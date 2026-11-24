# Formato della scena, unità e guide

> **Ambito:** gli attributi `fub:units` e `fub:guides` della radice di un
> disegno di FubDraw: grammatica, lettura, diagnostica e scrittura. Versione 1.
> **Fonti autorevoli:** `crates/fub-scene/src/rulers.rs`,
> `apps/client/src/editors/spatial/scene/rulers.ts` e i casi scritti a mano in
> `apps/client/src/__fixtures__/scene-rulers/cases.json`, che valgono per
> tutte e due le letture.

Righelli e guide se ne sono andati col livello Standard
([decisione 0231](../decisions/0231-la-chiusura-di-fubdraw.md)); il livello
Completo li riporta con le guide di VectorCraft (`crates/fub-disegno/src/guide.rs`):
all'apertura `fub:guides` diventa l'elenco delle guide del motore, e un
comando che le cambia riscrive l'attributo intero nella forma canonica (§2).
Una guida che non cambia si riscrive com'era, coi suoi riferimenti; una
guida senza livello che si sposta prende il primo livello visibile e
sbloccato, come in VectorCraft. Una guida `locked` non si sposta, non cambia
livello e non si toglie da sola; se ne va con la sua tavola, col suo livello
o con «Cancella guide». Con un valore fuori grammatica, o con una radice
ruotata o inclinata, i comandi delle guide sono spenti e il valore resta
com'è. `fub:units` si sceglie ancora, nella sezione Documento delle
proprietà.

Due attributi facoltativi della radice del
[formato della scena](scene-format.md): l'unità in cui la superficie mostra le
misure e le guide tirate dai righelli. Non cambiano il disegno e gli altri
programmi li ignorano: il file resta in unità utente, e cambiare unità non
riscrive la geometria. Come si usano sta in
[Disegni, unità e guide](../product/drawing-rulers.md); la superficie li
cambia soltanto col `set` sulla radice delle
[operazioni sulla scena](scene-operations.md), §2. Le sezioni del formato si
citano come «formato della scena, §N».

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000" fub:units="mm" fub:guides="x 120; y 340.5 locked">
```

## 1. `fub:units`

```text
units = "px" / "mm" / "cm" / "in" / "pt"
```

- **Significato:** l'unità dei numeri che la superficie mostra e chiede: i
  righelli, la posizione delle guide, i campi di posizione e di misura, il
  passo della griglia e gli annunci. Lo spessore del contorno, il corpo del
  testo e gli angoli restano nelle loro unità.
- **Rapporti:** quelli di CSS, gli stessi delle lunghezze con unità (formato
  della scena, §4): 1in = 96 unità utente = 25,4mm = 2,54cm = 72pt.
- **Assente:** l'unità è `px`.
- **Forma:** una delle cinque sigle, minuscola e senza spazi. `MM`, ` mm`,
  `pc` e il valore vuoto sono fuori grammatica.

## 2. `fub:guides`

```text
guides = *wsp / guide *(";" guide)
guide  = *wsp axis 1*wsp number *(1*wsp part) *wsp
part   = "locked" / "board=" ref / "layer=" ref
ref    = 1*(%x21-3A / %x3C-10FFFF)   ; né spazi né ";"
axis   = "x" / "y"
wsp    = %x20 / %x09 / %x0A / %x0C / %x0D
```

- **Asse:** una guida `x` è la retta verticale alla coordinata x della
  radice, una `y` l'orizzontale alla coordinata y.
- **Posizione:** `number` è un numero SVG come quelli della geometria
  (formato della scena, §4), in unità utente; `-0` vale `0`.
- **Bloccata:** con `locked` la guida non si sposta e non si prende col
  puntatore.
- **Tavola:** con `board=` la guida appartiene alla tavola con quell'id
  (formato della scena, tavole): corre solo sulla tavola, e si sposta, si
  copia e se ne va con lei. Senza, la guida è del foglio intero.
- **Livello:** con `layer=` la guida sta sul livello con quell'id: si
  mostra, si nasconde e si blocca con lui, e se ne va con lui. Senza, la
  guida non è di nessun livello ed è sempre lì.
- **Riferimenti persi:** un `board=` o un `layer=` che non nomina una
  tavola o un livello del disegno si legge come se mancasse; la guida resta.
- **Parti dopo il numero:** in qualunque ordine, ognuna al più una volta.
- **Elenco:** le guide valgono nell'ordine del file, e due guide uguali sono
  due guide. Un valore vuoto, o di soli spazi, non ha guide.
- **Limite:** al più 1 000 guide; oltre, il valore è fuori grammatica.
- **Fuori grammatica:** fra l'altro un `;` in testa, in coda o ripetuto
  (`x 1;`, `x 1;;y 2`), un asse attaccato al numero (`x1`), un asse diverso
  da `x` e `y`, un numero che manca o non è un numero, una parola dopo il
  numero che non è `locked`, `board=…` o `layer=…`, una parte ripetuta, un
  `board=` o un `layer=` senza id.
- **Forma ampliata:** `board=` e `layer=` vengono dopo la prima forma
  (asse, numero e `locked`) e non cambiano il significato di quella:
  la versione del formato resta 1. Un lettore di prima trova fuori grammatica
  un valore che li usa e lo lascia nel file com'è (§3), quindi non si perdono.

- **Tracciati-guida:** oltre a queste rette, una forma con `fub:guide="true"`
  è una guida della sua forma (formato della scena, §3): non sta in
  `fub:guides` e si mostra e si nasconde con le altre guide e col suo livello.

## 3. Lettura e diagnostica

Un valore fuori grammatica non si usa e resta nel file com'è, finché la
superficie non lo sostituisce:

- **`fub:units`:** l'unità è `px`. Scegliere un'unità sostituisce
  l'attributo, o lo toglie se è `px`.
- **`fub:guides`:** il documento non ha guide. La superficie non ne mostra e
  nessun gesto dell'editor riscrive l'attributo; lo cambia soltanto
  un'operazione `set` sulla radice, col valore nella sua grammatica.
- **S011** (info): una per attributo, senza span, col nome dell'attributo
  come dettaglio; prima `fub:units`, poi `fub:guides`. Sta con gli altri
  codici in formato della scena, §12.

## 4. Scrittura

- **Unità:** `px` non si scrive: scegliere i pixel toglie l'attributo.
- **Guide:** la forma canonica è `x 120; y 340.5 board=b1 layer=l2 locked`,
  con le parti in quest'ordine e uno spazio fra l'una e l'altra, `; ` fra
  una guida e l'altra e i numeri della geometria, al più con due decimali (formato della scena, §7, punto 3). Chi cambia l'elenco
  con un'operazione riscrive l'attributo intero, e senza guide lo toglie.
- **Ordine sulla radice:** quando la radice si riscrive, gli attributi vanno
  nell'ordine dell'esempio: le dichiarazioni, `fub:version`, `viewBox`,
  `width`, `height` e `fub:units`, poi gli altri nell'ordine originale e in
  fondo `fub:guides`, che è il più lungo. I valori che non cambiano si copiano
  così come sono (formato della scena, §7).
