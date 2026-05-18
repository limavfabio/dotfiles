# CLI Fallback When Kanban Tools Are Unavailable

The `kanban-orchestrator` skill assumes the agent has kanban tools in its schema (`kanban_create`, `kanban_link`, `kanban_list`, etc.). The main session agent (the one the user talks to directly) may NOT have these tools — they are part of the `kanban` toolset enabled for workers spawned by the dispatcher, not necessarily for the orchestrator's own session.

When kanban tools are missing, use the `hermes kanban` CLI. All tool calls have CLI equivalents:

## Tool → CLI Mapping

| Tool call | CLI equivalent |
|-----------|---------------|
| `kanban_create(title, assignee, body, parents, skills, workspace)` | `hermes kanban create "title" --assignee <profile> --body "..." --parent <id> --skill <name> --workspace dir:<path> --json` |
| `kanban_list(assignee, status)` | `hermes kanban list --assignee <profile> --status <status> --json` |
| `kanban_show(task_id)` | `hermes kanban show <id>` |
| `kanban_link(parent_id, child_id)` | `hermes kanban link <parent_id> <child_id>` |
| `kanban_complete(summary, metadata)` | `hermes kanban complete <id> --summary "..." --metadata '{"key":"val"}'` |
| `kanban_comment(task_id, body)` | `hermes kanban comment <id> "body text"` |
| `kanban_block(task_id, reason)` | `hermes kanban block <id> "reason"` |
| `kanban_unblock(task_id)` | `hermes kanban unblock <id>` |

## Key Differences

1. **Title is positional** in CLI: `hermes kanban create "My Task"` not `--title "My Task"`
2. **--parent is repeatable** for multiple parents: `--parent t_aaa --parent t_bbb`
3. **--workspace** controls isolation: `scratch` (default), `worktree`, or `dir:<absolute/path>`
4. **--json** flag gives structured output with task IDs — always use it when creating tasks so you can capture the ID for linking
5. **--skill is repeatable** for multiple skills: `--skill subagent-driven-development --skill test-driven-development`

## Discovery

Before creating cards, always:
- `hermes profile list` — discover available profiles (assignee names must exist or dispatcher silently drops the task)
- `hermes kanban boards list` — check current board or switch with `hermes kanban boards switch <slug>`
- `hermes kanban list --json` — see existing tasks on current board

## Creating Gated Children

Create the parent first with `--json`, capture its `id`, then create the child with `--parent <parent_id>`. The child starts in `todo` and auto-promotes to `ready` when all parents reach `done`.

```bash
PARENT=$(hermes kanban create "Review plan" --assignee swe --body "..." --json | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
hermes kanban create "Implement feature" --assignee swe --parent "$PARENT" --body "..." --json
```
