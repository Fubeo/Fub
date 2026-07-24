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
  resa. Gli `Span` byte→posizione CM sono già gestiti dal ponte offset
  (`crates/fubmd-format-markdown/src/offsets.rs`).
- **De-rischiato da M1:** il pannello anteprima HTML resta come fallback e come
  oracolo visivo; la live-preview è "meccanica" perché non richiede nuovi dati, solo
  proiezione degli `Span` esistenti.

### Rendering ricco di callout / embed / math

Oggi il provider markdown emette callout/tabelle/embed/math come
`Block::Custom { custom_kind, attrs, .. }` (agnosticità del modello). M3 aggiunge
**l'interpretazione** lato resa, senza togliere l'escape hatch:

- `render_html` del provider markdown (e le decorazioni in-editor) riconoscono i
  `custom_kind` noti — `callout`, `math`, `embed`, `table` — e producono la resa
  ricca (callout con icona/colore per tipo, math via KaTeX/MathML, embed di note/
  immagini, tabelle).
- Gli `attrs` portano i parametri (tipo di callout, `foldable`, sorgente math, target
  embed). I `custom_kind` sconosciuti restano resi come blocco generico.
- **Embed** (`![[..]]`, `LinkTarget::Wiki { embed: true }`): risolti dal kernel come
  i wikilink; la resa inserisce il contenuto (o un boxed-link se non risolto).

### Command palette (`CommandProvider`)

- Prima impl reale di `CommandProvider` (firma in
  [../architecture/traits.md](../architecture/traits.md)): raccoglie i `CommandSpec`
  registrati, palette fuzzy nel frontend, `invoke(command, args, host)` con
  `CommandOutcome.notify` per il feedback.
- Comandi di base: crea/rinomina/sposta nota, apri ricerca, toggle pannelli, "crea
  nota" (migrato qui da [M2](M2-search-graph.md) se lì era cablato nell'app).
- `keybinding` dei `CommandSpec` come suggerimento; la mappa reale è nei settings.

### Settings via form dichiarativi

- I settings (del core e dei futuri plugin) sono descritti come **form dichiarativi**
  nel protocollo `UiNode`. M3 introduce i nodi input necessari (text, toggle,
  select, number) — da congelare poi a [M4](M4-wit-hardening.md).
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
