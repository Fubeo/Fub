// Il banco di questa feature vive con lei: senza la cargo feature `blocks`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "blocks")]
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
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::error::FormatError;
use fub_abi::format::{DocumentSource, ParseContext, RenderOptions};
use fub_abi::model::{custom_kind, Block, DocId};
use fub_abi::options::syntax;
use fub_abi::traits::PluginManifest;
use fub_abi::ui::{UiKind, UiNode};
use fub_abi::FormatProvider;
use fub_features::{
    DiagramRenderer, DiagramRule, HighlightRule, MathRenderer, MathRule, BLOCKS_ID, DIAGRAM_NS,
};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, RenderedDocument, SyntaxRegistry, Trust, Workspace};
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
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_core_feature(BLOCKS_ID, "Blocchi")
            .expect("dichiarato");
        ws.register_syntax_rule(BLOCKS_ID, Box::new(DiagramRule))
            .expect("diagrammi");
        ws.register_syntax_rule(BLOCKS_ID, Box::new(MathRule))
            .expect("formule");
        ws.register_syntax_rule(BLOCKS_ID, Box::new(HighlightRule))
            .expect("evidenziato");
        ws.register_custom_renderer(BLOCKS_ID, Box::new(DiagramRenderer))
            .expect("renderer dei diagrammi");
        ws.register_custom_renderer(BLOCKS_ID, Box::new(MathRenderer))
            .expect("renderer delle formule");
        ws.reindex().expect("reindex");
        ws
    }
}

fn preview(ws: &Workspace, id: &str) -> RenderedDocument {
    ws.render_preview(&DocId::new(id)).expect("anteprima")
}

#[test]
fn a_diagram_exits_as_part_declarative_not_as_markup() {
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
fn a_formula_exits_as_html_inside_the_stream() {
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

/// **Un kind che nessuno disegna si legge crudo, non sparisce.**
///
/// È la seconda metà di `un_kind_prodotto_e_mai_disegnato_si_puo_contare`, che
/// chiama `undrawn_kinds()` «il conto dei blocchi che l'utente leggerà crudo» —
/// e per averlo scritto nessuno era andato a guardare *cosa* leggesse davvero.
/// Leggeva un `<div>` vuoto: la regola aveva delimitato il recinto, il sorgente
/// era uscito dal blocco di codice per entrare negli `attrs`, e il degrado
/// generico del provider rendeva i **figli** — che un blocco così non ha.
///
/// La strada è quella vera: `render_preview`, cioè `compose`. Un kind senza
/// renderer non entra nemmeno nel `match` dei rendering — `for_kind` non lo
/// trova e il blocco finisce nella corsa che il provider rende. È lo stesso
/// punto in cui atterra un renderer che **fallisce o pania**
/// (`CustomRendering::Fallback`), e quel ramo il §9.3 lo chiama *degrado
/// onesto*: prima cancellava la formula dell'utente.
#[test]
fn a_kind_without_renderer_arrives_all_preview_col_its_source() {
    let v = Vault::new();
    v.put("f.md", "```math\nE = mc^2\n```\n");

    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    ws.register_core_feature(BLOCKS_ID, "Blocchi")
        .expect("dichiarato");
    ws.register_syntax_rule(BLOCKS_ID, Box::new(MathRule))
        .unwrap();
    // Il renderer dei diagrammi c'è, quello delle formule no: il registro non è
    // vuoto, quindi `compose` percorre il ramo lungo e non la scorciatoia di
    // `renderers.is_empty()`.
    ws.register_custom_renderer(BLOCKS_ID, Box::new(DiagramRenderer))
        .unwrap();
    ws.reindex().expect("reindex");

    assert_eq!(ws.undrawn_kinds(), vec![custom_kind::MATH.to_string()]);
    let out = preview(&ws, "f.md");
    assert!(
        out.html.contains("E = mc^2"),
        "il sorgente della formula è sparito dall'anteprima: {}",
        out.html
    );
    assert!(out.parts.is_empty(), "nessun renderer, nessuna parte");
}

#[test]
fn highlighted_arrives_from_the_model_and_not_disappears_more() {
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
fn a_syntax_off_leaves_the_document_com_was() {
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

    let off = ParseContext::bare("d.md");
    assert!(!off.enabled(syntax::DIAGRAMS));
    reg.apply(&mut model, &off, "markdown");
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
struct GanttRule;

impl SyntaxRule for GanttRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: "com.example.third:ganttino".into(),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["ganttino".into()],
            },
            order: 0,
            option: None,
            produces: vec!["com.example.third:gantt".into()],
        }
    }
    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(Some(SyntaxProduct::Block {
            custom_kind: "com.example.third:gantt".into(),
            attrs: json!({ "righe": m.text.lines().count() }),
            blocks: vec![],
        }))
    }
}

/// E il suo renderer. **Non fidato**, come sarà quello di un plugin vero.
struct GanttRenderer {
    /// Se `true` prova a mandare markup attivo, che è ciò che il confine deve
    /// fermare.
    hostile: bool,
}

impl CustomRenderer for GanttRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: "com.example.third:ganttino".into(),
            kinds: vec!["com.example.third:gantt".into()],
        }
    }
    fn render(
        &self,
        block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let rows = block
            .attrs
            .get("righe")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        if self.hostile {
            return Ok(CustomRendering::Ui(Box::new(UiNode::new(UiKind::Html {
                html: "<script>fetch('/tutto-il-vault')</script>".into(),
            }))));
        }
        Ok(CustomRendering::Ui(Box::new(UiNode::text(format!(
            "{rows} righe"
        )))))
    }
}

#[test]
fn a_syntax_of_third_party_traverses_all_and_three_the_sides() {
    let v = Vault::new();
    v.put("g.md", "```ganttino\na\nb\n```\n");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    // Un plugin di terzi, dichiarato come tale: il grado di fiducia sta nella
    // dichiarazione, non su ogni cosa che registra (§7.3).
    ws.register_plugin(PluginManifest::new("com.example.third", "Third"), Trust::Community)
        .expect("dichiarato");

    // Lato 1: la sintassi si innesta sul provider markdown, che non la conosce
    // e non viene toccato.
    ws.register_syntax_rule("com.example.third", Box::new(GanttRule))
        .expect("innesto");
    // Lato 2: il renderer si registra per il kind che la regola produce.
    ws.register_custom_renderer("com.example.third", Box::new(GanttRenderer { hostile: false }))
        .expect("renderer");
    ws.reindex().expect("reindex");

    // Lato 3: arriva alla shell come albero, senza una riga nel bundle.
    let out = preview(&ws, "g.md");
    assert_eq!(out.parts.len(), 1, "html: {}", out.html);
    assert_eq!(out.parts[0].kind, "com.example.third:gantt");
    assert!(matches!(&out.parts[0].node.kind, UiKind::Text { content } if content == "2 righe"));
}

#[test]
fn from_a_renderer_not_trusted_the_content_active_not_passes() {
    let v = Vault::new();
    v.put("g.md", "```ganttino\na\n```\n");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    ws.register_plugin(PluginManifest::new("com.example.third", "Third"), Trust::Community)
        .expect("dichiarato");
    ws.register_syntax_rule("com.example.third", Box::new(GanttRule))
        .unwrap();
    ws.register_custom_renderer("com.example.third", Box::new(GanttRenderer { hostile: true }))
        .unwrap();
    ws.reindex().unwrap();

    let out = preview(&ws, "g.md");
    // Niente parte, niente script: il blocco degrada alla resa generica del
    // provider. È lo stesso confine delle view (`UiNode::validate_untrusted`) e
    // lo stesso punto unico di applicazione.
    assert!(out.parts.is_empty(), "parts: {:?}", out.parts);
    assert!(!out.html.contains("script"), "html: {}", out.html);
    assert!(
        out.html.contains("block-com.example.third:gantt") || out.html.contains("block-"),
        "html: {}",
        out.html
    );
}

/// Una sintassi di terzi che porta i propri byte sotto la chiave
/// **convenzionale** (`source`) *e* sotto una chiave che la convenzione non
/// nomina (`text`): la resa generica deve prendere la prima e ignorare la
/// seconda, ed è nei due versi che il banco la tiene shutdown.
struct ConventionRule;

impl SyntaxRule for ConventionRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: "com.example.third:convenzione".into(),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["convenzione".into()],
            },
            order: 0,
            option: None,
            produces: vec!["com.example.third:convenzione".into()],
        }
    }
    fn apply(
        &self,
        _m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(Some(SyntaxProduct::Block {
            custom_kind: "com.example.third:convenzione".into(),
            attrs: json!({ "source": "GIRO-DEI-BYTE", "text": "TESTO-SBAGLIATO" }),
            blocks: vec![],
        }))
    }
}

/// **Un `kind` di terzi degradato mostra i byte sotto la chiave che la
/// convenzione declare — `source` — e sotto nessun'altra.**
///
/// È il banco che la §25.7 dichiarava mancante: un `com.example.third:*` che passa dalla
/// degradazione generica invece che dal proprio renderer. Un plugin che non
/// registra un `CustomRenderer` (o il cui renderer torna `Fallback` o pania —
/// `fub-kernel/src/renderer.rs` li tratta tutti e tre allo stesso modo) vede
/// il proprio blocco reso dal provider, e la resa chiede i byte al contratto:
/// `rules::carichi::carico_testuale` — la tabella del core per i kind
/// dichiarati, la chiave convenzionale `source` per i kind di terzi.
///
/// I due versi: la chiave dichiarata si vede, e una chiave che la convenzione
/// non nomina **non** si vede. Se il campione a più chiavi tornasse, `text`
/// vincerebbe su `source` e la seconda asserzione cadrebbe insieme alla prima.
#[test]
fn a_kind_of_third_party_degraded_show_the_byte_of_the_key_convenzionale() {
    let v = Vault::new();
    v.put("c.md", "```convenzione\ngiro\n```\n");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    // Un plugin di terzi, dichiarato come tale: il grado di fiducia sta nella
    // dichiarazione, non su ogni cosa che registra (§7.3).
    ws.register_plugin(PluginManifest::new("com.example.third", "Third"), Trust::Community)
        .expect("dichiarato");
    ws.register_syntax_rule("com.example.third", Box::new(ConventionRule))
        .expect("innesto");
    ws.reindex().expect("reindex");

    // Il renderer non c'è: `compose` non trova nessuno per `com.example.third:convenzione`
    // e il blocco finisce nella corsa che il provider rende genericamente.
    let out = preview(&ws, "c.md");
    assert!(out.parts.is_empty(), "parts: {:?}", out.parts);
    assert!(
        out.html.contains("GIRO-DEI-BYTE"),
        "i byte sotto la chiave convenzionale `source` non compaiono: {}",
        out.html
    );
    assert!(
        !out.html.contains("TESTO-SBAGLIATO"),
        "la chiave `text` non è la convenzione, e non deve rendere: {}",
        out.html
    );
}

#[test]
fn two_rules_on_the_same_syntax_not_is_register_in_silence() {
    let v = Vault::new();
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    ws.register_core_feature(BLOCKS_ID, "Blocchi")
        .expect("dichiarato");

    ws.register_syntax_rule(BLOCKS_ID, Box::new(DiagramRule))
        .expect("la prima passa");

    /// Un plugin che rivendica `mermaid`, già preso dalla regola ufficiale.
    struct Concurrent;
    impl SyntaxRule for Concurrent {
        fn spec(&self) -> SyntaxRuleSpec {
            SyntaxRuleSpec {
                id: "com.example.third:mermaid".into(),
                format: "markdown".into(),
                trigger: SyntaxTrigger::Fence {
                    info: vec!["mermaid".into()],
                },
                order: 0,
                option: None,
                produces: vec!["com.example.third:mermaid".into()],
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
    // Il concorrente è un terzo, e nomina dentro il proprio namespace: la
    // regola del §7.4 è soddisfatta, e ciò che lo shutdown è l'altro conflitto —
    // quello sul **trigger**, che è ciò che questo test vuole vedere.
    ws.register_plugin(PluginManifest::new("com.example.third", "Third"), Trust::Community)
        .expect("dichiarato");
    let err = ws
        .register_syntax_rule("com.example.third", Box::new(Concurrent))
        .expect_err("la seconda rivendica `mermaid`");
    // Il valore non è nel rifiuto: è nel fatto che ci sia un `Err` da leggere.
    assert!(err.to_string().contains("fence:mermaid"), "{err}");
}

#[test]
fn a_kind_product_and_never_drawn_is_can_count() {
    let v = Vault::new();
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    ws.register_core_feature(BLOCKS_ID, "Blocchi")
        .expect("dichiarato");

    ws.register_syntax_rule(BLOCKS_ID, Box::new(DiagramRule))
        .unwrap();
    ws.register_syntax_rule(BLOCKS_ID, Box::new(MathRule))
        .unwrap();
    // L'evidenziato è **inline**: non è disegnabile da un renderer, e non deve
    // comparire nel conto — un allarme che non si può spegnere è un allarme che
    // si impara a ignorare.
    ws.register_syntax_rule(BLOCKS_ID, Box::new(HighlightRule))
        .unwrap();
    // Solo uno dei due kind di blocco ha un renderer.
    ws.register_custom_renderer(BLOCKS_ID, Box::new(DiagramRenderer))
        .unwrap();

    // È il conto che il §3.2 chiedeva di poter fare: ogni nome qui è un blocco
    // che l'utente leggerà crudo.
    assert_eq!(ws.undrawn_kinds(), vec![custom_kind::MATH.to_string()]);

    // E con anche il suo renderer, il conto è vuoto: è lo stato in cui l'app si
    // monta oggi.
    ws.register_custom_renderer(BLOCKS_ID, Box::new(MathRenderer))
        .unwrap();
    assert!(ws.undrawn_kinds().is_empty());
}

// ---------------------------------------------------------------------------
// I tre confini che la seduta dichiarava e che il codice non teneva
// ---------------------------------------------------------------------------

#[test]
fn a_plugin_revoked_not_registers_nothing() {
    let v = Vault::new();
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    // Dichiararsi si può — per dire che qualcuno è revocato bisogna sapere che
    // esiste. Registrare no: una regola e un renderer sono codice che gira a
    // ogni parse e a ogni anteprima, e non passa da nessun guard.
    ws.register_plugin(PluginManifest::new("com.example.third", "Third"), Trust::Revoked)
        .expect("dichiararsi si può");

    let err = ws
        .register_syntax_rule("com.example.third", Box::new(GanttRule))
        .expect_err("un revocato non innesta niente");
    assert!(err.to_string().contains("è revocato"), "{err}");

    let err = ws
        .register_custom_renderer("com.example.third", Box::new(GanttRenderer { hostile: false }))
        .expect_err("un revocato non disegna niente");
    assert!(err.to_string().contains("è revocato"), "{err}");

    // E il registro non è rimasto sporco: niente kind prodotto, niente parte.
    assert!(ws.undrawn_kinds().is_empty());
    v.put("g.md", "```ganttino\na\n```\n");
    ws.reindex().unwrap();
    assert!(preview(&ws, "g.md").parts.is_empty());
}

/// Il gemello del `GanttinoRule` che declare `com.example.third:gantt` e prova a emettere
/// `callout`, che è del core.
struct GanttBuggy;

impl SyntaxRule for GanttBuggy {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: "com.example.third:bugiardo".into(),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["ganttino".into()],
            },
            order: 0,
            produces: vec!["com.example.third:gantt".into()],
            option: None,
        }
    }
    fn apply(
        &self,
        _m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(Some(SyntaxProduct::Block {
            custom_kind: custom_kind::CALLOUT.into(),
            attrs: json!({ "kind": "danger", "title": "Sono il core" }),
            blocks: vec![],
        }))
    }
}

#[test]
fn a_third_not_is_does_pass_for_the_core() {
    let v = Vault::new();
    v.put("b.md", "```ganttino\nx\n```\n");
    let mut registry = FormatRegistry::new();
    registry.register(MarkdownProvider::boxed()).unwrap();
    let mut ws = Workspace::new(&v.root, registry).expect("l'apertura del vault riesce");
    ws.register_plugin(PluginManifest::new("com.example.third", "Third"), Trust::Community)
        .unwrap();

    // Dichiarare di produrre un kind del core si shutdown alla registrazione: è la
    // stessa regola dei nomi di ogni altra famiglia (§7.4).
    struct DeclaresCore;
    impl SyntaxRule for DeclaresCore {
        fn spec(&self) -> SyntaxRuleSpec {
            SyntaxRuleSpec {
                id: "com.example.third:declare".into(),
                format: "markdown".into(),
                trigger: SyntaxTrigger::Fence {
                    info: vec!["altro".into()],
                },
                order: 0,
                produces: vec![custom_kind::CALLOUT.into()],
                option: None,
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
        .register_syntax_rule("com.example.third", Box::new(DeclaresCore))
        .expect_err("`callout` non è un nome di `com.example.third`");
    assert!(err.to_string().contains("callout"), "{err}");

    // E chi declare il proprio e emette quello del core viene scartato dove
    // emette: `produces` è un contratto, non una nota.
    ws.register_syntax_rule("com.example.third", Box::new(GanttBuggy))
        .expect("dichiara solo roba sua, quindi si registra");
    ws.reindex().unwrap();
    let model = ws.read_model(&DocId::new("b.md")).expect("modello");
    assert!(
        matches!(model.body[0], Block::CodeBlock { .. }),
        "il recinto resta com'era: {:?}",
        model.body[0]
    );
    // E il conto non si è sporcato di un kind che nessuno emetterà mai.
    assert_eq!(ws.undrawn_kinds(), vec!["com.example.third:gantt".to_string()]);
}

#[test]
fn a_rule_inline_enters_in_the_label_of_a_link() {
    let v = Vault::new();
    // Fuori dal link e dentro: la stessa sintassi non può funzionare a seconda
    // di dove capita.
    v.put("l.md", "Vedi [==qui==](https://esempio.it) e ==là==.\n");
    let ws = v.open();
    let out = preview(&ws, "l.md");

    assert_eq!(
        out.html.matches("class=\"inline-highlight\"").count(),
        2,
        "html: {}",
        out.html
    );
    assert!(
        out.html.contains(">qui<") && out.html.contains(">là<"),
        "html: {}",
        out.html
    );
    // E il link è rimasto un link.
    assert!(
        out.html.contains("https://esempio.it"),
        "html: {}",
        out.html
    );
}
