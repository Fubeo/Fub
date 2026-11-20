# Integrating a coder's work

Read this when a coder reports `FATTO`.

## 1. Review

- The branch and the sha come from the report. `git log --oneline <base>..<sha>`
  and `git diff --stat <base>..<sha>`.
- Every path is under the task's `Tocca`, or is a test or a `docs/` page that
  sits with it. Anything else: ask the coder why, or send it back.
- Read the diff of the non-test code. Skim the tests only to confirm they prove
  the task's `Fatto quando`, and that none was deleted, skipped or weakened.
- Graphic task: open the screenshots named under `FOTO` and compare them with
  the prototype, both lights and the narrow width. Its pieces are in the map of
  `apps/client/bench/conformita/` and `npm run bench:conformita` is green; every
  new entry in `eccezioni-<prototipo>.json` cites DECISIONS or the plan.
- Check the `CLAUDE.md` closing gate against what you read: owner of the rule,
  generated files from their source, docs updated, no new dependency nobody
  asked for.
- Before every integration, a medium-level `code-review` of the task's diff
  (`<base>..<sha>`), by a reviewer that sees the code, not your conclusion. Ask
  it to judge each item under `DIFFERENZE DAL PIANO` too. Send what it finds
  back to the coder at once: a defect found here costs one round, the same
  defect found in the final review of the plan costs a full CI.
- Graphic task: look at the screenshots critically yourself, as the person
  using Fub would: the UI language everywhere, no raw host text, a sensible
  order, human error messages, empty, error and focus states, nothing clipped
  at 700 px.

Not convincing: resume the coder with what is wrong, precisely. Don't fix a
whole task yourself.

## 2. Bring it in

- Merge the coder's branch into the group branch, in the integration worktree:
  `git merge --no-ff -m "Merge <ramo>: <frase>" <sha>`. One merge commit per
  task, so a task can be taken out alone with `git revert -m 1`.
- A conflict in a shared registration file (a list, an index, an i18n table) is
  usually trivial: resolve it. For anything deeper, run `git merge --abort` and
  resume the coder: it starts again from the group branch's new tip.
- Run the narrow tests of what the task touched in the integration worktree.
  Each push gets the short CI; the full check runs once per group (see
  "Groups").
- A plan task: set its `Stato` to `[x] fatto` in `PLAN.md` on the plan branch
  (`docs(piano): T4 fatto`). Work without a plan: update the state file.

## 3. Push and CI

- `git push origin <group branch>`. On a network failure, retry up to 4 times,
  waiting 2, 4, 8 and 16 seconds. Never force.
- Wait for CI **in the background**, never by polling:
  - locally: `.claude/skills/fub-orchestrator/ci-attendi.sh <pr>` with
    `run_in_background`. It prints one result when CI ends, and follows the
    baseline bot's commit;
  - in a cloud session: subscribe to the PR's activity, and CI results arrive
    as events.
- A newer push cancels the older run on the PR. That's expected: the latest
  run covers everything before it.
- Red CI:
  - read only the failing job's log, and fix it with a small commit or a
    coder;
  - never skip, disable or weaken a test to get green;
  - a flaky test gets an issue and a fix of the test itself, never a higher
    threshold, and the fix comes before new tasks.

## 4. Clean up

Right after the integration, not at the end of the session:

- **The coder's worktree goes at once.** Run `git worktree unlock <path>`,
  `git worktree remove <path>` and `git branch -D <coder branch>`: the commits
  are in the group branch now.
  - The Agent tool locks the worktrees it creates. Without the unlock,
    `remove` fails and the worktree stays, so check the exit code.
  - A `cargo clean` alone is not a clean-up. Each leftover worktree keeps
    20–110 GB of `target/` and thousands of inotify watches: on 2026-11-20, 83
    of them used up the user's watch limit and broke the coders' Vite.
  - `sentinelle.sh --pulisci` catches the ones you missed.
- **The integration worktree:** run `cargo clean` there after a group's push
  when the sentinels report its `target/` over 80 GB.
- **Every other branch**, local or on GitHub, that has nothing left to give
  goes too: an experiment that ended, a work-in-progress branch overtaken by
  the real one, a plan already merged.
  - Before deleting a branch that isn't fully merged
    (`git merge-base --is-ancestor`, or `git cherry` with only `-` lines),
    save it with `git bundle`, outside the repository.
  - Before deleting a branch that is a PR's base (`gh pr list --base
    <branch>`), move those PRs to `main`:
    `gh api -X PATCH repos/Fubeo/Fub/pulls/<n> -f base=main`. Otherwise GitHub
    closes them silently.
- At every resume, `git ls-remote --heads origin` and `git worktree list`
  should show only `main`, branches with an open PR and work in progress.

## Groups

Tasks don't each get a PR to main: the full CI takes 1.5–2 hours, and paying
it per task stalls everything. They are integrated in groups instead.

- **The branch.** `integra/<slug>-<N>` has a **draft** PR: draft PRs get the
  short CI. It never carries `PLAN.md` or `PLAN-ui/`. Each task enters as one
  merge commit and is pushed; the coder's slot is refilled at once.
- **To main.** Every 5–10 tasks, or about twice a day:
  1. mark the PR ready, so the full CI runs, Windows and benches included;
  2. look at the baseline bot's photos (see "CI" in `CLAUDE.md`);
  3. green: merge under the rule in `CLAUDE.md`;
  4. close the issues the group fixes.
- **One group ready at a time**, in main within a day. The next group,
  `integra/<slug>-<N+1>`, starts from the **tip of N**, not from `main`.
  Whatever you fix to get N through also enters N+1 at once. Two groups living
  side by side for days changed the same files in different ways.
- **Full CI red:**
  - each task is its own merge commit, so find the culprit, then fix it or
    revert its merge; the other tasks don't wait;
  - red only on a flaky photo: open an issue, rerun once, and fix the scene
    before new tasks.

## Shared build cache

On a machine with `sccache`, coders don't rebuild the dependencies from zero in
every worktree. It is a per-machine setting, so it goes in
`.claude/settings.local.json` (not committed), never in the shared settings:

```json
{ "env": { "RUSTC_WRAPPER": "sccache", "CARGO_INCREMENTAL": "0" } }
```

`sccache` doesn't cache incremental builds, hence `CARGO_INCREMENTAL=0`. It
speeds up the dependencies, much less the workspace's own crates.
