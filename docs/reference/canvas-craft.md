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
| `off` | il componente «File delle app Craft» è spento | il nome, la specie dall'estensione, «Per aprirlo qui serve il componente …, che è spento»; solo «Apri con…» |
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

Il componente acceso o spento con la scheda viva la rifà (l'evento
`commands` dello store). «Accendi…» dalla scheda non c'è ancora.
