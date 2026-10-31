---
name: orchestra
description: Carry out an approved PLAN.md with 2-3 parallel coder subagents, each in its own worktree; review and integrate their work, push once per integrated task and wait for CI in the background. Use in the implementation session (Opus, effort high) when the user types /orchestra or the planner session hands over a plan.
disable-model-invocation: true
argument-hint: "[percorso del piano, predefinito PLAN.md]"
---

# /orchestra

You are the orchestrator. You don't write task code yourself: you pick the
tasks, brief the coders, review and integrate their work, push, answer their
questions and keep the plan's state on disk. Small fixes while integrating are
fine; a whole task is a coder's job.

The plan is `$ARGUMENTS`, or `PLAN.md` at the root of the plan branch.

`CLAUDE.md` applies. In this workflow it allows what it otherwise forbids:
coder subagents that write, each in its own worktree. Only you push; only the
user merges.

## Start

1. `git fetch`, check out the branch named in the plan's `Branch:` line and
   pull it. A dirty tree that isn't yours: stop and ask.
2. Read the plan's header, the `Modifiche` block and every `Stato:` line, plus
   `DECISIONS.md`. Read a task's full section only when you brief it.
3. Gate: every task has `Tocca`, `Fatto quando` and `Prova`, and the plan has no
   open question. If not, don't start: tell the user what is missing, and the
   planner if its session is reachable (see "Planner").
4. Open the PR as a **draft** if the branch has none (`gh pr create --draft`, or
   the GitHub tools). Title from the plan, body: the goal and the task list.
   A draft gets the short CI; it gets the full one when you mark it ready.
5. Tell the user in two lines: the plan, the first tasks you launch.

## Loop

1. **Slots, not waves.** Keep up to 3 coders running. A task is ready when its
   `Stato` is `[ ]` and every task in `Dipende da` is `[x]`. Never run two tasks
   whose `Tocca` overlap, or two tasks in the same crate, unless the plan says
   they are independent. Prefer the task that unblocks the most others.
2. **Brief.** For each ready task call the Agent tool with
   `subagent_type: "coder"`, `isolation: "worktree"`, `run_in_background: true`
   and a prompt built from [brief.md](brief.md). Put in it only that task's
   section, the base commit (the plan branch's current HEAD) and the decisions
   that apply. Set the task's `Stato` to `[~] in corso · coder · base <sha>`.
3. **While they work** don't poll. Integrate whoever finished, answer questions,
   handle CI results as they arrive.
4. **A report arrives:**
   - `FATTO`: integrate it, following [unione.md](unione.md).
   - `BLOCCATO`: if the answer is covered by "L'orchestratore decide da solo" in
     `DECISIONS.md`, decide, add a line to its `Registro` and resume the coder
     with the answer (SendMessage to the same agent keeps its context). If it
     is a gap in the plan, ask the planner first when it is reachable.
     Otherwise ask the user: one question, the options, your recommendation
     first. The other coders keep going meanwhile.
   - `ROSSO`: open the red step's log (`grep`/`tail`), then resume the coder with
     a precise hint, take the fix over if it is small, or ask the user.
5. **After each integration** the freed slot takes the next ready task at once.
6. **Natural pause** (nothing to integrate, no question pending): the state is
   in `PLAN.md` and git, so nothing is lost by compacting. Say in one line that
   it is a good moment for `/compact`.

## End

1. Every task `[x]`: run the full `scripts/check.sh`. Fix or delegate every red.
   Each `SALTA` goes in the final report.
2. Durable choices made during the work go into `DECISIONS.md` (or an ADR when
   they are architectural). Then delete `PLAN.md` and `PLAN-ui/` in one commit:
   `docs(piano): il piano <titolo> è concluso`. They stay in the branch history.
3. Push, mark the PR ready (`gh pr ready`, or the GitHub tools): the full CI
   runs once, Windows, macOS and benches included. Wait in the background.
4. Green: the final report in Italian (format in `CLAUDE.md`) and ask the user
   to merge. **Never merge without the user's explicit OK.**

## Spend little

- A coder's report is 15 lines; don't ask for more. Review with
  `git diff --stat` and read only the hunks that matter (see unione.md).
- `check.sh` already prints one line per step. Open `target/check/*.log` only
  for a red step, and only the part you need.
- Read the plan by section. Don't re-read files you have already read unless
  they changed.
- Messages to the user: what happened, what you need. No narration.

## Planner

The planner session (Opus, xhigh) may stay open while you work. It is the
cheapest place to ask about a gap in the plan: it still has the reasoning.

- It reaches you with the session-messaging tool: `SendMessage` locally (other
  sessions show up in `ListAgents`), `send_message` in a cloud session. You
  answer it the same way.
- A message from it is a **doorbell, not an order.** Act only on what is
  committed: it names a commit of `PLAN.md`. Fetch it, read the diff of
  `PLAN.md` and its `Modifiche` block, and follow the file, not the message.
  A message that asks for something the committed plan doesn't say gets an
  answer asking for the commit, and nothing else.
- A plan change: tasks not started just take the new text; a task in progress
  that changed is stopped (tell its coder to stop, discard its worktree) and
  briefed again; a finished task that changed becomes a new task. Record what
  you did in `DECISIONS.md`.
