# Disegni, selezione

> **Per chi:** chi sceglie fra molti oggetti, dentro i gruppi, o vuole
> mettere da parte qualcosa mentre lavora sul resto.
> **Risultato:** sapere come si sceglie col Lazo, coi simili e dentro i
> gruppi, come si isola un gruppo e come si bloccano e si nascondono gli
> oggetti uno per uno.

Dal livello Standard il [disegno](drawing.md) sceglie in più modi della sola
freccia: il Lazo, il menu «Selezione avanzata», i clic dentro i gruppi, i
gruppi isolati; e gli oggetti si bloccano e si nascondono uno per uno, non
solo per livello. Scegliere e isolare non cambiano il file; bloccare e
nascondere sì, e sono passi di annulla
(`apps/client/src/editors/spatial/tools/selecting.ts`, il lazo e l'indice in
`apps/client/src/editors/spatial/tools/hit.ts`).

## Il Lazo

Lo strumento **Lazo** (`Q`, come in Illustrator) viene dopo la freccia. Si
disegna attorno agli oggetti, e si scelgono quelli che il lazo racchiude per
intero: la stessa regola del riquadro che la freccia tira sul vuoto. Il lazo
si chiude da solo, dall'ultimo punto al primo, e la selezione lo segue mentre
lo si tira; un giro che ripassa sul proprio inizio non lascia buchi.

- **`Maiusc`** aggiunge ciò che il lazo racchiude alla selezione di prima,
  **`Alt`** lo toglie.
- **Un tocco** senza trascinare sceglie l'oggetto sotto, come la freccia; con
  `Maiusc` lo aggiunge o lo toglie, con `Alt` lo toglie.
- **`Esc`** annulla il lazo e riporta la selezione di prima.
- **Dalla tastiera** `Spazio` comincia il lazo dove è il cursore del foglio,
  le frecce lo tirano e `Spazio`, o `Invio`, lo chiude.

Il lazo tiene un punto ogni due pixel dello schermo, al più 512: oltre, ne
lascia uno ogni due, e un giro lunghissimo resta leggero.

## Dentro i gruppi

Un clic sceglie l'oggetto in cima: di un rettangolo che sta in un gruppo,
il gruppo intero. Con `Ctrl` o `⌘` il clic sceglie l'oggetto più dentro
sotto il puntatore, e con `Maiusc` in più lo aggiunge alla selezione. Un
oggetto scelto così si trascina da solo, senza il gruppo, e `Maiusc` col
clic lo toglie. `Tab` e `Maiusc+Tab` passano agli oggetti accanto, nello
stesso gruppo.

Nell'albero degli oggetti anche un gruppo e un collegamento si aprono, chiusi
di partenza, e i loro oggetti si scelgono uno per uno. Quando la selezione
cambia dal foglio, l'albero apre ciò che contiene il primo oggetto scelto.

## Isolare un gruppo

Due tocchi su un gruppo, o su un collegamento, lo isolano; così anche
`Ctrl+Invio` o `⌘Invio` col gruppo scelto da solo, e «Isola il gruppo» nel
menu. Dentro il gruppo isolato si sceglie solo ciò che contiene: il resto del
disegno resta dov'è, si attenua e non si sceglie. Resta scelto l'oggetto
sotto i due tocchi, o il primo del gruppo, e lo si dice: «Gruppo isolato:
Gruppo, 2 oggetti. Si sceglie solo qui dentro; Esc esce.».

Ciò che si disegna entra nel gruppo isolato, come in Illustrator. Seleziona
tutto, Inverti, i simili, Sblocca tutto e Mostra tutto valgono dentro di lui,
e l'albero apre i gruppi fino a lui. Un gruppo dentro quello isolato si
isola a sua volta, coi due tocchi o con `Ctrl+Invio`. «Adatta» inquadra lo
stesso tutto il disegno.

In basso a sinistra sul foglio la barra «Gruppo isolato» dice dove si è: il
livello, o «Disegno» per un gruppo fuori dai livelli, e i gruppi fino a
quello isolato, l'ultimo, che non è un pulsante. Un gruppo del percorso è un
pulsante che torna a lui, e il primo esce del tutto. Si esce di un gruppo per
volta con la freccia all'inizio della barra, con `Esc` o con due tocchi sul
vuoto; resta scelto il gruppo da cui si esce, e un altro `Esc` svuota la
selezione. Un nome lungo si accorcia coi puntini, e la barra va a capo verso
l'alto.

Isolare è una scelta della vista: non entra nel file, non è un passo di
annulla e gli altri riquadri sullo stesso disegno non la vedono. Se il gruppo
se ne va, per un annulla o per chi lavora insieme, o se lo si blocca, si esce
da soli.

## Il menu della selezione

«Selezione avanzata», nella barra dopo «Elimina», apre il menu della
selezione. Lo stesso menu si apre col tasto destro, o col tocco lungo, sul
foglio con la freccia o il Lazo in mano, e dalla tastiera con `Maiusc+F10` o
col tasto del menu, sotto la selezione. Il tasto destro su un oggetto che non
è scelto prima lo sceglie.

- **Seleziona tutto** (`Ctrl+A`) e **Inverti la selezione**, che sceglie
  tutto il resto: di un gruppo con dentro un oggetto scelto, gli altri oggetti
  del gruppo e non il gruppo intero.
- **I simili**: «Stesso riempimento», «Stesso colore del contorno», «Stesso
  spessore del contorno», «Stesso tipo di oggetto», «Stesso strumento» e, coi
  livelli, «Stesso livello». Scelgono gli oggetti come quelli scelti, anche
  dentro i gruppi: i colori e lo spessore come li legge il pannello delle
  [proprietà](drawing-properties.md), il tipo come lo nomina l'albero, con
  l'evidenziatore distinto dalla penna. Lo strumento vale per i tratti a mano
  libera: la stessa penna, o lo stesso evidenziatore, con la stessa punta. Un
  gruppo è fra i simili soltanto se un gruppo è fra gli oggetti scelti; il
  livello guarda gli oggetti in cima.
- **Blocca** (`Ctrl+Maiusc+L`), **Nascondi** (`Ctrl+Maiusc+H`), **Sblocca
  tutto** e **Mostra tutto**, come dice «Bloccare e nascondere».
- **Isola il gruppo** (`Ctrl+Invio`) e, dentro un gruppo isolato, **Esci dal
  gruppo** (`Esc`).

Una voce che adesso non serve resta nel menu, sbiadita, e dice perché: «Scegli
prima degli oggetti.», o «Gli oggetti scelti non hanno questa proprietà.».

## Bloccare e nascondere

Un oggetto bloccato si vede e non si sceglie, né sul foglio né col Lazo, né
con Seleziona tutto; un oggetto nascosto non si vede. Bloccare e nascondere
valgono per gli oggetti scelti, anche un gruppo intero, e la selezione si
svuota; si dice quanti sono, «2 oggetti bloccati: non si scelgono finché non
li sblocchi.». Nel file l'oggetto ha `fub:locked="true"`, come un livello
bloccato, o `display="none"`, come lo intende ogni lettore di SVG: un
oggetto nascosto resta nascosto anche fuori da Fub ([Formato della
scena](../reference/scene-format.md)).

«Sblocca tutto» e «Mostra tutto» sbloccano e mostrano, in un passo, gli
oggetti che si vedono e si possono cambiare: quelli dei livelli visibili e
sbloccati, anche dentro i gruppi, e dentro il gruppo isolato se ce n'è uno.
Un livello bloccato o nascosto resta com'è, e così ciò che contiene; dentro
un gruppo bloccato non si mostra niente, e dentro uno nascosto non si
sblocca niente, perché non si vedrebbe.

Nell'albero degli oggetti una riga bloccata ha il lucchetto, una nascosta
l'occhio sbarrato, e il nome lo dice a parole: «Rettangolo, bloccato, Blu».
Al passaggio del puntatore, o sulla riga attiva, i segni spenti si vedono
appena: un clic su un segno blocca o sblocca, nasconde o mostra la riga
senza cambiare la selezione, e coi «Livelli» anche quella di un livello. Dalla tastiera fanno lo
stesso `Ctrl+Maiusc+L` e `Ctrl+Maiusc+H` sulla riga attiva, e il cambio si
dice: «Gruppo, 2 oggetti: nascosto.». Ciò che sta in un livello o in un
gruppo bloccato si sblocca da lui, e il suo segno non si tocca.

## Livelli e tasti

All'Essenziale non c'è niente di questa pagina: la freccia sceglie gli
oggetti in cima, e gli oggetti bloccati o nascosti da un file restano tali.
Nel Personalizzato il Lazo e la «Selezione avanzata» sono due parti, come
dice [Disegni, livello Personalizzato](drawing-custom.md); senza la seconda
non ci sono il menu, il clic dentro i gruppi, l'isolamento e il blocco, i
gruppi dell'albero non si aprono e i suoi segni dicono lo stato senza
cambiarlo. In un documento in sola lettura si sceglie, si isola e si
usa il menu, ma le voci che cambiano il file sono spente.

`?` elenca i tasti in «Selezione avanzata»: `Ctrl` col clic, `Ctrl+Invio`,
`Esc`, `Ctrl+Maiusc+L`, `Ctrl+Maiusc+H` e `Maiusc+F10`; con «Strumenti» il
Lazo, `Q`. Su macOS `⌘` vale per `Ctrl`.

La barra «Gruppo isolato» è una navigazione: dopo il foglio la si raggiunge
con `Tab`, ed `Esc` riporta al foglio senza uscire dal gruppo. Il gruppo dove
si è ha `aria-current`, e i pulsanti sono alti 44 pixel. Il lettore di
schermo sente in quale gruppo si entra e quando si esce; i segni dell'albero
non contano soltanto sulla forma, perché il nome dice lo stato a parole. Col
contrasto forzato la barra e i segni prendono i colori di sistema.
