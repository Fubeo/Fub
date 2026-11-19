// Senza la cargo feature `draw` lo scrittore del PDF non è compilato.
#![cfg(feature = "draw")]
//! **Il PDF di una nota end-to-end**, attraverso il kernel vero: il comando
//! `pdf.write_pages` controlla l'elenco e accoda il lavoro, il lavoro scrive
//! il PDF nel vault, e il PDF si rilegge con `lopdf` e si ridisegna con
//! `hayro`: c'è il testo, ci sono i collegamenti (verso fuori e verso un'altra
//! pagina) e i segnalibri. Una cartella in sola lettura è un errore e nessun
//! file.
//!
//! Il PDF accessibile e il PDF/A passano due controlli scritti qui, sul file
//! riletto: quello d'accessibilità (il PDF marcato, la lingua, l'albero della
//! struttura, ogni sequenza della pagina nella struttura o fra gli artefatti,
//! i testi alternativi, i collegamenti nella struttura) e quello del PDF/A
//! (i metadati XMP uguali a `Info`, l'`OutputIntent` col suo profilo ICC,
//! l'identificativo, i caratteri tutti incorporati, le annotazioni
//! stampabili, nessun filtro o azione che il PDF/A vieta). Nel workspace non
//! c'è un validatore (veraPDF è Java): i due controlli ne coprono le regole
//! che lo scrittore tocca.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::event::Actor;
use fub_abi::PluginError;
use fub_features::pdf_export::lavoro::{PDF_QUEUED, PDF_WRITE_JOB, PDF_WRITE_PAGES};
use fub_features::pdf_export::{
    Collegamento, Destinazione, ElencoPagine, Faccia, Nodo, Pagina, Pezzo, Segnalibro, Specie,
    VERSIONE,
};
use fub_features::DRAW_ID;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

/// La riga dei disegni nell'inventario: catalogo, comandi e lavori come li
/// monta l'app, col PDF delle note composto dentro.
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
        nodo: None,
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
                        nodo: None,
                    },
                    Collegamento {
                        x: 20.0,
                        y: 28.0,
                        w: 96.0,
                        h: 16.0,
                        destinazione: Destinazione::Dentro { pagina: 1, y: 20.0 },
                        nodo: None,
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
        struttura: Vec::new(),
    }
}

/// Il comando, e poi il lavoro che ha accodato come lo esegue il runner: con
/// le capacità del bundle che l'ha chiesto.
fn esporta(ws: &mut Workspace, target: &str) -> Result<Value, PluginError> {
    esporta_con(ws, target, &elenco(), json!({ "images": "light" }))
}

/// Come [`esporta`], con un elenco e i parametri in più del comando.
fn esporta_con(
    ws: &mut Workspace,
    target: &str,
    elenco: &ElencoPagine,
    altri: Value,
) -> Result<Value, PluginError> {
    let pages = serde_json::to_string(elenco).unwrap();
    let mut args = json!({ "pages": pages, "target": target });
    for (k, v) in altri.as_object().expect("i parametri sono un oggetto") {
        args[k] = v.clone();
    }
    let esito = ws.invoke_command(PDF_WRITE_PAGES, args, InvokeMode::Apply, Actor::User)?;
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
        (disegni().jobs.expect("i disegni hanno lavori"))(&lavoro.spec.job, richiesta, host)
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

// ---------------------------------------------------------------------------
// Il PDF accessibile e il PDF/A.

fn nodo(specie: Specie, genitore: Option<usize>) -> Nodo {
    Nodo {
        specie,
        genitore,
        livello: None,
        alt: String::new(),
        lingua: String::new(),
        ambito: None,
        numerato: None,
    }
}

fn nel_nodo(mut pezzo: Pezzo, n: usize) -> Pezzo {
    if let Pezzo::Testo { nodo, .. } | Pezzo::Vettore { nodo, .. } = &mut pezzo {
        *nodo = Some(n);
    }
    pezzo
}

/// La nota di [`elenco`] con la sua struttura: i titoli, il paragrafo col
/// collegamento, e nella seconda pagina un diagramma col suo testo
/// alternativo, una tabella con l'intestazione, un elenco puntato e il numero
/// di pagina, che è un artefatto.
fn elenco_accessibile() -> ElencoPagine {
    let mut e = elenco();
    e.struttura = vec![
        Nodo {
            livello: Some(1),
            ..nodo(Specie::Titolo, None)
        }, // 0
        nodo(Specie::Collegamento, Some(0)), // 1: il titolo porta alla pagina 2
        nodo(Specie::Paragrafo, None),       // 2
        nodo(Specie::Collegamento, Some(2)), // 3
        Nodo {
            livello: Some(2),
            ..nodo(Specie::Titolo, None)
        }, // 4
        Nodo {
            alt: "Il flusso della nota: si scrive, si impagina, si esporta.".into(),
            ..nodo(Specie::Figura, None)
        }, // 5
        nodo(Specie::Tabella, None),         // 6
        nodo(Specie::Riga, Some(6)),         // 7
        nodo(Specie::Intestazione, Some(7)), // 8
        nodo(Specie::Riga, Some(6)),         // 9
        nodo(Specie::Cella, Some(9)),        // 10
        nodo(Specie::Elenco, None),          // 11
        nodo(Specie::Voce, Some(11)),        // 12
        nodo(Specie::Etichetta, Some(12)),   // 13
        nodo(Specie::CorpoVoce, Some(12)),   // 14
    ];
    let p0 = &mut e.pagine[0];
    p0.pezzi = vec![
        nel_nodo(testo(20.0, 40.0, "Introduzione"), 1),
        nel_nodo(testo(20.0, 80.0, "Sito"), 3),
    ];
    p0.collegamenti[0].nodo = Some(3);
    p0.collegamenti[1].nodo = Some(1);
    e.pagine[1].pezzi = vec![
        nel_nodo(testo(20.0, 40.0, "Metodo"), 4),
        nel_nodo(
            Pezzo::Vettore {
                x: 20.0,
                y: 60.0,
                w: 120.0,
                h: 40.0,
                svg: r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect x="2" y="2" width="116" height="36" rx="6" fill="#e8eefc" stroke="#36c"/><path d="M20 20 H100" stroke="#123" stroke-width="2"/></svg>"##.into(),
                nodo: None,
            },
            5,
        ),
        nel_nodo(testo(20.0, 130.0, "Nome"), 8),
        Pezzo::Riquadro {
            x: 20.0,
            y: 134.0,
            w: 120.0,
            h: 1.0,
            colore: [0.0, 0.0, 0.0, 1.0],
        },
        nel_nodo(testo(20.0, 150.0, "Ada"), 10),
        nel_nodo(testo(20.0, 180.0, "-"), 13),
        nel_nodo(testo(36.0, 180.0, "Prima"), 14),
        testo(190.0, 280.0, "2"),
    ];
    e
}

fn dizionario<'a>(doc: &'a lopdf::Document, o: &'a lopdf::Object) -> Option<&'a lopdf::Dictionary> {
    match o {
        lopdf::Object::Reference(r) => doc.get_dictionary(*r).ok(),
        lopdf::Object::Dictionary(d) => Some(d),
        _ => None,
    }
}

fn nome_di(d: &lopdf::Dictionary, k: &[u8]) -> Option<String> {
    d.get(k)
        .ok()
        .and_then(|o| o.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
}

fn testo_di(doc: &lopdf::Document, o: &lopdf::Object) -> Option<String> {
    let o = match o {
        lopdf::Object::Reference(r) => doc.get_object(*r).ok()?,
        o => o,
    };
    lopdf::decode_text_string(o).ok()
}

fn catalogo(doc: &lopdf::Document) -> &lopdf::Dictionary {
    let r = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    doc.get_dictionary(r).unwrap()
}

/// Il flusso dei metadati XMP del catalogo: il testo, e se è compresso.
fn metadati_xmp(doc: &lopdf::Document) -> Option<(String, bool)> {
    let r = catalogo(doc).get(b"Metadata").ok()?.as_reference().ok()?;
    let s = doc.get_object(r).ok()?.as_stream().ok()?;
    Some((
        String::from_utf8_lossy(&s.content).into_owned(),
        s.dict.has(b"Filter"),
    ))
}

/// I ruoli standard della struttura (PDF 1.7 §14.8.4).
const RUOLI: &[&str] = &[
    "Document",
    "Part",
    "Art",
    "Sect",
    "Div",
    "BlockQuote",
    "Caption",
    "TOC",
    "TOCI",
    "Index",
    "NonStruct",
    "Private",
    "P",
    "H",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "L",
    "LI",
    "Lbl",
    "LBody",
    "Table",
    "TR",
    "TH",
    "TD",
    "THead",
    "TBody",
    "TFoot",
    "Span",
    "Quote",
    "Note",
    "Reference",
    "BibEntry",
    "Code",
    "Link",
    "Annot",
    "Ruby",
    "RB",
    "RT",
    "RP",
    "Warichu",
    "WT",
    "WP",
    "Figure",
    "Formula",
    "Form",
];

/// Il controllo d'accessibilità: ciò che un PDF marcato deve avere perché un
/// lettore di schermo lo legga (PDF 1.7 §14.7–14.8, e le regole di PDF/UA che
/// lo scrittore tocca). Torna i problemi, uno per riga; vuoto, il file passa.
fn controlla_accessibile(doc: &lopdf::Document) -> Vec<String> {
    use std::collections::{BTreeMap, BTreeSet};
    let mut problemi = Vec::new();
    let cat = catalogo(doc);
    let marcato = cat
        .get(b"MarkInfo")
        .ok()
        .and_then(|o| dizionario(doc, o))
        .and_then(|d| d.get(b"Marked").ok()?.as_bool().ok());
    if marcato != Some(true) {
        problemi.push("il catalogo non dice MarkInfo /Marked true".to_string());
    }
    if cat
        .get(b"Lang")
        .ok()
        .and_then(|o| testo_di(doc, o))
        .is_none_or(|l| l.trim().is_empty())
    {
        problemi.push("il catalogo non dice la lingua".into());
    }
    let titolo_mostrato = cat
        .get(b"ViewerPreferences")
        .ok()
        .and_then(|o| dizionario(doc, o))
        .and_then(|d| d.get(b"DisplayDocTitle").ok()?.as_bool().ok());
    if titolo_mostrato != Some(true) {
        problemi.push("il lettore non mostra il titolo (DisplayDocTitle)".into());
    }
    if !metadati_xmp(doc).is_some_and(|(xml, _)| xml.contains("<dc:title>")) {
        problemi.push("i metadati XMP non dicono il titolo".into());
    }
    let Some(radice) = cat
        .get(b"StructTreeRoot")
        .ok()
        .and_then(|o| dizionario(doc, o))
    else {
        problemi.push("nessun albero della struttura".into());
        return problemi;
    };

    // L'albero: ogni elemento col suo ruolo, il suo genitore e ciò che
    // contiene.
    let mut ruolo: BTreeMap<lopdf::ObjectId, String> = BTreeMap::new();
    let mut mcr: BTreeMap<(lopdf::ObjectId, i64), lopdf::ObjectId> = BTreeMap::new();
    let mut objr: BTreeMap<lopdf::ObjectId, lopdf::ObjectId> = BTreeMap::new();
    let mut figli_di: BTreeMap<lopdf::ObjectId, Vec<lopdf::ObjectId>> = BTreeMap::new();
    let mut da_visitare: Vec<(lopdf::ObjectId, Option<lopdf::ObjectId>)> = Vec::new();
    match radice.get(b"K") {
        Ok(lopdf::Object::Reference(r)) => da_visitare.push((*r, None)),
        Ok(lopdf::Object::Array(a)) => da_visitare.extend(
            a.iter()
                .filter_map(|o| o.as_reference().ok())
                .map(|r| (r, None)),
        ),
        _ => problemi.push("l'albero della struttura è vuoto".into()),
    }
    while let Some((id, genitore)) = da_visitare.pop() {
        if ruolo.contains_key(&id) {
            problemi.push(format!("l'elemento {id:?} compare due volte"));
            continue;
        }
        let Ok(el) = doc.get_dictionary(id) else {
            problemi.push(format!("l'elemento {id:?} non c'è"));
            continue;
        };
        let s = nome_di(el, b"S").unwrap_or_default();
        if !RUOLI.contains(&s.as_str()) {
            problemi.push(format!("il ruolo «{s}» non è un ruolo del PDF"));
        }
        if let Some(g) = genitore {
            if el.get(b"P").ok().and_then(|p| p.as_reference().ok()) != Some(g) {
                problemi.push(format!("l'elemento {s} non nomina il suo genitore"));
            }
            figli_di.entry(g).or_default().push(id);
        }
        if matches!(s.as_str(), "Figure" | "Formula") {
            let alt = el
                .get(b"Alt")
                .ok()
                .or_else(|| el.get(b"ActualText").ok())
                .and_then(|o| testo_di(doc, o));
            if alt.is_none_or(|a| a.trim().is_empty()) {
                problemi.push(format!("un elemento {s} senza testo alternativo"));
            }
        }
        ruolo.insert(id, s);
        let pagina_el = el.get(b"Pg").ok().and_then(|p| p.as_reference().ok());
        let figli = match el.get(b"K") {
            Ok(lopdf::Object::Array(a)) => a.clone(),
            Ok(o) => vec![o.clone()],
            Err(_) => Vec::new(),
        };
        for figlio in figli {
            match figlio {
                lopdf::Object::Integer(m) => match pagina_el {
                    Some(pg) => {
                        mcr.insert((pg, m), id);
                    }
                    None => problemi.push("un MCID senza pagina".into()),
                },
                lopdf::Object::Reference(r) => da_visitare.push((r, Some(id))),
                lopdf::Object::Dictionary(d) => match nome_di(&d, b"Type").as_deref() {
                    Some("MCR") => {
                        let pg = d
                            .get(b"Pg")
                            .ok()
                            .and_then(|p| p.as_reference().ok())
                            .or(pagina_el);
                        match (pg, d.get(b"MCID").ok().and_then(|m| m.as_i64().ok())) {
                            (Some(pg), Some(m)) => {
                                mcr.insert((pg, m), id);
                            }
                            _ => problemi.push("un MCR senza pagina o MCID".into()),
                        }
                    }
                    Some("OBJR") => match d.get(b"Obj").ok().and_then(|o| o.as_reference().ok()) {
                        Some(o) => {
                            objr.insert(o, id);
                        }
                        None => problemi.push("un OBJR senza oggetto".into()),
                    },
                    altro => problemi.push(format!("un figlio sconosciuto {altro:?}")),
                },
                altro => problemi.push(format!("un figlio sconosciuto {altro:?}")),
            }
        }
    }
    // Una tabella ha le sue celle d'intestazione.
    for (id, s) in &ruolo {
        if s != "Table" {
            continue;
        }
        let mut pila = figli_di.get(id).cloned().unwrap_or_default();
        let mut trovata = false;
        while let Some(f) = pila.pop() {
            trovata |= ruolo.get(&f).is_some_and(|r| r == "TH");
            pila.extend(figli_di.get(&f).cloned().unwrap_or_default());
        }
        if !trovata {
            problemi.push("una tabella senza celle d'intestazione".into());
        }
    }

    // Il `ParentTree`, letto nella forma piatta (`Nums`).
    let mut genitori: BTreeMap<i64, lopdf::Object> = BTreeMap::new();
    match radice
        .get(b"ParentTree")
        .ok()
        .and_then(|o| dizionario(doc, o))
        .and_then(|d| d.get(b"Nums").ok()?.as_array().ok())
    {
        Some(nums) => {
            for coppia in nums.chunks(2) {
                if let [k, v] = coppia {
                    genitori.insert(k.as_i64().unwrap_or(-1), v.clone());
                }
            }
        }
        None => problemi.push("nessun ParentTree leggibile".into()),
    }

    // Ogni pagina: ogni sequenza marcata sta nell'albero e nel `ParentTree`,
    // e ogni cosa che disegna sta in una sequenza o in un artefatto.
    for (n, &pagina) in doc.get_pages().iter() {
        let pd = doc.get_dictionary(pagina).unwrap();
        let contenuto = lopdf::content::Content::decode(&doc.get_page_content(pagina)).unwrap();
        let mut aperte: Vec<Option<i64>> = Vec::new();
        let mut viste: BTreeSet<i64> = BTreeSet::new();
        for op in &contenuto.operations {
            match op.operator.as_str() {
                "BDC" => {
                    let props = op.operands.get(1).and_then(|o| dizionario(doc, o));
                    let mcid = props.and_then(|p| p.get(b"MCID").ok()?.as_i64().ok());
                    let artefatto = op.operands[0].as_name().ok() == Some(b"Artifact".as_slice());
                    match (mcid, artefatto) {
                        (Some(m), _) => {
                            viste.insert(m);
                            if !mcr.contains_key(&(pagina, m)) {
                                problemi.push(format!("pagina {n}: l'MCID {m} non è nell'albero"));
                            }
                        }
                        (None, true) => {}
                        (None, false) => {
                            problemi.push(format!("pagina {n}: una sequenza senza MCID"))
                        }
                    }
                    aperte.push(mcid);
                }
                "BMC" => {
                    if op.operands[0].as_name().ok() != Some(b"Artifact".as_slice()) {
                        problemi.push(format!(
                            "pagina {n}: una sequenza BMC che non è un artefatto"
                        ));
                    }
                    aperte.push(None);
                }
                "EMC" if aperte.pop().is_none() => {
                    problemi.push(format!("pagina {n}: un EMC di troppo"));
                }
                "Tj" | "TJ" | "'" | "\"" | "Do" | "f" | "F" | "f*" | "B" | "B*" | "b" | "b*"
                | "S" | "s" | "sh" | "BI"
                    if aperte.is_empty() =>
                {
                    problemi.push(format!(
                        "pagina {n}: «{}» fuori da ogni sequenza e da ogni artefatto",
                        op.operator
                    ));
                }
                _ => {}
            }
        }
        if !viste.is_empty() {
            let chiave = pd.get(b"StructParents").ok().and_then(|k| k.as_i64().ok());
            let elenco = chiave.and_then(|k| genitori.get(&k)).and_then(|o| match o {
                lopdf::Object::Reference(r) => doc.get_object(*r).ok()?.as_array().ok(),
                lopdf::Object::Array(a) => Some(a),
                _ => None,
            });
            match elenco {
                Some(elenco) => {
                    for m in &viste {
                        let nel_parent =
                            elenco.get(*m as usize).and_then(|o| o.as_reference().ok());
                        if nel_parent != mcr.get(&(pagina, *m)).copied() {
                            problemi.push(format!(
                                "pagina {n}: il ParentTree non riporta l'MCID {m} al suo elemento"
                            ));
                        }
                    }
                }
                None => problemi.push(format!("pagina {n}: senza StructParents nel ParentTree")),
            }
        }
        // Le annotazioni stanno nella struttura e dicono che cosa sono.
        let annotazioni: Vec<lopdf::ObjectId> = pd
            .get(b"Annots")
            .ok()
            .and_then(|a| a.as_array().ok())
            .map(|a| a.iter().filter_map(|o| o.as_reference().ok()).collect())
            .unwrap_or_default();
        if !annotazioni.is_empty() && nome_di(pd, b"Tabs").as_deref() != Some("S") {
            problemi.push(format!("pagina {n}: le annotazioni senza Tabs /S"));
        }
        for a in annotazioni {
            let ad = doc.get_dictionary(a).unwrap();
            let elemento = ad
                .get(b"StructParent")
                .ok()
                .and_then(|k| k.as_i64().ok())
                .and_then(|k| genitori.get(&k))
                .and_then(|o| o.as_reference().ok());
            if elemento.is_none() || objr.get(&a).copied() != elemento {
                problemi.push(format!("pagina {n}: un'annotazione fuori dalla struttura"));
            }
            if nome_di(ad, b"Subtype").as_deref() == Some("Link") {
                if elemento.and_then(|e| ruolo.get(&e)).map(String::as_str) != Some("Link") {
                    problemi.push(format!(
                        "pagina {n}: un collegamento fuori da un elemento Link"
                    ));
                }
                if ad
                    .get(b"Contents")
                    .ok()
                    .and_then(|o| testo_di(doc, o))
                    .is_none_or(|c| c.trim().is_empty())
                {
                    problemi.push(format!("pagina {n}: un collegamento senza descrizione"));
                }
            }
        }
    }
    problemi
}

/// Il testo di un elemento XMP semplice, `<tag>…</tag>`, con le entità
/// sciolte.
fn nell_xmp(xml: &str, apre: &str, chiude: &str) -> Option<String> {
    let inizio = xml.find(apre)? + apre.len();
    let fine = inizio + xml[inizio..].find(chiude)?;
    Some(
        xml[inizio..fine]
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&"),
    )
}

/// Il controllo del PDF/A-2b: le regole di ISO 19005-2 che lo scrittore tocca.
/// Torna i problemi; vuoto, il file passa.
fn controlla_pdfa(doc: &lopdf::Document, pdf: &[u8]) -> Vec<String> {
    let mut problemi = Vec::new();
    // L'intestazione: una versione fino alla 1.7, e la riga di commento con
    // quattro byte binari.
    let mut righe = pdf.split(|b| *b == b'\n');
    let prima = righe.next().unwrap_or_default();
    if !prima.starts_with(b"%PDF-1.") || prima.get(7).is_none_or(|v| *v > b'7') {
        problemi.push("l'intestazione non è %PDF-1.x con x fino a 7".to_string());
    }
    let seconda = righe.next().unwrap_or_default();
    if !(seconda.first() == Some(&b'%') && seconda.iter().skip(1).take(4).all(|b| *b >= 128)) {
        problemi.push("manca il commento binario nella seconda riga".into());
    }
    // Il trailer: l'identificativo, e nessuna cifratura.
    match doc.trailer.get(b"ID").ok().and_then(|o| o.as_array().ok()) {
        Some(id) if id.len() == 2 && id.iter().all(|s| s.as_str().is_ok_and(|s| !s.is_empty())) => {
        }
        _ => problemi.push("il trailer non ha l'identificativo".into()),
    }
    if doc.trailer.has(b"Encrypt") {
        problemi.push("il PDF è cifrato".into());
    }
    // I metadati: in chiaro, PDF/A-2, uguali a `Info`.
    let info = doc
        .trailer
        .get(b"Info")
        .ok()
        .and_then(|o| dizionario(doc, o))
        .cloned()
        .unwrap_or_default();
    let campo = |k: &[u8]| info.get(k).ok().and_then(|o| testo_di(doc, o));
    match metadati_xmp(doc) {
        None => problemi.push("nessun flusso di metadati XMP nel catalogo".into()),
        Some((xml, filtrato)) => {
            if filtrato {
                problemi.push("i metadati XMP sono compressi".into());
            }
            if nell_xmp(&xml, "<pdfaid:part>", "</pdfaid:part>").as_deref() != Some("2") {
                problemi.push("i metadati non dicono pdfaid:part 2".into());
            }
            if !matches!(
                nell_xmp(&xml, "<pdfaid:conformance>", "</pdfaid:conformance>").as_deref(),
                Some("A" | "B" | "U")
            ) {
                problemi.push("i metadati non dicono il livello".into());
            }
            let coppie = [
                (
                    b"Title".as_slice(),
                    nell_xmp(&xml, "<rdf:li xml:lang=\"x-default\">", "</rdf:li>"),
                ),
                (
                    b"Author".as_slice(),
                    nell_xmp(&xml, "<dc:creator><rdf:Seq><rdf:li>", "</rdf:li>"),
                ),
                (
                    b"Producer".as_slice(),
                    nell_xmp(&xml, "<pdf:Producer>", "</pdf:Producer>"),
                ),
                (
                    b"Creator".as_slice(),
                    nell_xmp(&xml, "<xmp:CreatorTool>", "</xmp:CreatorTool>"),
                ),
            ];
            for (k, nei_metadati) in coppie {
                if campo(k) != nei_metadati {
                    problemi.push(format!(
                        "Info {} e i metadati non coincidono",
                        String::from_utf8_lossy(k)
                    ));
                }
            }
            for k in [b"CreationDate".as_slice(), b"ModDate"] {
                if info.has(k) && !xml.contains("xmp:CreateDate") {
                    problemi.push("una data in Info senza la sua nei metadati".into());
                }
            }
        }
    }
    // L'OutputIntent col suo profilo ICC.
    let intento = catalogo(doc)
        .get(b"OutputIntents")
        .ok()
        .and_then(|o| o.as_array().ok())
        .and_then(|a| {
            a.iter()
                .filter_map(|o| dizionario(doc, o))
                .find(|d| nome_di(d, b"S").as_deref() == Some("GTS_PDFA1"))
        });
    match intento {
        None => problemi.push("nessun OutputIntent GTS_PDFA1".into()),
        Some(intento) => {
            let profilo = intento
                .get(b"DestOutputProfile")
                .ok()
                .and_then(|o| o.as_reference().ok())
                .and_then(|r| doc.get_object(r).ok()?.as_stream().ok());
            match profilo {
                None => problemi.push("l'OutputIntent senza profilo".into()),
                Some(s) => {
                    let p = s
                        .decompressed_content()
                        .unwrap_or_else(|_| s.content.clone());
                    let misura = p
                        .get(0..4)
                        .map(|b| u32::from_be_bytes(b.try_into().unwrap()) as usize);
                    let n = s.dict.get(b"N").ok().and_then(|n| n.as_i64().ok());
                    if misura != Some(p.len())
                        || p.get(36..40) != Some(b"acsp".as_slice())
                        || p.get(16..20) != Some(b"RGB ".as_slice())
                        || n != Some(3)
                        || !matches!(p.get(8), Some(2..=4))
                    {
                        problemi.push("il profilo dell'OutputIntent non è un ICC RGB".into());
                    }
                }
            }
        }
    }
    // Gli oggetti, uno per uno.
    for (id, oggetto) in &doc.objects {
        let d = match oggetto {
            lopdf::Object::Dictionary(d) => d,
            lopdf::Object::Stream(s) => &s.dict,
            _ => continue,
        };
        let filtri: Vec<Vec<u8>> = match d.get(b"Filter") {
            Ok(lopdf::Object::Name(n)) => vec![n.clone()],
            Ok(lopdf::Object::Array(a)) => a
                .iter()
                .filter_map(|o| o.as_name().ok().map(<[u8]>::to_vec))
                .collect(),
            _ => Vec::new(),
        };
        if filtri.iter().any(|f| f == b"LZWDecode") {
            problemi.push(format!("{id:?}: il filtro LZW"));
        }
        if d.has(b"JS") || matches!(nome_di(d, b"S").as_deref(), Some("JavaScript" | "Launch")) {
            problemi.push(format!("{id:?}: un'azione che il PDF/A vieta"));
        }
        if d.get(b"Interpolate").ok().and_then(|o| o.as_bool().ok()) == Some(true) {
            problemi.push(format!("{id:?}: un'immagine interpolata"));
        }
        if d.has(b"TR") {
            problemi.push(format!("{id:?}: una funzione di trasferimento"));
        }
        let tipo = nome_di(d, b"Type");
        if tipo.as_deref() == Some("Annot") || nome_di(d, b"Subtype").as_deref() == Some("Link") {
            let f = d.get(b"F").ok().and_then(|f| f.as_i64().ok()).unwrap_or(0);
            if f & 4 == 0 || f & (1 | 2 | 32) != 0 {
                problemi.push(format!("{id:?}: un'annotazione che non si stampa"));
            }
        }
        if tipo.as_deref() == Some("Font") {
            let descrittore = match nome_di(d, b"Subtype").as_deref() {
                Some("Type3") => continue,
                Some("Type0") => d
                    .get(b"DescendantFonts")
                    .ok()
                    .and_then(|o| o.as_array().ok())
                    .and_then(|a| dizionario(doc, a.first()?))
                    .and_then(|cid| {
                        if nome_di(cid, b"Subtype").as_deref() == Some("CIDFontType2")
                            && !cid.has(b"CIDToGIDMap")
                        {
                            problemi.push(format!("{id:?}: un CIDFontType2 senza CIDToGIDMap"));
                        }
                        cid.get(b"FontDescriptor").ok().cloned()
                    }),
                _ => d.get(b"FontDescriptor").ok().cloned(),
            };
            let incorporato = descrittore
                .as_ref()
                .and_then(|o| dizionario(doc, o))
                .is_some_and(|fd| {
                    fd.has(b"FontFile") || fd.has(b"FontFile2") || fd.has(b"FontFile3")
                });
            if !incorporato {
                problemi.push(format!("{id:?}: un carattere non incorporato"));
            }
        }
    }
    if let Some(nomi) = catalogo(doc)
        .get(b"Names")
        .ok()
        .and_then(|o| dizionario(doc, o))
    {
        if nomi.has(b"EmbeddedFiles") || nomi.has(b"JavaScript") {
            problemi.push("file allegati o JavaScript nel catalogo".into());
        }
    }
    problemi
}

fn esporta_e_rileggi(
    ws: &mut Workspace,
    vault: &Vault,
    target: &str,
    e: &ElencoPagine,
    altri: Value,
) -> (Value, Vec<u8>, lopdf::Document) {
    let esito = esporta_con(ws, target, e, altri).expect("il lavoro scrive il PDF");
    let pdf = std::fs::read(vault.root.join(target)).expect("il PDF c'è");
    let doc = lopdf::Document::load_mem(&pdf).expect("lopdf rilegge il PDF");
    (esito, pdf, doc)
}

#[test]
fn il_pdf_accessibile_e_pdfa_passa_i_due_controlli() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let (esito, pdf, doc) = esporta_e_rileggi(
        &mut ws,
        &vault,
        "Archivio.pdf",
        &elenco_accessibile(),
        json!({ "images": "light", "accessible": true, "pdfa": true }),
    );
    assert_eq!(esito["warnings"], json!([]));
    assert_eq!(controlla_accessibile(&doc), Vec::<String>::new());
    assert_eq!(controlla_pdfa(&doc, &pdf), Vec::<String>::new());

    // La lingua del documento, e il testo che si legge come prima.
    assert_eq!(
        testo_di(&doc, catalogo(&doc).get(b"Lang").unwrap()).as_deref(),
        Some("it")
    );
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
    assert!(testi[0].starts_with("IntroduzioneSito"), "{testi:?}");
    assert!(testi[1].contains("Metodo"), "{testi:?}");

    // E `hayro` lo legge.
    let letto = hayro::hayro_syntax::Pdf::new(Arc::new(pdf)).expect("hayro legge il PDF");
    assert_eq!(letto.pages().len(), 2);
}

#[test]
fn i_due_controlli_trovano_cio_che_manca_in_un_pdf_qualunque() {
    // La prova dei controlli: sul PDF senza tag e senza PDF/A dicono che cosa
    // manca, quindi non passano per niente.
    let vault = Vault::new();
    let mut ws = vault.open();
    let (_, pdf, doc) = esporta_e_rileggi(&mut ws, &vault, "Semplice.pdf", &elenco(), json!({}));
    let accessibile = controlla_accessibile(&doc);
    for atteso in ["MarkInfo", "albero della struttura"] {
        assert!(
            accessibile.iter().any(|p| p.contains(atteso)),
            "{atteso}: {accessibile:?}"
        );
    }
    let pdfa = controlla_pdfa(&doc, &pdf);
    for atteso in [
        "identificativo",
        "metadati XMP",
        "OutputIntent",
        "non si stampa",
    ] {
        assert!(
            pdfa.iter().any(|p| p.contains(atteso)),
            "{atteso}: {pdfa:?}"
        );
    }

    // Una figura senza testo alternativo esce con l'avviso, e il controllo la
    // trova.
    let mut senza_alt = elenco_accessibile();
    senza_alt.struttura[5].alt.clear();
    let (esito, _, doc) = esporta_e_rileggi(
        &mut ws,
        &vault,
        "SenzaAlt.pdf",
        &senza_alt,
        json!({ "accessible": true }),
    );
    assert_eq!(
        esito["warnings"],
        json!([{ "avviso": "testo_alternativo_mancante", "nodo": 5, "pagina": 2 }])
    );
    assert_eq!(
        controlla_accessibile(&doc),
        vec!["un elemento Figure senza testo alternativo".to_string()]
    );
}

#[test]
fn un_pdfa_che_non_si_puo_scrivere_lo_dice_e_non_lascia_file() {
    let vault = Vault::new();
    let mut ws = vault.open();
    let mut e = elenco();
    e.pagine[1].pezzi = vec![testo(20.0, 40.0, "Metodo中")];
    let errore = esporta_con(&mut ws, "Archivio.pdf", &e, json!({ "pdfa": true }))
        .expect_err("il PDF/A non ammette lettere senza disegno");
    let PluginError::BadArgs(testo) = errore else {
        panic!("{errore:?}");
    };
    let testo = serde_json::to_value(testo).unwrap();
    assert_eq!(testo["key"], "e_pdf_pdfa_glyphs", "{testo}");
    assert!(!vault.root.join("Archivio.pdf").exists());
    // Senza PDF/A lo stesso elenco si scrive, con l'avviso.
    let esito = esporta_con(&mut ws, "Archivio.pdf", &e, json!({})).unwrap();
    assert_eq!(esito["warnings"][0]["avviso"], "lettere_mancanti");
}
