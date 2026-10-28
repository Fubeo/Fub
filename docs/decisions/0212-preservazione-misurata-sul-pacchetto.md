# 0212 — La preservazione di un `.docx` si misura sul pacchetto, e la garanzia è di Fub

- **Stato:** accolta
- **Data:** 2026-10-21
- **Ambito:** storage
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La [0209](0209-videoscrittura-come-proiezione.md) fa modificare un documento di
videoscrittura come proiezione del modello di WordCraft, e la verifica che un
salvataggio si rilegga uguale a ciò che si voleva scrivere. Quella verifica
guarda il modello: un lettore non vede ciò che lui stesso salta. Sui file reali
di Word il codec DOCX perde in silenzio parti del pacchetto che il modello non
rappresenta (nomi delle immagini, contenuti importati, attributi di
impaginazione dell'Asia orientale), e la rilettura del modello passa lo stesso.

La proiezione porta inoltre, dentro le bozze autorevoli, dati opachi: JSON dei
tipi del modello che la shell ricopia senza leggerli. La loro forma cambia con
il motore, e una bozza scritta con una forma più vecchia o più nuova poteva
perdere un campo nel salvataggio senza che nessuno lo vedesse.

## Decisione

- Fub possiede la **garanzia**: il controllo che nessun contenuto si perda e la
  decisione di aprire in sola lettura o di non scrivere. Il controllo non usa
  il motore che sorveglia: `fub-format-rich` legge lo ZIP e l'XML con un
  inventario suo (`inventory.rs`) e lo confronta (`preservation.rs`).
- L'inventario conta elementi e attributi per nome espanso e classe di parte,
  con il valore in forma canonica, il testo di ogni paragrafo, le relazioni
  con la loro destinazione e le parti copiate per impronta. Le sole cose che
  non conta sono le normalizzazioni dichiarate, ciascuna con la sua ragione:
  i segni che Word rigenera a ogni salvataggio.
- **All'apertura** il file si confronta con una riscrittura a vuoto del codec:
  ciò che il codec perderebbe da solo apre il documento in sola lettura
  (motivo `codec`).
- **A ogni salvataggio** i blocchi e le parti che l'utente non ha toccato
  escono identici alla riscrittura a vuoto della base; ciò che ha toccato lo
  verifica la rilettura del modello della 0209, e nei blocchi toccati resta
  ciò che la proiezione non porta. Un salvataggio che non passa non scrive,
  e il testo resta nel buffer.
- Dentro un blocco conta anche **dove**: il controllo legge il corpo come
  flusso di caratteri e oggetti con le loro proprietà, e un segno o una
  proprietà spostati sono una perdita come un elemento sparito.
- I dati opachi hanno uno schema (`OPAQUE_SCHEMA`), che la proiezione v2
  dichiara (`opaque_schema`). Uno schema più nuovo di quello che Fub sa
  leggere si rifiuta con un errore tipizzato e la bozza resta; un dato che,
  decodificato, perderebbe un campo si rifiuta, anche un campo sconosciuto
  vuoto. La superficie serde dei tipi dei dati, letta dai sorgenti, è un
  golden: se cambia con lo stesso schema, lo schema sale, ogni schema
  precedente ha la sua regola di lettura e ogni schema la sua bozza.

## Conseguenze

### Positive

- Una perdita del motore diventa una sola lettura dichiarata, non un file
  rovinato; vale anche per un motore aggiornato, senza fidarsi delle sue note.
- La garanzia non cambia quando cambia la provenienza del motore
  ([0213](0213-provenienza-dei-motori-esterni.md)).
- Le bozze di prima della proiezione v2 si leggono come schema 0.

### Negative

- Più file reali si aprono in sola lettura: quelli in cui il codec
  perde qualcosa, anche un nome d'immagine. Si riduce soltanto correggendo il
  motore.
- Il controllo rilegge il pacchetto all'apertura e a ogni salvataggio; la
  prova a vuoto dell'apertura si ricorda per l'impronta dei byte.
- L'inventario misura ciò che sa contare: un cambiamento d'ordine fra
  elementi uguali, o di significato a valori uguali, gli sfugge.

## Alternative scartate

### Fidarsi del motore

Era il comportamento di prima: la rilettura del modello e i test del motore.
Non vede ciò che il motore salta, e il motore cambia a ogni aggiornamento.

### Un codec DOCX di Fub, come per l'OpenDocument

La [0210](0210-opendocument-con-un-codec-di-fub.md) l'ha fatto per l'ODT, che
è più piccolo. Per OOXML sarebbe molto più costoso, e duplicherebbe il motore
invece di sorvegliarlo.

## Verifica

- `crates/fub-format-rich/src/inventory.rs`, `canonical.rs` e
  `preservation.rs`: i test dell'inventario, delle forme canoniche, delle
  normalizzazioni e delle due regole;
- `crates/fub-format-rich/tests/preservation.rs` e `tests/corpus.rs`: i file
  del corpus all'apertura, alle esportazioni e alle modifiche standard;
- `crates/fub-format-rich/src/blob.rs` e `tests/opaque_schema.rs`: il
  controllo di contenimento, il golden della superficie serde e la bozza di
  ogni schema;
- `crates/fub-host/tests/rich_documents.rs`: una bozza di uno schema futuro
  non si salva e resta;
- `apps/client/src/editors/rich/fixture.test.ts`: la shell ricopia versione
  e schema della proiezione.
