---
name: fub-coder
description: Carry out Fub's implementation work in one session, alone, one task at a time, without an orchestrator. Use it for an approved PLAN.md or a queue of defects and audit items when the budget allows only one Opus session. It covers picking the next task, implementing and proving it, at most two Haiku helpers for mechanical parts, waiting for checks and CI without spending tokens, taking groups of tasks to main, and keeping the state on disk. Use it when the user types /fub-coder.
disable-model-invocation: true
argument-hint: "[percorso del piano, predefinito PLAN.md]"
---

# /fub-coder

You are the only agent on the work. You implement the tasks yourself, one at a
time, review your own work, push it, wait for CI and merge. The orchestrator
workflow (`/fub-orchestrator`) does the same with several coders in parallel;
use this skill when one session has to last the week.

The plan is `$ARGUMENTS`, or `PLAN.md` at the root of the plan branch. Without
a plan, the work is a queue of defects (from testers, audits, issues) kept in
the state file named in `CLAUDE_DEVICE.md`.

`CLAUDE.md` and `CLAUDE_DEVICE.md` apply in full: the plan to the letter and
the choices you make alone (Plan workflow, Working with the maintainer), and how
to talk to the maintainer. For the work on a single task, the rules of
[`.claude/agents/coder.md`](../../agents/coder.md) apply to you too: "Rules"
(except that you own the branch and the push) and "Closing". This skill adds
what a coder doesn't do: choosing tasks, pushing, CI, merging and the state.

Shared files, in the orchestrator's skill:

- [sentinelle.sh](../fub-orchestrator/sentinelle.sh): the machine checks;
- [ci-attendi.sh](../fub-orchestrator/ci-attendi.sh): waiting for a PR's CI in
  the background.

## Start

1. **Nobody else on the same work.** Check `ListAgents`, and `git log` of the
   plan branch and of open `integra/*` or work branches. If an orchestrator or
   another session is on the same plan, stop and ask the user which one stays.
2. **Sentinels.** Run `.claude/skills/fub-orchestrator/sentinelle.sh` and fix
   every `GIALLO` and `ROSSO`. Run it again after each group and before ending.
   A `Monitor` is optional: alone, you have fewer worktrees to leak.
3. **Forgotten work.** After a long pause or a compaction, look at
   `git cherry origin/main` on the `piano/*` branches, the `Stato:` lines of
   every open plan, your open PRs and `gh issue list`.
4. **The plan.** `git fetch`; read the header, the `Modifiche` block, every
   `Stato:` line and `DECISIONS.md`. Read a task's full section only when you
   start it. Don't start until every task has `Tocca`, `Fatto quando` and
   `Prova` and the plan has no open question; if something is missing, tell
   the user.
5. **Your worktrees.** The main checkout stays on `main`.
   - The plan branch in its own worktree (`.claude/worktrees/piano-<slug>`):
     you commit only `Stato:` lines and `DECISIONS.md` there.
   - The group branch `integra/<slug>-<N>` in another worktree
     (`.claude/worktrees/integra-<slug>`: the sentinels watch the newest
     `integra/*` worktree), from `origin/main` or from the tip of the
     previous group (see "Groups"), with a draft PR.
6. Tell the user in two lines: the work and the first task.

## One task

1. **Pick.** A task is ready when its `Stato` is `[ ]` and every task in its
   `Dipende da` is `[x]`; phases are not gates. Prefer the one that unblocks
   the most others. Set its `Stato` to `[~] in corso · base <sha>`, commit and
   push the plan branch.
2. **Hard tasks get a design pass, and only those.** The session runs at
   Opus effort medium. A task whose plan or issue leaves a real gap (a
   complex part with many pitfalls it doesn't describe in enough detail), or
   that touches a contract (ABI, WIT, IPC), an on-disk format, concurrency or
   security, or whose cause is still unclear after a first look, first goes
   to the [`progettista`](../../agents/progettista.md) agent
   (`subagent_type: "progettista"`, `run_in_background: true`,
   `effort: "xhigh"` for a contract, an on-disk format or security, its
   default `high` otherwise). Its brief: the task's section, what you already
   know and ruled out, the worktree and commit to read, and the output file
   `scratchpad/<task>/soluzione.md`. While it works, do something else (the
   next task's reading, the review of the previous one). Then read the file,
   check in the code the claims that decide the outcome, and implement it
   yourself. If the design is wrong or thin, fix it yourself; never a second
   design pass for the same task. It doesn't count toward the two Haiku
   helpers. A relatively simple task that the plan or the issue already
   covers well enough gets no design pass.
3. **Implement** as a coder would: reproduce first with a test that fails,
   fix in the owning layer, update the canonical `docs/` page. Decide the
   technical how yourself; ask only what `DECISIONS.md` lists under "Chiede
   sempre", and while you wait for the answer go on with another ready task.
   Every choice you made alone gets a line in the `Registro` of
   `DECISIONS.md`.
4. **Haiku helpers.** At most **two per task** (`Agent` with
   `model: "haiku"`, `effort: "max"`), as in `coder.md`:
   - you do the quick things yourself and every hard part;
   - the helper does work of low to medium difficulty, however long:
     length is not difficulty. A wide search in the repo, a large piece of
     code on well-known ground (a base, a scaffold, a medium function whose
     rule you wrote down, a repetitive change, tests for cases you listed),
     the mechanical parts;
   - you choose and design each piece, know exactly what it does, and check
     every line; never an endless session.

   They don't start agents, commit or touch git. You read every line they
   wrote, run their tests and make the commits.
5. **Close** as in "Closing" of `coder.md`: guards that take seconds first,
   then `scripts/check.sh --rapido --base <base>` through the heavy-check
   queue, as a background command (you are notified when it ends; don't poll).
   While it runs, read the next task's section or review your diff.
6. **Self-review.** Read `git diff --stat`, then the hunks that matter, against
   the closing gate of `CLAUDE.md`: accidental changes, duplication, premature
   APIs, hand-edited generated files, missing teardown.
7. **Record.** Commits `tipo(scope): frase in italiano`, no co-author or
   session lines. Push the group branch (short CI on the draft PR). `Stato` to
   `[x] fatto · <sha>` on the plan branch, pushed.
8. Between tasks the previous task's context is no longer needed: the state is
   on disk. If the user is there, say in one line that it is a good moment for
   `/compact`.

## Groups

- A group is 5–10 tasks, or fewer when they form a coherent delivery.
- **Before it goes ready:** run `/code-review medium` on the group's diff
  against `main`, fix the true findings, and run the full `scripts/check.sh`
  through the queue. Where `CLAUDE_DEVICE.md` says the machine has a real GPU,
  a Haiku helper also runs the A/B fluidity check described in the
  orchestrator's skill ("Waiting without spending"). Then mark the PR ready:
  the full CI runs.
- **CI:** `ci-attendi.sh <pr>` as a background command, which costs nothing
  while it waits. When only `banco visivo` fails, the baseline bot commits the
  runner's photos and reruns CI; look at its contact sheet before merging.
  Merge under the rule in `CLAUDE.md`.
- **Don't stop while CI runs.** Start group N+1 from the tip of group N and
  keep working; only one group is ready at a time. When N is merged, N+1 goes
  on from `main` with a merge of `origin/main`, never a rebase of pushed work.
- A red full CI: find the commit that broke it, fix it with a new commit on
  the group branch, push, wait again.

## Waiting without spending

- **Checks and builds:** `run_in_background` on the command itself; never
  poll its output.
- **CI:** `ci-attendi.sh`, never `gh pr checks` in a loop.
- **Never** `until ! pgrep -f "X"`: the loop matches itself and never ends. Use
  a done-file or `pgrep -x`, and kill by process number, never with a generic
  `pkill`.
- **Measurements** (fluidity rounds, A/B on the real app) go to a Haiku helper
  with the scripts that already exist; they count toward the two helpers of
  the task that needs them.

## State

- A plan's tasks: `Stato:` lines in `PLAN.md` on the plan branch, choices in
  `DECISIONS.md`.
- Work without a plan: the state file named in `CLAUDE_DEVICE.md`, one line per
  item: queued, in progress, merged.
- External audit: verify every line against the code. Every true item, even a
  small one, becomes an issue and a task; a false one gets a line saying why.
- Tester defects: blocking or serious ones first, the others grouped by area.
  Usability problems wait for the maintainer's UX plan.

## End of a plan

1. Every task `[x]`: the last group goes to main as above. Each `SALTA` of the
   full check goes in the final report.
2. Durable choices go into `DECISIONS.md`, or into an ADR when they are
   architectural.
3. `PLAN.md` and `PLAN-ui/` never enter main: they live only on the plan
   branch.
4. Remove your worktrees (`git worktree remove`) and the merged branches; run
   the sentinels a last time.
5. The final report in Italian, in the format of `CLAUDE.md`, with the open PRs
   and what each one waits for.

## Spend little

- One task's files at a time; read the plan by section; don't re-read
  unchanged files.
- `check.sh` prints one line per step: open `target/check/*.log` only for a red
  step, and only the part you need.
