# 0204 — L'inchiostro è un componente di sistema, non di un prodotto

- **Stato:** proposta
- **Data:** 2026-10-17
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Le [superfici spaziali](0203-superfici-spaziali.md) hanno dato a Fub un editor
di disegni, FubDraw, con la penna. Nei suoi primi cicli l'input della penna
(ruoli del puntatore, palmo, pressione, eventi coalescenti e predetti, annullo
del tratto) e le ricette di penna, evidenziatore e gomma vivevano nell'editor,
accanto alla scena che scrive.

Un secondo prodotto che raccoglie inchiostro avrebbe dovuto copiare tutto o
dipendere da FubDraw. Nessuna delle due strade regge: la copia diverge al primo
caso limite risolto da una parte sola, e la dipendenza porta con sé un editor
intero in un componente che deve restare piccolo. Il lavoro sul PDF, dove la
copia sarebbe nata, è sospeso.

I vincoli che contano:

- il percorso caldo gira a ogni evento del puntatore: niente IPC né WASM per
  battuta, e il client non ha una toolchain WASM;
- un componente WASM non ottiene DOM o filesystem per implicazione e deve
  osservare la stessa semantica del codice nativo: le regole dell'inchiostro
  devono poter diventare un giorno un componente, senza cambiare forma;
- il workspace Rust è su 1.89, edizione 2021;
- il codice di terzi esaminato per l'inchiostro richiede edizione 2024 e
  Rust 1.90 o più.

## Decisione

Obbligatorio:

1. **Il nucleo è doppio, Rust fa fede.** `crates/fub-ink` è la copia che fa
   fede; `apps/client/src/ink/` è la copia per il percorso caldo. Le due sono
   legate da una fixture generata e da un test gemello. Una regola cambia in
   Rust e si rigenera la fixture; non si cambia da un lato solo.
2. **`fub-ink` non dipende da niente** e compila per `wasm32-wasip2`. Chi può
   dipenderne è un elenco chiuso, che ora contiene `fub-scene`. Aggiungere un cliente
   è una decisione: si scrive qui e poi nell'elenco di
   `dependency_invariant.rs`.
3. **`apps/client/src/ink/` non conosce i prodotti.** Importa soltanto se stesso,
   `perfect-freehand` e, dal solo adattatore del browser, `ui/lifetime`. Niente
   editor, shell, stato, `@tauri-apps`, `@codemirror` né un modulo il cui nome
   dica PDF. Il nucleo non usa globali del DOM.
4. **Lo strumento è dati e funzioni pure.** Un id stabile, le capacità e la
   ricetta del tratto; nessuna scena, camera o formato dentro. Gli strumenti si
   registrano in un registro con disposer.
5. **Penna, evidenziatore e gomma sono un pacchetto di sistema.** `INK_TOOLS` è
   in sola lettura e registrato all'avvio. Non è un plugin installabile e non
   compare come tale. Il contratto è però scritto perché possa un giorno
   stare dietro un componente.
6. **Il prodotto possiede la sua parte.** Livello di destinazione, id, annullo,
   annunci per lo screen reader e formato della scena restano del prodotto.
   La barra del prodotto può avere un registro di presentazione, con gli stessi
   id degli strumenti di sistema e un test che li lega.
7. **Il riuso ha un ordine**: dipendenza diretta, estrazione, adattamento,
   codice nuovo. Il codice derivato conserva l'avviso di copyright e la
   licenza che l'originale chiede, in `THIRD_PARTY_NOTICES.md`.
8. **Nessun prodotto ha una penna propria.** Il lavoro sul PDF (modifica,
   annotazione, oscuramento, stampa) è sospeso: niente profili, modalità o
   rotte di inchiostro in più. Riaprirlo richiede una nuova decisione.

Come conseguenza possibile, non decisa qui: separare gli strumenti in un
componente a tempo di esecuzione. Servirebbe la stessa semantica nativa e WASM,
limiti di tempo e memoria e un fallback.

## Conseguenze

### Positive

- un secondo prodotto dell'inchiostro usa penna, gomma e input senza copiarli;
- le regole del puntatore si provano senza browser, in Rust e in TypeScript,
  con le stesse risposte;
- il confine è presidiato da test che leggono i sorgenti, non dalla memoria di
  chi ricorda la regola;
- l'adattamento dello stabilizzatore rispetta la licenza dell'originale.

### Negative

- due copie del nucleo da tenere uguali: il costo è la fixture generata e il
  test gemello, e ogni regola si scrive due volte;
- l'anteprima incrementale (`ink/pf1-live.ts`) ripete gli interni di
  perfect-freehand 1.2.3, non soltanto la sua interfaccia: la versione è
  fissata, e cambiarla chiede che la prova di uguaglianza a ogni prefisso resti
  verde;
- di un tratto lungo l'anteprima paga ancora, a ogni movimento, la copia del
  poligono e il suo riempimento sul canvas;
- lo stabilizzatore è nel nucleo ma FubDraw non lo espone ancora;
- l'adattatore del browser costa poco più del precedente per evento; il banco
  misura il percorso, senza imporre un tempo.

## Alternative scartate

### Solo TypeScript, senza nucleo Rust

Evita la doppia copia. Si scarta perché le regole del puntatore non
avrebbero una fonte portabile né un percorso verso un componente, e il banco
di prova resterebbe legato a un browser.

### Solo Rust, chiamato dal client

Nessuna copia da mantenere. Si scarta perché ogni evento attraverserebbe IPC o
WASM, che le regole del frontend escludono per il percorso caldo, e il client
non ha la toolchain.

### Dipendere da crate di terzi

Riuso massimo. Si scarta perché la toolchain non coincide e perché il solo
pezzo utile, lo stabilizzatore, vive in un crate di pittura raster. Si
riesamina se la toolchain di Fub si alza.

### Penna come plugin WASM installabile da subito

Separabilità immediata. Si scarta perché serve un attraversamento per
campione o per tratto, limiti di tempo e memoria, e un fallback; nessun caso
reale li ha ancora dimostrati. Il contratto degli strumenti non lo impedisce.

### Lasciare l'inchiostro in FubDraw ed estrarlo quando serve un secondo prodotto

Meno lavoro subito. Si scarta perché la prima copia nascerebbe nel prodotto
nuovo, con le sue varianti, e l'estrazione successiva dovrebbe riconciliarle.

## Verifica

- `cargo test -p fub-abi --test dependency_invariant`: `fub-ink` senza
  dipendenze e con i soli clienti ammessi;
- compilazione di `fub-ink` per `wasm32-wasip2` nella CI;
- `cargo test -p fub-ink --test ts_mirror` e `ink/mirror.test.ts`: le due
  copie rispondono uguale;
- `ink/pf1-live.test.ts` e `ink/tools/stroke.test.ts`: l'anteprima
  incrementale dà, a ogni prefisso e per ogni pennello provato, il contorno di
  `getStroke`;
- `ink/boundary.test.ts`: import ammessi, nucleo senza DOM, nessun prodotto;
- `tools/ink-tools.test.ts`: barra di FubDraw e pacchetto di sistema hanno gli
  stessi id;
- `check-listeners.mjs`: ogni ascoltatore dell'adattatore ha owner e disposer;
- [architettura dell'inchiostro](../architecture/ink-and-tools.md) per la
  spiegazione dei livelli e per i banchi (`cargo bench -p fub-ink`,
  `npm run bench:ink`).
