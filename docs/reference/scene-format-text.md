# Formato della scena, testo

> **Ambito:** il testo di un disegno: le righe, i pezzi di una riga con uno
> stile loro, il corsivo, la spaziatura delle lettere, il sottolineato e il
> barrato, il testo in area, che va a capo in un riquadro, e il testo su
> tracciato; come si leggono, come si scrivono e come li cambia l'operazione
> `text`; i caratteri con cui si disegnano. Versione 1.
> **Fonti autorevoli:** `apps/client/src/editors/spatial/scene/classify.ts`
> e `crates/fub-scene/src/classify.rs`, che leggono allo stesso modo; i
> valori in `scene/values.ts` e `crates/fub-scene/src/values.rs`; la
> scrittura dei pezzi in `scene/serialize.ts` e l'operazione `text` in
> `scene/engine.ts`, con i vettori di prova da 46 a 49 e da 60 a 64
> ([operazioni sulla scena](scene-operations.md), §9); gli a capo che
> l'editor scrive in `tools/wrap.ts`, con la misura dei caratteri in
> `tools/measure.ts`; i caratteri in `crates/fub-features/src/draw/fonts.rs`
> e `typefaces.rs`, con la stessa scelta in `fonts/faces.ts` e i vettori di
> `apps/client/src/__fixtures__/scene-fonts/choose.json`.

Una parte del [formato della scena](scene-format.md), §4: un `text` è un
oggetto modificabile, e ogni suo `tspan` è una riga. Una riga può avere,
oltre al suo testo, dei pezzi con un aspetto loro: una parola in grassetto,
un'altra in corsivo o di un altro colore. Un testo ha tre forme: **da
punto**, che va a capo soltanto dove lo si spezza; **in area**, che FubDraw
manda a capo nella larghezza di un riquadro (§4); **su tracciato**, una riga
sola lungo un tracciato delle risorse (§5). Come si scrive e si cambia il
testo è in [Disegni, tipografia](../product/drawing-typography.md). Le
sezioni del formato si citano come «formato della scena, §N»; quelle di
questa pagina col solo numero.

```xml
<text id="o9i0j1k2l" x="720" y="460" fill="#000000" font-family="Inter, sans-serif" font-size="32">
  <tspan x="720" dy="0">Evaporazione</tspan>
  <tspan x="720" dy="40" font-style="italic" letter-spacing="1.5">in <tspan fill="#0072b2" font-weight="bold" text-decoration="underline">pioggia</tspan></tspan>
</text>
```

Due righe: la seconda scende di 40, è in corsivo con le lettere un po' più
larghe, e la parola «pioggia» è blu, in grassetto e sottolineata.

## 1. Le righe

- **Il testo** ha `x` e `y`, il punto dove comincia la prima riga, e gli
  attributi di presentazione del formato della scena, §4, che le righe
  ereditano.
- **Ogni figlio `tspan` è una riga**, con la sua `x` e il suo `dy`: quanto
  scende dalla riga prima. Il `dy` della prima riga è di solito 0; quello
  delle altre è l'interlinea. Una riga può scrivere gli stessi attributi di
  presentazione, e prende quelli del testo che non scrive.
- **Fra le righe** il file può avere spazi e a capo, che non sono testo:
  sono i nodi di soli spazi che il formato conserva. Il testo fuori dai
  `tspan` rende estraneo il `text`.
- **Un testo su tracciato** non ha righe: al loro posto ha un solo
  `textPath` (§5).

## 2. I pezzi di una riga

- **Un pezzo** è un `tspan` dentro una riga, o dentro il `textPath` di un
  testo su tracciato: il testo della riga e i pezzi si alternano come
  vogliono, e il pezzo dipinge il suo testo col suo aspetto.
- **Un livello solo:** un pezzo contiene soltanto dati di carattere. Un pezzo
  dentro un pezzo, un commento, una sezione CDATA o un riferimento a
  un'entità del DTD in un pezzo rendono estraneo il `text`.
- **Gli attributi di un pezzo** sono quelli di presentazione, tranne
  quelli che spettano alla riga o all'oggetto: `id`, `x`, `dy`,
  `text-anchor`, `display`, `opacity` e `transform` rendono estraneo il
  `text`. Un pezzo non è un oggetto e non si nomina; la posizione e
  l'allineamento sono della riga, che SVG divide in blocchi dove una
  posizione ricomincia; e l'opacità o la visibilità di un pezzo i programmi
  non le disegnano tutti allo stesso modo. Gli attributi degli altri
  namespace, come `xml:space`, si conservano come altrove.
- **Il testo di una riga** sono i suoi dati di carattere e quelli dei pezzi,
  in ordine, uniti senza aggiungere niente: `Eva<tspan>pora</tspan>zione` è
  la parola «Evaporazione». È il testo che la scena dà per la riga, che
  l'indice legge e che si cerca.

## 3. Gli attributi tipografici

Valgono sul `text`, su una riga e su un pezzo, e si aggiungono a
`font-family`, `font-size`, `font-weight` e `text-anchor` del formato della
scena, §4.

- **`font-style`:** `normal`, `italic` o `oblique`, e niente altro: un angolo
  dopo `oblique`, o `inherit`, rendono estraneo l'elemento. Si eredita, ed è
  ammesso anche sui gruppi.
- **`letter-spacing`:** `normal`, che vale 0, oppure una lunghezza del
  formato, anche negativa, con le stesse unità assolute: lo spazio in più
  dopo ogni carattere. Percentuali ed `em` rendono estraneo l'elemento. Si
  eredita, ed è ammesso anche sui gruppi.
- **`text-decoration`:** `none`, oppure una o più fra `underline`,
  `overline` e `line-through`, ciascuna al più una volta, separate da spazi.
  Ogni altra parola, come `blink` o un colore, rende estraneo l'elemento.
  Non si eredita: vale soltanto su `text` e `tspan`, e su un gruppo o una
  forma rende estraneo l'elemento, perché lì i programmi non la disegnano
  tutti allo stesso modo. SVG dipinge la linea col riempimento dell'elemento
  che la scrive: sotto un pezzo di un altro colore resta del colore della
  riga, se è la riga a scriverla.

## 4. Il testo in area

```xml
<text id="o1a2b3c4d" fub:wrap="240" x="40" y="60" fill="#000000" font-family="Inter, sans-serif" font-size="20">
  <tspan x="40" dy="0">L'acqua del mare sale</tspan>
  <tspan fub:join="space" x="40" dy="24">in cielo e torna giù:</tspan>
  <tspan fub:join="space" x="40" dy="24">precipitevolissimevol</tspan>
  <tspan fub:join="word" x="40" dy="24">mente.</tspan>
  <tspan x="40" dy="24">Fine.</tspan>
</text>
```

Un riquadro largo 240 con due paragrafi. Il primo va a capo tre volte: due
al posto di uno spazio, una dentro una parola più larga del riquadro. Il
secondo è «Fine.».

- **`fub:wrap`** sul `text` è la larghezza del riquadro, in unità utente:
  un numero SVG (formato della scena, §4) maggiore di 0, senza unità. Un
  valore fuori grammatica, come `0`, `-5`, `10px` o vuoto, non rende
  estraneo niente: il testo è da punto, sempre modificabile, e l'attributo
  resta scritto com'è.
- **Il riquadro** comincia in `x`, ci sta al centro o ci finisce, secondo il
  `text-anchor` con cui si vede il testo, `start`, `middle` o `end`, e le
  righe ci stanno allineate allo stesso modo. In alto comincia con la prima
  riga, e l'altezza non si scrive: va dalla prima riga all'ultima.
- **Le righe** sono `tspan` come in ogni testo, una per riga del riquadro,
  con `x` e `dy`: gli a capo sono scritti nel file, e chi lo legge li
  disegna senza calcolarli.
- **`fub:join`** su una riga dice che continua il paragrafo della riga
  prima: `space` se l'a capo ha preso il posto di uno spazio, `word` se cade
  dentro una parola. Una riga senza `fub:join` comincia un paragrafo, e un
  altro valore vale come nessuno. Conta dalla seconda riga in poi, e solo in
  un testo in area; altrove non dice niente, e resta scritto.
- **Il paragrafo** sono le sue righe riunite: con `space` uno spazio fra
  l'una e l'altra, con `word` niente. Le righe tornano il paragrafo senza
  perdere un carattere.
- **Gli a capo** li rifà FubDraw quando cambiano il testo, il riquadro o il
  carattere di un pezzo, spaziatura compresa, e solo allora: il colore, le
  decorazioni e l'interlinea non li toccano. Ogni riga prende le parole che
  ci stanno. Si va a capo dopo una serie di spazi, di cui l'ultimo non si
  scrive, o dopo un trattino (`-`, `‐`, `–` o `—`) che segue un carattere
  che non è uno spazio; gli spazi in fondo alla riga non contano nella
  larghezza. Una parola più larga del riquadro si spezza fra
  due grafemi, e soltanto un grafema da solo può andare oltre. Le larghezze
  sono quelle dei caratteri con cui il testo si disegna (§9), come li disegna
  l'esportazione; la spaziatura delle lettere conta dopo ogni grafema.
- **Una riga nuova di un paragrafo** copia gli attributi della prima, tranne
  `id`, e scende dell'interlinea del testo.
- **Chi non legge `fub:*`**, un browser o un altro programma, vede un testo
  come gli altri, con le righe che FubDraw ha scritto, allineate in `x`:
  manca soltanto il riquadro, che non si disegna. Se un altro programma
  cambia il testo, le righe restano come lui le scrive, e FubDraw le rimanda
  a capo la volta dopo che le rifà. Un lettore di FubDraw più vecchio lo vede
  come un testo da punto e conserva i due attributi, come ogni `fub:*`
  sconosciuto (formato della scena, §10): per questo la versione resta 1.

## 5. Il testo su tracciato

```xml
<defs id="fub-defs">
  <path id="r1a2b3c4d" fub:role="private" d="M40 400 C160 300 280 300 400 400"/>
</defs>
…
<text id="o5e6f7g8h" fill="#0072b2" font-size="24" text-anchor="middle">
  <textPath startOffset="50%" href="#r1a2b3c4d">Sopra <tspan font-weight="bold">la</tspan> collina</textPath>
</text>
```

Un testo che segue una curva, centrato a metà della sua lunghezza, con la
parola «la» in grassetto. La curva da sola non si vede: è una risorsa, e
dice soltanto dove scorre il testo.

- **Il `text`** ha un solo figlio `textPath` al posto delle righe, oltre a
  `title`, `desc` e agli spazi. Un `tspan` accanto al `textPath`, un secondo
  `textPath`, del testo fuori da lui, o una `x` o una `y` sul `text`, che i
  lettori applicano lungo il tracciato in modi diversi, rendono estraneo il
  `text`. Gli altri attributi sono quelli di ogni testo: `text-anchor` dice
  se il testo comincia, sta al centro o finisce nel punto di `startOffset`.
  Un testo su tracciato è una riga sola e non va a capo: `fub:wrap` non
  vale, e resta scritto.
- **Il riferimento** è `href` o `xlink:href`, col valore `#` e l'id di un
  tracciato delle risorse. FubDraw lo legge come SVG 2, `href` prima di
  `xlink:href`, ma un `textPath` modificabile ne ha uno solo: con tutti e
  due, anche uguali, il `text` è estraneo. Un `url(#…)`, un id senza `#`, un
  altro file, o un id che non è di un tracciato delle risorse rendono
  estraneo il `text`; un id che il documento non ha è anche S014 (formato
  della scena, §12).
- **`startOffset`**, facoltativo, è dove comincia il testo lungo il
  tracciato: una lunghezza del formato, anche negativa e con le unità
  assolute, o una percentuale della lunghezza del tracciato. Senza, il
  testo comincia dall'inizio. Ogni altro valore, come `auto` o `1em`, e ogni
  altro attributo SVG del `textPath`, compreso `id`, rendono estraneo il
  `text`; gli attributi degli altri namespace, come `fub:*`, si conservano.
- **Il contenuto del `textPath`** è la riga del testo: dati di carattere e
  pezzi, come in una riga (§2). Un commento, un `title` o un pezzo con `x`
  o `dy` dentro il `textPath` rendono estraneo il `text`.
- **Il tracciato** è una [risorsa](scene-format-resources.md): un `path`
  figlio di una `defs` della radice, con un `id` non vuoto, un `d` nella
  grammatica del formato, anche vuoto, e nessun altro attributo SVG o
  `xlink`; gli attributi `fub:*` e degli altri namespace si conservano, e i
  figli sono soltanto `title`, `desc` e spazi. Un `path` nella `defs` con un altro
  attributo, come `transform` o `fill`, è estraneo, e con lui il testo che
  lo segue; fuori dalla `defs` un `path` è una forma. La `defs` può venire
  prima o dopo il testo, e più testi possono seguire lo stesso tracciato.
- **Il `d`** è nelle coordinate del testo che lo segue: la `transform` del
  testo vale anche per il tracciato. Il testo sta in piedi alla sinistra del
  verso del tracciato: sopra una linea che va da sinistra a destra. Come in
  SVG, le lettere che cadono fuori dal tracciato non si disegnano, e il
  tracciato da solo nemmeno.
- **Il ciclo di vita** del tracciato lo dice `fub:role`, come per le altre
  risorse (formato della scena, risorse, §7): FubDraw scrive `private`, un
  tracciato che è di un testo solo.
- **Dentro una risorsa**, in un motivo, un marcatore, un ritaglio o una
  maschera, un testo su tracciato non sta: rende estranea la risorsa.
- **Un lettore di FubDraw più vecchio** vede estranei il testo e il suo
  tracciato, e li conserva byte per byte; un browser li disegna come FubDraw.

## 6. La scrittura

- **L'ordine degli attributi** è quello del formato della scena, §7, con
  `font-style`, `letter-spacing` e `text-decoration` subito dopo
  `font-weight`, prima di `text-anchor`; `fub:wrap` e `fub:join` subito dopo
  `fub:geom`; `startOffset` subito dopo `d`, quindi prima del riferimento,
  che viene dopo `transform`: `<textPath startOffset="50%" href="#…">`.
- **Una riga sta su una riga del file**, coi suoi pezzi: il testo della riga
  e ogni pezzo uno dopo l'altro, senza spazi o a capo in mezzo, che sarebbero
  testo. Il testo della riga e quello dei pezzi seguono gli escape del testo
  dei `tspan`. Il `textPath` sta su una riga del file allo stesso modo.
- **La spaziatura** si scrive in unità utente con al più due decimali, come
  la geometria; `normal` resta `normal`.
- **`fub:wrap` e `startOffset`**, quando li scrive FubDraw, hanno al più due
  decimali. Lo `startOffset` è una distanza, o una percentuale se lo era già,
  e all'inizio del tracciato non si scrive.
- **Il tracciato** che FubDraw crea va con le risorse nuove (formato della
  scena, risorse, §1), con l'id di una risorsa, `fub:role="private"` e il
  `d` nelle coordinate del testo.
- **Una riga letta e copiata**, come nella riscrittura di un `text` che
  cambia un attributo, porta il suo contenuto così com'è scritto, pezzi
  compresi; così il contenuto di un `textPath`.

## 7. L'operazione `text`

`lines` è la lista delle righe. Una riga è una stringa, oppure la lista delle
sue parti: il testo della riga, una stringa, e i pezzi, ciascuno
`{ "text": "…", "attrs": { "nome": "valore" } }`, con gli attributi come in
un `Elem` ([operazioni sulla scena](scene-operations.md), §2).

```json
{ "op": "text", "id": "o9i0j1k2l", "lines": ["Evaporazione", ["in ", { "text": "pioggia", "attrs": { "font-weight": "bold" } }]] }
```

- **La forma canonica:** le parti vuote si tolgono, due stringhe vicine si
  uniscono, e così due pezzi vicini con gli stessi attributi; un pezzo senza
  attributi è testo della riga, e una riga che resta senza pezzi si scrive
  come una stringa. Così un'operazione e la sua inversa danno gli stessi byte.
- **Il rifiuto:** un a capo o un carattere che XML non ammette, in una riga o
  in un pezzo, una parte che non è né una stringa né un pezzo, un pezzo
  senza `text` o senza `attrs`, un valore che non è una stringa, e un testo
  che dopo la scrittura sarebbe estraneo per §2 o §3 sono `invalid-elem`.
- **L'inversa** porta le righe di prima coi loro pezzi, letti dal file.
- **Le righe nuove** copiano gli attributi della riga prima, tranne `id`,
  `dy` e `fub:join`, come per le righe di sole stringhe: una riga nuova
  comincia un paragrafo. I pezzi non si copiano.
- **`joins`**, facoltativo, è il `fub:join` di ogni riga, una voce per riga:
  una stringa, o `null` per nessuno. Con `joins` l'editor scrive in un passo
  solo gli a capo di un testo in area, le righe e come ognuna continua il
  suo paragrafo; senza, le righe che restano tengono il loro `fub:join`. Una
  voce in più o in meno, una voce che non è una stringa o `null`, o un
  carattere che XML non ammette sono `invalid-elem`. L'inversa di
  un'operazione con `joins` porta quelli di prima.

  ```json
  { "op": "text", "id": "o1a2b3c4d", "lines": ["Il testo in area", "va a capo da so", "lo."], "joins": [null, "space", "word"] }
  ```

- **Un testo su tracciato** ha in `lines` una riga sola, che diventa il
  contenuto del `textPath`, coi pezzi; il `textPath` tiene i suoi attributi,
  il riferimento e `startOffset`. Più righe, nessuna, o `joins`, sono
  `invalid-elem`. L'inversa rimette la riga di prima.
- **`add` ed `Elem`:** un `tspan` figlio di un `text`, o il suo `textPath`,
  può portare `runs`, le parti della riga nella stessa forma, al posto di
  `text`; tutti e due insieme sono `invalid-elem`. È la forma con cui si
  duplica e si incolla un testo coi suoi pezzi.

## 8. Ciò che si legge

- **Il contrasto e la grandezza** del [controllo di
  accessibilità](scene-format-accessibility.md) guardano ogni pezzo col suo
  colore, il suo corpo e il suo peso, nel punto d'inizio della riga: senza i
  caratteri non si sa dove cade il pezzo. Un pezzo piccolo e chiaro in una
  riga grande vuole il contrasto di un testo normale; il corpo più piccolo
  fra le righe e i pezzi è quello di S013. Un pezzo vuoto, di soli spazi o
  senza riempimento non si legge.
- **Un testo su tracciato** è una riga, e S009 e S013 lo guardano nel punto
  di `startOffset` lungo il tracciato, alzato come una riga dalla parte dove
  stanno i caratteri. Oltre un capo del tracciato il punto si ferma al capo;
  un testo su un tracciato lungo zero non si guarda.
- **L'indice** legge ogni riga intera, coi suoi pezzi uniti senza spazi
  (formato della scena, §9), e unisce le righe con uno spazio. In un testo in
  area una riga con `fub:join="word"`, dopo la prima, si unisce senza
  spazio: la parola spezzata si cerca intera. Un testo su tracciato è la sua
  riga.
- **Il riquadro del riepilogo**, `bbox` (formato della scena, §9), conta un
  testo su tracciato per i punti estremi del suo tracciato, dopo la
  `transform` del testo, come un tracciato. Un testo in area conta per i
  punti d'ancoraggio, come ogni testo: la larghezza del riquadro non entra.
- **La scena** dà per ogni riga il suo testo; per un testo in area anche la
  larghezza del riquadro, `wrap`; per un testo su tracciato la sua riga sola
  e l'id del tracciato, `textPath`. I pezzi e i loro attributi restano nel
  documento, e la superficie li legge da lì.

## 9. I caratteri

Un testo si disegna coi caratteri di Fub, Literata, Inter e JetBrains Mono,
e con quelli del vault che nomina; mai con un carattere del sistema o del
web. La scelta è la stessa sulla superficie, nelle sue immagini e
nell'esportazione, quindi le larghezze e gli a capo coincidono. Come la si
vede è in [Disegni, caratteri del vault](../product/drawing-fonts.md).

- **`font-family`** si legge come lo legge l'esportazione (`svgtypes`): una
  lista separata da virgole di nomi fra virgolette, semplici o doppie, o di
  serie di parole; `serif`, `sans-serif`, `monospace`, `cursive` e `fantasy`
  senza virgolette sono le famiglie generiche. Un valore che così non si
  legge, come `Café` o `1Inter` senza virgolette o una virgola seguita da
  spazi in fondo, vale come assente.
- **Le famiglie si provano in ordine.** Inter, Literata e JetBrains Mono
  sono di Fub; `serif` e `cursive` sono Literata, `sans-serif` e `fantasy`
  Inter, `monospace` JetBrains Mono; ogni altro nome si cerca fra i
  caratteri del vault. Una famiglia che non c'è passa la mano alla seguente,
  e in fondo c'è Literata. Due nomi sono la stessa famiglia senza badare a
  maiuscole e minuscole, ma soltanto nell'ASCII.
- **I caratteri del vault** sono i file `.ttf`, `.otf`, `.woff` e `.woff2`
  (`font/ttf`, `font/otf`, `font/woff`, `font/woff2`), anche una raccolta di
  facce in un WOFF2, fino a 64 MiB ciascuno, nell'ordine dell'anagrafe. Una
  faccia vale per ogni nome di famiglia che il file dice; una col nome di
  una famiglia di Fub non conta.
- **La faccia** si sceglie con le regole dei CSS (CSS Fonts 4, §5.2): prima
  la larghezza, poi lo stile, poi il peso; un carattere variabile vale per
  tutto l'intervallo dei suoi assi; a pari merito vince una faccia statica,
  poi l'ordine dei file e delle facce. La faccia scelta si fissa nel punto
  chiesto e diventa un carattere statico con una faccia sola: gli stessi
  byte per la superficie e per l'esportazione. Le famiglie di Fub hanno le
  istanze statiche ai pesi 400 e 700, e l'istanza del file variabile agli
  altri.
- **Niente si inventa:** un grassetto o un corsivo che il carattere non ha
  non si sintetizza. Una lettera che la faccia non ha si cerca nelle
  famiglie che seguono nella lista, poi nei caratteri di Fub.
- **Il tetto:** un disegno porta al più 64 MiB di caratteri fissati, di Fub
  e del vault, contati nell'ordine del documento; una faccia che non ci sta
  vale come una famiglia che non c'è.
- **La scrittura:** FubDraw scrive una famiglia del vault col suo nome e
  dopo la famiglia generica a cui la faccia somiglia, `Roboto, sans-serif`.
  Il nome va come parola se `svgtypes` e il browser lo rileggono uguale, se
  no fra virgolette doppie, se no fra semplici; un nome che in nessun modo
  si rilegge uguale non si scrive.
- **Gli a capo** di un testo in area (§4) si misurano con la faccia del
  vault quando è arrivata: un cambio che li rifà la aspetta. Aprire un
  disegno non li rifà, anche se il carattere nel frattempo è cambiato.
- **L'esportazione** nomina nel log le famiglie che non ha trovato, i file
  che non si leggono, le facce oltre il tetto e i caratteri la cui licenza
  (`fsType`) non lascia incorporarli: nel PDF il loro testo va a tracciati
  ([esportazione](scene-format-export.md), §5).
