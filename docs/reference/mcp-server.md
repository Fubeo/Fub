# Server MCP

> **Ambito:** il server MCP di `fub-cli` (`fub-cli mcp`): trasporto, strumenti,
> risorse, radici dell'automazione e regole di scrittura.
> **Fonti autorevoli:** `crates/fub-cli/src/mcp.rs`,
> `crates/fub-cli/src/mcp/tools.rs`, `crates/fub-cli/src/mcp/access.rs`,
> `crates/fub-cli/src/componenti.rs` e le prove in
> `crates/fub-cli/tests/mcp.rs`.

Un agente usa Fub come usa le app Craft: cerca, legge, collega, scrive e
invoca comandi, senza mai sovrascrivere il lavoro di qualcun altro. Il server
è un altro modo di arrivare alle chiamate che la CLI fa già: apre il vault con
la stessa `Connection` e, se l'app desktop tiene il vault, passa da lei col
canale di controllo (vedi [Permessi e sicurezza](permissions-and-security.md)).
Il perché delle scelte sta nell'ADR
[0232](../decisions/0232-il-server-mcp-di-fub.md).

```json
{
  "mcpServers": {
    "fub": {
      "command": "fub-cli",
      "args": ["mcp", "--vault", "/home/tu/Studio",
               "--automation-read-root", "/home/tu/Studio",
               "--automation-write-root", "/home/tu/Studio/Agente"]
    }
  }
}
```

## Trasporto

- stdio, JSON-RPC 2.0, un messaggio per riga; niente lotti;
- versioni del protocollo: `2025-11-25`, `2025-06-18`, `2025-03-26` e
  `2024-11-05`. Il server risponde con quella del client se la parla,
  altrimenti con la più nuova;
- capacità: `tools` e `resources`. Le notifiche del client non hanno
  risposta;
- il server risponde in ordine, una richiesta alla volta, e finisce quando
  stdin si chiude. Tiene il vault aperto finché vive, col watcher acceso.

| Errore | Codice |
|---|---|
| riga che non è JSON | `-32700` |
| richiesta che non è un oggetto, o senza `method` | `-32600` |
| metodo sconosciuto | `-32601` |
| strumento sconosciuto, `arguments` che non è un oggetto, risorsa non valida | `-32602` |
| errore dell'host leggendo una risorsa | `-32603` |

L'errore di uno strumento non è un errore JSON-RPC: torna come risultato con
`isError: true` e un testo `specie: messaggio`, dove la specie è quella della
CLI (`bad_args`, `not_found`, `denied`, `conflict`, `unavailable`, `local`).

## Strumenti

| Strumento | Che cosa fa | Chiamata dell'host | Scrive |
|---|---|---|---|
| `fub_search` | ricerca nel testo, con la sintassi della barra; `tag` e `folder` in AND | `query_index(Documents)` | no |
| `fub_query` | una chiave fra `backlinks`, `neighbors`, `tag` (le note col tag), `tags` (l'elenco) e `resolve` | `Backlinks`, `Neighbors`, `Documents`, `Tags`, `Resolve` | no |
| `fub_read` | testo e revisione | `read_document` | no |
| `fub_read_model` | il modello strutturato | `read_model` | no |
| `fub_write` | riscrive da una revisione | `write_document(DescendsFrom)` | sì |
| `fub_create` | nota nuova, con un testo o da un modello | `note.create`, `note.from_template` | sì |
| `fub_commands` | i comandi, con argomenti e se scrivono | `commands` | no |
| `fub_invoke` | esegue un comando, in prova se non si chiede `apply` | `invoke_user_command` | con `apply` |
| `fub_components` | i componenti: acceso o spento, perché (`core`, `chosen`, `required`, `off`), nome e chi lo richiede | `query_index(Settings)` | no |
| `fub_components_why` | perché `id` è acceso, o che è spento | `query_index(Settings)` | no |
| `fub_components_enable` | accende `id` e ciò senza cui non funziona, in prova se non si chiede `apply` | `set_plugin_enabled` | con `apply` |
| `fub_components_disable` | spegne `id`; `also_dependents` spegne anche chi lo richiede, `orphans` (`"remove"` o `"keep"`) decide di ciò che non serve più; in prova se non si chiede `apply` | `set_plugin_enabled` | con `apply` |

Ogni risultato riuscito porta i dati due volte: in `structuredContent` e,
come testo JSON, nel primo elemento di `content`. Gli elenchi sono a pagine:
`limit` da 1 a 200, 50 per difetto, e `offset`; la risposta dice `total`.

## Risorse

Le note del vault sono risorse con l'URI di apertura di Fub,
`fub://open?note=<path>`, a pagine da 100 (`cursor` è l'offset). `resources/read`
legge l'URI con lo stesso parser di `fub://`: traversal e chiavi ignote sono
rifiutati.

## Radici dell'automazione

Gli stessi flag delle app Craft, ripetibili:

- `--automation-write-root DIR`: si scrive soltanto sotto queste cartelle.
  Senza, il server è in sola lettura e ogni strumento che scrive risponde
  `denied`;
- `--automation-read-root DIR`: si legge soltanto sotto queste cartelle e
  sotto quelle di scrittura. Senza, si legge tutto il vault.

Una radice che contiene il vault lo copre intero; una fuori dal vault non
copre niente; una che non esiste ferma l'avvio. Le note fuori dalle radici di
lettura non compaiono nella ricerca, fra i backlink, fra i vicini, fra le
risorse, né come bersaglio di un link risolto.

## Regole di scrittura

- `fub_write` vuole la `base`, cioè la revisione letta con `fub_read`. Non
  c'è una scrittura senza base: una revisione superata torna come
  `conflict`, e l'agente rilegge e riprova. Nessun byte si perde.
- `fub_create` non sovrascrive: un nome già preso è un `conflict`. Il nome
  (estensione e cartella comprese) lo sceglie `note.create`; con un testo la
  nota nasce già scritta, in un passo solo, così anche una lavagna `.canvas`
  nasce valida.
- `fub_invoke` senza `"apply": true` restituisce il piano e non scrive.
  Con `apply`, un comando che scrive si esegue soltanto se tutte le note del
  suo piano stanno sotto le radici di scrittura; un comando che non dice
  quali note tocca si esegue soltanto se si scrive in tutto il vault.
  Con radici di lettura più strette del vault, `fub_invoke` è rifiutato,
  perché un comando raggiunge il vault intero.
- I componenti seguono le regole di `fub-cli componenti`: lo stato è
  `plugins.disabled`, chi è acceso lo decide la mappa dei componenti, e si
  scrive soltanto per i bundle. Senza `"apply": true` accendere e spegnere
  restituiscono l'effetto (`also_enabled`, `also_disabled`, `orphans`,
  `writes`) e non cambiano niente. Con `apply` vogliono tutto il vault
  fra le radici di scrittura, come un comando che non dice quali note tocca:
  un componente cambia il comportamento del vault intero. Con una radice più
  stretta la risposta è `denied`.
  Il nucleo (`fub.core`, `fub.maintenance`, `fub.markdown`) non si spegne
  (`denied`); un componente che altri richiedono è un `conflict` che li
  nomina; un id che la mappa non ha è `not_found`.
- Le cancellazioni passano dai comandi (`note.trash`) e vanno nel cestino,
  come dall'interfaccia.
- I messaggi d'errore passano dalla stessa redazione della CLI, e il server
  non scrive log.

## Non ancora

`fub_open_with` (aprire un file in un'app Craft) e gli strumenti della
lavagna (`fub_canvas_*`) arrivano coi comandi che li servono. Finché non ci
sono, una lavagna si scrive come file `.canvas` con `fub_create` e
`fub_write`.
