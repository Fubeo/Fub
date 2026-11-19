//! Il PDF di una nota sull'host vero, con la feature `draw`: il comando
//! `pdf.write_pages` accoda il lavoro, il runner lo esegue col corpo che il
//! bundle `fub.draw` dichiara nell'inventario (`OfficialFeature::jobs`), il
//! centro attività ne vede l'avanzamento pagina per pagina, e il PDF arriva
//! nel vault intero. Un lavoro annullato non lascia nessun file, anche quando
//! scrive più note in un PDF (`pdf.write_book`: lo stesso lavoro).

#![cfg(feature = "draw")]

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::{Actor, Event};
use fub_abi::PluginError;
use fub_features::pdf_export::book::{Capitolo, Libro, PDF_WRITE_BOOK, VERSIONE_LIBRO};
use fub_features::pdf_export::lavoro::{PDF_QUEUED, PDF_WRITE_JOB, PDF_WRITE_PAGES};
use fub_features::pdf_export::{ElencoPagine, Faccia, Pagina, Pezzo, VERSIONE};
use fub_features::DRAW_ID;
use fub_format_markdown::MarkdownProvider;
use fub_host::{Custody, Host, JobHost};
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::json;

/// La riga dei disegni nell'inventario: catalogo, comandi e lavori come li
/// monta l'app, col PDF delle note composto dentro.
fn disegni() -> &'static fub_features::OfficialFeature {
    fub_features::every_official_feature()
        .iter()
        .find(|feature| feature.id == DRAW_ID)
        .expect("la feature dei disegni è nell'inventario")
}

fn elenco(pagine: usize) -> String {
    let elenco = ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: "Relazione".into(),
        autore: String::new(),
        lingua: String::new(),
        facce: vec![Faccia {
            famiglia: "Inter Variable".into(),
            file: "/fonts/inter-latin-wght-normal.woff2".into(),
            corsivo: false,
            assi: Vec::new(),
        }],
        pagine: (0..pagine)
            .map(|i| Pagina {
                pezzi: vec![Pezzo::Testo {
                    x: 20.0,
                    y: 40.0,
                    larghezza: 30.0,
                    faccia: 0,
                    corpo: 12.0,
                    colore: [0.0, 0.0, 0.0, 1.0],
                    testo: format!("P{i}"),
                    posizioni: vec![0.0, 8.0],
                    sottolineato: false,
                    barrato: false,
                }],
                ..Pagina::default()
            })
            .collect(),
        segnalibri: Vec::new(),
    };
    serde_json::to_string(&elenco).unwrap()
}

#[test]
fn il_runner_esegue_il_lavoro_e_il_pdf_arriva_nel_vault() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let host = Host::without_watcher();
    host.open(&root).expect("il vault si apre");
    host.wait_indexed(None).expect("indicizzato");
    let eventi = host.subscribe(None).unwrap();

    let esito = host
        .invoke_user_command(
            None,
            PDF_WRITE_PAGES,
            json!({ "pages": elenco(3), "target": "Esportati/Relazione.pdf" }),
            InvokeMode::Apply,
        )
        .expect("il comando accoda il lavoro");
    let CommandEffect::Custom { ns, payload } = esito.effect else {
        panic!("il comando accoda un lavoro: {:?}", esito.effect);
    };
    assert_eq!(ns, PDF_QUEUED);
    let id = payload["job_id"].as_str().unwrap().to_owned();

    let mut avanzamenti = Vec::new();
    let risultato = loop {
        let notizia = eventi
            .recv_timeout(Duration::from_secs(60))
            .expect("il lavoro finisce");
        match notizia.event {
            Event::JobProgress { id: di, progress } if di.0.to_string() == id => {
                avanzamenti.push((progress.done, progress.total));
            }
            Event::JobDone {
                id: di,
                job,
                result,
            } if di.0.to_string() == id => {
                assert_eq!(job, PDF_WRITE_JOB);
                break result;
            }
            _ => {}
        }
    };
    let risultato = risultato.expect("il lavoro scrive il PDF");
    assert_eq!(risultato["pages"], 3);
    // Il centro attività vede una pagina per passo, fino all'ultima.
    assert_eq!(avanzamenti.first(), Some(&(0, Some(3))));
    assert_eq!(avanzamenti.last(), Some(&(3, Some(3))));

    let pdf = std::fs::read(root.join("Esportati/Relazione.pdf")).expect("il PDF c'è");
    // Intero: dall'intestazione alla fine del file. Che si rilegga con le sue
    // pagine lo prova `fub-features/tests/pdf_export_e2e.rs`.
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(pdf.trim_ascii_end().ends_with(b"%%EOF"));
    assert_eq!(risultato["bytes"], pdf.len());
}

/// Il workspace di un vault con il bundle dei disegni dichiarato e il suo
/// comando: il lavoro gira con le sue capacità, come nel runner.
fn workspace(root: &Utf8PathBuf) -> Custody<Workspace> {
    let mut formats = FormatRegistry::new();
    formats.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(root, formats).unwrap();
    ws.register_plugin(
        fub_abi::traits::PluginManifest::core(DRAW_ID, DRAW_ID)
            .speaking("it", (disegni().catalog)()),
        fub_kernel::Trust::Core,
    )
    .unwrap();
    ws.register_command_provider(
        DRAW_ID,
        (disegni().commands.expect("i disegni hanno comandi"))(),
    )
    .unwrap();
    ws.reindex().unwrap();
    Custody::new("pdf export test", ws)
}

#[test]
fn un_lavoro_annullato_non_lascia_il_file() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let workspace = workspace(&root);
    let lavoro = {
        let mut ws = workspace.write().unwrap();
        ws.invoke_command(
            PDF_WRITE_PAGES,
            json!({ "pages": elenco(2), "target": "Annullato.pdf" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("accodato");
        ws.take_pending_jobs().remove(0)
    };

    // La bandiera che il runner alza quando il centro attività annulla.
    let annullato = Arc::new(AtomicBool::new(true));
    let mut job_host = JobHost::new(workspace.clone(), DRAW_ID)
        .for_job(lavoro.id)
        .cancelled_by(annullato);
    let esito = (disegni().jobs.expect("i disegni hanno lavori"))(
        &lavoro.spec.job,
        lavoro.spec.payload.clone(),
        &mut job_host,
    );
    assert!(matches!(esito, Err(PluginError::Cancelled(_))), "{esito:?}");
    assert!(!root.join("Annullato.pdf").exists());
    let rimasti: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name())
        .filter(|n| !n.to_string_lossy().starts_with('.'))
        .collect();
    assert!(
        rimasti.is_empty(),
        "nessun file, nemmeno a metà: {rimasti:?}"
    );

    // Lo stesso lavoro, non annullato, scrive il PDF: è la bandiera a
    // fermarlo, non la richiesta.
    let mut job_host = JobHost::new(workspace, DRAW_ID).for_job(lavoro.id);
    (disegni().jobs.expect("i disegni hanno lavori"))(
        &lavoro.spec.job,
        lavoro.spec.payload,
        &mut job_host,
    )
    .expect("il lavoro scrive");
    assert!(root.join("Annullato.pdf").exists());
}

#[test]
fn il_libro_di_piu_note_e_un_lavoro_solo_che_si_annulla() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    let workspace = workspace(&root);
    let capitolo = |nota: &str| Capitolo {
        nota: Some(nota.into()),
        titolo: String::new(),
        pagine: serde_json::from_str::<ElencoPagine>(&elenco(2)).unwrap(),
        rimandi: Vec::new(),
    };
    let libro = Libro {
        versione: VERSIONE_LIBRO,
        titolo: "Libro".into(),
        autore: String::new(),
        lingua: String::new(),
        capitoli: vec![capitolo("A.md"), capitolo("B.md"), capitolo("C.md")],
    };
    let lavoro = {
        let mut ws = workspace.write().unwrap();
        ws.invoke_command(
            PDF_WRITE_BOOK,
            json!({ "book": serde_json::to_string(&libro).unwrap(), "target": "Libro.pdf" }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("accodato");
        let mut lavori = ws.take_pending_jobs();
        assert_eq!(lavori.len(), 1, "un lavoro solo per tre note");
        lavori.remove(0)
    };
    assert_eq!(lavoro.spec.job, PDF_WRITE_JOB);

    let annullato = Arc::new(AtomicBool::new(true));
    let mut job_host = JobHost::new(workspace, DRAW_ID)
        .for_job(lavoro.id)
        .cancelled_by(annullato);
    let esito = (disegni().jobs.expect("i disegni hanno lavori"))(
        &lavoro.spec.job,
        lavoro.spec.payload,
        &mut job_host,
    );
    assert!(matches!(esito, Err(PluginError::Cancelled(_))), "{esito:?}");
    assert!(!root.join("Libro.pdf").exists());
}
