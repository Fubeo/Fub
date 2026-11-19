// Senza la cargo feature `draw` lo scrittore del PDF non è compilato.
#![cfg(feature = "draw")]
//! **Più note in un PDF end-to-end**, attraverso il kernel vero: tre note del
//! vault, ognuna un capitolo; il comando `pdf.write_book` compone il libro e
//! accoda il lavoro delle pagine (uno solo), il lavoro scrive il PDF, e il PDF
//! si rilegge con `lopdf`: ogni collegamento fra le note porta alla pagina e
//! all'altezza giuste, quello verso una nota non esportata resta verso fuori,
//! e l'indice del lettore è uno solo, una voce per nota coi suoi titoli sotto.
//! Che il lavoro annullato non lasci file lo prova l'host vero
//! (`fub-host/tests/pdf_export_job.rs`).

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_features::pdf_export::book::{Capitolo, Libro, Rimando, PDF_WRITE_BOOK, VERSIONE_LIBRO};
use fub_features::pdf_export::lavoro::{PDF_QUEUED, PDF_WRITE_JOB};
use fub_features::pdf_export::{ElencoPagine, Faccia, Pagina, Pezzo, Segnalibro, VERSIONE};
use fub_features::DRAW_ID;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

/// La riga dei disegni nell'inventario, come la monta l'app.
fn disegni() -> &'static fub_features::OfficialFeature {
    fub_features::every_official_feature()
        .iter()
        .find(|feature| feature.id == DRAW_ID)
        .expect("la feature dei disegni è nell'inventario")
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    /// Un vault con le tre note del libro e una che resta fuori.
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::create_dir_all(root.join("Progetto")).unwrap();
        for (nome, testo) in [
            ("Progetto/Alfa.md", "# Alfa\n\nVedi [[Beta]] e [[Fuori]].\n"),
            ("Progetto/Beta.md", "# Beta\n\nIl [[Gamma#Metodo]].\n"),
            (
                "Progetto/Gamma.md",
                "# Gamma\n\n## Metodo\n\nTorna ad [[Alfa]].\n",
            ),
            ("Fuori.md", "# Fuori\n"),
        ] {
            std::fs::write(root.join(nome), testo).unwrap();
        }
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
                .speaking("it", (disegni().catalog)()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(
            DRAW_ID,
            (disegni().commands.expect("i disegni hanno comandi"))(),
        )
        .expect("registrato");
        ws.reindex().expect("reindex");
        ws
    }
}

fn testo(y: f64, parola: &str) -> Pezzo {
    let n = parola.chars().count();
    Pezzo::Testo {
        x: 20.0,
        y,
        larghezza: 8.0 * n as f64,
        faccia: 0,
        corpo: 14.0,
        colore: [20.0, 20.0, 20.0, 1.0],
        testo: parola.into(),
        posizioni: (0..n).map(|i| i as f64 * 8.0).collect(),
        sottolineato: false,
        barrato: false,
        nodo: None,
    }
}

/// Le pagine di una nota come le misura la vista: una pagina per voce, con
/// la parola in cima; un segnalibro per ogni titolo.
fn pagine(parole: &[&str], titoli: &[(&str, u8, usize, f64)]) -> ElencoPagine {
    ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: String::new(),
        autore: String::new(),
        lingua: String::new(),
        facce: vec![Faccia {
            famiglia: "Literata Variable".into(),
            file: "/fonts/literata-latin-wght-normal.woff2".into(),
            corsivo: false,
            assi: Vec::new(),
        }],
        pagine: parole
            .iter()
            .map(|p| Pagina {
                pezzi: vec![testo(40.0, p)],
                ..Pagina::default()
            })
            .collect(),
        segnalibri: titoli
            .iter()
            .map(|(titolo, livello, pagina, y)| Segnalibro {
                titolo: (*titolo).into(),
                livello: *livello,
                pagina: *pagina,
                y: *y,
            })
            .collect(),
        struttura: Vec::new(),
    }
}

fn rimando(nota: &str, sezione: Option<&str>, url: Option<&str>) -> Rimando {
    Rimando {
        pagina: 0,
        x: 20.0,
        y: 60.0,
        w: 60.0,
        h: 16.0,
        nota: nota.into(),
        sezione: sezione.map(Into::into),
        url: url.map(Into::into),
        nodo: None,
    }
}

/// Il libro delle tre note: Alfa (una pagina) porta a Beta e a una nota
/// fuori dal libro; Beta (una pagina) porta alla sezione «Metodo» di Gamma,
/// che sta sulla seconda pagina di Gamma; Gamma (due pagine) torna ad Alfa.
fn libro() -> Libro {
    Libro {
        versione: VERSIONE_LIBRO,
        titolo: "Progetto".into(),
        autore: "Ada".into(),
        lingua: "it".into(),
        capitoli: vec![
            Capitolo {
                nota: Some("Progetto/Alfa.md".into()),
                titolo: "Alfa".into(),
                pagine: pagine(&["Alfa"], &[]),
                rimandi: vec![
                    rimando("Progetto/Beta.md", None, None),
                    rimando("Fuori.md", None, Some("https://fub.example/Fuori")),
                ],
            },
            Capitolo {
                nota: Some("Progetto/Beta.md".into()),
                titolo: "Beta".into(),
                pagine: pagine(&["Beta"], &[]),
                rimandi: vec![rimando("Progetto/Gamma.md", Some("Metodo"), None)],
            },
            Capitolo {
                nota: Some("Progetto/Gamma.md".into()),
                titolo: "Gamma".into(),
                pagine: pagine(&["Gamma", "Metodo"], &[("Metodo", 1, 1, 100.0)]),
                rimandi: vec![Rimando {
                    pagina: 1,
                    ..rimando("Progetto/Alfa.md", None, None)
                }],
            },
        ],
    }
}

/// Il comando: torna l'effetto e il lavoro che ha accodato.
fn accoda(ws: &mut Workspace, target: &str) -> (Value, fub_kernel::PendingJob) {
    let book = serde_json::to_string(&libro()).unwrap();
    let esito = ws
        .invoke_command(
            PDF_WRITE_BOOK,
            json!({ "book": book, "target": target }),
            InvokeMode::Apply,
            Actor::User,
        )
        .expect("il comando accoda il lavoro");
    let CommandEffect::Custom { ns, payload } = esito.effect else {
        panic!("il comando accoda un lavoro: {:?}", esito.effect);
    };
    assert_eq!(ns, PDF_QUEUED);
    let mut lavori = ws.take_pending_jobs();
    assert_eq!(lavori.len(), 1, "un lavoro solo per tutto il libro");
    let lavoro = lavori.remove(0);
    assert_eq!(lavoro.spec.job, PDF_WRITE_JOB);
    assert_eq!(payload["job_id"], lavoro.id.0.to_string());
    (payload, lavoro)
}

#[test]
fn tre_note_in_un_pdf_coi_collegamenti_interni_al_posto_giusto() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let (effetto, lavoro) = accoda(&mut ws, "Esportati/Progetto.pdf");
    assert_eq!(effetto["warnings"], json!([]));
    let esito = ws
        .with_host(&lavoro.plugin, |host| {
            (disegni().jobs.expect("i disegni hanno lavori"))(
                &lavoro.spec.job,
                lavoro.spec.payload.clone(),
                host,
            )
        })
        .expect("il lavoro scrive il PDF");
    assert_eq!(esito["pages"], 4);

    let pdf = std::fs::read(vault.root.join("Esportati/Progetto.pdf")).expect("il PDF c'è");
    let doc = lopdf::Document::load_mem(&pdf).expect("lopdf rilegge il PDF");
    let pagine: Vec<lopdf::ObjectId> = doc.get_pages().values().copied().collect();
    assert_eq!(pagine.len(), 4);
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
    assert_eq!(testi, vec!["Alfa", "Beta", "Gamma", "Metodo"]);

    /// I collegamenti di una pagina: verso quale pagina (indice) e a che
    /// altezza in punti, o verso quale indirizzo.
    #[derive(Debug, PartialEq)]
    enum Porta {
        Pagina(usize, f32),
        Fuori(String),
    }
    let porte = |pagina: usize| -> Vec<Porta> {
        let dict = doc.get_dictionary(pagine[pagina]).unwrap();
        let Ok(annots) = dict.get(b"Annots") else {
            return Vec::new();
        };
        annots
            .as_array()
            .unwrap()
            .iter()
            .map(|a| {
                let a = doc.get_dictionary(a.as_reference().unwrap()).unwrap();
                let azione = a.get(b"A").unwrap().as_dict().unwrap();
                match azione.get(b"S").unwrap().as_name().unwrap() {
                    b"URI" => Porta::Fuori(
                        String::from_utf8(azione.get(b"URI").unwrap().as_str().unwrap().to_vec())
                            .unwrap(),
                    ),
                    b"GoTo" => {
                        let d = azione.get(b"D").unwrap().as_array().unwrap();
                        let dove = d[0].as_reference().unwrap();
                        let indice = pagine.iter().position(|p| *p == dove).unwrap();
                        assert_eq!(d[1].as_name().unwrap(), b"XYZ");
                        Porta::Pagina(indice, d[3].as_float().unwrap())
                    }
                    altro => panic!("azione inattesa {altro:?}"),
                }
            })
            .collect()
    };
    // La pagina è alta 300 px, 225 punti; un pixel è 3/4 di punto.
    assert_eq!(
        porte(0),
        vec![
            Porta::Pagina(1, 225.0),
            Porta::Fuori("https://fub.example/Fuori".into()),
        ],
        "Alfa porta all'inizio di Beta; la nota fuori dal libro resta verso fuori"
    );
    assert_eq!(
        porte(1),
        vec![Porta::Pagina(3, 225.0 - 100.0 * 0.75)],
        "Beta porta alla sezione «Metodo», sulla seconda pagina di Gamma"
    );
    assert_eq!(porte(2), Vec::new());
    assert_eq!(
        porte(3),
        vec![Porta::Pagina(0, 225.0)],
        "Gamma torna ad Alfa"
    );

    // Un indice solo: una voce per nota, coi suoi titoli sotto.
    let indice = doc.get_toc().expect("il PDF ha i segnalibri");
    let voci: Vec<(usize, &str, usize)> = indice
        .toc
        .iter()
        .map(|v| (v.level, v.title.as_str(), v.page))
        .collect();
    assert_eq!(
        voci,
        vec![
            (1, "Alfa", 1),
            (1, "Beta", 2),
            (1, "Gamma", 3),
            (2, "Metodo", 4)
        ]
    );
    let info = doc
        .get_dictionary(doc.trailer.get(b"Info").unwrap().as_reference().unwrap())
        .unwrap();
    assert_eq!(
        lopdf::decode_text_string(info.get(b"Title").unwrap()).unwrap(),
        "Progetto"
    );
}
