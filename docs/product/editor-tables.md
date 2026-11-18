# Tabelle

Le tabelle delle note, dei documenti e dei fogli condividono gli stessi gesti:
li tiene la Tabella (`apps/client/src/tabella/`, ADR 0225), e ogni formato
dice che cosa sa fare. La prova comune (`tabella/conformance.ts`) esegue ogni
gesto sui tre adattatori: la tabella Markdown, la tabella del documento e il
foglio.

I tasti hanno due modi. Nel modo **foglio** (le note in Live e i fogli) la
tabella ha il fuoco e una cella attiva. Nel modo **documento** (le tabelle del
docx) il cursore resta nel testo della cella.

## Tabelle in Live

In Live ogni tabella è una griglia da foglio di calcolo, anche col cursore
dentro; la sorgente con le pipe resta della modalità Sorgente, e Lettura la
mostra resa. Quando la griglia ha il fuoco compaiono le lettere delle colonne
e i numeri delle righe; la prima riga è l'intestazione della tabella. In tutte
e due la tabella sta in una cornice arrotondata, con un filo fra le celle,
riempie la colonna del testo e non va a capo nelle celle: quando il contenuto
non ci sta, scorre in orizzontale (in Live i numeri delle righe restano fermi
nel margine e, solo con la griglia scorsa, prendono il fondo del foglio per
coprire le celle che passano sotto). La griglia non è una
fermata del Tab: ci si entra dal testo con le frecce, come in una riga. Sulle
celle il puntatore resta la freccia.

- Le frecce muovono la cella attiva, Maiusc allarga la selezione; Mod con una
  freccia va al bordo dei dati, come nei fogli di calcolo: da una cella piena
  accanto a un'altra piena fino all'ultima del blocco, altrimenti fino alla
  prima piena o al bordo. Home ed End vanno ai capi della riga.
- Maiusc+Spazio sceglie la riga, Mod+Spazio la colonna, Mod+Maiusc+Spazio la
  tabella. Un clic sceglie una cella, il trascinamento o Maiusc+clic un
  rettangolo, la lettera una colonna, il numero una riga (con Maiusc fin lì),
  l'angolo tutta la tabella. Una lettera o un numero già scelti si
  trascinano, come nei fogli di Google: una linea d'accento segna dove
  arriveranno, e al rilascio le colonne o le righe scelte si spostano in un
  passo solo; un clic senza trascinare sceglie soltanto quella. Le righe non
  passano sopra l'intestazione, e in sola lettura non si spostano.
- Mod+clic, Mod+trascina e Maiusc+F8 aggiungono un intervallo agli altri; di
  nuovo Maiusc+F8, o Escape, smette. Canc svuota tutti gli intervalli
  insieme; copia, taglia, incolla, riempimento e righe chiedono un intervallo
  solo e lo dicono con un avviso.
- Tab e Maiusc+Tab avanzano lungo le righe, e Tab dall'ultima cella aggiunge
  una riga. Con più celle scelte Invio, Maiusc+Invio, Tab e Maiusc+Tab fanno
  girare la cella attiva dentro la selezione, senza muoverla; come nei fogli
  di calcolo, la cella attiva di una selezione è quella da cui è partita.
- Un carattere riscrive la cella attiva da capo; Invio (con una cella sola),
  F2 o il doppio clic la modificano col suo testo. Dentro la cella Invio
  conferma e scende, Tab conferma e avanza, Escape annulla; le frecce laterali
  confermano quando la modifica è cominciata con un carattere e muovono il
  cursore quando è cominciata con Invio.
- Mod+C, Mod+X e Mod+V usano il TSV dei fogli di calcolo (e una tabella HTML),
  dove una cella su più righe resta una cella; incollare oltre il bordo allarga
  la tabella, e un valore incollato riempie le celle scelte. Taglia non svuota:
  le celle tagliate restano in un tratteggio che gira (fermo col moto ridotto)
  finché non si incolla, e l'incolla le
  sposta in un passo solo; Escape rinuncia, e ogni altra modifica della
  tabella toglie il segno. Il segno vale dentro la sua tabella: incollato in
  un'altra tabella o nel testo, il taglio è un incolla qualunque e le celle
  tagliate restano dove sono, e il primo taglio lo dice. Un taglio che
  incollato uscirebbe dal bordo della tabella non sposta niente: è un incolla
  qualunque.
- Mod+D copia in giù la prima riga scelta (con una riga sola, quella sopra;
  l'intestazione non scende nel corpo), Mod+R a destra la prima colonna. Il
  quadratino nell'angolo della selezione continua la serie: i numeri col passo
  degli ultimi due, un testo che finisce con un numero, i giorni della
  settimana e i mesi, corti o interi, in italiano e in inglese («lun», «mar»…;
  «gennaio», «febbraio»…; «Jan», «Feb»…), col passo della sorgente, dopo
  dicembre di nuovo gennaio e con le maiuscole del primo valore. Dove una
  parola è di due lingue («mar») o un numero si legge in due modi («1.000»)
  vale la lingua della nota (`lang:` nel frontmatter), altrimenti quella di
  Fub; i numeri si leggono come nella somma. Il doppio clic sul quadratino
  riempie in giù quanto la colonna accanto (quella a sinistra, altrimenti
  quella a destra), come Excel: si ferma prima di una cella già piena, non
  fa niente senza una colonna accanto piena e non porta l'intestazione nel
  corpo.
- Scrivendo in una cella la Tabella propone un valore già scritto nella
  stessa colonna, col resto scelto e lavato d'accento: Invio o Tab lo
  accetta, e la cella prende il valore com'è scritto nella colonna («r»
  accettato è «Roma»); continuare a scrivere lo ignora, Canc lo toglie, e
  Mod+Z dentro la cella torna a ciò che si era scritto. Propone soltanto quando un valore solo
  comincia così (come Excel: con «Roma» e «Romagna», «Rom» non propone
  niente), mai nell'intestazione, mai i numeri e mai a chi scrive un numero;
  con l'IME aspetta la fine della composizione. La colonna si legge quando
  la cella si apre, non a ogni battuta. La prima volta lo dice con un
  avviso.
- Alt+= scrive nella cella attiva la somma dei numeri subito sopra, fino al
  primo valore che non è un numero o all'intestazione. È un numero, non una
  formula: non si aggiorna, e la prima volta lo dice. I numeri si leggono
  all'italiana («1.240,50») o all'inglese («1,240.50») come li scrivono i
  numeri sommati, non quelli più su; dove non lo dicono («1.240») decide la
  lingua della nota, altrimenti quella di Fub. Il totale tiene i decimali e
  il separatore delle migliaia dei numeri sommati. Senza numeri sopra non
  scrive niente e lo dice. Conta il carattere «=», con Maiusc o senza: sulla
  tastiera italiana è Alt+Maiusc+0.
- Mod+; scrive la data del giorno nella lingua di Fub («15 nov 2026»): nella
  cella attiva, o dove sta il cursore se la cella è aperta.
- Alt con una freccia sposta di un posto le righe (su, giù) o le colonne
  (sinistra, destra) della selezione, e la selezione le segue; l'intestazione
  non si sposta. Con la cella aperta Alt con una freccia resta del campo: non
  conferma e non sposta niente.
- Chi scrive una cella che comincia con un `=` solo (non `==`) vede, la prima volta, che nelle
  tabelle Markdown resta testo e che le formule che si aggiornano sono quelle
  del foglio.
- Mod+«+» inserisce prima della selezione tante righe quante ne sono scelte
  (sotto, se la selezione è sull'intestazione), o tante colonne se sono scelte
  colonne intere; Mod+«−» toglie le righe scelte, l'intestazione esclusa, o
  le colonne intere scelte.
- Mod+B, Mod+I e Mod+Maiusc+X mettono grassetto, corsivo e barrato.
- Il menu contestuale (tasto destro, tasto menu, Maiusc+F10 o, al tocco, il
  tocco lungo) inserisce, sposta ed elimina righe e colonne, ordina secondo la
  colonna attiva (i numeri, letti come nella somma, prima del testo; le celle
  vuote in fondo), allinea a sinistra, al centro o a destra, copia, taglia e
  svuota. Col puntatore sopra la tabella o il fuoco dentro compaiono due
  barre col «+», una sotto la tabella («Aggiungi una riga») e una alla sua
  destra («Aggiungi una colonna»), che aggiungono in fondo; non sono fermate
  del Tab (la tastiera ha Tab dall'ultima cella e Mod+«+»), e al telefono resta
  soltanto quella della riga. Al tocco due maniglie agli angoli della
  selezione la allargano.
- Dove si scrive col dito, col cursore in una tabella la barra di
  formattazione apre in testa Tab, Invio e «+ riga»: i primi due arrivano
  alla tabella come i tasti veri, il terzo aggiunge una riga sotto.
- Freccia su dalla prima riga, freccia giù dall'ultima ed Escape tornano al
  testo; freccia giù dalla riga sopra la tabella, e su da quella sotto, vi
  entrano. Mod+Z e Mod+Y annullano e ripetono come nel resto della nota.
- Alt+Invio in una cella aperta conferma e scende come Invio: la cella delle
  tabelle Markdown è su una riga sola.

### Il moto

La selezione e la cella attiva scivolano al posto nuovo in 120 ms. Quando la
tabella cambia, le righe e le colonne si fanno spazio in 260 ms, quelle tolte
svaniscono in 170 ms e i valori cambiati compaiono a cascata, 16 ms l'uno
dall'altro. Annulla e ripeti fanno lo stesso moto al contrario, perché il moto
si legge dalla tabella di prima e da quella di dopo. Si muovono soltanto
`transform` e `opacity`, con `apps/client/src/moto/`; oltre 600 celle e col
moto ridotto la tabella sta ferma.

### Sul disco

Ogni gesto è una modifica del testo nella cronologia del riquadro, in un passo
d'annullamento, e riscrive soltanto la tabella. Cambiare il contenuto di una
cella tocca soltanto quella cella, spazi compresi; aggiungere, togliere,
spostare, ordinare o allineare riscrive la tabella incolonnata: ogni colonna
larga quanto la sua cella più lunga (almeno tre), le celle allineate come dice
il delimitatore. Una tabella che è già incolonnata così resta incolonnata anche
quando cambia una cella. Una pipe in una cella diventa `\|`, un a capo `<br>`.
Anche quando la tabella si incolonna di nuovo, il testo cambia soltanto dove
cambia: le righe uguali restano intatte, e il cursore e la selezione degli
altri riquadri sulla stessa nota restano al loro posto.

Le celle mostrano la resa in riga (grassetto, codice, link, formule); Mod+clic
segue un link o un tag. Con la griglia a fuoco la barra di formattazione agisce
sulle celle selezionate: formattazione in riga e operazioni sulla tabella;
titoli, elenchi e blocchi sono spenti. In sola lettura la griglia si seleziona
e si copia, ma non si scrive.

## Nei documenti

Una tabella nuova (**Inserisci › Tabella**, in un `.docx` o in un `.odt`)
nasce con i paragrafi delle celle a spazio dopo 0 e interlinea singola, come
lo stile «Griglia tabella» di Word, anche dove il documento dà al testo
normale più spazio: è la spaziatura del paragrafo, che **Spaziatura del
paragrafo** mostra e cambia, si salva come formattazione diretta e si
rilegge uguale. Dove lo stile del documento la dà già, il file non la
ripete. Righe, colonne e paragrafi aggiunti dopo copiano quelli accanto e la
tengono; una tabella del file resta con la sua. Una copia RTF la porta,
perché lì è la spaziatura di serie.

Nelle tabelle del docx il cursore resta nel testo: le frecce sono del testo,
Tab e Maiusc+Tab vanno di cella in cella (Tab dall'ultima aggiunge una riga),
e Maiusc con una freccia che esce dalla cella, o il trascinamento da una cella
all'altra, sceglie un rettangolo di celle; Mod+trascina ne aggiunge un altro,
e Mod+clic aggiunge una cella. Mod+clic fuori dalla tabella delle celle scelte
le lascia.

I gesti del foglio che nel testo non scrivono niente valgono sempre dentro una
tabella: Mod+Spazio sceglie la colonna, Mod+Maiusc+Spazio la tabella,
Maiusc+F8 comincia ad aggiungere intervalli (e allora le frecce muovono la
cella). Quelli che il testo usa già valgono soltanto con celle scelte:
Maiusc+Spazio sceglie la riga, Invio e Tab fanno girare la cella attiva dentro
la selezione, Mod+D e Mod+R riempiono, Mod+«+» e Mod+«−» inseriscono e
tolgono righe o colonne, con le stesse regole del modo foglio; le colonne si
toccano soltanto dove nessuna cella è unita. Senza celle scelte Invio va a
capo, Mod+R allinea a destra e Mod+«+» fa l'apice, come nel resto del testo.
Mod+; scrive la data del giorno dove sta il cursore. Con celle scelte la data
va nella cella attiva: al posto del testo se la cella ha soltanto un
paragrafo di testo semplice, altrimenti in fondo al suo primo paragrafo, dopo
uno spazio, così stili, paragrafi e oggetti restano. Alt con una freccia
sposta le righe o le colonne delle celle scelte; senza celle scelte la freccia
resta del testo (su macOS Alt salta di parola). Mod+Alt con una freccia
sposta la riga o la colonna del cursore con la stessa regola: le colonne non
si spostano dove una cella è unita.

Sulle celle scelte Canc svuota tutti gli intervalli, copia passa TSV e una
tabella HTML (con più intervalli rifiuta, e lo dice, come i fogli), e
«Unisci celle» unisce una riga. Taglia segna le celle come nel
modo foglio, dentro la loro tabella, e l'incolla le sposta in un passo solo;
Escape toglie prima il segno, poi gli intervalli aggiunti, poi le celle. Ogni
gesto è un passo d'annullamento, e le celle restano scelte.

Nessuna modifica toglie una cella da una riga. Una selezione di testo che va
da una cella a un'altra della stessa tabella (il trascinamento del browser,
Maiusc+clic) diventa celle scelte, dall'àncora alla testa, e Canc o Backspace
le svuotano. Una selezione che esce dalla tabella si toglie a pezzi: il testo
fuori, le tabelle intere che contiene, e in ogni cella toccata il pezzo
scelto, con le celle che restano (vuote, se scelte tutte); una lettera scritta
sopra va dove cominciava. Taglia copia il testo scelto e lo toglie allo stesso
modo; Invio (e Maiusc+Invio) lo toglie e va a capo dove cominciava, nella
cella o nel paragrafo, e un Ctrl+Z rimette tutto. Ciò che unirebbe due celle o lascerebbe una riga più
corta delle altre non si applica; una tabella del file che ha già righe di
lunghezze diverse resta com'è, e Ctrl+Z passa sempre.

Alcuni gesti del foglio nel documento mancano apposta, e la prova comune lo
dice col perché: Mod con una freccia, che nel testo salta di parola; la cella
da aprire, riscrivere o annullare, perché il cursore è già nel testo della
cella; il completamento, perché si scrive nel testo come in Word; Alt+=, che
in Word inserisce un'equazione; il quadratino di riempimento e le
intestazioni da cliccare, che il documento non ha. L'ordinamento manca perché
il formato non lo sa fare.

## Nei fogli

Il foglio ha gli stessi gesti con le regole della Tabella: Maiusc+Spazio,
Mod+Spazio, Mod con una freccia, Invio e Tab dentro la selezione, il segno del
taglio, Maiusc+F8. Mod+D, Mod+R, Mod+«+» e Mod+«−» li esegue col suo
catalogo, come Excel: su un intervallo che non prende righe o colonne intere
Mod+«+» e Mod+«−» chiedono come spostare le celle. Alt+= mette la formula
della somma, il quadratino tirato o cliccato due volte continua la serie
(anche i giorni e i mesi) e le intestazioni scelgono la colonna o la riga,
sempre col catalogo del foglio. Il completamento, Mod+;, Alt con le frecce e
le intestazioni da trascinare per spostare righe e colonne il foglio non li
ha ancora: sono un lavoro sul motore dei fogli, e la prova comune lo dice.
Nel foglio trascinare le intestazioni allarga la scelta, come in Excel. La
griglia dei fogli è descritta in
[Editor e anteprima](editor-and-preview.md#la-griglia).

## La somma nella banda

Con due o più celle numeriche scelte in una tabella della nota in Live o nella
tabella di una Base, la banda in fondo mostra «Somma · Media · Conteggio» al
posto del conto delle parole; con una cella sola, o senza numeri, torna il
conto. Il conto si fa nella shell, senza chiamate al core, in un passo solo
anche su diecimila celle.

- Un numero si legge com'è scritto nella lingua della nota (`lang:` nel
  frontmatter, anche nella forma `it_IT`, se no quella dell'app): «1.240,5» in
  italiano, «1,240.5» in inglese, lo spazio come separatore in francese. La
  forma del computer «1240.5» vale soltanto dove il punto non separa le
  migliaia: in italiano «15.11» e «12.30» sono una data e un'ora, e non
  contano. Segno, valute (€ $ £ ¥) e percento sono permessi; un numero tra
  parentesi è negativo, come nei conti: «(1.234)», «(€ 1.240,50)». Testo,
  date, celle vuote e testo barrato (`~~100~~`) non contano. Il grassetto o il
  codice attorno al numero non lo cambiano. La riga d'intestazione non conta
  mai.
- Il conteggio è quello delle celle numeriche. I risultati si scrivono nella
  lingua delle celle, al più con le cifre dopo la virgola delle celle (la
  media almeno due) e senza zeri in fondo, come il prototipo: «1,50» e «1,00»
  fanno «2,5».
- Se tutte le celle contate sono percentuali, somma, media, minimo e massimo
  si scrivono in percento: «10%» e «20%» fanno «Somma 30%». Se sono miste, una
  percentuale vale la sua frazione («50%» è 0,5) e i risultati sono numeri:
  «50%» e «2» fanno «Somma 2,5».
- Un clic su una voce la copia negli appunti e lo dice con un avviso; il tasto
  destro sulla banda, o il tasto Menu e Maiusc+F10 su una voce, sceglie le
  voci (anche Minimo e Massimo). La scelta dura quanto la sessione, e almeno
  una voce resta accesa. I conti si sentono anche a voce, da una regione
  cortese (`role="status"`) che parla quando cambiano.
- Nella Base le celle si scelgono con il clic, Maiusc+clic, il trascinamento,
  o Maiusc con le frecce dalla cella (le righe dei gruppi si saltano). Nel
  campo aperto Maiusc con le frecce sceglie il testo: Escape lascia il campo
  senza scriverlo e porta alla cella, da cui le frecce scelgono le celle.
  Quando la Base si ridisegna (un'altra nota salvata, un gruppo chiuso) la
  scelta resta se le sue celle d'angolo ci sono ancora, con la stessa nota e
  la stessa colonna; se ne va con Escape, con la ricerca, cambiando vista o
  quando una delle due non c'è più. La tabella della Base non è una griglia
  ARIA (non ha la navigazione con le frecce): la scelta si sente dalla voce
  della banda. Una Base dentro una nota non porta la somma nella banda.

## Dove si trova

- `apps/client/src/tabella/` (tasti, navigazione, selezione, comandi, appunti,
  serie, somma, completamento, cornice e moto)
- `apps/client/src/editors/text/profiles/markdown/table-grid.ts`,
  `table-model.ts` e `table-widget.ts`
- `apps/client/src/editors/rich/cell-selection.ts` e `table-structure.ts` (righe
  e colonne, comuni ai comandi del documento)
- `apps/client/src/editors/grid/engine.ts` e `shortcuts.ts`
- `apps/client/src/panels/format-bar.ts` (i tasti della tabella per il dito)
- `apps/client/src/theme/scrittoio/skin/tabella.css`
- `apps/client/src/shells/scrittoio/frame/selection-sum.ts` (la somma nella
  banda) e `apps/client/src/editors/base/surface.ts` (le celle della Base)
