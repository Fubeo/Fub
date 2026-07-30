# M3 — Fedeltà editor

Torna a [../PIANO.md](../PIANO.md) · segue [M2](M2-search-graph.md) · precede
[M4](M4-wit-hardening.md).

## Obiettivo

Chiudere il divario di UX con Obsidian **dentro l'editor**: live-preview in-editor
(non più solo pannello HTML separato), command palette, settings via form
dichiarativi, e **rendering ricco di callout/embed/math** (oggi relegati
all'escape hatch `Custom`).

## Design

### Live-preview in-editor (decorazioni CodeMirror sugli `Span`)

Il perno è già nel modello: ogni nodo porta uno `Span` in byte
(vedi [../architecture/data-model.md](../architecture/data-model.md)).

- Il frontend chiede al core il `DocumentModel` (o una proiezione "decorazioni") del
  documento aperto; per ogni nodo con `Span` genera una decorazione CodeMirror 6:
  wikilink cliccabili inline, `#tag`, enfasi, heading, code.
- Modalità Obsidian: la riga sotto il cursore mostra la sorgente; le altre righe la
  resa.
- **Attenzione (nota di revisione):** gli `Span` del modello sono in **byte
  UTF-8**; le posizioni di CodeMirror 6 sono in **code unit UTF-16**. Il ponte
  byte→UTF-16 **non esiste ancora** (`offsets.rs` copre solo riga/colonna→byte
  di comrak): senza, ogni decorazione slitta al primo carattere accentato. Va
  costruito lato frontend (o come proiezione IPC) e testato su testo multibyte
  PRIMA di cablare le decorazioni.
- **De-rischiato da M1:** l'anteprima HTML resta come fallback e come oracolo
  visivo — da [decisione 0007](../decisions/0007-contesto-di-sessione.md) è la **modalità Lettura** del pannello, non un riquadro
  accanto all'editor; la live-preview è "meccanica" perché non richiede nuovi
  dati, solo proiezione degli `Span` esistenti.

### Conflitti buffer ↔ disco (debito dichiarato di M2)

La politica delle **tre copie** è decisa e in parte cablata (vedi
[data-model.md](../architecture/data-model.md), "Le tre copie"): flush del
buffer al cambio documento, reload del buffer pulito su cambio esterno, buffer
sporco mai sovrascritto. Il caso rimasto aperto — **documento aperto e sporco
che cambia su disco** (watcher, riscrittura link da un rename altrui) — oggi si
risolve con "il buffer vince, con warning". M3 lo chiude:

- **conflitto esplicito**: dialogo (mantieni buffer / ricarica / confronta) al
  posto del silenzioso "vince il buffer";
- **flush-before-patch** esteso ai comandi della palette che riscrivono file
  (rinomina/sposta nota): si salva il buffer prima di calcolare le patch;
- valutare lo **span-shift** (rimappare le patch sul buffer corrente invece di
  rifiutarle) solo se il conflitto si rivela frequente nell'uso reale.

### Rendering ricco di callout / embed / math

Oggi il provider markdown emette callout/tabelle/embed/math come
`Block::Custom { custom_kind, attrs, .. }` (agnosticità del modello). M3 aggiunge
**l'interpretazione** lato resa, senza togliere l'escape hatch:

- `render_html` del provider markdown (e le decorazioni in-editor) riconoscono i
  `custom_kind` noti — `callout`, `math`, `table` — e producono la resa ricca
  (callout con icona/colore per tipo, math via KaTeX/MathML, tabelle). Il
  registro dei kind noti e dei loro `attrs` è in
  [../architecture/data-model.md](../architecture/data-model.md).
- Gli `attrs` portano i parametri (tipo di callout, `foldable`, sorgente math).
  I `custom_kind` sconosciuti restano resi come blocco generico.
- **Embed** (`![[..]]`, `Link { embed: true }` — il flag sta sul riferimento,
  non sul bersaglio, così che ci ricada anche `![](immagine.png)`): il protocollo di
  transclusion è **già cablato** (deciso in revisione concettuale, vedi
  [../architecture/ui-protocol.md](../architecture/ui-protocol.md)): il provider
  emette il placeholder `.embed`, il kernel serve `render_embed(page, heading?)`
  (anche per sezione, via `Span` dell'outline), il frontend idrata con guardia
  su cicli e profondità. M3 estende la resa (immagini, blocchi `^id`, stile) —
  non il meccanismo.

### Command palette (`CommandProvider`) — **anticipata a M2** ([decisione 0009](../decisions/0009-registro-dei-comandi.md) + [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md))

Il registro, la palette e il dry-run sono stati fatti a M2 insieme alla [decisione 0010](../decisions/0010-comando-descritto-a-una-macchina.md): il
motivo è che `CommandSpec` e `invoke` sono **firme**, e le firme costano un campo
prima del freeze e una migrazione dopo. Cosa è già lì:
`register_command_provider`/`commands`/`invoke_command` nel kernel,
`list_commands`/`invoke_command` sull'IPC, `CoreCommands` in `fub-features`, la
palette in `frontend/src/ui/palette.ts` (filtro, form dai `ParamSpec`, anteprima del
piano prima di applicare, scorciatoie **dichiarate** dai comandi).

Cosa resta a M3:

- **I comandi strutturali** (crea/rinomina/sposta/cestina nota): non sono
  migrati perché l'`HostApi` non ha quelle capacità — è la [decisione 0013](../decisions/0013-elenco-delle-capacita.md) a doverle
  decidere una per una, e senza di esse un comando ufficiale le otterrebbe per
  una via privilegiata che un plugin non ha.
- **I comandi della shell** (toggle pannelli, cambio modalità): il registro vive
  nel kernel e il frontend non può registrarvisi (§18.2).
- **La mappa dei tasti come dato**: oggi la shell onora il `keybinding`
  *dichiarato* dal comando e ignora quelli senza modificatori; la mappa
  configurabile dall'utente è nei settings (§11.1 + §18.2).
- **Il form dei parametri con i nodi di input** ([decisione 0016](../decisions/0016-cosa-e-una-view.md)): la palette disegna i campi da
  sé; quando i nodi di input esisteranno, saranno la resa dei `ParamSpec` — non
  un secondo modo di dichiararli.

### Settings via form dichiarativi

- I settings (del core e dei futuri plugin) sono descritti come **form dichiarativi**
  nel protocollo `UiNode`. M3 introduce i nodi input necessari (text, toggle,
  select, number) — da congelare poi a [M4](M4-wit-hardening.md).
- I nodi input hanno **`id` stabile** e il renderer **riconcilia per id**: lo
  stato locale (focus, digitazione in corso) sopravvive a `ViewUpdate::Replace`
  — decisione già presa, vedi [ui-protocol.md](../architecture/ui-protocol.md).
- Persistenza via `HostApi.storage_get/set` (namespace per plugin/core).

## Trait/API coinvolti

- `CommandProvider` (prima impl) e `HostApi` (storage per settings).
- `FormatProvider::render_html` esteso (interpretazione dei `custom_kind`).
- Nuovi `UiNode` input per i form (estensione del protocollo).
- Proiezione "decorazioni" dal `DocumentModel` verso il frontend (nuovo comando IPC).

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| Live-preview via **decorazioni sugli `Span`** | Gli `Span` esistono da M1; niente nuovo modello, solo proiezione. |
| Callout/embed/math **a M3, non M2** | Sono "fedeltà di resa": stanno con la live-preview, non con ricerca/grafo. |
| Interpretazione dei `custom_kind` **nella resa**, non nel modello | Il modello resta agnostico; solo il layer di rendering conosce i callout. |
| Settings come **form dichiarativi** `UiNode` | Stesso protocollo dei plugin; niente UI ad hoc; congelabile in WIT. |

## Criteri di accettazione

- Aprendo una nota, wikilink/tag/heading/enfasi sono resi inline nell'editor; la
  riga sotto cursore resta editabile come sorgente.
- Callout, math ed embed sono resi correttamente sia nell'anteprima sia in-editor;
  un `custom_kind` sconosciuto degrada a blocco generico senza crash.
- Command palette apre, filtra, invoca; i comandi base funzionano e notificano.
- I settings si modificano da form e persistono tra riavvii.
- Nessuna regressione sui test M1/M2.

## Piano di test

- **Snapshot** del rendering ricco su un corpus di fixture Obsidian
  (callout tipi diversi, math inline/blocco, embed risolto/non risolto, tabelle).
- **Unit** sul mapping `Span`→posizione CM (round-trip byte↔riga/colonna, casi
  multibyte UTF-8) — estende `offsets.rs`.
- **Unit** su `CommandProvider`: registrazione, invoke, `UnknownCommand`.
- **E2e**: invoca "crea nota" dalla palette; modifica un setting e verifica la
  persistenza.
- `cargo test --workspace` + `cargo clippy` verdi (vedi
  [../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Fedeltà live-preview** (edge case markdown, cursore, IME) → pannello HTML come
  fallback; corpus di fixture + snapshot.
- **Math/embed pesanti** → rendering lazy fuori viewport; embed con guardia anti-ciclo.
- **Estensione del protocollo `UiNode`** → ogni nuovo nodo deve restare WIT-esprimibile
  (tabella in [../architecture/traits.md](../architecture/traits.md)); congelamento a M4.
