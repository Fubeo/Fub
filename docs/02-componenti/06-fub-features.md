# `fub-features` — le funzionalità ufficiali

[`crates/fub-features/`](../../crates/fub-features) contiene i bundle ufficiali
implementati contro i trait di `fub-abi`. Il crate non dipende dal kernel in
produzione: riceve ciò che gli serve attraverso `HostApi` e i registri comuni.

## Inventario autorevole

[`src/inventory.rs`](../../crates/fub-features/src/inventory.rs) è la fonte che
dichiara quali bundle esistono, il loro identificativo, i cataloghi delle
stringhe e i costruttori generici di viste e comandi. `fub-host` itera questo
inventario durante il montaggio.

Alcuni bundle richiedono collegamenti specifici che non entrano nella forma
generica della tabella. Ricerca, versioning e blocchi vengono completati in
`fub-host/src/mount.rs`; non esiste un secondo inventario concorrente.

## Bundle ufficiali

| Bundle | Superfici principali | Nota |
|---|---|---|
| `search` | `IndexProvider` | Apre e mantiene l'indice Tantivy; il montaggio è specifico dell'host. |
| `versioning` | vista, comandi e gestione degli eventi | Mostra la cronologia e permette il ripristino; store e handler sono collegati dall'host. |
| `backlinks` | vista | Mostra i collegamenti in entrata verso il documento attivo. |
| `outline` | vista | Espone la struttura dei titoli del documento. |
| `tags` | vista | Esplora tag e documenti associati. |
| `properties` | vista e comandi | Legge e modifica le proprietà del frontmatter. |
| `template` | vista e comandi | Gestisce le superfici dedicate ai modelli di documento. |
| `queries` | vista e comandi | Espone query strutturate e relative azioni. |
| `dashboard` | vista | Riassume informazioni e accessi del vault. |
| `backup` | vista e comandi | Espone le operazioni di backup previste dal bundle. |
| `trash` | vista | Mostra il cestino; le azioni usano comandi forniti dal bundle `commands`. |
| `graph` | vista | Produce la vista dichiarativa del grafo dei documenti. |
| `stats` | vista | Calcola e mostra statistiche del documento o del vault. |
| `commands` | `CommandProvider` | Registra i comandi di base usati dalla shell e da altri bundle. |
| `blocks` | regole sintattiche e renderer | Viene montato con registrazioni specifiche, senza una vista o un provider di comandi. |

## Cargo feature

Ogni bundle ha una Cargo feature con lo stesso nome. La configurazione
predefinita abilita tutti i bundle; una build mirata può disabilitarli senza
lasciare nell'inventario una voce non compilata.

`search` porta la dipendenza opzionale da Tantivy. `properties` porta
`serde_yaml_ng`. `trash` abilita anche `commands`, perché i pulsanti del
cestino invocano comandi registrati da quel bundle.

## Invarianti

- `fub-features` non dipende da `fub-kernel` come libreria di produzione;
- l'inventario stabilisce quali bundle esistono e in quale ordine vengono montati;
- le build parziali devono eliminare sia il modulo sia la relativa voce;
- i test con il kernel usano soltanto dipendenze di sviluppo;
- una nuova funzionalità attraversa il contratto comune invece di ottenere un canale privato verso la shell.

La differenza fra bundle nativi e componenti di terzi è spiegata in
[`../04-plugin/01-nativo-vs-wasm.md`](../04-plugin/01-nativo-vs-wasm.md).
