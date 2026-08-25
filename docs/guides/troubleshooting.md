# Risoluzione dei problemi

> **Stato:** implementato  
> **Fonte di verità:** comandi di build e workflow CI

## La build Linux non trova WebKitGTK

Installa i pacchetti indicati in [getting-started/install-and-run.md](../getting-started/install-and-run.md). Il nome richiesto da Tauri v2 è `webkit2gtk-4.1`.

## Un test WASM fallisce prima di eseguire il componente

Controlla il target:

```bash
rustup target add wasm32-wasip2
rustup target add wasm32-unknown-unknown
```

`wasm32-wasip2` produce componenti; `wasm32-unknown-unknown` viene usato dal varco che verifica la generazione dei binding.

## `vite build` passa ma TypeScript contiene errori

La build Vite non sostituisce il type-check esplicito:

```bash
cd frontend
npm run typecheck
```

## Il banco visuale è rosso

1. Apri il foglio di contatto prodotto dal banco.
2. Verifica se il cambiamento è voluto.
3. Rigenera le baseline soltanto nell'ambiente Linux canonico.
4. Non correggere un difetto modificando a mano file di tema generati.

## Un documento ha link rotti

```bash
node .github/scripts/check-doc-links.mjs
```

Aggiorna il link alla fonte canonica. Non creare un file di redirect per nascondere il problema.

## Un numero nella prosa è diventato falso

Derivalo dai sorgenti o aggiungi un controllo meccanico nello script documentale appropriato. Non sostituirlo con un altro numero copiato a mano.

## La CI locale e GitHub Actions divergono

```bash
node .github/scripts/check-locale-loop.mjs
```

Il ciclo autorevole è in [CONTRIBUTING.md](../../CONTRIBUTING.md); il workflow deve eseguire gli stessi controlli salvo eccezioni documentate.
