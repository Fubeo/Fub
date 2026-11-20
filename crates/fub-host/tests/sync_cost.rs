//! **Un passaggio di sync costa quanto è cambiato, non quanto è grande il
//! vault** (#519): host vero e servizio vero, nello stesso processo.
//!
//! Tre costi, ognuno contato:
//!
//! - un passaggio senza cambiamenti non apre nessun file del vault: i file si
//!   rendono illeggibili prima del passaggio, e il passaggio riesce lo stesso;
//! - `cursor.json` si scrive una volta per lotto, non una per op: le scritture
//!   si contano dai file temporanei che la scrittura atomica crea;
//! - un file cambiato da fuori Fub mentre l'app era chiusa si vede comunque,
//!   anche con la stessa misura e la data rimessa com'era.
//!
//! E la ripresa: un passaggio interrotto a metà (un op che non si autentica
//! dopo che i precedenti sono già sul disco, una risposta persa dopo che il
//! server ha scritto) converge al passaggio dopo, senza op persi né doppi.
#![cfg(feature = "http-client")]

mod sync_support;

use std::collections::BTreeSet;
use std::time::Instant;

use camino::Utf8Path;
use sync_support::{count, join_with_invite, service_with_account, set_passphrase, Device};

const PASSPHRASE_A: &str = "passphrase del primo dispositivo, lunga abbastanza";
const PASSPHRASE_B: &str = "passphrase del secondo dispositivo, diversa dalla prima";
const NOTES: usize = 2_000;
const ASSETS: usize = 40;

fn note_name(i: usize) -> String {
    format!("note/cartella-{:02}/nota-{i:04}.md", i % 20)
}

fn asset_name(i: usize) -> String {
    format!("allegati/immagine-{i:02}.png")
}

fn note_text(i: usize) -> String {
    format!("# Nota {i:04}\n\nUn paragrafo che ha sempre la stessa misura.\n")
}

fn asset_bytes(i: usize, salt: u8) -> Vec<u8> {
    (0..2_048)
        .map(|n| (n as u8).wrapping_mul(31) ^ (i as u8) ^ salt)
        .collect()
}

/// Ogni file del vault, path relativo e byte, fuori da `.fub/`.
fn files_of(root: &Utf8Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in dir.read_dir_utf8().unwrap() {
            let entry = entry.unwrap();
            let path = entry.path().to_path_buf();
            let relative = path.strip_prefix(root).unwrap().as_str().replace('\\', "/");
            if relative == ".fub" || relative.starts_with(".fub/") {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                stack.push(path);
            } else {
                out.push((relative, std::fs::read(&path).unwrap()));
            }
        }
    }
    out.sort();
    out
}

/// Le scritture atomiche di un file di stato, contate dai temporanei che
/// ognuna crea (`.<nome>.<uuid>.tmp`). Solo su Linux, dove inotify le vede
/// tutte; altrove il conto non c'è e i controlli sul conto si saltano.
struct StateWrites {
    #[cfg(target_os = "linux")]
    _watcher: notify::RecommendedWatcher,
    #[cfg(target_os = "linux")]
    events: std::sync::mpsc::Receiver<notify::Result<notify::Event>>,
}

impl StateWrites {
    fn watch(dir: &Utf8Path) -> Self {
        #[cfg(target_os = "linux")]
        {
            use notify::Watcher as _;
            let (tx, events) = std::sync::mpsc::channel();
            let mut watcher = notify::recommended_watcher(tx).expect("watcher");
            watcher
                .watch(dir.as_std_path(), notify::RecursiveMode::Recursive)
                .expect("watch");
            StateWrites {
                _watcher: watcher,
                events,
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = dir;
            StateWrites {}
        }
    }

    /// Quante scritture di `name` da quando si è chiesto l'ultima volta.
    /// `None` dove il conto non c'è.
    fn take(&self, name: &str) -> Option<usize> {
        #[cfg(target_os = "linux")]
        {
            let prefix = format!(".{name}.");
            let mut seen = 0;
            while let Ok(event) = self
                .events
                .recv_timeout(std::time::Duration::from_millis(300))
            {
                let event = event.expect("watch event");
                if !matches!(event.kind, notify::EventKind::Create(_)) {
                    continue;
                }
                seen += event
                    .paths
                    .iter()
                    .filter(|path| {
                        path.file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|file| file.starts_with(&prefix) && file.ends_with(".tmp"))
                    })
                    .count();
            }
            Some(seen)
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = name;
            None
        }
    }
}

/// Rende illeggibili i file del vault fuori da `.fub/`: un passaggio che ne
/// apre uno fallisce. `false` se il processo li legge lo stesso (root).
#[cfg(unix)]
fn lock_files(root: &Utf8Path, mode: u32) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let mut stack = vec![root.to_path_buf()];
    let mut sample = None;
    while let Some(dir) = stack.pop() {
        for entry in dir.read_dir_utf8().unwrap() {
            let entry = entry.unwrap();
            let path = entry.path().to_path_buf();
            if entry.file_name() == ".fub" {
                continue;
            }
            if entry.file_type().unwrap().is_dir() {
                stack.push(path);
            } else {
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
                sample.get_or_insert(path);
            }
        }
    }
    sample.is_some_and(|path| std::fs::read(path).is_err())
}

/// I documenti spinti da `from` in poi.
fn pushed_docs(network: &sync_support::InProcess, from: usize) -> Vec<String> {
    network.pushed.lock().unwrap()[from..]
        .iter()
        .map(|op| op["doc_id"].as_str().unwrap().to_string())
        .collect()
}

/// Quante versioni il servizio tiene per `doc`.
fn server_versions(network: &sync_support::InProcess, auth: &str, vault: &str, doc: &str) -> usize {
    let response = fub_services::sync::handle(
        &mut network.state.lock().unwrap(),
        "GET",
        &format!(
            "/v1/sync/versions?vault_id={vault}&doc_id={}",
            doc.replace('/', "%2F")
        ),
        Some(auth),
        b"",
    );
    assert_eq!(response.status, 200);
    let body: serde_json::Value = serde_json::from_slice(&response.body).unwrap();
    body["versions"].as_array().unwrap().len()
}

#[test]
fn a_pass_costs_what_changed_and_an_interrupted_pass_converges() {
    sync_support::clear_sync_env();
    let (_data, service, token) = service_with_account();
    let auth = format!("Bearer {token}");
    let network = sync_support::InProcess::new(service);

    let mut files: Vec<(String, Vec<u8>)> = (0..NOTES)
        .map(|i| (note_name(i), note_text(i).into_bytes()))
        .collect();
    files.extend((0..ASSETS).map(|i| (asset_name(i), asset_bytes(i, 0))));
    let borrowed: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(name, bytes)| (name.as_str(), bytes.as_slice()))
        .collect();
    let total = NOTES + ASSETS;

    // 1. Il primo push del vault intero.
    set_passphrase(PASSPHRASE_A);
    let mut a = Device::new(&network, &token, &borrowed);
    let a_writes = StateWrites::watch(&a.config);
    let started = Instant::now();
    let first = a.pass("the first push");
    eprintln!(
        "primo push: {:?}, cursor.json scritto {:?} volte",
        started.elapsed(),
        a_writes.take("cursor.json")
    );
    assert_eq!(first["pushed"], total);
    assert_eq!(a.outbox_len(), 0);
    let vault_id = a.state("vault-pairing").expect("pairing");

    // 2. Un passaggio senza cambiamenti non apre nessun file del vault e non
    //    riscrive il cursore.
    #[cfg(unix)]
    let locked = lock_files(&a.vault, 0o000);
    network.take_requests();
    let started = Instant::now();
    let quiet = a.pass("a pass without changes reads no file of the vault");
    eprintln!("passaggio fermo: {:?}", started.elapsed());
    #[cfg(unix)]
    {
        lock_files(&a.vault, 0o644);
        if !locked {
            eprintln!("il processo legge i file anche senza permessi: controllo saltato");
        }
    }
    assert_eq!(quiet["pushed"], 0);
    assert_eq!(quiet["applied"], 0);
    if let Some(writes) = a_writes.take("cursor.json") {
        assert_eq!(writes, 0, "a pass without changes leaves the cursor alone");
    }
    let requests = network.take_requests();
    assert_eq!(count(&requests, "/v1/sync/push"), 0);
    assert_eq!(count(&requests, "/v1/sync/versions"), 0);

    // 3. Un secondo dispositivo scarica il vault intero; il primo passaggio si
    //    interrompe a metà, su un op che non si autentica, quando i precedenti
    //    sono già sul disco.
    let b = Device::new(&network, &token, &[]);
    let accepted = join_with_invite(&a, PASSPHRASE_A, &b, PASSPHRASE_B);
    assert_eq!(accepted["key_epoch"], 1);
    let b_writes = StateWrites::watch(&b.config);
    *network.tamper_pull_op.lock().unwrap() = Some(total / 2);
    let interrupted = b.job(serde_json::json!({"op": "pass"}));
    assert!(interrupted.is_err(), "the tampered op stops the pass");
    let half = b_writes.take("cursor.json");
    network.take_requests();
    let started = Instant::now();
    let resumed = b.pass("the pass after the interruption converges");
    let requests = network.take_requests();
    let resumed_writes = b_writes.take("cursor.json");
    eprintln!(
        "pull di {total} op: {:?}, cursor.json scritto {half:?} + {resumed_writes:?} volte, \
         versioni chieste {} volte",
        started.elapsed(),
        count(&requests, "/v1/sync/versions"),
    );
    assert_eq!(resumed["held"], 0);
    assert_eq!(resumed["conflicts"], 0);
    assert_eq!(
        files_of(&b.vault),
        files_of(&a.vault),
        "the second device holds the same vault, nothing lost, nothing doubled"
    );
    // L'interrotto: il segno del pull in corso, un blocco di op, quelli prima
    // dell'errore. Il ripreso: il segno, un blocco, la fine del pull.
    if let (Some(half), Some(resumed)) = (half, resumed_writes) {
        assert!(
            half <= 3,
            "the interrupted pass wrote the cursor {half} times"
        );
        assert!(resumed <= 4, "the pull wrote the cursor {resumed} times");
    }
    let quiet = b.pass("the next pass on the second device is quiet");
    assert_eq!(quiet["applied"], 0);
    assert_eq!(quiet["pushed"], 0);

    // 4. La risposta del push si perde dopo che il servizio ha scritto: il
    //    passaggio dopo rimanda gli stessi op, e il servizio li tiene una volta.
    set_passphrase(PASSPHRASE_A);
    let changed: Vec<String> = (0..5).map(note_name).collect();
    for (n, doc) in changed.iter().enumerate() {
        a.write(doc, &format!("# Cambiata {n}\n"));
    }
    *network.lose_response.lock().unwrap() = Some("/v1/sync/push".into());
    assert!(a.job(serde_json::json!({"op": "pass"})).is_err());
    assert_eq!(
        a.outbox_len(),
        changed.len(),
        "unacknowledged ops stay queued"
    );
    let retried = a.pass("the queued ops go again");
    assert_eq!(retried["pushed"], changed.len());
    assert_eq!(a.outbox_len(), 0);
    for doc in &changed {
        assert_eq!(
            server_versions(&network, &auth, &vault_id, doc),
            2,
            "{doc}: the first push and the change, the change once"
        );
    }
    set_passphrase(PASSPHRASE_B);
    let pulled = b.pass("the second device takes the changes");
    assert_eq!(pulled["applied"], changed.len());
    assert_eq!(files_of(&b.vault), files_of(&a.vault));

    // 5. Cambiati da fuori Fub mentre l'app era chiusa, con la stessa misura:
    //    una nota e un allegato, e una nota e un allegato con la data rimessa
    //    com'era. Misura e data non bastano a vederli: li vede il timbro di
    //    cambio del file, che la scansione d'apertura confronta.
    set_passphrase(PASSPHRASE_A);
    let note = note_name(7);
    let asset = asset_name(3);
    let restored = note_name(8);
    let hidden = asset_name(4);
    a.reopen(|vault| {
        std::fs::write(vault.join(&note), note_text(7).replace("Un ", "Il ")).unwrap();
        std::fs::write(vault.join(&asset), asset_bytes(3, 0x5a)).unwrap();
        rewrite_keeping_date(&vault.join(&restored), note_text(8).replace("Un ", "Il "));
        rewrite_keeping_date(&vault.join(&hidden), asset_bytes(4, 0x5a));
    });
    let from = network.pushed.lock().unwrap().len();
    a.pass("the changes made while closed are seen");
    let seen: BTreeSet<String> = pushed_docs(&network, from).into_iter().collect();
    assert_eq!(
        seen,
        BTreeSet::from([
            note.clone(),
            asset.clone(),
            restored.clone(),
            hidden.clone()
        ]),
        "exactly the files changed while the app was closed"
    );
    set_passphrase(PASSPHRASE_B);
    b.pass("the second device takes them");
    assert_eq!(files_of(&b.vault), files_of(&a.vault));
}

/// Riscrive `path` con altri byte e gli rimette la data di prima.
fn rewrite_keeping_date(path: &Utf8Path, bytes: impl AsRef<[u8]>) {
    let before = std::fs::metadata(path).unwrap().modified().unwrap();
    std::fs::write(path, bytes).unwrap();
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(before)
        .unwrap();
}
