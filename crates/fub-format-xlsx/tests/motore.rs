//! GridCraft sullo strato dei motori (ADR 0236): il motore dei fogli nasce
//! alla prima apertura e non con il provider, le sue cache stanno nel budget,
//! e chiusa l'ultima istanza sono a zero byte.
//!
//! Le cache di GridCraft sono del processo (il dizionario dell'ortografia e i
//! formati dei numeri letti): le prove che le guardano si danno il turno con
//! [`TURNO`], e ognuna ha servizi, budget e motore suoi.

mod common;

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use common::one_sheet;
use fub_abi::{
    GridBytesProvider, GridBytesSession, GridCommand, GridCommandRequest, GridJournal, Revision,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};
use fub_format_xlsx::motore::{Fogli, SPAZIO};
use fub_motori::{Config, ErroreMotore, Motori, Servizi, Tetto, Voce};

/// Una parola sbagliata per l'ortografia e due numeri per i formati.
const BODY: &str = r#"<dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>house wrold</t></is></c><c r="B1"><v>1.5</v></c></row><row r="2"><c r="A2"><v>2</v></c><c r="B2"><v>3</v></c></row></sheetData>"#;

static TURNO: Mutex<()> = Mutex::new(());

fn turno() -> MutexGuard<'static, ()> {
    TURNO.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Un motore dei fogli suo, con un tetto delle cache scelto dalla prova.
fn fogli(tetto: u64) -> Arc<Fogli> {
    Fogli::nuovi(Servizi::nuovi(Config {
        fili: Some(1),
        tetto: Tetto::fisso(tetto),
    }))
}

fn largo() -> Arc<Fogli> {
    fogli(u64::MAX)
}

fn open(provider: &mut XlsxGridProvider) -> GridBytesSession {
    let bytes = one_sheet(BODY);
    provider
        .open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            &GridJournal::new(),
        )
        .unwrap()
}

fn give(provider: &mut XlsxGridProvider, session: &GridBytesSession, id: &str, params: &str) -> bool {
    provider
        .command(
            &session.instance,
            GridCommandRequest {
                revision: session.revision.clone(),
                command: GridCommand {
                    id: id.into(),
                    params: params.into(),
                    sheet: "s1".into(),
                    selection: "A1:B2".into(),
                    active: "A1".into(),
                },
            },
        )
        .is_ok()
}

/// Riempie le cache con i comandi della barra: la copia legge i valori con il
/// loro formato, l'ortografia legge il dizionario. Dice se il dizionario c'è:
/// senza l'elenco di parole del sistema (`/usr/share/dict/words`) GridCraft
/// rifiuta il controllo e il dizionario resta a zero byte.
fn riempi(provider: &mut XlsxGridProvider, session: &GridBytesSession, fogli: &Fogli) -> bool {
    assert!(give(provider, session, "fub.copyHtml", r#"{"range":"A1:B2"}"#));
    let controllato = give(provider, session, "review.spelling", "{}");
    let motore = fogli.se_acceso().expect("il motore è acceso");
    assert!(motore.byte_dei_formati() > 0, "i formati dei numeri letti");
    if motore.byte_del_dizionario() == 0 {
        assert!(!controllato, "senza elenco di parole il controllo è rifiutato");
        return false;
    }
    assert!(controllato);
    true
}

fn byte(fogli: &Fogli) -> u64 {
    fogli.se_acceso().map_or(0, |motore| motore.byte())
}

#[test]
fn creare_il_provider_non_costruisce_il_motore_e_la_prima_apertura_si() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    assert!(!fogli.acceso(), "il provider da solo non costruisce il motore");
    assert_eq!(fogli.aperte(), 0);

    let session = open(&mut provider);
    assert!(fogli.acceso(), "la prima apertura costruisce il motore");
    assert_eq!(fogli.aperte(), 1);
    let motore = fogli.se_acceso().unwrap();
    assert!(!motore.comandi().is_empty(), "il catalogo dei comandi è pronto");

    // La seconda apertura prende lo stesso motore.
    let _altra = open(&mut provider);
    assert!(Arc::ptr_eq(&motore, &fogli.se_acceso().unwrap()));
    assert_eq!(fogli.aperte(), 2);
    provider.close(&session.instance).unwrap();
    assert_eq!(fogli.aperte(), 1);
}

#[test]
fn un_apertura_fallita_non_conta() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    let bytes = b"non sono una cartella".to_vec();
    let rifiutata = provider.open(
        XLSX_GRID_SURFACE,
        &bytes,
        Revision::of_bytes(&bytes),
        &GridJournal::new(),
    );
    assert!(rifiutata.is_err());
    assert_eq!(fogli.aperte(), 0);
}

#[test]
fn chiusa_l_ultima_istanza_le_cache_sono_a_zero_byte() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    let session = open(&mut provider);
    riempi(&mut provider, &session, &fogli);
    assert!(byte(&fogli) > 0);

    provider.close(&session.instance).unwrap();
    assert_eq!(fogli.aperte(), 0);
    assert_eq!(byte(&fogli), 0, "chiusa l'ultima istanza");
    assert_eq!(fogli.servizi().memoria().usati(), 0);
    // Il motore resta: lo libera il budget, quando lo chiede.
    assert!(fogli.acceso());
}

#[test]
fn con_due_istanze_chiuderne_una_non_svuota() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    // Due riquadri sullo stesso file: due istanze.
    let prima = open(&mut provider);
    let seconda = open(&mut provider);
    let dizionario = riempi(&mut provider, &prima, &fogli);
    let pieni = byte(&fogli);
    let motore = fogli.se_acceso().unwrap();

    provider.close(&prima.instance).unwrap();
    assert_eq!(fogli.aperte(), 1);
    assert_eq!(byte(&fogli), pieni, "un foglio è ancora aperto");
    assert_eq!(motore.byte_del_dizionario() > 0, dizionario);

    provider.close(&seconda.instance).unwrap();
    assert_eq!(byte(&fogli), 0, "chiusa la seconda");
}

/// Il salvataggio di `fub-host` (`write_workbook_in`) apre un'istanza sua,
/// chiede i byte e la chiude: con il foglio ancora aperto non svuota niente,
/// senza foglio aperto sì.
#[test]
fn il_salvataggio_conta_le_istanze_non_le_chiusure() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    let aperta = open(&mut provider);
    riempi(&mut provider, &aperta, &fogli);
    let pieni = byte(&fogli);

    let salva = |provider: &mut XlsxGridProvider| {
        let temporanea = open(provider);
        provider
            .bytes_to_write(&temporanea.instance, temporanea.revision.clone())
            .unwrap();
        provider.close(&temporanea.instance).unwrap();
    };
    salva(&mut provider);
    assert_eq!(fogli.aperte(), 1);
    assert_eq!(byte(&fogli), pieni, "il foglio aperto tiene le cache");

    provider.close(&aperta.instance).unwrap();
    assert_eq!(byte(&fogli), 0);
    // Un salvataggio senza foglio aperto apre e chiude l'ultima istanza.
    let temporanea = open(&mut provider);
    riempi(&mut provider, &temporanea, &fogli);
    provider.close(&temporanea.instance).unwrap();
    assert_eq!(byte(&fogli), 0);
}

#[test]
fn shutdown_con_istanze_aperte_svuota() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    let prima = open(&mut provider);
    let _seconda = open(&mut provider);
    riempi(&mut provider, &prima, &fogli);
    assert!(byte(&fogli) > 0);

    provider.shutdown().unwrap();
    assert_eq!(fogli.aperte(), 0);
    assert_eq!(byte(&fogli), 0);
    // Un provider che cade con istanze aperte svuota allo stesso modo.
    let terza = open(&mut provider);
    riempi(&mut provider, &terza, &fogli);
    drop(provider);
    assert_eq!(fogli.aperte(), 0);
    assert_eq!(byte(&fogli), 0);
}

#[test]
fn chiudere_con_il_dizionario_mai_caricato() {
    let _turno = turno();
    let fogli = largo();
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    let session = open(&mut provider);
    let motore = fogli.se_acceso().unwrap();
    motore.svuota();
    assert!(give(&mut provider, &session, "fub.copyHtml", r#"{"range":"A1:B2"}"#));
    assert_eq!(motore.byte_del_dizionario(), 0);
    assert!(motore.byte_dei_formati() > 0);

    provider.close(&session.instance).unwrap();
    assert_eq!(byte(&fogli), 0);
    // Svuotare cache già vuote non fa niente.
    assert_eq!(motore.svuota(), 0);
    assert_eq!(fogli.svuota(), 0);
}

#[test]
fn il_budget_a_tetto_basso_libera_il_dizionario() {
    let _turno = turno();
    // Sopra i pochi formati della cartella, sotto qualunque dizionario.
    let fogli = fogli(64 * 1024);
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    let session = open(&mut provider);
    fogli.se_acceso().unwrap().svuota();
    let controllato = give(&mut provider, &session, "review.spelling", "{}");

    let motore = fogli.se_acceso().unwrap();
    // Il controllo ha letto il dizionario (se il sistema ha un elenco di
    // parole), il budget l'ha trovato oltre il tetto e l'ha liberato, con
    // l'istanza ancora aperta.
    assert_eq!(fogli.aperte(), 1);
    assert_eq!(motore.byte_del_dizionario(), 0);
    let budget = fogli.servizi().memoria();
    assert!(budget.usati() <= budget.tetto());
    if controllato {
        // Il controllo dopo lo rilegge, e il budget lo libera di nuovo.
        assert!(give(&mut provider, &session, "review.spelling", "{}"));
        assert_eq!(motore.byte_del_dizionario(), 0);
    }

    // Con il tetto largo lo stesso controllo lo tiene.
    let largo = largo();
    let mut altro = XlsxGridProvider::con_fogli(Arc::clone(&largo));
    let session = open(&mut altro);
    if give(&mut altro, &session, "review.spelling", "{}") {
        assert!(largo.se_acceso().unwrap().byte_del_dizionario() > 0);
    }
}

#[test]
fn il_motore_si_iscrive_nel_registro_e_si_scalda_da_li() {
    let _turno = turno();
    let fogli = largo();
    let motori = Motori::nuovi(Arc::clone(fogli.servizi()));
    fogli.iscrivi(&motori).unwrap();
    assert_eq!(
        fogli.iscrivi(&motori),
        Err(ErroreMotore::SpazioGiaIscritto(SPAZIO.into()))
    );
    assert_eq!(
        motori.voce(SPAZIO).map(|voce| voce.acceso()),
        Ok(false),
        "iscritto, non costruito"
    );
    for estensione in ["xlsx", "xlsm", "xltx", ".XLTM"] {
        assert_eq!(motori.scalda_per(estensione), Ok(true), "{estensione}");
    }
    let fino = Instant::now() + Duration::from_secs(60);
    while !fogli.acceso() {
        assert!(Instant::now() < fino, "il motore non si è scaldato");
        std::thread::sleep(Duration::from_millis(5));
    }
    // Liberarlo dal registro lo spegne; l'apertura dopo lo ricostruisce.
    assert!(motori.voce(SPAZIO).unwrap().libera());
    assert!(!fogli.acceso());
    let mut provider = XlsxGridProvider::con_fogli(Arc::clone(&fogli));
    open(&mut provider);
    assert!(fogli.acceso());
}

#[test]
fn i_provider_del_processo_iscrivono_il_motore_una_volta_sola() {
    let _turno = turno();
    let _uno = XlsxGridProvider::new();
    let _due = XlsxGridProvider::new();
    let elenco = Motori::processo().elenco().unwrap();
    assert_eq!(
        elenco.iter().filter(|stato| stato.spazio == SPAZIO).count(),
        1
    );
    assert_eq!(Motori::processo().scalda_per("csv"), Ok(false));
    assert!(Motori::processo().voce(SPAZIO).is_ok());
}
