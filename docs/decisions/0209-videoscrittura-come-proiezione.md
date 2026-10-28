# 0209 — I documenti di videoscrittura si modificano come proiezione

- **Stato:** accolta
- **Data:** 2026-10-18
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Fub apre i vault senza convertire i file. Un `.docx` è un pacchetto ZIP di XML
il cui modello (paragrafi con proprietà, stili, sezioni, oggetti, note,
revisioni) non ha una forma testuale che l'utente scriva a mano, e che nessun
editor di testo della shell sa mostrare. WordCraft ha già un modello del
documento e un codec DOCX in Rust, con licenza `MIT OR Apache-2.0`, ma non una
superficie che la shell possa riusare: la sua interfaccia è un'app propria.

Tre vincoli restringono la scelta: nessuna IPC o WASM per battuta; il Markdown
non deve dipendere da niente di Word; un file dell'utente non deve perdere in
silenzio ciò che l'editor non sa mostrare. Il codec, poi, non riscrive il file
byte per byte: rinumera parti, fonde impostazioni e toglie immagini non
mostrate.

## Decisione

1. Il modello e il codec di WordCraft sono vendorizzati (`vendor/wordcraft/`,
   con provenienza in `UPSTREAM.md`) e li usa soltanto `fub-format-rich`, che
   l'host monta con la feature `rich`. `fub-abi` e `fub-kernel` non li
   conoscono; per il kernel un `.docx` è un formato a byte con un modello
   comune per ricerca, outline e anteprima.
2. La shell modifica una **proiezione**: JSON chiuso e versionato
   (`fub-rich`, versione 1) che mostra in chiaro testo, enfasi, link, ruolo dei
   paragrafi, tabelle e oggetti, e porta il resto come dati opachi **attaccati
   a ogni nodo**, non come indici in una tabella del documento.
3. La proiezione passa dalle porte dei documenti esistenti: `read_document`
   la restituisce con la revisione dei byte, `write_document` la riporta ai
   byte partendo dal file a quella revisione e scrive con lo stesso CAS. La
   sessione documento, le bozze e i conflitti restano quelli di ogni testo.
4. Aprire verifica due andate e ritorni (proiezione → documento, documento →
   byte → documento) a meno delle normalizzazioni dichiarate del codec,
   ciascuna con la propria prova. Se una fallisce, o se il documento ha
   revisioni, registra le modifiche o è protetto, si apre in sola lettura con
   il motivo. Salvare rilegge ciò che sta per scrivere e non scrive se non è il
   documento voluto.
5. La superficie è una famiglia propria della shell (`rich`, ProseMirror,
   caricata in un chunk separato) che riusa `EditorSurface`, le azioni
   dell'editor con gli id esistenti e il client del correttore. I comandi
   stanno nella barra multifunzione del kit (`kit/ribbon/`), la stessa del
   foglio di calcolo, con le schede di Word: la superficie la dichiara
   (`ownBar`) e la barra di formattazione della shell non si mostra sopra; la
   bolla della selezione e l'intento `fub.editor.action` restano.

## Conseguenze

### Positive

- Nessuna porta IPC nuova: salvataggio, bozze, conflitti e annullamento
  funzionano come per le note, e una battuta resta locale.
- I dati non mostrati non possono diventare vecchi: dopo un salvataggio la
  shell tiene il proprio buffer, e un nodo che porta i propri dati non dipende
  da una tabella ricostruita dal file nuovo. Un tratto incollato porta la
  propria formattazione.
- Un documento che non si saprebbe riscrivere si legge comunque.
- Il formato è additivo: ODT, RTF e gli altri formati della famiglia sono altri
  codec della stessa proiezione e della stessa superficie. Un formato che
  WordCraft sa soltanto importare (RTF, Word 97-2003) entra subito, in sola
  lettura con il motivo `import`, finché un codec che lo riscrive identico non
  lo rende modificabile, come l'OpenDocument
  ([0210](0210-opendocument-con-un-codec-di-fub.md)).

### Negative

- La proiezione intera attraversa l'IPC a ogni lettura e salvataggio, ed è più
  grande del testo visibile per via dei dati opachi.
- Il file salvato non è identico byte per byte all'originale anche quando il
  contenuto lo è.
- La superficie scrive soltanto ciò che la proiezione v1 rende esplicito;
  il resto (oggetti, link, colonne) si modifica con un'altra applicazione.

## Alternative scartate

### Convertire il `.docx` in Markdown

Riusa l'editor esistente, ma perde struttura e proprietà a ogni salvataggio e
contraddice l'apertura senza conversione.

### Una porta IPC o una sessione strutturata dedicata

Il modello a finestre e patch della [0201](0201-superfici-strutturate-a-finestre.md)
serve a un foglio la cui risposta cresce con le celle valutate. Un documento di
prosa si mostra intero e cambia per paragrafi; una porta nuova duplicherebbe
salvataggio, bozze e conflitti senza un caso che lo richieda.

### Dati opachi come indici in una tabella del documento

Più compatta, ma dopo il primo salvataggio la tabella ricostruita dal file
nuovo ha indici diversi da quelli del buffer della shell, e un incolla fra
documenti prenderebbe la formattazione di un indice omonimo.

## Verifica

- `crates/fub-format-rich/tests/`: andate e ritorni, normalizzazioni del
  codec che non chiudono il documento, sola lettura per revisioni e per note
  duplicate, rifiuto delle proiezioni malformate o che nominano oggetti che il
  documento non ha, `importers.rs` per RTF e Word 97-2003 in sola
  lettura, e `ts_projection.rs` che lega la fixture della shell al codec nei
  due versi e i motivi di sola lettura alla lista della shell;
- `crates/fub-host/tests/rich_documents.rs`: lettura, scrittura, CAS, sola
  lettura ed errori tipizzati alle porte esistenti;
- `apps/client/src/editors/rich/*.test.ts`: proiezione invariata senza
  modifiche, azioni, cronologia, incolla e ciclo di vita della superficie;
- `cargo tree -p fub-kernel` e `-p fub-abi` senza `wordcraft-*`;
  `cargo test -p fub-abi --test dependency_invariant`.
