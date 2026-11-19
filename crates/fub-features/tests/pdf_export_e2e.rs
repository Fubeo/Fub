// Senza la cargo feature `draw` lo scrittore del PDF non è compilato.
#![cfg(feature = "draw")]
//! **Il PDF di una nota end-to-end**, attraverso il kernel vero: il comando
//! `pdf.write_pages` controlla l'elenco e accoda il lavoro, il lavoro scrive
//! il PDF nel vault, e il PDF si rilegge con `lopdf` e si ridisegna con
//! `hayro`: c'è il testo, ci sono i collegamenti (verso fuori e verso un'altra
//! pagina) e i segnalibri. Una cartella in sola lettura è un errore e nessun
//! file.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::PluginError;
use fub_features::pdf_export::lavoro::{PDF_QUEUED, PDF_WRITE_JOB, PDF_WRITE_PAGES};
use fub_features::pdf_export::{
    Collegamento, Destinazione, ElencoPagine, Faccia, Pagina, Pezzo, Segnalibro, VERSIONE,
};
use fub_features::{DrawCommands, DRAW_ID};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(DRAW_ID, DRAW_ID)
                .speaking("it", fub_features::draw::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(DRAW_ID, Box::new(DrawCommands))
            .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn testo(x: f64, y: f64, parola: &str) -> Pezzo {
    let n = parola.chars().count();
    Pezzo::Testo {
        x,
        y,
        larghezza: 8.0 * n as f64,
        faccia: 0,
        corpo: 14.0,
        colore: [20.0, 20.0, 20.0, 1.0],
        testo: parola.into(),
        posizioni: (0..n).map(|i| i as f64 * 8.0).collect(),
        sottolineato: false,
        barrato: false,
    }
}

/// Due pagine: la prima col titolo, un collegamento verso fuori e uno verso
/// la seconda; la seconda col suo titolo. Due segnalibri, uno sotto l'altro.
fn elenco() -> ElencoPagine {
    ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: "Relazione".into(),
        autore: "Ada".into(),
        lingua: "it".into(),
        facce: vec![Faccia {
            famiglia: "Literata Variable".into(),
            file: "/fonts/literata-latin-wght-normal.woff2".into(),
            corsivo: false,
            assi: Vec::new(),
        }],
        pagine: vec![
            Pagina {
                pezzi: vec![testo(20.0, 40.0, "Introduzione"), testo(20.0, 80.0, "Sito")],
                collegamenti: vec![
                    Collegamento {
                        x: 20.0,
                        y: 68.0,
                        w: 32.0,
                        h: 16.0,
                        destinazione: Destinazione::Fuori {
                            url: "https://fub.example/".into(),
                        },
                    },
                    Collegamento {
                        x: 20.0,
                        y: 28.0,
                        w: 96.0,
                        h: 16.0,
                        destinazione: Destinazione::Dentro { pagina: 1, y: 20.0 },
                    },
                ],
            },
            Pagina {
                pezzi: vec![testo(20.0, 40.0, "Metodo")],
                ..Pagina::default()
            },
        ],
        segnalibri: vec![
            Segnalibro {
                titolo: "Introduzione".into(),
                livello: 1,
                pagina: 0,
                y: 20.0,
            },
            Segnalibro {
                titolo: "Metodo".into(),
                livello: 2,
                pagina: 1,
                y: 20.0,
            },
        ],
    }
}

/// Il comando, e poi il lavoro che ha accodato come lo esegue il runner: con
/// le capacità del bundle che l'ha chiesto.
fn esporta(ws: &mut Workspace, target: &str) -> Result<Value, PluginError> {
    let pages = serde_json::to_string(&elenco()).unwrap();
    let esito = ws.invoke_command(
        PDF_WRITE_PAGES,
        json!({ "pages": pages, "target": target, "images": "light" }),
        InvokeMode::Apply,
        Actor::User,
    )?;
    let CommandEffect::Custom { ns, payload } = esito.effect else {
        panic!("il comando accoda un lavoro: {:?}", esito.effect);
    };
    assert_eq!(ns, PDF_QUEUED);
    let mut lavori = ws.take_pending_jobs();
    assert_eq!(lavori.len(), 1);
    let lavoro = lavori.remove(0);
    assert_eq!(payload["job_id"], lavoro.id.0.to_string());
    assert_eq!(lavoro.plugin, DRAW_ID);
    assert_eq!(lavoro.spec.job, PDF_WRITE_JOB);
    let richiesta = lavoro.spec.payload.clone();
    ws.with_host(&lavoro.plugin, |host| {
        fub_features::draw::jobs(&lavoro.spec.job, richiesta, host)
    })
}

#[test]
fn il_pdf_della_nota_si_rilegge_con_testo_collegamenti_e_segnalibri() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let esito = esporta(&mut ws, "Esportati/Relazione.pdf").expect("il lavoro scrive il PDF");
    assert_eq!(esito["pages"], 2);
    assert_eq!(esito["warnings"], json!([]));

    let pdf = std::fs::read(vault.root.join("Esportati/Relazione.pdf")).expect("il PDF c'è");
    assert_eq!(esito["bytes"], pdf.len());

    // `lopdf`: il testo di ogni pagina, i collegamenti, i segnalibri, i dati.
    let doc = lopdf::Document::load_mem(&pdf).expect("lopdf rilegge il PDF");
    let pagine: Vec<lopdf::ObjectId> = doc.get_pages().values().copied().collect();
    assert_eq!(pagine.len(), 2);
    let testi: Vec<String> = doc
        .get_pages()
        .keys()
        .map(|n| {
            doc.extract_text(&[*n])
                .unwrap()
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect()
        })
        .collect();
    assert_eq!(testi, vec!["IntroduzioneSito".to_string(), "Metodo".into()]);

    let prima = doc.get_dictionary(pagine[0]).unwrap();
    let annotazioni: Vec<&lopdf::Dictionary> = prima
        .get(b"Annots")
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|a| doc.get_dictionary(a.as_reference().unwrap()).unwrap())
        .collect();
    assert_eq!(annotazioni.len(), 2);
    let azione = |a: &lopdf::Dictionary| a.get(b"A").unwrap().as_dict().unwrap().clone();
    let fuori = azione(annotazioni[0]);
    assert_eq!(fuori.get(b"S").unwrap().as_name().unwrap(), b"URI");
    assert_eq!(
        fuori.get(b"URI").unwrap().as_str().unwrap(),
        b"https://fub.example/"
    );
    let dentro = azione(annotazioni[1]);
    assert_eq!(dentro.get(b"S").unwrap().as_name().unwrap(), b"GoTo");
    let d = dentro.get(b"D").unwrap().as_array().unwrap();
    assert_eq!(d[0].as_reference().unwrap(), pagine[1]);

    let indice = doc.get_toc().expect("il PDF ha i segnalibri");
    let voci: Vec<(usize, &str, usize)> = indice
        .toc
        .iter()
        .map(|v| (v.level, v.title.as_str(), v.page))
        .collect();
    assert_eq!(voci, vec![(1, "Introduzione", 1), (2, "Metodo", 2)]);

    let info = doc
        .get_dictionary(doc.trailer.get(b"Info").unwrap().as_reference().unwrap())
        .unwrap();
    let campo = |k: &[u8]| lopdf::decode_text_string(info.get(k).unwrap()).unwrap();
    assert_eq!(campo(b"Title"), "Relazione");
    assert_eq!(campo(b"Author"), "Ada");

    // `hayro`: ogni pagina si ridisegna, e il testo è inchiostro dove la vista
    // l'ha messo.
    use hayro::hayro_interpret::InterpreterSettings;
    let letto = hayro::hayro_syntax::Pdf::new(Arc::new(pdf.clone())).expect("hayro legge il PDF");
    let pagine = letto.pages();
    assert_eq!(pagine.len(), 2);
    for pagina in pagine.iter() {
        let (w, h) = pagina.render_dimensions();
        let render = hayro::RenderSettings {
            x_scale: 1.0 / 0.75,
            y_scale: 1.0 / 0.75,
            width: Some((w / 0.75).round() as u16),
            height: Some((h / 0.75).round() as u16),
            bg_color: hayro::vello_cpu::color::palette::css::WHITE,
        };
        let pixmap = hayro::render(
            pagina,
            &hayro::RenderCache::new(),
            &InterpreterSettings::default(),
            &render,
        );
        let dati = pixmap.data_as_u8_slice();
        let larga = (w / 0.75).round() as usize;
        let scuri = (28..44)
            .flat_map(|y| (20..60).map(move |x| (y * larga + x) * 4))
            .filter(|&i| dati[i] < 128)
            .count();
        assert!(scuri > 20, "la prima parola della pagina è inchiostro");
    }
}

#[test]
fn il_comando_non_accoda_un_pdf_che_c_e_gia_e_il_piano_non_scrive() {
    let vault = Vault::new();
    std::fs::write(vault.root.join("Relazione.pdf"), b"%PDF-1.7 vecchio").unwrap();
    let mut ws = vault.open();
    let pages = serde_json::to_string(&elenco()).unwrap();
    let rifiuto = ws.invoke_command(
        PDF_WRITE_PAGES,
        json!({ "pages": pages, "target": "Relazione.pdf" }),
        InvokeMode::Apply,
        Actor::User,
    );
    assert!(
        matches!(rifiuto, Err(PluginError::AlreadyExists(_))),
        "{rifiuto:?}"
    );
    let piano = ws
        .invoke_command(
            PDF_WRITE_PAGES,
            json!({ "pages": pages, "target": "Nuovo.pdf" }),
            InvokeMode::DryRun,
            Actor::User,
        )
        .unwrap();
    assert!(matches!(piano.effect, CommandEffect::Plan(_)));
    assert!(ws.take_pending_jobs().is_empty());
    assert!(!vault.root.join("Nuovo.pdf").exists());
    assert_eq!(
        std::fs::read(vault.root.join("Relazione.pdf")).unwrap(),
        b"%PDF-1.7 vecchio"
    );
}

#[cfg(unix)]
#[test]
fn una_cartella_in_sola_lettura_e_un_errore_e_nessun_file() {
    use std::os::unix::fs::PermissionsExt;
    let vault = Vault::new();
    let cartella = vault.root.join("Chiusa");
    std::fs::create_dir(&cartella).unwrap();
    std::fs::set_permissions(&cartella, std::fs::Permissions::from_mode(0o555)).unwrap();
    // Chi gira da amministratore scrive anche lì: la prova non ha senso.
    let prova = cartella.join(".prova");
    if std::fs::write(&prova, b"").is_ok() {
        std::fs::remove_file(&prova).unwrap();
        std::fs::set_permissions(&cartella, std::fs::Permissions::from_mode(0o755)).unwrap();
        eprintln!("la cartella in sola lettura si scrive: si gira da amministratore");
        return;
    }
    let mut ws = vault.open();
    let errore = esporta(&mut ws, "Chiusa/Relazione.pdf").expect_err("la cartella non si scrive");
    std::fs::set_permissions(&cartella, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        !matches!(errore, PluginError::Cancelled(_) | PluginError::BadArgs(_)),
        "è l'errore della scrittura: {errore:?}"
    );
    let rimasti: Vec<_> = std::fs::read_dir(&cartella).unwrap().collect();
    assert!(
        rimasti.is_empty(),
        "nessun file, nemmeno a metà: {rimasti:?}"
    );
}
