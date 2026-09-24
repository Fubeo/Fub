use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::format::{DocumentSource, FormatProvider, ParseContext, RenderOptions, RenderTarget};
use fub_abi::model::DocId;
use fub_abi::traits::{IndexQuery, IndexResult};
use fub_abi::ui::UiKind;
use fub_format_base::{BaseProvider, BASE_EMBED_NS};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

const SOURCE: &str =
    "views:\n  - {name: Table, type: table}\n  - {name: Board, type: table}\nproperties: []\n";

#[test]
fn file_backed_base_embeds_select_views_without_losing_source_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::create_dir(root.join("views")).unwrap();
    std::fs::write(root.join("views/foo.base"), SOURCE).unwrap();
    std::fs::write(
        root.join("note.md"),
        "![[views/foo.base]]\n![[views/foo.base#Board]]\n",
    )
    .unwrap();
    let mut mounted = fub_host::mount::mount(
        &root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .unwrap();
    mounted.workspace.reindex().unwrap();
    let markdown = mounted
        .workspace
        .render_preview(&DocId::new("note.md"))
        .unwrap();
    assert!(
        markdown.html.contains("data-embed-page=\"views/foo.base\""),
        "{}",
        markdown.html
    );
    assert!(
        markdown.html.contains("data-embed-heading=\"Board\""),
        "{}",
        markdown.html
    );
    assert_eq!(
        mounted
            .workspace
            .render_preview(&DocId::new("views/foo.base"))
            .unwrap()
            .parts
            .len(),
        1
    );

    for (heading, expected) in [(None, "Table"), (Some("Board"), "Board")] {
        let (id, rendered) = mounted
            .workspace
            .render_embed("views/foo.base", heading, None)
            .unwrap();
        assert_eq!(id, DocId::new("views/foo.base"));
        assert_eq!(rendered.parts.len(), 1);
        assert!(
            rendered.html.contains("data-ui-slot=\"0\""),
            "{}",
            rendered.html
        );
        let UiKind::Custom { ns, payload, .. } = &rendered.parts[0].node.kind else {
            panic!("Base must be a declarative custom part");
        };
        assert_eq!(ns, BASE_EMBED_NS);
        assert_eq!(payload["source"], SOURCE);
        assert_eq!(payload["view"], expected);

        let IndexResult::RenderEmbed(via_query) = mounted
            .workspace
            .query_index(IndexQuery::RenderEmbed {
                page: "views/foo.base".into(),
                heading: heading.map(str::to_string),
                block: None,
            })
            .unwrap()
        else {
            panic!("generic query did not render an embed")
        };
        assert_eq!(via_query.content.parts[0].node, rendered.parts[0].node);
    }
    let missing = mounted
        .workspace
        .render_embed("views/foo.base", Some("Missing"), None)
        .unwrap_err();
    assert!(missing.to_string().contains("Missing"));
    assert!(mounted
        .workspace
        .query_index(IndexQuery::RenderEmbed {
            page: "views/foo.base".into(),
            heading: Some("Missing".into()),
            block: None,
        })
        .is_err());
    assert!(mounted
        .workspace
        .render_embed("views/foo.base", None, Some("Board"))
        .is_err());

    let provider = BaseProvider::new();
    let hostile = format!("{SOURCE}# <script>alert('x')</script>&\n");
    let model = provider
        .parse(
            &DocumentSource::Text(hostile),
            &ParseContext::bare("views/foo.base"),
        )
        .unwrap();
    let static_options = RenderOptions {
        target: RenderTarget::StaticSite,
        ..RenderOptions::default()
    };
    let static_html = provider.render_html(&model, &static_options).unwrap();
    assert!(static_html.contains("block-base-source"));
    assert!(static_html.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;"));
    assert!(!static_html.contains("<script"));

    for unsupported in [
        "version: 999\nviews:\n  - {name: X, type: table}\n",
        "views: [invalid\n",
        "views: []\n",
    ] {
        let model = provider
            .parse(
                &DocumentSource::Text(unsupported.into()),
                &ParseContext::bare("views/foo.base"),
            )
            .unwrap();
        assert_eq!(model.body.len(), 1);
        let html = provider
            .render_html(&model, &RenderOptions::preview())
            .unwrap();
        assert!(html.contains(unsupported.trim_end()));
        std::fs::write(root.join("views/foo.base"), unsupported).unwrap();
        mounted.workspace.reindex().unwrap();
        let (_, rendered) = mounted
            .workspace
            .render_embed("views/foo.base", None, None)
            .unwrap();
        assert!(rendered.parts.is_empty());
        assert!(rendered.html.contains(unsupported.trim_end()));
        assert!(mounted
            .workspace
            .render_embed("views/foo.base", Some("Missing"), None)
            .is_err());
    }
}
