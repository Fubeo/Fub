# L'inchiostro della lavagna

> **Ambito:** i tratti a mano libera di una lavagna, cioè i campi `fub:ink`
> di un file `.canvas`. Versione 1.
> **Fonti autorevoli:** questa pagina e i vettori in
> `apps/client/src/__fixtures__/canvas-ink/`.

Come una lavagna tiene l'inchiostro scritto sopra le sue schede e sul vuoto.
Una lavagna è un file [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), lo
stesso di Obsidian, letto e scritto come dice il
[formato della lavagna](canvas-format.md); l'inchiostro sta in campi in più, che un programma che non
li conosce conserva o ignora. I punti di un tratto si scrivono con la stringa
`fub:ink` dei disegni e il pennello con la grammatica di `fub:brush`
([formato della scena](scene-format.md), §5). Il perché di questa forma sta
nell'[ADR 0238](../decisions/0238-inchiostro-sulla-lavagna.md).

## Esempio completo

Una lavagna con una scheda file annotata, una scheda di testo e un tratto
libero sul vuoto:

```json
{
  "nodes": [
    { "id": "f1", "type": "file", "file": "Corsi/Statistica/voti.xlsx",
      "x": 0, "y": 0, "width": 640, "height": 420,
      "fub:ink": { "v": 1, "strokes": [
        { "id": "s-mh0k2q1x-4f9a-1", "tool": "pen",
          "at": "2026-11-02T09:20:31.250Z",
          "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
          "color": "#0072b2",
          "anchor": { "kind": "card", "width": 640, "height": 420 },
          "ink": "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8" } ] } },
    { "id": "n2", "type": "text", "text": "Perché la media è così bassa?",
      "x": 700, "y": 40, "width": 280, "height": 90 }
  ],
  "edges": [],
  "fub:ink": { "v": 1, "strokes": [
    { "id": "s-mh0k2r7c-0b1e-2", "tool": "pen",
      "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
      "color": "#0072b2", "anchor": { "kind": "free" },
      "ink": "1 s100 cxy 4000,2500 120,40 95,-10" } ] }
}
```

Il primo tratto è della scheda `f1`: comincia a 120,5 e 30,2 unità dal suo
angolo in alto a sinistra, misurate quando la scheda era 640 × 420. Il secondo
è libero: comincia al punto 40, 25 della lavagna. La scheda `n2` non ha
inchiostro e non ha il campo. Lo stesso file è il vettore `board-and-card.json`.

## Il livello

Un **livello** è l'oggetto sotto la chiave `fub:ink`:

- di una scheda, di qualunque tipo (`text`, `file`, `link`, `group`): i tratti
  di quella scheda;
- della radice del file: i tratti liberi, in coordinate della lavagna.

```json
{ "v": 1, "strokes": [ … ] }
```

- **`v`:** la versione del livello, il numero 1. Si confronta per valore:
  `1.0` è 1.
- **`strokes`:** l'array dei tratti, nell'ordine in cui si disegnano: l'ultimo
  sta sopra.
- **Altri campi:** si conservano dove sono e non cambiano il significato del
  livello.
- **Un gruppo è una scheda.** Il suo livello tiene i tratti scritti sul suo
  vuoto. Un figlio sta sopra il gruppo nell'ordine di `nodes` e ha il suo
  livello: il gruppo non contiene i tratti dei figli.
- **Un `fub:ink` su un arco, o dentro un tratto,** è un campo sconosciuto come
  gli altri: non è un livello e non si disegna.

## Il tratto

| Campo | Obbligatorio | Valore |
|---|---|---|
| `id` | sì | stringa non vuota, unica nel livello |
| `tool` | sì | `"pen"` o `"highlighter"` |
| `at` | no | istante d'inizio, ISO 8601 UTC coi millisecondi, come `fub:at` (formato della scena, §5) |
| `brush` | sì | il pennello, con la grammatica di `fub:brush` (`pf1` o `nib1`) e la penna in `pen=<id>` |
| `color` | sì | `#rrggbb`, sei cifre esadecimali, maiuscole o minuscole |
| `anchor` | sì | l'ancora, qui sotto |
| `ink` | sì | i campioni, con la grammatica di `fub:ink` (formato della scena, §5) |

- **`id`:** unico nel livello, non nella lavagna. Duplicare una scheda copia il
  suo livello con gli stessi id. Fub crea gli id nuovi come quelli delle
  schede, col prefisso `s` (`newNodeId("s")` in
  `apps/client/src/editors/canvas/operation.ts`).
- **`at`:** non decide mai se il tratto si disegna. Un valore che non è una
  data, o non è una stringa, si conserva com'è.
- **`brush`:** lo spessore (`size`) e le rastremazioni sono in unità
  dell'ancora: della scheda alla sua misura di riferimento, o della lavagna.
  Le penne con un nome stanno nel
  [formato della scena, penne e punta piatta](scene-format-pens.md).
- **`color`:** il riempimento del tratto. Si scrive come attributo `fill`,
  mai come variabile del tema: il colore è un dato del file. La forma corta
  a tre cifre (`#07b`) e il canale alfa non valgono.
- **`ink`:** i campioni `x`, `y` sono in unità dell'ancora, moltiplicati per
  la scala. I canali facoltativi (`p`, `t`, `a`, `z`) e la quantizzazione
  sono quelli della §5. Un canale sconosciuto rende il tratto non
  disegnabile: la lavagna non ha un `d` già calcolato da usare al suo posto.
- **Campi sconosciuti:** si conservano nell'ordine in cui erano.

## L'ancora

L'ancora dice in quali unità sono i punti del tratto.

| Ancora | Dove vale | I punti |
|---|---|---|
| `{"kind": "card", "width": W, "height": H}` | solo nel livello di una scheda | unità della scheda alla misura `W × H`, origine nell'angolo in alto a sinistra |
| `{"kind": "free"}` | solo nel livello della radice | coordinate della lavagna |

- **`W`, `H`:** la misura della scheda quando il tratto si è scritto, numeri
  finiti maggiori di zero. Si confrontano per valore: `640.0` e `6.4e2` sono
  640.
- **Fuori posto:** un'ancora `card` alla radice o `free` su una scheda non è
  valida, e il tratto non si disegna.
- **Altri campi dell'ancora:** si conservano dopo quelli noti e non cambiano
  il significato.

## Come si disegna

- **L'inchiostro di una scheda** si disegna sopra il suo contenuto, con la
  scheda: una scheda che le sta sopra nell'ordine di `nodes` lo copre.
- **L'inchiostro libero** si disegna sopra tutte le schede.
- **Spostare una scheda** non cambia niente nel file: i punti sono relativi
  alla scheda.
- **Ridimensionare una scheda** non cambia niente nel file. La resa stira il
  tratto da `W × H` alla misura di adesso, in larghezza e in altezza
  separatamente: il punto (x, y) va a (x · w / W, y · h / H), e il contorno,
  spessore compreso, si stira allo stesso modo. Così un'annotazione resta
  sopra la stessa parte della scheda.
- **Un tratto che esce dalla scheda** resta valido: i punti non hanno limiti
  di posizione.

## Il livello estraneo

Un livello è **estraneo** quando:

- `fub:ink` non è un oggetto;
- `v` manca o non vale 1;
- `strokes` manca o non è un array;
- un elemento di `strokes` non è un oggetto o non ha un `id` stringa non
  vuota;
- due tratti hanno lo stesso `id`.

Un livello estraneo si conserva byte per byte, non si disegna e Fub non ci
scrive. I suoi tratti non si elencano, neanche quelli validi. La penna su una
scheda col livello estraneo scrive inchiostro libero; se è estraneo il
livello della radice, un tratto libero nuovo si rifiuta con l'avviso
`canvas.ink.foreign`. Ogni livello ha il suo stato: due livelli estranei nello
stesso file non toccano gli altri.

## Il tratto che non si disegna

In un livello valido, un tratto che non rispetta le regole qui sopra **si
conserva e non si disegna**, e la gomma non lo vede. La ragione è una parola
fissa, la prima che vale in quest'ordine:

| Ragione | Quando |
|---|---|
| `tool` | `tool` manca o non è `"pen"` né `"highlighter"` |
| `anchor` | `anchor` manca, non è un oggetto, ha un `kind` sconosciuto o fuori posto, o una misura che manca o non è un numero maggiore di zero |
| `color` | `color` manca o non è `#rrggbb` |
| `brush` | `brush` manca o non è un pennello valido della §5 |
| `ink` | `ink` manca, non rispetta la grammatica o i limiti della §5, o ha un canale sconosciuto |

## I limiti

- **Per tratto:** quelli della §5, al massimo 10 000 campioni e 512 KiB della
  stringa `ink`. Un tratto letto oltre i limiti non si disegna (ragione
  `ink`).
- **Per file:** 16 MiB di sorgente (`MAX_CANVAS_SOURCE_BYTES` in
  `apps/client/src/editors/canvas/model.ts`).
- **Un tratto nuovo** che supera un limite si rifiuta con l'avviso
  `canvas.ink.full`, e il file non cambia.

## Scrittura

- **Ordine dei campi del tratto:** `id`, `tool`, `at`, `brush`, `color`,
  `anchor`, `ink`, poi gli sconosciuti nell'ordine in cui erano.
- **Ordine dei campi dell'ancora:** `kind`, `width`, `height`, poi gli
  sconosciuti.
- **Il primo tratto** di una scheda o della radice crea il livello
  `{"v": 1, "strokes": [...]}` in fondo ai campi di chi lo tiene.
- **L'ultimo tratto tolto:** se il livello resta esattamente
  `{"v": 1, "strokes": []}`, la chiave `fub:ink` sparisce. Se il livello ha
  altri campi, resta. Annullare rimette la chiave in fondo ai campi della
  scheda: il modello torna uguale per valore.
- **Il resto del file** non cambia: spostare o ridimensionare una scheda non
  scrive niente per l'inchiostro, e un tratto nuovo tocca solo il suo livello.

## Toppa e operazioni

La toppa `ink`, che aggiunge, toglie o cambia un tratto con la sua inversa, e
le operazioni `add_strokes` ed `erase_strokes` stanno con le altre operazioni
della lavagna, nelle [operazioni sulla lavagna](canvas-operations.md)
(sezione «Inchiostro»).

## I vettori

`apps/client/src/__fixtures__/canvas-ink/` tiene un vettore per file, la prova
comune di ogni lettore del formato. Ogni vettore è un oggetto JSON:

```json
{
  "name": "card-on-board",
  "description": "Un'ancora card vale solo nel livello di una scheda …",
  "source": "{\n  \"nodes\": [],\n  …",
  "expect": { "layers": [
    { "layer": "board", "state": "ok", "strokes": [
      { "id": "s-1", "drawn": false, "reason": "anchor" },
      { "id": "s-2", "drawn": true } ] } ] }
}
```

- **`name`:** il nome del file senza `.json`.
- **`source`:** il testo grezzo del `.canvas`, BOM e a capo compresi.
- **`layers`:** i livelli presenti, nell'ordine delle schede in `nodes`, poi
  la radice. Una scheda o una radice senza `fub:ink` non compare.
- **`layer`:** `"board"` per la radice, `{"node": "<id>"}` per una scheda.
- **`state`:** `"ok"` o `"foreign"`. Un livello `"foreign"` ha `strokes`
  vuoto.
- **`strokes`:** i tratti di un livello `"ok"`, nell'ordine dell'array, con
  `drawn` e, se il tratto non si disegna, `reason`.

I vettori sono scritti a mano. I limiti di dimensione si provano nei test
d'unità dei lettori, perché un vettore da 512 KiB non sta nel repository.
