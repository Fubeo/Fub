# Trait del contratto `fub-abi`

## Panoramica

In Fub, tutto ciò che non è il nucleo di base (il motore dei file) è un **provider**, cioè un componente che implementa uno o più **trait** (interfacce) definiti nel crate [`crates/fub-abi`](../../crates/fub-abi/src/traits.rs).

Un trait in Rust è come un contratto: stabilisce quali funzioni un componente deve fornire, senza specificare come sono implementate internamente.

```mermaid
classDiagram
    class Plugin {
        +manifest() PluginManifest
        +activate(host) Result
        +deactivate(host) Result
        +run_job(job, payload, host) Result
    }

    class FormatProvider {
        +descriptor() FormatDescriptor
        +capabilities() FormatCapabilities
        +parse(source, ctx) Result
        +render_html(model, opts) Result
        +serialize(model) Result
    }

    class ViewProvider {
        +views() Vec~ViewSpec~
        +interests(instance) ViewInterests
        +render_view(instance, read_api) Result
        +on_action(instance, action, host) Result
    }

    class IndexProvider {
        +routes() Vec~QueryRoute~
        +query(query) Result
        +on_documents_indexed(docs) Vec~IndexLoss~
    }

    class CommandProvider {
        +commands() Vec~CommandSpec~
        +invoke(command, args, host) Result
    }

    class EventHandler {
        +subscribed() EventMask
        +handle(notice, host) Result
    }

    class HostApi {
        +read_document(doc_id)
        +write_document(doc_id, text, base)
        +query_index(query)
        +emit(event)
        +setting(key)
    }

    Plugin ..> HostApi : usa
    ViewProvider ..> HostApi : usa
    IndexProvider ..> HostApi : usa
    CommandProvider ..> HostApi : usa
    EventHandler ..> HostApi : usa
```

---

## I trait spiegati uno per uno

### 1. `Plugin`
Rappresenta il ciclo di vita di un modulo. Dice al sistema chi è il plugin (`manifest`), cosa fare quando viene avviato (`activate`) o spento (`deactivate`), e come gestire operazioni asincrone in background (`run_job`).
- File sorgente: [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs)

### 2. `FormatProvider`
Insegna a Fub a comprendere un formato di file (per esempio il Markdown). Trasforma il testo grezzo in una struttura ad albero (`DocumentModel`), converte il modello in HTML per l'anteprima (`render_html`), e lo risalva su disco (`serialize`). È una funzione pura su CPU e non compie I/O diretto (non riceve né dipende da `HostApi`).
- File sorgente: [`crates/fub-abi/src/format.rs`](../../crates/fub-abi/src/format.rs)

### 3. `ViewProvider`
Disegna un pannello dell'interfaccia utente (come l'albero dei file, il grafico dei link o la ricerca) tramite `render_view` (operazione pura in sola lettura via `ReadApi`), restituendo un albero di componenti grafici dichiarativi (`UiNode`) senza dover scrivere codice HTML direttamente. Gestisce le interazioni dell'utente tramite `on_action`.
- File sorgente: [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs)

### 4. `IndexProvider`
Risponde a interrogazioni sui dati del vault (per esempio "trova tutte le note con il tag `#scuola`" o "cerca la parola *algoritmo*") dichiarando le proprie rotte (`routes`) ed eseguendo le query.
- File sorgente: [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs)

### 5. `CommandProvider`
Aggiunge comandi eseguibili dall'utente (`commands`) ed eseguiti tramite `invoke` (per esempio tramite la tastiera o un menu dei comandi).
- File sorgente: [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs)

### 6. `EventHandler`
Riceve e reagisce alle notifiche del bus eventi del sistema (`handle`) per le categorie sottoscritte (`subscribed`).
- File sorgente: [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs)

### 7. `HostApi`
È il punto di accesso unico attraverso cui i provider interagiscono con il resto del programma: leggere un file, fare una ricerca, registrare un log o inviare una notifica.

---

## Se vuoi il dettaglio

- Guarda il file [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs) per l'elenco completo delle definizioni in Rust.
- Guarda [`docs/06-contratto/01-i-trait-in-rust.md`](../06-contratto/01-i-trait-in-rust.md) per approfondire come questi trait vengono implementati.
- Guarda [`docs/03-uml/05-mappa-visuale.md`](./05-mappa-visuale.md) per la mappa visuale complessiva dell'architettura e dei flussi dati.
