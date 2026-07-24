# M2 — Ricerca + graph + rifiniture

Torna a [../PIANO.md](../PIANO.md) · precede [M3](M3-editor-fidelity.md).

## Obiettivo

Portare FubMD da "editor di note collegate" a "strumento di navigazione della
conoscenza": ricerca full-text, grafo navigabile, pannelli outline/tag, e la
chiusura del ciclo dei link non risolti ("crea nota"). In parallelo, sostituire il
full-rebuild di grafo/indice con un aggiornamento **incrementale**.

## Design

### Indicizzazione full-text (tantivy, incrementale su disco)

Un `IndexProvider` nativo in `fubmd-features` che avvolge **tantivy**.

- **Persistenza:** indice su disco in `.fubmd-data/index/` (già ignorato dal walk
  del vault, vedi `crates/fubmd-kernel/src/vault.rs`). Avvio rapido: niente
  reindicizzazione completa ad ogni apertura.
- **Schema:** `doc_id` (STRING, stored), `title`/`page_name` (TEXT), `body`
  (TEXT, dalla proiezione `DocumentModel.text`), `tags` (facet/TEXT). Lo schema è
  versionato: un bump forza il rebuild.
- **Aggiornamento incrementale:** i ganci del trait sono già in firma —
  `on_document_indexed(doc)` fa delete-by-term(`doc_id`) + add; `on_document_removed(id)`
  fa delete-by-term. Commit debounced (batch) su `IndexUpdated`.
- **Query:** `IndexQuery::FullText { query, limit }` → `IndexResult::Search(Vec<SearchHit>)`
  con `score` e `snippet` (snippet generator di tantivy). `IndexQuery::Backlinks`
  può continuare a passare dal grafo o essere servito dall'indice — vedi sotto.

### Grafo incrementale (insieme all'indice) — **fatto**

`Workspace::rebuild_graph` ricostruiva `LinkGraph` da zero ad ogni modifica.
Ora `LinkGraph::upsert`/`LinkGraph::remove` applicano un delta per-documento
(`crates/fubmd-kernel/src/graph.rs`); `Workspace` li usa su
`write_document`/`refresh_from_disk`/`remove_document`.

Il problema vero non è aggiungere gli archi del documento toccato, ma sapere
**chi altro va ri-risolto**: creare `Nota.md` ruba il nome `nota` a `sub/Nota.md`
e sposta i link di terzi. L'invariante che rende il delta trattabile è che la
risoluzione di una chiave `K` dipende solo da `path_index[strip_ext(K)]`,
`name_index[K]`, `alias_index[K]`. Da lì due mappe di dipendenza inversa:
`watchers` (chiave d'indice → chiavi di link che ne dipendono) e `refs_by_key`
(chiave di link → documenti che la usano). Costo proporzionale al vicinato.

- `alias_index` e `path_index` diventano multi-mappe ordinate come `name_index`
  (vince il path più corto, poi lessicografico). Con la vecchia
  `HashMap<String, DocId>` due alias uguali — o `a.md` e `a.txt`, stesso path
  senza estensione — si sovrascrivevano nell'ordine casuale della `HashMap` dei
  modelli; e comunque serviva sapere **chi subentra** quando il vincitore sparisce.
- **Correttezza prima di tutto:** il full-rebuild resta come oracolo e come
  fallback dietro `Workspace::set_graph_update(GraphUpdate::FullRebuild)`.
- Misura indicativa (5000 documenti, 200 modifiche, release): ~12 µs a modifica
  contro ~19 ms del rebuild completo.

### Cache dei modelli: metadata ≠ body (insieme all'indice)

Oggi il `Workspace` tiene il `DocumentModel` **completo** (albero `body` +
proiezione `text`, ≈2× la sorgente) di *tutto* il vault, per sempre: conflazione
di due cache con vite diverse. Da sdoppiare quando arriva l'indice:

- **metadata cache** (globale, sempre in RAM): `outline`/`links`/`tags` +
  frontmatter — è ciò che serve a grafo, pannelli e risoluzione;
- **body parsato** (solo documenti aperti/anteprima, LRU piccola): serve al
  rendering; si riparsa on-demand dalla sorgente;
- `text` non resta in RAM: alimenta tantivy all'indicizzazione e poi vive
  nell'indice su disco.

Obsidian fa lo stesso (metadata cache persistente, niente AST globale in RAM).
Farlo a M2 e non prima: è lo stesso refactor dei percorsi incrementali, e
l'oracolo full-rebuild appena costruito verifica che nulla cambi.

### Graph view (Canvas/WebGL nel frontend)

- Un `ViewProvider` nativo espone **solo i dati** del grafo: nodi (`DocId`,
  `page_name`, grado) e archi (sorgente→target risolti, da `outgoing`).
- Il **rendering** è un componente frontend dedicato (Canvas 2D, con opzione WebGL
  per vault grandi): layout force-directed, pan/zoom, click→`Navigate { doc_id }`,
  evidenziazione del vicinato. **Non** passa dal protocollo `UiNode` (vedi la
  regola dell'escape hatch in [../architecture/ui-protocol.md](../architecture/ui-protocol.md)).
- Modalità: grafo globale e grafo locale (n-hop dal documento aperto).

### Outline panel e tag panel

- **Outline:** `ViewProvider` che legge `DocumentModel.outline` (già popolato: testo
  + slug + livello) e produce un `UiNode` (`List`/`ListItem`, azione = scroll a
  heading via `Span`). Nessun nuovo tipo dati.
- **Tag panel:** aggregazione dei `DocumentModel.tags` su tutto il vault → albero di
  tag (`#a/b`), click → ricerca per tag. Candidato a un nuovo `UiNode` tree-node se
  la `List` piatta non basta.

### Flusso "crea nota" (link non risolti)

Oggi `resolve_wiki` restituisce `None` per un wikilink senza target. M2:
- il frontend distingue i wikilink risolti da quelli non risolti (data-attribute
  già presente nell'HTML di anteprima);
- click su un link non risolto → comando "crea nota": nome dal `page` del
  `LinkTarget::Wiki`, path secondo le regole del vault, poi `write_document` di uno
  scheletro e navigazione. Naturale candidato per il primo `CommandProvider`
  (altrimenti cablato nell'app fino a M3).

## Trait/API coinvolti

- `IndexProvider` (nuova impl nativa, tantivy) — [traits.md](../architecture/traits.md).
- `ViewProvider` (graph-data, outline, tag) — dati via [ui-protocol.md](../architecture/ui-protocol.md).
- `Workspace` in `fubmd-kernel`: nuovi percorsi incrementali per grafo+indice.
- Eventuale primo `CommandProvider` per "crea nota".
- Nuovi comandi IPC in `fubmd-app` (search, graph-data, outline, tags, create-note).

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| tantivy **incrementale su disco** | Scala a vault grandi e dà avvio rapido; i ganci `on_document_*` esistono già nel trait. |
| Grafo **incrementale insieme** all'indice | Stessa natura del problema (delta per-documento); evita due passaggi di refactor sul `Workspace`. |
| Graph view **Canvas/WebGL**, fuori da `UiNode` | Performance su migliaia di nodi; il dichiarativo non regge il force-directed. |
| Outline/tag **via `ViewProvider`+`UiNode`** | Sono liste: restano dichiarative, dogfood del protocollo. |
| "crea nota" come **comando** | Riusa `HostApi.write_document`; anticipa `CommandProvider` senza attendere M3. |

## Criteri di accettazione

- Ricerca full-text su un vault di ≥1000 note con risultati rilevanti < 50 ms a
  query (indice caldo), snippet evidenziati.
- Riapertura del vault **senza** reindicizzazione completa (indice caricato da disco).
- Modifica/creazione/cancellazione di una nota: grafo e indice riflettono il
  cambiamento senza full-rebuild, e il risultato è **identico** a quello del
  full-rebuild.
- Graph view naviga (click→apertura), pan/zoom fluidi su vault grande; grafo locale
  n-hop.
- Outline e tag panel funzionanti; click naviga (heading via `Span`, tag via ricerca).
- Click su wikilink non risolto crea la nota e ci naviga.

## Piano di test

- **Unit:** schema/round-trip dell'indice tantivy; delete-by-term; snippet.
- **Proprietà:** su una sequenza casuale di write/remove, `grafo_incrementale ==
  LinkGraph::build(tutti)` e `indice_incrementale == indice_da_zero` (oracolo =
  full-rebuild attuale). Per il grafo: `crates/fubmd-kernel/tests/graph_incremental.rs`
  (universo ostile: omonimi a profondità diverse, alias che collidono con i nomi,
  path che collidono a meno dell'estensione; generatore xorshift deterministico,
  niente `proptest`) e `tests/workspace_incremental.rs` per lo stesso confronto
  passando da disco/provider/eventi.
- **E2e (estende `crates/fubmd-format-markdown/tests/vault_e2e.rs`):** query
  full-text sul sample-vault; creazione nota da link non risolto → il backlink
  compare.
- **Bench (facoltativo):** tempi di query e di aggiornamento incrementale vs rebuild
  su vault sintetico grande.
- `cargo test --workspace` + `cargo clippy` verdi su tutti gli OS (vedi
  [../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Divergenza incrementale vs rebuild** → test di proprietà con oracolo; fallback a
  rebuild dietro un flag finché il test non è stabile.
- **Corruzione/lock dell'indice su disco** → schema versionato + rebuild automatico
  se l'apertura fallisce; commit debounced per ridurre la pressione I/O.
- **Perf del force-directed** → soglia note oltre cui si passa a WebGL / si mostra
  solo il grafo locale; **loggare** eventuali cap (niente troncamenti silenziosi).
- **`IndexProvider` non implementato da nessuno a M1** → M2 è la sua prima prova:
  se la firma è scomoda, correggerla *ora* (il freeze è a [M4](M4-wit-hardening.md)).
