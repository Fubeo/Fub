//! «Nuovo documento» e «Nuovo foglio»: i comandi che fanno nascere un file
//! vuoto di un formato a byte composto dall'host e lo aprono.
//!
//! Sono `canvas.create` e `drawing.create` per i formati che non hanno una
//! feature in `fub-features`: il documento di Word (`document.create`, con il
//! bundle [`fub.rich`](crate::rich)) e la cartella di Excel (`sheet.create`,
//! con il bundle [`fub.xlsx`](crate::workbook)). Le regole dei nomi sono le
//! stesse:
//!
//! - senza nome, il primo nome libero della famiglia «Documento senza
//!   titolo», «Documento senza titolo 1», … (la convenzione di
//!   [`free_name`](fub_abi::traits::VaultRead::free_name)), nella lingua di chi
//!   lo crea;
//! - con un nome, quel nome: senza estensione riceve quella del formato, con
//!   l'estensione di un altro formato è un errore, e occupato è un conflitto,
//!   mai una sovrascrittura;
//! - un nome semplice va nella cartella `folder`, se c'è; un path resta dov'è;
//! - il nome si scrive nella forma dei nomi che nascono e deve passare la
//!   regola dei nomi nuovi del contratto ([`path_policy::check`] con
//!   [`Naming::New`]).
//!
//! I byte li scrive il codec del formato ([`NewFile::blank`]), riletti da lui
//! prima di toccare il vault. In simulazione si fanno gli stessi controlli e
//! non si scrive niente: il piano nomina il file che nascerebbe. Applicato, il
//! comando scrive con `write_document_bytes` senza revisione attesa, cioè
//! soltanto se il path è libero, passando dal `Guard` e dalla scrittura
//! atomica del kernel, e risponde con `Navigate`, che lo apre. L'annullamento
//! lo manda nel cestino.
//!
//! Il comando appartiene al bundle del formato: spento il bundle, o spenta la
//! feature di `fub-host` che lo porta, il comando non è dichiarato.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, Undo,
};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::rules::folders;
use fub_abi::rules::path_policy::{self, NameFault, Naming, MAX_SEGMENT_BYTES};
use fub_abi::text::{Arg, StringCatalog, Strings, Text};
use fub_abi::traits::{CommandProvider, HostApi};

const NAME: &str = "name";
const FOLDER: &str = "folder";

/// L'inverso di «crea» è «cestina», come per una nota, un disegno e una
/// lavagna: id letterale, il comando è di un altro bundle.
const TRASH: &str = "note.trash";

/// La lingua del nome libero quando chi crea non ne ha detta una: quella con
/// cui l'host monta i cataloghi dei suoi bundle.
const FALLBACK_LANGUAGE: &str = crate::settings::CORE_DEFAULT_LOCALE;

/// Le parole di un formato in una lingua: i pezzi che i template del
/// componente ([`TEMPLATES`]) compongono, più le voci sue.
pub(crate) struct Words {
    pub(crate) locale: &'static str,
    /// Il titolo del comando: «Nuovo documento».
    pub(crate) title: &'static str,
    /// La descrizione del comando.
    pub(crate) desc: &'static str,
    /// Il nome di un file senza nome, prima del numero che lo rende libero.
    pub(crate) untitled: &'static str,
    /// «il documento», con l'articolo.
    pub(crate) the: &'static str,
    /// «del documento».
    pub(crate) of_the: &'static str,
    /// «un documento».
    pub(crate) a: &'static str,
    /// «un documento nuovo».
    pub(crate) a_new: &'static str,
    /// «i documenti di Word»: ciò che un vault senza il formato non apre.
    pub(crate) all: &'static str,
    /// Le voci del formato oltre ai template (`<comando>.<chiave>`), lette dal
    /// suo [`NewFile::blank`].
    pub(crate) extra: &'static [(&'static str, &'static str)],
}

/// Rende una voce del componente (`<comando>.<chiave>`) nella lingua di chi
/// crea.
pub(crate) type Say<'a> = &'a dyn Fn(&str) -> String;

/// I byte di un file vuoto, o il perché no detto dal codec.
pub(crate) type Blank = fn(doc: &DocId, say: Say<'_>) -> Result<Vec<u8>, String>;

/// Un formato che nasce vuoto da un comando.
pub(crate) struct NewFile {
    /// L'id del comando: `document.create`.
    pub(crate) command: &'static str,
    /// L'id del formato che il file nuovo deve avere.
    pub(crate) format: &'static str,
    /// L'estensione del file nuovo, senza punto: la sola che il comando
    /// scrive, anche quando il formato ne serve altre.
    pub(crate) extension: &'static str,
    /// Le parole, una voce per lingua.
    pub(crate) words: &'static [Words],
    /// I byte del file vuoto che nascerà come `doc`, già riletti dal codec, o
    /// il perché no detto dal codec; `say` rende una voce del componente
    /// (`<comando>.<chiave>`) nella lingua di chi crea.
    pub(crate) blank: Blank,
}

/// I template comuni, con le parole del formato fra `%`: chiave dopo l'id del
/// comando, italiano, inglese.
const TEMPLATES: &[(&str, &str, &str)] = &[
    ("name.title", "Nome", "Name"),
    (
        "name.desc",
        "Il nome o il path %of_the%. Senza estensione riceve `.%ext%`. Assente = «%untitled%».",
        "The name or the path of %the%. Without an extension it gets `.%ext%`. Absent = «%untitled%».",
    ),
    ("folder.title", "Cartella", "Folder"),
    (
        "folder.desc",
        "La cartella in cui nasce %a% con un nome semplice. Assente = la radice del vault.",
        "The folder where %a% with a plain name is created. Absent = the root of the vault.",
    ),
    ("p_create", "Crea %the% «{doc}»", "Create %the% «{doc}»"),
    ("n_created", "Creato %the% «{doc}»", "Created %the% «{doc}»"),
    (
        "u_create",
        "la creazione %of_the% «{doc}»",
        "the creation of %the% «{doc}»",
    ),
    (
        "e_no_format",
        "Questo vault non apre %all%: nessun formato serve i file `.%ext%`.",
        "This vault does not open %all%: no format serves `.%ext%` files.",
    ),
    (
        "e_name_other",
        "«{doc}» non è il nome di %a%: %a_new% è un file `.%ext%`.",
        "«{doc}» is not the name of %a%: %a_new% is a `.%ext%` file.",
    ),
    (
        "e_taken",
        "«{doc}» c'è già: %a_new% non prende il posto di un file.",
        "«{doc}» already exists: %a_new% does not replace a file.",
    ),
    (
        "e_bytes",
        "%The% «{doc}» non si è potuto scrivere: {reason}",
        "%The% «{doc}» could not be written: {reason}",
    ),
    (
        "e_name_empty",
        "%The% non può chiamarsi «{doc}»: manca il nome.",
        "%The% cannot be called «{doc}»: the name is missing.",
    ),
    (
        "e_name_traversal",
        "%The% non può chiamarsi «{doc}»: «.» e «..» non sono nomi.",
        "%The% cannot be called «{doc}»: «.» and «..» are not names.",
    ),
    (
        "e_name_machine",
        "%The% non può chiamarsi «{doc}»: «{segment}» è il modo in cui il vault è fatto, non ciò che contiene.",
        "%The% cannot be called «{doc}»: «{segment}» is how the vault is made, not what it holds.",
    ),
    (
        "e_name_control",
        "%The% non può chiamarsi «{doc}»: «{segment}» contiene un carattere di controllo.",
        "%The% cannot be called «{doc}»: «{segment}» contains a control character.",
    ),
    (
        "e_name_reserved",
        "%The% non può chiamarsi «{doc}»: «{segment}» contiene «{ch}», che un filesystem si riserva.",
        "%The% cannot be called «{doc}»: «{segment}» contains «{ch}», which a filesystem reserves.",
    ),
    (
        "e_name_device",
        "%The% non può chiamarsi «{doc}»: «{segment}» è un nome che Windows si riserva.",
        "%The% cannot be called «{doc}»: «{segment}» is a name Windows reserves.",
    ),
    (
        "e_name_trailing_dot",
        "%The% non può chiamarsi «{doc}»: «{segment}» finisce con un punto, che Windows toglie.",
        "%The% cannot be called «{doc}»: «{segment}» ends with a dot, which Windows removes.",
    ),
    (
        "e_name_hidden",
        "%The% non può chiamarsi «{doc}»: «{segment}» comincia con un punto, e il vault non lo elencherebbe.",
        "%The% cannot be called «{doc}»: «{segment}» starts with a dot, and the vault would not list it.",
    ),
    (
        "e_name_too_long",
        "%The% non può chiamarsi «{doc}»: «{segment}» è troppo lungo (il massimo è {max} byte).",
        "%The% cannot be called «{doc}»: «{segment}» is too long (at most {max} bytes).",
    ),
];

impl NewFile {
    /// La chiave `<comando>.<suffisso>`.
    fn key(&self, suffix: &str) -> String {
        format!("{}.{suffix}", self.command)
    }

    /// Il catalogo del componente, una voce per lingua: si somma a quello del
    /// bundle del formato.
    pub(crate) fn catalog(&self) -> Vec<StringCatalog> {
        self.words
            .iter()
            .map(|words| {
                let italian = words.locale.starts_with("it");
                let mut catalog = StringCatalog::new(words.locale)
                    .with(self.key("title"), words.title)
                    .with(self.key("desc"), words.desc)
                    .with(self.key("untitled"), words.untitled);
                for (suffix, it, en) in TEMPLATES {
                    let template = if italian { it } else { en };
                    catalog = catalog.with(self.key(suffix), self.fill(template, words));
                }
                for (suffix, text) in words.extra {
                    catalog = catalog.with(self.key(suffix), *text);
                }
                catalog
            })
            .collect()
    }

    /// Un template con le parole del formato.
    fn fill(&self, template: &str, words: &Words) -> String {
        template
            .replace("%The%", &capitalized(words.the))
            .replace("%the%", words.the)
            .replace("%of_the%", words.of_the)
            .replace("%a_new%", words.a_new)
            .replace("%a%", words.a)
            .replace("%all%", words.all)
            .replace("%ext%", self.extension)
            .replace("%untitled%", words.untitled)
    }

    /// La spec del comando.
    pub(crate) fn spec(&self) -> CommandSpec {
        let parameter = |name: &str| {
            ParamSpec::new(
                name,
                Text::key(self.key(&format!("{name}.title"))),
                ParamKind::Text,
            )
            .describing(Text::key(self.key(&format!("{name}.desc"))))
        };
        CommandSpec::new(self.command, Text::key(self.key("title")))
            .describing(Text::key(self.key("desc")))
            .with_param(parameter(NAME))
            .with_param(parameter(FOLDER))
            // Un documento solo, e il cestino lo rende reversibile: lo stesso
            // raggio di `note.create`, `drawing.create` e `canvas.create`.
            .with_scope(CommandScope::writing(CommandReach::Document))
    }

    /// Crea il file, o in simulazione dice quale nascerebbe.
    fn create(
        &self,
        args: Args<'_>,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let doc = self.target(args.text(NAME), args.text(FOLDER), &*host)?;
        if mode.is_dry_run() {
            let plan = CommandPlan::of_edits(self.one("p_create", &doc), Vec::new()).with_doc(doc);
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        let bytes = {
            let catalogs = self.catalog();
            let locale = host.user_locale();
            let strings = Strings::new(&catalogs, FALLBACK_LANGUAGE, &locale);
            let say = |suffix: &str| strings.render(&Text::key(self.key(suffix)));
            (self.blank)(&doc, &say).map_err(|error| self.unwritable(&doc, error))?
        };
        // Nessuna revisione attesa: il file nasce soltanto se il path è
        // ancora libero, anche se qualcuno lo ha preso dopo il controllo.
        host.write_document_bytes(&doc, &bytes, None)?;
        let undo = Undo::by_command(
            self.one("u_create", &doc),
            TRASH,
            serde_json::json!({ "doc": doc.as_str() }),
        );
        Ok(CommandOutcome::notify(self.one("n_created", &doc))
            .undoable(undo)
            .with_effect(CommandEffect::Navigate { doc }))
    }

    /// Il file che nasce dagli argomenti, dopo ogni controllo che si può fare
    /// prima di scrivere.
    fn target(
        &self,
        name: Option<&str>,
        folder: Option<&str>,
        host: &dyn HostApi,
    ) -> Result<DocId, PluginError> {
        let ours = |doc: &DocId| {
            host.format_of(doc)
                .is_some_and(|format| format.descriptor.id == self.format)
                && extension(doc.as_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case(self.extension))
        };
        // Prima il vault, poi il nome: senza il formato nessun nome ne fa
        // nascere uno.
        if !ours(&DocId::new(format!("x.{}", self.extension))) {
            return Err(PluginError::BadArgs(Text::key(self.key("e_no_format"))));
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
                // «Lettere/» non nomina un file: senza questo controllo
                // diventerebbe «Lettere/.docx».
                if written
                    .rsplit('/')
                    .next()
                    .is_some_and(|last| last.trim().is_empty())
                {
                    return Err(self.bad_name(&written, &NameFault::Empty));
                }
                self.new_name(&self.with_extension(host, &written))?
            }
            None => {
                let stem = self.untitled(host);
                host.free_name(&self.new_name(&placed(&format!("{stem}.{}", self.extension)))?)
            }
        };
        if !ours(&doc) {
            return Err(PluginError::BadArgs(self.one("e_name_other", &doc)));
        }
        // Il controllo che la scrittura rifarà, detto prima: il piano non
        // promette un file che non può nascere.
        if host.free_name(&doc) != doc {
            return Err(PluginError::AlreadyExists(self.one("e_taken", &doc)));
        }
        Ok(doc)
    }

    /// Il nome scelto con l'estensione del formato, se il suo ultimo segmento
    /// non ne porta già una servita da un formato del vault: `Relazione`
    /// diventa `Relazione.docx`, `Piano v1.2` diventa `Piano v1.2.docx`.
    fn with_extension(&self, host: &dyn HostApi, name: &str) -> String {
        let last = name.rsplit('/').next().unwrap_or(name);
        if last.ends_with('.') || host.format_of(&DocId::new(name)).is_some() {
            name.to_string()
        } else {
            format!("{name}.{}", self.extension)
        }
    }

    /// Il nome nella forma con cui nasce sul disco, se la regola dei nomi
    /// nuovi lo ammette.
    fn new_name(&self, written: &str) -> Result<DocId, PluginError> {
        path_policy::check(written, Naming::New).map_err(|fault| self.bad_name(written, &fault))?;
        Ok(DocId::new(path_policy::normalized(written)))
    }

    /// Il nome di un file senza nome nella lingua di chi lo crea.
    fn untitled(&self, host: &dyn HostApi) -> String {
        let locale = host.user_locale();
        let catalogs = self.catalog();
        Strings::new(&catalogs, FALLBACK_LANGUAGE, &locale).render(&Text::key(self.key("untitled")))
    }

    /// Il guasto di un file che il codec non ha saputo scrivere: non è colpa
    /// degli argomenti.
    fn unwritable(&self, doc: &DocId, reason: String) -> PluginError {
        PluginError::Internal(Text::message(
            self.key("e_bytes"),
            vec![Arg::text("doc", doc.as_str()), Arg::text("reason", reason)],
        ))
    }

    /// Il guasto di un nome, nella frase del catalogo. Il `match` è
    /// esaustivo di proposito: un guasto nuovo nel contratto non compila
    /// finché non ha la sua frase.
    fn bad_name(&self, written: &str, fault: &NameFault) -> PluginError {
        let suffix = match fault {
            NameFault::Empty => "e_name_empty",
            NameFault::Traversal { .. } => "e_name_traversal",
            NameFault::Machine { .. } => "e_name_machine",
            NameFault::Control { .. } => "e_name_control",
            NameFault::Reserved { .. } => "e_name_reserved",
            NameFault::Device { .. } => "e_name_device",
            NameFault::TrailingDot { .. } => "e_name_trailing_dot",
            NameFault::Hidden { .. } => "e_name_hidden",
            NameFault::TooLong { .. } => "e_name_too_long",
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
        PluginError::BadArgs(Text::message(self.key(suffix), args))
    }

    /// Un messaggio sul file.
    fn one(&self, suffix: &str, doc: &DocId) -> Text {
        Text::message(self.key(suffix), vec![Arg::text("doc", doc.as_str())])
    }
}

/// L'estensione dell'ultimo segmento, senza punto.
fn extension(path: &str) -> Option<&str> {
    let last = path.rsplit('/').next().unwrap_or(path);
    last.rsplit_once('.').map(|(_, ext)| ext)
}

fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Il comando di un [`NewFile`] come provider di comandi del suo bundle.
pub(crate) struct NewFileCommands(pub(crate) &'static NewFile);

impl CommandProvider for NewFileCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![self.0.spec()]
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != self.0.command {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        self.0.create(Args::new(&args), mode, host)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::command::UndoStep;
    use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor, SourceKind};
    use fub_abi::locale::Locale;
    use fub_abi::traits::VaultRead;
    use fub_sdk::testing::MemoryHost;
    use serde_json::json;

    /// Un formato di prova: i byte sono il nome del primo «foglio».
    static PROVA: NewFile = NewFile {
        command: "prova.create",
        format: "prova",
        extension: "prv",
        words: &[
            Words {
                locale: "it",
                title: "Nuova prova",
                desc: "Crea una prova vuota.",
                untitled: "Prova senza titolo",
                the: "la prova",
                of_the: "della prova",
                a: "una prova",
                a_new: "una prova nuova",
                all: "le prove",
                extra: &[("first", "Pagina1")],
            },
            Words {
                locale: "en",
                title: "New test",
                desc: "Creates an empty test.",
                untitled: "Untitled test",
                the: "the test",
                of_the: "the test",
                a: "a test",
                a_new: "a new test",
                all: "tests",
                extra: &[("first", "Page1")],
            },
        ],
        blank: |_doc, say| Ok(say("first").into_bytes()),
    };

    fn host() -> MemoryHost {
        MemoryHost::new().with_format(
            "prv",
            DocumentFormat {
                descriptor: FormatDescriptor {
                    source: SourceKind::Bytes,
                    ..FormatDescriptor::text("prova", "Prova", &["prv"])
                },
                capabilities: FormatCapabilities::default(),
            },
        )
    }

    fn invoke(
        host: &mut MemoryHost,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        PROVA.spec().validate_args(&args)?;
        NewFileCommands(&PROVA).invoke(PROVA.command, args, mode, host)
    }

    fn created(outcome: CommandOutcome) -> DocId {
        match outcome.effect {
            CommandEffect::Navigate { doc } => doc,
            other => panic!("un file creato si apre, non {other:?}"),
        }
    }

    fn rendered(text: &Text, language: &str) -> String {
        let catalogs = PROVA.catalog();
        let locale = Locale {
            language: language.to_string(),
            ..Locale::default()
        };
        Strings::new(&catalogs, FALLBACK_LANGUAGE, &locale).render(text)
    }

    #[test]
    fn senza_nome_prende_il_primo_nome_libero_nella_lingua_di_chi_crea() {
        let mut host = host();
        let first = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(first.as_str(), "Prova senza titolo.prv");
        assert_eq!(host.read_document_bytes(&first).unwrap(), b"Pagina1");
        let second = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(second.as_str(), "Prova senza titolo 1.prv");
        let placed = created(
            invoke(
                &mut host,
                json!({ "folder": "/Lavoro/" }),
                InvokeMode::Apply,
            )
            .unwrap(),
        );
        assert_eq!(placed.as_str(), "Lavoro/Prova senza titolo.prv");

        let english = Locale {
            language: "en-GB".to_string(),
            ..Locale::default()
        };
        let mut abroad = super::tests::host().with_locale(english);
        let doc = created(invoke(&mut abroad, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(doc.as_str(), "Untitled test.prv");
        assert_eq!(abroad.read_document_bytes(&doc).unwrap(), b"Page1");
    }

    #[test]
    fn un_nome_riceve_l_estensione_e_un_altro_formato_e_rifiutato() {
        let mut host = host();
        let cases = [
            (json!({ "name": "Conti" }), "Conti.prv"),
            (json!({ "name": "Piano v1.2" }), "Piano v1.2.prv"),
            (json!({ "name": "Rosso.PRV" }), "Rosso.PRV"),
            (
                json!({ "name": "Gatto", "folder": "Animali" }),
                "Animali/Gatto.prv",
            ),
        ];
        for (args, expected) in cases {
            let doc = created(invoke(&mut host, args.clone(), InvokeMode::Apply).unwrap());
            assert_eq!(doc.as_str(), expected, "{args}");
        }
        let error = invoke(&mut host, json!({ "name": "Idee.md" }), InvokeMode::Apply)
            .expect_err("una nota non è una prova");
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        assert_eq!(
            rendered(error.message(), "it"),
            "«Idee.md» non è il nome di una prova: una prova nuova è un file `.prv`."
        );
    }

    #[test]
    fn un_nome_preso_e_un_conflitto_e_niente_si_sovrascrive() {
        let mut host = host().with_document("Conti.prv", "vecchio");
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = invoke(&mut host, json!({ "name": "Conti" }), mode).unwrap_err();
            assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
            assert_eq!(
                rendered(error.message(), "it"),
                "«Conti.prv» c'è già: una prova nuova non prende il posto di un file."
            );
        }
        assert_eq!(
            host.read_document(&DocId::new("Conti.prv")).unwrap(),
            "vecchio"
        );
    }

    #[test]
    fn la_prova_a_secco_nomina_il_file_e_non_scrive() {
        let mut host = host();
        let outcome = invoke(&mut host, json!({}), InvokeMode::DryRun).unwrap();
        let CommandEffect::Plan(plan) = outcome.effect else {
            panic!("una simulazione risponde con un piano");
        };
        assert_eq!(plan.docs, [DocId::new("Prova senza titolo.prv")]);
        assert_eq!(
            rendered(&plan.summary, "it"),
            "Crea la prova «Prova senza titolo.prv»"
        );
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn la_creazione_si_dice_e_si_annulla_nel_cestino() {
        let mut host = host();
        let outcome = invoke(&mut host, json!({ "name": "Conti" }), InvokeMode::Apply).unwrap();
        assert_eq!(
            rendered(outcome.notify.as_ref().unwrap(), "en"),
            "Created the test «Conti.prv»"
        );
        let undo = outcome.undo.expect("la creazione si annulla");
        assert_eq!(
            undo.steps,
            [UndoStep::Command {
                command: TRASH.to_string(),
                args: json!({ "doc": "Conti.prv" }),
            }]
        );
    }

    #[test]
    fn un_nome_che_non_puo_nascere_e_detto_prima_di_scrivere() {
        let mut host = host();
        let cases = [
            (
                "Conti/",
                "La prova non può chiamarsi «Conti/»: manca il nome.",
            ),
            (
                "Conti: marzo",
                "La prova non può chiamarsi «Conti: marzo.prv»: «Conti: marzo.prv» contiene \
                 «:», che un filesystem si riserva.",
            ),
            (
                ".fub/Conti",
                "La prova non può chiamarsi «.fub/Conti.prv»: «.fub» è il modo in cui il vault \
                 è fatto, non ciò che contiene.",
            ),
        ];
        for (name, expected) in cases {
            for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
                let error = invoke(&mut host, json!({ "name": name }), mode).unwrap_err();
                assert!(
                    matches!(error, PluginError::BadArgs(_)),
                    "{name}: {error:?}"
                );
                assert_eq!(rendered(error.message(), "it"), expected, "{name}");
            }
        }
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn un_vault_senza_il_formato_non_crea_niente() {
        let mut host = MemoryHost::new();
        let error = invoke(&mut host, json!({}), InvokeMode::Apply).unwrap_err();
        assert_eq!(
            rendered(error.message(), "it"),
            "Questo vault non apre le prove: nessun formato serve i file `.prv`."
        );
    }

    #[test]
    fn ogni_chiave_della_spec_ha_le_sue_frasi_nelle_due_lingue() {
        let spec = PROVA.spec();
        for language in ["it", "en"] {
            let texts = std::iter::once(&spec.title)
                .chain(std::iter::once(&spec.description))
                .chain(spec.params.iter().flat_map(|p| [&p.title, &p.description]));
            for text in texts {
                let said = rendered(text, language);
                assert!(!said.starts_with("prova."), "{language}: {said}");
                assert!(!said.contains('%'), "{language}: {said}");
            }
        }
        for catalog in PROVA.catalog() {
            for template in catalog.entries.values() {
                assert!(!template.contains('%'), "{template}");
            }
        }
    }
}
