//! La fixture che lega la shell al contratto dell'anteprima:
//! `craft-preview.json` porta alcuni `CraftPreview` come serde li scrive (con
//! l'immagine e senza, di un XMP, con l'offerta di farla, in coda), e i nomi
//! del comando, del job e del bundle. `apps/client/src/host/craft.test.ts` li
//! legge con `readCraftPreview`. La scrive questo file con `UPDATE_MIRROR=1`.

use std::path::PathBuf;

use base64::Engine as _;
use fub_abi::Revision;
use fub_format_craft::xmp::Flag;
use fub_format_craft::{
    CraftApp, CraftPreview, PreviewImage, PreviewInfo, PreviewOrigin, PreviewSize, RenderOffer,
    XmpInfo, BUNDLE_NS, PREVIEW_COMMAND, PREVIEW_VERSION, RENDER_JOB,
};
use serde_json::{json, Value};

/// Un sole arancio su un cielo azzurro, 12×12.
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAALUlEQVR42mPYcv0DQcRAsqJPM/XgCLsiZBVo6hhwqUBWNzCKiHI4sUFAaYgDALeJPdjKdhNUAAAAAElFTkSuQmCC";

fn client(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src")
        .join(path)
}

fn info(app: CraftApp, format_version: Option<&str>, bytes: u64) -> PreviewInfo {
    PreviewInfo {
        app,
        editor: app.editor_name().to_owned(),
        format_version: format_version.map(str::to_owned),
        bytes,
        photo: None,
        edits: Vec::new(),
        xmp: None,
    }
}

fn samples() -> Vec<CraftPreview> {
    let png = base64::engine::general_purpose::STANDARD
        .decode(PNG)
        .unwrap();
    let image = PreviewImage::from_png(&png).unwrap();
    assert_eq!((image.width, image.height), (12, 12));
    let revision = |bytes: &[u8]| Revision::of_bytes(bytes);
    vec![
        // L'anteprima che il disegno porta.
        CraftPreview {
            version: PREVIEW_VERSION,
            doc: "Disegni/logo.vectorcraft".into(),
            revision: revision(b"logo"),
            size: PreviewSize::Small,
            origin: PreviewOrigin::File,
            queued: false,
            image: Some(image.clone()),
            info: info(CraftApp::VectorCraft, Some("4"), 182_344),
            render: None,
        },
        // Fatta dalla riga di comando, per la scheda.
        CraftPreview {
            version: PREVIEW_VERSION,
            doc: "Disegni/logo.vectorcraft".into(),
            revision: revision(b"logo"),
            size: PreviewSize::Large,
            origin: PreviewOrigin::Cli,
            queued: false,
            image: Some(image),
            info: info(CraftApp::VectorCraft, Some("4"), 182_344),
            render: None,
        },
        // Senza anteprima, con l'app che può farla.
        CraftPreview {
            version: PREVIEW_VERSION,
            doc: "Foto/ritratto.pcraft".into(),
            revision: revision(b"ritratto"),
            size: PreviewSize::Large,
            origin: PreviewOrigin::None,
            queued: false,
            image: None,
            info: info(CraftApp::PhotoCraft, Some("2"), 4_096),
            render: Some(RenderOffer {
                app: CraftApp::PhotoCraft.editor_name().to_owned(),
            }),
        },
        // La risposta che ha messo in coda il job.
        CraftPreview {
            version: PREVIEW_VERSION,
            doc: "Progetti/sito.figcraft".into(),
            revision: revision(b"sito"),
            size: PreviewSize::Small,
            origin: PreviewOrigin::None,
            queued: true,
            image: None,
            info: info(CraftApp::FigCraft, None, 0),
            render: None,
        },
        // Un XMP con la sua foto e la copia modificata.
        CraftPreview {
            version: PREVIEW_VERSION,
            doc: "Foto/IMG_0001.CR3.xmp".into(),
            revision: revision(b"xmp"),
            size: PreviewSize::Small,
            origin: PreviewOrigin::None,
            queued: false,
            image: None,
            info: PreviewInfo {
                photo: Some("Foto/IMG_0001.CR3".into()),
                edits: vec!["Foto/IMG_0001-Edit.psd".into()],
                xmp: Some(XmpInfo {
                    rating: Some(4),
                    label: Some("Rosso".into()),
                    flag: Some(Flag::Pick),
                    keywords: vec!["New York".into(), "mare".into()],
                }),
                ..info(CraftApp::Xmp, None, 2_311)
            },
            render: None,
        },
        // Un XMP scartato, senza foto accanto.
        CraftPreview {
            version: PREVIEW_VERSION,
            doc: "IMG.xmp".into(),
            revision: revision(b"scartata"),
            size: PreviewSize::Large,
            origin: PreviewOrigin::None,
            queued: false,
            image: None,
            info: PreviewInfo {
                xmp: Some(XmpInfo {
                    rating: Some(-1),
                    label: None,
                    flag: Some(Flag::Reject),
                    keywords: Vec::new(),
                }),
                ..info(CraftApp::Xmp, None, 120)
            },
            render: None,
        },
    ]
}

fn fixture() -> Value {
    let samples = samples();
    // La forma torna uguale da serde: la fixture è il contratto, non un caso.
    for sample in &samples {
        let back: CraftPreview =
            serde_json::from_value(serde_json::to_value(sample).unwrap()).unwrap();
        assert_eq!(&back, sample);
    }
    json!({
        "version": PREVIEW_VERSION,
        "command": PREVIEW_COMMAND,
        "job": RENDER_JOB,
        "ns": BUNDLE_NS,
        "samples": samples,
    })
}

#[test]
fn la_fixture_della_shell_è_il_contratto_dell_anteprima() {
    let fixture = fixture();
    let path = client("__fixtures__/craft-preview.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        // Sempre `\n`, su ogni macchina: la fixture è committata.
        let mut out = serde_json::to_string_pretty(&fixture).unwrap();
        out.push('\n');
        std::fs::write(&path, out).expect("scrive la fixture");
        return;
    }
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let value: Value = serde_json::from_str(&raw).expect("fixture JSON");
    assert_eq!(
        value, fixture,
        "la fixture della shell è stantia: rigenerala con \
         `UPDATE_MIRROR=1 cargo test -p fub-format-craft --test ts_preview`"
    );
}

#[test]
fn i_nomi_json_sono_quelli_del_contratto() {
    let value = serde_json::to_value(&samples()[4]).unwrap();
    assert_eq!(value["size"], "small");
    assert_eq!(value["origin"], "none");
    assert_eq!(value["info"]["app"], "xmp");
    assert_eq!(value["info"]["editor"], "LightCraft");
    assert_eq!(value["info"]["xmp"]["flag"], "pick");
    assert_eq!(value["image"], Value::Null);
    assert_eq!(value["render"], Value::Null);
    assert!(value["revision"].is_string());
    let value = serde_json::to_value(&samples()[1]).unwrap();
    assert_eq!(value["origin"], "cli");
    assert_eq!(value["image"]["media_type"], "image/png");
}
