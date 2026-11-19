//! Le prove del comando e del lavoro, sul doppio dell'host: cosa si controlla
//! prima di accodare, cosa il lavoro scrive e dove, e quando non scrive.

use fub_abi::model::{DocumentModel, Frontmatter};
use fub_abi::traits::{HostEnv, VaultRead};
use fub_sdk::testing::MemoryHost;
use serde_json::json;

use super::*;
use crate::pdf_export::{Faccia, Pagina, Pezzo, VERSIONE};

/// L'elenco di una pagina con una parola in Inter, il carattere di Fub che il
/// lavoro prende dal binario, e un'immagine del vault.
fn elenco_json(titolo: &str) -> String {
    let elenco = ElencoPagine {
        versione: VERSIONE,
        larghezza: 400.0,
        altezza: 300.0,
        titolo: titolo.into(),
        autore: String::new(),
        lingua: String::new(),
        facce: vec![Faccia {
            famiglia: "Inter Variable".into(),
            file: "/fonts/inter-latin-wght-normal.woff2".into(),
            corsivo: false,
            assi: Vec::new(),
        }],
        pagine: vec![Pagina {
            pezzi: vec![
                Pezzo::Testo {
                    x: 20.0,
                    y: 40.0,
                    larghezza: 40.0,
                    faccia: 0,
                    corpo: 12.0,
                    colore: [0.0, 0.0, 0.0, 1.0],
                    testo: "Ciao".into(),
                    posizioni: vec![0.0, 8.0, 12.0, 20.0],
                    sottolineato: false,
                    barrato: false,
                },
                Pezzo::Immagine {
                    x: 20.0,
                    y: 60.0,
                    w: 40.0,
                    h: 20.0,
                    file: "Foto/blu.png".into(),
                },
            ],
            ..Pagina::default()
        }],
        segnalibri: Vec::new(),
    };
    serde_json::to_string(&elenco).unwrap()
}

fn host() -> MemoryHost {
    MemoryHost::new().with_binary_document(
        "Foto/blu.png",
        &crate::pdf_export::tests::png(8, 4, [0, 0, 255]),
    )
}

fn args(target: &str) -> serde_json::Value {
    json!({ "pages": elenco_json("Prova"), "target": target })
}

fn chiave(e: &PluginError) -> String {
    let testo = match e {
        PluginError::BadArgs(t)
        | PluginError::AlreadyExists(t)
        | PluginError::Cancelled(t)
        | PluginError::NotFound(t) => t,
        other => panic!("{other:?}"),
    };
    serde_json::to_value(testo).unwrap()["key"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

#[test]
fn pdf_export_la_spec_chiede_pagine_e_destinazione() {
    let spec = spec();
    assert_eq!(spec.id, PDF_WRITE_PAGES);
    let richiesti: Vec<&str> = spec
        .params
        .iter()
        .filter(|p| p.required)
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(richiesti, vec![P_PAGES, P_TARGET]);
    assert_eq!(spec.params.len(), 5);
}

#[test]
fn pdf_export_il_piano_dice_il_pdf_e_non_scrive() {
    let mut host = host();
    let esito = invoke(args("Esportati/Nota.pdf"), InvokeMode::DryRun, &mut host).unwrap();
    match esito.effect {
        CommandEffect::Plan(plan) => assert_eq!(plan.docs, vec![DocId::new("Esportati/Nota.pdf")]),
        other => panic!("{other:?}"),
    }
    assert!(host
        .read_document_bytes(&DocId::new("Esportati/Nota.pdf"))
        .is_err());
}

#[test]
fn pdf_export_il_comando_accoda_il_lavoro_e_ne_da_l_id() {
    let mut host = host();
    let esito = invoke(args("Nota.pdf"), InvokeMode::Apply, &mut host).unwrap();
    match esito.effect {
        CommandEffect::Custom { ns, payload } => {
            assert_eq!(ns, PDF_QUEUED);
            assert_eq!(payload["job_id"], "0");
            assert_eq!(payload["path"], "Nota.pdf");
        }
        other => panic!("{other:?}"),
    }
    // Il PDF non c'è ancora: lo scrive il lavoro.
    assert!(host.read_document_bytes(&DocId::new("Nota.pdf")).is_err());
}

#[test]
fn pdf_export_destinazioni_ed_elenchi_sbagliati_si_dicono_prima_di_accodare() {
    let mut host = host().with_binary_document("C'è.pdf", b"%PDF-1.7");
    let e = invoke(args("Nota.txt"), InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_NOT_PDF);
    let e = invoke(args(".pdf"), InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_NOT_PDF);
    let e = invoke(args("../Fuori.pdf"), InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_NAME);
    let e = invoke(args("C'è.pdf"), InvokeMode::Apply, &mut host).unwrap_err();
    assert!(matches!(e, PluginError::AlreadyExists(_)));
    assert_eq!(chiave(&e), E_TAKEN);
    let sostituisci = json!({ "pages": elenco_json("x"), "target": "C'è.pdf", "replace": true });
    invoke(sostituisci, InvokeMode::Apply, &mut host).unwrap();

    let rotto = json!({ "pages": "{\"versione\": 1", "target": "Nota.pdf" });
    let e = invoke(rotto, InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_UNREADABLE);
    let enorme = json!({ "pages": " ".repeat(MAX_ELENCO_BYTE + 1), "target": "Nota.pdf" });
    let e = invoke(enorme, InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_TOO_BIG);
    let mut senza_pagine: serde_json::Value = serde_json::from_str(&elenco_json("x")).unwrap();
    senza_pagine["pagine"] = json!([]);
    let vuoto = json!({ "pages": senza_pagine.to_string(), "target": "Nota.pdf" });
    let e = invoke(vuoto, InvokeMode::Apply, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_PAGES);
}

fn richiesta(target: &str, replace: bool) -> serde_json::Value {
    json!({ "pages": elenco_json(""), "target": target, "replace": replace })
}

#[test]
fn pdf_export_il_lavoro_scrive_il_pdf_nel_vault_coi_suoi_caratteri_e_l_immagine() {
    let mut host = host();
    let esito = run_job(
        PDF_WRITE_JOB,
        richiesta("Esportati/Nota.pdf", false),
        &mut host,
    )
    .unwrap();
    assert_eq!(esito["path"], "Esportati/Nota.pdf");
    assert_eq!(esito["pages"], 1);
    assert_eq!(esito["warnings"], json!([]));
    let pdf = host
        .read_document_bytes(&DocId::new("Esportati/Nota.pdf"))
        .unwrap();
    assert_eq!(esito["bytes"], pdf.len());
    assert_eq!(
        crate::pdf_export::tests::lettere(&pdf),
        vec!["Ciao".to_string()]
    );
    // Inter è incorporato dal binario, non sostituito da Literata.
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let nomi: Vec<String> = doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter_map(|d| d.get(b"BaseFont").ok()?.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .collect();
    assert!(nomi.iter().any(|n| n.contains("Inter")), "{nomi:?}");
    // E l'immagine del vault c'è: blu nel suo riquadro.
    let img = crate::pdf_export::tests::ridisegna(&pdf, 0);
    let i = ((70 * img.0 + 40) * 4) as usize;
    assert_eq!(&img.2[i..i + 3], &[0, 0, 255]);
}

#[test]
fn pdf_export_un_immagine_o_un_carattere_che_mancano_sono_avvisi() {
    let mut host = MemoryHost::new();
    let mut elenco: serde_json::Value = serde_json::from_str(&elenco_json("")).unwrap();
    elenco["facce"][0]["file"] = json!("https://caratteri.example/x.woff2");
    let payload = json!({ "pages": elenco.to_string(), "target": "N.pdf" });
    let esito = run_job(PDF_WRITE_JOB, payload, &mut host).unwrap();
    let avvisi: Vec<&str> = esito["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["avviso"].as_str().unwrap())
        .collect();
    assert_eq!(avvisi, vec!["carattere_mancante", "immagine_mancante"]);
    assert!(host.read_document_bytes(&DocId::new("N.pdf")).is_ok());
}

#[test]
fn pdf_export_titolo_autore_e_lingua_vengono_dalla_nota_se_le_pagine_tacciono() {
    let mut fm = serde_json::Map::new();
    fm.insert("author".into(), json!(["Ada", "Charles"]));
    fm.insert("lang".into(), json!("it"));
    let mut model = DocumentModel::empty(DocId::new("Note/Relazione finale.md"));
    model.frontmatter = Frontmatter(fm);
    let mut host = host()
        .with_document("Note/Relazione finale.md", "x")
        .with_model("Note/Relazione finale.md", model);
    let comando = json!({
        "pages": elenco_json(""),
        "target": "Relazione.pdf",
        "note": "Note/Relazione finale.md",
    });
    invoke(comando, InvokeMode::Apply, &mut host).unwrap();
    // Il doppio non tiene la richiesta accodata: la si ricostruisce come la
    // scrive il comando.
    let (titolo, autore, lingua) = dati_della_nota(&DocId::new("Note/Relazione finale.md"), &host);
    assert_eq!(
        (titolo.as_str(), autore.as_str(), lingua.as_str()),
        ("Relazione finale", "Ada, Charles", "it")
    );
    let payload = json!({
        "pages": elenco_json(""),
        "target": "Relazione.pdf",
        "title": titolo,
        "author": autore,
        "lang": lingua,
    });
    run_job(PDF_WRITE_JOB, payload, &mut host).unwrap();
    let pdf = host
        .read_document_bytes(&DocId::new("Relazione.pdf"))
        .unwrap();
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let info = doc
        .get_dictionary(doc.trailer.get(b"Info").unwrap().as_reference().unwrap())
        .unwrap();
    let campo = |k: &[u8]| lopdf::decode_text_string(info.get(k).unwrap()).unwrap();
    assert_eq!(campo(b"Title"), "Relazione finale");
    assert_eq!(campo(b"Author"), "Ada, Charles");
    let lang = doc.catalog().unwrap().get(b"Lang").unwrap();
    assert_eq!(lopdf::decode_text_string(lang).unwrap(), "it");

    // Le pagine che dicono il titolo vincono sulla nota.
    let payload = json!({
        "pages": elenco_json("Dalla vista"),
        "target": "Vista.pdf",
        "title": "Dalla nota",
    });
    run_job(PDF_WRITE_JOB, payload, &mut host).unwrap();
    let pdf = host.read_document_bytes(&DocId::new("Vista.pdf")).unwrap();
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let info = doc
        .get_dictionary(doc.trailer.get(b"Info").unwrap().as_reference().unwrap())
        .unwrap();
    assert_eq!(
        lopdf::decode_text_string(info.get(b"Title").unwrap()).unwrap(),
        "Dalla vista"
    );
}

#[test]
fn pdf_export_il_lavoro_non_sovrascrive_senza_permesso_e_sostituisce_se_chiesto() {
    let vecchio = b"%PDF-1.7 vecchio".to_vec();
    let mut host = host().with_binary_document("Nota.pdf", &vecchio);
    // Il file è nato fra il comando e il lavoro: niente sovrascrittura.
    let e = run_job(PDF_WRITE_JOB, richiesta("Nota.pdf", false), &mut host).unwrap_err();
    assert!(matches!(e, PluginError::AlreadyExists(_)), "{e:?}");
    assert_eq!(
        host.read_document_bytes(&DocId::new("Nota.pdf")).unwrap(),
        vecchio
    );
    run_job(PDF_WRITE_JOB, richiesta("Nota.pdf", true), &mut host).unwrap();
    let nuovo = host.read_document_bytes(&DocId::new("Nota.pdf")).unwrap();
    assert_ne!(nuovo, vecchio);
    assert!(nuovo.starts_with(b"%PDF-"));
}

#[test]
fn pdf_export_un_lavoro_sconosciuto_o_una_richiesta_storta_sono_errori() {
    let mut host = host();
    assert!(matches!(
        run_job("pdf.altro", richiesta("N.pdf", false), &mut host),
        Err(PluginError::UnknownJob(_))
    ));
    let e = run_job(PDF_WRITE_JOB, json!({ "pagine": "x" }), &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_PAYLOAD);
    let mut lunga: serde_json::Value = richiesta("N.pdf", false);
    lunga["author"] = json!("a".repeat(crate::pdf_export::MAX_TESTO_DATI + 1));
    let e = run_job(PDF_WRITE_JOB, lunga, &mut host).unwrap_err();
    assert_eq!(chiave(&e), E_DATA);
    assert!(host.read_document_bytes(&DocId::new("N.pdf")).is_err());
}

#[test]
fn pdf_export_il_controllo_del_lavoro_conta_le_pagine_e_guarda_l_orologio() {
    let mut memoria = MemoryHost::new();
    let inizio = memoria.now_unix_millis();
    {
        let ponte = Ponte {
            host: RefCell::new(&mut memoria),
            inizio,
            riportate: RefCell::new(None),
        };
        let mut controllo = ControlloDelLavoro(&ponte);
        assert_eq!(controllo.continua(0, 2), Ok(()));
        assert_eq!(*ponte.riportate.borrow(), Some(0));
        assert_eq!(controllo.continua(1, 2), Ok(()));
        assert_eq!(*ponte.riportate.borrow(), Some(1));
    }
    memoria.advance(MAX_TEMPO_MS + 1);
    let ponte = Ponte {
        host: RefCell::new(&mut memoria),
        inizio,
        riportate: RefCell::new(None),
    };
    assert_eq!(
        ControlloDelLavoro(&ponte).continua(1, 2),
        Err(Interruzione::TempoScaduto {
            secondi: MAX_TEMPO_MS / 1000
        })
    );
}

#[test]
fn pdf_export_gli_errori_dello_scrittore_hanno_la_loro_frase() {
    assert!(matches!(
        errore(ErroreEsportazione::Annullato),
        PluginError::Cancelled(_)
    ));
    let e = errore(ErroreEsportazione::MisuraPezzo {
        pagina: 3,
        pezzo: 1,
    });
    assert_eq!(chiave(&e), E_BROKEN_PAGE);
    let e = errore(ErroreEsportazione::TempoScaduto { secondi: 600 });
    assert_eq!(chiave(&e), E_TIME);
    // Ogni chiave ha la sua frase in italiano e in inglese.
    let it = in_italian(StringCatalog::new("it"));
    let en = in_english(StringCatalog::new("en"));
    for k in [
        E_TOO_BIG,
        E_UNREADABLE,
        E_VERSION,
        E_PAGE_SIZE,
        E_PAGES,
        E_BROKEN_PAGE,
        E_BOOKMARKS,
        E_DATA,
        E_FONT,
        E_TIME,
        E_CANCELLED,
        E_NOT_PDF,
        E_NAME,
        E_TAKEN,
        E_PAYLOAD,
        P_PLAN,
        D_QUEUED,
        T_TITLE,
        T_DESC,
    ] {
        assert!(it.entries.contains_key(k), "{k} in italiano");
        assert!(en.entries.contains_key(k), "{k} in inglese");
    }
}
