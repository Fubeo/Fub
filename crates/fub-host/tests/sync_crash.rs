//! Un pull interrotto da un crollo del processo, non da un errore.
//!
//! Il pull tiene il cursore in memoria e lo scrive a blocchi. Se il processo
//! muore fra due scritture, sul disco restano dei file appena scaricati che il
//! cursore non nomina: a guardarli sembrano modifiche locali. Il passaggio
//! dopo non deve rimandarli al servizio (sarebbero op concorrenti, cioè
//! conflitti finti), e una modifica vera fatta dopo il crollo su uno di loro
//! non deve perdersi.
//!
//! Il crollo è un panico a un punto fisso del pull
//! (`crash_next_pull_after`): niente dopo di lui scrive, come in un processo
//! ucciso.

mod sync_support;

use std::panic::AssertUnwindSafe;

use sync_support::{join_with_invite, service_with_account, set_passphrase, Device, InProcess};

const PASSPHRASE_A: &str = "passphrase del primo dispositivo, lunga abbastanza";
const PASSPHRASE_B: &str = "passphrase del secondo dispositivo, diversa dalla prima";
const NOTES: usize = 300;
/// Meno di un blocco di scrittura del cursore: il crollo cade fra due.
const CRASH_AT: usize = 100;

fn note_name(i: usize) -> String {
    format!("note/nota-{i:03}.md")
}

fn note_text(i: usize) -> String {
    format!("# Nota {i:03}\n\nScaricata dal primo dispositivo.\n")
}

#[test]
fn a_pull_cut_by_a_crash_sends_back_nothing_it_downloaded() {
    sync_support::clear_sync_env();
    let (_data, service, token) = service_with_account();
    let network = InProcess::new(service);
    let files: Vec<(String, String)> = (0..NOTES).map(|i| (note_name(i), note_text(i))).collect();
    let borrowed: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(name, text)| (name.as_str(), text.as_bytes()))
        .collect();

    set_passphrase(PASSPHRASE_A);
    let a = Device::new(&network, &token, &borrowed);
    assert_eq!(a.pass("the first push")["pushed"], NOTES);

    let mut b = Device::new(&network, &token, &[]);
    join_with_invite(&a, PASSPHRASE_A, &b, PASSPHRASE_B);
    fub_host::remote::bundle::crash_next_pull_after(CRASH_AT);
    let crashed = std::panic::catch_unwind(AssertUnwindSafe(|| {
        b.job(serde_json::json!({"op": "pass"}))
    }));
    assert!(
        !matches!(crashed, Ok(Ok(_))),
        "the pass dies in the middle of the pull"
    );
    let arrived: Vec<usize> = (0..NOTES)
        .filter(|&i| std::fs::read_to_string(b.vault.join(note_name(i))).ok() == Some(note_text(i)))
        .collect();
    assert!(
        arrived.len() >= CRASH_AT && arrived.len() < NOTES,
        "the crash leaves part of the vault downloaded: {}",
        arrived.len()
    );

    // L'app riparte; su uno dei file già scaricati qualcuno scrive davvero.
    b.restart_after_crash();
    let edited = note_name(arrived[0]);
    let edit = "# Cambiata sul secondo dispositivo dopo il crollo\n";
    b.write(&edited, edit);

    // La modifica vera e la copia di conflitto con i byte remoti sono gli
    // unici file che possono partire dal secondo dispositivo.
    let copy_prefix = format!("{}.sync-conflict-", edited.trim_end_matches(".md"));
    let is_the_change = |doc: &str| doc == edited || doc.starts_with(&copy_prefix);

    let from = network.pushed.lock().unwrap().len();
    let after = b.pass("the pass after the crash");
    let echoed: Vec<String> = network.pushed.lock().unwrap()[from..]
        .iter()
        .map(|op| op["doc_id"].as_str().unwrap().to_string())
        .filter(|doc| !is_the_change(doc))
        .collect();
    assert!(
        echoed.is_empty(),
        "{} downloaded files went back to the service as local changes, e.g. {:?}",
        echoed.len(),
        echoed.first()
    );
    assert_eq!(
        std::fs::read_to_string(b.vault.join(&edited)).unwrap(),
        edit,
        "the change made after the crash is kept"
    );
    assert_eq!(
        after["conflicts"], 1,
        "the file changed after the crash is the only conflict: {after}"
    );
    let copies: Vec<String> = b
        .vault
        .join("note")
        .read_dir_utf8()
        .unwrap()
        .map(|entry| format!("note/{}", entry.unwrap().file_name()))
        .filter(|name| name.starts_with(&copy_prefix))
        .collect();
    assert_eq!(copies.len(), 1, "one conflict copy: {copies:?}");
    assert_eq!(
        std::fs::read_to_string(b.vault.join(&copies[0])).unwrap(),
        note_text(arrived[0]),
        "the conflict copy keeps the downloaded bytes"
    );
    for i in (0..NOTES).filter(|&i| note_name(i) != edited) {
        assert_eq!(
            std::fs::read_to_string(b.vault.join(note_name(i))).ok(),
            Some(note_text(i)),
            "{} arrives whole",
            note_name(i)
        );
    }

    let quiet = b.pass("the next pass is quiet");
    assert_eq!(quiet["applied"], 0);
    let pushed_after = network.pushed.lock().unwrap().len();
    assert!(
        network.pushed.lock().unwrap()[from..pushed_after]
            .iter()
            .all(|op| is_the_change(op["doc_id"].as_str().unwrap())),
        "nothing but the real change ever leaves the second device"
    );
}
