//! La feature `draw` (ADR 0203), accesa e spenta, sul montaggio di produzione.
//!
//! Spenta, che è il `default`, un `.svg` resta un allegato: nessun formato lo
//! rivendica, la shell lo apre come testo col profilo `svg` e lo salva come
//! byte. Accesa, il provider `svg` lo rivendica e il file diventa un
//! documento. Un `.svgz` resta di specie sconosciuta nei due casi: è
//! compresso, e nessuna tabella gli dà un MIME. Il Markdown non cambia.
//!
//! Lo stesso vale per le annotazioni di un PDF, `<nome>.pdf.fubann`: spenta,
//! il file è di specie sconosciuta come ogni estensione senza formato né
//! MIME; accesa, il provider `fubann` lo rivendica e il PDF accanto prende un
//! backlink.
//!
//! Accesa, il vault ha anche le impostazioni dell'editor dei disegni; spenta,
//! le chiavi non ci sono.
//!
//! Lo stesso file si compila nei due giri della CI: `cargo test --workspace`
//! prova il ramo spento, `cargo test -p fub-host --features draw` quello acceso.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult, Page};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

const DRAWING: &str = concat!(
    r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100" width="100" height="100">"#,
    "\n  <title>Schizzo</title>\n",
    r#"  <a href="nota.md"><text x="1" y="2">vai alla nota</text></a>"#,
    "\n</svg>\n",
);

/// Le annotazioni di `Bando.pdf`: una nota sulla prima pagina.
const ANNOTATIONS: &str = concat!(
    r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" fub:annotates="Bando.pdf" fub:pages="2">"#,
    "\n  <title>Revisione</title>\n",
    r#"  <g fub:page="1"><text x="10" y="20" fub:note="Il corpo della nota">vista</text></g>"#,
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

/// Chi punta a `target`, anche se è un allegato: la domanda del pannello dei
/// backlink.
fn referrers(ws: &fub_kernel::Workspace, target: &str) -> Vec<DocId> {
    let Ok(IndexResult::Backlinks(found)) = ws.query_index(IndexQuery::Backlinks {
        target: DocId::new(target),
        page: None,
    }) else {
        panic!("i backlink rispondono")
    };
    found.items.into_iter().map(|link| link.source).collect()
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

#[test]
fn annotations_are_a_document_only_with_the_draw_feature() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(root.join("Bando.pdf"), b"%PDF-1.7\n").unwrap();
    std::fs::write(root.join("Bando.pdf.fubann"), ANNOTATIONS).unwrap();
    let mounted = mounted(&root);
    let ws = &mounted.workspace;
    let annotations = DocId::new("Bando.pdf.fubann");

    assert_eq!(kind_of(ws, "Bando.pdf"), EntryKind::Asset);

    #[cfg(not(feature = "draw"))]
    {
        assert_eq!(kind_of(ws, "Bando.pdf.fubann"), EntryKind::Unknown);
        assert_eq!(ws.format_of(&annotations), None);
        assert!(!ws.extensions().iter().any(|ext| ext == "fubann"));
        assert!(!ws.documents().contains(&annotations));
        assert!(referrers(ws, "Bando.pdf").is_empty());
    }

    #[cfg(feature = "draw")]
    {
        assert_eq!(kind_of(ws, "Bando.pdf.fubann"), EntryKind::Document);
        let format = ws.format_of(&annotations).expect("il formato fubann");
        assert_eq!(format.descriptor.id, fub_format_svg::ANNOTATIONS_FORMAT_ID);
        assert!(ws.extensions().iter().any(|ext| ext == "fubann"));
        assert!(ws.documents().contains(&annotations));
        assert_eq!(referrers(ws, "Bando.pdf"), [DocId::new("Bando.pdf.fubann")]);
    }

    assert_eq!(ws.read_source(&annotations).unwrap(), ANNOTATIONS);
}

#[test]
fn the_drawing_settings_exist_only_with_the_draw_feature() {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    std::fs::write(root.join("schizzo.svg"), DRAWING).unwrap();
    let mut mounted = mounted(&root);
    let ws = &mut mounted.workspace;

    #[cfg(not(feature = "draw"))]
    {
        for key in [
            "draw.level",
            "draw.custom",
            "draw.templates",
            "draw.symbols",
            "draw.suggestions",
        ] {
            assert!(ws.setting(key).is_err(), "{key}");
        }
        assert!(ws
            .set_setting("draw.suggestions", SettingValue::Toggle(false))
            .is_err());
    }

    #[cfg(feature = "draw")]
    {
        use fub_abi::settings::SettingScope;
        let text = |value: &str| SettingValue::Text(value.into());
        let Ok(IndexResult::Settings(entries)) = ws.query_index(IndexQuery::Settings {
            plugin: Some(fub_features::DRAW_ID.into()),
        }) else {
            panic!("le impostazioni dei disegni rispondono")
        };
        // Il bundle porta anche le chiavi sintetiche dei permessi e delle
        // scorciatoie: qui contano le sue.
        let keys: Vec<_> = entries
            .iter()
            .map(|entry| entry.spec.key.as_str())
            .filter(|key| key.starts_with("draw."))
            .collect();
        assert_eq!(
            keys,
            [
                "draw.level",
                "draw.custom",
                "draw.templates",
                "draw.symbols",
                "draw.suggestions"
            ]
        );
        let entry = |key: &str| entries.iter().find(|entry| entry.spec.key == key).unwrap();
        // I valori di serie.
        assert_eq!(entry("draw.level").value, text("essential"));
        assert_eq!(
            entry("draw.custom").value,
            SettingValue::List(
                ["pen", "eraser", "rect", "ellipse", "line", "arrow"]
                    .map(String::from)
                    .to_vec()
            )
        );
        assert_eq!(entry("draw.templates").value, text("Templates"));
        assert_eq!(entry("draw.symbols").value, text("Symbols"));
        assert_eq!(entry("draw.suggestions").value, SettingValue::Toggle(true));
        // Il vault le porta con sé, la macchina i suggerimenti.
        assert_eq!(entry("draw.level").spec.scope, SettingScope::Vault);
        assert_eq!(entry("draw.templates").spec.scope, SettingScope::Vault);
        assert_eq!(entry("draw.symbols").spec.scope, SettingScope::Vault);
        assert_eq!(entry("draw.suggestions").spec.scope, SettingScope::Machine);

        // La casella «Non mostrare più suggerimenti» scrive la chiave.
        ws.set_setting("draw.suggestions", SettingValue::Toggle(false))
            .expect("i suggerimenti si spengono dall'interfaccia");
        assert_eq!(
            ws.setting("draw.suggestions").unwrap(),
            SettingValue::Toggle(false)
        );
        ws.set_setting("draw.suggestions", SettingValue::Toggle(true))
            .expect("e si riaccendono");
        assert_eq!(
            ws.setting("draw.suggestions").unwrap(),
            SettingValue::Toggle(true)
        );
        assert!(ws.set_setting("draw.suggestions", text("no")).is_err());

        // Il livello ha i quattro nomi dell'editor, e nessun altro.
        for level in ["standard", "expert", "custom", "essential"] {
            ws.set_setting("draw.level", text(level))
                .unwrap_or_else(|error| panic!("{level}: {error:?}"));
            assert_eq!(ws.setting("draw.level").unwrap(), text(level));
        }
        assert!(ws.set_setting("draw.level", text("master")).is_err());
        assert_eq!(ws.setting("draw.level").unwrap(), text("essential"));

        // Le parti del Personalizzato sono un elenco, e la cartella un testo.
        let parts = SettingValue::List(vec!["pen".into(), "text".into()]);
        ws.set_setting("draw.custom", parts.clone()).unwrap();
        assert_eq!(ws.setting("draw.custom").unwrap(), parts);
        ws.set_setting("draw.templates", text("Modelli")).unwrap();
        assert_eq!(ws.setting("draw.templates").unwrap(), text("Modelli"));
        ws.set_setting("draw.symbols", text("Simboli")).unwrap();
        assert_eq!(ws.setting("draw.symbols").unwrap(), text("Simboli"));

        let written = std::fs::read_to_string(root.join(".fub").join("settings.json")).unwrap();
        for key in [
            "draw.level",
            "draw.custom",
            "draw.templates",
            "draw.symbols",
        ] {
            assert!(written.contains(&format!("\"{key}\"")), "{key}: {written}");
        }
        // I suggerimenti sono della macchina: non entrano nel file del vault.
        assert!(!written.contains("draw.suggestions"), "{written}");
    }

    // Le impostazioni non toccano i disegni.
    assert_eq!(
        std::fs::read_to_string(root.join("schizzo.svg")).unwrap(),
        DRAWING
    );
}
