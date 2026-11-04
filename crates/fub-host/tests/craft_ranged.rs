//! Le letture a pezzi di `fub.craft` (`craft::ranged`) su un vault vero.
//!
//! La revisione di un file letto intero è la stessa di `document_revision`;
//! un file cambiato fra due pezzi è `Stale`; la memoria delle revisioni non
//! si fida di peso e data; il vault chiuso spegne un file aperto; un
//! `craft.preview` mentre un altro thread scrive nel vault non si ferma; una
//! foto RAW dà il JPEG che porta dentro, letto a pezzi, e un `.docx` di
//! 300 MiB la sua miniatura; un PDF è `absent`; e nessun byte dei file
//! cambia.

#![cfg(feature = "craft")]

use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_format_craft::{CraftPreview, Missing, PreviewOrigin, PreviewSubject, PREVIEW_COMMAND};
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
    ask_sized(host, root, doc, "small")
}

fn ask_sized(
    host: &Host,
    root: &Utf8Path,
    doc: &str,
    size: &str,
) -> Result<CraftPreview, PluginError> {
    let outcome = host.invoke_user_command(
        Some(root.as_str()),
        PREVIEW_COMMAND,
        serde_json::json!({ "doc": doc, "size": size }),
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
    let (dir, root) = vault(&[
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
    // Il comando passa davvero dalle lease: una foto RAW finta non ha
    // un'anteprima, e la risposta non ha revisione (dall'host l'avrebbe).
    let raw = ask(&host, &root, "Foto/a.CR3").unwrap();
    assert_eq!(raw.revision, None);
    assert_eq!(raw.info.bytes, b"RAW finto".len() as u64);

    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let writer = {
        let (host, root, stop) = (host.clone(), root.clone(), stop.clone());
        // Accanto al vault, sullo stesso filesystem, perché il rename regga.
        let outside = tempfile::tempdir_in(dir.path().parent().unwrap()).unwrap();
        std::thread::spawn(move || {
            let mut i = 0u32;
            while !stop.load(std::sync::atomic::Ordering::Acquire) {
                let id = DocId::new(format!("Scritti/n{i}.bin"));
                host.write_document_bytes(Some(root.as_str()), &id, b"nuovo", None)
                    .unwrap();
                // Il file dell'anteprima cambia da fuori, come lo salva un'app:
                // un file nuovo rinominato sopra, con un peso nuovo a ogni giro.
                // Un `fs::write` lo tronca prima di scriverlo, e chi lo legge
                // in quell'istante vede un file vuoto o a metà, ma intero per
                // il kernel: `unreadable`, non byte misti.
                let mut moving = vectorcraft();
                moving.extend(std::iter::repeat_n(b' ', (i % 7) as usize));
                let next = outside.path().join("mobile.vectorcraft");
                std::fs::write(&next, moving).unwrap();
                std::fs::rename(&next, root.join("Disegni/mobile.vectorcraft")).unwrap();
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

// --- Le foto RAW ------------------------------------------------------------

fn segment(marker: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0xFF, marker];
    out.extend_from_slice(&u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
    out.extend_from_slice(payload);
    out
}

/// Un JPEG base minimo di `width`×`height`, lungo almeno `pad` byte di dati.
fn jpeg(width: u16, height: u16, pad: usize) -> Vec<u8> {
    let mut sof = vec![8];
    sof.extend_from_slice(&height.to_be_bytes());
    sof.extend_from_slice(&width.to_be_bytes());
    sof.extend_from_slice(&[1, 1, 0x11, 0]);
    let mut out = vec![0xFF, 0xD8];
    out.extend_from_slice(&segment(0xC0, &sof));
    out.extend_from_slice(&segment(0xDA, &[1, 1, 0, 0, 63, 0]));
    out.extend(std::iter::repeat_n(0x55, pad));
    out.extend_from_slice(&[0xFF, 0xD9]);
    out
}

/// Un NEF finto: IFD0 con l'orientamento 6 e il JPEG grande, IFD1 con la
/// miniatura, poi i "dati del sensore". Il JPEG grande sta oltre il primo
/// pezzo, perché lo si legga davvero a pezzi.
fn nef(big: &[u8], thumb: &[u8]) -> Vec<u8> {
    let big_at = CHUNK_BYTES as u32 + 4096;
    let thumb_at = 512u32;
    let entry = |tag: u16, kind: u16, value: u32| {
        let mut out = tag.to_be_bytes().to_vec();
        out.extend_from_slice(&kind.to_be_bytes());
        out.extend_from_slice(&1u32.to_be_bytes());
        if kind == 3 {
            out.extend_from_slice(&u16::try_from(value).unwrap().to_be_bytes());
            out.extend_from_slice(&[0, 0]);
        } else {
            out.extend_from_slice(&value.to_be_bytes());
        }
        out
    };
    let mut bytes = b"MM\0\x2a\0\0\0\x08".to_vec();
    bytes.extend_from_slice(&3u16.to_be_bytes());
    bytes.extend(entry(0x0112, 3, 6));
    bytes.extend(entry(0x0201, 4, big_at));
    bytes.extend(entry(0x0202, 4, big.len() as u32));
    bytes.extend_from_slice(&100u32.to_be_bytes());
    bytes.resize(100, 0);
    bytes.extend_from_slice(&2u16.to_be_bytes());
    bytes.extend(entry(0x0201, 4, thumb_at));
    bytes.extend(entry(0x0202, 4, thumb.len() as u32));
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.resize(thumb_at as usize, 0);
    bytes.extend_from_slice(thumb);
    bytes.extend(pattern(big_at as usize - bytes.len()));
    bytes.extend_from_slice(big);
    bytes.extend(pattern(CHUNK_BYTES * 3));
    bytes
}

fn bmff(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = u32::try_from(payload.len() + 8)
        .unwrap()
        .to_be_bytes()
        .to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(payload);
    out
}

/// `THMB` o `PRVW`: 8 byte loro, la lunghezza del JPEG, 4 byte, il JPEG.
fn cr3_jpeg_box(kind: &[u8; 4], jpeg: &[u8]) -> Vec<u8> {
    let mut payload = vec![0u8; 8];
    payload.extend_from_slice(&u32::try_from(jpeg.len()).unwrap().to_be_bytes());
    payload.extend_from_slice(&[0, 0, 0, 0]);
    payload.extend_from_slice(jpeg);
    bmff(kind, &payload)
}

/// Un CR3 finto: `ftyp crx `, `moov` con la `uuid` di Canon (`CMT1` con
/// l'orientamento 6 e `THMB`), la `uuid` di `PRVW`, un `mdat`.
fn cr3(big: &[u8], thumb: &[u8]) -> Vec<u8> {
    use fub_format_craft::raw::{CR3_CANON_UUID, CR3_PREVIEW_UUID};
    let mut cmt1 = b"II\x2a\0\x08\0\0\0".to_vec();
    cmt1.extend_from_slice(&1u16.to_le_bytes());
    cmt1.extend_from_slice(&0x0112u16.to_le_bytes());
    cmt1.extend_from_slice(&3u16.to_le_bytes());
    cmt1.extend_from_slice(&1u32.to_le_bytes());
    cmt1.extend_from_slice(&[6, 0, 0, 0]);
    cmt1.extend_from_slice(&0u32.to_le_bytes());
    let mut canon = CR3_CANON_UUID.to_vec();
    canon.extend(bmff(b"CMT1", &cmt1));
    canon.extend(cr3_jpeg_box(b"THMB", thumb));
    let moov = bmff(b"moov", &bmff(b"uuid", &canon));
    let mut prvw = CR3_PREVIEW_UUID.to_vec();
    prvw.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
    prvw.extend(cr3_jpeg_box(b"PRVW", big));
    let mut ftyp = b"crx ".to_vec();
    ftyp.extend_from_slice(&[0, 0, 0, 1]);
    ftyp.extend_from_slice(b"crx isom");
    [
        bmff(b"ftyp", &ftyp),
        moov,
        bmff(b"uuid", &prvw),
        bmff(b"mdat", &pattern(CHUNK_BYTES * 3)),
    ]
    .concat()
}

/// `craft.preview` di una foto RAW, `small` e `large`: il JPEG dentro il
/// file, con l'orientamento del file, senza revisione e senza toccare un
/// byte.
#[test]
fn a_raw_photo_gives_the_jpeg_inside_it_read_in_pieces() {
    use base64::Engine as _;
    let big = jpeg(1620, 1080, 64 * 1024);
    let thumb = jpeg(160, 120, 256);
    let (_dir, root) = vault(&[
        ("Foto/a.NEF", nef(&big, &thumb)),
        ("Foto/b.CR3", cr3(&big, &thumb)),
    ]);
    let before = [
        std::fs::read(root.join("Foto/a.NEF")).unwrap(),
        std::fs::read(root.join("Foto/b.CR3")).unwrap(),
    ];
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    for doc in ["Foto/a.NEF", "Foto/b.CR3"] {
        for size in ["small", "large"] {
            let preview = ask_sized(&host, &root, doc, size).unwrap();
            let image = preview
                .image
                .unwrap_or_else(|| panic!("{doc} {size}: {:?}", preview.missing));
            assert_eq!(image.media_type, "image/jpeg", "{doc} {size}");
            // Nessuno dei due è stretto meno di 256 tranne la miniatura:
            // anche `small` prende il JPEG grande.
            assert_eq!(
                (image.width, image.height, image.orientation),
                (1620, 1080, 6),
                "{doc} {size}"
            );
            assert_eq!(
                image.data,
                base64::engine::general_purpose::STANDARD.encode(&big),
                "{doc} {size}"
            );
            assert_eq!(preview.origin, PreviewOrigin::File, "{doc} {size}");
            assert_eq!(preview.missing, None, "{doc} {size}");
            assert_eq!(preview.revision, None, "{doc} {size}");
            assert_eq!(preview.info.app, PreviewSubject::Raw, "{doc}");
            assert_eq!(preview.info.editor, "LightCraft", "{doc}");
        }
    }
    assert_eq!(std::fs::read(root.join("Foto/a.NEF")).unwrap(), before[0]);
    assert_eq!(std::fs::read(root.join("Foto/b.CR3")).unwrap(), before[1]);
}

/// Un RAW rotto è `unreadable`, uno senza JPEG `absent`: mai un errore.
#[test]
fn a_broken_raw_is_unreadable_and_one_without_a_jpeg_absent() {
    let empty = b"II\x2a\0\x08\0\0\0\0\0\0\0\0\0".to_vec();
    let looped = b"II\x2a\0\x08\0\0\0\0\0\x08\0\0\0".to_vec();
    let (_dir, root) = vault(&[("Foto/vuoto.DNG", empty), ("Foto/anello.DNG", looped)]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let absent = ask(&host, &root, "Foto/vuoto.DNG").unwrap();
    assert_eq!(absent.missing, Some(Missing::Absent));
    let broken = ask(&host, &root, "Foto/anello.DNG").unwrap();
    assert_eq!(broken.missing, Some(Missing::Unreadable));
    assert!(broken.image.is_none());
}

// --- Le anteprime lette a pezzi ------------------------------------------------

/// Un PNG minimo di `width` × `height`: firma, `IHDR`, `IEND`.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut png = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    png.extend_from_slice(&13u32.to_be_bytes());
    png.extend_from_slice(b"IHDR");
    png.extend_from_slice(&width.to_be_bytes());
    png.extend_from_slice(&height.to_be_bytes());
    png.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    png.extend_from_slice(&0u32.to_be_bytes());
    png.extend_from_slice(b"IEND");
    png.extend_from_slice(&[0, 0, 0, 0]);
    png
}

/// Il CRC-32 dello ZIP, bit per bit: pochi byte, nessuna dipendenza.
fn crc_of(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// Un `.pcraft` scritto a mano in `path`: una voce STORE di `hole` byte che
/// sul disco non ci sono (un file sparso), poi `thumb.png`, il manifesto, la
/// directory centrale e la fine.
fn sparse_pcraft(path: &Utf8Path, hole: u64, thumb: &[u8]) -> u64 {
    let manifest = br#"{"format_version":5}"#;
    sparse_zip(
        path,
        ("layers/0.bin", hole),
        &[("thumb.png", thumb), ("manifest.json", manifest)],
    )
}

/// Uno ZIP scritto a mano in `path`: la voce STORE `hole.0` di `hole.1` byte
/// che sul disco non ci sono (un file sparso), poi le voci STORE `entries`,
/// la directory centrale e la fine. Il peso del file.
fn sparse_zip(path: &Utf8Path, hole: (&str, u64), entries: &[(&str, &[u8])]) -> u64 {
    use std::io::Write;
    let mut file = std::fs::File::create(path).unwrap();
    let mut at = 0u64;
    let mut central = Vec::new();
    let mut count = 0u16;
    let mut entry = |file: &mut std::fs::File, name: &str, data: &[u8], hole: u64| {
        let size = u32::try_from(data.len() as u64 + hole).unwrap();
        let crc = if hole > 0 { 0 } else { crc_of(data) };
        let mut fixed = Vec::new();
        for half in [20u16, 0, 0, 0, 0x21] {
            fixed.extend_from_slice(&half.to_le_bytes());
        }
        for word in [crc, size, size] {
            fixed.extend_from_slice(&word.to_le_bytes());
        }
        fixed.extend_from_slice(&(name.len() as u16).to_le_bytes());
        let mut local = b"PK\x03\x04".to_vec();
        local.extend_from_slice(&fixed);
        local.extend_from_slice(&0u16.to_le_bytes());
        local.extend_from_slice(name.as_bytes());
        local.extend_from_slice(data);
        file.write_all(&local).unwrap();
        central.extend_from_slice(b"PK\x01\x02");
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&fixed);
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&u32::try_from(at).unwrap().to_le_bytes());
        central.extend_from_slice(name.as_bytes());
        at += local.len() as u64 + hole;
        file.seek(SeekFrom::Start(at)).unwrap();
        count += 1;
    };
    entry(&mut file, hole.0, b"", hole.1);
    for (name, data) in entries {
        entry(&mut file, name, data, 0);
    }
    let mut tail = central.clone();
    tail.extend_from_slice(b"PK\x05\x06\0\0\0\0");
    tail.extend_from_slice(&count.to_le_bytes());
    tail.extend_from_slice(&count.to_le_bytes());
    tail.extend_from_slice(&(central.len() as u32).to_le_bytes());
    tail.extend_from_slice(&u32::try_from(at).unwrap().to_le_bytes());
    tail.extend_from_slice(&0u16.to_le_bytes());
    file.write_all(&tail).unwrap();
    at + tail.len() as u64
}

/// Un host coi suoi settaggi di macchina in `config`, e `craft.preview-max-mib`
/// a `mib`.
fn host_with_limit(config: &Utf8Path, mib: f64) -> Host {
    let host = Host::without_watcher().with_config_dir(config);
    host.set_setting_for_user(
        None,
        fub_host::settings::CRAFT_PREVIEW_MAX_MIB,
        fub_abi::settings::SettingValue::Number(mib),
    )
    .unwrap();
    host
}

fn config_dir() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

const GIB: u64 = 1024 * 1024 * 1024;
const MIB: u64 = 1024 * 1024;

#[test]
fn a_one_gib_pcraft_gives_its_thumb_with_a_one_mib_limit() {
    let (_dir, root) = vault(&[]);
    let path = root.join("Foto/enorme.pcraft");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let len = sparse_pcraft(&path, GIB, &png(64, 48));
    let before = std::fs::metadata(&path).unwrap();
    let (_config_dir, config) = config_dir();
    let host = host_with_limit(&config, 1.0);
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    for size in ["small", "large"] {
        let preview = ask_sized(&host, &root, "Foto/enorme.pcraft", size).unwrap();
        let image = preview
            .image
            .unwrap_or_else(|| panic!("{size}: {:?}", preview.missing));
        assert_eq!((image.width, image.height), (64, 48), "{size}");
        assert_eq!(preview.origin, PreviewOrigin::File, "{size}");
        assert_eq!(preview.missing, None, "{size}");
        assert_eq!(preview.limit_bytes, None, "{size}");
        // Senza tutti i byte non c'è revisione, e niente cache.
        assert_eq!(preview.revision, None, "{size}");
        assert_eq!(preview.info.bytes, len, "{size}");
        assert_eq!(preview.info.format_version.as_deref(), Some("5"), "{size}");
    }
    let after = std::fs::metadata(&path).unwrap();
    assert_eq!(after.len(), before.len());
    assert_eq!(after.modified().unwrap(), before.modified().unwrap());
}

#[test]
fn the_one_gib_pcraft_is_read_in_under_one_mib() {
    let (_dir, root) = vault(&[]);
    let path = root.join("enorme.pcraft");
    let len = sparse_pcraft(&path, GIB, &png(64, 48));
    let (_ws, ranged) = workspace(&root);
    let mut file = ranged.open(&DocId::new("enorme.pcraft")).unwrap();
    let found = fub_format_craft::container::embedded_preview_from(
        fub_format_craft::CraftApp::PhotoCraft,
        &mut file,
        len,
        fub_format_craft::PreviewSize::Small,
        u64::MAX,
    )
    .unwrap();
    assert!(found.png.unwrap().is_some());
    // I pezzi del kernel sono di 256 KiB: la coda e le voci, non il file.
    assert!(file.bytes_read() < MIB, "{}", file.bytes_read());
}

/// Un `.vectorcraft` di 2 MiB: il JSON con l'anteprima e un riempimento.
fn heavy_vectorcraft() -> Vec<u8> {
    let mut bytes = vectorcraft();
    bytes.truncate(bytes.len() - 1);
    bytes.extend_from_slice(br#","pad":""#);
    let fill = 2 * MIB as usize - bytes.len() - 2;
    bytes.extend(std::iter::repeat_n(b'a', fill));
    bytes.extend_from_slice(b"\"}");
    assert_eq!(bytes.len() as u64, 2 * MIB);
    bytes
}

#[test]
fn a_two_mib_vectorcraft_is_over_a_one_mib_limit_and_read_under_64() {
    let file = heavy_vectorcraft();
    let (_dir, root) = vault(&[("Disegni/pesante.vectorcraft", file.clone())]);
    let (_config_dir, config) = config_dir();

    let host = host_with_limit(&config, 1.0);
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let over = ask(&host, &root, "Disegni/pesante.vectorcraft").unwrap();
    assert_eq!(over.missing, Some(Missing::OverLimit));
    assert_eq!(over.limit_bytes, Some(1_048_576));
    assert_eq!(over.info.bytes, 2 * MIB);
    assert_eq!(over.revision, None);
    assert!(over.image.is_none());
    drop(host);

    let host = host_with_limit(&config, 64.0);
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    let read = ask(&host, &root, "Disegni/pesante.vectorcraft").unwrap();
    assert_eq!(read.missing, None);
    assert_eq!(read.origin, PreviewOrigin::File);
    let image = read.image.unwrap();
    assert_eq!((image.width, image.height), (64, 32));
    // Letto intero: la revisione del kernel, come in T21.
    let kernel = {
        let mut hasher = fub_abi::RevisionHasher::new();
        hasher.update(&file);
        hasher.finish()
    };
    assert_eq!(read.revision, Some(kernel));
    assert_eq!(read.info.format_version.as_deref(), Some("4"));
    assert_eq!(
        std::fs::read(root.join("Disegni/pesante.vectorcraft")).unwrap(),
        file
    );
}

#[test]
fn a_broken_an_empty_or_a_foreign_zip_is_unreadable() {
    let (_dir, root) = vault(&[
        ("rotto.pcraft", b"non sono uno zip".to_vec()),
        ("vuoto.pcraft", Vec::new()),
        ("rotto.figcraft", b"PK\x05\x06".to_vec()),
    ]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    for doc in ["rotto.pcraft", "vuoto.pcraft", "rotto.figcraft"] {
        let preview = ask(&host, &root, doc).unwrap();
        assert_eq!(preview.missing, Some(Missing::Unreadable), "{doc}");
        assert_eq!(preview.origin, PreviewOrigin::None, "{doc}");
        assert_eq!(preview.revision, None, "{doc}");
    }
}

/// Le relazioni di un `.docx` che portano alla miniatura `target`.
fn docx_rels(target: &str) -> Vec<u8> {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="{}" Target="{target}"/></Relationships>"#,
        fub_format_craft::office::OOXML_THUMBNAIL_TYPE
    )
    .into_bytes()
}

/// Un `.docx` sparso di 300 MiB in `path`: un'immagine enorme che sul disco
/// non c'è, poi le relazioni, la miniatura e il documento. Il peso del file.
fn sparse_docx(path: &Utf8Path, thumbnail: &[u8]) -> u64 {
    let rels = docx_rels("/docProps/thumbnail.png");
    sparse_zip(
        path,
        ("word/media/grande.bin", 300 * MIB),
        &[
            ("_rels/.rels", &rels),
            ("docProps/thumbnail.png", thumbnail),
            ("word/document.xml", b"<w:document/>"),
        ],
    )
}

#[test]
fn a_sparse_300_mib_docx_gives_its_thumbnail_read_in_pieces() {
    let (_dir, root) = vault(&[]);
    let path = root.join("Documenti/Relazione.docx");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let len = sparse_docx(&path, &png(96, 128));
    let before = std::fs::metadata(&path).unwrap();
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    for size in ["small", "large"] {
        let preview = ask_sized(&host, &root, "Documenti/Relazione.docx", size).unwrap();
        let image = preview
            .image
            .unwrap_or_else(|| panic!("{size}: {:?}", preview.missing));
        assert_eq!(image.media_type, "image/png", "{size}");
        assert_eq!((image.width, image.height), (96, 128), "{size}");
        assert_eq!(preview.origin, PreviewOrigin::File, "{size}");
        assert_eq!(preview.missing, None, "{size}");
        // Senza tutti i byte non c'è revisione, e niente cache.
        assert_eq!(preview.revision, None, "{size}");
        assert_eq!(preview.info.bytes, len, "{size}");
        assert_eq!(preview.info.app, PreviewSubject::Document, "{size}");
        assert_eq!(preview.info.editor, "WordCraft", "{size}");
    }
    let after = std::fs::metadata(&path).unwrap();
    assert_eq!(after.len(), before.len());
    assert_eq!(after.modified().unwrap(), before.modified().unwrap());

    let (_ws, ranged) = workspace(&root);
    let mut file = ranged
        .open(&DocId::new("Documenti/Relazione.docx"))
        .unwrap();
    let found = fub_format_craft::office::embedded_thumbnail(&mut file, len).unwrap();
    assert!(found.is_some());
    // La coda, la directory, le relazioni e la miniatura: non il file.
    assert!(file.bytes_read() < MIB, "{}", file.bytes_read());
}

/// Un PDF non porta una miniatura che Fub legga: `absent`, e la fa l'app
/// esterna. Un `.docx` cifrato è un contenitore CFB, non uno ZIP:
/// `unreadable`. Mai un errore.
#[test]
fn a_pdf_is_absent_and_an_encrypted_docx_unreadable() {
    let cfb = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0].repeat(64);
    let (_dir, root) = vault(&[
        (
            "Carte/a.pdf",
            b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<<>>\nendobj\n%%EOF\n".to_vec(),
        ),
        ("Carte/cifrato.docx", cfb),
    ]);
    let host = Host::without_watcher();
    host.open(&root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();

    let pdf = ask(&host, &root, "Carte/a.pdf").unwrap();
    assert_eq!(pdf.missing, Some(Missing::Absent));
    assert!(pdf.image.is_none());
    assert_eq!(pdf.origin, PreviewOrigin::None);
    assert_eq!(pdf.revision, None);
    assert_eq!(pdf.info.app, PreviewSubject::Pdf);
    assert_eq!(pdf.info.editor, "PdfCraft");
    let json = serde_json::to_value(&pdf).unwrap();
    assert_eq!(json["info"]["app"], "pdf");
    assert_eq!(json["missing"], "absent");

    let encrypted = ask(&host, &root, "Carte/cifrato.docx").unwrap();
    assert_eq!(encrypted.missing, Some(Missing::Unreadable));
    assert!(encrypted.image.is_none());
    assert_eq!(encrypted.revision, None);
    assert_eq!(encrypted.info.app, PreviewSubject::Document);
    assert_eq!(encrypted.info.editor, "WordCraft");
}
