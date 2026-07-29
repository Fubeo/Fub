# Modello dati comune (`fubmd-abi`)

Il modello di documento **comune e agnostico rispetto al formato**, in
`crates/fubmd-abi/src/model.rs`. È abbastanza ricco da rappresentare markdown in
modo fedele, ma **non nomina nulla di specifico del markdown**: i concetti
trasversali (link, tag, heading, frontmatter) sono estratti in tabelle piatte, e
ciò che è peculiare di un formato (callout, math, embed, tabelle) finisce
nell'escape hatch `Custom`.

**Che tipo di agnosticismo è.** Il modello non nomina la *sintassi* di nessun
formato, ma il kernel possiede una *semantica* precisa dei link: la risoluzione
wikilink in stile Obsidian (shortest unique path, alias nel frontmatter con
chiavi `aliases`/`alias`, priorità fra omonimi). Un futuro provider (org-mode,
AsciiDoc) non porta la propria semantica di risoluzione: mappa i propri
riferimenti su `LinkTarget::Wiki` e adotta quella del kernel. «Zero modifiche al
kernel» vale per la sintassi; per la semantica vale «una sola, quella del
kernel».

Torna a [../PIANO.md](../PIANO.md) · vedi anche [traits.md](traits.md).

## `DocId` — identità del documento

```rust
pub struct DocId(pub String);
```

È il **path relativo al vault**, normalizzato con separatori `/`, estensione
inclusa. `page_name()` restituisce il basename senza estensione (lo usa la
risoluzione wikilink). La risoluzione wikilink → `DocId` è compito del **kernel**,
non dei provider.

**Identità e rename.** Poiché l'identità È il path, un rename cambia identità: il
contratto lo tratta come operazione di prima classe, non come remove+add.
`Event::DocumentRenamed { from, to }` è l'evento dedicato (chi tiene stato
per-documento migra la chiave) e `Workspace::rename_document` è l'operazione:
sposta il file, migra modello e grafo, ed esegue la **riscrittura chirurgica**
dei wikilink entranti — solo il testo-pagina dentro lo `Span` del link, e solo
per i riferimenti **per nome o per path** che risolvevano davvero al documento
rinominato. I riferimenti per **alias** non si toccano (l'alias vive nel
frontmatter del target e sopravvive al rename); quelli a un **omonimo** vincente
non vengono dirottati. Se il nuovo nome è conteso, la riscrittura usa il path
senza estensione, che è sempre univoco.

**Case dei path.** Il `DocId` è **byte-exact** (conserva il case del filesystem);
la **risoluzione** wikilink è **case-insensitive** (le chiavi degli indici del
grafo sono normalizzate a minuscolo). Così la semantica osservabile è la stessa
su FS case-sensitive (Linux) e case-insensitive (macOS/Windows). Conseguenze:

- il **rename case-only** (`nota.md` → `Nota.md`) è supportato: su FS
  case-insensitive `vault.exists(to)` vedrebbe lo *stesso* file, quindi il kernel
  salta il check sul disco quando i due path coincidono a meno del case (una vera
  collisione è intercettata dalla cache dei modelli, perché il vault è l'unica
  fonte dei `DocId`);
- due documenti che differiscono solo per il case possono esistere solo su FS
  case-sensitive: lì la risoluzione resta deterministica per priorità (path più
  corto, poi lessicografico), come per qualsiasi omonimo.

## `Span` — ancoraggio alla sorgente

```rust
pub struct Span { pub start: usize, pub end: usize } // [start, end) in byte
```

Ogni nodo del modello porta uno `Span` in **byte** sulla sorgente originale. È il
perno delle decorazioni di live-preview in CodeMirror (M3) e delle modifiche
in-place. Costante `Span::EMPTY` per i test del kernel che non conoscono alcun
formato.

## `DocumentModel` — il documento parsato

```rust
pub struct DocumentModel {
    pub id: DocId,
    pub frontmatter: Frontmatter,        // metadati YAML/TOML proiettati su JSON
    pub body: Vec<Block>,                // albero a blocchi, per il rendering
    pub outline: Vec<Heading>,           // heading piatti, per outline/link a heading
    pub links: Vec<Link>,                // link piatti, risolti poi dal grafo
    pub tags: Vec<Tag>,                  // tag piatti
    pub anchors: Vec<Anchor>,            // ancore di blocco esplicite (`^id`)
    pub text: String,                    // proiezione testo, per l'indice full-text
}
```

Doppia rappresentazione voluta: **l'albero `body`** serve al rendering, **le
tabelle piatte** fanno sì che il kernel costruisca grafo e indice **senza
camminare alberi format-specific**.

`Frontmatter` è `serde_json::Map<String, Value>` con helper `aliases()` (accetta
stringa singola o lista, chiavi `aliases`/`alias`). Il workspace abilita
`serde_json/preserve_order`: la proiezione mantiene l'**ordine delle chiavi** del
file dell'utente. Restano perdite note della proiezione YAML→JSON (commenti,
anchor): riscrivere il frontmatter va fatto come patch sulla sorgente, non per
riserializzazione.

## Proprietà tipizzate

Il JSON del frontmatter è la **verità grezza**, non la risposta che i consumatori
cercano. `Frontmatter::property(key)` restituisce un `PropertyValue` normalizzato
— `Empty`, `Text`, `Number`, `Bool`, `Date`, `Link`, `List(Vec<PropertyScalar>)`,
`Unknown(json)` — e la regola sta nel contratto perché altrimenti ogni
consumatore reinventerebbe il parsing delle date e due plugin darebbero due
risposte diverse sullo stesso file.

Tre scelte, tutte nella direzione del **non indovinare**:

- **Solo l'ISO-8601 è una data** (`2026-07-25`, con orario e fuso opzionali,
  campi a larghezza fissa). `2026-7-5` e `1-2-3` restano testo. La data è
  **scomposta** (`year`/`month`/`day` + `time`) perché il primo cliente (10.4,
  calendario) raggruppa per giorno e per mese, e una stringa lo costringerebbe a
  riparsare. Il fuso è quello **scritto**: senza fuso resta `None`, perché il
  fuso dell'utente è una capacità dell'host, non un fatto del documento.
- **L'unica stringa che cambia specie è il wikilink**: `autore: "[[Mario]]"`
  diventa `PropertyValue::Link`, che è la "proprietà relazione" di 8.2. Un URL
  scritto in una proprietà resta `Text` — 8.2 ha *sia* "proprietà URL" *sia*
  "proprietà testo", e distinguerle è una scelta di prodotto, non un indovinello
  del parser.
- **La lista porta `PropertyScalar`, non `PropertyValue`**: il confine non ammette
  tipi ricorsivi (stessa ragione dell'arena), e per le proprietà l'arena sarebbe
  una macchina sproporzionata. La lista di liste cade in `Unknown`, cioè in JSON,
  e non perde niente.

## Fonte di verità e `serialize`

**La fonte di verità di un documento esistente è la sua sorgente sul disco.** Il
`DocumentModel` è una *proiezione* lossy per costruzione: non conserva lo stile
di enfasi (`*` vs `_`), la spaziatura, l'indentazione delle liste, i commenti
YAML. Ne discendono tre regole:

1. `FormatProvider::serialize` è **generazione, non round-trip**: serve a creare
   documenti nuovi (template, "crea nota") e frammenti. La fedeltà round-trip
   integrale non è un obiettivo che «cresce nel tempo»: con un modello lossy è
   irraggiungibile per costruzione.
2. Il kernel **non riscrive mai un file esistente** passando da `serialize`.
3. Le modifiche programmatiche (rename dei link, inserimenti, refactoring) si
   fanno come **patch chirurgiche sulla sorgente**, guidate dagli `Span`. Dalla
   [decisione 0008](../decisions/0008-modifica-chirurgica.md) la patch è una
   primitiva del contratto: `HostApi::apply_edit(id, EditRequest { base, edits })`,
   con `edits` una lista di `(Span, String)` in coordinate della base. **Guardia
   delle patch:** gli `Span` valgono solo per la sorgente da cui il modello è
   stato parsato, e `base` è la `Revision` di quella sorgente — una patch
   calcolata su un testo cambiato nel frattempo fallisce (`Conflict`) invece di
   applicarsi alla cieca. `Workspace::rename_document` è il primo cliente: il suo
   piano di riscrittura dei link è fatto di `EditRequest`, uno per sorgente.

## Le tre copie: disco, modello, buffer

«La verità è il disco» è completa solo per i documenti **chiusi**. Per il
documento aperto le copie sono tre — sorgente sul disco, `DocumentModel`,
**buffer dell'editor** — e il buffer con modifiche non salvate è **la verità** di
quel documento. La riconciliazione è dell'**app layer** (il kernel resta ignaro
dei buffer, come è ignaro della UI); le regole stanno in
`frontend/src/panels/document.ts`:

- **flush prima di cedere il passo**: ogni operazione che riscrive file salva
  prima il buffer sporco, così le patch chirurgiche non lavorano mai su una
  sorgente superata;
- **cambio esterno, buffer pulito** → il buffer si riallinea dal disco (senza
  reset del cursore se il contenuto è identico: l'eco del proprio salvataggio non
  è un cambio);
- **cambio esterno, buffer sporco** → il buffer **vince** e il suo salvataggio
  riallinea il disco; il conflitto è segnalato (warn), non silenzioso. È un
  limite accettato a M2: niente merge. Il conflitto esplicito (dialogo/merge,
  span-shift delle patch su buffer sporco) è lavoro di
  [M3](../milestones/M3-editor-fidelity.md).

La cancellazione è l'unica eccezione al flush, e in una sola direzione: il
salvataggio in attesa sul documento cestinato viene **disinnescato** invece che
eseguito, o farebbe risorgere la nota un istante dopo. Non è una perdita
silenziosa: è l'azione che l'utente ha appena confermato.

## Il documento cancellato e il documento di ieri

Due meccanismi allargano il discorso della verità senza contraddirlo, perché
nessuno dei due è una *seconda copia viva* del documento:

- **Il cestino** (`.trash/`, lo stesso di Obsidian). Cancellare dall'app è
  **spostare**: la sorgente resta sul disco, in un posto che il vault non guarda
  — il filtro dei path ignorati è uno solo, condiviso fra la scansione e il
  watcher, ed è ciò che impedisce a una nota cestinata di restare cercabile. Il
  ripristino è un `write_document` normale, quindi passa da grafo, indici ed
  eventi come ogni altra scrittura.
- **Le versioni** (`.fubmd/data/plugins/fubmd.versioning/`). Sono *copie morte*: snapshot
  timestampati, mai riletti dal kernel, mai in concorrenza con la sorgente.
  Ripristinarne una è di nuovo una scrittura normale, ed è il motivo per cui
  genera a sua volta una versione — cioè è annullabile.

## `Block` e `Inline` — l'albero

`Block` (tag serde `kind`): `Heading`, `Paragraph`, `List { ordered, items }`,
`CodeBlock { lang, code }`, `Quote`, `ThematicBreak`, l'escape hatch
`Custom { custom_kind, attrs, blocks }`, e `Table { head, rows, align }`. **Ogni**
variante porta `anchor: Option<String>` e `span`, e i due accessori totali
`Block::span()` / `Block::anchor()` evitano il `match` esaustivo ripetuto.

`Inline` (tag serde `kind`): `Text`, `Emph`, `Strong`, `Code`,
`Link { target, label, embed, span }`, `TagRef { name, span }`, e
`Custom { custom_kind, attrs, span }`.

**L'escape hatch `Custom`** è la chiave dell'agnosticità: callout Obsidian,
blocchi math, footnote, definition list **non sono hardcoded nell'enum**. Un
provider li emette come `Custom { custom_kind: "callout", attrs: {...}, ... }`; il
core li rende senza conoscerne la semantica.

### Task e liste

`Block::List` non porta `Vec<Vec<Block>>` ma `Vec<ListItem>`, e
`ListItem { blocks, task: Option<TaskMarker>, span }`. Il perché è dimensionale:
finché una task list era una lista di paragrafi, lo stato viveva nel testo, e
**tutto** il capitolo 10 di FEATURES (~90 voci) sarebbe ripartito dal parsing di
quel testo.

`TaskMarker { symbol: Option<char>, span }`, con `checked()` per la lettura
binaria. Due scelte:

- **un carattere, non un booleano**: gli stati personalizzati (`[/]` in corso,
  `[-]` cancellato, `[>]` rimandato) sono una richiesta esplicita di 10.1.
  `checked()` è `true` solo per `x`/`X` — regola di Obsidian; attribuire "fatto"
  a un simbolo che il prodotto non ha ancora definito sarebbe inventare
  semantica.
- **lo span è quello del simbolo**, non della voce né delle parentesi (`[ ]` → lo
  spazio in mezzo). Spuntare una task diventa la sostituzione di **un carattere**
  nella sorgente: la patch più piccola scrivibile, per il gesto più frequente che
  ci sia.

### Ancore stabili

Un blocco è indirizzabile in due sintassi, che sono due spazi di nomi distinti:

- `[[Nota#Titolo]]` → l'ancora di un heading è il suo **slug generato**
  (`heading_slug`, nel contratto: prima era una funzione privata del provider
  markdown, quindi due provider potevano dare due id allo stesso titolo);
- `[[Nota#^abc]]` → l'**id esplicito** che l'utente scrive in coda al blocco,
  normalizzato da `canonical_anchor` (trim + minuscolo, come `canonical_tag`) e
  validato da `valid_anchor` (lettere, cifre, `-`, `_`). Il `^` deve essere
  preceduto da spazio, altrimenti `2^10` in fondo a un paragrafo diventerebbe
  un'ancora.

La tabella piatta `DocumentModel.anchors` contiene **solo** le ancore esplicite,
con lo span del blocco (è ciò che un embed di blocco ritaglia) e quello del solo
marcatore (è ciò che si toglie esportando). Gli slug degli heading non ci stanno:
sono già in `outline`, e mescolare i due spazi di nomi renderebbe ambigua la
risoluzione.

L'ancora si attacca al blocco **più interno** che la contiene; per indirizzare un
contenitore — una lista, una tabella — si usa la forma su riga propria (`^abc` da
solo, subito dopo il blocco), che il parser non emette come blocco ma assegna a
quello che la precede. Nel rendering l'ancora diventa un `id=`, e non compare né
nel testo indicizzato né a schermo: è indirizzo, non contenuto.

### Tabella: variante, e le altre due no

Il criterio per promuovere qualcosa da `Custom` a variante è duplice: (a) un
consumatore **trasversale al formato** deve interrogarne la struttura, non solo
disegnarla; (b) la forma di `Custom` non regge il contenuto.

- **La tabella** soddisfa entrambi. Chi la consuma non è il renderer markdown ma
  11 (database su file), 11.4 (CSV/JSON), 17 (export Pandoc/Typst), 6.3 (stampa),
  22.1 (chunking), e a tutti serve righe/celle/allineamento *come tipo*. E
  `Custom { blocks }` porta solo blocchi, mentre una cella porta inline: prima di
  questa variante una tabella non era rappresentata alla grossa, era **persa**.
- **Footnote e definition list** non soddisfano né l'uno né l'altro: il loro
  contenuto *sono* blocchi e nessun consumatore trasversale ne interroga la
  struttura. Restano `Custom`, con `custom_kind` registrati. Promuoverle resta
  additivo; per la tabella non lo era, perché il difetto era già un bug.

### Registro dei `custom_kind` noti

`custom_kind` è una stringa: senza un registro condiviso due provider possono
emettere `attrs` diversi per lo stesso kind e l'agnosticità diventa illusoria. Le
costanti stanno in `fubmd_abi::model::custom_kind`; questa tabella è la loro
forma. Un nuovo kind interpretato dal frontend o da più provider va aggiunto in
tutti e due i posti prima di usarlo:

| `custom_kind` | `attrs` | Note |
|---|---|---|
| `callout` | `{ "type": string, "title": string? }` | callout Obsidian `> [!type] Title`; corpo in `blocks` |
| `footnote-definition` | `{ "label": string }` | corpo in `blocks` |
| `footnote-reference` | `{ "label": string }` | **inline** |
| `definition-list` | — | figli: `definition-term` e `definition-description` alternati |
| `definition-term` / `definition-description` | — | corpo in `blocks` |
| `html` | `{ "html": string }` | HTML grezzo della sorgente: resta **dato**, non torna markup (5.3) |
| `math` | `{ "source": string, "display": bool }` | prodotto dalla regola `fubmd:math` (recinto `math`/`latex`/`tex`), reso da `MathRenderer` |
| `diagram` | `{ "engine": string, "source": string }` | mermaid, PlantUML, Graphviz, D2. Il motore sta negli `attrs` perché il kind è la **famiglia**: chi li disegna vuole un innesto solo |
| `highlight` | `{ "text": string }` | **inline**, `==…==` |
| `block` | — | ciò che il provider non sa nominare |

**Chi emette un kind, e chi lo disegna.** Dalla
[decisione 0017](../decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md) i
kind non arrivano più solo dal provider: una `SyntaxRule` innestata può
produrne, e un `CustomRenderer` registrato può disegnarli. Il **namespace** li
divide — i kind del core non hanno prefisso (sono in questa tabella), quelli di
terzi portano `ns:`. `Workspace::undrawn_kinds()` dice quali sono prodotti e mai
disegnati.

I kind **sconosciuti** degradano sempre a resa generica
(`<div class="block-{kind}">` per un blocco, `<span class="inline-{kind}">` col
`text` degli `attrs` per un inline), mai a errore. Il degrado inline **non
esisteva** prima della 0017: un `Inline::Custom` sconosciuto non veniva reso
affatto, quindi il testo spariva in silenzio.

## `LinkTarget` — intento non risolto

```rust
pub enum LinkTarget {
    Wiki { page: String, heading: Option<String>, block: Option<String> },
    Url(String),
    Path(String),
}
```

Il provider dichiara l'**intento** ("questo è un wikilink a `Page#Heading^block`");
la **risoluzione a `DocId` è del kernel** (regola Obsidian dello shortest unique
path, e `fubmd_abi::rules::path` per i path). Questo confine è ciò che tiene il
provider markdown ignaro della topologia del vault.

**Chi decide la specie è il contratto.** `LinkTarget::classify(raw)` è la regola
per un link scritto alla markdown: schema URI valido (o `//host`) → `Url`, tutto
il resto → `Path`. Prima viveva dentro il provider markdown come
`url.contains("://")`, quindi (a) un secondo provider poteva rispondere un'altra
cosa sulla stessa stringa, e (b) `mailto:` non aveva `//` mentre `C:\foto\a.png`
sembrava avere uno schema.

**L'embed sta sul riferimento, non sul bersaglio.**
`Link { target, embed, span, context }` e `Inline::Link { .., embed, .. }`:
incorporare è un fatto di *chi riferisce* — la stessa nota si può linkare e
incorporare nella stessa pagina — e finché il flag stava dentro
`LinkTarget::Wiki`, `![](immagine.png)` non aveva modo di dirlo, quindi **le
immagini non entravano affatto in `links`**: nessun riferimento ad allegato
veniva aggiornato al rename né compariva fra gli orfani (13.1). Ora ci entrano, e
in anteprima un embed che non è un wikilink resta un **segnaposto**
(`data-embed-path` / `data-embed-url`): caricare una risorsa è una decisione
della shell (5.3, 23), non del provider che ha letto il file. La resa della
transclusion è in [ui-protocol.md](ui-protocol.md).

## Invarianti del modello

- Nessun tipo del modello nomina il markdown; l'unica dipendenza esterna è `serde`.
- Ogni tipo è `Serialize + Deserialize` (regola d'oro — attraversa IPC e, a M5,
  il confine WASM).
- Gli `Span` sono in byte e riferiti alla sorgente **originale** passata a `parse`.
- I `LinkTarget::Wiki` restano non risolti nel modello; risolverli è del grafo
  (`crates/fubmd-kernel/src/graph.rs`).
