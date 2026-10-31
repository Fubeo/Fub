# Dove sta X

> **Per chi:** chi cerca una definizione avendo in mano un nome: un tipo, un
> comando, un'impostazione, una chiave, una stringa.
> **Risultato:** il file che definisce X, senza passare per il motore di
> ricerca.
> **Fonte autorevole:** il file citato in ogni riga; se la riga e il file
> divergono, vince il file e la riga va corretta.

## I contratti

| Contratto | Definito da |
|---|---|
| il modello di documento comune | `crates/fub-abi/src/model.rs` |
| i trait di estensione e il manifest dei plugin | `crates/fub-abi/src/traits.rs` |
| il `FormatProvider` | `crates/fub-abi/src/format.rs` |
| l'edit chirurgico e le revisioni | `crates/fub-abi/src/edit.rs` |
| gli eventi e i lotti | `crates/fub-abi/src/event.rs` |
| la famiglia `grid` a byte e il giornale | `crates/fub-abi/src/grid_bytes.rs` |
| il confine IPC e i suoi tipi | `docs/reference/ipc-contract.md` e `apps/client/src/host/contract.ts` |
| il contratto WASM | `crates/fub-abi/wit/fub/abi.wit` (`fub:abi@0.2.0`) |
| il formato scena dei disegni | `docs/reference/scene-format.md` |
| le annotazioni PDF (`.fubann`) | `docs/reference/annotation-format.md` |
| JSON Canvas (`.canvas`) | `crates/fub-format-canvas/schema/canvas-v1.schema.json` |
| la proiezione dei documenti ricchi | `docs/reference/rich-projection.md` |
| il protocollo della sessione live | `docs/reference/live-session.md` |
| gli strumenti del server MCP | `docs/reference/mcp-server.md` |
| la cattura del clipper | `apps/clipper/capture-v1.schema.json` |
| il layout su disco di `.fub/` | `docs/reference/on-disk-layout.md` |

## Tipi e chiavi che si cercano spesso

| Nome | Dove sta |
|---|---|
| `DocumentSession` | `apps/client/src/state/document-session.ts` |
| `TextEngine` (il padrone di CodeMirror) | `apps/client/src/editors/text/engine.ts` |
| il registro delle superfici | `apps/client/src/editors/core/registry.ts` |
| `SHELL_COMMANDS` e i suoi mirror | `crates/fub-host/src/shell.rs` e `apps/client/src/ui/shell-keys.generated.ts` |
| `PluginManifest` (`provides`, `requires`) | `crates/fub-abi/src/traits.rs` |
| `plugins.disabled` (spegnere per vault) | `crates/fub-host/src/settings.rs` |
| `SettingSpec` e i livelli delle impostazioni | `crates/fub-abi/src/settings.rs` |
| `perf.probe` (la sonda N0) | `crates/fub-host/src/settings.rs`, montata da `apps/client/src/perf/` |
| `draw.workspace` (Semplice o Completo) | le impostazioni della feature `draw`, `crates/fub-features/src/draw.rs` |
| il registro dei comandi del vault | `crates/fub-features/src/commands.rs` (dogfood del `CommandProvider`) |
| il catalogo dei comandi dei fogli | `crates/fub-abi/src/grid_bytes.rs`, servito in `crates/fub-format-xlsx` |
| il lessico dei menu | `apps/client/src/i18n/lexicon.ts` |
| le stringhe della shell | `apps/client/src/i18n/catalog.ts` |
| le stringhe dell'editor dei disegni | `apps/client/src/editors/spatial/strings.ts` |
| la tavolozza dell'inchiostro | `apps/client/src/ink/palette.ts` (Okabe–Ito) |
| i sei colori della lavagna | `apps/client/src/editors/canvas/engine.ts` |
| il limite dei 64 MiB per i media | `apps/client/src/editors/media/media-types.ts` |
| il sanificatore dell'HTML | `apps/client/src/ui/sanitize.ts` |
| le molle del moto | `apps/client/src/moto/spring.ts` |
| `MemoryHost` (provare un provider) | `crates/fub-sdk/src/testing/mod.rs` |
| i template dei disegni | `crates/fub-features/templates/` |
| le scene del banco visivo | `apps/client/bench/scene.mjs` |
| i budget della CI della WebView | `apps/client/bench/webview/budgets.json` |
| le misure prese | `docs/misure/` |

## I file generati, da dove vengono

| File | Come si rigenera |
|---|---|
| `apps/client/src/host/enums.generated.ts` | `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums` |
| `apps/client/src/ui/shell-{ids,keys}.generated.ts` | `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_ids_mirror` (e `shell_keys_mirror`) |
| `apps/client/src/rules/syntax.generated.ts` | `UPDATE_MIRROR=1 cargo test -p fub-abi --test rules_mirror` |
| `apps/client/src/editors/rich/paper.generated.ts` | `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_projection` |
| le fixture dei mirror (in `src/__fixtures__/`) | lo stesso giro di `UPDATE_MIRROR=1` del test che le cita |
| la pelle del tema di serie | `npm run theme:generate` da `apps/client/` |
| il catalogo dei comandi serviti dei fogli | `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --lib catalogo_servito` |
| il corpus dei documenti ricchi | `cargo run -p fub-format-rich --example genera_corpus` |
| le baseline visuali | solo dal runner Linux: `npm run bench:update` |
| `vendor/<motore>/` | `node tools/vendor-craft/vendor.mjs <motore> update --rev <sha>` |

La regola vale per tutti: mai a mano. Il primo commento di ogni file generato
nomina il comando esatto.

## Le prove

| Voglio provare | Comando |
|---|---|
| il nucleo Rust | `cargo test --workspace --no-fail-fast` |
| un crate solo | `cargo test -p fub-kernel` |
| il client | `npm run typecheck && npm test` da `apps/client/` |
| un test solo | `npx vitest run src/host/mirror.test.ts` |
| il banco visivo | `npm run bench:verify` |
| l'accessibilità | `npm run bench:a11y` |
| il moto | `npm run bench:motion` |
| la battuta | `node bench/interaction.mjs --only=battuta` |
| la WebView vera | `npm run bench:webview` |
| un motore di terzi | `node tools/motori-prova/misura.mjs --out DIR` |
| un guard | `node .github/scripts/<guard>.mjs` |

L'elenco dei comandi che la CI pretende sta in `CONTRIBUTING.md`, fra
`ci-required:start` e `ci-required:end`.
