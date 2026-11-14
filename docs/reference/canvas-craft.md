# La scheda dei file Craft sulla lavagna

> **Ambito:** come una scheda di un `.canvas` mostra un disegno di
> VectorCraft, un progetto di FigCraft o un'immagine di PhotoCraft.
> **Fonti autorevoli:** `apps/client/src/editors/canvas/cards/craft.ts`
> (`craftCardRenderer`, `CraftCardPort`), `CRAFT_EXTENSIONS` in
> `apps/client/src/editors/canvas/cards.ts`, il lato della shell in
> `apps/client/src/state/document-controller.ts` (`canvasCards.craft`,
> `openCardWith`); le prove in `cards/craft.test.ts` e `cards.test.ts`.

Un file `.vectorcraft`, `.figcraft` o `.pcraft` è una scheda di specie
`craft` ([le specie](canvas-cards.md#le-specie)). L'XMP di LightCraft no:
sono i dati di una foto, senza un'immagine sua, e resta una scheda di file.

## Che cosa mostra

| Stato (`data-card-state`) | Quando | Che cosa si vede |
|---|---|---|
| `picture` | l'anteprima `large` ha un'immagine | l'immagine intera, sul foglio bianco; «Apri» e «Apri con…» in una barra in basso, al passaggio, col fuoco o con la scheda scelta |
| `card` | l'anteprima non ha un'immagine | il nome, la riga dei dati (`craftInfoText`), perché manca, con le frasi della scheda di N7 (nessuna anteprima, file rotto, oltre il peso massimo, in coda, l'app non ci è riuscita); «Apri» e «Apri con…» sotto |
| `off` | il componente «File delle app Craft» è spento | il nome, la specie dall'estensione, «Per aprirlo qui serve il componente …, che è spento»; «Accendi…» e «Apri con…» (vedi [Accendi…](#accendi)) |
| `unreadable` | il comando non risponde, o l'immagine non si decodifica | la ragione; il doppio clic apre il file, come per le altre schede ([il file che manca](canvas-cards.md#il-file-che-manca)) |
| `missing` | `craft.preview` risponde `not_found` | la scheda «File mancante» della tela |
| `loading`, `placeholder` | si chiede; ferma senza immagine in cache | «Apro…»; la sigla del formato e il percorso |

L'anteprima la chiede `previewOf(path, "large")` di
`state/craft-previews.ts`, che non avvia mai l'app. L'immagine diventa
un'immagine ferma larga al più il doppio della scheda, nella cache delle
schede con la parte `craft@<larghezza>`: la scheda ferma la mostra e una
scheda riaccesa non richiede. Un file cambiato la fa dimenticare (`watch`).
La proporzione dell'immagine è il `contentAspect` della scheda, che
l'inchiostro segue.

## Il consenso

L'anteprima fatta dall'app la chiede soltanto un clic, e soltanto col
consenso `craft.cli-previews` acceso: allora la scheda senza immagine offre
«Crea l'anteprima con …» (`renderPreview(path, "large")`). Spento, la scheda
dice che le anteprime delle app sono spente; da chiedere, rimanda al file,
dove la scheda di N7 fa la domanda. La scheda non chiede mai l'anteprima da
sé: montarsi sulla lavagna non è un gesto.

## Aprire

- «Apri» e il doppio clic aprono il file nella modalità di Fub, come il menu
  della scheda; col componente spento il doppio clic porta al riquadro «solo
  come file».
- «Apri con…» apre sotto il pulsante il menu delle app di
  [«Apri con un'altra app»](external-editors.md) (`openWithEntry`): l'app del
  sistema e le app Craft che aprono il file, col prestito della sessione.
  Senza app Craft installate il file va all'app del sistema.
- Invio sulla scheda la fa entrare, con la barra dei pulsanti in vista: da
  lì Tab arriva a «Accendi…», «Apri» e «Apri con…», ed Esc esce. Senza barra
  (caricamento, segnaposto, file mancante) non c'è in cui entrare.

Il componente acceso o spento con la scheda viva la rifà (l'evento
`commands` dello store).

## Accendi…

Col componente spento la scheda offre «Accendi…» accanto a «Apri con…», al
posto che avrebbe «Apri». La riga che serve è quella che la mappa dei
componenti dà per `UI_CRAFT` (`offRowFor`, `fub.craft`): «Accendi…» apre la
pagina Componenti sulla sua riga, col fuoco sull'interruttore, con
`showComponent(id)` di `ui/commands.ts`. Non accende niente: accende l'utente,
e la scheda passa da sola ad «Apri» quando il componente è acceso.

- Senza riga con id, o col componente che non c'è in questa build, «Accendi…»
  non si offre e la scheda dice la ragione senza nome.
- Se nessuno apre la riga (`showComponent` dà falso, come senza impostazioni
  montate), il clic ritira «Accendi…» e il fuoco va su «Apri con…». Un
  controllo senza clic non c'è: `ui/commands.ts` non dice se una porta è
  registrata.
- Una scheda tolta mentre la pagina si apre non tocca più il DOM.
