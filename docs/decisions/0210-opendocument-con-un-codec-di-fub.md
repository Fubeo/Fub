# 0210 — Un OpenDocument si scrive con un codec di Fub che conserva l'XML

- **Stato:** accolta
- **Data:** 2026-10-18
- **Ambito:** storage
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

La [0209](0209-videoscrittura-come-proiezione.md) apre ogni formato di
videoscrittura come proiezione e lo rende modificabile soltanto quando un codec
lo riscrive senza perdere ciò che la superficie non mostra. Per l'OpenDocument
WordCraft ha un importatore e un esportatore che passano dal suo modello: il
modello lascia indietro note, commenti, caselle di testo, forme e gran parte
degli stili, e l'esportatore riscrive il pacchetto da capo. Un `.odt` salvato
così perderebbe quel contenuto in silenzio.

Un `.odt` reale (LibreOffice, moduli compilati) è fatto quasi tutto di ciò che
quel modello non porta, ma il testo che si scrive sta in paragrafi, titoli,
elenchi e tabelle di `content.xml`, con stili che rimandano per nome.

## Decisione

- Un `.odt` si apre e si salva con un codec di `fub-format-rich`
  (`src/odt/`) che legge `content.xml` in un albero che conserva le posizioni
  dei byte e costruisce la proiezione direttamente da lì, senza il modello di
  WordCraft.
- Ogni nodo della proiezione porta nel proprio `k` i tag originali che lo
  contengono (paragrafo, livelli d'elenco, involucri del testo, oggetti interi,
  tabella, riga, cella), mai un indice nel file.
- Salvare riusa i byte originali di ogni unità che non è cambiata, rigenera
  soltanto i blocchi toccati, aggiunge gli stili automatici o comuni che
  servono a un ruolo o a un'enfasi nuovi e copia grezze, nello stesso ordine,
  tutte le altre voci del pacchetto. Il risultato si rilegge e si confronta con
  ciò che si voleva scrivere; se non coincide non si scrive.
- Aprire prova che la rigenerazione di ogni blocco rilegge identico ciò che il
  file mostra; se no la proiezione esce con `projection`. Ciò che il lettore
  non sa rappresentare (voci d'elenco vuote, righe ripetute, contenitori
  sconosciuti di paragrafi, commenti XML dentro un paragrafo) apre con
  l'importatore di WordCraft, in sola lettura con `import`.
- Revisioni tracciate, registrazione delle modifiche, sezioni protette e
  pacchetti cifrati seguono le stesse specie del codec Word.
- L'importatore resta il lettore di `FormatProvider::parse` (indice, outline,
  anteprima). `Codec::write` continua a non scrivere un `.odt` da un modello.

## Conseguenze

### Positive

- Un `.odt` reale diventa modificabile e un salvataggio cambia soltanto le
  righe toccate: il diff del file resta leggibile e ciò che Fub non conosce
  arriva nel file nuovo byte per byte.
- La superficie, la proiezione e le porte restano quelle della 0209: nessun
  campo, motivo di sola lettura o IPC nuovo.
- Il codec non dipende dal modello di WordCraft: un limite di quel modello non
  diventa un limite di scrittura.

### Negative

- Fub possiede un secondo lettore di OpenDocument, accanto all'importatore, e
  i due possono vedere lo stesso file in modo diverso.
- Un oggetto che non si ripete (nota, segnalibro, commento) non si incolla due
  volte: il salvataggio lo rifiuta invece di duplicarne il nome.
- Le righe di una tabella con celle unite su più righe non si spostano.

## Alternative scartate

### Usare l'esportatore di WordCraft

Riusa codice esistente, ma riscrive il pacchetto dal modello e perde tutto ciò
che l'importatore non ha letto: contraddice la regola di nessuna perdita.

### Estendere il modello di WordCraft finché porta tutto

Richiederebbe di rappresentare ogni elemento di ODF in un modello pensato per
Word, e di farlo crescere in `vendor/` come patch locale. Il codec di Fub tiene
i byte che non capisce invece di doverli modellare.

### Convertire l'`.odt` in `.docx` per scriverlo

Cambia il formato del file dell'utente: è una conversione, non un'apertura.

## Verifica

- `crates/fub-format-rich/tests/odt.rs`: ruoli, enfasi e oggetti letti; un
  salvataggio invariato non scrive; una modifica tocca soltanto il suo
  paragrafo e le altre voci del pacchetto restano identiche; spazi, titoli,
  citazioni, elenchi, tabelle, oggetti ripetuti o estranei, sezioni, sola
  lettura per specie, ritorno all'importatore e documento nuovo;
- i test unitari in `crates/fub-format-rich/src/odt/` per albero XML,
  pacchetto e chiavi;
- `crates/fub-host/tests/rich_documents.rs`: un `.odt` si scrive e si crea
  dalle porte esistenti, e uno che il codec non rappresenta resta in sola
  lettura con `host.rich.readonly.import`.
