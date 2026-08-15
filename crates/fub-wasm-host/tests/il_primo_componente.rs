//! **Il primo componente WASM che si monta, vive e si smonta.**
//!
//! È il gemello di `crates/fub-host/tests/il_primo_plugin.rs`: stesso vault,
//! stesso banco, stesso job, stesse asserzioni. Ciò che cambia è una riga sola
//! — là il bundle è una `struct` Rust, qui è un `.wasm` — e il fatto che tutto
//! il resto NON cambi è ciò che il test prova. Il §16.1 dice «un trait, due
//! backend»; questi due file, letti uno accanto all'altro, sono la frase in
//! forma eseguibile.
//!
//! # Il componente lo compila il test
//!
//! `esempi/ping-wasm` sta fuori dal workspace e si compila per
//! `wasm32-wasip2`. Il test invoca `cargo` da sé invece di cercare un artefatto
//! che qualcun altro dovrebbe aver prodotto: un test che si salta da solo
//! quando il file non c'è è un test che un giorno non gira più e nessuno se ne
//! accorge. Se il bersaglio manca, il fallimento dice come installarlo.

use std::sync::Arc;
use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::event::Event;
use fub_abi::options::permission;
use fub_abi::traits::JobSpec;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust};
use fub_wasm_host::WasmBundle;

const ID: &str = "demo.ping";

// --- il componente ----------------------------------------------------------

/// Compila `esempi/ping-wasm` in una delle sue varianti e restituisce il
/// `.wasm`.
///
/// La variante è una feature dell'esempio, cioè **una riga sola di differenza**
/// nel componente: il manifest senza `read-vault`, o il mondo che chiede anche
/// la rete.
///
/// # Una cartella sola, un `cargo` per volta
///
/// Le tre varianti condividono la stessa `--target-dir`, e questa è la ragione
/// per cui esiste il lucchetto qui sotto. Misurato: con una cartella per
/// variante il test compilava l'albero dell'esempio tre volte e ci metteva
/// ~62s; con una cartella sola le dipendenze si compilano una volta e a
/// cambiare è solo il `cdylib`. Il prezzo è che due `cargo` sulla stessa
/// cartella con feature diverse si sovrascriverebbero il `.wasm` a vicenda —
/// e i test girano su thread paralleli. Quindi: si serializza, e appena
/// l'artefatto è pronto lo si **copia** in un file che porta il nome della
/// variante, prima di lasciare il lucchetto.
fn componente(variante: &str) -> Utf8PathBuf {
    static LUCCHETTO: std::sync::Mutex<()> = std::sync::Mutex::new(());
    // Un panico dentro la parentesi avvelena il `Mutex`, e un test già rotto non
    // è una ragione per farne fallire altri due con un messaggio che parla di
    // avvelenamento invece che del guasto vero.
    let _guardia = LUCCHETTO.lock().unwrap_or_else(|e| e.into_inner());

    let radice = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("esempi/ping-wasm");
    let uscita = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("ping-wasm");
    let copia = Utf8PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "ping_wasm-{}.wasm",
        if variante.is_empty() {
            "base"
        } else {
            variante
        }
    ));

    let mut cargo = std::process::Command::new(env!("CARGO"));
    cargo
        .arg("build")
        .arg("--release")
        .arg("--target")
        .arg("wasm32-wasip2")
        .arg("--manifest-path")
        .arg(radice.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&uscita);
    if !variante.is_empty() {
        cargo.arg("--features").arg(variante);
    }
    let esito = cargo.output().expect("cargo si esegue");
    assert!(
        esito.status.success(),
        "il componente di esempio non si compila.\n\
         Se manca il bersaglio: `rustup target add wasm32-wasip2`.\n{}",
        String::from_utf8_lossy(&esito.stderr)
    );

    let wasm = uscita.join("wasm32-wasip2/release/ping_wasm.wasm");
    assert!(wasm.exists(), "il componente compilato non è in {wasm}");
    std::fs::copy(&wasm, &copia).expect("la copia della variante");
    copia
}

// --- il banco ---------------------------------------------------------------

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        Vault { _dir: dir, root }
    }
}

/// Un host headless col vault aperto e il componente montato.
fn banco(v: &Vault, permessi: bool) -> (Host, Subscription) {
    let wasm = componente(if permessi { "" } else { "senza-permessi" });
    let bundle = WasmBundle::da_file(&wasm, Trust::Community).expect("il componente si carica");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    let eventi = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(&bundle, &mut ws)
            .expect("il bundle si monta");
    })
    .expect("aperto");
    (host, eventi)
}

fn chiedi(host: &Host, job: &str) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

fn esito(eventi: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
    let scadenza = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < scadenza {
        if let Ok(notice) = eventi.recv_timeout(Duration::from_millis(200)) {
            if let Event::JobDone { job, result, .. } = notice.event {
                return (job, result);
            }
        }
    }
    panic!("nessun job è mai tornato: la coda non la drena nessuno");
}

// --- le prove ---------------------------------------------------------------

/// Il giro intero, su un backend che il kernel non sa di avere: montare, vedere
/// il manifest nell'inventario, far girare un job che legge il vault, smontare.
#[test]
fn un_componente_wasm_si_monta_vive_e_si_smonta() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v, true);

    // Montato: il plugin è nell'inventario del §7.6 con ciò che il **manifest
    // del componente** ha dichiarato, non ciò che un file accanto diceva di lui.
    host.with_session(None, |s| {
        let ws = s.workspace().read().unwrap();
        let info = ws
            .plugins()
            .into_iter()
            .find(|p| p.id == ID)
            .expect("il componente è nell'inventario del §7.6");
        assert!(
            info.permissions.enabled(permission::READ_VAULT),
            "il manifest del `.wasm` dichiara `read-vault` e l'inventario lo mostra"
        );
        assert!(
            s.bundles().read().unwrap().ids().contains(&ID),
            "il registry possiede il bundle"
        );
    })
    .expect("aperto");

    // Il job gira sul pool vero, dentro l'istanza WASM, e torna con l'esito:
    // ha letto la nota **attraverso il confine**.
    chiedi(&host, "ping");
    let (job, result) = esito(&eventi);
    assert_eq!(job, "ping");
    let valore = result.expect("il job è riuscito");
    assert_eq!(valore["nota"], "Nota.md");
    assert!(
        valore["caratteri"].as_u64().unwrap() > 0,
        "il job ha letto davvero: {valore}"
    );
    // `acceso` è la traccia che l'attivazione ha lasciato dentro il componente:
    // il diario del plugin nativo, nell'unica forma che attraversa un confine.
    assert!(
        valore["acceso"].as_u64().unwrap() > 0,
        "`activate` è stato chiamato e l'orologio ha risposto: {valore}"
    );

    // Un job che non esiste è `UnknownJob`, e il nome è quello chiesto: un
    // errore del contratto tradotto dal WIT, non un trap.
    chiedi(&host, "non-esiste");
    let (_, result) = esito(&eventi);
    let errore = result.expect_err("un job sconosciuto non riesce");
    assert!(
        matches!(&errore, PluginError::UnknownJob(t)
            if t.as_literal() == Some("non-esiste")),
        "è un job sconosciuto, col suo nome: {errore}"
    );

    // Smontato: `deactivate` è passato dal confine e il registry non lo ha più.
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        let errori = s.bundles().write().unwrap().unmount(&mut ws, ID);
        assert!(errori.is_empty(), "niente è andato storto: {errori:?}");
        assert!(
            !s.bundles().read().unwrap().ids().contains(&ID),
            "il registry non possiede più il bundle"
        );
    })
    .expect("aperto");

    host.close();
}

/// Il cancello del §7.3 davanti a un componente: **lo stesso** `.wasm`, con un
/// manifest che non chiede `read-vault`, si monta lo stesso — e la sua prima
/// lettura riceve `PermissionDenied`.
///
/// Che il rifiuto arrivi al componente come **valore** e non come trap è metà
/// del punto: l'istanza è ancora viva dopo, e il job torna con un errore che si
/// legge invece che con un'istanza abbattuta.
#[test]
fn un_componente_senza_il_permesso_vede_chiudersi_il_cancello() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v, false);

    chiedi(&host, "ping");
    let (job, result) = esito(&eventi);
    assert_eq!(job, "ping");
    let errore = result.expect_err("senza `read-vault` il ping non legge");
    assert!(
        matches!(&errore, PluginError::PermissionDenied(t)
            if t.as_literal().is_some_and(|m| m.contains("non ha dichiarato il permesso"))),
        "è il permesso a chiudere, e il messaggio è quello del kernel: {errore}"
    );

    host.close();
}

/// **Un componente che chiede una famiglia non servita non si monta**, e il
/// messaggio la nomina.
///
/// È il prezzo dichiarato del linker per interfaccia (vedi il modulo `ospite`):
/// le famiglie che questo host serve oggi sono due, e chi ne importa una terza
/// lo scopre al caricamento invece che a metà lavoro. Il componente di prova è
/// lo stesso ping, compilato contro un mondo che importa anche
/// `fub:abi/host-network`.
#[test]
fn una_famiglia_non_servita_si_fa_nominare() {
    let wasm = componente("con-rete");
    let errore = WasmBundle::da_file(&wasm, Trust::Community)
        .expect_err("una famiglia non servita non si carica");
    let detto = errore.to_string();
    assert!(
        detto.contains("host-network"),
        "il rifiuto nomina la famiglia che manca: {detto}"
    );
}

/// Il tipo del prestito deve poter attraversare i thread: un job gira sul pool.
/// Se un giorno smettesse, questo test non compilerebbe più.
#[test]
fn il_bundle_attraversa_i_thread() {
    fn pretende_send_sync<T: Send + Sync>() {}
    pretende_send_sync::<WasmBundle>();
    pretende_send_sync::<Arc<dyn fub_abi::traits::Plugin>>();
}
