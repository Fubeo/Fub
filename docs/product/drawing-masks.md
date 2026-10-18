# Disegni, ritagli e maschere

> **Per chi:** chi vuole mostrare soltanto una parte di una foto, e chi
> compone forme che si ritagliano o si sfumano a vicenda.
> **Risultato:** sapere come si ritaglia un'immagine, come si fa e si
> rilascia una maschera, e che cosa ne fanno la selezione, gli altri comandi
> e l'export.

Dal livello Standard un'immagine si **ritaglia** sul foglio, come in
Illustrator o in PowerPoint: se ne sceglie la parte da mostrare, e l'immagine
resta intera nel file, pronta a mostrarne un'altra. All'[Esperto](drawing-expert.md)
le **maschere** fanno lo stesso con ogni oggetto: la forma in cima ritaglia
quelle sotto, o ne fa la trasparenza col suo chiaro e il suo scuro. Il
ritaglio è in `apps/client/src/editors/spatial/tools/crop.ts`, le maschere in
`tools/masks.ts`; la parte che si vede, per la selezione e i riquadri, in
`tools/clips.ts`.

## Ritagliare un'immagine

Con un'immagine scelta da sola, **«Ritaglia…»** nella barra «Disponi» apre il
ritaglio; con la Selezione bastano anche due tocchi sull'immagine. Il foglio
mostra l'immagine intera, attenuata, e sopra la parte che resta, coi suoi
segni ai lati e agli angoli; mentre si tira, la griglia dei terzi aiuta a
comporre. Finché il ritaglio è aperto, i gesti sul foglio sono suoi.

- **Tirare un segno** sposta quel lato, o i due di quell'angolo. Con `Maiusc`
  il ritaglio tiene le proporzioni che ha, con `Alt` resta attorno al suo
  centro; i due tasti si premono e si lasciano anche a metà del gesto, e il
  ritaglio si rifà subito, anche col puntatore fermo. Quando il segno si
  lascia vale ciò che i tasti dicono in quel momento. Il ritaglio non esce mai
  dall'immagine.
- **Tirare dentro** sposta l'immagine sotto il ritaglio, che resta fermo: si
  sceglie che cosa mostrare senza cambiare dove sta. L'immagine si ferma
  quando un suo bordo arriva al ritaglio. Le frecce la spostano di un'unità,
  con `Maiusc` di dieci.
- **La barra** sopra il foglio ha i quattro margini, «In alto», «A destra»,
  «In basso» e «A sinistra», nell'unità del documento, e dice quanto si
  vede: «Si vede 30 × 15 di 40 × 20». Un margine scritto cambia l'anteprima
  subito; uno che lascerebbe troppo poco dell'immagine lo dice, e non
  cambia niente. Un campo vuoto o che non si legge non cambia niente
  neppure: la barra dice di scrivere un valore, e lasciato il campo torna
  al margine che vale. Un margine non va sotto lo zero.

Il ritaglio si **applica** con `Invio`, con «Applica», con due tocchi dentro,
con un tocco fuori, che sceglie anche ciò che tocca come un tocco della
Selezione (con `Maiusc` lo aggiunge a ciò che era scelto, con `Ctrl` o `⌘`
sceglie dentro i gruppi), cambiando strumento o selezione, e prima di ogni
comando che cambia il disegno, come duplicare, eliminare o scrivere un valore
nel pannello delle proprietà. È un passo di annulla, «Ritaglio», e l'immagine
resta scelta, con la cornice sulla parte che si vede; un comando che cambia
il disegno ne fa due, il ritaglio e il suo, e lo vede già ritagliato. Si
**annulla** con `Esc`, con «Annulla» e con un annulla, che non annulla altro,
e quando cambiano il documento o il livello: il file resta com'era. Un
ripeti chiude il ritaglio e poi ripete come sempre.

Un ritaglio che c'è si riapre e si cambia allo stesso modo; portato
all'immagine intera, se ne va. **«Togli il ritaglio»**, nella barra
«Disponi», rende intere tutte le immagini scelte in un passo, qualunque
ritaglio abbiano. Un'immagine ritagliata da un altro programma con una forma
che non è un rettangolo mostra «Ritaglia…», che spiega di togliere prima quel
ritaglio.

Quando il ritaglio si apre, lo screen reader sente che cosa fanno i segni, le
frecce, `Invio` ed `Esc`; la barra mostra i margini e quanto si vede, e `?`
elenca i tasti del ritaglio. Poi dice la misura che si vede quando un segno si
lascia, e i margini quando l'immagine si sposta.

## Le maschere

All'Esperto **«Maschera»**, nella barra «Disponi», apre un menu con tre voci:

- **«Crea maschera di ritaglio»** (`Ctrl+7`, `⌘7`): l'oggetto in cima fra
  quelli scelti ritaglia gli altri. Ritaglia una forma o un testo; si vede
  ciò che sta dentro la sua area, e il colore non conta.
- **«Crea maschera d’opacità»**: l'oggetto in cima fa la trasparenza degli
  altri. Il bianco mostra, il nero nasconde, il grigio lascia vedere a metà:
  una sfumatura dal bianco al nero li dissolve. Può essere anche un gruppo
  di forme e testi.
- **«Rilascia maschera»** (`Ctrl+Alt+7`, `⌘⌥7`): la forma della maschera
  torna un oggetto, subito sopra chi la usava, col suo aspetto. Un gruppo
  che non aveva altro di suo si separa.

Gli oggetti mascherati entrano in un gruppo nuovo, al posto del più alto e
nel suo livello, come con «Raggruppa», e il gruppo resta scelto. Una forma in
cima che stava in un gruppo semitrasparente porta con sé quella trasparenza
nella maschera d'opacità, e mostra quanto si vedeva. Ogni comando
è un passo di annulla, che il nome dice: «Maschera di ritaglio», «Maschera
d’opacità» o «Rilascia maschera».

Una maschera non si crea, e il comando dice perché, con meno di due oggetti
scelti; quando quello in cima è un'immagine, un collegamento o un testo su
tracciato, o un gruppo per un ritaglio; quando è una linea, che non ha area;
quando porta già un ritaglio, una maschera, degli effetti che si vedono o un
filtro, e per una maschera d'opacità motivi o punte, che cambierebbero ciò che
mostra; gli effetti nascosti ci vanno, e tornano col rilascio; quando il
livello ha una trasformazione che lo schiaccia; quando l'oggetto in cima sta in
un gruppo con un ritaglio, una maschera, degli effetti o un filtro, o uno stile
del disegno ne cambierebbe l'aspetto dentro la maschera. Anche un rilascio si rifiuta, e lo
dice, se i pezzi finirebbero fuori posto o uno stile del disegno li farebbe
vedere diversi. Le voci spente del menu lo dicono prima, con le parole che il
comando direbbe, e il menu mostra i tasti di «Crea maschera di ritaglio» e di
«Rilascia maschera». «Separa» su un gruppo mascherato non lo separa, e ricorda
che una maschera si rilascia dal menu «Maschera».

Su una tastiera dove `AltGr+7` scrive un carattere, come la tedesca, dove
scrive «{», Windows manda `Ctrl+Alt` per AltGr: `Ctrl+Alt+7` scrive quel
carattere e non rilascia. La voce del menu c'è sempre.

## Ciò che si vede è ciò che si tocca

La selezione, la cornice, l'aggancio, le guide intelligenti, il lazo, la
gomma e l'export della selezione guardano la **parte che si vede**: un clic
sulla parte nascosta di un'immagine ritagliata non la sceglie, e la sua
cornice è quella del ritaglio, girata con l'immagine. Lo stesso vale dentro un
gruppo mascherato isolato, dove ogni oggetto è ritagliato dalla maschera del
gruppo, per un livello con un ritaglio scritto da un altro programma, e per le
punte di una linea ritagliata. Una maschera d'opacità conta per la sua area,
anche dove è nera. Un oggetto nascosto del tutto si sceglie dall'albero degli
oggetti.

## Con gli altri comandi

- **«Applica trasformazione»** porta il ritaglio di un'immagine nella sua
  geometria nuova: l'immagine ruotata resta ruotata, e il ritaglio la segue.
- **Duplicare, copiare e incollare** portano il ritaglio e la maschera con
  l'oggetto, ognuno coi suoi: cambiare il ritaglio di una copia non tocca
  l'originale.
- **In Lettura e nell'[export](drawing-export.md)**, in PNG, JPEG, PDF e
  SVG pulito, i ritagli e le maschere sono quelli del foglio.

## Nel file

Un ritaglio è un `clipPath` fra le [risorse](drawing-resources.md) del
disegno, suo e di nessun altro, con un rettangolo nelle coordinate
dell'immagine; spostare l'immagine sotto il ritaglio cambia soltanto `x` e `y`.

```xml
<clipPath id="c1" fub:role="private">
  <rect x="20" y="20" width="40" height="36"/>
</clipPath>
<image id="o1" x="12" y="12" width="64" height="64"
  clip-path="url(#c1)" href="data:image/png;base64,…"/>
```

Una maschera di ritaglio è un `clipPath` con la forma, una d'opacità una
`mask`, e il gruppo li usa con `clip-path` o `mask`. Come li scrive il file è
in [Formato della scena,
risorse](../reference/scene-format-resources.md#i-ritagli-e-le-maschere).

## Livelli e parti

Il ritaglio delle immagini viene dallo Standard, le maschere dall'Esperto.
Nel [Personalizzato](drawing-custom.md) li portano le parti «Ritaglia
immagine» e «Maschere di ritaglio e d’opacità». A un livello che non li ha, i
ritagli e le maschere restano nel disegno, si vedono e valgono per la
selezione; mancano i comandi. In un documento in sola lettura non ci sono.
