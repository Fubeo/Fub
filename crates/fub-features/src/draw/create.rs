//! «Nuovo disegno»: il comando [`DRAWING_CREATE`], che fa nascere un disegno e
//! lo apre: vuoto, da un modello distribuito con Fub, o dalla copia di un
//! disegno del vault.
//!
//! Il documento lo scrive, a seconda degli argomenti:
//!
//! - **vuoto** (`template` assente o `blank`): il provider dei disegni, con
//!   [`serialize`](fub_abi::FormatProvider::serialize), cioè radice, titolo,
//!   carta e «Livello 1», come il formato della scena vuole per un disegno
//!   nuovo;
//! - **da un modello** (`template`): uno dei sette disegni del modulo
//!   [`templates`], nella lingua di chi lo crea (`en…` dà il file inglese,
//!   ogni altra lingua l'italiano, come per «Disegno»);
//! - **da un disegno del vault** (`from`): il suo testo, com'è. Con un
//!   `template` diverso da `blank` è un errore: un disegno nasce da una cosa
//!   sola. Un file che non è un disegno, che non c'è, o che non è una scena
//!   FubDraw modificabile, è un errore detto prima di scrivere.
//!
//! In tutti i casi il titolo del disegno nuovo è il suo nome: nel modello e
//! nella copia lo scrive [`retitle`](fub_format_svg::retitle), che cambia il
//! solo titolo e rilegge il risultato. Qui si decide soltanto **dove** nasce,
//! con le regole dei nomi che valgono per una nota nuova:
//!
//! - senza nome, il primo nome libero della famiglia «Disegno», «Disegno 1»,
//!   «Disegno 2», … (la convenzione di
//!   [`free_name`](fub_abi::traits::VaultRead::free_name)), nella lingua di
//!   chi lo crea;
//! - con un nome, quel nome: senza estensione riceve `.svg`, con l'estensione
//!   di un altro formato è un errore, e occupato è un conflitto, mai una
//!   sovrascrittura;
//! - un nome semplice va nella cartella `folder`, se c'è; un path resta dov'è;
//! - il nome si scrive nella forma dei nomi che nascono (NFC, segmenti senza
//!   spazi ai bordi) e deve passare la regola dei nomi nuovi del contratto
//!   ([`path_policy::check`] con [`Naming::New`]).
//!
//! In simulazione si fanno gli stessi controlli, documento compreso, e non si
//! scrive niente: il piano nomina il disegno che nascerebbe. Applicato, il
//! comando crea il file con `create_document`, che rifiuta un path occupato
//! anche se qualcuno lo ha preso dopo il controllo, e risponde con `Navigate`,
//! che lo apre. L'annullamento lo manda nel cestino.

use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, InvokeMode, ParamKind, ParamSpec, Undo,
};
use fub_abi::error::PluginError;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::folders;
use fub_abi::rules::path_policy::{self, NameFault, Naming, MAX_SEGMENT_BYTES};
use fub_abi::text::{Arg, StringCatalog, Strings, Text};
use fub_abi::traits::{CommandProvider, HostApi};
use fub_abi::FormatProvider;
use fub_format_svg::{retitle, SvgProvider, FORMAT_ID};

use super::templates::{self, Language, BLANK};

/// Crea un disegno nuovo e lo apre.
pub const DRAWING_CREATE: &str = "drawing.create";

/// L'estensione dei disegni, quella che il provider dei disegni rivendica.
const EXTENSION: &str = "svg";

/// L'inverso di «crea» è «cestina», come per una nota: un inverso reversibile
/// per un gesto reversibile. Id letterale e non import: i moduli di feature
/// non si nominano fra loro.
const TRASH: &str = "note.trash";

/// La lingua del nome libero quando chi crea non ne ha detta una: quella con
/// cui l'host monta i cataloghi dei bundle ufficiali.
const FALLBACK_LANGUAGE: &str = "it";

const NAME: &str = "name";
const FOLDER: &str = "folder";
const TEMPLATE: &str = "template";
const FROM: &str = "from";

const T_TITLE: &str = "drawing.create.title";
const T_DESC: &str = "drawing.create.desc";
const T_NAME: &str = "drawing.create.name.title";
const T_NAME_DESC: &str = "drawing.create.name.desc";
const T_FOLDER: &str = "drawing.create.folder.title";
const T_FOLDER_DESC: &str = "drawing.create.folder.desc";
const T_TEMPLATE: &str = "drawing.create.template.title";
const T_TEMPLATE_DESC: &str = "drawing.create.template.desc";
const T_FROM: &str = "drawing.create.from.title";
const T_FROM_DESC: &str = "drawing.create.from.desc";

/// Il nome di un disegno senza nome, prima del numero che lo rende libero.
const N_UNTITLED: &str = "untitled";
const P_CREATE: &str = "plan_create";
const D_CREATE: &str = "done_create";
const U_CREATE: &str = "undo_create";
const E_NO_FORMAT: &str = "e_no_format";
const E_NOT_A_DRAWING: &str = "e_not_a_drawing";
const E_TAKEN: &str = "e_taken";
const E_SERIALIZE: &str = "e_serialize";
const E_FROM_AND_TEMPLATE: &str = "e_from_and_template";
const E_FROM_NOT_A_DRAWING: &str = "e_from_not_a_drawing";
const E_FROM_MISSING: &str = "e_from_missing";
const E_FROM_UNUSABLE: &str = "e_from_unusable";
const E_NO_TEMPLATE: &str = "e_no_template";
const E_NAME_EMPTY: &str = "e_name_empty";
const E_NAME_TRAVERSAL: &str = "e_name_traversal";
const E_NAME_MACHINE: &str = "e_name_machine";
const E_NAME_CONTROL: &str = "e_name_control";
const E_NAME_RESERVED: &str = "e_name_reserved";
const E_NAME_DEVICE: &str = "e_name_device";
const E_NAME_TRAILING_DOT: &str = "e_name_trailing_dot";
const E_NAME_HIDDEN: &str = "e_name_hidden";
const E_NAME_TOO_LONG: &str = "e_name_too_long";

/// I nomi dei modelli, nell'ordine della scelta `template`. Il nome nella sua
/// lingua è anche il titolo del file del modello, quindi il test sui file li
/// confronta con questi.
pub(super) const TEMPLATE_NAMES_IT: [(&str, &str); 8] = [
    ("blank", "Vuoto"),
    ("a4-portrait", "A4 verticale"),
    ("a4-landscape", "A4 orizzontale"),
    ("slide", "Diapositiva 16:9"),
    ("diagram", "Diagramma di flusso"),
    ("lesson", "Lavagna per la lezione"),
    ("storyboard", "Storyboard"),
    ("concept-map", "Mappa concettuale"),
];

/// I nomi dei modelli in inglese, nello stesso ordine.
pub(super) const TEMPLATE_NAMES_EN: [(&str, &str); 8] = [
    ("blank", "Blank"),
    ("a4-portrait", "A4 portrait"),
    ("a4-landscape", "A4 landscape"),
    ("slide", "16:9 slide"),
    ("diagram", "Flowchart"),
    ("lesson", "Lesson board"),
    ("storyboard", "Storyboard"),
    ("concept-map", "Concept map"),
];

/// La chiave del nome di un modello nel catalogo.
pub(super) fn template_key(id: &str) -> String {
    format!("drawing.create.template.{id}")
}

/// Le stringhe del comando in italiano, aggiunte al catalogo del bundle.
pub(super) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    let catalog = TEMPLATE_NAMES_IT
        .iter()
        .fold(catalog, |catalog, (id, name)| {
            catalog.with(template_key(id), *name)
        });
    catalog
        .with(T_TITLE, "Nuovo disegno")
        .with(
            T_DESC,
            "Crea un disegno e lo apre: vuoto, da uno dei modelli di Fub o come \
             copia di un disegno del vault. Senza nome nasce «Disegno», e se \
             quel nome è preso «Disegno 1», «2», … Il titolo del disegno è il \
             suo nome.",
        )
        .with(T_NAME, "Nome")
        .with(
            T_NAME_DESC,
            "Il nome o il path del disegno. Senza estensione riceve `.svg`. \
             Assente = «Disegno».",
        )
        .with(T_FOLDER, "Cartella")
        .with(
            T_FOLDER_DESC,
            "La cartella in cui nasce un disegno con un nome semplice. Assente = \
             la radice del vault.",
        )
        .with(T_TEMPLATE, "Modello")
        .with(
            T_TEMPLATE_DESC,
            "Il modello da cui nasce il disegno: Vuoto, A4 verticale, A4 \
             orizzontale, Diapositiva 16:9, Diagramma di flusso, Lavagna per la \
             lezione, Storyboard o Mappa concettuale. Assente = Vuoto. Non si \
             usa insieme a «Disegno da copiare».",
        )
        .with(T_FROM, "Disegno da copiare")
        .with(
            T_FROM_DESC,
            "Un disegno del vault da cui nasce quello nuovo, che ne è la copia \
             col suo nome per titolo. Non si usa insieme a un modello.",
        )
        .with(N_UNTITLED, "Disegno")
        .with(P_CREATE, "Crea il disegno «{doc}»")
        .with(D_CREATE, "Creato il disegno «{doc}»")
        .with(U_CREATE, "la creazione del disegno «{doc}»")
        .with(
            E_NO_FORMAT,
            "Questo vault non apre i disegni: nessun formato serve i file `.svg`.",
        )
        .with(
            E_NOT_A_DRAWING,
            "«{doc}» non è il nome di un disegno: un disegno è un file `.svg`.",
        )
        .with(
            E_TAKEN,
            "«{doc}» c'è già: un disegno nuovo non prende il posto di un file.",
        )
        .with(
            E_SERIALIZE,
            "Il disegno «{doc}» non si è potuto scrivere: {reason}",
        )
        .with(
            E_FROM_AND_TEMPLATE,
            "Un disegno nasce da un modello o dalla copia di un altro: «{doc}» e \
             il modello «{template}» non vanno insieme.",
        )
        .with(
            E_FROM_NOT_A_DRAWING,
            "«{doc}» non è un disegno: si copia un file `.svg` del vault.",
        )
        .with(
            E_FROM_MISSING,
            "Il disegno «{doc}» da copiare non c'è nel vault.",
        )
        .with(
            E_FROM_UNUSABLE,
            "«{doc}» non si può copiare come disegno nuovo: {reason}",
        )
        .with(E_NO_TEMPLATE, "«{template}» non è un modello di disegno.")
        .with(
            E_NAME_EMPTY,
            "Il disegno non può chiamarsi «{doc}»: manca il nome.",
        )
        .with(
            E_NAME_TRAVERSAL,
            "Il disegno non può chiamarsi «{doc}»: «.» e «..» non sono nomi.",
        )
        .with(
            E_NAME_MACHINE,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» è il modo in cui il \
             vault è fatto, non ciò che contiene.",
        )
        .with(
            E_NAME_CONTROL,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» contiene un carattere \
             di controllo.",
        )
        .with(
            E_NAME_RESERVED,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» contiene «{ch}», che \
             un filesystem si riserva.",
        )
        .with(
            E_NAME_DEVICE,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» è un nome che Windows \
             si riserva.",
        )
        .with(
            E_NAME_TRAILING_DOT,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» finisce con un punto, \
             che Windows toglie.",
        )
        .with(
            E_NAME_HIDDEN,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» comincia con un punto, \
             e il vault non lo elencherebbe.",
        )
        .with(
            E_NAME_TOO_LONG,
            "Il disegno non può chiamarsi «{doc}»: «{segment}» è troppo lungo (il \
             massimo è {max} byte).",
        )
}

/// Le stesse stringhe in inglese.
pub(super) fn in_english(catalog: StringCatalog) -> StringCatalog {
    let catalog = TEMPLATE_NAMES_EN
        .iter()
        .fold(catalog, |catalog, (id, name)| {
            catalog.with(template_key(id), *name)
        });
    catalog
        .with(T_TITLE, "New drawing")
        .with(
            T_DESC,
            "Creates a drawing and opens it: empty, from one of Fub's templates \
             or as a copy of a drawing in the vault. Without a name it is called \
             «Drawing», and if that name is taken «Drawing 1», «2», … The title \
             of the drawing is its name.",
        )
        .with(T_NAME, "Name")
        .with(
            T_NAME_DESC,
            "The name or the path of the drawing. Without an extension it gets \
             `.svg`. Absent = «Drawing».",
        )
        .with(T_FOLDER, "Folder")
        .with(
            T_FOLDER_DESC,
            "The folder where a drawing with a plain name is created. Absent = the \
             root of the vault.",
        )
        .with(T_TEMPLATE, "Template")
        .with(
            T_TEMPLATE_DESC,
            "The template the drawing starts from: Blank, A4 portrait, A4 \
             landscape, 16:9 slide, Flowchart, Lesson board, Storyboard or \
             Concept map. Absent = Blank. Not used together with «Drawing to \
             copy».",
        )
        .with(T_FROM, "Drawing to copy")
        .with(
            T_FROM_DESC,
            "A drawing in the vault the new one starts from: it is a copy, with \
             its own name as the title. Not used together with a template.",
        )
        .with(N_UNTITLED, "Drawing")
        .with(P_CREATE, "Create the drawing «{doc}»")
        .with(D_CREATE, "Created the drawing «{doc}»")
        .with(U_CREATE, "the creation of the drawing «{doc}»")
        .with(
            E_NO_FORMAT,
            "This vault does not open drawings: no format serves `.svg` files.",
        )
        .with(
            E_NOT_A_DRAWING,
            "«{doc}» is not the name of a drawing: a drawing is an `.svg` file.",
        )
        .with(
            E_TAKEN,
            "«{doc}» already exists: a new drawing does not replace a file.",
        )
        .with(
            E_SERIALIZE,
            "The drawing «{doc}» could not be written: {reason}",
        )
        .with(
            E_FROM_AND_TEMPLATE,
            "A drawing starts from a template or from a copy of another: «{doc}» \
             and the template «{template}» do not go together.",
        )
        .with(
            E_FROM_NOT_A_DRAWING,
            "«{doc}» is not a drawing: what gets copied is an `.svg` file of the \
             vault.",
        )
        .with(
            E_FROM_MISSING,
            "The drawing «{doc}» to copy is not in the vault.",
        )
        .with(
            E_FROM_UNUSABLE,
            "«{doc}» cannot be copied as a new drawing: {reason}",
        )
        .with(E_NO_TEMPLATE, "«{template}» is not a drawing template.")
        .with(
            E_NAME_EMPTY,
            "The drawing cannot be called «{doc}»: the name is missing.",
        )
        .with(
            E_NAME_TRAVERSAL,
            "The drawing cannot be called «{doc}»: «.» and «..» are not names.",
        )
        .with(
            E_NAME_MACHINE,
            "The drawing cannot be called «{doc}»: «{segment}» is how the vault is \
             made, not what it holds.",
        )
        .with(
            E_NAME_CONTROL,
            "The drawing cannot be called «{doc}»: «{segment}» contains a control \
             character.",
        )
        .with(
            E_NAME_RESERVED,
            "The drawing cannot be called «{doc}»: «{segment}» contains «{ch}», which \
             a filesystem reserves.",
        )
        .with(
            E_NAME_DEVICE,
            "The drawing cannot be called «{doc}»: «{segment}» is a name Windows \
             reserves.",
        )
        .with(
            E_NAME_TRAILING_DOT,
            "The drawing cannot be called «{doc}»: «{segment}» ends with a dot, which \
             Windows removes.",
        )
        .with(
            E_NAME_HIDDEN,
            "The drawing cannot be called «{doc}»: «{segment}» starts with a dot, and \
             the vault would not list it.",
        )
        .with(
            E_NAME_TOO_LONG,
            "The drawing cannot be called «{doc}»: «{segment}» is too long (at most \
             {max} bytes).",
        )
}

/// I comandi del bundle: [`DRAWING_CREATE`] e
/// [`PDF_ANNOTATE`](super::PDF_ANNOTATE), che vive nel modulo `annotate`.
pub struct DrawCommands;

impl DrawCommands {
    /// La spec, anche fuori dal trait: una sola, per l'elenco e per i test.
    pub fn spec() -> CommandSpec {
        CommandSpec::new(DRAWING_CREATE, Text::key(T_TITLE))
            .describing(Text::key(T_DESC))
            .with_param(
                ParamSpec::new(NAME, Text::key(T_NAME), ParamKind::Text)
                    .describing(Text::key(T_NAME_DESC)),
            )
            .with_param(
                ParamSpec::new(FOLDER, Text::key(T_FOLDER), ParamKind::Text)
                    .describing(Text::key(T_FOLDER_DESC)),
            )
            .with_param(
                ParamSpec::new(
                    TEMPLATE,
                    Text::key(T_TEMPLATE),
                    ParamKind::Choice(
                        templates::ids()
                            .map(|id| Choice::new(id, Text::key(template_key(id))))
                            .collect(),
                    ),
                )
                .describing(Text::key(T_TEMPLATE_DESC)),
            )
            .with_param(
                ParamSpec::new(FROM, Text::key(T_FROM), ParamKind::Document)
                    .describing(Text::key(T_FROM_DESC)),
            )
            // Un documento solo, e il cestino lo rende reversibile: lo stesso
            // raggio di `note.create`, quindi la palette lo esegue senza
            // mostrare prima il piano.
            .with_scope(CommandScope::writing(CommandReach::Document))
    }
}

impl CommandProvider for DrawCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![DrawCommands::spec(), super::annotate::spec()]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command == super::PDF_ANNOTATE {
            return super::annotate::invoke(args, mode, host);
        }
        if command != DRAWING_CREATE {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let args = Args::new(&args);
        let start = Start::of(&args)?;
        let doc = target(args.text(NAME), args.text(FOLDER), host)?;
        let source = start.source(&doc, host)?;
        if mode.is_dry_run() {
            let plan = CommandPlan::of_edits(one(P_CREATE, &doc), Vec::new()).with_doc(doc);
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        // `create_document` e non `write_document`: se nel frattempo qualcuno
        // ha preso il nome, il disegno non nasce al posto suo.
        host.create_document(&doc, &source)?;
        let undo = Undo::by_command(
            one(U_CREATE, &doc),
            TRASH,
            serde_json::json!({ "doc": doc.as_str() }),
        );
        Ok(CommandOutcome::notify(one(D_CREATE, &doc))
            .undoable(undo)
            .with_effect(CommandEffect::Navigate { doc }))
    }
}

/// Il disegno che nasce dagli argomenti, dopo ogni controllo che si può fare
/// prima di scrivere.
fn target(
    name: Option<&str>,
    folder: Option<&str>,
    host: &dyn HostApi,
) -> Result<DocId, PluginError> {
    let drawing = |doc: &DocId| {
        host.format_of(doc)
            .is_some_and(|format| format.descriptor.id == FORMAT_ID)
    };
    // Prima il vault, poi il nome: senza il formato dei disegni nessun nome
    // ne fa nascere uno. La domanda è quella di `new_note_extension`, un nome
    // qualsiasi con l'estensione, e il formato decide da sé maiuscole e
    // minuscole.
    if !drawing(&DocId::new(format!("x.{EXTENSION}"))) {
        return Err(PluginError::BadArgs(Text::key(E_NO_FORMAT)));
    }
    let folder = folder.map(path_policy::from_outside);
    let folder = folder
        .as_deref()
        .map(folders::normalized)
        .filter(|folder| !folder.is_empty());
    let placed = |name: &str| match folder {
        Some(folder) if !name.contains('/') => format!("{folder}/{name}"),
        _ => name.to_string(),
    };
    let name = name
        .map(path_policy::from_outside)
        .filter(|name| !name.is_empty());
    let doc = match name {
        Some(name) => {
            let written = placed(&name);
            // «Scienze/» non nomina un disegno: senza questo controllo
            // diventerebbe «Scienze/.svg», e il guasto sarebbe il punto in testa
            // di un nome che nessuno ha scritto.
            if written
                .rsplit('/')
                .next()
                .is_some_and(|last| last.trim().is_empty())
            {
                return Err(bad_name(&written, &NameFault::Empty));
            }
            new_name(&crate::formats::with_extension(host, &written, EXTENSION))?
        }
        None => {
            let stem = untitled(host);
            host.free_name(&new_name(&placed(&format!("{stem}.{EXTENSION}")))?)
        }
    };
    if !drawing(&doc) {
        return Err(PluginError::BadArgs(one(E_NOT_A_DRAWING, &doc)));
    }
    // Il controllo che `create_document` rifarà, detto prima: il piano non
    // promette un disegno che non può nascere. Un nome scelto da `free_name`
    // lo passa per costruzione; un nome dato può essere di qualcun altro.
    if host.free_name(&doc) != doc {
        return Err(PluginError::AlreadyExists(one(E_TAKEN, &doc)));
    }
    Ok(doc)
}

/// Il nome nella forma con cui nasce sul disco, se la regola dei nomi nuovi
/// lo ammette. È la forma che `create_document` scriverà, quindi il piano e
/// `Navigate` nominano il file che c'è davvero.
fn new_name(written: &str) -> Result<DocId, PluginError> {
    path_policy::check(written, Naming::New).map_err(|fault| bad_name(written, &fault))?;
    Ok(DocId::new(path_policy::normalized(written)))
}

/// Il nome di un disegno senza nome nella lingua di chi lo crea, dal catalogo
/// del bundle: la stessa voce che la sua descrizione promette.
fn untitled(host: &dyn HostApi) -> String {
    let locale = host.user_locale();
    let catalogs = super::catalog();
    Strings::new(&catalogs, FALLBACK_LANGUAGE, &locale).render(&Text::key(N_UNTITLED))
}

/// Da che cosa nasce il disegno.
enum Start {
    /// Il documento nuovo del provider dei disegni.
    Blank,
    /// Uno dei modelli di Fub.
    Template(String),
    /// La copia di un disegno del vault.
    Copy(DocId),
}

impl Start {
    /// Che cosa chiedono gli argomenti. `from` con un modello che non sia
    /// `blank` è un errore: un disegno nasce da una cosa sola.
    fn of(args: &Args) -> Result<Self, PluginError> {
        let template = args.text(TEMPLATE).filter(|template| *template != BLANK);
        let from = args.text(FROM).map(path_policy::from_outside);
        match (from, template) {
            (Some(from), Some(template)) => Err(PluginError::BadArgs(Text::message(
                E_FROM_AND_TEMPLATE,
                vec![Arg::text("doc", from), Arg::text("template", template)],
            ))),
            (Some(from), None) => Ok(Start::Copy(DocId::new(from))),
            (None, Some(template)) => Ok(Start::Template(template.to_string())),
            (None, None) => Ok(Start::Blank),
        }
    }

    /// Il testo del disegno che nasce come `doc`, scritto e riletto prima di
    /// toccare il vault.
    ///
    /// Il vuoto porta soltanto l'id al provider: il titolo è il nome del file,
    /// e l'id del primo livello viene dal nome, quindi lo stesso nome dà
    /// sempre lo stesso file. Un modello e una copia hanno già il loro testo,
    /// e cambia il solo titolo, che diventa il nome di `doc`.
    fn source(&self, doc: &DocId, host: &dyn HostApi) -> Result<String, PluginError> {
        match self {
            Start::Blank => SvgProvider::new()
                .serialize(&DocumentModel::empty(doc.clone()))
                .map_err(|error| unwritable(doc, &error.to_string())),
            Start::Template(id) => {
                let language = Language::of(&host.user_locale());
                let text = templates::source(id, language).ok_or_else(|| {
                    PluginError::BadArgs(Text::message(
                        E_NO_TEMPLATE,
                        vec![Arg::text("template", id.as_str())],
                    ))
                })?;
                retitle(text, doc.page_name()).map_err(|error| unwritable(doc, &error.to_string()))
            }
            Start::Copy(from) => {
                let drawing = host
                    .format_of(from)
                    .is_some_and(|format| format.descriptor.id == FORMAT_ID);
                if !drawing {
                    return Err(PluginError::BadArgs(one(E_FROM_NOT_A_DRAWING, from)));
                }
                let text = match host.read_document(from) {
                    Ok(text) => text,
                    Err(PluginError::NotFound(_)) => {
                        return Err(PluginError::NotFound(one(E_FROM_MISSING, from)));
                    }
                    Err(other) => return Err(other),
                };
                retitle(&text, doc.page_name()).map_err(|error| {
                    PluginError::BadArgs(Text::message(
                        E_FROM_UNUSABLE,
                        vec![
                            Arg::text("doc", from.as_str()),
                            Arg::text("reason", error.to_string()),
                        ],
                    ))
                })
            }
        }
    }
}

/// Il guasto di un disegno che non si è potuto scrivere: non è colpa degli
/// argomenti.
fn unwritable(doc: &DocId, reason: &str) -> PluginError {
    PluginError::Internal(Text::message(
        E_SERIALIZE,
        vec![Arg::text("doc", doc.as_str()), Arg::text("reason", reason)],
    ))
}

/// Il guasto di un nome, nella frase del catalogo. Il `match` è esaustivo di
/// proposito: un guasto nuovo nel contratto non compila finché non ha la sua
/// frase.
fn bad_name(written: &str, fault: &NameFault) -> PluginError {
    let key = match fault {
        NameFault::Empty => E_NAME_EMPTY,
        NameFault::Traversal { .. } => E_NAME_TRAVERSAL,
        NameFault::Machine { .. } => E_NAME_MACHINE,
        NameFault::Control { .. } => E_NAME_CONTROL,
        NameFault::Reserved { .. } => E_NAME_RESERVED,
        NameFault::Device { .. } => E_NAME_DEVICE,
        NameFault::TrailingDot { .. } => E_NAME_TRAILING_DOT,
        NameFault::Hidden { .. } => E_NAME_HIDDEN,
        NameFault::TooLong { .. } => E_NAME_TOO_LONG,
    };
    let mut args = vec![Arg::text("doc", written)];
    if let Some(segment) = fault.segment() {
        args.push(Arg::text("segment", segment));
    }
    match fault {
        NameFault::Reserved { ch, .. } | NameFault::Control { ch, .. } => {
            args.push(Arg::text("ch", ch.to_string()));
        }
        NameFault::TooLong { .. } => args.push(Arg::int("max", MAX_SEGMENT_BYTES as i64)),
        _ => {}
    }
    PluginError::BadArgs(Text::message(key, args))
}

/// Un messaggio sul disegno.
fn one(key: &str, doc: &DocId) -> Text {
    Text::message(key, vec![Arg::text("doc", doc.as_str())])
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::command::UndoStep;
    use fub_abi::format::{DocumentFormat, FormatCapabilities};
    use fub_abi::locale::Locale;
    use fub_abi::traits::VaultRead;
    use fub_sdk::testing::MemoryHost;
    use serde_json::json;

    /// Un host che serve i disegni come il vault con la feature `draw`.
    fn host() -> MemoryHost {
        MemoryHost::new().with_format(
            EXTENSION,
            DocumentFormat {
                descriptor: SvgProvider::new().descriptor(),
                capabilities: FormatCapabilities::default(),
            },
        )
    }

    /// Come farebbe il kernel: prima la convalida contro la spec, poi la
    /// chiamata.
    fn invoke(
        host: &mut MemoryHost,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        DrawCommands::spec().validate_args(&args)?;
        DrawCommands.invoke(DRAWING_CREATE, args, mode, host)
    }

    fn created(outcome: CommandOutcome) -> DocId {
        match outcome.effect {
            CommandEffect::Navigate { doc } => doc,
            other => panic!("un disegno creato si apre, non {other:?}"),
        }
    }

    fn planned(outcome: CommandOutcome) -> Vec<DocId> {
        match outcome.effect {
            CommandEffect::Plan(plan) => plan.docs,
            other => panic!("una simulazione risponde con un piano, non {other:?}"),
        }
    }

    /// Un testo come lo legge chi guarda, nella lingua data.
    fn rendered(text: &Text, language: &str) -> String {
        let catalogs = super::super::catalog();
        let locale = Locale {
            language: language.to_string(),
            ..Locale::default()
        };
        Strings::new(&catalogs, FALLBACK_LANGUAGE, &locale).render(text)
    }

    fn message(error: &PluginError) -> String {
        rendered(error.message(), "it")
    }

    #[test]
    fn the_spec_reaches_one_document_and_asks_nothing() {
        let specs = DrawCommands.commands();
        assert_eq!(specs.len(), 2, "«Nuovo disegno» e «Annota il PDF»");
        let spec = &specs[0];
        assert_eq!(spec.id, DRAWING_CREATE);
        assert!(spec.params.iter().all(|param| !param.required));
        assert!(spec.scope.writes && spec.scope.reversible);
        assert_eq!(spec.scope.reach, CommandReach::Document);
        assert_eq!(rendered(&spec.title, "it"), "Nuovo disegno");
        assert_eq!(rendered(&spec.title, "en"), "New drawing");
    }

    /// Gli id dei modelli nell'ordine in cui la scelta li propone.
    const TEMPLATE_IDS: [&str; 8] = [
        "blank",
        "a4-portrait",
        "a4-landscape",
        "slide",
        "diagram",
        "lesson",
        "storyboard",
        "concept-map",
    ];

    fn param<'a>(spec: &'a CommandSpec, name: &str) -> &'a ParamSpec {
        spec.params
            .iter()
            .find(|param| param.name == name)
            .unwrap_or_else(|| panic!("manca il parametro `{name}`"))
    }

    #[test]
    fn the_spec_offers_the_templates_in_order_and_a_drawing_to_copy() {
        let spec = DrawCommands::spec();
        let names: Vec<_> = spec.params.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["name", "folder", "template", "from"]);

        let template = param(&spec, TEMPLATE);
        let ParamKind::Choice(choices) = &template.kind else {
            panic!("`template` è una scelta: {:?}", template.kind)
        };
        let values: Vec<_> = choices.iter().map(|c| c.value.as_str()).collect();
        assert_eq!(values, TEMPLATE_IDS);
        // Ogni scelta ha il suo nome nelle due lingue, e sono quelli della
        // tabella dei nomi.
        for (choice, ((_, it), (_, en))) in choices
            .iter()
            .zip(TEMPLATE_NAMES_IT.iter().zip(TEMPLATE_NAMES_EN.iter()))
        {
            assert_eq!(&rendered(&choice.title, "it"), it, "{}", choice.value);
            assert_eq!(&rendered(&choice.title, "en"), en, "{}", choice.value);
        }
        assert_eq!(rendered(&choices[0].title, "it"), "Vuoto");
        assert_eq!(rendered(&choices[0].title, "en"), "Blank");
        assert_eq!(rendered(&choices[3].title, "it"), "Diapositiva 16:9");
        assert_eq!(rendered(&choices[7].title, "en"), "Concept map");

        let from = param(&spec, FROM);
        assert!(matches!(from.kind, ParamKind::Document), "{:?}", from.kind);
        for name in [TEMPLATE, FROM] {
            let p = param(&spec, name);
            assert!(!p.required, "{name}");
            for language in ["it", "en"] {
                assert!(!rendered(&p.title, language).is_empty(), "{name}");
                let description = rendered(&p.description, language);
                assert!(!description.is_empty(), "{name} in {language}");
                assert!(
                    !description.starts_with("drawing.create"),
                    "{name} in {language}: la chiave non ha voce"
                );
            }
        }

        // La convalida della spec ammette i modelli e nient'altro.
        for id in TEMPLATE_IDS {
            assert!(
                spec.validate_args(&json!({ "template": id })).is_ok(),
                "{id}"
            );
        }
        assert!(spec
            .validate_args(&json!({ "template": "cartolina" }))
            .is_err());
        assert!(spec.validate_args(&json!({ "template": 3 })).is_err());
        assert!(spec
            .validate_args(&json!({ "from": "Origine.svg" }))
            .is_ok());
        assert!(spec.validate_args(&json!({ "from": 3 })).is_err());
    }

    #[test]
    fn the_template_table_has_one_name_per_choice() {
        let ids: Vec<_> = TEMPLATE_NAMES_IT.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, TEMPLATE_IDS);
        let ids: Vec<_> = TEMPLATE_NAMES_EN.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, TEMPLATE_IDS);
        let files: Vec<_> = templates::ids().collect();
        assert_eq!(files, TEMPLATE_IDS);
        for catalog in super::super::catalog() {
            for id in TEMPLATE_IDS {
                assert!(
                    catalog.entries.contains_key(&template_key(id)),
                    "«{}»: manca il nome di `{id}`",
                    catalog.locale
                );
            }
        }
    }

    #[test]
    fn a_drawing_without_a_name_takes_the_first_free_one() {
        let mut host = host();
        let first = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(first.as_str(), "Disegno.svg");
        let second = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(second.as_str(), "Disegno 1.svg");
        let placed = created(
            invoke(
                &mut host,
                json!({ "folder": "/Scienze/" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(placed.as_str(), "Scienze/Disegno.svg");
    }

    #[test]
    fn the_free_name_speaks_the_language_of_who_creates_it() {
        let english = Locale {
            language: "en-GB".to_string(),
            ..Locale::default()
        };
        let mut abroad = host().with_locale(english);
        let doc = created(invoke(&mut abroad, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(doc.as_str(), "Drawing.svg");
        let source = abroad.read_document(&doc).unwrap();
        assert!(source.contains("<title>Drawing</title>"), "{source}");

        // Una lingua senza catalogo scende a quella dei cataloghi ufficiali.
        let german = Locale {
            language: "de".to_string(),
            ..Locale::default()
        };
        let mut elsewhere = host().with_locale(german);
        let doc = created(invoke(&mut elsewhere, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(doc.as_str(), "Disegno.svg");
    }

    #[test]
    fn the_new_file_is_the_providers_new_document() {
        let mut host = host();
        let doc = created(
            invoke(
                &mut host,
                json!({ "name": "Ciclo dell'acqua", "folder": "Scienze" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(doc.as_str(), "Scienze/Ciclo dell'acqua.svg");
        let source = host.read_document(&doc).unwrap();
        let expected = SvgProvider::new()
            .serialize(&DocumentModel::empty(doc.clone()))
            .unwrap();
        assert_eq!(source, expected);
        assert!(
            source.contains("<title>Ciclo dell'acqua</title>"),
            "{source}"
        );
        assert!(source.contains("Livello 1"), "{source}");
    }

    #[test]
    fn a_name_keeps_its_place_and_gets_the_extension() {
        let mut host = host();
        let cases = [
            (json!({ "name": "Gatto" }), "Gatto.svg"),
            (json!({ "name": "Mappa.SVG" }), "Mappa.SVG"),
            // Il punto è del nome: `.2` non è un formato.
            (json!({ "name": "Report v1.2" }), "Report v1.2.svg"),
            (
                json!({ "name": "Gatto", "folder": "Animali" }),
                "Animali/Gatto.svg",
            ),
            // Un path esplicito non viene ribasato.
            (
                json!({ "name": "Altrove/Gatto", "folder": "Animali" }),
                "Altrove/Gatto.svg",
            ),
            // Le barre di Windows e gli spazi ai bordi sono del varco.
            (json!({ "name": " Mari\\Onda " }), "Mari/Onda.svg"),
            // Nasce in NFC, ed è quello il file che si apre.
            (json!({ "name": "Cafe\u{301}" }), "Caf\u{e9}.svg"),
        ];
        for (args, expected) in cases {
            let doc = created(invoke(&mut host, args.clone(), InvokeMode::Apply).unwrap());
            assert_eq!(doc.as_str(), expected, "{args}");
            assert!(host.read_document(&doc).is_ok(), "{expected} esiste");
        }
    }

    #[test]
    fn a_taken_name_is_a_conflict_and_nothing_is_overwritten() {
        let mut host = host().with_document("Gatto.svg", "<svg/>");
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = invoke(&mut host, json!({ "name": "Gatto" }), mode).unwrap_err();
            assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
            assert_eq!(
                message(&error),
                "«Gatto.svg» c'è già: un disegno nuovo non prende il posto di un file."
            );
        }
        assert_eq!(
            host.read_document(&DocId::new("Gatto.svg")).unwrap(),
            "<svg/>"
        );
        // Senza nome, invece, il nome libero è il successivo.
        let mut host = host_with(&["Disegno.svg", "Disegno 1.svg"]);
        let doc = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(doc.as_str(), "Disegno 2.svg");
    }

    fn host_with(docs: &[&str]) -> MemoryHost {
        docs.iter()
            .fold(host(), |host, doc| host.with_document(doc, "<svg/>"))
    }

    #[test]
    fn another_format_is_not_a_drawing() {
        let mut host = host();
        let error = invoke(
            &mut host,
            json!({ "name": "Appunti.md" }),
            InvokeMode::Apply,
        )
        .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        assert_eq!(
            message(&error),
            "«Appunti.md» non è il nome di un disegno: un disegno è un file `.svg`."
        );
        assert!(host.read_document(&DocId::new("Appunti.md")).is_err());
        // Anche quando quel nome è preso: prima si dice che non è un disegno.
        let mut host = host_with(&[]).with_document("Appunti.md", "# Appunti");
        let error = invoke(
            &mut host,
            json!({ "name": "Appunti.md" }),
            InvokeMode::DryRun,
        )
        .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    }

    #[test]
    fn a_vault_without_drawings_creates_none() {
        let mut host = MemoryHost::new();
        // Anche un nome di un altro formato: il guasto è del vault, non del nome.
        for args in [
            json!({}),
            json!({ "name": "Gatto.svg" }),
            json!({ "name": "Appunti.md" }),
        ] {
            let error = invoke(&mut host, args, InvokeMode::Apply).unwrap_err();
            assert_eq!(
                message(&error),
                "Questo vault non apre i disegni: nessun formato serve i file `.svg`."
            );
        }
        assert!(host.read_document(&DocId::new("Disegno.svg")).is_err());
    }

    #[test]
    fn a_name_that_cannot_be_born_is_said_before_writing() {
        let mut host = host();
        let long = "a".repeat(MAX_SEGMENT_BYTES);
        let cases = [
            (
                "Scienze/",
                "Il disegno non può chiamarsi «Scienze/»: manca il nome.",
            ),
            (
                "../Gatto",
                "Il disegno non può chiamarsi «../Gatto.svg»: «.» e «..» non sono nomi.",
            ),
            (
                ".fub/Gatto",
                "Il disegno non può chiamarsi «.fub/Gatto.svg»: «.fub» è il modo in cui \
                 il vault è fatto, non ciò che contiene.",
            ),
            (
                "Gatto\u{7}",
                "Il disegno non può chiamarsi «Gatto\u{7}.svg»: «Gatto\u{7}.svg» contiene \
                 un carattere di controllo.",
            ),
            (
                "Scienze: acqua",
                "Il disegno non può chiamarsi «Scienze: acqua.svg»: «Scienze: acqua.svg» \
                 contiene «:», che un filesystem si riserva.",
            ),
            (
                "CON",
                "Il disegno non può chiamarsi «CON.svg»: «CON.svg» è un nome che Windows \
                 si riserva.",
            ),
            (
                "Gatto.",
                "Il disegno non può chiamarsi «Gatto.»: «Gatto.» finisce con un punto, \
                 che Windows toglie.",
            ),
            (
                ".Gatto",
                "Il disegno non può chiamarsi «.Gatto.svg»: «.Gatto.svg» comincia con un \
                 punto, e il vault non lo elencherebbe.",
            ),
        ];
        for (name, expected) in cases {
            for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
                let error = invoke(&mut host, json!({ "name": name }), mode).unwrap_err();
                assert!(
                    matches!(error, PluginError::BadArgs(_)),
                    "{name}: {error:?}"
                );
                assert_eq!(message(&error), expected, "{name}");
            }
        }
        let error = invoke(&mut host, json!({ "name": long }), InvokeMode::Apply).unwrap_err();
        assert!(
            message(&error).ends_with("è troppo lungo (il massimo è 255 byte)."),
            "{}",
            message(&error)
        );
        assert!(
            host.list_documents(None).unwrap().items.is_empty(),
            "niente è nato"
        );
    }

    #[test]
    fn the_plan_names_the_drawing_and_writes_nothing() {
        let mut host = host();
        let outcome = invoke(&mut host, json!({ "name": "Gatto" }), InvokeMode::DryRun).unwrap();
        assert_eq!(planned(outcome), [DocId::new("Gatto.svg")]);
        assert!(host.read_document(&DocId::new("Gatto.svg")).is_err());
        let outcome = invoke(&mut host, json!({}), InvokeMode::DryRun).unwrap();
        assert_eq!(planned(outcome), [DocId::new("Disegno.svg")]);
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn the_creation_says_what_it_did_and_undoes_to_the_trash() {
        let mut host = host();
        let outcome = invoke(&mut host, json!({ "name": "Gatto" }), InvokeMode::Apply).unwrap();
        assert_eq!(
            rendered(outcome.notify.as_ref().unwrap(), "it"),
            "Creato il disegno «Gatto.svg»"
        );
        let undo = outcome.undo.clone().expect("la creazione si annulla");
        assert_eq!(
            rendered(&undo.label, "en"),
            "the creation of the drawing «Gatto.svg»"
        );
        assert_eq!(
            undo.steps,
            [UndoStep::Command {
                command: TRASH.to_string(),
                args: json!({ "doc": "Gatto.svg" }),
            }]
        );
    }

    #[test]
    fn every_language_names_an_untitled_drawing_that_can_be_born() {
        for catalog in super::super::catalog() {
            let stem = &catalog.entries[N_UNTITLED];
            let name = format!("{stem} 12.{EXTENSION}");
            assert!(
                path_policy::check(&name, Naming::New).is_ok(),
                "«{}»: «{name}»",
                catalog.locale
            );
        }
    }

    /// Il file di un modello come sta sul disco, letto a runtime: una strada
    /// diversa da quella di `include_str!` con cui il binario lo porta dentro.
    fn template_file(id: &str, language: &str) -> String {
        let path = format!(
            "{}/templates/{id}.{language}.svg",
            env!("CARGO_MANIFEST_DIR")
        );
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"))
    }

    /// Un host la cui lingua è `language`.
    fn host_in(language: &str) -> MemoryHost {
        host().with_locale(Locale {
            language: language.to_string(),
            ..Locale::default()
        })
    }

    #[test]
    fn a_blank_template_is_the_empty_drawing_of_today() {
        let mut absent = host();
        let first =
            created(invoke(&mut absent, json!({ "name": "Gatto" }), InvokeMode::Apply).unwrap());
        let mut blank = host();
        let second = created(
            invoke(
                &mut blank,
                json!({ "name": "Gatto", "template": "blank" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(first, second);
        assert_eq!(
            absent.read_document(&first).unwrap(),
            blank.read_document(&second).unwrap()
        );
        assert_eq!(
            blank.read_document(&second).unwrap(),
            SvgProvider::new()
                .serialize(&DocumentModel::empty(second.clone()))
                .unwrap()
        );
    }

    #[test]
    fn every_template_in_both_languages_is_the_retitled_file() {
        let name = "Ciclo dell'acqua & il mare";
        for (language, code) in [("it", "it"), ("en", "en")] {
            for id in &TEMPLATE_IDS[1..] {
                let mut host = host_in(code);
                let doc = created(
                    invoke(
                        &mut host,
                        json!({ "name": name, "template": id }),
                        InvokeMode::Apply,
                    )
                    .unwrap(),
                );
                assert_eq!(doc.as_str(), format!("{name}.svg"));
                let written = host.read_document(&doc).unwrap();
                let file = template_file(id, language);
                let expected = retitle(&file, name).unwrap();
                assert_eq!(written, expected, "{id} in {language}");
                // Cambia il solo titolo.
                let scene = fub_scene::read(&written).unwrap();
                assert!(scene.editable(), "{id} in {language}");
                assert_eq!(
                    scene.index.title.map(|title| title.text).as_deref(),
                    Some(name),
                    "{id} in {language}"
                );
                let original = fub_scene::read(&file).unwrap();
                assert_eq!(scene.summary.layers, original.summary.layers);
                assert_eq!(scene.summary.boards, original.summary.boards);
                assert_eq!(scene.summary.counts, original.summary.counts);
                assert!(written.contains("&amp;"), "{id}: il nome è escapato");
            }
        }
    }

    #[test]
    fn the_language_of_the_file_is_the_one_of_who_creates_it() {
        let cases = [
            ("en", "en"),
            ("en-GB", "en"),
            ("en_US", "en"),
            ("EN", "en"),
            ("it", "it"),
            ("it-CH", "it"),
            ("de", "it"),
            ("fr-CA", "it"),
            ("und", "it"),
            ("", "it"),
        ];
        for (locale, file) in cases {
            let mut host = host_in(locale);
            let doc = created(
                invoke(
                    &mut host,
                    json!({ "name": "Prova", "template": "slide" }),
                    InvokeMode::Apply,
                )
                .unwrap(),
            );
            let expected = retitle(&template_file("slide", file), "Prova").unwrap();
            assert_eq!(host.read_document(&doc).unwrap(), expected, "{locale:?}");
        }
        // Senza una lingua detta, quella di serie.
        let mut plain = host();
        let doc = created(
            invoke(
                &mut plain,
                json!({ "name": "Prova", "template": "slide" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(
            plain.read_document(&doc).unwrap(),
            retitle(&template_file("slide", "it"), "Prova").unwrap()
        );
    }

    #[test]
    fn a_template_without_a_name_takes_the_free_name_in_the_language_of_the_file() {
        let mut host = host_in("en-GB");
        let doc = created(
            invoke(
                &mut host,
                json!({ "template": "storyboard" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(doc.as_str(), "Drawing.svg");
        let source = host.read_document(&doc).unwrap();
        assert!(source.contains("<title>Drawing</title>"), "{source}");
        let doc = created(
            invoke(
                &mut host,
                json!({ "template": "storyboard", "folder": "Scene" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(doc.as_str(), "Scene/Drawing.svg");
    }

    #[test]
    fn a_template_keeps_the_plan_the_undo_and_the_navigation() {
        let mut host = host();
        let outcome = invoke(
            &mut host,
            json!({ "name": "Lezione", "template": "lesson" }),
            InvokeMode::DryRun,
        )
        .unwrap();
        assert_eq!(planned(outcome), [DocId::new("Lezione.svg")]);
        assert!(host.read_document(&DocId::new("Lezione.svg")).is_err());

        let outcome = invoke(
            &mut host,
            json!({ "name": "Lezione", "template": "lesson" }),
            InvokeMode::Apply,
        )
        .unwrap();
        assert_eq!(
            rendered(outcome.notify.as_ref().unwrap(), "it"),
            "Creato il disegno «Lezione.svg»"
        );
        assert_eq!(
            outcome.undo.clone().expect("si annulla").steps,
            [UndoStep::Command {
                command: TRASH.to_string(),
                args: json!({ "doc": "Lezione.svg" }),
            }]
        );
        assert_eq!(created(outcome), DocId::new("Lezione.svg"));

        // Un nome preso resta un conflitto, anche con un modello.
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = invoke(
                &mut host,
                json!({ "name": "Lezione", "template": "lesson" }),
                mode,
            )
            .unwrap_err();
            assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
        }
    }

    #[test]
    fn an_unknown_template_is_refused_even_without_the_spec() {
        let mut host = host();
        let error = DrawCommands
            .invoke(
                DRAWING_CREATE,
                json!({ "template": "cartolina" }),
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        assert_eq!(message(&error), "«cartolina» non è un modello di disegno.");
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    /// Un disegno del vault con un oggetto in più, per vedere che la copia lo
    /// porta con sé.
    fn origin() -> String {
        let source = SvgProvider::new()
            .serialize(&DocumentModel::empty(DocId::new("Origine.svg")))
            .unwrap();
        source.replace(
            "  </g>\n",
            "    <rect id=\"r1\" x=\"10\" y=\"20\" width=\"30\" height=\"40\" fill=\"#ff0000\"/>\n  </g>\n",
        )
    }

    #[test]
    fn a_copy_is_the_source_with_the_new_name_as_title() {
        let origin = origin();
        assert!(origin.contains("id=\"r1\""));
        let mut host = host().with_document("Classe/Origine.svg", &origin);
        let doc = created(
            invoke(
                &mut host,
                json!({ "name": "Copia & incolla", "from": "Classe/Origine.svg", "folder": "Altro" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(doc.as_str(), "Altro/Copia & incolla.svg");
        let written = host.read_document(&doc).unwrap();
        assert_eq!(
            written,
            origin.replace(
                "<title>Origine</title>",
                "<title>Copia &amp; incolla</title>"
            )
        );
        // La sorgente non si tocca.
        assert_eq!(
            host.read_document(&DocId::new("Classe/Origine.svg"))
                .unwrap(),
            origin
        );
        let scene = fub_scene::read(&written).unwrap();
        assert!(scene.editable());
        assert_eq!(scene.summary.counts.shapes, 1);
    }

    #[test]
    fn a_copy_without_a_name_takes_the_free_name_and_its_title() {
        let mut host = host_in("en").with_document("Origine.svg", &origin());
        let doc = created(
            invoke(
                &mut host,
                json!({ "from": "Origine.svg" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(doc.as_str(), "Drawing.svg");
        assert!(host
            .read_document(&doc)
            .unwrap()
            .contains("<title>Drawing</title>"));
    }

    #[test]
    fn a_copy_of_a_drawing_without_a_title_gets_one() {
        let bare = origin().replace("  <title>Origine</title>\n", "");
        assert!(!bare.contains("<title"));
        let mut host = host().with_document("Senza.svg", &bare);
        let doc = created(
            invoke(
                &mut host,
                json!({ "name": "Con titolo", "from": "Senza.svg" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        let written = host.read_document(&doc).unwrap();
        assert!(
            written.contains("\n  <title>Con titolo</title>\n  <rect"),
            "{written}"
        );
    }

    #[test]
    fn a_copy_may_say_blank_as_its_template() {
        let mut host = host().with_document("Origine.svg", &origin());
        let doc = created(
            invoke(
                &mut host,
                json!({ "name": "Gemello", "from": "Origine.svg", "template": "blank" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert!(host.read_document(&doc).unwrap().contains("id=\"r1\""));
    }

    #[test]
    fn a_copy_and_a_template_do_not_go_together() {
        let mut host = host().with_document("Origine.svg", &origin());
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            for id in &TEMPLATE_IDS[1..] {
                let error = invoke(
                    &mut host,
                    json!({ "name": "Nuovo", "from": "Origine.svg", "template": id }),
                    mode,
                )
                .unwrap_err();
                assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
                assert_eq!(
                    message(&error),
                    format!(
                        "Un disegno nasce da un modello o dalla copia di un altro: \
                         «Origine.svg» e il modello «{id}» non vanno insieme."
                    )
                );
                assert_eq!(
                    rendered(error.message(), "en"),
                    format!(
                        "A drawing starts from a template or from a copy of another: \
                         «Origine.svg» and the template «{id}» do not go together."
                    )
                );
            }
        }
        assert!(host.read_document(&DocId::new("Nuovo.svg")).is_err());
    }

    #[test]
    fn a_source_that_is_not_a_drawing_is_said_before_writing() {
        let mut host = host()
            .with_document("Appunti.md", "# Appunti")
            .with_document(
                "Estraneo.svg",
                "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>",
            )
            .with_document("Rotto.svg", "<svg")
            .with_document(
                "Doctype.svg",
                &origin().replace("<svg ", "<!DOCTYPE svg>\n<svg "),
            );
        for from in ["Appunti.md", "foto.png"] {
            for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
                let error =
                    invoke(&mut host, json!({ "name": "Nuovo", "from": from }), mode).unwrap_err();
                assert!(
                    matches!(error, PluginError::BadArgs(_)),
                    "{from}: {error:?}"
                );
                assert_eq!(
                    message(&error),
                    format!("«{from}» non è un disegno: si copia un file `.svg` del vault.")
                );
            }
        }
        // Un file `.svg` che il programma non sa modificare: lo dice, con la ragione.
        for from in ["Estraneo.svg", "Rotto.svg", "Doctype.svg"] {
            for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
                let error =
                    invoke(&mut host, json!({ "name": "Nuovo", "from": from }), mode).unwrap_err();
                assert!(
                    matches!(error, PluginError::BadArgs(_)),
                    "{from}: {error:?}"
                );
                let said = message(&error);
                assert!(
                    said.starts_with(&format!("«{from}» non si può copiare come disegno nuovo: ")),
                    "{said}"
                );
                assert!(!said.ends_with(": "), "{said}");
                assert!(rendered(error.message(), "en")
                    .starts_with(&format!("«{from}» cannot be copied as a new drawing: ")));
            }
        }
        // Una sorgente che non c'è.
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = invoke(
                &mut host,
                json!({ "name": "Nuovo", "from": "Manca.svg" }),
                mode,
            )
            .unwrap_err();
            assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
            assert_eq!(
                message(&error),
                "Il disegno «Manca.svg» da copiare non c'è nel vault."
            );
            assert_eq!(
                rendered(error.message(), "en"),
                "The drawing «Manca.svg» to copy is not in the vault."
            );
        }
        assert!(host.read_document(&DocId::new("Nuovo.svg")).is_err());
    }

    #[test]
    fn the_name_of_the_copy_is_checked_before_its_source() {
        let mut host = host().with_document("Origine.svg", &origin());
        let error = invoke(
            &mut host,
            json!({ "name": "Appunti.md", "from": "Origine.svg" }),
            InvokeMode::Apply,
        )
        .unwrap_err();
        assert_eq!(
            message(&error),
            "«Appunti.md» non è il nome di un disegno: un disegno è un file `.svg`."
        );
        let error = invoke(
            &mut host,
            json!({ "name": "Origine", "from": "Origine.svg" }),
            InvokeMode::DryRun,
        )
        .unwrap_err();
        assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
    }

    #[test]
    fn the_plan_of_a_copy_names_the_drawing_and_writes_nothing() {
        let mut host = host().with_document("Origine.svg", &origin());
        let outcome = invoke(
            &mut host,
            json!({ "name": "Gemello", "from": "Origine.svg" }),
            InvokeMode::DryRun,
        )
        .unwrap();
        assert_eq!(planned(outcome), [DocId::new("Gemello.svg")]);
        assert!(host.read_document(&DocId::new("Gemello.svg")).is_err());
    }

    #[test]
    fn every_language_names_every_template_that_the_choice_offers() {
        let spec = DrawCommands::spec();
        let ParamKind::Choice(choices) = &param(&spec, TEMPLATE).kind else {
            panic!("`template` è una scelta")
        };
        for catalog in super::super::catalog() {
            for choice in choices {
                let Text::Message(message) = &choice.title else {
                    panic!("il titolo di `{}` è una chiave", choice.value)
                };
                assert!(
                    catalog.entries.contains_key(&message.key),
                    "«{}»: manca `{}`",
                    catalog.locale,
                    message.key
                );
            }
        }
    }

    #[test]
    fn another_command_is_not_this_one() {
        let mut host = host();
        let error = DrawCommands
            .invoke("drawing.delete", json!({}), InvokeMode::Apply, &mut host)
            .unwrap_err();
        assert!(matches!(error, PluginError::UnknownCommand(_)), "{error:?}");
    }
}
