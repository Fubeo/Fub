//! L'esportazione come comando sull'host vero (T79): con l'app aperta la
//! shell si annuncia, la richiesta le arriva come evento, e il PDF che la shell
//! impagina lo scrive il lavoro del core; senza l'app (il server MCP da solo,
//! un processo nuovo sul vault) il comando risponde con un errore tipato che
//! chiede l'app aperta.

#![cfg(feature = "draw")]

use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Event;
use fub_abi::PluginError;
use fub_features::pdf_export::command::{
    NS_RICHIESTA, PDF_EXPORT_LISTEN, PDF_EXPORT_NOTE, PDF_PROFILE_DEFAULT, PDF_PROFILE_SAVE,
    TOPIC_RICHIESTA,
};
use fub_features::pdf_export::lavoro::PDF_WRITE_PAGES;
use fub_features::pdf_export::profile::Profilo;
use fub_features::pdf_export::{ElencoPagine, Faccia, Pagina, Pezzo, VERSIONE};
use fub_host::Host;
use serde_json::{json, Value};

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(root.join("Tipi")).unwrap();
    std::fs::write(
        root.join("Tipi/Libro.md"),
        "---\nproperties: [autore]\n---\n",
    )
    .unwrap();
    std::fs::write(
        root.join("Dune.md"),
        "---\ntipo: \"[[Tipi/Libro]]\"\n---\n# Dune\n\nIl deserto.\n",
    )
    .unwrap();
    (dir, root)
}

fn aperto(root: &Utf8PathBuf) -> Host {
    let host = Host::without_watcher();
    host.open(root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    host
}

/// L'elenco che la shell manda dopo aver impaginato: una pagina, una parola.
fn elenco() -> String {
    serde_json::to_string(&ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: "Dune".into(),
        autore: String::new(),
        lingua: String::new(),
        facce: vec![Faccia {
            famiglia: "Inter Variable".into(),
            file: "/fonts/inter-latin-wght-normal.woff2".into(),
            corsivo: false,
            assi: Vec::new(),
        }],
        pagine: vec![Pagina {
            pezzi: vec![Pezzo::Testo {
                x: 20.0,
                y: 40.0,
                larghezza: 30.0,
                faccia: 0,
                corpo: 12.0,
                colore: [0.0, 0.0, 0.0, 1.0],
                testo: "Dune".into(),
                posizioni: vec![0.0, 8.0, 16.0, 24.0],
                sottolineato: false,
                barrato: false,
                nodo: None,
            }],
            ..Pagina::default()
        }],
        segnalibri: Vec::new(),
        struttura: Vec::new(),
    })
    .unwrap()
}

fn invoca(host: &Host, command: &str, args: Value) -> Result<CommandEffect, PluginError> {
    host.invoke_user_command(None, command, args, InvokeMode::Apply)
        .map(|esito| esito.effect)
}

#[test]
fn senza_l_app_il_comando_chiede_l_app_aperta() {
    let (_dir, root) = vault();
    // Un processo che apre il vault senza una shell che impagina: è ciò che fa
    // il server MCP quando l'app non c'è.
    let host = aperto(&root);
    let errore =
        invoca(&host, PDF_EXPORT_NOTE, json!({ "note": "Dune.md" })).expect_err("nessuno impagina");
    assert!(matches!(errore, PluginError::Unserved(_)), "{errore:?}");
    assert!(!root.join("Dune.pdf").exists());
}

#[test]
fn con_l_app_aperta_la_richiesta_arriva_alla_shell_e_il_pdf_nel_vault() {
    let (_dir, root) = vault();
    let host = aperto(&root);
    let eventi = host.subscribe(None).unwrap();

    // Un profilo predefinito per i libri: la richiesta lo porta con sé.
    let profilo = Profilo::nuovo("Libri");
    let CommandEffect::Custom { payload, .. } = invoca(
        &host,
        PDF_PROFILE_SAVE,
        json!({ "profile": serde_json::to_string(&profilo).unwrap() }),
    )
    .expect("salvato") else {
        panic!("il salvataggio dice l'id");
    };
    let id = payload["id"].as_str().unwrap().to_owned();
    invoca(
        &host,
        PDF_PROFILE_DEFAULT,
        json!({ "id": id, "scope": "type", "note": "Dune.md" }),
    )
    .expect("predefinito per i libri");
    // Il profilo sta nello spazio dati dei disegni.
    assert!(root
        .join(".fub/plugins/fub.draw/profili")
        .join(format!("{id}.json"))
        .exists());

    // La shell si annuncia, poi qualcuno (un agente) chiede l'esportazione.
    invoca(&host, PDF_EXPORT_LISTEN, json!({})).expect("la shell c'è");
    let CommandEffect::Custom { ns, payload } =
        invoca(&host, PDF_EXPORT_NOTE, json!({ "note": "Dune.md" })).expect("la richiesta parte")
    else {
        panic!("la richiesta dice dove arriverà il PDF");
    };
    assert_eq!(ns, NS_RICHIESTA);
    assert_eq!(payload["profile"]["id"], id.as_str());
    assert_eq!(payload["profile"]["from"], "type");

    // La shell la riceve come evento, col profilo intero da impaginare.
    let richiesta = loop {
        let notizia = eventi
            .recv_timeout(Duration::from_secs(30))
            .expect("la richiesta arriva alla shell");
        if let Event::Custom { topic, payload } = notizia.event {
            if topic == TOPIC_RICHIESTA {
                break payload;
            }
        }
    };
    assert_eq!(richiesta["note"], "Dune.md");
    assert_eq!(richiesta["target"], "Dune.pdf");
    assert_eq!(richiesta["profile"]["nome"], "Libri");
    assert_eq!(richiesta["request"], payload["request"]);

    // La shell impagina e manda l'elenco: il lavoro del core scrive il PDF.
    invoca(
        &host,
        PDF_WRITE_PAGES,
        json!({ "pages": elenco(), "target": richiesta["target"], "note": "Dune.md" }),
    )
    .expect("accodato");
    loop {
        let notizia = eventi
            .recv_timeout(Duration::from_secs(60))
            .expect("il lavoro finisce");
        if let Event::JobDone { result, .. } = notizia.event {
            result.expect("il PDF si scrive");
            break;
        }
    }
    let pdf = std::fs::read(root.join("Dune.pdf")).expect("il PDF c'è");
    assert!(pdf.starts_with(b"%PDF-"));
}
