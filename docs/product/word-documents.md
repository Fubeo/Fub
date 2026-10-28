# Documenti di Word

> **Per chi:** chi scrive documenti di Word in un vault e chi modifica la loro
> superficie.
> **Risultato:** sapere cosa si modifica in un `.docx`, cosa resta nel file,
> quando un documento si apre soltanto in lettura, cosa si modifica in un
> `.odt`, come si leggono `.rtf` e `.doc` e come se ne esporta una copia.

Un `.docx` si apre in una superficie di scrittura, con la stessa carta, le
stesse scorciatoie e lo stesso correttore delle note. Si salva nel file
stesso, senza conversioni e senza copie a lato.

I comandi stanno nella barra multifunzione sopra il foglio, come in Word: le
schede **Home**, **Inserisci**, **Layout**, **Revisione** e **Visualizza**, e
**Tabella** quando il cursore sta in una tabella; **Annulla** e **Ripeti**
accanto alle schede. Alt o F10 mostrano le lettere di ogni scheda e di ogni
comando, `Ctrl+F1` ritira la barra e la riapre; ritirata, una scheda scelta
si apre per un gesto. Stretta, la barra raccoglie prima Modifica, Stili e
Paragrafo in un pulsante ciascuno. Un comando che adesso non si dà resta al
suo posto, spento, e il suggerimento dice perché.

Si modificano:

- il testo, con a-capo, tabulazioni e salti di pagina (`Ctrl+Invio`) o di
  colonna (`Ctrl+Maiusc+Invio`), anche dalla scheda **Inserisci**;
- i link: `Ctrl+K` o **Collegamento** in **Inserisci** chiedono l'indirizzo (web o
  posta) e lo mettono sulla selezione, sul link al cursore o, senza
  selezione, su un testo nuovo; dallo stesso modulo un link si toglie;
- grassetto, corsivo e barrato dal gruppo **Carattere** di **Home**;
- l'aspetto del carattere dallo stesso gruppo: tipo e
  dimensione (anche a passi, `Ctrl+]` e `Ctrl+[`), colore del testo, colore
  dell'evidenziatore, sottolineato (`Ctrl+U`), apice (`Ctrl+Maiusc+=`), pedice
  (`Ctrl+=`), tutto maiuscolo (`Ctrl+Maiusc+A`) e maiuscoletto
  (`Ctrl+Maiusc+K`). **Copia formato** prende l'aspetto del punto in cui sta
  il cursore e lo dà alla prossima selezione, una volta; Esc lo lascia.
  Un valore uguale a quello del paragrafo non si scrive: il tratto torna a
  seguire il suo stile;
- lo stile del paragrafo: testo, titoli da 1 a 6, citazione e, dalla
  galleria **Stili** di **Home**, che scrive ogni nome nel carattere del
  documento, gli stili di paragrafo che il documento propone o usa;
- il paragrafo, dal gruppo **Paragrafo** di **Home** (le spaziature anche da
  **Layout**): allineamento a sinistra (`Ctrl+L`),
  centrato, a destra (`Ctrl+R`) e giustificato (`Ctrl+J`); rientro sinistro a
  passi di mezzo pollice (`Ctrl+M`, `Ctrl+Maiusc+M`); interlinea singola,
  1,5 e doppia (`Ctrl+1`, `Ctrl+5`, `Ctrl+2`) o 1,15, 2,5 e tripla; rientri,
  prima riga e spazi prima e dopo in punti. Un campo vuoto torna al valore
  dello stile, e come per il carattere un valore uguale a quello dello stile
  non si scrive;
- elenchi puntati e numerati su nove livelli;
- le tabelle: una nuova dal pulsante **Tabella** di **Inserisci**, scegliendo
  righe e colonne sulla griglia (col mouse o con le frecce), dopo il paragrafo
  del cursore o al posto di uno vuoto; è la griglia di Word, a tutta riga, a
  colonne uguali e con i bordi.
  Righe e colonne si aggiungono, si spostano e si tolgono dalla scheda
  **Tabella** o con le scorciatoie della tabella Markdown; una colonna nuova
  copia le proprietà delle celle accanto e la griglia si rifà alla larghezza
  di prima, nelle proporzioni delle colonne. Dalla scheda **Tabella** le celle che la
  selezione tocca in una riga si uniscono (i loro paragrafi, tranne i vuoti,
  vanno nella prima) e una cella unita si divide.
  Tab e Maiusc+Tab vanno alla cella dopo e prima, col suo testo scelto, e
  Tab nell'ultima cella aggiunge una riga. Maiusc con una freccia alla fine
  (o all'inizio) del testo di una cella, o il trascinamento da una cella a
  un'altra, sceglie più celle: Canc le svuota, Ctrl+C e Ctrl+X le copiano
  come un foglio di calcolo, «Unisci celle» le unisce se stanno in una riga;
- le immagini e le note nuove, dalla scheda **Inserisci**:
  **Immagine** sceglie un PNG, un JPEG o un GIF del vault (fino a 16 MB) e lo
  mette al cursore, nel testo, alla sua misura (un pixel CSS è tre quarti di
  punto) ridotta se serve alla colonna di una pagina Letter; **Nota** chiede il
  testo, una riga, e se va a piè di pagina o in chiusura, e la scrive con gli
  stili delle note di Word.

Da **Trova** e **Sostituisci** di **Home** e dalla scheda **Revisione**:

- **Trova e sostituisci** (`Ctrl+F` apre la ricerca del documento, `Ctrl+H`
  anche con Sostituisci) mostra nel testo le occorrenze mentre si scrive, con maiuscole
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
  documento che ne ha, la scheda **Revisione** le scorre (precedente, successiva) e le
  **accetta** o **rifiuta**, una alla volta (quella del cursore o quelle
  della selezione) o tutte insieme. Tratti vicini con la stessa revisione
  sono una modifica sola, e i due capi di uno spostamento vanno insieme.
  Accettare un segno di paragrafo eliminato, o rifiutarne uno inserito,
  unisce il paragrafo al seguente, che gli dà le sue proprietà. Ciò che si
  scrive dentro o accanto a una revisione non ne fa parte;
- i **commenti** di un `.docx` si leggono nel pannello **Commenti**, con
  autore, data e risposte sotto, e il testo che commentano ha uno sfondo, con
  il commento al passaggio del puntatore. Un commento nuovo (`Ctrl+Alt+M`)
  segna la selezione, con testo semplice (una riga per paragrafo) e l'autore,
  che la sessione ricorda. Ogni commento si mostra nel testo, riceve una
  risposta, si **risolve** o si riapre con le sue risposte, e si elimina con
  loro e con i loro segni; ogni gesto è una battuta, che l'annulla disfa. Il
  testo di un commento che c'era resta com'è. Il segno di un commento nuovo
  si sposta trascinandolo, ma non si copia;
- **Registra modifiche** in un `.docx` chiede l'autore (lo stesso dei
  commenti) e accende l'impostazione del documento, che il file conserva: da
  lì ciò che si scrive, si cancella, si incolla o si sostituisce diventa una
  revisione tracciata di quell'autore, con la data. Il testo eliminato resta
  barrato e Backspace e Canc lo scavalcano; Invio fa un segno di paragrafo
  inserito, unire due paragrafi ne elimina uno. Ciò che l'autore aveva
  inserito si toglie davvero, e un tratto battuto di seguito resta una
  modifica sola. Mentre si registra il formato non si cambia (aspetto, stile,
  spaziatura, tabelle), perché non ha una revisione da scrivere; commenti,
  accettare e rifiutare restano liberi. Un `.docx` che registra già si apre
  così, non più in sola lettura;
- **Pagina** in un `.docx` cambia la pagina della sezione dove sta il
  cursore: la dimensione della carta (quelle di Word), l'orientamento, i
  margini (già pronti o in centimetri) e le colonne. Una pagina girata tiene
  la sua carta; margini che non lasciano spazio al testo non si prendono, e
  l'avviso lo dice. Il resto della sezione (la rilegatura, la larghezza delle
  colonne, le intestazioni) resta com'è, ma cambiare il numero di colonne le
  rende uguali. Mentre si registra la pagina non si cambia. Un `.odt` non
  offre la pagina. La pagina si cambia vedendola sui fogli (in
  [Pagina, Scrittura e Lettura](#pagina-scrittura-e-lettura)); le colonne non
  si vedono sul foglio;
- **Intestazione e piè di pagina** in un `.docx` si scrivono sul posto: un
  doppio clic nel margine di un foglio, o i loro bottoni nella barra, aprono
  sopra il margine un campo «Intestazione · Sezione N». Si scrive testo, una
  riga per paragrafo; il numero di pagina e il numero delle pagine sono i
  gettoni «Pagina» e «Pagine», messi dai due bottoni accanto all'etichetta.
  Esc o un clic fuori chiudono e scrivono, con un passo solo che `Ctrl+Z`
  annulla. Una riga riscritta tiene l'aspetto di quella di prima; una nuova
  prende gli stili Intestazione e Piè di pagina di Word. Vuoti, la sezione
  mostra quelli della sezione prima. Quelli della prima pagina e delle pagine
  pari restano come sono, e uno con immagini, tabelle o aspetti diversi si
  legge ma si modifica in Word. Mentre si registra non si cambiano;
- **Sommario** in un `.docx` mette prima del paragrafo del cursore il
  sommario dei titoli fino al terzo livello, o rifà quello già messo da Fub
  con i titoli di adesso. I numeri di pagina li calcola Word aprendo il file.
  Senza titoli il bottone è spento; mentre si registra non si usa.

Il resto del documento (le altre proprietà dei paragrafi e dei tratti, la
definizione degli stili, il resto delle sezioni,
le intestazioni che non sono testo semplice, immagini, forme, campi, note, formule, il testo dei commenti) resta nel file
così com'è. Un oggetto si vede come una casella con il suo nome o il suo testo
alternativo; la fine di una sezione è un filo doppio che non si cancella con un
Backspace.

Un documento si apre **soltanto in lettura**, con il motivo in testa, quando
ha modifiche di formato tracciate o revisioni fuori dal corpo (note,
intestazioni, piè di pagina, commenti, caselle di testo), è protetto,
oppure quando la superficie o il codec non saprebbero riscriverlo identico.
Per un `.docx` lo si misura sui byte del pacchetto, non soltanto sul modello:
all'apertura Fub confronta il file con una riscrittura a vuoto del codec, e
guarda che cosa questa perde o cambia: un elemento, un attributo o il suo
valore, il testo di un paragrafo, una relazione, una parte copiata (per
esempio un contenuto importato con `w:altChunk`, o il nome che Word ha dato a
un'immagine), o anche soltanto il posto di un segno dentro il paragrafo. Non
contano i segni che Word stesso rigenera a ogni salvataggio: le sessioni di
modifica (`rsid`), gli errori di ortografia segnati, l'ultima impaginazione,
gli identificativi dei paragrafi, le statistiche del file e la numerazione
degli id; né le forme che la norma considera uguali, come un contenitore di
proprietà vuoto, `start` ed `end` al posto di `left` e `right`, un
interruttore acceso scritto con `w:val="true"` o senza, un rientro sporgente
nullo al posto di una prima riga nulla, un campo semplice o il paragrafo che
chiude il corpo dopo una tabella.

Ciò che si perderebbe non chiude per forza tutto il documento:

- un **paragrafo o una tabella** che la riscrittura non porterebbe intero
  resta com'è nel file, segnato, e da Fub non si cambia: lo si può spostare
  intero, ma non scriverci dentro né toglierlo. Il chip accanto al percorso
  dice quante parti restano come sono («2 parti chiuse»); il suo riquadro le
  elenca, con la pagina e un «Vai» per ciascuna, e il resto del testo si
  scrive;
- se si perderebbe qualcosa **fuori dal corpo** (stili, numerazioni,
  impostazioni, tema, proprietà del file, intestazioni, commenti), si
  scrivono soltanto i paragrafi e le tabelle del testo: la pagina, le
  intestazioni e i piè di pagina, i commenti, la registrazione delle
  modifiche e le note non si cambiano, e un elenco di una specie che il
  documento non ha ancora non si crea, perché vorrebbe una numerazione nuova.
  Il chip dice «Solo il testo»;
- tutto il documento resta in sola lettura (motivo `codec`) soltanto quando
  il modello non si rilegge uguale, o il corpo del file non si legge blocco
  per blocco come lo legge il codec.

Il chip dice anche «Si scrive», quando il file si riscrive tutto, e «Sola
lettura», con il perché nella lingua di chi scrive; il suo riquadro offre di
cercare. Accanto al chip, «Registra» dice che le modifiche si registrano.

Un salvataggio che tocca soltanto il testo è un **innesto**: il file resta
com'era, byte per byte, tranne i paragrafi e le tabelle toccati, che arrivano
dal codec con i loro riferimenti riportati a quelli del file (immagini,
segnalibri, commenti, note). Un salvataggio che cambia anche ciò che sta fuori
dal corpo riscrive tutto il file con il codec, e si fa soltanto se la
riscrittura non perde niente. In ogni caso un salvataggio che non si rilegge
uguale a ciò che si voleva scrivere non scrive, e il testo resta nel buffer;
lo stesso vale per un salvataggio che cambierebbe un blocco chiuso o una
parte che l'utente non ha toccato, che duplicherebbe un'immagine o
lascerebbe un riferimento senza relazione. Un documento cifrato o più grande
di 256 MiB non si apre; uno molto lungo (centomila paragrafi) si apre in
qualche secondo, senza fermare l'interfaccia.

Limiti attuali:

- di un `.docx` si disegnano le immagini PNG, JPEG e GIF intere, fino a
  4 MiB l'una e 8 MiB in tutto; un'immagine ritagliata, in un altro formato
  (EMF, WMF, SVG) o oltre quei pesi, e ogni immagine di un `.odt`, resta un
  segnaposto con il nome e la misura. Un oggetto non si modifica dalla
  superficie, e il testo di una nota esistente non si cambia;
- una nota nuova è testo semplice su una riga, senza formattazione; copiata e
  incollata, è una seconda nota con lo stesso testo;
- l'interlinea «almeno» ed «esattamente» si mostra e si conserva, ma dalla
  barra si sceglie soltanto un multiplo. La carta disegna carattere, misura,
  colore, rientri, spazi e interlinea che il file scrive sul paragrafo o sul
  tratto; quelli che vengono dallo stile non si disegnano (valgono i
  predefiniti di Word), e un campo vuoto della spaziatura non dice quanto
  valgono. I bordi delle tabelle del file non si disegnano;
- un foglio il cui testo non ci sta si allunga e non si spezza, quindi le
  **Pagine** della banda di stato contano i fogli, non le pagine che Word
  stamperebbe. Una sezione che comincia a pagina pari o dispari apre un foglio
  solo, senza il foglio bianco; un salto dentro una tabella non apre un
  foglio; i numeri di pagina non ripartono a ogni sezione;
- un carattere che la macchina non ha si mostra con uno di ripiego, ma nel
  file resta quello scelto; in un `.docx` l'evidenziatore ha soltanto i sedici
  colori di Word;
- un link porta soltanto a un indirizzo web, di posta o a un segnalibro
  già nel documento;
- le colonne si aggiungono, si spostano e si tolgono soltanto in una tabella
  le cui righe hanno tutte le stesse celle, senza celle unite in larghezza;
  le celle si uniscono soltanto in larghezza, e una cella unita in altezza si
  mostra come una cella per riga;
- un elenco numerato mostra sempre numeri arabi, qualunque sia la numerazione
  del documento, che resta quella del file;
- quando un salvataggio riscrive tutto il file (perché è cambiato ciò che
  sta fuori dal corpo), il codec lo scrive in forma propria: rinumera
  intestazioni, piè di pagina, note e caselle di testo, fonde le impostazioni
  che genera con quelle originali e toglie le immagini che il testo non
  mostra più. Il contenuto non cambia, ma il file salvato non è identico byte
  per byte; un innesto invece lo è, fuori dalle unità toccate.

## Pagina, Scrittura e Lettura

Un documento si guarda in tre modi, dal selettore accanto al percorso:

- **Pagina**, il predefinito: il documento sta sulla carta vera, misurata in
  punti, sulla scrivania. Ha la carta e i margini della sua sezione, e il
  carattere, la misura e i colori del file. Ogni salto pagina e ogni sezione
  che comincia a pagina nuova aprono un foglio, con l'intestazione, il piè e i
  numeri di pagina veri; fra due fogli c'è il nome dell'interruzione. La carta
  non si stringe col riquadro, si scorre. **Adatta larghezza** e **Pagina
  intera**, nella banda di stato, la scalano alla vista, fra un decimo e il
  doppio; un altro clic torna alla carta vera;
- **Scrittura**: la colonna di una nota, con il carattere e i colori del
  tema. Restano titoli, elenchi, tabelle ed enfasi, e un'interruzione è una
  riga con il suo nome;
- **Lettura**: la barra si ritira e resta la carta; Esc torna a Pagina.

Mentre il documento ha il fuoco, la banda di stato dice il foglio del cursore
(«Pagina 2 di 5», in Pagina e in Lettura), le parole («12 di 418 parole» con
una selezione), la lingua che il file dice per il testo e **Registra** quando
le modifiche si registrano. Le parole sono quelle di Proprietà › Conteggio, e
un clic ci porta; il conteggio della nota, che la banda mostra per le altre
note, si fa da parte.

**F6** porta il fuoco alla zona seguente della finestra, come in Office: la
barra del documento, il foglio, l'ispettore con Commenti, Revisioni e
Proprietà, la banda di stato, poi il pannello dei file se è aperto.
**Maiusc+F6** fa il giro al contrario. Una zona chiusa non si conta, e in
Lettura la barra non c'è. F6 vale anche per gli altri fogli, che sono una zona
sola; la scorciatoia si cambia in Preferenze come le altre.

Il formato si vede prima di aprire: nell'albero, nelle schede e nel
lanciatore un documento di Word, un OpenDocument, un foglio di calcolo e un
disegno hanno ciascuno la sua icona, diversa dal foglietto di una nota. Accanto
al percorso, nella testata del foglio, un'etichetta dice **WORD**, **ODT**,
**RTF** o **EXCEL**. La specie viene dall'estensione (`ui/format-kind.ts`);
quale formato apre il file lo decide sempre il backend.

**Carta adattata**, nella scheda **Visualizza**, porta il documento di Pagina
e di Lettura sulla carta del tema, che di notte è scura. Ogni colore del file
tiene la tinta e il contrasto che aveva sul bianco. Con il contrasto alto è
il predefinito, se l'aspetto del contenuto in Preferenze › Aspetto è
automatico. I segni di Fub (revisioni, correttore, ricerca, commenti)
prendono i colori della carta su cui stanno.

Cambiando modo, ritirando la barra o cambiando lo zoom si muove la carta, e
il testo è già al suo posto: il paragrafo in cima alla vista resta in cima, e
lo zoom tiene fermo il centro della vista. Un foglio aperto da `Ctrl+Invio`
esce da quello sopra; tolto il salto, la sua sagoma si dissolve. Un documento
aperto o cambiato da fuori non muove niente, e con il moto ridotto gli stessi
stati arrivano subito.

## Tasto destro e mini-barra

Il tasto destro, il tasto Menu o Maiusc+F10 aprono il menu del documento,
con le sezioni dei menu delle note. Sotto il puntatore: il link (copia
l'indirizzo, modifica, rimuovi), la revisione tracciata (accetta, rifiuta) e
la tabella (righe e colonne). Poi Taglia, Copia, Incolla e Incolla solo testo;
«Formato», «Trasforma in», l'allineamento e il rientro; «Inserisci»; in fondo
Trova e sostituisci e Seleziona tutto. Il tasto destro fuori dalla selezione
porta lì il cursore. Su una parola segnata dal correttore il menu è quello
delle correzioni.

Sopra il menu c'è la mini-barra, come in Word: carattere, dimensione, A⁺ e
A⁻, grassetto, corsivo, sottolineato e copia formato. Sulla selezione compare da sola quando la barra di
formattazione è spenta, secondo l'impostazione «Mini-barra di formattazione».

## Disegnare e inserire un disegno

La scheda «Disegna» (`editors/rich/ink.ts`) mette un velo sopra la pagina
quando è scelto uno strumento che disegna, e raccoglie i tratti con
l'adattatore dell'inchiostro (`ink/dom/pointer-adapter.ts`). I tratti di una
sessione diventano un oggetto `ink` davanti al testo, ancorato al paragrafo
più vicino, in un passo di Annulla; la geometria pura (riquadro, gomma, lazo,
contorno) sta in `editors/rich/ink-shape.ts`. In un documento OpenDocument la
sessione entra come `drawing`. Un inchiostro del file che non si legge resta
opaco, e il chip dello stato lo dice in «Che cosa manca?».

Il menu **«Tipo di penna»** sceglie una delle sei penne del disegno
([penne](drawing-pen.md)); la penna di ogni tratto entra nel pennello come
Word lo conosce, e il suo nome in `fubPen`. Le penne salvate del disegno
qui non ci sono.

Inserisci › Disegno e la scheda «Oggetto» stanno in `editors/rich/drawing.ts`:
un disegno nuovo o copiato dal vault, la disposizione di immagini, disegni e
inchiostri, e la modifica sul posto con l'editor dei disegni, caricato
soltanto allora (`editors/rich/drawing-editor.ts`). Il PNG di ripiego lo fa
il client. I campi `ink`, `svg` e `float` sono in [Proiezione dei
documenti](../reference/rich-projection.md); il perché è
nell'[ADR 0226](../decisions/0226-inchiostro-e-disegni-nei-documenti.md).

## OpenDocument

Un `.odt` si apre nella stessa superficie e si modifica come un `.docx`, con
gli stessi limiti. Il codec non porta la sua pagina, quindi in Pagina sta su
un A4 con i margini di 2 cm, che il riquadro **Pagina** dice senza
cambiarli; un salto di pagina o di colonna però non si scrive, e una
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
citazione, senza toccare gli altri. Le lunghezze nuove si scrivono in punti. Le revisioni tracciate e i commenti di un `.odt`
non si scrivono: un testo che ne porta (incollato da un `.docx`) non si
salva, e la barra non offre commenti nuovi.

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
[0210](../decisions/0210-opendocument-con-un-codec-di-fub.md),
[0211](../decisions/0211-copie-esportate-con-la-perdita-misurata.md),
[0212](../decisions/0212-preservazione-misurata-sul-pacchetto.md) e
[0215](../decisions/0215-salvataggio-docx-per-innesto.md).
