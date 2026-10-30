# Disegni, campiture e motivi

> **Per chi:** chi apre un disegno con aree riempite di righe o di puntini,
> come in un disegno tecnico, in una mappa o in un grafico da stampare in
> bianco e nero, o con un proprio disegno ripetuto come motivo.
> **Risultato:** sapere come le campiture e i motivi stanno nel file e che
> cosa ne fanno l'editor, i comandi, la Lettura e l'export.

Il riempimento di un oggetto può essere una **campitura**: righe, righe
incrociate o puntini che si ripetono, sopra un fondo o sul trasparente. Una
campitura distingue un'area anche dove i colori non bastano: in bianco e
nero, in fotocopia, per chi non vede alcune tinte. Un disegno può portare
anche dei **motivi del documento**, che riempiono gli oggetti ripetendosi.
L'editor non ne fa più e non li cambia: la sezione «Campitura» del pannello
delle proprietà se n'è andata col livello Standard (decisione 0231). Le
campiture e i motivi che un file ha già restano e si vedono uguali. Il
modello delle campiture è in
`apps/client/src/editors/spatial/tools/hatches.ts`.

## Le campiture pronte

| Campitura | Che cosa disegna |
|---|---|
| Diagonale | righe oblique, che salgono verso destra |
| Incrociata | due serie di righe oblique, a rete |
| Orizzontale | righe orizzontali |
| Puntinata | puntini sfalsati, a quinconce |
| Quadrettata | righe orizzontali e verticali, a quadretti |

- **Ogni oggetto ha la sua**, nelle sue coordinate, come una
  [sfumatura](drawing-gradients.md): spostarlo, ruotarlo o ridimensionarlo
  dalle maniglie la porta con sé, e ingrandito ha le righe più larghe e più
  spesse.
- **Chi la usa scrive anche un colore di ripiego**: il colore delle righe
  mescolato al fondo secondo la parte che coprono, o il colore delle righe
  senza fondo. È quello che mostra un programma che non sa disegnare i
  motivi, ed è vicino a ciò che l'occhio vede da lontano.

## I motivi del documento

Un motivo del documento è una copia di oggetti, nel riquadro di ciò che
disegnano, che riempie un oggetto ripetendosi uno accanto all'altro senza
spazio. Fub non ne fa più (decisione 0231): li disegna, li conserva e li copia
con gli oggetti che li usano.

- **La distanza fra le ripetizioni** la dà il riquadro: per lasciare
  spazio, si sceglie anche un rettangolo senza riempimento né contorno,
  dietro gli oggetti e più grande di loro, come la mattonella di
  Illustrator. Non si vede, e il motivo si ripete alla sua misura.
- **Un motivo è del documento,** come un [campione](drawing-colors.md#i-campioni):
  resta anche quando nessuno lo usa, e il suo nome è diverso da quelli dei
  campioni e degli altri motivi. Chi lo usa scrive come ripiego il colore
  medio del motivo.
## Distinguere le aree

Un grafico, una mappa o uno schema che affidano un significato al colore
non si leggono in bianco e nero, né da chi non vede quelle tinte. La
[verifica dell'accessibilità](drawing-accessibility.md) lo dice quando due
colori usati come codice si distinguono soltanto per la tinta (S017). Non
propone più una correzione: dare una campitura alle aree era della sezione
«Campitura», che se n'è andata.

## Con gli altri comandi

- **Duplicare, copiare e incollare** danno alla copia la sua campitura, con
  un nome nuovo: cambiare l'una non cambia l'altra. Un motivo del documento
  resta in comune, come un campione ([Disegni,
  risorse](drawing-resources.md#i-comandi)).
- **«Incolla lo stile»** dà a ogni oggetto la sua copia della campitura, e
  lo stesso motivo del documento; in un altro disegno, che quel motivo non
  ha, il suo colore di ripiego.

## In Lettura e nell'export

In Lettura, in PNG, in JPEG e nell'SVG pulito le campiture e i motivi sono
quelli del foglio; l'SVG pulito li scrive come motivi di SVG, senza ciò che
serve soltanto a FubDraw. Nel PDF restano vettoriali, ripetuti dal lettore
come sul foglio ([Disegni, esportare](drawing-export.md)).

## Nel file

Una campitura è un motivo di SVG privato con `fub:pattern`, che dice in
sei parole il genere, l'angolo, il passo, lo spessore, il colore delle
righe e il fondo, e il contenuto ne discende; un motivo del documento ha il
suo nome in `fub:name`, come un campione.

```xml
<pattern id="r3h8k2m5q" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 8 1.5 #000000 #56b4e9">
  <rect width="8" height="8" fill="#56b4e9"/>
  <rect y="3.25" width="8" height="1.5" fill="#000000"/>
</pattern>
…
<rect id="o1" x="10" y="10" width="60" height="40" fill="url(#r3h8k2m5q) #4692bd"/>
```

Un motivo scritto da un altro programma si vede e si conserva. La grammatica, il ripiego e quando un motivo è una
campitura di FubDraw sono in [Formato della scena,
risorse](../reference/scene-format-resources.md#le-campiture-e-i-motivi).
