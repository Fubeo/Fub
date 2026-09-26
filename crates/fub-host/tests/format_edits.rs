//! Le feature chiedono al formato come si scrive un link o una spunta.
//!
//! Il montaggio è quello vero, con un formato in prosa in più, `.righe`, che ha
//! una sua sintassi: un link è `<<pagina>>`, un task è `( )` o `(v)` in testa
//! alla riga. Se una feature scrivesse ancora `[[…]]` o `x` da sé, qui
//! comparirebbe la sintassi Markdown dentro un file che non la conosce.
//!
//! Un formato che non offre le operazioni (il Markdown non c'entra: qui è un
//! `.righe` senza di esse) riceve l'errore tipizzato e il file non cambia.
//! Un `.righe` che non si dichiara in prosa rifiuta per il formato anche una
//! selezione senza coordinate, come quella delle carte scelte in una tela.

use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::TextEdit;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, FormatProvider, LinkInsert, ParseContext,
    RenderOptions,
};
use fub_abi::model::{Block, DocId, DocumentModel, LinkTarget, ListItem, Span, TaskMarker};
use fub_abi::session::{SelectionSet, ViewContext};
use fub_abi::{FormatError, PluginError};
use fub_host::{Host, PreparedFormatSource, StartupSnapshot, StartupSource};

const PANE: &str = "main";

/// Un formato di righe: `( ) cosa` e `(v) cosa` sono task, `<<pagina>>` è un
/// link. Con `edits` spento non offre le scritture mirate; con `prose` spento
/// non si dichiara un sorgente in prosa.
struct Righe {
    edits: bool,
    prose: bool,
}

impl FormatProvider for Righe {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("righe", "Righe", &["righe"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        if self.prose {
            FormatCapabilities::of(&[fub_abi::options::source::PROSE])
        } else {
            FormatCapabilities::default()
        }
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let text = source.text().unwrap_or_default();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = text.to_string();
        let mut items = Vec::new();
        let mut at = 0;
        for line in text.split_inclusive('\n') {
            let symbol = if line.starts_with("( )") {
                Some(None)
            } else if line.starts_with("(v)") {
                Some(Some('v'))
            } else {
                None
            };
            if let Some(symbol) = symbol {
                items.push(ListItem {
                    blocks: Vec::new(),
                    task: Some(TaskMarker {
                        symbol,
                        span: Span::new(at + 1, at + 2),
                    }),
                    span: Span::new(at, at + line.trim_end().len()),
                });
            }
            at += line.len();
        }
        if !items.is_empty() {
            model.body.push(Block::List {
                ordered: false,
                items,
                anchor: None,
                span: Span::new(0, text.len()),
                start: None,
            });
        }
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn format_link(
        &self,
        _ctx: &ParseContext,
        link: &LinkInsert,
    ) -> Result<Option<String>, FormatError> {
        match (&link.target, self.edits) {
            (LinkTarget::Wiki { page, .. }, true) => Ok(Some(format!("<<{page}>>"))),
            _ => Ok(None),
        }
    }

    fn set_task_state(
        &self,
        _source: &DocumentSource,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<Vec<TextEdit>>, FormatError> {
        if !self.edits {
            return Ok(None);
        }
        let symbol = if done { "v" } else { " " };
        Ok(Some(vec![TextEdit::replace(marker.span, symbol)]))
    }
}

struct WithRighe {
    edits: bool,
    prose: bool,
}

impl StartupSource for WithRighe {
    fn prepare(&self) -> Result<StartupSnapshot, PluginError> {
        let mut snapshot = StartupSnapshot::new(Vec::new());
        snapshot.formats = PreparedFormatSource::from_provider(Box::new(Righe {
            edits: self.edits,
            prose: self.prose,
        }));
        Ok(snapshot)
    }
}

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
}

impl Vault {
    fn open(edits: bool, files: &[(&str, &str)]) -> Self {
        Self::open_with(edits, true, files)
    }

    fn open_with(edits: bool, prose: bool, files: &[(&str, &str)]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
        for (name, text) in files {
            std::fs::write(root.join(name), text).unwrap();
        }
        let host =
            Host::without_watcher().with_startup_source(Arc::new(WithRighe { edits, prose }));
        host.open(&root).expect("il vault si apre");
        host.wait_indexed(None).expect("indicizzato");
        Vault {
            _dir: dir,
            root,
            host,
        }
    }

    fn focus(&self, doc: &str, selections: SelectionSet) {
        self.host
            .set_active_context(
                None,
                Some(
                    ViewContext::new(PANE)
                        .with_doc(Some(DocId::new(doc)))
                        .with_selections(Some(selections)),
                ),
            )
            .expect("contesto");
    }

    fn run(&self, command: &str, args: serde_json::Value) -> Result<(), PluginError> {
        self.host
            .invoke_user_command(None, command, args, InvokeMode::Apply)
            .map(|_| ())
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel)).unwrap()
    }
}

fn bad_args(result: Result<(), PluginError>) {
    match result {
        Err(PluginError::BadArgs(_)) => {}
        other => panic!("atteso un rifiuto tipizzato, non {other:?}"),
    }
}

#[test]
fn a_selection_becomes_a_link_in_the_syntax_of_its_format() {
    let vault = Vault::open(true, &[("lista.righe", "parlo di Kant\n")]);
    let start = "parlo di ".len();
    vault.focus(
        "lista.righe",
        SelectionSet::anchored(Span::new(start, start + 4), "Kant"),
    );
    vault
        .run("selection.wikilink", serde_json::json!({}))
        .expect("il formato sa scrivere il link");
    assert_eq!(vault.read("lista.righe"), "parlo di <<Kant>>\n");
}

#[test]
fn a_task_is_ticked_with_the_symbol_of_its_format() {
    let vault = Vault::open(true, &[("lista.righe", "( ) latte\n(v) pane\n")]);
    vault
        .run(
            "note.task.toggle",
            serde_json::json!({"doc": "lista.righe", "at": [4]}),
        )
        .expect("spunta");
    assert_eq!(vault.read("lista.righe"), "(v) latte\n(v) pane\n");
    vault
        .run(
            "note.task.toggle",
            serde_json::json!({"doc": "lista.righe", "at": [14]}),
        )
        .expect("toglie la spunta");
    assert_eq!(vault.read("lista.righe"), "(v) latte\n( ) pane\n");
}

#[test]
fn a_format_without_the_operations_refuses_and_keeps_the_file() {
    let source = "( ) latte\nparlo di Kant\n";
    let vault = Vault::open(false, &[("lista.righe", source)]);
    bad_args(vault.run(
        "note.task.toggle",
        serde_json::json!({"doc": "lista.righe", "at": [4]}),
    ));
    let start = source.find("Kant").unwrap();
    vault.focus(
        "lista.righe",
        SelectionSet::anchored(Span::new(start, start + 4), "Kant"),
    );
    bad_args(vault.run("selection.wikilink", serde_json::json!({})));
    assert_eq!(
        vault.read("lista.righe"),
        source,
        "nessuna sintassi estranea"
    );
}

/// Il rifiuto dice il formato: una selezione senza coordinate in un sorgente
/// che non è prosa non diventa «il buffer ha modifiche da salvare», che
/// l'utente non potrebbe risolvere salvando.
#[test]
fn a_floating_selection_outside_prose_is_refused_for_the_format() {
    let source = "( ) latte\nparlo di Kant\n";
    let vault = Vault::open_with(true, false, &[("lista.righe", source)]);
    vault.focus("lista.righe", SelectionSet::floating("latte"));
    for command in ["selection.wikilink", "note.extract"] {
        match vault.run(command, serde_json::json!({})) {
            // L'host rende il messaggio nella lingua dell'utente: fra i rifiuti
            // possibili, soltanto quello del formato nomina il documento.
            Err(PluginError::BadArgs(text)) => assert!(
                text.as_literal().is_some_and(|t| t.contains("lista.righe")),
                "{command} nomina il formato, non il buffer: {text:?}"
            ),
            other => panic!("{command}: atteso un rifiuto tipizzato, non {other:?}"),
        }
    }
    assert_eq!(vault.read("lista.righe"), source, "il file non cambia");
}

#[test]
fn markdown_still_writes_wikilinks_and_ticks() {
    let vault = Vault::open(true, &[("nota.md", "- [ ] latte\n\nparlo di Kant\n")]);
    vault
        .run(
            "note.task.toggle",
            serde_json::json!({"doc": "nota.md", "at": [6]}),
        )
        .expect("spunta");
    let start = "- [x] latte\n\nparlo di ".len();
    vault.focus(
        "nota.md",
        SelectionSet::anchored(Span::new(start, start + 4), "Kant"),
    );
    vault
        .run("selection.wikilink", serde_json::json!({}))
        .expect("wikilink");
    assert_eq!(vault.read("nota.md"), "- [x] latte\n\nparlo di [[Kant]]\n");
}
