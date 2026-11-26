# Blocchi

> **Per chi:** chi scrive nelle note Markdown e chi modifica i blocchi di
> Scrittura.
> **Risultato:** sapere cosa aggiungono i blocchi alla Scrittura, come si
> spostano, si trasformano e si collegano i blocchi, e cosa finisce nel file.

## Che cos'è

I **blocchi** stanno dentro la modalità [Scrittura](editor-writing.md) della
nota Markdown: danno a ogni blocco una maniglia, un menu, il trascinamento e
una selezione di blocchi; la testata della pagina in cima c'è anche coi blocchi
spenti. Quanto si vede dei
segni Markdown lo dice `editor.live-reveal`, come in tutta Scrittura. Il file
resta Markdown puro: nessun blocco ha un id nascosto né un formato a parte, e
Sorgente mostra gli stessi byte. Gli a capo che un gesto scrive (spostare,
duplicare, trasformare, il link al blocco, le colonne, «+») sono quelli della
nota: una nota tutta CRLF resta tutta CRLF (`editors/text/line-breaks.ts`).

I blocchi sono una preferenza della macchina, `editor.blocks` (accesa di
fabbrica): si cambia dalle Impostazioni o dal menu «…» del riquadro
(«Blocchi: maniglie e selezione», gruppo Scrittura), e la nota aperta cambia
subito, senza riaprirsi; vedi [I blocchi spenti](#i-blocchi-spenti).

Blocchi non è più una modalità a sé. Un riquadro salvato in `blocks`, e
**Mod+Shift+B** (`shell.mode.blocks`, soltanto sulle note), portano a
Scrittura. Il codice dei blocchi si carica con l'editor della nota, non come un
pezzo a parte.

## I blocchi

Un blocco è un paragrafo, un titolo, una voce di elenco o di attività, una
citazione, un callout, un blocco di codice, un ripiegabile `<details>`, una
tabella, una riga orizzontale, un blocco HTML o di formula, il frontmatter o
una nota a piè di pagina. Una voce di elenco è un blocco a sé, con le sue
sottovoci come figli. Un `^id` scritto su una riga sua, sotto un blocco, fa
parte di quel blocco e si sposta con lui.

Che cosa scrivono nel file colori, ripiegabili, colonne, indice, persone e
date lo dice [Colori, colonne, persone e date](editor-note-extras.md); la
testata della pagina sta nella [sua pagina](editor-header.md), i segnalibri web
in [Link, sbirciata e pagine incorporate](editor-links.md#i-segnalibri-web).

## Maniglie e menu

Al passaggio del puntatore a sinistra del blocco compaiono, in grigio, il
**«+»**, che aggiunge sotto un paragrafo vuoto (o una voce sorella sotto una
voce), e la **maniglia**: i due occhi del marchio. A riposo non si vedono;
sugli schermi senza passaggio restano sul blocco del cursore. Stanno sempre a
sinistra di ciò che si vede: una scheda o una tabella più larga della colonna
li sposta, e su una citazione, un riquadro o un blocco di codice stanno a
sinistra del filo o del fondo, non del testo rientrato (figure da 16 px). In
altezza stanno sulla prima riga di testo; su un blocco alto che non comincia
con una riga (una tabella, una scheda, un'immagine) stanno in testa, non a
metà altezza. La maniglia sotto il puntatore prende l'accento
e gli occhi crescono appena; il suggerimento dice «Trascina per spostare,
clic per il menu». La maniglia ha il nome del blocco («Blocco: Titolo 2») e
apre col clic o col tasto destro un menu col campo «Cerca un'azione…», il
nome del blocco e il piede dei tasti ([Tasto destro](editor-menus.md)). Ha:

- **Trasforma in…**: paragrafo, titoli, elenchi, elenco di attività, citazione,
  riquadro, blocco di codice, ripiegabile. Il testo resta, cambiano soltanto i segni; un titolo che
  prende più righe le unisce con uno spazio, e le sottovoci restano blocchi
  sotto. Una tabella non si trasforma;
- **Colore ▸**, il testo e il fondo coi nove [colori](editor-note-extras.md#i-colori);
- **Duplica**, **Sposta in…** ([in un'altra nota](editor-move-to.md)) e, per
  ultimo, **Elimina**; **Sposta su**, **Sposta giù** e **Affianca in colonne** si trovano scrivendo;
- **Copia il link al blocco**: scrive negli appunti `[[Nota#Titolo]]` per un
  titolo e `[[Nota#^id]]` per il resto. Se il blocco non ha un id, ne riceve uno
  di sei caratteri: in coda all'ultima riga per paragrafi, titoli e voci, su una
  riga sua per gli altri. Un id che c'è già si riusa.

La maniglia si trascina (dopo 4 px di movimento; al tocco tenendola premuta
300 ms): gli occhi si socchiudono e il blocco **va in mano**. È il blocco vero,
largo com'era (anche una tabella o una scheda più larga della colonna) e mai
più alto di 104 px: uno più alto si accorcia davanti agli occhi mentre i
vicini salgono, si taglia sfumando e porta il nome del suo tipo; più blocchi selezionati salgono insieme e dicono
quanti sono. Fra i fratelli dello stesso livello si apre **il posto** dove
cadrà, alto quanto il blocco in mano: grigio finché è quello d'origine,
d'accento altrove; i vicini scivolano via per fargli spazio, e il posto
scivola con loro, una volta per ogni cambio: a posto fermo non si muove,
comunque si muova il puntatore. Il posto cambia
soltanto quando il centro del blocco in mano passa oltre la metà di un vicino,
e torna indietro solo ripassandola: niente tremolii. In un'altra sezione
un'etichetta in basso a destra dice «in «Sezione»»; per chi non vede, a ogni
cambio di posto la regione viva dice «Posizione 4 di 14, in «I conti»».

Di lato il blocco segue il puntatore per un terzo, al più 28 px. Una voce
d'elenco spostata di 24 px a destra entra nella voce sopra; di 24 px a
sinistra, in fondo alla sua lista, ne esce. Col puntatore sull'ultimo ottavo
a destra di un vicino, o fuori dalla colonna a sinistra, 48 px oltre la
maniglia da cui è partito (una deriva di lato non basta), compare una
barra verticale sul bordo del vicino: lasciato lì, il blocco gli va
**accanto**, in colonne (a sinistra non vale per le voci d'elenco, dove quel
gesto porta fuori). Al rilascio il blocco cade nel posto con un solo
passo d'annullamento; Esc, una finestra che perde il fuoco o il testo cambiato
da fuori (che vince) lo riportano dov'era. Le maniglie
stanno fuori dal testo ma sono pulsanti veri: il «+» e la maniglia del blocco
del cursore si raggiungono con Tab, e con Vim acceso restano cliccabili.

**Lo scorrimento al bordo.** Col blocco in mano, a meno di 72 px dal bordo
alto o basso della nota (al più un terzo della sua altezza) la nota scorre:
più piano lontano dal bordo, fino a circa 800 px al secondo sul bordo (col
quadrato della vicinanza), con una partenza morbida di mezzo secondo. Si
ferma fuori dalla fascia, a fine nota, al rilascio e quando il blocco esce
dalla colonna; col moto ridotto resta.

**Fuori dalla colonna.** Portato più di 90 px a sinistra o a destra della
colonna del testo, il blocco diventa un **cartellino**: rimpicciolito (largo
al più 250 px), sopra a tutto, segue il puntatore a 14 px di lato e 16 sotto,
e la maniglia sparisce. Il posto resta aperto, grigio, dove il blocco stava.
Le righe della Struttura della stessa nota che nominano un titolo diventano
bersagli: col cartellino sopra una riga, la riga si accende col bordo
d'accento e l'etichetta sotto il cartellino dice «In fondo a «Cose da fare»».
Lasciato lì, il blocco (o i blocchi selezionati) va in fondo a quella
sezione, prima del titolo seguente dello stesso livello o più alto, con un
solo passo d'annullamento, e la nota scorre per mostrarlo. Lasciato altrove,
il cartellino torna alla grandezza vera volando al suo posto, e il testo non
cambia; lo stesso con la Struttura chiusa, con un bersaglio che è proprio il
titolo in mano, o con blocchi annidati in una lista o in una citazione, che
non hanno bersagli. Per chi non vede, la regione viva dice «Fuori dal testo:
lasciato qui torna al suo posto» o il bersaglio. Col moto ridotto il
cartellino non vola. I bersagli arrivano dal registro degli editor
(`offerDropTargets` in `editors/core/registry.ts`): la Struttura li offre
per le righe il cui `action.payload` porta `{doc, start, end}` (byte del
titolo sul disco, `\r` compresi), soltanto per la nota dello stesso vault;
il nome della riga (testo puro) serve da ripiego. I posti si misurano
all'uscita dalla colonna e poi al più una volta per fotogramma, quando
qualcosa scorre o la Struttura si ridisegna (`dropOffersChanged`), mai a
ogni movimento del puntatore.

## La selezione di blocchi

Esc seleziona il blocco del cursore, e soltanto lui: su una riga vuota o nel
frontmatter non seleziona niente, e il velo copre le righe del blocco, non la
testata della pagina che sta sopra la prima riga. Righe scritte con un solo a
capo sono un paragrafo solo, come in Markdown, e Esc le sceglie insieme.
Shift+↑/↓ allarga ai fratelli, ↑/↓
passano al blocco vicino, Canc e Backspace eliminano i blocchi con le loro righe
vuote, Mod+D duplica, Invio ed Esc tornano al testo. Copiare e tagliare
lavorano sul Markdown dei blocchi interi. La selezione è del riquadro: un altro
riquadro sulla stessa nota non la vede, e le modifiche che arrivano da lì non
diventano battute nella sua cronologia. Lo screen reader sente quanti blocchi
sono selezionati.

## Tasti

- Mod+Shift+↑/↓ sposta il blocco del cursore, o la selezione di blocchi, fra i
  fratelli; le voci numerate si rinumerano; un annulla torna indietro in un
  passo.
- Mod+A seleziona prima il testo del blocco del cursore, senza i suoi segni
  (il testo di un titolo, di una voce, del codice); la seconda volta tutti i
  blocchi del corpo come selezione di blocchi, titolo e proprietà fuori; la
  terza non fa altro. Una nota col solo frontmatter non ha niente da prendere.
- Mod+D duplica il blocco del cursore, sotto, e il cursore passa nella copia
  allo stesso punto; con una selezione di blocchi la duplica tutta. Il
  frontmatter non si duplica come blocco, perché farebbe una seconda testata:
  col cursore nel suo YAML Mod+D passa alla copia della riga del testo, che
  copia la riga di una proprietà come le altre righe e non copia mai le righe
  `---`.
- Alt+↑/↓ sulle righe del testo (fuori dalle proprietà) non portano una riga
  del corpo dentro il frontmatter, né le sue righe `---` fuori.
- Backspace all'inizio di un paragrafo lo unisce al testo del blocco sopra.
- Dentro un blocco di codice Tab e Shift+Tab rientrano il codice.
- Mod+Alt+0 fa un paragrafo, Mod+Alt+1…3 un titolo, 4 un'attività, 5 un
  elenco puntato, 6 uno numerato, 7 un ripiegabile, 8 un blocco di codice;
  valgono anche coi blocchi spenti.

Durante una composizione (IME) e con Vim fuori dal modo inserimento questi tasti
si fanno da parte: Esc resta di Vim. In una scheda della lavagna Esc è della
scheda, che esce dalla scrittura: sul testo non seleziona il blocco, e una
selezione di blocchi già fatta la chiude prima di uscire
(`SurfaceMountContext.escapeLeaves`).

## I blocchi spenti

Con `editor.blocks` spenta Scrittura è un editor di testo: la testata della
pagina e la resa dei segni restano, il «/» resta, e i gesti cambiano così.

| Gesto | Blocchi accesi | Blocchi spenti |
| --- | --- | --- |
| Maniglia e «+» | al passaggio e sul blocco del cursore | non ci sono |
| Mod+A | il testo del blocco, poi tutti i blocchi | il corpo della nota, dal primo all'ultimo blocco; titolo e proprietà fuori; la seconda volta niente |
| Esc | seleziona il blocco del cursore | chiude ciò che è aperto; con Vim resta di Vim |
| Mod+Shift+↑/↓ | sposta il blocco o la selezione di blocchi | sposta la riga, o le righe scelte, senza entrare nella testata |
| Mod+D | duplica il blocco | sceglie la prossima occorrenza, con un cursore in più |
| Trascinare | il blocco, dalla maniglia | il testo scelto |
| «Trasforma il blocco» | nel menu della maniglia e nel tasto destro | nel tasto destro |

Una nota senza frontmatter dà a Mod+A tutto il testo. «Seleziona tutto» del
tasto destro fa ciò che fa Mod+A nei due stati. Spegnere i blocchi con
una selezione di blocchi attiva la lascia come selezione di testo sulle stesse
righe, e chiude il menu della maniglia se era aperto. Durante una
composizione (IME) il cambio aspetta che la composizione
finisca, o che il fuoco lasci la nota. In una scheda della lavagna Esc resta
della scheda nei due stati.

## Il movimento

I blocchi si muovono soltanto per un gesto di blocco, mai per una battuta: la
transazione porta l'annotazione `blockGesture`, e un plugin legge i riquadri
delle righe prima che CodeMirror le riscriva e le anima dal posto vecchio con
`moto`, soltanto con `transform` e `opacity`.

- **Prendere e posare.** Preso, il blocco cresce dell'1,5% e l'ombra si forma
  in 240 ms con una molla appena accennata; in mano raggiunge il puntatore in
  due o tre fotogrammi, si inclina al più di 1° quando corre di lato, e vicino
  al posto ne è attratto. Sale soltanto il blocco: la testata della pagina e i
  widget degli altri blocchi restano fermi. I vicini scivolano in 300 ms
  superando l'arrivo di un soffio. Al rilascio il blocco si posa in 340 ms, e
  poi niente: nessun alone. Esc (o il rilascio al suo posto) lo riporta a casa
  in 300 ms da dove si vede e con la grandezza che ha, anche a metà presa:
  l'ombra, il posto e le etichette svaniscono e i vicini tornano scivolando;
  una presa nuova o il testo cambiato lo posano subito. Al tocco
  presa e posa danno un colpetto aptico. Le misure si prendono alla presa e
  di nuovo soltanto se cambia la parte montata da CodeMirror; per fotogramma si
  scrive soltanto `transform`, il ciclo dei fotogrammi gira solo finché il
  blocco non ha raggiunto il puntatore (e solo allora ha uno strato suo), e il
  documento cambia al rilascio. Trascinato
  sopra il frontmatter, il blocco si posa subito sotto di lui, che non si
  trascina.
- **Scambiare.** Mod+Shift+↑/↓ fa scivolare le righe dal posto vecchio, con
  lo stesso moto della posa, e dice il posto come il trascinamento
  («Posizione 3 di 5, in «I conti»»). Il
  frontmatter resta sempre il primo blocco: niente gli passa davanti, lui non
  scende, e «Sposta su» non compare sul primo testo che lo segue.
- **Trasformare.** Il testo cresce o cala sul posto con la scala dei
  caratteri, il segno nuovo entra con un rimbalzo e i blocchi sotto scivolano.
  Un gesto che ne interrompe uno ancora in corsa riparte da dov'era.
- **Nascere e sparire.** Una riga nuova scende di 8 px e appare; una tolta si
  alza di 4 px e svanisce entro 120 ms mentre le altre salgono.
- **Ripiegare.** Il contenuto entra uno dopo l'altro, la freccia ruota.
- **Colore, colonne, casella.** Il fondo vecchio si ritira, l'etichetta della
  colonna cresce, la casella fa un rimbalzo.
- **La selezione.** Il velo dei blocchi scelti (`--doc-block-selected`) appare
  di blocco in blocco.

Il cursore non segue la corsa: dal primo fotogramma sta dove andrà la lettera,
e una battuta che non è un gesto (la lettera scritta subito dopo Invio) porta
subito al loro posto le righe ancora in movimento.

Oltre 60 righe in movimento, le righe si limitano a una dissolvenza. Col moto
ridotto non si muove niente: chi nasce appare soltanto in dissolvenza, il
posto appare senza scivolare e il blocco in mano si posa senza volo.
Ogni gesto si dice anche nella regione viva dei blocchi («Posizione 3 di 5, in
«I conti»» dopo uno spostamento, «Ora è Titolo 2», «Aperto»).

**Cursore morbido** (`editor.soft-cursor`, spento di norma) fa scivolare il
cursore fra le righe quando ci si muove senza scrivere; vale soltanto in
Scrittura, e mai col moto ridotto.

## Gli id di blocco

Con la rivelazione `mai` un `^id` in coda a un blocco, o su una riga sua, non si
vede; con `elemento` e `riga` resta visibile e attenuato. In Sorgente si vede
sempre.

## Dove si trova

- `apps/client/src/editors/text/profiles/markdown/blocks/`: modello, maniglie,
  selezione, spostamenti, trasformazioni, link, movimento (`motion.ts`),
  scorrimento al bordo (`autoscroll.ts`), bersagli fuori (`drop-targets.ts`);
- `apps/client/src/editors/text/profiles/markdown/block-gesture.ts`: i gesti
  di blocco, annotati anche dalla resa di Scrittura (`livepreview.ts`) e dalle
  azioni comuni (la freccia di un ripiegabile, la casella di un'attività);
- `apps/client/src/editors/text/profiles/markdown/block-id.ts`: gli id nascosti;
- `apps/client/src/state/editor-blocks.ts`: la preferenza `editor.blocks`,
  letta all'avvio della finestra e dalla superficie, scritta dal menu «…»
  del riquadro;
- `crates/fub-host/src/settings/editor_specs.rs`: la modalità dei riquadri nuovi, il
  cursore morbido e `editor.blocks`.
