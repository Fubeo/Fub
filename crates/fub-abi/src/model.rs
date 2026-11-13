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
//! `Custom` è dichiarato in `../../../docs/architecture/document-model.md`: deve esistere un
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

/// Limite comune per le conversioni ricorsive del modello di documento.
pub const MAX_DOCUMENT_DEPTH: u32 = 64;

use crate::rules::composition::composed;

/// Il nome, senza estensione, del file che fa da pagina alla sua cartella:
/// `Viaggio/_index.md` è la pagina «Viaggio». Un nome fisso, che nessuno dà a
/// una nota per caso (ADR 0229).
pub const FOLDER_PAGE_STEM: &str = "_index";

/// Il nome di un file senza l'ultima estensione; un dotfile non ne ha.
fn stem_of(base: &str) -> &str {
    match base.rsplit_once('.') {
        Some((stem, _ext)) if !stem.is_empty() => stem,
        _ => base,
    }
}

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
    /// La gemella TypeScript è `pageName` in `apps/client/src/rules/mirrored.ts`, e
    /// a tenerle uguali sui nomi ostili non è più un elenco copiato a mano ma la
    /// fixture generata di `tests/rules_mirror.rs` (§6.2).
    ///
    /// **La pagina della cartella** ([ADR 0229](../../../docs/decisions/0229-pagina-della-cartella.md)):
    /// `X/_index.<ext>` si chiama come la sua cartella, `X`. Così `[[X]]` la
    /// trova, e schede, ricerca, grafo e cestino dicono «X». Nella radice del
    /// vault `_index.md` non ha una cartella da nominare e resta `_index`.
    pub fn page_name(&self) -> &str {
        match self.0.rsplit_once('/') {
            Some((folder, base)) if stem_of(base) == FOLDER_PAGE_STEM => {
                folder.rsplit('/').next().unwrap_or(folder)
            }
            Some((_, base)) => stem_of(base),
            None => stem_of(&self.0),
        }
    }

    /// È la pagina di una cartella (`X/_index.<ext>`, non nella radice)?
    pub fn is_folder_page(&self) -> bool {
        self.0
            .rsplit_once('/')
            .is_some_and(|(_, base)| stem_of(base) == FOLDER_PAGE_STEM)
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
        self.property_with_types(key, formats, &PropertyTypes::default())
    }

    /// Interpreta la sorgente secondo le dichiarazioni del vault, senza mutarla.
    pub fn property_with_types(
        &self,
        key: &str,
        formats: &DateFormats,
        types: &PropertyTypes,
    ) -> Option<PropertyValue> {
        self.0
            .get(key)
            .map(|value| normalize_property(key, value, formats, types))
    }

    /// Tutte le proprietà normalizzate, **nell'ordine del file** (il workspace
    /// abilita `serde_json/preserve_order`).
    pub fn properties(&self, formats: &DateFormats) -> Vec<(String, PropertyValue)> {
        self.properties_with_types(formats, &PropertyTypes::default())
    }

    pub fn properties_with_types(
        &self,
        formats: &DateFormats,
        types: &PropertyTypes,
    ) -> Vec<(String, PropertyValue)> {
        self.0
            .iter()
            .map(|(key, value)| (key.clone(), normalize_property(key, value, formats, types)))
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

fn normalize_property(
    key: &str,
    value: &serde_json::Value,
    formats: &DateFormats,
    types: &PropertyTypes,
) -> PropertyValue {
    if !types.types.contains_key(key)
        && matches!(key, "aliases" | "alias" | "cssclasses" | "cssclass")
    {
        return match value {
            serde_json::Value::Null => PropertyValue::Empty,
            serde_json::Value::String(s) => {
                PropertyValue::List(vec![PropertyScalar::Text(s.clone())])
            }
            serde_json::Value::Array(items) => PropertyValue::List(
                items
                    .iter()
                    .map(|item| match item {
                        serde_json::Value::String(s) => PropertyScalar::Text(s.clone()),
                        _ => PropertyScalar::Unknown(item.clone()),
                    })
                    .collect(),
            ),
            _ => PropertyValue::Unknown(value.clone()),
        };
    }
    PropertyValue::normalize_as(value, formats, types.resolve(key))
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

    /// Dove comincia il corpo in `source`, il testo da cui il modello è stato
    /// letto, se il documento ha un frontmatter: è dove si scrive «in testa»
    /// senza che il frontmatter smetta di essere la prima cosa del file.
    ///
    /// È la riga del primo blocco del corpo, se prima di lui ci sono soltanto
    /// spazi, così il suo rientro non si spezza; la fine di `source` se il
    /// frontmatter è tutto il documento. Conta anche il frontmatter che il
    /// provider non ha saputo leggere e tiene verbatim come primo blocco
    /// ([`custom_kind::FRONTMATTER_UNPARSED`]): è ancora la testa del file.
    ///
    /// `Ok(None)` senza frontmatter. L'errore porta lo span del primo blocco
    /// quando non cade dentro `source`, cioè il modello non è stato letto da lì.
    pub fn body_start(&self, source: &str) -> Result<Option<usize>, Span> {
        let unparsed = matches!(
            self.body.first(),
            Some(Block::Custom { custom_kind, .. })
                if custom_kind == custom_kind::FRONTMATTER_UNPARSED
        );
        if !self.frontmatter_present && !unparsed {
            return Ok(None);
        }
        let Some(first) = self.body.get(usize::from(unparsed)) else {
            return Ok(Some(source.len()));
        };
        let span = first.span();
        let head = source.get(..span.start).ok_or(span)?;
        let row = head.rfind(['\n', '\r']).map_or(0, |at| at + 1);
        Ok(Some(
            if head[row..].chars().all(|c| c == ' ' || c == '\t') {
                row
            } else {
                span.start
            },
        ))
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
    /// `~pedice~`: un pedice inline, l'estensione `subscript` di comrak
    /// (decisione 0228). Il gemello di [`Inline::Superscript`]; `~~…~~` resta
    /// barrato. In coda per la stessa ragione degli a-capo.
    Subscript(Vec<Inline>),
}

mod link;
mod property;

pub use link::{parse_wikilink_inner, LinkTarget, ParsedWikilink};
pub use property::{
    valid_civil_date, DateFormats, DateOrder, PropertyDate, PropertyScalar, PropertyTime,
    PropertyType, PropertyTypes, PropertyValue,
};

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
/// `../../../docs/architecture/document-model.md`).
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
/// in `../../../docs/architecture/document-model.md`.
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
    /// `attrs: { label: string, unreferenced?: bool }`: `unreferenced` segna
    /// una definizione che nessun richiamo usa, che sta nel file e che la resa
    /// non mostra.
    pub const FOOTNOTE_DEFINITION: &str = "footnote-definition";
    /// Il richiamo nel testo (inline). `attrs: { label: string, inline?: bool,
    /// source?: string, unresolved?: bool }`: `inline` è una nota che porta il
    /// suo testo sul posto (`source` è com'è scritto), `unresolved` un
    /// richiamo che non trova la sua definizione e si legge com'è scritto.
    pub const FOOTNOTE_REFERENCE: &str = "footnote-reference";
    /// Un diagramma a blocco recintato: mermaid, PlantUML, Graphviz, D2.
    /// `attrs: { engine: string, source: string }`. Il core lo **delimita** e
    /// non lo disegna: chi lo disegna è un renderer registrato (§3.2), e il
    /// motore sta negli `attrs` perché il kind è la famiglia, non il dialetto.
    pub const DIAGRAM: &str = "diagram";
    /// `==evidenziato==` (inline). `attrs: { text: string }`.
    pub const HIGHLIGHT: &str = "highlight";
    /// `%%commento%%` (inline): testo dell'autore che la resa non mostra.
    /// `attrs: { source: string }`, **delimitatori compresi**, perché riscriverlo
    /// è copiarlo e nascondere un commento non autorizza a perderlo.
    pub const COMMENT: &str = "comment";
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
        (COMMENT, Payload::Source("source")),
        (DEFINITION_LIST, Payload::Children),
        (DEFINITION_TERM, Payload::Children),
        (DEFINITION_DESCRIPTION, Payload::Children),
        (BLOCK, Payload::Children),
        (FRONTMATTER_UNPARSED, Payload::Source("text")),
    ];

    /// Cosa porta un `custom_kind`, o `None` se il contratto non lo dichiara.
    ///
    /// **`None` non vuol dire «niente»: vuol dire «nessuno l'ha detto».** Un
    /// kind di terzi non è in [`PAYLOADS`] per costruzione — l'elenco è del
    /// core, e questo modulo dichiara i significati *condivisi*, non tutti
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
pub use custom_kind::Payload;

#[cfg(test)]
mod tests;
