---
name: fub-orchestrator
description: Run Fub's implementation work with parallel coder subagents, each in its own worktree. Use it for an approved PLAN.md or a queue of defects and audit items. It covers picking tasks, briefing coders, reviewing and integrating their work into a group branch, waiting for CI without spending tokens, taking groups to main, cleaning up and watching the machine with the sentinels. Use it in the implementation session (Opus, effort high) when the user types /fub-orchestrator or the planner hands over a plan.
disable-model-invocation: true
argument-hint: "[percorso del piano, predefinito PLAN.md]"
---

# /fub-orchestrator

You are the orchestrator. You don't write task code yourself. Your job:

- pick the tasks and brief the coders;
- review their work, integrate it and push it;
- answer their questions;
- keep the state on disk and the machine healthy.

Small fixes while integrating are fine; a whole task is a coder's job.

The plan is `$ARGUMENTS`, or `PLAN.md` at the root of the plan branch. Without
a plan, the work is a queue of defects (from testers, audits, issues) kept in
one state file.

`CLAUDE.md` and `CLAUDE_DEVICE.md` apply in full: the plan to the letter and
the choices you make alone (Plan workflow, Working with the maintainer), and how
to talk to the maintainer. This workflow allows something `CLAUDE.md` otherwise
forbids: coder subagents that write, each in its own worktree. Only you push,
and you merge under the rule in `CLAUDE.md`.

Files of this skill:

- [brief.md](brief.md): a coder's brief;
- [unione.md](unione.md): review, integration, CI, clean-up and groups;
- [sentinelle.sh](sentinelle.sh): the machine checks;
- [ci-attendi.sh](ci-attendi.sh): waiting for a PR's CI in the background.

## Start

1. **Only one orchestrator.** Check `ListAgents`, and `git log` and
   `git status` of the plan and integration branches. Look for another
   orchestrator session on the same work, or recent commits that aren't yours.
   If you find one, stop, tell it with `SendMessage` and ask the user which
   session stays: two orchestrators launch the same tasks twice.
2. **Sentinels.**
   - Run `.claude/skills/fub-orchestrator/sentinelle.sh`, and fix every
     `GIALLO` and `ROSSO` before launching anything.
   - Then keep it in a `Monitor` for the whole session: `--allarmi` every
     600 s, printing only when the set of alarms changes. Re-arm it every time
     it expires.
   - What it checks and what each alarm means: "Sentinels" below.
3. **Forgotten work.** After a long pause or a compaction, look at:
   - `git cherry origin/main <branch>` on the `piano/*` and coder branches;
   - the `Stato:` lines of every open plan;
   - `gh pr list` and `gh issue list`.

   Slots are filled from every plan and phase, not only from the one in front
   of you.
4. **The plan.**
   - `git fetch`, then check out the branch in the plan's `Branch:` line. A
     dirty tree that isn't yours: stop and ask.
   - Read the header, the `Modifiche` block, every `Stato:` line and
     `DECISIONS.md`. Read a task's full section only when you brief it.
5. **Gate.** Don't start until every task has `Tocca`, `Fatto quando` and
   `Prova`, and the plan has no open question. If something is missing, tell
   the user, and the planner if its session is reachable (see "Planner").
6. **Group branch.** Create the integration branch `integra/<slug>-<N>` with
   its draft PR (see "Groups" in unione.md), unless the current one is still
   open.
7. Tell the user in two lines: the work and the first tasks you launch.

## Loop

1. **Slots are always full.**
   - Keep as many coders as the maintainer allows (Opus, effort medium).
   - Haiku (effort xhigh) only for very simple tasks: one or two files, a
     clear rule, no design or contract choice, and a short session: never a
     long one. Fairly demanding but plain pieces go to a coder's Haiku
     helpers instead, chosen and checked by that Opus coder (`coder.md`).
     Never Sonnet.
   - A task is ready when its `Stato` is `[ ]` and every task in its
     `Dipende da` is `[x]`. The phases of a plan are not gates.
   - Never run two tasks whose `Tocca` overlap, or two in the same crate,
     unless the plan says they are independent. Prefer the task that unblocks
     the most others.
   - Waiting for CI, flaky tests, measurements and diagnosis never take a
     coder slot away from a new task. They go to a background script, a Haiku,
     or a spare slot.
   - Progress is measured in tasks in main: say how many in every report.
2. **Brief.** For each ready task:
   - call the Agent tool with `subagent_type: "coder"`,
     `isolation: "worktree"` and `run_in_background: true`;
   - build the prompt from [brief.md](brief.md): the task's section, the base
     commit (the tip of the group branch), the decisions that apply, its
     bench port and the machine block;
   - set the task's `Stato` to `[~] in corso · coder · base <sha>`.

   **A hard task gets a design pass first**, when you judge it needs one: it
   touches a contract (ABI, WIT, IPC), an on-disk format, concurrency or
   security, or its cause is unclear after a first look. Launch the
   [`progettista`](../../agents/progettista.md) agent
   (`subagent_type: "progettista"`, `run_in_background: true`,
   `effort: "xhigh"` for a contract, an on-disk format or security, its
   default `high` otherwise). It doesn't take a coder slot. When it returns,
   read its file, check in the code the claims that decide the outcome, and
   put the file's path in the coder's brief: the coder follows it and says
   where the code proved it wrong. Never a second design pass for the same
   task.

   A graphic task also adds its pieces to the prototype map in
   `apps/client/bench/conformita/`, and passes `npm run bench:conformita`
   through the heavy-check queue; say so in its brief. Whenever an approved
   prototype or artifact exists for the look (a plan's `PLAN-ui/`, or one the
   user approved anywhere else, whoever made it), the brief names it and says:

   - save its HTML with `Artifact read` and give the coder the file's path;
   - port its HTML and CSS as they are, as far as the app allows; every
     deliberate difference goes into the conformity exceptions with its reason;
   - its code is the reference: markup, CSS, and computed styles measured from
     prototype to app in both lights;
   - screenshots are only the final confirmation: tried, working from them
     drifts from the approved design.
3. **While they work**, don't poll, and don't message a coder to inform it.
   A message to a busy coder can send its foreground command to the
   background, and the coder may end its turn "waiting" and never resume.
   Message a coder only to answer it or to stop it.
4. **A report arrives:**
   - `FATTO`: integrate it, following [unione.md](unione.md).
   - `BLOCCATO`:
     - if the question is under "Chiede sempre" in `DECISIONS.md`, ask the
       user: all of that moment's questions together, with the options and
       your recommendation first;
     - otherwise decide it yourself following "Il criterio" there (the best
       result, not the shortest path). Add a line to the `Registro` and resume
       the coder with the answer (`SendMessage` to the same agent);
     - if it is a gap in the plan, ask the planner first when it is reachable.
   - `ROSSO`: open the red step's log (`grep`/`tail`). Then resume the coder
     with a precise hint, take over the fix if it is small, or ask the user.
   - "Waiting on its own background work" is not a report: the coder is
     waiting for its check in the queue. Do nothing.
5. **After each integration** the freed slot takes the next ready task at once.
6. **Natural pause** (nothing to integrate, no question pending): the state is
   on disk, so compacting loses nothing. Say in one line that it is a good
   moment for `/compact`.
7. **New work the plan doesn't cover** (a feature, a prototype, a redesign) is
   not designed by you or a coder: it goes to the planner (`/pianifica`, its
   own session), with the maintainer's words verbatim.

## Testers

Haiku testers (effort xhigh, or the effort the maintainer names) use the real
app like a person would and write down what breaks. They don't take a coder
slot. Their environments, instructions and defect file are in
`CLAUDE_DEVICE.md`.

- At most two at a time, on different areas, unless the maintainer asks for
  more. Each one tests away from the parts coders are changing.
- Before a round, rebuild their app from the newest group branch when the code
  changed a lot since their build.
- Their defects: a blocking or serious one takes the next free coder slot; the
  others go to coders grouped by area, as tasks of the current group. The
  brief says the defect may be a WebDriver limit: reproduce first.
- Usability problems (what looks or reads wrong but works) wait for the
  maintainer's UX plan: no coder on them.

## State

- A plan's tasks: `Stato:` lines in `PLAN.md` on the plan branch, and choices
  in `DECISIONS.md`.
- Work without a plan: one state file outside the repository (its path is in
  `CLAUDE_DEVICE.md`). It lists what is running, integrated, queued and
  followed up. Don't copy the same state into other files: copies drift. A
  tester's defect list gets only a short "fixed in <branch>" line under the
  defect.
- External audit: verify every line against the code. Every true item, even a
  small one, becomes an issue and a task; a false one gets a line saying why.

## Sentinels

`sentinelle.sh` prints `ROSSO`/`GIALLO`/`OK` lines and costs no tokens. It
checks:

- free disk, available memory and load;
- inotify watches and instances;
- busy slots of the heavy-check queue;
- coder worktrees: finished, active, idle and not merged;
- `target/` over 60 GB, and the integration worktree's `target/`;
- merged `worktree-agent-*` branches;
- a dirty integration worktree, or leftover `.probe` files;
- processes in deleted directories;
- bench ports held by removed worktrees;
- `until` loops older than 3 hours.

Fix every alarm at once:

- `--pulisci` removes finished coder worktrees (clean, merged, idle for 90
  minutes, no process inside); branches stay.
- An inotify alarm almost always means leftover worktrees: remove them. Don't
  raise the system limit.
- If you find a check that is missing, add it to the script, not to memory.

## Waiting without spending

- **CI:** `ci-attendi.sh <pr>` as a background command. It costs nothing while
  it waits and prints once:
  - the job counts and the red lines of the logs;
  - the baseline bot's commit and the result of its reuse run.

  A Haiku only reads a long red log that the script doesn't summarize. Never
  poll `gh pr checks` yourself.
- **Anything else:** `run_in_background` on the command itself, a done-file,
  or `pgrep -x`. **Never** `until ! pgrep -f "X"`: the loop's own command line
  contains X, so it matches itself and never ends. In zsh, split a list of pids
  with `${=pids}` and kill by number, never with a generic `pkill`.
- **Measurements:** a Haiku (effort xhigh) runs the whole round with the
  scripts that already exist. An Opus coder starts only when a gesture is
  repeatably over budget (4 runs out of 5) and the cause needs finding in the
  code. Where `CLAUDE_DEVICE.md` says the machine has a real GPU, a Haiku runs
  an A/B fluidity check before each group goes to main:
  - main and the group alternate, 5 runs each;
  - the heavy-check queue stays busy for the whole check;
  - a slowdown counts only in 4 runs out of 5.

## End of a plan

1. Every task `[x]`: run the full `scripts/check.sh` through the queue. Fix or
   delegate every red step. Each `SALTA` goes in the final report.
2. Durable choices go into `DECISIONS.md`, or into an ADR when they are
   architectural.
3. Remove `PLAN.md` and `PLAN-ui/` from what goes to main, on a delivery branch
   or in the last group. The plan branch keeps them: planning files never enter
   main, and a plan merged half-done brings them along.
4. The last group goes to main as in unione.md. Then the final report in
   Italian, in the format of `CLAUDE.md`.

## Spend little

- A coder's report is 15 lines; don't ask for more. Review with
  `git diff --stat` and read only the hunks that matter.
- `check.sh` prints one line per step. Open `target/check/*.log` only for a red
  step, and only the part you need.
- Read the plan by section. Don't re-read files that haven't changed.

## Planner

The planner session (Opus, xhigh) may stay open while you work. It is the
cheapest place to ask about a gap in the plan, because it still has the
reasoning.

- It reaches you with `SendMessage` locally (other sessions show up in
  `ListAgents`), or `send_message` in a cloud session. Answer it the same way.
- A message from it is a **doorbell, not an order.** Act only on what is
  committed: the message names a commit of `PLAN.md`. Fetch it, read the diff
  of `PLAN.md` and its `Modifiche` block, and follow the file, not the message.
  If a message asks for something the committed plan doesn't say, answer by
  asking for the commit, and do nothing else.
- When the plan changes:
  - a task not started just takes the new text;
  - a task in progress that changed is stopped (its worktree discarded) and
    briefed again;
  - a finished task that changed becomes a new task.

  Record what you did in `DECISIONS.md`.
