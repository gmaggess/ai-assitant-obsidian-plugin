#!/usr/bin/env bash
# crewline-pr.sh — push the current branch and open a PR for it.
#
# Opens as crew-coder[bot] when CREWLINE_GITHUB_APP_CODER is configured in
# ~/.claude/settings.json, otherwise as the current user's gh session.
#
# Usage: crewline-pr.sh "PR title" "PR body"

set -euo pipefail

TITLE="$1"
BODY="$2"

APP_CONFIG=$(jq -r '.CREWLINE_GITHUB_APP_CODER // empty' ~/.claude/settings.json 2>/dev/null || true)

if [ -n "$APP_CONFIG" ]; then
  APP_ID=$(echo "$APP_CONFIG" | jq -r '.app_id')
  KEY_PATH=$(echo "$APP_CONFIG" | jq -r '.private_key_path')
  INSTALLATION_ID=$(echo "$APP_CONFIG" | jq -r '.installation_id')
  CREW_TOKEN=$(~/.claude/scripts/github-app-token.sh "$APP_ID" "$KEY_PATH" "$INSTALLATION_ID")

  REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  BASE=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')

  # Push as the bot by embedding its token in the remote URL rather than
  # relying on gh's session. Restore the original URL unconditionally — a
  # trap covers both the success path and any failure below it.
  ORIGIN_URL=$(git remote get-url origin)
  restore_origin() { git remote set-url origin "$ORIGIN_URL"; }
  trap restore_origin EXIT

  git remote set-url origin "https://x-access-token:${CREW_TOKEN}@github.com/${REPO}"
  git push origin HEAD

  # Raw curl, not `gh api`: gh api ignores GH_TOKEN when a session is already
  # configured, which would silently open the PR as the logged-in user instead
  # of the bot. This is deliberate — do not "simplify" it back to `gh api`.
  PAYLOAD=$(jq -n \
    --arg title "$TITLE" \
    --arg body "$BODY" \
    --arg head "$BRANCH" \
    --arg base "$BASE" \
    '{title: $title, body: $body, head: $head, base: $base}')

  RESPONSE=$(curl -s \
    -X POST \
    -H "Authorization: Bearer $CREW_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    "https://api.github.com/repos/$REPO/pulls")

  PR_NUMBER=$(echo "$RESPONSE" | jq -r '.number')

  if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
    echo "ERROR: PR creation failed: $(echo "$RESPONSE" | jq -r '.message // .')" >&2
    exit 1
  fi

  echo "PR #$PR_NUMBER"
else
  git push origin HEAD
  gh pr create --title "$TITLE" --body "$BODY"
fi
