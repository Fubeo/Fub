---
name: auto
description: The unattended version of /orchestra, for whenever the user leaves Fub's plans running on their own (at night or by day). Carries out the open plans with at most 2 subagents at once, follows the approved prototypes, has planner subagents design new ones in Fub's style and approves them itself on written assumptions, never merges or acts outside the repository, and leaves a report to read on return. Use only when the user types /auto.
disable-model-invocation: true
argument-hint: "[piani da seguire, predefinito: tutti i rami piano/* con una PR aperta]"
---

# /auto

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
In `/auto` it splits in two:

- *You decide, on the dossier, and write it down* (an `A-auto-N` in the plan,
  a line in the plan's `DECISIONS.md` marked `(auto)`, a line in the report):
  what the person sees or does differently from the plan, when it follows the
  plan's direction and the dossier; how a new piece looks; the choices inside
  an approved scope. Choose like Fub (the dossier's last section), never at
  random, never the cheapest.
- *You don't do it; you prepare it and it waits for the maintainer:* the
  merge; anything outside the repository (creating repositories or issues,
  commenting, publishing anywhere but a private Artifact); weakening or
  skipping a test; security and permissions; a new external dependency or
  licence; changing `Fatto quando` or `Fuori scope`, skipping or postponing a
  task. A change of public contract (ABI, WIT, IPC, a format other programs
  read) may be implemented and integrated on the plan branch, which is not
  merged, marked `da confermare` in the plan and first in the report: they
  confirm it before the merge.

A task that can't go on without one of the second kind: leave it `[ ]` with a
line `Aspetta: <cosa>` under its `Stato:`, and move to another.

**Pushing.** Push after each integration, as in `/orchestra`, to the draft
PRs. `gh pr ready` only when a plan's tasks are all done and the full CI is
needed; never merge.

**The live app on port 1432** follows `main`, and `main` doesn't change
during the run: don't pull, don't restart it unless it is down.

**What the classifier denies** stays denied: don't work around it, write it in
the report with the exact command for the maintainer.

**Context.** Compact at natural pauses: the state is in the plans and git.
Start the session with a lower threshold, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60
claude`.

**If the maintainer writes during the run**, they are back: answer them, and
what they say wins over any `(auto)` choice still open.

## When to stop

Stop when no task is ready (everything left waits for the maintainer, for
another plan or for CI), or when the disk or a red you can't fix stops the
work. Don't stop for a question that is yours to decide.

## The report

Publish it as a private Artifact, in simple Italian, for someone who has just
come back. First what changes for the person using Fub, then:

1. **Fatto:** per plan, the tasks done (one line each, with the branch and
   the PR), CI state.
2. **Scelto da me, da rivedere:** every `A-auto-N` and `(auto)` decision, each
   with the alternative and how to change it; the prototypes approved
   automatically, with their links.
3. **Aspetta te:** the contract changes to confirm, the merges ready to ask,
   the questions of the second kind, each with options and your
   recommendation first; the commands only the maintainer can run.
4. **Controlli:** the checks run, the ones not run and why, the reds and the
   flaky tests with their issue.
5. **Il prossimo passo:** what the next run or session should start from.

Then end with one line that points at the report.
