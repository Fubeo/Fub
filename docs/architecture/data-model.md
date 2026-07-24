# Modello dati comune (`fubmd-abi`)

Il modello di documento **comune e agnostico rispetto al formato**, definito in
`crates/fubmd-abi/src/model.rs`. È abbastanza ricco da rappresentare markdown in
modo fedele, ma **non nomina nulla di specifico del markdown**: i concetti
trasversali (link, tag, heading, frontmatter) sono estratti in tabelle piatte, e
tutto ciò che è peculiare di un formato (callout, math, embed, tabelle) finisce
nell'escape hatch `Custom`.

**Che tipo di agnosticismo è (onestà).** Il modello non nomina la *sintassi* di
nessun formato, ma il kernel possiede una *semantica* precisa dei link: la
risoluzione wikilink in stile Obsidian (shortest unique path, alias nel
frontmatter con chiavi `aliases`/`alias`, priorità fra omonimi). È il
vocabolario comune: un futuro provider (org-mode, AsciiDoc) non porta la
propria semantica di risoluzione — mappa i propri riferimenti su
`LinkTarget::Wiki` e adotta quella del kernel. "Zero modifiche al kernel" vale
per la sintassi; per la semantica vale "una sola, quella del kernel".

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

**Case dei path (deciso).** Il `DocId` è **byte-exact** (conserva il case del
filesystem); la **risoluzione** wikilink è **case-insensitive** (le chiavi degli
indici del grafo sono normalizzate a minuscolo). Così la semantica osservabile è
la stessa su filesystem case-sensitive (Linux) e case-insensitive
(macOS/Windows). Conseguenze cablate:

- il **rename case-only** (`nota.md` → `Nota.md`) è supportato: su FS
  case-insensitive `vault.exists(to)` vedrebbe lo *stesso* file, quindi il
  kernel salta il check sul disco quando i due path coincidono a meno del case
  (una vera collisione è comunque intercettata dalla cache dei modelli, perché
  il vault è l'unica fonte dei `DocId`);
- due documenti che differiscono solo per il case possono esistere solo su FS
  case-sensitive: lì la risoluzione resta deterministica per priorità (path più
  corto, poi lessicografico), come per qualsiasi omonimo.

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
   esempio cablato di questo pattern. **Guardia delle patch:** gli `Span`
   valgono solo per la sorgente da cui il modello è stato parsato; prima di
   applicare, si verifica che il testo dentro lo span sia quello atteso (già
   fatto in `link_rewrite_plan`) — una patch su sorgente cambiata si scarta,
   mai si applica alla cieca.

## Le tre copie: disco, modello, buffer (deciso)

"La verità è il disco" è completa solo per i documenti **chiusi**. Per il
documento aperto le copie sono tre — sorgente sul disco, `DocumentModel`,
**buffer dell'editor** — e il buffer con modifiche non salvate è **la verità**
di quel documento. La riconciliazione è dell'**app layer** (il kernel resta
ignaro dei buffer, come è ignaro della UI); le regole, implementate nel
frontend (`frontend/src/main.ts`):

- **flush prima di cedere il passo**: cambio di documento (e in futuro ogni
  operazione che riscrive file, come il rename da palette) salva prima il
  buffer sporco, così le patch chirurgiche non lavorano mai su una sorgente
  superata;
- **cambio esterno, buffer pulito** → il buffer si riallinea dal disco (senza
  reset del cursore se il contenuto è identico: l'eco del proprio salvataggio
  non è un cambio);
- **cambio esterno, buffer sporco** → il buffer **vince** e il suo salvataggio
  riallinea il disco; il conflitto è segnalato (warn), non silenzioso. È un
  limite accettato a M2: niente merge. Il conflitto esplicito (dialogo/merge,
  span-shift delle patch su buffer sporco) è lavoro di
  [M3](../milestones/M3-editor-fidelity.md), dove la live-preview rende il
  problema quotidiano.

Il flush ha smesso di essere "in futuro": ogni operazione che riscrive file lo
chiama davvero — il rename dalla lista file e il ripristino di una versione
(vedi [PIANO.md](../PIANO.md), "Decisioni"). La cancellazione è l'unica
eccezione, e in una sola direzione: il salvataggio in attesa sul documento
cestinato viene **disinnescato** invece che eseguito, o farebbe risorgere la
nota un istante dopo. Il buffer sporco di un documento cancellato muore col
documento; non è una perdita silenziosa, è l'azione che l'utente ha appena
confermato.

## Il documento cancellato e il documento di ieri (deciso)

Due meccanismi allargano il discorso della verità senza contraddirlo, perché
nessuno dei due è una *seconda* copia viva del documento:

- **Il cestino** (`.trash/` dentro il vault, lo stesso di Obsidian). Cancellare
  dall'app è **spostare**: la sorgente resta sul disco, solo in un posto che il
  vault non guarda — il filtro dei path ignorati è uno solo, condiviso fra la
  scansione e il percorso del watcher, ed è ciò che impedisce a una nota
  cestinata di restare cercabile. Il cestino è piatto perché quello di Obsidian
  lo è; il ripristino riporta la nota nella radice ed è un `write_document`
  normale, quindi passa da grafo, indici ed eventi come ogni altra scrittura.
- **Le versioni** (`.fubmd-data/versions/`). Sono *copie morte*: snapshot
  timestampati, mai riletti dal kernel, mai in concorrenza con la sorgente.
  Ripristinarne una non è un canale privilegiato verso il disco ma di nuovo una
  scrittura normale — è il motivo per cui il ripristino genera a sua volta una
  versione, cioè è annullabile. Il campionatore è un `EventHandler` esterno al
  kernel: la verità del documento non cambia perché qualcuno la sta fotografando.

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
