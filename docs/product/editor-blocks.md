# Blocchi

> **Per chi:** chi scrive nelle note Markdown e chi modifica i blocchi di
> Scrittura.
> **Risultato:** sapere cosa aggiungono i blocchi alla Scrittura, come si
> spostano, si trasformano e si collegano i blocchi, e cosa finisce nel file.

## Che cos'è

I **blocchi** stanno dentro la modalità [Scrittura](editor-writing.md) della
nota Markdown: danno a ogni blocco una maniglia, un menu, il trascinamento e
una selezione di blocchi, e in cima la testata della pagina. Quanto si vede dei
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

## Maniglie e menu

Al passaggio del puntatore a sinistra del blocco compaiono, in grigio, il
**«+»**, che aggiunge sotto un paragrafo vuoto (o una voce sorella sotto una
voce), e la **maniglia**: i due occhi del marchio. A riposo non si vedono;
sugli schermi senza passaggio restano sul blocco del cursore. Stanno sempre a
sinistra di ciò che si vede: una scheda o una tabella più larga della colonna
li sposta (figure da 16 px). La maniglia sotto il puntatore prende l'accento
e gli occhi crescono appena; il suggerimento dice «Trascina per spostare,
clic per il menu». La maniglia ha il nome del blocco («Blocco: Titolo 2») e
apre col clic o col tasto destro un menu col campo «Cerca un'azione…», il
nome del blocco e il piede dei tasti ([Tasto destro](editor-menus.md)). Ha:

- **Trasforma in…**: paragrafo, titoli, elenchi, elenco di attività, citazione,
  riquadro, blocco di codice, ripiegabile. Il testo resta, cambiano soltanto i segni; un titolo che
  prende più righe le unisce con uno spazio, e le sottovoci restano blocchi
  sotto. Una tabella non si trasforma;
- **Colore ▸**, il testo e il fondo coi nove colori dei Blocchi;
- **Duplica** e, per ultimo, **Elimina**; **Sposta su**, **Sposta giù** e
  **Affianca in colonne** si trovano scrivendo;
- **Sposta in…** (dopo Duplica): vedi [Sposta in…](#sposta-in);
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
d'accento altrove; i vicini scivolano via per fargli spazio. Il posto cambia
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

Sono bersagli anche **le note del cassetto** (le note Markdown dell'albero e
delle appuntate, del vault della nota): la riga si accende allo stesso modo e
l'etichetta dice «Sposta in «Progetto»». Lasciato lì, il blocco va in fondo a
quella nota col link al suo posto, come «Sposta in…» con le scelte di serie;
il cartellino si posa e il blocco sparisce dalla nota quando le due scritture
sono fatte. Il cassetto offre le sue righe con la stessa porta
(`kind: "note"`).

## Sposta in…

«Sposta in…» manda il blocco (o i blocchi selezionati) **in un'altra nota**:
dal menu della maniglia, dallo spazio comandi (<kbd>Ctrl O</kbd>, «Sposta
in…») e trascinandolo su una nota del cassetto. Dal menu le domande sono
due: prima la nota, in un elenco per nome che si filtra scrivendo («Cerca
una nota…»; la nota stessa è l'ultima e dice «questa nota»); poi una finestra «Sposta in
«Progetto»» con **Dove** («In fondo alla nota», o «In fondo a «Titolo»» per
ogni titolo, rientrato per livello) e **Al suo posto** («Un link alla nota»,
«Niente», «Una trasclusione del blocco», quest'ultima per un blocco solo).
Le scelte di serie sono in fondo e col link: Invio sposta subito. Il blocco
è quello del momento del menu: se la nota cambia mentre si sceglie, non si
sposta niente e lo dice («La nota è cambiata mentre sceglievi»).

Lo fa il comando del nucleo `note.block.move`
(`crates/fub-features/src/commands/move_block.rs`), con i byte del blocco e
il testo letto lì: se la nota è cambiata e fra quei byte c'è altro, non si
muove niente. Il blocco arriva con gli a capo della nota d'arrivo e senza il
rientro che aveva in un elenco; una voce entra nell'elenco che chiude la nota.
Al posto del blocco il link è `[[Progetto]]`, o `[[Progetto#^id]]` se il
blocco ha un id; una voce d'elenco tiene il suo segno (`- [[Progetto]]`), non
la casella. La trasclusione è `![[Progetto#^id]]`: un blocco senza id ne
riceve uno nuovo, scritto dove lo scrive «Copia il link al blocco».

**Due scritture, un annulla.** La nota d'arrivo, quella di partenza e le note
i cui link seguono il blocco si scrivono insieme o per niente (il piano su più
documenti del kernel): una nota cambiata da fuori, una nota in sola lettura o
un disco pieno lasciano tutte le note com'erano, e il messaggio lo dice. La
notifica «Spostato in fondo a «Progetto». Qui resta il link.» ha «Annulla»,
che rimette tutte le note in un passo, oppure non tocca niente se una è
cambiata dopo.

**I link seguono il blocco.** Un id (`^abc123`) e un titolo restano col
blocco, e i link wiki che li nominano nella nota di partenza, in quella
d'arrivo e nelle note che linkano la partenza (`[[Riunione#^abc123]]`,
`[[#^abc123]]`, `[[Riunione#Titolo]]`) puntano alla nota nuova: cambia solo
il nome della pagina, alias e frammento restano. Un link Markdown
(`[testo](Riunione.md#^abc123)`) resta com'è.

**Nella stessa nota** il blocco va in fondo alla nota o alla sezione scelta
e non lascia niente; un titolo dentro ciò che si sposta non è una
destinazione.

## La selezione di blocchi

Esc seleziona il blocco del cursore; Shift+↑/↓ allarga ai fratelli, ↑/↓
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
  valgono anche in Live.

Durante una composizione (IME) e con Vim fuori dal modo inserimento questi tasti
si fanno da parte: Esc resta di Vim. In una scheda della lavagna Esc è della
scheda, che esce dalla scrittura: sul testo non seleziona il blocco, e una
selezione di blocchi già fatta la chiude prima di uscire
(`SurfaceMountContext.escapeLeaves`).

## I blocchi spenti

Con `editor.blocks` spenta Scrittura è un editor di testo: la testata della
pagina e i segni della Live restano, il «/» resta, e i gesti cambiano così.

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

I Blocchi si muovono soltanto per un gesto di blocco, mai per una battuta: la
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

Oltre 60 righe in movimento, le righe si limitano a una dissolvenza. Col moto
ridotto non si muove niente: chi nasce appare soltanto in dissolvenza, il
posto appare senza scivolare e il blocco in mano si posa senza volo.
Ogni gesto si dice anche nella regione viva dei Blocchi («Posizione 3 di 5, in
«I conti»» dopo uno spostamento, «Ora è Titolo 2», «Aperto»).

**Cursore morbido** (`editor.soft-cursor`, spento di norma) fa scivolare il
cursore fra le righe quando ci si muove senza scrivere; vale soltanto in
Scrittura, e mai col moto ridotto.

## Gli id di blocco

Con la rivelazione `mai` un `^id` in coda a un blocco, o su una riga sua, non si
vede; con `elemento` e `riga` resta visibile e attenuato. In Sorgente si vede
sempre.

## La testata della pagina

In cima ai Blocchi stanno la copertina, l'icona e il titolo della pagina, con
le proprietà subito sotto; la Lettura mostra la stessa testata (ordine,
proprietà e tastiera in [Scrittura](editor-writing.md#la-testata)). Icona,
copertina e classi sono righe del frontmatter, scritte come le altre
proprietà, e in Sorgente si vedono così:

```yaml
icon: 🧳            # o una figura: icon: fub:book
cover: ../Risorse/mare.png
cover-y: 30         # dove sta la copertina, da 0 (in cima) a 100
cssclasses: [wide, sans]
```

- **Titolo.** È il nome del file; per la pagina di una cartella
  (`Viaggio/_index.md`, vedi [Esplora e cartelle](explorer-and-folders.md)) è il
  nome della cartella. Si scrive in riga: Invio o l'uscita dal campo rinominano
  il file, o la cartella, con i collegamenti; Esc torna al nome di prima. Un
  nome che non si può usare o che c'è già non rinomina niente e lo dice. Invio
  dal titolo porta al testo; ↑ e ↓ passano per le proprietà della testata.
- **Icona.** Un'emoji, scelta cercandola per nome in italiano o in inglese, o
  una delle figure monocrome dell'esplora, che stanno prima delle emoji e si
  scrivono `icon: fub:book`. Una figura prende il colore del testo; un `fub:`
  con un nome che questa versione non conosce non si mostra, e la testata
  offre di nuovo «Aggiungi un'icona». Si vede anche fuori dalla pagina, quando l'indice ha letto la nota salvata:
  nella sua riga dell'esplora (e in quella della cartella di cui è la pagina,
  se l'esplora non le ha dato un'icona sua), nella sua scheda e prima dei
  `[[wikilink]]` che la nominano in Live e in Blocchi. Due note omonime con
  icone diverse non la danno a `[[Nome]]`. Un valore che non è un testo breve,
  come il path di un'immagine messo da un'altra app, non si mostra.
- **Copertina.** Un'immagine del vault, con lo stesso path di un'immagine nel
  testo, un indirizzo, o un colore pieno (`cover: "#a3c4f3"`); per
  un'immagine «Riposiziona» ne sceglie la parte che si vede.
- **Nuova sottopagina.** Chiede il nome, dice se la pagina sta per diventare
  quella di una cartella, crea la nota con `note.subpage` e scrive `[[Nome]]`
  in una riga vuota o in un paragrafo dopo il blocco del cursore.
- **Il menu «⋯».** «Larghezza piena», «Testo piccolo» e il carattere (quello
  del tema, con grazie, senza grazie, monospaziato) scrivono `cssclasses`
  (`wide`, `small`, `serif`, `sans`, `mono`) e lasciano le altre classi della
  nota. Il tema le applica al riquadro quando l'indice ha letto la nota salvata.
  Classi scritte con un commento o in una forma che la riscrittura perderebbe
  non si toccano: il menu apre lo YAML sulla loro riga.

In sola lettura la testata si guarda soltanto. Ogni modifica è un passo
d'annullamento suo.

## I colori

Come in Notion, il testo e il suo fondo hanno nove colori: `gray`, `brown`,
`orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`. Sul disco sono
HTML in riga con una classe chiusa, che la Lettura, la Live, i Blocchi e
l'export rendono e il sanitizzatore lascia passare da sola:

```html
<span class="fub-color-red">urgente</span>
<mark class="fub-bg-yellow">da ricordare</mark>
```

«Colore» li scrive dalla barra (`markdown.color.*` e `markdown.background.*`
in [`ipc-contract`](../reference/ipc-contract.md)), dal «/» e dal menu del
blocco: sulla selezione, o sul testo della riga dopo i segni del blocco. Un
testo già colorato cambia classe invece di prendere un tag in più;
«predefinito» toglie la classe, e con l'ultima il tag. Le tinte sono del tema,
in entrambe le luci, con un contrasto di almeno 4,5:1 sul foglio.

## I ripiegabili

Il ripiegabile di Notion è `<details>` con il suo `<summary>`. Le righe vuote
dopo il sommario e prima della chiusura tengono il contenuto Markdown:

```html
<details>
<summary>Ingredienti</summary>

- farina
- acqua

</details>
```

In Live e nei Blocchi resta il sommario con la freccia davanti, e il contenuto
sta rientrato sotto; i tag e le due righe vuote non si vedono. La freccia apre
e chiude soltanto nella vista e non scrive niente. Un ripiegabile comincia
aperto se ha `open`, che «Aperto di norma» nel menu del blocco mette o toglie,
e un cursore che entra nel contenuto lo apre. La Lettura e l'export lo rendono
come `<details>` vero. Ogni altra forma, come un sommario con altri tag o un
`<details>` senza la sua chiusura, resta HTML; senza chiusura ha l'ondulato.

## Le colonne

Le colonne sono un callout `[!columns]` con un callout `[!column]` annidato
per colonna, da due a quattro, separati da una riga `>`:

```markdown
> [!columns]
> > [!column]
> > Pro
>
> > [!column]
> > Contro
```

La Lettura, la Live e i Blocchi le mettono in griglia, alla pari, e un foglio
largo meno di 700 px le mette una sotto l'altra. Col cursore dentro, la Live
le mostra una sotto l'altra con l'etichetta «Colonna 1», «Colonna 2»…, e il
testo si scrive lì. Le crea «Colonne» (`markdown.columns`) dalla barra o dal
«/», con un blocco per colonna delle righe selezionate; nei Blocchi anche
«Colonne» nel menu del blocco, che mette il blocco accanto al fratello che lo
segue (o la selezione di blocchi, una colonna per blocco), e il blocco
trascinato e lasciato sul bordo destro (o sinistro) di un altro, che gli va accanto o in
fondo alle sue colonne. Un callout `[!columns]` con un solo `[!column]`, più
di quattro o altro testo fra loro resta un callout. Gli altri programmi le
leggono come citazioni annidate, e l'export come callout annidati.

## L'indice

Un recinto `toc` diventa l'indice dei titoli della nota, ognuno un link al suo
titolo, rientrato di quanto il suo livello sta sotto il più alto elencato:

```toc
livelli: 2-3
```

`livelli: a-b` (o `levels: a-b`) tiene soltanto quei livelli; senza, ci sono
tutti. Nel file resta il recinto: l'indice segue i titoli da solo, in Lettura,
in Live, nei Blocchi e nell'export. In Live e nei Blocchi il clic su una voce
porta al titolo; il recinto si modifica dalla sua riga. «Indice»
(`markdown.toc`) lo inserisce dalla barra e dal «/». Gli altri programmi lo
mostrano come un blocco di codice.

## Le persone

Una persona è una nota della cartella `files.people-folder`, un'impostazione
del vault che parte da `Persone`; vuota, `@` resta testo. In Live e nei
Blocchi `@` all'inizio di una parola propone le persone il cui nome combacia,
cercate dall'indice, e scrive il link con il nome come testo:

```markdown
Ne parlo con [[Persone/Anna Bianchi|Anna Bianchi]].
```

Se nessuna si chiama così, «Nuova persona» scrive lo stesso link e crea la
nota nella cartella. Il link a una nota della cartella si mostra come una
pastiglia con la `@` davanti; in Lettura e negli altri programmi resta un
wikilink.

## Le date

`@` propone anche i giorni: il giorno stesso, «domani», «ieri», un giorno della
settimana («venerdì», il prossimo con quel nome), «prossimo venerdì» (quello
della settimana dopo, che comincia dal giorno scelto in
`locale.first-day-of-week` o da quello del sistema), «4 novembre», «nov 4» e
`2026-11-04`, in italiano e in inglese. Una parola a metà basta. Il giorno
diventa il link alla sua giornaliera, nella cartella e col formato di
`daily.folder` e `daily.format`, con il giorno per esteso come testo:

```markdown
Consegna [[Daily/2026-11-04|4 novembre 2026]].
```

In un compito c'è anche la scadenza `📅 2026-11-04`. «Persona»
(`markdown.mention`) e «Data» (`markdown.date`) scrivono la `@` dal «/» e
dalla barra; «Nuova sottopagina» (`note.subpage`) sta nel «/» fra i comandi
del vault.

## I segnalibri web

Un indirizzo `http` o `https` scritto da solo in un paragrafo, fuori dal
cursore, si vede come una scheda con titolo, descrizione, sito e icona della
pagina; col cursore dentro torna l'indirizzo. Il file resta l'URL nudo, e in
Lettura e negli altri programmi è un link. La scheda si scarica **soltanto su
richiesta**: aprire una nota legge la cache e basta, e un indirizzo senza
scheda offre «Mostra l'anteprima». Il download è il comando `linkcard.fetch`
del bundle `fub.linkcard`, col permesso `fub:network` che si spegne nelle
Preferenze: la scheda in cache torna subito nell'effetto `custom` con `ns`
`fub.linkcard`, quella scaricata arriva col `job_done` del job
`linkcard.fetch`. Della pagina si leggono soltanto i metadati della testa, fino a
1 MiB; l'icona entra se è un'immagine raster entro 64 KiB, mai un SVG. Le
schede stanno nella cache del bundle, ricostruibile. «Pagina web»
(`markdown.linkcard`) apre dal «/» un paragrafo con `https://`.

## Dove si trova

- `apps/client/src/editors/text/profiles/markdown/blocks/`: modello, maniglie,
  selezione, spostamenti, trasformazioni, link, movimento (`motion.ts`),
  scorrimento al bordo (`autoscroll.ts`), bersagli fuori (`drop-targets.ts`),
  le domande di «Sposta in…» (`move-to.ts`);
- `apps/client/src/state/move-block.ts`: «Sposta in…» verso il comando
  `note.block.move` (`crates/fub-features/src/commands/move_block.rs`), con
  l'annulla;
- `apps/client/src/panels/explorer.ts`: le note del cassetto come bersagli;
- `apps/client/src/editors/text/profiles/markdown/block-gesture.ts`: i gesti
  di blocco, annotati anche dalla Live;
- `apps/client/src/editors/text/profiles/markdown/block-id.ts`: gli id nascosti;
- `apps/client/src/editors/text/profiles/markdown/details.ts`: la regola dei
  ripiegabili, gemella di `crates/fub-format-markdown/src/render.rs`;
- `apps/client/src/editors/text/profiles/markdown/blocks/columns.ts`: le
  colonne fatte coi blocchi;
- `apps/client/src/editors/text/profiles/markdown/toc.ts`: l'indice, gemello
  di `crates/fub-format-markdown/src/render.rs`;
- `apps/client/src/state/page-rename.ts`: la rinomina dal titolo;
- `apps/client/src/state/page-icons.ts`: le icone fuori dalla pagina;
- `apps/client/src/ui/page-mark.ts`: che cosa vuol dire un valore d'icona
  (un'emoji o una figura `fub:<nome>`);
- `apps/client/src/state/people.ts`: la cartella delle persone;
- `apps/client/src/editors/text/profiles/markdown/dates.ts` e
  `apps/client/src/state/dates.ts`: le date di `@` e la giornaliera, gemella
  di `crates/fub-features/src/template.rs`;
- `apps/client/src/editors/text/profiles/markdown/link-card.ts` e
  `apps/client/src/state/link-cards.ts`: la scheda nella Live e le risposte di
  `crates/fub-host/src/link_card.rs`;
- `apps/client/src/state/editor-blocks.ts`: la preferenza `editor.blocks`,
  letta all'avvio della finestra e dalla superficie, scritta dal menu «…»
  del riquadro;
- `crates/fub-host/src/settings.rs`: la modalità dei riquadri nuovi, il
  cursore morbido e `editor.blocks`.
