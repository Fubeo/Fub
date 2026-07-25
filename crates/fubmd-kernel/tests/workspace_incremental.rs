//! Lo stesso confronto incrementale-vs-rebuild del grafo, ma **dal livello
//! `Workspace`**: passando dal disco, dal parse di un provider e dagli eventi.
//!
//! Il provider qui è un giocattolo di venti righe (una riga = un wikilink):
//! il kernel non deve conoscere il markdown nemmeno nei propri test, e questo è
//! anche il modo più economico di verificare che `FormatProvider` basti a sé
//! stesso senza l'implementazione vera.

use camino::Utf8PathBuf;
use fubmd_abi::error::FormatError;
use fubmd_abi::format::{FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions};
use fubmd_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, GraphUpdate, Workspace};

/// Formato `.lnk`: ogni riga non vuota è il nome di una pagina collegata.
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
                let aliases = model.frontmatter.0.entry("aliases").or_insert(json_array());
                if let Some(arr) = aliases.as_array_mut() {
                    arr.push(serde_json::Value::String(alias.trim().to_string()));
                }
                continue;
            }
            model.links.push(Link {
                target: LinkTarget::wiki(page),
                embed: false,
                span,
                context: Some(format!("{} → {page}", ctx.doc_id)),
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

fn json_array() -> serde_json::Value {
    serde_json::Value::Array(Vec::new())
}

fn workspace(dir: &Utf8PathBuf, mode: GraphUpdate) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry.register(Box::new(LinkListProvider));
    let mut ws = Workspace::new(dir, registry);
    ws.set_graph_update(mode);
    ws.reindex().expect("reindex di un vault vuoto");
    ws
}

/// Directory temporanea usa-e-getta (niente dipendenze di test nel kernel).
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

/// Le operazioni del copione, applicate identiche ai due workspace.
const SCRIPT: &[(&str, &str)] = &[
    // (doc, sorgente) — sorgente `@remove` significa cancellazione
    ("a.lnk", "Nota\nAltra"),
    ("sub/Nota.lnk", "a"),
    ("Nota.lnk", "alias: Mario\na"), // ruba il nome `nota` a sub/Nota
    ("b.lnk", "Mario\nsub/Nota\nNota"), // link per alias, per path e per nome
    ("Nota.lnk", "@remove"),         // il nome torna a sub/Nota, l'alias sparisce
    ("sub/Altra.lnk", "b"),
    ("Altra.lnk", "b\nb"),    // link duplicati verso lo stesso target
    ("a.lnk", "Inesistente"), // a perde tutti i link risolti
    ("sub/Altra.lnk", "@remove"),
    ("Nota.lnk", "alias: Mario"), // torna, con l'alias
    ("b.lnk", "@remove"),
];

#[test]
fn workspace_incremental_matches_full_rebuild() {
    let inc_dir = TempDir::new("inc");
    let reb_dir = TempDir::new("reb");
    let mut incremental = workspace(&inc_dir.0, GraphUpdate::Incremental);
    let mut rebuild = workspace(&reb_dir.0, GraphUpdate::FullRebuild);

    for (step, (path, source)) in SCRIPT.iter().enumerate() {
        let id = DocId::new(*path);
        for ws in [&mut incremental, &mut rebuild] {
            if *source == "@remove" {
                let abs = ws.root().join(path);
                std::fs::remove_file(&abs).expect("cancella il documento");
                ws.remove_document(&id);
            } else {
                if let Some(parent) = ws.root().join(path).parent() {
                    std::fs::create_dir_all(parent).expect("crea sottocartella");
                }
                ws.write_document(&id, source).expect("scrive il documento");
            }
        }

        assert_eq!(
            incremental.documents(),
            rebuild.documents(),
            "documenti disallineati al passo {step} ({path})"
        );
        for doc in rebuild.documents() {
            assert_eq!(
                incremental.backlinks(&doc),
                rebuild.backlinks(&doc),
                "backlink di {doc} al passo {step} ({path})"
            );
            assert_eq!(
                incremental.outgoing(&doc),
                rebuild.outgoing(&doc),
                "link uscenti di {doc} al passo {step} ({path})"
            );
        }
        for key in ["Nota", "sub/Nota", "Altra", "sub/Altra", "Mario", "a", "b"] {
            assert_eq!(
                incremental.resolve_link(key),
                rebuild.resolve_link(key),
                "risoluzione di `{key}` al passo {step} ({path})"
            );
        }
    }

    // Il copione deve aver prodotto un grafo vivo, non un vault vuoto per caso.
    assert!(!incremental.documents().is_empty());
    assert_eq!(
        incremental.resolve_link("Mario"),
        Some(DocId::new("Nota.lnk"))
    );
}

/// Il caso del milestone: creare la nota mancante fa comparire il backlink,
/// senza toccare nient'altro.
#[test]
fn creating_a_missing_note_makes_the_backlink_appear() {
    let dir = TempDir::new("create");
    let mut ws = workspace(&dir.0, GraphUpdate::Incremental);

    let source = DocId::new("origine.lnk");
    ws.write_document(&source, "Da Creare")
        .expect("scrive origine");
    assert_eq!(ws.resolve_link("Da Creare"), None);
    assert!(ws.outgoing(&source).is_empty());

    let created = DocId::new("Da Creare.lnk");
    ws.write_document(&created, "")
        .expect("crea la nota mancante");

    assert_eq!(ws.resolve_link("Da Creare"), Some(created.clone()));
    assert_eq!(ws.outgoing(&source), vec![created.clone()]);
    let backlinks = ws.backlinks(&created);
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0].source, source);
}
