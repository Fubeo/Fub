# frontend/

La webview dell'app: Vite + TypeScript + CodeMirror 6.

**La documentazione di questa cartella sta in `docs/`**, e non qui: la mappa dei
moduli e le regole che li tengono separati sono in
[`docs/02-componenti/11-frontend.md`](../docs/02-componenti/11-frontend.md).
L'architettura della shell è in
[`docs/07-ui/01-la-shell-e-il-frontend.md`](../docs/07-ui/01-la-shell-e-il-frontend.md),
mentre il protocollo con cui il backend descrive una vista è in
[`docs/07-ui/02-il-protocollo-ui-node.md`](../docs/07-ui/02-il-protocollo-ui-node.md).

Questo file resta volutamente breve: una seconda descrizione completa del
frontend diventerebbe una seconda fonte da mantenere.

```bash
npm ci
npm run dev    # server Vite sulla porta 1420
npm run build  # produce dist/, consumata dall'app Tauri
```

L'avvio dell'app desktop completa è nel [README della radice](../README.md).
