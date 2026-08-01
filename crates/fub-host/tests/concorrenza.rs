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
use std::sync::{Arc, Barrier, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_abi::traits::{ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface};
use fub_abi::ui::{UiAction, UiNode, ViewUpdate};
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};

/// Quanti lettori mettere in campo. Su una macchina a un core la
/// sovrapposizione vera è impossibile, e il test lo dice invece di fallire.
fn lettori() -> usize {
    std::thread::available_parallelism().map_or(2, |n| n.get().clamp(2, 8))
}

/// Il banco di misura è uno solo, e i due test di contesa devono farci il turno.
///
/// libtest esegue in parallelo i test dello stesso binario: senza questo turno
/// i due girerebbero insieme, e ognuno dei due *è* la macchina occupata
/// dell'altro. Quello che conta le letture sovrapposte tiene il prestito
/// condiviso in ciclo stretto proprio mentre l'altro cronometra quanto ci mette
/// a passare in scrittura — misurerebbero la contesa che si fanno da soli,
/// invece di quella che il §8.3 ha comprato.
static BANCO: Mutex<()> = Mutex::new(());

/// Prende il turno di banco, avvelenamento compreso.
///
/// Se il test precedente è panicato il `Mutex` resta avvelenato, e qui non
/// vuol dire niente: il dato protetto è `()`, non c'è nessuno stato invariante
/// che un panico possa aver lasciato a metà. L'unica cosa che il turno serializa
/// è il tempo, e il tempo non si corrompe. Ereditarlo e misurare è giusto:
/// l'alternativa sarebbe un secondo rosso che nasconde il primo.
fn turno_di_banco() -> MutexGuard<'static, ()> {
    BANCO
        .lock()
        .unwrap_or_else(|avvelenato| avvelenato.into_inner())
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
    let _turno = turno_di_banco();
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
/// Ciò che si misura è l'**attesa mediana** di venti salvataggi, non quante
/// scritture passano: in debug e su un vault piccolo passano comunque tutte, ed
/// è per questo che un test sul conteggio sarebbe un falso presidio —
/// passerebbe anche col prestito esclusivo. La separazione sta invece tutta
/// nell'attesa, ed è di tre-quattro ordini di grandezza: da 147 ms a 2,2 s con
/// `write()`, contro 0,2–0,3 ms con `read()`, in ogni taglia di vault provata.
/// La soglia sotto è a 50 ms: 150× sopra ciò che il caso buono misura, 3× sotto
/// il *migliore* dei casi cattivi.
///
/// **Che questo valga dipende da `std`, non da noi**, e va detto: la
/// documentazione di `RwLock` dichiara la politica di priorità dipendente dal
/// sistema operativo e non promette che chi aspetta di scrivere blocchi i
/// lettori nuovi. Su Linux (futex) lo fa. Il giorno che questo test diventasse
/// rosso su una piattaforma, non sarebbe una fiacchezza del test: sarebbe
/// quella piattaforma che dice di non avere la proprietà, e a quel punto la
/// coda equa va scritta da noi.
///
/// **Si guarda la mediana perché il massimo era la statistica sbagliata**, e
/// non perché la soglia sia stata alzata per far tacere il test: la soglia è
/// rimasta a 50 ms, con la taratura di prima — 150× il caso buono, 3× sotto il
/// migliore dei cattivi — intatta. Ciò che è cambiato è quale dei venti
/// campioni si legge, non dove sta l'asticella. Il massimo di venti è, per
/// definizione, il campione più esposto al vicino di banco: basta che
/// *un* lettore venga prelazionato mentre tiene il prestito condiviso perché
/// quel singolo giro incassi un quanto di scheduler intero — su Windows sono
/// 15–30 ms — e la CI ha misurato 101 ms contro i 50 della soglia con sotto il
/// codice giusto, per poi tornare verde al rilancio successivo senza che
/// nessuno avesse toccato niente.
///
/// E quel campione non porta segnale che gli altri non abbiano già: la firma
/// del prestito esclusivo non è *un* giro lento, sono **tutti** i giri lenti.
/// Sotto il `Mutex` che il §8.3 ha tolto ogni salvataggio viene scavalcato da
/// ogni lettore in ciclo stretto, quindi ogni giro aspetta e la mediana sale
/// insieme al massimo — anzi, prima, perché non ha bisogno che il caso peggiore
/// si presenti. Leggere la mediana rinuncia solo alla sensibilità a ciò che non
/// stiamo misurando. Il peggiore resta nel messaggio di fallimento: serve a
/// capire un rosso, non a produrlo.
///
/// Per la stessa ragione i lettori sono `lettori()` e non il doppio. Su un
/// runner a quattro core, otto thread in ciclo stretto non aumentano la contesa
/// sul lock — quella satura molto prima — e aggiungono solo thread pronti che
/// si contendono le CPU: rumore di scheduler versato dentro la misura.
#[test]
fn chi_scrive_non_aspetta_i_lettori_piu_di_un_battito() {
    let _turno = turno_di_banco();
    let v = vault(120);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();

    let stop = Arc::new(AtomicBool::new(false));
    let handles: Vec<_> = (0..lettori())
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

    // Si tengono tutte e venti: il verdetto vuole la mediana, il messaggio di
    // fallimento vuole il peggiore, e nessuno dei due si ricava dall'altro.
    let mut attese = Vec::with_capacity(20);
    for giro in 0..20 {
        let t = Instant::now();
        let mut w = ws.write().unwrap();
        attese.push(t.elapsed());
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

    attese.sort_unstable();
    let mediana = attese[attese.len() / 2];
    let peggiore = *attese.last().expect("venti giri, venti attese");

    assert!(
        mediana < Duration::from_millis(50),
        "l'attesa mediana di un salvataggio dietro ai lettori è {mediana:?} \
         (la peggiore dei venti giri: {peggiore:?}). Con il prestito condiviso \
         l'attesa misurata è di frazioni di millisecondo; decine o centinaia di \
         millisecondi *a ogni giro* sono la firma del prestito esclusivo, cioè \
         del `Mutex` che il §8.3 ha tolto."
    );
}

/// Una view che pania mentre disegna.
struct Esplode;

impl ViewProvider for Esplode {
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

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
        _: &mut dyn fub_abi::HostApi,
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
/// **E adesso non attraversa più nemmeno il chiamante** (§9.3,
/// decisione 0032). Questa prova diceva l'opposto: «il panico attraversa ancora
/// chi ha chiamato, e quello che cambia è che si porta via *quella chiamata*
/// invece del vault». Era la metà che la 0024 poteva comprare da sola; l'altra
/// metà è la rete al confine, che traduce il panico in un `PluginError` che
/// **nomina** il colpevole. Ciò che la 0024 ha comprato resta e non è
/// ridondante: la rete si può bucare — la prova qui sotto la buca apposta da un
/// thread suo — e sotto un `Mutex` un buco solo costerebbe ancora il vault.
#[test]
fn una_view_che_pania_disegnando_non_avvelena_il_vault() {
    let v = vault(4);
    let host = aperto(&v);
    let ws = host.workspace(None).unwrap();
    {
        // Prima si dichiara, poi si registra: il kernel non presta capacità a
        // una stringa (§7.3, decisione 0021).
        let mut w = ws.write().unwrap();
        w.register_core_feature("fub.esplode", "Esplode")
            .expect("dichiarata");
        w.register_view_provider("fub.esplode", Box::new(Esplode))
            .expect("registrata");
    }

    // Il panico non esce più dal kernel: torna come errore, e dice di chi è.
    let esito = ws
        .read()
        .unwrap()
        .render_view(&ViewInstance::only("esplode"));
    let errore = esito.expect_err("una view che pania non rende un albero");
    assert!(
        errore.to_string().contains("fub.esplode")
            && errore.to_string().contains("è andato in panico"),
        "l'errore deve nominare chi è esploso: {errore}"
    );

    // E se qualcuno lo bucasse, la seconda rete regge: un panico su un prestito
    // **condiviso** non avvelena. Il thread serve solo a non far morire il test.
    let scoppiata = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let w = ws.read().unwrap();
            let _ = w.views();
            panic!("qualcuno pania tenendo il prestito condiviso");
        })
        .join()
    };
    assert!(scoppiata.is_err(), "il thread doveva paniare");

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
