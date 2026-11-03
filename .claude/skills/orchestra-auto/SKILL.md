---
name: orchestra-auto
description: The unattended version of /orchestra, for whenever the user leaves Fub's plans running on their own (at night or by day). Carries out the open plans with at most 2 subagents at once, follows the approved prototypes, has planner subagents design new ones in Fub's style and approves them itself on written assumptions, merges a plan into main only when it is finished and the full CI is green, cleans up its branches, never acts outside the repository, and leaves a report to read on return. Use only when the user types /orchestra-auto.
disable-model-invocation: true
argument-hint: "[piani da seguire, predefinito: tutti i rami piano/* con una PR aperta]"
---

# /orchestra-auto

You are the orchestrator, and the maintainer is away: asleep, out, busy with
something else. Nobody answers until they come back. Everything in
[`/orchestra`](../orchestra/SKILL.md) holds (the loop, the briefs, the planner
subagents, how to integrate, CI in the background), and so do `CLAUDE.md` and
`DECISIONS.md`. This page says only what changes when nobody is there to ask.

The aim is to move the plans forward as far as the work can go **without
anything that can't be undone**. When the maintainer comes back they read one
report and find every choice you made on their behalf, written down, easy to
change.

The plans are `$ARGUMENTS`, or every `piano/*` branch with an open PR.

## Before starting

1. For each plan: fetch, read the header, `Modifiche`, every `Stato:` line,
   the open questions and `DECISIONS.md` (root and plan). Note the prototypes
   and whether they are approved.
2. Read [the Fub dossier](../pianifica/fub.md). Every decision of the run is
   judged against it.
3. Check the disk (`df -h /`): keep at least 15% free, clean your own
   worktrees and the `target/` of finished worktrees as you go.
4. Write the header of the report (see the end): date and time, plans, the
   HEAD of each branch.

## What changes when nobody is there

**Subagents.** At most **2 at the same time**, coders and planners together.
Prefer the tasks on the longest path, then those that unblock the most others.

**Something to design** goes to a planner subagent, as in `/orchestra`
("Planner subagents"), with the Fub dossier in its brief. Never design it
yourself and never hand it to a coder.

**Your own review of a prototype** replaces the maintainer's look for the
run, so do it properly: read the whole page, look at its photos in both
lights, at full width and at 700 px, check it against the dossier and the
approved prototypes, run the CSS through `sanitizeThemeCss` if the planner
didn't. Then:

- publish it as an Artifact (read it whole first), so the maintainer can open
  it on return;
- write in the page head and in the plan's `Prototipo:` line
  `Approvato in automatico (AAAA-MM-GG): da rivedere`;
- list in the plan's `Assunzioni` (as `A-auto-N`) each choice that the
  maintainer would normally make by looking, with its reason from the dossier;
- let the coders implement it.

A prototype the maintainer has already seen and commented on, or that they
said they want to see, is **not** approved automatically: a planner may rework
it on their comments, you publish the new version, and its tasks wait for
them.

**Questions.** "Chiede sempre" of `DECISIONS.md` still decides what is theirs.
In `/orchestra-auto` it splits in two:

- *You decide, on the dossier, and write it down* (an `A-auto-N` in the plan,
  a line in the plan's `DECISIONS.md` marked `(auto)`, a line in the report):
  what the person sees or does differently from the plan, when it follows the
  plan's direction and the dossier; how a new piece looks; the choices inside
  an approved scope. Choose like Fub (the dossier's last section), never at
  random, never the cheapest.
- *You merge a finished plan into `main`*, under the rules of "Merging"
  below: the maintainer allowed it for `/orchestra-auto` (2026-11-03), so
  that `main` holds the finished work and branches don't pile up.
- *You don't do it; you prepare it and it waits for the maintainer:* anything
  outside the repository (creating repositories or issues, commenting,
  publishing anywhere but a private Artifact); weakening or skipping a test;
  security and permissions; a new external dependency or licence; changing
  `Fatto quando` or `Fuori scope`, skipping or postponing a task. A change of
  public contract (ABI, WIT, IPC, a format other programs read) may be
  implemented and integrated on the plan branch, marked `da confermare` in
  the plan and first in the report; that plan is not merged until they
  confirm it, because files written in a new format don't go back with a
  revert.

A task that can't go on without one of the second kind: leave it `[ ]` with a
line `Aspetta: <cosa>` under its `Stato:`, and move to another.

**Pushing.** Push after each integration, as in `/orchestra`, to the draft
PRs. `gh pr ready` only when a plan's tasks are all done and the full CI is
needed.

**Cleaning up.** After integrating a coder's task, remove its worktree
(`git worktree remove`) and delete its local `coder/*` branch. Never delete a
branch or a worktree you didn't create, and never one with work that isn't
integrated.

**What the classifier denies** stays denied: don't work around it, write it in
the report with the exact command for the maintainer.

**Context.** Compact at natural pauses: the state is in the plans and git.
Start the session with a lower threshold, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60
claude`.

**If the maintainer writes during the run**, they are back: answer them, and
what they say wins over any `(auto)` choice still open.

## Merging

A plan is merged into `main` when all of these hold:

1. it went through the whole "End" of `/orchestra`: every task `[x]`, the full
   `scripts/check.sh` green on the final state, `PLAN.md` and `PLAN-ui/`
   removed, the PR marked ready;
2. the full CI of that last push is green: Windows, macOS and the benches
   included. A job that is red on `main` too, for the same cause and with an
   open issue, doesn't block it, and the report names it; any other red does;
3. nothing in the plan is `da confermare` or `Aspetta:`, and the plan has no
   open question for the maintainer;
4. the branch is up to date with `main` (merge `main` in, check, push and wait
   for the CI again if it wasn't).

Then `gh pr merge <n> --merge --delete-branch`, the same merge commits `main`
already has. Stacked plans go base first: after the base is merged, the next
PR targets `main` (check with `gh pr view`), takes `main` in and goes through
the four points again. After the merge, remove the plan's worktree and its
local branch.

**The live app**, when the machine has one (`CLAUDE_DEVICE.md`, port 1432 on
`server-di-fub`), follows `main`: after each merge update it as that file
says (`git pull --ff-only` in the main checkout, which must be on a clean
`main` apart from the maintainer's untracked files; rebuild and restart the
bridge when a crate changed) and check that it answers. If the pull can't be
a fast-forward, or the checkout isn't on `main`, leave it and write it in the
report. Between merges, don't pull and don't restart it unless it is down.

## When to stop

Stop when no task is ready (everything left waits for the maintainer, for
another plan or for CI), or when the disk or a red you can't fix stops the
work. Don't stop for a question that is yours to decide.

## The report

Publish it as a private Artifact, in simple Italian, for someone who has just
come back. First what changes for the person using Fub, then:

1. **Fatto:** per plan, the tasks done (one line each, with the branch and
   the PR), CI state; the plans merged into `main`, with the merge commit and
   how to undo it (`git revert -m 1 <commit>`); whether the live app is up
   to date.
2. **Scelto da me, da rivedere:** every `A-auto-N` and `(auto)` decision, each
   with the alternative and how to change it; the prototypes approved
   automatically, with their links.
3. **Aspetta te:** the contract changes to confirm, the plans not merged and why,
   the questions of the second kind, each with options and your
   recommendation first; the commands only the maintainer can run.
4. **Controlli:** the checks run, the ones not run and why, the reds and the
   flaky tests with their issue.
5. **Il prossimo passo:** what the next run or session should start from.

Then end with one line that points at the report.
