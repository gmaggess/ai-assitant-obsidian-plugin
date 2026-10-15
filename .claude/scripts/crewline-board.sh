#!/usr/bin/env bash
# crewline-board.sh — single entry point for all crewline issue-state writes.
#
# A GitHub Project board is required — this script reads GITHUB_PROJECT from the
# settings.json beside it (resolved from the script's own location, so the caller's
# cwd does not matter) and fails loudly if it is missing or unresolvable. Every
# subcommand is idempotent.
#
# Usage:
#   crewline-board.sh status  <issue> <Backlog|Ready|In Progress|In Review|Done>
#   crewline-board.sh size    <issue> <XS|S|M|L|XL>
#   crewline-board.sh number  <issue> <round|ci_failures> <value>
#   crewline-board.sh claim   <issue>            # heartbeat — refresh on claim AND on every push
#   crewline-board.sh cleanup <issue>            # drop crew/* counters once the issue is done
#
# Requires: gh (authenticated), jq

set -euo pipefail

# Resolve settings relative to this script, not the caller's cwd. The script is
# installed at <repo>/.claude/scripts/, so the repo root is two levels up. This
# holds inside a git worktree too, where each worktree has its own checkout of
# .claude/ — and unlike `git rev-parse --show-toplevel` it needs no git call and
# works when the caller's cwd is somewhere else entirely (e.g. the reviewer,
# which runs with no isolated worktree and may be anywhere in the tree).
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SETTINGS="$SCRIPT_DIR/../settings.json"

die() { echo "crewline-board: $*" >&2; exit 1; }

[ $# -ge 2 ] || die "usage: crewline-board.sh <status|size|number|claim|cleanup> <issue> [args]"

CMD=$1
ISSUE=$2
[[ "$ISSUE" =~ ^[0-9]+$ ]] || die "issue must be a number, got '$ISSUE'"

setting() { [ -f "$SETTINGS" ] && jq -r "$1 // empty" "$SETTINGS" 2>/dev/null || true; }

# Resolve this issue's item ID on the configured project board, adding the issue
# to the board if it is not on it yet (addProjectV2ItemById is idempotent — it
# returns the existing item when one is already present). Fails loudly if no
# board is configured or the item ID cannot be resolved.
item_id() {
  local issue_node_id project_number project_id existing item
  project_number=$(setting '.GITHUB_PROJECT.project_number')
  project_id=$(setting '.GITHUB_PROJECT.project_id')
  [ -n "$project_number" ] && [ -n "$project_id" ] || \
    die "GITHUB_PROJECT is not configured in $SETTINGS — a board is required, run /crewline:setup"
  issue_node_id=$(gh issue view "$ISSUE" --json id --jq '.id')

  existing=$(gh api graphql -f query='
    query($issue_id: ID!) {
      node(id: $issue_id) {
        ... on Issue { projectItems(first: 10) { nodes { id project { number } } } }
      }
    }' -f issue_id="$issue_node_id" \
    --jq ".data.node.projectItems.nodes[] | select(.project.number == $project_number) | .id" 2>/dev/null || true)

  if [ -n "$existing" ]; then
    echo "$existing"
    return 0
  fi

  item=$(gh api graphql -f query='
    mutation($project: ID!, $content: ID!) {
      addProjectV2ItemById(input: {projectId: $project, contentId: $content}) { item { id } }
    }' -f project="$project_id" -f content="$issue_node_id" \
    --jq '.data.addProjectV2ItemById.item.id' 2>/dev/null || true)
  [ -n "$item" ] || die "failed to resolve or add board item for issue #$ISSUE (project_id=$project_id may be stale)"
  echo "$item"
}

set_field() {
  local item=$1 field_id=$2 value_expr=$3
  # A project created before this field existed has no ID for it in settings.
  # Skip rather than fail — the task list still carries the value.
  [ -n "$field_id" ] || return 0
  gh api graphql -f query="
    mutation(\$project: ID!, \$item: ID!, \$field: ID!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: \$project, itemId: \$item, fieldId: \$field, value: { $value_expr }
      }) { projectV2Item { id } }
    }" \
    -f project="$(setting '.GITHUB_PROJECT.project_id')" \
    -f item="$item" -f field="$field_id" >/dev/null
}

case "$CMD" in
  status)
    [ $# -eq 3 ] || die "usage: crewline-board.sh status <issue> <status>"
    STATUS=$3
    ITEM=$(item_id)
    OPTION=$(setting ".GITHUB_PROJECT.fields.status.options[\"$STATUS\"]")
    [ -n "$OPTION" ] || die "unknown status '$STATUS' — not in settings"
    set_field "$ITEM" "$(setting '.GITHUB_PROJECT.fields.status.field_id')" \
      "singleSelectOptionId: \"$OPTION\""
    ;;

  size)
    # Set once by issue-architect at creation.
    [ $# -eq 3 ] || die "usage: crewline-board.sh size <issue> <XS|S|M|L|XL>"
    SIZE=$3
    ITEM=$(item_id)
    OPTION=$(setting ".GITHUB_PROJECT.fields.size.options[\"$SIZE\"]")
    [ -n "$OPTION" ] || die "unknown size '$SIZE' — not in settings"
    set_field "$ITEM" "$(setting '.GITHUB_PROJECT.fields.size.field_id')" \
      "singleSelectOptionId: \"$OPTION\""
    ;;

  number)
    [ $# -eq 4 ] || die "usage: crewline-board.sh number <issue> <round|ci_failures> <value>"
    FIELD=$3 VALUE=$4
    [[ "$VALUE" =~ ^[0-9]+$ ]] || die "value must be a number, got '$VALUE'"
    case "$FIELD" in
      round|ci_failures) ;;
      *) die "unknown field '$FIELD' (expected round|ci_failures)" ;;
    esac
    ITEM=$(item_id)
    set_field "$ITEM" "$(setting ".GITHUB_PROJECT.fields.${FIELD}.field_id")" "number: $VALUE"
    ;;

  claim)
    # Liveness heartbeat: the signal the reconciler reads to tell a working agent
    # from a dead one. Refreshed on claim and on every push, so it means "last
    # proof of life" rather than "when I started" — that is what makes a single
    # stale-timestamp check sufficient, with no separate post-reclaim grace window.
    #
    # Written as Heartbeat = 1 on the project board. The stored value is a constant
    # (always 1); the write itself is the pulse — ProjectV2 field values each carry
    # their own updatedAt that advances even when the value is unchanged. The
    # reconciler reads Heartbeat.updatedAt to detect stuck agents, treating a null
    # field value (never claimed) as "not stuck".
    ITEM=$(item_id)
    set_field "$ITEM" "$(setting '.GITHUB_PROJECT.fields.heartbeat.field_id')" "number: 1"
    ;;

  cleanup)
    # Nothing to clean up: the Heartbeat field value stays on the board (it's
    # machine state and poses no confusion once the issue is Done), and there are
    # no crew/* labels left to remove for this issue.
    ;;

  *) die "unknown subcommand '$CMD' (expected status|size|number|claim|cleanup)" ;;
esac
