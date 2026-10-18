# Documenti di Word

> **Per chi:** chi scrive documenti di Word in un vault e chi modifica la loro
> superficie.
> **Risultato:** sapere cosa si modifica in un `.docx`, cosa resta nel file,
> quando un documento si apre soltanto in lettura, cosa si modifica in un
> `.odt`, come si leggono `.rtf` e `.doc` e come se ne esporta una copia.

Un `.docx` si apre in una superficie di scrittura, con la stessa carta, la
stessa barra di formattazione, le stesse scorciatoie e lo stesso correttore
delle note. Si salva nel file stesso, senza conversioni e senza copie a lato.

Si modificano:

- il testo, con a-capo, tabulazioni e salti di pagina (`Ctrl+Invio`) o di
  colonna (`Ctrl+Maiusc+Invio`), anche dal gruppo **Inserisci** della striscia;
- i link: `Ctrl+K` o il pulsante della striscia chiedono l'indirizzo (web o
  posta) e lo mettono sulla selezione, sul link al cursore o, senza
  selezione, su un testo nuovo; dallo stesso modulo un link si toglie;
- grassetto, corsivo, barrato ed evidenziato dalla barra;
- l'aspetto del carattere dalla striscia sopra il foglio: tipo e
  dimensione (anche a passi, `Ctrl+]` e `Ctrl+[`), colore del testo, colore
  dell'evidenziatore, sottolineato (`Ctrl+U`), apice (`Ctrl+Maiusc+=`), pedice
  (`Ctrl+=`), tutto maiuscolo (`Ctrl+Maiusc+A`) e maiuscoletto
  (`Ctrl+Maiusc+K`). **Copia formato** prende l'aspetto del punto in cui sta
  il cursore e lo dà alla prossima selezione, una volta; Esc lo lascia.
  Un valore uguale a quello del paragrafo non si scrive: il tratto torna a
  seguire il suo stile;
- lo stile del paragrafo: testo, titoli da 1 a 6, citazione e, dalla
  striscia, gli stili di paragrafo che il documento propone o usa;
- il paragrafo, dalla stessa striscia: allineamento a sinistra (`Ctrl+L`),
  centrato, a destra (`Ctrl+R`) e giustificato (`Ctrl+J`); rientro sinistro a
  passi di mezzo pollice (`Ctrl+M`, `Ctrl+Maiusc+M`); interlinea singola,
  1,5 e doppia (`Ctrl+1`, `Ctrl+5`, `Ctrl+2`) o 1,15, 2,5 e tripla; rientri,
  prima riga e spazi prima e dopo in punti. Un campo vuoto torna al valore
  dello stile, e come per il carattere un valore uguale a quello dello stile
  non si scrive;
- elenchi puntati e numerati su nove livelli;
- le tabelle: una nuova dal pulsante **Tabella** della striscia, scegliendo
  righe e colonne sulla griglia (col mouse o con le frecce), dopo il paragrafo
  del cursore o al posto di uno vuoto; è la griglia di Word, a tutta riga, a
  colonne uguali e con i bordi (anche **Inserisci tabella** della barra, 2 × 2).
  Righe e colonne si aggiungono, si spostano e si tolgono dal menu tabella
  della barra o con le scorciatoie della tabella Markdown; una colonna nuova
  copia le proprietà delle celle accanto e la griglia si rifà alla larghezza
  di prima, nelle proporzioni delle colonne. Dalla striscia le celle che la
  selezione tocca in una riga si uniscono (i loro paragrafi, tranne i vuoti,
  vanno nella prima) e una cella unita si divide;
- le immagini e le note nuove, dal gruppo **Inserisci** della striscia:
  **Immagine** sceglie un PNG, un JPEG o un GIF del vault (fino a 16 MB) e lo
  mette al cursore, nel testo, alla sua misura (un pixel CSS è tre quarti di
  punto) ridotta se serve alla colonna di una pagina Letter; **Nota** chiede il
  testo, una riga, e se va a piè di pagina o in chiusura, e la scrive con gli
  stili delle note di Word.

Dal gruppo **Revisione** della striscia:

- **Trova e sostituisci** (`Ctrl+H`; `Ctrl+F` resta la ricerca nella nota
  della shell) mostra nel testo le occorrenze mentre si scrive, con maiuscole
  e minuscole o soltanto parole intere; Invio va alla prossima, Maiusc+Invio
  alla precedente. Un'occorrenza sta dentro un paragrafo e non scavalca un
  oggetto o un segno (l'inizio di un commento, un segnalibro). Il testo nuovo
  prende l'aspetto del primo carattere sostituito, e **Sostituisci tutto** è
  una battuta sola, che si annulla in una volta;
- **Conteggio parole** dice parole, caratteri con e senza spazi e paragrafi
  del documento e, se c'è, della selezione: una parola è ciò che sta fra due
  spazi, un oggetto separa senza contare, il testo delle note non conta;
- le **revisioni tracciate** di un `.docx` si vedono: il testo inserito
  sottolineato, quello eliminato barrato, un segno di paragrafo inserito o
  eliminato come `¶`, con autore e data al passaggio del puntatore. In un
  documento che ne ha, la striscia le scorre (precedente, successiva) e le
  **accetta** o **rifiuta**, una alla volta (quella del cursore o quelle
  della selezione) o tutte insieme. Tratti vicini con la stessa revisione
  sono una modifica sola, e i due capi di uno spostamento vanno insieme.
  Accettare un segno di paragrafo eliminato, o rifiutarne uno inserito,
  unisce il paragrafo al seguente, che gli dà le sue proprietà. Ciò che si
  scrive dentro o accanto a una revisione non ne fa parte.

Il resto del documento (le altre proprietà dei paragrafi e dei tratti, la
definizione degli stili, sezioni,
intestazioni, immagini, forme, campi, note, formule, commenti) resta nel file
così com'è. Un oggetto si vede come una casella con il suo nome o il suo testo
alternativo; la fine di una sezione è un filo doppio che non si cancella con un
Backspace.

Un documento si apre **soltanto in lettura**, con il motivo in testa, quando
ha modifiche di formato tracciate o revisioni fuori dal corpo (note,
intestazioni, piè di pagina, commenti, caselle di testo), registra le
modifiche, è protetto, oppure quando la
superficie o il codec non saprebbero riscriverlo identico. Un documento cifrato
o più grande di 256 MiB non si apre. Un salvataggio che non si rilegge uguale a
ciò che si voleva scrivere non scrive, e il testo resta nel buffer.

Limiti attuali:

- le immagini del file non si disegnano: si vede soltanto un'immagine appena
  inserita, finché il documento resta aperto; un oggetto non si modifica dalla
  superficie, e il testo di una nota esistente non si cambia;
- una nota nuova è testo semplice su una riga, senza formattazione; copiata e
  incollata, è una seconda nota con lo stesso testo;
- l'interlinea «almeno» ed «esattamente» si mostra e si conserva, ma dalla
  striscia si sceglie soltanto un multiplo; rientri, spazi e interlinea che
  vengono dallo stile non si disegnano (il foglio usa quelli del tema), e un
  campo vuoto della spaziatura non dice quanto valgono;
- un carattere che la macchina non ha si mostra con uno di ripiego, ma nel
  file resta quello scelto; in un `.docx` l'evidenziatore ha soltanto i sedici
  colori di Word;
- un link porta soltanto a un indirizzo web, di posta o a un segnalibro
  già nel documento;
- le colonne si aggiungono, si spostano e si tolgono soltanto in una tabella
  le cui righe hanno tutte le stesse celle, senza celle unite in larghezza;
  le celle si uniscono soltanto in larghezza, e una cella unita in altezza si
  mostra come una cella per riga;
- con le revisioni registrate (`track_changes`) il documento resta in sola
  lettura: una modifica fatta qui non diventerebbe una revisione;
- un elenco numerato mostra sempre numeri arabi, qualunque sia la numerazione
  del documento, che resta quella del file;
- il codec riscrive il file in forma propria: rinumera intestazioni, piè di
  pagina, note e caselle di testo, fonde le impostazioni che genera con quelle
  originali e toglie le immagini che il testo non mostra più. Il contenuto non
  cambia, ma il file salvato non è identico byte per byte.

## OpenDocument

Un `.odt` si apre nella stessa superficie e si modifica come un `.docx`, con
gli stessi limiti; un salto di pagina o di colonna però non si scrive, e una
tabella nuova ha una colonna per cella della riga più lunga e celle con un
bordo sottile (lo stile automatico `FubC…`). Le colonne si aggiungono o si
tolgono soltanto in una tabella con le colonne tutte uguali, e le celle si
uniscono o si dividono soltanto in una tabella senza celle unite in altezza;
altrimenti il salvataggio lo rifiuta e il testo resta nel buffer. Il
salvataggio riscrive soltanto i blocchi toccati: il resto di `content.xml` e
ogni altra parte del pacchetto (immagini, impostazioni, metadati) restano byte
per byte com'erano. Un ruolo, un'enfasi, un aspetto del carattere o una
disposizione del paragrafo nuovi aggiungono gli stili automatici che servono
(`FubP…`, `FubT…`, `FubL…`) e, se mancano, gli stili comuni dei titoli e della
citazione, senza toccare gli altri. Le lunghezze nuove si scrivono in punti. Le revisioni tracciate di un `.odt`
non si scrivono: un testo che ne porta (incollato da un `.docx`) non si
salva.

Oltre ai motivi del `.docx`, un `.odt` si apre **in sola lettura** quando la
superficie non saprebbe riscriverlo identico, per esempio con due elenchi uguali
uno dopo l'altro. Uno che il codec non sa rappresentare (voci d'elenco vuote,
righe ripetute, commenti XML dentro un paragrafo) si legge con l'importatore di
WordCraft, come un `.rtf`. Una nota, un segnalibro o un commento non si
incollano due volte: il salvataggio lo rifiuta. Un'immagine nuova entra in
`Pictures/` col nome dei suoi byte (`fub-….png`) e nel manifesto, e una nota
nuova prende lo stile `Footnote` o `Endnote` del documento, se c'è.

## RTF e Word 97-2003

Un `.rtf`, un `.doc` o un `.dot` si aprono nella stessa superficie, sempre **in
sola lettura**: si leggono, si cercano, compaiono nell'outline e passano dal
correttore. Li legge un importatore di WordCraft, che porta testo, titoli,
enfasi, elenchi, tabelle e link e lascia indietro il resto (note, commenti,
caselle di testo, forme, gran parte degli stili). Riscrivere il file da lì
perderebbe ciò che l'importatore non ha letto, quindi la superficie lo dice in
testa e non scrive; un file nuovo di questi formati non si crea.

Un `.doc` si legge per la sua firma: un `.docx` o un RTF rinominati si aprono
come tali, sempre in sola lettura. Un `.doc` cifrato con una password non si
apre.

## Esportare una copia

**Esporta una copia** (`rich.export-copy`, dalla palette) scrive un documento
di videoscrittura in HTML, testo semplice, LaTeX, RTF, OpenDocument o Word XML
(un `.docx` in un file XML solo, Flat OPC), con gli esportatori di WordCraft.
Il documento non si tocca: la copia arriva nell'attività e si salva dove si
vuole. Una copia nello stesso formato del documento (un `.rtf` in RTF, un
`.odt` in OpenDocument) non si fa: sarebbe il file riscritto da un modello che
ne porta meno.

Accanto alla copia l'attività dice **cosa non porta**. La copia si rilegge con
l'importatore del suo formato e si confronta con il documento: parole, titoli,
voci d'elenco, tabelle, link, enfasi, note, commenti, intestazioni e piè di
pagina, immagini, grafici, forme, equazioni, campi, segnalibri, revisioni e
oggetti non interpretati. Ciò che manca o diminuisce è un avviso, con il
numero. Impaginazione, caratteri, colori e stili dei paragrafi non si misurano,
e l'avviso lo dice. Un documento letto da un importatore (`.rtf`, `.doc`,
`.odt`) parte già da meno del file, e anche questo è un avviso. In HTML e nel
testo semplice i commenti si possono mettere in fondo alla copia.

`.html`, `.txt`, `.tex` e `.xml` restano file di testo: si aprono e si
modificano come sorgente, anche quando sono nati da una copia.

## Dove si trova

- `crates/fub-format-rich/`: codec e importatori, provider e proiezione
  modificabile; `src/odt/` è il codec OpenDocument, `src/export.rs`
  l'esportazione delle copie e la misura di ciò che perdono.
- `crates/fub-host/src/rich.rs`: la composizione alle porte dei documenti.
- `apps/client/src/editors/rich/`: la superficie.
- `vendor/wordcraft/`: modello, codec e importatori di WordCraft, con
  provenienza e licenza in `UPSTREAM.md`.

Il disegno del confine è in
[Superficie ricca e correttore](../architecture/rich-surface-and-proofing.md#documenti-di-videoscrittura-la-superficie-ricca),
la forma alle porte nel [contratto IPC](../reference/ipc-contract.md#documenti-di-videoscrittura)
e il perché nelle decisioni [0209](../decisions/0209-videoscrittura-come-proiezione.md),
[0210](../decisions/0210-opendocument-con-un-codec-di-fub.md) e
[0211](../decisions/0211-copie-esportate-con-la-perdita-misurata.md).
