//! Il modello di documento **comune e agnostico rispetto al formato**.
//!
//! Deve essere abbastanza ricco da rappresentare markdown in modo fedele, ma
//! non deve nominare nulla di specifico del markdown: i concetti trasversali
//! (link, tag, heading, ancore, frontmatter) sono estratti in tabelle piatte
//! così che il kernel possa costruire grafo e indice senza camminare alberi
//! format-specific. Tutto ciò che è peculiare di un formato (callout, math,
//! footnote, definition list) finisce nell'escape hatch
//! `Custom { custom_kind, attrs }`, con i kind condivisi registrati in
//! [`custom_kind`].
//!
//! Il criterio per cui qualcosa si guadagna una variante invece di restare
//! `Custom` è dichiarato in `docs/architecture/data-model.md`: deve esistere un
//! consumatore **trasversale al formato** che ne interroghi la struttura, e la
//! forma di `Custom` non deve reggerne il contenuto. La tabella ha entrambi (una
//! cella porta inline, e `Custom` porta solo blocchi); footnote e definition
//! list nessuno dei due.
//!
//! # `kind` + `value`: perché il tag qui è adiacente e non interno
//!
//! Gli enum di questo modulo le cui varianti portano uno **scalare**
//! (`Inline::Text(String)`, `LinkTarget::Url(String)`, `PropertyValue::Number`)
//! sono serializzati `#[serde(tag = "kind", content = "value")]`. Non è
//! cosmesi: con il tag *interno* — la forma che usano gli enum di sole varianti
//! a struct (`Block`, `Event`, `UiNode`) — serde non sa dove mettere uno
//! scalare accanto al tag, e `serde_json::to_string` **fallisce a runtime**
//! ("cannot serialize tagged newtype variant"). Un tipo del contratto che non
//! attraversa il JSON non è un tipo del contratto: l'IPC verso la shell è JSON,
//! e ciò che non ci passa non arriva a nessuna view. Il presidio è il
//! round-trip in coda a questo modulo, che elenca ogni variante.

use serde::{Deserialize, Serialize};

use crate::rules::composition::composed;

/// L'identità di un documento nel vault: **il path**, e non un'altra cosa.
///
/// È il path relativo al vault, normalizzato con separatori `/` e senza
/// estensione implicita rimossa (il path è la verità). La risoluzione dei
/// wikilink → `DocId` è compito del kernel, non dei provider; la domanda con
/// cui gliela si chiede è
/// [`IndexQuery::Resolve`](crate::traits::IndexQuery::Resolve).
///
/// # Il path è la chiave **per sempre** (decisione 0043)
///
/// Non è una scelta rimandata a quando qualcuno chiederà un id stabile: è
/// decisa, ed è decisa *contro* la seconda strada — un `DocRef` a due forme
/// (path *oppure* id opaco) che ogni firma del contratto avrebbe dovuto
/// prendere al posto di questa. La ragione sta tutta in una domanda: **dove
/// vivrebbe quell'id?**
///
/// - *Fuori dal file*, in una tabella `path → id`: non sopravvive a ciò per cui
///   esiste. Una nota rinominata mentre Fub è chiuso lascia la tabella che
///   nomina il path vecchio, e il path nuovo senza id — cioè esattamente il
///   caso che l'id stabile doveva coprire. È il path con un costume addosso, e
///   in più un file da tenere in sincronia.
/// - *Dentro il file*, nel frontmatter: sopravvive davvero — ma allora **è una
///   proprietà**, e le proprietà il contratto le sa già dire
///   ([`Frontmatter::property`], [`IndexQuery::Documents`] con
///   [`QueryPredicate::Property`]). L'«UUID opzionale per nota» e l'id
///   Zettelkasten di FEATURES sono esprimibili **oggi**, senza toccare una
///   firma, e restano ciò che sono: un dato del documento, non la sua chiave.
///
/// Quindi la seconda forma o è già esprimibile, o non funziona. Ciò che resta a
/// carico di questa scelta è la **migrazione della chiave** a ogni rinomina, che
/// è per sempre un problema del kernel: dove atterra lo stato per-documento di
/// chi non è il kernel lo dice [`rules::doc_data`](crate::rules::doc_data).
///
/// [`IndexQuery::Documents`]: crate::traits::IndexQuery::Documents
/// [`QueryPredicate::Property`]: crate::query::QueryPredicate::Property
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DocId(pub String);

impl DocId {
    pub fn new(path: impl Into<String>) -> Self {
        DocId(path.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Il "nome pagina" (basename senza l'ultima estensione), usato dalla
    /// risoluzione dei wikilink in stile Obsidian e dal display.
    ///
    /// La regola è **una sola**, e vale anche per il frontend: si toglie ciò che
    /// segue l'ultimo punto, a meno che il punto sia il primo carattere del
    /// basename — un dotfile non ha estensione, il punto è parte del nome.
    /// Nessuna delle due implementazioni consulta l'elenco delle estensioni
    /// *gestite*, perché un `DocId` viene dal vault e quindi un'estensione
    /// gestita ce l'ha già — filtrarci sopra faceva divergere risoluzione e
    /// display su nomi come `note.backup`.
    ///
    /// La gemella TypeScript è `pageName` in `frontend/src/rules/mirrored.ts`, e
    /// a tenerle uguali sui nomi ostili non è più un elenco copiato a mano ma la
    /// fixture generata di `tests/rules_mirror.rs` (§6.2).
    pub fn page_name(&self) -> &str {
        let after_slash = self.0.rsplit('/').next().unwrap_or(&self.0);
        match after_slash.rsplit_once('.') {
            Some((stem, _ext)) if !stem.is_empty() => stem,
            _ => after_slash,
        }
    }
}

impl std::fmt::Display for DocId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Un intervallo `[start, end)` in **byte** nella sorgente originale.
///
/// Ogni nodo porta uno span: è indispensabile per le decorazioni di live
/// preview in CodeMirror e per le modifiche in-place / round-trip.
///
/// # Che cos'è «la sorgente» (§15.5)
///
/// **I byte del file decodificati, integralmente**: il BOM se c'era, i
/// terminatori di riga come stanno sul disco, nessuna normalizzazione. È la
/// stessa stringa che
/// [`VaultRead::read_document`](crate::traits::VaultRead::read_document)
/// restituisce, quella su cui [`Revision::of`](crate::edit::Revision::of) è
/// calcolata, e quella che
/// [`write_document`](crate::traits::VaultWrite::write_document) scrive. Un
/// `Span { start: 0, end: 0 }` su un file col BOM inserisce **prima** del BOM;
/// chi vuole la testa del *contenuto* parte da
/// [`text_policy::bom_len`](crate::rules::text_policy::bom_len).
///
/// Detto per esteso perché non era detto da nessuna parte, e le due letture
/// possibili — i byte del file, oppure un testo già normalizzato — sono
/// indistinguibili fino al momento in cui un provider calcola gli offset su una
/// e l'host li applica sull'altra. Allora gli edit atterrano spostati di quanto
/// misura ciò che è stato normalizzato, e nessun test lo vede: il documento
/// resta UTF-8 valido, con dei byte in meno da un punto e in più da un altro.
///
/// La lettura scartata è «un testo normalizzato», e ha tre problemi che non si
/// riparano:
///
/// 1. **La fedeltà diventa indimostrabile.** Il catalogo (§2.4) promette
///    «nessuna modifica fuori dallo span dichiarato», che è un'affermazione sul
///    *file*: se gli span vivono in un altro sistema di coordinate, la promessa
///    ha bisogno di una traduzione che solo l'host conosce, e verificarla
///    diventa impossibile per chiunque altro.
/// 2. **La revisione mentirebbe.** [`Revision::of`](crate::edit::Revision::of) è
///    l'impronta del sorgente, e due file che differiscono per il solo BOM
///    darebbero la stessa impronta: un edit calcolato senza BOM verrebbe
///    accettato su un file che ce l'ha, e cadrebbe tre byte più in là.
/// 3. **Normalizzare in lettura obbliga a riscrivere.** O si riscrive il file
///    normalizzato — e il primo salvataggio di una nota CRLF muove ogni riga,
///    che è il `git diff` pieno di righe che l'utente non ha scritto — o si
///    tiene da parte ciò che è stato tolto per rimetterlo dopo, cioè la stessa
///    informazione in un secondo posto, dove si disallinea.
///
/// Chi parsa un formato che non tollera il BOM lo **salta senza uscire dalle
/// coordinate**: si dà al parser
/// [`text_policy::strip_bom`](crate::rules::text_policy::strip_bom) e si somma
/// `bom_len` agli offset che torna. È l'unica traslazione del sistema, e sta
/// scritta in un posto solo.
///
/// I campi sono `usize` perché indicizzano `&str` in memoria, e non `u64`:
/// dover scrivere `as usize` a ogni slice per compiacere il confine sarebbe la
/// coda che muove il cane. Nel WIT lo span è `record span { start: u64, end: u64 }`
/// — il confine ha bisogno di una larghezza fissa — e la conversione vive nel
/// proxy WASM: `usize`→`u64` è sempre lecita, `u64`→`usize` su wasm32 (dove
/// `usize` è a 32 bit) passa da un `try_into`, con il conforto che un documento
/// più grande di 4 GiB non entrerebbe comunque nella memoria di un modulo.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub const EMPTY: Span = Span { start: 0, end: 0 };

    pub fn new(start: usize, end: usize) -> Self {
        Span { start, end }
    }
}

/// Metadati strutturati del documento (frontmatter YAML/TOML/... proiettati su
/// JSON, così che il core resti agnostico rispetto alla sintassi).
///
/// Il JSON resta la **verità grezza** — è ciò che il file dice, ordine delle
/// chiavi compreso. Ciò che i consumatori vogliono, però, non è quasi mai il
/// JSON: è "questa proprietà è una data", "questa è una relazione". Quella
/// lettura è [`Frontmatter::property`], e la sua forma normalizzata è
/// [`PropertyValue`]: senza, ogni consumatore reinventerebbe il parsing delle
/// date, e due plugin darebbero due risposte diverse sullo stesso file.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Frontmatter(pub serde_json::Map<String, serde_json::Value>);

impl Frontmatter {
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.0.get(key)
    }

    /// La proprietà `key` **normalizzata** ([`PropertyValue`]), o `None` se la
    /// chiave non c'è (che è diverso da `Some(PropertyValue::Empty)`: quello è
    /// `key:` senza valore).
    ///
    /// `formats` sono i formati di data che **il vault dichiara**
    /// ([`DateFormats`]); chi non ne ha nessuno passa [`DateFormats::ISO`], che
    /// è la regola della 0003 intera. È un parametro e non un default perché
    /// leggere lo stesso file con due dichiarazioni diverse dà due risposte
    /// diverse, e un chiamante che non se ne accorge è un filtro che non trova.
    pub fn property(&self, key: &str, formats: &DateFormats) -> Option<PropertyValue> {
        self.0
            .get(key)
            .map(|v| PropertyValue::normalize(v, formats))
    }

    /// Tutte le proprietà normalizzate, **nell'ordine del file** (il workspace
    /// abilita `serde_json/preserve_order`).
    pub fn properties(&self, formats: &DateFormats) -> Vec<(String, PropertyValue)> {
        self.0
            .iter()
            .map(|(k, v)| (k.clone(), PropertyValue::normalize(v, formats)))
            .collect()
    }

    /// Alias dichiarati nel frontmatter (`aliases: [..]` in stile Obsidian).
    /// Accetta sia una stringa singola sia una lista.
    pub fn aliases(&self) -> Vec<String> {
        match self.0.get("aliases").or_else(|| self.0.get("alias")) {
            Some(serde_json::Value::String(s)) => vec![s.clone()],
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            _ => Vec::new(),
        }
    }
}

/// Il documento parsato nel modello comune.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DocumentModel {
    pub id: DocId,
    pub frontmatter: Frontmatter,
    /// L'albero a blocchi (per il rendering).
    pub body: Vec<Block>,
    /// Heading in ordine, piatti (per outline panel e link a heading).
    pub outline: Vec<Heading>,
    /// Link piatti, risolti in seguito dal grafo del kernel.
    pub links: Vec<Link>,
    /// Tag piatti.
    pub tags: Vec<Tag>,
    /// Ancore di blocco esplicite (`^id`), piatte: è così che il kernel risolve
    /// un `[[Nota#^blocco]]` senza camminare l'albero. Le ancore degli
    /// **heading** non stanno qui: sono lo `slug` di [`Heading`] in `outline`,
    /// perché `#titolo` e `#^blocco` sono due sintassi e due spazi di nomi
    /// diversi, e mescolarli renderebbe ambigua la risoluzione.
    pub anchors: Vec<Anchor>,
    /// Proiezione a testo semplice, per l'indicizzazione full-text.
    pub text: String,
    /// Il documento **porta** un frontmatter, anche se non dichiara nessuna
    /// proprietà.
    ///
    /// `frontmatter` è una mappa, e una mappa vuota non sa dire la differenza
    /// fra «il file non ha un frontmatter» e «il file ha un frontmatter senza
    /// chiavi» — cioè le due righe di delimitatori che si scrivono per dire
    /// «i metadati di questa nota li compilo dopo». Chi riscriveva il file
    /// leggeva la mappa vuota, concludeva «niente frontmatter» e toglieva dal
    /// documento due righe che l'utente aveva battuto.
    ///
    /// Non è un campo di markdown: TOML, JSON e ogni altra sintassi di
    /// frontmatter hanno lo stesso vuoto da distinguere. Sta **in fondo** al
    /// record perché la posizione dei campi è ABI (`wit_additivity`), e ha un
    /// `serde(default)` perché un modello serializzato prima che il campo
    /// esistesse si rilegge come «nessun frontmatter», che è ciò che quel
    /// modello diceva.
    #[serde(default)]
    pub frontmatter_present: bool,
}

impl DocumentModel {
    /// Costruisce un modello vuoto per un dato id (comodo nei test del kernel,
    /// che non conoscono alcun formato).
    pub fn empty(id: DocId) -> Self {
        DocumentModel {
            id,
            frontmatter: Frontmatter::default(),
            body: Vec::new(),
            outline: Vec::new(),
            links: Vec::new(),
            tags: Vec::new(),
            anchors: Vec::new(),
            text: String::new(),
            frontmatter_present: false,
        }
    }
}

/// Nodi a livello di blocco. `Custom` è l'escape hatch: callout, math,
/// footnote, definition list non sono hardcoded nell'enum.
///
/// # L'ancora
///
/// Ogni blocco porta un `anchor: Option<String>`, ed è la stessa cosa vista da
/// due sintassi: per un [`Block::Heading`] è lo **slug** del titolo — generato
/// dal testo ([`heading_slug`]) o, quando l'utente ha scritto un id esplicito
/// in coda al titolo (`## Titolo ^Mio-ID`), **quell'id com'è scritto** (vedi
/// [`Block::Heading`] e [`Heading`]: lo slug dell'outline è la forma canonica
/// dell'id, la chiave; l'`anchor` del blocco è l'id scritto, ciò che l'HTML
/// porta verbatim) — per tutti gli altri è l'**id esplicito** che l'utente ha
/// scritto in coda al blocco (`^abc123`, normalizzato da [`canonical_anchor`]).
/// È ciò che rende indirizzabile un pezzo di documento — link a blocco (7.1),
/// embed di blocchi (5.2), deep link a un'annotazione (13.3), diff a blocchi
/// (18.3) — e senza, ogni feature di quella famiglia ricomincerebbe dal
/// parsing. Alcuni blocchi non ne portano mai una (`ThematicBreak`): il campo
/// c'è lo stesso perché [`Block::anchor`] sia totale.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Block {
    Heading {
        level: u8,
        inlines: Vec<Inline>,
        anchor: Option<String>,
        span: Span,
        /// L'ancora **scritta dall'utente** in coda al titolo (`## Titolo ^Mio-ID`),
        /// **com'è scritta** — la maiuscola e i trattini non vengono
        /// normalizzati: è ciò che `serialize` riscrive sul file e ciò che
        /// l'HTML deve portare verbatim. Con un id scritto `anchor` vale questo
        /// stesso id com'è scritto; la **chiave** — la forma canonica
        /// ([`canonical_anchor`]), quella con cui la tabella piatta `anchors`
        /// risolve `[[Nota#^mio-id]]` — sta nello `slug` dell'outline
        /// ([`Heading`]), non qui. Uno slug non si può distinguere da un id
        /// che per coincidenza gli somiglia, e senza questo campo «`## Testa`
        /// torna `## Testa ^testa`» — un'ancora che nel file non c'era.
        ///
        /// Sta **in fondo** al record perché la posizione dei campi è ABI
        /// (`wit_additivity`): ciò che c'era non si muove.
        explicit_anchor: Option<String>,
    },
    Paragraph {
        inlines: Vec<Inline>,
        anchor: Option<String>,
        span: Span,
    },
    List {
        ordered: bool,
        items: Vec<ListItem>,
        anchor: Option<String>,
        span: Span,
        /// Il numero da cui parte un elenco **ordinato**: `3.` come primo
        /// marcatore vuol dire `Some(3)`. `None` per un elenco puntato, e per
        /// un ordinato costruito da un generatore che non ha un numero da
        /// dichiarare — che vale `1`, cioè il default di ogni formato.
        ///
        /// **Non è impaginazione.** Un elenco che comincia da 3 riprende un
        /// elenco interrotto — una procedura spezzata da una nota, i passi
        /// continuati dopo un blocco di codice — e riportarlo a 1 fa dire al
        /// documento riscritto una cosa diversa da quella che il documento
        /// letto diceva. È dato: `<ol start>` in HTML ce l'ha, CommonMark ce
        /// l'ha, e finché non c'era qui il numero si perdeva fra il file e il
        /// file.
        ///
        /// Sta **in fondo** al record perché la posizione dei campi è ABI
        /// (`wit_additivity`): ciò che c'era non si muove.
        start: Option<u32>,
    },
    CodeBlock {
        lang: Option<String>,
        code: String,
        anchor: Option<String>,
        span: Span,
    },
    Quote {
        blocks: Vec<Block>,
        anchor: Option<String>,
        span: Span,
    },
    ThematicBreak {
        anchor: Option<String>,
        span: Span,
    },
    /// Callout Obsidian, blocchi math, footnote, definition list... mappano
    /// qui, con un `custom_kind` preso dal registro di [`custom_kind`].
    Custom {
        custom_kind: String,
        attrs: serde_json::Value,
        blocks: Vec<Block>,
        anchor: Option<String>,
        span: Span,
    },
    /// La tabella è l'unica delle tre candidate della decisione 0003 promossa a variante, e
    /// il criterio è dichiarato: (a) chi la consuma è **trasversale al
    /// formato** — database su file, import/export CSV/JSON, Pandoc/Typst,
    /// stampa, chunking per il RAG — e ha bisogno di righe, celle e
    /// allineamento *come tipo*, non come stringhe da interrogare; (b) la forma
    /// di `Custom` non la regge, perché `blocks` porta solo blocchi mentre una
    /// cella porta inline. Prima di questa variante una tabella non era
    /// "rappresentata alla grossa": era **persa**, degradata a `Custom("table")`
    /// di `Custom("block")` indistinguibili, senza allineamento.
    ///
    /// Footnote e definition list restano `Custom`: il loro contenuto *sono*
    /// blocchi, quindi l'escape hatch calza, e nessun consumatore trasversale
    /// ne interroga la struttura. Promuoverle più avanti resta additivo (un
    /// caso in fondo al variant); qui non lo era, perché il difetto era già un
    /// bug e non un debito.
    Table {
        /// La riga di intestazione, se il formato la distingue.
        head: Option<TableRow>,
        rows: Vec<TableRow>,
        /// Allineamento per colonna, in ordine. Può essere più corta delle
        /// righe: le colonne in eccesso sono [`ColumnAlign::None`].
        align: Vec<ColumnAlign>,
        anchor: Option<String>,
        span: Span,
    },
    /// Una reference definition CommonMark: `[etichetta]: destinazione "titolo"`.
    /// È metadata — la riga che dichiara il bersaglio di un `[a][etichetta]` —
    /// e la sua forma è **scalare** (etichetta, URL, titolo), non blocchi: è
    /// per questo che `Custom { blocks }` non la regge, lo stesso criterio
    /// che ha promosso la tabella a variante. `comrak` la consuma durante il
    /// parsing senza lasciare un nodo nell'AST, quindi senza questa variante
    /// la riga spariva dal modello e la prima riscrittura la cancellava dal
    /// file (§4: `[a][rif]` + `[rif]: nota.md` → `[a](nota.md)`). Non entra
    /// nel testo piatto del documento: è indirizzo, non prosa. `url` è la
    /// destinazione **nuda** (le `<…>` che la racchiudono si normalizzano),
    /// e `title` è il titolo senza i suoi delimitatatori.
    ReferenceDefinition {
        label: String,
        url: String,
        title: Option<String>,
        anchor: Option<String>,
        span: Span,
    },
}

impl Block {
    /// Lo `Span` del blocco, qualunque variante sia.
    ///
    /// Esiste perché il `match` esaustivo sulle varianti per estrarre un
    /// campo che c'è in tutte era già scritto due volte in posti diversi, e la
    /// terza copia sarebbe stata quella sbagliata.
    pub fn span(&self) -> Span {
        match self {
            Block::Heading { span, .. }
            | Block::Paragraph { span, .. }
            | Block::List { span, .. }
            | Block::CodeBlock { span, .. }
            | Block::Quote { span, .. }
            | Block::ThematicBreak { span, .. }
            | Block::Custom { span, .. }
            | Block::Table { span, .. }
            | Block::ReferenceDefinition { span, .. } => *span,
        }
    }

    /// L'ancora del blocco, se ne ha una.
    pub fn anchor(&self) -> Option<&str> {
        match self {
            Block::Heading { anchor, .. }
            | Block::Paragraph { anchor, .. }
            | Block::List { anchor, .. }
            | Block::CodeBlock { anchor, .. }
            | Block::Quote { anchor, .. }
            | Block::ThematicBreak { anchor, .. }
            | Block::Custom { anchor, .. }
            | Block::Table { anchor, .. }
            | Block::ReferenceDefinition { anchor, .. } => anchor.as_deref(),
        }
    }
}

/// Una voce di lista.
///
/// Non è un `Vec<Block>` nudo perché una voce di lista **può essere una task**,
/// e una task list rappresentata come lista di paragrafi obbliga chiunque
/// (viste task, query, spunta da UI, ricorrenze — il capitolo 10 per intero) a
/// ricominciare dal parsing del testo. Lo stato sta in `task`, che è `None` per
/// le voci normali.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ListItem {
    pub blocks: Vec<Block>,
    /// Presente **sse** la voce è una task. Tenere stato e marcatore insieme in
    /// un `Option` rende irrappresentabile la voce con lo stato ma senza il
    /// posto dove scriverlo (e viceversa).
    pub task: Option<TaskMarker>,
    pub span: Span,
}

/// Il marcatore di una task: cosa c'è fra le parentesi, e **dove**.
///
/// Lo `span` è quello del **simbolo**, non della voce e nemmeno delle
/// parentesi: `[ ]` → lo spazio in mezzo, `[x]` → la `x`. Spuntare una task è
/// così la sostituzione di **un carattere** nella sorgente, che è la patch più
/// piccola che si possa scrivere — e il gesto quotidiano del capitolo 10 non
/// deve riscrivere il documento per cambiare uno stato.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskMarker {
    /// Il simbolo scritto fra le parentesi; `None` è la casella vuota (`[ ]`).
    ///
    /// È un carattere e non un booleano perché gli stati personalizzati sono
    /// una richiesta esplicita del prodotto (10.1: in corso, cancellato,
    /// bloccato, in attesa) e nascono tutti qui: `[/]`, `[-]`, `[>]`. Un
    /// `bool` avrebbe chiuso quella famiglia al primo parse.
    pub symbol: Option<char>,
    pub span: Span,
}

impl TaskMarker {
    /// La lettura binaria, quella che serve a chi vuole solo sapere se è fatta:
    /// `[x]`/`[X]`. Ogni altro simbolo è uno stato **non** completato — è la
    /// regola di Obsidian, ed è l'unica che non inventa semantica sui simboli
    /// che il prodotto non ha ancora definito.
    pub fn checked(&self) -> bool {
        matches!(self.symbol, Some('x') | Some('X'))
    }
}

/// Una riga di tabella.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

/// Una cella di tabella: inline, non blocchi — ed è la ragione per cui la
/// tabella non stava dentro `Custom`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TableCell {
    pub inlines: Vec<Inline>,
    pub span: Span,
}

/// Allineamento di una colonna.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColumnAlign {
    /// Non dichiarato: chi disegna decide (di solito a sinistra).
    #[default]
    None,
    Left,
    Center,
    Right,
}

/// Nodi inline. Wikilink e link markdown normalizzano entrambi su `Link`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Inline {
    Text(String),
    Emph(Vec<Inline>),
    Strong(Vec<Inline>),
    Code(String),
    Link {
        target: LinkTarget,
        label: Option<Vec<Inline>>,
        /// Il riferimento **incorpora** il bersaglio invece di puntarlo:
        /// `![[Nota]]`, `![alt](immagine.png)`. Vedi [`Link::embed`].
        embed: bool,
        span: Span,
    },
    TagRef {
        name: String,
        span: Span,
    },
    Custom {
        custom_kind: String,
        attrs: serde_json::Value,
        span: Span,
    },
    /// `^apice^`: un apice inline, variante a sé del dialetto (l'estensione
    /// `superscript` di comrak). Non collassa in [`Inline::Custom`] né
    /// nell'enfasi: è un costrutto che si legge in un modo e si riscrive in
    /// quello stesso modo.
    Superscript(Vec<Inline>),
    /// `~~barrato~~`: un tratto di testo barrato. Variante a sé, distinta
    /// dall'apice e dall'enfasi — due costrutti diversi non finiscono nello
    /// stesso stile né nello stesso testo.
    Strikethrough(Vec<Inline>),
    /// A-capo **duro** (`  ` o `\` a fine riga): nella resa cambia riga.
    ///
    /// È un nodo a sé perché il `Text(" ")` con cui prima si appiattiva faceva
    /// sparire il salto alla prima riscrittura — e al giro dopo i due `Text`
    /// diventavano un nodo solo, cioè una forma del modello che cambiava fra
    /// round 1 e round 2. In coda all'enum perché l'ordine dei casi è il
    /// discriminante dell'ABI (additivo = in fondo).
    HardBreak,
    /// A-capo **morbido**: la riga continua, e nella resa è uno spazio.
    SoftBreak,
}

/// Intento di link **non risolto**. Il provider dice "questo è un wikilink alla
/// pagina X#heading"; la risoluzione a `DocId` è compito del KERNEL (regola
/// Obsidian dello shortest unique path).
///
/// Le tre varianti sono tre *specie* di bersaglio, e la distinzione fra
/// "risorsa del vault" (`Wiki`, `Path`) e "mondo esterno" (`Url`) è una regola
/// del **contratto**, non di chi parsa: sta in [`LinkTarget::classify`]. Prima
/// viveva dentro il provider markdown, e un secondo provider poteva
/// legittimamente rispondere un'altra cosa sulla stessa stringa — con l'effetto
/// che metà del grafo dipendeva da chi aveva letto il file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum LinkTarget {
    /// `[[Page#Heading^block]]`.
    Wiki {
        page: String,
        heading: Option<String>,
        block: Option<String>,
    },
    Url(String),
    Path(String),
}

impl LinkTarget {
    pub fn wiki(page: impl Into<String>) -> Self {
        LinkTarget::Wiki {
            page: page.into(),
            heading: None,
            block: None,
        }
    }

    /// Questo riferimento nomina il documento che lo **ospita**?
    ///
    /// È il caso di `[[#Sezione]]` e `[[#^blocco]]`: un wikilink senza pagina
    /// non è un link rotto e non è un link a niente — è un link *qui dentro*, e
    /// il documento che nomina è quello in cui è scritto. Il parser lo produce
    /// dal primo giorno (`page` vuota, `heading` o `block` pieni); a leggerlo
    /// non era nessuno, e le due conseguenze erano che la risoluzione
    /// rispondeva `None` e il controllo di salute lo dichiarava rotto con la
    /// stringa vuota come destinazione.
    ///
    /// La regola sta qui e non nei due chiamanti perché è una regola della
    /// **grammatica**, non della risoluzione: chi chiede «a cosa punta» e chi
    /// chiede «è rotto» devono avere la stessa risposta, e due copie
    /// divergerebbero al primo che se ne dimentica.
    ///
    /// `[[]]` non passa: senza pagina *e* senza punto non c'è niente da
    /// nominare, e «questo documento in cima» non è ciò che quel link chiede —
    /// è ciò che si otterrebbe non chiedendo niente.
    pub fn names_host(&self) -> bool {
        match self {
            LinkTarget::Wiki {
                page,
                heading,
                block,
            } => page.trim().is_empty() && (heading.is_some() || block.is_some()),
            _ => false,
        }
    }

    /// La destinazione di un link scritto "alla markdown" (`[t](qui)`): è del
    /// **vault** o del mondo esterno?
    ///
    /// La regola è lo schema: `qualcosa:` con uno schema URI valido (lettera,
    /// poi lettere/cifre/`+`/`-`/`.`) oppure il protocol-relative `//host` →
    /// [`LinkTarget::Url`]; tutto il resto è un path dentro il vault, che il
    /// kernel risolverà (`fub_kernel::pathlink`). Un `mailto:`, un `tel:`,
    /// un `obsidian://` cadono nel primo caso senza essere nominati uno per uno.
    ///
    /// Il caso ostile è il path di Windows (`C:\foto\a.png`): lo schema di un
    /// URI è lungo almeno due caratteri, quindi `C:` non lo è, e resta un path.
    pub fn classify(raw: &str) -> Self {
        let s = raw.trim();
        if s.starts_with("//") {
            return LinkTarget::Url(raw.to_string());
        }
        if let Some((scheme, _)) = s.split_once(':') {
            let mut chars = scheme.chars();
            let ok = scheme.len() >= 2
                && chars.next().is_some_and(|c| c.is_ascii_alphabetic())
                && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
            if ok {
                return LinkTarget::Url(raw.to_string());
            }
        }
        LinkTarget::Path(raw.to_string())
    }
}

/// L'interno di un wikilink già scomposto: `Page#Heading^block|Alias`.
///
/// Vive nel contratto e non nel toolkit dei provider testuali perché è la
/// **grammatica di ciò che il contratto dichiara**: [`LinkTarget::Wiki`] ha
/// esattamente quei tre campi, e la regola che li riempie è una sola, come
/// [`canonical_tag`]. `fub-sdk` la ri-esporta per i provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedWikilink {
    pub target: LinkTarget,
    /// Alias di visualizzazione dopo `|`, se presente.
    pub alias: Option<String>,
}

/// Parsa l'interno di un wikilink, cioè il contenuto fra `[[` e `]]`.
///
/// L'`embed` non è qui: il `!` sta *fuori* dalle parentesi, ed è una proprietà
/// del riferimento, non del bersaglio (vedi [`Link::embed`]).
///
/// Esempi: `Nota`, `Nota#Sezione`, `Nota^blocco`, `Nota#Sez|testo`, `#SoloHeading`.
///
/// È **indulgente di proposito** su una forma che Obsidian non scrive:
/// `Nota^blocco` senza `#` dà lo stesso un riferimento a blocco. Chi *scrive*
/// non lo è ([`LinkTarget::wiki_inner`] mette sempre il `#`), che è la sola
/// composizione in cui leggere e scrivere non producono un dialetto privato.
pub fn parse_wikilink_inner(inner: &str) -> ParsedWikilink {
    // Alias dopo la prima '|'.
    let (link_part, alias) = match inner.split_once('|') {
        Some((the, a)) => (the, Some(a.trim().to_string())),
        None => (inner, None),
    };

    // Riferimento a blocco `^id` (solo se dopo un eventuale heading).
    let (link_part, block) = match link_part.split_once('^') {
        Some((the, b)) => (the, Some(b.trim().to_string())),
        None => (link_part, None),
    };

    // Heading dopo '#'.
    let (page, heading) = match link_part.split_once('#') {
        Some((p, h)) => (p.trim().to_string(), Some(h.trim().to_string())),
        None => (link_part.trim().to_string(), None),
    };

    ParsedWikilink {
        target: LinkTarget::Wiki {
            page,
            // **Un heading vuoto non è un heading.** In `Nota#^blocco` il `#`
            // introduce il `^` e non nomina niente, e in `Nota#` non c'è niente
            // da nominare: il campo valeva `Some("")`, cioè un titolo che
            // nessun outline contiene. Da lì uscivano un `data-…-heading=""`
            // scritto sul segnaposto della transclusion e — peggio — un
            // bersaglio che [`LinkTarget::wiki_inner`] non sa riscrivere
            // uguale, perché la forma canonica di quel campo assente è
            // l'assenza.
            heading: heading.filter(|h| !h.is_empty()),
            block,
        },
        alias: alias.filter(|a| !a.is_empty()),
    }
}

impl LinkTarget {
    /// L'interno di questo wikilink, cioè ciò che va fra `[[` e `]]`.
    ///
    /// È il verso opposto di [`parse_wikilink_inner`], e sta **qui accanto** per
    /// la ragione per cui [`HeadingSlugs`] sta accanto a [`heading_matches`]:
    /// chi scrive la forma testuale di un bersaglio e chi la rilegge sono la
    /// stessa regola in due versi, e finché erano due divergevano. Divergevano
    /// davvero: il serializer markdown scriveva `[[page^b]]` per un riferimento
    /// a blocco senza heading, e in Obsidian quello non è un riferimento a
    /// blocco — è una pagina che si chiama `page^b`. Il `#` non è opzionale
    /// perché l'heading manca; è ciò che rende `^` un `^` di ancora.
    ///
    /// Il giro `wiki_inner` → `parse_wikilink_inner` è **l'identità**, ed è la
    /// forma in cui la coppia resta onesta: un lettore indulgente e uno
    /// scrittore che si accontenta della propria indulgenza sono d'accordo fra
    /// loro e in disaccordo con tutti gli altri.
    ///
    /// `None` per gli altri due bersagli: un URL e un path si scrivono con
    /// un'altra sintassi, e quale non lo decide il contratto.
    pub fn wiki_inner(&self) -> Option<String> {
        let LinkTarget::Wiki {
            page,
            heading,
            block,
        } = self
        else {
            return None;
        };
        let mut out = String::with_capacity(page.len() + 16);
        out.push_str(page);
        if let Some(h) = heading {
            out.push('#');
            out.push_str(h);
        }
        if let Some(b) = block {
            if heading.is_none() {
                out.push('#');
            }
            out.push('^');
            out.push_str(b);
        }
        Some(out)
    }
}

/// Un link estratto, piatto, con lo span nella sorgente e un po' di contesto
/// per l'anteprima nei backlink.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Link {
    pub target: LinkTarget,
    /// Il riferimento **incorpora** il bersaglio (`![[Nota]]`, `![alt](a.png)`)
    /// invece di puntarlo.
    ///
    /// Sta qui e non dentro [`LinkTarget::Wiki`] perché incorporare è un fatto
    /// del *riferimento*: la stessa nota, lo stesso allegato, si possono
    /// linkare e incorporare nella stessa pagina. Finché il flag era dentro la
    /// variante wiki, `![](immagine.png)` non aveva modo di dirlo — e infatti
    /// un'immagine markdown non entrava affatto in `links`, con la conseguenza
    /// che nessun riferimento ad allegato veniva aggiornato al rename (13.1).
    pub embed: bool,
    pub span: Span,
    pub context: Option<String>,
}

/// Un heading estratto (per outline e link a heading).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    /// La chiave con cui si risolve `[[Nota#Titolo]]` e con cui si nomina
    /// l'heading nell'outline. Quando l'utente ha scritto un id esplicito in
    /// coda al titolo (`## Titolo ^Mio-ID`), **è la forma canonica di quell'id**
    /// ([`canonical_anchor`]) — la generazione è bypassata, e la chiave è la
    /// stessa con cui la tabella piatta `anchors` risolve `[[Nota#^mio-id]]`;
    /// altrimenti è lo slug generato dal testo ([`heading_slug`], con
    /// [`HeadingSlugs`] a separare gli omonimi).
    pub slug: String,
    pub span: Span,
    /// L'id **esplicito** che l'utente ha scritto in coda al titolo
    /// (`## Titolo ^Mio-ID`), **com'è scritto**: la maiuscola e i trattini non
    /// si normalizzano, perché è ciò che `serialize` deve riscrivere sul file.
    /// `None` quando l'heading non ne porta uno — e allora `slug` è generato,
    /// come sempre.
    ///
    /// Sta **in fondo** al record perché la posizione dei campi è ABI
    /// (`wit_additivity`): ciò che c'era non si muove.
    pub explicit_anchor: Option<String>,
}

/// Un tag `#foo` o `#foo/bar` estratto.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub span: Span,
}

/// Un'ancora di blocco esplicita (`^abc123`) estratta.
///
/// Porta **due** span perché servono a due mestieri diversi, e derivarne uno
/// dall'altro vorrebbe dire ricercare nella sorgente: `span` è il blocco intero
/// (è ciò che un embed di blocco ritaglia), `marker` è il solo token `^abc123`
/// (è ciò che si toglie esportando, o si riscrive rinominando l'id).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anchor {
    /// L'id **canonico** ([`canonical_anchor`]), che è la chiave con cui si
    /// risolve. La forma scritta dall'utente resta nella sorgente, dentro
    /// `marker`.
    pub id: String,
    pub span: Span,
    pub marker: Span,
}

/// La forma **canonica** di un nome di tag: spazi esterni via, NFC
/// ([`composed`]), minuscolo (Unicode). Stile Obsidian: `#Rust` e `#rust` sono
/// lo stesso tag, case-insensitive come chiave e case-preserving per il
/// display.
///
/// È LA chiave con cui i tag si contano (aggregazione del kernel), si
/// indicizzano e si interrogano (campo tag della ricerca): la regola vive nel
/// contratto perché kernel e feature non si vedono tra loro, e due copie
/// divergerebbero al primo ritocco — il nome del tag sta diventando chiave di
/// pannelli, grafo e query salvate.
///
/// La NFC non è un ornamento: `#caffè` digitato e `#caffè` copiato da una nota
/// scritta su macOS sono byte diversi, e senza [`composed`] il pannello dei tag
/// ne conterebbe due con lo stesso nome sullo schermo.
pub fn canonical_tag(name: &str) -> String {
    composed(name.trim()).to_lowercase()
}

/// La forma **canonica** di un id di blocco: spazi esterni via, NFC
/// ([`composed`]), minuscolo.
///
/// Sta accanto a [`canonical_tag`] e per la stessa ragione: è LA chiave con cui
/// un `[[Nota#^Blocco]]` trova il suo blocco, e chi scrive l'ancora e chi la
/// cerca sono due pezzi di codice che non si vedono fra loro. Un'ancora è
/// case-insensitive come il resto della risoluzione (§ "Case dei path" in
/// `docs/architecture/data-model.md`).
pub fn canonical_anchor(id: &str) -> String {
    composed(id.trim()).to_lowercase()
}

/// Un id di blocco è **valido**? Lettere, cifre, `-` e `_`, almeno uno.
///
/// È la regola di Obsidian, e sta nel contratto perché è ciò che distingue
/// un'ancora da un accento circonflesso qualsiasi: senza, `2^10 = 1024` in
/// fondo a un paragrafo diventerebbe un'ancora chiamata `10`.
pub fn valid_anchor(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
}

/// L'ancora di un heading, **generata** dal suo testo: minuscolo, spazi → `-`,
/// via la punteggiatura.
///
/// È la gemella di [`canonical_anchor`] per l'altra sintassi (`[[Nota#Titolo]]`)
/// e sta nel contratto per la stessa ragione per cui ci sta quella: era una
/// funzione privata del provider markdown, quindi due provider potevano dare
/// due id diversi allo stesso titolo e il link dell'uno non risolveva sull'altro.
///
/// Il testo si compone ([`composed`]) **prima** di filtrare, e qui la NFC non
/// spostava soltanto la risposta: un accento combinante è una `Mn`, non è
/// alfanumerico, e senza comporlo `# Café` scritto su macOS dava `cafe` — cioè
/// l'accento **sparito** invece che diverso.
pub fn heading_slug(text: &str) -> String {
    let text = composed(text);
    let mut slug = String::with_capacity(text.len());
    let mut last_dash = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            slug.extend(c.to_lowercase());
            last_dash = false;
        } else if (c.is_whitespace() || c == '-' || c == '_') && !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
        // ogni altra punteggiatura viene ignorata
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    slug
}

/// L'assegnatario degli slug di **un** documento: [`heading_slug`] dice come si
/// scrive un titolo, questo dice chi se lo prende quando i titoli omonimi sono
/// due.
///
/// # Perché non basta la funzione
///
/// Uno slug è un `id` nell'HTML e la chiave di `[[Nota#Titolo]]`, e una nota
/// con due `## Note` ne produceva **due uguali**: `getElementById` e
/// `outline.iter().find(…)` restituiscono il primo, quindi il link alla seconda
/// sezione atterrava sulla prima senza che niente lo dicesse — non un errore,
/// una destinazione sbagliata. La regola pura non può ripararlo perché la
/// domanda «è già preso?» non è una domanda sul testo di un titolo: è una
/// domanda sul documento, e la risposta è **stato**. Qui c'è l'unico posto in
/// cui quello stato esiste, così non può essercene una seconda copia che
/// diverge: chi parsa lo tiene per la durata di un documento, chi verifica lo
/// ricostruisce dai testi con [`heading_slugs`], e i due ottengono la stessa
/// lista o il presidio è rosso.
///
/// # La regola
///
/// Il **primo** che chiede una forma la ottiene esattamente com'era
/// (`heading_slug`), e questo non è un dettaglio: un documento senza titoli
/// omonimi ha gli stessi slug di prima, quindi nessun link già scritto
/// dall'utente cambia destinazione. Dal secondo in poi si numera in coda —
/// `note`, `note-1`, `note-2` — che è la consuetudine di GitHub, quella che chi
/// scrive markdown ha già in mano, ed è **raggiungibile scrivendola**:
/// `[[Nota#Note 1]]` passa da `heading_slug` e dà `note-1`.
///
/// Il numero non è un contatore per testo ma la prima forma **libera**: se il
/// documento contiene davvero un `## Note 1` fra i due `## Note`, il terzo
/// diventa `note-2` invece di rubargli l'id. Un contatore per testo avrebbe
/// prodotto due `note-1`, cioè il difetto di partenza spostato di una riga.
#[derive(Debug, Default, Clone)]
pub struct HeadingSlugs {
    taken: std::collections::BTreeSet<String>,
}

impl HeadingSlugs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Lo slug del prossimo heading, in ordine di lettura del documento.
    pub fn next_slug(&mut self, text: &str) -> String {
        let base = heading_slug(text);
        if self.taken.insert(base.clone()) {
            return base;
        }
        for n in 1u32.. {
            // Un titolo di sola punteggiatura dà base vuota (il contratto la
            // conosce: `valid_anchor` la rifiuterebbe). Attaccarci un trattino
            // darebbe `-1`; il numero da solo resta una forma che `heading_slug`
            // sa produrre, quindi resta scrivibile in un link.
            let candidate = if base.is_empty() {
                n.to_string()
            } else {
                format!("{base}-{n}")
            };
            if self.taken.insert(candidate.clone()) {
                return candidate;
            }
        }
        unreachable!("a document does not have 4 billion duplicate titles")
    }
}

/// Il `#Sezione` di un `[[Nota#Sezione]]` (o di un `![[Nota#Sezione]]`) nomina
/// **questo** heading?
///
/// È la metà che legge di [`HeadingSlugs`], e sta qui accanto per la ragione
/// per cui la 0121 aveva messo le due metà di un prefisso in una funzione sola:
/// chi genera un id e chi lo cerca non possono essere due regole, o la
/// disambiguazione diventa il difetto nuovo — id diversi che nessuna query sa
/// più distinguere. Erano già due, e diverse: il canale dati confrontava
/// `heading_slug` con lo slug, l'embed confrontava la chiave di risoluzione con
/// lo slug **o** col testo. Entrambe trovavano il titolo giusto finché era uno;
/// nessuna delle due sapeva nominare il secondo.
///
/// Le due strade restano, perché rispondono a due modi di scrivere: chi scrive
/// `#Note 1` nomina lo slug (ed è così che si raggiunge un omonimo), chi scrive
/// `#Ciao, Mondo!` nomina il titolo com'è, punteggiatura compresa. La prima
/// vince sulla seconda perché è quella che sa distinguere gli omonimi.
pub fn heading_matches(query: &str, heading: &Heading) -> bool {
    heading_slug(query) == heading.slug
        || crate::rules::path::resolution_key(query)
            == crate::rules::path::resolution_key(&heading.text)
}

/// Gli slug di un outline, dai suoi testi in ordine di lettura.
///
/// È [`HeadingSlugs`] in una riga, per chi ha già tutti i titoli in mano —
/// tipicamente chi **verifica** che un provider abbia applicato la regola
/// invece di riscriverla.
pub fn heading_slugs<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut slugs = HeadingSlugs::new();
    texts.into_iter().map(|t| slugs.next_slug(t)).collect()
}

/// Il registro dei `custom_kind` noti — la metà "decisa" della decisione 0003 sulle
/// varianti mancanti.
///
/// `custom_kind` è una stringa, e una stringa senza registro è un accordo
/// implicito: due provider emettono `attrs` diversi per lo stesso kind e
/// l'agnosticità del modello diventa una convinzione. Qui stanno i kind che
/// **più di un pezzo del sistema** interpreta (parser, renderer, export), con
/// la forma dei loro `attrs`; l'elenco esteso, con la tabella degli `attrs`, è
/// in `docs/architecture/data-model.md`.
///
/// Un kind sconosciuto non è un errore: degrada a resa generica. Questo elenco
/// non chiude l'insieme — dichiara quali significati sono **condivisi**.
pub mod custom_kind {
    /// Callout Obsidian / alert GitHub. `attrs: { type: string, title: string? }`.
    pub const CALLOUT: &str = "callout";
    /// Blocco math. `attrs: { source: string, display: bool }`.
    pub const MATH: &str = "math";
    /// HTML grezzo incontrato nella sorgente. `attrs: { html: string }`.
    pub const HTML: &str = "html";
    /// La definizione di una nota a piè di pagina; il corpo sta in `blocks`.
    /// `attrs: { label: string }`.
    pub const FOOTNOTE_DEFINITION: &str = "footnote-definition";
    /// Il richiamo nel testo (inline). `attrs: { label: string }`.
    pub const FOOTNOTE_REFERENCE: &str = "footnote-reference";
    /// Un diagramma a blocco recintato: mermaid, PlantUML, Graphviz, D2.
    /// `attrs: { engine: string, source: string }`. Il core lo **delimita** e
    /// non lo disegna: chi lo disegna è un renderer registrato (§3.2), e il
    /// motore sta negli `attrs` perché il kind è la famiglia, non il dialetto.
    pub const DIAGRAM: &str = "diagram";
    /// `==evidenziato==` (inline). `attrs: { text: string }`.
    pub const HIGHLIGHT: &str = "highlight";
    /// Definition list: i figli sono `DEFINITION_TERM` e `DEFINITION_DESCRIPTION`
    /// alternati, nell'ordine della sorgente.
    pub const DEFINITION_LIST: &str = "definition-list";
    pub const DEFINITION_TERM: &str = "definition-term";
    pub const DEFINITION_DESCRIPTION: &str = "definition-description";
    /// L'ultima spiaggia: un blocco che il provider non sa nominare ma di cui
    /// ha ricostruito i figli.
    pub const BLOCK: &str = "block";
    /// Un frontmatter che il provider **non è riuscito a proiettare su JSON**:
    /// YAML rotto, chiavi duplicate, o un documento che non è una mappa.
    /// `attrs: { text: string, error: string }`, dove `text` è il blocco
    /// **verbatim** — delimitatori compresi — così com'era sul disco.
    ///
    /// Esiste perché senza di lui quel testo spariva due volte: dal modello,
    /// che ricadeva su un frontmatter vuoto, e poi dal file, alla prima
    /// riscrittura che passa dal modello. Un frontmatter illeggibile è
    /// *contenuto dell'utente*, e chi non l'ha capito non è autorizzato a
    /// cancellarlo: lo conserva così com'è, e dice perché in `error`.
    pub const FRONTMATTER_UNPARSED: &str = "frontmatter-unparsed";

    /// **Dove un `Custom` tiene il proprio contenuto**, cioè i byte che
    /// l'utente ha scritto.
    ///
    /// È la domanda che chi rende e chi serializza si facevano ognuno per
    /// conto proprio, e in due modi diversi: `render.rs` provava tre chiavi a
    /// campione (`html`, `source`, `text`) e chiamava vuoto ciò che non
    /// trovava; `serialize.rs` teneva una catena di `if` sui kind, che è lo
    /// stesso elenco scritto come flusso di controllo — non interrogabile da
    /// nessuno, e da riscrivere per intero al secondo `FormatProvider`.
    ///
    /// Le prose degli `attrs` qui sopra dicevano già tutto: sono state fatte
    /// dato. Ciò che si eredita è la parte **indipendente dal formato** —
    /// *questi byte sono già sorgente*, *questo contenuto sta nei figli*,
    /// *questo è il corpo di una sintassi che il formato deve saper
    /// riscrivere*. Ciò che resta di ogni formato è la sua grammatica: `>
    /// [!nota]` è di markdown, e in markdown resta.
    #[derive(Copy, Clone, Debug, PartialEq, Eq)]
    pub enum Payload {
        /// Nei **figli**. `blocks` è tutto il contenuto; gli `attrs`, se ci
        /// sono, sono parametri — il tipo di un callout, l'etichetta di una
        /// nota — e non testo dell'utente.
        Children,
        /// **Sorgente**, sotto questa chiave degli `attrs`: i byte sono già il
        /// testo che stava nel file, delimitatori compresi. Riscriverli è
        /// copiarli, e ogni formato che sappia ospitare del testo grezzo li sa
        /// esprimere.
        Source(&'static str),
        /// Il **corpo** di una sintassi, sotto questa chiave: byte dell'utente
        /// senza il delimitatore che li racchiudeva. Chi rende li mostra —
        /// meglio del nulla che si vedeva prima —, ma chi serializza li può
        /// riscrivere **solo se conosce quella sintassi**: il recinto
        /// ```` ```math ```` che li ha prodotti è un'informazione della regola,
        /// e la regola può averlo trasformato. Ricostruirlo a indovinare
        /// sarebbe inventare la sorgente dell'utente.
        Body(&'static str),
    }

    /// I kind del core con ciò che ognuno porta, **tutti e soli**.
    ///
    /// Che sia una tabella e non un `match` è deliberato: un `match` sulle
    /// stringhe non si può contare, e il presidio
    /// `every_kind_declares_what_carries` conta proprio le due metà — un `const`
    /// nuovo senza una riga qui è rosso, e una riga qui che non nomina nessun
    /// `const` pure.
    pub const PAYLOADS: &[(&str, Payload)] = &[
        (CALLOUT, Payload::Children),
        (MATH, Payload::Body("source")),
        (HTML, Payload::Source("html")),
        (FOOTNOTE_DEFINITION, Payload::Children),
        (FOOTNOTE_REFERENCE, Payload::Body("label")),
        (DIAGRAM, Payload::Body("source")),
        (HIGHLIGHT, Payload::Body("text")),
        (DEFINITION_LIST, Payload::Children),
        (DEFINITION_TERM, Payload::Children),
        (DEFINITION_DESCRIPTION, Payload::Children),
        (BLOCK, Payload::Children),
        (FRONTMATTER_UNPARSED, Payload::Source("text")),
    ];

    /// Cosa porta un `custom_kind`, o `None` se il contratto non lo declare.
    ///
    /// **`None` non vuol dire «niente»: vuol dire «nessuno l'ha detto».** Un
    /// kind di terzi non è in [`PAYLOADS`] per costruzione — l'elenco è del
    /// core, e questo modulo declare i significati *condivisi*, non tutti
    /// quelli possibili. Chi rende un kind non dichiarato degrada come sa; chi
    /// serializza si rifiuta, che è l'unica risposta che non inventa byte.
    ///
    /// **Il limite, dichiarato**: oggi un terzo *non ha modo* di dire dove
    /// tiene i propri byte — `SyntaxRuleSpec::produces` elenca i nomi dei kind
    /// e nient'altro. Aggiungerglielo cambia il contratto, che è additivo e
    /// vicino al freeze, e le forme possibili sono più d'una: è una scelta, e
    /// finché non è presa questa funzione risponde `None` e lo dice.
    pub fn payload(kind: &str) -> Option<Payload> {
        PAYLOADS.iter().find(|(k, _)| *k == kind).map(|(_, c)| *c)
    }

    impl Payload {
        /// La chiave degli `attrs` sotto cui stanno i byte, se ci stanno.
        pub fn key(self) -> Option<&'static str> {
            match self {
                Payload::Children => None,
                Payload::Source(k) | Payload::Body(k) => Some(k),
            }
        }
    }
}

/// I *nomi* dei kind si usano qualificati — `custom_kind::MATH` dice di chi è
/// quella stringa —, ma [`custom_kind::Payload`] è un **tipo**, e compare nella
/// firma di [`custom_kind::payload`]: chi la legge deve poterlo nominare senza
/// sapere in che modulo è stato scritto (`superficie_della_radice.rs`).
/// Il valore di una proprietà del frontmatter, **normalizzato**.
pub use custom_kind::Payload;

///
/// Il frontmatter grezzo è JSON piatto, e va benissimo per attraversare il
/// confine; non va bene come *risposta* alla domanda che tutti gli consumatori
/// fanno. 8.2 chiede proprietà tipizzate (data, rating, relazione, formula),
/// 10.2 chiede scadenze, 10.4 un calendario: senza una forma normalizzata nel
/// contratto, ognuno di loro reinventa il parsing delle date — e due plugin
/// danno due risposte diverse sullo stesso file.
///
/// Cosa **non** fa: non indovina. Un URL scritto in una proprietà resta
/// [`PropertyValue::Text`], perché distinguerlo da una stringa che *sembra* un
/// URL è una scelta di prodotto (8.2 ha "proprietà URL" *e* "proprietà testo")
/// e `Text` non perde niente. La sola stringa che cambia specie è il wikilink,
/// `[[Nota]]`, perché quella è la relazione di 8.2 ed è l'unica forma che nel
/// vocabolario di questo modello ha già un significato non ambiguo.
/// **Perché l'elenco porta uno `PropertyScalar` e non un `PropertyValue`**: il
/// confine non ammette tipi ricorsivi (è la stessa ragione per cui gli alberi
/// del documento ci attraversano come arena, vedi [`crate::arena`]), e per una
/// lista di proprietà l'arena sarebbe una macchina sproporzionata al problema.
/// La lista di liste — che nel frontmatter di una nota non si scrive — cade in
/// [`PropertyScalar::Unknown`], che è JSON e quindi non perde niente.
// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
    /// `chiave:` senza valore (YAML `null`). Diverso da chiave assente.
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PropertyValue {
    /// Data ISO-8601, con o senza orario.
    Empty,
    Text(String),
    Number(f64),
    Bool(bool),
    /// Una relazione: `autore: "[[Mario Rossi]]"`.
    Date(PropertyDate),
    /// Ciò che non si normalizza (oggetti annidati): il JSON com'è. L'escape
    Link(LinkTarget),
    List(Vec<PropertyScalar>),
    /// hatch delle proprietà, gemello di `Block::Custom`.
/// Il valore di una **voce di elenco**: [`PropertyValue`] meno la lista.
    Unknown(serde_json::Value),
}

// Tag adiacente: alcune varianti portano uno scalare, e col tag interno
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// `serde_json` fallirebbe a serializzarle (vedi il § in testa al modulo).
/// Una data ISO-8601, già scomposta.
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum PropertyScalar {
    Empty,
    Text(String),
    Number(f64),
    Bool(bool),
    Date(PropertyDate),
    Link(LinkTarget),
    Unknown(serde_json::Value),
}

///
/// Scomposta e non stringa perché il primo cliente (10.4, calendario e agenda)
/// deve raggruppare per giorno e per mese, e una stringa lo costringerebbe a
/// riparsare — che è esattamente ciò che questa voce esiste per evitare. Il
/// contratto non dipende da `chrono`: qui non si fa aritmetica sulle date, si
/// declare *cosa c'era scritto*.
/// L'ordine dei campi in una data che **non** è ISO-8601: ciò che un vault può
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub time: Option<PropertyTime>,
}

/// dichiarare di sé.
///
/// Tre ordini e non un formato con dei segnaposto (`%d/%m/%Y`) perché il
/// separatore non è mai stato l'ambiguità: `05/07/2026` e `05-07-2026` sono la
/// stessa scrittura, mentre `05/07/2026` e `07/05/2026` sono la **stessa
/// stringa** letta da due parti del mondo come due giorni diversi. È
/// esattamente questo che nessun parser può dedurre e che solo chi possiede il
/// vault può dire.
///
/// Serializzabile e in `snake_case` non per attraversare il contratto — non lo
/// cross — ma perché la parola con cui il vault lo declare *è* il suo
/// nome in minuscolo, e le due forme devono restare la stessa: che
/// [`as_key`](DateOrder::as_key) e serde dicano `dmy` tutte e due lo prova
/// `the_word_of_the_setting_is_the_word_of_the_wire`.
    /// `05/07/2026`, `5-7-2026`: giorno, mese, anno.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DateOrder {
    /// `07/05/2026`: mese, giorno, anno.
    Dmy,
    /// `2026/07/05`, `2026-7-5`: anno, mese, giorno.
    Mdy,
    /// Tutti gli ordini, in ordine di dichiarazione.
    Ymd,
}

impl DateOrder {
    /// La parola con cui il vault lo declare.
    pub const ALL: [DateOrder; 3] = [DateOrder::Dmy, DateOrder::Mdy, DateOrder::Ymd];

    ///
    /// Sta qui e non accanto all'impostazione che la scrive: la stringa che
    /// l'utente sceglie e l'ordine che il parser applica sono **una tabella
    /// sola**, e due copie sarebbero due tendine che promettono cose diverse.
    /// L'ordine che quella parola nomina, o `None` se non ne nomina nessuno.
    pub fn as_key(self) -> &'static str {
        match self {
            DateOrder::Dmy => "dmy",
            DateOrder::Mdy => "mdy",
            DateOrder::Ymd => "ymd",
        }
    }

    /// Legge `s` in quest'ordine, o `None`.
    pub fn from_key(s: &str) -> Option<DateOrder> {
        DateOrder::ALL.into_iter().find(|or| or.as_key() == s)
    }

    ///
    /// Rigido quanto [`parse_iso_date`], su un insieme diverso: tre campi
    /// numerici separati dallo **stesso** segno fra `/`, `-` e `.`, l'anno a
    /// quattro cifre, mese e giorno a una o due. Le due cifre dell'anno non si
    /// accettano — `05/07/26` chiederebbe di indovinare il secolo, e indovinare
    /// è la cosa che la 0003 ha rifiutato.
/// I formati di data che **questo vault declare**, oltre all'ISO-8601.
    fn read(self, s: &str) -> Option<PropertyDate> {
        let sep = s.chars().find(|c| matches!(c, '/' | '-' | '.'))?;
        let mut parts = s.split(sep);
        let (a, b, c) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        let (year, month, day) = match self {
            DateOrder::Dmy => (c, b, a),
            DateOrder::Mdy => (c, a, b),
            DateOrder::Ymd => (a, b, c),
        };
        if year.len() != 4 {
            return None;
        }
        let year = i32::try_from(digits(year, 4)?).ok()?;
        let month = u8::try_from(digits(month, 2)?).ok()?;
        let day = u8::try_from(digits(day, 2)?).ok()?;
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
            return None;
        }
        Some(PropertyDate {
            year,
            month,
            day,
            time: None,
        })
    }
}

///
/// La [decisione 0003](../../../docs/decisions/0003-modello-del-documento.md)
/// ha rifiutato il parser tollerante con l'argomento giusto — *un parser
/// tollerante trasformerebbe in date le stringhe dell'utente* — e quell'argomento
/// resta intero. Ciò che cambia non è la **tolleranza**: è **chi declare il
/// formato**. Un formato dichiarato non è un indovinello, ed è la differenza
/// esatta fra questo tipo e la cosa che la 0003 ha rifiutato.
///
/// Il default è [`DateFormats::ISO`], cioè nessuna dichiarazione e la regola di
/// prima parola per parola: un vault che non dice niente si legge oggi come si
/// leggeva ieri.
    /// Nessuna dichiarazione: **solo** l'ISO-8601.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq)]
pub struct DateFormats {
    declared: Option<DateOrder>,
}

impl DateFormats {
    /// I formati di un vault che ne declare uno.
    pub const ISO: DateFormats = DateFormats { declared: None };

    /// L'ordine dichiarato, se c'è.
    pub fn declaring(order: DateOrder) -> DateFormats {
        DateFormats {
            declared: Some(order),
        }
    }

    /// Legge `s` coi soli formati dichiarati. Senza dichiarazione non legge
    pub fn declared(&self) -> Option<DateOrder> {
        self.declared
    }

    /// niente, ed è il punto.
    /// `s` **sembra** una data a qualcuno?
    fn read(&self, s: &str) -> Option<PropertyDate> {
        self.declared.and_then(|or| or.read(s))
    }

    ///
    /// È il rilevatore del controllo di salute, e non è una seconda regola: è
    /// lo **stesso** parser con tutti gli ordini insieme. Ciò che due
    /// dichiarazioni diverse leggerebbero in due modi è esattamente ciò su cui
    /// vale la pena chiedere all'utente — e siccome la risposta è una domanda e
    /// non un valore, qui la larghezza è legittima dove nel parser non lo era.
/// L'orario di una [`PropertyDate`], col fuso **come era scritto**.
    pub fn looks_like_a_date(s: &str) -> bool {
        let t = s.trim();
        DateOrder::ALL.iter().any(|or| or.read(t).is_some())
    }
}

///
/// `offset_minutes` è `None` per un orario locale-senza-fuso: convertirlo
/// richiederebbe sapere il fuso dell'utente, che è una capacità dell'host
/// (decisione 0013) e non un fatto del documento. Il modello non indovina.
    /// Minuti rispetto a UTC (`Z` → `0`, `+02:00` → `120`).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyTime {
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    /// Normalizza un valore JSON del frontmatter, coi formati di data che il
    pub offset_minutes: Option<i16>,
}

impl PropertyValue {
    /// vault declare ([`DateFormats`]).
    /// Normalizza un valore JSON che **non** può essere una lista: una lista
    pub fn normalize(v: &serde_json::Value, formats: &DateFormats) -> PropertyValue {
        match v {
            serde_json::Value::Array(a) => PropertyValue::List(
                a.iter()
                    .map(|v| PropertyScalar::normalize(v, formats))
                    .collect(),
            ),
            scalar => PropertyScalar::normalize(scalar, formats).into(),
        }
    }
}

impl PropertyScalar {
    /// annidata resta JSON.
                // Un intero più grande di quanto un f64 rappresenti senza
    pub fn normalize(v: &serde_json::Value, formats: &DateFormats) -> PropertyScalar {
        match v {
            serde_json::Value::Null => PropertyScalar::Empty,
            serde_json::Value::Bool(b) => PropertyScalar::Bool(*b),
            serde_json::Value::Number(n) => match n.as_f64() {
                Some(f) => PropertyScalar::Number(f),
                // perdite non è un numero da fare i conti: è un'identità.
                // La normalizzazione di una stringa: wikilink, poi data ISO, poi il
                None => PropertyScalar::Text(n.to_string()),
            },
            serde_json::Value::String(s) => PropertyScalar::from_text(s, formats),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                PropertyScalar::Unknown(v.clone())
            }
        }
    }

    /// formato che il vault **declare**, poi testo.
    ///
    /// L'ordine non è un dettaglio: l'ISO-8601 si legge sempre e per primo,
    /// quindi una dichiarazione non può cambiare come si legge una data già
    /// scritta bene. Ciò che una dichiarazione fa è **aggiungere** una lettura
    /// a stringhe che oggi restano [`PropertyScalar::Text`].
/// `2026-07-25`, `2026-07-25T10:30`, `2026-07-25 10:30:00Z`, `…+02:00`.
    fn from_text(s: &str, formats: &DateFormats) -> PropertyScalar {
        let t = s.trim();
        if let Some(inner) = t.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) {
            return PropertyScalar::Link(parse_wikilink_inner(inner).target);
        }
        if let Some(d) = parse_iso_date(t).or_else(|| formats.read(t)) {
            return PropertyScalar::Date(d);
        }
        PropertyScalar::Text(s.to_string())
    }
}

impl From<PropertyScalar> for PropertyValue {
    fn from(s: PropertyScalar) -> Self {
        match s {
            PropertyScalar::Empty => PropertyValue::Empty,
            PropertyScalar::Text(t) => PropertyValue::Text(t),
            PropertyScalar::Number(n) => PropertyValue::Number(n),
            PropertyScalar::Bool(b) => PropertyValue::Bool(b),
            PropertyScalar::Date(d) => PropertyValue::Date(d),
            PropertyScalar::Link(the) => PropertyValue::Link(the),
            PropertyScalar::Unknown(v) => PropertyValue::Unknown(v),
        }
    }
}

///
/// Rigido di proposito: solo l'ISO-8601 nella forma che YAML e Obsidian
/// producono. Un parser tollerante qui direbbe di sì a `1-2-3` e trasformerebbe
/// in date delle stringhe che l'utente non intendeva tali.
        // Il `-` del fuso si distingue dal nulla solo per posizione: prima ci
fn parse_iso_date(s: &str) -> Option<PropertyDate> {
    let (date, rest) = s.split_at_checked(10)?;
    let mut parts = date.split('-');
    let year: i32 = parts.next()?.parse().ok()?;
    let month: u8 = fixed_width(parts.next()?, 2)?;
    let day: u8 = fixed_width(parts.next()?, 2)?;
    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let time = match rest {
        "" => None,
        _ => Some(parse_iso_time(rest.strip_prefix(['T', 't', ' '])?)?),
    };
    Some(PropertyDate {
        year,
        month,
        day,
        time,
    })
}

fn parse_iso_time(s: &str) -> Option<PropertyTime> {
    let (hms, zone) = match s.find(['Z', 'z', '+']) {
        Some(the) => s.split_at(the),
        // sono almeno `hh:mm`.
        // I secondi frazionari si troncano: il modello declare cosa c'era
        None => match s.get(5..).and_then(|rest| rest.find('-')) {
            Some(the) => s.split_at(the + 5),
            None => (s, ""),
        },
    };
    let mut parts = hms.split(':');
    let hour: u8 = fixed_width(parts.next()?, 2)?;
    let minute: u8 = fixed_width(parts.next()?, 2)?;
    let second: u8 = match parts.next() {
        // scritto, non pretende di essere un istante.
        // Un campo numerico a larghezza fissa (`07`), che è ciò che distingue una data
        Some(sec) => fixed_width(sec.split('.').next()?, 2)?,
        None => 0,
    };
    if parts.next().is_some() || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let offset_minutes = match zone {
        "" => None,
        "Z" | "z" => Some(0),
        z => {
            let sign: i16 = if z.starts_with('-') { -1 } else { 1 };
            let (h, m) = z[1..].split_once(':').unwrap_or((&z[1..], "0"));
            let h: i16 = h.parse().ok()?;
            let m: i16 = m.parse().ok()?;
            if h > 23 || m > 59 {
                return None;
            }
            Some(sign * (h * 60 + m))
        }
    };
    Some(PropertyTime {
        hour,
        minute,
        second,
        offset_minutes,
    })
}

/// ISO da un'espressione: `2026-7-5` non è una data ISO.
/// Un campo numerico di una data **dichiarata**: da una a `max` cifre ASCII.
fn fixed_width(s: &str, width: usize) -> Option<u8> {
    if s.len() != width || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

///
/// Il gemello largo di [`fixed_width`], e la larghezza è il punto: `2026-7-5`
/// non è una data ISO e resta tale, ma un vault che declare `ymd` sta dicendo
/// che quella è la sua scrittura del cinque luglio.
    /// I `const` dichiarati dentro `pub mod custom_kind`, letti dal sorgente.
fn digits(s: &str, max: usize) -> Option<u32> {
    if s.is_empty() || s.len() > max || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    ///
    /// Il salto della prosa è la metà che conta: questo modulo *racconta* i
    /// kind nei doc comment, e un estrattore che contasse anche quelli
    /// presidierebbe se stesso. Si prendono le sole righe che **sono** una
    /// dichiarazione — `pub const NOME: &str = "…";` — e solo dentro il
    /// modulo, che comincia alla riga che lo apre.
            // Un `pub const` di **un altro tipo** non è un kind: `PAYLOADS` è la
    fn kind_declared() -> Vec<(String, String)> {
        let src = include_str!("model.rs");
        let within = src
            .split_once("pub mod custom_kind {")
            .expect("the `custom_kind` module is not found in source")
            .1;
        let mut out = Vec::new();
        for row in within.lines() {
            let row = row.trim();
            let Some(rest) = row.strip_prefix("pub const ") else {
                continue;
            };
            // tabella che risponde su di loro, e sta nello stesso modulo. Il
            // salto guarda il tipo scritto, non il nome, così un kind non può
            // sfuggire al conto chiamandosi in un modo invece che in un altro;
            // e se un giorno l'estrattore smettesse di riconoscere la forma,
            // il conto `>= 12` qui sotto è il rosso che se ne accorge.
    // **Ogni `custom_kind` del core declare cosa porta, e viceversa.**
            let Some((name, value)) = rest.split_once(": &str = ") else {
                continue;
            };
            let value = value
                .trim_end_matches(';')
                .trim_matches('"')
                .trim_matches('\\');
            out.push((name.to_string(), value.to_string()));
        }
        out
    }

    ///
    /// È il presidio del difetto 0095: *dove* stiano i byte di un `Custom` era
    /// scritto in tre posti che nessuno teneva allineati — la prosa qui sopra,
    /// tre stringhe a campione in `render.rs`, una catena di `if` in
    /// `serialize.rs`. Adesso il posto è [`custom_kind::PAYLOADS`], e questo
    /// conto è ciò che impedisce al quarto kind di nascere senza una risposta:
    /// il compilatore un `const` in più non lo vede, e chi lo aggiunge non ha
    /// nessuna ragione di aprire `render.rs`.
    ///
    /// Il conto è nei **due versi** apposta, come l'allowlist di
    /// `dependency_invariant.rs`: una riga di `PAYLOADS` che non nomina nessun
    /// `const` è un kind rinominato di cui è rimasta l'ombra, e sarebbe una
    /// tabella che risponde a un nome che non esiste più.
    /// L'estrattore deve leggere ciò che dice di leggere: le dichiarazioni sì,
    #[test]
    fn every_kind_declares_what_carries() {
        let declared = kind_declared();
        assert!(
            declared.len() >= 12,
            "the extractor read {} declarations: too few to be the reader\n\
             this count believes it has",
            declared.len()
        );

        let without_load: Vec<&str> = declared
            .iter()
            .filter(|(_, v)| custom_kind::payload(v).is_none())
            .map(|(n, _)| n.as_str())
            .collect();
        assert!(
            without_load.is_empty(),
            "{without_load:?} are core `custom_kind`s and do not say where they keep\n\
             their bytes. Add them to `custom_kind::PAYLOADS`: `Children` if the\n\
             content is in children, `Source(key)` if `attrs` already carry the\n\
             source, `Body(key)` if they carry the body of a syntax without its\n\
             delimiter. Without that line the kind renders empty and does not\n\
             serialize, and there is nothing red anywhere."
        );

        let values: Vec<&str> = declared.iter().map(|(_, v)| v.as_str()).collect();
        let fantasmi: Vec<&str> = custom_kind::PAYLOADS
            .iter()
            .map(|(k, _)| *k)
            .filter(|k| !values.contains(k))
            .collect();
        assert!(
            fantasmi.is_empty(),
            "{fantasmi:?} are in `PAYLOADS` and are not `const`s of `custom_kind`:\n\
             it is the shadow of a renamed or removed kind. Remove the line, or the\n\
             table answers a name that no longer exists."
        );
    }

    /// la prosa che le nomina no.
        // `PAYLOADS` è un `pub const` dello stesso modulo, ed è la tabella, non
    #[test]
    fn the_extractor_of_the_kind_skips_the_prose() {
        let read = kind_declared();
        assert!(read.iter().any(|(n, v)| n == "HTML" && v == "html"));
        assert!(read
            .iter()
            .any(|(n, v)| n == "FRONTMATTER_UNPARSED" && v == "frontmatter-unparsed"));
        // un kind: l'estrattore lo salta perché il suo tipo non è `&str`.
        // Il doc di `PAYLOADS` nomina `Source`, `Body` e `Children`, e il doc di
        assert!(
            !read.iter().any(|(n, _)| n == "PAYLOADS"),
            "the extractor mistook the table for a kind"
        );
        // `payload` nomina `SyntaxRuleSpec::produces`: nessuno dei quattro è un
        // kind, e nessuno dei quattro deve comparire.
    // La regola che distingue "risorsa del vault" da "mondo esterno", con i
        for name in ["Source", "Body", "Children", "produces"] {
            assert!(
                !read.iter().any(|(n, v)| n == name || v == name),
                "the extractor picked up `{name}` from prose"
            );
        }
    }

    #[test]
    fn docid_page_name_strips_dir_and_ext() {
        assert_eq!(DocId::new("note.md").page_name(), "note");
        assert_eq!(DocId::new("a/b/Nota Lunga.md").page_name(), "Nota Lunga");
        assert_eq!(DocId::new("senza-ext").page_name(), "senza-ext");
    }

    /// casi su cui un `contains("://")` sbagliava: `mailto:` non ha `//`, e un
    /// path di Windows ha i due punti al secondo carattere senza essere un URI.
        // Un heading vuoto non è un heading: `Nota#^blk` ha un `#` che serve al
    #[test]
    fn classify_tells_a_vault_resource_from_the_outside_world() {
        for external in [
            "https://example.invalid/a",
            "http://x",
            "mailto:a@b.it",
            "tel:+39012",
            "obsidian://open?vault=v",
            "//cdn.example.invalid/a.png",
            "data:image/png;base64,AAAA",
        ] {
            assert_eq!(
                LinkTarget::classify(external),
                LinkTarget::Url(external.to_string()),
                "`{external}` is external"
            );
        }
        for internal in [
            "note/other.md",
            "../attachments/photo.png",
            "/from-root.md",
            "note with spaces.md",
            "C:\\photo\\a.png",
            "#fragment-only",
            "a:b",
        ] {
            assert_eq!(
                LinkTarget::classify(internal),
                LinkTarget::Path(internal.to_string()),
                "`{internal}` belongs to the vault"
            );
        }
    }

    #[test]
    fn wikilink_inner_splits_page_heading_block_and_alias() {
        assert_eq!(
            parse_wikilink_inner("Nota#Sezione^blk|Testo"),
            ParsedWikilink {
                target: LinkTarget::Wiki {
                    page: "Nota".into(),
                    heading: Some("Sezione".into()),
                    block: Some("blk".into()),
                },
                alias: Some("Testo".into()),
            }
        );
        assert_eq!(
            parse_wikilink_inner("Nota").target,
            LinkTarget::wiki("Nota")
        );
        // `^`, e `Nota#` non nomina niente.
    // **Il giro fra i due versi della stessa regola.**
        assert_eq!(
            parse_wikilink_inner("Nota#^blk").target,
            LinkTarget::Wiki {
                page: "Nota".into(),
                heading: None,
                block: Some("blk".into()),
            }
        );
        assert_eq!(
            parse_wikilink_inner("Nota#").target,
            LinkTarget::wiki("Nota")
        );
    }

    ///
    /// `wiki_inner` scrive ciò che `parse_wikilink_inner` legge, e la prova che
    /// conta è che il giro sia l'identità: una coppia scrittore/lettore può
    /// restare d'accordo con sé stessa scrivendo un dialetto che nessun altro
    /// legge, ed è esattamente com'era — il serializer markdown scriveva
    /// `page^b`, il lettore lo riaccettava perché è indulgente, e Obsidian ci
    /// leggeva una pagina di nome `page^b`.
            // Il caso che divergeva: blocco **senza** heading.
    #[test]
    fn what_a_wikilink_writes_is_what_a_wikilink_reads() {
        let targets = [
            LinkTarget::wiki("Nota"),
            LinkTarget::Wiki {
                page: "Nota".into(),
                heading: Some("Sezione".into()),
                block: None,
            },
            // I due che nominano il documento che li ospita (`names_host`).
            LinkTarget::Wiki {
                page: "Nota".into(),
                heading: None,
                block: Some("blk".into()),
            },
            LinkTarget::Wiki {
                page: "Nota".into(),
                heading: Some("Sezione".into()),
                block: Some("blk".into()),
            },
        // L'altro verso: ciò che il lettore accetta per indulgenza torna
            LinkTarget::Wiki {
                page: String::new(),
                heading: Some("Sezione".into()),
                block: None,
            },
            LinkTarget::Wiki {
                page: String::new(),
                heading: None,
                block: Some("blk".into()),
            },
        ];
        for t in &targets {
            let inner = t.wiki_inner().expect("a Wiki has an interior");
            assert_eq!(
                &parse_wikilink_inner(&inner).target,
                t,
                "`{inner}` does not re-read as the target that wrote it"
            );
        }
        assert_eq!(
            LinkTarget::Wiki {
                page: "Nota".into(),
                heading: None,
                block: Some("blk".into()),
            }
            .wiki_inner()
            .as_deref(),
            Some("Nota#^blk"),
            "the `#` is not optional because the heading is missing: it is what\n\
             makes that `^` an anchor `^`"
        );
        // **canonico** quando lo si riscrive, invece di restare un dialetto.
        // E i bersagli che non sono wikilink non hanno un interno da scrivere.
        assert_eq!(
            parse_wikilink_inner("Nota^blk")
                .target
                .wiki_inner()
                .as_deref(),
            Some("Nota#^blk")
        );
        // Ciò che NON è un'ancora: senza questo, `2^10 = 1024` ne creerebbe una.
        assert_eq!(
            LinkTarget::Url("https://x.invalid/".into()).wiki_inner(),
            None
        );
        assert_eq!(LinkTarget::Path("a/b.md".into()).wiki_inner(), None);
    }

    #[test]
    fn an_anchor_is_a_key_and_a_heading_slug_is_generated() {
        assert_eq!(canonical_anchor("  Blocco-1 "), "blocco-1");
        assert!(valid_anchor("abc123") && valid_anchor("a-b_c"));
    // Due titoli omonimi non possono portare lo stesso id, e un documento che
        assert!(!valid_anchor("") && !valid_anchor("10 = 1024") && !valid_anchor("a.b"));

        assert_eq!(heading_slug("Ciao Mondo!"), "ciao-mondo");
        assert_eq!(heading_slug("Sezione   con  spazi"), "sezione-con-spazi");
        assert_eq!(heading_slug("A/B & C"), "ab-c");
    }

    /// omonimi non ne ha non deve cambiare **nemmeno un** id: un link già
    /// scritto dall'utente punta a uno slug, e riscriverlo sarebbe una
    /// regressione silenziosa su ogni nota del vault.
        // Il verso che protegge chi non ha duplicati: identità con la regola
    #[test]
    fn two_headings_with_the_same_text_cannot_share_an_id() {
        assert_eq!(
            heading_slugs(["Note", "Altro", "Note", "Note"]),
            ["note", "altro", "note-1", "note-2"],
            "the first keeps the pure form, the rest are numbered"
        );
        // pura, titolo per titolo.
        // Il numero è la prima forma LIBERA, non un contatore per testo: se
        let only = ["Titolo Uno", "Sotto Sezione", "A/B & C", ""];
        assert_eq!(
            heading_slugs(only),
            only.iter().map(|t| heading_slug(t)).collect::<Vec<_>>()
        );
        // `note-1` esiste già come titolo suo, il secondo `Note` lo salta
        // invece di rubarglielo.
        // Chi arriva dopo non scaccia chi c'era: se `note-1` se l'è già preso
        assert_eq!(
            heading_slugs(["Note", "Note 1", "Note"]),
            ["note", "note-1", "note-2"]
        );
        // il secondo omonimo, il titolo che si chiama davvero «Note 1» prende
        // la prima forma libera invece del suo id.
        // Anche la base vuota (titolo di sola punteggiatura) si disambigua, e
        assert_eq!(
            heading_slugs(["Note", "Note", "Note 1"]),
            ["note", "note-1", "note-1-1"]
        );
        // resta una forma che `heading_slug` sa produrre — cioè scrivibile in
        // un link.
    // La gemella che legge: chi cerca un frammento trova esattamente il
        assert_eq!(heading_slugs(["...", "???"]), ["", "1"]);
        assert_eq!(heading_slug("1"), "1");
    }

    /// titolo che quella lista ha nominato, secondo per secondo.
        // La seconda sezione omonima è raggiungibile, e prima non lo era da
    #[test]
    fn a_fragment_finds_the_heading_the_allocator_named() {
        let outline: Vec<Heading> = ["Note", "Ciao, Mondo!", "Note"]
            .iter()
            .zip(heading_slugs(["Note", "Ciao, Mondo!", "Note"]))
            .map(|(text, slug)| Heading {
                level: 2,
                text: (*text).to_string(),
                slug,
                span: Span::EMPTY,
                explicit_anchor: None,
            })
            .collect();
        let find = |q: &str| outline.iter().position(|h| heading_matches(q, h));
        assert_eq!(find("Note"), Some(0));
        // nessuna sintassi.
        // Il titolo com'è scritto, punteggiatura compresa, resta una strada.
        assert_eq!(find("Note 1"), Some(2));
        assert_eq!(find("note-1"), Some(2));
    // **Il difetto 0093 era falso sulla conseguenza, e questo lo tiene fermo.**
        assert_eq!(find("Ciao, Mondo!"), Some(1));
        assert_eq!(find("ciao-mondo"), Some(1));
        assert_eq!(find("Sezione che non c'è"), None);
    }

    ///
    /// Diceva: «`heading_slug` non normalizza in NFC, quindi `# Café` scritto da
    /// macOS e lo stesso link digitato altrove danno due slug diversi **e i link
    /// si rompono**». La prima metà era vera — era il difetto 0140, che
    /// riguardava quattro regole e non una, ed è chiuso: [`heading_slug`] compone
    /// col resto (`rules::composition::composed`). La seconda no, e resta la
    /// riga che questo banco difende: [`heading_matches`] è una **disgiunzione**,
    /// e anche quando il primo ramo taceva il secondo passava da
    /// `resolution_key`, che la NFC la faceva. La risoluzione teneva **nei due
    /// versi**; ciò che si rompeva era l'`id=` HTML, che di rami ne ha uno solo.
    ///
    /// Senza questo banco qualcuno «riparerebbe» di nuovo la metà che non è
    /// rotta, e la strada che salva la risoluzione anche a slug divergenti non
    /// sarebbe provata da nessuna parte — perciò il titolo su cui si prova qui è
    /// uno che i due rami vedono **diverso**.
        // Lo slug non diverge più: è la chiusura del 0140, e la coppia completa
    #[test]
    fn nfd_and_nfc_is_meet_on_the_text_and_not_on_the_slug() {
        let nfc = "Café";
        let nfd = "Cafe\u{301}";
        assert_ne!(
            nfc, nfd,
            "le due forme sono byte diversi, o non si prova niente"
        );

        // sta in `crates/fub-abi/tests/una_sola_forma_normalizzata.rs`.
        // Il ramo del **testo**, provato da solo. Ci vuole un titolo il cui slug
        assert_eq!(heading_slug(nfc), "café");
        assert_eq!(heading_slug(nfd), "café");

        // non sia la forma pura, e in un documento vero è il secondo omonimo:
        // `## Café` due volte dà `café` e `café-1`, e chi scrive `[[Nota#Café]]`
        // nomina il testo, non lo slug che gli è toccato.
        // Gli stati personalizzati (10.1) NON sono "fatto", ma restano leggibili.
        let second = |text: &str| Heading {
            level: 2,
            text: text.to_string(),
            slug: format!("{}-1", heading_slug(text)),
            span: Span::EMPTY,
            explicit_anchor: None,
        };
        let written_nfd = second(nfd);
        assert_ne!(
            heading_slug(nfc),
            written_nfd.slug,
            "il primo ramo non deve poter rispondere, o il secondo non è provato"
        );
        assert!(
            heading_matches(nfc, &written_nfd),
            "NFC does not find the NFD title"
        );

        let written_nfc = second(nfc);
        assert!(
            heading_matches(nfd, &written_nfc),
            "NFD does not find the NFC title"
        );
    }

    #[test]
    fn a_task_marker_carries_the_symbol_not_just_a_flag() {
        let m = |symbol| TaskMarker {
            symbol,
            span: Span::EMPTY,
        };
        assert!(m(Some('x')).checked() && m(Some('X')).checked());
        // La lista di liste non è rappresentabile al confine e non si perde:
        assert!(!m(None).checked() && !m(Some('/')).checked() && !m(Some('-')).checked());
        assert_eq!(m(Some('/')).symbol, Some('/'));
    }

    #[test]
    fn properties_are_normalized_by_shape_not_by_guessing() {
        let fm = Frontmatter(
            serde_json::json!({
                "titolo": "Una nota",
                "rating": 4,
                "pubblicata": true,
                "scadenza": "2026-07-25",
                "creata": "2026-07-25T10:30:00+02:00",
                "vuota": null,
                "tag": ["a", "b"],
                "autore": "[[Mario Rossi]]",
                "sito": "https://esempio.it",
                "annidata": { "a": 1 },
            })
            .as_object()
            .unwrap()
            .clone(),
        );
        assert_eq!(
            fm.property("titolo", &DateFormats::ISO),
            Some(PropertyValue::Text("Una nota".into()))
        );
        assert_eq!(
            fm.property("rating", &DateFormats::ISO),
            Some(PropertyValue::Number(4.0))
        );
        assert_eq!(
            fm.property("pubblicata", &DateFormats::ISO),
            Some(PropertyValue::Bool(true))
        );
        assert_eq!(
            fm.property("scadenza", &DateFormats::ISO),
            Some(PropertyValue::Date(PropertyDate {
                year: 2026,
                month: 7,
                day: 25,
                time: None
            }))
        );
        assert_eq!(
            fm.property("creata", &DateFormats::ISO),
            Some(PropertyValue::Date(PropertyDate {
                year: 2026,
                month: 7,
                day: 25,
                time: Some(PropertyTime {
                    hour: 10,
                    minute: 30,
                    second: 0,
                    offset_minutes: Some(120)
                }),
            }))
        );
        assert_eq!(
            fm.property("vuota", &DateFormats::ISO),
            Some(PropertyValue::Empty)
        );
        assert_eq!(
            fm.property("tag", &DateFormats::ISO),
            Some(PropertyValue::List(vec![
                PropertyScalar::Text("a".into()),
                PropertyScalar::Text("b".into())
            ]))
        );
        // resta JSON dentro la voce.
        // La relazione (8.2) è l'unica stringa che cambia specie...
        assert!(matches!(
            PropertyValue::normalize(&serde_json::json!([["a"], "b"]), &DateFormats::ISO),
            PropertyValue::List(v) if matches!(v[0], PropertyScalar::Unknown(_))
        ));
        // ...un URL no: distinguerlo sarebbe indovinare, e `Text` non perde nulla.
        assert_eq!(
            fm.property("autore", &DateFormats::ISO),
            Some(PropertyValue::Link(LinkTarget::wiki("Mario Rossi")))
        );
        // Chiave assente ≠ chiave senza valore.
        assert_eq!(
            fm.property("sito", &DateFormats::ISO),
            Some(PropertyValue::Text("https://esempio.it".into()))
        );
        assert!(matches!(
            fm.property("annidata", &DateFormats::ISO),
            Some(PropertyValue::Unknown(_))
        ));
    // Il parser di date dice di **no** più spesso di quanto dica di sì: ogni
        assert_eq!(fm.property("mai-scritta", &DateFormats::ISO), None);
        assert_eq!(fm.properties(&DateFormats::ISO).len(), 10);
    }

    /// falso positivo qui è una stringa dell'utente trasformata in data.
    /// Una dichiarazione **aggiunge** una lettura, non ne cambia nessuna: ciò
    #[test]
    fn only_iso_8601_is_a_date() {
        let date =
            |s: &str| match PropertyValue::normalize(&serde_json::json!(s), &DateFormats::ISO) {
                PropertyValue::Date(d) => Some(d),
                _ => None,
            };
        assert!(date("2026-07-25").is_some());
        assert!(date("2026-07-25 10:30").is_some());
        assert!(
            date("2026-07-25T10:30:00Z")
                .unwrap()
                .time
                .unwrap()
                .offset_minutes
                == Some(0)
        );
        assert!(
            date("2026-07-25T10:30:00.123-05:30")
                .unwrap()
                .time
                .unwrap()
                .offset_minutes
                == Some(-330)
        );
        for not_data in [
            "2026-7-5",
            "26-07-25",
            "2026/07/25",
            "2026-13-01",
            "2026-07-32",
            "2026-07-25X10:30",
            "2026-07-25T25:00",
            "domani",
            "1-2-3",
            "2026-07-25 e poi",
        ] {
            assert!(date(not_data).is_none(), "`{not_data}` is not a date");
        }
    }

    /// che era una data ISO resta quella data, ciò che era testo può diventare
    /// una data, e niente si muove al contrario.
        // L'ISO si legge sempre e per primo, dichiarazione o no.
    #[test]
    fn a_declared_format_only_adds_readings() {
        let dmy = DateFormats::declaring(DateOrder::Dmy);
        let read =
            |s: &str, f: &DateFormats| match PropertyValue::normalize(&serde_json::json!(s), f) {
                PropertyValue::Date(d) => Some((d.year, d.month, d.day)),
                _ => None,
            };
        // Senza dichiarazione niente cambia rispetto a ieri.
        assert_eq!(read("2026-07-25", &dmy), Some((2026, 7, 25)));
        assert_eq!(read("2026-07-25", &DateFormats::ISO), Some((2026, 7, 25)));
        // Con la dichiarazione, e **solo** nell'ordine dichiarato.
        assert_eq!(read("05/07/2026", &DateFormats::ISO), None);
        assert_eq!(read("2026-7-5", &DateFormats::ISO), None);
        // La stessa stringa, due dichiarazioni, due giorni: è precisamente ciò
        assert_eq!(read("05/07/2026", &dmy), Some((2026, 7, 5)));
        assert_eq!(read("5-7-2026", &dmy), Some((2026, 7, 5)));
        assert_eq!(read("5.7.2026", &dmy), Some((2026, 7, 5)));
        assert_eq!(
            read("2026-7-5", &DateFormats::declaring(DateOrder::Ymd)),
            Some((2026, 7, 5))
        );
        // che nessun parser può dedurre e che solo il vault può dire.
    // Un formato dichiarato non è un parser tollerante: l'insieme si allarga
        assert_eq!(
            read("07/05/2026", &DateFormats::declaring(DateOrder::Mdy)),
            Some((2026, 7, 5))
        );
        assert_eq!(read("07/05/2026", &dmy), Some((2026, 5, 7)));
    }

    /// di poco e per una ragione dichiarata, e tutto il resto continua a dire
    /// di no.
            // L'anno a due cifre chiederebbe di indovinare il secolo.
    #[test]
    fn declaring_a_format_is_not_a_tolerant_parser() {
        let each = |s: &str| {
            DateOrder::ALL.into_iter().any(|or| {
                let f = DateFormats::declaring(or);
                matches!(
                    PropertyValue::normalize(&serde_json::json!(s), &f),
                    PropertyValue::Date(_)
                )
            })
        };
        for not_data in [
            // Un codice prodotto: è il caso del foglio di calcolo, e resta testo.
            "05/07/26",
            // Separatori mescolati: due scritture in una non sono una scrittura.
            "1-2-3",
            "12-3456-78",
            // Campi che non sono un giorno né un mese.
            "05/07-2026",
            // Un campo più largo del suo posto: `007` non è un mese scritto
            "45/07/2026",
            "00/00/2026",
            // storto, è un'altra cosa. Questo caso è nato dalla verifica del
            // rosso — togliendo il limite di larghezza non diventava rosso
            // niente, perché sul mese e sul giorno ci pensava già `u8` e
            // sull'anno il vincolo delle quattro cifre.
            // Cifre non ASCII, testo attaccato, e la data con la coda.
            "5/007/2026",
    // Il rilevatore è lo stesso parser con tutti gli ordini insieme, e dice di
            "٠٥/٠٧/٢٠٢٦",
            "05/07/2026 e poi",
            "2026-07-05T10:30 fine",
            "domani",
            "",
        ] {
            assert!(!each(not_data), "`{not_data}` is not a date");
        }
    }

    /// sì esattamente a ciò su cui varrebbe la pena chiedere.
    /// La parola che l'utente sceglie nell'impostazione e quella che serde
    #[test]
    fn what_looks_like_a_date_is_what_a_declaration_would_read() {
        for sembra in ["05/07/2026", "2026-7-5", "5.7.2026", " 12/12/2026 "] {
            assert!(DateFormats::looks_like_a_date(sembra), "`{sembra}`");
        }
        for not_seems in ["1-2-3", "domani", "05/07/26", "v1.2.3", "capitolo 3"] {
            assert!(
                !DateFormats::looks_like_a_date(not_seems),
                "`{not_seems}`"
            );
        }
    }

    /// scrive sono la **stessa tabella**: due copie sarebbero due modi di
    /// nominare lo stesso ordine, e il secondo lo leggerebbe solo metà del
    /// codice.
    /// Ogni variante di questi enum deve saper attraversare il JSON: l'IPC
    #[test]
    fn the_word_of_the_setting_is_the_word_of_the_wire() {
        for order in DateOrder::ALL {
            let json = serde_json::to_string(&order).expect("an enum without payload");
            assert_eq!(json, format!("\"{}\"", order.as_key()));
            assert_eq!(DateOrder::from_key(order.as_key()), Some(order));
        }
        assert_eq!(DateOrder::from_key("dd/mm/yyyy"), None);
    }

    #[test]
    fn frontmatter_aliases_accepts_string_or_list() {
        let mut m = serde_json::Map::new();
        m.insert("aliases".into(), serde_json::json!(["A", "B"]));
        assert_eq!(Frontmatter(m).aliases(), vec!["A", "B"]);

        let mut m2 = serde_json::Map::new();
        m2.insert("alias".into(), serde_json::json!("Solo"));
        assert_eq!(Frontmatter(m2).aliases(), vec!["Solo"]);
    }

    /// verso la shell è JSON, e un tipo del contratto che non ci passa non
    /// arriva a nessuna view. Col tag *interno* — la forma di `Block` e
    /// `Event`, che hanno solo varianti a struct — le varianti che portano uno
    /// scalare fallivano a runtime, in silenzio fino al primo cliente vero: le
    /// proprietà del frontmatter, che il canale dati della decisione 0005 mette sul filo.
    /// proprietà del frontmatter, che il canale dati della decisione 0005 mette sul filo.
    #[test]
    fn every_variant_survives_the_json_boundary() {
        fn round_trip<T>(what: &str, value: T)
        where
            T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug,
        {
            let json = serde_json::to_string(&value)
                .unwrap_or_else(|and| panic!("{what} does not serialize: {and}"));
            let back: T = serde_json::from_str(&json)
                .unwrap_or_else(|and| panic!("{what} does not re-read from `{json}`: {and}"));
            assert_eq!(back, value, "{what}: the round-trip changes the value");
        }

        let span = Span::new(0, 1);
        let date = PropertyDate {
            year: 2026,
            month: 7,
            day: 26,
            time: Some(PropertyTime {
                hour: 12,
                minute: 0,
                second: 0,
                offset_minutes: Some(120),
            }),
        };

        for t in [
            LinkTarget::wiki("Pagina"),
            LinkTarget::Url("https://example.invalid".into()),
            LinkTarget::Path("note/a.md".into()),
        ] {
            round_trip("LinkTarget", t);
        }

        for s in [
            PropertyScalar::Empty,
            PropertyScalar::Text("t".into()),
            PropertyScalar::Number(1.5),
            PropertyScalar::Bool(true),
            PropertyScalar::Date(date),
            PropertyScalar::Link(LinkTarget::wiki("P")),
            PropertyScalar::Unknown(serde_json::json!({"a": 1})),
        ] {
            round_trip("PropertyScalar", s);
        }

        for v in [
            PropertyValue::Empty,
            PropertyValue::Text("t".into()),
            PropertyValue::Number(1.5),
            PropertyValue::Bool(true),
            PropertyValue::Date(date),
            PropertyValue::Link(LinkTarget::wiki("P")),
            PropertyValue::List(vec![PropertyScalar::Text("a".into())]),
            PropertyValue::Unknown(serde_json::json!({"a": 1})),
        ] {
            round_trip("PropertyValue", v);
        }

        for the in [
            Inline::Text("t".into()),
            Inline::Emph(vec![Inline::Text("e".into())]),
            Inline::Strong(vec![]),
            Inline::Code("c".into()),
            Inline::Link {
                target: LinkTarget::wiki("P"),
                label: None,
                embed: false,
                span,
            },
            Inline::TagRef {
                name: "t".into(),
                span,
            },
            Inline::Custom {
                custom_kind: "k".into(),
                attrs: serde_json::Value::Null,
                span,
            },
            Inline::Superscript(vec![Inline::Text("s".into())]),
            Inline::Strikethrough(vec![Inline::Text("d".into())]),
            Inline::HardBreak,
            Inline::SoftBreak,
        ] {
            round_trip("Inline", the);
        }
    }
}
