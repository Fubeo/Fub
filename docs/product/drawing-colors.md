# Disegni, colori

> **Per chi:** chi vuole colori coerenti in tutto un disegno.
> **Risultato:** sapere che cos'è un campione, che cosa dice il contrasto e
> quali colori sono recenti.

Un disegno ha i suoi colori: i **campioni**, colori con un nome che gli
oggetti usano per riferimento, così che cambiarne uno cambia tutti quelli che
lo usano, e quelli scelti di recente. Il campo di un colore, nel [pannello
delle proprietà](drawing-properties.md), li offre tutti. Il contagocce se ne
è andato col livello Standard (decisione 0231). I campioni sono in
`apps/client/src/editors/spatial/tools/swatches.ts`.

## I campioni

Un campione è un colore del documento con un nome, «Blu mare» o «Rosso del
logo». Chi lo usa non scrive il colore ma il campione: quando il campione
cambia colore, cambiano tutti insieme, in un passo di annulla. Il file resta
un SVG che ogni programma apre, perché il campione è una sfumatura di un
colore solo, e chi lo usa scrive anche il colore, come ripiego.

```xml
<linearGradient id="r7k2m9q4x" fub:role="swatch" fub:name="Blu mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>
…
<rect id="o3c5e7g9j" x="40" y="40" width="200" height="120" fill="url(#r7k2m9q4x) #0072b2"/>
```

- **Si usano, non si fanno.** L'editor non fa più campioni, non li
  rinomina, non ne cambia il colore e non li elimina: la sezione «Colori del
  documento» se ne è andata col livello Standard (decisione 0231). Il campo
  di un colore li offre ancora, col loro nome, e chi ne sceglie uno lo usa.
- **I testi** usano un campione intero. Le righe e le parole non ne usano,
  perché il formato non dà loro riferimenti: quelle che scrivono un colore
  loro lo tengono.

Un colore lo usa chi lo mostra: il riempimento delle forme e dei testi, il
contorno, il colore di un tratto a penna, anche ereditati da un gruppo o da
un livello, e il nero di SVG dove nessuno scrive un riempimento. Contano anche
le forme dei motivi e dei marcatori, che dipingono chi li usa; non i punti
delle sfumature, né il contenuto dei ritagli e delle maschere.

## Il campo del colore e il contrasto

Nel pannello delle proprietà il campo di un colore legge anche il nome di un
campione, con le maiuscole a parte, e lo mostra col suo nome; il nome di un
campione vale prima di quello di un colore, perché è del disegno. Il
pulsante accanto al campo apre il selettore dei colori, con «Nessuno», i
consigliati della tavolozza, i colori del documento, i recenti e un colore
qualunque.

Sotto il Riempimento e il Contorno una riga dice il **contrasto con la
carta**, con l'opacità degli oggetti se è una sola. Per il riempimento di un
testo dà il livello di WCAG del testo normale e di quello grande, per il blu
`#0072b2` sul bianco «Contrasto con la carta 5,18:1. Testo normale: AA;
testo grande: AAA.»; per il resto dice se basta il 3:1 di una forma. La
carta è la prima del disegno, o il bianco; la riga non c'è per nessun
colore, un valore misto, una sfumatura o un motivo, e con una carta di
colore ignoto.

## I colori recenti

Un colore scritto e scelto entra fra i recenti: dal campo del
riempimento o del contorno e come colore con cui si disegna; anche il colore con cui si disegnava prima resta fra loro. Un
campione no, perché ha la sua griglia. I recenti valgono per tutti i disegni
e li ricorda la macchina, nello stato di vista `draw.colors`; i primi tre
sono anche nel menu radiale ([Disegni, vista ruotata, gesti e menu
radiale](drawing-view.md)).

## Fra disegni

Lo stile copiato vale per tutti i disegni aperti, e un campione che il
disegno non ha lascia il posto a quello con lo stesso nome, con le maiuscole
a parte, e lo stesso colore, o al suo colore; un'altra risorsa che manca, al
colore di ripiego. Incollando oggetti, un campione resta quello del disegno
con lo stesso id, o diventa quello con lo stesso nome e lo stesso colore, e
chi lo usa ne prende il colore come ripiego; altrimenti arriva, e con un nome
già preso, o che si legge come un colore, prende il primo libero, «Vermiglio
2» ([Disegni, risorse](drawing-resources.md#copiare-e-incollare)).

## Chi monta l'editor

I recenti arrivano con `colors`, dal più recente, e ogni scelta li manda a
`onColorsChange`; `setRecentColors` li cambia senza tornare a
`onColorsChange` (`apps/client/src/editors/spatial/tools/editor.ts`). Il
formato del campione, i riferimenti e la raccolta stanno in [formato della
scena, risorse](../reference/scene-format-resources.md).
