//! **Il primo sync di un vault funziona, e il rekey cambia davvero chiave**
//! (#516): host vero e servizio vero, nello stesso processo.
//!
//! Il client di rete non finge risposte: inoltra ogni richiesta a
//! `fub_services::sync::handle` su uno stato in una cartella temporanea, come
//! farebbe il server. Così il contratto dell'epoca della chiave è provato ai
//! due capi insieme: il servizio assegna la prima epoca, il client la adotta e
//! la salva prima di sigillare.
//!
//! Un test solo, e non uno per caso: le variabili `FUB_SERVICES_*` e
//! `FUB_SYNC_*` sono del processo, e due test paralleli se le contenderebbero.
#![cfg(feature = "http-client")]

mod sync_support;

use fub_services::server::ServiceState;
use sync_support::{
    clear_sync_env, open_last_push, owner_only, served_key, set_passphrase, utf8_dir, Device,
    InProcess,
};

const PASSPHRASE_A: &str = "passphrase del primo dispositivo, lunga abbastanza";
const PASSPHRASE_B: &str = "passphrase del secondo dispositivo, diversa dalla prima";

#[test]
fn the_first_pass_and_a_rekey_seal_with_the_served_key() {
    assert_eq!(
        fub_host::remote::INITIAL_KEY_EPOCH,
        fub_services::sync::INITIAL_KEY_EPOCH,
        "client and service agree on the first epoch"
    );
    clear_sync_env();
    let (_data_dir, data) = utf8_dir();
    let mut service = ServiceState::open(Some(data.clone().into_std_path_buf())).expect("service");
    let owner = service
        .accounts
        .create_account("proprietaria", "correct-horse-99")
        .expect("account");
    let token = service.accounts.issue_session_token(&owner).expect("token");
    let auth = format!("Bearer {token}");
    let network = InProcess::new(service);

    // 1. Primo passaggio di un vault nuovo: il servizio crea la chiave
    //    all'epoca uno e il client sigilla con quella, non con zero.
    set_passphrase(PASSPHRASE_A);
    let a = Device::new(&network, &token, &[("Prima.md", b"# Prima\n")]);
    a.pass("the first pass of a new vault succeeds");
    assert_eq!(
        a.state("key-epoch").as_deref(),
        Some("1"),
        "the epoch is saved"
    );
    assert_eq!(a.outbox_len(), 0, "the first push is acknowledged");
    let vault_id = a.state("vault-pairing").expect("pairing");
    let (epoch, vdk_a) = served_key(&network, &auth, &vault_id, PASSPHRASE_A);
    assert_eq!(epoch, 1);
    let (sealed_at, plain) = open_last_push(&network, "Prima.md", &vdk_a);
    assert_eq!(sealed_at, 1);
    assert_eq!(plain.as_deref(), Ok("# Prima\n".as_bytes()));
    a.write("Prima.md", "# Prima, di nuovo\n");
    a.pass("the next pass keeps working");
    assert_eq!(a.outbox_len(), 0);
    let (sealed_at, plain) = open_last_push(&network, "Prima.md", &vdk_a);
    assert_eq!(sealed_at, 1);
    assert_eq!(plain.as_deref(), Ok("# Prima, di nuovo\n".as_bytes()));

    // 2. Un secondo dispositivo con un'altra passphrase entra con un invito:
    //    la chiave del servizio non si apre da lì, quella accettata sì.
    let (_secrets_dir, secrets) = utf8_dir();
    owner_only(&secrets.join("invite-passphrase"), PASSPHRASE_B);
    // SAFETY: vedi `set_passphrase`.
    unsafe {
        std::env::set_var(
            "FUB_SYNC_INVITE_PASSPHRASE_FILE",
            secrets.join("invite-passphrase").as_str(),
        )
    };
    let invite = a
        .job(serde_json::json!({"op": "invite", "role": "writer"}))
        .expect("invite");
    unsafe { std::env::remove_var("FUB_SYNC_INVITE_PASSPHRASE_FILE") };
    owner_only(
        &secrets.join("invite-token"),
        invite["token_b64"].as_str().expect("token"),
    );
    // SAFETY: vedi `set_passphrase`.
    unsafe {
        std::env::set_var(
            "FUB_SYNC_INVITE_TOKEN_FILE",
            secrets.join("invite-token").as_str(),
        )
    };
    set_passphrase(PASSPHRASE_B);
    let b = Device::new(&network, &token, &[]);
    let accepted = b.job(serde_json::json!({"op": "accept"})).expect("accept");
    assert_eq!(accepted["key_epoch"], 1);
    b.pass("the invited device pulls with the accepted key");
    assert_eq!(
        std::fs::read_to_string(b.vault.join("Prima.md")).unwrap(),
        "# Prima, di nuovo\n"
    );

    // 3. Rekey dal secondo dispositivo, poi un passaggio: i nuovi op si
    //    aprono con la chiave nuova, non con quella dell'invito.
    let rekeyed = b.job(serde_json::json!({"op": "rekey"})).expect("rekey");
    assert_eq!(rekeyed["key_epoch"], 2);
    b.write("Dopo.md", "# Dopo il rekey\n");
    b.pass("the pass after a rekey succeeds");
    assert_eq!(b.state("key-epoch").as_deref(), Some("2"));
    let (epoch, vdk_new) = served_key(&network, &auth, &vault_id, PASSPHRASE_B);
    assert_eq!(epoch, 2);
    assert_ne!(vdk_new, vdk_a, "the rekey made a fresh key");
    let (sealed_at, plain) = open_last_push(&network, "Dopo.md", &vdk_new);
    assert_eq!(sealed_at, 2);
    assert_eq!(
        plain.as_deref(),
        Ok("# Dopo il rekey\n".as_bytes()),
        "a note written after the rekey is sealed with the new key"
    );
    let (_, old) = open_last_push(&network, "Dopo.md", &vdk_a);
    assert!(old.is_err(), "the revoked key no longer opens new notes");
    b.pass("a second pass after the rekey also works");
}
