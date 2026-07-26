//! Il modello parsato **si chiede**, e di che formato è un documento si sa
//! senza aprirlo: le due capacità della decisione 0018 (§4.2 e §4.3) su un vault
//! vero.
//!
//! Sta qui e non fra i test del kernel per la stessa ragione di
//! `index_queries_e2e.rs`: serve markdown *vero*. Un provider finto proverebbe
//! che il kernel sa restituire ciò che gli è stato dato; qui si prova ciò che
//! conta davvero — che dal canale esce il **corpo**, cioè proprio la parte che
//! la cache del kernel non ha e che il canale metadata non sa rispondere.
//!
//! Il giro è quello che farà un provider (anche in WASM): un `HostApi` prestato
//! dal workspace, nessuna scorciatoia sui metodi pubblici del `Workspace`.

use camino::Utf8PathBuf;
use fubmd_abi::custom::{SyntaxMatch, SyntaxProduct, SyntaxRule, SyntaxRuleSpec, SyntaxTrigger};
use fubmd_abi::error::FormatError;
use fubmd_abi::format::ParseContext;
use fubmd_abi::model::{Block, DocId};
use fubmd_abi::options::syntax;
use fubmd_abi::traits::HostApi;
use fubmd_abi::PluginError;
use fubmd_format_markdown::MarkdownProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

/// L'estensione di un terzo: un delimitatore che comrak non conosce, innestato
/// sul provider markdown come lo innesterebbe un plugin.
struct RegolaDiTerzi;

impl SyntaxRule for RegolaDiTerzi {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: "terzi:sottolineato".into(),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Inline {
                open: "__".into(),
                close: "__".into(),
            },
            order: 0,
            option: Some("terzi:sottolineato".into()),
            produces: vec!["terzi:sottolineato".into()],
        }
    }

    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(Some(SyntaxProduct::Inline {
            custom_kind: "terzi:sottolineato".into(),
            attrs: serde_json::json!({ "text": m.text }),
        }))
    }
}

fn vault() -> (tempfile::TempDir, Workspace) {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().join("vault")).expect("utf8");
    let write = |rel: &str, body: &str| {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    };

    write(
        "Nota.md",
        "---\ntipo: nota\n---\n# Titolo\n\nUn paragrafo con [[Altra]].\n\n\
         - [ ] da fare\n- [x] fatta\n",
    );
    write("Altra.md", "Ciao.\n");
    // Un file che nessun provider rivendica: il vault non lo indicizza, ma il
    // suo *nome* resta una domanda legittima per `format_of`.
    write("allegato.pdf", "%PDF-1.4\n");

    let mut registry = FormatRegistry::new();
    registry
        .register(MarkdownProvider::boxed())
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(&root, registry);
    ws.reindex().expect("reindex");
    (dir, ws)
}

/// Presta l'host come lo riceve un provider e fai la domanda da lì.
fn chiedendo<R>(ws: &mut Workspace, f: impl FnOnce(&dyn HostApi) -> R) -> R {
    ws.with_host("test", |host| f(host))
}

#[test]
fn dal_canale_esce_il_corpo_che_la_cache_non_ha() {
    let (_dir, mut ws) = vault();

    let model = chiedendo(&mut ws, |host| host.read_model(&DocId::new("Nota.md")))
        .expect("il modello di una nota che esiste");

    assert_eq!(model.id, DocId::new("Nota.md"));
    assert!(
        !model.body.is_empty(),
        "il corpo È la ragione di questo canale: outline, frontmatter e link \
         li serviva già `IndexQuery` dalla cache calda"
    );
    assert!(
        matches!(&model.body[0], Block::Heading { level: 1, .. }),
        "il primo blocco è il titolo, e arriva con il suo span: {:?}",
        model.body[0]
    );

    // La lista con le due task: è il dato per cui il percorso one-shot esiste
    // (spuntare il task sotto il cursore), e nessuna variante di `IndexQuery`
    // sa rispondere.
    let tasks: Vec<_> = model
        .body
        .iter()
        .filter_map(|b| match b {
            Block::List { items, .. } => Some(items),
            _ => None,
        })
        .flatten()
        .filter_map(|i| i.task)
        .collect();
    assert_eq!(tasks.len(), 2, "due voci di task");
    assert!(!tasks[0].checked() && tasks[1].checked());
    // Lo span è quello del **simbolo**: un carattere, che è la patch più
    // piccola con cui si spunta.
    assert_eq!(tasks[0].span.end - tasks[0].span.start, 1);
    assert_eq!(
        &std::fs::read_to_string(ws.root().join("Nota.md")).unwrap()
            [tasks[1].span.start..tasks[1].span.end],
        "x"
    );
}

#[test]
fn il_modello_e_quello_del_disco_adesso_non_quello_di_quando_e_stato_indicizzato() {
    let (_dir, mut ws) = vault();

    ws.write_document(&DocId::new("Altra.md"), "# Cambiata\n")
        .expect("scrittura");

    let model = chiedendo(&mut ws, |host| host.read_model(&DocId::new("Altra.md")))
        .expect("il modello dopo la scrittura");
    assert!(
        matches!(&model.body[0], Block::Heading { .. }),
        "riparsa a ogni chiamata: se servisse una cache, qui ci sarebbe ancora \
         il paragrafo di prima"
    );
}

#[test]
fn un_documento_che_il_vault_non_conosce_e_un_errore_non_un_modello_vuoto() {
    let (_dir, mut ws) = vault();

    let esito = chiedendo(&mut ws, |host| host.read_model(&DocId::new("Fantasma.md")));
    assert!(
        matches!(esito, Err(PluginError::Internal(msg)) if msg.contains("Fantasma.md")),
        "una domanda su ciò che non c'è si dice, non si risponde con un modello \
         vuoto che il chiamante scambierebbe per una nota vuota"
    );
}

#[test]
fn le_capacita_di_un_formato_comprendono_le_sintassi_innestate() {
    let (_dir, mut ws) = vault();

    let prima = chiedendo(&mut ws, |host| host.format_of(&DocId::new("Nota.md")))
        .expect("il markdown rivendica .md");
    assert_eq!(prima.descriptor.id, "markdown");
    assert!(prima.capabilities.supports(syntax::WIKILINKS));
    assert!(
        !prima.capabilities.supports("terzi:sottolineato"),
        "nessuno l'ha ancora innestata"
    );

    ws.register_syntax_rule(Box::new(RegolaDiTerzi))
        .expect("nessun conflitto");

    let dopo = chiedendo(&mut ws, |host| host.format_of(&DocId::new("Nota.md")))
        .expect("il markdown rivendica .md");
    assert!(
        dopo.capabilities.supports("terzi:sottolineato"),
        "le capacità sono quelle EFFETTIVE: rispondere le sole capacità del \
         provider sarebbe una verità di laboratorio, perché la sintassi funziona"
    );
    assert!(
        dopo.capabilities.supports(syntax::WIKILINKS),
        "e l'innesto non toglie niente a ciò che il provider sa già fare"
    );
}

#[test]
fn di_che_formato_e_un_documento_e_una_domanda_sul_nome() {
    let (_dir, mut ws) = vault();

    assert!(
        chiedendo(&mut ws, |host| host.format_of(&DocId::new("allegato.pdf"))).is_none(),
        "nessun provider rivendica .pdf: `none` è la risposta che serve a chi \
         deve sapere che quel nome non è roba sua"
    );
    assert!(
        chiedendo(&mut ws, |host| host
            .format_of(&DocId::new("Diario/2026-07-26.md")))
        .is_some(),
        "vale anche per un documento che non esiste ancora: chi sta per crearlo \
         può chiedere prima chi lo tratterà"
    );
}
