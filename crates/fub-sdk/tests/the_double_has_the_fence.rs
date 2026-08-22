//! **Il doppio applica il recinto che applica l'host vero.**
//!
//! `MemoryHost` è ciò contro cui si prova una view o un provider prima che
//! esista un vault, e finché non applicava recinto affatto raccontava una
//! bugia in un modo che nessuno poteva scoprire: chi scriveva una feature la
//! vedeva accettare `../outside.md`, `.fub/settings.json` e un nome che su
//! Windows non nasce, e l'host vero la rifiutava — cioè il banco era verde e
//! l'app diceva di no. Peggio del rifiuto tardivo è che **chi scrive i banchi
//! non aveva modo di accorgersi che il proprio recinto non esisteva**: nessun
//! test poteva chiedersi «e se il path fosse ostile», perché il doppio
//! rispondeva sempre di sì. Era il difetto 0220.
//!
//! La riparazione non è una copia della regola: è la stessa funzione del
//! contratto (`path_policy::fenced_doc_id`) che chiama anche `KernelHost`. Il
//! banco quindi non riprova la regola — quella ha il suo modulo — ma che le
//! superfici del doppio la **chiedano**, una per una.

use fub_abi::edit::WriteBase;
use fub_abi::model::DocId;
use fub_abi::traits::{VaultRead, VaultStructure, VaultWrite};
use fub_abi::PluginError;
use fub_sdk::testing::MemoryHost;

/// I nomi che l'host vero rifiuta e che il doppio deve rifiutare uguale: uno
/// che risale, uno che nomina lo spazio macchina, uno che parte da un'unità
/// Windows.
const OUTSIDE: &[&str] = &[
    "../outside.md",
    "note/../../outside.md",
    ".fub/settings.json",
    ".trash/Note.md",
    "C:/Users/x/secret.md",
];

fn must_refuse(outcome: Result<impl std::fmt::Debug, PluginError>, surface: &str, name: &str) {
    match outcome {
        Err(PluginError::PermissionDenied(_)) => {}
        other => panic!("`{surface}` accepted `{name}`: {other:?}"),
    }
}

#[test]
fn no_read_of_the_double_exits_the_fence() {
    let host = MemoryHost::default();
    for name in OUTSIDE {
        let id = DocId::new(*name);
        must_refuse(host.read_document(&id), "read_document", name);
        must_refuse(host.read_document_bytes(&id), "read_document_bytes", name);
        must_refuse(host.document_revision(&id), "document_revision", name);
        must_refuse(host.read_model(&id), "read_model", name);
    }
}

#[test]
fn no_write_of_the_double_exits_the_fence() {
    let mut host = MemoryHost::default();
    for name in OUTSIDE {
        let id = DocId::new(*name);
        must_refuse(
            host.write_document(&id, "text", WriteBase::Dictated),
            "write_document",
            name,
        );
        must_refuse(host.create_document(&id, "text"), "create_document", name);
        must_refuse(
            host.rename_document(&DocId::new("Note.md"), &id),
            "rename_document (destination)",
            name,
        );
        must_refuse(
            host.rename_document(&id, &DocId::new("Note.md")),
            "rename_document (origin)",
            name,
        );
        must_refuse(host.trash_document(&id), "trash_document", name);
    }
    assert!(
        host.list_documents(None).unwrap().items.is_empty(),
        "and none of this left a document in memory"
    );
}

/// Il recinto è una domanda; la portabilità è l'altra (§15.5). Il doppio le fa
/// tutte e due dove le fa `KernelHost::create_document`, cioè su un nome che
/// **nasce** — e su nient'altro: un documento che si chiama `CON.md` perché il
/// vault lo conteneva già si legge e si scrive.
#[test]
fn a_name_born_in_the_double_is_portable_like_in_the_real_host() {
    let mut host = MemoryHost::default();

    let err = host
        .create_document(&DocId::new("CON.md"), "the console")
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");
    let err = host
        .create_document(&DocId::new(".hidden/Note.md"), "invisible")
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");

    // Ma leggere e scrivere un nome che il vault contiene già non è una nascita.
    // Ma leggere e scrivere un nome che il vault contiene già non è una nascita.
    host.write_document(
        &DocId::new("CON.md"),
        "arrived from an import",
        WriteBase::Dictated,
    )
    .expect("the fence passes: `CON.md` is inside the vault");
    assert_eq!(
        host.read_document(&DocId::new("CON.md")).unwrap(),
        "arrived from an import"
    );
}

/// Il ripristino: `entry` nomina una voce dentro `.trash/`, che il recinto dei
/// documenti rifiuta apposta — a validarlo è la ricerca fra le voci che ci
/// sono. Il `to`, che atterra nel vault, è un nome che nasce.
/// sono. Il `to`, che atterra nel vault, è un nome che nasce.
#[test]
fn the_doubles_restore_asks_the_trash_and_the_fence() {
    let mut host = MemoryHost::default();
    host.create_document(&DocId::new("Idea.md"), "an idea")
        .unwrap();
    let trashed = host.trash_document(&DocId::new("Idea.md")).unwrap();

    must_refuse(
        host.restore_document(&trashed, Some(DocId::new("../outside.md"))),
        "restore_document (to)",
        "../outside.md",
    );
    let err = host
        .restore_document(&trashed, Some(DocId::new(".hidden/Idea.md")))
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");

    // E la voce è ancora nel cestino: nessuno dei due rifiuti l'ha consumata.
    let returned = host.restore_document(&trashed, None).unwrap();
    assert_eq!(returned, DocId::new("Idea.md"));
}
