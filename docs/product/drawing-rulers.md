# Disegni, unità e guide

> **Per chi:** chi disegna su misura, in millimetri per la stampa o in pixel
> per lo schermo, e chi apre un disegno con le guide.
> **Risultato:** sapere come l'unità del documento cambia ciò che si legge e
> si scrive, che cosa succede alle guide che un disegno porta, e come si
> misura e si quota.

Il [disegno](drawing.md) ha la sua unità di misura, che vale per i campi e
per ciò che l'editor dice. Le **guide del documento**, linee orizzontali e
verticali scritte nel file, restano dove sono quando un disegno le porta,
scritte da un altro programma o da una versione precedente, ma Fub non le
mostra, non le crea e non le cambia: i righelli e le guide se ne sono andati
con lo Standard (decisione 0231). Le unità sono in
`apps/client/src/editors/spatial/tools/rulers.ts`.

## L'unità del documento

L'unità si sceglie fra pixel, millimetri, centimetri, pollici e punti, nel
campo **Unità** della sezione «Documento» delle
[proprietà](drawing-properties.md). Un pollice vale 96 pixel, 25,4 millimetri e 72 punti, come nei fogli di stile. Cambiarla
è un passo di annulla, si annuncia, «Il documento ora misura in
millimetri.», e il disegno resta com'è: cambia soltanto come si leggono e si
scrivono le misure. Col Completo e il motore, `Ctrl+Alt+Maiusc+U` (Cambia
unità, come in VectorCraft) passa all'unità successiva, nell'ordine punti,
pollici, millimetri, centimetri, pixel, e dai pixel torna ai punti.

Nell'unità del documento ci sono:

- i campi di «Posizione e misure» e della misura della pagina, col nome che
  dice l'unità, «Larghezza (mm)»;
- il passo della griglia, che ogni unità ricorda per conto suo: 1, 2, 5, 10
  o 20 millimetri, da 5 la prima volta; 0,2, 0,5, 1, 2 o 5 centimetri, da
  0,5; un sedicesimo, un ottavo, un quarto, mezzo pollice o un pollice, da un
  quarto; 6, 12, 18, 36 o 72 punti, da 12; in pixel restano quelli di
  sempre;
- le misure che si leggono accanto al puntatore e quelle che si dicono:
  «Misure: 20 millimetri × 10,6 millimetri.», e le coordinate del cursore.

Lo spessore del contorno, la dimensione del testo e gli angoli restano nelle
loro unità.

## Lo strumento Misura

Nel Completo, nella casella del Contagocce, c'è la **Misura**, come in
VectorCraft: si trascina da un punto a un altro e accanto alla fine si
leggono la distanza, l'angolo e gli spostamenti in orizzontale e in
verticale; con Maiusc la linea va a passi di 45°, e senza si aggancia come
gli altri strumenti. Il disegno non cambia e non c'è un passo di annulla. La
linea e le misure restano sul foglio fino alla misura dopo; Esc a metà
trascinamento la annulla e riporta quella di prima, e un altro strumento le
toglie. Con «Etichette delle misure» spenta resta solo la linea. A uno zoom
fatto dopo, le scritte si rifanno alla scala nuova, come i segni del
passaggio di «Misura e ispeziona».

Accanto c'è **Misura e ispeziona**, che VectorCraft ha in più: il
trascinamento misura come la Misura, e la misura resta allo stesso modo. Il
mouse che passa sopra un tracciato, senza premere, ne legge accanto al
puntatore se è aperto o chiuso, quanti punti ha, la lunghezza del segmento e
del tracciato, l'area che chiude, il raggio di curvatura e la direzione in
quel punto; sopra un punto anche il suo angolo e le maniglie. Il segmento
sotto il mouse si illumina. Il disegno non cambia.

## Lo strumento Quota

Nella stessa casella c'è la **Quota**, come in VectorCraft: lascia nel
disegno la misura di un lato, di un angolo o di un cerchio, con le linee di
estensione, le frecce e il numero.

- **Col trascinamento.** Sopra un lato (lineare), un angolo (angolare) o un
  cerchio o un arco (radiale) si trascina verso l'esterno; il rilascio posa
  la quota.
- **Coi clic.** Due punti (lineare) o due lati diritti (angolare), poi un
  clic posa la quota; un clic su un cerchio ne dà il raggio. Esc annulla
  senza lasciare niente.
- **La fila dello strumento** sceglie il tipo (Lineare, Angolare, Radiale) e
  apre «Opzioni quota…», lo stile delle quote nuove: unità, decimali, scala
  «disegno:reale» (1:10 scrive 10 per ogni unità del foglio), linea, frecce,
  linee di estensione e testo. La finestra non manda un valore fuori dai
  limiti e spegne OK con una scala sbagliata.
- **La sezione «Quota» del Design** c'è quando ogni oggetto scelto è una
  quota: cambia la distanza della linea dall'oggetto misurato, apre le
  opzioni della prima quota (OK le manda a tutte le scelte) e «Applica a
  tutti» copia lo stile della prima su ogni quota del disegno. Ogni cambio è
  un passo di annulla.

Nel file una quota è un gruppo di linee, tracciati e testo, con la sua
ricetta nei metadati: si riapre come quota, con le sue opzioni. Il legame
con l'oggetto misurato non si scrive nel file: una quota riaperta non segue
l'oggetto quando cambia.

## Nel file

Le guide e l'unità sono attributi della radice: `fub:guides="x 120; y 340.5
locked"` e `fub:units="mm"`. I pixel sono l'unità di serie e non si scrivono.
Fub non tocca `fub:guides`: i cambi agli oggetti lo lasciano com'era. La
grammatica è in [Formato della scena, unità e
guide](../reference/scene-format-rulers.md).
