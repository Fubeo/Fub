# 0248 — Il disegno incorporato in una nota si modifica sul posto

- **Stato:** accolta
- **Data:** 2026-11-19
- **Ambito:** frontend
- **Sostituisce:** — (aggiorna il punto 7 della [0203](0203-superfici-spaziali.md))
- **Sostituita da:** —

## Contesto

La [0203](0203-superfici-spaziali.md) diceva, al punto 7, che un disegno
incorporato in una nota resta un'immagine del vault: un `<img>` servito come
`image/svg+xml` con `nosniff`, senza un secondo percorso per gli embed. Era
la scelta giusta finché la nota non aveva un modo di ospitare un editor: un
disegno vivo dentro il testo avrebbe voluto un suo widget, una sua sessione e
un suo salvataggio.

Con le schede vive nella nota (E19, T41) quel modo c'è: un file incorporato
da solo nel paragrafo è una scheda, e una scheda attiva monta l'editor vero
del file sulla stessa `DocumentSession` di un riquadro
(`CardEditorPort`, `editors/core/cards/editor-port.ts`). Il documento di
Word e il foglio si scrivono già così (T42, T44). Il piano dell'editor
(E20, T46) chiede lo stesso per i disegni: a riposo il disegno fermo, da
attiva la penna, le forme e il testo.

## Decisione

1. Nella nota un `.svg` incorporato da solo nel paragrafo è una scheda della
   specie `drawing` (`noteCardKindOf` di `editors/core/cards/contract.ts`).
   Sulla lavagna la specie resta `image`: lì l'SVG è un'immagine ferma.
2. A riposo la scheda mostra il disegno fermo con la scheda d'immagine così
   com'è: un `<img>` dal blob, mai l'SVG nel DOM. Il punto 7 della 0203 vale
   ancora per ciò che si vede a riposo, e per ogni SVG che non si modifica.
3. Da attiva, se il file è un disegno di Fub (`fub:version` sulla radice) e la
   nota si scrive, la scheda chiede alla porta delle schede l'editor del file:
   la superficie dei disegni montata **compatta** (`context.compact`). Si
   scrive nel `.svg`, sulla sua sessione, con le sue bozze e il suo
   salvataggio; la nota non cambia. Non nasce un secondo percorso di
   scrittura: è lo stesso editor di un riquadro, con la stessa operazione
   testuale.
4. Compatta, la superficie mette gli strumenti in una fila sopra il foglio
   (`cardChrome`), nello spazio Semplice con la barra della selezione; non
   offre «Esporta», non manda pannelli nell'ispettore (che è della nota) e
   non legge né scrive lo spazio e la colonna scelti per i disegni. «A tutta
   pagina» offre lo spazio Completo (`EditorSurface.setFullPage`).
5. Restano un'immagine ferma, senza scrittura: un SVG che non è un disegno di
   Fub (adottarlo riscriverebbe il file da dentro la nota: si adotta
   aprendolo), un file oltre il tetto della scheda d'immagine, e ogni disegno
   quando la superficie dei disegni non c'è (il componente spento).

## Conseguenze

### Positive

- Un disegno si ritocca senza lasciare la nota, con l'annulla, le bozze e i
  conflitti del suo file.
- Il formato dei disegni non cambia, e nemmeno il Markdown: l'embed resta
  `![[disegno.svg]]`.

### Negative

- Il punto 7 della 0203 non è più assoluto: chi legge la 0203 deve sapere che
  nella nota, da attiva, il disegno è vivo.
- La specie `drawing` esiste solo nella nota: la stessa estensione dà due
  specie secondo chi ospita la scheda.
- La scheda riconosce un disegno di Fub da un controllo testuale della
  radice; un falso sì lo corregge la superficie, che in una scheda mostra un
  SVG estraneo com'è e non lo adotta.
