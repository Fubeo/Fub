// **The counts that prose asserts about the sources** (§16.8).
//
// Every entry here is a number that some document — or some comment inside the
// code — writes in English, together with the command that derives it from the
// sources. `check-prose.mjs` redoes the count and compares it with **every**
// place that cites it, in both directions: a number that changes in the code
// turns red, and an entry that no one cites anymore turns red too — the same
// discipline as the allowlist of `crates/fub-app/tests/lean_ipc.rs`.
//
// Why this file is a JS module and not a JSON: **every line carries its
// reason**, and a format without comments would force writing it somewhere
// else, that is, in a place that ages.
//
// How to add an entry:
//
//   1. choose a `name`, which is what will be written in prose between
//      `[conta: …]`;
//   2. `command` must print **exactly one number**, and run from any folder
//      (it is executed from the repo root);
//   3. `reason` says what that number asserts, not how it is counted — the how
//      is the command, and it is already there.
//
// What does NOT go here: a number describing the state of back then inside a
// decision record. A record is dated, and a count inside a record does not
// promise to be true today — it promises to have been true that day. Those are
// written in the past tense («it counted eight then»), and this guard does not
// look at them.

export const COUNTS = [
  {
    name: "hostapi-metodi",
    reason:
      "The functions that a plugin can call on the host: the surface of `HostApi` " +
      "as seen from the other side of the boundary. It is the number of decision " +
      "0013 — the list is closed to subtraction, not to growth — and before this " +
      "guard the same document declared two different ones. " +
      "Comments are skipped: in a contract that is half English prose, " +
      "a documentation line that names a function with two dots " +
      "would count as a function.",
    command:
      "awk '/^[[:space:]]*\\/\\//{next} /^[[:space:]]*interface host-/{i=1}" +
      " i&&/^}/{i=0} i&&/:[[:space:]]*func/{n++} END{print n+0}'" +
      " crates/fub-abi/wit/fub/abi.wit",
  },
  {
    name: "wit-interfacce-host",
    reason:
      "The `host-*` interfaces of the contract: into how many families that " +
      "surface is divided. It grows only when a family of capabilities is born, " +
      "so it must move together with `guard-families`: if the two diverge, one " +
      "of the two lists has stopped being the other.",
    command: "grep -cE '^[[:space:]]*interface host-' crates/fub-abi/wit/fub/abi.wit",
  },
  {
    name: "guard-famiglie",
    reason:
      "The capability families on which a policy answers yes or no: the cases of " +
      "`Capability` in `guard.rs`. The number is written three times in that file, " +
      "and all three times it was `ten` when the families were fourteen.",
    command:
      "sed -n '/^pub enum Capability {/,/^}/p' crates/fub-kernel/src/host/guard.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    name: "capacita-strutturali",
    reason:
      "The methods of `VaultStructure`, that is, how many structural operations " +
      "the gate of decision 0010 covers. Two documents said «all six» and then " +
      "listed five. The anchor demanded a **bare** signature: an `async fn`, " +
      "an `unsafe fn` or a `fn c<T>() where …` would pass the gate without " +
      "entering the count.",
    command:
      "sed -n '/^pub trait VaultStructure/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^[[:space:]]+(default |const |async |unsafe )*fn '",
  },
  {
    name: "superfici-di-vista",
    reason:
      "The surfaces a view can stand on: the cases of `ViewSurface`. Decision " +
      "0104 gave the list a guard that forbids holes and duplicates, and the " +
      "red-verification of 0105 measured that a variant added **at the tail** " +
      "still escapes it, because its anchor is a manually named variant. No `assert` " +
      "inside Rust can catch it: a count that reads the source from outside can, " +
      "and this is it.",
    command:
      "sed -n '/^pub enum ViewSurface {/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    name: "porte-verso-un-terzo",
    reason:
      "The gates through which one enters third-party code: the cases of `Gate` in " +
      "`gate.rs` (contract). Decision 0032 declared them «eight, and that's all» " +
      "in an immutable record, and when 0105 counted them they were thirteen. " +
      "Since 0161 the enum lives in `fub-abi` because `Event::Trouble` names it, " +
      "and the kernel re-exports it from `safety.rs`.",
    command:
      "sed -n '/^pub enum Gate {/,/^}/p' crates/fub-abi/src/gate.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    name: "schemi-su-disco",
    reason:
      "The independent schema versions: how many on-disk formats Fub versions " +
      "separately. It is the number whose error does not cancel out, because the " +
      "promise is made to the user's files, not to whoever compiles. It counts " +
      "the **type**: a constant of type `SchemaVersion`, whatever its name. " +
      "The two earlier forms looked at a name — first the literal `SCHEMA_VERSION`, " +
      "which left `DIAGNOSTICS_VERSION` out, then any integer whose name ended " +
      "with `VERSION`, which left a `const E_SCHEMA_REV` out — and 0106 had " +
      "already measured why a name does not hold: whoever calls it differently " +
      "has not done anything wrong, and it is the count that let itself be " +
      "eluded. The type is crossed instead of remembered, " +
      "and this count also serves to say that the gate has **hooked**: a site " +
      "still using `u32` is not counted and diverges from `schemi-in-tabella`. " +
      "Still **out**: a version written on the fly inside the record " +
      "(`v: SchemaVersion::new(1)`, without a constant naming it): it is of the " +
      "right type and nobody counts it — the type makes writing `v: 1` " +
      "impossible, not not-naming the 1.",
    command:
      "grep -rhE '^[[:space:]]*(pub([[:space:]]*\\([^)]*\\))?[[:space:]]+)?" +
      "const [A-Z_0-9]+: SchemaVersion = '" +
      " crates/*/src | wc -l",
  },
  {
    name: "schemi-in-tabella",
    reason:
      "The rows of the schema table in `docs/versionamento.md`. It lives " +
      "beside `schemi-su-disco` and says the other half: that counts the formats " +
      "the code versions, this the formats the document lists. That they are the " +
      "**same** — row by row and number by number — is verified by " +
      "`crates/fub-app/tests/schemas_on_disk.rs`; that they are **as many** " +
      "is said by these two, and it is the direction a test cannot see, because " +
      "a format no one included is a format no test knows about.",
    command:
      "grep -cE '^\\| [^|]+ \\| \\[`crates/[^`]+:[0-9]+`\\]' docs/versionamento.md",
  },
  {
    name: "file-con-superficie-ipc",
    aliases: ["files-with-ipc-surface"],
    reason:
      "In how many files of `crates/fub-app/src` there is a `#[tauri::command]` " +
      "or a `generate_handler!`. It must be **one**: `lean_ipc.rs` judges " +
      "`lib.rs` with an `include_str!`, so a second surface mounted by " +
      "another file of the same crate — a `.plugin()` with its own " +
      "`generate_handler!` — is invisible to it and remains reachable from the " +
      "webview as `plugin:<name>|<command>`. A guard that reads one file knows " +
      "that file; what sees the others is a count that walks the folder. The " +
      "anchor demanded the `]` **immediately**: measured, a file of only " +
      "parameterized commands — `#[tauri::command(rename_all = \"snake_case\")]`, " +
      "`#[tauri::command(async)]` — was invisible to this count *and* to " +
      "`lean_ipc.rs`, which reads `lib.rs`. Now the parenthesis counts as much as " +
      "the bracket.",
    command:
      "grep -rlE '#\\[(tauri::)?command[](]|generate_handler!' crates/fub-app/src | wc -l",
  },
  {
    name: "cataloghi-del-kernel",
    reason:
      "How many `fub-kernel` families declare a string catalog, i.e. how many " +
      "`pub fn catalog()` there are in `crates/fub-kernel/src`. The core bundle " +
      "mounts them one by one and the two catalog benches list them by hand: " +
      "a hand-written list notices a **key** that is missing, never a " +
      "**catalog** that is missing — `maintenance` was out for a long time " +
      "without anything turning red. It is the shape 0105 names for this kind " +
      "of hole, and no `assert` inside Rust can catch it: a count that reads the " +
      "source from outside does. It counts **declarations**, not files: the " +
      "first form counted files with at least one, and a " +
      "`pub mod calendar { pub fn catalog() }` inside an already-counted file " +
      "left the number still with the suite green — measured. For the same " +
      "reason the anchor admits indentation.",
    command: "grep -rhE '^[[:space:]]*pub fn catalog\\(\\)' crates/fub-kernel/src | wc -l",
  },
  {
    name: "famiglie-del-kernel",
    reason:
      "The kernel families the mounting knows: the variants of " +
      "`Family` in `crates/fub-kernel/src/families.rs`. It lives in the same " +
      "sentence as `kernel-catalogs` and closes it from the other end. That count " +
      "looks at the sources — how many `pub fn catalog()` exist —, this looks at " +
      "the list that mounts them, and the two numbers must be the same: a family " +
      "born in the kernel that does not enter the list makes them diverge, and " +
      "a variant removed from the list while its `catalog()` stays makes them " +
      "diverge in the other direction. Inside the list neither is needed — there " +
      "the `match` is exhaustive and a mutated variant does not compile — and " +
      "outside no `assert` suffices: a module nobody cites does not exist for " +
      "whoever compiles.",
    command:
      "sed -n '/^pub enum Family {/,/^}/p' crates/fub-kernel/src/families.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    name: "impostazioni-del-kernel",
    reason:
      "How many `fub-kernel` families declare settings, i.e. how many " +
      "`pub fn *_settings()` there are in `crates/fub-kernel/src`. It lives " +
      "beside `cataloghi-del-kernel` and guards the other half: a family that the " +
      "core bundle does not mount is not red anywhere — its keys disappear from " +
      "the panel and whoever reads them silently takes the default, which is " +
      "precisely the right behavior for a vault that declared nothing. " +
      "Measured by removing the line (§15.6). It counts **declarations**, not " +
      "files, for the same reason as its twin: a " +
      "`pub fn calendar_settings()` added inside `locale.rs` — a file already " +
      "counted — left the number at four with `cargo test --workspace` " +
      "green, because the list of the `i_catalogs.rs` bench is written by hand " +
      "and sees a missing key, never a family nobody mounted.",
    command:
      "grep -rhE '^[[:space:]]*pub fn [a-z_]*settings\\(\\)' crates/fub-kernel/src | grep -v 'all_settings' | wc -l",
  },
  {
    name: "durabilita-su-ogni-piattaforma",
    reason:
      "How many tests of `crates/fub-kernel/tests/durability.rs` **really run " +
      "on every platform**, i.e. how many remain where the platform does not " +
      "give inodes or hardlinks. It is the guard against a species of defect " +
      "no color signals: CI runs `cargo test --workspace` " +
      "on windows-latest too, and for years that job passed green because the " +
      "guards that would have interrogated the case there were not compiled — " +
      "**a suite that silently empties is indistinguishable from a green suite** " +
      "(§23.16). A test cannot notice it, because the test that would notice it " +
      "is exactly the one that is not there: what notices it is a count that " +
      "reads the source from outside. It watches **four** ways of emptying the " +
      "suite, all measured one by one on this file: a `#[cfg` in front of " +
      "a test (the first form looked for the exact string `#[cfg(unix)]` and at " +
      "`#[cfg(not(windows))]` stayed eleven); a `#[ignore]`, which leaves " +
      "`0 passed; 0 failed; 16 ignored` and the prose green; a `#![cfg(…)]` as " +
      "an **inner attribute** at the top of the file, which empties everything " +
      "in one line without touching any test; and an `if cfg!(windows) { return; }` **inside " +
      "a body** — the worst form, because the test looks like it runs and " +
      "passes by doing nothing. The last three zero the count instead of scaling " +
      "it: in a file " +
      "that exists to run everywhere there is no legitimate use of `cfg!`, and a " +
      "guard that cannot scale can at least turn itself off loudly.",
    command:
      "awk '/^[[:space:]]*\\/\\//{next} /^[[:space:]]*#!\\[cfg/{fuori=1}" +
      " /cfg!\\(/{fuori=1} /^[[:space:]]*#\\[/{a=a $0 \" \"; next}" +
      " /^[[:space:]]*(pub )?(async )?(unsafe )?fn /{if(a ~ /#\\[test\\]/ &&" +
      " a !~ /#\\[cfg/ && a !~ /#\\[ignore/) n++; a=\"\"; next} {a=\"\"}" +
      " END{print fuori?0:n+0}' crates/fub-kernel/tests/durability.rs",
  },
  {
    name: "famiglie-paginate",
    reason:
      "The data-channel queries that ask for a window. The bench of §17.1 " +
      "(decision 0113) measured that the window can be applied in three ways — " +
      "at the source, with `Paged::from_source`, or by trimming in memory — and " +
      "that for years all kernel ones used the third, building the entire " +
      "set to show twenty. The number sits next to the prose that describes " +
      "the three roads, so whoever adds a tenth passes through it and chooses. " +
      "**The count used to count itself**: it looked for `page: Option<Page>,` " +
      "in the whole file and also found the *parameter* of `Paged::from_source`, " +
      "i.e. the function born with 0113 to serve them — ten where the variants " +
      "were nine, and the architecture prose said «ten» contradicting the record " +
      "that wrote it. Now it reads the enum body, and admits " +
      "the last field without a comma (rustfmt writes a single-field variant " +
      "inline, and that one escaped in the other direction).",
    command:
      "sed -n '/^pub enum IndexQuery {/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^[[:space:]]+page: Option<Page>,?$'",
  },
  {
    name: "code-delle-documents-nel-kernel",
    reason:
      "From how many places in `crates/fub-kernel/src` is `properties::finish` " +
      "called, i.e. how many times the kernel mounts by hand the tail of a " +
      "`Documents` response. It must be **one**: that tail wants the date formats " +
      "the vault declares (decision 0108), and as long as the places were two — " +
      "the index when the query arrives whole, the planner when it reassembles it " +
      "— each one passed them for itself. Measured: replacing the formats with " +
      "`DateFormats::ISO` in the planner one **no** test in the entire " +
      "suite turned red, so the two routes could order the same query in two " +
      "ways without anything comparing them. Now the tail lives in " +
      "`CoreIndex::finish_documents` and the formats are passed by it; a second " +
      "caller that starts mounting it again is what this count sees, because the " +
      "compiler has no way to tell a right `&DateFormats` from a wrong one and no " +
      "test can see a route that does not exist yet.",
    command: "grep -rhoE 'properties::finish\\(' crates/fub-kernel/src | wc -l",
  },
  {
    name: "crate-del-workspace",
    reason:
      "The crates that inherit the version from the root `Cargo.toml`. " +
      "This used to declare that and count the **folders** of `crates/`: a crate " +
      "that wrote its version by hand — precisely the one the sentence excludes " +
      "— would be counted anyway. And even after that correction the **list** " +
      "remained the glob `crates/*`, that is, the disk, while who compiles reads " +
      "`[workspace] members`: a folder with a manifest no member declares entered " +
      "the count without cargo compiling it — code that does not exist and `#[test]`s " +
      "that are not red because they do not run — and a member outside `crates/` never " +
      "entered. Today the two lists coincide and neither case exists: the " +
      "count does not change number, it changes where it takes it from. The " +
      "list is given by `workspace-members.mjs`, the same one `check-cargo-versions` " +
      "and `check-cargo-feature-default` open, and the command-line door exists " +
      "because a `command` is a shell string: the third copy of the reading of " +
      "`members` would have been written here. " +
      "Declared blind zones: the divergences between list and disk this count " +
      "does not print — the two guards that call the same function make them red " +
      "— so a declared member without a `Cargo.toml` exits the count " +
      "silently *here* and screams *there*; and the anchor remains the line " +
      "`version.workspace = true`, so a crate that inherited the version " +
      "another way would not be seen.",
    command:
      "node .github/scripts/workspace-members.mjs | while read -r m; do" +
      " grep -qE '^version\\.workspace *= *true' \"$m\" && echo \"$m\"; done | wc -l",
  },
  {
    name: "wit-righe",
    reason:
      "How long the WIT contract is. It serves the measure that decision " +
      "0053 makes — how much of the contract is prose — and alone it says nothing.",
    command: "wc -l < crates/fub-abi/wit/fub/abi.wit",
  },
  {
    name: "wit-commenti",
    reason:
      "And how much of that length is comment: the other half of the above " +
      "measure, and the reason the contract reads well.",
    command: "grep -cE '^[[:space:]]*//' crates/fub-abi/wit/fub/abi.wit",
  },
  {
    name: "conformance-functions",
    reason:
      "The functions of the conformance bench that `fub-sdk` offers to whoever " +
      "writes a provider. The number of decision 0054 («a third crate for eight " +
      "functions») was false **in the commit that wrote it**: it already counted " +
      "fourteen. Not an aged number — a number never derived from its " +
      "source, which is the species this file exists to make impossible.",
    command: "grep -c '^pub fn ' crates/fub-sdk/src/testing/conformance.rs",
  },
  {
    name: "diagnostica-shell",
    reason:
      "The `console.warn`/`console.error` left in the shell: what goes wrong and " +
      "that decision 0052 wants to become an event instead of a line " +
      "in someone's console. It is a number that must **go down**, and the " +
      "guard is what makes it noticed when it goes up. It counts **calls**, and " +
      "it did not before in two opposite ways: it counted *lines* (two " +
      "`console.warn` on the same line counted one, and in a number that must " +
      "go down that is the direction that forgives) and it also counted the " +
      "times prose **names** them — the three the count declared were all three " +
      "inside a comment, and of real calls in `frontend/src` there is " +
      "none. The `(` is what distinguishes a call from a name.",
    command:
      "find frontend/src -name '*.ts' -o -name '*.tsx' | xargs awk" +
      " '/^[[:space:]]*(\\/\\/|\\*|\\/\\*)/{next}" +
      " {n+=gsub(/console\\.(warn|error)[[:space:]]*\\(/,\"\")} END{print n+0}'",
  },
  {
    name: "moduli-di-feature",
    reason:
      "The feature modules of `fub-features`: the files of `src/` that are not " +
      "the root nor the aggregator. It is the number on which §16.3 stands when " +
      "it says that paying twenty `Cargo.toml` files for eight modules that do " +
      "not talk to each other is a cost without a buyer — i.e. the number that " +
      "makes the premise **false** on the day it grows, and the reason it is " +
      "worth counting instead of remembering. The two exclusions are the same " +
      "as `ROOT` in `crates/fub-features/tests/independent_modules.rs`: if a shared " +
      "module is added there, it must be removed here too, or the bench and the " +
      "count stop talking about the same set. A folder module " +
      "(`canvas/mod.rs`) is as much a module as a file, and the first form did " +
      "not see it: the ninth would have been added leaving the count at eight.",
    command:
      "ls crates/fub-features/src/*.rs crates/fub-features/src/*/mod.rs 2>/dev/null" +
      " | grep -vE '/(lib|inventory)\\.rs$' | wc -l",
  },
  {
    name: "permessi-dichiarabili",
    reason:
      "The permissions a manifest can declare, i.e. how many rows the list the " +
      "user reads when deciding what to trust can have at most (§23.17). " +
      "It grows when a capability is born that the user must be able to deny, " +
      "and it is a number that lives in **three** places — the contract, the " +
      "shell catalog and the prose — of which the first two guard each other " +
      "(`i_permissions_sono_gli_stessi_di_qua_e_di_la`). This count is the third " +
      "side, and it serves because the phrase «thirteen permissions» is what " +
      "someone reads instead of going to count.",
    command:
      "sed -n '/pub const ALL: \\[&str; /,/];/p' crates/fub-abi/src/options.rs" +
      " | grep -cE '^        [A-Z_]+,'",
  },
  {
    name: "code-che-si-svuotano",
    reason:
      "The places from which a dispatcher event queue empties in bulk, " +
      "i.e. where an event can disappear without reaching anyone. Each of the " +
      "four has a reason written beside it in `dispatcher.rs`. The first " +
      "form of this command looked for the line `self.pending.clear();`: it " +
      "guarded **one syllable**, and the defect already bit — the transfer to " +
      "`salvaged` (`self.pending.drain(..)`) was a place where the queue " +
      "emptied and the count said three. `truncate`, a `= VecDeque::new()`, " +
      "a `clear()` with a comment at the tail (the `$` anchor fell), and the " +
      "**second queue**, `salvaged`, which no reconciliation repairs, stayed " +
      "out. Now the two queues are one type — `EventQueue`, with the `VecDeque` " +
      "private — that empties in bulk from two doors only, `take_all` (transfers) " +
      "and `discard_all` (throws away, and returns how many): the count counts " +
      "those calls, i.e. the ownership, and every other form does not compile. " +
      "It reads **one file only** and it can afford it because the type is " +
      "private to the module: a queue in another file could not name it.",
    command:
      "grep -oE '\\.(discard_all|take_all)\\(\\)'" +
      " crates/fub-kernel/src/dispatcher.rs | wc -l",
  },
  {
    name: "gesti-della-shell",
    reason:
      "The gestures the shell e2e walks end to end (§17.2): one `it` " +
      "per gesture in `frontend/src/shell.e2e.test.ts`. It is the discipline of " +
      "0109 applied to a suite that cannot be emptied by a `cfg` but by a " +
      "deleted line or a `.skip`. An actor that looks at the file from " +
      "outside is needed: a gesture that disappears leaves a green and smaller " +
      "suite, and smaller is not visible. The first form read `^  it(`, i.e. **today's " +
      "indentation**: measured, a `.skip` on the six `describe` — which stand at " +
      "column zero — left the count at seven, `npm run test` at exit 0 with " +
      "`7 skipped` and the green prose, i.e. all seven gestures gone without " +
      "a color. Now the indentation does not matter, gestures are recognized " +
      "also as `it.each(`/`test(`, and a `.skip`/`.only`/`.todo` on a `describe` or an " +
      "`it` zeroes the count: a suite that can *not run* does not " +
      "scale, it turns itself off loudly. What the count does NOT see is an `it` " +
      "that asserts nothing; for that the actor is the red verification, done by hand.",
    command:
      "awk '/^[[:space:]]*\\/\\//{next} /(describe|it|test)\\.(skip|only|todo)/{fuori=1}" +
      " /^[[:space:]]*(it|test)[[:space:]]*(\\.each\\([^)]*\\))?\\(/{n++}" +
      " END{print fuori?0:n+0}' frontend/src/shell.e2e.test.ts",
  },
  {
    name: "finestre-aperte",
    reason:
      "The data-channel queries the shell asks **without a window**, i.e. " +
      "asking for the whole vault: how many surfaces are allowed to grow " +
      "with the number of notes (§2.9). The number must not be zero — the tags of " +
      "a vault are its vocabulary, and truncating an alphabet is worse than " +
      "carrying it whole — but it must be **small and named**, because each of " +
      "these is a promise the UI makes to §24.1 and cannot keep. " +
      "Before this count the line that promised it was written in a " +
      "comment of `host/query.ts` and the count did not exist: a guard " +
      "promised and never written, worse than no comment. The anchor is " +
      "`WITHOUT_PAGE` in **argument** position — after a parenthesis or " +
      "a comma — so the `import` and the line that compares it stay out. " +
      "The count holds because the value is a `unique symbol`: the constant " +
      "cannot be rewritten by hand, so there is no way to open a window without " +
      "naming it. Declared blind zone: an argument wrapped onto its own line " +
      "(`f(\\n  WITHOUT_PAGE,\\n)`) has no comma on the same line and " +
      "escapes — `prettier` does not break a call that short, but if it did " +
      "the count would go down instead of up, i.e. it would be seen.",
    command:
      "find frontend/src -name '*.ts' | xargs grep -ohE '[(,] ?WITHOUT_PAGE'" +
      " | wc -l",
  },
  {
    name: "stati-salvataggio",
    reason:
      "The states the bar can say of a document: the cases of " +
      "`SaveState` in `frontend/src/state/saving.ts`. The comment " +
      "that introduces them said «four and not two» and it was true the day " +
      "it was written; then §18.1 added `conflict` and the phrase " +
      "stayed behind without anything turning red — a number in a " +
      "comment is less than a string constant, and the compiler does not " +
      "look at it. It is exactly the species of §16.7, and the right place to " +
      "guard it is this register: that number **speaks about the sources**, and " +
      "it does not matter if it lives in `docs/` or in a `///` line. The anchor " +
      "reads the variants from the declaration, and stops at the first `;` — even " +
      "when it is on the same line, which is what a `sed` range cannot do. " +
      "Declared blind spot: a variant that was not a lowercase string literal " +
      "would not enter the count.",
    command:
      "awk '/^export type SaveState =/{f=1} f{print; if(/;/) exit}'" +
      " frontend/src/state/saving.ts | grep -oE '\"[a-z_]+\"' | wc -l",
  },
  {
    name: "esiti-cambio-sotto",
    reason:
      "The responses of `UnderChange`, i.e. in how many ways the shell can say " +
      "who rewrote a file under a buffer. It lives next to " +
      "`saving-states` and stays in the same file for the same reason: the " +
      "comment that lists them **counts them**, and today the number is right. " +
      "A count is guarded when it is right — when it is wrong it is no longer " +
      "a guard, it is a repair.",
    command:
      "awk '/^export type UnderChange =/{f=1} f{print; if(/;/) exit}'" +
      " frontend/src/state/saving.ts | grep -oE '\"[a-z_]+\"' | wc -l",
  },
  {
    name: "echoes-fuori-dal-padrone",
    reason:
      "The lines of `frontend/src` that move the echo counter **outside " +
      "who owns it**, i.e. outside `state/saving.ts`. It must be **zero**. " +
      "The echo count has two events — it is born with the write, " +
      "dies with the event that the write produces — and for a while the half " +
      "that removes has been a `-= 1` written by hand inside the `case \"echo\"` of " +
      "whoever notifies: a line that the next branch, or the next listener of " +
      "`document_changed`, forgets. No type forbids it (it is a `number` in " +
      "an object) and no test sees it, because the test that would see it is " +
      "the caller that does not exist yet: a count that reads the " +
      "sources from outside sees it. It skips comment lines, and not for elegance " +
      "— the prose that tells this defect writes the old form in full, and " +
      "measured without the skip the count said **one** counting its own " +
      "story, the same defect as `shell-diagnostics` repeated.",
    command:
      "find frontend/src -name '*.ts' ! -name 'saving.ts' | xargs awk" +
      " '/^[[:space:]]*(\\/\\/|#|\\*|\\/\\*)/{next}" +
      " {n+=gsub(/echoes[[:space:]]*(\\+=|-=|\\+\\+|--)/,\"\")} END{print n+0}'",
  },
  {
    name: "uscite-fuori-dal-ponte",
    reason:
      "The lines of `crates/fub-host/src` that deliver to an `EventSink` **outside " +
      "the bridge**, i.e. outside `bridge.rs`. The bridge is the place where an " +
      "event that cannot leave is counted and re-said as `Overflow` as soon as " +
      "the exit reopens: who delivers elsewhere does not have that count, and an " +
      "event lost there is lost for real. There is **one**, and it has a reason " +
      "a machine setting written with no vault open has no bus, " +
      "so no bridge — but it is a reason that holds for it alone: a " +
      "second hand-written delivery must either go through the bridge or " +
      "declare why it cannot. Declared blind spot: the count watches the " +
      "shape `sink.emit(`, so whoever copies the sink into a variable with " +
      "another name, or calls `EventSink::emit(&*s, …)` in full, would not " +
      "be counted — the direction in which the count errs requires *wanting* " +
      "to bypass it. It skips comment lines, or the prose that explains this " +
      "defect would count itself.",
    command:
      "find crates/fub-host/src -name '*.rs' ! -name 'bridge.rs' | xargs awk" +
      " '/^[[:space:]]*(\\/\\/|#|\\*|\\/\\*)/{next}" +
      " {n+=gsub(/sink\\.emit\\(/,\"\")} END{print n+0}'",
  },
  {
    name: "lucchetti-nudi-del-kernel",
    reason:
      "The files of `crates/fub-kernel/src` holding a `Mutex`/`RwLock` in " +
      "**production** outside the two poison doors (`bus.rs` of 0126 and " +
      "`poison.rs`). It is the zone 0120 declared it would not watch and that " +
      "0126 refused to close, for a reason that still holds: " +
      "an allowlist on these files would be as long as the list it should " +
      "restrict, and the kernel's policy is not the host's. But " +
      "«declared» does not mean «measured»: the head of " +
      "`crates/fub-kernel/tests/kernel_poison.rs` listed **nine** by hand, and three " +
      "of them — `journal.rs`, `drafts.rs`, `ignore.rs` — had " +
      "none, while `vault.rs` had one and was not on the list. " +
      "No actor watched that sentence; now the number is this. " +
      "The `#[cfg(test)]` cut is that of the two poison benches: a " +
      "lock built in a bench is bench property, and that is why `vault.rs` is **not** " +
      "here. " +
      "Declared blind spots, all in the direction of who would bypass them: " +
      "files are counted, not sites, so a second lock in a file " +
      "that already has one does not move the number; the anchor is the type " +
      "name, so a `use std::sync::Mutex as Lock` or a third-party lock " +
      "is not seen; and the cut assumes the test module is at the end, " +
      "as the files of this crate are written. Comment lines are skipped, " +
      "or the prose that explains this defect would count itself. " +
      "A **third** door written tomorrow would raise the number instead of " +
      "disappearing from the count: the right direction to err, because it " +
      "forces declaring it.",
    command:
      "find crates/fub-kernel/src -name '*.rs' ! -name 'bus.rs' ! -name" +
      " 'poison.rs' -exec awk 'FNR==1{c=0;t=0} /^#\\[cfg\\(test\\)\\]$/{t=1}" +
      " t{next} /^[[:space:]]*\\/\\//{next}" +
      " !c&&/(Mutex|RwLock)(<|::)/{print FILENAME; c=1}' {} + | wc -l",
  },
  {
    name: "lucchetti-fuori-dal-conto",
    aliases: ["lucchetti-outside-dal-conto"],
    reason:
      "The same files, widened to the three crates the 0120 count does not " +
      "cross: `fub-kernel`, `fub-features` and `fub-sdk`. It lives in the same " +
      "sentence as `lucchetti-nudi-del-kernel` and closes it from the other end — that " +
      "one says how big the kernel blind zone is, this how big all of it is. It " +
      "exists because `crates/fub-host/tests/one_lock_only.rs` declares " +
      "the blind zone and did not give **any** number: a blind zone without a " +
      "number is indistinguishable from a growing one, and that is how file " +
      "number nine entered silently. The count restricts nothing and does not " +
      "ask anyone for a justification line: the 0126 decision — that a poison " +
      "policy derives from what the lock protects, instead of being transplanted " +
      "— remains intact. What changes is only that the blind zone is now " +
      "measured. Same blind spots as the count above.",
    command:
      "find crates/fub-kernel/src crates/fub-features/src crates/fub-sdk/src" +
      " -name '*.rs' ! -name 'bus.rs' ! -name 'poison.rs' -exec awk" +
      " 'FNR==1{c=0;t=0} /^#\\[cfg\\(test\\)\\]$/{t=1} t{next}" +
      " /^[[:space:]]*\\/\\//{next} !c&&/(Mutex|RwLock)(<|::)/{print FILENAME;" +
      " c=1}' {} + | wc -l",
  },
  {
    name: "buchi-dichiarati",
    reason:
      "The records that declare a gap of their own: a fact about the shape of " +
      "the contract that cannot be closed from here, written instead of left " +
      "open (rule of 0064). It is not a box and does not enter any " +
      "total — but **it** is a number, and the glossary line that writes it " +
      "stayed behind three times in a row because no actor watched it: " +
      "it said «two» while there were three, then «four» while there were " +
      "six. The anchor is the **emphasis**: a record that declares one writes it " +
      "in bold or in a title, while whoever cites another one's names it " +
      "in passing in the middle of a sentence — and the only emphatic citation " +
      "form that exists, «il buco dichiarato **della** 0064» is " +
      "removed by name. **Files** are counted, not lines, because a record that " +
      "declares one also names it three times. Declared blind spot: a " +
      "record that declared a gap without emphasizing it would not enter the " +
      "count, and one that cited another's in bold without saying «of» " +
      "would enter it wrongly.",
    command:
      "grep -EiH '(\\*\\*[^*]*buco dichiarato|^#+[^#]*buco dichiarato)'" +
      " docs/decisions/0*.md | grep -vi 'buco dichiarato della'" +
      " | cut -d: -f1 | sort -u | wc -l",
  },
  {
    name: "scene-del-banco",
    reason:
      "The scenes of the visual bench (§31.1): the `id:` lines of the closed list in " +
      "`frontend/bench/scene.mjs`. This number is cited in prose — the roadmap, " +
      "decision records, the locale loop — and grows every time someone " +
      "adds a surface to photograph. Scenes are counted, not photos, because " +
      "photos are double by construction (two lights), and a count that " +
      "doubles reads poorly: `scene.test.ts` already guards " +
      "that there are exactly two per scene.",
    command: "grep -c '^    id: ' frontend/bench/scene.mjs",
  },
  {
    name: "verbali",
    reason:
      "The decision records of the closed decisions. It is the count that `todo.md` " +
      "already wrote with its command beside it — the only one with a source " +
      "before this register, and it said «fifty-seven» when they were fifty-nine.",
    command: "ls docs/decisions/0*.md | wc -l",
  },
  {
    name: "voci-aperte",
    reason:
      "The still-open entries of the infrastructure plan: the rows of the table " +
      "in `todo.md`. The plan declares that «if an entry is in this table it " +
      "is open» and that a closed entry **disappears** — so the number is not " +
      "a thing to remember, it is a thing to count, and until now nobody did. " +
      "The `|| true` at the end is not laziness: `grep -c` exits **1** when it " +
      "finds nothing, and zero open entries is exactly what this count was " +
      "born to be able to say — without it, on the day the table empties, the " +
      "register would say «did not count» instead of «zero».",
    command: "grep -c '^| \\*\\*§' docs/todo.md || true",
  },
  {
    name: "difetti-aperti",
    reason:
      "The measured defects still open: the rows of the «Measured defects» table " +
      "of `todo.md`. It is the **third species** of work that file " +
      "holds, and it has its own count for the same reason the plan " +
      "table has a column separate from the entries — a defect does not ask for " +
      "a decision and is not the residue of a record, so summing it to the other " +
      "two would give a number that answers no question. It counts the row and " +
      "not the id because the ids **do not scale**: they come " +
      "from the issue tracker and are cited by records, so the sequence has " +
      "holes and the last number does not say how many there are. The " +
      "`|| true` is that of `open-entries`, for the same reason: " +
      "zero open defects is the thing this count must be able to say. " +
      "The pattern takes **any four digits** and not `00NN`: born when " +
      "the ids all came from `issues.md`, it stopped at 0099, and the first " +
      "new block would have skipped it, making the guard count fewer rows " +
      "than there are — lying downward exactly while the table grows.",
    command: "grep -c '^| [0-9][0-9][0-9][0-9] |' docs/todo.md || true",
  },
];

// The pattern of a count annotation in prose:
//   "[conta: <name>]"
export const RE_ANNOTATION = /\[conta:\s*([a-z0-9-]+)\s*\]/;

// The commands that are bare grep patterns (everything else starts with
// `node `, `awk `, `sed `, `wc `, `ls `, `find `, or `grep `).
export const RE_COMMAND = /^(grep|node|awk|sed|wc|ls|find|git)/;
