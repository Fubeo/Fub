# Disegni, unità e guide

> **Per chi:** chi disegna su misura, in millimetri per la stampa o in pixel
> per lo schermo, e chi apre un disegno con le guide.
> **Risultato:** sapere come l'unità del documento cambia ciò che si legge e
> si scrive, e che cosa succede alle guide che un disegno porta.

Il [disegno](drawing.md) ha la sua unità di misura, che vale per i campi e
per ciò che l'editor dice. Le **guide del documento**, linee orizzontali e
verticali scritte nel file, restano dove sono quando un disegno le porta,
scritte da un altro programma o da una versione precedente, ma Fub non le
mostra, non le crea e non le cambia: i righelli e le guide se ne sono andati
con lo Standard (decisione 0231). Le unità sono in
`apps/client/src/editors/spatial/tools/rulers.ts`.

## L'unità del documento

L'unità si sceglie fra pixel, millimetri, centimetri, pollici e punti, nel
campo **Unità** della sezione «Documento» delle
[proprietà](drawing-properties.md). Un pollice vale 96 pixel, 25,4 millimetri e 72 punti, come nei fogli di stile. Cambiarla
è un passo di annulla, si annuncia, «Il documento ora misura in
millimetri.», e il disegno resta com'è: cambia soltanto come si leggono e si
scrivono le misure.

Nell'unità del documento ci sono:

- i campi di «Posizione e misure» e della misura della pagina, col nome che
  dice l'unità, «Larghezza (mm)»;
- il passo della griglia, che ogni unità ricorda per conto suo: 1, 2, 5, 10
  o 20 millimetri, da 5 la prima volta; 0,2, 0,5, 1, 2 o 5 centimetri, da
  0,5; un sedicesimo, un ottavo, un quarto, mezzo pollice o un pollice, da un
  quarto; 6, 12, 18, 36 o 72 punti, da 12; in pixel restano quelli di
  sempre;
- le misure che si leggono accanto al puntatore e quelle che si dicono:
  «Misure: 20 millimetri × 10,6 millimetri.», e le coordinate del cursore.

Lo spessore del contorno, la dimensione del testo e gli angoli restano nelle
loro unità.

## Nel file

Le guide e l'unità sono attributi della radice: `fub:guides="x 120; y 340.5
locked"` e `fub:units="mm"`. I pixel sono l'unità di serie e non si scrivono.
Fub non tocca `fub:guides`: i cambi agli oggetti lo lasciano com'era. La
grammatica è in [Formato della scena, unità e
guide](../reference/scene-format-rulers.md).
