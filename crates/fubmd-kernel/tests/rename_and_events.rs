//! Test dei due nodi concettuali sciolti nel kernel:
//!
//! 1. **Rename con identità**: `rename_document` sposta il file, migra grafo e
//!    modello, emette `DocumentRenamed` (non remove+add) e riscrive in modo
//!    chirurgico i link entranti per nome/path — mai quelli per alias.
//! 2. **Dispatch a coda**: gli `EventHandler` girano dentro al kernel senza
//!    rientranza; un handler può emettere eventi e scrivere documenti durante
//!    `handle` senza innescare dispatch ricorsivi.
//!
//! Il provider è lo stesso giocattolo di `workspace_incremental.rs`, con una
//! riga in più: una riga non vuota = un wikilink; `alias: X` dichiara un alias
//! nel frontmatter; `[testo](dest)` è un link markdown — `Path` se `dest` è un
//! percorso, `Url` se è un indirizzo. Serve perché le due specie di link hanno
//! regole di riscrittura diverse (il path è relativo a chi lo scrive) e la
//! differenza si vede solo su un documento vero, con degli offset veri.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fubmd_abi::error::{FormatError, PluginError};
use fubmd_abi::event::{Event, EventKind, EventMask, Notice};
use fubmd_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fubmd_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fubmd_abi::options::syntax;
use fubmd_abi::traits::{EventHandler, HostApi, JobSpec};
use fubmd_abi::FormatProvider;
use fubmd_kernel::{FormatRegistry, Workspace};

struct LinkListProvider;

impl FormatProvider for LinkListProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("linklist", "Lista di link (test)", &["lnk"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[syntax::WIKILINKS])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source = source.text().unwrap_or_default();
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
            let target = match markdown_dest(page) {
                Some(dest) if dest.contains("://") => LinkTarget::Url(dest.to_string()),
                Some(dest) => LinkTarget::Path(dest.to_string()),
                None => LinkTarget::wiki(page),
            };
            model.links.push(Link {
                target,
                embed: false,
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

/// La destinazione di `[etichetta](destinazione)`, se la riga è tutta lì.
fn markdown_dest(line: &str) -> Option<&str> {
    let rest = line.strip_prefix('[')?;
    let (_label, rest) = rest.split_once("](")?;
    rest.strip_suffix(')')
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
    registry
        .register(Box::new(LinkListProvider))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(dir, registry);
    // I plugin di prova si dichiarano prima di registrare (§7.3): il
    // kernel non presta capacità a una stringa.
    for plugin in ["test.chaining", "test.pingpong", "test.jobs"] {
        ws.register_core_feature(plugin, plugin)
            .expect("dichiarato");
    }
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
        if let Event::DocumentRenamed { from, to } = e.event {
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
fn case_only_rename_preserves_identity() {
    // `nota.lnk` → `Nota.lnk`: su un filesystem case-insensitive il target
    // "esiste già" (è lo stesso file) — il rename deve comunque riuscire.
    let dir = TempDir::new("rename-case");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "nota").unwrap();

    ws.rename_document(&DocId::new("nota.lnk"), &DocId::new("Nota.lnk"))
        .unwrap();

    assert!(ws.documents().contains(&DocId::new("Nota.lnk")));
    assert!(!ws.documents().contains(&DocId::new("nota.lnk")));
    // La risoluzione è case-insensitive: il backlink sopravvive.
    let bl = ws.backlinks(&DocId::new("Nota.lnk"));
    assert_eq!(bl.len(), 1);
    assert_eq!(bl[0].source, DocId::new("a.lnk"));
}

#[test]
fn rename_rewrites_the_self_link_too() {
    // Il self-link è escluso dai backlink per scelta, ma al rename va
    // riscritto come gli altri: `[[Nota]]` dentro Nota stessa resterebbe
    // dangling — e verrebbe dirottato da chi ricreasse il vecchio nome.
    let dir = TempDir::new("rename-self");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "Nota").unwrap();

    ws.rename_document(&DocId::new("Nota.lnk"), &DocId::new("Rinominata.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("Rinominata.lnk")).unwrap(),
        "Rinominata",
        "il self-link deve seguire il rename, applicato al path nuovo"
    );
}

// ---------------------------------------------------------------------------
// Link markdown: archi come gli altri, con una regola di riscrittura in più
// ---------------------------------------------------------------------------

#[test]
fn a_markdown_path_link_is_an_edge_like_a_wikilink() {
    // La decisione 0004: `[t](sub/Nota.lnk)` deve avere backlink e arco esattamente
    // come `[[Nota]]`, o «aggiornamento link su rinomina» è vero a metà.
    let dir = TempDir::new("pathlink-edge");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("sub/Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[testo](sub/Nota.lnk)")
        .unwrap();

    let bl = ws.backlinks(&DocId::new("sub/Nota.lnk"));
    assert_eq!(bl.len(), 1);
    assert_eq!(bl[0].source, DocId::new("a.lnk"));
}

#[test]
fn urls_and_links_out_of_the_vault_are_not_edges() {
    let dir = TempDir::new("pathlink-nonedge");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.write_document(
        &DocId::new("a.lnk"),
        "[web](https://esempio.test/Nota.lnk)\n[fuori](../Nota.lnk)\n[ancora](#sezione)",
    )
    .unwrap();

    assert!(ws.backlinks(&DocId::new("Nota.lnk")).is_empty());
    // E un rename non li tocca: non c'è niente da riparare.
    ws.rename_document(&DocId::new("Nota.lnk"), &DocId::new("Spostata.lnk"))
        .unwrap();
    assert_eq!(
        ws.read_source(&DocId::new("a.lnk")).unwrap(),
        "[web](https://esempio.test/Nota.lnk)\n[fuori](../Nota.lnk)\n[ancora](#sezione)"
    );
}

#[test]
fn a_path_link_does_not_resolve_by_name_or_alias() {
    // Un wikilink `[[Nota]]` pesca il nome ovunque sia; `[t](Nota.lnk)` no:
    // l'utente ha scritto un path, e alla radice quel path non c'è.
    let dir = TempDir::new("pathlink-strict");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("sub/Nota.lnk"), "alias: Mario")
        .unwrap();
    ws.write_document(
        &DocId::new("a.lnk"),
        "[per nome](Nota.lnk)\n[per alias](Mario)",
    )
    .unwrap();

    assert!(ws.backlinks(&DocId::new("sub/Nota.lnk")).is_empty());
}

#[test]
fn a_path_link_takes_its_extension_seriously() {
    // `sub/Nota` senza estensione risolve (è la chiave dei wikilink), ma
    // `sub/Nota.png` no: non esiste, e non deve ricadere sul `.lnk` omonimo.
    let dir = TempDir::new("pathlink-ext");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("sub/Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[senza](sub/Nota)")
        .unwrap();
    ws.write_document(&DocId::new("b.lnk"), "[sbagliata](sub/Nota.png)")
        .unwrap();

    let sources: Vec<DocId> = ws
        .backlinks(&DocId::new("sub/Nota.lnk"))
        .into_iter()
        .map(|r| r.source)
        .collect();
    assert_eq!(sources, [DocId::new("a.lnk")]);
}

#[test]
fn renaming_a_target_rewrites_incoming_path_links_relative_to_each_source() {
    // Lo stesso documento è scritto in due modi diversi da due cartelle
    // diverse: la riscrittura deve produrre due testi diversi, ciascuno
    // relativo a chi lo contiene. È la differenza col wikilink, ed è tutta qui.
    let dir = TempDir::new("pathlink-rewrite");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("note/Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[t](note/Nota.lnk)")
        .unwrap();
    ws.write_document(&DocId::new("note/vicina.lnk"), "[t](Nota.lnk)")
        .unwrap();
    ws.write_document(&DocId::new("x/y/lontana.lnk"), "[t](../../note/Nota.lnk)")
        .unwrap();

    ws.rename_document(
        &DocId::new("note/Nota.lnk"),
        &DocId::new("archivio/Rinominata.lnk"),
    )
    .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("a.lnk")).unwrap(),
        "[t](archivio/Rinominata.lnk)"
    );
    assert_eq!(
        ws.read_source(&DocId::new("note/vicina.lnk")).unwrap(),
        "[t](../archivio/Rinominata.lnk)"
    );
    assert_eq!(
        ws.read_source(&DocId::new("x/y/lontana.lnk")).unwrap(),
        "[t](../../archivio/Rinominata.lnk)"
    );
    assert_eq!(
        ws.backlinks(&DocId::new("archivio/Rinominata.lnk")).len(),
        3
    );
}

#[test]
fn moving_a_document_rebases_its_own_relative_links() {
    // Il caso che il wikilink non ha: a spostarsi è la **sorgente**, e i suoi
    // link relativi puntavano da dove non è più. Nessun backlink lo segnala —
    // il documento che si rompe è quello che si è mosso.
    let dir = TempDir::new("pathlink-rebase");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("note/altra.lnk"), "")
        .unwrap();
    ws.write_document(&DocId::new("radice.lnk"), "").unwrap();
    ws.write_document(
        &DocId::new("a.lnk"),
        "[giù](note/altra.lnk)\n[accanto](radice.lnk)\n[dalla radice](/radice.lnk)\n[[radice]]",
    )
    .unwrap();

    ws.rename_document(&DocId::new("a.lnk"), &DocId::new("x/y/a.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("x/y/a.lnk")).unwrap(),
        // I due relativi risalgono; quello dalla radice e il wikilink non si
        // toccano — nessuno dei due dipende da dove sta il documento.
        "[giù](../../note/altra.lnk)\n[accanto](../../radice.lnk)\n[dalla radice](/radice.lnk)\n[[radice]]"
    );
    assert_eq!(
        ws.backlinks(&DocId::new("note/altra.lnk"))[0].source,
        DocId::new("x/y/a.lnk")
    );
}

#[test]
fn a_moved_document_rewrites_its_self_link_and_its_links_together() {
    let dir = TempDir::new("pathlink-self");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("altra.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[io](a.lnk)\n[lei](altra.lnk)")
        .unwrap();

    ws.rename_document(&DocId::new("a.lnk"), &DocId::new("sub/b.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("sub/b.lnk")).unwrap(),
        "[io](b.lnk)\n[lei](../altra.lnk)"
    );
}

#[test]
fn a_rewritten_reference_is_escaped_and_regains_its_extension() {
    // Due cose che il riferimento nuovo deve garantire e il vecchio no: che
    // stia dentro `[]()` senza rompersi, e che risolva senza ambiguità.
    let dir = TempDir::new("pathlink-escape");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[t](Nota)")
        .unwrap();

    ws.rename_document(&DocId::new("Nota.lnk"), &DocId::new("f(x) uno.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("a.lnk")).unwrap(),
        "[t](f%28x%29%20uno.lnk)"
    );
    // E il link riscritto è di nuovo un arco: è l'unica prova che conti.
    assert_eq!(
        ws.backlinks(&DocId::new("f(x) uno.lnk"))[0].source,
        DocId::new("a.lnk")
    );
}

#[test]
fn an_encoded_path_link_is_the_same_edge_as_a_bare_one() {
    let dir = TempDir::new("pathlink-encoded");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("sub/nota uno.lnk"), "")
        .unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[t](sub/nota%20uno.lnk)")
        .unwrap();

    assert_eq!(
        ws.backlinks(&DocId::new("sub/nota uno.lnk"))[0].source,
        DocId::new("a.lnk")
    );
}

#[test]
fn a_fragment_survives_the_rewrite() {
    let dir = TempDir::new("pathlink-fragment");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[t](Nota.lnk#una-sezione)")
        .unwrap();

    ws.rename_document(&DocId::new("Nota.lnk"), &DocId::new("sub/Spostata.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("a.lnk")).unwrap(),
        "[t](sub/Spostata.lnk#una-sezione)"
    );
}

#[test]
fn a_dangling_path_link_is_left_alone() {
    // Riscrivere un link già rotto vorrebbe dire indovinare cosa intendeva.
    let dir = TempDir::new("pathlink-dangling");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "[rotto](mai/esistito.lnk)")
        .unwrap();

    ws.rename_document(&DocId::new("a.lnk"), &DocId::new("sub/a.lnk"))
        .unwrap();

    assert_eq!(
        ws.read_source(&DocId::new("sub/a.lnk")).unwrap(),
        "[rotto](mai/esistito.lnk)"
    );
}

#[test]
fn rename_migrates_the_active_document_and_removal_clears_it() {
    let dir = TempDir::new("rename-active");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.set_active_document(Some(DocId::new("Nota.lnk")));

    // Dopo il rename il kernel deve rispondere col path nuovo, o le view che
    // leggono `active_document` si svuotano fino al prossimo cambio nota.
    ws.rename_document(&DocId::new("Nota.lnk"), &DocId::new("Spostata.lnk"))
        .unwrap();
    assert_eq!(ws.active_document(), Some(&DocId::new("Spostata.lnk")));

    // E una nota rimossa non può restare "attiva".
    ws.remove_document(&DocId::new("Spostata.lnk"));
    assert_eq!(ws.active_document(), None);
}

#[test]
fn rename_cannot_escape_the_vault() {
    let dir = TempDir::new("rename-escape");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();

    for fuori in ["../fuori.lnk", "sub/../../fuori.lnk", "a//b.lnk", "./x.lnk"] {
        let err = ws
            .rename_document(&DocId::new("Nota.lnk"), &DocId::new(fuori))
            .unwrap_err();
        assert!(
            err.to_string().contains("nome non valido"),
            "`{fuori}` doveva essere rifiutato, invece: {err}"
        );
    }
    // La nota non si è mossa e nessun file è uscito dal vault.
    assert!(ws.documents().contains(&DocId::new("Nota.lnk")));
    assert!(!dir.0.parent().unwrap().join("fuori.lnk").exists());
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
// Rename esterno (watcher): migrazione d'identità, non remove+add
// ---------------------------------------------------------------------------

#[test]
fn an_external_rename_migrates_identity_and_emits_renamed() {
    let dir = TempDir::new("extrename");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "AltraCosa")
        .unwrap();
    ws.set_active_document(Some(DocId::new("Nota.lnk")));

    // Qualcun altro (Finder, Obsidian, sync) sposta il file.
    std::fs::rename(dir.0.join("Nota.lnk"), dir.0.join("Spostata.lnk")).unwrap();

    let rx = ws.bus().subscribe();
    assert!(ws
        .sync_renamed_path(&dir.0.join("Nota.lnk"), &dir.0.join("Spostata.lnk"))
        .unwrap());

    // Identità migrata: modelli, documento attivo, e l'evento è Renamed —
    // non la coppia Removed+Changed che spezzerebbe versioning e meta.
    assert!(!ws.documents().contains(&DocId::new("Nota.lnk")));
    assert!(ws.documents().contains(&DocId::new("Spostata.lnk")));
    assert_eq!(ws.active_document(), Some(&DocId::new("Spostata.lnk")));
    let eventi: Vec<Event> = rx.try_iter().map(|n| n.event).collect();
    assert!(
        eventi
            .iter()
            .any(|e| matches!(e, Event::DocumentRenamed { from, to }
            if from.as_str() == "Nota.lnk" && to.as_str() == "Spostata.lnk")),
        "eventi: {eventi:?}"
    );
    assert!(
        !eventi
            .iter()
            .any(|e| matches!(e, Event::DocumentRemoved { .. })),
        "un rename esterno non è una rimozione: {eventi:?}"
    );
}

#[test]
fn an_external_rename_does_not_rewrite_incoming_links() {
    let dir = TempDir::new("extrename-links");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();
    ws.write_document(&DocId::new("a.lnk"), "Nota").unwrap();

    std::fs::rename(dir.0.join("Nota.lnk"), dir.0.join("Spostata.lnk")).unwrap();
    ws.sync_renamed_path(&dir.0.join("Nota.lnk"), &dir.0.join("Spostata.lnk"))
        .unwrap();

    // Chi ha rinominato può aver già riscritto i link (Obsidian lo fa):
    // il watcher non tocca le sorgenti altrui.
    assert_eq!(ws.read_source(&DocId::new("a.lnk")).unwrap(), "Nota");
}

#[test]
fn an_external_rename_into_an_ignored_folder_is_a_removal() {
    let dir = TempDir::new("extrename-trash");
    let mut ws = workspace(&dir.0);
    ws.write_document(&DocId::new("Nota.lnk"), "").unwrap();

    std::fs::create_dir_all(dir.0.join(".trash")).unwrap();
    std::fs::rename(dir.0.join("Nota.lnk"), dir.0.join(".trash/Nota.lnk")).unwrap();

    let rx = ws.bus().subscribe();
    assert!(ws
        .sync_renamed_path(&dir.0.join("Nota.lnk"), &dir.0.join(".trash/Nota.lnk"))
        .unwrap());
    assert!(ws.documents().is_empty());
    assert!(rx
        .try_iter()
        .any(|n| matches!(n.event, Event::DocumentRemoved { id }
        if id.as_str() == "Nota.lnk")));
}

// ---------------------------------------------------------------------------
// Dispatch a coda (anti-rientranza)
// ---------------------------------------------------------------------------

type Log = Arc<Mutex<Vec<String>>>;

/// Handler che logga ciò che riceve e, su `DocumentChanged`, emette un evento
/// custom e scrive un documento derivato — il caso rientrante per eccellenza.
struct ChainingHandler {
    log: Log,
    /// Ha già reagito? Era una chiave dello `storage_*` dell'host finché quello
    /// esisteva; adesso è un campo — che è il punto per cui la decisione 0013 lo ha
    /// tolto, perché un handler è un oggetto vivo e la memoria ce l'ha già.
    fatto: bool,
}

impl EventHandler for ChainingHandler {
    fn subscribed(&self) -> EventMask {
        EventMask(vec![EventKind::DocumentChanged, EventKind::Custom])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let event = &notice.event;
        match event {
            Event::DocumentChanged { id } => {
                self.log.lock().unwrap().push(format!("changed:{id}"));
                // Reagisce solo al documento "innesco", altrimenti la scrittura
                // qui sotto rigenererebbe l'evento all'infinito (il budget del
                // kernel tronca comunque, ma il test vuole un ciclo che converge).
                if id.as_str() == "innesco.lnk" && !self.fatto {
                    self.fatto = true;
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
    ws.register_event_handler(
        "test.chaining",
        Box::new(ChainingHandler {
            log: log.clone(),
            fatto: false,
        }),
    )
    .expect("registrato");

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

    fn handle(&mut self, _notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        *self.count.lock().unwrap() += 1;
        host.emit(Event::Custom {
            topic: "test/pong".into(),
            payload: serde_json::Value::Null,
        });
        Ok(())
    }
}

#[test]
fn dispatch_budget_stops_infinite_event_loops_loudly() {
    let dir = TempDir::new("pingpong");
    let mut ws = workspace(&dir.0);
    let count = Arc::new(Mutex::new(0usize));
    ws.register_event_handler(
        "test.pingpong",
        Box::new(PingPongHandler {
            count: count.clone(),
        }),
    )
    .expect("registrato");

    let rx = ws.bus().subscribe();
    // L'evento Custom emesso dal handler rialimenta sé stesso: senza budget
    // questo write non tornerebbe mai.
    ws.write_document(&DocId::new("x.lnk"), "").unwrap();

    let n = *count.lock().unwrap();
    assert!(n > 0, "il handler deve essere stato chiamato");
    assert!(n <= 2048, "il budget deve aver troncato il ping-pong: {n}");

    // Il troncamento non è silenzioso: sul bus arriva Overflow col conteggio
    // degli eventi persi — il segnale di "riconcilia da zero".
    let mut overflow = None;
    while let Ok(e) = rx.try_recv() {
        if let Event::Overflow { dropped } = e.event {
            overflow = Some(dropped);
        }
    }
    let dropped = overflow.expect("il troncamento deve emettere Event::Overflow");
    assert!(dropped > 0, "Overflow deve contare gli eventi persi");
}

// ---------------------------------------------------------------------------
// Job: lavoro lungo fuori dal giro sincrono
// ---------------------------------------------------------------------------

/// Handler che su `DocumentChanged` chiede un job e su `JobDone` scrive il
/// risultato nel vault: il giro `spawn_job` → coda → `complete_job` →
/// `JobDone`, che è ciò che questo test presidia.
///
/// Il job qui è un **calcolo puro** e resta il caso più semplice: dalla
/// decisione 0027 un job può anche scrivere da sé, e chi non tocca l'host
/// scrive lo stesso job di prima. Che questo test non sia cambiato di una riga
/// è la prova di quella metà.
struct JobRequestingHandler {
    job_id: Arc<Mutex<Option<fubmd_abi::traits::JobId>>>,
}

impl EventHandler for JobRequestingHandler {
    fn subscribed(&self) -> EventMask {
        EventMask(vec![EventKind::DocumentChanged, EventKind::JobDone])
    }

    fn handle(&mut self, notice: &Notice, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let event = &notice.event;
        match event {
            Event::DocumentChanged { id } if id.as_str() == "innesco.lnk" => {
                if self.job_id.lock().unwrap().is_none() {
                    let id = host.spawn_job(JobSpec {
                        job: "sommario".into(),
                        payload: serde_json::json!({ "doc": id.as_str() }),
                    })?;
                    *self.job_id.lock().unwrap() = Some(id);
                }
                Ok(())
            }
            Event::JobDone { id, job, result } => {
                // Riconosce il PROPRIO job dall'id che ha conservato.
                if Some(*id) == *self.job_id.lock().unwrap() {
                    assert_eq!(job, "sommario");
                    let text = result.as_ref().unwrap().as_str().unwrap().to_string();
                    host.write_document(&DocId::new("sommario.lnk"), &text)?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }
}

#[test]
fn jobs_run_outside_the_kernel_and_complete_via_event() {
    let dir = TempDir::new("jobs");
    let mut ws = workspace(&dir.0);
    let job_id = Arc::new(Mutex::new(None));
    ws.register_event_handler(
        "test.jobs",
        Box::new(JobRequestingHandler {
            job_id: job_id.clone(),
        }),
    )
    .expect("registrato");

    // 1. Il handler chiede il job durante il giro sincrono: il kernel lo
    //    accoda soltanto (niente esecuzione dentro al lock).
    ws.write_document(&DocId::new("innesco.lnk"), "").unwrap();
    let jobs = ws.take_pending_jobs();
    assert_eq!(jobs.len(), 1);
    let (id, spec) = &jobs[0];
    assert_eq!(spec.job, "sommario");
    assert_eq!(Some(*id), *job_id.lock().unwrap());

    // 2. L'host (qui il test; nell'app un thread) esegue il job FUORI dal
    //    workspace. Questo job non ha bisogno del vault, quindi non c'è nemmeno
    //    un `JobHost` da costruirgli: il risultato è una funzione del payload.
    let result = serde_json::Value::String("innesco".to_string());

    // 3. L'esito rientra come JobDone sul giro sincrono normale: il handler
    //    lo riconosce e scrive il documento derivato.
    ws.complete_job(*id, spec.job.clone(), Ok(result));
    assert!(ws.documents().contains(&DocId::new("sommario.lnk")));
    assert_eq!(
        ws.read_source(&DocId::new("sommario.lnk")).unwrap(),
        "innesco"
    );
    // La coda dei job non ricresce da sola.
    assert!(ws.take_pending_jobs().is_empty());
}
