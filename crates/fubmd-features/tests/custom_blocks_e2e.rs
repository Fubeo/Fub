//! *Chi disegna ciò che il core non conosce*, end-to-end **attraverso il kernel
//! vero**: vault su disco, markdown vero, regole innestate vere, renderer
//! registrati veri (decisione 0017).
//!
//! È la prova che i tre lati del §3 sono un percorso solo e non tre meccanismi
//! che si assomigliano. Un sorgente markdown entra; una `SyntaxRule` che il
//! provider **non conosce** ne fa un `Block::Custom`; un `CustomRenderer`
//! registrato per quel `custom_kind` lo disegna; e ciò che ne esce arriva al
//! confine — come HTML se è markup, come albero `UiNode` se è roba per la shell.
//!
//! Il test che conta di più è
//! [`una_sintassi_di_terzi_percorre_tutti_e_tre_i_lati`]: senza di lui gli altri
//! provano tre metà di plugin.

use camino::Utf8PathBuf;
use fubmd_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fubmd_abi::error::FormatError;
use fubmd_abi::format::{DocumentSource, ParseContext, RenderOptions};
use fubmd_abi::model::{custom_kind, Block, DocId};
use fubmd_abi::options::syntax;
use fubmd_abi::ui::{UiKind, UiNode};
use fubmd_abi::FormatProvider;
use fubmd_features::{
    DiagramRenderer, DiagramRule, HighlightRule, MathRenderer, MathRule, DIAGRAM_NS,
};
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, RenderedDocument, SyntaxRegistry, Trust, Workspace};
use serde_json::json;

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn put(&self, rel: &str, body: &str) {
        std::fs::write(self.root.join(rel), body).unwrap();
    }

    /// Un workspace con le sintassi e i renderer ufficiali innestati, come li
    /// monta l'app.
    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry);
        ws.register_syntax_rule(Box::new(DiagramRule))
            .expect("diagrammi");
        ws.register_syntax_rule(Box::new(MathRule))
            .expect("formule");
        ws.register_syntax_rule(Box::new(HighlightRule))
            .expect("evidenziato");
        ws.register_custom_renderer(Trust::Core, Box::new(DiagramRenderer))
            .expect("renderer dei diagrammi");
        ws.register_custom_renderer(Trust::Core, Box::new(MathRenderer))
            .expect("renderer delle formule");
        ws.reindex().expect("reindex");
        ws
    }
}

fn preview(ws: &Workspace, id: &str) -> RenderedDocument {
    ws.render_preview(&DocId::new(id)).expect("anteprima")
}

#[test]
fn un_diagramma_esce_come_parte_dichiarativa_non_come_markup() {
    let v = Vault::new();
    v.put(
        "nota.md",
        "# Titolo\n\nPrima.\n\n```mermaid\ngraph TD;\n```\n\nDopo.\n",
    );
    let ws = v.open();
    let out = preview(&ws, "nota.md");

    // L'HTML porta il buco, non il diagramma: chi disegna un grafo non è il
    // Rust, ed è il punto del §3.3.
    assert!(
        out.html.contains("data-ui-slot=\"0\""),
        "html: {}",
        out.html
    );
    assert!(out.html.contains("data-custom-kind=\"diagram\""));
    // E ciò che sta prima e dopo lo ha reso il provider, nell'ordine giusto:
    // la composizione spezza il corpo, non fa chirurgia sulla stringa.
    let slot = out.html.find("data-ui-slot").unwrap();
    assert!(out.html.find("Prima.").unwrap() < slot);
    assert!(out.html.find("Dopo.").unwrap() > slot);
    assert!(out.html.contains("<h1"), "il titolo resta al provider");

    assert_eq!(out.parts.len(), 1);
    let part = &out.parts[0];
    assert_eq!(part.slot, 0);
    assert_eq!(part.kind, custom_kind::DIAGRAM);
    let UiKind::Custom { ns, payload, .. } = &part.node.kind else {
        panic!("atteso un nodo Custom, trovato {:?}", part.node.kind);
    };
    assert_eq!(ns, DIAGRAM_NS);
    assert_eq!(payload["engine"], "mermaid");
    assert_eq!(payload["source"], "graph TD;\n");
}

#[test]
fn una_formula_esce_come_html_dentro_il_flusso() {
    let v = Vault::new();
    v.put("f.md", "```math\nE = mc^2\n```\n");
    let ws = v.open();
    let out = preview(&ws, "f.md");

    assert!(
        out.html.contains("class=\"math-block\""),
        "html: {}",
        out.html
    );
    assert!(out.html.contains("data-tex=\"E = mc^2"));
    // La via HTML non produce parti: è markup, e sta nel flusso.
    assert!(out.parts.is_empty());
    // E soprattutto NON è più un blocco di codice.
    assert!(!out.html.contains("language-math"), "html: {}", out.html);
}

#[test]
fn levidenziato_arriva_dal_modello_e_non_sparisce_piu() {
    let v = Vault::new();
    v.put("h.md", "Un ==punto importante== nel testo.\n");
    let ws = v.open();
    let out = preview(&ws, "h.md");

    // Prima di questa seduta un `Inline::Custom` sconosciuto al provider non
    // veniva reso affatto: il testo spariva, in silenzio.
    assert!(
        out.html
            .contains("<span class=\"inline-highlight\">punto importante</span>"),
        "html: {}",
        out.html
    );
    assert!(
        out.html.contains("Un "),
        "il testo intorno resta: {}",
        out.html
    );
    assert!(out.html.contains(" nel testo."));
}

#[test]
fn una_sintassi_spenta_lascia_il_documento_com_era() {
    let v = Vault::new();
    v.put("d.md", "```mermaid\ngraph TD;\n```\n");
    let ws = v.open();
    // Con l'opzione accesa — il default di `ParseContext::obsidian`, che è ciò
    // che il kernel usa — il recinto diventa un diagramma.
    assert_eq!(preview(&ws, "d.md").parts.len(), 1);

    // E la stessa regola, con la sua opzione spenta, non tocca niente. È il
    // ponte col §3.4: una sintassi si spegne per vault (28) o per nota (6.2)
    // senza che nessuno disinstalli nulla. Il registro si interroga qui
    // direttamente perché il canale che porterà quel contesto fin dentro al
    // kernel è il §11.1, e non esiste ancora.
    let mut reg = SyntaxRegistry::new();
    reg.register(Box::new(DiagramRule)).unwrap();
    let mut model = MarkdownProvider::new()
        .parse(
            &DocumentSource::Text("```mermaid\ngraph TD;\n```\n".into()),
            &ParseContext::obsidian("d.md"),
        )
        .unwrap();

    let spento = ParseContext::bare("d.md");
    assert!(!spento.enabled(syntax::DIAGRAMS));
    reg.apply(&mut model, &spento, "markdown");
    assert!(
        matches!(model.body[0], Block::CodeBlock { .. }),
        "spenta, la regola lascia il recinto com'era: {:?}",
        model.body[0]
    );

    // E accesa lo prende. Le due metà nello stesso test perché ciò che si vuole
    // provare è la *differenza*, non i due esiti separati.
    reg.apply(&mut model, &ParseContext::obsidian("d.md"), "markdown");
    assert!(
        matches!(&model.body[0], Block::Custom { custom_kind, .. } if custom_kind == custom_kind::DIAGRAM)
    );
}

// ---------------------------------------------------------------------------
// Il test che conta: un terzo percorre tutti e tre i lati
// ---------------------------------------------------------------------------

/// Una sintassi di un plugin immaginario: ```` ```ganttino ```` .
struct GanttinoRule;

impl SyntaxRule for GanttinoRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: "terzi:ganttino".into(),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["ganttino".into()],
            },
            order: 0,
            option: None,
            produces: vec!["terzi:gantt".into()],
        }
    }
    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(Some(SyntaxProduct::Block {
            custom_kind: "terzi:gantt".into(),
            attrs: json!({ "righe": m.text.lines().count() }),
            blocks: vec![],
        }))
    }
}

/// E il suo renderer. **Non fidato**, come sarà quello di un plugin vero.
struct GanttinoRenderer {
    /// Se `true` prova a mandare markup attivo, che è ciò che il confine deve
    /// fermare.
    ostile: bool,
}

impl CustomRenderer for GanttinoRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: "terzi:ganttino".into(),
            kinds: vec!["terzi:gantt".into()],
        }
    }
    fn render(
        &self,
        block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let righe = block
            .attrs
            .get("righe")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if self.ostile {
            return Ok(CustomRendering::Ui(Box::new(UiNode::new(UiKind::Html {
                html: "<script>fetch('/tutto-il-vault')</script>".into(),
            }))));
        }
        Ok(CustomRendering::Ui(Box::new(UiNode::text(format!(
            "{righe} righe"
        )))))
    }
}

#[test]
fn una_sintassi_di_terzi_percorre_tutti_e_tre_i_lati() {
    let v = Vault::new();
    v.put("g.md", "```ganttino\na\nb\n```\n");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry);

    // Lato 1: la sintassi si innesta sul provider markdown, che non la conosce
    // e non viene toccato.
    ws.register_syntax_rule(Box::new(GanttinoRule))
        .expect("innesto");
    // Lato 2: il renderer si registra per il kind che la regola produce.
    ws.register_custom_renderer(
        Trust::Community,
        Box::new(GanttinoRenderer { ostile: false }),
    )
    .expect("renderer");
    ws.reindex().expect("reindex");

    // Lato 3: arriva alla shell come albero, senza una riga nel bundle.
    let out = preview(&ws, "g.md");
    assert_eq!(out.parts.len(), 1, "html: {}", out.html);
    assert_eq!(out.parts[0].kind, "terzi:gantt");
    assert!(matches!(&out.parts[0].node.kind, UiKind::Text { content } if content == "2 righe"));
}

#[test]
fn da_un_renderer_non_fidato_il_contenuto_attivo_non_passa() {
    let v = Vault::new();
    v.put("g.md", "```ganttino\na\n```\n");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry);
    ws.register_syntax_rule(Box::new(GanttinoRule)).unwrap();
    ws.register_custom_renderer(
        Trust::Community,
        Box::new(GanttinoRenderer { ostile: true }),
    )
    .unwrap();
    ws.reindex().unwrap();

    let out = preview(&ws, "g.md");
    // Niente parte, niente script: il blocco degrada alla resa generica del
    // provider. È lo stesso confine delle view (`UiNode::validate_untrusted`) e
    // lo stesso punto unico di applicazione.
    assert!(out.parts.is_empty(), "parts: {:?}", out.parts);
    assert!(!out.html.contains("script"), "html: {}", out.html);
    assert!(
        out.html.contains("block-terzi:gantt") || out.html.contains("block-"),
        "html: {}",
        out.html
    );
}

#[test]
fn due_regole_sulla_stessa_sintassi_non_si_registrano_in_silenzio() {
    let v = Vault::new();
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry);

    ws.register_syntax_rule(Box::new(DiagramRule))
        .expect("la prima passa");

    /// Un plugin che rivendica `mermaid`, già preso dalla regola ufficiale.
    struct Concorrente;
    impl SyntaxRule for Concorrente {
        fn spec(&self) -> SyntaxRuleSpec {
            SyntaxRuleSpec {
                id: "terzi:mermaid".into(),
                format: "markdown".into(),
                trigger: SyntaxTrigger::Fence {
                    info: vec!["mermaid".into()],
                },
                order: 0,
                option: None,
                produces: vec!["terzi:mermaid".into()],
            }
        }
        fn apply(
            &self,
            _m: &SyntaxMatch,
            _ctx: &ParseContext,
        ) -> Result<Option<SyntaxProduct>, FormatError> {
            unreachable!("non deve nemmeno registrarsi")
        }
    }
    let err = ws
        .register_syntax_rule(Box::new(Concorrente))
        .expect_err("la seconda rivendica `mermaid`");
    // Il valore non è nel rifiuto: è nel fatto che ci sia un `Err` da leggere.
    assert!(err.to_string().contains("fence:mermaid"), "{err}");
}

#[test]
fn un_kind_prodotto_e_mai_disegnato_si_puo_contare() {
    let v = Vault::new();
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry);

    ws.register_syntax_rule(Box::new(DiagramRule)).unwrap();
    ws.register_syntax_rule(Box::new(MathRule)).unwrap();
    // L'evidenziato è **inline**: non è disegnabile da un renderer, e non deve
    // comparire nel conto — un allarme che non si può spegnere è un allarme che
    // si impara a ignorare.
    ws.register_syntax_rule(Box::new(HighlightRule)).unwrap();
    // Solo uno dei due kind di blocco ha un renderer.
    ws.register_custom_renderer(Trust::Core, Box::new(DiagramRenderer))
        .unwrap();

    // È il conto che il §3.2 chiedeva di poter fare: ogni nome qui è un blocco
    // che l'utente leggerà crudo.
    assert_eq!(ws.undrawn_kinds(), vec![custom_kind::MATH.to_string()]);

    // E con anche il suo renderer, il conto è vuoto: è lo stato in cui l'app si
    // monta oggi.
    ws.register_custom_renderer(Trust::Core, Box::new(MathRenderer))
        .unwrap();
    assert!(ws.undrawn_kinds().is_empty());
}
