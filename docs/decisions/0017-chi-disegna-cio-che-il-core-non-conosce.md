# 0017 — Chi disegna ciò che il core non conosce

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §3.1–§3.6 (seduta 3, *ex* §1.20, §1.22, §1.23, §1.26, §3.4, §3.12) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/03-chi-disegna-cio-che-il-core-non-conosce.md) · [il protocollo](../architecture/ui-protocol.md)

---

Il quarto giro lo diceva alla lettera: **§3.1, §3.2 e §3.3 sono una decisione
sola vista da tre lati** — chi aggiunge la *sintassi*, chi disegna il *blocco*
che ne esce, chi fa entrare un renderer di terzi nella *shell* — e vanno prese
insieme o due terzi della risposta sono inutilizzabili. Con loro il §3.4 e il
§3.5, che aprono le stesse porte dal lato delle opzioni e dei tipi chiusi troppo
presto, e il §3.6, che è la domanda «e se il blocco custom resta una stringa
HTML, chi la ripulisce?».

Sei voci su sei sono chiuse. Il **§3.3 resta aperto per la sua metà di
implementazione** e si è ristretto a una riga sola: la sua decisione è presa e
scritta qui sotto.

## La risposta, in una frase

**Il perno è il `custom_kind`.** Un nome con namespace lo produce
([`SyntaxRule`](../../crates/fubmd-abi/src/custom.rs), §3.1), lo stesso nome lo
disegna ([`CustomRenderer`](../../crates/fubmd-abi/src/custom.rs), §3.2), e lo
stesso nome arriva alla shell dentro `UiKind::Custom { ns }` (§3.3). Chi ne
registra uno solo ha scritto mezzo plugin — e adesso il registro **glielo può
dire**, perché prima non c'era nemmeno un posto dove accorgersene.

Le decisioni prese, da NON ridiscutere senza motivo:

- **Una regola sintattica agisce sul modello, non sul flusso di caratteri**
  (§3.1). È questo che la rende innestabile su un provider che non la conosce: il
  provider parsa senza sapere che esiste, e la regola riscrive i nodi che
  rivendica. Prima l'unico modo di aggiungere una sintassi al markdown era
  **sostituire** il provider markdown, ed era l'unico punto in cui l'invariante
  del progetto — «una feature ufficiale è ciò che scriverà un plugin di terzi» —
  era già falsa. Il prezzo è dichiarato e sta nel doc del modulo: una regola non
  può cambiare come la grammatica di base spezza il testo. Non si può far
  significare altro a `**`. Si può fare ciò che i due trigger nominano —
  prendersi un recinto che il provider ha già riconosciuto come tale
  (`SyntaxTrigger::Fence`) e prendersi un tratto di testo fra due delimitatori
  (`SyntaxTrigger::Inline`) — e sono le due forme in cui è scritta la maggioranza
  delle ~50 estensioni del 5.2.
- **Una regola produce solo l'escape hatch**, mai un nodo del vocabolario
  centrale. Nessuno può innestare una sintassi che finge di essere un `Heading`,
  e chi consuma il modello sa che tutto ciò che arriva da un terzo porta un
  `custom_kind` con un namespace addosso. È il confine che tiene il modello
  leggibile a chi non conosce le estensioni installate.
- **Il conflitto ha finalmente dove accadere.** `FormatRegistry::register` faceva
  `insert` su una mappa estensione → un indice: chi registrava dopo vinceva **in
  silenzio**. Ora restituisce un `Result`, e sostituire un provider resta
  possibile ma si chiede per nome (`FormatRegistry::replace`). Lo stesso per le
  regole: due che rivendicano `fence:mermaid` sullo stesso formato sono un
  `SyntaxConflict`, e la seconda **non si registra affatto** — nemmeno per le
  sintassi libere che portava con sé, perché una regola registrata a metà
  funziona per alcuni file e non per altri, che è peggio di una non registrata.
- **Un renderer produce HTML *oppure* un albero `UiNode`** (§3.2), e le due
  strade non sono simmetriche: `Html` è markup e passa dal punto unico di
  sanitizzazione; `Ui` è **sicura per costruzione** — nessun campo di un `UiNode`
  è interpretato come markup — e viaggia fino alla shell, che la monta con lo
  stesso `mountTree` delle view. La terza risposta è `Fallback`, «non lo disegno
  io», che è diversa da un errore: è ciò che un renderer dice quando gli `attrs`
  non sono quelli che si aspettava.
- **La composizione la fa il kernel spezzando il corpo, non facendo chirurgia
  sull'HTML.** `render_html` resta una funzione pura per-documento che non
  conosce i renderer registrati — se li conoscesse, aggiungerne uno vorrebbe dire
  toccare ogni provider. Il kernel rende col provider le **corse** di blocchi che
  nessuno rivendica e i blocchi custom col loro renderer, poi concatena. È
  esattamente ciò che `render_embed` faceva già rendendo un sottomodello, e non
  richiede nessun segnaposto da riconoscere in una stringa. Il limite dichiarato:
  si delegano i blocchi custom **di primo livello**; uno annidato dentro una
  citazione resta al provider, che lo degrada. Cade dove fa meno male — un
  diagramma o una formula a display non si scrivono al terzo livello di un elenco
  puntato.
- **`render_preview` non restituisce più una stringa** ma un `RenderedDocument
  { html, parts }`: l'HTML porta un buco `data-ui-slot="N"` e la parte con quel
  numero ci va dentro. Il segnaposto lo scrive **il kernel** e non il provider,
  perché un formato deciso dal provider diventerebbe contratto per tutti.
- **Fra le tre opzioni del §3.3 si è scelta la terza** — *solo prima parte, e
  tutto il resto dichiarativo* — e con una precisazione che il §3.3 chiedeva: il
  protocollo dichiarativo **arriva ai blocchi custom**, non solo alle view.
  Quindi il blocco di un plugin arriva a schermo senza una riga nel bundle della
  shell. Le altre due sono scartate, non rimandate a caso: il registro di web
  component sbatte contro «no eval policy» (20.3) e contro la CSP che questa
  seduta stringe; l'**iframe sandboxato con un protocollo di messaggi** è la
  strada giusta per il widget vero, regge 20.3 e la CSP, e va a M5 con l'asset
  story e la CSP dedicata che la [decisione 0016](0016-cosa-e-una-view.md) aveva
  già messo lì per `WebView`. Farne due (dichiarativo ora, iframe poi) non è un
  ripensamento: sono due livelli, e il primo è quello che venti moduli Suite
  useranno per il 90% di ciò che disegnano.
- **`UiKind::Custom` ha il suo primo cliente**, che è ciò che la
  [decisione 0016](0016-cosa-e-una-view.md) aspettava per costruire il ramo «la
  shell che conosce `ns`». Il cliente è il diagramma, e ha portato con sé la
  scoperta che quel ramo **ancora non serve**: il `fallback` dichiarativo è già
  la resa giusta finché non c'è un motore da invocare. Il registro `ns` → widget
  resta quindi non costruito, per la stessa ragione di prima e con un cliente in
  più che lo conferma invece di smentirlo.
- **I quattro tipi chiusi troppo presto diventano una mappa con namespace**
  (§3.5), e la risposta è **un tipo solo** — `OptionMap`, chiave `ns:nome`, valore
  = il parametro. `FormatCapabilities` (5 booleani), `ParseContext` (2),
  `RenderOptions` (1), `PluginPermissions` (3). Il §3.5 diceva che vanno in blocco
  perché la scadenza è comune e non è la larghezza ma la **forma**: un campo
  appeso in fondo a un `record` è additivo e il presidio della
  [decisione 0002](0002-additivita-del-contratto.md) lo fa passare; sostituire N
  booleani con una mappa è la sola cosa che dopo il freeze non si fa più.
- **`FormatCapabilities` e `ParseContext` condividono il vocabolario.** Era la
  scoperta che il §3.4 e il §3.5 nascondevano ognuno per metà: «cosa so fare» e
  «cosa devi accendere» sono la stessa domanda vista da due lati, e tenuti
  separati la terza sintassi li avrebbe fatti divergere. Le chiavi del core
  stanno in [`options::syntax`](../../crates/fubmd-abi/src/options.rs), un elenco
  solo.
- **`RenderTarget` è un `enum` e non una voce della mappa.** I bersagli — schermo,
  stampa, PDF (6.3), pubblicazione statica (19.4) — sono **esclusivi**: si rende
  per uno alla volta, e chi riceve `opts` deve poterlo trattare con un match. La
  mappa serve a ciò che è additivo e concorrente (tema, asset, CSS per
  nota/cartella/tipo), non a ciò che è alternativo.
- **`parse` prende un `DocumentSource`** e il `FormatDescriptor` dichiara quale
  forma vuole (§3.4). «Leggi il file» e «decodificalo come UTF-8» erano la stessa
  operazione, e per un `.canvas` (12), un CSV con un encoding suo (11.4, 2.3) o un
  PDF (13.2) la seconda metà è sbagliata: o fallisce o corrompe. Un provider
  testuale che riceve dei byte risponde `Unsupported` invece di indovinare —
  l'encoding è una decisione, non un tentativo. La metà kernel di questa voce
  (cosa il vault sa leggere, cosa è un asset invece che un documento) resta il
  §14.1.
- **`Trust` da due gradi a cinque** (§3.5): `Core`, `Verified`, `Community`,
  `Development`, `Revoked`. È l'unico dei quattro che vive nel kernel e la cui
  forma non scade col freeze, e sta nella stessa voce perché la domanda è la
  stessa. La differenza con gli altri tre è che qui i casi sono **ordinati ed
  esclusivi**, quindi la risposta non è una mappa: è un grado. E la regola non si
  allarga con i gradi nuovi — `allows_active_content()` resta vero solo per
  `Core`: `Verified` dice che *si sa chi è*, non che il suo `<script>` sia
  benvenuto nella webview che ha l'IPC a pieni privilegi.
- **L'HTML che entra nella webview passa da un punto solo** (§3.6). Erano tre e
  nessuno dei tre sapeva degli altri: `UiNode::Html` con un `innerHTML` diretto,
  l'anteprima, il contenuto di un embed. Ognuno si fidava di chi lo aveva
  prodotto, e «tanto il rendering è già escapato lato Rust» è vero *oggi* e per
  *quel* produttore. Il sanitizer restituisce un `DocumentFragment` e non una
  stringa, di proposito: una stringa ripulita che il chiamante rimetta in
  `innerHTML` viene parsata **due volte**, e la doppia parsatura è la classe di
  difetti che i sanitizer pagano più cara.
- **Sanitizer e CSP rispondono a due domande diverse**, e servono tutti e due: il
  primo decide *cosa entra* nel DOM, la seconda *cosa può fare* una volta
  entrato. Un sanitizer con un buco lascia passare un tag; la CSP lo rende
  comunque incapace di eseguire o di chiamare casa.
- **Un link è navigazione, una risorsa è caricamento**, e la differenza è tutta
  lì. `<a href="https://…">` passa: è l'utente a decidere se seguirlo. `<img
  src="https://…">` no: parte da solo, senza che nessuno clicchi, e dice a chi lo
  serve che quella nota è aperta. È il blocco di default di 5.3 e 23.2; il
  consenso esplicito ha già il parametro (`risorsaConsentita(v, true)`) e gli
  manca solo dove l'utente lo esprime, che è il §11.1.

## Il dogfooding, che è dove si è scoperto se regge

Tre regole e due renderer ufficiali, in
[`fubmd-features/src/blocks.rs`](../../crates/fubmd-features/src/blocks.rs).
Nessuna delle tre tocca il provider markdown e nessuno dei due renderer sta
dentro di lui: un plugin di terzi scriverebbe **esattamente quel codice**, con un
altro namespace. Ognuno ha esercitato una parte diversa:

- **`fubmd:diagrams`** (recinto `mermaid`, `plantuml`, `graphviz`, `dot`, `d2`)
  col suo renderer — è la catena intera, e l'unica che arriva fino alla shell. Il
  motore sta negli `attrs` e non nel `custom_kind` perché il kind è la
  **famiglia**: chi disegna i diagrammi vuole un punto d'innesto solo, e chi
  aggiunge un dialetto non deve registrarne un altro.
- **`fubmd:math`** (recinto `math`, `latex`, `tex`) — la via HTML. Senza un motore
  TeX nel bundle, ciò che si può fare onestamente è dare alla formula un blocco
  suo e conservare il sorgente in un `data-tex`: non è un segnaposto che finge, è
  la formula, non composta.
- **`fubmd:highlight`** (`==…==`) — l'unico trigger inline, ed è qui per provarlo:
  un delimitatore che comrak **non conosce affatto** diventa un nodo del modello
  senza toccare il provider. Ha anche trovato un difetto vero: il degrado generico
  degli inline non emetteva **niente**, quindi un `Inline::Custom` sconosciuto
  faceva sparire il testo in silenzio. Era il gemello inline del difetto che il
  §3.2 nomina sui blocchi, con l'aggravante che non restava nemmeno il contenuto.

Il test che conta di più è
[`una_sintassi_di_terzi_percorre_tutti_e_tre_i_lati`](../../crates/fubmd-features/tests/custom_blocks_e2e.rs):
senza di lui gli altri provano tre metà di plugin. Un `ganttino` immaginario
innesta la sua sintassi su un provider che non la conosce, registra il renderer
del kind che produce, e arriva alla shell come albero — e il suo gemello ostile
prova che da un renderer non fidato il contenuto attivo **non passa**, con lo
stesso `UiNode::validate_untrusted` e lo stesso punto unico delle view.

## La linea di base ritagliata

Il presidio dell'additività ha nominato **cinque** rotture, ed è il suo mestiere:
sono deliberate, sono pre-freeze, e la baseline è stata ritagliata con la ragione
scritta dentro `wit/frozen/0.1.0.wit` (più la riga nella tabella dei ritagli del
suo README).

| cosa | perché |
|---|---|
| `format-capabilities`: 5 booleani → `syntax: option-map` | il vocabolario condiviso col `parse-context` (§3.5 con §3.4) |
| `parse-context`: `parse-tags`/`parse-wikilinks` → `options: option-map` | ~50 sintassi, non due (§3.4) |
| `render-options`: `wikilinks-as-data-attrs: bool` → `target` + `options` | tre bersagli, e una coda aperta (§3.5) |
| `plugin-permissions`: 3 booleani → `granted: option-map` | un permesso ha un **parametro**: l'allowlist di 20.3 (§3.5) |
| `format.parse`: `source: string` → `document-source` | i documenti non-testo (§3.4) |

Tutto il resto è **additivo** e passa il presidio senza toccare niente:
l'interfaccia `options`, le due interfacce nuove (`syntax`, `renderer`) coi loro
tipi, `source-kind`, `render-target`, il campo `source` in fondo a
`format-descriptor`, e i due export nuovi del `plugin-world`.

`syntax` e `renderer` sono esportate **separatamente** da `format` proprio perché
un plugin può implementarne una senza l'altra — ed è esattamente ciò che «mezzo
plugin» significa.

## Cosa NON è stato fatto, e perché

- **La metà implementativa del §3.3 resta aperta**, e si è ristretta a una riga:
  il grafo è ancora un pannello nativo. Non è più bloccato da questa seduta —
  l'area principale c'è nel contratto dalla [decisione 0016](0016-cosa-e-una-view.md)
  e adesso c'è anche come si disegna — ma portarcelo vuole il modello di layout,
  che è il §1.2 e va con `PaneId` e le sessioni multiple del §9.6.
- **Il registro `ns` → widget nella shell non c'è**, ed è la stessa diagnosi
  della decisione 0016 con un dato in più: il primo cliente è arrivato, e ha
  mostrato che il `fallback` dichiarativo *basta* finché non c'è un motore da
  invocare. Costruirlo adesso sarebbe costruirlo per un cliente che non lo usa.
- **Una parte dichiarativa non riceve azioni.** Un `mountTree` su uno slot passa
  un `onAction` che non fa niente, perché una parte è un **disegno** e non ha un
  `ViewProvider` a cui mandare un click. Chi vorrà un blocco interattivo passerà
  da una view sull'area principale. È scritto nel codice invece che lasciato a un
  `TODO` che diventa un errore a runtime.
- **Uno span esatto per un match inline non esiste.** `Inline::Text` non porta uno
  `Span`, quindi dopo il parse non c'è più modo di risalire agli offset di un
  tratto di testo dentro un paragrafo: `SyntaxMatch.span` è quello del contenitore
  (della **cella**, per una tabella, che è già più stretto). Il limite è
  dichiarato in tre posti — il doc di `SyntaxMatch`, quello di `with_inlines`, e
  qui — ed è un debito del **modello**, non di questo registro.
- **Il cammino sul DOM del sanitizer non è testato.** La sua *politica* — quale
  tag, quale attributo, quale URL — è un pugno di funzioni pure con otto test,
  perché è lì che si sbaglia in un modo che non si vede. Ciò che tocca il DOM
  davvero vuole un ambiente DOM nei test, che questa shell non ha: è il §17.2, ed
  è la stessa divisione con cui la decisione 0016 ha trattato il riconciliatore.
- **Il §3.6 chiedeva anche il «sandbox degli embed (iframe, SVG, PDF)».** Oggi è
  soddisfatto **per esclusione** e va detto così: `iframe` e `object` sono
  cancellati dal sanitizer, `frame-src 'none'` li ferma comunque, e SVG e PDF
  incorporati non esistono ancora. Il giorno che esisteranno entreranno da quel
  punto, che è precisamente il motivo per cui il punto è uno.
- **Un renderer che fallisce non lo sa nessuno.** Degrada al provider, che è il
  comportamento giusto — un'estensione rotta rende un documento meno ricco, non
  illeggibile — ma il canale con cui quel fallimento arriva a un umano è il §20.2,
  e non esiste. Lo stesso per `Workspace::undrawn_kinds()`, che il §3.2 chiedeva
  di poter **contare**: il conto c'è ed è esatto, la superficie dove mostrarlo è
  il §20.4.
- **`undrawn_kinds()` conta i soli kind di *blocco*.** Un `Inline::Custom` lo
  disegna il provider nel suo degrado generico e un renderer non può
  rivendicarlo: contarlo vorrebbe dire segnalare come «senza renderer» qualcosa
  che un renderer non può avere, cioè un allarme che non si può spegnere — e un
  allarme che non si può spegnere è un allarme che si impara a ignorare. La
  divisione si legge dal **trigger**, perché è il trigger a decidere quale delle
  due passate applica la regola.

## Verifica

`cargo test --workspace`: **481 verdi** (erano 456), fra cui la conformità
abi↔WIT con le due interfacce nuove, l'additività col ritaglio dichiarato, i
mirror TS↔Rust rigenerati e gli otto test end-to-end della catena. `npx tsc`
pulito, **160 test vitest** (erano 152: otto li porta la politica del
sanitizer), `vite build` ok.

**Non verificato visivamente nell'app Tauri.** Due cose in particolare meritano
un occhio quando qualcuno la aprirà, e sono le due che i test di questa shell non
possono vedere: la **CSP stretta**, che è il tipo di cambiamento che non rompe
niente finché non rompe tutto in un punto solo (CodeMirror scrive stili inline, e
`style-src 'unsafe-inline'` è lì apposta — ma l'unica prova vera è la finestra
che si apre), e il **sanitizer sull'anteprima**, dove un attributo dimenticato
nell'allowlist non è un test rosso: è una tabella che perde l'allineamento.
