# Disegni, etichette nelle forme

> **Per chi:** chi fa schemi, diagrammi di flusso o mappe, e vuole scrivere
> dentro una forma un testo che resti al centro quando la forma cambia.
> **Risultato:** sapere come si scrive e si cambia l'etichetta di una forma,
> dove sta e come segue la forma, quando se ne va, e che cosa ne fanno i
> comandi, la Lettura e l'export.

Dallo Standard una forma chiusa ha un'etichetta: un testo scritto dentro di
lei, al centro, che va a capo nella sua larghezza. Una forma chiusa è un
rettangolo, un'ellisse, un cerchio, un poligono, una stella o un tracciato
chiuso. Quando la forma si sposta, si gira o cambia misura, l'etichetta
torna al centro e rifà le righe nello stesso passo di annulla, come in Visio
e in PowerPoint. Il posto e il seguire sono in
`apps/client/src/editors/spatial/tools/labels.ts`, chi ha un'etichetta in
`tools/label-hosts.ts`.

## Scrivere un'etichetta

- **Due tocchi su una forma chiusa,** con la Selezione, aprono il campo del
  testo al suo centro, largo quanto la forma, anche nel vuoto di una forma
  senza riempimento, dove un tocco solo non la sceglie. Con la forma scelta
  da sola lo aprono anche `F2` e «Modifica il testo» nella barra «Disponi».
  Il campo si chiama «Etichetta nella forma».
- **Si scrive come in ogni testo** ([Disegni](drawing.md#testo)): `Invio` va
  a capo, `Esc`, `Tab`, un tocco sul foglio o il fuoco che va altrove
  concludono. Le righe vanno a capo da sole nella larghezza della forma, e il
  blocco resta al centro mentre cresce.
- **L'etichetta nuova** ha il colore, il carattere e la dimensione dello
  strumento Testo, centrata. Entra nel file in un passo di annulla,
  «Etichetta nella forma», e l'annuncio dice «Etichetta aggiunta.». Un campo
  lasciato vuoto non scrive niente.
- **Una forma che sta in un livello** entra in un gruppo nuovo con la sua
  etichetta, al suo posto, e il gruppo resta scelto. Una forma che sta già in
  un gruppo riceve l'etichetta accanto, e resta scelta lei.

## Cambiarla

- **Gli stessi gesti** aprono l'etichetta che c'è: due tocchi sulla forma,
  sul gruppo che la tiene con la sua etichetta, o sull'etichetta stessa, `F2`
  o «Modifica il testo». Concluso, resta scelto ciò che lo era.
- **Due tocchi sul gruppo** di una forma e della sua etichetta cambiano
  l'etichetta invece di isolare il gruppo; il gruppo si isola ancora con
  `Ctrl+Invio` o `⌘Invio` e con «Isola il gruppo»
  ([Disegni, selezione](drawing-selection.md)).
- **`F2` su una forma chiusa** ne scrive l'etichetta, e non la rinomina: il
  nome si cambia nell'albero degli oggetti o con «Rinomina» nel menu, che per
  queste forme non suggerisce `F2`.
- **L'aspetto** si cambia come per ogni testo, scegliendo l'etichetta. Col
  gruppo scelto, il riempimento e il contorno del pannello sono quelli della
  forma, e l'etichetta tiene il suo colore; il carattere e il corpo sono i
  suoi.

## Dove sta

- **Al centro del riquadro del testo,** il rettangolo più grande che sta
  dentro la forma: il rettangolo stesso, rientrato agli angoli tondi;
  quello coi vertici sul bordo, in un'ellisse; in un triangolo o in una
  stella, il più largo che il contorno lascia, e l'etichetta va lì.
- **La larghezza** è quella del riquadro meno 6 unità per parte, e le righe
  ci vanno a capo; non è mai meno del corpo del testo.
- **Il testo non cresce** con la forma: resta del corpo scritto. Ciò che non
  ci sta in altezza esce sopra e sotto in parti uguali.
- **Una forma girata** gira la sua etichetta; una forma specchiata no, e le
  righe restano dritte, girate al più di un quarto di giro.
- **Un'etichetta che esce dalla pagina** la fa crescere nello stesso passo,
  come ogni oggetto nuovo.

## Seguire la forma

- **Una forma che cambia** riporta al centro la sua etichetta e ne rifà le
  righe, nello stesso passo di annulla. Vale per spostarla, ridimensionarla e
  girarla, per cambiarne la geometria dal pannello o coi nodi, e per
  cambiare il testo.
- **Spostare il gruppo** sposta forma ed etichetta insieme.
- **Un'etichetta spostata da sola,** con la Selezione, si stacca: diventa un
  testo qualunque, dove la si è messa.
- **Una forma tolta,** portata fuori dal gruppo o aperta, lascia la sua
  etichetta come un testo qualunque.
- **Cambiare l'id della forma,** dal pannello degli attributi, non la stacca:
  l'etichetta e i connettori che la nominano ricevono l'id nuovo nello stesso
  passo, e un annulla rimette tutto. Se uno di loro sta in un livello o in un
  gruppo bloccato, l'id non cambia, e il pannello dice di sbloccarlo prima.
- **In un livello o in un gruppo bloccato** un'etichetta non si riscrive.

## Toglierla

- **Svuotare l'etichetta** la toglie in un passo, «Rimozione
  dell'etichetta», e l'annuncio dice «Etichetta tolta.». Il gruppo si
  scioglie, e la forma torna com'era, se teneva soltanto lei e l'etichetta,
  senza titolo, descrizione né effetti, e se niente vi è agganciato, come un
  connettore.
- **Eliminare l'etichetta,** scelta da sola, la toglie come ogni testo, e il
  gruppo resta.

## Con gli altri comandi

- **Duplicare, copiare e incollare** la forma o il gruppo dà una copia con la
  sua etichetta, che segue la copia. L'etichetta copiata da sola è un testo
  qualunque ([Disegni, appunti](drawing-clipboard.md)).
- **Un connettore agganciato al gruppo** tocca il contorno della forma:
  l'etichetta non conta, nemmeno quando esce dalla forma ([Disegni,
  connettori](drawing-connectors.md)).
- **Un testo su tracciato** e l'etichetta di un connettore seguono la loro
  linea, e non sono mai etichette di una forma.

## In Lettura e nell'export

- **L'albero degli oggetti** chiama una forma con le parole della sua
  etichetta, perché sono il testo che si vede: «Rettangolo «Inizio»». Se la
  forma ha un titolo, il titolo prende il posto del tipo: una decisione delle
  raccolte con l'etichetta «Controlla l'ordine» è «Decisione «Controlla
  l'ordine»», non «Tracciato «Decisione»». Il gruppo che tiene soltanto loro
  due ha il nome della forma, «Gruppo «Controlla l'ordine», 2 oggetti», se
  non ha un titolo suo. Così anche i connettori: «Connettore da «Inizio» a
  «Controlla l'ordine»». Le righe dell'etichetta si leggono come sono
  scritte: una che continua una parola, come il «?» di «Pronto?», si unisce
  senza spazio.
- **In Lettura** l'etichetta è un testo, e la forma ha lo stesso nome che
  nell'albero ([Disegni, accessibilità](drawing-accessibility.md)).
- **Nell'export** un altro programma vede un gruppo con una forma e un testo,
  dove FubDraw lo mostra. L'SVG pulito toglie gli attributi di FubDraw, e nel
  PDF il testo resta testo ([Disegni, esportare](drawing-export.md)).

Il banco di fedeltà (`apps/client/bench/fidelity.mjs`) confronta il foglio,
la Lettura e il PNG anche su quattro etichette: in un rettangolo, su due
righe in un'ellisse, in un rettangolo tondo e girato, e in un rombo.

## Nel file

L'etichetta è un `text` con `fub:inside`, che porta l'id della forma, nello
stesso gruppo della forma. `fub:wrap` è la larghezza in cui va a capo, e il
`transform` la mette già al centro.

```xml
<g id="o4d5e6f7g">
  <rect id="o2b3c4d5e" x="100" y="100" width="200" height="120" fill="#e69f00"/>
  <text id="o8m3n4p5r" fub:inside="o2b3c4d5e" fub:wrap="188" x="0" y="0" fill="#000000" font-family="Inter, sans-serif" font-size="32" text-anchor="middle" transform="matrix(1 0 0 1 200 168.8)">
    <tspan x="0" dy="0">Inizio</tspan>
  </text>
</g>
```

Un altro programma vede il testo dove lo mostra FubDraw, e non lo rimette al
centro quando la forma cambia. Chi è l'etichetta di chi, il riquadro del
testo e il seguire sono in [Formato della scena,
etichette](../reference/scene-format-labels.md).

## Livelli e parti

Le etichette vengono col Testo: dallo Standard, e nel
[Personalizzato](drawing-custom.md) con la parte «Testo». A un livello che
non l'ha, le etichette restano nel disegno, si vedono e continuano a seguire
le forme: è un fatto del file. Manca il modo di scriverle. In un documento in
sola lettura i due tocchi non aprono il campo.
