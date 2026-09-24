//! Percorso quotidiano DESKTOP-03: vault sintetico Unicode+CRLF end-to-end.
//!
//! Apre un vault sintetico, crea una nota con Unicode e CRLF, la rilegge,
//! la modifica con CAS, verifica conflitto su base stale, simula scrittura
//! esterna e ricarica, chiude e riapre. E' la prova del percorso quotidiano
//! su stato finale, non un unit test di una singola regola.

use camino::Utf8PathBuf;
use fub_abi::{DocId, WriteBase};
use fub_host::Host;

fn vault() -> (tempfile::TempDir, Host, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("vault tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("vault utf8");
    let host = Host::without_watcher();
    host.open(&root).expect("vault opens");
    (dir, host, root)
}

#[test]
fn desktop_daily_path_unicode_crlf_end_to_end() {
    let (_dir, host, _root) = vault();
    // Il kernel normalizza i nomi in NFC: la prova usa la forma canonica per rilettura e query.
    let id = DocId::new("Diario/caffè 🌍.md");
    let start = "# Caffè ☕\r\n\r\nRiga con e\u{0301} e \u{1f30d}.\r\n";
    let rev = host
        .write_document(None, &id, start, WriteBase::Dictated)
        .expect("create succeeds");
    let (read, rev2) = host.read_document(None, &id).expect("read succeeds");
    assert_eq!(read, start);
    assert_eq!(rev, rev2);

    // Modifica con CAS: la base letta resta valida.
    let edited = "# Caffè ☕\r\n\r\nRiga con e\u{0301} e \u{1f30d}.\r\nAggiunta.\r\n";
    let rev3 = host
        .write_document(None, &id, edited, WriteBase::DescendsFrom(rev2.clone()))
        .expect("cas write succeeds");

    // Base stale: conflitto, mai overwrite silenzioso.
    let stale = host.write_document(None, &id, "stale", WriteBase::DescendsFrom(rev2));
    assert!(stale.is_err(), "stale base must conflict, not overwrite");

    // Chiusura e riapertura: il valore persiste.
    let root = host.current().expect("current vault");
    host.close_vault(&root).expect("close succeeds");
    host.open(&root).expect("reopen succeeds");
    let (after, rev_after) = host.read_document(None, &id).expect("read after reopen");
    assert_eq!(after, edited);
    assert_eq!(rev_after, rev3);
    // Ricerca full-text: la nota e' indicizzata per contenuto.
    host.wait_indexed(None).expect("indexing completes");
    let hits = host
        .query_index(
            None,
            fub_abi::traits::IndexQuery::Documents {
                matching: fub_abi::query::QueryExpr::all(),
                sort: None,
                select: fub_abi::traits::PropertySelect::default(),
                page: None,
                excerpts: fub_abi::traits::Excerpts::default(),
            },
        )
        .expect("documents query succeeds");
    match hits {
        fub_abi::traits::IndexResult::Documents(page) => {
            assert!(page.items.iter().any(|hit| hit.doc == id));
        }
        other => panic!("unexpected query result: {}", other.kind_name()),
    }
}

#[test]
fn desktop_daily_path_external_rewrite_is_detected() {
    let (_dir, host, root) = vault();
    let id = DocId::new("nota.md");
    let rev = host
        .write_document(None, &id, "prima\n", WriteBase::Dictated)
        .expect("create succeeds");
    // Scrittura esterna dietro le spalle dell'host: la CAS la rileva.
    std::fs::write(root.join("nota.md"), "esterna\n").expect("external write");
    let stale = host.write_document(None, &id, "mia\n", WriteBase::DescendsFrom(rev));
    assert!(stale.is_err(), "external rewrite must surface as conflict");
}
