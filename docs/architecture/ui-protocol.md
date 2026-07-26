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
   - `Navigate { doc_id }` — chiede al core di aprire un documento;
   - `Reveal { doc_id, span }` — apri (se serve) e porta la vista su un
     intervallo del documento; `span` è in byte UTF-8, il frontend lo mappa
     sull'editor col ponte in `frontend/src/offsets.ts`;
   - `RunSearch { query }` — esegui una ricerca e mostrane i risultati.

Questo giro è cablato nel renderer generico (`mountView` in `main.ts`) e servito
dai comandi `render_view`/`view_action`/`set_active_context`. Lo esercitano i
backlink (`open:<DocId>` → `Navigate`), l'outline (`reveal:<start>:<end>` →
`Reveal` sull'heading) e il pannello tag (`tag:<nome>` → `RunSearch`).

## Quando una view invecchia: due maschere, non una

`ViewSpec` dichiara `refresh: EventMask` **e** `follows: ContextMask`. La prima
sono gli eventi del **vault** al cui arrivo serve un nuovo `render_view`; la
seconda le parti del **contesto di sessione** (documento, selezione, modalità)
che la view guarda. Sono separate perché un cursore che si muove non è un fatto
del vault: farlo passare dall'event bus significherebbe consegnare ogni battuta
di tasto a ogni handler registrato.

La shell pubblica il contesto con `set_active_context` e riceve **gli id delle
view da ridisegnare**: il conto lo fa il kernel, che conosce le `follows`. Senza
questa metà del protocollo l'unica strada sarebbe ridisegnarle tutte a ogni
movimento del cursore — cioè una `query_index` per battuta di tasto sul pannello
tag e sulla vista a grafo.

Cosa dichiarano le quattro view ufficiali: i backlink solo `Document` (i
backlink di una nota sono gli stessi da ogni punto di essa), l'outline
`Document + Selection` (segna la sezione in cui sta il cursore), le statistiche
tutto (contano la selezione e cambiano faccia in lettura), il pannello tag
**niente** — la distribuzione dei tag del vault è la stessa da qualunque nota la
si guardi, ed è il caso che la maschera esiste per servire.

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
  se `Html`/`WebView` compaiono ovunque nell'albero. Il punto di enforcement è
  **uno** ed esiste già: `Workspace::render_view` e `Workspace::view_action`,
  dove i provider si registrano con il proprio grado di fiducia
  (`register_view_provider(id, Trust, provider)`). Vale anche per l'albero che
  torna dentro un `ViewUpdate::Replace`, cioè in risposta a un click e non al
  rendering — un controllo fatto solo su `render_view` sarebbe aggirabile in un
  gesto. Oggi nessun provider non fidato esiste e la validazione è un no-op: il
  varco esiste *prima* del primo, perché aggiungerlo dopo vorrebbe dire cercarlo
  fra N chiamanti (stesso principio del "un solo punto" di `HostApi`; test in
  `crates/fubmd-kernel/tests/view_trust.rs`);
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

**Asterisco di onestà sul dogfooding.** La graph view è quindi una superficie
*privilegiata*: componente frontend + canale IPC dedicato, non percorribile da
un plugin di terzi finché la `WebView` non ha asset story e CSP (M5). Il
principio "se il protocollo basta alle feature ufficiali, basta ai plugin" vale
per le superfici **dichiarative** (liste, pannelli, form); per i canvas ad alte
prestazioni il claim "le feature native sono di fatto plugin" va letto con
questo limite dichiarato — finché `WebView` non apre ai terzi, un plugin non
può costruire una graph view alternativa.

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
  **Vincolo già deciso:** `ViewUpdate::Replace` rimpiazza l'albero, e un albero
  con input non può perdere lo stato locale (focus, testo a metà digitazione,
  scroll) a ogni update. I nodi input avranno un **`id` stabile** e il renderer
  **riconcilia per id** (aggiorna il DOM esistente invece di ricrearlo) — la
  semantica di `Replace` resta l'unica del protocollo, ma il rendering è una
  riconciliazione, non una ricostruzione. Da fissare con i nodi input a M3,
  prima del freeze.
- Ogni nuovo `UiNode` deve restare esprimibile in WIT (vedi la tabella in
  [traits.md](traits.md)).
