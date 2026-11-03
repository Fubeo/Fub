//! I tre contenitori dei file Craft: i metadati, il testo e l'anteprima che
//! si leggono da un `.pcraft`, un `.figcraft` e un `.vectorcraft`, e i limiti
//! che fermano un file ostile.
//!
//! Ogni file è costruito qui: gli ZIP con `zip::ZipWriter` (voci in STORE e in
//! Deflate), gli gzip con `flate2`, il base64 con `base64` e un PNG minimo
//! scritto a mano.

use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use flate2::write::{DeflateEncoder, GzEncoder};
use flate2::{Compress, Compression, Crc, FlushCompress};
use fub_format_craft::container::{
    embedded_preview, embedded_preview_from, read_meta, ContainerError, Contents, Embedded, Png,
    MAX_CENTRAL_DIRECTORY_BYTES, MAX_FILE_BYTES, MAX_MANIFEST_BYTES, MAX_PREVIEW_BYTES,
    MAX_TEXT_BYTES, MAX_ZIP_ENTRIES, PNG_SIGNATURE, VECTORCRAFT_BLOBS,
};
use fub_format_craft::{CraftApp, PreviewSize};
use serde_json::json;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const STORE: CompressionMethod = CompressionMethod::Stored;
const DEFLATE: CompressionMethod = CompressionMethod::Deflated;
const SIZES: [PreviewSize; 2] = [PreviewSize::Small, PreviewSize::Large];
const ZIPPED: [CraftApp; 2] = [CraftApp::PhotoCraft, CraftApp::FigCraft];

// --- I file finti ---------------------------------------------------------

/// Un chunk PNG: lunghezza, tipo, dati e CRC del tipo con i dati.
fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut crc = Crc::new();
    crc.update(kind);
    crc.update(data);
    let mut out = (data.len() as u32).to_be_bytes().to_vec();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    out.extend_from_slice(&crc.sum().to_be_bytes());
    out
}

/// Un PNG minimo di `width` × `height`: la firma, `IHDR` e `IEND`.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut ihdr = width.to_be_bytes().to_vec();
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    let mut out = PNG_SIGNATURE.to_vec();
    out.extend(chunk(b"IHDR", &ihdr));
    out.extend(chunk(b"IEND", &[]));
    out
}

/// Un PNG il cui `IHDR` si ferma a metà.
fn png_with_short_ihdr() -> Vec<u8> {
    let mut out = png(10, 10);
    out.truncate(PNG_SIGNATURE.len() + 8 + 6);
    out
}

/// L'inizio di un JPEG: non è un PNG.
const JPEG: &[u8] = &[0xff, 0xd8, 0xff, 0xe0, 0, 16, b'J', b'F', b'I', b'F', 0];

fn zip_of(entries: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes, method) in entries {
        let options = SimpleFileOptions::default()
            .compression_method(*method)
            .large_file(bytes.len() > u32::MAX as usize / 2);
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn json_bytes(value: &serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

/// Riscrive la misura scompattata che lo ZIP dichiara per la voce `name`,
/// nell'intestazione locale e nella directory centrale.
fn declare_size(zip: &mut [u8], name: &str, size: u32) {
    let mut patched = 0;
    for at in 0..zip.len().saturating_sub(46) {
        let (size_at, name_len_at, name_at) = match &zip[at..at + 4] {
            [b'P', b'K', 3, 4] => (at + 22, at + 26, at + 30),
            [b'P', b'K', 1, 2] => (at + 24, at + 28, at + 46),
            _ => continue,
        };
        let name_len = u16::from_le_bytes([zip[name_len_at], zip[name_len_at + 1]]) as usize;
        if zip.get(name_at..name_at + name_len) == Some(name.as_bytes()) {
            zip[size_at..size_at + 4].copy_from_slice(&size.to_le_bytes());
            patched += 1;
        }
    }
    assert_eq!(
        patched, 2,
        "la voce {name} è nell'intestazione locale e nella directory"
    );
}

fn vectorcraft_with_preview(data: &str) -> Vec<u8> {
    json_bytes(&json!({ "format_version": 4, "preview": { "data": data } }))
}

fn preview(app: CraftApp, bytes: &[u8], size: PreviewSize) -> Option<(u32, u32)> {
    embedded_preview(app, bytes, size)
        .unwrap()
        .map(|png| (png.width, png.height))
}

// --- PhotoCraft --------------------------------------------------------------

#[test]
fn il_manifesto_di_photocraft_dà_versione_e_titolo() {
    for method in [STORE, DEFLATE] {
        let manifest = json!({ "format_version": 3, "title": "Ritratto", "name": "ignorato" });
        let file = zip_of(&[
            ("thumb.png", &png(4, 3), method),
            ("manifest.json", &json_bytes(&manifest), method),
        ]);
        let contents = read_meta(CraftApp::PhotoCraft, &file).unwrap();
        assert_eq!(
            contents,
            Contents {
                format_version: Some("3".into()),
                title: Some("Ritratto".into()),
                text: String::new(),
                json: Some(manifest),
            }
        );
    }

    // La versione stringa resta com'è; il titolo, se manca `title`, da `name`.
    let manifest = json!({ "format_version": "3.1", "name": "Paesaggio", "title": "  " });
    let file = zip_of(&[("manifest.json", &json_bytes(&manifest), DEFLATE)]);
    let contents = read_meta(CraftApp::PhotoCraft, &file).unwrap();
    assert_eq!(contents.format_version.as_deref(), Some("3.1"));
    assert_eq!(contents.title.as_deref(), Some("Paesaggio"));

    // Una versione che non è numero né stringa non c'è; `version` non vale
    // per PhotoCraft.
    let manifest = json!({ "format_version": true, "version": 9 });
    let file = zip_of(&[("manifest.json", &json_bytes(&manifest), STORE)]);
    let contents = read_meta(CraftApp::PhotoCraft, &file).unwrap();
    assert_eq!((contents.format_version, contents.title), (None, None));
}

#[test]
fn uno_zip_senza_il_suo_json_ha_i_contenuti_vuoti() {
    let file = zip_of(&[("thumb.png", &png(4, 3), STORE)]);
    for app in ZIPPED {
        assert_eq!(read_meta(app, &file), Ok(Contents::default()), "{app:?}");
    }
    let empty = zip_of(&[]);
    for app in ZIPPED {
        assert_eq!(read_meta(app, &empty), Ok(Contents::default()), "{app:?}");
        for size in SIZES {
            assert_eq!(embedded_preview(app, &empty, size), Ok(None), "{app:?}");
        }
    }
    // Una cartella con il nome del manifesto non è il manifesto.
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_directory("manifest.json", SimpleFileOptions::default())
        .unwrap();
    let folder = writer.finish().unwrap().into_inner();
    assert_eq!(
        read_meta(CraftApp::PhotoCraft, &folder),
        Ok(Contents::default())
    );
}

#[test]
fn le_anteprime_di_photocraft_con_la_riserva() {
    let both = zip_of(&[
        ("manifest.json", b"{}", STORE),
        ("thumb.png", &png(64, 48), DEFLATE),
        ("composite/preview.png", &png(1024, 768), STORE),
    ]);
    assert_eq!(
        preview(CraftApp::PhotoCraft, &both, PreviewSize::Small),
        Some((64, 48))
    );
    assert_eq!(
        preview(CraftApp::PhotoCraft, &both, PreviewSize::Large),
        Some((1024, 768))
    );

    let thumb_only = zip_of(&[("thumb.png", &png(64, 48), DEFLATE)]);
    let composite_only = zip_of(&[("composite/preview.png", &png(1024, 768), DEFLATE)]);
    for size in SIZES {
        assert_eq!(
            preview(CraftApp::PhotoCraft, &thumb_only, size),
            Some((64, 48))
        );
        assert_eq!(
            preview(CraftApp::PhotoCraft, &composite_only, size),
            Some((1024, 768))
        );
    }

    // Un'anteprima che non è un PNG passa alla riserva; senza riserva è None.
    let jpeg_thumb = zip_of(&[
        ("thumb.png", JPEG, STORE),
        ("composite/preview.png", &png(1024, 768), STORE),
    ]);
    assert_eq!(
        preview(CraftApp::PhotoCraft, &jpeg_thumb, PreviewSize::Small),
        Some((1024, 768))
    );
    let jpeg_only = zip_of(&[("thumb.png", JPEG, STORE)]);
    let short_only = zip_of(&[("composite/preview.png", &png_with_short_ihdr(), STORE)]);
    for size in SIZES {
        assert_eq!(preview(CraftApp::PhotoCraft, &jpeg_only, size), None);
        assert_eq!(preview(CraftApp::PhotoCraft, &short_only, size), None);
    }
}

#[test]
fn l_anteprima_di_photocraft_troppo_grande_lascia_la_riserva() {
    let mut file = zip_of(&[
        ("thumb.png", &png(64, 48), STORE),
        ("composite/preview.png", &png(1024, 768), STORE),
    ]);
    declare_size(
        &mut file,
        "composite/preview.png",
        MAX_PREVIEW_BYTES as u32 + 1,
    );
    assert_eq!(
        preview(CraftApp::PhotoCraft, &file, PreviewSize::Large),
        Some((64, 48))
    );

    let mut alone = zip_of(&[("composite/preview.png", &png(1024, 768), STORE)]);
    declare_size(
        &mut alone,
        "composite/preview.png",
        MAX_PREVIEW_BYTES as u32 + 1,
    );
    for size in SIZES {
        assert_eq!(
            embedded_preview(CraftApp::PhotoCraft, &alone, size),
            Err(ContainerError::TooLarge)
        );
    }
}

// --- FigCraft ----------------------------------------------------------------

#[test]
fn il_documento_di_figcraft_dà_versione_titolo_e_testo() {
    let document = json!({
        "version": "2",
        "name": "Sito",
        "pages": [
            { "name": "Home", "children": [
                { "type": "text", "characters": "Benvenuti" },
                { "type": "frame", "content": { "text": "Chi siamo" } },
                { "text": 42, "content": "" },
            ]},
            { "content": "Contatti, è facile" },
        ],
    });
    for method in [STORE, DEFLATE] {
        let file = zip_of(&[
            ("document.json", &json_bytes(&document), method),
            ("thumbnail.png", &png(320, 200), method),
        ]);
        let contents = read_meta(CraftApp::FigCraft, &file).unwrap();
        assert_eq!(contents.format_version.as_deref(), Some("2"));
        assert_eq!(contents.title.as_deref(), Some("Sito"));
        // Le chiavi di un oggetto vengono in ordine alfabetico (`serde_json`
        // senza `preserve_order`); gli elementi di una lista nel loro ordine.
        assert_eq!(contents.text, "Benvenuti\nChi siamo\nContatti, è facile");
        assert_eq!(contents.json, Some(document.clone()));
        for size in SIZES {
            assert_eq!(preview(CraftApp::FigCraft, &file, size), Some((320, 200)));
        }
    }

    // `format_version` vince su `version`, e un numero diventa stringa.
    let file = zip_of(&[(
        "document.json",
        &json_bytes(&json!({ "format_version": 5.5, "version": "1" })),
        STORE,
    )]);
    let contents = read_meta(CraftApp::FigCraft, &file).unwrap();
    assert_eq!(contents.format_version.as_deref(), Some("5.5"));

    let jpeg = zip_of(&[("thumbnail.png", JPEG, STORE)]);
    let short = zip_of(&[("thumbnail.png", &png_with_short_ihdr(), STORE)]);
    for size in SIZES {
        assert_eq!(preview(CraftApp::FigCraft, &jpeg, size), None);
        assert_eq!(preview(CraftApp::FigCraft, &short, size), None);
    }
}

// --- VectorCraft -------------------------------------------------------------

fn vectorcraft_document() -> serde_json::Value {
    json!({
        "format_version": 4,
        "title": "Logo",
        "layers": [ { "text": "ACME" }, { "content": "sottotitolo" } ],
    })
}

#[test]
fn vectorcraft_in_chiaro_in_gzip_e_con_i_blob() {
    let document = vectorcraft_document();
    let plain = json_bytes(&document);
    let mut with_blobs = plain.clone();
    with_blobs.extend_from_slice(b"\n\0VCBLOBS\0");
    with_blobs.extend_from_slice(&[0xff, 0x00, 0x1f, 0x8b, b'{', b'\n', 0, 7]);

    for file in [
        plain.clone(),
        gzip(&plain),
        with_blobs.clone(),
        gzip(&with_blobs),
    ] {
        let contents = read_meta(CraftApp::VectorCraft, &file).unwrap();
        assert_eq!(
            contents,
            Contents {
                format_version: Some("4".into()),
                title: Some("Logo".into()),
                text: "ACME\nsottotitolo".into(),
                json: Some(document.clone()),
            }
        );
    }

    // I blob al primo separatore: il secondo è dentro i blob.
    let mut twice = plain.clone();
    twice.extend_from_slice(b"\n\0VCBLOBS\0\n\0VCBLOBS\0{}");
    assert_eq!(
        read_meta(CraftApp::VectorCraft, &twice)
            .unwrap()
            .title
            .as_deref(),
        Some("Logo")
    );
}

#[test]
fn il_separatore_dei_blob_all_inizio_lascia_un_json_vuoto() {
    let mut file = b"\n\0VCBLOBS\0".to_vec();
    file.extend_from_slice(&json_bytes(&vectorcraft_document()));
    assert_eq!(
        read_meta(CraftApp::VectorCraft, &file),
        Err(ContainerError::NotJson)
    );
    assert_eq!(
        embedded_preview(CraftApp::VectorCraft, &gzip(&file), PreviewSize::Small),
        Err(ContainerError::NotJson)
    );
}

#[test]
fn uno_gzip_troncato_o_rotto_è_bad_gzip() {
    let file = gzip(&json_bytes(&vectorcraft_document()));
    for cut in [2, 3, 10, file.len() / 2, file.len() - 1] {
        assert_eq!(
            read_meta(CraftApp::VectorCraft, &file[..cut]),
            Err(ContainerError::BadGzip),
            "tagliato a {cut}"
        );
        assert_eq!(
            embedded_preview(CraftApp::VectorCraft, &file[..cut], PreviewSize::Large),
            Err(ContainerError::BadGzip)
        );
    }
    let mut broken = file.clone();
    let middle = broken.len() / 2;
    broken[middle] ^= 0xff;
    broken[middle + 1] ^= 0xff;
    assert_eq!(
        read_meta(CraftApp::VectorCraft, &broken),
        Err(ContainerError::BadGzip)
    );
}

#[test]
fn le_anteprime_di_vectorcraft() {
    let encoded = STANDARD.encode(png(256, 180));
    for data in [
        encoded.clone(),
        format!("data:image/png;base64,{encoded}"),
        // Senza riempimento e con gli a capo di un base64 MIME.
        encoded.trim_end_matches('=').to_owned(),
        encoded
            .as_bytes()
            .chunks(16)
            .map(|line| std::str::from_utf8(line).unwrap())
            .collect::<Vec<_>>()
            .join("\r\n"),
    ] {
        let file = vectorcraft_with_preview(&data);
        for size in SIZES {
            assert_eq!(
                preview(CraftApp::VectorCraft, &file, size),
                Some((256, 180)),
                "{data}"
            );
        }
        assert_eq!(
            preview(CraftApp::VectorCraft, &gzip(&file), PreviewSize::Small),
            Some((256, 180))
        );
    }

    // Vuota, non base64, un JPEG, un IHDR corto, un URL `data:` che non è
    // base64: nessuna anteprima, nessun errore.
    for data in [
        String::new(),
        "data:image/png;base64,".to_owned(),
        "questo non è base64!".to_owned(),
        STANDARD.encode(JPEG),
        format!("data:image/jpeg;base64,{}", STANDARD.encode(JPEG)),
        STANDARD.encode(png_with_short_ihdr()),
        format!("data:image/png,{}", STANDARD.encode(png(1, 1))),
    ] {
        let file = vectorcraft_with_preview(&data);
        assert_eq!(
            embedded_preview(CraftApp::VectorCraft, &file, PreviewSize::Small),
            Ok(None),
            "{data}"
        );
    }

    // Senza `/preview/data`, o con un valore che non è una stringa.
    for document in [
        json!({ "title": "x" }),
        json!({ "preview": { "data": 12 } }),
        json!({ "preview": "x" }),
        json!([1, 2]),
    ] {
        assert_eq!(
            embedded_preview(
                CraftApp::VectorCraft,
                &json_bytes(&document),
                PreviewSize::Large
            ),
            Ok(None)
        );
    }
}

#[test]
fn l_anteprima_di_vectorcraft_ha_il_tetto_di_8_mib() {
    // Un PNG di 8 MiB esatti: la sua stringa base64 è la più lunga ammessa.
    let mut at_limit = png(2, 2);
    at_limit.resize(MAX_PREVIEW_BYTES, 0);
    let encoded = STANDARD.encode(&at_limit);
    let file = vectorcraft_with_preview(&encoded);
    let found = embedded_preview(CraftApp::VectorCraft, &file, PreviewSize::Large)
        .unwrap()
        .unwrap();
    assert_eq!(found, Png::new(at_limit).unwrap());

    // Un carattere in più è oltre il tetto, anche prima di decodificare.
    let file = vectorcraft_with_preview(&format!("{encoded}A"));
    assert_eq!(
        embedded_preview(CraftApp::VectorCraft, &file, PreviewSize::Large),
        Err(ContainerError::TooLarge)
    );
    let mut over = png(2, 2);
    over.resize(MAX_PREVIEW_BYTES + 1, 0);
    let file =
        vectorcraft_with_preview(&format!("data:image/png;base64,{}", STANDARD.encode(&over)));
    assert_eq!(
        embedded_preview(CraftApp::VectorCraft, &file, PreviewSize::Small),
        Err(ContainerError::TooLarge)
    );
}

// --- JSON che non si legge o non è un oggetto -------------------------------

#[test]
fn un_json_valido_che_non_è_un_oggetto() {
    let list = json!([{ "title": "no", "text": "uno" }, { "content": "due" }]);
    let contents = read_meta(CraftApp::VectorCraft, &json_bytes(&list)).unwrap();
    assert_eq!(
        contents,
        Contents {
            format_version: None,
            title: None,
            text: "uno\ndue".into(),
            json: Some(list.clone()),
        }
    );
    let file = zip_of(&[("document.json", &json_bytes(&list), DEFLATE)]);
    assert_eq!(read_meta(CraftApp::FigCraft, &file).unwrap().title, None);
    for scalar in [json!("una stringa"), json!(42), json!(null)] {
        let file = zip_of(&[("manifest.json", &json_bytes(&scalar), STORE)]);
        assert_eq!(
            read_meta(CraftApp::PhotoCraft, &file),
            Ok(Contents {
                json: Some(scalar.clone()),
                ..Contents::default()
            })
        );
        let contents = read_meta(CraftApp::VectorCraft, &json_bytes(&scalar)).unwrap();
        assert_eq!((contents.title, contents.text), (None, String::new()));
    }
}

#[test]
fn un_json_rotto_è_not_json() {
    for broken in [&b""[..], b"{\"title\":", b"\xff\xfe", b"{} {}", b"\0"] {
        assert_eq!(
            read_meta(CraftApp::VectorCraft, broken),
            Err(ContainerError::NotJson)
        );
        let file = zip_of(&[
            ("manifest.json", broken, STORE),
            ("document.json", broken, DEFLATE),
        ]);
        for app in ZIPPED {
            assert_eq!(
                read_meta(app, &file),
                Err(ContainerError::NotJson),
                "{app:?}"
            );
        }
    }
    // Annidato oltre il limite di `serde_json`: un errore, non uno stack pieno.
    let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
    assert_eq!(
        read_meta(CraftApp::VectorCraft, deep.as_bytes()),
        Err(ContainerError::NotJson)
    );
}

#[test]
fn uno_zip_rotto_è_not_zip() {
    let good = zip_of(&[("manifest.json", b"{\"title\":\"x\"}", DEFLATE)]);
    let inputs = [
        Vec::new(),
        b"non sono uno zip".to_vec(),
        b"PK\x03\x04\x14\x00\x00\x00".to_vec(),
        good[..good.len() / 2].to_vec(),
        good[..good.len() - 4].to_vec(),
    ];
    for bytes in inputs {
        for app in ZIPPED {
            assert_eq!(
                read_meta(app, &bytes),
                Err(ContainerError::NotZip),
                "{app:?}"
            );
            for size in SIZES {
                assert_eq!(
                    embedded_preview(app, &bytes, size),
                    Err(ContainerError::NotZip)
                );
            }
        }
    }
}

// --- Il testo ----------------------------------------------------------------

#[test]
fn il_testo_si_taglia_a_64_kib_su_un_confine_di_carattere() {
    // Righe di «€» (3 byte): 64 KiB non cadono su un confine.
    let line = "€".repeat(1000);
    let layers: Vec<_> = (0..40).map(|_| json!({ "text": line })).collect();
    let file = json_bytes(&json!({ "layers": layers }));
    let text = read_meta(CraftApp::VectorCraft, &file).unwrap().text;
    assert!(text.len() <= MAX_TEXT_BYTES, "{}", text.len());
    assert!(text.len() > MAX_TEXT_BYTES - 4, "{}", text.len());
    assert!(text.starts_with(&line));
    assert!(text.ends_with('€'));
    assert!(text.split('\n').all(|row| row.chars().all(|c| c == '€')));

    // Sotto il tetto il testo resta intero.
    let layers: Vec<_> = (0..3)
        .map(|i| json!({ "characters": format!("riga {i}") }))
        .collect();
    let file = zip_of(&[(
        "document.json",
        &json_bytes(&json!({ "layers": layers })),
        DEFLATE,
    )]);
    assert_eq!(
        read_meta(CraftApp::FigCraft, &file).unwrap().text,
        "riga 0\nriga 1\nriga 2"
    );
}

// --- I nomi delle voci -------------------------------------------------------

#[test]
fn una_voce_con_dotdot_non_è_quella_del_formato() {
    let manifest = json_bytes(&json!({ "title": "fuori" }));
    let file = zip_of(&[
        ("../manifest.json", &manifest, STORE),
        ("x/../manifest.json", &manifest, STORE),
        ("../document.json", &manifest, DEFLATE),
        ("../thumb.png", &png(4, 4), STORE),
        ("x/../thumb.png", &png(4, 4), STORE),
        ("../composite/preview.png", &png(4, 4), STORE),
        ("../thumbnail.png", &png(4, 4), DEFLATE),
    ]);
    for app in ZIPPED {
        assert_eq!(read_meta(app, &file), Ok(Contents::default()), "{app:?}");
        for size in SIZES {
            assert_eq!(embedded_preview(app, &file, size), Ok(None), "{app:?}");
        }
    }
}

// --- I limiti ----------------------------------------------------------------

fn many_entries(count: usize) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(STORE);
    writer.start_file("manifest.json", options).unwrap();
    writer.write_all(b"{\"title\":\"tante voci\"}").unwrap();
    for index in 1..count {
        writer
            .start_file(format!("layers/{index}"), options)
            .unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn diecimila_voci_si_leggono_diecimila_e_una_no() {
    let at_limit = many_entries(MAX_ZIP_ENTRIES);
    assert_eq!(
        read_meta(CraftApp::PhotoCraft, &at_limit)
            .unwrap()
            .title
            .as_deref(),
        Some("tante voci")
    );
    let over = many_entries(MAX_ZIP_ENTRIES + 1);
    for app in ZIPPED {
        assert_eq!(
            read_meta(app, &over),
            Err(ContainerError::TooLarge),
            "{app:?}"
        );
        for size in SIZES {
            assert_eq!(
                embedded_preview(app, &over, size),
                Err(ContainerError::TooLarge)
            );
        }
    }
}

#[test]
fn una_voce_che_dichiara_più_di_64_mib_non_si_legge() {
    for name in ["manifest.json", "document.json"] {
        let mut file = zip_of(&[(name, b"{\"title\":\"x\"}", STORE)]);
        declare_size(&mut file, name, MAX_FILE_BYTES as u32 + 1);
        let app = if name == "manifest.json" {
            CraftApp::PhotoCraft
        } else {
            CraftApp::FigCraft
        };
        assert_eq!(
            read_meta(app, &file),
            Err(ContainerError::TooLarge),
            "{name}"
        );
    }
}

#[test]
fn una_voce_dichiarata_piccola_che_si_scompatta_grande_si_ferma() {
    // Un PNG vero di 8 MiB e un byte, compresso: lo ZIP dice 100 byte.
    let mut big = png(2, 2);
    big.resize(MAX_PREVIEW_BYTES + 1, 0);
    for (app, name) in [
        (CraftApp::PhotoCraft, "thumb.png"),
        (CraftApp::FigCraft, "thumbnail.png"),
    ] {
        let mut file = zip_of(&[(name, &big, DEFLATE)]);
        declare_size(&mut file, name, 100);
        // La lettura si ferma alla misura dichiarata, e lì il CRC non torna:
        // la voce non si legge. Il `take` al tetto resta la seconda barriera.
        // Mai l'anteprima, mai un panico, mai 8 MiB in memoria.
        assert_eq!(
            embedded_preview(app, &file, PreviewSize::Small),
            Err(ContainerError::NotZip),
            "{app:?}"
        );
    }
    // Lo stesso per il JSON: 1 KiB vero dichiarato 10 byte.
    let manifest = json_bytes(&json!({ "title": "x".repeat(1024) }));
    let mut file = zip_of(&[("manifest.json", &manifest, DEFLATE)]);
    declare_size(&mut file, "manifest.json", 10);
    assert_eq!(
        read_meta(CraftApp::PhotoCraft, &file),
        Err(ContainerError::NotZip)
    );
}

#[test]
fn un_file_di_64_mib_e_un_byte_non_si_apre() {
    // Un JSON di 64 MiB esatti si legge.
    let head = b"{\"title\":\"Al limite\",\"pad\":\"";
    let tail = b"\"}";
    let mut at_limit = head.to_vec();
    at_limit.resize(MAX_FILE_BYTES - tail.len(), b'a');
    at_limit.extend_from_slice(tail);
    assert_eq!(at_limit.len(), MAX_FILE_BYTES);
    let contents = read_meta(CraftApp::VectorCraft, &at_limit).unwrap();
    assert_eq!(contents.title.as_deref(), Some("Al limite"));

    // Un byte in più, e il file non si apre: neanche uno che sarebbe valido.
    let mut over = at_limit;
    over.insert(head.len(), b'a');
    assert_eq!(over.len(), MAX_FILE_BYTES + 1);
    for app in [
        CraftApp::VectorCraft,
        CraftApp::PhotoCraft,
        CraftApp::FigCraft,
    ] {
        assert_eq!(
            read_meta(app, &over),
            Err(ContainerError::TooLarge),
            "{app:?}"
        );
        for size in SIZES {
            assert_eq!(
                embedded_preview(app, &over, size),
                Err(ContainerError::TooLarge)
            );
        }
    }
}

#[test]
fn uno_gzip_che_si_scompatta_oltre_64_mib_si_ferma() {
    let head = b"{\"title\":\"Compresso\",\"pad\":\"";
    let tail = b"\"}";
    let mut at_limit = head.to_vec();
    at_limit.resize(MAX_FILE_BYTES - tail.len(), b'a');
    at_limit.extend_from_slice(tail);
    assert_eq!(
        read_meta(CraftApp::VectorCraft, &gzip(&at_limit))
            .unwrap()
            .title
            .as_deref(),
        Some("Compresso")
    );

    at_limit.insert(head.len(), b'a');
    let over = gzip(&at_limit);
    assert!(over.len() < 1024 * 1024, "{}", over.len());
    assert_eq!(
        read_meta(CraftApp::VectorCraft, &over),
        Err(ContainerError::TooLarge)
    );
    assert_eq!(
        embedded_preview(CraftApp::VectorCraft, &over, PreviewSize::Small),
        Err(ContainerError::TooLarge)
    );
}

// --- XMP ---------------------------------------------------------------------

#[test]
fn un_xmp_non_è_un_contenitore() {
    let file = zip_of(&[("manifest.json", b"{\"title\":\"x\"}", STORE)]);
    assert_eq!(read_meta(CraftApp::Xmp, &file), Ok(Contents::default()));
    for size in SIZES {
        assert_eq!(embedded_preview(CraftApp::Xmp, &file, size), Ok(None));
    }
}

// --- Letture a pezzi ---------------------------------------------------------
//
// `embedded_preview_from` legge da un `Read + Seek`: i file grandi sono sparsi
// (`set_len` e `seek` oltre la fine) in una cartella temporanea, e un lettore
// conta i byte che il contenitore chiede.

/// Un lettore che conta i byte dati.
struct Counting<R> {
    inner: R,
    read: u64,
}

impl<R> Counting<R> {
    fn new(inner: R) -> Self {
        Counting { inner, read: 0 }
    }
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let got = self.inner.read(buf)?;
        self.read += got as u64;
        Ok(got)
    }
}

impl<R: Seek> Seek for Counting<R> {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

/// Una cartella temporanea che si toglie da sola.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Scratch {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("fub-containers-{}-{tag}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        Scratch(dir)
    }

    fn file(&self, name: &str) -> (PathBuf, File) {
        let path = self.0.join(name);
        let file = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        (path, file)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const MIB: u64 = 1024 * 1024;
const GIB: u64 = 1024 * MIB;

/// Uno ZIP scritto a mano: le intestazioni locali, la directory centrale e
/// la fine, classica o ZIP64, coi CRC veri. Una voce può essere sparsa: la
/// sua intestazione e poi un buco della misura dichiarata.
struct RawZip<W> {
    out: W,
    at: u64,
    central: Vec<u8>,
    count: u64,
}

struct Tail {
    entries: u64,
    size: u64,
    offset: u64,
    /// Dove comincia ciò che viene dopo la directory.
    end: u64,
}

impl<W: Write + Seek> RawZip<W> {
    fn new(out: W) -> Self {
        RawZip {
            out,
            at: 0,
            central: Vec::new(),
            count: 0,
        }
    }

    fn write(&mut self, bytes: &[u8]) {
        self.out.write_all(bytes).unwrap();
        self.at += bytes.len() as u64;
    }

    /// Una voce: `data` sono i byte scritti (compressi se `method` è 8),
    /// `hole` un buco dopo di loro, `declared` la misura scompattata.
    #[allow(clippy::too_many_arguments)]
    fn entry_with(
        &mut self,
        name: &str,
        method: u16,
        crc: u32,
        data: &[u8],
        hole: u64,
        declared: u32,
        comment: &[u8],
    ) {
        let offset = u32::try_from(self.at).unwrap();
        let compressed = u32::try_from(data.len() as u64 + hole).unwrap();
        let mut fixed = Vec::new();
        fixed.extend_from_slice(&20u16.to_le_bytes());
        fixed.extend_from_slice(&0u16.to_le_bytes());
        fixed.extend_from_slice(&method.to_le_bytes());
        fixed.extend_from_slice(&0u16.to_le_bytes());
        fixed.extend_from_slice(&0x21u16.to_le_bytes());
        fixed.extend_from_slice(&crc.to_le_bytes());
        fixed.extend_from_slice(&compressed.to_le_bytes());
        fixed.extend_from_slice(&declared.to_le_bytes());
        fixed.extend_from_slice(&(name.len() as u16).to_le_bytes());
        let mut local = b"PK\x03\x04".to_vec();
        local.extend_from_slice(&fixed);
        local.extend_from_slice(&0u16.to_le_bytes());
        local.extend_from_slice(name.as_bytes());
        self.write(&local);
        self.write(data);
        if hole > 0 {
            self.at += hole;
            self.out.seek(SeekFrom::Start(self.at)).unwrap();
        }
        let central = &mut self.central;
        central.extend_from_slice(b"PK\x01\x02");
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&fixed);
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&(comment.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 8]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
        central.extend_from_slice(comment);
        self.count += 1;
    }

    fn stored(&mut self, name: &str, bytes: &[u8]) {
        let len = u32::try_from(bytes.len()).unwrap();
        self.entry_with(name, 0, crc_of(bytes), bytes, 0, len, b"");
    }

    fn deflated(&mut self, name: &str, bytes: &[u8]) {
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::fast());
        encoder.write_all(bytes).unwrap();
        let compressed = encoder.finish().unwrap();
        let len = u32::try_from(bytes.len()).unwrap();
        self.entry_with(name, 8, crc_of(bytes), &compressed, 0, len, b"");
    }

    /// Una voce STORE di `len` byte a zero, che sul disco non ci sono.
    fn sparse(&mut self, name: &str, len: u64) {
        let declared = u32::try_from(len).unwrap();
        self.entry_with(name, 0, 0, b"", len, declared, b"");
    }

    /// La directory centrale, senza la fine.
    fn directory(&mut self) -> Tail {
        let offset = self.at;
        let central = std::mem::take(&mut self.central);
        self.write(&central);
        Tail {
            entries: self.count,
            size: central.len() as u64,
            offset,
            end: self.at,
        }
    }

    /// La directory e la fine classica col commento `comment`.
    fn finish(mut self, comment: &[u8]) -> W {
        let tail = self.directory();
        let eocd = eocd(
            tail.entries as u16,
            tail.size as u32,
            tail.offset as u32,
            comment,
        );
        self.write(&eocd);
        self.out
    }

    /// La directory, la fine ZIP64 (che dichiara `entries` voci), il
    /// localizzatore e la fine classica coi campi al massimo.
    fn finish_zip64(mut self, entries: u64) -> W {
        let tail = self.directory();
        let mut record = b"PK\x06\x06".to_vec();
        record.extend_from_slice(&44u64.to_le_bytes());
        record.extend_from_slice(&45u16.to_le_bytes());
        record.extend_from_slice(&45u16.to_le_bytes());
        record.extend_from_slice(&[0; 8]);
        record.extend_from_slice(&entries.to_le_bytes());
        record.extend_from_slice(&entries.to_le_bytes());
        record.extend_from_slice(&tail.size.to_le_bytes());
        record.extend_from_slice(&tail.offset.to_le_bytes());
        self.write(&record);
        let mut locator = b"PK\x06\x07".to_vec();
        locator.extend_from_slice(&0u32.to_le_bytes());
        locator.extend_from_slice(&tail.end.to_le_bytes());
        locator.extend_from_slice(&1u32.to_le_bytes());
        self.write(&locator);
        self.write(&eocd(u16::MAX, u32::MAX, u32::MAX, b""));
        self.out
    }
}

fn crc_of(bytes: &[u8]) -> u32 {
    let mut crc = Crc::new();
    crc.update(bytes);
    crc.sum()
}

/// La fine classica della directory centrale.
fn eocd(entries: u16, size: u32, offset: u32, comment: &[u8]) -> Vec<u8> {
    let mut out = b"PK\x05\x06".to_vec();
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&entries.to_le_bytes());
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&offset.to_le_bytes());
    out.extend_from_slice(&(comment.len() as u16).to_le_bytes());
    out.extend_from_slice(comment);
    out
}

fn manifest(version: u32) -> Vec<u8> {
    json_bytes(&json!({ "format_version": version, "title": "a pezzi" }))
}

/// Un piccolo `.pcraft` scritto a mano.
fn small_pcraft(comment: &[u8]) -> Vec<u8> {
    let mut zip = RawZip::new(Cursor::new(Vec::new()));
    zip.stored("thumb.png", &png(4, 3));
    zip.stored("manifest.json", &manifest(3));
    zip.finish(comment).into_inner()
}

fn from_bytes(
    app: CraftApp,
    bytes: &[u8],
    size: PreviewSize,
    max: u64,
) -> (Result<Embedded, ContainerError>, u64) {
    let mut reader = Counting::new(Cursor::new(bytes));
    let found = embedded_preview_from(app, &mut reader, bytes.len() as u64, size, max);
    (found, reader.read)
}

fn measures(found: &Result<Embedded, ContainerError>) -> Option<(u32, u32)> {
    let png = found.as_ref().ok()?.png.as_ref().ok()?.as_ref()?;
    Some((png.width, png.height))
}

/// Uno stream deflate che si scompatta in `mib` MiB di zeri: un pezzo di
/// 1 MiB compresso e chiuso su un confine di byte, ripetuto. Ogni copia si
/// riferisce solo a zeri già scritti, quindi lo stream resta valido.
fn deflate_of_zeros(mib: usize) -> Vec<u8> {
    let zeros = vec![0u8; MIB as usize];
    let mut compress = Compress::new(Compression::best(), false);
    let mut piece = Vec::with_capacity(MIB as usize);
    compress
        .compress_vec(&zeros, &mut piece, FlushCompress::Sync)
        .unwrap();
    assert_eq!(compress.total_in(), MIB);
    let mut out = Vec::with_capacity(piece.len() * mib + 64);
    for _ in 0..mib {
        out.extend_from_slice(&piece);
    }
    let mut end = Vec::with_capacity(64);
    compress
        .compress_vec(&[], &mut end, FlushCompress::Finish)
        .unwrap();
    out.extend_from_slice(&end);
    out
}

#[test]
fn un_pcraft_di_1_gib_dà_l_anteprima_leggendo_meno_di_1_mib() {
    let scratch = Scratch::new("pcraft");
    let (_, file) = scratch.file("enorme.pcraft");
    let mut zip = RawZip::new(file);
    zip.sparse("layers/0.bin", GIB);
    zip.stored("thumb.png", &png(64, 48));
    zip.stored("manifest.json", &manifest(5));
    let mut file = zip.finish(b"");
    let len = file.seek(SeekFrom::End(0)).unwrap();
    assert!(len > GIB, "{len}");
    let before = file.metadata().unwrap().modified().unwrap();
    for size in SIZES {
        let mut reader = Counting::new(&mut file);
        let found =
            embedded_preview_from(CraftApp::PhotoCraft, &mut reader, len, size, u64::MAX).unwrap();
        assert_eq!(found.format_version, Ok(Some("5".into())));
        let png = found.png.unwrap().unwrap();
        assert_eq!((png.width, png.height), (64, 48));
        assert!(reader.read < MIB, "{size:?}: {} byte letti", reader.read);
    }
    // Il file non si tocca: stesso peso, stessa data.
    assert_eq!(file.seek(SeekFrom::End(0)).unwrap(), len);
    assert_eq!(file.metadata().unwrap().modified().unwrap(), before);
}

#[test]
fn una_directory_centrale_oltre_4_mib_si_ferma_prima_di_zip() {
    // Al tetto la coda passa, e decide `zip`: qui la directory sono zeri.
    let mut at_limit = vec![0u8; MAX_CENTRAL_DIRECTORY_BYTES as usize + 16];
    at_limit.extend(eocd(1, MAX_CENTRAL_DIRECTORY_BYTES as u32, 0, b""));
    let (found, _) = from_bytes(CraftApp::PhotoCraft, &at_limit, PreviewSize::Small, 0);
    assert_eq!(found, Err(ContainerError::NotZip));

    // 5 MiB dichiarati: nessun byte oltre la coda.
    let mut over = vec![0u8; 6 * MIB as usize];
    over.extend(eocd(1, 5 * MIB as u32, 0, b""));
    let (found, read) = from_bytes(CraftApp::PhotoCraft, &over, PreviewSize::Small, 0);
    assert_eq!(found, Err(ContainerError::TooLarge));
    assert!(read <= 65_557, "{read}");

    let mut over = vec![0u8; MAX_CENTRAL_DIRECTORY_BYTES as usize + 16];
    over.extend(eocd(1, MAX_CENTRAL_DIRECTORY_BYTES as u32 + 1, 0, b""));
    let (found, _) = from_bytes(CraftApp::FigCraft, &over, PreviewSize::Large, 0);
    assert_eq!(found, Err(ContainerError::TooLarge));
}

#[test]
fn diecimila_e_una_voci_si_fermano_prima_di_zip() {
    let at_limit = many_entries(MAX_ZIP_ENTRIES);
    let (found, _) = from_bytes(CraftApp::PhotoCraft, &at_limit, PreviewSize::Small, 0);
    assert_eq!(found.unwrap().png, Ok(None));
    let over = many_entries(MAX_ZIP_ENTRIES + 1);
    for app in ZIPPED {
        let (found, read) = from_bytes(app, &over, PreviewSize::Small, 0);
        assert_eq!(found, Err(ContainerError::TooLarge), "{app:?}");
        assert!(read <= 65_557, "{app:?}: {read}");
    }
}

#[test]
fn una_fine_che_punta_fuori_dal_file_non_è_uno_zip() {
    let good = small_pcraft(b"");
    let eocd_at = good.len() - 22;
    for (field, value) in [(16, u32::MAX - 1), (16, good.len() as u32), (12, 1_000_000)] {
        let mut bad = good.clone();
        bad[eocd_at + field..eocd_at + field + 4].copy_from_slice(&value.to_le_bytes());
        let (found, read) = from_bytes(CraftApp::PhotoCraft, &bad, PreviewSize::Small, 0);
        assert_eq!(found, Err(ContainerError::NotZip), "{field}={value}");
        assert!(read <= good.len() as u64, "{read}");
    }
}

#[test]
fn una_fine_finta_nel_commento_si_guarda_anche_lei() {
    // Il commento porta una fine che dichiara 5 MiB di directory: `zip`
    // potrebbe sceglierla, quindi ferma il file prima di aprirlo.
    let fake = eocd(1, 5 * MIB as u32, 0, b"");
    let file = small_pcraft(&fake);
    let (found, read) = from_bytes(CraftApp::PhotoCraft, &file, PreviewSize::Small, 0);
    assert_eq!(found, Err(ContainerError::TooLarge));
    assert!(read <= file.len() as u64, "{read}");

    // Una fine finta il cui commento esce dal file non si sceglie: resta la
    // vera, e l'anteprima c'è.
    let mut fake = eocd(1, 5 * MIB as u32, 0, b"");
    fake[20..22].copy_from_slice(&1000u16.to_le_bytes());
    let file = small_pcraft(&fake);
    let (found, _) = from_bytes(CraftApp::PhotoCraft, &file, PreviewSize::Small, 0);
    assert_eq!(measures(&found), Some((4, 3)));
}

#[test]
fn uno_zip64_si_legge_e_le_sue_voci_si_contano() {
    let build = |entries: u64| {
        let mut zip = RawZip::new(Cursor::new(Vec::new()));
        zip.stored("thumbnail.png", &png(7, 5));
        zip.stored("document.json", &json_bytes(&json!({ "version": "2.1" })));
        zip.finish_zip64(entries).into_inner()
    };
    let file = build(2);
    let (found, _) = from_bytes(CraftApp::FigCraft, &file, PreviewSize::Small, 0);
    assert_eq!(measures(&found), Some((7, 5)));
    assert_eq!(found.unwrap().format_version, Ok(Some("2.1".into())));

    let (found, read) = from_bytes(
        CraftApp::FigCraft,
        &build(MAX_ZIP_ENTRIES as u64 + 1),
        PreviewSize::Small,
        0,
    );
    assert_eq!(found, Err(ContainerError::TooLarge));
    assert!(read < 70_000, "{read}");

    // Un localizzatore che punta dopo sé stesso non è uno ZIP.
    let mut bad = build(2);
    let locator = bad.len() - 22 - 20;
    let after = (bad.len() as u64).to_le_bytes();
    bad[locator + 8..locator + 16].copy_from_slice(&after);
    let (found, _) = from_bytes(CraftApp::FigCraft, &bad, PreviewSize::Small, 0);
    assert_eq!(found, Err(ContainerError::NotZip));
}

#[test]
fn una_directory_dichiarata_corta_ma_lunga_si_ferma_al_tetto_dei_byte() {
    // La fine dice 46 byte; le voci portano commenti di 64 KiB, per 6 MiB.
    let mut zip = RawZip::new(Cursor::new(Vec::new()));
    let comment = vec![b'c'; u16::MAX as usize];
    for index in 0..100 {
        zip.entry_with(&format!("v{index}"), 0, 0, b"", 0, 0, &comment);
    }
    let tail = zip.directory();
    let mut bytes = zip.out.into_inner();
    bytes.extend(eocd(100, 46, tail.offset as u32, b""));
    let (found, read) = from_bytes(CraftApp::PhotoCraft, &bytes, PreviewSize::Small, 0);
    assert_eq!(found, Err(ContainerError::TooLarge));
    assert!(read < MIB, "{read}");
}

#[test]
fn un_anteprima_deflate_ha_il_tetto_di_8_mib() {
    let mut at_limit = png(9, 9);
    at_limit.resize(MAX_PREVIEW_BYTES, 0);
    let mut over = at_limit.clone();
    over.push(0);
    for (thumb, expected) in [
        (at_limit, Ok(Some((9, 9)))),
        (over, Err(ContainerError::TooLarge)),
    ] {
        let mut zip = RawZip::new(Cursor::new(Vec::new()));
        zip.deflated("thumb.png", &thumb);
        let file = zip.finish(b"").into_inner();
        let (found, _) = from_bytes(CraftApp::PhotoCraft, &file, PreviewSize::Small, 0);
        let got = found
            .unwrap()
            .png
            .map(|png| png.map(|png| (png.width, png.height)));
        assert_eq!(got, expected);
    }
}

#[test]
fn una_voce_di_1_kib_che_si_scompatta_in_1_gib_si_ferma() {
    let bomb = deflate_of_zeros(1024);
    assert!(bomb.len() < 2 * MIB as usize, "{}", bomb.len());
    let mut zip = RawZip::new(Cursor::new(Vec::new()));
    zip.entry_with("thumb.png", 8, 0, &bomb, 0, 1024, b"");
    let file = zip.finish(b"").into_inner();
    let (found, read) = from_bytes(CraftApp::PhotoCraft, &file, PreviewSize::Small, 0);
    assert!(found.unwrap().png.is_err());
    assert!(read < 2 * MIB, "{read}");
}

#[test]
fn senza_thumb_la_misura_grande_prende_il_composito() {
    let mut zip = RawZip::new(Cursor::new(Vec::new()));
    zip.stored("composite/preview.png", &png(800, 600));
    let file = zip.finish(b"").into_inner();
    for size in SIZES {
        let (found, _) = from_bytes(CraftApp::PhotoCraft, &file, size, 0);
        assert_eq!(measures(&found), Some((800, 600)), "{size:?}");
        // Senza manifesto la versione non si sa, e non è un errore.
        assert_eq!(found.unwrap().format_version, Ok(None));
    }
}

#[test]
fn il_manifesto_ha_il_tetto_di_1_mib() {
    let padded = |len: usize| {
        let mut bytes = br#"{"format_version":7,"pad":""#.to_vec();
        let pad = len - bytes.len() - 2;
        bytes.extend(std::iter::repeat_n(b'a', pad));
        bytes.extend_from_slice(b"\"}");
        assert_eq!(bytes.len(), len);
        bytes
    };
    for (len, expected) in [
        (MAX_MANIFEST_BYTES, Some("7".to_string())),
        (MAX_MANIFEST_BYTES + 1, None),
    ] {
        let mut zip = RawZip::new(Cursor::new(Vec::new()));
        zip.stored("thumb.png", &png(4, 3));
        zip.stored("manifest.json", &padded(len));
        let file = zip.finish(b"").into_inner();
        let (found, _) = from_bytes(CraftApp::PhotoCraft, &file, PreviewSize::Small, 0);
        assert_eq!(measures(&found), Some((4, 3)));
        assert_eq!(found.unwrap().format_version, Ok(expected), "{len}");
    }
    // Un manifesto rotto si dice: la versione è un errore, l'anteprima resta.
    let mut zip = RawZip::new(Cursor::new(Vec::new()));
    zip.stored("thumb.png", &png(4, 3));
    zip.stored("manifest.json", b"{rotto");
    let file = zip.finish(b"").into_inner();
    let (found, _) = from_bytes(CraftApp::PhotoCraft, &file, PreviewSize::Small, 0);
    assert_eq!(measures(&found), Some((4, 3)));
    assert_eq!(found.unwrap().format_version, Err(ContainerError::NotJson));
}

#[test]
fn un_pcraft_vuoto_o_troppo_corto_non_è_uno_zip() {
    for bytes in [&b""[..], b"PK\x05\x06", b"non sono uno zip"] {
        for app in ZIPPED {
            let (found, _) = from_bytes(app, bytes, PreviewSize::Small, 0);
            assert_eq!(found, Err(ContainerError::NotZip), "{app:?} {bytes:?}");
        }
    }
}

#[test]
fn un_vectorcraft_con_100_mib_di_blob_legge_solo_il_json() {
    let scratch = Scratch::new("vectorcraft");
    let (_, mut file) = scratch.file("blob.vectorcraft");
    let data = STANDARD.encode(png(12, 10));
    let json = vectorcraft_with_preview(&data);
    file.write_all(&json).unwrap();
    file.write_all(VECTORCRAFT_BLOBS).unwrap();
    let len = (json.len() + VECTORCRAFT_BLOBS.len()) as u64 + 100 * MIB;
    file.set_len(len).unwrap();
    let mut reader = Counting::new(&mut file);
    let found = embedded_preview_from(
        CraftApp::VectorCraft,
        &mut reader,
        len,
        PreviewSize::Small,
        GIB,
    )
    .unwrap();
    assert_eq!(found.format_version, Ok(Some("4".into())));
    let png = found.png.unwrap().unwrap();
    assert_eq!((png.width, png.height), (12, 10));
    // Il JSON e al più un pezzo di 64 KiB dopo il separatore.
    assert!(
        reader.read <= json.len() as u64 + 64 * 1024,
        "{}",
        reader.read
    );
}

#[test]
fn il_json_di_vectorcraft_prima_dei_blob_ha_il_tetto_concesso() {
    let json = json_bytes(&json!({ "format_version": 4, "pad": "x".repeat(2000) }));
    let max = json.len() as u64;
    let mut with_blobs = json.clone();
    with_blobs.extend_from_slice(VECTORCRAFT_BLOBS);
    with_blobs.extend_from_slice(&[7; 5000]);
    for bytes in [&json, &with_blobs] {
        let (found, _) = from_bytes(CraftApp::VectorCraft, bytes, PreviewSize::Small, max);
        assert_eq!(found.unwrap().format_version, Ok(Some("4".into())));
        let (found, _) = from_bytes(CraftApp::VectorCraft, bytes, PreviewSize::Small, max - 1);
        assert_eq!(found, Err(ContainerError::OverLimit));
    }
    // Lo stesso tetto vale dopo lo gzip, e anche sui byte compressi.
    let packed = gzip(&with_blobs);
    let (found, _) = from_bytes(CraftApp::VectorCraft, &packed, PreviewSize::Small, max);
    assert_eq!(found.unwrap().format_version, Ok(Some("4".into())));
    let (found, _) = from_bytes(CraftApp::VectorCraft, &packed, PreviewSize::Small, max - 1);
    assert_eq!(found, Err(ContainerError::OverLimit));
    let (found, _) = from_bytes(CraftApp::VectorCraft, &packed, PreviewSize::Small, 20);
    assert_eq!(found, Err(ContainerError::OverLimit));
}

#[test]
fn il_separatore_a_cavallo_di_due_pezzi_si_trova() {
    for at in [
        64 * 1024 - 3,
        64 * 1024,
        64 * 1024 - VECTORCRAFT_BLOBS.len(),
    ] {
        let head = br#"{"format_version":4,"pad":""#;
        let mut bytes = head.to_vec();
        bytes.extend(std::iter::repeat_n(b'a', at - head.len() - 2));
        bytes.extend_from_slice(b"\"}");
        assert_eq!(bytes.len(), at);
        bytes.extend_from_slice(VECTORCRAFT_BLOBS);
        bytes.extend_from_slice(b"non JSON");
        let (found, _) = from_bytes(CraftApp::VectorCraft, &bytes, PreviewSize::Small, GIB);
        assert_eq!(found.unwrap().format_version, Ok(Some("4".into())), "{at}");
    }
}

#[test]
fn uno_gzip_di_1_mib_che_diventa_1_gib_si_ferma_al_tetto() {
    let mut bomb = vec![0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff];
    bomb.extend(deflate_of_zeros(1024));
    bomb.extend_from_slice(&[0; 8]);
    assert!(bomb.len() < 2 * MIB as usize, "{}", bomb.len());
    let (found, read) = from_bytes(
        CraftApp::VectorCraft,
        &bomb,
        PreviewSize::Small,
        MAX_FILE_BYTES as u64,
    );
    assert_eq!(found, Err(ContainerError::OverLimit));
    assert!(read < bomb.len() as u64, "{read}");
    assert_eq!(
        embedded_preview(CraftApp::VectorCraft, &bomb, PreviewSize::Small),
        Err(ContainerError::TooLarge)
    );
}
