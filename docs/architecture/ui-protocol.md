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
| `Html` | `html` | `div.ui-html` (frammento già renderizzato) |
| `WebView` | `url`, `height: u32` | `iframe` sandboxed (`allow-scripts`) |

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

## La regola dell'escape hatch

`Html` e `WebView` sono escape hatch, da **usare con parsimonia**:

- **`Html`** — un frammento già renderizzato dal core (es. l'anteprima HTML di un
  backlink prodotta dal `FormatProvider`). Non è codice del plugin, è output del
  core reinserito nell'albero.
- **`WebView`** — iframe isolato (`sandbox="allow-scripts"`). È l'unico punto in
  cui gira codice arbitrario del plugin. Regola: **si usa solo quando la resa
  dichiarativa non basta davvero** e il contenuto richiede un canvas/DOM proprio.

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
