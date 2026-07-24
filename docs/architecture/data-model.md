# Modello dati comune (`fubmd-abi`)

Il modello di documento **comune e agnostico rispetto al formato**, definito in
`crates/fubmd-abi/src/model.rs`. È abbastanza ricco da rappresentare markdown in
modo fedele, ma **non nomina nulla di specifico del markdown**: i concetti
trasversali (link, tag, heading, frontmatter) sono estratti in tabelle piatte, e
tutto ciò che è peculiare di un formato (callout, math, embed, tabelle) finisce
nell'escape hatch `Custom`.

Torna a [../PIANO.md](../PIANO.md) · vedi anche [traits.md](traits.md).

## `DocId` — identità del documento

```rust
pub struct DocId(pub String);
```

È il **path relativo al vault**, normalizzato con separatori `/`, estensione
inclusa (il path è la verità). Metodi chiave: `page_name()` restituisce il
basename senza estensione (usato dalla risoluzione wikilink stile Obsidian). La
risoluzione wikilink → `DocId` è compito del **kernel**, non dei provider.

**Identità e rename (deciso).** Poiché l'identità È il path, un rename cambia
identità: il contratto lo tratta come operazione di prima classe, non come
remove+add. `Event::DocumentRenamed { from, to }` è l'evento dedicato (chi tiene
stato per-documento migra la chiave) e `Workspace::rename_document` è
l'operazione kernel: sposta il file, migra modello e grafo, ed esegue la
**riscrittura chirurgica** dei wikilink entranti in stile Obsidian — solo il
testo-pagina dentro lo `Span` del link, e solo per i riferimenti **per nome o
per path** che risolvevano davvero al documento rinominato (i riferimenti per
**alias** non si toccano: l'alias vive nel frontmatter del target e sopravvive
al rename; i riferimenti a un **omonimo** vincente non vengono dirottati). Se il
nuovo nome è conteso da un altro documento, la riscrittura usa il path senza
estensione, che è sempre univoco.

## `Span` — ancoraggio alla sorgente

```rust
pub struct Span { pub start: usize, pub end: usize } // [start, end) in byte
```

Ogni nodo del modello porta uno `Span` in **byte** sulla sorgente originale. È il
perno di due feature future: le decorazioni di live-preview in CodeMirror (M3) e
le modifiche in-place / round-trip (serialize). Costante `Span::EMPTY` per i test
del kernel che non conoscono alcun formato.

## `DocumentModel` — il documento parsato

```rust
pub struct DocumentModel {
    pub id: DocId,
    pub frontmatter: Frontmatter,        // metadati YAML/TOML proiettati su JSON
    pub body: Vec<Block>,                // albero a blocchi, per il rendering
    pub outline: Vec<Heading>,           // heading piatti, per outline/link a heading
    pub links: Vec<Link>,                // link piatti, risolti poi dal grafo
    pub tags: Vec<Tag>,                  // tag piatti
    pub text: String,                    // proiezione testo, per l'indice full-text
}
```

Doppia rappresentazione voluta: **l'albero `body`** serve al rendering, **le
tabelle piatte** (`outline`/`links`/`tags`/`text`) fanno sì che il kernel
costruisca grafo e indice **senza camminare alberi format-specific**. Il campo
`text` è la proiezione che alimenterà l'indice tantivy (M2).

`Frontmatter` è `serde_json::Map<String, Value>` con helper `aliases()` (accetta
stringa singola o lista, chiavi `aliases`/`alias`) — è la sorgente degli alias per
la risoluzione wikilink. Il workspace abilita `serde_json/preserve_order`: la
proiezione mantiene l'**ordine delle chiavi** del file dell'utente (riscrivere il
frontmatter non deve riordinarlo alfabeticamente). Restano comunque perdite note
della proiezione YAML→JSON (commenti, anchor): un'eventuale riscrittura del
frontmatter va fatta come patch sulla sorgente, non per riserializzazione — vedi
la sezione qui sotto.

## Fonte di verità e `serialize` (deciso)

**La fonte di verità di un documento esistente è la sua sorgente sul disco.**
Il `DocumentModel` è una *proiezione* lossy per costruzione: non conserva lo
stile di enfasi (`*` vs `_`), la spaziatura, l'indentazione delle liste, i
commenti YAML. Ne discendono tre regole:

1. `FormatProvider::serialize` è **generazione, non round-trip**: serve a creare
   documenti nuovi (template, "crea nota") e frammenti. La fedeltà round-trip
   integrale non è un obiettivo che "cresce nel tempo": con un modello lossy è
   irraggiungibile per costruzione, e fingere il contrario è il modo migliore di
   distruggere la formattazione dell'utente.
2. Il kernel **non riscrive mai un file esistente** passando da `serialize`.
3. Le modifiche programmatiche a un documento esistente (rename dei link,
   inserimenti, refactoring) si fanno come **patch chirurgiche sulla sorgente**,
   guidate dagli `Span` del modello. `Workspace::rename_document` è il primo
   esempio cablato di questo pattern.

## `Block` e `Inline` — l'albero

`Block` (tag serde `kind`): `Heading`, `Paragraph`, `List { ordered, items }`,
`CodeBlock { lang, code }`, `Quote`, `ThematicBreak`, e l'escape hatch
`Custom { custom_kind, attrs, blocks, span }`.

`Inline` (tag serde `kind`): `Text`, `Emph`, `Strong`, `Code`, `Link { target,
label, span }`, `TagRef { name, span }`, e `Custom { custom_kind, attrs, span }`.

**L'escape hatch `Custom`** è la chiave dell'agnosticità: callout Obsidian, blocchi
math, tabelle, embed **non sono hardcoded nell'enum**. Un provider li emette come
`Custom { custom_kind: "callout", attrs: {...}, ... }`; il core li rende senza
conoscerne la semantica (fino a M3, dove il rendering ricco li interpreta — vedi
[M3](../milestones/M3-editor-fidelity.md)).

### Registro dei `custom_kind` noti

`custom_kind` è una stringa: senza un registro condiviso due provider possono
emettere `attrs` diversi per lo stesso kind e l'agnosticità diventa illusoria.
Questo elenco è il **contratto dei kind noti** — un nuovo kind interpretato dal
frontend o da più provider va aggiunto qui prima di usarlo:

| `custom_kind` | `attrs` | Note |
|---|---|---|
| `callout` | `{ "type": string, "title": string? }` | callout Obsidian `> [!type] Title`; corpo in `blocks` |
| `math` | `{ "source": string, "display": bool }` | riservato (M3) |
| `table` | da definire a M3 | riservato (M3) |

I kind **sconosciuti** degradano sempre a resa generica
(`<div class="block-{kind}">`), mai a errore. Gli embed **non** passano da
`Custom`: sono `LinkTarget::Wiki { embed: true }` e la loro resa è il protocollo
di transclusion in [ui-protocol.md](ui-protocol.md).

## `LinkTarget` — intento non risolto

```rust
pub enum LinkTarget {
    Wiki { page: String, heading: Option<String>, block: Option<String>, embed: bool },
    Url(String),
    Path(String),
}
```

Il provider dichiara l'**intento** ("questo è un wikilink a `Page#Heading^block`,
eventualmente embed `![[..]]`"); la **risoluzione a `DocId` è del kernel** (regola
Obsidian dello shortest unique path). Questo confine è ciò che tiene il provider
markdown ignaro della topologia del vault. `Link` porta anche `span` e un
`context` opzionale (usato nell'anteprima dei backlink).

## Invarianti del modello

- Nessun tipo del modello nomina il markdown; l'unica dipendenza esterna è `serde`.
- Ogni tipo è `Serialize + Deserialize` (regola d'oro — attraversa IPC e, a M5, il
  confine WASM).
- Gli `Span` sono in byte e riferiti alla sorgente **originale** passata a `parse`.
- I `LinkTarget::Wiki` restano non risolti nel modello; risolverli è del grafo
  (`crates/fubmd-kernel/src/graph.rs`).
