//! Le letture a pezzi di `fub.craft` (`craft::ranged`) su un vault vero.
//!
//! La revisione di un file letto intero è la stessa di `document_revision`;
//! un file cambiato fra due pezzi è `Stale`; la memoria delle revisioni non
//! si fida di peso e data; il vault chiuso spegne un file aperto; un
//! `craft.preview` mentre un altro thread scrive nel vault non si ferma; e
//! nessun byte dei file cambia.

#![cfg(feature = "craft")]

use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_format_craft::{CraftPreview, PreviewOrigin, PREVIEW_COMMAND};
use fub_host::craft::ranged::{is_stale, Ranged, RangedError, CHUNK_BYTES};
use fub_host::Host;
use fub_kernel::{FormatRegistry, Workspace};

fn vault(files: &[(&str, Vec<u8>)]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (path, bytes) in files {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    (dir, root)
}

fn workspace(root: &Utf8Path) -> (Workspace, Ranged) {
    let ws = Workspace::new(root, FormatRegistry::new()).unwrap();
    let ranged = Ranged::new(ws.resource_reader());
    (ws, ranged)
}

/// Byte che non si ripetono a ogni pezzo: uno scambio di pezzi si vedrebbe.
fn pattern(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 31 % 251) as u8).collect()
}

const BIG: u64 = 64 * 1024 * 1024;

#[test]
fn read_all_and_revision_give_the_revision_of_the_kernel() {
    let long = pattern(CHUNK_BYTES * 2 + 17);
    let (_dir, root) = vault(&[
        ("vuoto.bin", Vec::new()),
        ("corto.bin", b"tre".to_vec()),
        ("Lungo/lungo.bin", long.clone()),
    ]);
    let (ws, ranged) = workspace(&root);
    for (name, bytes) in [
        ("vuoto.bin", Vec::new()),
        ("corto.bin", b"tre".to_vec()),
        ("Lungo/lungo.bin", long),
    ] {
        let doc = DocId::new(name);
        let kernel = ws.document_revision(&doc).unwrap();
        let whole = ranged.read_all(&doc, BIG).unwrap();
        assert_eq!(whole.bytes, bytes, "{name}");
        assert_eq!(whole.revision, kernel, "{name}");
        assert_eq!(ranged.revision(&doc, BIG).unwrap(), kernel, "{name}");
        // La seconda volta risponde la memoria, con la stessa revisione.
        assert_eq!(ranged.revision(&doc, BIG).unwrap(), kernel, "{name}");
    }
}

#[test]
fn over_the_limit_nothing_is_read() {
    let (_dir, root) = vault(&[("a.bin", pattern(100))]);
    let (_ws, ranged) = workspace(&root);
    let doc = DocId::new("a.bin");
    let mut file = ranged.open(&doc).unwrap();
    let error = file.read_whole(99).unwrap_err();
    assert!(
        matches!(
            error,
            RangedError::OverLimit {
                bytes: 100,
                limit: 99
            }
        ),
        "{error:?}"
    );
    assert_eq!(file.bytes_read(), 0);
    assert!(matches!(
        ranged.revision(&doc, 99),
        Err(RangedError::OverLimit { .. })
    ));
}

#[test]
fn a_ranged_file_reads_seeks_and_ends_with_a_short_piece() {
    let bytes = pattern(CHUNK_BYTES + 10);
    let (_dir, root) = vault(&[("a.bin", bytes.clone())]);
    let (_ws, ranged) = workspace(&root);
    let mut file = ranged.open(&DocId::new("a.bin")).unwrap();
    assert_eq!(file.len(), bytes.len() as u64);
    let mut all = Vec::new();
    file.read_to_end(&mut all).unwrap();
    assert_eq!(all, bytes);
    // Due pezzi: uno intero e l'ultimo, più corto del chiesto.
    assert_eq!(file.bytes_read(), bytes.len() as u64);

    // Indietro dalla fine, dentro l'ultimo pezzo.
    file.seek(SeekFrom::End(-4)).unwrap();
    let mut tail = [0u8; 8];
    let n = file.read(&mut tail).unwrap();
    assert_eq!(&tail[..n], &bytes[bytes.len() - 4..]);
    // Oltre la fine si va, e non si legge niente.
    assert_eq!(
        file.seek(SeekFrom::End(100)).unwrap(),
        bytes.len() as u64 + 100
    );
    assert_eq!(file.read(&mut tail).unwrap(), 0);
    // Prima dell'inizio no.
    file.seek(SeekFrom::Start(0)).unwrap();
    assert!(file.seek(SeekFrom::Current(-1)).is_err());
}

#[test]
fn an_empty_file_reads_nothing() {
    let (_dir, root) = vault(&[("vuoto.bin", Vec::new())]);
    let (_ws, ranged) = workspace(&root);
    let mut file = ranged.open(&DocId::new("vuoto.bin")).unwrap();
    assert!(file.is_empty());
    let mut out = Vec::new();
    assert_eq!(file.read_to_end(&mut out).unwrap(), 0);
    assert_eq!(file.bytes_read(), 0);
}

#[test]
fn a_file_rewritten_while_open_makes_the_next_piece_stale() {
    let (_dir, root) = vault(&[("a.bin", pattern(CHUNK_BYTES * 2))]);
    let (_ws, ranged) = workspace(&root);
    let mut file = ranged.open(&DocId::new("a.bin")).unwrap();
    let mut head = [0u8; 16];
    file.read_exact(&mut head).unwrap();
    std::fs::write(root.join("a.bin"), pattern(CHUNK_BYTES * 2 + 1)).unwrap();
    file.seek(SeekFrom::Start(CHUNK_BYTES as u64)).unwrap();
    let error = file.read(&mut head).unwrap_err();
    assert!(is_stale(&error), "{error:?}");
    // E il file intero, con la stessa lease, non dà byte misti.
    let mut again = ranged.open(&DocId::new("a.bin")).unwrap();
    std::fs::write(root.join("a.bin"), pattern(CHUNK_BYTES * 3)).unwrap();
    assert!(matches!(again.read_whole(BIG), Err(RangedError::Stale)));
}

#[test]
fn the_remembered_revision_does_not_trust_size_and_date() {
    let (_dir, root) = vault(&[("a.bin", b"AAAAAAAA".to_vec())]);
    let (ws, ranged) = workspace(&root);
    let doc = DocId::new("a.bin");
    let path = root.join("a.bin");
    let first = ranged.revision(&doc, BIG).unwrap();
    let modified = std::fs::metadata(&path).unwrap().modified().unwrap();
    // Stesso peso, stessa data, sullo stesso file: resta il timbro di
    // cambiamento, che è nuovo.
    std::fs::write(&path, b"BBBBBBBB").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        modified
    );
    let second = ranged.revision(&doc, BIG).unwrap();
    assert_ne!(second, first);
    assert_eq!(second, ws.document_revision(&doc).unwrap());
}

#[test]
fn a_closed_vault_stops_an_open_ranged_file_without_panic() {
    let (_dir, root) = vault(&[("a.bin", pattern(CHUNK_BYTES * 2))]);
    let (mut ws, ranged) = workspace(&root);
    let mut file = ranged.open(&DocId::new("a.bin")).unwrap();
    let mut head = [0u8; 16];
    file.read_exact(&mut head).unwrap();
    assert!(ws.close().is_empty());
    file.seek(SeekFrom::Start(CHUNK_BYTES as u64)).unwrap();
    let error = file.read(&mut head).unwrap_err();
    assert!(!is_stale(&error), "{error:?}");
    assert!(matches!(
        ranged.read_all(&DocId::new("a.bin"), BIG),
        Err(RangedError::Kernel(_))
    ));
}

#[test]
fn a_file_beyond_four_gib_seeks_at_u64_offsets() {
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
        use std::io::Write;
        let mut file = file;
        file.seek(SeekFrom::Start(size - 4)).unwrap();
        file.write_all(b"FINE").unwrap();
    }
    let (_ws, ranged) = workspace(&root);
    let doc = DocId::new("grande.bin");
    let mut file = ranged.open(&doc).unwrap();
    assert_eq!(file.len(), size);
    file.seek(SeekFrom::Start(size - 4)).unwrap();
    let mut tail = Vec::new();
    file.read_to_end(&mut tail).unwrap();
    assert_eq!(tail, b"FINE");
    assert_eq!(file.bytes_read(), 4);
    // Intero non si legge: oltre il tetto, senza un byte.
    assert!(matches!(
        ranged.read_all(&doc, BIG),
        Err(RangedError::OverLimit { bytes, .. }) if bytes == size
    ));
}

/// Un `.vectorcraft` con un'anteprima PNG minima dentro.
fn vectorcraft() -> Vec<u8> {
    use base64::Engine as _;
    let mut png = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    png.extend_from_slice(&13u32.to_be_bytes());
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&64u32.to_be_bytes());
    png.extend_from_slice(&32u32.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    png.extend_from_slice(&0u32.to_be_bytes());
    png.extend_from_slice(b"IEND");
    png.extend_from_slice(&[0, 0, 0, 0]);
    serde_json::to_vec(&serde_json::json!({
        "format_version": 4,
        "title": "Logo",
        "preview": { "data": base64::engine::general_purpose::STANDARD.encode(png) },
    }))
    .unwrap()
}

fn ask(host: &Host, root: &Utf8Path, doc: &str) -> Result<CraftPreview, PluginError> {
    let outcome = host.invoke_user_command(
        Some(root.as_str()),
        PREVIEW_COMMAND,
        serde_json::json!({ "doc": doc, "size": "small" }),
        InvokeMode::Apply,
    )?;
    match outcome.effect {
        CommandEffect::Custom { payload, .. } => Ok(serde_json::from_value(payload).unwrap()),
        other => panic!("{other:?}"),
    }
}

/// Il comando legge a pezzi senza prendere il lucchetto del workspace: con un
/// altro thread che scrive nel vault (dall'host, che prende il lucchetto in
/// scrittura, e da fuori, sul file stesso dell'anteprima) le anteprime
/// finiscono. Dieci secondi sono molti più di quanti ne servono a 40
/// anteprime di un file piccolo anche su una macchina carica, e molti meno di
/// un timeout di nextest: uno stallo si vede qui, come errore del test.
#[test]
fn a_preview_while_another_thread_writes_does_not_stall() {
    let (_dir, root) = vault(&[
        ("Disegni/logo.vectorcraft", vectorcraft()),
        ("Disegni/mobile.vectorcraft", vectorcraft()),
        ("Foto/a.CR3", b"RAW finto".to_vec()),
    ]);
    let host = std::sync::Arc::new(Host::without_watcher());
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let before = std::fs::read(root.join("Disegni/logo.vectorcraft")).unwrap();
    let photo = std::fs::read(root.join("Foto/a.CR3")).unwrap();
    // La revisione dei byte con la formula del kernel, senza aprire un
    // secondo workspace sul vault dell'host.
    let kernel = {
        let mut hasher = fub_abi::RevisionHasher::new();
        hasher.update(&before);
        hasher.finish()
    };
    // Il comando passa davvero dalle lease: una foto RAW non si legge, e la
    // risposta non ha revisione (dall'host l'avrebbe).
    let raw = ask(&host, &root, "Foto/a.CR3").unwrap();
    assert_eq!(raw.revision, None);
    assert_eq!(raw.info.bytes, b"RAW finto".len() as u64);

    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let writer = {
        let (host, root, stop) = (host.clone(), root.clone(), stop.clone());
        std::thread::spawn(move || {
            let mut i = 0u32;
            while !stop.load(std::sync::atomic::Ordering::Acquire) {
                let id = DocId::new(format!("Scritti/n{i}.bin"));
                host.write_document_bytes(Some(root.as_str()), &id, b"nuovo", None)
                    .unwrap();
                // Il file dell'anteprima cambia da fuori: peso nuovo a ogni giro.
                let mut moving = vectorcraft();
                moving.extend(std::iter::repeat_n(b' ', (i % 7) as usize));
                std::fs::write(root.join("Disegni/mobile.vectorcraft"), moving).unwrap();
                i += 1;
            }
            i
        })
    };

    let (sent, got) = std::sync::mpsc::channel();
    let asker = {
        let (host, root) = (host.clone(), root.clone());
        std::thread::spawn(move || {
            for _ in 0..20 {
                let out = ask(&host, &root, "Disegni/logo.vectorcraft");
                let moving = ask(&host, &root, "Disegni/mobile.vectorcraft");
                if sent.send((out, moving)).is_err() {
                    return;
                }
            }
        })
    };
    for _ in 0..20 {
        let (out, moving) = got
            .recv_timeout(Duration::from_secs(10))
            .expect("un'anteprima entro 10 s");
        let out = out.unwrap();
        assert_eq!(out.origin, PreviewOrigin::File);
        assert_eq!(out.revision.as_ref(), Some(&kernel));
        // Un file che cambia a ogni lettura può dire che cambia: mai byte
        // misti, mai uno stallo.
        match moving {
            Ok(preview) => assert_eq!(preview.origin, PreviewOrigin::File),
            Err(error) => assert!(
                matches!(error, PluginError::Conflict(_) | PluginError::NotFound(_)),
                "{error:?}"
            ),
        }
    }
    stop.store(true, std::sync::atomic::Ordering::Release);
    asker.join().unwrap();
    assert!(writer.join().unwrap() > 0);
    assert_eq!(
        std::fs::read(root.join("Disegni/logo.vectorcraft")).unwrap(),
        before,
        "Fub non scrive i file Craft"
    );
    assert_eq!(std::fs::read(root.join("Foto/a.CR3")).unwrap(), photo);
}
