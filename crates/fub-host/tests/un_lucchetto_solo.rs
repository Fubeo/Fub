//! **Un lucchetto solo, e la politica sta dentro** (decisione 0120).
//!
//! Il difetto che questo banco presidia non era un panico: era che alla stessa
//! domanda — *cosa si fa quando questo lucchetto è avvelenato?* — l'host e la
//! colla Tauri rispondevano in due modi, e un terzo posto ne aveva un terzo.
//! Una riparazione che sostituisse N `unwrap` con N `expect` avrebbe lasciato
//! la domanda aperta per l'`unwrap` numero N+1. La riparazione è una porta:
//! [`fub_host::Custodia`].
//!
//! Il banco è in **due parti**, e ne servono due perché guardano due cose che
//! si rompono separatamente.
//!
//! 1. Il **conto sul sorgente**: un `Mutex`/`RwLock` nudo fuori dalla porta è
//!    un lucchetto senza politica, e vuole una riga con la sua ragione.
//! 2. Il **comportamento**: un vault avvelenato risponde di no, lo fa *tutte*
//!    le volte, e lo dice **una** volta.
//!
//! # La zona cieca, misurata addosso
//!
//! `Custodia::read` restituisce un `Result`, e su un `Result` si può scrivere
//! `.unwrap()`. Non è un'ipotesi: è successo **scrivendo questa decisione**. La
//! sostituzione automatica su `crates/fub-app/src/lib.rs` non aveva agganciato
//! (indentazione diversa da quella cercata), il crate ha continuato a compilare
//! **verde** con quattordici `.unwrap()` addosso alla porta nuova, e nessun
//! errore del compilatore lo ha detto — perché non c'era niente di sbagliato da
//! dire: `Result::unwrap` è legittimo.
//!
//! Quindi il conto ne guarda **due** cose e non una: il tipo nudo, e l'`unwrap`
//! sulla risposta della porta dentro il codice di produzione. Il secondo è ciò
//! che il compilatore non può vedere, ed è esattamente il caso che è sfuggito.
//!
//! Ciò che questo banco **non** vede, dichiarato: i lucchetti degli altri
//! crate. `fub-kernel`, `fub-features` e `fub-sdk` ne hanno di propri — sono
//! **otto** file [conta: lucchetti-fuori-dal-conto] —, e la politica di questa
//! decisione non li ha attraversati: il difetto misurato era il confine
//! host↔app, e allargare un conto oltre ciò che si è deciso vorrebbe dire
//! un'allowlist lunga come l'elenco che dovrebbe restringere. La
//! [0126](../../../docs/decisions/0126-un-bus-che-tace-non-lo-scopre-nessuno.md)
//! ha riguardato la domanda e ha risposto di nuovo di no, con la ragione più
//! forte: una politica del veleno si **riderivano** da cosa il lucchetto
//! protegge, quindi trapiantare qui la `Custodia` importerebbe la risposta
//! dell'host in un posto dove nessuna delle sue giustificazioni vale.
//!
//! Il numero però c'è, ed è la sola cosa che è cambiata: prima questa frase
//! nominava tre crate e nessuna quantità. Una zona cieca senza numero è
//! indistinguibile da una che cresce — il file che ci entra domani non fa
//! rumore da nessuna parte, e non c'è niente da cui accorgersene. Contarla non
//! la restringe e non chiede una riga di giustificazione a nessuno: la
//! **misura**, che è il minimo che si deve a un buco che si è deciso di
//! tenere.

use std::collections::{BTreeMap, BTreeSet};

use camino::Utf8PathBuf;
use fub_host::{Custodia, Host, NoWatcher};

// ---------------------------------------------------------------------------
// 1. Il conto sul sorgente
// ---------------------------------------------------------------------------

/// **Perché quel lucchetto sta fuori dalla porta.**
///
/// Due ragioni e non di più: se nessuna delle due si applica, la risposta non è
/// inventarne una terza — è che quel dato va in una [`Custodia`].
#[derive(Debug, PartialEq, Eq)]
enum Perche {
    /// **Una condizione ha bisogno del suo `Mutex`.** [`std::sync::Condvar`] è
    /// definita su `MutexGuard` e su niente altro: `wait` restituisce la stessa
    /// guardia che ha ricevuto, e una porta che consegnasse una guardia di un
    /// `RwLock` non potrebbe metterla in attesa.
    ///
    /// Il dato protetto è un `bool` che dice «ha finito», e ci si arriva **una
    /// volta** all'apertura: un panico che lo avvelenasse lascerebbe dietro di
    /// sé un `bool`, cioè niente da rendere incredibile. È il caso in cui la
    /// domanda della 0120 ha una risposta diversa perché è diverso *cosa il
    /// lucchetto protegge*.
    Condizione,
    /// **Serializza dei test, e non protegge niente.** Le variabili d'ambiente
    /// sono globali al processo: il lucchetto mette in fila due test, e ciò che
    /// «protegge» è il processo stesso. Qui `into_inner` è la risposta giusta —
    /// ed è la terza risposta che il difetto (9) aveva trovato in giro, rimasta
    /// dov'era perché lì era vera.
    SoloTest,
}

/// I lucchetti nudi che restano, e perché.
///
/// La chiave è `file:simbolo`. Si controlla in **tutte e due le direzioni**: uno
/// che compare e non è qui è rosso, e una riga che non corrisponde più a niente
/// è rossa anche lei — un'allowlist che resta lunga mentre il codice si
/// accorcia smette di essere una fotografia e diventa un ricordo.
fn concessi() -> BTreeMap<&'static str, Perche> {
    BTreeMap::from([
        ("src/runner.rs:Mutex", Perche::Condizione),
        ("src/session.rs:Mutex", Perche::Condizione),
        ("src/config.rs:Mutex", Perche::SoloTest),
    ])
}

/// I sorgenti che il conto giudica. `include_str!` e non `std::fs`: così il
/// legame è una dipendenza di compilazione e non un path da tenere aggiornato a
/// mano — se un file si sposta, questo banco non compila.
///
/// `src/net.rs` è qui e si legge **sempre**, anche in un montaggio che spegne
/// `http-client`: `include_str!` non ha `#[cfg]`, e il verso in cui questo
/// sbaglia è quello giusto — il conto guarda di più, non di meno. Un `#[cfg]`
/// sull'elenco avrebbe fatto l'opposto, cioè un file che sparisce dal presidio
/// esattamente nella build in cui nessuno lo compila.
const SORGENTI: &[(&str, &str)] = &[
    ("src/lib.rs", include_str!("../src/lib.rs")),
    ("src/session.rs", include_str!("../src/session.rs")),
    ("src/runner.rs", include_str!("../src/runner.rs")),
    ("src/watcher.rs", include_str!("../src/watcher.rs")),
    ("src/jobs.rs", include_str!("../src/jobs.rs")),
    ("src/mount.rs", include_str!("../src/mount.rs")),
    ("src/vaults.rs", include_str!("../src/vaults.rs")),
    ("src/config.rs", include_str!("../src/config.rs")),
    ("src/registry.rs", include_str!("../src/registry.rs")),
    ("src/bridge.rs", include_str!("../src/bridge.rs")),
    ("src/settings.rs", include_str!("../src/settings.rs")),
    ("src/records.rs", include_str!("../src/records.rs")),
    ("src/shell.rs", include_str!("../src/shell.rs")),
    ("src/parete.rs", include_str!("../src/parete.rs")),
    ("src/net.rs", include_str!("../src/net.rs")),
    ("app/src/lib.rs", include_str!("../../fub-app/src/lib.rs")),
    ("app/src/main.rs", include_str!("../../fub-app/src/main.rs")),
];

/// **La porta**, e l'unico file che il conto non legge.
///
/// La ragione è che il lucchetto della [`Custodia`] è *il* lucchetto con la
/// politica: leggerlo qui vorrebbe dire pretendere una riga di `concessi()` per
/// la risposta stessa, cioè chiedere alla porta di giustificarsi davanti al
/// conto che esiste per mandarci la gente.
///
/// Fin qui questa costante si chiamava `FUORI_FEATURE` e assolveva **due** file
/// dicendo che stavano «dietro una cargo feature spenta di default», e non era
/// vero per nessuno dei due. `pub mod custodia;` in `lib.rs` è incondizionato:
/// nessuna feature lo ha mai spento, e la ragione per cui sta fuori è
/// **strutturale**, non di packaging. `net.rs` sta dietro `http-client`, che è
/// nel `default` del `Cargo.toml` — cioè acceso in ogni build che nessuno abbia
/// spento a mano —, quindi è codice di produzione compilato di norma, ed è
/// passato in fondo a `SORGENTI`. Era la forma peggiore delle due: non un
/// numero invecchiato ma una **ragione che non è mai stata vera**, e che
/// leggendola faceva sembrare guardato un file che nessuno guardava.
const LA_PORTA: &[&str] = &["custodia.rs"];

/// Le righe di **codice** di un sorgente: la prosa si salta sempre, i banchi
/// solo quando la domanda li riguarda.
///
/// Che un commento non sia codice è la trappola misurata da `dieta_ipc.rs` — in
/// un repo in cui i file spiegano sé stessi, un `grep` ingenuo conta le
/// spiegazioni.
///
/// Che i banchi si saltino o no dipende dalla domanda, e le due qui sono
/// diverse. *«Esiste un lucchetto senza politica?»* vale anche in un banco: un
/// `Mutex` costruito a mano in un `#[cfg(test)]` è comunque un secondo posto in
/// cui la politica non c'è, e va dichiarato. *«Qualcuno srotola la risposta
/// della porta?»* no: un test che scrive `.unwrap()` su un `Result` sta dicendo
/// «qui non deve fallire», che è ciò che un test fa di mestiere.
///
/// Il taglio presuppone che il modulo di test stia **in fondo**, che è come
/// sono scritti i file di questo crate; se un giorno non lo fosse, il conto
/// guarderebbe di meno e non di più.
fn codice(sorgente: &str, salta_i_banchi: bool) -> Vec<(usize, &str)> {
    let fine = match salta_i_banchi {
        true => sorgente.find("\n#[cfg(test)]\n").unwrap_or(sorgente.len()),
        false => sorgente.len(),
    };
    sorgente[..fine]
        .lines()
        .enumerate()
        .map(|(n, riga)| (n + 1, riga.trim()))
        .filter(|(_, riga)| !riga.starts_with("//"))
        .collect()
}

/// **Un lucchetto nudo fuori dalla porta vuole una ragione.**
#[test]
fn nessun_lucchetto_senza_politica() {
    let concessi = concessi();
    let mut trovati: BTreeSet<String> = BTreeSet::new();
    for (file, sorgente) in SORGENTI {
        for (n, riga) in codice(sorgente, false) {
            for simbolo in ["Mutex", "RwLock"] {
                if riga.contains(&format!("{simbolo}<")) || riga.contains(&format!("{simbolo}::")) {
                    let chiave = format!("{file}:{simbolo}");
                    assert!(
                        concessi.contains_key(chiave.as_str()),
                        "{file}:{n} prende un `{simbolo}` a mano:\n    {riga}\n\
                         La politica del veleno sta in `Custodia` (decisione 0120), e un \
                         lucchetto fuori di lì è la seconda risposta alla stessa domanda. \
                         Se davvero non può essere una `Custodia`, la riga va in `concessi()` \
                         con la sua ragione."
                    );
                    trovati.insert(chiave);
                }
            }
        }
    }
    let scaduti: Vec<_> = concessi.keys().filter(|k| !trovati.contains(**k)).collect();
    assert!(
        scaduti.is_empty(),
        "queste righe di `concessi()` non corrispondono più a niente: {scaduti:?} — \
         un'allowlist che resta lunga mentre il codice si accorcia è un ricordo, non una \
         fotografia"
    );
}

/// **Nessuno srotola la risposta della porta.**
///
/// È la zona cieca misurata addosso: `Custodia::read` rende un `Result`, e un
/// `.unwrap()` su quel `Result` rimette in piedi esattamente il panico a ogni
/// IPC che la decisione toglie — col compilatore d'accordo, perché non c'è
/// niente di illegale da segnalare.
#[test]
fn nessuno_srotola_la_risposta_della_porta() {
    for (file, sorgente) in SORGENTI {
        for (n, riga) in codice(sorgente, true) {
            let srotola = ["read().unwrap()", "write().unwrap()"]
                .iter()
                .any(|p| riga.contains(p))
                || (riga.contains(".read().expect(") || riga.contains(".write().expect("));
            assert!(
                !srotola,
                "{file}:{n} srotola la risposta della porta:\n    {riga}\n\
                 Un `unwrap` qui è il panico a ogni chiamata che la decisione 0120 toglie: \
                 la firma di chi chiama porta già un `PluginError`, e la risposta è `?`."
            );
        }
    }
}

/// Le cartelle che `SORGENTI` dice di coprire, come prefisso e come path.
///
/// Sono **due** perché `SORGENTI` nomina due crate, e questa costante esiste
/// perché il conto le derivi invece di ricordarsene una sola: prima la
/// passeggiata guardava `crates/fub-host/src` e basta, mentre l'elenco
/// dichiarava anche `app/src/lib.rs`. La metà taciuta era vacua per il difetto
/// che il primo conto cerca — `fub-app` non ha lucchetti nudi — e **non** per il
/// difetto che questa passeggiata cerca: `crates/fub-app/src/main.rs` c'era già,
/// non era in `SORGENTI`, e nessuno lo diceva. Sei righe di `main`, quindi
/// niente di rotto; ma la cosa che qui si presidia non è il contenuto di quel
/// file, è che il **prossimo** entri in rumore e non in silenzio.
const CARTELLE: &[(&str, &str)] = &[("src", "src"), ("app/src", "../fub-app/src")];

/// **Il conto guarda tutte le cartelle che dice di guardare**, o dice quale file
/// gli è sfuggito.
///
/// È la lezione di `dieta_ipc.rs`: un presidio che legge un elenco di file sa
/// quell'elenco, e un file nuovo entra in silenzio. Qui l'elenco lo si
/// confronta con le cartelle vere.
///
/// Che sia rosso davvero si prova **togliendo** una riga da `SORGENTI`, non
/// aggiungendo un file: un elenco che dice «questi sono tutti» sbaglia per
/// difetto, e un caso in più non tocca il verso in cui sbaglia.
#[test]
fn ogni_file_e_guardato() {
    let radice = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut mancanti = Vec::new();
    for (prefisso, cartella) in CARTELLE {
        let dir = radice.join(cartella);
        for voce in std::fs::read_dir(&dir).expect("la cartella dei sorgenti") {
            let voce = voce.expect("una voce");
            let nome = voce.file_name().to_string_lossy().to_string();
            if !nome.ends_with(".rs") || LA_PORTA.contains(&nome.as_str()) {
                continue;
            }
            let atteso = format!("{prefisso}/{nome}");
            if !SORGENTI.iter().any(|(f, _)| *f == atteso) {
                mancanti.push(atteso);
            }
        }
    }
    assert!(
        mancanti.is_empty(),
        "questi sorgenti sono nati dopo il conto e nessuno li guarda: {mancanti:?}"
    );
}

// ---------------------------------------------------------------------------
// 2. Il comportamento
// ---------------------------------------------------------------------------

/// Un vault vero, aperto come lo apre l'app meno il rilevatore.
fn vault() -> (tempfile::TempDir, Host, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("nota.md"), "ciao\n").expect("semina");
    let host = Host::new().with_watcher(Box::new(NoWatcher));
    host.open(&root).expect("apertura");
    let root = host.current().expect("appena aperto è il corrente");
    (dir, host, root)
}

/// Avvelena il workspace del vault corrente come lo avvelena la vita: un thread
/// che pania **tenendo il prestito esclusivo**.
///
/// L'hook dei panici si mette a tacere per la durata del misfatto: un panico di
/// proposito che stampa la sua traccia fa sembrare rotto un banco verde, e chi
/// legge l'output smette di fidarsi di tutti gli altri.
fn avvelena(ws: &Custodia<fub_kernel::Workspace>) {
    let copia = ws.clone();
    let hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let _ = std::thread::spawn(move || {
        let _g = copia.write().expect("vivo prima del misfatto");
        panic!("un provider a metà di una scrittura");
    })
    .join();
    std::panic::set_hook(hook);
}

/// **Ciò che l'utente vede la prima volta, e ciò che vede le volte dopo.**
///
/// Prima della 0120 questo test non sarebbe fallito: avrebbe **abortito il
/// thread del banco**, che è la stessa cosa che l'app faceva a ogni `invoke`.
#[test]
fn un_vault_avvelenato_risponde_di_no_a_ogni_chiamata() {
    let (_dir, host, _root) = vault();
    let ws = host.workspace(None).expect("il vault corrente");
    avvelena(&ws);

    // Dieci chiamate, come dieci IPC di fila: nessuna pania, tutte rispondono.
    for giro in 0..10 {
        let esito = host.in_session(None, |s| Ok(s.workspace().read()?.documents().len()));
        let err = esito.expect_err("giro {giro}: un vault morto non risponde con dei dati");
        let frase = err.to_string();
        assert!(
            frase.contains("irrecuperabile"),
            "giro {giro}: la frase non dice cosa è successo: {frase}"
        );
        assert!(
            frase.contains("riavvia"),
            "giro {giro}: la frase non dice cosa fare: {frase}"
        );
        assert!(
            frase.contains("disco"),
            "giro {giro}: la frase non dice cosa NON si è perso: {frase}"
        );
    }

    // E la riga di diagnosi è **una**: la metà del difetto (9) era che nessuno
    // dicesse perché; l'altra metà sarebbe stata dirlo venti volte.
    assert_eq!(
        ws.denunce(),
        1,
        "venti prestiti rifiutati e una sola riga scritta"
    );
}

/// **Chiudere un vault avvelenato non pania: dice cosa non ha potuto chiudere.**
///
/// È il caso in cui l'irrecuperabilità incontra una firma che un canale ce l'ha
/// già — `close_vault` rende ciò che è andato storto chiudendo — e la risposta
/// è metterci dentro anche questo, invece di inventare un secondo canale.
#[test]
fn chiudere_un_vault_avvelenato_lo_dice_invece_di_paniare() {
    let (_dir, host, root) = vault();
    let ws = host.workspace(None).expect("il vault corrente");
    avvelena(&ws);

    let guai = host.close_vault(&root).expect("la sessione c'è ancora");
    assert!(
        guai.iter()
            .any(|g| g.to_string().contains("irrecuperabile")),
        "chi chiude non ha saputo che il vault era morto: {guai:?}"
    );
    assert!(
        host.vaults().is_empty(),
        "e il vault è comunque uscito dalla mappa: restarci sarebbe un vault \
         irraggiungibile e mai chiuso"
    );
}

/// **Due vault sono due stati.** Il veleno è del dato, non del processo: un
/// secondo vault aperto continua a rispondere.
#[test]
fn il_veleno_di_un_vault_non_tocca_l_altro() {
    let (_dir_a, host, root_a) = vault();
    let dir_b = tempfile::tempdir().expect("tempdir");
    let root_b = Utf8PathBuf::from_path_buf(dir_b.path().to_path_buf()).expect("utf8");
    std::fs::write(root_b.join("altra.md"), "ciao\n").expect("semina");
    host.open(&root_b).expect("secondo vault");

    // Nominati, e non presi per posizione: `vaults()` ordina per path, e un
    // banco che si fidasse dell'ordine proverebbe una volta su due l'opposto di
    // ciò che dice di provare.
    let ws_a = host.workspace(Some(root_a.as_str())).expect("il primo");
    let ws_b = host.workspace(Some(root_b.as_str())).expect("il secondo");
    avvelena(&ws_a);

    assert!(ws_a.read().is_err(), "il primo è morto");
    assert!(ws_b.read().is_ok(), "il secondo non c'entra niente");
    assert_eq!(ws_b.denunce(), 0);
}
