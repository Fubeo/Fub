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
la risoluzione wikilink.

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
