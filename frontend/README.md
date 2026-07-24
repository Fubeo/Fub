# Frontend FubMD

Webview dell'app (Vite + TypeScript + CodeMirror 6). Contiene:

- `src/editor.ts` — editor markdown (CodeMirror 6);
- `src/ui.ts` — renderer del protocollo di **UI dichiarativa** (`UiNode`): lo
  stesso percorso che useranno i plugin (il core descrive, il frontend disegna);
- `src/api.ts` — wrapper tipizzati sui comandi/eventi IPC del backend Rust;
- `src/main.ts` — layout, apertura vault, anteprima, navigazione wikilink, backlink.

Comandi: `npm install`, poi `npm run dev` (porta 1420) o `npm run build` (→ `dist/`,
consumato dal binario Tauri in release).
