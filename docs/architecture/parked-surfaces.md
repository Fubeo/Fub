# Le superfici da parte

> **Domanda:** che cosa succede alla superficie di una scheda di testo o di
> un foglio quando il riquadro passa a un'altra scheda, e quando si libera?
> **Fonti autorevoli:** `apps/client/src/state/document-controller.ts`
> (`ParkedSurface`, `parkSurface`, `unparkSurface`, `parkingWeight`), le
> prove «tornare a una scheda già aperta» in `apps/client/src/shell.e2e.test.ts`
> e «tornare a un foglio già aperto» in `apps/client/src/canvas-edit.e2e.test.ts`.

## In breve

Ogni riquadro mostra la superficie della scheda attiva
([superfici dell'editor](editor-surfaces.md)). Lasciando una scheda di testo
o un foglio che resta aperto nel riquadro, la sua superficie non si
distrugge: va **da parte**, nascosta, e tornarci la rimostra invece di
ricostruire l'editor. Le superfici da parte di un riquadro pesano al più
quattro (`MAX_PARKED`): una nota pesa uno, un foglio due.

Il motivo è il costo: rifare l'editor a ogni cambio di scheda voleva dire
montare un `EditorView` nuovo, rimettere il testo da capo e, per una nota
lunga, rifare il parser di tutto il documento. Per un foglio voleva dire
riaprire la cartella nell'host (rileggere i byte, `open_grid_bytes`) e
chiedere di nuovo le finestre di celle. Le cifre sono in
[il budget delle prestazioni](../product/performance-budget.md) e nello
scenario F4 del [banco WebView](../development/webview-measurements.md).

## Chi va da parte

Una superficie di una scheda che resta aperta nello stesso riquadro, con
la stessa superficie scelta, se è:

- una superficie di testo (profili `markdown` e `plain-text`) di un file
  del nucleo: peso uno;
- una superficie che lo dichiara (`EditorSurface.parking`, col suo peso):
  oggi il foglio di Excel nel riquadro, peso due, perché tiene anche la
  sua sessione aperta nell'host. Il foglio compatto di una scheda della
  lavagna non lo dichiara: è della scheda.

Restano fuori, e si smontano come prima: gli altri file di un componente,
che seguono l'acceso e lo spento dei componenti; i documenti mostrati dai
byte; le viste; la superficie d'errore. Una superficie che dichiara
`parking` nomina il suo documento in ogni modifica che emette
(`SurfaceCallbacks.onChange`): una conferma che arriva dal provider quando
il riquadro mostra già un'altra scheda va al suo documento, non a quello
davanti. Lasciare un foglio con una cella in conferma aspetta comunque la
conferma (`commitPending`) prima di staccarlo.

## Andare da parte

1. La superficie si stacca dalla sessione come a ogni cambio di scheda
   (`detachSurface`, che prima registra il testo in sospeso): il testo
   battuto è già nella `DocumentSession`, con la sua coda di salvataggio.
2. Il riquadro le toglie ciò che le aveva appeso: classi della nota, rilascio
   dei file, registratore, slide, stampa.
3. Il suo contenitore resta **dov'è**, nascosto (`hidden`), con la classe
   `pane-editor-riposo` al posto di `pane-editor`. Non si sposta perché è
   così che il browser conserva lo scorrimento. Un contenitore nuovo
   `pane-editor` prende il suo posto per la scheda che arriva.

Chi cerca la superficie del riquadro (i fogli, il CSS, le prove, i banchi)
la cerca sotto `.pane-editor`, e trova soltanto quella attiva. Ogni
superficie ha il suo contenitore perché scrive sul genitore (modalità,
interruzioni di riga) e ci ascolta eventi: due nello stesso si pesterebbero.

Da parte la superficie non riceve niente: né il testo, né la luce, né la
sola lettura. Un foglio da parte tiene aperta la sua sessione dell'host
(la cartella letta, la selezione, lo scorrimento, la cronologia) e non
chiede finestre.

## Tornare

Tornando sulla scheda il contenitore vuoto se ne va e quello della superficie
torna visibile. La superficie riceve, nell'ordine: il tema, se intanto è
cambiato; la modalità scelta; il testo della sessione con `syncDoc`, se
intanto è cambiato (un altro riquadro, il disco: fuori dalla cronologia
locale), se è cambiata la revisione dei byte da cui il testo discende (un
salvataggio, un'altra app: il foglio riapre la sua sessione dell'host sui
byte nuovi, con la stessa selezione e lo stesso scorrimento) o se la
lettura resa va ridisegnata dopo un salvataggio; poi si
riattacca alla sessione, che le rimette la sola lettura, e riprende classi e
allegati. Cursore, scorrimento e cronologia locale restano quelli della
scheda. Se qualcosa fallisce la superficie si smonta e la scheda si monta da
capo, come prima.

## Quando si libera

Una superficie da parte si distrugge, e tornarci rimonta la scheda da capo,
quando:

- il peso delle superfici da parte del riquadro passa quattro: si libera
  la meno recente, finché il peso torna sotto;
- la scheda si chiude o cambia superficie scelta (il confronto è documento
  più override, a ogni disegno del riquadro);
- la scheda si rinomina o si sposta cambiando estensione. Con la stessa
  estensione la superficie segue il nome nuovo, come quella davanti
  (`followRenameInPanes`): resta da parte e torna col suo cursore;
- il riquadro si chiude, o il vault cambia;
- cambiano i componenti montati, da cui vengono le forme sintattiche e
  gli editor dei file dei componenti (un foglio da parte compreso);
- un'apertura chiede un gesto o una pagina, che vogliono il montaggio che
  nasce da loro;
- la sessione del documento non c'è più.

Distruggerla chiama `destroy` della superficie, cioè dell'`EditorView` con i
suoi plugin e ascoltatori, e toglie il contenitore. Per un foglio `destroy`
chiude anche la sua sessione dell'host (`close_grid_bytes`): qualunque
strada porti fuori dal parcheggio, la sessione si chiude. Una divisione non
copia le superfici da parte nel riquadro nuovo.

## La testata al ritorno

La barra di formato e la bolla della selezione (`panels/format-bar.ts`)
seguono la superficie del riquadro. Se la barra della scheda che arriva ha
gli stessi gruppi, titoli e scorciatoie, i pulsanti restano: cambia soltanto
l'iscrizione allo stato della superficie, e lo stato si rilegge subito. La
riga si misura al fotogramma (`requestAnimationFrame`), non dentro il cambio:
la barra ristretta compare già nel primo disegno, senza un'impaginazione in
più.
