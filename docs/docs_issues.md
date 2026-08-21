# Registro Problemi Documentazione (docs_issues.md)

Questo file raccoglie gli errori, i refusi, i link rotti e le discrepanze architetturali rilevati durante la verifica della documentazione di Fub da parte dei 5 subagent di audit.

---

## 1. Onboarding, Concetti e Root (`README.md`, `docs/00-inizia-qui/`, `docs/01-concetti/`, `docs/*.md`)
*Segnalato da Doc Auditor 1 (`47256dcc`)*

### `README.md` (Root)
- **Riga 50 (*Idea architetturale*)**: Incoerenza di genere per «un webview» (altrove usato al femminile, es. in `SECURITY.md`). -> Sostituire con «senza portarsi dietro **una** webview».
- **Riga 118 (*Roadmap: M4*)**: Percorso errato `(wit/)` alla radice (il percorso reale è `crates/fub-abi/wit/`). -> Sostituire con `crates/fub-abi/wit/` o `crates/fub-abi/wit/fub/abi.wit`.

### `docs/CONTRIBUTING.md`
- **Righe 110-111 (*Le eccezioni al ciclo*)**: Nome script errato `check-ciclo-locale.mjs` (lo script reale in `.github/scripts/` è `check-locale-loop.mjs`).
- **Righe 133-135 (*Il banco visivo*)**: Comandi npm inesistenti `npm run banco:verifica`, `npm run banco:aggiorna`, `npm run banco`. In `frontend/package.json` sono `npm run bench:verify`, `npm run bench:update`, `npm run bench`.
- **Riga 139 (*Il banco visivo*)**: Percorso inesistente `frontend/banco/.uscita/foglio-di-contatto.html` (la cartella reale è `frontend/bench/` e l'output è in `.output/`).
- **Righe 147-158 (*Tre file del tema sono generati*)**: Nomi file in italiano non corrispondenti alla codebase reale (`ricetta.ts` -> `recipe.ts`, `foglio-*.css` -> `sheet-dark.css`/`sheet-light.css`, `serie/pelle/` -> `serie/skin/`, `serie/pelle.css` -> `serie/skin.css`, `serie/pelle/ordine.ts` -> `serie/skin/order.ts`, `pelle.css` -> `skin.css`).
- **Righe 162-163, 170 (*Tre file del tema sono generati*)**: Comandi npm inesistenti `npm run tema:genera` e `npm run tema:verifica` (gli script reali sono `npm run theme:generate` e `npm run theme:verify`).
- **Riga 168 (*Tre file del tema sono generati*)**: Nomi test inesistenti `src/theme/ricetta.test.ts` e `src/theme/pelle.test.ts` (i file reali sono `recipe.test.ts` e `skin.test.ts`).

### `docs/SECURITY.md`
- **Riga 98 (*Cosa il progetto presidia già*)**: Conteggio crate obsoleto («i `Cargo.toml` degli otto crate» invece di nove crate attuali con `fub-wasm-host`). -> Sostituire con «dei nove crate».

### `docs/CODE_OF_CONDUCT.md`
- **Riga 22**: Presenza di un secondo titolo H1 (`# Codice di Comportamento del Collaboratore`) dopo `# Codice di condotta` a riga 1.
- **Riga 26 (*Il Nostro Impegno*)**: Ortografia «ci impegnamo» -> «ci impegniamo».
- **Riga 60 (*Applicazione*)**: Disaccordo grammaticale «I casi [...] possono essere presentate» -> «possono essere presentati».
- **Riga 84 (*Espulsione temporanea*)**: «comprese coloro che applicano...» -> «compresi coloro che» oppure «comprese le persone che».
- **Riga 99 (*Attribuzione*)**: Refuso «Per riposte a domande comuni...» -> «Per **risposte** a domande comuni...».
- **Riga 99 (*Attribuzione*)**: Spazio mancante dopo la virgola «condotta,controlla» -> «condotta, controlla».

### `docs/CHANGELOG.md`
- **Riga 1**: Line break vuoto prima del primo titolo H1.
- **Righe 63-64 (*Non rilasciato*)**: Testo/link incoerente `[milestones/](archivio/milestones/M2-search-graph.md)` -> Correggere in `[archivio/milestones/](archivio/milestones/README.md)` o puntare specificamente a `[M2-search-graph.md]`.

### `docs/00-inizia-qui/` e `docs/01-concetti/`
- `docs/00-inizia-qui/01-cos-e-fub.md` (Righe 46-48): Incoerenza di stile tra testi dei link (alcuni percorsi completi, altri nomi di directory).
- Fine file con righe vuote multiple in `01-cos-e-fub.md`, `02-come-si-avvia.md`, `03-struttura-del-repo.md`, `01-il-vault.md`, `02-il-kernel.md`, `03-i-plugin.md`, `04-gli-eventi.md`.

---

## 2. Documentazione Componenti (`docs/02-componenti/`)
*Segnalato da Doc Auditor 2 (`054c6d5c`)*

### Refusi e Testo Corrotto
- **File**: [`docs/02-componenti/04-fub-sdk.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/04-fub-sdk.md)
  - **Riga**: 24 (*File chiave del modulo*)
  - **Problema**: Testo corrotto derivante da copia/incolla errato (`per i test di conformità.tizia dell'interfaccia HostApi`).
  - **Correzione**: Sostituire con:
    ```markdown
    - [`crates/fub-sdk/src/testing/mod.rs`](../../crates/fub-sdk/src/testing/mod.rs): simulatore host in memoria (`MemoryHost`) e implementazione fittizia dell'interfaccia `HostApi` utile per collaudi rapidi nei test unitari.
    ```

- **File**: [`docs/02-componenti/01-panoramica.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/01-panoramica.md)
  - **Riga**: 33 (*Tabella dei componenti*)
  - **Problema**: Mancano i backtick su `tantivy` nella colonna delle dipendenze (a differenza di `` `comrak` `` e `` `wasmtime` ``).
  - **Correzione**: Sostituire `con tantivy` con `con \`tantivy\``.

### Discrepanze Architetturali e Concettuali
- **File**: [`docs/02-componenti/01-panoramica.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/01-panoramica.md)
  - **Riga**: 14 (Diagramma Mermaid)
  - **Problema**: Il diagramma mostra `fub-host` (C) che dipende da `fub-wasm-host` (G) (`C --> G`). L'invariante architetturale impone che `fub-host` non conosca `fub-wasm-host` né `wasmtime`; è `fub-wasm-host` che dipende da `fub-host` ed entrambi sono linkati in `fub-app`.
  - **Correzione**: Correggere la freccia (`G --> C`) e/o collegare `fub-app` (`B --> G`).

- **File**: [`docs/02-componenti/06-fub-features.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/06-fub-features.md)
  - **Riga**: 9 (*A cosa serve*)
  - **Problema**: Viene indicato che `graph.rs` gestisce sia il grafico sia il pannello backlink (`Grafico e collegamenti (graph.rs): mappa visiva e pannello dei backlink`). In realtà `backlinks.rs` e `graph.rs` sono due moduli e feature cargo separati.
  - **Correzione**:
    ```markdown
    - **Grafico delle note** (`graph.rs`): mappa visiva interattiva delle relazioni tra documenti.
    - **Backlink** (`backlinks.rs`): pannello dei collegamenti in entrata verso la nota corrente.
    ```

- **File**: [`docs/02-componenti/07-fub-host.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/07-fub-host.md)
  - **Riga**: 8 (*A cosa serve*)
  - **Problema**: Viene citato il nome del tipo Rust come `Custodia` (italiano) invece della struct reale `Custody<T>`.
  - **Correzione**: Sostituire con `Custody`.

### Link e Riferimenti Interni
- **File**: [`docs/02-componenti/04-fub-sdk.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/04-fub-sdk.md)
  - **Riga**: 31 (*Se vuoi il dettaglio*)
  - **Problema**: Il link punta alla cartella directory `docs/04-plugin/` senza puntare a un file Markdown esistente.
  - **Correzione**: Puntare a un file specifico (es. `docs/04-plugin/01-nativo-vs-wasm.md` o `docs/04-plugin/05-creare-un-plugin.md`).

- **File**: [`docs/02-componenti/02-fub-abi.md`](file:///home/fubeo/Files/Progetti/Fub/docs/02-componenti/02-fub-abi.md)
  - **Riga**: 25 (*File chiave del modulo*)
  - **Problema**: Si indica che `crates/fub-abi/src/traits.rs` contiene `FormatProvider`, ma è definito in `crates/fub-abi/src/format.rs`.
  - **Correzione**: Citare `crates/fub-abi/src/format.rs`.

---

## 3. Diagrammi UML e Plugin (`docs/03-uml/`, `docs/04-plugin/`)
*Segnalato da Doc Auditor 3 (`6aa1521b`)*

### `docs/03-uml/01-trait-fub-abi.md`
- **Righe 9–59 (Diagramma Mermaid)**:
  - Metodi disallineati rispetto all'ABI reale (`Plugin::on_job` -> `run_job`, `FormatProvider::render` -> `render_html`, `ViewProvider::render` -> `render_view`, `IndexProvider` metodi differenti, `CommandProvider::execute` -> `invoke`, `EventHandler::on_event` -> `handle`).
  - Relazione errata: `FormatProvider ..> HostApi : usa` (invece `FormatProvider` è un trait di pura computazione CPU senza I/O e senza accesso a `HostApi`).
- **Righe 66, 70, 74**: Riferimenti ai metodi `on_job` -> `run_job`, `render` -> `render_html` e omissione di `render_view`.

### `docs/03-uml/02-sequenza-tasto-pixel.md`
- **Riga 26 (Mermaid) e Riga 41 (Passo 6)**: Riferimento all'evento inesistente `Event::DocumentSaved` invece della variante reale `Event::DocumentChanged`.

### `docs/03-uml/03-componenti-e-dipendenze.md`
- **Riga 72**: Link relativo incompleto `[docs/02-componenti/](../02-componenti)` -> Aggiornare in `[docs/02-componenti/01-panoramica.md](../02-componenti/01-panoramica.md)`.

### `docs/04-plugin/02-il-varco-hostapi.md`
- **Riga 28 (*Capacità HostApi*)**: Metodi errati `read_blob(key)` / `write_blob(key, data)` invece dei metodi effettivi in `DataRead`/`DataWrite`: `data_read(path)` e `data_write(path, data)`.

### `docs/04-plugin/03-i-permessi.md`
- **Riga 9 (Mermaid) e Righe 18–26**: Nomi dei permessi in MAIUSCOLO non conformi al namespace reale in `fub-abi` (`fub:read-vault`, `fub:write-vault`, `fub:network`, `fub:external-fs`, `fub:read-clipboard`, `fub:write-clipboard`, `fub:run-command`).
- **Righe 34–38 (Snippet Rust)**: Tipi ed enum errati (`Capability::WriteDocument` -> `Capability::VaultWrite`, `FubError` -> `PluginError::PermissionDenied`).

### `docs/04-plugin/04-esempio-ping.md`
- **Riga 8**: Refuso «ed demo.ping» (d eufonica davanti a 'd') -> «e demo.ping».

### `docs/04-plugin/05-creare-un-plugin.md`
- **Righe 53–57**: Viene consigliato `world: "fub:abi/plugin-world"` che esporta 11 interfacce mandando in errore di compilazione i plugin guest minimi; è necessario specificare un world minimale locale come in `esempi/ping-wasm/wit/ping.wit`.
- **Righe 60, 62**: Import non utilizzati nell'esempio Rust (`CommandSpec`, `Text`, ecc.).
- **Riga 124**: Link locale senza prefisso uniforme `./` (`04-esempio-ping.md` invece di `./04-esempio-ping.md`).

---

## 4. Disco, Contratto e UI (`docs/05-disco/`, `docs/06-contratto/`, `docs/07-ui/`)
*Segnalato da Doc Auditor 4 (`210703fc`)*

### `docs/05-disco/02-cartella-fub.md`
- **Riga 12, 30, 48**: Descrizione di `workspace.json` come gestore dello stato finestra anziché del sidecar di organizzazione vault (note fissate, ordinamento manuale, icone e spazi); chiarire che `organization.rs` gestisce `workspace.json` e `settings.rs` gestisce `settings.json`.

### `docs/05-disco/03-cestino-e-sidecar.md`
- **Righe 8, 14, 41**: Percorso sidecar del cestino indicato erroneamente come `.trash/<nota>.fub-trash.json` anziché `.fub/data/trash/<nome_file>.json`; il modulo di gestione è `crates/fub-kernel/src/vault.rs` e non `entries.rs`.

### `docs/05-disco/04-risoluzione-link.md`
- **Riga 17, 33**: Viene spiegato che per i wikilink (`[[Appunti]]`) vince la nota più vicina al documento corrente, mentre vince quella più vicina alla radice del vault (`segments(id)` minore, con spareggio lessicografico).

### `docs/05-disco/05-versionamento-e-snapshot.md`
- **Riga 13 (Mermaid)**: Rimozione dell'evento inesistente `DocumentSaved` a favore di `Event::DocumentChanged`.

### `docs/06-contratto/01-i-trait-in-rust.md`
- **Righe 18–53**: Nomi metodi trait non allineati all'ABI (`render_html`, `views`/`render_view`/`interests`, `routes`/`query`/`on_documents_indexed`, `invoke`) e aggiunta descrizione `EventHandler`.

### `docs/06-contratto/02-il-modello-dati.md`
- **Righe 16–18, 29, 37, 39**: Nomi varianti enum disallineati (`Block::Blockquote` -> `Block::Quote`, `Inline::Emphasis` -> `Inline::Emph`, `Inline::Tag` -> `Inline::TagRef`).

### `docs/06-contratto/03-il-contratto-wit.md`
- **Righe 21–30**: Firma WIT di `host-vault-read` disallineata (`id: doc-id` invece di `path: string`, `result<revision, plugin-error>` invece di `result<u64, ...>`).

### `docs/07-ui/02-il-protocollo-ui-node.md`
- **Righe 22, 23, 26**: Citati nodi inesistenti `Card` e `Grid` (sostituire con `Section`, `Tabs`, `Tree`); chiarire che `Intent` è lo stile visivo semantico e non l'azione inviata.

### `docs/07-ui/03-comandi-eventi-ipc.md`
- **Righe 29–51, 59**: Snippet TS/Rust di `write_document` disallineati (parametro `source`, parametro `base: WriteBase`, firma sincrona backend con `State<Host>`, percorso `crates/fub-host/src/bridge.rs`).

### `docs/07-ui/04-temi-e-accessibilita.md`
- **Righe 8–12**: Token CSS generici disallineati rispetto al sistema di design reale (`--doc-bg`, `--bg`, `--bg-chrome`, `--bg-elev`, `--text`, `--muted`, `--accent`, ecc.).

---

## 5. Crate Interni e Archivio (`crates/**`, `docs/archivio/`)
*Segnalato da Doc Auditor 5 (`fe83e8fb`)*

### Crate e WIT
- **`crates/fub-abi/wit/README.md` (Righe 20, 22)**: Due link identici che puntano a `docs/06-contratto/03-il-contratto-wit.md` senza ancore di sezione o rimando alla baseline congelata.
- **`crates/fub-abi/wit/fub/abi.wit` (Righe 6, 14, 318, 2553, 2610)**: Commenti docstring con percorsi obsoleti (`docs/architecture/traits.md`, `docs/architecture/data-model.md`, `docs/architecture/wit-congelato.md`).
- **`crates/fub-app/plan/2026-08-17_ollama-cloud-pi.md`**: File estraneo al progetto Fub (riguardante configurazione CLI personale `pi` e Ollama Cloud). Da rimuovere.

### Archivio (`docs/archivio/`)
- **Link a file di documentazione root (`docs/*.md`)**: Correzione percorsi in `PIANO.md`, `leggimi-prima.md`, `todo.md`, `versionamento.md`, `architecture/shell.md` e ADRs.
- **Errore sistematico di profondità per file in sottocartelle di archivio**: Sostituzione di `../../crates` con `../../../crates` per i file sotto `docs/archivio/architecture/`, `docs/archivio/decisions/` e `docs/archivio/roadmap/`.
- **Incongruenze storiche**: Aggiunta disclaimer storico in `docs/archivio/leggimi-prima.md` e `PIANO.md` e correzione citazione directory in `FEATURES.md`.
