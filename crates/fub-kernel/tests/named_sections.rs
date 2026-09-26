//! **Sezioni nominate dichiarate dal provider.**
//!
//! `[[x.base#Vista]]` sceglieva una vista perché il kernel riconosceva
//! l'estensione `.base` e il kind `base`. Ora la regola sta nel contratto: un
//! documento fatto di un solo blocco custom dichiara le proprie sezioni in
//! `attrs[SECTIONS_ATTR]`, e il kernel consegna la scelta in
//! `attrs[SECTION_ATTR]` qualunque sia il formato. Qui il formato è inventato
//! apposta: né l'estensione né il kind hanno a che fare con Base.

use camino::Utf8PathBuf;
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SECTIONS_ATTR, SECTION_ATTR,
};
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, ParseContext,
    RenderOptions,
};
use fub_abi::model::{heading_slug, Block, DocId, DocumentModel, Heading, Span};
use fub_abi::traits::{PluginManifest, PluginPermissions};
use fub_kernel::{FormatRegistry, KernelError, Trust, Workspace};
use serde_json::json;

const KIND: &str = "test.one:tavola";

// --- un formato e un renderer di prova --------------------------------------

/// Una sorgente `sezioni: A, B` diventa un solo blocco custom che dichiara le
/// sezioni `A` e `B`. `# Titolo` diventa lo stesso blocco senza dichiarazione,
/// con il suo heading nell'outline.
struct Tavola;

impl FormatProvider for Tavola {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("test.tavola", "Tavola", &["tavola"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().unwrap_or_default();
        let span = Span {
            start: 0,
            end: text.len(),
        };
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = text.to_string();
        let mut attrs = json!({ "source": text });
        if let Some(names) = text.trim().strip_prefix("sezioni:") {
            attrs[SECTIONS_ATTR] = json!(names.split(',').map(str::trim).collect::<Vec<_>>());
        }
        if let Some(title) = text.trim().strip_prefix("# ") {
            model.outline.push(Heading {
                level: 1,
                text: title.to_string(),
                slug: heading_slug(title),
                span,
                explicit_anchor: None,
            });
        }
        model.body.push(Block::Custom {
            custom_kind: KIND.into(),
            attrs,
            blocks: vec![],
            anchor: None,
            span,
        });
        Ok(model)
    }

    fn render_html(&self, _m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(String::new())
    }

    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

/// Disegna la sezione che il kernel gli ha consegnato, o `intera`.
struct Scelta;

impl CustomRenderer for Scelta {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: "test.one:scelta".into(),
            kinds: vec![KIND.into()],
        }
    }

    fn render(
        &self,
        block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let section = block
            .attrs
            .get(SECTION_ATTR)
            .and_then(|value| value.as_str())
            .unwrap_or("intera");
        Ok(CustomRendering::Html(format!("<p>{section}</p>")))
    }
}

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    std::fs::write(root.join("viste.tavola"), "sezioni: Uno, Due").unwrap();
    std::fs::write(root.join("piatta.tavola"), "# Titolo").unwrap();
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(Tavola)).expect("format");
    let mut ws = Workspace::new(&root, registry).expect("the vault opens");
    ws.register_plugin(
        PluginManifest::new("test.one", "test.one").granting(PluginPermissions::core()),
        Trust::Community,
    )
    .expect("declared");
    ws.register_custom_renderer("test.one", Box::new(Scelta))
        .expect("renderer");
    ws.reindex().expect("scan");
    (dir, ws)
}

fn embed(ws: &Workspace, page: &str, heading: Option<&str>) -> Result<String, KernelError> {
    ws.render_embed(page, heading, None)
        .map(|(_, rendered)| rendered.html)
}

// --- le prove ---------------------------------------------------------------

/// Il nome sceglie una sezione dichiarata e il renderer la riceve.
#[test]
fn a_declared_section_reaches_the_renderer() {
    let (_dir, ws) = vault();
    let html = embed(&ws, "viste", Some("Due")).expect("declared section");
    assert!(html.contains("<p>Due</p>"), "{html}");
    let whole = embed(&ws, "viste", None).expect("whole document");
    assert!(whole.contains("<p>intera</p>"), "{whole}");
}

/// Un nome che il blocco non dichiara non ha sezione, anche se il formato
/// avrebbe potuto inventarne una.
#[test]
fn an_undeclared_name_has_no_section() {
    let (_dir, ws) = vault();
    let error = embed(&ws, "viste", Some("Tre")).expect_err("undeclared");
    assert!(matches!(error, KernelError::NotFound(_)), "{error:?}");
}

/// Un blocco custom senza dichiarazione passa per gli heading, come ogni altro
/// documento, e il renderer non riceve una scelta.
#[test]
fn without_a_declaration_the_name_is_a_heading() {
    let (_dir, ws) = vault();
    let html = embed(&ws, "piatta", Some("Titolo")).expect("heading section");
    assert!(html.contains("<p>intera</p>"), "{html}");
    let error = embed(&ws, "piatta", Some("Uno")).expect_err("no such heading");
    assert!(matches!(error, KernelError::NotFound(_)), "{error:?}");
}
