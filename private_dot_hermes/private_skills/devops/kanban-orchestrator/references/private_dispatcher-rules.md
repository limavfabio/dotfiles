# Kanban Dispatcher Status Transition Rules

Verified against hermes-agent docs (`https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban`) and CLI dry-run behavior.

## Status Lifecycle

```
triage → todo → ready → running → done
                  ↑         ↓
                  │    blocked (human-in-the-loop)
                  │         ↓
                  └─── unblocked
```

## Dispatcher Promotion Rules

### `todo → ready`
- **Trigger**: Dispatcher promotes automatically when **every parent task is `done`**.
- **Docs**: "Link — task_links row recording a parent → child dependency. The dispatcher promotes todo → ready when all parents are done."
- **Frequency**: Every 60s (default `kanban.dispatch_interval_seconds`).
- **Verification**: Run `hermes kanban dispatch --dry-run --json` to see what would be promoted.

### `ready → running`
- **Trigger**: Dispatcher claims the task atomically and spawns a worker process for the assigned profile.
- **Precondition**: The assigned profile must be running (not stopped). A stopped profile will never claim tasks.

### `triage`
- **Dispatcher behavior**: **Completely ignores triage tasks.** Never spawns workers for them.
- **Docs**: "triage is the parking column for rough ideas a specifier is expected to flesh out. Tasks land here and the dispatcher leaves them alone until a human or specifier promotes them to todo / ready."
- **Promotion paths**:
  1. Manual: `hermes kanban show <id>` → status action row → promote to `todo` or `ready`
  2. Specifier: `hermes kanban specify <id>` — auxiliary LLM (configured via `triage_specifier` in config) expands the body and auto-promotes to `todo`
  3. Bulk: `hermes kanban specify --all` sweeps every triage task

### `specify` command behavior and caveats

**What it actually does** (from REST API docs: `POST /tasks/:id/specify`):
- **Rewrites the body** — replaces whatever was there with a structured spec (goal, approach, acceptance criteria). May also update the title.
- **Auto-promotes** triage → todo. No flag to suppress promotion.
- **Leaves an audit comment** recording who/what ran the specifier (the `--author` flag controls the attribution).

**Design issue**: The command conflates two independent gates:
1. *Fleshing out the spec* — turning a rough idea into an actionable task
2. *Declaring readiness* — asserting dependencies are satisfied, assignee is right, it's time to work

A task that can be derived from a single one-liner proves it *needed* specification, not that it's *ready to execute*. The user's opinion: spec fleshing should not auto-promote.

**Workarounds for specifying without promoting**:
- **Dogfood patch (recommended)**: A local `--no-promote` patch is applied as unstaged edits in `~/.hermes/hermes-agent/`. Three files changed: `hermes_cli/kanban_db.py` (+`promote: bool = True` param), `hermes_cli/kanban_specify.py` (+`promote: bool = True` param), `hermes_cli/kanban.py` (+`--no-promote` CLI flag). Usage: `hermes kanban specify <id> --no-promote` fleshes out the body but keeps status = triage. `hermes update` handles unstaged edits by stashing during pull and reapplying after — the patch survives updates. The patch is backward-compatible: default `promote=True` means zero behavior change for callers not using the flag. Upstream PR to `github.com/NousResearch/hermes-agent` is pending.
- **Edit body + comment in-place**: `hermes kanban edit <id> --body "..."` then `hermes kanban comment <id> "spec fleshed out"`. Task stays in triage. Body is the authoritative artifact.
- **Specify then demote**: Run `hermes kanban specify <id>` (body enriched, promoted to todo), then manually demote back to triage with the enriched body.
- **Pre-create review cards in triage** with `--triage --parent <impl_id>` so they stay parked until a human explicitly promotes them.

**Comment visibility to workers**: Workers CAN read comments via `kanban_show` (returns full comment thread). The kanban-worker skill explicitly instructs: "Read the comment thread." However, workers orient primarily on the task **body** — comments are supplementary. If the spec is only in a comment but the body is a one-liner, workers may skim and assume underspecification.

## Dependency Linking

- `hermes kanban link <parent_id> <child_id>` — parent first, then child. Mixing them up demotes the wrong task.
- Child created with `--parent <id>` during `hermes kanban create` starts in `todo` (not `ready`) because parent is unfinished.
- When parent completes (`done`), next dispatcher tick promotes child `todo → ready`.

## Specifier Code Trace

When debugging or patching the specifier, the call chain is:

```
hermes kanban specify <id>          # CLI entry
  → hermes_cli/kanban.py:_cmd_specify()    # argparse, iterates task ids
    → hermes_cli/kanban_specify.py:specify_task()  # LLM call + parse
      → hermes_cli/kanban_db.py:specify_triage_task()  # DB write
```

**The hardcoded promotion** lives at `kanban_db.py:2727`:
```python
sets: list[str] = ["status = 'todo'"]
```
That `'todo'` is unconditional — always appended to the UPDATE. The specifier also writes an audit comment (line 2752-2763) recording changed fields and promotion.

**Config**: The auxiliary LLM is configured at `auxiliary.triage_specifier` in `~/.hermes/config.yaml` (provider, model, base_url, api_key, timeout).

**To make promotion optional** (patch plan): add `promote: bool = True` parameter through all three functions. 3 files, ~15 lines. Backward-compatible. The hermes-agent repo at `github.com/NousResearch/hermes-agent` accepts PRs (153k stars, CONTRIBUTING.md at repo root).

## Profile Requirements

- Assignee name must match a profile that exists on the machine. Unknown assignees: dispatcher silently drops the task — card sits in `ready` forever, no error.
- Discover profiles: `hermes profile list`
- Profile must be running (gateway manages this). Stopped profiles: dispatcher won't spawn workers for them.
