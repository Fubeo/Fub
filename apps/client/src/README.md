# `src/` — la shell del client

Una riga per cartella di primo livello. La mappa completa con aree e prove è in
[`docs/map/repo.md`](../../../docs/map/repo.md); il grafo dei crate in
[`docs/architecture/overview.md`](../../../docs/architecture/overview.md).

## Cartelle

- `editors/` — un editor per formato: `base`, `core` (bootstrap e registro
  delle superfici), `text` (CodeMirror), `rich`, `grid`, `canvas`, `spatial`,
  `craft`, `media`.
- `__fixtures__/` — dati di prova condivisi dai test (mirror JSON, fixture
  import/annotazioni/ink).
- `shells/` — le shell: `desktop/`, `mobile/` e `scrittoio/` (cornice,
  lanciatore, fogli, preferenze).
- `ui/` — logica di interfaccia non primitiva: menu, comandi, dialoghi, icone,
  a11y, fuzzy.
- `theme/` — tema e contrasto: colori adattati, `contrast.ts`, font,
  test per alto contrasto.
- `state/` — stato del vault aperto: componenti accesi, segnalibri, store
  della shell.
- `panels/` — i pannelli: rail, explorer, ricerca, grafo, impostazioni,
  cestino, barra del formato…
- `ink/` — inchiostro lato client: pennelli, input (pointer, pressione,
  stabilizzatore), adattatore DOM.
- `kit/` — le primitive: button, dialog, field, popover, tabs, splitter,
  tool-rail. Niente stato globale, niente host.
- `graph/` — Graph View 2.0: motore a forze, pittore, interazione.
- `host/` — l'unica cucitura verso Tauri: `ipc.ts`, `contract.ts`,
  `dialog.ts` e l'host finto dei test.
- `moto/` — i motori del movimento: keyframe, easing, gesti, livelli.
- `rules/` — regole del vault lato shell, gemelle di quelle Rust.
- `tabella/` — la Tabella come astrazione indipendente dall'editor.
- `i18n/` — stringhe e regole di localizzazione.
- `platform/` — capacità della piattaforma, clipboard, confirm, selettore
  del vault.
- `avvio/` — la logica TypeScript dello strato d'avvio (vedi sotto).
- `scrittura/` — Scrittura, il nucleo del testo ricco (ProseMirror).
- `perf/` — le sonde delle prestazioni (N0).
- `entrypoints/` — gli ingressi: desktop e mobile.
- `spatial/` — la camera 2D del mondo (matematica pura, niente DOM).

## File in radice

`main.ts` (entry Vite), `desktop-shell.ts` (montaggio della shell),
`test-setup.ts`, i test e2e `*.e2e.test.ts`.

## Le coppie che confondono

- `kit/` vs `ui/`: `kit/` sono le primitive (niente stato globale né host);
  `ui/` è la logica di interfaccia della shell costruita sopra il kit.
- `tabella/` vs `editors/grid/`: `tabella/` è l'astrazione «tabella»
  (selezione, comandi, clipboard); `editors/grid/` è l'editor del foglio di
  calcolo con il motore GridCraft.
- `scrittura/` vs `editors/rich/`: `scrittura/` è il livello Scrittura
  (vista ProseMirror, marche, font); `editors/rich/` è l'implementazione
  dell'editor ricco/documentale.
- `spatial/` vs `editors/spatial/`: `spatial/camera.ts` è la camera 2D pura;
  `editors/spatial/` è l'editor della lavagna FubDraw.
- `src/avvio/` vs `public/avvio/`: `public/avvio/` è lo strato statico caricato
  in `<head>` prima di ogni JS (valido anche senza JS); `src/avvio/` è la
  logica che a runtime consegna quello strato all'app.
