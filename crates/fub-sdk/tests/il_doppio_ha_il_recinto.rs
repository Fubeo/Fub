//! **Il doppio applica il recinto che applica l'host vero.**
//!
//! `MemoryHost` è ciò contro cui si prova una view o un provider prima che
//! esista un vault, e finché non applicava recinto affatto raccontava una
//! bugia in un modo che nessuno poteva scoprire: chi scriveva una feature la
//! vedeva accettare `../fuori.md`, `.fub/settings.json` e un nome che su
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
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::traits::{VaultRead, VaultStructure, VaultWrite};
use fub_sdk::testing::MemoryHost;

/// I nomi che l'host vero rifiuta e che il doppio deve rifiutare uguale: uno
/// che risale, uno che nomina lo spazio macchina, uno che parte da un'unità
/// Windows.
const FUORI: &[&str] = &[
    "../fuori.md",
    "note/../../fuori.md",
    ".fub/settings.json",
    ".trash/Nota.md",
    "C:/Users/x/segreto.md",
];

fn nega(esito: Result<impl std::fmt::Debug, PluginError>, dove: &str, nome: &str) {
    match esito {
        Err(PluginError::PermissionDenied(_)) => {}
        altro => panic!("`{dove}` ha accettato `{nome}`: {altro:?}"),
    }
}

#[test]
fn nessuna_lettura_del_doppio_esce_dal_recinto() {
    let host = MemoryHost::default();
    for nome in FUORI {
        let id = DocId::new(*nome);
        nega(host.read_document(&id), "read_document", nome);
        nega(host.read_document_bytes(&id), "read_document_bytes", nome);
        nega(host.document_revision(&id), "document_revision", nome);
        nega(host.read_model(&id), "read_model", nome);
    }
}

#[test]
fn nessuna_scrittura_del_doppio_esce_dal_recinto() {
    let mut host = MemoryHost::default();
    for nome in FUORI {
        let id = DocId::new(*nome);
        nega(
            host.write_document(&id, "testo", WriteBase::Dictated),
            "write_document",
            nome,
        );
        nega(host.create_document(&id, "testo"), "create_document", nome);
        nega(
            host.rename_document(&DocId::new("Nota.md"), &id),
            "rename_document (destinazione)",
            nome,
        );
        nega(
            host.rename_document(&id, &DocId::new("Nota.md")),
            "rename_document (origine)",
            nome,
        );
        nega(host.trash_document(&id), "trash_document", nome);
    }
    assert!(
        host.list_documents(None).unwrap().items.is_empty(),
        "e niente di tutto questo ha lasciato un documento in memoria"
    );
}

/// Il recinto è una domanda; la portabilità è l'altra (§15.5). Il doppio le fa
/// tutte e due dove le fa `KernelHost::create_document`, cioè su un nome che
/// **nasce** — e su nient'altro: un documento che si chiama `CON.md` perché il
/// vault lo conteneva già si legge e si scrive.
#[test]
fn un_nome_che_nasce_nel_doppio_e_portabile_come_nell_host_vero() {
    let mut host = MemoryHost::default();

    let err = host
        .create_document(&DocId::new("CON.md"), "la console")
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");
    let err = host
        .create_document(&DocId::new(".nascosta/Nota.md"), "invisibile")
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");

    // Ma leggere e scrivere un nome che il vault contiene già non è una nascita.
    host.write_document(
        &DocId::new("CON.md"),
        "arrivato da un import",
        WriteBase::Dictated,
    )
    .expect("il recinto passa: `CON.md` sta dentro il vault");
    assert_eq!(
        host.read_document(&DocId::new("CON.md")).unwrap(),
        "arrivato da un import"
    );
}

/// Il ripristino: `entry` nomina una voce dentro `.trash/`, che il recinto dei
/// documenti rifiuta apposta — a validarlo è la ricerca fra le voci che ci
/// sono. Il `to`, che atterra nel vault, è un nome che nasce.
#[test]
fn il_ripristino_del_doppio_chiede_al_cestino_e_al_recinto() {
    let mut host = MemoryHost::default();
    host.create_document(&DocId::new("Idea.md"), "un'idea")
        .unwrap();
    let cestinata = host.trash_document(&DocId::new("Idea.md")).unwrap();

    nega(
        host.restore_document(&cestinata, Some(DocId::new("../fuori.md"))),
        "restore_document (to)",
        "../fuori.md",
    );
    let err = host
        .restore_document(&cestinata, Some(DocId::new(".nascosta/Idea.md")))
        .unwrap_err();
    assert!(matches!(err, PluginError::BadArgs(_)), "{err:?}");

    // E la voce è ancora nel cestino: nessuno dei due rifiuti l'ha consumata.
    let tornata = host.restore_document(&cestinata, None).unwrap();
    assert_eq!(tornata, DocId::new("Idea.md"));
}
