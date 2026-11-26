use super::*;

#[test]
fn ogni_chiave_di_errore_e_nelle_due_lingue() {
    let catalogs = catalog();
    let keys = [
        P_APPLY,
        N_APPLIED,
        N_UNCHANGED,
        U_APPLY,
        E_NO_DOC,
        E_NOT_CANVAS,
        E_OPS_JSON,
        E_OPS_EMPTY,
        E_SEED,
        E_BASE,
        E_OPEN_LIMIT,
        E_OPEN_JSON,
        E_OPEN_INVALID,
        E_OP_UNKNOWN_NODE,
        E_OP_UNKNOWN_EDGE,
        E_OP_DUPLICATE,
        E_OP_TOO_MANY_NODES,
        E_OP_TOO_MANY_EDGES,
        E_OP_TOO_MANY_MOVED,
        E_OP_INVALID,
        E_OP_UNKNOWN_STROKE,
        E_OP_FOREIGN_LAYER,
        E_COMMIT_STALE,
        E_COMMIT_INVALID,
        E_COMMIT_REJECTED,
        E_COMMIT_UNSTABLE,
        N_UNTITLED,
        P_CREATE,
        N_CREATED,
        U_CREATE,
        E_NO_FORMAT,
        E_NAME_NOT_CANVAS,
        E_TAKEN,
        E_SOURCE,
        E_NAME_EMPTY,
        E_NAME_TRAVERSAL,
        E_NAME_MACHINE,
        E_NAME_CONTROL,
        E_NAME_RESERVED,
        E_NAME_DEVICE,
        E_NAME_TRAILING_DOT,
        E_NAME_HIDDEN,
        E_NAME_TOO_LONG,
        N_CHECK_SUMMARY,
        N_CHECK_REFUSED,
        E_READ_FORM,
        E_READ_IDS,
        E_READ_MAX_CHARS,
        E_READ_MAX_CHARS_FORM,
        E_READ_WRITE,
        E_GUIDE_TOPIC,
        E_PREVIEW_OPS,
        E_PREVIEW_SIZE,
        E_PREVIEW_BASE,
        E_PREVIEW_PNG,
        S_GROUP,
        S_INK_MOUSE_REMEMBER,
        S_INK_MOUSE_REMEMBER_DESC,
        S_FINGER_MOVES_CARD,
        S_FINGER_MOVES_CARD_DESC,
        S_FINGER_WRITES,
        S_FINGER_WRITES_DESC,
        S_PEN_BUTTON,
        S_PEN_BUTTON_DESC,
        S_PEN_BUTTON_RADIAL,
        S_PEN_BUTTON_ERASER,
        S_PEN_BUTTON_PAN,
        S_PEN_BUTTON_LASSO,
        S_WHEEL,
        S_WHEEL_DESC,
        S_WHEEL_PAN,
        S_WHEEL_ZOOM,
        S_WORKSPACE,
        S_WORKSPACE_DESC,
        S_WORKSPACE_AUTO,
        S_WORKSPACE_FULL,
        S_WORKSPACE_SIMPLE,
        S_TOOLBAR,
        S_TOOLBAR_DESC,
        S_GRID,
        S_GRID_DESC,
        S_SNAP,
        S_SNAP_DESC,
        S_SNAP_STEP,
        S_SNAP_STEP_DESC,
        S_SNAP_STEP_8,
        S_SNAP_STEP_16,
        S_SNAP_STEP_32,
        S_SNAP_STEP_NONE,
        S_PARTS_PICKER,
        S_PARTS_PICKER_DESC,
        S_DROP_FOLDER,
        S_DROP_FOLDER_DESC,
        S_DROP_FOLDER_NOTES,
        S_DROP_FOLDER_BOARD,
        S_DROP_FOLDER_FOLDER,
        S_DROP_FOLDER_PATH,
        S_DROP_FOLDER_PATH_DESC,
    ];
    for catalog in &catalogs {
        for key in keys.iter().chain(note::KEYS).copied() {
            assert!(
                catalog.entries.contains_key(key),
                "«{key}» manca in «{}»",
                catalog.locale
            );
        }
    }
    assert_eq!(catalogs.len(), 2);
    // Più le frasi comuni del modulo dei formati (il nome scritto in un
    // campo «Documento»).
    assert_eq!(
        catalogs[0].entries.len(),
        STRINGS.len() + note::STRINGS.len() + crate::formats::SPOKEN.len()
    );
}

/// Ogni codice che il payload di `canvas.check` può dare ha la sua frase,
/// in tutte e due le lingue: la rende il catalogo, non il payload.
#[test]
fn ogni_codice_di_problema_ha_la_sua_frase() {
    let catalogs = catalog();
    for code in check::CODES {
        let key = format!("canvas.check.p_{code}");
        for catalog in &catalogs {
            assert!(
                catalog.entries.contains_key(key.as_str()),
                "«{key}» manca in «{}»",
                catalog.locale
            );
        }
    }
}

use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
use fub_abi::text::{ArgValue, Message, Text};
use fub_sdk::testing::MemoryHost;
use serde_json::{json, Value};

/// Un host con una lavagna, una nota e una lavagna che non si apre. Gli errori
/// si provano sul provider: il kernel li rende nella lingua di sistema, e lì
/// la chiave del catalogo non si vede più.
fn host() -> MemoryHost {
    MemoryHost::new()
        .with_format(
            "canvas",
            DocumentFormat {
                descriptor: FormatDescriptor::text(CANVAS_FORMAT, "Canvas", &["canvas"]),
                capabilities: FormatCapabilities::default(),
            },
        )
        .with_document("Idee.canvas", r#"{"nodes": [], "edges": []}"#)
        .with_document("Nota.md", "# Nota\n")
        .with_document("Rotta.canvas", "{\"nodes\": [")
}

/// Il rifiuto di un comando, com'è uscito dal provider.
fn refusal(command: &str, args: Value) -> PluginError {
    let mut host = host();
    LavagnaCommands
        .invoke(command, args, InvokeMode::Apply, &mut host)
        .expect_err("il comando rifiuta")
}

/// Il messaggio di un errore di argomenti: la chiave, e i suoi argomenti.
fn message(error: &PluginError) -> &Message {
    let PluginError::BadArgs(text) = error else {
        panic!("un errore di argomenti, non {error:?}");
    };
    text.as_message().expect("un messaggio del catalogo")
}

fn arg(error: &PluginError, name: &str) -> String {
    match message(error).arg(name) {
        Some(ArgValue::Text(value)) => value.clone(),
        other => panic!("l'argomento «{name}» non è un testo: {other:?}"),
    }
}

/// La notifica del controllo: il riassunto con i conti se si scrive, il
/// conto dei problemi se no. Le chiavi si vedono solo qui: il kernel le rende.
#[test]
fn la_notifica_del_controllo_porta_i_conti() {
    let mut host = host();
    let add = json!([{ "op": "add_card", "node": { "id": "n", "type": "text", "x": 0, "y": 0, "width": 200, "height": 160, "text": "x" } }]);
    let summary = LavagnaCommands
        .invoke(
            CANVAS_CHECK,
            json!({ "doc": "Idee.canvas", "ops": add.to_string() }),
            InvokeMode::Apply,
            &mut host,
        )
        .expect("il rapporto");
    let text = summary
        .notify
        .as_ref()
        .and_then(Text::as_message)
        .expect("un riassunto");
    assert_eq!(text.key, "canvas.check.n_summary");
    assert_eq!(text.arg("added"), Some(&ArgValue::Int(1)));
    assert_eq!(text.arg("edges"), Some(&ArgValue::Int(0)));

    let refused = LavagnaCommands
        .invoke(
            CANVAS_CHECK,
            json!({ "doc": "Idee.canvas", "ops": "[{\"op\":\"fly\"}]" }),
            InvokeMode::Apply,
            &mut host,
        )
        .expect("il rapporto");
    let text = refused
        .notify
        .as_ref()
        .and_then(Text::as_message)
        .expect("un conto");
    assert_eq!(text.key, "canvas.check.n_refused");
    assert_eq!(text.arg("problems"), Some(&ArgValue::Int(1)));
}

#[test]
fn leggere_rifiuta_con_le_sue_chiavi() {
    let form = refusal(CANVAS_READ, json!({ "doc": "Idee.canvas", "form": "xml" }));
    assert_eq!(message(&form).key, "canvas.read.e_form");
    assert_eq!(arg(&form, "form"), "xml");

    let ids = refusal(
        CANVAS_READ,
        json!({ "doc": "Idee.canvas", "ids": "non è JSON" }),
    );
    assert_eq!(message(&ids).key, "canvas.read.e_ids");

    let negative = refusal(
        CANVAS_READ,
        json!({ "doc": "Idee.canvas", "max_chars": -1 }),
    );
    assert_eq!(message(&negative).key, "canvas.read.e_max_chars");

    let code = refusal(
        CANVAS_READ,
        json!({ "doc": "Idee.canvas", "form": "code", "max_chars": 10 }),
    );
    assert_eq!(message(&code).key, "canvas.read.e_max_chars_form");
    assert_eq!(arg(&code, "form"), "code");
}

#[test]
fn un_documento_che_non_e_una_lavagna_o_non_si_apre_ha_le_chiavi_di_apply() {
    let nota = json!({ "doc": "Nota.md", "ops": "[{\"op\":\"remove\",\"ids\":[\"a\"]}]" });
    for name in [CANVAS_READ, CANVAS_CHECK, CANVAS_APPLY] {
        let error = refusal(name, nota.clone());
        assert_eq!(message(&error).key, "canvas.apply.e_not_canvas", "{name}");
    }

    let rotta = json!({ "doc": "Rotta.canvas", "ops": "[{\"op\":\"remove\",\"ids\":[\"a\"]}]" });
    let apply = refusal(CANVAS_APPLY, rotta.clone());
    let expected = message(&apply).key.clone();
    assert!(expected.starts_with("canvas.apply.e_open_"), "{expected}");
    for name in [CANVAS_READ, CANVAS_CHECK] {
        let error = refusal(name, rotta.clone());
        assert_eq!(message(&error).key, expected, "{name}");
    }
}

#[test]
fn controllare_rifiuta_il_testo_che_non_e_json_senza_problema_della_forma() {
    let error = refusal(
        CANVAS_CHECK,
        json!({ "doc": "Idee.canvas", "ops": "non è JSON" }),
    );
    assert_eq!(message(&error).key, "canvas.apply.e_ops_json");
    assert_eq!(arg(&error, "problem"), "-");
}

#[test]
fn apply_con_una_lista_che_non_si_legge_nomina_il_primo_problema() {
    let error = refusal(
        CANVAS_APPLY,
        json!({ "doc": "Idee.canvas", "ops": "[{\"op\":\"fly\"}]" }),
    );
    assert_eq!(message(&error).key, "canvas.apply.e_ops_json");
    assert_eq!(arg(&error, "problem"), "unknown_op · /0/op");

    // Con un nome vicino, il vicino fa parte del problema.
    let near = refusal(
        CANVAS_APPLY,
        json!({ "doc": "Idee.canvas", "ops": "[{\"op\":\"moev\",\"ids\":[\"a\"],\"dx\":1,\"dy\":1}]" }),
    );
    assert_eq!(arg(&near, "problem"), "unknown_op · /0/op · move");
}

#[test]
fn la_guida_rifiuta_un_topic_sconosciuto_con_i_nomi_vicini() {
    let near = refusal(CANVAS_GUIDE, json!({ "topic": "mvoe" }));
    assert_eq!(message(&near).key, "canvas.guide.e_topic");
    assert_eq!(arg(&near, "topic"), "mvoe");
    assert_eq!(arg(&near, "near"), "move");

    // Senza vicini, la frase elenca tutti i nomi.
    let far = refusal(CANVAS_GUIDE, json!({ "topic": "xyzzy" }));
    let names = arg(&far, "near");
    assert!(
        names.contains("add_card") && names.contains("reorder"),
        "{names}"
    );
}

/// `canvas.preview` rifiuta con le sue chiavi: una lista che non si disegna
/// dice l'operazione e il codice del primo problema, un lato che non è un
/// intero dice la sua chiave. Le chiavi si vedono solo qui: il kernel le rende.
#[test]
fn il_disegno_rifiuta_con_le_sue_chiavi() {
    let unknown = refusal(
        CANVAS_PREVIEW,
        json!({ "doc": "Idee.canvas", "ops": json!([{ "op": "move", "ids": ["manca"], "dx": 1, "dy": 0 }]).to_string() }),
    );
    assert_eq!(message(&unknown).key, "canvas.preview.e_ops");
    assert_eq!(arg(&unknown, "position"), "1");
    assert_eq!(arg(&unknown, "code"), "unknown_node");

    // Una lista vuota non ha un'operazione: la posizione è «-».
    let empty = refusal(CANVAS_PREVIEW, json!({ "doc": "Idee.canvas", "ops": "[]" }));
    assert_eq!(message(&empty).key, "canvas.preview.e_ops");
    assert_eq!(arg(&empty, "position"), "-");

    let size = refusal(CANVAS_PREVIEW, json!({ "doc": "Idee.canvas", "size": 1.5 }));
    assert_eq!(message(&size).key, "canvas.preview.e_size");

    let not_json = refusal(
        CANVAS_PREVIEW,
        json!({ "doc": "Idee.canvas", "ops": "non json" }),
    );
    assert_eq!(message(&not_json).key, "canvas.apply.e_ops_json");
}

/// `text` com'è detto in `language`, col catalogo del componente.
fn said(text: &Text, language: &str) -> String {
    let catalogs = catalog();
    let locale = fub_abi::locale::Locale {
        language: language.to_string(),
        ..fub_abi::locale::Locale::default()
    };
    fub_abi::text::Strings::new(&catalogs, "it", &locale).render(text)
}

/// Le quattordici impostazioni nell'ordine del pannello: la chiave, la specie, il
/// valore di serie, lo spazio. Le prime cinque sono della macchina.
#[test]
fn le_quattordici_impostazioni_hanno_chiave_specie_e_valore_di_serie() {
    use fub_abi::settings::{SettingScope, SettingValue};
    let want: [(&str, &str, SettingValue); 14] = [
        (
            "canvas.ink_mouse_remember",
            "toggle",
            SettingValue::Toggle(false),
        ),
        (
            "canvas.finger_moves_card",
            "toggle",
            SettingValue::Toggle(false),
        ),
        (
            "canvas.finger_writes",
            "toggle",
            SettingValue::Toggle(false),
        ),
        (
            "canvas.pen_button",
            "choice",
            SettingValue::Text("radial".into()),
        ),
        ("canvas.wheel", "choice", SettingValue::Text("pan".into())),
        (
            "canvas.drag_empty",
            "choice",
            SettingValue::Text("select".into()),
        ),
        (
            "canvas.workspace",
            "choice",
            SettingValue::Text("auto".into()),
        ),
        ("canvas.toolbar", "list", SettingValue::List(Vec::new())),
        ("canvas.grid", "toggle", SettingValue::Toggle(true)),
        ("canvas.snap", "toggle", SettingValue::Toggle(true)),
        ("canvas.snap_step", "choice", SettingValue::Text("8".into())),
        ("canvas.parts_picker", "toggle", SettingValue::Toggle(true)),
        (
            "canvas.drop_folder",
            "choice",
            SettingValue::Text("notes".into()),
        ),
        (
            "canvas.drop_folder_path",
            "text",
            SettingValue::Text("Allegati".into()),
        ),
    ];
    let specs = settings();
    assert_eq!(specs.len(), want.len());
    for (index, (spec, (key, kind, default))) in specs.iter().zip(&want).enumerate() {
        assert_eq!(spec.key, *key);
        assert_eq!(spec.kind.name(), *kind, "{key}");
        assert_eq!(&spec.kind.default_value(), default, "{key}");
        assert!(!spec.program_writable, "{key}");
        // Le prime sei sono della macchina: la rotella e il trascinamento nel vuoto
        // sono come si tocca questo computer.
        let scope = if index < 6 {
            SettingScope::Machine
        } else {
            SettingScope::Vault
        };
        assert_eq!(spec.scope, scope, "{key}");
        // Ogni specie prende il suo valore e nient'altro.
        let other = match spec.kind.default_value() {
            SettingValue::Toggle(_) => SettingValue::Text("sì".into()),
            _ => SettingValue::Toggle(true),
        };
        assert!(spec.kind.rejects(&other).is_some(), "{key}");
    }
}

/// Le scelte hanno i valori del piano, nell'ordine dei pulsanti, e un valore
/// fuori lista è un rifiuto per chi scrive.
#[test]
fn le_scelte_hanno_i_valori_del_piano() {
    use fub_abi::settings::SettingValue;
    let specs = settings();
    let values = |key: &str| -> Vec<String> {
        let spec = specs.iter().find(|spec| spec.key == key).expect(key);
        match &spec.kind {
            SettingKind::Choice { options, .. } => {
                options.iter().map(|option| option.value.clone()).collect()
            }
            other => panic!("{key} non è una scelta: {}", other.name()),
        }
    };
    assert_eq!(
        values(CANVAS_PEN_BUTTON_KEY),
        ["radial", "eraser", "pan", "lasso"]
    );
    assert_eq!(values(CANVAS_WHEEL_KEY), ["pan", "zoom"]);
    assert_eq!(values(CANVAS_DRAG_EMPTY_KEY), ["select", "pan"]);
    assert_eq!(values(CANVAS_WORKSPACE_KEY), ["auto", "full", "simple"]);
    assert_eq!(values(CANVAS_DROP_FOLDER_KEY), ["notes", "board", "folder"]);
    assert_eq!(values(CANVAS_SNAP_STEP_KEY), ["8", "16", "32", "none"]);
    for key in [
        CANVAS_SNAP_STEP_KEY,
        CANVAS_PEN_BUTTON_KEY,
        CANVAS_WHEEL_KEY,
        CANVAS_DRAG_EMPTY_KEY,
        CANVAS_WORKSPACE_KEY,
        CANVAS_DROP_FOLDER_KEY,
    ] {
        let spec = specs.iter().find(|spec| spec.key == key).expect(key);
        assert!(
            spec.kind
                .rejects(&SettingValue::Text("altro".into()))
                .is_some(),
            "{key}"
        );
    }
}

/// I testi italiani del prototipo approvato (T25, «Come frasi»), parola per
/// parola: il nome e la descrizione di ogni riga.
#[test]
fn i_testi_italiani_sono_quelli_del_prototipo_approvato() {
    let specs = settings();
    let approved: [(&str, &str); 12] = [
            (
                "Ricorda se scrivi col mouse",
                "Riaprendo una lavagna, l'interruttore «Scrivi col mouse» resta come l'hai lasciato. Spenta, la lavagna si apre sempre con l'interruttore spento. Il tasto D funziona sempre.",
            ),
            (
                "Il dito sposta le schede",
                "Sullo schermo touch il dito sposta la scheda che tocca, e la lavagna solo dove non ci sono schede. Spenta, il dito sposta sempre la lavagna e una scheda si sposta dalla sua testata. Due dita ingrandiscono sempre.",
            ),
            (
                "Il dito scrive",
                "Sullo schermo touch un dito scrive con la penna scelta, come una penna vera; due dita spostano e ingrandiscono. Si cambia anche dall'interruttore in fondo alla colonna.",
            ),
            (
                "Il tasto della penna",
                "Che cosa fa il tasto sul fianco della penna: apre il menu radiale, cancella come il retro della penna, sposta la lavagna o sceglie col lazo. Su un computer senza penna non fa niente.",
            ),
            (
                "La rotella del mouse",
                "Che cosa fa la rotella fuori da una scheda attiva. Ctrl+rotella e il pizzico ingrandiscono sempre; dentro una scheda attiva la rotella scorre la scheda.",
            ),
            (
                "Spazio di lavoro",
                "Completo offre tutti gli strumenti, il navigatore e l'ispettore; Semplice ha la colonna ridotta e caselle grandi, per il dito e la penna. Automatico sceglie Semplice sui dispositivi che hanno solo il tocco.",
            ),
            (
                "Strumenti della colonna",
                "Gli strumenti che la colonna della lavagna mostra, in ordine; vuota, quelli di serie. Uno strumento tolto resta raggiungibile dai tasti e da Ctrl+/.",
            ),
            (
                "Griglia",
                "Mostra i punti della griglia sulla lavagna. Ctrl+' la mostra o la nasconde solo per la lavagna aperta.",
            ),
            (
                "Aggancia le schede",
                "Spostando o ridimensionando una scheda, i bordi si agganciano alle schede vicine e alla griglia. Alt tenuto lo spegne per quel gesto.",
            ),
            (
                "Scegli le parti di una nota",
                "Portando sulla lavagna una nota con almeno due titoli, accanto alla scheda si apre l'elenco dei titoli per tenerne solo alcuni. Con Alt, mentre la lasci, arriva intera.",
            ),
            (
                "Dove vanno i file trascinati",
                "I file portati sulla lavagna dal computer, o incollati, si copiano nel vault qui. «Con le note» segue la cartella degli allegati delle note; «Con la lavagna» li mette in una cartella accanto alla lavagna; «In una cartella» sempre nella stessa cartella del vault. Un file che è già nel vault non si copia.",
            ),
            (
                "Cartella dei file trascinati",
                "Il nome della cartella accanto alla lavagna, o il percorso nel vault per «In una cartella». Con «Con le note» non si usa.",
            ),
        ];
    // «Trascinare nel vuoto» (N6 T20b) e «Passo della griglia» (#411 C-05)
    // non sono nel prototipo T25: i loro testi si controllano qui sotto, a
    // parte, finché il prototipo non li porta.
    let approved_rows = specs
        .iter()
        .filter(|spec| spec.key != CANVAS_DRAG_EMPTY_KEY && spec.key != CANVAS_SNAP_STEP_KEY);
    for (spec, (label, description)) in approved_rows.zip(approved) {
        assert_eq!(said(&spec.label, "it"), label, "{}", spec.key);
        assert_eq!(said(&spec.description, "it"), description, "{}", spec.key);
    }
    let drag = specs
        .iter()
        .find(|spec| spec.key == CANVAS_DRAG_EMPTY_KEY)
        .expect(CANVAS_DRAG_EMPTY_KEY);
    assert_eq!(said(&drag.label, "it"), "Trascinare nel vuoto");
    let it = said(&drag.description, "it");
    assert!(it.contains("«Sceglie» disegna un rettangolo"), "{it}");
    assert!(it.contains("Esc la annulla"), "{it}");
    let step = specs
        .iter()
        .find(|spec| spec.key == CANVAS_SNAP_STEP_KEY)
        .expect(CANVAS_SNAP_STEP_KEY);
    assert_eq!(said(&step.label, "it"), "Passo della griglia");
    let it = said(&step.description, "it");
    assert!(it.contains("quando la lasci si aggancia"), "{it}");
    assert!(it.contains("«Nessuna griglia»"), "{it}");
}

/// Le opzioni in italiano e in inglese, e le etichette inglesi delle righe.
#[test]
fn le_opzioni_e_l_inglese_dicono_le_stesse_cose() {
    let specs = settings();
    let labels = |key: &str, language: &str| -> Vec<String> {
        let spec = specs.iter().find(|spec| spec.key == key).expect(key);
        match &spec.kind {
            SettingKind::Choice { options, .. } => options
                .iter()
                .map(|option| said(&option.label, language))
                .collect(),
            other => panic!("{key} non è una scelta: {}", other.name()),
        }
    };
    assert_eq!(
        labels(CANVAS_PEN_BUTTON_KEY, "it"),
        [
            "Apre il menu",
            "Cancella",
            "Sposta la lavagna",
            "Sceglie col lazo"
        ]
    );
    assert_eq!(
        labels(CANVAS_WHEEL_KEY, "it"),
        ["Sposta la lavagna", "Ingrandisce"]
    );
    assert_eq!(
        labels(CANVAS_DRAG_EMPTY_KEY, "it"),
        ["Sceglie", "Sposta la vista"]
    );
    assert_eq!(
        labels(CANVAS_WORKSPACE_KEY, "it"),
        ["Automatico", "Completo", "Semplice"]
    );
    assert_eq!(
        labels(CANVAS_DROP_FOLDER_KEY, "it"),
        ["Con le note", "Con la lavagna", "In una cartella"]
    );
    assert_eq!(
        labels(CANVAS_SNAP_STEP_KEY, "it"),
        ["Fine (8)", "Medio (16)", "Largo (32)", "Nessuna griglia"]
    );
    assert_eq!(
        labels(CANVAS_SNAP_STEP_KEY, "en"),
        ["Fine (8)", "Medium (16)", "Wide (32)", "No grid"]
    );
    assert_eq!(
        labels(CANVAS_PEN_BUTTON_KEY, "en"),
        [
            "Opens the menu",
            "Erases",
            "Moves the whiteboard",
            "Selects with the lasso"
        ]
    );
    assert_eq!(
        labels(CANVAS_WHEEL_KEY, "en"),
        ["Moves the whiteboard", "Zooms"]
    );
    assert_eq!(
        labels(CANVAS_DRAG_EMPTY_KEY, "en"),
        ["Selects", "Moves the view"]
    );
    assert_eq!(
        labels(CANVAS_WORKSPACE_KEY, "en"),
        ["Automatic", "Full", "Simple"]
    );
    assert_eq!(
        labels(CANVAS_DROP_FOLDER_KEY, "en"),
        ["With the notes", "With the whiteboard", "In a folder"]
    );
    let english = [
        "Remember whether you write with the mouse",
        "A finger moves the cards",
        "A finger writes",
        "The pen button",
        "The mouse wheel",
        "Dragging on empty space",
        "Workspace",
        "Column tools",
        "Grid",
        "Snap cards",
        "Grid step",
        "Choose the parts of a note",
        "Where dragged files go",
        "Folder for dragged files",
    ];
    for (spec, label) in specs.iter().zip(english) {
        assert_eq!(said(&spec.label, "en"), label, "{}", spec.key);
    }
}

#[test]
fn le_impostazioni_parlano_italiano_e_inglese() {
    let specs = settings();
    for spec in &specs {
        for (language, group) in [("it", "Lavagna"), ("en", "Whiteboard")] {
            assert_eq!(said(&spec.group, language), group, "{}", spec.key);
            for text in [&spec.label, &spec.description] {
                let line = said(text, language);
                assert!(
                    !line.is_empty() && !line.starts_with("s_"),
                    "{} in {language}: «{line}»",
                    spec.key
                );
            }
        }
    }
    // Le parole del prototipo approvato (PLAN-ui/lavagna-penne.html).
    assert_eq!(said(&specs[0].label, "it"), "Ricorda se scrivi col mouse");
    assert_eq!(said(&specs[1].label, "it"), "Il dito sposta le schede");
    assert_eq!(
        said(&specs[0].label, "en"),
        "Remember whether you write with the mouse"
    );
    assert_eq!(said(&specs[1].label, "en"), "A finger moves the cards");
    let it = said(&specs[0].description, "it");
    assert!(it.contains("«Scrivi col mouse»"), "{it}");
    assert!(it.contains("Il tasto D funziona sempre."), "{it}");
    let en = said(&specs[0].description, "en");
    assert!(en.contains("«Write with the mouse»"), "{en}");
    let it = said(&specs[1].description, "it");
    assert!(it.contains("Due dita ingrandiscono sempre."), "{it}");
    let en = said(&specs[1].description, "en");
    assert!(en.contains("Two fingers always zoom."), "{en}");
}
