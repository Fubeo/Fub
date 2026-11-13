# Orientarsi nella repository

> **Per chi:** chi deve trovare il punto giusto da modificare.
> **Risultato:** passare da un comportamento a crate, modulo e test pertinenti.

## Mappa

La mappa della repository — cartelle, crate, aree e come si provano — è in
[map/repo.md](../map/repo.md); l'indice domanda → pagina di tutta `docs/` è in
[map/pagine.md](../map/pagine.md).

## Dove modificare cosa

| Obiettivo | Punto di partenza |
|---|---|
| aggiungere o cambiare un tipo condiviso | `crates/fub-abi/src/` |
| cambiare il modello del documento | `crates/fub-abi/src/model.rs` |
| cambiare una firma che attraversa WASM | `crates/fub-abi/wit/fub/abi.wit` |
| cambiare workspace, path, storage o indici | `crates/fub-kernel/src/` |
| cambiare mount, sessioni, job o impostazioni | `crates/fub-host/src/` |
| aggiungere un comando Tauri o adattare IPC | `crates/fub-app/src/lib.rs` |
| cambiare parsing o rendering Markdown | `crates/fub-format-markdown/src/` |
| cambiare ricerca, grafo o feature ufficiali | `crates/fub-features/src/` |
| cambiare il runtime dei componenti | `crates/fub-wasm-host/src/` |
| cambiare editor, pannelli o tema | `apps/client/src/` |
| testare un provider in memoria | `crates/fub-sdk/` |
| testare host e kernel insieme | `crates/fub-testkit/` |

## I crate

I 25 crate con la responsabilità di ciascuno sono nella tabella delle aree in
[map/repo.md](../map/repo.md#le-aree-una-riga-ciascuna).

## Flusso per tipo di modifica

### Una nuova capacità del prodotto

1. definisci il comportamento osservabile;
2. usa un trait o un registro esistente;
3. implementa il provider nel crate proprietario;
4. monta il provider in `fub-host`;
5. esponi soltanto l'adattamento necessario in `fub-app`;
6. usa il seam `apps/client/src/host/` nella shell;
7. aggiungi test al livello più basso e un'integrazione sul flusso.

### Un nuovo formato

1. riusa il modello comune o motiva l'estensione;
2. implementa `FormatProvider` fuori dal kernel;
3. registra estensioni e capacità;
4. verifica parse, render, serializzazione e trasferimento;
5. evita rami `if markdown` nel core.

### Un nuovo plugin WASM

Parti da [`development/plugin-authoring.md`](../development/plugin-authoring.md)
e dagli esempi in `esempi/`.

## Confini da ricordare

- il kernel non importa Tauri, Wasmtime o Markdown;
- l'host non importa Tauri;
- Wasmtime resta in `fub-wasm-host`;
- i tipi condivisi non nascono nel frontend;
- una feature ufficiale può essere spenta senza rompere il workspace;
- il codice di test non entra nelle dipendenze normali.

Il grafo completo è in
[`architecture/components-and-boundaries.md`](../architecture/components-and-boundaries.md).
Le mappe di orientamento — il disegno d'insieme, la tabella di chi possiede
ogni regola e l'indice «dove sta X» — stanno in
[`map/repo.md`](../map/repo.md), [`map/ownership.md`](../map/ownership.md) e
[`map/dove-sta-x.md`](../map/dove-sta-x.md).
