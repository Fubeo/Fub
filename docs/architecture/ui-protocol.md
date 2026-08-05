# Protocollo di UI dichiarativa (`UiNode`)

Un plugin (o una feature ufficiale) **descrive** la propria UI come albero
`UiNode` serializzabile e neutro rispetto al framework; il frontend del core lo
**disegna** con i suoi componenti nativi. Risultato: temi coerenti, niente JS nei
plugin, stessa strada per feature native e plugin di terzi.

Definizione: `crates/fub-abi/src/ui.rs`. Renderer e riconciliatore:
`frontend/src/ui/node.ts`. Cosa è una view, e perché:
[decisione 0016](../decisions/0016-cosa-e-una-view.md).

Torna a [../PIANO.md](../PIANO.md) · vedi [traits.md](traits.md).

## Un nodo è una chiave e una specie

`UiNode` è il record `{ key, kind }`. La **chiave** è l'identità del nodo
attraverso due ridisegni: stabile e unica **fra i fratelli** (l'id di un
documento, non l'indice nella lista), ed è ciò su cui il riconciliatore lavora.
Senza, l'identità di un nodo è la sua posizione — e una lista che si riordina si
porta dietro il focus e la selezione di qualcun altro. Chi non ha liste che si
riordinano può ometterla.

## Ogni etichetta è un `Text`, non una `String`

Dalla [decisione 0040](../decisions/0040-chi-localizza.md), **ogni campo che una
persona legge** — `content`, `title`, `label`, `subtitle`, `placeholder`,
`submit_label`, `message` — è un
[`Text`](../../crates/fub-abi/src/text.rs): o un `Literal` (un dato: un nome di
tag, un path) o un `Message` (una chiave del catalogo di chi l'ha scritta, coi
suoi argomenti). A risolverlo è il **kernel**, sulla via d'uscita dal contratto.

Per chi disegna nella shell non cambia niente: quando l'albero arriva alla
webview ogni `Text` è già un `Literal`, e un `Literal` sul filo è una stringa
nuda. Per chi scrive un provider cambia una cosa sola: i builder prendono
`impl Into<Text>`, quindi `UiNode::text("ciao")` continua a funzionare.

**Non** sono `Text`, e non lo diventeranno: `Icon.name` (un id del repertorio
della shell), `Custom.ns`, `Html.html`, `WebView.url`, i `field` e i `value` dei
nodi di input, il `value` di una `UiOption`. Tradurli romperebbe l'identità che
sono.

## Le specie di nodo

**Struttura di base**

| Specie | Campi | Reso dal frontend come |
|---|---|---|
| `Stack` | `dir: Axis`, `gap: u8`, `children` | `div` flex (row/column) |
| `Text` | `content` | `div.ui-text` |
| `Heading` | `level: u8`, `content` | `h1..h6` |
| `List` | `items` | `div.ui-list` |
| `ListItem` | `title`, `subtitle`, `action: Option<ActionRef>`, `selected` | riga cliccabile |
| `Button` | `label`, `intent: Intent`, `action: ActionRef` | `button.intent-*` |
| `Html` | `html` | `div.ui-html` (frammento già renderizzato) — **solo codice fidato** |
| `WebView` | `url`, `height: u32` | `iframe` sandboxed (`allow-scripts`) — **solo codice fidato** |

**Nodi strutturali**

| Specie | Campi | Reso come |
|---|---|---|
| `Section` | `title`, `collapsed`, `children` | `details`/`summary` (la piega è della shell) |
| `Table` | `columns: Vec<TableColumn>`, `rows` | `table` (le righe sono nodi: hanno una chiave) |
| `Row` | `cells`, `action` | `tr` cliccabile |
| `Tree` | `roots` | `div.ui-tree` |
| `TreeItem` | `label`, `expanded`, `action`, `selected`, `children` | voce annidata |
| `Tabs` | `active: u32`, `tabs` | linguette + corpo (cambiare scheda non disturba il provider) |
| `Tab` | `label`, `action`, `children` | il corpo di una scheda |
| `Badge` | `label`, `intent` | `span.ui-badge` |
| `Icon` | `name` | icona del repertorio della shell; un nome ignoto non disegna nulla |
| `Progress` | `value: Option<f32>`, `label` | `progress` (assente = indeterminato) |
| `Separator` | — | `hr` |
| `EmptyState` | `title`, `detail`, `action` | il vuoto, e cosa si può fare |
| `KeyValue` | `entries` | `dl` |

**Nodi di input.** Ognuno porta il `field` (la chiave sotto cui il valore torna
in `UiAction::fields`), il `value` che il provider vuole vederci **adesso** — il
protocollo resta senza stato lato shell — e un'`action` opzionale che scatta
quando il valore si assesta.

`TextInput`, `TextArea`, `Number`, `Checkbox`, `Select`, `Radio`, `Slider`,
`DatePicker` (data civile ISO-8601: una stringa, non un istante — il tempo civile
è nel locale, [decisione 0039](../decisions/0039-il-locale-e-il-caso.md)), e
`Form { children, submit_label, submit }`, che inviando manda **tutti** i campi
contenuti.

**Il varco, e i due stati**

| Specie | A cosa serve |
|---|---|
| `Custom { ns, payload, fallback }` | la shell che conosce `ns` disegna il suo widget, chi non lo conosce disegna il `fallback` dichiarativo |
| `Pending { label }` | «non ancora»: il dato lo sta preparando qualcuno |
| `Failed { message, retry }` | «non ce l'ho fatta», con l'invito a riprovare |

`Pending`/`Failed` sono **nodi** e non risposte di `render_view` perché il caso
normale è parziale: la testata c'è, la tabella arriva.

Tipi di supporto: `Axis { Row, Column }`, `Intent { Neutral, Primary, Danger }`
(i plugin scelgono **intenti semantici, non colori**: il tema è del core),
`Align`, `ActionId(String)`, `ActionRef { action, payload }`,
`UiValue { Text | Number | Bool | Choices }`, `FieldValue { field, value }`,
`UiOption`, `KeyValueEntry`, `TableColumn`.

## Chi mette cosa in un'azione

Un'azione ha **due metà con due proprietari**, e nessuno dei due tocca l'oggetto
dell'altro:

- il **provider** attacca al nodo un `ActionRef`: l'id e il `payload` che gli
  serve per riconoscere *su cosa* si è cliccato. Torna a lui intatto;
- la **shell** riempie `UiAction::fields` con lo stato dei campi in vigore —
  quelli del `Form` che contiene l'azione, o quelli della view intera fuori da un
  form. Un campo dichiarato due volte compare una volta sola, con l'ultimo
  valore.

L'`ActionId` è quindi **opaco**: non è un canale dati. La convenzione privata di
prima — i dati concatenati dentro l'id (`open:a/Uno.md`, `tag:rust`) — stava
diventando contratto de facto.

## Ciclo azione → aggiornamento

1. Il frontend monta l'albero via `mountTree(container, node, onAction)`: la
   prima volta disegna, dalle successive **riconcilia**.
2. Un click (o il cambio di un campo) manda al `ViewProvider`
   `UiAction { action, payload, fields }`, insieme all'istanza che lo ha emesso.
3. Il provider — che qui prende `&mut self`, e può quindi ricordare — risponde
   con `ViewUpdate`:
   - `Replace { root }` — rimpiazza l'albero della view (che la shell
     riconcilia, non ricostruisce);
   - `Patch { key, node }` — rimpiazza **il solo nodo** con quella chiave; una
     chiave che non si trova non è un errore, è una view cambiata sotto;
   - `None` — nessun cambiamento;
   - `Navigate { doc_id }` — chiede al core di aprire un documento;
   - `Reveal { doc_id, span }` — apri (se serve) e porta la vista su un
     intervallo; `span` è in byte UTF-8, il frontend lo mappa sull'editor con
     `frontend/src/rules/offsets.ts`;
   - `RunSearch { query }` — esegui una ricerca e mostrane i risultati;
   - `Custom { ns, payload }` — intento che questa shell non prevede: chi non
     riconosce `ns` non fa nulla.

Il giro è servito dai comandi `render_view`/`view_action`/`set_active_context` e
montato in `frontend/src/ui/views.ts`. Lo esercitano i backlink (`open` col
`DocId` nel payload → `Navigate`), l'outline (`reveal` con lo span → `Reveal`),
il pannello tag (`search` col tag → `RunSearch`, più il campo `filter` che è il
collaudo dello stato) e le statistiche.

## Le istanze: quale esemplare sta disegnando

`render_view` e `on_action` ricevono una `ViewInstance { view, instance, params }`.
`views()` resta un elenco **statico** di specie; un esemplare serve a dire
*questa view, con questo parametro* — le viste multiple di un database, le viste
salvate, le query embed parametriche, i task per tag / per cartella / per data.

I `params` sono dichiarati in `ViewSpec::params` con gli **stessi `ParamSpec` dei
comandi**, e la convalida è la stessa funzione (`command::validate_params`): chi
apre una view da un comando e chi la apre a mano ricevono la stessa risposta
sullo stesso argomento sbagliato. Il punto di applicazione è uno, il kernel.

Chi apre un'istanza è un comando (`CommandEffect::OpenView { view, params }`). La
shell monta da sé l'**esemplare unico** di ogni view dichiarata: si chiama come
la sua specie e non ha parametri.

## Le superfici: dove una view si ancora

`ViewSurface` ne nomina dieci: `LeftSidebar`, `RightSidebar`, `Bottom`, `Main`,
`Modal`, `StatusBar`, `Ribbon`, `Menu`, `ContextMenu`, `SettingsTab`. Non è un
modello di layout: dice **a cosa ci si attacca**, non come lo spazio è diviso.

Questa shell ne ospita **sette**: le sei di prima più la scheda di impostazioni,
che dal §11.1 ([decisione 0036](../decisions/0036-le-impostazioni-e-i-tre-stati.md))
ha un pannello dove stare. Le tre che restano — area principale, menu, menu
contestuale — vogliono il modello di layout (feature 3.3), un menu applicativo e
un menu contestuale estendibile. Una view che le chiede **riceve un avviso che la
nomina** invece di sparire in silenzio.

La scheda di impostazioni è ospitata con un limite dichiarato: le view che la
chiedono si montano **tutte nella stessa area**, sotto il form generato dallo
schema, e non ognuna in una scheda sua — una scheda per view vuole il modello di
layout come tutto il resto.

`ViewSpec` porta anche come si presenta: `icon`, `order` (crescente, i pari
merito nell'ordine di registrazione), `open_by_default`, `preferred_size` (vale
alla prima apertura) e `closable`.

## Quando una view invecchia: due maschere e un invito

`ViewSpec` dichiara `refresh: EventMask` **e** `follows: ContextMask`. La prima
sono gli eventi del **vault** al cui arrivo serve un nuovo `render_view`; la
seconda le parti del **contesto di sessione** (documento, selezione, modalità)
che la view guarda. Sono separate perché un cursore che si muove non è un fatto
del vault: farlo passare dall'event bus significherebbe consegnare ogni battuta
di tasto a ogni handler registrato.

`refresh` non è una lista di specie: è la maschera per intero
([decisione 0033](../decisions/0033-la-grana-di-un-abbonamento.md)) — specie,
prefissi di topic dei custom e **soggetto** — e ad applicarla è la shell, con la
stessa regola del kernel (`maskWants` in `frontend/src/rules/mirrored.ts`,
gemella di `fub_abi::rules::events::mask_wants` e legata a lei dalla fixture
generata). Filtrando sulle sole specie, una view poteva restringere quanto voleva
e la shell la ridisegnava lo stesso: la promessa del contratto sarebbe stata vera
nel kernel e falsa in finestra. Per la stessa ragione i pannelli **nativi**
dichiarano una maschera e non una lista (`refreshOn(...)` in `ui/panel-host.ts`).

La shell pubblica il contesto con `set_active_context` e riceve **gli id delle
view da ridisegnare**: il conto lo fa il kernel, che conosce le `follows`. Senza
questa metà, l'unica strada sarebbe ridisegnarle tutte a ogni movimento del
cursore — cioè una `query_index` per battuta di tasto.

La terza strada è l'**invito**: un provider che finisce un lavoro lungo emette
`Event::ViewInvalidated { view, instance }`. È un evento e non una capacità
`invalidate_view` per la regola della
[decisione 0013](../decisions/0013-elenco-delle-capacita.md): *una capacità è ciò
di cui il chiamante ha bisogno della risposta per proseguire; ciò che si limita a
informare è un evento*. `instance` assente = tutte le istanze. Il **freno** è di
chi disegna: venti inviti in un giro sono un ridisegno, e la finestra è un
microtask.

Cosa dichiarano le sette view ufficiali: i backlink solo `Document` (i backlink
di una nota sono gli stessi da ogni punto di essa), l'outline
`Document + Selection` (segna la sezione in cui sta la primaria), le statistiche
tutto (contano la selezione e cambiano faccia in lettura), la cronologia
`Document` (la storia è di *quella* nota), il pannello tag e il cestino
**niente** — la distribuzione dei tag del vault, e cosa c'è nel cestino, sono le
stesse da qualunque nota le si guardi — e il grafo **niente nemmeno lui**, né dal
contesto né dagli eventi: la sua maschera è vuota, perché ridisegnarlo vuol dire
far ripartire una simulazione sotto il mouse di chi la sta guardando.

## La regola dell'escape hatch — e il confine di fiducia

`Html` e `WebView` sono escape hatch, da **usare con parsimonia**:

- **`Html`** — un frammento già renderizzato dal core (es. l'anteprima HTML di un
  backlink). Non è codice del plugin, è output del core reinserito nell'albero.
  Passa **comunque** dal punto unico di sanitizzazione (`ui/sanitize.ts`, §3.6):
  i due presidi rispondono a due domande diverse — il kernel dice *chi* può
  mandare markup, il sanitizer *quale* markup entra nella webview — e il codice
  fidato non è codice infallibile.
- **`WebView`** — iframe isolato (`sandbox="allow-scripts"`). È l'unico punto in
  cui gira codice arbitrario del plugin. Si usa solo quando la resa dichiarativa
  non basta davvero e il contenuto richiede un canvas/DOM proprio.

**Confine di fiducia.** `Html` e `WebView` iniettano contenuto attivo nella
webview principale, che parla con l'IPC Tauri a pieni privilegi: un plugin
sandboxato che potesse emetterle scavalcherebbe l'intera sandbox *via UI* —
memoria isolata ma `<script>` iniettato nel core. Quindi:

- le due varianti sono **riservate al codice fidato** (core e feature ufficiali);
- l'host che riceve un albero da un provider **non fidato** lo rifiuta con
  `UiNode::validate_untrusted()` (in `fub-abi`, con test): `PermissionDenied`
  se `Html`/`WebView` compaiono ovunque nell'albero. Il punto di enforcement è
  **uno**: `Workspace::render_view` e `Workspace::view_action`, dove i provider
  si registrano col proprio grado di fiducia
  (`register_view_provider(id, Trust, provider)`). Vale anche per l'albero che
  torna dentro un `ViewUpdate::Replace`, cioè in risposta a un click — un
  controllo fatto solo su `render_view` sarebbe aggirabile in un gesto. Oggi
  nessun provider non fidato esiste e la validazione è un no-op: il varco esiste
  *prima* del primo (test in `crates/fub-kernel/tests/view_trust.rs`);
- `WebView` tornerà disponibile ai plugin solo quando esisteranno una **asset
  story** (asset del plugin serviti dall'host, non URL arbitrari) e una **CSP**
  dedicate — da progettare a M5.

## L'HTML entra da un punto solo

Ogni frammento di HTML che finisce nella webview passa da
`frontend/src/ui/sanitize.ts` (§3.6): `UiNode::Html`, l'anteprima del documento,
il contenuto di un embed. Prima erano tre punti e nessuno sapeva degli altri.

Il sanitizer restituisce un `DocumentFragment` e non una stringa **di proposito**:
una stringa ripulita che il chiamante rimetta in `innerHTML` viene parsata due
volte, e la doppia parsatura è la classe di difetti che i sanitizer pagano più
cara. La **politica** — quale tag, quale attributo, quale URL — è un pugno di
funzioni pure sotto test; il cammino sul DOM no, perché questa shell non ha un
ambiente DOM nei test (§17.2).

Due regole che non sono simmetriche:

- un **link** è navigazione, e un `https://` esterno passa: è l'utente a decidere
  se seguirlo (e riceve `rel="noopener noreferrer"`);
- una **risorsa** (`src`) è caricamento: parte da sola e dice a chi la serve che
  quella nota è aperta, quindi il remoto è bloccato di default (5.3, 23.2).

La CSP in `tauri.conf.json` è l'altra metà: il sanitizer decide *cosa entra* nel
DOM, la CSP *cosa può fare* una volta entrato.

## Transclusion (embed): placeholder + composizione

`FormatProvider::render_html` è una funzione **pura per-documento**: non ha
`HostApi` e non può leggere altri documenti. Un embed `![[Page#Heading]]` quindi
non viene risolto dal provider: esce come placeholder

```html
<div class="embed" data-embed-page="Page" data-embed-heading="Heading">…</div>
```

e la composizione avviene fuori:

1. il **kernel** espone `Workspace::render_embed(page, heading?)` → risolve la
   pagina via grafo e rende l'intero documento o la sola sezione del heading
   (sottomodello ritagliato sugli `Span` dell'outline);
2. il **frontend** idrata i placeholder (comando IPC `render_embed`) e innesta
   l'HTML, ricorsivamente; tiene la catena dei documenti aperti per spezzare i
   **cicli** (`![[A]]` dentro A) e applica la **profondità massima** (5).

Così il provider resta puro, il kernel resta l'unico che conosce la topologia del
vault, e il frontend fa per il contenuto quel che già fa per la navigazione dei
wikilink.

Caso guida, e dalla [0079](../decisions/0079-il-grafo-esce-dall-overlay.md) non
più una promessa: la **graph view** ad alte prestazioni (force-directed su
Canvas) **non** passa da `UiNode`, e passa da tutto il resto. Il `ViewProvider`
del grafo (`fub-features/src/graph.rs`) dichiara `ViewSurface::Main`, chiede
nodi e archi al canale dati (`IndexQuery::Documents` e `IndexQuery::Neighbors`,
due domande e nessuna porta), e li manda dentro un
`UiKind::Custom { ns: "fub:graph", payload }`; il frontend riconosce quello `ns`
e ci mette sopra il suo canvas (`frontend/src/panels/graph.ts`, registrato in
`ui/custom.ts`). Il click su un nodo torna indietro come una qualunque azione di
view, e la risposta è `ViewUpdate::Navigate` — la stessa che usa il backlink.

**Asterisco di onestà sul dogfooding, riscritto perché è cambiato di misura.**
La graph view *era* una superficie privilegiata in due sensi: possedeva i propri
**dati** e i propri **pixel**. Il primo se n'è andato — i dati vengono dal canale
di tutti, e una vista a grafo di terzi può chiedere esattamente le stesse due
query. Il secondo resta, e la sua misura è precisa: **un `ns` che la shell
conosce**. Un plugin di terzi manda il suo `Custom` e riceve il `fallback`
finché non ha modo di spedire codice di disegno, cioè finché la `WebView` non ha
asset story e CSP (M5). Il principio «se il protocollo basta alle feature
ufficiali, basta ai plugin» vale per le superfici **dichiarative**, e il varco
`Custom` è il punto in cui una superficie smette di esserlo — dichiarato, con un
degrado scritto nel contratto, e non un canale a parte.

## Dogfooding: le sette view ufficiali

Sono la strada che percorrerà un plugin di terzi, e per questo il protocollo si
tiene "affamato". Ognuna esercita una parte diversa:

- **backlink** (`backlinks.rs`) — il payload al posto della concatenazione
  nell'id, e la **chiave** su ogni riga (il `DocId` sorgente);
- **outline** (`outline.rs`) — un `Tree` vero. Prima la gerarchia degli heading
  si vedeva rientrando il titolo con uno spazio EM: la struttura di un documento
  attraversava il confine come *spaziatura*. E «figlio» è *di livello maggiore*,
  non *di livello esattamente uno in più*;
- **tag** (`tags.rs`) — un **filtro**: un campo di testo il cui contenuto
  sopravvive fra due render, cioè il collaudo dello stato su `on_action` e del
  riconciliatore insieme;
- **grafo** (`graph.rs`) — l'**area principale** e il varco `Custom`: la prima
  view che dichiari `ViewSurface::Main`, e la prima che mandi alla shell un dato
  che il protocollo non sa disegnare. È il caso più duro, ed è quello che dice
  dove passa davvero il confine fra ciò che si dichiara e ciò che si disegna;
- **statistiche** (`stats.rs`) — il primo cliente della barra di stato;
- **cestino** (`trash.rs`) — le due **domande**: svuotare e ripristinare su un
  path occupato non chiedono una modale al contratto, disegnano la domanda al
  posto dell'elenco e la ricordano nello stato di vista
  ([0075](../decisions/0075-una-view-non-chiede-con-una-finestra.md));
- **cronologia** (`versioning.rs`) — la view che appartiene al plugin che
  **scrive** ciò che disegna, e quindi lo rilegge dal proprio spazio dati invece
  di chiedere un canale nuovo; e che agisce invocando un comando del registro
  (`version.restore`) invece di scrivere da sé.

**Fin dove arriva la garanzia**, che dalla
[0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md) è **misurata**
invece che affermata: queste sette view stanno su **quattro** delle **dieci**
superfici che `ViewSurface` nomina, e sulle altre sei non c'è nessun dogfooding.
Quindi «se il protocollo basta alle feature ufficiali, basta ai plugin» vale dove
una feature ufficiale è passata davvero, ed è un enunciato su quattro superfici e
non su tutte — il conto lo tiene `fub-features/tests/conformita.rs`
(`il_dogfooding_dichiara_fin_dove_arriva`), che per ogni superficie pretende o
una feature che ci stia o una ragione scritta.

L'altra metà di dove finisce sta nel metro di
[plugin-boundary.md](plugin-boundary.md#cosa-non-può-essere-solo-un-guest-e-il-metro-per-deciderlo):
la sua **quarta voce** — *se la superficie esiste* — nomina chi non passa non
perché costi troppo ma perché una porta non c'è, e il caso che trova è la
**superficie di scrittura**, non vietata e non attrezzata.

## Evoluzione prevista

- **Fatto ([0016](../decisions/0016-cosa-e-una-view.md))** — i nodi di input, le
  superfici, le istanze, lo stato su `on_action`, il «non ancora», i metadati
  della `ViewSpec`, il payload delle azioni e la chiave col riconciliatore. Il
  vincolo dichiarato — «un albero con input non può perdere lo stato locale a
  ogni update» — è mantenuto così: la chiave sta **sul nodo**, `mountTree`
  riconcilia invece di ricostruire, e un campo che ha il focus non si sovrascrive
  col valore del provider.
- **Fatto ([0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md))**
  — il protocollo dichiarativo **arriva ai blocchi custom** e non solo alle view:
  `render_preview` restituisce un `RenderedDocument { html, parts }`, l'HTML
  porta un buco `data-ui-slot="N"` e la shell ci monta la parte con lo stesso
  `mountTree`. Così il blocco di un plugin arriva a schermo **senza una riga in
  questo bundle** (l'iframe sandboxato resta la strada del widget vero, a M5).
- **Resta aperto** — la virtualizzazione delle liste lunghe
  ([§2.9](../roadmap/02-cosa-e-una-view.md)) e il ramo «la shell conosce `ns`» di
  `Custom`. Il primo cliente è arrivato — il diagramma, `ns: "fub:diagram"` — e
  ha mostrato che quel ramo **ancora non serve**: il `fallback` dichiarativo è la
  resa giusta finché non c'è un motore da invocare.
- Ogni nuovo `UiNode` deve restare esprimibile in WIT (tabella in
  [traits.md](traits.md)).
