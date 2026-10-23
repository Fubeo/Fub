//! Esportare una **copia** di un documento di videoscrittura in un altro
//! formato, con gli esportatori di WordCraft.
//!
//! Il documento resta com'è: si leggono i suoi byte, se ne fa il modello di
//! WordCraft con il codec del suo formato ([`Codec::read`]) e se ne scrive la
//! copia, che esce come artefatto alla porta di export del contratto e che
//! l'utente posa dove vuole. Niente entra nel vault.
//!
//! # Nessuna perdita silenziosa
//!
//! Un formato di destinazione porta meno del documento: un testo semplice non
//! ha titoli, un HTML non ha intestazioni di pagina, nessuno dei formati di
//! testo ha le forme di Word. WordCraft non dichiara cosa perde un suo
//! esportatore, quindi la perdita si **misura**: la copia si rilegge con
//! l'importatore dello stesso formato e il suo [inventario](Inventory) si
//! confronta con quello del documento. Ogni voce che manca, o che è diminuita,
//! diventa un avviso nel rapporto dell'export, con il documento a cui si
//! riferisce. Un importatore che legge meno di ciò che il suo esportatore ha
//! scritto fa dire alla misura qualcosa di troppo, mai di troppo poco.
//!
//! Ciò che l'inventario non conta (impaginazione, caratteri, colori, stili dei
//! paragrafi) lo dice un avviso a parte, e un documento letto con un
//! importatore ([`Codec::lossless`] falso) parte già da meno del file: anche
//! questo lo dice il rapporto.

use std::collections::BTreeMap;
use std::sync::Arc;

use fub_abi::command::{
    Choice, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind,
    ParamSpec,
};
use fub_abi::model::DocId;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi, ReadApi, VaultRead};
use fub_abi::transfer::{
    copy_names, ArtifactSink, ExportProvider, ExportReport, ExportRequest, ExportSelection,
    ExportTarget, TransferNote,
};
use fub_abi::PluginError;
use wordcraft_doc::para::{InlineObject, NoteKind};
use wordcraft_doc::{Block, Document, PartKind};
use wordcraft_formats::ExportOptions;

use crate::projection::{self, Mark, Role};
use crate::Codec;

/// Il prefisso delle destinazioni di questo provider.
pub const TARGET_PREFIX: &str = "rich.copy.";

/// Il comando che esporta una copia del documento aperto.
pub const EXPORT_COPY: &str = "rich.export-copy";

/// Il comando del contratto che accoda un export: è l'id che il comando di
/// qui invoca, non un dettaglio di chi lo esegue.
const EXPORT_RUN: &str = "export.run";

/// L'opzione che mette i commenti in fondo a una copia HTML o di testo.
pub const OPTION_COMMENTS: &str = "comments";

/// Quanti documenti esporta una richiesta sola: le copie stanno in memoria
/// finché l'utente non le posa.
const MAX_DOCUMENTS: usize = 256;

/// Un formato in cui si esporta una copia.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Html,
    Txt,
    Latex,
    Rtf,
    Odt,
    /// Word XML in un file solo (Flat OPC), che Word apre come un `.docx`.
    WordXml,
}

impl Target {
    pub const ALL: [Target; 6] = [
        Target::Html,
        Target::Txt,
        Target::Latex,
        Target::Rtf,
        Target::Odt,
        Target::WordXml,
    ];

    /// Il nome corto, che segue [`TARGET_PREFIX`] e che il comando sceglie.
    pub fn key(self) -> &'static str {
        match self {
            Target::Html => "html",
            Target::Txt => "txt",
            Target::Latex => "latex",
            Target::Rtf => "rtf",
            Target::Odt => "odt",
            Target::WordXml => "wordxml",
        }
    }

    pub fn id(self) -> String {
        format!("{TARGET_PREFIX}{}", self.key())
    }

    pub fn of_id(id: &str) -> Option<Target> {
        let key = id.strip_prefix(TARGET_PREFIX)?;
        Target::ALL.into_iter().find(|target| target.key() == key)
    }

    fn name(self) -> &'static str {
        match self {
            Target::Html => "HTML",
            Target::Txt => "Testo semplice",
            Target::Latex => "LaTeX",
            Target::Rtf => "RTF",
            Target::Odt => "OpenDocument",
            Target::WordXml => "Word XML",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Target::Html => "html",
            Target::Txt => "txt",
            Target::Latex => "tex",
            Target::Rtf => "rtf",
            Target::Odt => "odt",
            Target::WordXml => "xml",
        }
    }

    fn media_type(self) -> &'static str {
        match self {
            Target::Html => "text/html",
            Target::Txt => "text/plain",
            Target::Latex => "application/x-tex",
            Target::Rtf => "application/rtf",
            Target::Odt => "application/vnd.oasis.opendocument.text",
            Target::WordXml => "application/xml",
        }
    }

    /// Il formato del documento è già questo: la sua copia sarebbe il file
    /// riscritto da un modello che ne porta meno.
    fn is_format_of(self, codec: Codec) -> bool {
        matches!(
            (self, codec),
            (Target::Odt, Codec::Odt) | (Target::Rtf, Codec::Rtf)
        )
    }

    /// I commenti in fondo come testo: l'opzione degli esportatori di WordCraft
    /// che la prevedono. Gli altri formati li tengono a modo loro o no.
    fn prints_comments(self) -> bool {
        matches!(self, Target::Html | Target::Txt)
    }

    fn write(self, document: &Document, comments: bool) -> Result<Vec<u8>, String> {
        match self {
            Target::WordXml => {
                wordcraft_docx::write_flat(document).map_err(|error| error.to_string())
            }
            target => {
                let options = ExportOptions {
                    comments: comments && target.prints_comments(),
                };
                wordcraft_formats::export_with(target.extension(), document, &options)
                    .unwrap_or_else(|| Err(format!("no exporter for {}", target.key())))
            }
        }
    }

    /// La copia riletta con l'importatore dello stesso formato.
    fn reread(self, bytes: &[u8]) -> Result<Document, String> {
        match self {
            Target::WordXml => wordcraft_docx::read_xml(bytes).map_err(|error| error.to_string()),
            target => wordcraft_formats::import(target.extension(), bytes)
                .unwrap_or_else(|| Err(format!("no importer for {}", target.key()))),
        }
    }
}

/// Le destinazioni offerte alla porta di export.
pub struct RichExport;

impl RichExport {
    pub fn boxed() -> Box<dyn ExportProvider> {
        Box::new(RichExport)
    }
}

impl ExportProvider for RichExport {
    fn targets(&self) -> Vec<ExportTarget> {
        Target::ALL
            .into_iter()
            .map(|target| ExportTarget {
                id: target.id(),
                name: target.name().to_string(),
                extension: Some(target.extension().to_string()),
            })
            .collect()
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        let Some(target) = Target::of_id(&request.target) else {
            return Err(PluginError::BadArgs(
                format!("`{}` is not a destination of this provider", request.target).into(),
            ));
        };
        let comments = request.flag(OPTION_COMMENTS, false);
        let docs = request.selection.resolve(host)?;
        let mut report = ExportReport::default();
        let mut chosen = Vec::new();
        for doc in docs {
            match codec_of(host, &doc) {
                Some(codec) if target.is_format_of(codec) => report.log.push(
                    TransferNote::warning(format!(
                        "è già un documento {}: la copia non si fa",
                        target.name()
                    ))
                    .about(doc.to_string()),
                ),
                Some(codec) => chosen.push((doc, codec)),
                None => report.log.push(
                    TransferNote::info("non è un documento di videoscrittura: resta fuori")
                        .about(doc.to_string()),
                ),
            }
        }
        if chosen.is_empty() {
            return Err(PluginError::BadArgs(
                format!(
                    "nothing to export as {}: no selected document is a word-processing document in another format",
                    target.name()
                )
                .into(),
            ));
        }
        if chosen.len() > MAX_DOCUMENTS {
            return Err(PluginError::BadArgs(
                format!("more than {MAX_DOCUMENTS} documents: select a smaller batch").into(),
            ));
        }
        let ids: Vec<DocId> = chosen.iter().map(|(doc, _)| doc.clone()).collect();
        for ((doc, codec), name) in chosen.iter().zip(copy_names(&ids, target.extension())) {
            let entry = doc.to_string();
            let document = match host
                .read_document_bytes(doc)
                .and_then(|bytes| codec.read(&bytes).map_err(|error| read_error(doc, error)))
            {
                Ok(document) => document,
                Err(error) => {
                    report
                        .log
                        .push(TransferNote::warning(error.to_string()).about(entry));
                    continue;
                }
            };
            let bytes = match target.write(&document, comments) {
                Ok(bytes) => bytes,
                Err(error) => {
                    report.log.push(
                        TransferNote::warning(format!(
                            "la copia {} non si scrive: {error}",
                            target.name()
                        ))
                        .about(entry),
                    );
                    continue;
                }
            };
            let handle = out.open_artifact(&name, target.media_type())?;
            for chunk in bytes.chunks(64 * 1024) {
                out.write_artifact(handle, chunk)?;
            }
            report.artifacts.push(out.close_artifact(handle)?);
            report
                .log
                .extend(losses(&document, *codec, target, comments, &bytes, &entry));
        }
        if report.artifacts.is_empty() {
            return Err(PluginError::BadArgs(
                format!(
                    "none of the selected documents could be exported as {}",
                    target.name()
                )
                .into(),
            ));
        }
        Ok(report)
    }
}

/// Il codec di un documento, dal formato con cui il registro lo serve: un
/// documento che nessun formato di videoscrittura serve non ha codec.
pub fn codec_of<H: VaultRead + ?Sized>(host: &H, doc: &DocId) -> Option<Codec> {
    host.format_of(doc)
        .and_then(|format| Codec::of_format(&format.descriptor.id))
}

fn read_error(doc: &DocId, error: crate::RichError) -> PluginError {
    PluginError::BadArgs(format!("`{doc}` cannot be read: {error}").into())
}

/// Gli avvisi su ciò che la copia non porta.
fn losses(
    document: &Document,
    codec: Codec,
    target: Target,
    comments: bool,
    bytes: &[u8],
    entry: &str,
) -> Vec<TransferNote> {
    let mut notes = Vec::new();
    if !codec.lossless() {
        notes.push(
            TransferNote::warning(
                "il documento si legge con l'importatore di WordCraft: ciò che l'importatore \
                 non legge (note, commenti, caselle di testo, forme, gran parte degli stili) \
                 non arriva nella copia",
            )
            .about(entry),
        );
    }
    let copy = match target.reread(bytes) {
        Ok(copy) => copy,
        Err(error) => {
            notes.push(
                TransferNote::warning(format!(
                    "la copia {} non si rilegge ({error}): non si sa dire cosa porta",
                    target.name()
                ))
                .about(entry),
            );
            return notes;
        }
    };
    let before = Inventory::of(document);
    let after = Inventory::of(&copy);
    let printed = comments && target.prints_comments();
    let mut missing = Vec::new();
    for item in Item::ALL {
        let (had, has) = (before.count(item), after.count(item));
        if has >= had {
            continue;
        }
        if item == Item::Comments && printed {
            notes.push(
                TransferNote::info(format!(
                    "{} in fondo alla copia, come testo",
                    item.counted(had)
                ))
                .about(entry),
            );
            continue;
        }
        missing.push(match has {
            0 => item.counted(had),
            has => format!("{} su {had}", item.counted(had - has)),
        });
    }
    if !missing.is_empty() {
        notes.push(
            TransferNote::warning(format!(
                "la copia {} non porta: {}",
                target.name(),
                missing.join(", ")
            ))
            .about(entry),
        );
    }
    if target != Target::WordXml {
        notes.push(
            TransferNote::info(format!(
                "impaginazione, caratteri, colori e stili dei paragrafi restano come il formato {} \
                 sa dirli: il confronto non li misura",
                target.name()
            ))
            .about(entry),
        );
    }
    notes
}

/// Una voce dell'inventario.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Item {
    Words,
    Headings,
    ListItems,
    Tables,
    Links,
    Bold,
    Italic,
    Underline,
    Strike,
    Highlight,
    Superscript,
    Subscript,
    Caps,
    SmallCaps,
    Footnotes,
    Endnotes,
    Comments,
    HeadersFooters,
    Images,
    Graphics,
    Shapes,
    Equations,
    Fields,
    Bookmarks,
    Revisions,
    Opaque,
}

impl Item {
    pub const ALL: [Item; 26] = [
        Item::Words,
        Item::Headings,
        Item::ListItems,
        Item::Tables,
        Item::Links,
        Item::Bold,
        Item::Italic,
        Item::Underline,
        Item::Strike,
        Item::Highlight,
        Item::Superscript,
        Item::Subscript,
        Item::Caps,
        Item::SmallCaps,
        Item::Footnotes,
        Item::Endnotes,
        Item::Comments,
        Item::HeadersFooters,
        Item::Images,
        Item::Graphics,
        Item::Shapes,
        Item::Equations,
        Item::Fields,
        Item::Bookmarks,
        Item::Revisions,
        Item::Opaque,
    ];

    /// `n` di questa voce, in italiano, con il singolare dove serve.
    fn counted(self, n: usize) -> String {
        let (one, many) = match self {
            Item::Words => ("parola", "parole"),
            Item::Headings => ("titolo", "titoli"),
            Item::ListItems => ("voce d'elenco", "voci d'elenco"),
            Item::Tables => ("tabella", "tabelle"),
            Item::Links => ("link", "link"),
            Item::Bold => ("carattere in grassetto", "caratteri in grassetto"),
            Item::Italic => ("carattere in corsivo", "caratteri in corsivo"),
            Item::Underline => ("carattere sottolineato", "caratteri sottolineati"),
            Item::Strike => ("carattere barrato", "caratteri barrati"),
            Item::Highlight => ("carattere evidenziato", "caratteri evidenziati"),
            Item::Superscript => ("carattere in apice", "caratteri in apice"),
            Item::Subscript => ("carattere in pedice", "caratteri in pedice"),
            Item::Caps => ("carattere in maiuscolo", "caratteri in maiuscolo"),
            Item::SmallCaps => ("carattere in maiuscoletto", "caratteri in maiuscoletto"),
            Item::Footnotes => ("nota a piè di pagina", "note a piè di pagina"),
            Item::Endnotes => ("nota di chiusura", "note di chiusura"),
            Item::Comments => ("commento", "commenti"),
            Item::HeadersFooters => (
                "intestazione o piè di pagina",
                "intestazioni e piè di pagina",
            ),
            Item::Images => ("immagine", "immagini"),
            Item::Graphics => ("grafico o SmartArt", "grafici e SmartArt"),
            Item::Shapes => ("forma o casella di testo", "forme e caselle di testo"),
            Item::Equations => ("equazione", "equazioni"),
            Item::Fields => ("campo", "campi"),
            Item::Bookmarks => ("segnalibro", "segnalibri"),
            Item::Revisions => ("revisione tracciata", "revisioni tracciate"),
            Item::Opaque => ("oggetto non interpretato", "oggetti non interpretati"),
        };
        format!("{n} {}", if n == 1 { one } else { many })
    }
}

/// Quanto di ciascuna [`Item`] ha un documento.
///
/// Le parole e l'enfasi si contano nel corpo, dove un formato di testo le
/// porta; gli oggetti in tutto il documento, intestazioni, note e caselle
/// comprese. L'enfasi si conta in caratteri che non sono spazi, perché un
/// esportatore può spezzare o unire i tratti senza cambiare ciò che si vede.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Inventory {
    counts: BTreeMap<Item, usize>,
}

impl Inventory {
    pub fn of(document: &Document) -> Inventory {
        let mut inventory = Inventory::default();
        inventory.blocks(document, &document.body, Place::Body);
        for part in document.parts.values() {
            if matches!(part.kind, PartKind::Header | PartKind::Footer) && !part.blocks.is_empty() {
                inventory.add(Item::HeadersFooters, 1);
            }
            let place = match part.kind {
                PartKind::Footnote | PartKind::Endnote => Place::Note,
                _ => Place::Part,
            };
            inventory.blocks(document, &part.blocks, place);
        }
        inventory.add(Item::Comments, document.comments.len());
        inventory.add(Item::Revisions, document.revisions.len());
        inventory
    }

    pub fn count(&self, item: Item) -> usize {
        self.counts.get(&item).copied().unwrap_or(0)
    }

    fn add(&mut self, item: Item, n: usize) {
        if n > 0 {
            *self.counts.entry(item).or_default() += n;
        }
    }

    fn blocks(&mut self, document: &Document, blocks: &[Arc<Block>], place: Place) {
        let body = place == Place::Body;
        for block in blocks {
            match &**block {
                Block::Para(paragraph) => {
                    if body {
                        self.add(
                            Item::Words,
                            paragraph.plain_text().split_whitespace().count(),
                        );
                        match projection::role(document, &paragraph.props) {
                            Role::Heading { .. } => self.add(Item::Headings, 1),
                            Role::List { .. } => self.add(Item::ListItems, 1),
                            Role::Body | Role::Quote => {}
                        }
                        let style = paragraph.props.style.as_deref();
                        let mut link: Option<&str> = None;
                        for (range, props) in paragraph.run_ranges() {
                            let text = paragraph.text.get(range).unwrap_or_default();
                            let visible = text
                                .chars()
                                .filter(|c| !c.is_whitespace() && *c != wordcraft_doc::para::OBJ)
                                .count();
                            let here = props.link.as_deref();
                            for mark in projection::marks(&document.styles, style, props) {
                                // Il sottolineato di un link è il suo aspetto,
                                // e viaggia con il link.
                                if mark == Mark::U && here.is_some() {
                                    continue;
                                }
                                self.add(mark_item(mark), visible);
                            }
                            if here.is_some() && here != link {
                                self.add(Item::Links, 1);
                            }
                            link = here;
                        }
                    }
                    for object in &paragraph.objects {
                        // Una nota porta in sé il segno del proprio rimando:
                        // la nota si conta dove la si richiama.
                        let mark = matches!(object, InlineObject::NoteRef { .. });
                        if let Some(item) =
                            object_item(object).filter(|_| !mark || place != Place::Note)
                        {
                            self.add(item, 1);
                        }
                    }
                }
                Block::Table(table) => {
                    if body {
                        self.add(Item::Tables, 1);
                    }
                    for cell in table.rows.iter().flat_map(|row| &row.cells) {
                        self.blocks(document, &cell.blocks, place);
                    }
                }
            }
        }
    }
}

/// Dove sta un blocco che l'inventario conta.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    Body,
    Note,
    Part,
}

fn mark_item(mark: Mark) -> Item {
    match mark {
        Mark::B => Item::Bold,
        Mark::I => Item::Italic,
        Mark::U => Item::Underline,
        Mark::S => Item::Strike,
        Mark::H => Item::Highlight,
        Mark::Sup => Item::Superscript,
        Mark::Sub => Item::Subscript,
        Mark::Caps => Item::Caps,
        Mark::SmallCaps => Item::SmallCaps,
    }
}

fn object_item(object: &InlineObject) -> Option<Item> {
    Some(match object {
        InlineObject::Image { .. } => Item::Images,
        InlineObject::Graphic { .. } => Item::Graphics,
        InlineObject::Shape { .. } | InlineObject::Group { .. } => Item::Shapes,
        InlineObject::Equation { .. } => Item::Equations,
        InlineObject::Field { .. } | InlineObject::FieldStart { .. } => Item::Fields,
        InlineObject::NoteRef { kind, .. } => match kind {
            NoteKind::Footnote => Item::Footnotes,
            NoteKind::Endnote => Item::Endnotes,
        },
        InlineObject::BookmarkStart { .. } => Item::Bookmarks,
        InlineObject::Opaque { .. } => Item::Opaque,
        _ => return None,
    })
}

const T_TITLE: &str = "cmd.rich.export-copy.title";
const T_DESC: &str = "cmd.rich.export-copy.desc";
const T_DOC: &str = "cmd.rich.export-copy.doc";
const T_FORMAT: &str = "cmd.rich.export-copy.format";
const T_COMMENTS: &str = "cmd.rich.export-copy.comments";
const T_COMMENTS_DESC: &str = "cmd.rich.export-copy.comments.desc";

fn format_key(target: Target) -> String {
    format!("{T_FORMAT}.{}", target.key())
}

/// Il comando «Esporta una copia»: sceglie il documento e il formato e accoda
/// l'export con il comando del contratto, `export.run`. Le copie arrivano
/// nell'attività, dove l'utente le salva.
pub struct RichCommands;

impl RichCommands {
    pub fn boxed() -> Box<dyn CommandProvider> {
        Box::new(RichCommands)
    }
}

impl CommandProvider for RichCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        let formats = Target::ALL
            .into_iter()
            .map(|target| Choice::new(target.key(), Text::key(format_key(target))))
            .collect();
        vec![CommandSpec::new(EXPORT_COPY, Text::key(T_TITLE))
            .describing(Text::key(T_DESC))
            // Accodare l'export è un effetto, ma non tocca il vault: un
            // comando di sola lettura girerebbe in simulazione, e la sua
            // invocazione di `export.run` con lui.
            .with_scope(CommandScope::writing(CommandReach::Session))
            .with_param(ParamSpec::new("doc", Text::key(T_DOC), ParamKind::Document).required())
            .with_param(
                ParamSpec::new("format", Text::key(T_FORMAT), ParamKind::Choice(formats))
                    .required(),
            )
            .with_param(
                ParamSpec::new(OPTION_COMMENTS, Text::key(T_COMMENTS), ParamKind::Bool)
                    .describing(Text::key(T_COMMENTS_DESC)),
            )]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        _mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != EXPORT_COPY {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let spec = self.commands().remove(0);
        spec.validate_args(&args)?;
        let doc = DocId::new(args["doc"].as_str().unwrap_or_default());
        let target = args["format"]
            .as_str()
            .and_then(|key| Target::ALL.into_iter().find(|t| t.key() == key))
            .ok_or_else(|| PluginError::BadArgs("`format` is not an export format".into()))?;
        match codec_of(&*host, &doc) {
            None => {
                return Err(PluginError::BadArgs(
                    format!("`{doc}` is not a word-processing document").into(),
                ))
            }
            Some(codec) if target.is_format_of(codec) => {
                return Err(PluginError::BadArgs(
                    format!("`{doc}` is already a {} document", target.name()).into(),
                ))
            }
            Some(_) => {}
        }
        let request = ExportRequest::new(target.id(), ExportSelection::Documents(vec![doc]))
            .with_options(serde_json::json!({
                OPTION_COMMENTS: args.get(OPTION_COMMENTS).and_then(serde_json::Value::as_bool).unwrap_or(false),
            }));
        let request_json = serde_json::to_string(&request)
            .map_err(|error| PluginError::BadArgs(error.to_string().into()))?;
        // Il modo (prova o esecuzione) è dell'host, e passa con l'invocazione.
        host.run_command(
            EXPORT_RUN,
            serde_json::json!({ "request_json": request_json }),
        )
    }
}

/// Le stringhe del comando.
pub fn catalog() -> Vec<StringCatalog> {
    let named = |mut catalog: StringCatalog, txt: &str| {
        for target in Target::ALL {
            let name = match target {
                Target::Txt => txt,
                target => target.name(),
            };
            catalog = catalog.with(format_key(target), name);
        }
        catalog
    };
    vec![
        named(StringCatalog::new("it"), "Testo semplice")
            .with(T_TITLE, "Esporta una copia")
            .with(
                T_DESC,
                "Scrive una copia del documento di videoscrittura in un altro formato, senza \
                 toccarlo. La copia arriva nell'attività, da salvare dove vuoi, con l'elenco \
                 di ciò che il formato non porta.",
            )
            .with(T_DOC, "Documento")
            .with(T_FORMAT, "Formato")
            .with(T_COMMENTS, "Con i commenti")
            .with(
                T_COMMENTS_DESC,
                "In HTML e nel testo semplice, i commenti in fondo alla copia.",
            ),
        named(StringCatalog::new("en"), "Plain text")
            .with(T_TITLE, "Export a copy")
            .with(
                T_DESC,
                "Writes a copy of the word-processing document in another format without \
                 touching it. The copy appears in Activity, to save wherever you like, with \
                 the list of what the format does not carry.",
            )
            .with(T_DOC, "Document")
            .with(T_FORMAT, "Format")
            .with(T_COMMENTS, "With comments")
            .with(
                T_COMMENTS_DESC,
                "In HTML and plain text, the comments at the end of the copy.",
            ),
    ]
}
