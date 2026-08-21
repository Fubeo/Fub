# 0163 — Render via IndexQuery

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: la casella residua della
[§16.6](../roadmap/16-crate-sdk-banchi-di-prova.md) — *«restano i due che
nessuno nominava: `render_preview` e `render_embed`»* — e il
[difetto 0130](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

La §16.6 teneva due bespoke dichiarati: `render_preview` e `render_embed`,
comandi IPC della shell che rispondono con **dati** — `RenderedDocument` e
`EmbedContent` — mentre un `ViewProvider` non aveva nessuna porta per i dati
(HTML) e la shell ne aveva due. Il difetto 0130 lo diceva per esteso: *«due
letture che rispondono con dei dati hanno un comando IPC proprio invece di una
variante di `IndexQuery`, e siccome `IndexQuery` non ha una variante di resa e
l'`HostApi` non ha una capacità di render, un `ViewProvider` non ha nessuna
porta per mostrare un documento reso mentre la shell ne ha due»*. La voce
aveva già deciso il criterio — *«prima di migrare un bespoke si valuta chi lo
chiama, e da che parte del confine dovrebbe stare»* — e rimandava l'esecuzione
a una decisione sul confine di fiducia.

## La premessa, rimisurata

- **I due comandi Tauri sono spariti.** `crates/fub-app/src/lib.rs:296-301`
  lo dice per esteso: *«`render_preview` e `render_embed` (0163) non sono più
  qui: sono passati al canale dati (`query_index` con `IndexQuery::RenderPreview`
  / `IndexQuery::RenderEmbed`), come l'outline e ogni altra lettura»*. Il
  registro `COMANDI` non li elenca più, e `dieta_ipc.rs:352-357` racconta la
  stessa storia: *«un fatto sul vault che solo la shell sapeva chiedere è
  adesso una domanda del canale di tutti»*.
- **Le varianti sono in fondo ai loro enum.** `IndexQuery::RenderPreview { doc }`
  e `IndexQuery::RenderEmbed { page, heading, block }` in coda a
  `IndexQuery` (`traits.rs:2915-2934`), `QueryKind::RenderPreview`/`RenderEmbed`
  in coda a `QueryKind` (`:3136-3141`), `IndexResult::RenderPreview(RenderedDocument)`
  e `IndexResult::RenderEmbed(EmbedContent)` in coda a `IndexResult`
  (`:3395-3399`). Tutte additive, e il WIT le rispecchia.
- **`Workspace::query_index` instrada sulle fn kernel esistenti.**
  `workspace.rs:4703-4712`: `RenderPreview` chiama `self.render_preview(&doc)`
  e `RenderEmbed` chiama `self.render_embed(...)` — le stesse funzioni di
  prima, che non sono sparite: è sparita la **porta** bespoke, non il lavoro.
  Il kernel dichiara le due varianti nella propria tabella di rotte
  (`index/core.rs:1070-1072`) e le serve da `query_index`, non dall'indice
  (`:1335-1338`).
- **La capacità è quella di sempre.** `QueryKind::RenderPreview` e
  `RenderEmbed` passano da `Capability::Query` (`host/guard.rs:1034-1036`):
  un plugin che può leggere il vault può chiedere un documento reso — la
  stessa spunta di ogni altra lettura del canale.
- **Il frontend chiede via `query_index`, e lo dice.** `frontend/src/panels/preview.ts:84-89`
  chiama `api.queryIndex({ kind: "render_preview", doc: id })`; il mirror TS
  dichiara le due varianti (`host/contract.ts:1285-1293, 1319-1324`) e
  `ipc.ts:83-87` racconta la migrazione. La transclusione idrata da
  `queryIndex` con `render_embed` come l'anteprima.

## La decisione

**La resa è una variante additiva del canale dati, e risponde il kernel come
l'outline.** `IndexQuery::RenderPreview`/`RenderEmbed` → `IndexResult` con lo
stesso instradamento di ogni altra lettura: la domanda entra da `query_index`,
il kernel la serve con le funzioni che esistevano, e la risposta torna sul
canale di tutti. Un `ViewProvider` ha la stessa porta della shell — la
domanda che il difetto 0130 poneva è chiusa: non c'è più un fatto sul vault
che solo la shell sapeva chiedere. La fiducia che la voce rimandava è la
stessa di ogni altra variante del canale: la resa è una lettura, e la lettura
passa da `Capability::Query` come le altre.

Il lavoro portato è il fatto scritto dove ci si inciampa: il doc di
`IndexQuery::RenderPreview` (`traits.rs:2905-2914`) dice che prima della 0163
la resa era un comando IPC bespoke e che un `ViewProvider` non aveva una porta
(difetto 0130); il doc di `render.rs` (il modulo dei tipi di resa, che vive
nel contratto) dice la stessa cosa dall'altro lato; `lib.rs` e `dieta_ipc.rs`
raccontano la sparizione dei due comandi; e il mirror TS e `preview.ts`
mostrano il cliente vero.

**Presidio: la dieta dell'IPC.** I due comandi non sono più nel registro, e
`dieta_ipc.rs` — che estrae i comandi definiti e registrati dal sorgente e li
confronta con l'allowlist — non li elenca più. Il debito del §16.6, che la
[0075](0075-una-view-non-chiede-con-una-finestra.md) aveva ridotto a due, è a
**zero**: la variabile `il_debito_dichiarato_e_un_numero_presidiato` si è
mossa con la migrazione.

## Le forme scartate

- **Una capacità `HostApi` di render** — scartata: è la regola della
  [0013](0013-elenco-delle-capacita.md) applicata al caso — *una lettura è
  dati, e i dati hanno un canale solo*. Una capacità `render` avrebbe dato al
  plugin una seconda porta per la stessa domanda, e l'elenco chiuso delle
  capacità sarebbe cresciuto per un caso che il canale già copre.
- **Tenere i Tauri come wrapper** — scartata: è la porta di troppo che la
  dieta esiste per non avere. Un comando che risponde con dati è precisamente
  ciò che il §16.6 vieta, e un wrapper che inoltra a `query_index` non
  aggiunge niente — solo un secondo modo di fare la stessa cosa, da tenere
  allineato per sempre.

## Cosa resta scoperto

- **Il frontend chiede via `query_index`, e lo fa**: `preview.ts` usa
  `api.queryIndex({ kind: "render_preview", doc: id })` e la transclusione
  idrata da `queryIndex` con `render_embed`. La casella che questa decisione
  avrebbe potuto lasciare — *«il frontend deve chiedere via query_index»* —
  è chiusa dal codice, non da una promessa.
- **La resa resta una lettura del kernel, non un canale nuovo.** Un plugin
  che voglia rendere con i **propri** renderer non passa di qui: la variante
  serve il documento reso dal kernel, con i provider e i renderer registrati.
  Un canale di resa di terzi sarebbe una domanda diversa, e non è questa.
