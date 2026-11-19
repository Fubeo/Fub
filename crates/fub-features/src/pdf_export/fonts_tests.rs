//! Le prove dei caratteri della stampa: i file di Fub che la vista offre si
//! incorporano dal binario, e quelli del vault si elencano per famiglia col
//! permesso d'incorporarli.

use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::traits::VaultRead;
use fub_abi::CommandProvider;
use fub_sdk::testing::MemoryHost;
use serde_json::json;

use super::*;
use crate::pdf_export::lavoro::{run_job, ConIlPdf, PDF_WRITE_JOB};
use crate::pdf_export::tests::carattere_app;

/// Un carattere variabile dell'app col nome di una famiglia del vault.
fn del_vault(nome: &str, famiglia: &str) -> Vec<u8> {
    let sfnt = per_il_pdf::decode(&carattere_app(&format!("/fonts/{nome}")).unwrap())
        .unwrap()
        .into_owned();
    per_il_pdf::renamed(&sfnt, famiglia)
}

const TONDO: &str = "jetbrains-mono-latin-wght-normal.woff2";
const CORSIVO: &str = "jetbrains-mono-latin-wght-italic.woff2";

#[test]
fn pdf_export_i_caratteri_della_stampa_sono_quelli_dell_app() {
    // Le copie accanto al crate sono i file che l'app serve, byte per byte.
    for nome in nomi_dell_app() {
        let app = carattere_app(&format!("/fonts/{nome}")).unwrap();
        assert!(file_dell_app(nome) == Some(app.as_slice()), "{nome}");
    }
    // Ogni file che l'app serve si incorpora: nessun carattere che la vista
    // offre esce in Literata nel PDF.
    let cartella =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../apps/client/public/fonts");
    let mut visti = 0;
    for voce in std::fs::read_dir(cartella).unwrap() {
        let nome = voce.unwrap().file_name().into_string().unwrap();
        let byte = file_dell_app(&nome).unwrap_or_else(|| panic!("{nome} manca nel binario"));
        let sfnt = per_il_pdf::decode(byte).unwrap();
        assert!(per_il_pdf::embeddable(&sfnt, 0), "{nome}");
        visti += 1;
    }
    assert_eq!(visti, 14);
    assert_eq!(file_dell_app("non-c-e.woff2"), None);
    assert_eq!(file_dell_app("../Cargo.toml"), None);
}

#[test]
fn pdf_export_il_lavoro_incorpora_newsreader_dal_binario() {
    // La vista nomina Newsreader come l'app lo serve: il lavoro lo incorpora,
    // senza avvisi e senza ripiegare su Literata.
    let elenco = json!({
        "versione": crate::pdf_export::VERSIONE,
        "larghezza": 400.0,
        "altezza": 300.0,
        "facce": [{
            "famiglia": "Newsreader Variable",
            "file": "/fonts/newsreader-latin-opsz-normal.woff2",
            "corsivo": false,
            "assi": [{ "tag": "opsz", "valore": 12.0 }, { "tag": "wght", "valore": 400.0 }]
        }],
        "pagine": [{
            "pezzi": [{
                "tipo": "testo", "x": 20.0, "y": 40.0, "larghezza": 40.0, "faccia": 0,
                "corpo": 12.0, "colore": [0.0, 0.0, 0.0, 1.0], "testo": "Ciao",
                "posizioni": [0.0, 8.0, 12.0, 20.0]
            }]
        }]
    });
    let mut host = MemoryHost::new();
    let payload = json!({ "pages": elenco.to_string(), "target": "N.pdf" });
    let esito = run_job(PDF_WRITE_JOB, payload, &mut host).unwrap();
    assert_eq!(esito["warnings"], json!([]));
    let pdf = host.read_document_bytes(&DocId::new("N.pdf")).unwrap();
    let doc = lopdf::Document::load_mem(&pdf).unwrap();
    let nomi: Vec<String> = doc
        .objects
        .values()
        .filter_map(|o| o.as_dict().ok())
        .filter_map(|d| d.get(b"BaseFont").ok()?.as_name().ok())
        .map(|n| String::from_utf8_lossy(n).into_owned())
        .collect();
    assert!(nomi.iter().any(|n| n.contains("Newsreader")), "{nomi:?}");
    assert!(!nomi.iter().any(|n| n.contains("Literata")), "{nomi:?}");
}

/// La chiave della frase di un esito.
fn chiave(frase: Option<Text>) -> String {
    match frase {
        Some(Text::Message(m)) => m.key,
        other => panic!("{other:?}"),
    }
}

fn vault() -> MemoryHost {
    MemoryHost::new()
        .with_binary_document("Caratteri/Aperta.ttf", &del_vault(TONDO, "Aperta"))
        .with_binary_document(
            "Caratteri/Aperta-Corsivo.ttf",
            &del_vault(CORSIVO, "Aperta"),
        )
        .with_binary_document(
            "Caratteri/Riservata.ttf",
            &per_il_pdf::with_fs_type(&del_vault(TONDO, "Riservata"), 0x0002),
        )
        .with_binary_document("Caratteri/Diritta.woff2", &del_vault(TONDO, "diritta"))
        .with_binary_document("Caratteri/Rotto.otf", b"non sono un carattere")
        .with_binary_document(
            "Foto/blu.png",
            &crate::pdf_export::tests::png(2, 2, [0, 0, 255]),
        )
}

#[test]
fn pdf_export_i_caratteri_del_vault_per_famiglia_col_permesso() {
    let elenco = caratteri_del_vault(&vault());
    let famiglie: Vec<&str> = elenco
        .caratteri
        .iter()
        .map(|c| c.famiglia.as_str())
        .collect();
    // In ordine di nome, senza badare alle maiuscole.
    assert_eq!(famiglie, ["Aperta", "diritta", "Riservata"]);
    let aperta = &elenco.caratteri[0];
    assert_eq!(aperta.file, "Caratteri/Aperta.ttf");
    assert!(aperta.corsivo && aperta.incorporabile);
    assert_eq!(aperta.facce.len(), 2);
    assert_eq!(aperta.facce[0].file, "Caratteri/Aperta-Corsivo.ttf");
    assert!(aperta.facce[0].corsivo);
    assert!(!aperta.facce[1].corsivo);
    assert_eq!(aperta.facce[1].pesi, [100.0, 800.0]);
    // Un carattere senza corsivo lo dice.
    let diritta = &elenco.caratteri[1];
    assert!(!diritta.corsivo && diritta.incorporabile);
    // La licenza che non lascia incorporare.
    let riservata = &elenco.caratteri[2];
    assert!(!riservata.incorporabile);
    assert!(!riservata.facce[0].incorporabile);
    assert_eq!(elenco.chiusi(), 1);
    // Un file rotto si dice; un'immagine non è un carattere.
    assert_eq!(elenco.illeggibili, ["Caratteri/Rotto.otf"]);
    assert_eq!(elenco.tralasciati, 0);
}

#[test]
fn pdf_export_una_faccia_chiusa_chiude_la_famiglia() {
    // Il tondo si incorpora, il corsivo no: la famiglia non si usa, perché il
    // PDF uscirebbe col corsivo in un altro carattere.
    let host = MemoryHost::new()
        .with_binary_document("F/Mista.ttf", &del_vault(TONDO, "Mista"))
        .with_binary_document(
            "F/Mista-Corsivo.ttf",
            &per_il_pdf::with_fs_type(&del_vault(CORSIVO, "Mista"), 0x0200),
        );
    let elenco = caratteri_del_vault(&host);
    assert_eq!(elenco.caratteri.len(), 1);
    assert!(!elenco.caratteri[0].incorporabile);
    assert_eq!(elenco.caratteri[0].file, "F/Mista.ttf");
}

#[test]
fn pdf_export_un_vault_senza_caratteri_risponde_vuoto() {
    let elenco = caratteri_del_vault(&MemoryHost::new());
    assert_eq!(elenco, CaratteriDelVault::default());
}

#[test]
fn pdf_export_il_comando_elenca_i_caratteri_del_vault() {
    let provider = ConIlPdf(crate::draw::DrawCommands);
    let comando = provider
        .commands()
        .into_iter()
        .find(|c| c.id == PDF_VAULT_FONTS)
        .expect("il comando c'è");
    assert!(!comando.scope.writes);
    assert!(comando.params.is_empty());
    let mut host = vault();
    let esito = provider
        .invoke(PDF_VAULT_FONTS, json!({}), InvokeMode::Apply, &mut host)
        .unwrap();
    let CommandEffect::Custom { ns, payload } = esito.effect else {
        panic!("{:?}", esito.effect);
    };
    assert_eq!(ns, PDF_VAULT_FONTS_NS);
    assert_eq!(payload["caratteri"][0]["famiglia"], "Aperta");
    assert_eq!(payload["caratteri"][0]["file"], "Caratteri/Aperta.ttf");
    assert_eq!(payload["caratteri"][2]["incorporabile"], false);
    assert_eq!(payload["illeggibili"], json!(["Caratteri/Rotto.otf"]));
    assert_eq!(chiave(esito.notify), D_FOUND);
    // Un vault vuoto lo dice con la sua frase.
    let vuoto = provider
        .invoke(
            PDF_VAULT_FONTS,
            json!({}),
            InvokeMode::Apply,
            &mut MemoryHost::new(),
        )
        .unwrap();
    assert_eq!(chiave(vuoto.notify), D_NONE);
    // Ogni frase in italiano e in inglese.
    let it = in_italian(StringCatalog::new("it"));
    let en = in_english(StringCatalog::new("en"));
    for k in [T_TITLE, T_DESC, D_FOUND, D_NONE] {
        assert!(it.entries.contains_key(k), "{k} in italiano");
        assert!(en.entries.contains_key(k), "{k} in inglese");
    }
}
