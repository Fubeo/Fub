# Leggimi prima

## 1. Cos'è Fub

Fub è un'applicazione per prendere note su una cartella di file `.md`. È
compatibile con i vault di Obsidian. Il suo nucleo gestisce dati generici e usa
provider esterni per imparare il markdown.

## 2. Com'è diviso

I crate in ordine di dipendenza e il frontend:

- **`fub-abi`**: il contratto. Definisce il modello del documento e le
  interfacce per estendere il sistema.
- **`fub-kernel`**: il motore sui file. Gestisce il disco, l'anagrafe dei
  documenti e gli eventi.
- **`fub-sdk`**: gli strumenti per scrivere i provider.
- **`fub-format-markdown`**: il primo provider nativo. Legge e scrive i file
  markdown.
- **`fub-features`**: le funzioni ufficiali come ricerca e backlink. Usano il
  contratto come veri plugin.
- **`fub-host`**: il coordinatore. Assembla i pezzi e osserva il disco.
- **`fub-app`**: l'app Tauri. Comandi ed eventi IPC, finestre, dialoghi.
- **`fub-testkit`**: il banco del lato host. Monta un vault vero sul kernel vero
  e dice quali eventi sono usciti. Serve solo ai test.
- **`fub-wasm-host`**: l'ambiente per i plugin di terzi. **Non esiste ancora**:
  arriverà con `M5`.
- **`frontend`**: l'interfaccia utente.

Il disegno d'insieme è in
[architecture/mappa-visuale.md](architecture/mappa-visuale.md).

## 3. I quattro documenti che contano

- [decisions/](decisions/README.md): i verbali. Spiegano perché un sistema è
  fatto così. Ogni file è unico; il contenuto è immutabile, ma la forma si può
  riscrivere per chiarezza.
- [todo.md](todo.md): l'indice del lavoro. Mostra cosa manca, in **tre**
  categorie con conteggi separati.
- [architecture/](architecture/README.md): il funzionamento attuale. Spiega
  com'è fatto il progetto adesso.
- [FEATURES.md](FEATURES.md): il catalogo. Elenca dove vogliamo arrivare.

## 4. Il dizionario del dialetto

Le parole del prodotto (lotto, porta, ponte, anagrafe, sidecar, superficie,
revisione, ricongiungimento) sono definite in una riga dove si usano, in
[PIANO.md](PIANO.md) e in
[architecture/mappa-visuale.md](architecture/mappa-visuale.md). Questa tabella
definisce le parole del metodo interno:

| Parola | In italiano normale |
|---|---|
| banco | Un test sistematico su vari scenari. |
| buco dichiarato | Un compromesso accettato sul contratto, scritto per non dimenticarlo. |
| casa | Il posto unico dove una regola vive nel codice. |
| casella | Lavoro da eseguire senza prendere nuove decisioni. |
| difetto | Un errore che ripariamo senza fare nuove scelte. |
| gemella | Una funzione duplicata in due linguaggi per verificare risultati identici. |
| gesto | Un'azione base dell'utente (es. un clic). |
| giro | Una passata completa su un documento per rispondere a una domanda. |
| grana | Il livello di dettaglio per misurare o filtrare. |
| innesco | L'evento che avvia un compito. |
| lente | La domanda mirata che guida un'analisi del codice. |
| leva | L'importanza di un lavoro per l'architettura. |
| P0 / P1 / P2 | La priorità di una scadenza. |
| presidio | Un controllo automatico (es. script) che fallisce per proteggere una regola. |
| residuo | La parte esecutiva di un compito dopo aver deciso tutto. |
| seduta | Un gruppo di decisioni affrontate insieme. |
| specie | La categoria del lavoro da fare. |
| strato | Un'etichetta per l'urgenza di un problema. |
| strozzatura | Un blocco nell'architettura attuale. |
| verbale | Un documento storico per una decisione definitiva. |
| voce | Un'unità di lavoro pianificata. |

## 5. Da dove si comincia

Il ciclo locale di sviluppo è in [CONTRIBUTING.md](CONTRIBUTING.md).
