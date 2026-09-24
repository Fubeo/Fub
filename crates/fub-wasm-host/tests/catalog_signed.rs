//! Il catalogo firmato attraversa verifica, installazione, aggiornamento e
//! revoca con un feed locale firmato: nessuna rete, nessun endpoint inventato.

mod common;

use std::collections::BTreeSet;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use camino::Utf8Path;
use fub_abi::command::InvokeMode;
use fub_abi::edit::Revision;
use fub_abi::PluginError;
use fub_host::{Host, StartupSource};
use fub_wasm_host::catalog::{
    canonical_payload, verify_feed, CatalogEntry, CatalogError, CatalogKind, CatalogPayload,
    CatalogTrust, SignedFeed,
};
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::InstalledPluginManager;
use ring::rand::SystemRandom;
use ring::signature::{Ed25519KeyPair, KeyPair};

fn root(dir: &tempfile::TempDir) -> &Utf8Path {
    Utf8Path::from_path(dir.path()).unwrap()
}

struct Authority {
    trust: CatalogTrust,
    key_pair: Ed25519KeyPair,
    key_id: String,
}

fn authority() -> Authority {
    let rng = SystemRandom::new();
    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).expect("chiave di prova");
    let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("chiave rileggibile");
    let public_b64 = B64.encode(key_pair.public_key().as_ref());
    let trust = CatalogTrust::default()
        .with_key("prova-1", &public_b64)
        .expect("chiave valida");
    Authority {
        trust,
        key_pair,
        key_id: "prova-1".to_string(),
    }
}

fn entry_for(id: &str, version: &str, bytes: &[u8]) -> CatalogEntry {
    CatalogEntry {
        id: id.to_string(),
        kind: CatalogKind::Plugin,
        name: format!("Prova {id}"),
        version: version.to_string(),
        abi: fub_abi::traits::ABI_VERSION.to_string(),
        url: format!("file://locale/{id}-{version}.wasm"),
        digest: Revision::of_bytes(bytes),
        size: bytes.len() as u64,
        permissions: BTreeSet::from(["fub:read-vault".to_string()]),
        license: "MIT".to_string(),
        compatible: ">=0.1,<0.3".to_string(),
        provenance: "prova".to_string(),
        revoked: false,
    }
}

fn sign(authority: &Authority, payload: &CatalogPayload) -> SignedFeed {
    let bytes = canonical_payload(payload);
    let signature = B64.encode(authority.key_pair.sign(&bytes).as_ref());
    SignedFeed {
        payload: bytes,
        signature,
        key_id: authority.key_id.clone(),
    }
}

fn payload(entries: Vec<CatalogEntry>) -> CatalogPayload {
    CatalogPayload {
        generation: 1,
        expires_at: u64::MAX,
        entries,
    }
}

#[test]
fn signed_local_feed_verifies_and_rejects_tampering_staleness_and_expiry() {
    let authority = authority();
    let bytes = std::fs::read(common::ping("")).expect("ping di prova");
    let feed = sign(
        &authority,
        &payload(vec![entry_for("demo.ping", "0.1.0", &bytes)]),
    );
    let verified =
        verify_feed(&authority.trust, &feed, 1_700_000_000_000).expect("feed locale firmato");
    assert_eq!(verified.generation, 1);
    assert_eq!(verified.entries.len(), 1);
    assert_eq!(verified.entries[0].id, "demo.ping");

    let mut tampered = feed.clone();
    let last = tampered.payload.len() - 1;
    tampered.payload[last] ^= 0x01;
    assert!(
        verify_feed(&authority.trust, &tampered, 0).is_err(),
        "un byte manomesso invalida la firma, non il payload"
    );

    let mut unknown_key = feed.clone();
    unknown_key.key_id = "sconosciuta".to_string();
    assert!(
        verify_feed(&authority.trust, &unknown_key, 0).is_err(),
        "chiave non attendibile non verifica"
    );

    let trust_old = CatalogTrust {
        min_generation: 2,
        ..authority.trust.clone()
    };
    assert!(
        verify_feed(&trust_old, &feed, 0).is_err(),
        "generazione inferiore al minimo è anti-rollback"
    );

    let expired = sign(
        &authority,
        &CatalogPayload {
            generation: 1,
            expires_at: 1,
            entries: vec![entry_for("demo.ping", "0.1.0", &bytes)],
        },
    );
    assert!(
        verify_feed(&authority.trust, &expired, 2).is_err(),
        "feed scaduto non si usa"
    );
    let unsupported = sign(
        &authority,
        &CatalogPayload {
            generation: 1,
            expires_at: u64::MAX,
            entries: vec![],
        },
    );
    let mut future = unsupported.clone();
    future.payload = unsupported
        .payload
        .windows(b"\"schema\":1".len())
        .position(|window| window == b"\"schema\":1")
        .map(|at| {
            let mut bytes = unsupported.payload.clone();
            bytes.splice(
                at..at + b"\"schema\":1".len(),
                b"\"schema\":2".iter().copied(),
            );
            bytes
        })
        .expect("canonical payload includes schema");
    future.signature = B64.encode(authority.key_pair.sign(&future.payload).as_ref());
    assert!(matches!(
        verify_feed(&authority.trust, &future, 0),
        Err(CatalogError::Unreadable(_))
    ));
}

#[test]
fn catalog_manager_requires_signed_entries_for_install_update_rollback_and_revoke() {
    let dir = tempfile::tempdir().unwrap();
    let manager = Arc::new(InstalledPluginManager::open(root(&dir)).unwrap());
    let vault = tempfile::tempdir().unwrap();
    let vault_root = root(&vault);
    std::fs::write(vault_root.join("Nota.md"), "# Nota\n").unwrap();
    let source: Arc<dyn StartupSource> = manager.clone();
    let host = Host::without_watcher()
        .with_job_threads(1)
        .with_startup_source(source);
    host.open(vault_root).unwrap();
    host.wait_indexed(None).unwrap();
    let authority = authority();
    let first_bytes = std::fs::read(common::ping("")).expect("prima release");
    let first = entry_for("demo.ping", "0.1.0", &first_bytes);
    let next_bytes = std::fs::read(common::ping("versione-successiva")).expect("release dopo");
    let next = entry_for("demo.ping", "0.2.0", &next_bytes);
    let signed = sign(&authority, &payload(vec![first.clone(), next.clone()]));
    assert_eq!(
        manager
            .catalog_search(&authority.trust, &signed, 0, "ping")
            .unwrap()
            .len(),
        2
    );

    let mut tampered = signed.clone();
    tampered.payload.push(b' ');
    assert!(matches!(
        manager.catalog_install(
            &authority.trust,
            &tampered,
            0,
            "demo.ping",
            "0.1.0",
            &first_bytes
        ),
        Err(CatalogError::Signature(_))
    ));
    let mut forged = first.clone();
    forged.permissions.clear();
    let forged_feed = sign(&authority, &payload(vec![forged]));
    assert!(matches!(
        manager.catalog_install(
            &authority.trust,
            &forged_feed,
            0,
            "demo.ping",
            "0.1.0",
            &first_bytes
        ),
        Err(CatalogError::Integrity(_))
    ));
    assert!(manager.store().snapshot().unwrap().plugins().is_empty());
    let installed = manager
        .catalog_install(
            &authority.trust,
            &signed,
            0,
            "demo.ping",
            "0.1.0",
            &first_bytes,
        )
        .expect("installazione firmata");
    assert!(!installed.enabled);
    assert_eq!(installed.consent, Consent::Undecided);
    assert_eq!(installed.catalog.as_ref().unwrap().publisher, "prova");
    assert_eq!(installed.catalog.as_ref().unwrap().generation, 1);
    let id = installed.installation;
    manager.set_enabled(&host, id, true).unwrap();
    manager.set_consent(&host, id, Consent::Granted).unwrap();
    assert!(host
        .bundles(Some(vault_root.as_str()))
        .unwrap()
        .iter()
        .any(|bundle| bundle.id == "demo.ping" && bundle.mounted));

    let mut altered = next_bytes.clone();
    altered.push(0);
    assert!(matches!(
        manager.catalog_update(&host, &authority.trust, &signed, 0, id, "0.2.0", &altered),
        Err(CatalogError::Integrity(_))
    ));
    let snapshot = manager.store().snapshot().unwrap();
    let unchanged = &snapshot.plugins()[0];
    assert_eq!(unchanged.manifest.version, "0.1.0");
    assert_eq!(unchanged.consent, Consent::Granted);
    let lock = root(&dir).join("wasm-plugins/.inventory.json.lock");
    std::fs::remove_file(&lock).expect("inventory lock exists");
    std::fs::create_dir(&lock).expect("simulate interrupted inventory publication");
    assert!(matches!(
        manager.catalog_update(
            &host,
            &authority.trust,
            &signed,
            0,
            id,
            "0.2.0",
            &next_bytes
        ),
        Err(CatalogError::Store(_))
    ));
    std::fs::remove_dir(&lock).unwrap();
    let previous = manager.store().snapshot().unwrap().plugins()[0].clone();
    assert_eq!(previous.manifest.version, "0.1.0");
    assert_eq!(previous.consent, Consent::Granted);
    assert_eq!(
        manager.store().load(&previous).unwrap().bytes(),
        first_bytes
    );

    let (updated, errors) = manager
        .catalog_update(
            &host,
            &authority.trust,
            &signed,
            0,
            id,
            "0.2.0",
            &next_bytes,
        )
        .expect("aggiornamento firmato");
    assert!(errors.is_empty());
    assert_eq!(updated.version, "0.2.0");
    assert!(updated.enabled);
    assert_eq!(updated.consent, Consent::Undecided);
    assert!(
        matches!(
            host.invoke_user_command(
                None,
                "demo.ping:conta",
                serde_json::json!({}),
                InvokeMode::Apply
            ),
            Err(PluginError::UnknownCommand(_))
        ),
        "the old provider is gone until the new release receives consent"
    );
    let (rolled_back, errors) = manager
        .catalog_rollback(
            &host,
            &authority.trust,
            &signed,
            0,
            id,
            "0.1.0",
            &first_bytes,
        )
        .expect("rollback firmato con esatti byte precedenti");
    assert!(errors.is_empty());
    assert_eq!(rolled_back.version, "0.1.0");
    assert_eq!(rolled_back.consent, Consent::Undecided);
    assert!(matches!(
        manager.catalog_rollback(
            &host,
            &authority.trust,
            &signed,
            0,
            id,
            "0.2.0",
            &first_bytes
        ),
        Err(CatalogError::Integrity(_))
    ));
    manager.set_consent(&host, id, Consent::Granted).unwrap();
    assert!(host
        .bundles(Some(vault_root.as_str()))
        .unwrap()
        .iter()
        .any(|bundle| bundle.id == "demo.ping" && bundle.mounted));
    let user_data = vault_root.join(".fub/plugins/demo.ping/authoritative.bin");
    std::fs::create_dir_all(user_data.parent().unwrap()).unwrap();
    std::fs::write(&user_data, b"dati utente").unwrap();
    assert!(matches!(
        manager.catalog_revoke(&host, &authority.trust, &signed, 0, id),
        Err(CatalogError::Unavailable(_))
    ));
    let mut revoked = first;
    revoked.revoked = true;
    let revoke_feed = sign(
        &authority,
        &CatalogPayload {
            generation: 2,
            expires_at: u64::MAX,
            entries: vec![revoked],
        },
    );
    assert!(manager
        .catalog_revoke(&host, &authority.trust, &revoke_feed, 0, id)
        .expect("revoca firmata")
        .is_empty());
    assert!(!manager.store().snapshot().unwrap().plugins()[0].enabled);
    assert!(manager.store().snapshot().unwrap().plugins()[0].revoked);
    assert_eq!(
        manager.store().snapshot().unwrap().plugins()[0]
            .revocation
            .as_ref()
            .unwrap()
            .generation,
        2
    );
    assert!(
        manager.set_enabled(&host, id, true).is_err(),
        "revoked byte cannot remount"
    );
    assert!(matches!(
        manager.catalog_update(
            &host,
            &authority.trust,
            &signed,
            0,
            id,
            "0.2.0",
            &next_bytes
        ),
        Err(CatalogError::Stale(_))
    ));
    let reopened = InstalledPluginManager::open(root(&dir)).unwrap();
    assert!(
        matches!(
            reopened.catalog_search(&authority.trust, &signed, 0, ""),
            Err(CatalogError::Stale(_))
        ),
        "signed revocation generation survives manager restart"
    );
    assert!(matches!(
        host.invoke_user_command(
            None,
            "demo.ping:conta",
            serde_json::json!({}),
            InvokeMode::Apply
        ),
        Err(PluginError::UnknownCommand(_))
    ));
    let replacement = sign(
        &authority,
        &CatalogPayload {
            generation: 3,
            expires_at: u64::MAX,
            entries: vec![next],
        },
    );
    let (recovered, diagnostics) = manager
        .catalog_update(
            &host,
            &authority.trust,
            &replacement,
            0,
            id,
            "0.2.0",
            &next_bytes,
        )
        .expect("only a newer signed release lifts the revocation");
    assert!(diagnostics.is_empty());
    assert!(!recovered.revoked);
    assert!(!recovered.enabled);
    assert_eq!(recovered.consent, Consent::Undecided);
    assert!(host.close().is_empty());
    assert_eq!(std::fs::read(&user_data).unwrap(), b"dati utente");
    assert!(matches!(
        manager.catalog_search(&authority.trust, &signed, 0, ""),
        Err(CatalogError::Stale(_))
    ));
}

#[test]
fn signed_theme_releases_cover_assets_update_and_revoke_without_erasing_user_choices() {
    let config = tempfile::tempdir().unwrap();
    let manager = InstalledPluginManager::open(root(&config)).unwrap();
    let authority = authority();
    let sample = camino::Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/theme/author/sample");
    let changed = tempfile::tempdir().unwrap();
    let newer = root(&changed).join("theme");
    std::fs::create_dir(&newer).unwrap();
    for name in [
        "manifest.json",
        "sheet-dark.css",
        "sheet-light.css",
        "skin.css",
    ] {
        std::fs::copy(sample.join(name), newer.join(name)).unwrap();
    }
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(newer.join("manifest.json")).unwrap()).unwrap();
    manifest["version"] = "1.1.0".into();
    std::fs::write(
        newer.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let entry = |source: &Utf8Path, version: &str| CatalogEntry {
        id: "org.fub.theme-bench".into(),
        kind: CatalogKind::Theme,
        name: "Theme Bench".into(),
        version: version.into(),
        abi: "theme-1".into(),
        url: format!("file://theme-bench/{version}"),
        digest: Revision(fub_host::theme::theme_tree_digest(source).unwrap()),
        size: std::fs::metadata(source.join("manifest.json"))
            .unwrap()
            .len(),
        permissions: BTreeSet::new(),
        license: "MIT".into(),
        compatible: ">=0.1".into(),
        provenance: "theme-publisher".into(),
        revoked: false,
    };
    let old_entry = entry(&sample, "1.0.0");
    let new_entry = entry(&newer, "1.1.0");
    let signed = sign(
        &authority,
        &payload(vec![old_entry.clone(), new_entry.clone()]),
    );
    let id = "org.fub.theme-bench";
    manager
        .catalog_install_theme(&authority.trust, &signed, 0, id, "1.0.0", &sample)
        .expect("signed theme installs");
    assert_eq!(
        manager
            .catalog_theme_provenance(id)
            .unwrap()
            .unwrap()
            .publisher,
        "theme-publisher"
    );
    assert!(fub_host::theme::list_themes(root(&config))
        .iter()
        .any(|theme| theme.manifest.id == id && theme.manifest.version == "1.0.0"));

    let stylesheet = newer.join("sheet-dark.css");
    let untrusted_css = std::fs::read(&stylesheet).unwrap();
    std::fs::write(
        &stylesheet,
        [untrusted_css.as_slice(), b"\n/* altered */"].concat(),
    )
    .unwrap();
    assert!(matches!(
        manager.catalog_update_theme(&authority.trust, &signed, 0, id, "1.1.0", &newer),
        Err(CatalogError::Integrity(_))
    ));
    assert!(fub_host::theme::list_themes(root(&config))
        .iter()
        .any(|theme| theme.manifest.id == id && theme.manifest.version == "1.0.0"));
    std::fs::write(&stylesheet, untrusted_css).unwrap();
    manager
        .catalog_update_theme(&authority.trust, &signed, 0, id, "1.1.0", &newer)
        .expect("signed theme update");
    assert!(fub_host::theme::list_themes(root(&config))
        .iter()
        .any(|theme| theme.manifest.id == id && theme.manifest.version == "1.1.0"));
    manager
        .catalog_rollback_theme(&authority.trust, &signed, 0, id, "1.0.0", &sample)
        .expect("explicit signed theme rollback");
    assert!(fub_host::theme::list_themes(root(&config))
        .iter()
        .any(|theme| theme.manifest.id == id && theme.manifest.version == "1.0.0"));

    let user_choice = root(&config).join("theme-choice.txt");
    std::fs::write(&user_choice, id).unwrap();
    let mut revoked = old_entry;
    revoked.revoked = true;
    let revocation = sign(
        &authority,
        &CatalogPayload {
            generation: 2,
            expires_at: u64::MAX,
            entries: vec![revoked],
        },
    );
    manager
        .catalog_revoke_theme(&authority.trust, &revocation, 0, id)
        .expect("signed theme revocation");
    assert!(!fub_host::theme::list_themes(root(&config))
        .iter()
        .any(|theme| theme.manifest.id == id));
    assert!(manager.catalog_theme_revoked(id).unwrap());
    assert_eq!(
        manager
            .catalog_theme_revocation(id)
            .unwrap()
            .unwrap()
            .generation,
        2
    );
    assert!(matches!(
        manager.catalog_update_theme(&authority.trust, &signed, 0, id, "1.1.0", &newer),
        Err(CatalogError::Stale(_))
    ));
    let replacement = sign(
        &authority,
        &CatalogPayload {
            generation: 3,
            expires_at: u64::MAX,
            entries: vec![new_entry],
        },
    );
    manager
        .catalog_update_theme(&authority.trust, &replacement, 0, id, "1.1.0", &newer)
        .expect("newer signed theme release lifts revocation");
    assert!(fub_host::theme::list_themes(root(&config))
        .iter()
        .any(|theme| theme.manifest.id == id && theme.manifest.version == "1.1.0"));
    assert!(!manager.catalog_theme_revoked(id).unwrap());
    assert_eq!(std::fs::read_to_string(user_choice).unwrap(), id);
}
