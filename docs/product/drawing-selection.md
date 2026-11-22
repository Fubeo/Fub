# Disegni, selezione

> **Per chi:** chi sceglie fra molti oggetti, dentro i gruppi, o vuole
> mettere da parte qualcosa mentre lavora sul resto.
> **Risultato:** sapere come si sceglie coi simili e dentro i gruppi, come si isola un gruppo e come si bloccano e si nascondono gli
> oggetti uno per uno.

Nello spazio Completo il [disegno](drawing.md) sceglie in più modi della sola
freccia: il menu «Selezione avanzata», i clic dentro i gruppi, i gruppi
isolati; e gli oggetti si bloccano e si nascondono uno per uno, non
solo per livello. Scegliere e isolare non cambiano il file; bloccare e
nascondere sì, e sono passi di annulla
(`apps/client/src/editors/spatial/tools/selecting.ts`, l'indice in
`apps/client/src/editors/spatial/tools/hit/`). Lo strumento Lazo di Fub se
n'è andato col livello Standard (decisione 0231): il riquadro che la freccia
tira sul vuoto sceglie ciò che racchiude per intero. Nel Disegno completo il
Lazo torna come strumento del motore (sotto).

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

## Gli strumenti del motore nel Disegno completo

Nel Disegno completo la colonna ha anche gli strumenti del motore del disegno
per scegliere e per la vista: **Selezione (Completo)**, **Selezione diretta** e
**Selezione gruppo**, **Lazo** nel gruppo «Scegli»; **Mano (Completo)**, **Zoom (Completo)** e
**Ruota vista** nel gruppo della vista. Ognuno ha il suo nome nella lingua
dell'interfaccia e la sua icona, dopo gli strumenti di Fub della stessa
casella. Il Semplice tiene solo gli strumenti di Fub.

Scegliere uno di questi strumenti prepara la sua famiglia («nucleo»): finché
si prepara la casella dice «Selezione diretta: si prepara…», e lo strumento di
prima resta in mano. Se la famiglia non si prepara la casella lo dice
(«non si è preparato. Sceglilo di nuovo per riprovare.»): sceglierlo di nuovo
ci riprova, e intanto si disegna con lo strumento di prima. Appena la famiglia
è pronta compare in testata la fila delle opzioni dello strumento, senza
bisogno di un gesto sul foglio. Gli strumenti di scelta del nucleo non hanno
opzioni da mostrare, e la fila resta vuota; le coordinate del punto scelto con
la Selezione diretta non ci sono ancora, perché il motore non le dà.

Mano, Zoom e Ruota vista del motore spostano, ingrandiscono e girano la vista
di Fub, come la Mano e la Lente di Fub: la vista non cambia il file. Un tratto
a mano libera (`fub:ink`) si sceglie e si sposta, ma gli strumenti del motore
non ne cambiano i punti. Scegliere uno strumento di Fub toglie quello del
motore. Il codice: `apps/client/src/editors/spatial/completo/colonna.ts`,
`apps/client/src/editors/spatial/tools/editor/chrome/rail.ts`,
`apps/client/src/editors/spatial/motore/gesti.ts`.

L'isolamento di un gruppo è di Fub anche nel Disegno completo: «Isola il
gruppo» ed «Esci dal gruppo» stanno nel menu del tasto destro, `Esc` esce
dall'isolamento prima di svuotare la selezione, e riaprendo il disegno non si
è più dentro il gruppo.

## Il menu della selezione

«Selezione avanzata», nella barra dopo «Elimina», apre il menu della
selezione, con tutte le voci che seguono.

**Riseleziona** ripete l'ultimo comando di selezione (per esempio Uguale ›
Colore riempimento): dopo Deseleziona riparte dalla selezione di prima. Il
ricordo sta nella sessione del disegno aperto: si perde chiudendo il disegno
o cambiando il testo dall'esterno. Senza un comando di selezione prima, la
voce è spenta e dice che cosa fare. Le selezioni salvate e la bacchetta magica
non ci sono ancora: il formato del disegno non ha ancora un posto per loro.

Il tasto destro del mouse sul foglio, con ogni strumento, il tocco lungo con
la freccia in mano e, dalla tastiera, `Maiusc+F10` o il tasto del menu, sotto
la selezione, aprono invece un menu più corto. Con la freccia il tasto
destro su un oggetto che non è scelto prima lo sceglie.

- Senza niente di scelto restano le sole voci che adesso fanno qualcosa:
  **Incolla** (`Ctrl+V`), **Incolla nello stesso punto** (`Ctrl+Maiusc+V`),
  **Seleziona tutto** (`Ctrl+A`), **Mostra tutto il disegno** (`Maiusc+1`) e
  **Menu radiale** ([Disegni, vista, gesti e menu
  radiale](drawing-view.md#il-menu-radiale)). A chi legge soltanto restano
  Seleziona tutto e Mostra tutto il disegno.
- Con una selezione, Taglia, Copia e Incolla stanno nella riga dei pulsanti
  in cima; sotto, lo stile, **Seleziona
  simili** in un sottomenu, Blocca, Nascondi, Isola il gruppo, Esci dal
  gruppo dentro un gruppo isolato, e Menu radiale: sempre meno di nove voci.

Il resto, Incolla nello stesso punto con una selezione, Inverti la
selezione, Rinomina, Sblocca tutto e Mostra tutto, si trova scrivendo, come dice il piede «Scrivi per trovare altro».

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

### Nel menu ≡ › Selezione del Disegno completo

Nel Disegno completo il menu ≡ › Selezione ha le voci del motore che scelgono
gli oggetti. Scegliere non cambia il file e non passa da Annulla.

- **Tutto nella tavola attiva** (`Ctrl+Alt+A`) sceglie tutti gli oggetti della
  tavola attiva.
- **Uguale** sceglie gli oggetti che hanno lo stesso valore di quello scelto,
  con il confronto del motore: **Aspetto**, **Metodo di fusione**, **Riempimento
  e tratto**, **Colore riempimento**, **Opacità**, **Forma** (il tipo di forma),
  **Colore tratto**, **Spessore tratto** e **Istanza di simbolo**, che sceglie
  le istanze dello stesso simbolo. Gli oggetti senza tratto sono uguali fra
  loro: con un oggetto senza tratto, **Colore tratto** sceglie tutti quelli
  senza tratto. **Famiglia di font**, **Famiglia e stile font**, **Famiglia,
  stile e dimensione font**, **Dimensione font**, **Colore riempimento testo** e
  **Colore tratto testo** confrontano il testo scelto: sceglie gli oggetti che
  hanno un testo con lo stesso valore, anche dentro i gruppi.
- **Oggetto** ha **Tutto sugli stessi livelli**, che sceglie gli oggetti dei
  livelli dell'oggetto scelto, e **Tutti gli oggetti di testo**, che sceglie
  tutti gli oggetti di testo del disegno. **Punti isolati** sceglie i tracciati
  di un solo punto, e **Tracciati aperti** quelli che non sono chiusi.
- **Tutto**, **Inversa**, **Oggetto successivo sopra** e **sotto**, e
  **Deseleziona** scelgono o tolgono la selezione, senza cambiare il file.

Una voce che non vale per ciò che è scelto resta nel menu, sbiadita, con il
perché del motore: «Scegli un oggetto.» senza scelta, «Scegli un testo.» sulle
voci del testo quando la scelta non ha testo, sulla voce Istanza di simbolo
«Non è un'istanza.» quando la scelta non è un'istanza, e «Nel disegno non ci
sono punti isolati.» (o tracciati aperti) quando il disegno non ne ha.

Non sono ancora nel menu: **Riseleziona**, le selezioni salvate (**Salva
selezione…**, **Aggiorna selezione**, **Richiama** e **Modifica selezione…**),
**Seleziona testo per font**, **Avvia modifica globale** e la bacchetta
magica. Dentro **Oggetto** mancano **Maschere di ritaglio**, **Maniglie di
direzione**, **Pennellate**, **Sezioni**, **Oggetti testo per punti** e
**Oggetti testo in area**: il motore non distingue il testo con la larghezza di
Fub da quello di punto, perché il suo importatore legge il testo in area solo
dai `flowRoot`. **Punti**, **segmenti** e **colore** non sono voci del menu: il
motore le vuole con un punto o un colore già scelti, e restano nell'ispettore.

## Bloccare e nascondere

Un oggetto bloccato si vede e non si sceglie, né sul foglio né con
Seleziona tutto; un oggetto nascosto non si vede. Bloccare e nascondere
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

### Nel menu ≡ › Oggetto del Disegno completo

Nel Disegno completo il menu ≡ › Oggetto ha anche i comandi del motore del
disegno, e ognuno è un passo solo di Annulla e di Ripristina:

- **Raggruppa** mette gli oggetti scelti in un gruppo nuovo, con un id nuovo,
  nel livello e al posto che il motore sceglie; gli oggetti tengono id,
  ordine e testo, e il resto del file non cambia.
- **Blocca** e **Nascondi** scrivono `fub:locked="true"` e `display="none"`
  sugli oggetti scelti, come sopra; **Blocca tutto ciò che non è scelto** e
  **Nascondi tutto ciò che non è scelto** fanno lo stesso con gli altri
  oggetti dei livelli che si vedono.
- **Sblocca tutto** e **Mostra tutto** sono quelli di Fub, con la regola di
  «Bloccare e nascondere»: un livello bloccato o nascosto resta com'è, con ciò
  che contiene.

Un oggetto nascosto da uno stile (`style="display:none"`) non si mostra da
qui: il motore lo rifiuta, e il file non cambia. In un documento in sola
lettura questi comandi sono spenti. Non ci sono ancora «Tutta la grafica
soprastante» e «Altri livelli» di Blocca e Nascondi, «Invia al livello
corrente» e «Riseleziona».

## Spazi e tasti

Nel Semplice non c'è niente di questa pagina: la freccia sceglie gli
oggetti in cima, e gli oggetti bloccati o nascosti da un file restano tali.
Per chi monta l'editor con le sue parti la «Selezione avanzata» è una parte, come
dice [Disegni, spazio di lavoro e barra](drawing-custom.md); senza
non ci sono il menu, il clic dentro i gruppi, l'isolamento e il blocco, i
gruppi dell'albero non si aprono e i suoi segni dicono lo stato senza
cambiarlo. In un documento in sola lettura si sceglie, si isola e si
usa il menu, ma le voci che cambiano il file sono spente.

`?` elenca i tasti in «Selezione avanzata»: `Ctrl` col clic, `Ctrl+Invio`,
`Esc`, `Ctrl+Maiusc+L`, `Ctrl+Maiusc+H` e `Maiusc+F10`. Su macOS `⌘` vale per `Ctrl`.

La barra «Gruppo isolato» è una navigazione: dopo il foglio la si raggiunge
con `Tab`, ed `Esc` riporta al foglio senza uscire dal gruppo. Il gruppo dove
si è ha `aria-current`, e i pulsanti sono alti 44 pixel. Il lettore di
schermo sente in quale gruppo si entra e quando si esce; i segni dell'albero
non contano soltanto sulla forma, perché il nome dice lo stato a parole. Col
contrasto forzato la barra e i segni prendono i colori di sistema.
