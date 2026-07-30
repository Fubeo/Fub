//! **Ciò che va storto arriva a qualcuno** (seduta 20:
//! [0051](../../../docs/decisions/0051-l-alimentazione-risponde.md) +
//! [0052](../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md)).
//!
//! La proprietà sotto esame è quella che il piano dichiarava di avere e aveva a
//! metà: *perdite silenziose non esistono per contratto*. Qui si guarda dai due
//! versi in cui era falsa —
//!
//! 1. un indice che **non prende** un documento adesso lo nomina, e il kernel
//!    trasforma quel nome in un `Event::Trouble`;
//! 2. un handler che **fallisce** non viene più ignorato con un `let _ =`.
//!
//! Ogni test qui fallisce nel modo che conta: non «la firma è diversa», ma
//! «nessuno lo ha saputo».

use camino::Utf8PathBuf;
use fub_abi::error::PluginError;
use fub_abi::event::{Event, EventMask, Notice, Severity};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{
    EventHandler, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute,
};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::TestoDiProva;

/// Un indice che rifiuta ciò che gli si dà, e **lo dice**: è il
/// `SearchIndex` col writer andato, ridotto all'osso.
struct IndiceCheRifiuta;

impl IndexProvider for IndiceCheRifiuta {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        docs.iter()
            .map(|d| {
                IndexLoss::new(
                    d.id.clone(),
                    PluginError::Internal("il writer è andato".into()),
                )
            })
            .collect()
    }
    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("niente".into()))
    }
}

/// L'handler che fallisce: è la forma del versioning quando il disco è pieno —
/// `handle` propaga l'errore di `snapshot`, e prima di questa seduta il kernel
/// lo scartava con un `let _ =`.
struct HandlerCheFallisce;

impl EventHandler for HandlerCheFallisce {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }
    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        // **Non** sui guasti: un handler che fallisce ricevendo un `Trouble` è
        // esattamente il ciclo che la 0052 chiude nel kernel, e senza questa
        // riga il test lo eserciterebbe invece di provare ciò che vuole
        // provare.
        if matches!(notice.event, Event::DocumentChanged { .. }) {
            return Err(PluginError::Io("disco pieno".into()));
        }
        Ok(())
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    fn workspace(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(TestoDiProva::per_estensione("txt").boxed())
            .expect("plain");
        let mut ws = Workspace::new(&self.root, registry);
        for plugin in ["test.rifiuta", "test.fallisce"] {
            ws.register_core_feature(plugin, plugin)
                .expect("dichiarato");
        }
        ws
    }
}

/// Tutti i guasti arrivati sul bus, in ordine.
fn guasti(rx: &fub_kernel::Subscription) -> Vec<(Severity, Option<String>, String)> {
    let mut out = Vec::new();
    while let Ok(n) = rx.try_recv() {
        out.push(n);
    }
    out.into_iter()
        .filter_map(|n| match n.event {
            Event::Trouble {
                severity,
                subject,
                error,
            } => Some((severity, subject.map(|s| s.to_string()), error.to_string())),
            _ => None,
        })
        .collect()
}

#[test]
fn un_documento_che_l_indice_non_prende_arriva_a_chi_guarda() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_index_provider("test.rifiuta", Box::new(IndiceCheRifiuta))
        .expect("registrato");
    ws.reindex().unwrap();
    let rx = ws.bus().subscribe();

    ws.create_note(Some("Nota.txt")).unwrap();
    ws.write_document(&DocId::new("Nota.txt"), "corpo").unwrap();

    let visti = guasti(&rx);
    assert!(
        !visti.is_empty(),
        "l'indice ha detto di aver perso il documento e nessuno lo ha saputo: \
         è esattamente il difetto che la seduta 20 chiude"
    );
    let (severity, subject, message) = &visti[0];
    assert_eq!(
        subject.as_deref(),
        Some("Nota.txt"),
        "un guasto che non nomina il documento non fa agire nessuno: è la \
         ragione per cui l'esito cumulativo del flush è stato scartato"
    );
    assert_eq!(
        *severity,
        Severity::Warning,
        "un indice è un derivato: si ricostruisce riaprendo il vault"
    );
    assert!(message.contains("il writer è andato"), "{message}");
}

#[test]
fn la_scrittura_riesce_lo_stesso_quando_l_indice_rifiuta() {
    // L'altra metà, e conta quanto la prima: il vault è la verità, un indice è
    // un derivato. Dire la perdita non deve trasformarla in un fallimento
    // dell'operazione che l'utente ha chiesto.
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_index_provider("test.rifiuta", Box::new(IndiceCheRifiuta))
        .expect("registrato");
    ws.reindex().unwrap();

    ws.create_note(Some("Nota.txt")).unwrap();
    ws.write_document(&DocId::new("Nota.txt"), "corpo")
        .expect("la scrittura riesce");
    assert_eq!(ws.read_source(&DocId::new("Nota.txt")).unwrap(), "corpo");
}

#[test]
fn l_errore_di_un_handler_non_si_perde_piu() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_event_handler("test.fallisce", Box::new(HandlerCheFallisce))
        .expect("registrato");
    ws.reindex().unwrap();
    let rx = ws.bus().subscribe();

    ws.create_note(Some("Nota.txt")).unwrap();
    ws.write_document(&DocId::new("Nota.txt"), "corpo").unwrap();

    let visti = guasti(&rx);
    assert!(
        !visti.is_empty(),
        "`let _ = handler.handle(…)`: il versioning che smette di fare snapshot \
         era indistinguibile dal versioning che funziona"
    );
    let (severity, _, message) = &visti[0];
    assert_eq!(
        *severity,
        Severity::Failure,
        "il kernel non sa cosa NON è successo dietro un handler: sottostimare \
         è peggio che sovrastimare"
    );
    assert!(message.contains("disco pieno"), "{message}");
}

#[test]
fn un_handler_che_fallisce_non_fa_fallire_la_scrittura() {
    // La metà del vecchio commento che era giusta, e che resta: «l'errore di un
    // handler non deve far fallire l'operazione che ha emesso l'evento».
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_event_handler("test.fallisce", Box::new(HandlerCheFallisce))
        .expect("registrato");
    ws.reindex().unwrap();

    ws.create_note(Some("Nota.txt")).unwrap();
    ws.write_document(&DocId::new("Nota.txt"), "corpo")
        .expect("la scrittura riesce anche se un handler ha detto di no");
}
