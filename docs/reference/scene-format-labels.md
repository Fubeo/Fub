# Formato della scena, etichette

> **Ambito:** l'etichetta di una forma, il testo scritto dentro un
> rettangolo, un'ellisse, un poligono o un tracciato chiuso, che resta al
> centro quando la forma cambia: la grammatica di `fub:inside`, chi è
> l'etichetta di chi, dove sta il testo e come segue la forma, lettura e
> scrittura. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/labels.ts`,
> `crates/fub-scene/src/labels.rs` e i casi scritti a mano in
> `apps/client/src/__fixtures__/scene-labels/cases.json`, che valgono per
> tutte e due le letture; chi ha un'etichetta e il riquadro del testo li
> calcola soltanto la superficie, in
> `apps/client/src/editors/spatial/tools/label-hosts.ts`, il posto e il
> seguire in `tools/labels.ts`; il vettore di prova 80 ([operazioni sulla
> scena](scene-operations.md), §9).

Un `text` con `fub:inside`, che porta l'id della forma, nello stesso gruppo
della forma. Il suo `transform` lo mette già al centro: un altro programma
vede il testo dove FubDraw lo mostra. FubDraw legge `fub:inside` per
rimetterlo al centro, e per rifargli la larghezza, quando la forma si sposta,
si gira o cambia misura. Come si scrive un'etichetta è in [Disegni,
etichette nelle forme](../product/drawing-labels.md).
Le sezioni del formato si citano come «formato della scena, §N»; quelle di
questa pagina col solo numero.

```xml
<g id="o4d5e6f7g">
  <rect id="o2b3c4d5e" x="100" y="100" width="200" height="120" fill="#e69f00"/>
  <text id="o8m3n4p5r" fub:inside="o2b3c4d5e" fub:wrap="188" x="0" y="0" fill="#000000" font-family="Inter, sans-serif" font-size="32" text-anchor="middle" transform="matrix(1 0 0 1 200 168.8)">
    <tspan x="0" dy="0">Inizio</tspan>
  </text>
</g>
```

Un rettangolo largo 200 e la sua etichetta «Inizio», nel loro gruppo. Il
testo va a capo in 188 unità, la larghezza del rettangolo meno 6 per parte.
La riga va dalla cima delle maiuscole, 0,8 volte il corpo sopra la linea di
base, al fondo, 0,25 volte sotto: il suo mezzo, 8,8 sopra la linea di base,
cade in (200, 160), il centro del rettangolo.

## 1. `fub:inside`

- **Il valore** è un id: una parola sola, con spazi di SVG prima o dopo
  ammessi.
- **Fuori grammatica,** vuoto o di più parole, `fub:inside` non si usa e
  resta nel file com'è.
- **Conta soltanto su un `text`** scritto in righe: non su un testo su
  tracciato, né sull'etichetta di un connettore, che segue la sua linea
  ([connettori](scene-format-connectors.md), §6).

## 2. Chi è l'etichetta di chi

- **La forma** è una sorella dell'etichetta, nello stesso gruppo: il primo
  figlio del gruppo che ha quell'id. Un livello non è un gruppo.
- **Una forma chiusa:** un rettangolo, un'ellisse, un cerchio, un poligono,
  un poligono regolare o una stella (formato della scena, §6), o un
  tracciato con almeno un sottotracciato chiuso da `Z`.
- **Un'etichetta per forma:** la prima, in ordine di documento, fra i testi
  del gruppo che la nominano. Gli altri sono testi qualunque.
- **Altrimenti,** se la forma non c'è, non è una sorella o non è chiusa, il
  testo è un testo qualunque, dove lo mette il suo `transform`.

## 3. Il riquadro del testo

Il formato non fissa dove sta l'etichetta: la lettura prende il `transform`
com'è scritto. Così la mette FubDraw: al centro del riquadro del testo, il
rettangolo più grande che sta dentro la forma, dritto nelle sue coordinate.

- **Un rettangolo:** il rettangolo stesso; con gli angoli arrotondati, quello
  che tocca gli archi a metà, cioè rientrato di `rx` e `ry` per
  (1 − √2/2) da ogni lato.
- **Un'ellisse o un cerchio:** quello coi vertici sul bordo, largo e alto √2
  volte i semiassi.
- **Ogni altra forma:** una griglia di 48 celle sul lato più lungo trova il
  rettangolo più grande fra le celle che hanno il centro dentro la forma,
  con la regola `nonzero`, e che né il contorno né le linee aperte del
  tracciato attraversano; a parità il più vicino al centro, poi il più largo.
  Il rettangolo trovato si allarga poi un lato alla volta, sinistra, destra,
  sopra e sotto, fin dove il contorno lo lascia.

## 4. Il posto

- **La larghezza,** `fub:wrap`: quella del riquadro nella scena meno 6 unità
  per parte, ma non meno del corpo del testo, con 2 decimali. Il testo è in
  area ([testo](scene-format-text.md), §4) e ci va a capo.
- **Il centro:** il `transform` porta il mezzo del blocco delle righe al
  centro del riquadro. In verticale il blocco va dalla cima delle maiuscole
  della prima riga scritta al fondo dell'ultima, come nell'esempio; in
  orizzontale è il mezzo della larghezza.
- **L'angolo:** il testo gira con la forma. Uno specchio non lo rovescia: le
  righe restano dritte, girate al più di un quarto di giro da una parte o
  dall'altra.
- **Il corpo** resta quello scritto: il testo non cresce con la forma. Ciò
  che non ci sta in altezza esce sopra e sotto in parti uguali.
- **Un'etichetta nuova** ha `x` e `y` a 0, `text-anchor="middle"`, righe con
  `x="0"`, e il colore, il carattere e il corpo dello strumento Testo.

## 5. Seguire la forma

- **Quando la forma o l'etichetta cambia,** si sposta, si gira, cambia misura,
  geometria o testo, FubDraw riscrive il `transform` dell'etichetta e, se la
  larghezza è un'altra, `fub:wrap` e le righe, nella stessa operazione: un
  annulla le riporta insieme.
- **Spostare il gruppo** non riscrive niente: forma ed etichetta si spostano
  insieme.
- **Un'etichetta spostata da sola,** senza la sua forma, si stacca: perde
  `fub:inside` e resta dove la si è messa.
- **Una forma tolta,** uscita dal gruppo o non più chiusa: l'etichetta,
  quando un'operazione tocca lei o la forma, perde `fub:inside` e resta un
  testo.
- **Un id cambiato** alla forma, dal pannello degli attributi, porta
  `fub:inside` e i riferimenti dei connettori (`fub:from`, `fub:to`,
  `fub:along`) all'id nuovo, nelle stesse operazioni. Se uno di loro sta in
  un livello o in un gruppo bloccato, l'id non si cambia: il riferimento
  resterebbe al vecchio.
- **Un livello o un gruppo bloccato:** l'etichetta che vi sta dentro non si
  riscrive.

## 6. Dare e togliere un'etichetta

- **Una forma in un livello** riceve l'etichetta in un gruppo nuovo, al suo
  posto, con la forma prima e l'etichetta dopo.
- **Una forma che sta già in un gruppo** la riceve accanto, subito dopo di
  lei, nel suo gruppo.
- **Un'etichetta svuotata** si toglie. Il gruppo si scioglie se teneva
  soltanto la forma e lei, senza `title`, `desc` né effetti, e se niente lo
  nomina, come un connettore agganciato a lui: la forma torna com'era.
- **Le copie:** copiata col gruppo, o con la forma, l'etichetta nomina la
  copia della forma; copiata da sola perde `fub:inside`.

## 7. Lettura e scrittura

- **Nella scena letta** il testo ha la forma che nomina, l'id letto. Se è la
  sua etichetta lo dice chi conosce il resto del documento (§2).
- **Scrittura:** `fub:inside` è l'id e basta. Nell'ordine canonico (formato
  della scena, §7, punto 2) viene dopo `fub:along` e prima di `fub:wrap`.
- **Analisi e accessibilità:** l'etichetta è un testo. Una forma con la sua
  etichetta si chiama con le parole di questa, che sono il testo che si
  vede, anche se ha un `title`: il `title` prende il posto del tipo,
  «Decisione «Controlla l'ordine»» e non «Tracciato «Decisione»». Il gruppo
  che tiene soltanto lei e la forma, senza un `title` suo, si chiama come la
  forma, e i capi di un connettore agganciato alla forma la dicono con le
  stesse parole, nell'albero degli oggetti e nella Lettura
  ([accessibilità](scene-format-accessibility.md)). Le righe dell'etichetta
  si uniscono come il paragrafo del testo (formato della scena, testo): una
  con `fub:join="word"` senza spazio, le altre con uno.
- **I connettori:** il contorno di un gruppo a cui ci si aggancia non
  comprende l'etichetta di una forma, nemmeno quando esce dalla forma.

## 8. Compatibilità

Un lettore che non conosce le etichette vede un gruppo con una forma e un
testo, dove lo mette il suo `transform`: lo stesso disegno. `fub:inside` è
un attributo `fub:*`: un lettore di FubDraw che non lo conosce lo conserva
(formato della scena, §10) ma non rimette il testo al centro quando la forma
cambia, e un programma estraneo può non conservarlo, lasciando un testo
qualunque.

L'SVG pulito dell'export non lo scrive, come ogni attributo di un namespace
che non è quello vuoto, XLink o XML
([export, §3](scene-format-export.md#3-lsvg-pulito)).
