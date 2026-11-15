# Le pagine e gli estratti in codice

> **Ambito:** le operazioni `spread_pages` ed `excerpt` della lavagna in codice:
> spargere le pagine di un PDF e fare un estratto di un file. Versione 1.
> **Fonti autorevoli:** `crates/fub-canvas-core/src/ops/pages.rs`,
> `crates/fub-features/src/lavagna/prefill.rs` e i vettori
> `spread-pages-*.json` ed `excerpt-*.json` in
> `apps/client/src/__fixtures__/canvas-ops/`.

Le altre operazioni stanno in [La lavagna come codice](canvas-code.md#le-operazioni),
il campo `fub:parts` degli estratti in [Gli estratti della lavagna](canvas-parts.md).
Le due operazioni fanno ciò che fanno «Spargi le pagine…» e il selettore delle
parti della GUI, con le stesse misure e gli stessi posti: la prova è
`apps/client/src/editors/canvas/spread-pages-parity.test.ts`, che rifà i vettori
con `parsePageRanges`, `bornSize` e `spreadLayout` della GUI.

Il nucleo non legge file. Il numero e le misure delle pagine, e la misura
dell'immagine, li mette nella lista `canvas.check`/`canvas.apply` di
`fub-features` (`prefill.rs`), leggendo il file del vault (fino a 32 MiB, una
volta sola per lista) prima di compilare; chi chiama il nucleo da solo li dà
nei campi qui sotto. Una misura data non si sovrascrive; il numero delle pagine
sì: se il file si legge vince il file, e se il `page_count` dato era un altro la
nota `page_count_from_file` lo dice (in `canvas.check` è l'avviso dello stesso
nome). Un file che non si legge, che non si apre (malformato) o cifrato non dà
misure: decidono i campi dati, e senza `page_count` `spread_pages` è `Invalid`.

## `spread_pages`

Fa una scheda per pagina del PDF della scheda `id`, accanto a lei: le schede
mostrano lo stesso file, con `subpath` `#page=N`.

```json
{ "op": "spread_pages", "id": "p1", "pages": "1-3, 7" }
```

| Campo | Di serie | Valore |
|---|---|---|
| `id` | — | una scheda `file` di un PDF (`.pdf`) |
| `pages` | tutte | il testo del campo della GUI (`"1-3, 7"`, `"20-"`), o una lista di numeri |
| `page_count` | dal file | quante pagine ha il PDF, solo per un file che non si legge; senza, l'operazione è `Invalid` |
| `page_sizes` | dal file | `[[w, h], …]` in punti, una per pagina dalla prima; quelle che mancano nascono 360×480 |
| `label` | «N pagine» | l'etichetta del gruppo, se c'è |

- **Le pagine.** Il testo si legge come la GUI: pezzi separati da virgole,
  spazi ignorati, `a-b` o `a-` fino all'ultima, intervalli fusi, in ordine.
  Un pezzo che non è una pagina o un intervallo è `Invalid`, anche `"30-"` su un
  PDF di 9 pagine. Una lista si ordina e perde i doppi; un elemento che non è
  un intero è `wrong_type` già nel controllo della forma, uno sotto 1
  `bad_value`, e una lista vuota è `Invalid`. Le pagine oltre l'ultima si
  tolgono e la nota `pages_cut` lo dice (l'avviso dello stesso nome in
  [Il controllo](canvas-check.md)); se non ne resta nessuna è `Invalid`.
- **Le misure.** Ogni pagina nasce come una scheda PDF di `add_card`, con la
  stessa regola (`layout::born_size`): larga 360, alta quanto la sua
  proporzione, arrotondata all'intero (una A4 è 360×509), come `bornSize` della
  GUI. Una pagina girata da `/Rotate` si misura girata. Un'altezza oltre 100 000
  (una pagina più di 277 volte alta che larga, una misura assurda) vale la
  misura di serie 360×480: la GUI non ha tetto.
- **Il posto.** Le pagine vanno in riga a destra della scheda, dal primo
  multiplo di 8 che lascia 24 dopo il suo bordo, con la y della scheda portata
  a multiplo di 8; a capo ogni 10 pagine, con la riga dopo sotto la più alta.
  Le schede che ci sono non spostano le pagine, come nella GUI.
- **Il gruppo.** Oltre 12 pagine un gruppo le raccoglie, con 24 di margine per
  lato, e nasce prima delle pagine. Senza `label`, `canvas.apply` gli dà «N
  pagine» nella lingua di chi scrive (`canvas.spread.group`, la frase della
  GUI); il nucleo da solo non ha lingua e scrive «N pagine» in italiano.
- **I limiti.** Al più 1 000 pagine per operazione (`TooMany`), e la lavagna
  non supera le sue 100 000 schede.

## `excerpt`

Fa un estratto della scheda `file` `id`: una scheda nuova sullo stesso file
accanto a `near`, o con `in_place` la scheda stessa.

```json
{ "op": "excerpt", "id": "p1", "part": { "kind": "pages", "pages": [3, 4] }, "side": "bottom" }
```

| Campo | Di serie | Valore |
|---|---|---|
| `id` | — | una scheda `file` |
| `part` | — | il `fub:parts` dell'estratto, una delle [quattro specie](canvas-parts.md#le-quattro-specie) |
| `near`, `side` | `id`, `right` | dove nasce la scheda nuova, come `add_card` con `near` |
| `content_size` | dal file | `[w, h]` della pagina (`pages`, la prima; `region`) o dell'immagine (`image`) |
| `page_count` | dal file | quante pagine ha il PDF: con il conto, una pagina della parte oltre l'ultima è `Invalid` |
| `in_place` | `false` | cambia la scheda `id` invece di farne una nuova |

- **La parte.** Si scrive come la scrive la GUI: `subpath` e `fub:parts`
  vengono da `write_parts`, e un `part` che il formato non accetta è `Invalid`
  col motivo fra parentesi (`(field)`, `(kind)`, `(rotate)`…).
- **Le misure.** `pages` nasce come la pagina del PDF; `region` come il suo
  rettangolo sulla pagina, largo 360; `sections` 320×240, come una nota;
  `image` come la zona ritagliata, col lato lungo 480 (girata di 90 o 270
  gradi i lati si scambiano). Senza misura la pagina vale 360×480 e l'immagine
  480×360. La regola è quella di `add_card`, col suo tetto: una zona quasi
  senza larghezza, che nascerebbe alta più di 100 000, vale 360×480.
- **Le pagine che non ci sono.** Con il conto (dal file, o `page_count`) una
  pagina di `pages` o la pagina di `region` oltre l'ultima è `Invalid`, come in
  `spread_pages`; senza conto il nucleo non lo sa.
- **Sul posto.** La scheda tiene id, posto, misure e colore; cambiano solo
  `subpath` e `fub:parts`, come il selettore delle sezioni; a differenza del
  ritaglio della GUI l'altezza non cambia (`#finishCrop` la rifà dalle
  proporzioni della zona, anche con «Togli il ritaglio»). Se aveva già un
  estratto valido della stessa specie, i suoi campi sconosciuti restano.
  `in_place` con `near`, `side` o `content_size` è `Invalid`; anche
  `content_size` con `sections`.
- **Nella GUI.** Gli estratti di un PDF la GUI li mostra solo da N6 T82: finché
  `cards/pdf.ts` non legge `context.parts`, la scheda mostra la pagina del
  `subpath`, o la prima. Gli estratti di note e immagini si vedono già.

## Gli errori

| Errore | Quando |
|---|---|
| `UnknownNode` | `id` o `near` non è una scheda |
| `Invalid` | `spread_pages` di una scheda che non è un PDF, senza `page_count` o con `page_count` sotto 1, un `page_sizes` che non è `[w, h]`, `pages` che non si legge o vuoto; `excerpt` di una scheda che non è un file, un `part` che il formato non accetta, una pagina oltre l'ultima, `page_count` sotto 1, `in_place` mescolato col posto |
| `TooMany` | più di 1 000 pagine in uno `spread_pages`, o la lavagna oltre le 100 000 schede |
