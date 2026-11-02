# Chi possiede che cosa

> **Per chi:** chi sta per cambiare qualcosa e deve sapere in quale file
> vive la regola, e quale test la difende.
> **Risultato:** il punto esatto dove mettere le mani, e il banco che dirà
> se qualcosa si è rotto.
> **Fonte autorevole:** i test e i guard citati; i confini spiegati stanno in
> [`components-and-boundaries.md`](../architecture/components-and-boundaries.md).

## L'indice delle regole

| Regola | Il file che la possiede | Il presidio |
|---|---|---|
| il contratto è uno e sta in un posto | `crates/fub-abi/src/` | `crates/fub-abi/tests/superficie_della_radice.rs` |
| ogni tipo che attraversa una firma ha una controparte WIT | `crates/fub-abi/wit/fub/abi.wit` | `crates/fub-abi/tests/wit_conformance.rs` |
| il contratto cresce solo per aggiunta | `crates/fub-abi/wit/frozen/` | `crates/fub-abi/tests/wit_additivity.rs` |
| le regole di identità si dichiarano | `crates/fub-abi/src/rules/` | `crates/fub-abi/tests/a_named_rule_is_declared.rs` |
| un nome è lo stesso nome in ogni codifica | `crates/fub-abi/src/rules/composition.rs` | `crates/fub-abi/tests/one_normalized_form.rs` |
| le entità HTML si scrivono in un posto solo | `crates/fub-abi/src/html.rs` | `crates/fub-abi/tests/one_escape_table.rs` |
| l'impronta FNV-1a si calcola in un posto solo | `crates/fub-abi/src/edit.rs` | `crates/fub-abi/tests/one_fingerprint.rs` |
| il bersaglio di un clic non entra nel contesto di sessione | `crates/fub-abi/src/session.rs` | `crates/fub-abi/tests/context_has_four_fields.rs` |
| `serialize` non riscrive un documento esistente | i provider, `crates/fub-abi/src/format.rs` | `crates/fub-abi/tests/serialize_non_riscrive.rs` |
| la scrittura è atomica rispetto al parse | `crates/fub-kernel/src/workspace.rs` | `crates/fub-kernel/tests/write_atomicity.rs` |
| la storage accede dai soli handle, la radice non si ripete | `crates/fub-kernel/src/storage/` | `crates/fub-kernel/tests/rooted_cas.rs` |
| cancellare è spostare nel cestino, mai distruggere | `crates/fub-kernel/src/os_trash.rs` e `rules/trash.rs` | `crates/fub-kernel/tests/trash.rs` |
| un provider che pania costa la chiamata, non il vault | `crates/fub-kernel/src/safety.rs` | `crates/fub-kernel/tests/the_panic.rs` |
| i lucchetti dell'host passano da una porta sola, senza callback sotto guardia | `crates/fub-host/src/custody.rs` | `crates/fub-host/src/legacy_tests/` |
| le capacità si rifiutano da un solo `Guard` per famiglie | `crates/fub-kernel/src/host/guard.rs` | `crates/fub-kernel/tests/effective_capabilities.rs` |
| la tabella di montaggio dei bundle è una, per app, CLI e headless | `crates/fub-host/src/mount.rs` | `crates/fub-host/tests/before_write_bundles.rs` |
| in quale vault arriva una scrittura è detto, non implicito | `crates/fub-host/src/session.rs` | `crates/fub-host/tests/the_vault_of_a_write.rs` |
| la superficie IPC è un elenco chiuso | `crates/fub-app/src/lib.rs` | `crates/fub-app/tests/lean_ipc.rs` |
| ogni finestra ha solo i permessi che le spettano | `crates/fub-app/permissions/` | `crates/fub-app/tests/ipc_permissions.rs` |
| nessun modulo della shell importa Tauri fuori dalla cucitura | `apps/client/src/host/ipc.ts` | `apps/client/src/host/no-tauri-outside-host.test.ts` |
| CodeMirror resta nel package del testo | `apps/client/src/editors/text/` | `.github/scripts/check-codemirror-boundary.mjs` |
| ProseMirror resta in Scrittura | `apps/client/src/scrittura/` | `.github/scripts/check-prosemirror-boundary.mjs` |
| la Tabella non sa in quale editor vive | `apps/client/src/tabella/` | `.github/scripts/check-tabella-boundary.mjs` |
| ogni listener globale ha un owner e un disposer | `apps/client/src/ui/lifetime.ts` | `.github/scripts/check-listeners.mjs` |
| niente attese nascoste dentro un giro della coda | `apps/client/src/state/kernel.ts` | `.github/scripts/check-races.mjs` |
| un editor non scrive un ruolo del tema sull'elemento | `apps/client/src/theme/` | `.github/scripts/check-inline-theme.mjs` |
| il tema di serie si rigenera byte per byte | `apps/client/theme/author/` | `npm run theme:generate && npm run theme:verify` |
| una pelle rifiutata rende la pagina senza stile, e si vede | `apps/client/src/ui/sanitize-css.ts` | `apps/client/src/theme/gate.test.ts` |
| l'HTML entra nella webview da un punto solo | `apps/client/src/ui/sanitize.ts` | `apps/client/src/ui/sanitize.test.ts` |
| il mirror TypeScript non diverge dal Rust | i test `ts_*` dei crate | `UPDATE_MIRROR=1 cargo test …` e i banchi `mirror` |
| le regole lato shell sono le stesse del contratto | `apps/client/src/rules/` | `crates/fub-abi/tests/rules_mirror.rs` |
| l'inchiostro TypeScript è la copia calda di quello Rust | `apps/client/src/ink/` | `crates/fub-ink/tests/ts_mirror.rs` e la fixture `ink-samples.json` |
| i disegni grandi si aprono e si muovono nei tempi | `apps/client/src/editors/spatial/painter/` | `npm run bench:large`, gate della CI |
| la battuta sta nel budget di 4 ms di mediana | `apps/client/src/editors/text/profiles/markdown/` | `node bench/interaction.mjs --only=battuta` e `render-incremental.test.ts` |
| una feature Cargo è accesa solo da chi la usa | `crates/fub-features/src/inventory.rs` | `crates/fub-features/tests/cargo_features.rs` e `check-cargo-feature-default.mjs` |
| una feature spenta non rompe il build | `crates/fub-features/` | la CI compila `--no-default-features` |
| i motori di terzi si nominano dai soli adattatori | `crates/fub-format-rich/`, `crates/fub-format-xlsx/` | `.github/scripts/check-engine-boundary.mjs` |
| nessuna interfaccia delle app Craft in `fub-app`, librerie doppie sotto il tetto | `docs/reference/budgets.json` | `.github/scripts/check-motori.mjs` |
| un motore si costruisce alla prima richiesta e una volta sola, senza lucchetto tenuto | `crates/fub-motori/src/pigro.rs` | `crates/fub-motori/tests/pigro.rs` |
| le cache dei motori stanno sotto un tetto comune, dalla meno usata | `crates/fub-motori/src/memoria.rs` | `crates/fub-motori/tests/memoria.rs` |
| la copia di un motore è derivata e verificata | `tools/vendor-craft/vendor.mjs` | `vendor.mjs check`, `verify-upstream`, `gate` |
| i componenti WASM rispettano tempi e memoria | `crates/fub-wasm-host/src/limits.rs` | `crates/fub-wasm-host/tests/` |
| i plugin installati si accendono e spengono per vault | `crates/fub-host/src/session.rs` | `crates/fub-kernel/tests/deactivation.rs` e `crates/fub-host/tests/draw_feature.rs` |
| il testo del vault passa dal kernel, mai dal formato sbagliato | `crates/fub-kernel/src/documents.rs` | `crates/fub-kernel/tests/text_fidelity.rs` |

## I cinque proprietari del kernel

`Workspace` non è un struct piatto: chi risponde di una domanda è sempre uno
di cinque (`crates/fub-kernel/src/lib.rs`):

| Proprietario | Risponde di |
|---|---|
| `DocumentStore` | il disco, e come ciò che ci sta sopra diventa un modello |
| `Indexes` | il canale dati: chi risponde a una query e come si instrada |
| `ProviderRegistry` | chi è registrato e che cosa ha dichiarato |
| `Dispatcher` | quando un evento parte, con che nome, fino a quando |
| `Session` | che cosa sta guardando l'utente adesso |

## Le tre pile di lavoro

Quando un gesto può essere lungo, il posto giusto è deciso da tre domande
(`crates/fub-host/src/jobs.rs` e `crates/fub-kernel/src/dispatcher.rs`):

| Lavoro | Dove vive | La regola |
|---|---|---|
| un evento | coda del kernel, `BatchId` per il lotto | accodato, mai rientrante |
| un lavoro lungo | job dell'host con stato e cancellazione | mai un lucchetto tenuto mentre si chiama fuori |
| una risposta immediata | il chiamante | il custode del workspace non aspetta |
