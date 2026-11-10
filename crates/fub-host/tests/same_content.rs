//! La domanda «c'è già questo contenuto nel vault?» dall'host: il vault aperto
//! risponde con il file che ha quei byte, anche con un altro nome, e dice di no
//! quando nessun file li ha. I casi di dettaglio (limiti, cestino, collegamenti)
//! stanno nei test del kernel, `fub-kernel/tests/same_content.rs`.

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_host::Host;
use fub_kernel::same_content::SameContent;

fn vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    for (rel, bytes) in files {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    (dir, root)
}

#[test]
fn the_open_vault_finds_the_same_bytes_under_another_name() {
    let (_dir, root) = vault(&[
        ("Note/originale.md", b"# Titolo\n"),
        ("Scritti/altro.md", b"# Altro, piu lungo\n"),
    ]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    let found = SameContent::Found {
        id: DocId::new("Note/originale.md"),
    };
    assert_eq!(
        host.same_content(Some(root.as_str()), b"# Titolo\n")
            .unwrap(),
        found
    );
    // Il vault corrente (`None`) risponde come quello nominato.
    assert_eq!(host.same_content(None, b"# Titolo\n").unwrap(), found);
}

#[test]
fn the_same_size_with_other_bytes_is_not_the_same_content() {
    let (_dir, root) = vault(&[("Note/originale.md", b"# Titolo\n")]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    // Il controllo positivo: i byte giusti trovano il file, così il no che segue
    // non è un no qualunque. Stessa misura di `# Titolo\n`, un carattere diverso.
    assert_eq!(
        host.same_content(Some(root.as_str()), b"# Titolo\n")
            .unwrap(),
        SameContent::Found {
            id: DocId::new("Note/originale.md"),
        }
    );
    assert_eq!(
        host.same_content(Some(root.as_str()), b"# Titolx\n")
            .unwrap(),
        SameContent::NotFound
    );
}
