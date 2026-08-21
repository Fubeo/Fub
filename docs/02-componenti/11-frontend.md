# `frontend` — L'interfaccia utente

Per chi è: studenti interessati allo sviluppo web che vogliono scoprire come è costruita la GUI di Fub con TypeScript, Vite e CodeMirror 6.

---

## A cosa serve

La cartella [`frontend`](../../frontend) contiene tutta l'interfaccia utente (la **shell**) eseguita all'interno della webview di Tauri.

Si occupa di:
- Mostrare l'albero dei file e cartelle del vault.
- Fornire l'editor di testo per le note tramite **CodeMirror 6**, con supporto per anteprima live (*live preview*), completamento automatico di link `[[...]]` e tag `#...`.
- Mostrare pannelli laterali (ricerca, struttura/outline, grafico delle note, tag, cestino, cronologia) disegnati tramite il protocollo dichiarativo `UiNode`.
- Gestire temi (chiaro/scuro), scorciatoie da tastiera e finestre di dialogo.

---

## Struttura delle cartelle

- [`frontend/src/editor/`](../../frontend/src/editor): configurazione di CodeMirror, estensioni di sintassi e rendering dell'anteprima.
- [`frontend/src/panels/`](../../frontend/src/panels): i vari pannelli della finestra (es. explorer, search, graph, trash, settings).
- [`frontend/src/ui/`](../../frontend/src/ui): interprete del protocollo `UiNode` (trasforma le descrizioni del backend in componenti del DOM).
- [`frontend/src/state/`](../../frontend/src/state): gestione dello stato reattivo, cronologia di salvataggio e ricezione eventi da Tauri.
- [`frontend/src/host/`](../../frontend/src/host): wrapper tipizzati per le chiamate IPC verso Rust.

---

## Comandi di sviluppo

```bash
cd frontend
npm install       # Installa le dipendenze
npm run typecheck # Controlla la correttezza dei tipi TypeScript
npm test          # Esegue i test di unità con Vitest
npm run build     # Compila l'applicazione per la produzione
```

---

## Se vuoi il dettaglio

- Guarda [`docs/07-ui/01-la-shell-e-il-frontend.md`](../07-ui/01-la-shell-e-il-frontend.md) per l'architettura dettagliata della shell.
- Guarda [`docs/07-ui/02-il-protocollo-ui-node.md`](../07-ui/02-il-protocollo-ui-node.md) per capire come il backend controlla l'interfaccia grafica.
