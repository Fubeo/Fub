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
| i trait di estensione e il manifest dei plugin | `crates/fub-abi/src/traits.rs`, diviso in `traits/` (capacità in `stores.rs` e `host.rs`, provider in `views.rs`, `index_provider.rs`, `plugin.rs`) |
| il `FormatProvider` | `crates/fub-abi/src/format.rs` |
| l'edit chirurgico e le revisioni | `crates/fub-abi/src/edit.rs` |
| gli eventi e i lotti | `crates/fub-abi/src/event.rs` |
| la famiglia `grid` a byte e il giornale | `crates/fub-abi/src/grid_bytes.rs` |
| il confine IPC e i suoi tipi | `docs/reference/ipc-contract.md` e `apps/client/src/host/contract.ts` |
| le porte della pagina Componenti | `docs/reference/components-contract.md` |
| il contratto WASM | `crates/fub-abi/wit/fub/abi.wit` (`fub:abi@0.2.0`) |
| il formato scena dei disegni | `docs/reference/scene-format.md` |
| le annotazioni PDF (`.fubann`) | `docs/reference/annotation-format.md` |
| JSON Canvas (`.canvas`) | `crates/fub-format-canvas/schema/canvas-v1.schema.json` |
| il modello e le regole della lavagna | `crates/fub-canvas-core/` e `docs/reference/canvas-format.md` |
| la lavagna letta come codice (`outline`, `code`, `json`) | `crates/fub-canvas-core/src/describe.rs` e `docs/reference/canvas-code.md` |
| lo schema delle operazioni della lavagna, i problemi di forma (`validate`) | `crates/fub-canvas-core/src/spec.rs` e `docs/reference/canvas-schema.md` |
| la lettura di Mermaid e delle scalette (`from_mermaid`, `from_outline`) e la loro disposizione | `crates/fub-canvas-core/src/import/`, `src/ops/import.rs` e `docs/reference/canvas-import.md` |
| il controllo di una lista prima di scriverla (`check`) e il suo riassunto | `crates/fub-canvas-core/src/check.rs`, `summary.rs` e `docs/reference/canvas-check.md` |
| le misure e i posti delle schede (`born_size`, `auto_place`, `place_near`, `nearest_sides`, `group_rect`) e le disposizioni (allinea, distribuisci, griglia, riga, colonna, albero) | `crates/fub-canvas-core/src/layout.rs` e `src/layout/arrange.rs`; le regole in `docs/reference/canvas-code.md` («Misure e posti») |
| l'anteprima di una lavagna (il disegno SVG, poi il PNG) | `crates/fub-canvas-core/src/preview.rs`; il PNG e il comando `canvas.preview` in `crates/fub-features/src/lavagna/preview.rs`; `docs/reference/canvas-operations.md` |
| i comandi della lavagna `canvas.apply`, `canvas.create`, `canvas.read`, `canvas.check`, `canvas.guide`, `canvas.preview` | `crates/fub-features/src/lavagna.rs` e `crates/fub-features/src/lavagna/` (un file per comando; `prefill.rs` le misure dei file, `guida.md` la guida); `docs/reference/canvas-operations.md` |
| gli strumenti MCP della lavagna (`fub_canvas_guide`, `fub_canvas_read`, `fub_canvas_create`, `fub_canvas_apply`) | `crates/fub-cli/src/mcp/tools.rs` e `docs/reference/mcp-server.md` |
| la proiezione dei documenti ricchi | `docs/reference/rich-projection.md` |
| il protocollo della sessione live | `docs/reference/live-session.md` |
| le porte IPC del motore del disegno | `docs/reference/drawing-ipc.md` |
| le porte IPC dei fogli di calcolo | `docs/reference/grid-ipc.md` |
| le porte IPC dei temi | `docs/reference/theme-ipc.md` |
| gli strumenti del server MCP | `docs/reference/mcp-server.md` |
| la cattura del clipper | `apps/clipper/capture-v1.schema.json` |
| il layout su disco di `.fub/` | `docs/reference/on-disk-layout.md` |

## Tipi e chiavi che si cercano spesso

| Nome | Dove sta |
|---|---|
| `DocumentSession` | `apps/client/src/state/document-session.ts` |
| `TextEngine` (il padrone di CodeMirror) | `apps/client/src/editors/text/engine.ts` |
| il registro delle superfici | `apps/client/src/editors/core/registry.ts` |
| la porta dei suggerimenti (`openHintSource`) e la riga della banda | `apps/client/src/editors/core/hints.ts`; la riga in `apps/client/src/shells/scrittoio/frame/hints-row.ts` |
| le preferenze dell'editor delle note (`editor.blocks`, `editor.toolbar`, `editor.hints`, `editor.link-click`, `editor.typewriter`, `editor.typography`, `editor.minibar`, `editor.slash`) | `crates/fub-host/src/settings.rs`; `editor.blocks` letta in `apps/client/src/state/editor-blocks.ts` |
| i livelli di presenza sul foglio (`markPresence`) | `apps/client/src/editors/core/presence.ts` |
| la sbirciata (`createNotePeek`) | `apps/client/src/state/note-peek.ts` |
| i gruppi del blocco nella barra di formato | `apps/client/src/editors/text/profiles/markdown/block-groups.ts`, dalla porta `blockGroup` di `apps/client/src/editors/core/registry.ts` |
| il lanciatore (Ctrl O) | `apps/client/src/shells/scrittoio/launcher/` |
| i commenti nelle note (CriticMarkup) | `apps/client/src/editors/text/profiles/markdown/comments/`; la grammatica del provider in `crates/fub-format-markdown/src/parse/comments.rs` |
| il registro dei tipi delle proprietà (`properties.types`) | `crates/fub-kernel/src/properties.rs`; i comandi in `crates/fub-features/src/properties/commands.rs`, le Relazioni in `relation.rs` |
| le toppe mirate del `.base` | `crates/fub-format-base/src/patch.rs`; il modello e la forma su disco (`disk_form`) in `model.rs` |
| la Tabella (i gesti comuni a note, documenti e fogli) | `apps/client/src/tabella/` |
| `SHELL_COMMANDS` e i suoi mirror | `crates/fub-host/src/shell.rs` e `apps/client/src/ui/shell-keys.generated.ts` |
| `PluginManifest` (`provides`, `requires`) | `crates/fub-abi/src/traits/plugin.rs` |
| `plugins.disabled` (spegnere per vault) | `crates/fub-host/src/settings.rs` |
| `SettingSpec` e i livelli delle impostazioni | `crates/fub-abi/src/settings.rs` |
| `perf.probe` (la sonda N0) | `crates/fub-host/src/settings.rs`, montata da `apps/client/src/perf/` |
| `developer.mode` (la modalità sviluppatore) | `crates/fub-host/src/settings.rs`; la applicano `Host::check_theme_folder` e `Host::install_theme_from_folder`, i bottoni stanno in `apps/client/src/panels/theme-folder.ts` («Installa da cartella…», «Collega una cartella…») e in `apps/client/src/panels/settings.ts` («Tutti i componenti») |
| Il tema collegato (`developer.theme-folder`) | `crates/fub-host/src/theme/linked.rs` (lettura con le porte), `crates/fub-host/src/theme_watch.rs` (l'osservatore), `Host::link_theme_folder`; il rimontaggio in `apps/client/src/theme/theme.ts`, il blocco «Cartella collegata» in `apps/client/src/panels/theme-folder.ts` |
| `draw.workspace` (Semplice o Completo) | le impostazioni della feature `draw`, `crates/fub-features/src/draw.rs` |
| `draw.keys` (i tasti del Disegno completo cambiati dall'utente) | la chiave in `crates/fub-features/src/draw.rs`; il valore e i file d'insieme in `apps/client/src/editors/spatial/completo/tasti-utente.ts`, il disegno aperto lo segue con `completo/segui-tasti.ts`, la sezione «Disegno completo» di Impostazioni › Scorciatoie è `apps/client/src/panels/settings-disegno.ts` |
| `draw.motore` (le preferenze del motore del Disegno completo) | la chiave e la versione in `crates/fub-features/src/draw.rs`; la lettura, la scrittura dopo ogni comando e i rifiuti in `crates/fub-host/src/drawing.rs`; le preferenze senza le cartelle in `crates/fub-disegno/src/preferenze.rs`; il riquadro «Motore del disegno» di Impostazioni › Disegni è `apps/client/src/panels/settings-motore.ts` (pigro: `settings-motore-corpo.ts`), le sue parole `settings-motore.generated.json` (`UPDATE_MIRROR=1 cargo test -p fub-host --test ts_preferenze_motore`) |
| le quattordici impostazioni della lavagna, `canvas.*` (`ink_mouse_remember`, `finger_moves_card`, `finger_writes`, `pen_button`, `wheel`, `drag_empty`, `workspace`, `toolbar`, `grid`, `snap`, `snap_step`, `parts_picker`, `drop_folder`, `drop_folder_path`) | le impostazioni della feature `lavagna`, `crates/fub-features/src/lavagna.rs`; le chiavi, i valori di serie e la lettura in `apps/client/src/rules/canvas-settings.ts`, le legge e le segue `apps/client/src/editors/canvas/preferences.ts` |
| dove vanno i file trascinati dal computer sulla lavagna (`canvas.drop_folder`) | `apps/client/src/state/canvas-intake.ts` (`dropFolderFor`, `depositCanvasFiles`); la cartella delle note è `files.attachment-folder`, letta in `apps/client/src/state/document-controller.ts` |
| la regola del documento scritto per nome in un campo «Documento» | `document_named` e `Args::named_document` in `crates/fub-abi/src/command.rs`; per le feature `crates/fub-features/src/formats.rs`, per l'host `crates/fub-host/src/doc_names.rs`; `docs/reference/document-by-name.md` |
| il registro dei comandi del vault | `crates/fub-features/src/commands.rs` e i suoi moduli in `commands/` (dogfood del `CommandProvider`) |
| il catalogo dei comandi dei fogli | `crates/fub-abi/src/grid_bytes.rs`, servito in `crates/fub-format-xlsx` |
| il lessico dei menu | `apps/client/src/i18n/lexicon.ts` |
| le stringhe della shell | `apps/client/src/i18n/catalog.ts` |
| le stringhe dell'editor dei disegni | `apps/client/src/editors/spatial/strings.ts`, con le voci per area (italiano e inglese insieme) in `strings/` |
| il disegno sul motore (chi possiede che cosa) | [Il disegno sul motore](../architecture/disegno.md) |
| il disegno completo (la parità, la mappa, le famiglie pigre, l'indice) | [Il disegno completo](../architecture/disegno-completo.md) |
| gli strumenti del motore nel Completo (il ponte, le opzioni, i tracciati, il Contagocce) | [Gli strumenti del motore](../architecture/disegno-strumenti.md) |
| i livelli del motore nel Completo (la differenza, i comandi sui livelli, il livello corrente) | [I livelli del motore](../architecture/disegno-livelli.md) |
| la tavolozza dell'inchiostro | `apps/client/src/ink/palette.ts` (Okabe–Ito) |
| i colori della lavagna (i sei di JSON Canvas, i nove delle note, «Altro…») | `apps/client/src/editors/canvas/colors.ts` |
| le schede vive della lavagna (`liveCardIds`, `LIVE_ZOOM_MIN`, `MAX_LIVE_CARDS`, che vale anche per le schede della nota) e il contratto dei renderer | `apps/client/src/editors/core/cards/contract.ts`; i renderer in `apps/client/src/editors/core/cards/kinds/` e `apps/client/src/editors/grid/card.ts` |
| l'inventario della parità della lavagna (le voci e i test) | `apps/client/src/__fixtures__/canvas-parity/`, con le regole in `docs/development/canvas-parity.md` |
| il limite dei 64 MiB per i media | `apps/client/src/editors/media/media-types.ts` |
| il sanificatore dell'HTML | `apps/client/src/ui/sanitize.ts` |
| le molle del moto | `apps/client/src/moto/spring.ts` |
| `MemoryHost` (provare un provider) | `crates/fub-sdk/src/testing/mod.rs` |
| i template dei disegni | `crates/fub-features/templates/` |
| le scene del banco visivo | `apps/client/bench/scene.mjs` |
| i cataloghi del banco e la pagina «Tutti i componenti» | `apps/client/src/dev/catalogo/` |
| i comportamenti della shell (avvisi, menu delle modalità, tasto destro, albero, linguette, avvisi nel foglio) | `apps/client/src/panels/`, `apps/client/src/state/`, `apps/client/src/ui/` e `docs/architecture/shell-behaviours.md` |
| la cornice del telefono e la soglia dei 600 px | `apps/client/src/shells/scrittoio/mobile/` e `docs/architecture/phone-frame.md` |
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
| `apps/client/src/__fixtures__/live-decorations.json` (l'impronta delle decorazioni della Live) | `UPDATE_MIRROR=1 npx vitest run src/editors/text/profiles/markdown/livepreview-identica.test.ts` da `apps/client/`, soltanto per un cambio voluto di ciò che la Live disegna |
| la pelle del tema di serie | `npm run theme:generate` da `apps/client/` |
| `apps/client/src/editors/text/profiles/markdown/html-entities.generated.ts` | `npm run entities:generate` da `apps/client/` (verifica: `npm run entities:verify`, e `npm test`) |
| il catalogo dei comandi serviti dei fogli | `UPDATE_MIRROR=1 cargo test -p fub-format-xlsx --lib catalogo_servito` |
| il corpus dei documenti ricchi | `cargo run -p fub-format-rich --example genera_corpus` |
| le baseline visuali | solo dal runner Linux: `npm run bench:update` |
| `apps/client/bench/conformita/<prototipo>.json` (gli stili attesi del prototipo) | `git fetch`, poi `node bench/conformita/estrai.mjs <prototipo>` da `apps/client/`; la chiave `_intestazione` nomina ramo, commit e file del prototipo |
| `vendor/<motore>/` | `node tools/vendor-craft/vendor.mjs <motore> update --rev <sha>` |
| `packaging/flatpak/requisiti-generatori.txt` (i moduli Python dei generatori, con le impronte) | il comando `uv pip compile` scritto in testa al file, da `packaging/flatpak/requisiti-generatori.in` |
| `vendor/whatwg-entities/entities.json` | riscaricato a mano, con i passi del suo `UPSTREAM.md`; lo sha256 atteso sta in `tools/vendor-craft/dati.mjs` |

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
| la grafica uguale al prototipo | `npm run bench:conformita` |
| la battuta | `node bench/interaction.mjs --only=battuta` |
| la WebView vera | `npm run bench:webview` |
| un motore di terzi | `node tools/motori-prova/misura.mjs --out DIR` |
| un guard | `node .github/scripts/<guard>.mjs` |

L'elenco dei comandi che la CI pretende sta in `CONTRIBUTING.md`, fra
`ci-required:start` e `ci-required:end`.
