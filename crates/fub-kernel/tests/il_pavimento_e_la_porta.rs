//! **Il pavimento e la porta** (seduta 17: §17.3,
//! [0062](../../../docs/decisions/0062-il-log-e-il-pavimento-l-evento-e-la-porta.md)).
//!
//! Ciò che va storto ha due destinazioni, e la decisione 0062 le distingue con
//! un criterio: *il log è il pavimento, l'evento è la porta*. Ogni guasto
//! lascia una riga di log — sempre, per chi sviluppa — e solo quelli che
//! raccontano una **perdita** aprono anche la porta del canale degli eventi,
//! che è rivolto a chi legge le note.
//!
//! Qui si prova che i due sono **indipendenti**, ed è la proprietà che tiene:
//! se si confondessero, o un guasto sparirebbe nel silenzio (pavimento rotto),
//! o il centro notifiche si riempirebbe di diagnosi per chi sviluppa (porta
//! spalancata). Il primo test guasta l'uno e l'altro separatamente e guarda che
//! l'altro stia fermo.

use camino::Utf8PathBuf;
use fub_abi::event::Event;
use fub_abi::text::Text;
use fub_abi::{PluginError, Severity};
use fub_kernel::{FormatRegistry, Workspace};
use fub_testkit::TestoDiProva;

fn workspace() -> Workspace {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    // La `TempDir` va tenuta viva finché serve il workspace: la lascia cadere
    // il chiamante del test, che è anche l'ultimo a usare `ws`.
    std::mem::forget(dir);
    let mut registry = FormatRegistry::new();
    registry
        .register(TestoDiProva::per_estensione("txt").boxed())
        .expect("plain");
    let mut ws = Workspace::new(&root, registry).expect("l'apertura del vault riesce");
    ws.register_core_feature("test.dice", "test.dice")
        .expect("dichiarato");
    ws
}

/// **Una perdita apre la porta e lascia una riga: una non-perdita solo la
/// riga.** È il criterio intero, in un test: il pavimento cattura entrambe, la
/// porta si apre per una sola.
#[test]
fn una_perdita_apre_la_porta_una_non_perdita_no() {
    let mut ws = workspace();
    let rx = ws.bus().subscribe();

    // Una **perdita**: il pavimento scrive una riga di log, e la porta si apre
    // con un `Event::Trouble`. È la forma di ogni punto che la 0062 manda ad
    // entrambe le destinazioni — il versioning che perde una versione, il
    // cestino col sidecar non scritto.
    let ((), righe) = fub_kernel::log::captured_default(|| {
        tracing::warn!(target: "fub.test", "perdita: una versione non salvata");
        ws.with_host("test.dice", |host| {
            host.emit(Event::Trouble {
                severity: Severity::Failure,
                subject: None,
                error: PluginError::Internal(Text::from("una versione non salvata")),
                gate: None,
            });
        });
    });
    assert_eq!(
        righe.len(),
        1,
        "il pavimento ha catturato la riga: {righe:?}"
    );
    assert!(righe[0].contains("perdita"), "{:?}", righe[0]);
    let guasti = trouble_su(&rx);
    assert_eq!(
        guasti.len(),
        1,
        "la porta si è aperta per la perdita: {guasti:?}"
    );

    // Una **non-perdita**: il pavimento scrive comunque una riga — sapere che
    // si è potato è utile dopo — ma la porta resta chiusa, perché nessuno ha
    // perso niente che aveva scritto. È la forma di ogni punto che la 0062
    // manda al solo pavimento — una potatura riuscita, un indice ricostruito.
    let ((), righe) = fub_kernel::log::captured_default(|| {
        tracing::info!(target: "fub.test", "non-perdita: potate 3 versioni");
    });
    assert_eq!(
        righe.len(),
        1,
        "il pavimento cattura anche ciò che non è una perdita: {righe:?}"
    );
    assert_eq!(
        trouble_su(&rx).len(),
        0,
        "la porta resta chiusa per ciò che non è una perdita"
    );
}

/// **Guastare il pavimento non apre la porta, e viceversa.** È l'indipendenza
/// dei due canali: se uno si rompe, l'altro non smette di fare il suo mestiere.
/// Qui lo si guarda dal verso del collettore: col livello globale a `Off`, il
/// pavimento tace e la porta continua a parlare.
#[test]
fn il_pavimento_spento_non_chiude_la_porta() {
    let mut ws = workspace();
    let rx = ws.bus().subscribe();
    let levels = std::sync::Arc::new(fub_kernel::log::Levels::default());
    levels.set_global(fub_kernel::log::Level::Off);

    let ((), righe) = fub_kernel::log::captured(levels, || {
        // Anche col pavimento spento, la perdita apre la porta.
        ws.with_host("test.dice", |host| {
            host.emit(Event::Trouble {
                severity: Severity::Warning,
                subject: None,
                error: PluginError::Internal(Text::from("flush fallito")),
                gate: None,
            });
        });
    });
    assert_eq!(
        righe.len(),
        0,
        "col livello Off il pavimento tace: {righe:?}"
    );
    assert_eq!(
        trouble_su(&rx).len(),
        1,
        "ma la porta è un altro canale, e resta aperta"
    );
}

/// I `Trouble` arrivati sul bus, svuotati.
fn trouble_su(rx: &fub_kernel::Subscription) -> Vec<Event> {
    let mut out = Vec::new();
    while let Ok(n) = rx.try_recv() {
        if matches!(n.event, Event::Trouble { .. }) {
            out.push(n.event);
        }
    }
    out
}
