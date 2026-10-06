# Formato della scena, unità e guide

> **Ambito:** gli attributi `fub:units` e `fub:guides` della radice di un
> disegno di FubDraw: grammatica, lettura, diagnostica e scrittura. Versione 1.
> **Fonti autorevoli:** `crates/fub-scene/src/rulers.rs`,
> `apps/client/src/editors/spatial/scene/rulers.ts` e i casi scritti a mano in
> `apps/client/src/__fixtures__/scene-rulers/cases.json`, che valgono per
> tutte e due le letture.

Due attributi facoltativi della radice del
[formato della scena](scene-format.md): l'unità in cui la superficie mostra le
misure e le guide tirate dai righelli. Non cambiano il disegno e gli altri
programmi li ignorano: il file resta in unità utente, e cambiare unità non
riscrive la geometria. Come si usano sta in
[Disegni, righelli e guide](../product/drawing-rulers.md); la superficie li
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
guide  = *wsp axis 1*wsp number [1*wsp "locked"] *wsp
axis   = "x" / "y"
wsp    = %x20 / %x09 / %x0A / %x0C / %x0D
```

- **Asse:** una guida `x` è la retta verticale alla coordinata x della
  radice, una `y` l'orizzontale alla coordinata y.
- **Posizione:** `number` è un numero SVG come quelli della geometria
  (formato della scena, §4), in unità utente; `-0` vale `0`.
- **Bloccata:** con `locked` la guida non si sposta e non si prende col
  puntatore.
- **Elenco:** le guide valgono nell'ordine del file, e due guide uguali sono
  due guide. Un valore vuoto, o di soli spazi, non ha guide.
- **Limite:** al più 1 000 guide; oltre, il valore è fuori grammatica.
- **Fuori grammatica:** fra l'altro un `;` in testa, in coda o ripetuto
  (`x 1;`, `x 1;;y 2`), un asse attaccato al numero (`x1`), un asse diverso
  da `x` e `y`, un numero che manca o non è un numero, una parola dopo il
  numero che non è `locked`.

## 3. Lettura e diagnostica

Un valore fuori grammatica non si usa e resta nel file com'è, finché la
superficie non lo sostituisce:

- **`fub:units`:** l'unità è `px`. Scegliere un'unità sostituisce
  l'attributo, o lo toglie se è `px`.
- **`fub:guides`:** il documento non ha guide. La superficie non ne mostra e
  nessun gesto riscrive l'attributo; lo sostituisce soltanto l'elenco di
  «Guide…», quando lo si conferma.
- **S011** (info): una per attributo, senza span, col nome dell'attributo
  come dettaglio; prima `fub:units`, poi `fub:guides`. Sta con gli altri
  codici in formato della scena, §12.

## 4. Scrittura

- **Unità:** `px` non si scrive: scegliere i pixel toglie l'attributo.
- **Guide:** FubDraw le scrive come `x 120; y 340.5 locked`, con uno spazio
  fra le parti, `; ` fra una guida e l'altra e i numeri della geometria, al
  più con due decimali (formato della scena, §7, punto 3). Ogni modifica
  riscrive l'attributo intero, quindi anche le posizioni delle altre guide
  passano per questa regola. L'ordine è quello dell'elenco: una guida nuova
  va in fondo, una spostata resta al suo posto. Senza guide l'attributo si
  toglie.
- **Ordine sulla radice:** quando la radice si riscrive, gli attributi vanno
  nell'ordine dell'esempio: le dichiarazioni, `fub:version`, `viewBox`,
  `width`, `height` e `fub:units`, poi gli altri nell'ordine originale e in
  fondo `fub:guides`, che è il più lungo. I valori che non cambiano si copiano
  così come sono (formato della scena, §7).
