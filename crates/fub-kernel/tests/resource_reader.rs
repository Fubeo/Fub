//! Il lettore delle lease fuori dal workspace ([`ResourceReader`]).
//!
//! Le recinzioni sono quelle di `prepare_resource_open` e
//! `prepare_resource_read`: un nome che risale, un collegamento che esce dal
//! vault e una lease di un altro vault non si leggono; un file cambiato fra
//! due pezzi, sostituito da uno dello stesso peso e della stessa data o
//! cancellato è `Stale` o un errore, mai byte misti. Chiuso il vault, il
//! lettore non legge più.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_kernel::workspace::ResourceReader;
use fub_kernel::{FormatRegistry, KernelError, Workspace};

fn vault(files: &[(&str, &[u8])]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("la cartella del vault");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("un path UTF-8");
    for (path, bytes) in files {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().expect("una cartella")).expect("la cartella");
        std::fs::write(path, bytes).expect("il file");
    }
    (dir, root)
}

fn workspace(root: &Utf8Path) -> Workspace {
    Workspace::new(root, FormatRegistry::new()).expect("l'apertura del vault")
}

fn reader(root: &Utf8Path) -> (Workspace, ResourceReader) {
    let ws = workspace(root);
    let reader = ws.resource_reader();
    (ws, reader)
}

#[test]
fn a_lease_reads_pieces_like_the_workspace() {
    let (_dir, root) = vault(&[("Foto/a.bin", b"0123456789")]);
    let (ws, reader) = reader(&root);
    let doc = DocId::new("Foto/a.bin");
    let lease = reader.open(&doc).expect("la lease");
    assert_eq!(lease.stat.size, 10);
    assert_eq!(lease.revision, None, "mai un'impronta all'apertura");
    assert_eq!(reader.read_at(&lease, 2, 3).unwrap(), b"234");
    // L'ultimo pezzo è più corto del chiesto, oltre la fine è vuoto.
    assert_eq!(reader.read_at(&lease, 8, 100).unwrap(), b"89");
    assert!(reader.read_at(&lease, 10, 4).unwrap().is_empty());
    assert!(reader.read_at(&lease, u64::MAX, 4).unwrap().is_empty());
    // Gli stessi byte della via del workspace.
    assert_eq!(
        reader.read_at(&lease, 0, 10).unwrap(),
        ws.read_resource(&lease, 0, 10).unwrap()
    );
    assert_eq!(reader.root(), lease.root.as_path());
}

#[test]
fn an_empty_file_opens_and_reads_nothing() {
    let (_dir, root) = vault(&[("vuoto.bin", b"")]);
    let (_ws, reader) = reader(&root);
    let lease = reader.open(&DocId::new("vuoto.bin")).unwrap();
    assert_eq!(lease.stat.size, 0);
    assert!(reader.read_at(&lease, 0, 64).unwrap().is_empty());
}

#[test]
fn a_name_that_climbs_is_refused() {
    let (_dir, root) = vault(&[("a.bin", b"a")]);
    let (_ws, reader) = reader(&root);
    for name in ["../fuori.bin", "Foto/../../fuori.bin"] {
        let error = reader.open(&DocId::new(name)).unwrap_err();
        assert!(
            matches!(
                error,
                KernelError::BadName { .. } | KernelError::OutsideVault(_)
            ),
            "{name}: {error:?}"
        );
    }
}

#[test]
fn a_missing_file_or_a_folder_is_not_found() {
    let (_dir, root) = vault(&[("Foto/a.bin", b"a")]);
    let (_ws, reader) = reader(&root);
    for name in ["Foto/sparito.bin", "Foto"] {
        let error = reader.open(&DocId::new(name)).unwrap_err();
        assert!(
            matches!(error, KernelError::NotFound(_) | KernelError::Io { .. }),
            "{name}: {error:?}"
        );
    }
}

/// Su Unix perché il caso si costruisce con un symlink, e su Windows crearne
/// uno vuole un privilegio che un banco non ha.
#[cfg(unix)]
#[test]
fn a_link_that_leaves_the_vault_is_not_read() {
    let outside = tempfile::tempdir().unwrap();
    let secret = outside.path().join("segreto.bin");
    std::fs::write(&secret, b"segreto").unwrap();
    let (_dir, root) = vault(&[("a.bin", b"a")]);
    std::os::unix::fs::symlink(&secret, root.join("fuga.bin")).unwrap();
    std::os::unix::fs::symlink(outside.path(), root.join("Fuori")).unwrap();
    let (_ws, reader) = reader(&root);
    for name in ["fuga.bin", "Fuori/segreto.bin"] {
        match reader.open(&DocId::new(name)) {
            Err(_) => {}
            Ok(lease) => {
                let read = reader.read_at(&lease, 0, 64);
                assert!(read.is_err(), "{name}: {read:?}");
            }
        }
    }
}

#[test]
fn a_file_rewritten_between_two_pieces_is_stale() {
    let (_dir, root) = vault(&[("a.bin", b"prima versione")]);
    let (_ws, reader) = reader(&root);
    let lease = reader.open(&DocId::new("a.bin")).unwrap();
    assert_eq!(reader.read_at(&lease, 0, 5).unwrap(), b"prima");
    std::fs::write(root.join("a.bin"), b"dopo, un altro peso").unwrap();
    let error = reader.read_at(&lease, 5, 5).unwrap_err();
    assert!(matches!(error, KernelError::Stale(_)), "{error:?}");
}

#[test]
fn a_file_replaced_by_one_of_the_same_size_and_date_is_stale() {
    let (_dir, root) = vault(&[("a.bin", b"AAAAAAAA")]);
    let (_ws, reader) = reader(&root);
    let path = root.join("a.bin");
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    let lease = reader.open(&DocId::new("a.bin")).unwrap();
    assert_eq!(reader.read_at(&lease, 0, 4).unwrap(), b"AAAA");
    // Un file nuovo accanto, con lo stesso peso e la stessa data, rinominato
    // sopra: cambia l'identità, e la lease lo vede.
    let next = root.join("a.bin.nuovo");
    std::fs::write(&next, b"BBBBBBBB").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&next)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    std::fs::rename(&next, &path).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().len(), 8);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        modified
    );
    let error = reader.read_at(&lease, 4, 4).unwrap_err();
    assert!(matches!(error, KernelError::Stale(_)), "{error:?}");
}

#[test]
fn a_deleted_file_is_an_error_and_never_bytes() {
    let (_dir, root) = vault(&[("a.bin", b"ancora qui")]);
    let (_ws, reader) = reader(&root);
    let lease = reader.open(&DocId::new("a.bin")).unwrap();
    std::fs::remove_file(root.join("a.bin")).unwrap();
    assert!(reader.read_at(&lease, 0, 4).is_err());
    assert!(reader.open(&DocId::new("a.bin")).is_err());
}

#[test]
fn a_lease_of_another_vault_is_outside() {
    let (_one, first) = vault(&[("a.bin", b"primo")]);
    let (_two, second) = vault(&[("a.bin", b"secondo")]);
    let (_ws1, mine) = reader(&first);
    let (_ws2, theirs) = reader(&second);
    let foreign = theirs.open(&DocId::new("a.bin")).unwrap();
    let error = mine.read_at(&foreign, 0, 4).unwrap_err();
    assert!(matches!(error, KernelError::OutsideVault(_)), "{error:?}");
}

#[test]
fn a_closed_vault_stops_every_reader() {
    let (_dir, root) = vault(&[("a.bin", b"0123456789")]);
    let (mut ws, reader) = reader(&root);
    let lease = reader.open(&DocId::new("a.bin")).unwrap();
    assert_eq!(reader.read_at(&lease, 0, 2).unwrap(), b"01");
    let copy = reader.clone();
    assert!(ws.close().is_empty());
    for reader in [&reader, &copy] {
        let error = reader.read_at(&lease, 2, 2).unwrap_err();
        assert!(
            matches!(&error, KernelError::Io { source, .. }
                if source.kind() == std::io::ErrorKind::NotConnected),
            "{error:?}"
        );
        assert!(reader.open(&DocId::new("a.bin")).is_err());
    }
    // Un lettore preso dopo la chiusura è già spento.
    assert!(ws.resource_reader().open(&DocId::new("a.bin")).is_err());
}

#[test]
fn a_file_beyond_four_gib_reads_at_u64_offsets() {
    let (_dir, root) = vault(&[]);
    let path = root.join("grande.bin");
    let size = (4u64 << 30) + 16;
    let file = std::fs::File::create(&path).unwrap();
    // Un file sparso: se il filesystem non lo regge, il caso non si prova qui.
    if file.set_len(size).is_err() {
        eprintln!("il filesystem non regge un file sparso oltre 4 GiB: caso saltato");
        return;
    }
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut file = file;
        file.seek(SeekFrom::Start(size - 4)).unwrap();
        file.write_all(b"FINE").unwrap();
    }
    let (_ws, reader) = reader(&root);
    let lease = reader.open(&DocId::new("grande.bin")).unwrap();
    assert_eq!(lease.stat.size, size);
    assert_eq!(reader.read_at(&lease, size - 4, 64).unwrap(), b"FINE");
    assert_eq!(reader.read_at(&lease, 1 << 32, 4).unwrap(), [0, 0, 0, 0]);
}
