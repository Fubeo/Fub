# Protocollo di UI dichiarativa (`UiNode`)

Un plugin (o una feature ufficiale) **descrive** la propria UI come albero
`UiNode` serializzabile e neutro rispetto al framework; il frontend del core lo
**disegna** con i suoi componenti nativi. Risultato: temi coerenti, niente JS nei
plugin, stessa strada per feature native e plugin di terzi.

Definizione: `crates/fubmd-abi/src/ui.rs`. Renderer: `frontend/src/ui.ts`.

Torna a [../PIANO.md](../PIANO.md) · vedi [traits.md](traits.md).

## Nodi supportati

| Variante `UiNode` | Campi | Reso dal frontend come |
|---|---|---|
| `Stack` | `dir: Axis`, `gap: u8`, `children` | `div` flex (row/column) |
| `Text` | `content` | `div.ui-text` |
| `Heading` | `level: u8`, `content` | `h1..h6` |
| `List` | `items` | `div.ui-list` |
| `ListItem` | `title`, `subtitle: Option`, `action: Option<ActionId>` | riga cliccabile |
| `Button` | `label`, `intent: Intent`, `action: ActionId` | `button.intent-*` |
| `Html` | `html` | `div.ui-html` (frammento già renderizzato) — **solo codice fidato** |
| `WebView` | `url`, `height: u32` | `iframe` sandboxed (`allow-scripts`) — **solo codice fidato** |

Tipi di supporto: `Axis { Row, Column }`, `Intent { Neutral, Primary, Danger }`
(i plugin scelgono **intenti semantici, non colori**: il tema è del core),
`ActionId(String)`.

## Ciclo azione → aggiornamento

1. Il frontend rende l'albero via `renderUiNode(node, onAction)`.
2. Un click su `ListItem`/`Button` con `action` emette l'`ActionId` verso il
   `ViewProvider` come `UiAction { action, payload }`.
3. Il provider risponde con `ViewUpdate`:
   - `Replace { root }` — rimpiazza l'intero albero della view;
   - `None` — nessun cambiamento;
   - `Navigate { doc_id }` — chiede al core di aprire un documento.

Questo giro è già cablato per i backlink (l'azione `open:<DocId>` → navigazione).

## La regola dell'escape hatch — e il confine di fiducia

`Html` e `WebView` sono escape hatch, da **usare con parsimonia**:

- **`Html`** — un frammento già renderizzato dal core (es. l'anteprima HTML di un
  backlink prodotta dal `FormatProvider`). Non è codice del plugin, è output del
  core reinserito nell'albero.
- **`WebView`** — iframe isolato (`sandbox="allow-scripts"`). È l'unico punto in
  cui gira codice arbitrario del plugin. Regola: **si usa solo quando la resa
  dichiarativa non basta davvero** e il contenuto richiede un canvas/DOM proprio.

**Confine di fiducia (deciso).** `Html` e `WebView` iniettano contenuto attivo
nella webview principale, che parla con l'IPC Tauri a pieni privilegi: un plugin
sandboxato che potesse emetterle scavalcherebbe l'intera sandbox *via UI* —
memoria isolata ma `<script>` iniettato nel core. Quindi:

- le due varianti sono **riservate al codice fidato** (core e feature ufficiali);
- l'host che riceve un albero da un provider **non fidato** lo rifiuta con
  `UiNode::validate_untrusted()` (in `fubmd-abi`, con test): `PermissionDenied`
  se `Html`/`WebView` compaiono ovunque nell'albero. Punti di enforcement: il
  proxy WASM (M5) e il registry dei plugin per i nativi non-core (M4) — stesso
  principio del "un solo punto" di `HostApi`;
- `WebView` tornerà disponibile ai plugin solo quando esisteranno una **asset
  story** (da dove viene `url`? asset del plugin serviti dall'host, non URL
  arbitrari) e una **CSP** dedicate — da progettare a M5, non prima.

## Transclusion (embed): placeholder + composizione

`FormatProvider::render_html` è una funzione **pura per-documento**: non ha
`HostApi` e non può leggere altri documenti. Un embed `![[Page#Heading]]` quindi
**non viene risolto dal provider**: viene emesso come placeholder

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

Così il provider resta puro (regola d'oro intatta), il kernel resta l'unico che
conosce la topologia del vault, e il frontend — che già risolve la navigazione
dei wikilink via data-attribute — fa lo stesso per il contenuto.

Caso guida per M2: la **graph view** ad alte prestazioni (force-directed su
Canvas/WebGL) **non** passa da `UiNode`. Il `ViewProvider` del grafo espone i dati
(nodi/archi) e il frontend possiede un componente canvas dedicato; l'escape hatch
`WebView` resta per plugin di terzi che vogliano una propria superficie di disegno.
Vedi la sezione "Graph view" in [M2](../milestones/M2-search-graph.md).

## Dogfooding: il pannello backlink

La prima feature ufficiale espressa nel protocollo è il pannello backlink
(`crates/fubmd-features/src/backlinks.rs`): `build_backlinks_view(&[BacklinkRef])
-> UiNode` produce uno `Stack` con un `Heading` ("N backlink") e una `List` di
`ListItem` (titolo = `page_name`, sottotitolo = contesto, azione =
`open:<DocId>`). È esattamente la strada che percorrerà un plugin di terzi: se il
protocollo è insufficiente per le feature ufficiali, lo è anche per i plugin — per
questo lo si tiene "affamato" e lo si estende solo su necessità reale.

## Evoluzione prevista

- **M2** — nuove view (`ViewProvider`): outline panel, tag panel; nuovi `UiNode`
  solo se una di queste li richiede (candidati: input di ricerca, tree-node).
- **M3** — form dichiarativi per i settings: probabile aggiunta di nodi input
  (text/toggle/select) al protocollo, congelati poi a [M4](../milestones/M4-wit-hardening.md).
- Ogni nuovo `UiNode` deve restare esprimibile in WIT (vedi la tabella in
  [traits.md](traits.md)).
