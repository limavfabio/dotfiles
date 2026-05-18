# Kanban Operational Notes

Techniques and details discovered through operational use. Not part of the
core spec — these are the "how to actually do X when the CLI doesn't cover it"
entries.

## Changing workspace on an existing task

**CLI and REST API do NOT support changing workspace after creation.** The
PATCH endpoint handles status / assignee / priority / title / body / result
only — no `workspace_kind` or `workspace_path`.

Workaround: direct SQLite update on the board-specific database.

```bash
# The board-specific DB is at:
#   ~/.hermes/kanban/boards/<board-slug>/kanban.db

sqlite3 ~/.hermes/kanban/boards/<slug>/kanban.db \
  "UPDATE tasks SET workspace_kind = 'dir',
                    workspace_path = '/absolute/path/to/repo'
   WHERE id = 't_<hex>';"
```

Common workspace values:
- `scratch` — tmp dir, GC'd on archive (default)
- `dir:<path>` — shared persistent directory, multiple runs share it
- `worktree` — git worktree at resolved path

The task must exist on the correct board. If unsure which board, check
`hermes kanban boards list` for the current board slug.

## What `hermes kanban specify` actually does

The `specify` command runs the auxiliary LLM (configured under
`auxiliary.triage_specifier` in config.yaml) to flesh out a triage task.
It:

1. **Rewrites the body** — replaces the existing body with a structured
   spec: Goal, Approach, Acceptance criteria, Out of scope. May also
   update the title.
2. **Leaves an audit comment** — "Specified — updated title,body and
   promoted to todo." (or "kept in triage" if `--no-promote` is used).
3. **Promotes triage → todo** — always (unless `--no-promote` flag is
   used, which requires the local patch described below).

The promotion is a single hardcoded line in `hermes_cli/kanban_db.py`:
`specify_triage_task()` at line 2727. No config flag controls this.

If the specifier LLM returns malformed JSON, the fallback uses the raw
response as the body and leaves the title unchanged. If the LLM call
fails entirely, the task stays untouched in triage.

## `--no-promote` patch (dogfood)

A local patch allows `hermes kanban specify <id> --no-promote` to flesh
out the body while keeping the task in triage. Files changed:

- `hermes_cli/kanban_db.py` — `specify_triage_task()`: added `promote: bool = True` param
- `hermes_cli/kanban_specify.py` — `specify_task()`: added `promote: bool = True` param
- `hermes_cli/kanban.py` — `_cmd_specify()`: reads `--no-promote`, passes `promote`

All changes are backward-compatible (default `promote=True`). The patch
is kept unstaged so `hermes update` can stash/reapply it.

## Three-card plan-review chain (plan review → implement → code review)

When a plan must be reviewed before implementation, use this pattern:

```
t_review_plan (ready) → swe   "Review: <feature> implementation plan"
   └─ t_implement (todo) → swe   "Implement: <feature>"
        └─ t_review_code (triage) → swe   "Review: <feature> implementation"
```

Key design decisions:

1. **Plan review starts in `ready`** — dispatcher picks it up immediately.
   The review card's body instructs the worker to read the plan file and
   apply taste/improvements directly.

2. **Implementation starts in `todo`** — gated on plan review completing.
   Auto-promotes when review is done. Uses `--skill subagent-driven-development`
   and `--skill test-driven-development`.

3. **Code review starts in `triage`** — NOT gated on implementation.
   This keeps the review as a human decision gate. The user decides when
   to specify (expand body) and promote to `todo`. If the review card were
   `todo` with parent = implementation, it would auto-promote and run
   without human oversight.

4. **All cards use `--workspace "dir:<repo-path>"`** when working in a
   single-project board like varejo-rails. This gives the worker direct
   access to the repo for reading the plan, editing files, and committing.

## Workspace type selection

| Kind | When to use |
|------|------------|
| `scratch` | Research, data processing, one-shot scripts. Isolated, auto-GC'd. |
| `dir:<path>` | Project-specific work where the worker needs the full repo context (AGENTS.md, existing code, tests). Multiple tasks in the same project share this workspace. Worker MUST create a feature branch to avoid polluting main. |
| `worktree` | When isolation matters — parallel tasks on the same repo, or when you want automatic worktree creation + branch management. Dispatcher creates `~/.hermes/kanban/boards/<board>/workspaces/t_xxx`. |

**`dir:` is the default for project boards.** It's simpler and gives workers
access to project conventions (AGENTS.md, gemfile, etc.). The tradeoff is
no isolation — two workers on the same `dir:` can step on each other.
Use `worktree` when running parallel implementation tasks.

## Single-profile boards and scope-creep

When ALL cards are assigned to the same profile (e.g., `swe` for both
review and implementation), the worker's context isolation comes from
the fresh kanban spawn — not from profile differences. However, a worker
on a "review plan" task may scope-creep into implementation if the task
body isn't explicit enough. Mitigation:

- **Review card body**: explicitly say "read and modify the plan file only —
  do NOT implement code."
- **Implementation card body**: explicitly say "follow the reviewed plan —
  do NOT re-review it."
- After review completes, check `git log` to verify the worker only touched
  the plan file (`.hermes/plans/`), not source code.
