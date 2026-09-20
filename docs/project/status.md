# Stato del progetto

> **Stato aggiornato per `main@94f3f3e17c813b7cee4334f2ad37f35c482487de`, 20 settembre 2026.**

## Baseline corrente

La linea audit è integrata in `main` dalla PR #53; G14 è completo 56/56 e
G15/GO è registrato. Le PR #59 e #60 hanno completato temi installabili,
superfici condivise, guardie permanenti e baseline Grid. La PR #62 ha corretto
il crash WebKitGTK delle Impostazioni; la PR #61 ha reso hard il gate heap
della Graph View.

Le milestone #6, #7, #8, #10, #11, #12, #13, #17 e #56 sono chiuse con
evidenze riferite a codice, test, documentazione e CI.

## Release corrente

Fub non ha ancora pubblicato un tag. Workspace e shell dichiarano `0.1.0`; il
contratto plugin corrente include Grid v1 in ABI/WIT e mirror TypeScript.

Sono presenti:

- vault local-first, revisioni, bozze, cestino e versioning;
- ricerca, link, Graph View, editor e anteprima;
- `DocumentSession` condivisa e `DocumentSurfaceRegistry`;
- formato `.fubsheet`, `GridEngine` e protocollo Grid a finestre/patch;
- temi installabili con contratto `theme-1`;
- runtime WASM, capability, UI non fidata e percorso prodotto installato;
- sincronizzazione fra superfici limitata alla stessa sessione locale.

## Superfici condivise

La shell risolve ogni documento tramite `DocumentSurfaceRegistry`. Una
famiglia registra i profili che può montare; binding di formato/specie e
override non possono inventare profili. Un override non servito prosegue lungo
la catena di fallback.

Grid v1 usa lo stesso contratto per provider nativo e WASM. Il guard
`public_surface_family_delivery` rende incompleta una nuova famiglia ABI finché
non esistono insieme shell, fallback, mirror TypeScript, provider nativo e
percorso WASM. La scena visuale `grid-sheet` esercita il cliente `.fubsheet`
reale attraverso la shell e il fake IPC tipizzato.

Le invarianti permanenti vivono in
[Frontend e IPC](../architecture/frontend-and-ipc.md),
[Editor e anteprima](../product/editor-and-preview.md),
[Runtime dei plugin](../architecture/plugin-runtime.md) e
[ADR 0201](../decisions/0201-superfici-strutturate-a-finestre.md).

## Runtime WASM

M5 è consegnata. Il percorso prodotto distingue installazione, dati persistenti,
consenso, scelta `enabled` e istanza montata. `CommandProvider`,
`FormatProvider`, `ViewProvider` e `GridProvider` attraversano i percorsi
esercitati nativo/WASM.

I limiti non promessi restano espliciti:

- #57 possiede `WASM-002`: `IndexProvider` e `EventHandler` inbound;
- #58 possiede `WASM-003`: quote assolute CPU/RAM di processo oltre i limiti
  per-store e le deadline cooperative.

La pagina [M5](m5-wasm-runtime.md) è una retrospettiva della milestone, non un
piano ancora aperto.

## Graph View

La modularizzazione, il teardown strutturale e i benchmark 2k/10k sono
consegnati. Il gate hard usa la fixture 10k/seed 6 per 16 finestre: dopo otto
finestre di warm-up richiede heap completo, slope della coda non superiore a
65.536 byte per finestra, al massimo sei incrementi monotoni e delta risorse
post-close pari a zero. Due run CI ordinari sullo stesso head hanno certificato
il criterio; #6 e #56 sono chiuse.

## Lavoro residuo

- #5: ripristino atomico degli snapshot del database;
- #9: sincronizzazione distribuita esclusa dalla prima release. L'issue resta
  OPEN come lavoro futuro perché Fub non offre ancora una capacità utente
  distribuita;
- #57 e #58: follow-up WASM esplicitamente differiti.

La decisione su #9 non è un blocker del primo release candidate: non è un test
mancante su una feature già pubblicata, ma lavoro futuro per introdurre una
capacità distribuita. Watcher, catch-up, rejoin e sincronizzazione fra superfici
restano capacità locali e non promettono due repliche, trasporto, convergenza o
assenza di perdita distribuita.

## Fonti

- [Roadmap](roadmap.md)
- [M5 — retrospettiva](m5-wasm-runtime.md)
- [Changelog](../../CHANGELOG.md)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
