# Cos'è Fub

Fub è un workspace di scrittura local-first. L'utente sceglie una cartella, Fub
lavora sui file presenti in quella cartella e mantiene separati i dati personali
dalle cache ricostruibili.

Il primo formato supportato è Markdown, con compatibilità per le convenzioni più
comuni dei vault Obsidian. L'architettura, però, non assume che ogni documento
sia Markdown: il kernel vede un modello comune e chiama provider attraverso i
trait definiti in `fub-abi`.

## Cosa offre oggi

| Area | Stato | In pratica |
|---|---|---|
| Vault locale | **Implementato** | Apertura, scansione, watcher e operazioni sui file. |
| Markdown | **Implementato** | Parsing, serializzazione e resa HTML tramite provider dedicato. |
| Ricerca e collegamenti | **Implementato** | Ricerca indicizzata, wikilink, backlink, tag e outline. |
| Interfaccia desktop | **Implementato** | Explorer, editor, anteprima, comandi, impostazioni e grafo. |
| Plugin nativi | **Implementato** | Le funzionalità ufficiali usano gli stessi registri pubblici dei provider. |
| Plugin WASM di terzi | **Parziale** | Runtime e primi adattatori sono presenti; la copertura completa è la milestone M5. |

## Principi

### I file appartengono all'utente

Le note restano leggibili senza Fub. Gli indici e le cache devono poter essere
ricostruiti dai dati autorevoli.

### Il kernel non conosce il formato

`fub-kernel` gestisce workspace, policy, identità, indici ed eventi. Il provider
`fub-format-markdown` è il componente che conosce la sintassi Markdown.

### Un solo contratto di estensione

Provider nativi e componenti WASM devono convergere sugli stessi tipi e trait.
Il runtime non deve creare una seconda architettura parallela.

### La shell resta sottile

Il frontend usa comandi, query e viste registrate. Un comportamento esprimibile
attraverso il contratto comune non riceve un canale IPC speciale.

## Prossimi passi

- Per avviare il progetto: [`02-come-si-avvia.md`](02-come-si-avvia.md).
- Per orientarsi nel codice: [`03-struttura-del-repo.md`](03-struttura-del-repo.md).
- Per lo stato del prodotto: [`../FEATURES.md`](../FEATURES.md).
- Per il piano corrente: [`../PIANO.md`](../PIANO.md).
