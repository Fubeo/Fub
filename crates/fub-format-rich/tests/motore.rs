//! Il motore dei documenti nello strato dei motori: si iscrive nel registro
//! del processo con lo spazio e le estensioni dei codec, conta nel budget i
//! byte delle prove a vuoto ricordate, e una prova tolta dal budget non cambia
//! i byte del salvataggio.
//!
//! Le prove di questo file usano il motore del processo, uno solo per binario:
//! si fanno una alla volta.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use fub_format_rich::motore::{self, MotoreDocumenti};
use fub_format_rich::projection::{Block, Inline, Projection};
use fub_format_rich::{open, save, Codec, RichProvider, Saved};
use fub_motori::{Budget, ErroreMotore, Motori, Tetto, Voce};

static UNA_ALLA_VOLTA: Mutex<()> = Mutex::new(());

fn una_alla_volta() -> MutexGuard<'static, ()> {
    UNA_ALLA_VOLTA
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

fn corpus(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus/docx")
        .join(name);
    std::fs::read(path).expect("il documento del corpus")
}

/// La proiezione aperta, con una parola in più nel primo paragrafo che ha un
/// testo.
fn changed(bytes: &[u8]) -> String {
    let opened = open(Codec::Docx, bytes).expect("si apre");
    assert_eq!(opened.readonly, None, "il documento si scrive");
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    let text = projection
        .blocks
        .iter_mut()
        .find_map(|block| match block {
            Block::Para(para) => para.c.iter_mut().find_map(|inline| match inline {
                Inline::Text { x, .. } if !x.is_empty() => Some(x),
                _ => None,
            }),
            Block::Table(_) => None,
        })
        .expect("un paragrafo con un testo");
    text.push_str(" cambiato");
    projection.to_json().unwrap()
}

fn saved(bytes: &[u8], json: &str) -> Vec<u8> {
    match save(Codec::Docx, bytes, json).expect("si salva") {
        Saved::Bytes(bytes) => bytes,
        Saved::Unchanged => panic!("la proiezione è cambiata"),
    }
}

/// Il primo provider iscrive il motore nel registro del processo, una volta
/// sola e spento, con lo spazio «documenti» e le estensioni di ogni codec.
#[test]
fn il_motore_si_iscrive_una_volta_con_le_estensioni_dei_codec() {
    let _una = una_alla_volta();
    let _ = RichProvider::new(Codec::Docx);
    let _ = RichProvider::new(Codec::Odt);
    let registro = Motori::processo();
    let elenco = registro.elenco().unwrap();
    assert_eq!(
        elenco
            .iter()
            .filter(|voce| voce.spazio == motore::SPAZIO)
            .count(),
        1
    );
    assert!(registro.voce(motore::SPAZIO).is_ok());
    assert_eq!(
        motore::estensioni(),
        ["docx", "odt", "rtf", "doc", "dot"],
        "le estensioni di Codec::ALL"
    );
    // Lo spazio è già iscritto: una seconda iscrizione è un errore.
    assert!(matches!(
        MotoreDocumenti::processo().iscrivi_in(&registro),
        Err(ErroreMotore::SpazioGiaIscritto(_))
    ));

    // In un registro nuovo il motore si iscrive spento e senza byte.
    let altro = Motori::nuovi(registro.servizi().clone());
    MotoreDocumenti::nuovo(registro.servizi().clone())
        .iscrivi_in(&altro)
        .unwrap();
    let elenco = altro.elenco().unwrap();
    assert_eq!(elenco.len(), 1);
    assert_eq!(elenco[0].spazio, motore::SPAZIO);
    assert!(!elenco[0].acceso, "iscriversi non lo accende");
    assert_eq!(elenco[0].byte, 0);
}

/// Una prova ricordata si conta nel budget del processo, per i suoi byte.
#[test]
fn la_cache_conta_i_byte_di_una_prova_ricordata() {
    let _una = una_alla_volta();
    let motore = MotoreDocumenti::processo();
    motore.svuota();
    assert_eq!(motore.byte(), 0);

    let bytes = corpus("libreoffice.docx");
    open(Codec::Docx, &bytes).expect("si apre");
    assert_eq!(motore.prove_ricordate(), 1);
    // Il peso della prova di questo documento è 1.569 voci: la stima la conta
    // sopra i 313 KB misurati.
    let contati = motore.byte();
    assert!(contati > 313_202, "{contati}");
    assert!(contati < 2 * 313_202, "{contati}");

    let cache = motore.cache().expect("il motore è acceso");
    assert_eq!(cache.byte(), contati);
    assert_eq!(cache.nome(), "documenti.prove");
    let budget = motore.servizi().memoria();
    assert!(budget.usati() >= contati);

    // Riaprirlo non la conta due volte.
    open(Codec::Docx, &bytes).expect("si apre");
    assert_eq!(motore.prove_ricordate(), 1);
    assert_eq!(motore.byte(), contati);

    assert_eq!(motore.svuota(), contati);
    assert_eq!(motore.byte(), 0);
}

/// Un budget a tetto basso toglie la prova ricordata, anche l'ultima, e il
/// salvataggio che non la trova la rifà: scrive gli stessi byte.
#[test]
fn il_budget_a_tetto_basso_toglie_la_prova_e_il_salvataggio_scrive_gli_stessi_byte() {
    let _una = una_alla_volta();
    let motore = MotoreDocumenti::processo();
    motore.svuota();
    let bytes = corpus("libreoffice.docx");
    let json = changed(&bytes);
    let ricordata = saved(&bytes, &json);

    // L'apertura ha ricordato la prova; il salvataggio l'ha trovata.
    open(Codec::Docx, &bytes).expect("si apre");
    assert_eq!(motore.prove_ricordate(), 1);
    let budget = Budget::nuovo(Tetto::fisso(1));
    budget.registra(&motore.cache().expect("acceso"));
    let resoconto = budget.rispetta();
    assert!(resoconto.prima > 1, "{resoconto:?}");
    assert_eq!(resoconto.dopo, 0, "{resoconto:?}");
    assert_eq!(motore.prove_ricordate(), 0);

    let rifatta = saved(&bytes, &json);
    assert_eq!(
        rifatta, ricordata,
        "gli stessi byte senza la prova ricordata"
    );
    // Il salvataggio l'ha ricordata di nuovo, e il budget del processo la
    // tiene.
    assert_eq!(motore.prove_ricordate(), 1);
    motore.svuota();
}

/// Spegnere il motore lascia cadere la cache: il budget la dimentica, e la
/// prova dopo lo riaccende.
#[test]
fn spento_il_motore_il_budget_dimentica_la_cache() {
    let _una = una_alla_volta();
    let motore = MotoreDocumenti::processo();
    let bytes = corpus("stili-elenchi-tabelle.docx");
    open(Codec::Docx, &bytes).expect("si apre");
    assert!(motore.acceso());
    let cache = std::sync::Arc::downgrade(&motore.cache().expect("acceso"));
    assert!(motore.libera());
    assert!(!motore.acceso());
    assert_eq!(motore.byte(), 0);
    assert!(cache.upgrade().is_none(), "la cache è caduta col motore");

    open(Codec::Docx, &bytes).expect("si apre");
    assert!(motore.acceso());
    assert_eq!(motore.prove_ricordate(), 1);
    motore.svuota();
}
