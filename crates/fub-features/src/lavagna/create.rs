//! «Nuova lavagna»: il comando [`CANVAS_CREATE`], che fa nascere una lavagna
//! vuota e la apre.
//!
//! È `drawing.create` (`draw/create.rs`) per le lavagne, con le stesse regole
//! dei nomi che valgono per una nota nuova:
//!
//! - senza nome, il primo nome libero della famiglia «Lavagna», «Lavagna 1»,
//!   «Lavagna 2», … (la convenzione di
//!   [`free_name`](fub_abi::traits::VaultRead::free_name)), nella lingua di
//!   chi la crea («Whiteboard» in inglese);
//! - con un nome, quel nome: senza estensione riceve `.canvas`, con
//!   l'estensione di un altro formato è un errore, e occupato è un conflitto,
//!   mai una sovrascrittura;
//! - un nome semplice va nella cartella `folder`, se c'è (anche una che non
//!   c'è ancora: nasce col file); un path resta dov'è;
//! - il nome si scrive nella forma dei nomi che nascono (NFC, segmenti senza
//!   spazi ai bordi) e deve passare la regola dei nomi nuovi del contratto
//!   ([`path_policy::check`] con [`Naming::New`]).
//!
//! Il testo lo scrive il nucleo: è il sorgente nuovo di una lavagna vuota
//! (R6 di `docs/reference/canvas-format.md`, rientrato di due spazi e chiuso
//! da `"\n"`), riletto dal nucleo prima di toccare il vault.
//!
//! In simulazione si fanno gli stessi controlli e non si scrive niente: il
//! piano nomina la lavagna che nascerebbe. Applicato, il comando crea il file
//! con `create_document`, che rifiuta un path occupato anche se qualcuno lo ha
//! preso dopo il controllo, e risponde con `Navigate`, che lo apre.
//! L'annullamento lo manda nel cestino, anche se nel frattempo è cambiato: dal
//! cestino si ripristina con quello che aveva.

use fub_abi::command::{Args, CommandEffect, CommandOutcome, CommandPlan, InvokeMode, Undo};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::rules::folders;
use fub_abi::rules::path_policy::{self, NameFault, Naming, MAX_SEGMENT_BYTES};
use fub_abi::text::{Arg, Strings, Text};
use fub_abi::traits::HostApi;
use fub_canvas_core::commit::Core;
use fub_canvas_core::source::patch_source;
use fub_canvas_core::Canvas;

use super::*;

/// L'id del formato delle lavagne, lo stesso che `apply` confronta: la
/// feature non dipende dal formato, ne nomina soltanto l'id del contratto.
const CANVAS_FORMAT: &str = "canvas";

/// L'estensione delle lavagne, quella che il formato delle lavagne rivendica.
const EXTENSION: &str = "canvas";

/// L'inverso di «crea» è «cestina», come per una nota e per un disegno. Id
/// letterale e non import: i moduli di feature non si nominano fra loro.
const TRASH: &str = "note.trash";

/// La lingua del nome libero quando chi crea non ne ha detta una: quella con
/// cui l'host monta i cataloghi dei bundle ufficiali.
const FALLBACK_LANGUAGE: &str = "it";

pub(super) fn canvas_create(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = target(args.text(NAME), args.text(FOLDER), host)?;
    let source = empty_source(&doc)?;
    if mode.is_dry_run() {
        let plan = CommandPlan::of_edits(one(P_CREATE, &doc), Vec::new()).with_doc(doc);
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
    // `create_document` e non `write_document`: se nel frattempo qualcuno ha
    // preso il nome, la lavagna non nasce al posto suo.
    host.create_document(&doc, &source)?;
    let undo = Undo::by_command(
        one(U_CREATE, &doc),
        TRASH,
        serde_json::json!({ "doc": doc.as_str() }),
    );
    Ok(CommandOutcome::notify(one(N_CREATED, &doc))
        .undoable(undo)
        .with_effect(CommandEffect::Navigate { doc }))
}

/// Il sorgente di una lavagna vuota, come lo scrive il nucleo per un file
/// vuoto (R1 → R6), e riletto dal nucleo: il comando non promette un file che
/// la lavagna non saprebbe aprire.
pub(super) fn empty_source(doc: &DocId) -> Result<String, PluginError> {
    let empty = Canvas::default();
    let source = patch_source("", &empty, &empty).map_err(|error| unwritable(doc, &error))?;
    Core::open(source.as_str()).map_err(|error| unwritable(doc, &error))?;
    Ok(source)
}

/// La lavagna che nasce dagli argomenti, dopo ogni controllo che si può fare
/// prima di scrivere.
fn target(
    name: Option<&str>,
    folder: Option<&str>,
    host: &dyn HostApi,
) -> Result<DocId, PluginError> {
    let canvas = |doc: &DocId| {
        host.format_of(doc)
            .is_some_and(|format| format.descriptor.id == CANVAS_FORMAT)
    };
    // Prima il vault, poi il nome: senza il formato delle lavagne nessun nome
    // ne fa nascere una.
    if !canvas(&DocId::new(format!("x.{EXTENSION}"))) {
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
            // «Idee/» non nomina una lavagna: senza questo controllo
            // diventerebbe «Idee/.canvas», e il guasto sarebbe il punto in
            // testa di un nome che nessuno ha scritto.
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
    if !canvas(&doc) {
        return Err(PluginError::BadArgs(one(E_NAME_NOT_CANVAS, &doc)));
    }
    // Il controllo che `create_document` rifarà, detto prima: il piano non
    // promette una lavagna che non può nascere. Un nome scelto da `free_name`
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

/// Il nome di una lavagna senza nome nella lingua di chi la crea, dal
/// catalogo del componente: la stessa voce che la sua descrizione promette.
fn untitled(host: &dyn HostApi) -> String {
    let locale = host.user_locale();
    let catalogs = catalog();
    Strings::new(&catalogs, FALLBACK_LANGUAGE, &locale).render(&Text::key(N_UNTITLED))
}

/// Il guasto di una lavagna che non si è potuta scrivere: non è colpa degli
/// argomenti.
fn unwritable(doc: &DocId, reason: &dyn std::fmt::Display) -> PluginError {
    PluginError::Internal(Text::message(
        E_SOURCE,
        vec![
            Arg::text("doc", doc.as_str()),
            Arg::text("reason", reason.to_string()),
        ],
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

/// Un messaggio sulla lavagna.
fn one(key: &str, doc: &DocId) -> Text {
    Text::message(key, vec![Arg::text("doc", doc.as_str())])
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::command::{CommandReach, CommandSpec, UndoStep};
    use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
    use fub_abi::locale::Locale;
    use fub_abi::traits::{CommandProvider, VaultRead};
    use fub_sdk::testing::MemoryHost;
    use serde_json::json;

    /// Un host che serve le lavagne come il vault con il formato `canvas`.
    fn host() -> MemoryHost {
        MemoryHost::new().with_format(
            EXTENSION,
            DocumentFormat {
                descriptor: FormatDescriptor::text(CANVAS_FORMAT, "Canvas", &[EXTENSION]),
                capabilities: FormatCapabilities::default(),
            },
        )
    }

    fn spec() -> CommandSpec {
        LavagnaCommands
            .commands()
            .into_iter()
            .find(|spec| spec.id == CANVAS_CREATE)
            .expect("il comando c'è")
    }

    /// Come farebbe il kernel: prima la convalida contro la spec, poi la
    /// chiamata.
    fn invoke(
        host: &mut MemoryHost,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        spec().validate_args(&args)?;
        LavagnaCommands.invoke(CANVAS_CREATE, args, mode, host)
    }

    fn created(outcome: CommandOutcome) -> DocId {
        match outcome.effect {
            CommandEffect::Navigate { doc } => doc,
            other => panic!("una lavagna creata si apre, non {other:?}"),
        }
    }

    fn rendered(text: &Text, language: &str) -> String {
        let catalogs = catalog();
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
    fn la_spec_tocca_un_documento_e_non_chiede_niente() {
        let spec = spec();
        let names: Vec<_> = spec.params.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, [NAME, FOLDER]);
        assert!(spec.params.iter().all(|param| !param.required));
        assert!(spec.scope.writes && spec.scope.reversible);
        assert_eq!(spec.scope.reach, CommandReach::Document);
        assert_eq!(rendered(&spec.title, "it"), "Nuova lavagna");
        assert_eq!(rendered(&spec.title, "en"), "New whiteboard");
        for language in ["it", "en"] {
            assert!(!rendered(&spec.description, language).starts_with("canvas."));
            for param in &spec.params {
                assert!(!rendered(&param.title, language).starts_with("canvas."));
                assert!(!rendered(&param.description, language).starts_with("canvas."));
            }
        }
    }

    #[test]
    fn senza_nome_prende_il_primo_nome_libero() {
        let mut host = host();
        let first = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(first.as_str(), "Lavagna.canvas");
        let second = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(second.as_str(), "Lavagna 1.canvas");
        let placed =
            created(invoke(&mut host, json!({ "folder": "/Idee/" }), InvokeMode::Apply).unwrap());
        assert_eq!(placed.as_str(), "Idee/Lavagna.canvas");

        let english = Locale {
            language: "en-GB".to_string(),
            ..Locale::default()
        };
        let mut abroad = super::tests::host().with_locale(english);
        let doc = created(invoke(&mut abroad, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(doc.as_str(), "Whiteboard.canvas");
    }

    #[test]
    fn il_file_nuovo_e_la_lavagna_vuota_del_nucleo() {
        let mut host = host();
        let doc = created(invoke(&mut host, json!({ "name": "Idee" }), InvokeMode::Apply).unwrap());
        let source = host.read_document(&doc).unwrap();
        assert_eq!(source, "{\n  \"nodes\": [],\n  \"edges\": []\n}\n");
        let core = Core::open(source.as_str()).expect("il nucleo la apre");
        assert!(core.canvas().nodes.is_empty() && core.canvas().edges.is_empty());
    }

    #[test]
    fn un_nome_tiene_il_suo_posto_e_riceve_l_estensione() {
        let mut host = host();
        let cases = [
            (json!({ "name": "Idee" }), "Idee.canvas"),
            (json!({ "name": "Piano.canvas" }), "Piano.canvas"),
            (json!({ "name": "Mappa.CANVAS" }), "Mappa.CANVAS"),
            (json!({ "name": "Piano v1.2" }), "Piano v1.2.canvas"),
            (
                json!({ "name": "Gatto", "folder": "Animali" }),
                "Animali/Gatto.canvas",
            ),
            (
                json!({ "name": "Altrove/Gatto", "folder": "Animali" }),
                "Altrove/Gatto.canvas",
            ),
            (json!({ "name": " Mari\\Onda " }), "Mari/Onda.canvas"),
            (json!({ "name": "Cafe\u{301}" }), "Caf\u{e9}.canvas"),
        ];
        for (args, expected) in cases {
            let doc = created(invoke(&mut host, args.clone(), InvokeMode::Apply).unwrap());
            assert_eq!(doc.as_str(), expected, "{args}");
            assert!(host.read_document(&doc).is_ok(), "{expected} esiste");
        }
    }

    #[test]
    fn un_nome_preso_e_un_conflitto_e_niente_si_sovrascrive() {
        let mut host = host().with_document("Idee.canvas", "{}");
        for name in ["Idee", "Idee.canvas"] {
            for mode in [InvokeMode::DryRun, InvokeMode::Apply] {
                let error = invoke(&mut host, json!({ "name": name }), mode).unwrap_err();
                assert!(matches!(error, PluginError::AlreadyExists(_)), "{error:?}");
                assert_eq!(
                    message(&error),
                    "«Idee.canvas» c'è già: una lavagna nuova non prende il posto di un file."
                );
            }
        }
        assert_eq!(
            host.read_document(&DocId::new("Idee.canvas")).unwrap(),
            "{}"
        );
        let mut host = host
            .with_document("Lavagna.canvas", "{}")
            .with_document("Lavagna 1.canvas", "{}");
        let doc = created(invoke(&mut host, json!({}), InvokeMode::Apply).unwrap());
        assert_eq!(doc.as_str(), "Lavagna 2.canvas");
    }

    #[test]
    fn un_altro_formato_non_e_una_lavagna() {
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
            "«Appunti.md» non è il nome di una lavagna: una lavagna è un file `.canvas`."
        );
        assert!(host.read_document(&DocId::new("Appunti.md")).is_err());
    }

    #[test]
    fn un_vault_senza_lavagne_non_ne_crea() {
        let mut host = MemoryHost::new();
        for args in [json!({}), json!({ "name": "Idee.canvas" })] {
            let error = invoke(&mut host, args, InvokeMode::Apply).unwrap_err();
            assert_eq!(
                message(&error),
                "Questo vault non apre le lavagne: nessun formato serve i file `.canvas`."
            );
        }
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn un_nome_che_non_puo_nascere_e_detto_prima_di_scrivere() {
        let mut host = host();
        let cases = [
            (
                "Idee/",
                "La lavagna non può chiamarsi «Idee/»: manca il nome.",
            ),
            (
                "../Gatto",
                "La lavagna non può chiamarsi «../Gatto.canvas»: «.» e «..» non sono nomi.",
            ),
            (
                ".fub/Gatto",
                "La lavagna non può chiamarsi «.fub/Gatto.canvas»: «.fub» è il modo in cui \
                 il vault è fatto, non ciò che contiene.",
            ),
            (
                "Gatto\u{7}",
                "La lavagna non può chiamarsi «Gatto\u{7}.canvas»: «Gatto\u{7}.canvas» \
                 contiene un carattere di controllo.",
            ),
            (
                "Idee: acqua",
                "La lavagna non può chiamarsi «Idee: acqua.canvas»: «Idee: acqua.canvas» \
                 contiene «:», che un filesystem si riserva.",
            ),
            (
                "CON",
                "La lavagna non può chiamarsi «CON.canvas»: «CON.canvas» è un nome che \
                 Windows si riserva.",
            ),
            (
                "Gatto.",
                "La lavagna non può chiamarsi «Gatto.»: «Gatto.» finisce con un punto, \
                 che Windows toglie.",
            ),
            (
                ".Gatto",
                "La lavagna non può chiamarsi «.Gatto.canvas»: «.Gatto.canvas» comincia \
                 con un punto, e il vault non lo elencherebbe.",
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
        let long = "a".repeat(MAX_SEGMENT_BYTES);
        let error = invoke(&mut host, json!({ "name": long }), InvokeMode::Apply).unwrap_err();
        assert!(
            message(&error).ends_with("è troppo lungo (il massimo è 255 byte)."),
            "{}",
            message(&error)
        );
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn il_piano_nomina_la_lavagna_e_non_scrive() {
        let mut host = host();
        let outcome = invoke(&mut host, json!({ "name": "Idee" }), InvokeMode::DryRun).unwrap();
        let CommandEffect::Plan(plan) = outcome.effect else {
            panic!("una simulazione risponde con un piano");
        };
        assert_eq!(plan.docs, [DocId::new("Idee.canvas")]);
        assert_eq!(
            rendered(&plan.summary, "it"),
            "Crea la lavagna «Idee.canvas»"
        );
        assert!(host.list_documents(None).unwrap().items.is_empty());
    }

    #[test]
    fn la_creazione_dice_che_cosa_ha_fatto_e_si_annulla_nel_cestino() {
        let mut host = host();
        let outcome = invoke(&mut host, json!({ "name": "Idee" }), InvokeMode::Apply).unwrap();
        assert_eq!(
            rendered(outcome.notify.as_ref().unwrap(), "it"),
            "Creata la lavagna «Idee.canvas»"
        );
        let undo = outcome.undo.clone().expect("la creazione si annulla");
        assert_eq!(
            rendered(&undo.label, "en"),
            "the creation of the whiteboard «Idee.canvas»"
        );
        assert_eq!(
            undo.steps,
            [UndoStep::Command {
                command: TRASH.to_string(),
                args: json!({ "doc": "Idee.canvas" }),
            }]
        );
    }

    #[test]
    fn ogni_lingua_nomina_una_lavagna_senza_nome_che_puo_nascere() {
        for catalog in catalog() {
            let stem = &catalog.entries[N_UNTITLED];
            let name = format!("{stem} 12.{EXTENSION}");
            assert!(
                path_policy::check(&name, Naming::New).is_ok(),
                "{}: «{name}»",
                catalog.locale
            );
        }
    }
}
