//! La domanda «c'è già questo contenuto nel vault?» dall'host: il vault aperto
//! risponde con il file che ha quei byte, anche con un altro nome, e dice di no
//! quando nessun file li ha. I casi di dettaglio (limiti, cestino, collegamenti)
//! stanno nei test del kernel, `fub-kernel/tests/same_content.rs`.

use camino::Utf8PathBuf;
use fub_abi::model::DocId;
use fub_host::resources::{ResourceReuse, ResourceWrite, ResourceWriteReceipt};
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
        host.same_content(
            Some(root.as_str()),
            &DocId::new("Arrivi/nuova.md"),
            b"# Titolo\n"
        )
        .unwrap(),
        found
    );
    // Il vault corrente (`None`) risponde come quello nominato.
    assert_eq!(
        host.same_content(None, &DocId::new("Arrivi/nuova.md"), b"# Titolo\n")
            .unwrap(),
        found
    );
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
        host.same_content(
            Some(root.as_str()),
            &DocId::new("Arrivi/nuova.md"),
            b"# Titolo\n"
        )
        .unwrap(),
        SameContent::Found {
            id: DocId::new("Note/originale.md"),
        }
    );
    assert_eq!(
        host.same_content(
            Some(root.as_str()),
            &DocId::new("Arrivi/nuova.md"),
            b"# Titolx\n"
        )
        .unwrap(),
        SameContent::NotFound
    );
}

/// Un deposito di un file nuovo, con o senza riuso (D-3 (b)): la ricevuta.
fn deposit(
    host: &Host,
    root: &Utf8PathBuf,
    id: &str,
    bytes: &[u8],
    reuse: ResourceReuse,
) -> ResourceWriteReceipt {
    host.resource_write(Some(root.as_str()), &DocId::new(id), bytes, None, reuse)
        .unwrap()
}

#[test]
fn a_file_deposited_in_the_session_is_found_the_second_time() {
    let (_dir, root) = vault(&[("Note/nota.md", b"# Nota\n")]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let png = b"\x89PNG\r\n\x1a\nuna foto depositata adesso";

    // La prima volta il vault non ha questi byte: si scrive.
    let first = deposit(
        &host,
        &root,
        "attachments/foto.png",
        png,
        ResourceReuse::SameContent,
    );
    assert!(!first.reused, "{first:?}");
    assert_eq!(first.id, DocId::new("attachments/foto.png"));

    // La seconda, nella stessa sessione, l'indice vivo lo conosce già: niente
    // `foto 1.png`.
    let second = deposit(
        &host,
        &root,
        "attachments/foto 1.png",
        png,
        ResourceReuse::SameContent,
    );
    assert!(second.reused, "{second:?}");
    assert_eq!(second.id, DocId::new("attachments/foto.png"));
    assert!(!root.join("attachments/foto 1.png").exists());
}

#[test]
fn only_a_file_of_the_same_type_is_the_same_content() {
    let (_dir, root) = vault(&[("vuota.md", b""), ("nota.md", b"ciao\n")]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    // Il controllo positivo: stessa estensione, maiuscole a parte, si ritrova.
    let same_type = deposit(
        &host,
        &root,
        "copia.MD",
        b"ciao\n",
        ResourceReuse::SameContent,
    );
    assert!(same_type.reused, "{same_type:?}");
    assert_eq!(same_type.id, DocId::new("nota.md"));

    // Un `.txt` con i byte di una nota non è quella nota.
    let txt = deposit(
        &host,
        &root,
        "nota.txt",
        b"ciao\n",
        ResourceReuse::SameContent,
    );
    assert!(!txt.reused, "{txt:?}");
    assert_eq!(txt.id, DocId::new("nota.txt"));

    // Un file vuoto non si ritrova mai, nemmeno fra quelli del suo tipo.
    let csv = deposit(&host, &root, "dati.csv", b"", ResourceReuse::SameContent);
    assert!(!csv.reused, "{csv:?}");
    assert_eq!(csv.id, DocId::new("dati.csv"));
    let empty_md = deposit(&host, &root, "altra.md", b"", ResourceReuse::SameContent);
    assert!(!empty_md.reused, "{empty_md:?}");
}
