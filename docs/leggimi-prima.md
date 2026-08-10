# Leggimi prima

## 1. Cos'è Fub

Fub è un'applicazione per prendere note su una cartella di file `.md`, compatibile con i vault di Obsidian. Ha un nucleo che non sa cos'è il markdown e usa dei provider aggiuntivi per insegnarglielo.

## 2. Com'è diviso

I crate in ordine di dipendenza e il frontend:

- **`fub-abi`**: contratto: modello documento comune + tutti i trait (+ arena: la forma dei tipi AL CONFINE e le conversioni)
- **`fub-kernel`**: core agnostico: vault, grafo link, registry, event bus
- **`fub-sdk`**: helper per scrivere provider (scan #tag / [[wikilink]])
- **`fub-format-markdown`**: 1° FormatProvider nativo (comrak)
- **`fub-features`**: feature ufficiali (backlink, ricerca full-text, versioning) NON dipende dal kernel: solo dal contratto, come un plugin
- **`fub-host`**: chi MONTA: tabella delle feature, sessione, watcher dietro un trait, ponte eventi. NON dipende da tauri
- **`fub-app`**: colla Tauri v2: IPC comandi/eventi, finestre, dialoghi
- **`fub-testkit`**: banco di prova del KERNEL: Banco, un builder sui cinque assi che i test variano davvero. Crate a sé e non fub-sdk::testing, che è il banco dei PROVIDER (0055)
- **`fub-wasm-host`**: (M5) host wasmtime per plugin di terzi
- **`frontend`**: il codice dell'interfaccia utente.

Chi vuole il disegno vero lo trova in [architecture/mappa-visuale.md](architecture/mappa-visuale.md).

## 3. I quattro documenti che contano

- [decisions/](decisions/README.md): i verbali, spiegano perché una cosa è in un certo modo. C'è un file per decisione e non si riscrivono mai.
- [todo.md](todo.md): l'indice del lavoro aperto. Spiega cosa manca in tre categorie che si contano separatamente.
- [architecture/](architecture/README.md): spiega com'è fatto adesso il progetto.
- [FEATURES.md](FEATURES.md): il catalogo delle funzionalità, spiega dove si vuole arrivare e non dove si è.

## 4. Il dizionario del dialetto

Questa tabella è una scorciatoia per la prima lettura. La sede vera delle definizioni è [glossario.md](glossario.md).

| Parola | In italiano normale |
|---|---|
| banco | Un test del codice che varia gli scenari in modo sistematico. |
| casa | Il punto esatto del codice in cui una regola viene stabilita una sola volta. |
| casella | Un compito esecutivo che resta da fare dopo che le decisioni sono già state prese. |
| difetto | Un problema del codice che si ripara senza dover fare nuove scelte. |
| gemella | Una funzione scritta identica in due linguaggi per verificare che diano lo stesso risultato. |
| gesto | Un'azione base dell'utente, come premere un tasto o fare clic. |
| grana | Il livello di dettaglio con cui si misura o si filtra qualcosa. |
| innesco | L'evento osservabile che fa partire un compito quando non c'è una data precisa. |
| lente | La domanda mirata che guida l'esplorazione del codice durante un'analisi. |
| presidio | Un controllo o test che fallisce per avvisare se una regola del progetto viene violata. |
| residuo | La parte di un compito che non ha bisogno di decisioni e diventa solo lavoro da eseguire. |
| seduta | Un gruppo di decisioni collegate affrontate insieme in un'unica volta. |
| specie | La categoria che classifica il tipo di lavoro da compiere. |
| verbale | Il documento che fissa per sempre le motivazioni di una decisione chiusa. |
| voce | Un'unità di lavoro precisa nella pianificazione del progetto. |

## 5. Da dove si comincia

Il ciclo locale di sviluppo per toccare il codice sta in [CONTRIBUTING.md](CONTRIBUTING.md).
