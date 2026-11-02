//! I tre contenitori dei file Craft: i metadati, il testo e l'anteprima che
//! si leggono da un `.pcraft`, un `.figcraft` e un `.vectorcraft`, e i limiti
//! che fermano un file ostile.
//!
//! Ogni file è costruito qui: gli ZIP con `zip::ZipWriter` (voci in STORE e in
//! Deflate), gli gzip con `flate2`, il base64 con `base64` e un PNG minimo
//! scritto a mano.

use std::io::{Cursor, Write};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use flate2::write::GzEncoder;
use flate2::{Compression, Crc};
use fub_format_craft::container::{
    embedded_preview, read_meta, ContainerError, Contents, Png, MAX_FILE_BYTES, MAX_PREVIEW_BYTES,
    MAX_TEXT_BYTES, MAX_ZIP_ENTRIES, PNG_SIGNATURE,
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
