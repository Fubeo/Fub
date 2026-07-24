//! Test dei due nodi concettuali sciolti nel kernel:
//!
//! 1. **Rename con identità**: `rename_document` sposta il file, migra grafo e
//!    modello, emette `DocumentRenamed` (non remove+add) e riscrive in modo
//!    chirurgico i wikilink entranti per nome/path — mai quelli per alias.
//! 2. **Dispatch a coda**: gli `EventHandler` girano dentro al kernel senza
//!    rientranza; un handler può emettere eventi e scrivere documenti durante
//!    `handle` senza innescare dispatch ricorsivi.
//!
//! Il provider è lo stesso giocattolo di `workspace_incremental.rs`: una riga
//! non vuota = un wikilink; `alias: X` dichiara un alias nel frontmatter.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventKind, EventMask};
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fubmd_abi::traits::{EventHandler, HostApi};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

struct LinkListProvider;

impl FormatProvider for LinkListProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor {
            id: "linklist".into(),
            name: "Lista di link (test)".into(),
            extensions: vec!["lnk".into()],
        }
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities {
            wikilinks: true,
            ..FormatCapabilities::default()
        }
    }

    fn parse(&self, source: &str, ctx: &ParseContext) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let mut offset = 0usize;
        for line in source.lines() {
            let span = Span::new(offset, offset + line.len());
            offset += line.len() + 1;
            let page = line.trim();
            if page.is_empty() {
                continue;
            }
            if let Some(alias) = page.strip_prefix("alias:") {
                let aliases = model
                    .frontmatter
                    .0
                    .entry("aliases")
                    .or_insert(serde_json::Value::Array(Vec::new()));
                if let Some(arr) = aliases.as_array_mut() {
                    arr.push(serde_json::Value::String(alias.trim().to_string()));
                }
                continue;
            }
            model.links.push(Link {
                target: LinkTarget::wiki(page),
                span,
                context: None,
            });
        }
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(format!("<pre>{}</pre>", model.text))
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

struct TempDir(Utf8PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let base = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("temp dir non UTF-8")
            .join(format!("fubmd-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("crea temp dir");
        TempDir(base)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn workspace(dir: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(LinkListProvider));
    let mut ws = Workspace::new(dir, registry);
    ws.reindex().expect("reindex vault vuoto");
    ws
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

#[test]
fn rename_moves_identity_rewrites_name_links_and_emits_renamed() {
    let dir = TempDir::new("rename-base");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("sub/Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "Nota\nAltraCosa")
        .unwrap();

    let rx = ws.bus().subscribe();
    ws.rename_document(
        &DocId::new("sub/Nota.lnk"),
        &DocId::new("sub/Rinominata.lnk"),
    )
    .unwrap();

    // Il file è stato spostato e l'identità migrata (niente remove+add).
    assert!(!dir.0.join("sub/Nota.lnk").exists());
    assert!(dir.0.join("sub/Rinominata.lnk").exists());
    assert!(!ws.documents().contains(&DocId::new("sub/Nota.lnk")));

    // Il wikilink per nome è stato riscritto chirurgicamente (l'altra riga no).
    let src = ws.read_source(&DocId::new("a.lnk")).unwrap();
    assert_eq!(src, "Rinominata\nAltraCosa");

    // Il grafo segue: il backlink punta al nuovo id.
    let bl = ws.backlinks(&DocId::new("sub/Rinominata.lnk"));
    assert_eq!(bl.len(), 1);
    assert_eq!(bl[0].source, DocId::new("a.lnk"));

    // Fra gli eventi c'è DocumentRenamed con la coppia giusta.
    let mut renamed = None;
    while let Ok(e) = rx.try_recv() {
        if let Event::DocumentRenamed { from, to } = e {
            renamed = Some((from, to));
        }
    }
    assert_eq!(
        renamed,
        Some((DocId::new("sub/Nota.lnk"), DocId::new("sub/Rinominata.lnk")))
    );
}

#[test]
fn rename_leaves_alias_links_untouched() {
    let dir = TempDir::new("rename-alias");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Persona.lnk"), "alias: Mario")
        .unwrap();
    ws.write_document(&DocId::new("b.lnk"), "Mario").unwrap();

    ws.rename_document(&DocId::new("Persona.lnk"), &DocId::new("Anagrafica.lnk"))
        .unwrap();

    // L'alias vive nel frontmatter del target: il link sopravvive invariato.
    assert_eq!(ws.read_source(&DocId::new("b.lnk")).unwrap(), "Mario");
    let bl = ws.backlinks(&DocId::new("Anagrafica.lnk"));
    assert_eq!(bl.len(), 1);
    assert_eq!(bl[0].source, DocId::new("b.lnk"));
}

#[test]
fn rename_does_not_hijack_links_to_a_homonym() {
    let dir = TempDir::new("rename-homonym");
    let mut ws = workspace(&dir.0);
    // `Nota` risolve alla radice (shortest path), non a sub/Nota.
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("sub/Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "Nota").unwrap();

    ws.rename_document(&DocId::new("sub/Nota.lnk"), &DocId::new("sub/Z.lnk"))
        .unwrap();

    // Il link di `a` puntava all'omonimo alla radice: non va toccato.
    assert_eq!(ws.read_source(&DocId::new("a.lnk")).unwrap(), "Nota");
    assert_eq!(
        ws.backlinks(&DocId::new("Nota.lnk"))[0].source,
        DocId::new("a.lnk")
    );
}

#[test]
fn rename_to_contended_name_rewrites_by_path() {
    let dir = TempDir::new("rename-ambiguous");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Altra.lnk"), "").unwrap();
    ws.write_document(&DocId::new("sub/Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "Nota").unwrap();

    // Il nuovo nome `Altra` è conteso: la riscrittura deve usare il path.
    ws.rename_document(&DocId::new("sub/Nota.lnk"), &DocId::new("sub/Altra.lnk"))
        .unwrap();

    assert_eq!(ws.read_source(&DocId::new("a.lnk")).unwrap(), "sub/Altra");
    let bl = ws.backlinks(&DocId::new("sub/Altra.lnk"));
    assert_eq!(bl.len(), 1);
    assert_eq!(bl[0].source, DocId::new("a.lnk"));
}

#[test]
fn rename_onto_existing_document_is_refused() {
    let dir = TempDir::new("rename-clash");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("a.lnk"), "").unwrap();
    ws.write_document(&DocId::new("b.lnk"), "").unwrap();

    let err = ws
        .rename_document(&DocId::new("a.lnk"), &DocId::new("b.lnk"))
        .unwrap_err();
    assert!(err.to_string().contains("esiste già"));
    // Nessun danno collaterale.
    assert!(ws.documents().contains(&DocId::new("a.lnk")));
    assert!(ws.documents().contains(&DocId::new("b.lnk")));
}

// ---------------------------------------------------------------------------
// Dispatch a coda (anti-rientranza)
// ---------------------------------------------------------------------------

type Log = Arc<Mutex<Vec<String>>>;

/// Handler che logga ciò che riceve e, su `DocumentChanged`, emette un evento
/// custom e scrive un documento derivato — il caso rientrante per eccellenza.
struct ChainingHandler {
    log: Log,
}

impl EventHandler for ChainingHandler {
    fn subscribed(&self) -> EventMask {
        EventMask(vec![EventKind::DocumentChanged, EventKind::Custom])
    }

    fn handle(&mut self, event: &Event, host: &mut dyn HostApi) -> Result<(), PluginError> {
        match event {
            Event::DocumentChanged { id } => {
                self.log.lock().unwrap().push(format!("changed:{id}"));
                // Reagisce solo al documento "innesco", altrimenti la scrittura
                // qui sotto rigenererebbe l'evento all'infinito (il budget del
                // kernel tronca comunque, ma il test vuole un ciclo che converge).
                if id.as_str() == "innesco.lnk" && host.storage_get("done").is_none() {
                    host.storage_set("done", serde_json::Value::Bool(true));
                    host.emit(Event::Custom {
                        topic: "test/derivato".into(),
                        payload: serde_json::json!({ "da": id.as_str() }),
                    });
                    host.write_document(&DocId::new("derivato.lnk"), "innesco")?;
                }
                Ok(())
            }
            Event::Custom { topic, .. } => {
                self.log.lock().unwrap().push(format!("custom:{topic}"));
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[test]
fn handlers_run_queued_not_recursive_and_can_write_documents() {
    let dir = TempDir::new("dispatch");
    let mut ws = workspace(&dir.0);
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    ws.register_event_handler(Box::new(ChainingHandler { log: log.clone() }));

    ws.write_document(&DocId::new("innesco.lnk"), "").unwrap();

    // Il documento scritto DAL handler esiste ed è nel grafo.
    assert!(ws.documents().contains(&DocId::new("derivato.lnk")));
    assert_eq!(
        ws.backlinks(&DocId::new("innesco.lnk"))
            .first()
            .map(|b| b.source.clone()),
        Some(DocId::new("derivato.lnk"))
    );

    // Ordine FIFO: prima l'evento che ha innescato, poi quelli accodati
    // durante il handle (custom, poi il changed del documento derivato).
    let log = log.lock().unwrap();
    assert_eq!(
        *log,
        vec![
            "changed:innesco.lnk".to_string(),
            "custom:test/derivato".to_string(),
            "changed:derivato.lnk".to_string(),
        ]
    );
}

/// Due handler che si rimbalzano eventi custom a vicenda per sempre: il budget
/// di dispatch tronca il ping-pong invece di bloccare il kernel.
struct PingPongHandler {
    count: Arc<Mutex<usize>>,
}

impl EventHandler for PingPongHandler {
    fn subscribed(&self) -> EventMask {
        // DocumentChanged è la miccia; Custom è il rimbalzo infinito.
        EventMask(vec![EventKind::DocumentChanged, EventKind::Custom])
    }

    fn handle(&mut self, _event: &Event, host: &mut dyn HostApi) -> Result<(), PluginError> {
        *self.count.lock().unwrap() += 1;
        host.emit(Event::Custom {
            topic: "test/pong".into(),
            payload: serde_json::Value::Null,
        });
        Ok(())
    }
}

#[test]
fn dispatch_budget_stops_infinite_event_loops() {
    let dir = TempDir::new("pingpong");
    let mut ws = workspace(&dir.0);
    let count = Arc::new(Mutex::new(0usize));
    ws.register_event_handler(Box::new(PingPongHandler {
        count: count.clone(),
    }));

    // L'evento Custom emesso dal handler rialimenta sé stesso: senza budget
    // questo write non tornerebbe mai.
    ws.write_document(&DocId::new("x.lnk"), "").unwrap();

    let n = *count.lock().unwrap();
    assert!(n > 0, "il handler deve essere stato chiamato");
    assert!(n <= 2048, "il budget deve aver troncato il ping-pong: {n}");
}
