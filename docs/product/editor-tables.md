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
mostra resa. Sulla griglia compaiono le lettere delle colonne e i numeri
delle righe; la prima riga è l'intestazione della tabella. La griglia non è una
fermata del Tab: ci si entra dal testo con le frecce, come in una riga. Sulle
celle il puntatore resta la freccia.

- Le frecce muovono la cella attiva, Maiusc allarga la selezione; Mod con una
  freccia va al bordo dei dati, come nei fogli di calcolo: da una cella piena
  accanto a un'altra piena fino all'ultima del blocco, altrimenti fino alla
  prima piena o al bordo. Home ed End vanno ai capi della riga.
- Maiusc+Spazio sceglie la riga, Mod+Spazio la colonna, Mod+Maiusc+Spazio la
  tabella. Un clic sceglie una cella, il trascinamento o Maiusc+clic un
  rettangolo, la lettera una colonna, il numero una riga, l'angolo tutta la
  tabella.
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
  le celle tagliate restano tratteggiate finché non si incolla, e l'incolla le
  sposta in un passo solo; Escape rinuncia, e ogni altra modifica della
  tabella toglie il segno. Il segno vale dentro la sua tabella: incollato in
  un'altra tabella o nel testo, il taglio è un incolla qualunque e le celle
  tagliate restano dove sono, e il primo taglio lo dice. Un taglio che
  incollato uscirebbe dal bordo della tabella non sposta niente: è un incolla
  qualunque.
- Mod+D copia in giù la prima riga scelta (con una riga sola, quella sopra;
  l'intestazione non scende nel corpo), Mod+R a destra la prima colonna. Il
  quadratino nell'angolo della selezione continua la serie.
- Mod+«+» inserisce prima della selezione tante righe quante ne sono scelte
  (sotto, se la selezione è sull'intestazione), o tante colonne se sono scelte
  colonne intere; Mod+«−» toglie le righe scelte, l'intestazione esclusa, o
  le colonne intere scelte.
- Mod+B, Mod+I e Mod+Maiusc+X mettono grassetto, corsivo e barrato.
- Il menu contestuale (tasto destro, tasto menu, Maiusc+F10 o, al tocco, il
  tocco lungo) inserisce, sposta ed elimina righe e colonne, ordina secondo la
  colonna attiva, allinea a sinistra, al centro o a destra, copia, taglia e
  svuota. I pulsanti «+ Riga» e «+ Colonna» sotto la tabella aggiungono in
  fondo. Al tocco due maniglie agli angoli della selezione la allargano.
- Dove si scrive col dito, col cursore in una tabella la barra di
  formattazione apre in testa Tab, Invio e «+ riga»: i primi due arrivano
  alla tabella come i tasti veri, il terzo aggiunge una riga sotto.
- Freccia su dalla prima riga, freccia giù dall'ultima ed Escape tornano al
  testo; freccia giù dalla riga sopra la tabella, e su da quella sotto, vi
  entrano. Mod+Z e Mod+Y annullano e ripetono come nel resto della nota.

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

Sulle celle scelte Canc svuota tutti gli intervalli, copia passa TSV e una
tabella HTML (con più intervalli rifiuta, e lo dice, come i fogli), e
«Unisci celle» unisce una riga. Taglia segna le celle come nel
modo foglio, dentro la loro tabella, e l'incolla le sposta in un passo solo;
Escape toglie prima il segno, poi gli intervalli aggiunti, poi le celle. Ogni
gesto è un passo d'annullamento, e le celle restano scelte.

Due gesti del foglio nel documento mancano apposta, e la prova comune lo dice
col perché: Mod con una freccia, che nel testo salta di parola, e la cella da
aprire, riscrivere o annullare, perché il cursore è già nel testo della cella.
L'ordinamento manca perché il formato non lo sa fare.

## Nei fogli

Il foglio ha gli stessi gesti con le regole della Tabella: Maiusc+Spazio,
Mod+Spazio, Mod con una freccia, Invio e Tab dentro la selezione, il segno del
taglio, Maiusc+F8. Mod+D, Mod+R, Mod+«+» e Mod+«−» li esegue col suo
catalogo, come Excel: su un intervallo che non prende righe o colonne intere
Mod+«+» e Mod+«−» chiedono come spostare le celle. La griglia dei fogli è
descritta in [Editor e anteprima](editor-and-preview.md#la-griglia).

## Dove si trova

- `apps/client/src/tabella/` (tasti, navigazione, selezione, comandi, appunti,
  cornice e moto)
- `apps/client/src/editors/text/profiles/markdown/table-grid.ts`,
  `table-model.ts` e `table-widget.ts`
- `apps/client/src/editors/rich/cell-selection.ts` e `table-structure.ts` (righe
  e colonne, comuni ai comandi del documento)
- `apps/client/src/editors/grid/engine.ts` e `shortcuts.ts`
- `apps/client/src/panels/format-bar.ts` (i tasti della tabella per il dito)
- `apps/client/src/theme/scrittoio/skin/tabella.css`
