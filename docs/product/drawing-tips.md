# Disegni, punte delle linee

> **Per chi:** chi disegna schemi, quote e indicazioni, e vuole una punta
> all'inizio o alla fine di una linea.
> **Risultato:** sapere quali punte ci sono, dove si scelgono, di che colore
> e quanto grandi vengono, e che cosa ne fanno i comandi.

Dal livello Standard una linea, una spezzata o un tracciato aperto possono
avere una **punta** all'inizio e una alla fine, come nel pannello Traccia di
Illustrator. Si scelgono in «Aspetto», nel [pannello delle
proprietà](drawing-properties.md). Il modello è in
`apps/client/src/editors/spatial/tools/tips.ts`; dove SVG mette e gira un
marcatore, per la selezione e i riquadri, in `scene/markers.ts`.

## Le punte

- **Le forme:** Triangolo, Punta aperta, Cerchio, Quadrato, Rombo e Barra.
- **Le misure:** Piccola, Media e Grande, 3,5, 5 o 7 volte lo spessore
  della linea. È la larghezza del triangolo, della punta aperta e della
  barra; il cerchio, il quadrato e il rombo di traverso sono un po' più
  stretti. La punta cresce e cala con lo spessore: una linea più spessa ha
  una punta più grande, nelle stesse proporzioni.
- **La punta copre il capo della linea.** La cima del triangolo e del rombo
  sta poco oltre l'estremo, l'angolo della punta aperta è tondo: una linea
  con gli estremi quadrati o tondi non sporge mai dalla sua punta.
- **Chi può averle:** linee, spezzate e tracciati senza chiusura. Non le
  frecce, che hanno la loro testa, i poligoni regolari e le stelle, i tratti
  a penna, le linee a spessore variabile e i testi. Un gruppo passa il
  cambio alle sue parti; una parte bloccata resta com'è. Una forma chiusa
  con una punta scritta da un altro programma può soltanto toglierla.

## Nel pannello delle proprietà

«Punta d’inizio» e «Punta di fine» vengono in «Aspetto», dopo gli altri campi
del contorno, quando fra gli oggetti scelti c'è almeno una parte che può
averle. Ognuno è un pulsante che mostra la punta di quel capo su un tratto di
linea, col suo nome, e apre un menu:

- **le forme**, ciascuna con la sua figura, e «Nessuna» per toglierla;
- **«Un’altra punta»**, scelta e spenta, quando quel capo ha un marcatore che
  FubDraw non ha scritto: si vede com'è, e una forma della raccolta lo
  sostituisce;
- **le misure**, per una punta della raccolta;
- **«Scambia inizio e fine»**, che porta ogni punta al capo opposto.

Ogni scelta è un passo di annulla col suo nome: «Punta d’inizio», «Punta di
fine», «Misura della punta» o «Punte scambiate». Con più linee il pulsante
mostra ciò che hanno in comune, e «Misto» dove non sono d'accordo; ogni
scelta vale per tutte.

Da tastiera `Invio`, `Spazio` e `↓` aprono il menu sulla voce scelta, le
frecce scorrono le voci, ed `Esc` lo chiude tornando al pulsante. Il lettore
di schermo legge il pulsante col capo, la forma e la misura, «Punta di fine:
Triangolo, media».

## Il colore

- **Una punta ha il colore del contorno** della linea, con la sua opacità,
  scritto da lei o preso dal gruppo, e lo segue: cambiare il contorno, quello
  del gruppo che lo passa, ricolorare un campione o cambiare la sfumatura del
  contorno ricolora le punte nello stesso passo di annulla.
- **Un campione** resta un campione: la punta lo usa per nome, e cambia con
  lui ([Disegni, colori](drawing-colors.md)).
- **Una sfumatura** dà alla punta il colore e la trasparenza che ha nel
  punto dove la punta sta: la punta di una dissolvenza svanisce con la
  linea. Un motivo dà il suo colore di ripiego.
- **Senza contorno** la punta non si vede, ma resta, e riappare col
  contorno.
- **Con un contorno semitrasparente** il colore si somma dove la linea entra
  nella punta, perché SVG disegna la punta sopra la linea. L'opacità
  dell'oggetto, nel pannello delle proprietà, vale per tutt'e due insieme,
  e non lo fa.

## Nel file

Una punta è un marcatore fra le [risorse](drawing-resources.md) del
disegno, che la linea nomina con `marker-start` o `marker-end`. Le linee con
la stessa punta dello stesso colore ne usano una sola, e quando nessuno la
usa più se ne va, nello stesso passo.

```xml
<marker id="p1" fub:role="shared" fub:marker="triangle medium end"
  refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto">
  <path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="#0072b2"/>
</marker>
<line id="o1" x1="16" y1="20" x2="104" y2="20" stroke="#0072b2"
  stroke-width="3" marker-end="url(#p1)"/>
```

`fub:marker` dice la forma, la misura e il capo; FubDraw riconosce come sua
soltanto la punta che scriverebbe identica, e ogni altro marcatore è
«Un’altra punta». Come lo scrive il file è in [Formato della scena,
risorse](../reference/scene-format-resources.md#le-punte-delle-linee).

## Con gli altri comandi

- **Le Forbici e il Coltello** lasciano la punta d'inizio al pezzo che
  comincia dove cominciava la linea, e quella di fine al pezzo che finisce
  dove finiva; i pezzi in mezzo non ne hanno, e nemmeno quelli di una forma
  chiusa.
- **«Unisci»** dà al tracciato unito le punte dei capi rimasti liberi, al
  capo dove stanno, e lo strumento Nodi fa lo stesso quando unisce due capi.
  Un tracciato che si chiude non ne ha più. Aggiungere, togliere o spostare
  nodi le lascia ai capi: se si toglie il nodo di un capo, la punta passa al
  nodo che diventa il capo.
- **Le operazioni booleane e il costruttore di forme** fanno regioni, che
  non hanno punte.
- **«Contorno in tracciato»**, all'Esperto, fa delle punte della raccolta
  una forma sola col contorno. Una linea con «Un’altra punta», o con un
  marcatore sui nodi di mezzo, resta com'è, e il comando la conta fra
  quelle che non riesce a cambiare.
- **«Scostamento»** dà un tracciato senza punte; «Semplifica» e «Oggetto in
  tracciato» le lasciano dove sono.
- **Lo strumento Spessore e il profilo** non cambiano una linea con le
  punte, e lo dicono: prima si tolgono le punte.
- **«Incolla lo stile» e il contagocce** portano le punte della raccolta,
  anche in un altro disegno; un capo con «Un’altra punta» resta com'era.
  Il contagocce su una punta prende l'aspetto della sua linea.
- **Duplicare, copiare e incollare** portano le punte con la linea: in un
  altro disegno, una punta uguale a una che c'è già usa quella.
- **In Lettura e nell'export** le punte sono quelle del file, uguali a
  quelle del foglio.

## Livelli e parti

All'Essenziale le punte restano nel disegno e si vedono, ma i due campi non
ci sono. Nel [Personalizzato](drawing-custom.md) li porta la parte «Punte
delle linee». In un documento in sola lettura i campi mostrano le punte, e
non si aprono.
