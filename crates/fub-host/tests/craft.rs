//! I file delle app Craft su un vault vero, col bundle `fub.craft` (N7).
//!
//! Un `.vectorcraft`, un `.pcraft` e un `.figcraft` con l'anteprima dentro,
//! un `.vectorcraft` senza, e un XMP di LightCraft accanto alla sua foto: il
//! comando `craft.preview` dà l'anteprima piccola e grande, la cache del
//! bundle risponde quando c'è, e nessun byte dei file cambia. I formati
//! restano col componente spento: la ricerca trova il testo di un
//! `.figcraft`, la foto collegata ha il disegno fra i backlink e il tag di un
//! XMP si conta. Il comando `craft.photo` trova l'XMP accanto a una foto e
//! lo legge, senza scrivere niente.

#![cfg(feature = "craft")]

use std::collections::BTreeMap;
use std::io::{Cursor, Write};

use base64::Engine as _;
use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::command::{CommandEffect, InvokeMode};
use fub_abi::model::DocId;
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{EntryKind, Excerpts, IndexQuery, IndexResult, Page, PropertySelect};
use fub_abi::PluginError;
use fub_format_craft::{
    cache_key, CraftPreview, Missing, PhotoSidecar, PreviewOrigin, PreviewSize, PreviewSubject,
    PHOTO_COMMAND, PREVIEW_COMMAND,
};
use fub_host::Host;

/// Un PNG minimo: firma, `IHDR` (il CRC non conta per le misure) e `IEND`.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut out = vec![0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];
    out.extend_from_slice(&13u32.to_be_bytes());
    out.extend_from_slice(b"IHDR");
    out.extend_from_slice(&width.to_be_bytes());
    out.extend_from_slice(&height.to_be_bytes());
    out.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    out.extend_from_slice(&0u32.to_be_bytes());
    out.extend_from_slice(b"IEND");
    out.extend_from_slice(&[0, 0, 0, 0]);
    out
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// Un disegno di VectorCraft che piazza la foto, con o senza anteprima.
fn vectorcraft(with_preview: bool) -> Vec<u8> {
    let mut doc = serde_json::json!({
        "format_version": 4,
        "title": "Logo",
        "layers": [{ "type": "image", "href": "../Foto/IMG_0001.CR3" }],
    });
    if with_preview {
        doc["preview"] = serde_json::json!({
            "data": base64::engine::general_purpose::STANDARD.encode(png(64, 32)),
        });
    }
    serde_json::to_vec(&doc).unwrap()
}

/// Un `.pcraft` con la sola miniatura: chiesto grande, dà quella.
fn pcraft() -> Vec<u8> {
    let manifest = br#"{"format_version":"2","title":"Ritocco"}"#;
    zip_of(&[("manifest.json", manifest), ("thumb.png", &png(40, 30))])
}

fn figcraft() -> Vec<u8> {
    let document =
        br#"{"version":3,"name":"Schermate","pages":[{"text":"Il faro di Capo Testa"}]}"#;
    zip_of(&[
        ("document.json", document),
        ("thumbnail.png", &png(120, 80)),
    ])
}

const XMP: &str = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="4"><dc:subject><rdf:Bag><rdf:li>mareggiata</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>"#;

/// I file del vault, scritti dal test.
fn files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("Disegni/logo.vectorcraft", vectorcraft(true)),
        ("Disegni/bozza.vectorcraft", vectorcraft(false)),
        ("Foto/ritocco.pcraft", pcraft()),
        ("Schermate/app.figcraft", figcraft()),
        ("Foto/IMG_0001.CR3", b"RAW finto".to_vec()),
        ("Foto/IMG_0001-Edit.psd", b"8BPS finto".to_vec()),
        ("Foto/IMG_0001.xmp", XMP.as_bytes().to_vec()),
        ("Foto/IMG_0002.xmp", XMP.as_bytes().to_vec()),
        ("Nota.md", b"# Nota\n".to_vec()),
    ]
}

fn vault(disabled: &[&str]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (path, bytes) in files() {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    if !disabled.is_empty() {
        std::fs::create_dir_all(root.join(".fub")).unwrap();
        std::fs::write(
            root.join(".fub/settings.json"),
            serde_json::json!({"version": 1, "values": {"plugins.disabled": disabled}}).to_string(),
        )
        .unwrap();
    }
    (dir, root)
}

fn opened(root: &Utf8Path) -> Host {
    let host = Host::without_watcher();
    host.open(root).unwrap();
    host.wait_indexed(Some(root.as_str())).unwrap();
    host
}

fn ask(host: &Host, root: &Utf8Path, doc: &str, size: &str) -> Result<CraftPreview, PluginError> {
    ask_with(host, root, serde_json::json!({ "doc": doc, "size": size }))
}

fn ask_with(
    host: &Host,
    root: &Utf8Path,
    args: serde_json::Value,
) -> Result<CraftPreview, PluginError> {
    let outcome = host.invoke_user_command(
        Some(root.as_str()),
        PREVIEW_COMMAND,
        args,
        InvokeMode::Apply,
    )?;
    match outcome.effect {
        CommandEffect::Custom { ns, payload } => {
            assert_eq!(ns, "fub.craft");
            Ok(serde_json::from_value(payload).unwrap())
        }
        other => panic!("{other:?}"),
    }
}

fn bytes_of(root: &Utf8Path) -> BTreeMap<String, Vec<u8>> {
    files()
        .into_iter()
        .map(|(path, _)| (path.to_string(), std::fs::read(root.join(path)).unwrap()))
        .collect()
}

#[test]
fn every_craft_file_has_its_preview_small_and_large_and_nothing_is_written() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let before = bytes_of(&root);
    let with = [
        (
            "Disegni/logo.vectorcraft",
            "vectorcraft",
            Some("4"),
            (64, 32),
        ),
        ("Foto/ritocco.pcraft", "photocraft", Some("2"), (40, 30)),
        ("Schermate/app.figcraft", "figcraft", Some("3"), (120, 80)),
    ];
    for (doc, app, version, (width, height)) in with {
        for size in ["small", "large"] {
            let out = ask(&host, &root, doc, size).unwrap();
            assert_eq!(out.doc, doc);
            assert_eq!(out.size.as_str(), size);
            assert_eq!(out.origin, PreviewOrigin::File, "{doc} {size}");
            assert_eq!(out.info.app.id(), app);
            assert_eq!(out.info.format_version.as_deref(), version, "{doc}");
            assert_eq!(out.info.bytes, before[doc].len() as u64);
            assert!(!out.queued && out.render.is_none());
            assert_eq!(out.missing, None);
            let image = out.image.expect("l'immagine del file");
            assert_eq!(image.media_type, "image/png");
            assert_eq!(image.orientation, 1);
            assert_eq!((image.width, image.height), (width, height), "{doc} {size}");
            // La seconda chiamata dà la stessa anteprima.
            let again = ask(&host, &root, doc, size).unwrap();
            assert_eq!(again.revision, out.revision);
            assert_eq!(again.image.map(|i| i.data), Some(image.data));
        }
    }
    for size in ["small", "large"] {
        let out = ask(&host, &root, "Disegni/bozza.vectorcraft", size).unwrap();
        assert_eq!(out.origin, PreviewOrigin::None);
        assert!(out.image.is_none() && out.render.is_none() && !out.queued);
        assert_eq!(out.missing, Some(Missing::Absent));
        assert_eq!(out.info.editor, "VectorCraft");
    }
    assert_eq!(bytes_of(&root), before, "Fub non scrive i file Craft");
    // Il comando è di sola lettura: il kernel gli nega le scritture, anche
    // quella della cache, e l'anteprima arriva lo stesso.
    assert!(!cache_dir(&root).join("previews").exists());
}

/// La cartella della cache del bundle in `.fub/`.
fn cache_dir(root: &Utf8Path) -> Utf8PathBuf {
    root.join(".fub/data/plugins/fub.craft")
}

#[test]
fn the_cache_answers_when_it_matches_and_is_ignored_otherwise() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let doc = "Disegni/logo.vectorcraft";
    let fresh = ask(&host, &root, doc, "large").unwrap();
    let key = cache_key(&fresh.revision.as_ref().unwrap().0, PreviewSize::Large);
    let path = cache_dir(&root).join(&key);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();

    // Una voce che corrisponde risponde al posto del file.
    let mut planted = fresh.clone();
    planted.info.format_version = Some("dalla cache".into());
    std::fs::write(&path, serde_json::to_vec(&planted).unwrap()).unwrap();
    let out = ask(&host, &root, doc, "large").unwrap();
    assert_eq!(out.info.format_version.as_deref(), Some("dalla cache"));

    // Rotta, della versione 1 o di un altro documento: vale assente, e si
    // rifà dal file.
    let mut other_version = planted.clone();
    other_version.version = 1;
    let mut other_doc = planted.clone();
    other_doc.doc = "Disegni/bozza.vectorcraft".into();
    for bytes in [
        b"{rotta".to_vec(),
        serde_json::to_vec(&other_version).unwrap(),
        serde_json::to_vec(&other_doc).unwrap(),
    ] {
        std::fs::write(&path, bytes).unwrap();
        let out = ask(&host, &root, doc, "large").unwrap();
        assert_eq!(out.info.format_version.as_deref(), Some("4"));
        assert_eq!(out.origin, PreviewOrigin::File);
    }
}

#[test]
fn a_render_in_the_request_changes_nothing() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    for doc in ["Disegni/bozza.vectorcraft", "Disegni/logo.vectorcraft"] {
        let plain = ask(&host, &root, doc, "small").unwrap();
        let with_render = ask_with(
            &host,
            &root,
            serde_json::json!({ "doc": doc, "size": "small", "render": true }),
        )
        .unwrap();
        assert_eq!(with_render, plain, "{doc}");
        assert!(!with_render.queued && with_render.render.is_none());
    }
}

#[test]
fn a_raw_photo_is_a_subject_from_its_extension() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let out = ask(&host, &root, "Foto/IMG_0001.CR3", "large").unwrap();
    assert_eq!(out.info.app, PreviewSubject::Raw);
    assert_eq!(out.info.editor, "LightCraft");
    assert_eq!(out.info.bytes, b"RAW finto".len() as u64);
    // «RAW finto» non è un RAW: il lettore a pezzi (T27) lo dice illeggibile.
    assert_eq!(out.missing, Some(Missing::Unreadable));
    assert!(out.image.is_none() && out.render.is_none() && !out.queued);
    // Un allegato senza soggetto resta rifiutato.
    let error = ask(&host, &root, "Foto/IMG_0001-Edit.psd", "small").unwrap_err();
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
}

#[test]
fn two_requests_together_give_the_same_preview() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let (a, b) = std::thread::scope(|scope| {
        let a = scope.spawn(|| ask(&host, &root, "Schermate/app.figcraft", "small"));
        let b = scope.spawn(|| ask(&host, &root, "Schermate/app.figcraft", "small"));
        (a.join().unwrap().unwrap(), b.join().unwrap().unwrap())
    });
    assert_eq!(a, b);
}

#[test]
fn an_xmp_knows_its_photo_its_edit_and_its_keywords() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let out = ask(&host, &root, "Foto/IMG_0001.xmp", "small").unwrap();
    assert_eq!(out.info.app.id(), "xmp");
    assert_eq!(out.info.editor, "LightCraft");
    assert_eq!(out.info.photo.as_deref(), Some("Foto/IMG_0001.CR3"));
    assert_eq!(out.info.edits, ["Foto/IMG_0001-Edit.psd"]);
    let xmp = out.info.xmp.expect("l'XMP si legge");
    assert_eq!(xmp.rating, Some(4));
    assert_eq!(xmp.keywords, ["mareggiata"]);
    assert_eq!(out.origin, PreviewOrigin::None);

    // Senza foto accanto: niente foto e niente copie.
    let alone = ask(&host, &root, "Foto/IMG_0002.xmp", "small").unwrap();
    assert_eq!(alone.info.photo, None);
    assert!(alone.info.edits.is_empty());
    assert!(alone.info.xmp.is_some());
}

#[test]
fn a_document_that_is_not_craft_or_is_missing_is_an_error() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    let error = ask(&host, &root, "Nota.md", "small").unwrap_err();
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert!(
        !error.to_string().contains("not_craft"),
        "localizzato: {error}"
    );
    let error = ask(&host, &root, "Disegni/sparito.vectorcraft", "small").unwrap_err();
    assert!(
        matches!(error, PluginError::NotFound(_) | PluginError::BadArgs(_)),
        "{error:?}"
    );

    host.close_vault(&root).unwrap();
    assert!(ask(&host, &root, "Disegni/logo.vectorcraft", "small").is_err());
}

fn search(host: &Host, root: &Utf8Path, terms: &str) -> Vec<String> {
    match host.query_index(
        Some(root.as_str()),
        IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(terms))),
            sort: None,
            select: PropertySelect::None,
            page: Some(Page::first(50)),
            excerpts: Excerpts::Omit,
        },
    ) {
        Ok(IndexResult::Documents(hits)) => hits
            .items
            .into_iter()
            .map(|hit| hit.doc.to_string())
            .collect(),
        other => panic!("{other:?}"),
    }
}

fn backlinks(host: &Host, root: &Utf8Path, target: &str) -> Vec<String> {
    match host.query_index(
        Some(root.as_str()),
        IndexQuery::Backlinks {
            target: DocId::new(target),
            page: None,
        },
    ) {
        Ok(IndexResult::Backlinks(found)) => found
            .items
            .into_iter()
            .map(|link| link.source.to_string())
            .collect(),
        other => panic!("{other:?}"),
    }
}

fn tags(host: &Host, root: &Utf8Path) -> Vec<String> {
    match host.query_index(
        Some(root.as_str()),
        IndexQuery::Tags {
            matching: QueryExpr::default(),
            page: None,
        },
    ) {
        Ok(IndexResult::Tags(found)) => found.items.into_iter().map(|tag| tag.name).collect(),
        other => panic!("{other:?}"),
    }
}

fn kind_of(host: &Host, root: &Utf8Path, doc: &str) -> Option<EntryKind> {
    let Ok(IndexResult::Entries(entries)) = host.query_index(
        Some(root.as_str()),
        IndexQuery::Entries {
            of_kind: None,
            within: None,
            page: Some(Page::first(1000)),
        },
    ) else {
        panic!("l'anagrafe risponde")
    };
    entries
        .items
        .into_iter()
        .find(|entry| entry.id.as_str() == doc)
        .map(|entry| entry.kind)
}

/// Ricerca, backlink e tag sono dei formati: valgono col bundle acceso e
/// spento.
fn the_formats_serve(host: &Host, root: &Utf8Path) {
    assert_eq!(search(host, root, "Capo Testa"), ["Schermate/app.figcraft"]);
    let mut from = backlinks(host, root, "Foto/IMG_0001.CR3");
    from.sort();
    assert_eq!(
        from,
        ["Disegni/bozza.vectorcraft", "Disegni/logo.vectorcraft"]
    );
    assert!(tags(host, root).contains(&"mareggiata".to_string()));
    for doc in [
        "Disegni/logo.vectorcraft",
        "Foto/ritocco.pcraft",
        "Schermate/app.figcraft",
        "Foto/IMG_0001.xmp",
    ] {
        assert_eq!(kind_of(host, root, doc), Some(EntryKind::Document), "{doc}");
    }
}

#[test]
fn search_backlinks_and_tags_see_the_craft_files() {
    let (_dir, root) = vault(&[]);
    let host = opened(&root);
    the_formats_serve(&host, &root);
    let commands = host.commands(Some(root.as_str())).unwrap();
    assert!(commands.iter().any(|spec| spec.id == PREVIEW_COMMAND));
}

#[test]
fn with_the_component_off_the_command_goes_and_the_formats_stay() {
    let (_dir, root) = vault(&["fub.craft"]);
    let host = opened(&root);
    let commands = host.commands(Some(root.as_str())).unwrap();
    assert!(!commands.iter().any(|spec| spec.id == PREVIEW_COMMAND));
    assert!(ask(&host, &root, "Disegni/logo.vectorcraft", "small").is_err());
    the_formats_serve(&host, &root);
}

/// Un XMP di LightCraft col voto `rating`.
fn rated(rating: i8) -> Vec<u8> {
    XMP.replace("xmp:Rating=\"4\"", &format!("xmp:Rating=\"{rating}\""))
        .into_bytes()
}

/// Un vault con le foto e gli XMP di `files`, scritti dal test.
fn photo_vault(files: &[(&str, Vec<u8>)], disabled: &[&str]) -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    for (path, bytes) in files {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
    if !disabled.is_empty() {
        std::fs::create_dir_all(root.join(".fub")).unwrap();
        std::fs::write(
            root.join(".fub/settings.json"),
            serde_json::json!({"version": 1, "values": {"plugins.disabled": disabled}}).to_string(),
        )
        .unwrap();
    }
    (dir, root)
}

fn ask_photo(host: &Host, root: &Utf8Path, doc: &str) -> Result<PhotoSidecar, PluginError> {
    let outcome = host.invoke_user_command(
        Some(root.as_str()),
        PHOTO_COMMAND,
        serde_json::json!({ "doc": doc }),
        InvokeMode::Apply,
    )?;
    match outcome.effect {
        CommandEffect::Custom { ns, payload } => {
            assert_eq!(ns, "fub.craft");
            Ok(serde_json::from_value(payload).unwrap())
        }
        other => panic!("{other:?}"),
    }
}

/// Ogni file del vault fuori da `.fub/`, coi suoi byte.
fn all_bytes(root: &Utf8Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &std::path::Path, root: &std::path::Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.file_name().is_some_and(|name| name == ".fub") {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                let id = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(id, std::fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root.as_std_path(), root.as_std_path(), &mut out);
    out
}

fn photo_files() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        // Il nome intero, il gambo, tutti e due, nessuno.
        ("Foto/A.jpg", b"jpeg A".to_vec()),
        ("Foto/A.jpg.xmp", rated(1)),
        ("Foto/B.jpg", b"jpeg B".to_vec()),
        ("Foto/B.xmp", rated(2)),
        ("Foto/C.jpg", b"jpeg C".to_vec()),
        ("Foto/C.jpg.xmp", rated(3)),
        ("Foto/C.xmp", rated(5)),
        ("Foto/D.jpg", b"jpeg D".to_vec()),
        // Un XMP rotto.
        ("Foto/E.jpg", b"jpeg E".to_vec()),
        ("Foto/E.jpg.xmp", b"<x:xmpmeta><rotto".to_vec()),
        // Un RAW con la sua copia `-Edit.psd`.
        ("Foto/IMG_0001.CR3", b"RAW finto".to_vec()),
        ("Foto/IMG_0001-Edit.psd", b"8BPS finto".to_vec()),
        ("Foto/IMG_0001.xmp", rated(4)),
        // Un gambo per due foto; e una delle due col suo XMP.
        ("Foto/S.jpg", b"jpeg S".to_vec()),
        ("Foto/S.CR3", b"RAW S".to_vec()),
        ("Foto/S.xmp", rated(2)),
        ("Foto/T.jpg", b"jpeg T".to_vec()),
        ("Foto/T.CR3", b"RAW T".to_vec()),
        ("Foto/T.xmp", rated(1)),
        ("Foto/T.CR3.xmp", rated(5)),
        // L'XMP in un'altra cartella non conta.
        ("Foto/F.jpg", b"jpeg F".to_vec()),
        ("Altro/F.jpg.xmp", rated(3)),
        ("Altro/F.xmp", rated(3)),
        // Una cartella col nome di un candidato.
        ("Foto/G.jpg", b"jpeg G".to_vec()),
        ("Foto/G.jpg.xmp/dentro.md", b"# dentro\n".to_vec()),
        // Senza estensione.
        ("Foto/senza", b"?".to_vec()),
        ("Foto/senza.xmp", rated(4)),
    ]
}

#[test]
fn a_photo_finds_its_xmp_reads_it_and_writes_nothing() {
    let (_dir, root) = photo_vault(&photo_files(), &[]);
    let host = opened(&root);
    let before = all_bytes(&root);
    let rating = |out: &PhotoSidecar| out.meta.as_ref().and_then(|meta| meta.rating);

    let a = ask_photo(&host, &root, "Foto/A.jpg").unwrap();
    assert_eq!(a.version, 2);
    assert_eq!(a.doc, "Foto/A.jpg");
    assert_eq!(a.xmp.as_deref(), Some("Foto/A.jpg.xmp"));
    assert_eq!(rating(&a), Some(1));
    assert!(a.edits.is_empty());

    let b = ask_photo(&host, &root, "Foto/B.jpg").unwrap();
    assert_eq!(b.xmp.as_deref(), Some("Foto/B.xmp"));
    assert_eq!(rating(&b), Some(2));

    // Tutti e due: vince il nome intero.
    let c = ask_photo(&host, &root, "Foto/C.jpg").unwrap();
    assert_eq!(c.xmp.as_deref(), Some("Foto/C.jpg.xmp"));
    assert_eq!(rating(&c), Some(3));

    let d = ask_photo(&host, &root, "Foto/D.jpg").unwrap();
    assert_eq!((d.xmp, d.meta), (None, None));
    assert!(d.edits.is_empty());

    // Un XMP rotto: il suo nome, nessun dato.
    let e = ask_photo(&host, &root, "Foto/E.jpg").unwrap();
    assert_eq!(e.xmp.as_deref(), Some("Foto/E.jpg.xmp"));
    assert_eq!(e.meta, None);

    let raw = ask_photo(&host, &root, "Foto/IMG_0001.CR3").unwrap();
    assert_eq!(raw.xmp.as_deref(), Some("Foto/IMG_0001.xmp"));
    let meta = raw.meta.expect("l'XMP si legge");
    assert_eq!(meta.rating, Some(4));
    assert_eq!(meta.keywords, ["mareggiata"]);
    assert_eq!(raw.edits, ["Foto/IMG_0001-Edit.psd"]);

    // Un gambo vale per tutte le foto che non hanno il loro XMP.
    for doc in ["Foto/S.jpg", "Foto/S.CR3"] {
        let out = ask_photo(&host, &root, doc).unwrap();
        assert_eq!(out.xmp.as_deref(), Some("Foto/S.xmp"), "{doc}");
    }
    let t_jpg = ask_photo(&host, &root, "Foto/T.jpg").unwrap();
    assert_eq!(t_jpg.xmp.as_deref(), Some("Foto/T.xmp"));
    let t_raw = ask_photo(&host, &root, "Foto/T.CR3").unwrap();
    assert_eq!(t_raw.xmp.as_deref(), Some("Foto/T.CR3.xmp"));
    assert_eq!(rating(&t_raw), Some(5));

    // Un'altra cartella, o una cartella col nome giusto, non contano.
    for doc in ["Foto/F.jpg", "Foto/G.jpg"] {
        let out = ask_photo(&host, &root, doc).unwrap();
        assert_eq!((out.xmp, out.meta), (None, None), "{doc}");
    }

    // Senza estensione: soltanto il nome intero più `.xmp`.
    let bare = ask_photo(&host, &root, "Foto/senza").unwrap();
    assert_eq!(bare.xmp.as_deref(), Some("Foto/senza.xmp"));

    // Un documento che è già un XMP non ha un XMP suo.
    let own = ask_photo(&host, &root, "Foto/IMG_0001.xmp").unwrap();
    assert_eq!((own.xmp, own.meta), (None, None));
    assert!(own.edits.is_empty());

    assert_eq!(
        all_bytes(&root),
        before,
        "Fub non scrive né le foto né gli XMP"
    );
    assert!(!cache_dir(&root).exists(), "il comando non scrive la cache");
}

#[test]
fn the_photo_command_refuses_a_missing_doc_and_a_closed_vault() {
    let (_dir, root) = photo_vault(&photo_files(), &[]);
    let host = opened(&root);
    let error = ask_photo(&host, &root, "Foto/sparita.jpg").unwrap_err();
    assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
    assert!(
        !error.to_string().contains("photo.missing"),
        "localizzato: {error}"
    );
    let commands = host.commands(Some(root.as_str())).unwrap();
    let spec = commands
        .iter()
        .find(|spec| spec.id == PHOTO_COMMAND)
        .expect("il comando c'è col componente acceso");
    assert!(!spec.scope.writes, "{:?}", spec.scope);

    host.close_vault(&root).unwrap();
    assert!(ask_photo(&host, &root, "Foto/A.jpg").is_err());
}

#[test]
fn with_the_component_off_the_photo_command_goes() {
    let (_dir, root) = photo_vault(&photo_files(), &["fub.craft"]);
    let host = opened(&root);
    let commands = host.commands(Some(root.as_str())).unwrap();
    assert!(!commands.iter().any(|spec| spec.id == PHOTO_COMMAND));
    assert!(ask_photo(&host, &root, "Foto/A.jpg").is_err());
}
