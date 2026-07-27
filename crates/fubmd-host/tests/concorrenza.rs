//! Le tre proprietà che il `RwLock` del §8.3 compra, provate invece che dette.
//!
//! Il §8.3 chiedeva «`RwLock` sul `Workspace` con `render_view`/`query_index`/
//! `render_*` in prestito condiviso», e la sua prima riga era «misurare prima».
//! La misura sta in [`examples/contesa.rs`](../examples/contesa.rs) e non è un
//! test: dice dei numeri, e i numeri dipendono dalla macchina. Qui stanno le
//! **proprietà** che quei numeri hanno rivelato, ridotte a soglie che una
//! macchina lenta supera lo stesso — perché il modo di perderle non è un
//! rallentamento, è qualcuno che riscrive `read()` in `write()`.
//!
//! Il cambio si perde in silenzio: `write()` al posto di `read()` compila,
//! passa ogni test funzionale, e non si vede in nessuna diff che non sia
//! questa. È esattamente la forma del presidio di
//! `dependency_invariant.rs` — l'invariante che nessuno rompe apposta e che
//! tutti romperebbero per comodità.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fubmd_abi::model::DocId;
use fubmd_abi::traits::{ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface};
use fubmd_abi::ui::{UiAction, UiNode, ViewUpdate};
use fubmd_abi::PluginError;
use fubmd_host::{Host, NoWatcher};

/// Quanti lettori mettere in campo. Su una macchina a un core la
/// sovrapposizione vera è impossibile, e il test lo dice invece di fallire.
fn lettori() -> usize {
    std::thread::available_parallelism().map_or(2, |n| n.get().clamp(2, 8))
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

fn vault(note: usize) -> Vault {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    for i in 0..note {
        let corpo = format!(
            "# Nota {i}\n\n#prova\n\n## Sezione\n\nUn testo con parole ripetute, \
             abbastanza lungo da costare un parse vero. Vedi [[Nota {}]].\n",
            (i + 1) % note.max(1)
        );
        std::fs::write(root.join(format!("Nota {i}.md")), corpo).unwrap();
    }
    Vault { _dir: dir, root }
}

fn aperto(v: &Vault) -> Host {
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&v.root).expect("il vault si apre");
    host
}

/// **La proprietà che dà il nome alla voce**: due letture del kernel possono
/// essere dentro il workspace *nello stesso momento*.
///
/// Il contatore si alza e si abbassa **dentro** il prestito, quindi il massimo
/// che registra è il numero di thread che hanno tenuto il workspace insieme. Con
/// `write()` al posto di `read()` quel massimo è 1, per costruzione — ed è
/// l'unico modo in cui questo test può fallire.
#[test]
fn due_letture_stanno_nel_workspace_insieme() {
    let v = vault(60);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();

    let n = lettori();
    let dentro = Arc::new(AtomicUsize::new(0));
    let massimo = Arc::new(AtomicUsize::new(0));
    let via = Arc::new(Barrier::new(n));

    let handles: Vec<_> = (0..n)
        .map(|t| {
            let (ws, dentro, massimo, via) =
                (ws.clone(), dentro.clone(), massimo.clone(), via.clone());
            std::thread::spawn(move || {
                via.wait();
                // Un solo giro non basta: la sovrapposizione è un incrocio, e un
                // incrocio va aspettato. Duecento letture con un parse vero
                // dentro sono un miliardo di occasioni più del necessario.
                for i in 0..200u64 {
                    let w = ws.read().unwrap();
                    let ora = dentro.fetch_add(1, Ordering::SeqCst) + 1;
                    massimo.fetch_max(ora, Ordering::SeqCst);
                    let _ =
                        w.render_preview(&DocId::new(format!("Nota {}.md", (i + t as u64) % 60)));
                    dentro.fetch_sub(1, Ordering::SeqCst);
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }

    assert!(
        massimo.load(Ordering::SeqCst) >= 2,
        "nessuna lettura si è mai sovrapposta a un'altra: il prestito non è \
         condiviso. Se qui c'è un `write()` dove il §8.3 chiede un `read()`, \
         il workspace è tornato a essere un `Mutex` con un altro nome."
    );
}

/// **La contropartita, ed è la ragione vera del cambio.**
///
/// Con il `Mutex`, chi salva competeva con i lettori sullo *stesso* prestito
/// esclusivo, e i lettori in ciclo stretto lo scavalcavano: il banco di misura
/// ha visto un salvataggio aspettare **23 secondi**. Con il `RwLock` chi scrive
/// si mette in coda e i lettori nuovi si fermano dietro di lui.
///
/// Ciò che si misura è l'**attesa peggiore**, non quante scritture passano: in
/// debug e su un vault piccolo passano comunque tutte, ed è per questo che un
/// test sul conteggio sarebbe un falso presidio — passerebbe anche col
/// prestito esclusivo. La separazione sta invece tutta nell'attesa, ed è di
/// tre-quattro ordini di grandezza: da 147 ms a 2,2 s con `write()`, contro
/// 0,2–0,3 ms con `read()`, in ogni taglia di vault provata. La soglia sotto è
/// a 50 ms: 150× sopra ciò che il caso buono misura, 3× sotto il *migliore*
/// dei casi cattivi.
///
/// **Che questo valga dipende da `std`, non da noi**, e va detto: la
/// documentazione di `RwLock` dichiara la politica di priorità dipendente dal
/// sistema operativo e non promette che chi aspetta di scrivere blocchi i
/// lettori nuovi. Su Linux (futex) lo fa. Il giorno che questo test diventasse
/// rosso su una piattaforma, non sarebbe una fiacchezza del test: sarebbe
/// quella piattaforma che dice di non avere la proprietà, e a quel punto la
/// coda equa va scritta da noi.
#[test]
fn chi_scrive_non_aspetta_i_lettori_piu_di_un_battito() {
    let v = vault(120);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();

    let stop = Arc::new(AtomicBool::new(false));
    let handles: Vec<_> = (0..(lettori() * 2))
        .map(|t| {
            let (ws, stop) = (ws.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut i = t as u64;
                while !stop.load(Ordering::Relaxed) {
                    let w = ws.read().unwrap();
                    let _ = w.render_preview(&DocId::new(format!("Nota {}.md", i % 120)));
                    i += 1;
                }
            })
        })
        .collect();

    // I lettori entrano in regime prima che il salvataggio provi a passare.
    std::thread::sleep(Duration::from_millis(150));

    let mut attesa_peggiore = Duration::ZERO;
    for giro in 0..20 {
        let t = Instant::now();
        let mut w = ws.write().unwrap();
        attesa_peggiore = attesa_peggiore.max(t.elapsed());
        w.write_document(
            &DocId::new("Nota 0.md"),
            &format!("# Nota 0\n\ngiro {giro}\n"),
        )
        .expect("il salvataggio riesce");
        drop(w);
    }
    stop.store(true, Ordering::Relaxed);
    for h in handles {
        h.join().unwrap();
    }

    assert!(
        attesa_peggiore < Duration::from_millis(50),
        "un salvataggio ha aspettato {attesa_peggiore:?} dietro ai lettori. \
         Con il prestito condiviso l'attesa misurata è di frazioni di \
         millisecondo; centinaia di millisecondi sono la firma del prestito \
         esclusivo, cioè del `Mutex` che il §8.3 ha tolto."
    );
}

/// Una view che pania mentre disegna.
struct Esplode;

impl ViewProvider for Esplode {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: "esplode".into(),
            title: "Esplode".into(),
            surface: ViewSurface::RightSidebar,
            refresh: Default::default(),
            follows: Default::default(),
            params: Vec::new(),
            icon: None,
            order: 0,
            open_by_default: false,
            preferred_size: None,
            closable: true,
        }]
    }
    fn render_view(&self, _: &ViewInstance, _: &dyn ReadApi) -> Result<UiNode, PluginError> {
        panic!("il provider è esploso mentre disegnava");
    }
    fn on_action(
        &mut self,
        _: &ViewInstance,
        _: UiAction,
        _: &mut dyn fubmd_abi::HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        unreachable!()
    }
}

/// **Il terzo effetto, e non era nei tre punti della voce.** Un `Mutex` si
/// avvelena quando chi lo tiene pania: con il workspace dietro un `Mutex`, una
/// view che esplodeva *mentre disegnava* rendeva il vault irraggiungibile a
/// ogni chiamata successiva — `.unwrap()` su un lock avvelenato è un panico, e
/// i panici erano ventidue, uno per comando.
///
/// Un `RwLock` si avvelena **solo** se a paniare è chi tiene il prestito
/// esclusivo (`std::sync::RwLock`: «may only be poisoned if a panic occurs
/// while it is locked exclusively»). Disegnare è una lettura, quindi il caso
/// più probabile — e l'unico che un provider di terzi produrrà davvero, perché
/// disegnare è ciò che un provider fa più spesso — smette di portarsi via il
/// vault.
///
/// **Non è la 24.2.** Là si chiede un `catch_unwind` al confine e la
/// disattivazione con avviso: qui il panico attraversa ancora il chiamante, e
/// chi lo riceve è il comando IPC che l'ha chiesto. Quello che cambia è che si
/// porta via *quella chiamata* invece del vault.
#[test]
fn una_view_che_pania_disegnando_non_avvelena_il_vault() {
    let v = vault(4);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();
    {
        // Prima si dichiara, poi si registra: il kernel non presta capacità a
        // una stringa (§7.3, decisione 0021).
        let mut w = ws.write().unwrap();
        w.register_core_feature("fubmd.esplode", "Esplode")
            .expect("dichiarata");
        w.register_view_provider("fubmd.esplode", Box::new(Esplode))
            .expect("registrata");
    }

    let scoppiata = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let w = ws.read().unwrap();
            let _ = w.render_view(&ViewInstance::only("esplode"));
        })
        .join()
    };
    assert!(scoppiata.is_err(), "la view doveva paniare");

    // E il vault risponde ancora — in lettura e in scrittura.
    assert!(
        ws.read()
            .unwrap()
            .read_source(&DocId::new("Nota 0.md"))
            .is_ok(),
        "il lock è avvelenato: un provider che pania disegnando si è portato via il vault"
    );
    ws.write()
        .unwrap()
        .write_document(&DocId::new("Nota 0.md"), "# Nota 0\n\ndopo il panico\n")
        .expect("si scrive ancora");
}
