//! I quattro provider dei file Craft: il contratto dei formati, i descrittori,
//! il rifiuto di scrivere, la figura della resa e il modello vuoto di un file
//! che non si legge.

use fub_abi::model::DocumentModel;
use fub_abi::{
    DocumentSource, FormatError, FormatProvider, ParseContext, RenderOptions, SourceKind,
};
use fub_format_craft::{
    providers, CraftApp, CraftProvider, FIGCRAFT_FORMAT_ID, PHOTOCRAFT_FORMAT_ID,
    VECTORCRAFT_FORMAT_ID, XMP_FORMAT_ID,
};
use fub_sdk::testing::conformance;

fn doc_of(app: CraftApp) -> String {
    format!("Disegni/prova.{}", app.extensions()[0])
}

fn parse(app: CraftApp, bytes: Vec<u8>, doc: &str) -> Result<DocumentModel, FormatError> {
    CraftProvider::new(app).parse(&DocumentSource::Bytes(bytes), &ParseContext::bare(doc))
}

/// Byte pseudo-casuali ma ripetibili: un generatore congruenziale con il seme.
fn noise(seed: u64, len: usize) -> Vec<u8> {
    let mut state = seed;
    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 33) as u8
        })
        .collect()
}

#[test]
fn i_quattro_formati_rispettano_il_contratto() {
    let all = providers();
    assert_eq!(all.len(), 4);
    for provider in &all {
        conformance::a_format_respects_the_contract(provider.as_ref());
    }
    for app in CraftApp::ALL {
        conformance::a_format_respects_the_contract(&CraftProvider::new(app));
    }
}

#[test]
fn i_descrittori_dicono_id_estensione_e_byte() {
    let seen: Vec<_> = providers()
        .iter()
        .map(|provider| {
            let descriptor = provider.descriptor();
            assert_eq!(descriptor.source, SourceKind::Bytes, "{}", descriptor.id);
            (descriptor.id, descriptor.extensions)
        })
        .collect();
    let expected = [
        (VECTORCRAFT_FORMAT_ID, "vectorcraft"),
        (PHOTOCRAFT_FORMAT_ID, "pcraft"),
        (FIGCRAFT_FORMAT_ID, "figcraft"),
        (XMP_FORMAT_ID, "xmp"),
    ]
    .map(|(id, extension)| (id.to_owned(), vec![extension.to_owned()]));
    assert_eq!(seen, expected);
}

#[test]
fn ogni_famiglia_si_ritrova_dal_suo_id() {
    for app in CraftApp::ALL {
        assert_eq!(CraftApp::of_format(app.format_id()), Some(app));
    }
    assert_eq!(CraftApp::of_format("svg"), None);
    assert_eq!(CraftApp::of_format(""), None);
    // L'id si confronta così com'è scritto.
    assert_eq!(CraftApp::of_format("CRAFT-XMP"), None);
    assert_eq!(
        CraftApp::ALL.map(CraftApp::editor),
        ["vectorcraft", "photocraft", "figcraft", "lightcraft"]
    );
}

#[test]
fn il_testo_non_è_di_questi_formati() {
    for app in CraftApp::ALL {
        let refused = CraftProvider::new(app).parse(
            &DocumentSource::Text("{}".into()),
            &ParseContext::bare(doc_of(app)),
        );
        let Err(FormatError::Unsupported { format, got }) = refused else {
            panic!("{app:?}: {refused:?}");
        };
        assert_eq!((format.as_str(), got), (app.format_id(), SourceKind::Text));
    }
}

#[test]
fn fub_non_scrive_mai_un_file_craft() {
    for app in CraftApp::ALL {
        let provider = CraftProvider::new(app);
        let model = parse(app, Vec::new(), &doc_of(app)).unwrap();
        let Err(FormatError::Unsupported { format, got }) = provider.serialize(&model) else {
            panic!("{app:?} scrive");
        };
        assert_eq!((format.as_str(), got), (app.format_id(), SourceKind::Text));
        let rewritten = provider
            .rewrite_links(
                &DocumentSource::Bytes(Vec::new()),
                &ParseContext::bare(doc_of(app)),
                &[],
            )
            .unwrap();
        assert_eq!(rewritten, None);
    }
}

#[test]
fn la_resa_è_la_figura_con_il_nome_del_file() {
    let doc = "Disegni/a \"b\" <c> & d.vectorcraft";
    let model = parse(CraftApp::VectorCraft, Vec::new(), doc).unwrap();
    let html = CraftProvider::new(CraftApp::VectorCraft)
        .render_html(&model, &RenderOptions::default())
        .unwrap();
    assert_eq!(
        html,
        "<figure class=\"fub-craft\" data-embed-kind=\"craft\" \
         data-embed-doc=\"Disegni/a &quot;b&quot; &lt;c&gt; &amp; d.vectorcraft\" \
         data-craft-app=\"vectorcraft\"><figcaption>a &quot;b&quot; &lt;c&gt; &amp; \
         d.vectorcraft</figcaption></figure>"
    );

    let model = parse(CraftApp::Xmp, Vec::new(), "IMG_0001.CR3.xmp").unwrap();
    let html = CraftProvider::new(CraftApp::Xmp)
        .render_html(&model, &RenderOptions::default())
        .unwrap();
    assert_eq!(
        html,
        "<figure class=\"fub-craft\" data-embed-kind=\"craft-xmp\" \
         data-embed-doc=\"IMG_0001.CR3.xmp\" data-craft-app=\"xmp\">\
         <figcaption>IMG_0001.CR3.xmp</figcaption></figure>"
    );

    for (app, name) in [
        (CraftApp::PhotoCraft, "photocraft"),
        (CraftApp::FigCraft, "figcraft"),
    ] {
        let model = parse(app, Vec::new(), &doc_of(app)).unwrap();
        let html = CraftProvider::new(app)
            .render_html(&model, &RenderOptions::default())
            .unwrap();
        assert!(html.contains(" data-embed-kind=\"craft\""), "{html}");
        assert!(
            html.contains(&format!(" data-craft-app=\"{name}\"")),
            "{html}"
        );
    }
}

#[test]
fn un_file_illeggibile_dà_il_modello_vuoto() {
    let truncated_zip = b"PK\x03\x04\x14\x00\x00\x00".to_vec();
    let truncated_gzip = vec![0x1f, 0x8b, 0x08];
    for app in CraftApp::ALL {
        let doc = doc_of(app);
        let ctx = ParseContext::bare(doc.as_str());
        let inputs = [
            Vec::new(),
            noise(1, 512),
            noise(app as u64 + 7, 4096),
            truncated_zip.clone(),
            truncated_gzip.clone(),
            b"{\"title\":".to_vec(),
        ];
        for bytes in inputs {
            let model = parse(app, bytes, &doc).unwrap();
            conformance::the_model_matches_the_given_id(&model, &ctx);
            assert_eq!(model, DocumentModel::empty(model.id.clone()), "{app:?}");
        }
    }
}
