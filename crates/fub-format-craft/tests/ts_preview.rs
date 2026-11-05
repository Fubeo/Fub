//! La fixture che lega la shell al contratto dell'anteprima:
//! `craft-preview.json` porta alcuni `CraftPreview` come serde li scrive (un
//! esempio per ogni soggetto, ogni motivo per cui l'immagine manca e ogni
//! consenso, un PNG e un JPEG ruotato, con la revisione e senza), alcuni
//! `PhotoSidecar` (con l'XMP e senza), e i nomi dei comandi, del job e del
//! bundle. `apps/client/src/host/craft.test.ts` li legge con
//! `readCraftPreview` e `readPhotoSidecar`. La scrive questo file con
//! `UPDATE_MIRROR=1 cargo test -p fub-format-craft --test ts_preview`.

use std::path::PathBuf;

use base64::Engine as _;
use fub_abi::Revision;
use fub_format_craft::xmp::Flag;
use fub_format_craft::{
    CraftPreview, Missing, PhotoSidecar, PreviewImage, PreviewInfo, PreviewOrigin, PreviewSize,
    PreviewSubject, RenderConsent, RenderOffer, XmpInfo, BUNDLE_NS, PHOTO_COMMAND, PREVIEW_COMMAND,
    PREVIEW_VERSION, RENDER_JOB,
};
use serde_json::{json, Value};

/// Un sole arancio su un cielo azzurro, 12×12.
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAALUlEQVR42mPYcv0DQcRAsqJPM/XgCLsiZBVo6hhwqUBWNzCKiHI4sUFAaYgDALeJPdjKdhNUAAAAAElFTkSuQmCC";

/// Il peso massimo dell'esempio `over_limit`: 64 MiB.
const LIMIT: u64 = 64 * 1024 * 1024;

fn client(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src")
        .join(path)
}

fn info(app: PreviewSubject, format_version: Option<&str>, bytes: u64) -> PreviewInfo {
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

/// L'intestazione di un JPEG 1620×1080: `SOI`, un `SOF0` di un componente,
/// `EOI`. Basta alle misure; la shell non la decodifica nei test.
fn jpeg() -> Vec<u8> {
    let mut out = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x0B, 8];
    out.extend_from_slice(&1080u16.to_be_bytes());
    out.extend_from_slice(&1620u16.to_be_bytes());
    out.extend_from_slice(&[1, 1, 0x11, 0, 0xFF, 0xD9]);
    out
}

fn revision(bytes: &[u8]) -> Option<Revision> {
    Some(Revision::of_bytes(bytes))
}

/// L'anteprima senza immagine di `doc`, per il motivo `missing`.
fn without_image(
    doc: &str,
    size: PreviewSize,
    missing: Missing,
    info: PreviewInfo,
) -> CraftPreview {
    CraftPreview {
        version: PREVIEW_VERSION,
        doc: doc.into(),
        revision: revision(doc.as_bytes()),
        size,
        origin: PreviewOrigin::None,
        queued: false,
        image: None,
        missing: Some(missing),
        limit_bytes: None,
        info,
        render: None,
    }
}

fn offer(subject: PreviewSubject, consent: RenderConsent) -> Option<RenderOffer> {
    Some(RenderOffer {
        app: subject.editor_name().to_owned(),
        consent,
    })
}

fn samples() -> Vec<CraftPreview> {
    let png = base64::engine::general_purpose::STANDARD
        .decode(PNG)
        .unwrap();
    let image = PreviewImage::from_png(&png).unwrap();
    assert_eq!((image.width, image.height, image.orientation), (12, 12, 1));
    let photo = PreviewImage::from_jpeg(&jpeg(), 6).unwrap();
    assert_eq!((photo.width, photo.height), (1620, 1080));
    let with_image = |doc: &str, size, origin, image: &PreviewImage, info| CraftPreview {
        version: PREVIEW_VERSION,
        doc: String::from(doc),
        revision: revision(doc.as_bytes()),
        size,
        origin,
        queued: false,
        image: Some(image.clone()),
        missing: None,
        limit_bytes: None,
        info,
        render: None,
    };
    vec![
        // L'anteprima che il disegno porta.
        with_image(
            "Disegni/logo.vectorcraft",
            PreviewSize::Small,
            PreviewOrigin::File,
            &image,
            info(PreviewSubject::VectorCraft, Some("4"), 182_344),
        ),
        // Fatta dalla riga di comando, per la scheda.
        with_image(
            "Disegni/logo.vectorcraft",
            PreviewSize::Large,
            PreviewOrigin::Cli,
            &image,
            info(PreviewSubject::VectorCraft, Some("4"), 182_344),
        ),
        // Senza anteprima, con l'app che può farla e la domanda.
        CraftPreview {
            render: offer(PreviewSubject::PhotoCraft, RenderConsent::Ask),
            ..without_image(
                "Foto/ritratto.pcraft",
                PreviewSize::Large,
                Missing::Absent,
                info(PreviewSubject::PhotoCraft, Some("2"), 4_096),
            )
        },
        // La risposta che ha messo in coda il job, col consenso già dato.
        CraftPreview {
            queued: true,
            render: offer(PreviewSubject::FigCraft, RenderConsent::On),
            ..without_image(
                "Progetti/sito.figcraft",
                PreviewSize::Small,
                Missing::Absent,
                info(PreviewSubject::FigCraft, None, 0),
            )
        },
        // Un XMP con la sua foto e la copia modificata.
        without_image(
            "Foto/IMG_0001.CR3.xmp",
            PreviewSize::Small,
            Missing::Absent,
            PreviewInfo {
                photo: Some("Foto/IMG_0001.CR3".into()),
                edits: vec!["Foto/IMG_0001-Edit.psd".into()],
                xmp: Some(XmpInfo {
                    rating: Some(4),
                    label: Some("Rosso".into()),
                    flag: Some(Flag::Pick),
                    keywords: vec!["New York".into(), "mare".into()],
                }),
                ..info(PreviewSubject::Xmp, None, 2_311)
            },
        ),
        // Un XMP scartato, senza foto accanto.
        without_image(
            "IMG.xmp",
            PreviewSize::Large,
            Missing::Absent,
            PreviewInfo {
                xmp: Some(XmpInfo {
                    rating: Some(-1),
                    label: None,
                    flag: Some(Flag::Reject),
                    keywords: Vec::new(),
                }),
                ..info(PreviewSubject::Xmp, None, 120)
            },
        ),
        // Il JPEG di un RAW, girato, letto a pezzi: senza revisione.
        CraftPreview {
            revision: None,
            ..with_image(
                "Foto/IMG_0001.CR3",
                PreviewSize::Large,
                PreviewOrigin::File,
                &photo,
                info(PreviewSubject::Raw, None, 31_457_280),
            )
        },
        // Un PDF oltre il peso massimo.
        CraftPreview {
            limit_bytes: Some(LIMIT),
            ..without_image(
                "Libri/manuale.pdf",
                PreviewSize::Small,
                Missing::OverLimit,
                info(PreviewSubject::Pdf, None, LIMIT + 1),
            )
        },
        // Un documento che l'app non è riuscita a mostrare, con le anteprime
        // spente.
        CraftPreview {
            render: offer(PreviewSubject::Document, RenderConsent::Off),
            ..without_image(
                "Lettere/lettera.docx",
                PreviewSize::Large,
                Missing::Failed,
                info(PreviewSubject::Document, None, 18_000),
            )
        },
        // Un disegno rotto.
        without_image(
            "Disegni/rotto.vectorcraft",
            PreviewSize::Small,
            Missing::Unreadable,
            info(PreviewSubject::VectorCraft, None, 9),
        ),
    ]
}

/// I dati di una foto: con l'XMP accanto e senza.
fn photos() -> Vec<PhotoSidecar> {
    vec![
        PhotoSidecar {
            version: PREVIEW_VERSION,
            doc: "Foto/IMG_0001.CR3".into(),
            xmp: Some("Foto/IMG_0001.CR3.xmp".into()),
            meta: Some(XmpInfo {
                rating: Some(4),
                label: Some("Rosso".into()),
                flag: Some(Flag::Pick),
                keywords: vec!["New York".into(), "mare".into()],
            }),
            edits: vec!["Foto/IMG_0001-Edit.psd".into()],
        },
        PhotoSidecar {
            version: PREVIEW_VERSION,
            doc: "Foto/IMG_0002.NEF".into(),
            xmp: None,
            meta: None,
            edits: Vec::new(),
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
    let photos = photos();
    for photo in &photos {
        let back: PhotoSidecar =
            serde_json::from_value(serde_json::to_value(photo).unwrap()).unwrap();
        assert_eq!(&back, photo);
    }
    json!({
        "version": PREVIEW_VERSION,
        "command": PREVIEW_COMMAND,
        "photo_command": PHOTO_COMMAND,
        "job": RENDER_JOB,
        "ns": BUNDLE_NS,
        "samples": samples,
        "photos": photos,
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
    assert_eq!(value["missing"], "absent");
    assert_eq!(value["limit_bytes"], Value::Null);
    assert!(value["revision"].is_string());
    let value = serde_json::to_value(&samples()[1]).unwrap();
    assert_eq!(value["origin"], "cli");
    assert_eq!(value["image"]["media_type"], "image/png");
    assert_eq!(value["image"]["orientation"], 1);
    assert_eq!(value["missing"], Value::Null);
    let value = serde_json::to_value(&samples()[6]).unwrap();
    assert_eq!(value["info"]["app"], "raw");
    assert_eq!(value["image"]["media_type"], "image/jpeg");
    assert_eq!(value["revision"], Value::Null);
    let value = serde_json::to_value(&samples()[7]).unwrap();
    assert_eq!(value["missing"], "over_limit");
    assert_eq!(value["limit_bytes"], LIMIT);
    let value = serde_json::to_value(&samples()[2]).unwrap();
    assert_eq!(
        value["render"],
        json!({ "app": "PhotoCraft", "consent": "ask" })
    );
}

#[test]
fn la_fixture_ha_ogni_variante_del_contratto() {
    let samples = samples();
    for subject in PreviewSubject::ALL {
        assert!(
            samples.iter().any(|sample| sample.info.app == subject),
            "manca il soggetto {subject:?}"
        );
    }
    for missing in Missing::ALL {
        assert!(
            samples.iter().any(|sample| sample.missing == Some(missing)),
            "manca il motivo {missing:?}"
        );
    }
    for consent in RenderConsent::ALL {
        assert!(
            samples
                .iter()
                .any(|sample| sample.render.as_ref().map(|r| r.consent) == Some(consent)),
            "manca il consenso {consent:?}"
        );
    }
    assert!(samples.iter().any(|sample| sample
        .image
        .as_ref()
        .is_some_and(|image| image.media_type == "image/jpeg" && image.orientation == 6)));
    assert!(samples.iter().any(|sample| sample.revision.is_some()));
    assert!(samples.iter().any(|sample| sample.revision.is_none()));
    // `missing` c'è solo senza immagine, `limit_bytes` solo con `over_limit`.
    for sample in &samples {
        assert_eq!(
            sample.image.is_none(),
            sample.missing.is_some(),
            "{}",
            sample.doc
        );
        assert_eq!(
            sample.limit_bytes.is_some(),
            sample.missing == Some(Missing::OverLimit),
            "{}",
            sample.doc
        );
    }
    let photos = photos();
    assert!(photos.iter().any(|photo| photo.xmp.is_some()));
    assert!(photos.iter().any(|photo| photo.xmp.is_none()));
}
