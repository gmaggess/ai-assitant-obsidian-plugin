<!-- BEGIN: crewline -->
# Project AI Automation

## Settings

Stored in `.claude/settings.json`, set during `/crewline:setup`:

| Key | Default | Meaning |
|---|---|---|
| `MAX_PARALLEL_ISSUES` | — | Hard cap on issues worked concurrently |
| `DEAD_AGENT_TIMEOUT_MINUTES` | 30 | Heartbeat age before a slot is reclaimed |
| `GITHUB_PROJECT` | — | Board number, ID, field/option IDs |

## Agents

| Agent | Role |
|---|---|
| `issue-architect` | Reads specs/, creates milestones, labels, issues, and dependency graph |
| `issue-coder` | Implements issues in isolated worktrees, opens PRs |
| `issue-reviewer` | Reviews PRs, posts comments, merges on approval |
| `doc-writer` | Creates and updates documentation, always via a GitHub issue + PR |
| `doc-reviewer` | Validates doc accuracy against codebase and other docs |
| `spec-writer` | Brainstorms and drafts specs/ documents (PRD, ARCHITECTURE, DESIGN, etc.) |
| `spec-reviewer` | Validates spec consistency, completeness, format, and ADR coverage |
| `idea-shaper` | Pressure-tests a raw idea into a scoped scratchpad before specs exist |

## State: GitHub is the database

Two stores, one of them authoritative:

- **Task list** (`TaskCreate`/`TaskUpdate`) — session-local, lost on restart. Working memory only.
- **GitHub** — durable. Board fields: Status, Priority, Size, Round, CI Failures, and Heartbeat (liveness signal).

All writes to durable state go through **`.claude/scripts/crewline-board.sh`** (committed in-repo; see its own usage output and the agent files for exact invocations). It fails loudly if the board is missing or unreachable — **no caller ever branches on board availability**.

Because durable state always lives in GitHub, **`SendMessage` between agents is a latency optimization only** — correctness never depends on a message arriving. A lead that lost its task list rebuilds it by running a Reconcile tick (see `crewline:reconcile`).

## Team lead responsibilities

The team lead is the main Claude session running in this repo. It loads issues directly — there is no separate loader agent. The full loading, polling, and reactive-handler procedures live in the **`crewline:orchestrate`** skill; the reconstruction and liveness procedures live in **`crewline:reconcile`**. This section only summarizes the durable task schema both skills read and write.

### Task structure

- **Name**: `"#NUMBER: issue title"` — e.g. `"#42: Add auth service"`
- **Native status**: `pending` | `in-progress` | `completed`
- **Details**:
  ```
  Sub-status: PENDING
  Issue: #NUMBER
  PR: (empty until opened)
  Round: 1
  CI Failures: 0
  Worktree: (path, recorded by the coder/doc-writer when it claims)
  Branch: (branch name, recorded alongside Worktree)
  Notes: (rejection feedback, blockers, escalation summaries)
  ```

`Round` and `CI Failures` are mirrored to GitHub via `crewline-board.sh number` on every change, so they survive a restart.

| Sub-status | Native | Meaning |
|---|---|---|
| `PENDING` | pending | Awaiting coder |
| `IN PROGRESS` | in-progress | Coder working |
| `READY FOR REVIEW` | in-progress | PR opened, awaiting reviewer |
| `IN REVIEW` | in-progress | Reviewer working |
| `ACCEPTED` | completed | Merged and done |
| `BLOCKED` | pending | Lead must fix the cause, then requeue to `PENDING` |
| `ESCALATED` | in-progress | Human intervention required — carries `needs-human` |

Only two non-happy-path behaviors exist, so only two states. The **reason** lives in the task Notes and in a `⚠️`-prefixed issue comment — never encoded in the state name.

Load procedures ("Loading issues", "Polling after merges", the reactive handlers, and ad-hoc issue creation) are in `crewline:orchestrate`. Liveness and reconstruction ("Reconcile tick", "Dead agent detection", running it unattended via `/loop`) are in `crewline:reconcile`. Review-round caps, worktree handling, and learnings-store conventions are documented in the `issue-coder` and `issue-reviewer` agent definitions, loaded only when those agents run. Spec doc structure and scope-leakage rules are documented in the `spec-writer` and `spec-reviewer` agent definitions.

## Trigger phrases

### Specs
```
let's brainstorm [topic]          continue the brainstorm on [topic]
generate the specs                review the specs
```

### Issues
```
create an issue for [X]                          → lead creates it directly (crewline:orchestrate)
read specs/ and create github issues             → issue-architect, plan mode
read specs/ and create github issues --milestone v1.0
start the team for issue #1, #2                  → explicit mode (crewline:orchestrate)
start the team on unblocked issues               → auto mode (crewline:orchestrate)
start the team on unblocked issues --milestone v1.0
```

### Documentation
```
create an issue and update specs/auth.md — [gap]
fix the doc drift flagged in PR #X               → spawns doc-writer
review docs for milestone v1.0
review specs/auth.md against the codebase
```

### Reconciliation
```
run reconcile                                              → crewline:reconcile skill
/loop 5m run the crewline Reconcile tick for this repo      → unattended local reconciliation
```

## Blocking relationships

GitHub native blocking is used for dependencies. An issue is unblocked when its last `BlockedBy` timeline event is `BlockedByRemovedEvent`, or it has no such events.
<!-- END: crewline -->
