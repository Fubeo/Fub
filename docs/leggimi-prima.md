# Leggimi prima

## 1. Cos'è Fub

Fub è un'applicazione per prendere note su una cartella di file `.md`,
compatibile con i vault di Obsidian. Ha un nucleo che non sa cos'è il markdown
e usa dei provider aggiuntivi per insegnarglielo.

## 2. Com'è diviso

I crate in ordine di dipendenza e il frontend:

- **`fub-abi`**: il contratto, che descrive il modello comune di un documento e
  le interfacce per estendere il sistema.
- **`fub-kernel`**: il nucleo che ignora i formati: gestisce i file su disco,
  l'anagrafe dei documenti e gli eventi.
- **`fub-sdk`**: gli strumenti di supporto usati per scrivere i provider.
- **`fub-format-markdown`**: il primo provider nativo che sa leggere e scrivere
  i file markdown.
- **`fub-features`**: le funzionalità ufficiali come la ricerca e i backlink,
  che si appoggiano al contratto come veri plugin.
- **`fub-host`**: il componente che assembla il tutto, coordina la sessione e
  osserva il disco.
- **`fub-app`**: il livello dell'applicazione Tauri, che si occupa delle
  finestre e dei menu del sistema operativo.
- **`fub-testkit`**: il motore usato per testare il kernel variando tutte le
  condizioni possibili in modo combinatorio.
- **`fub-wasm-host`**: l'ambiente per eseguire plugin di terze parti (previsto
  per il traguardo M5).
- **`frontend`**: il codice dell'interfaccia utente.

Chi vuole il disegno vero lo trova in [architecture/mappa-visuale.md](architecture/mappa-visuale.md).

## 3. I quattro documenti che contano

- [decisions/](decisions/README.md): i verbali, spiegano perché una cosa è in un certo modo. C'è un file per decisione e non si riscrivono mai.
- [todo.md](todo.md): l'indice del lavoro aperto. Spiega cosa manca in tre categorie che si contano separatamente.
- [architecture/](architecture/README.md): spiega com'è fatto adesso il progetto.
- [FEATURES.md](FEATURES.md): il catalogo delle funzionalità, spiega dove si vuole arrivare e non dove si è.

## 4. Il dizionario del dialetto

Il [glossario.md](glossario.md) definisce le parole del prodotto. Questa tabella,
invece, definisce le parole del metodo con cui lavoriamo:

| Parola | In italiano normale |
|---|---|
| banco | Un test del codice che varia gli scenari in modo sistematico. |
| buco dichiarato | Un fatto noto ma rinviato sulla forma del contratto. |
| casa | Il punto esatto del codice in cui una regola viene stabilita una sola volta. |
| casella | Un compito esecutivo che resta da fare dopo che le decisioni sono già state prese. |
| difetto | Un problema del codice che si ripara senza dover fare nuove scelte. |
| gemella | Una funzione scritta identica in due linguaggi per verificare che diano lo stesso risultato. |
| gesto | Un'azione base dell'utente, come premere un tasto o fare clic. |
| giro | Una passata completa su un documento o catalogo per rispondere a un'unica domanda. |
| grana | Il livello di dettaglio con cui si misura o si filtra qualcosa. |
| innesco | L'evento osservabile che fa partire un compito quando non c'è una data precisa. |
| lente | La domanda mirata che guida l'esplorazione del codice durante un'analisi. |
| leva | L'importanza di un compito per l'architettura del sistema. |
| P0 / P1 / P2 | La priorità basata sulla scadenza nel ciclo di sviluppo. |
| presidio | Un controllo o test che fallisce per avvisare se una regola del progetto viene violata. |
| residuo | La parte di un compito che non ha bisogno di decisioni e diventa solo lavoro da eseguire. |
| seduta | Un gruppo di decisioni collegate affrontate insieme in un'unica volta. |
| specie | La categoria che classifica il tipo di lavoro da compiere. |
| strato | L'etichetta usata per capire quanto urgentemente va risolto un problema. |
| strozzatura | Il punto in cui l'architettura attuale blocca uno sviluppo futuro. |
| verbale | Il documento che fissa per sempre le motivazioni di una decisione chiusa. |
| voce | Un'unità di lavoro precisa nella pianificazione del progetto. |

## 5. Da dove si comincia

Il ciclo locale di sviluppo per toccare il codice sta in [CONTRIBUTING.md](CONTRIBUTING.md).
