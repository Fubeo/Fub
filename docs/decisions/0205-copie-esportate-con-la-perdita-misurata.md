# 0205 — HTML, testo, LaTeX e Word XML sono copie esportate, con la perdita misurata

- **Stato:** accolta
- **Data:** 2026-10-18
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

WordCraft sa scrivere un documento di videoscrittura in HTML, testo semplice,
LaTeX, RTF, OpenDocument e Word XML (Flat OPC). In Fub `.html`, `.txt`,
`.tex` e `.xml` sono già file di testo che si aprono e si modificano come
sorgente. Aprirli come documenti di videoscrittura significherebbe riscriverli
da un modello che ne porta meno, e cambierebbe come si apre un file che già
funziona.

Gli esportatori di WordCraft non dicono cosa lasciano indietro: la verifica di
compatibilità dell'applicazione guarda soltanto gli oggetti non interpretati.
Una copia che perde note o commenti senza dirlo è una perdita silenziosa.

## Decisione

- Nessuna estensione nuova diventa un documento di videoscrittura. `.html`,
  `.txt`, `.tex` e `.xml` restano file di testo.
- Un documento di videoscrittura si **esporta** in quei formati, e in RTF e
  OpenDocument, dalla porta di export del contratto: `fub-format-rich`
  registra un `ExportProvider` con le destinazioni `rich.copy.*` e il comando
  `rich.export-copy`, che chiede `export.run`. Il bundle `fub.rich` dell'host
  li compone e si spegne come gli altri.
- La copia non tocca il documento. Una copia nello stesso formato del
  documento non si fa.
- Ciò che la copia perde si **misura**: la copia si rilegge con l'importatore
  del suo formato e un inventario (parole, ruoli, enfasi, link, note,
  commenti, parti, oggetti, revisioni) si confronta con quello del documento.
  Ogni diminuzione è un avviso nel giornale dell'export, che l'attività
  mostra. Ciò che l'inventario non misura (impaginazione, caratteri, colori,
  stili) è una nota, e un documento letto da un importatore è un avviso.
- `export.run` è un comando che scrive con portata di sessione: accoda un
  lavoro, e un comando in sola lettura girerebbe come simulazione.

## Conseguenze

### Positive

- I file di testo esistenti si aprono come prima; nessun salvataggio passa da
  un modello che perde.
- La perdita di una copia è un fatto dichiarato con il numero, non una
  supposizione sull'esportatore.
- Nessuna porta né IPC nuova: export, lavori e attività esistevano già.

### Negative

- Un importatore più debole del suo esportatore fa contare come perso ciò che
  la copia porta: l'avviso può dire di più, mai di meno.
- Il confronto non vede la forma del testo, soltanto la sua struttura.
- Una copia in HTML o LaTeX non si riapre come documento di videoscrittura.

## Alternative scartate

### Aprire HTML, testo, LaTeX e XML come documenti di videoscrittura

Dava un editor ricco a quei file, ma li riscriveva dal modello di WordCraft,
perdendo ciò che il loro sorgente porta, e cambiava l'apertura di file che
già si modificano come testo.

### Esportare senza misura, con un avviso fisso per formato

Più semplice, ma un elenco scritto a mano invecchia con gli esportatori e non
dice cosa perde quel documento.

## Verifica

- `crates/fub-format-rich/tests/export.rs`: ogni destinazione si rilegge, il
  documento resta, le perdite si contano per formato, i commenti si stampano
  a richiesta, lo stesso formato si rifiuta, una cartella esporta soltanto i
  documenti di videoscrittura;
- `crates/fub-host/tests/rich_documents.rs`: il comando accoda l'export, il
  file resta, spento il bundle comando e destinazioni spariscono;
- `crates/fub-host/tests/transfer_registry.rs`: `export.run` accoda davvero
  il lavoro;
- `apps/client/src/panels/activity.test.ts`: l'attività mostra il giornale.
