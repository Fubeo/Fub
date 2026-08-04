//! Il tragitto di un documento che **non è testo**, dalla scansione all'indice.
//!
//! La [§21.8](../../../docs/roadmap/21-la-ricerca-predefinita.md) chiedeva «il
//! testo che sta dentro gli allegati», e nominava due blocchi che nel frattempo
//! erano caduti: `Vault::list_documents` (via con la
//! [0046](../../../docs/decisions/0046-l-anagrafe-del-vault.md)) e
//! `parse(source: &str)` (via con la
//! [0017](../../../docs/decisions/0017-chi-disegna-cio-che-il-core-non-conosce.md),
//! che ha messo `DocumentSource::Bytes` nel contratto). Ciò che restava non era
//! né l'anagrafe né il parser: era il **tragitto**, e a essere scollegata era
//! l'indicizzazione — che leggeva testo comunque, senza guardare cosa il
//! provider avesse dichiarato.
//!
//! Questi test sono il cliente che percorre quel tragitto. Il provider di prova
//! non è un estrattore di PDF: è la sua **forma** — byte in, testo fuori — e
//! nessun crate di parsing entra nel workspace per averla
//! ([0087](../../../docs/decisions/0087-il-testo-che-sta-dentro-gli-allegati.md)).

use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_kernel::Workspace;
use fub_testkit::{Banco, EstrattoreDiProva};

/// Byte che **non sono UTF-8 valido** e che portano comunque del testo:
/// `«allegato»` in latin-1, dove le due virgolette basse stanno a 0xAB e 0xBB.
/// È la coppia di proprietà che serve al banco — il canale del testo li
/// rifiuta, il canale dei byte li porta a destinazione.
const ALLEGATO: &[u8] = b"\xaballegato\xbb";

fn banco_con_estrattore() -> fub_testkit::Montato {
    Banco::nuovo()
        .con_estensione("md")
        .con_formato(EstrattoreDiProva::per_estensione("pdf").boxed())
        .monta()
}

/// **Il documento a byte entra nell'indice.**
///
/// Prima di questa voce finiva fra gli scarti dell'apertura, e non per una
/// decisione: `index_batch` chiamava `Vault::read`, che decodifica, e la
/// decodifica falliva. Un provider che aveva dichiarato di volere dei byte non
/// vedeva mai il proprio documento.
#[test]
fn un_documento_a_byte_non_viene_scartato() {
    let mut banco = banco_con_estrattore();
    banco.scrivi_byte("manuale.pdf", ALLEGATO);
    banco.scrivi("nota.md", "una nota normale");

    let apertura = banco.reindex().expect("la scansione riesce");

    assert!(
        apertura.intera(),
        "nessuno scarto: gli scarti sono {:?}",
        apertura.scartati
    );
}

/// **Il testo estratto è cercabile**, che è tutta la ragione per cui la §21.8
/// stava nella seduta della ricerca e non in quella del disco.
#[test]
fn il_testo_estratto_arriva_nell_indice() {
    let mut banco = banco_con_estrattore();
    banco.scrivi_byte("manuale.pdf", ALLEGATO);
    banco.reindex().expect("la scansione riesce");

    let modello = banco
        .read_model(&DocId::new("manuale.pdf"))
        .expect("il documento si parsa");

    assert!(
        modello.text.contains("allegato"),
        "il testo estratto dai byte non è arrivato al modello: {:?}",
        modello.text
    );
}

/// **Lo stesso file non si riestrae se non è cambiato.**
///
/// L'impronta di un documento a byte si prende **sui byte** e non su una
/// decodifica, e resta la stessa famiglia di impronte di prima: un documento di
/// testo non cambia impronta il giorno che qualcuno lo rivendica a byte, e un
/// allegato che non cambia non rifà il giro (la regola di `up_to_date`, dalla
/// [0046](../../../docs/decisions/0046-l-anagrafe-del-vault.md)).
#[test]
fn l_impronta_di_un_allegato_e_stabile() {
    let mut banco = banco_con_estrattore();
    banco.scrivi_byte("manuale.pdf", ALLEGATO);
    banco.reindex().expect("la scansione riesce");

    let prima = impronta(&banco, "manuale.pdf");
    assert!(prima.is_some(), "l'anagrafe non ha preso l'impronta");

    banco.reindex().expect("la seconda scansione riesce");
    assert_eq!(
        prima,
        impronta(&banco, "manuale.pdf"),
        "l'impronta di un file non toccato è cambiata fra due aperture"
    );
}

/// **Il confine dei plugin sa dire i byte.**
///
/// È la sola parte di questa voce che è costata contratto, ed è quella senza cui
/// un estrattore di terzi resterebbe impossibile: `read_document` risponde ciò
/// che risponderebbe il vault — no, questo non è testo — e
/// `read_document_bytes` porta i byte com'erano.
#[test]
fn un_plugin_puo_chiedere_i_byte() {
    let mut banco = banco_con_estrattore();
    banco.scrivi_byte("manuale.pdf", ALLEGATO);
    banco.reindex().expect("la scansione riesce");
    banco
        .register_core_feature("prova.estrattore", "prova.estrattore")
        .expect("dichiarato");

    let id = DocId::new("manuale.pdf");
    banco.with_read_host("prova.estrattore", |host| {
        assert_eq!(
            host.read_document_bytes(&id).expect("i byte si leggono"),
            ALLEGATO,
            "i byte non sono arrivati intatti al confine"
        );
        assert!(
            host.read_document(&id).is_err(),
            "il canale del testo ha accettato dei byte che non sono UTF-8"
        );
    });
}

fn impronta(ws: &Workspace, id: &str) -> Option<String> {
    let IndexResult::Entries(page) = ws
        .query_index(IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: None,
        })
        .expect("il kernel serve l'anagrafe")
    else {
        panic!("attesa l'anagrafe");
    };
    page.items
        .into_iter()
        .find(|e| e.id.as_str() == id)
        .and_then(|e| e.fingerprint)
        .map(|r| r.as_str().to_string())
}
