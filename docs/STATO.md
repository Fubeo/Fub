# Stato del progetto

Questa pagina è la fotografia sintetica della versione presente nel repository. Non sostituisce i test o i manifest: li rende leggibili.

## Versione e distribuzione

- versione del workspace e dell'app: `0.1.0`;
- versione del contratto WIT vivo: `0.1.1`;
- nessun rilascio pubblico e nessun installer ufficiale;
- il codice deve essere compilato dalla repository.

## Base implementata

Sono presenti e collegati:

- applicazione desktop Tauri e shell TypeScript;
- apertura di vault locali e gestione del loro stato;
- provider Markdown;
- kernel agnostico rispetto al formato;
- composition root separato dalla UI;
- contratto Rust e WIT con test di conformità e additività;
- runtime WASM nel crate dedicato e componenti di prova;
- indici, comandi, viste dichiarative, lavori lunghi ed eventi;
- persistenza versionata per stato, bozze, registri e dati delle funzionalità;
- controlli multi-piattaforma, supply-chain, documentazione, resa visuale e accessibilità.

## Bundle ufficiali presenti nell'inventario

L'inventario di `fub-features` registra questi bundle:

- ricerca;
- versioning;
- backlink;
- struttura;
- tag;
- proprietà;
- template;
- query;
- dashboard;
- backup;
- statistiche;
- cestino;
- grafo;
- comandi;
- blocchi.

La presenza nell'inventario prova che il bundle è parte della build ufficiale; non implica che ogni requisito elencato in [`features/`](features/README.md) sia già completo.

## Frontend

La shell comprende editor, anteprima, esplora file, ricerca, apertura rapida, grafo, impostazioni, attività e renderer delle viste dichiarative. TypeScript, test, build, listener globali, corse concorrenti, confronto visuale e accessibilità sono controllati dalla CI.

Il documento sulle [superfici di editing condivise](frontend/05-superfici-di-editing-condivise.md) è un piano tecnico. Le famiglie generiche per celle, formule, rich text e canvas non sono ancora una nuova API pubblica del contratto.

## Plugin e WASM

Il WIT vivo, le baseline congelate, il varco compilabile e il runtime dedicato esistono. Il percorso completo per installare, distribuire e supportare plugin di terzi non è ancora una superficie pubblica stabile.

## Lavoro aperto

Le attività tecniche realmente aperte sono in [`todo.md`](todo.md). Le milestone e la roadmap spiegano l'ordine e le dipendenze del lavoro; le specifiche di prodotto restano separate.

## Fonti di verità

| Domanda | Fonte |
|---|---|
| quali crate esistono e da cosa dipendono | `Cargo.toml` e i manifest dei crate |
| quali bundle ufficiali esistono | `crates/fub-features/src/inventory.rs` |
| qual è il contratto WASM | `crates/fub-abi/wit/fub/abi.wit` |
| quali comandi verifica la CI | `.github/workflows/ci.yml` |
| quali attività sono aperte | `docs/todo.md` |
| perché è stata presa una decisione | `docs/decisions/` |