# Formato della scena, tavole

> **Ambito:** le tavole di un disegno, cioè più pagine sulla stessa tela,
> ognuna col suo nome e la sua carta: come si scrivono e si leggono, come le
> operazioni le tengono insieme alle loro carte e come l'indice ne fa sezioni
> del disegno. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `analysis.ts`, con `crates/fub-scene/src/classify.rs` e `analysis.rs`, che
> leggono allo stesso modo; le operazioni in `scene/engine.ts`, con i vettori
> di prova da 65 a 73 ([operazioni sulla scena](scene-operations.md), §9);
> l'indice in `crates/fub-format-svg/src/parse.rs`.

Una parte del [formato della scena](scene-format.md), §2. Una tavola è una
pagina dentro il disegno, col suo nome e la sua carta: un disegno ne può
avere più d'una, da incorporare in una nota una per una. Si scrive con `view`
di SVG, così `disegno.svg#id` mostra quella tavola anche in un browser. Un
disegno senza tavole è una pagina sola, come sempre. Come si usano sta in
[Disegni, tavole](../product/drawing-boards.md). Le sezioni del formato si
citano come «formato della scena, §N»; quelle di questa pagina col solo
numero.

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 2560 1024" width="2560" height="1024">
  <title>Ciclo dell'acqua</title>
  <rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1122.52" height="793.7" fill="#ffffff"/>
  <rect id="c5e6f7g8h" fub:role="paper" fub:board="b9i0j1k2l" x="1202.52" y="0" width="1122.52" height="793.7" fill="#ffffff"/>
  <view id="b1a2b3c4d" fub:role="board" viewBox="0 0 1122.52 793.7">
    <title>Copertina</title>
  </view>
  <view id="b9i0j1k2l" fub:role="board" viewBox="1202.52 0 1122.52 793.7">
    <title>Evaporazione</title>
  </view>
  <g id="l3f8a0c2d" fub:layer="Livello 1">
  </g>
</svg>
```

Due tavole A4 orizzontali, una accanto all'altra con 80 unità in mezzo:
«Copertina», che ha preso la carta della pagina quando è nata, ed
«Evaporazione».

## 1. La tavola

- **Un `view` figlio della radice** con `fub:role="board"`, un `id` non
  vuoto e un `viewBox`: quattro numeri SVG separati da spazi o virgole, con
  larghezza e altezza maggiori di 0, in unità utente. È il rettangolo della
  tavola sulla tela.
- **Il nome** è il testo del primo `title` figlio, con gli spazi XML ridotti a
  uno, come il nome di un oggetto. Una tavola senza `title`, o col nome
  vuoto, si chiama col suo id. I figli sono soltanto `title` e `desc`, con gli
  spazi fra loro.
- **Fuori grammatica:** ogni altro attributo SVG, come `preserveAspectRatio`,
  `zoomAndPan`, `style` o `class`, un altro figlio, o un `view` che non è
  figlio della radice rendono estraneo il `view`: si conserva com'è e non è
  una tavola. Gli attributi `fub:*` sconosciuti e quelli degli altri
  namespace si conservano.
- **L'ordine delle tavole** è quello dei `view` nel documento: il primo è la
  tavola 1. Una tavola non si blocca e non si nasconde.
- **Al più 1 000 tavole** per documento (formato della scena, §11): un file
  che ne ha di più si apre e si modifica, e non ne riceve altre.

## 2. La carta di una tavola

- **Ogni tavola ha la sua carta:** il `rect` della carta (formato della
  scena, §2) con `fub:board`, l'id della tavola, e `x`, `y`, `width` e
  `height` uguali ai quattro numeri del suo `viewBox`. Così un altro
  programma disegna le tavole come fogli sulla tela.
- **In un disegno con le tavole** ogni carta è di una tavola: la carta della
  pagina, senza `fub:board`, c'è solo in un disegno senza tavole. Una tavola
  senza carta si legge, e si disegna senza fondo.
- **Quando non vanno insieme** (S015, §7): una carta il cui `fub:board` non è
  l'id di una tavola, la seconda carta della stessa tavola, una carta con
  una geometria diversa da quella della sua tavola, una carta senza
  `fub:board` in un disegno con le tavole. Il file si apre e si disegna così
  com'è; le operazioni impediscono soltanto di scriverne altre (§5).

## 3. La tela

- **I figli della radice:** dopo `title`, `desc` e le `defs`, le carte, poi
  le tavole, poi i livelli. Conta solo l'ordine dei `view`: le carte possono
  stare in qualunque ordine, purché sotto i livelli.
- **Il `viewBox` della radice** copre le tavole e il contenuto, e cresce con
  `page` come in un disegno senza tavole (formato della scena, §2). Un
  browser che apre il file mostra tutta la tela, con le tavole come fogli;
  con `#id` mostra quella tavola.
- **Il contenuto** sta nei livelli: una tavola non contiene oggetti, è un
  rettangolo sulla tela. Ciò che sta fuori da ogni tavola resta nel file e
  nel disegno intero, non nell'immagine di una tavola.
- **La prima tavola nasce dalla pagina:** in un disegno che ha la sola carta
  della pagina, la prima tavola ha la geometria della pagina, il `viewBox`
  della radice, e la carta riceve `fub:board`, e quella geometria se non
  l'aveva, e diventa la sua. Togliere l'ultima tavola fa il contrario: la
  carta perde `fub:board` e torna la carta della pagina, che `page` riporta
  sul `viewBox` della radice; FubDraw lo porta sul rettangolo della tavola,
  allargato a passi finché copre il disegno.

## 4. La scrittura

- **Id:** una tavola nuova ha `b` seguito da 8 caratteri base36 casuali, la
  carta di una tavola nuova `c` seguito da 8 (formato della scena, §7). La
  carta della pagina che diventa di una tavola tiene `fub-paper`.
- **Ordine degli attributi:** `fub:board` viene subito dopo `fub:role`; il
  `viewBox` di una tavola dopo la geometria. Il `title` della tavola sta
  nella riga dopo il `view`, rientrato di due spazi.
- **Dove vanno:** FubDraw scrive la carta di una tavola nuova dopo l'ultima
  carta, e la tavola dopo l'ultima tavola; la prima tavola va subito dopo la
  carta della pagina che prende. La copia di una tavola va subito dopo la
  tavola che copia, e la sua carta, copia di quella della tavola, dopo
  l'ultima carta.
- **Numeri:** il `viewBox` di una tavola e la geometria della sua carta si
  scrivono con le regole della geometria (formato della scena, §7), gli
  stessi quattro numeri nei due elementi.

## 5. Le operazioni

Le [operazioni sulla scena](scene-operations.md) tengono ogni tavola insieme
alla sua carta.

- **Una tavola** si aggiunge e si toglie con `add` e `remove`, figlia della
  radice; si sposta con `move` soltanto fra i figli della radice, ed è così
  che cambia l'ordine delle tavole. Il suo `viewBox` cambia con `set`, e il
  nome col suo `title`, come quello di un oggetto.
- **La carta della pagina** cambia soltanto con `page`, tranne che con un
  `set` che le dà `fub:board` e nient'altro: allora diventa la carta di una
  tavola. Ogni altra operazione su di lei è `locked`.
- **La carta di una tavola** si aggiunge, figlia della radice, si toglie, si
  sposta fra i figli della radice e cambia con `set` in `x`, `y`, `width`,
  `height` e `fub:board`; un altro attributo è `locked`, e `fub:board` a
  `null` la riporta carta della pagina. Una carta nuova senza `fub:board`, o
  fuori dalla radice, è `invalid-elem`.
- **La coerenza:** alla fine di ogni operazione il motore guarda le tavole
  che l'operazione ha aggiunto, tolto o cambiato, e quelle delle carte che ha
  aggiunto, tolto o cambiato. Ognuna, se c'è, ha al più una carta, con la sua
  geometria; ogni carta di quelle tavole, e ogni carta toccata, rimanda a una
  tavola che c'è; e se il documento ha tavole, nessuna carta toccata è senza
  `fub:board`, né lo è una carta che c'era quando l'operazione ha aggiunto la
  prima tavola. Altrimenti l'operazione è `invalid-elem`, e niente cambia.
  Così una tavola cambia insieme alla sua carta, in un `batch`.
- **Un file già fuori regola** si modifica lo stesso: la coerenza guarda solo
  ciò che l'operazione tocca, e le inverse del motore non si guardano,
  perché rimettono lo stato di prima.
- **`page`** cambia la radice e la carta della pagina, se c'è; le carte delle
  tavole hanno la geometria delle loro tavole e restano dove sono.
- **Il limite:** un'operazione che porta il documento oltre 1 000 tavole è
  `limit`.

Un `batch` che crea la prima tavola:

```json
{ "op": "batch", "ops": [
  { "op": "add", "parent": "#root", "pos": { "first": true }, "elem": { "tag": "view", "attrs": { "id": "b1a2b3c4d", "fub:role": "board", "viewBox": "0 0 1600 1000" }, "children": [ { "tag": "title", "attrs": {}, "text": "Tavola 1" } ] } },
  { "op": "set", "id": "fub-paper", "attrs": { "fub:board": "b1a2b3c4d" } }
] }
```

## 6. L'indice e gli embed

- **Ogni tavola è una sezione** del disegno (formato della scena, §9): un
  heading di livello 2 col suo nome, sullo span del `view`, con la sua voce
  di `outline`, e un nome fra le sezioni nominate del riepilogo, dopo il
  titolo. Il nome entra anche nel campo `text`, per la ricerca.
- **I riferimenti:** `[[disegno#Copertina]]` apre il disegno su quella
  tavola; `![[disegno#Copertina]]` incorpora soltanto lei, ritagliata sul suo
  `viewBox`, coi caratteri e le immagini del vault come il disegno intero. Il
  titolo del disegno resta la sezione del disegno intero; un nome che non è
  né il titolo né una tavola non ha sezione, e l'embed non si risolve.
- **Lo stesso nome due volte:** due tavole con lo stesso nome, o una tavola
  col nome del disegno, si possono scrivere; il nome vale per la prima
  sezione che lo porta, il titolo prima delle tavole (S016). I nomi si
  confrontano così come sono.
- **Il riepilogo** porta `boards`, i nomi delle tavole in ordine.

## 7. La diagnostica

| Codice | Gravità | Significato |
|---|---|---|
| S015 | info | una carta che non va con la sua tavola (§2) |
| S016 | avviso | il nome di una tavola è già del disegno o di una tavola che viene prima: un riferimento a quel nome mostra l'altra (§6) |

- **S015:** una per carta, sulla carta, col suo id e il motivo come
  dettaglio (`c5e6f7g8h board`), o il solo motivo per una carta senza id:
  `board` se `fub:board` non è l'id di una tavola, `second` se la tavola ha
  già una carta prima di lei, `geometry` se `x`, `y`, `width` e `height` non
  sono i numeri del `viewBox` della tavola, `free` per una carta senza
  `fub:board` in un disegno con le tavole. I numeri si confrontano come
  valori, non come testo.
- **S016:** una per tavola, sul `view`, col nome come dettaglio.

## 8. Lettori più vecchi e ciò che manca

- **Lettori più vecchi:** un lettore che non conosce le tavole vede estranei
  i `view`, li conserva byte per byte e disegna le carte al loro posto. Le
  tavole sono entrate nel formato insieme alla regola di `page` che non tocca
  le carte delle tavole, prima che un lettore senza quella regola uscisse:
  la versione resta 1.
- **Ciò che manca:** l'export di una tavola come pagina di un PDF o come
  immagine, il colore della carta di una tavola, le tavole bloccate, le
  guide e la griglia di una tavola. Il formato le può aggiungere come
  attributi, senza cambiare ciò che c'è.
