//! «Annota il PDF»: il comando [`PDF_ANNOTATE`], che apre le annotazioni di un
//! PDF del vault e, se non ci sono ancora, le fa nascere.
//!
//! Le annotazioni di `Bando.pdf` sono il file `Bando.pdf.fubann` nella stessa
//! cartella (il [formato delle
//! annotazioni](../../../../docs/reference/annotation-format.md)): il nome non
//! si sceglie, perché è il nome a legarle al PDF. Il PDF non si tocca mai, in
//! nessun ramo: si chiede soltanto se c'è.
//!
//! - Se le annotazioni ci sono, il comando le apre e basta: `Navigate`, senza
//!   scrivere e senza annullamento.
//! - Se non ci sono, le scrive il provider `fubann` con
//!   [`serialize`](fub_abi::FormatProvider::serialize): radice, titolo e
//!   `fub:annotates` dedotto dal nome. Impronta, numero di pagine e gruppi di
//!   pagina li scrive il profilo `pdf` della superficie, che il PDF lo legge.
//!   Poi `Navigate`, e l'annullamento le manda nel cestino, come per un
//!   disegno nuovo.
//!
//! Il nome che nasce passa la regola dei nomi nuovi del contratto
//! ([`path_policy::check`] con [`Naming::New`]): un PDF dal nome lunghissimo
//! può non avere posto per `.fubann`, e il comando lo dice prima di scrivere.
//! Un nome occupato da un file che non è quello delle annotazioni (un'altra
//! grafia su un disco che non distingue le maiuscole) è un conflitto, mai una
//! sovrascrittura.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, Undo,
};
use fub_abi::error::PluginError;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::rules::media;
use fub_abi::rules::path_policy::{self, NameFault, Naming, MAX_SEGMENT_BYTES};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::HostApi;
use fub_abi::FormatProvider;
use fub_format_svg::{FubannProvider, ANNOTATIONS_FORMAT_ID};

/// Apre le annotazioni di un PDF, e le crea se non ci sono.
pub const PDF_ANNOTATE: &str = "pdf.annotate";

/// Il suffisso delle annotazioni, dopo il nome intero del PDF.
const SUFFIX: &str = ".fubann";

/// L'estensione del documento annotato.
const PDF: &str = ".pdf";

/// L'inverso di «crea» è «cestina», come per un disegno nuovo.
const TRASH: &str = "note.trash";

const PARAM: &str = "pdf";

const T_TITLE: &str = "pdf.annotate.title";
const T_DESC: &str = "pdf.annotate.desc";
const T_PDF: &str = "pdf.annotate.pdf.title";
const T_PDF_DESC: &str = "pdf.annotate.pdf.desc";

const P_CREATE: &str = "plan_annotations_create";
const P_OPEN: &str = "plan_annotations_open";
const D_CREATE: &str = "done_annotations_create";
const U_CREATE: &str = "undo_annotations_create";
const E_NO_FORMAT: &str = "e_annotations_no_format";
const E_NOT_PDF: &str = "e_annotations_not_pdf";
const E_NO_PDF: &str = "e_annotations_no_pdf";
const E_TAKEN: &str = "e_annotations_taken";
const E_NAME: &str = "e_annotations_name";
const E_NAME_TOO_LONG: &str = "e_annotations_name_too_long";
const E_SERIALIZE: &str = "e_annotations_serialize";

/// Le stringhe del comando in italiano, aggiunte al catalogo del bundle.
pub(super) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Annota il PDF")
        .with(
            T_DESC,
            "Apre le annotazioni del PDF, il file `.pdf.fubann` accanto, e le crea \
             se non ci sono. Il PDF resta com'è.",
        )
        .with(T_PDF, "PDF")
        .with(T_PDF_DESC, "Il PDF del vault da annotare.")
        .with(P_CREATE, "Crea le annotazioni «{doc}»")
        .with(P_OPEN, "Apre le annotazioni «{doc}»")
        .with(D_CREATE, "Create le annotazioni «{doc}»")
        .with(U_CREATE, "la creazione delle annotazioni «{doc}»")
        .with(
            E_NO_FORMAT,
            "Questo vault non apre le annotazioni: nessun formato serve i file `.fubann`.",
        )
        .with(
            E_NOT_PDF,
            "«{doc}» non è un PDF: si annotano i file `.pdf`.",
        )
        .with(E_NO_PDF, "Il PDF «{doc}» non c'è nel vault.")
        .with(
            E_TAKEN,
            "«{doc}» è il nome di un altro file: le annotazioni non ne prendono il posto.",
        )
        .with(
            E_NAME,
            "Le annotazioni non possono chiamarsi «{doc}»: il nome non passa le regole \
             dei file nuovi.",
        )
        .with(
            E_NAME_TOO_LONG,
            "Le annotazioni non possono chiamarsi «{doc}»: il nome supera {max} byte.",
        )
        .with(
            E_SERIALIZE,
            "Le annotazioni «{doc}» non si sono potute scrivere: {reason}",
        )
}

/// Le stesse stringhe in inglese.
pub(super) fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Annotate PDF")
        .with(
            T_DESC,
            "Opens the annotations of the PDF, the `.pdf.fubann` file beside it, and \
             creates them if they do not exist. The PDF stays as it is.",
        )
        .with(T_PDF, "PDF")
        .with(T_PDF_DESC, "The vault PDF to annotate.")
        .with(P_CREATE, "Create the annotations «{doc}»")
        .with(P_OPEN, "Open the annotations «{doc}»")
        .with(D_CREATE, "Created the annotations «{doc}»")
        .with(U_CREATE, "the creation of the annotations «{doc}»")
        .with(
            E_NO_FORMAT,
            "This vault does not open annotations: no format serves `.fubann` files.",
        )
        .with(
            E_NOT_PDF,
            "«{doc}» is not a PDF: only `.pdf` files are annotated.",
        )
        .with(E_NO_PDF, "The PDF «{doc}» is not in the vault.")
        .with(
            E_TAKEN,
            "«{doc}» is the name of another file: the annotations do not replace it.",
        )
        .with(
            E_NAME,
            "The annotations cannot be called «{doc}»: the name breaks the rules for \
             new files.",
        )
        .with(
            E_NAME_TOO_LONG,
            "The annotations cannot be called «{doc}»: the name exceeds {max} bytes.",
        )
        .with(
            E_SERIALIZE,
            "The annotations «{doc}» could not be written: {reason}",
        )
}

/// La spec del comando, una sola per l'elenco e per i test.
pub(super) fn spec() -> CommandSpec {
    CommandSpec::new(PDF_ANNOTATE, Text::key(T_TITLE))
        .describing(Text::key(T_DESC))
        .with_param(
            ParamSpec::new(PARAM, Text::key(T_PDF), ParamKind::Document)
                .describing(Text::key(T_PDF_DESC))
                .required(),
        )
        // Al più un documento nuovo, che il cestino rende reversibile: il
        // raggio di «Nuovo disegno», quindi la palette lo esegue senza mostrare
        // prima il piano.
        .with_scope(CommandScope::writing(CommandReach::Document))
}

/// Esegue il comando: apre le annotazioni che ci sono, o le crea e le apre.
pub(super) fn invoke(
    args: serde_json::Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let args = Args::new(&args);
    let pdf = pdf(args.text(PARAM), host)?;
    let doc = DocId::new(format!("{}{SUFFIX}", pdf.as_str()));
    if host.document_revision(&doc).is_ok() {
        if mode.is_dry_run() {
            let plan = CommandPlan::of_edits(one(P_OPEN, &doc), Vec::new());
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Navigate { doc }));
    }
    path_policy::check(doc.as_str(), Naming::New).map_err(|fault| bad_name(&doc, &fault))?;
    // Il controllo che `create_document` rifarà, detto prima: il piano non
    // promette annotazioni che non possono nascere.
    if host.free_name(&doc) != doc {
        return Err(PluginError::AlreadyExists(one(E_TAKEN, &doc)));
    }
    let source = annotations(&doc)?;
    if mode.is_dry_run() {
        let plan = CommandPlan::of_edits(one(P_CREATE, &doc), Vec::new()).with_doc(doc);
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
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

/// Il PDF degli argomenti, dopo i controlli che non scrivono: il vault serve
/// le annotazioni, il nome è di un PDF e il PDF c'è.
fn pdf(given: Option<&str>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    let served = host
        .format_of(&DocId::new(format!("x{PDF}{SUFFIX}")))
        .is_some_and(|format| format.descriptor.id == ANNOTATIONS_FORMAT_ID);
    if !served {
        return Err(PluginError::BadArgs(Text::key(E_NO_FORMAT)));
    }
    // La convalida della spec ha già chiesto una stringa: qui si scrive nella
    // forma dei nomi del vault.
    let written = path_policy::from_outside(given.unwrap_or_default());
    // Il PDF si sceglie dall'elenco o si scrive per nome («Bando di gara»):
    // la regola di `Args::named_document`, fra i soli PDF del vault. Un PDF è
    // un allegato, quindi i candidati sono i file dell'anagrafe. Un percorso
    // con l'estensione di un file (`Altro.pdf`, `Appunti.md`) che non c'è e
    // che nessun PDF porta come nome resta la frase del comando su quel file.
    let pdf = match crate::formats::written_file_named_by(&written, host, is_pdf) {
        Ok(Some(found)) => found,
        Ok(None) => DocId::new(written),
        Err(error) if crate::formats::missing_file(&error, &written, host) => DocId::new(written),
        Err(error) => return Err(error),
    };
    if !is_pdf(&pdf) {
        return Err(PluginError::BadArgs(one(E_NOT_PDF, &pdf)));
    }
    match host.document_revision(&pdf) {
        Ok(_) => Ok(pdf),
        Err(PluginError::NotFound(_)) => Err(PluginError::NotFound(one(E_NO_PDF, &pdf))),
        Err(other) => Err(other),
    }
}

/// Un PDF è ciò che il vault chiama così: la regola che dà il tipo di
/// contenuto a un allegato, senza badare al caso (`Bando.PDF`) e con un nome
/// prima del punto. Una seconda grafia della stessa domanda divergerebbe.
fn is_pdf(doc: &DocId) -> bool {
    media::mime_of(doc) == Some("application/pdf")
}

/// Il documento nuovo, scritto dal provider delle annotazioni: il modello porta
/// soltanto l'id, da cui il provider deduce titolo e `fub:annotates`.
fn annotations(doc: &DocId) -> Result<String, PluginError> {
    FubannProvider::new()
        .serialize(&DocumentModel::empty(doc.clone()))
        .map_err(|error| {
            PluginError::Internal(Text::message(
                E_SERIALIZE,
                vec![
                    Arg::text("doc", doc.as_str()),
                    Arg::text("reason", error.to_string()),
                ],
            ))
        })
}

/// Il guasto del nome che nascerebbe. Il solo che un PDF già nel vault può
/// dare davvero è la lunghezza, e ha la sua frase; gli altri la frase comune.
fn bad_name(doc: &DocId, fault: &NameFault) -> PluginError {
    let message = match fault {
        NameFault::TooLong { .. } => Text::message(
            E_NAME_TOO_LONG,
            vec![
                Arg::text("doc", doc.as_str()),
                Arg::int("max", MAX_SEGMENT_BYTES as i64),
            ],
        ),
        _ => one(E_NAME, doc),
    };
    PluginError::BadArgs(message)
}

/// Un messaggio su un documento.
fn one(key: &str, doc: &DocId) -> Text {
    Text::message(key, vec![Arg::text("doc", doc.as_str())])
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::command::UndoStep;
    use fub_abi::format::{DocumentFormat, FormatCapabilities};
    use fub_abi::locale::Locale;
    use fub_abi::text::Strings;
    use fub_abi::traits::VaultRead;
    use fub_sdk::testing::MemoryHost;
    use serde_json::json;

    /// Un host che serve le annotazioni come il vault con la feature `draw`,
    /// con un PDF dentro.
    fn host() -> MemoryHost {
        MemoryHost::new()
            .with_format(
                "fubann",
                DocumentFormat {
                    descriptor: FubannProvider::new().descriptor(),
                    capabilities: FormatCapabilities::default(),
                },
            )
            .with_binary_document("Gare/Bando di gara.pdf", b"%PDF-1.7\n%\xe2\xe3\n")
    }

    /// Come farebbe il kernel: prima la convalida contro la spec, poi la
    /// chiamata.
    fn run(
        host: &mut MemoryHost,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        spec().validate_args(&args)?;
        invoke(args, mode, host)
    }

    fn opened(outcome: &CommandOutcome) -> DocId {
        match &outcome.effect {
            CommandEffect::Navigate { doc } => doc.clone(),
            other => panic!("le annotazioni si aprono, non {other:?}"),
        }
    }

    fn rendered(text: &Text, language: &str) -> String {
        let catalogs = super::super::catalog();
        let locale = Locale {
            language: language.to_string(),
            ..Locale::default()
        };
        Strings::new(&catalogs, "it", &locale).render(text)
    }

    fn message(error: &PluginError) -> String {
        rendered(error.message(), "it")
    }

    const BANDO: &str = "Gare/Bando di gara.pdf";
    const NOTE: &str = "Gare/Bando di gara.pdf.fubann";

    #[test]
    fn the_spec_asks_for_the_pdf_and_reaches_one_document() {
        let spec = spec();
        assert_eq!(spec.id, PDF_ANNOTATE);
        assert_eq!(spec.params.len(), 1);
        assert!(spec.params[0].required);
        assert!(matches!(spec.params[0].kind, ParamKind::Document));
        assert!(spec.scope.writes && spec.scope.reversible);
        assert_eq!(spec.scope.reach, CommandReach::Document);
        assert_eq!(rendered(&spec.title, "it"), "Annota il PDF");
        assert_eq!(rendered(&spec.title, "en"), "Annotate PDF");
    }

    #[test]
    fn the_first_time_the_annotations_are_born_beside_the_pdf() {
        let mut host = host();
        let outcome = run(&mut host, json!({ "pdf": BANDO }), InvokeMode::Apply).unwrap();
        let doc = opened(&outcome);
        assert_eq!(doc.as_str(), NOTE);
        assert_eq!(
            rendered(outcome.notify.as_ref().unwrap(), "it"),
            format!("Create le annotazioni «{NOTE}»")
        );
        // Il file è il documento nuovo del provider, byte per byte, e nomina
        // il PDF accanto.
        let source = host.read_document(&doc).unwrap();
        let expected = FubannProvider::new()
            .serialize(&DocumentModel::empty(doc.clone()))
            .unwrap();
        assert_eq!(source, expected);
        assert!(
            source.contains("fub:annotates=\"Bando%20di%20gara.pdf\""),
            "{source}"
        );
        // Il PDF resta com'è.
        assert_eq!(
            host.read_document_bytes(&DocId::new(BANDO)).unwrap(),
            b"%PDF-1.7\n%\xe2\xe3\n"
        );
        // L'annullamento manda le annotazioni nel cestino.
        let undo = outcome.undo.expect("la creazione si annulla");
        match undo.steps.as_slice() {
            [UndoStep::Command { command, args }] => {
                assert_eq!(command, TRASH);
                assert_eq!(args, &json!({ "doc": NOTE }));
            }
            other => panic!("un passo di cestino, non {other:?}"),
        }
    }

    #[test]
    fn the_second_time_they_only_open() {
        let mut host = host().with_document(NOTE, "<svg/>");
        let outcome = run(&mut host, json!({ "pdf": BANDO }), InvokeMode::Apply).unwrap();
        assert_eq!(opened(&outcome).as_str(), NOTE);
        assert!(outcome.notify.is_none(), "aprire non si annuncia");
        assert!(outcome.undo.is_none(), "aprire non si annulla");
        assert_eq!(
            host.read_document(&DocId::new(NOTE)).unwrap(),
            "<svg/>",
            "le annotazioni che ci sono restano"
        );
    }

    #[test]
    fn the_plan_names_what_would_be_born_and_writes_nothing() {
        let mut host = host();
        let outcome = run(&mut host, json!({ "pdf": BANDO }), InvokeMode::DryRun).unwrap();
        match outcome.effect {
            CommandEffect::Plan(plan) => {
                assert_eq!(plan.docs, [DocId::new(NOTE)]);
                assert_eq!(
                    rendered(&plan.summary, "it"),
                    format!("Crea le annotazioni «{NOTE}»")
                );
            }
            other => panic!("una simulazione risponde con un piano, non {other:?}"),
        }
        assert!(host.read_document(&DocId::new(NOTE)).is_err());

        let mut existing = host.with_document(NOTE, "<svg/>");
        let outcome = run(&mut existing, json!({ "pdf": BANDO }), InvokeMode::DryRun).unwrap();
        match outcome.effect {
            CommandEffect::Plan(plan) => assert!(plan.docs.is_empty() && plan.edits.is_empty()),
            other => panic!("una simulazione risponde con un piano, non {other:?}"),
        }
    }

    #[test]
    fn only_a_pdf_of_the_vault_is_annotated() {
        let mut host = host().with_document("Appunti.md", "# Appunti\n");
        let error = run(&mut host, json!({ "pdf": "Appunti.md" }), InvokeMode::Apply).unwrap_err();
        assert_eq!(
            message(&error),
            "«Appunti.md» non è un PDF: si annotano i file `.pdf`."
        );
        // Un nome che è soltanto estensione non è un PDF, nemmeno in una cartella.
        for bare in [".pdf", "Archivio/.pdf"] {
            let error = run(&mut host, json!({ "pdf": bare }), InvokeMode::Apply).unwrap_err();
            assert!(
                matches!(error, PluginError::BadArgs(_)),
                "{bare}: {error:?}"
            );
        }
        let error = run(&mut host, json!({ "pdf": "Altro.pdf" }), InvokeMode::Apply).unwrap_err();
        assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
        assert_eq!(message(&error), "Il PDF «Altro.pdf» non c'è nel vault.");
        // Le maiuscole dell'estensione non contano, come per il vault.
        let mut upper = host.with_binary_document("SCAN.PDF", b"%PDF-1.4\n");
        let outcome = run(&mut upper, json!({ "pdf": "SCAN.PDF" }), InvokeMode::Apply).unwrap();
        assert_eq!(opened(&outcome).as_str(), "SCAN.PDF.fubann");
    }

    #[test]
    fn the_pdf_can_be_written_by_name() {
        // Chi scrive «Bando di gara» nel campo intende il PDF: un allegato,
        // che l'elenco dei documenti non ha, trovato fra i soli PDF del vault.
        // Un'immagine omonima non lo rende ambiguo.
        let mut host = host().with_binary_document("Bando di gara.png", b"\x89PNG\r\n");
        for written in [
            "Bando di gara",
            "bando di gara",
            "Gare/Bando di gara",
            "Bando di gara.pdf",
        ] {
            let outcome = run(&mut host, json!({ "pdf": written }), InvokeMode::DryRun)
                .unwrap_or_else(|error| panic!("{written}: {error:?}"));
            let CommandEffect::Plan(plan) = &outcome.effect else {
                panic!("{written}: un piano, non {:?}", outcome.effect);
            };
            assert_eq!(plan.docs, [DocId::new(NOTE)], "{written}");
        }
        let outcome = run(
            &mut host,
            json!({ "pdf": "Bando di gara" }),
            InvokeMode::Apply,
        )
        .unwrap();
        assert_eq!(opened(&outcome).as_str(), NOTE);
    }

    #[test]
    fn a_name_no_pdf_or_many_pdfs_carry_is_said() {
        let mut host = host()
            .with_binary_document("A/Doppio.pdf", b"%PDF-1.7\n")
            .with_binary_document("B/Doppio.pdf", b"%PDF-1.7\n");
        for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
            let error = run(&mut host, json!({ "pdf": "Doppio" }), mode).unwrap_err();
            assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
            assert_eq!(
                message(&error),
                "Più documenti si chiamano «Doppio»: A/Doppio.pdf, B/Doppio.pdf. Scegli \
                 dall'elenco del campo quello giusto."
            );
            let error = run(&mut host, json!({ "pdf": "Manca" }), mode).unwrap_err();
            assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
            assert_eq!(
                message(&error),
                "Nessun documento che questo comando può usare si chiama «Manca». Sceglilo \
                 dall'elenco del campo."
            );
            assert_eq!(
                rendered(error.message(), "en"),
                "No document this command can use is called “Manca”. Pick it from the \
                 field's list."
            );
        }
        assert!(host
            .read_document(&DocId::new("A/Doppio.pdf.fubann"))
            .is_err());
    }

    #[test]
    fn a_vault_without_annotations_creates_none() {
        let mut host = MemoryHost::new().with_binary_document(BANDO, b"%PDF-1.7\n");
        let error = run(&mut host, json!({ "pdf": BANDO }), InvokeMode::Apply).unwrap_err();
        assert!(message(&error).starts_with("Questo vault non apre le annotazioni"));
        assert!(host.read_document(&DocId::new(NOTE)).is_err());
    }

    #[test]
    fn a_name_too_long_for_the_suffix_is_said_before_writing() {
        let long = format!("{}.pdf", "a".repeat(MAX_SEGMENT_BYTES - 4));
        let mut host = host().with_binary_document(&long, b"%PDF-1.7\n");
        let error = run(&mut host, json!({ "pdf": long }), InvokeMode::DryRun).unwrap_err();
        assert!(
            message(&error).ends_with(&format!("il nome supera {MAX_SEGMENT_BYTES} byte.")),
            "{}",
            message(&error)
        );
    }

    #[test]
    fn every_message_has_both_languages() {
        let catalogs = super::super::catalog();
        for key in [
            T_TITLE,
            T_DESC,
            T_PDF,
            T_PDF_DESC,
            P_CREATE,
            P_OPEN,
            D_CREATE,
            U_CREATE,
            E_NO_FORMAT,
            E_NOT_PDF,
            E_NO_PDF,
            E_TAKEN,
            E_NAME,
            E_NAME_TOO_LONG,
            E_SERIALIZE,
        ] {
            for catalog in &catalogs {
                assert!(
                    catalog.entries.contains_key(key),
                    "{key} manca in {}",
                    catalog.locale
                );
            }
        }
    }
}
