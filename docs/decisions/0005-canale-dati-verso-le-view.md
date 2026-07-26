# 0005 — `IndexQuery` — il canale dati verso le view

|  |  |
|---|---|
| **Decisa** | 2026-07-26 |
| **Origine** | `todo.md` §1.6 (primo giro) |
| **Commit** | `3953274` |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [PIANO.md](../PIANO.md)

---

- [x] **Grafo**: `IndexQuery::Neighbors { doc, direction, depth, page }` —
      camminata in ampiezza sul `LinkGraph`, con `NeighborRef { doc, via, depth }`
      (il `via` è l'anello precedente: senza, oltre il primo passo la risposta è
      un sacchetto di nodi invece di un albero). Primo cliente: `graph_data`, che
      non prende più gli archi da `Workspace::outgoing` — cioè da una scorciatoia
      che un plugin non ha (7.3).
- [x] **Proprietà**: `IndexQuery::Properties { filter, sort, select, page }` e
      `PropertyValues { key, filter, page }`, servite dal kernel dal frontmatter
      già in cache. `PropertyTest` è un variant (`exists`, `missing`, `equals`,
      `not_equals`, `contains`, `>`, `<`) su `PropertyValue` della [decisione 0003](../decisions/0003-modello-del-documento.md); le
      faccette contano **sul sottoinsieme filtrato** e un elenco conta per ogni
      suo elemento. Regole in un posto solo (`kernel/properties.rs`): specie
      diverse non si confrontano (falso, non errore), chi non ha la chiave
      ordina in fondo in entrambi i versi, la parità la rompe il `DocId` — o una
      risposta paginata non è stabile.
- [x] **Full-text con ambito**: `FullText { query, scope, page }` con
      `SearchScope { folders, tags }` applicato **dentro tantivy** (nuovo campo
      `folder` con ogni cartella antenata, schema v3), non post-filtrato: il
      totale e le pagine restano veri.
- [x] **Salute del vault**: `VaultHealth { check, page }` con `broken_links` e
      `orphan_documents` dal grafo e dai link in cache; `HealthIssue` porta la
      destinazione **com'era scritta** e lo span, che è ciò che serve per
      correggerla.
- [x] **Paginazione**: `Page { offset, limit }` nella domanda, `Paged { items,
      offset, total }` nella risposta, `None` = tutto. Chi sa paginare alla
      sorgente lo fa (tantivy: collector con offset + `Count`); il kernel
      ritaglia con `Paged::window`. Fuori solo `Outline`, che cresce con un
      documento e non col vault.

*Trovato per strada e chiuso:* gli enum del contratto con tag interno e variante
a scalare (`PropertyValue::Text`, `LinkTarget::Url`, `Inline::Text`) **non erano
serializzabili** in JSON — `serde_json` fallisce a runtime su un newtype
taggato. Latente finché nessuno li metteva sul filo; questa voce li ci mette.
Ora il tag è adiacente (`kind` + `value`) e un round-trip in `abi/model.rs`
elenca ogni variante.

*Resta fuori, dichiarato:* le **faccette sul risultato full-text** (contare i
tag di un insieme di hit) — servono un campo facet in tantivy e la decisione di
chi le calcola, e oggi la stessa domanda si fa con `Tags`/`PropertyValues`; il
**join fra full-text e proprietà** ("le note `tipo: progetto` che parlano di
rust"), che è il query engine del §5.3/9.2 e non un campo in più qui; gli
**allegati inutilizzati** di 7.2, che presuppongono il modello degli asset
(§14.1) — oggi un PNG nel kernel non esiste, e infatti un riferimento a un
allegato non viene contato fra i link rotti (sarebbe un falso positivo per
immagine); le **ancore rotte** (`[[Nota#^blocco]]` verso un blocco sparito), che
sono la coda della [decisione 0003](0003-modello-del-documento.md).

*Trovato dopo, e va letto insieme a questa voce:* delle nove varianti, **sette
non raggiungono nessun `IndexProvider`** — il kernel se le risponde da sé e
ritorna prima del ciclo sui provider. Il canale è quindi «dati verso le view»
per chiunque, ma «dati da chiunque» per due varianti su nove: le sei aggiunte in
questo giro sono tutte dalla parte che nessun provider può servire. È il §5.1,
e finché non è chiuso ogni famiglia che vorrebbe estendere grafo, proprietà o
salute del vault ha una strada sola, `IndexQuery::Custom`.
