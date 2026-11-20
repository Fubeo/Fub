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

- Linear history: `git cherry-pick <base>..<sha>` onto the plan branch.
- A conflict in a shared registration file (a list, an index, an i18n table) is
  usually trivial: resolve it. Anything deeper: `git cherry-pick --abort` and
  resume the coder, telling it to start again from the plan branch's new HEAD.
- `scripts/check.sh --rapido --base <the plan branch's HEAD before the
  cherry-pick>`. It checks what the task touched and every crate that uses it,
  on top of everything integrated so far.
- Set the task's `Stato` to `[x] fatto` in `PLAN.md` and commit it with the next
  push: `docs(piano): T4 fatto`.

## 3. Push and CI

- `git push origin <plan branch>`. Network failure: retry up to 4 times,
  waiting 2, 4, 8 and 16 seconds. Never force.
- Wait for CI **in the background**, never by polling:
  - locally, `gh pr checks <n> --watch --fail-fast` as a background command
    (`run_in_background`): you are told when it ends;
  - in a cloud session, subscribe to the PR's activity: CI results arrive as
    events.
- A newer push cancels the older run on the PR. That's expected: the latest
  run covers everything before it.
- Red CI: read only the failing job's log (`gh run view <run> --log-failed`, or
  the GitHub tools), fix it with a small commit or a coder. Never skip, disable
  or weaken a test to get green.

## 4. Clean up

Right after the push, not at the end of the session:

- `git worktree unlock <path>`, then `git worktree remove <path>` and
  `git branch -D <coder branch>`: the commits are in the plan branch now. The
  Agent tool locks the worktrees it creates, so without the unlock `remove`
  fails and the worktree stays; check the exit code. A `cargo clean` alone is
  not a clean-up: the worktree and its branch must go too.
- The same holds for every other branch, local or on GitHub, that has nothing
  left to give: an experiment that ended, a work-in-progress branch overtaken
  by the real one, a plan already merged. Before deleting one that is not fully
  merged (`git merge-base --is-ancestor`, or `git cherry` with only `-` lines),
  save it with `git bundle`, outside the repository.
- At every resume, `git ls-remote --heads origin` and `git worktree list`
  should show only `main`, branches with an open PR and work in progress.

## Shared build cache

On a machine with `sccache`, coders don't rebuild the dependencies from zero in
every worktree. It is a per-machine setting, so it goes in
`.claude/settings.local.json` (not committed), never in the shared settings:

```json
{ "env": { "RUSTC_WRAPPER": "sccache", "CARGO_INCREMENTAL": "0" } }
```

`sccache` doesn't cache incremental builds, hence `CARGO_INCREMENTAL=0`. It
speeds up the dependencies, much less the workspace's own crates.
