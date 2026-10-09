# Formato della scena, stili

> **Ambito:** gli stili di un disegno, di testo e grafici: la loro forma,
> come un oggetto ne segue uno, come vivono e come escono nell'export.
> Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `crates/fub-scene/src/classify.rs`, che leggono allo stesso modo;
> l'interlinea in `scene/values.ts` e `crates/fub-scene/src/values.rs`; le
> operazioni in `scene/engine.ts`, coi vettori di prova da 81 a 83
> ([operazioni sulla scena](scene-operations.md), §9); l'SVG pulito in
> `crates/fub-scene/src/export/clean.rs`; ciò che l'editor ne fa in
> `tools/styles.ts`.

Una parte del [formato della scena](scene-format.md), §4, e delle sue
[risorse](scene-format-resources.md). Uno stile è un aspetto con un nome,
che gli oggetti seguono: un titolo di capitolo, una nota, un riquadro di
avviso. Che cosa ne fa l'editor sta in [Disegni, stili](../product/drawing-styles.md).
Le sezioni del formato si citano come «formato della scena, §N»; quelle di
questa pagina col solo numero.

```xml
<defs id="fub-defs">
  <text id="r0a1b2c3d" fub:role="style" fub:name="Titolo del capitolo" fub:leading="1.2"
    fill="#1a1a1a" font-family="Inter, sans-serif" font-size="48" font-weight="600"/>
  <polyline id="r4e5f6g7h" fub:role="style" fub:name="Riquadro" points="0,0 100,0 100,100"
    fill="#fff4d6" stroke="#e69f00" stroke-width="2"/>
</defs>
…
<text id="o1a2b3c4d" fub:style="r0a1b2c3d" x="80" y="120" fill="#1a1a1a"
  font-family="Inter, sans-serif" font-size="48" font-weight="600"><tspan x="80" dy="0">Capitolo primo</tspan></text>
<rect id="o5e6f7g8h" fub:style="r4e5f6g7h" x="80" y="200" width="400" height="160"
  fill="#fff4d6" stroke="#e69f00" stroke-width="4"/>
```

Un titolo che segue lo stile «Titolo del capitolo» e ne ha l'aspetto, e un
rettangolo che segue «Riquadro» con un contorno più spesso: il suo
spessore è una differenza dallo stile.

## 1. Uno stile è un prototipo

Uno stile è un elemento con `fub:role="style"` figlio di una `defs` della
radice, che porta l'aspetto come lo porterebbe un oggetto: lo si legge e lo
si dà con le stesse regole con cui «Copia lo stile» e «Incolla lo stile»
lo leggono e lo danno fra due oggetti. Non si disegna, perché sta in una
`defs`, e non cambia come si disegna chi lo segue: ogni oggetto porta
scritti i suoi attributi, e un altro programma vede lo stesso disegno senza
sapere che gli stili ci sono.

Ogni stile ha:

- **un id** nella forma delle risorse, `r` e otto caratteri, anche quando
  entra con un'operazione;
- **un nome** in `fub:name`, non vuoto. Il formato non vuole altro; i nomi
  che l'editor scrive, e quando due nomi sono uguali, stanno in [Disegni,
  stili](../product/drawing-styles.md);
- **per figli** soltanto `title`, `desc` e spazio, e gli attributi di altri
  namespace, che restano e non decidono niente.

Un elemento con `fub:role="style"` che non ha la forma di uno dei due tipi
è estraneo (formato della scena, §8), e si conserva byte per byte; una
risorsa di un altro tag con `fub:role="style"` è una risorsa senza ciclo di
vita.

## 2. Lo stile di testo

È un `text` vuoto. Di SVG ha soltanto `id`, `font-family`, `font-size`,
`font-weight`, `font-style`, `letter-spacing`, `text-decoration` e `fill`,
coi valori che il formato ammette su un testo (formato della scena, §4): un
colore, `none`, o una risorsa col suo ripiego, come un campione o una
sfumatura (risorse, §6). Un attributo di posizione, un contorno,
un'opacità o una riga lo rendono estraneo.

`fub:leading` è l'interlinea, in volte il corpo: un numero da 0,5 a 10 con
al più tre decimali, scritto come `^[0-9]+(\.[0-9]{1,3})?$`. Uno fuori da
questa grammatica rende estraneo lo stile. Senza `fub:leading` lo stile
non dice l'interlinea, e chi lo segue tiene la sua; chi lo segue la porta
nelle sue righe, come ogni testo ([testo](scene-format-text.md)).

## 3. Lo stile grafico

È una `polyline` coi punti `0,0 100,0 100,100`, esatti: una spezzata aperta
che dà a una sfumatura il riquadro 100 × 100 in cui stare, e che può avere
le punte di una linea. Non è un `path`, perché un `path` in una `defs` è il
tracciato di un testo. Di SVG ha soltanto `id`, `points`, `fill`,
`fill-opacity`, `stroke`, `stroke-opacity`, `stroke-width`,
`stroke-dasharray`, `stroke-linecap`, `stroke-linejoin`, `marker-start`,
`marker-end`, `opacity`, `style` e `filter`, coi valori che il formato
ammette su una spezzata: lo `style` dice soltanto la fusione
([effetti](scene-format-effects.md), §5), e gli attributi `fub:*` che
accompagnano gli effetti, le punte e i motivi sono quelli di un oggetto.
Un `transform`, la visibilità, un ritaglio o una maschera lo rendono
estraneo.

## 4. Seguire uno stile

Un oggetto segue uno stile con `fub:style`, che porta l'id dello stile:

- **un testo** segue uno stile di testo, anche quando è l'etichetta di una
  forma o di un connettore;
- **gli altri oggetti** che si disegnano seguono uno stile grafico: le
  forme, i tracciati, le linee, i connettori, i tratti a penna, le
  immagini e i gruppi.

`fub:style` su un livello, un collegamento, la carta, una tavola o una
risorsa non dice niente: resta com'è e non si legge. Un oggetto che segue
uno stile che non c'è, o uno dell'altro tipo, dà **S018** (formato della
scena, §12) con l'id com'è scritto, e si disegna dai suoi attributi come
ogni altro; l'attributo resta finché qualcuno non lo toglie. Un elemento
estraneo non segue niente.

**Le differenze.** Un valore di un oggetto diverso da quello dello stile è
una differenza: il file non la segna, e si trova confrontando l'aspetto
dell'oggetto con quello dello stile, campo per campo. Una sfumatura privata
dello stile si confronta come starebbe nel riquadro dell'oggetto.

## 5. Il ciclo di vita

- **Uno stile non si raccoglie mai** (risorse, §9): resta anche quando
  nessuno lo segue, e se ne va soltanto quando qualcuno lo toglie.
- **Le sue risorse private sono sue.** Una sfumatura, un filtro o un motivo
  privati che lo stile usa contano come usati finché c'è lui, e se ne vanno
  con lui. Stanno nelle sue coordinate: una sfumatura sta nel riquadro
  100 × 100, anche quella di uno stile di testo, e chi riceve lo stile la
  riceve in copia, adattata al suo riquadro.
- **I campioni e i motivi del documento** che uno stile usa restano del
  documento: lo stile li condivide, come un oggetto.
- **Chi lo segue lo trattiene:** `remove` di uno stile che un oggetto
  segue, o di una `defs` che lo contiene, è `in-use`, e così `ident` che
  gli toglie l'id. `fub:style` non è un riferimento alle risorse: verso una
  risorsa che non è uno stile non la trattiene.
- **Un id che qualcuno segue** non torna con uno stile nuovo: un `add` di
  uno stile con quell'id è `duplicate-id`, perché chi lo segue cambierebbe
  natura, come per un id a cui il documento rimanda già. Una risorsa di un
  altro tipo entra, e chi segue resta con S018.
- **Togliere uno stile e chi lo segue** si fa in un `batch`: prima
  `fub:style`, poi lo stile, e la raccolta toglie le sue risorse private e
  la `fub-defs` rimasta vuota (vettore 83).

## 6. La scrittura

FubDraw scrive gli attributi nell'ordine canonico (formato della scena,
§7): `fub:role`, `fub:name` e `fub:leading` di uno stile, e `fub:style` di
chi lo segue, dopo l'id. I valori di uno stile sono scritti come quelli di
un oggetto: gli stessi numeri, gli stessi colori, le stesse sfumature.

## 7. L'export

- **Nell'SVG pulito** ([export](scene-format-export.md)) gli stili se ne
  vanno, come ogni risorsa che nessuno usa, e con loro le loro risorse
  private; `fub:style` se ne va con gli altri attributi `fub:*`. Un
  campione che uno stile usa resta se lo usa anche un oggetto. Il disegno
  resta lo stesso, perché nessuno stile si disegna.
- **Il PNG, il JPEG e il PDF** disegnano gli oggetti dai loro attributi: gli
  stili non ci sono.

## 8. Lettori più vecchi

Un lettore che conosce le risorse ma non gli stili vede estraneo un `text` o
una `polyline` nella `defs`, e lo conserva byte per byte; le sfumature
private dello stile restano, perché un riferimento conta anche da un
elemento estraneo. `fub:style` è per lui un attributo `fub:*` che non
conosce, e che non decide niente: gli oggetti restano modificabili e si
disegnano come prima. La versione resta 1.
