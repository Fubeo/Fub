# Disegni, sfumature

> **Per chi:** chi apre un disegno con riempimenti o contorni che passano da
> un colore all'altro.
> **Risultato:** sapere come le sfumature stanno nel file e che cosa ne
> fanno l'editor e i comandi.

Il riempimento e il contorno di un oggetto possono essere una
**sfumatura**: lineare, lungo una linea da un capo all'altro, o radiale, dal
centro al bordo di un cerchio o di un'ellisse. I suoi **punti** dicono quale
colore, e quanto opaco, sta dove. L'editor non ne fa più e non le cambia: lo
strumento Sfumatura e la sezione «Sfumatura» del pannello delle proprietà se
ne sono andati col livello Standard (decisione 0231). Le sfumature che un
file ha già restano e si vedono uguali, sul foglio, in Lettura e
nell'export. Il modello è in
`apps/client/src/editors/spatial/tools/gradients.ts`.

## Ogni oggetto ha la sua

Una sfumatura sta fra le [risorse](drawing-resources.md) del disegno, nelle
coordinate dell'oggetto: spostarlo, ruotarlo o ridimensionarlo la porta con
sé. Chi la usa scrive anche un colore di ripiego, la media dei suoi colori
pesata sull'opacità, per chi non sa disegnare le sfumature.

```xml
<linearGradient id="r4k9m2x7q" fub:role="private" x1="40" y1="100" x2="240" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#ffffff"/></linearGradient>
…
<rect id="o3c5e7g9j" x="40" y="40" width="200" height="120" fill="url(#r4k9m2x7q) #80b9d9"/>
```

- **Un oggetto con una sfumatura che il formato non conosce**, come una che
  ne eredita un'altra, resta estraneo: si vede com'è, e si sposta e si
  elimina intero ([Disegni, risorse](drawing-resources.md#che-cosa-resta-modificabile)).

## Con gli altri comandi

- **Duplicare, copiare e incollare** danno alla copia la sua sfumatura, con
  un nome nuovo: cambiare l'una non cambia l'altra ([Disegni,
  risorse](drawing-resources.md#i-comandi)).
- **«Incolla lo stile»** dà a ogni oggetto la sua copia.
- **In Lettura e nell'export** la sfumatura è quella del file, uguale a
  quella del foglio.
