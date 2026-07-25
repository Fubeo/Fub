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

use serde::{Deserialize, Serialize};

/// Identificatore stabile di un documento nel vault.
///
/// È il path relativo al vault, normalizzato con separatori `/` e senza
/// estensione implicita rimossa (il path è la verità). La risoluzione dei
/// wikilink → `DocId` è compito del kernel, non dei provider.
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
    /// basename — un dotfile non ha estensione, il punto è parte del nome. La
    /// gemella in TypeScript è `pageName` in `frontend/src/organizer.ts`, e le
    /// due sono identiche per costruzione: nessuna delle due consulta l'elenco
    /// delle estensioni *gestite*, perché un `DocId` viene dal vault e quindi
    /// un'estensione gestita ce l'ha già — filtrarci sopra faceva divergere
    /// risoluzione e display su nomi come `note.backup`.
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
    pub fn property(&self, key: &str) -> Option<PropertyValue> {
        self.0.get(key).map(PropertyValue::normalize)
    }

    /// Tutte le proprietà normalizzate, **nell'ordine del file** (il workspace
    /// abilita `serde_json/preserve_order`).
    pub fn properties(&self) -> Vec<(String, PropertyValue)> {
        self.0
            .iter()
            .map(|(k, v)| (k.clone(), PropertyValue::normalize(v)))
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
        }
    }
}

/// Nodi a livello di blocco. `Custom` è l'escape hatch: callout, math,
/// footnote, definition list non sono hardcoded nell'enum.
///
/// # L'ancora
///
/// Ogni blocco porta un `anchor: Option<String>`, ed è la stessa cosa vista da
/// due sintassi: per un [`Block::Heading`] è lo **slug generato** dal testo
/// ([`heading_slug`]), per tutti gli altri è l'**id esplicito** che l'utente ha
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
    /// La tabella è l'unica delle tre candidate del §1.5 promossa a variante, e
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
}

impl Block {
    /// Lo `Span` del blocco, qualunque variante sia.
    ///
    /// Esiste perché il `match` esaustivo su sette varianti per estrarre un
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
            | Block::Table { span, .. } => *span,
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
            | Block::Table { anchor, .. } => anchor.as_deref(),
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
#[serde(tag = "kind", rename_all = "snake_case")]
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
#[serde(tag = "kind", rename_all = "snake_case")]
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

    /// La destinazione di un link scritto "alla markdown" (`[t](qui)`): è del
    /// **vault** o del mondo esterno?
    ///
    /// La regola è lo schema: `qualcosa:` con uno schema URI valido (lettera,
    /// poi lettere/cifre/`+`/`-`/`.`) oppure il protocol-relative `//host` →
    /// [`LinkTarget::Url`]; tutto il resto è un path dentro il vault, che il
    /// kernel risolverà (`fubmd_kernel::pathlink`). Un `mailto:`, un `tel:`,
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
/// [`canonical_tag`]. `fubmd-sdk` la ri-esporta per i provider.
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
pub fn parse_wikilink_inner(inner: &str) -> ParsedWikilink {
    // Alias dopo la prima '|'.
    let (link_part, alias) = match inner.split_once('|') {
        Some((l, a)) => (l, Some(a.trim().to_string())),
        None => (inner, None),
    };

    // Riferimento a blocco `^id` (solo se dopo un eventuale heading).
    let (link_part, block) = match link_part.split_once('^') {
        Some((l, b)) => (l, Some(b.trim().to_string())),
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
            heading,
            block,
        },
        alias: alias.filter(|a| !a.is_empty()),
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
    pub slug: String,
    pub span: Span,
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

/// La forma **canonica** di un nome di tag: spazi esterni via, minuscolo
/// (Unicode). Stile Obsidian: `#Rust` e `#rust` sono lo stesso tag,
/// case-insensitive come chiave e case-preserving per il display.
///
/// È LA chiave con cui i tag si contano (aggregazione del kernel), si
/// indicizzano e si interrogano (campo tag della ricerca): la regola vive nel
/// contratto perché kernel e feature non si vedono tra loro, e due copie
/// divergerebbero al primo ritocco — il nome del tag sta diventando chiave di
/// pannelli, grafo e query salvate.
pub fn canonical_tag(name: &str) -> String {
    name.trim().to_lowercase()
}

/// La forma **canonica** di un id di blocco: spazi esterni via, minuscolo.
///
/// Sta accanto a [`canonical_tag`] e per la stessa ragione: è LA chiave con cui
/// un `[[Nota#^Blocco]]` trova il suo blocco, e chi scrive l'ancora e chi la
/// cerca sono due pezzi di codice che non si vedono fra loro. Un'ancora è
/// case-insensitive come il resto della risoluzione (§ "Case dei path" in
/// `docs/architecture/data-model.md`).
pub fn canonical_anchor(id: &str) -> String {
    id.trim().to_lowercase()
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
pub fn heading_slug(text: &str) -> String {
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

/// Il registro dei `custom_kind` noti — la metà "decisa" della voce §1.5 sulle
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
    /// Definition list: i figli sono `DEFINITION_TERM` e `DEFINITION_DESCRIPTION`
    /// alternati, nell'ordine della sorgente.
    pub const DEFINITION_LIST: &str = "definition-list";
    pub const DEFINITION_TERM: &str = "definition-term";
    pub const DEFINITION_DESCRIPTION: &str = "definition-description";
    /// L'ultima spiaggia: un blocco che il provider non sa nominare ma di cui
    /// ha ricostruito i figli.
    pub const BLOCK: &str = "block";
}

/// Il valore di una proprietà del frontmatter, **normalizzato**.
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PropertyValue {
    /// `chiave:` senza valore (YAML `null`). Diverso da chiave assente.
    Empty,
    Text(String),
    Number(f64),
    Bool(bool),
    /// Data ISO-8601, con o senza orario.
    Date(PropertyDate),
    /// Una relazione: `autore: "[[Mario Rossi]]"`.
    Link(LinkTarget),
    List(Vec<PropertyScalar>),
    /// Ciò che non si normalizza (oggetti annidati): il JSON com'è. L'escape
    /// hatch delle proprietà, gemello di `Block::Custom`.
    Unknown(serde_json::Value),
}

/// Il valore di una **voce di elenco**: [`PropertyValue`] meno la lista.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PropertyScalar {
    Empty,
    Text(String),
    Number(f64),
    Bool(bool),
    Date(PropertyDate),
    Link(LinkTarget),
    Unknown(serde_json::Value),
}

/// Una data ISO-8601, già scomposta.
///
/// Scomposta e non stringa perché il primo cliente (10.4, calendario e agenda)
/// deve raggruppare per giorno e per mese, e una stringa lo costringerebbe a
/// riparsare — che è esattamente ciò che questa voce esiste per evitare. Il
/// contratto non dipende da `chrono`: qui non si fa aritmetica sulle date, si
/// dichiara *cosa c'era scritto*.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyDate {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub time: Option<PropertyTime>,
}

/// L'orario di una [`PropertyDate`], col fuso **come era scritto**.
///
/// `offset_minutes` è `None` per un orario locale-senza-fuso: convertirlo
/// richiederebbe sapere il fuso dell'utente, che è una capacità dell'host
/// (§1.4) e non un fatto del documento. Il modello non indovina.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PropertyTime {
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    /// Minuti rispetto a UTC (`Z` → `0`, `+02:00` → `120`).
    pub offset_minutes: Option<i16>,
}

impl PropertyValue {
    /// Normalizza un valore JSON del frontmatter.
    pub fn normalize(v: &serde_json::Value) -> PropertyValue {
        match v {
            serde_json::Value::Array(a) => {
                PropertyValue::List(a.iter().map(PropertyScalar::normalize).collect())
            }
            scalar => PropertyScalar::normalize(scalar).into(),
        }
    }
}

impl PropertyScalar {
    /// Normalizza un valore JSON che **non** può essere una lista: una lista
    /// annidata resta JSON.
    pub fn normalize(v: &serde_json::Value) -> PropertyScalar {
        match v {
            serde_json::Value::Null => PropertyScalar::Empty,
            serde_json::Value::Bool(b) => PropertyScalar::Bool(*b),
            serde_json::Value::Number(n) => match n.as_f64() {
                Some(f) => PropertyScalar::Number(f),
                // Un intero più grande di quanto un f64 rappresenti senza
                // perdite non è un numero da fare i conti: è un'identità.
                None => PropertyScalar::Text(n.to_string()),
            },
            serde_json::Value::String(s) => PropertyScalar::from_text(s),
            serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
                PropertyScalar::Unknown(v.clone())
            }
        }
    }

    /// La normalizzazione di una stringa: wikilink, poi data, poi testo.
    fn from_text(s: &str) -> PropertyScalar {
        let t = s.trim();
        if let Some(inner) = t.strip_prefix("[[").and_then(|r| r.strip_suffix("]]")) {
            return PropertyScalar::Link(parse_wikilink_inner(inner).target);
        }
        match parse_iso_date(t) {
            Some(d) => PropertyScalar::Date(d),
            None => PropertyScalar::Text(s.to_string()),
        }
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
            PropertyScalar::Link(l) => PropertyValue::Link(l),
            PropertyScalar::Unknown(v) => PropertyValue::Unknown(v),
        }
    }
}

/// `2026-07-25`, `2026-07-25T10:30`, `2026-07-25 10:30:00Z`, `…+02:00`.
///
/// Rigido di proposito: solo l'ISO-8601 nella forma che YAML e Obsidian
/// producono. Un parser tollerante qui direbbe di sì a `1-2-3` e trasformerebbe
/// in date delle stringhe che l'utente non intendeva tali.
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
        Some(i) => s.split_at(i),
        // Il `-` del fuso si distingue dal nulla solo per posizione: prima ci
        // sono almeno `hh:mm`.
        None => match s.get(5..).and_then(|rest| rest.find('-')) {
            Some(i) => s.split_at(i + 5),
            None => (s, ""),
        },
    };
    let mut parts = hms.split(':');
    let hour: u8 = fixed_width(parts.next()?, 2)?;
    let minute: u8 = fixed_width(parts.next()?, 2)?;
    let second: u8 = match parts.next() {
        // I secondi frazionari si troncano: il modello dichiara cosa c'era
        // scritto, non pretende di essere un istante.
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

/// Un campo numerico a larghezza fissa (`07`), che è ciò che distingue una data
/// ISO da un'espressione: `2026-7-5` non è una data ISO.
fn fixed_width(s: &str, width: usize) -> Option<u8> {
    if s.len() != width || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docid_page_name_strips_dir_and_ext() {
        assert_eq!(DocId::new("note.md").page_name(), "note");
        assert_eq!(DocId::new("a/b/Nota Lunga.md").page_name(), "Nota Lunga");
        assert_eq!(DocId::new("senza-ext").page_name(), "senza-ext");
    }

    /// I casi ostili, quelli su cui kernel e frontend potevano dissentire.
    ///
    /// La gemella TypeScript (`pageName` in `frontend/src/organizer.ts`) applica
    /// la stessa regola sugli stessi casi: se questa tabella cambia, cambia
    /// anche là — sono due righe di codice identiche, e questa è la lista che le
    /// tiene oneste. Prima il frontend toglieva l'estensione *solo se gestita*, e
    /// per `note.backup` il kernel risolveva `note` mentre la UI mostrava
    /// `note.backup`.
    #[test]
    fn docid_page_name_agrees_with_the_frontend_on_hostile_names() {
        for (id, atteso) in [
            ("note.md", "note"),
            ("note.backup", "note"),
            ("a.b.md", "a.b"),
            (".foo", ".foo"),
            ("dir/.hidden.md", ".hidden"),
            ("dir/.gitignore", ".gitignore"),
            ("senza-ext", "senza-ext"),
            ("dir.con.punti/nota.md", "nota"),
            ("finisce-con-punto.", "finisce-con-punto"),
        ] {
            assert_eq!(DocId::new(id).page_name(), atteso, "page_name di `{id}`");
        }
    }

    /// La regola che distingue "risorsa del vault" da "mondo esterno", con i
    /// casi su cui un `contains("://")` sbagliava: `mailto:` non ha `//`, e un
    /// path di Windows ha i due punti al secondo carattere senza essere un URI.
    #[test]
    fn classify_tells_a_vault_resource_from_the_outside_world() {
        for esterno in [
            "https://esempio.it/a",
            "http://x",
            "mailto:a@b.it",
            "tel:+39012",
            "obsidian://open?vault=v",
            "//cdn.esempio.it/a.png",
            "data:image/png;base64,AAAA",
        ] {
            assert_eq!(
                LinkTarget::classify(esterno),
                LinkTarget::Url(esterno.to_string()),
                "`{esterno}` è esterno"
            );
        }
        for interno in [
            "note/altra.md",
            "../allegati/foto.png",
            "/dalla-radice.md",
            "nota con spazi.md",
            "C:\\foto\\a.png",
            "#solo-frammento",
            "a:b",
        ] {
            assert_eq!(
                LinkTarget::classify(interno),
                LinkTarget::Path(interno.to_string()),
                "`{interno}` è del vault"
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
    }

    #[test]
    fn an_anchor_is_a_key_and_a_heading_slug_is_generated() {
        assert_eq!(canonical_anchor("  Blocco-1 "), "blocco-1");
        assert!(valid_anchor("abc123") && valid_anchor("a-b_c"));
        // Ciò che NON è un'ancora: senza questo, `2^10 = 1024` ne creerebbe una.
        assert!(!valid_anchor("") && !valid_anchor("10 = 1024") && !valid_anchor("a.b"));

        assert_eq!(heading_slug("Ciao Mondo!"), "ciao-mondo");
        assert_eq!(heading_slug("Sezione   con  spazi"), "sezione-con-spazi");
        assert_eq!(heading_slug("A/B & C"), "ab-c");
    }

    #[test]
    fn a_task_marker_carries_the_symbol_not_just_a_flag() {
        let m = |symbol| TaskMarker {
            symbol,
            span: Span::EMPTY,
        };
        assert!(m(Some('x')).checked() && m(Some('X')).checked());
        // Gli stati personalizzati (10.1) NON sono "fatto", ma restano leggibili.
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
            fm.property("titolo"),
            Some(PropertyValue::Text("Una nota".into()))
        );
        assert_eq!(fm.property("rating"), Some(PropertyValue::Number(4.0)));
        assert_eq!(fm.property("pubblicata"), Some(PropertyValue::Bool(true)));
        assert_eq!(
            fm.property("scadenza"),
            Some(PropertyValue::Date(PropertyDate {
                year: 2026,
                month: 7,
                day: 25,
                time: None
            }))
        );
        assert_eq!(
            fm.property("creata"),
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
        assert_eq!(fm.property("vuota"), Some(PropertyValue::Empty));
        assert_eq!(
            fm.property("tag"),
            Some(PropertyValue::List(vec![
                PropertyScalar::Text("a".into()),
                PropertyScalar::Text("b".into())
            ]))
        );
        // La lista di liste non è rappresentabile al confine e non si perde:
        // resta JSON dentro la voce.
        assert!(matches!(
            PropertyValue::normalize(&serde_json::json!([["a"], "b"])),
            PropertyValue::List(v) if matches!(v[0], PropertyScalar::Unknown(_))
        ));
        // La relazione (8.2) è l'unica stringa che cambia specie...
        assert_eq!(
            fm.property("autore"),
            Some(PropertyValue::Link(LinkTarget::wiki("Mario Rossi")))
        );
        // ...un URL no: distinguerlo sarebbe indovinare, e `Text` non perde nulla.
        assert_eq!(
            fm.property("sito"),
            Some(PropertyValue::Text("https://esempio.it".into()))
        );
        assert!(matches!(
            fm.property("annidata"),
            Some(PropertyValue::Unknown(_))
        ));
        // Chiave assente ≠ chiave senza valore.
        assert_eq!(fm.property("mai-scritta"), None);
        assert_eq!(fm.properties().len(), 10);
    }

    /// Il parser di date dice di **no** più spesso di quanto dica di sì: ogni
    /// falso positivo qui è una stringa dell'utente trasformata in data.
    #[test]
    fn only_iso_8601_is_a_date() {
        let date = |s: &str| match PropertyValue::normalize(&serde_json::json!(s)) {
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
        for non_data in [
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
            assert!(date(non_data).is_none(), "`{non_data}` non è una data");
        }
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
}
