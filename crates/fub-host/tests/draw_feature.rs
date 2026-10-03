//! La feature `draw` (ADR 0203), accesa e spenta, sul montaggio di produzione.
//!
//! Spenta, che è il `default`, un `.svg` resta un allegato: nessun formato lo
//! rivendica, la shell lo apre come testo col profilo `svg` e lo salva come
//! byte. Accesa, il provider `svg` lo rivendica e il file diventa un
//! documento. Un `.svgz` resta di specie sconosciuta nei due casi: è
//! compresso, e nessuna tabella gli dà un MIME. Il Markdown non cambia.
//!
//! Lo stesso file si compila nei due giri della CI: `cargo test --workspace`
//! prova il ramo spento, `cargo test -p fub-host --features draw` quello acceso.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult, Page};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

const DRAWING: &str = concat!(
    r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100" width="100" height="100">"#,
    "\n  <title>Schizzo</title>\n",
    r#"  <a href="nota.md"><text x="1" y="2">vai alla nota</text></a>"#,
    "\n</svg>\n",
);

fn mounted(root: &Utf8Path) -> fub_host::mount::Mounted {
    let mut mounted = fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("il vault si monta");
    mounted.workspace.reindex().expect("il vault si indicizza");
    mounted
}

fn kind_of(ws: &fub_kernel::Workspace, id: &str) -> EntryKind {
    let Ok(IndexResult::Entries(entries)) = ws.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: Some(Page::first(100)),
    }) else {
        panic!("l'anagrafe risponde")
    };
    entries
        .items
        .iter()
        .find(|entry| entry.id.as_str() == id)
        .unwrap_or_else(|| panic!("{id} non è nell'anagrafe"))
        .kind
}

#[test]
fn an_svg_is_a_document_only_with_the_draw_feature() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(root.join("schizzo.svg"), DRAWING).unwrap();
    std::fs::write(root.join("nota.md"), "# Nota\n\nCorpo.\n").unwrap();
    // L'intestazione di gzip: un `.svgz` non è testo.
    std::fs::write(root.join("schizzo.svgz"), [0x1f, 0x8b, 0x08, 0x00]).unwrap();
    let mounted = mounted(&root);
    let ws = &mounted.workspace;
    let drawing = DocId::new("schizzo.svg");

    assert_eq!(kind_of(ws, "nota.md"), EntryKind::Document);
    assert_eq!(kind_of(ws, "schizzo.svgz"), EntryKind::Unknown);
    assert_eq!(ws.format_of(&DocId::new("schizzo.svgz")), None);

    #[cfg(not(feature = "draw"))]
    {
        assert_eq!(kind_of(ws, "schizzo.svg"), EntryKind::Asset);
        assert_eq!(ws.format_of(&drawing), None);
        assert!(!ws.extensions().iter().any(|ext| ext == "svg"));
        assert!(!ws.documents().contains(&drawing));
        // Un allegato non porta collegamenti: la nota non ha backlink.
        assert!(ws.backlinks(&DocId::new("nota.md")).is_empty());
    }

    #[cfg(feature = "draw")]
    {
        assert_eq!(kind_of(ws, "schizzo.svg"), EntryKind::Document);
        let format = ws.format_of(&drawing).expect("il formato svg");
        assert_eq!(format.descriptor.id, fub_format_svg::FORMAT_ID);
        assert_eq!(format.descriptor.name, "SVG (FubDraw)");
        assert!(ws.extensions().iter().any(|ext| ext == "svg"));
        assert!(ws.documents().contains(&drawing));
        let backlinks = ws.backlinks(&DocId::new("nota.md"));
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].source, drawing);
    }

    // Il sorgente è quello del disco in tutti e due i casi.
    assert_eq!(ws.read_source(&drawing).unwrap(), DRAWING);
}
