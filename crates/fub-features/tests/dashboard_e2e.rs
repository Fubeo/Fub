#![cfg(feature = "dashboard")]
//! Dashboard del vault: conteggi da Entries/Tags/VaultHealth.

use camino::Utf8PathBuf;
use fub_abi::traits::{PluginManifest, ViewInstance};
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{DashboardView, DASHBOARD_ID, DASHBOARD_VIEW};
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};

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
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, body).unwrap();
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        // Il formato Base: è lui a dire quali file sono una Base.
        #[cfg(feature = "base")]
        registry
            .register(fub_format_base::BaseProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        // Il manifest come lo monta l'host: le stringhe e le due impostazioni
        // della Scrivania.
        ws.register_plugin(
            PluginManifest::core(DASHBOARD_ID, DASHBOARD_ID)
                .speaking("it", fub_features::dashboard::catalog())
                .configuring(fub_features::dashboard::settings()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_view_provider(DASHBOARD_ID, Box::new(DashboardView))
            .expect("view");
        ws.reindex().expect("reindex");
        ws
    }
}

fn texts(tree: &UiNode) -> Vec<String> {
    fn walk(node: &UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::Text { content } => out.push(format!("{content}")),
            UiKind::ListItem {
                title, subtitle, ..
            } => {
                out.push(format!("{title}"));
                if let Some(s) = subtitle {
                    out.push(format!("{s}"));
                }
            }
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(tree, &mut out);
    out
}

#[test]
fn counts_notes_tag_and_link_rotti() {
    let vault = Vault::new();
    vault.put("a.md", "# A\n\n#rust\n[[manca]]\n");
    vault.put("b.md", "# B\n");
    let ws = vault.open();
    let tree = ws.render_view(&ViewInstance::only(DASHBOARD_VIEW)).unwrap();
    let texts = texts(&tree);
    let blob = texts.join(" | ");
    assert!(
        texts.iter().any(|t| t.contains("2") && t.contains("note")),
        "note: {blob}"
    );
    assert!(texts.iter().any(|t| t.contains("tag")), "tag: {blob}");
    assert!(
        texts.iter().any(|t| t.contains("link rotti")),
        "rotti: {blob}"
    );
    assert!(
        texts.iter().any(|t| t.contains("a.md")),
        "il link rotto nomina la nota: {blob}"
    );
}

#[test]
fn vault_empty_zero_rotti() {
    let vault = Vault::new();
    let ws = vault.open();
    let tree = ws.render_view(&ViewInstance::only(DASHBOARD_VIEW)).unwrap();
    let texts = texts(&tree);
    let blob = texts.join(" | ");
    assert!(
        texts.iter().any(|t| t.contains("0") && t.contains("note")),
        "{blob}"
    );
}

// ---------------------------------------------------------------------------
// La Scrivania
// ---------------------------------------------------------------------------

mod desk {
    use super::Vault;
    use fub_abi::settings::SettingValue;
    use fub_abi::traits::ViewInstance;
    use fub_abi::ui::{FieldValue, UiAction, UiKind, UiNode, UiValue, ViewUpdate};
    use fub_features::{DESK_BASE_KEY, DESK_TILES_KEY, DESK_TILE_NS, DESK_VIEW};

    fn instance() -> ViewInstance {
        ViewInstance::only(DESK_VIEW)
    }

    /// Ogni nodo dell'albero, in larghezza.
    fn nodes(tree: &UiNode) -> Vec<&UiNode> {
        let mut out = vec![tree];
        let mut at = 0;
        while at < out.len() {
            let node = out[at];
            out.extend(node.children());
            at += 1;
        }
        out
    }

    /// I riquadri, nell'ordine in cui si disegnano: le chiavi `desk:<id>`.
    fn frames(tree: &UiNode) -> Vec<String> {
        fn walk(node: &UiNode, out: &mut Vec<String>) {
            if let Some(id) = node.key.as_deref().and_then(|k| k.strip_prefix("desk:")) {
                if !id.contains(':') {
                    out.push(id.to_string());
                    return;
                }
            }
            for child in node.children() {
                walk(child, out);
            }
        }
        let mut out = Vec::new();
        walk(tree, &mut out);
        out
    }

    /// Le parole che si leggono, vuoti e bottoni compresi.
    fn words(tree: &UiNode) -> String {
        nodes(tree)
            .into_iter()
            .filter_map(|node| match &node.kind {
                UiKind::Text { content } | UiKind::Heading { content, .. } => {
                    Some(format!("{content}"))
                }
                UiKind::ListItem {
                    title, subtitle, ..
                } => Some(format!(
                    "{title} {}",
                    subtitle.as_ref().map(|s| s.to_string()).unwrap_or_default()
                )),
                UiKind::EmptyState { title, detail, .. } => Some(format!(
                    "{title} {}",
                    detail.as_ref().map(|s| s.to_string()).unwrap_or_default()
                )),
                UiKind::Button { label, .. } => Some(format!("{label}")),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(" | ")
    }

    fn act(ws: &mut fub_kernel::Workspace, action: UiAction) -> UiNode {
        match ws.view_action(&instance(), action).expect("view_action") {
            ViewUpdate::Replace { root } => root,
            other => panic!("atteso un ridisegno, {other:?}"),
        }
    }

    fn tiles(ws: &fub_kernel::Workspace) -> Vec<String> {
        match ws.setting(DESK_TILES_KEY).unwrap() {
            SettingValue::List(ids) => ids,
            other => panic!("{other:?}"),
        }
    }

    fn moving(tile: &str, to: usize) -> UiAction {
        UiAction::new("desk.move").with_payload(serde_json::json!({ "tile": tile, "to": to }))
    }

    #[test]
    fn i_riquadri_di_chi_non_ha_toccato_niente() {
        let vault = Vault::new();
        vault.put("a.md", "# A\n");
        let ws = vault.open();
        let tree = ws.render_view(&instance()).unwrap();
        assert_eq!(
            frames(&tree),
            ["pinned", "recent", "tasks", "base", "month"]
        );
        let blob = words(&tree);
        assert!(blob.contains("Nessuna nota appuntata"), "{blob}");
        assert!(blob.contains("Nel vault non c'è nessuna Base"), "{blob}");
        assert!(
            blob.contains("Appuntate") && blob.contains("Recenti"),
            "{blob}"
        );
        // Ogni riquadro ha la riga di comandi della shell, con un'azione per
        // ogni posto in cui può andare e il ripiego coi bottoni.
        let commands: Vec<&UiNode> = nodes(&tree)
            .into_iter()
            .filter(|n| matches!(&n.kind, UiKind::Custom { ns, .. } if ns == DESK_TILE_NS))
            .collect();
        assert_eq!(commands.len(), 5);
        let UiKind::Custom {
            payload, fallback, ..
        } = &commands[0].kind
        else {
            unreachable!()
        };
        assert_eq!(payload["frame"], "desk:pinned");
        assert_eq!(payload["at"], 0);
        assert_eq!(payload["moves"].as_array().map(Vec::len), Some(5));
        assert_eq!(payload["moves"][1]["payload"]["to"], 1);
        // Il primo non sale: «Sposta giù» e «Togli».
        assert_eq!(fallback.len(), 2, "{fallback:?}");
    }

    #[test]
    fn spostare_un_riquadro_scrive_l_ordine_nel_vault() {
        let vault = Vault::new();
        let mut ws = vault.open();
        let tree = act(&mut ws, moving("month", 0));
        assert_eq!(
            frames(&tree),
            ["month", "pinned", "recent", "tasks", "base"]
        );
        assert_eq!(tiles(&ws), ["month", "pinned", "recent", "tasks", "base"]);
        // Oltre la fine si ferma in fondo, e un id sconosciuto non tocca niente.
        let tree = act(&mut ws, moving("month", 99));
        assert_eq!(
            frames(&tree),
            ["pinned", "recent", "tasks", "base", "month"]
        );
        assert!(matches!(
            ws.view_action(&instance(), moving("meteo", 0)).unwrap(),
            ViewUpdate::None
        ));
        act(&mut ws, moving("base", 1));
        drop(ws);
        // È un'impostazione del vault: chi lo riapre trova lo stesso ordine.
        let reopened = vault.open();
        let tree = reopened.render_view(&instance()).unwrap();
        assert_eq!(
            frames(&tree),
            ["pinned", "base", "recent", "tasks", "month"]
        );
    }

    #[test]
    fn un_riquadro_si_toglie_e_si_rimette_in_fondo() {
        let vault = Vault::new();
        let mut ws = vault.open();
        let tree = act(
            &mut ws,
            UiAction::new("desk.hide").with_payload(serde_json::json!({"tile": "recent"})),
        );
        assert_eq!(frames(&tree), ["pinned", "tasks", "base", "month"]);
        assert!(words(&tree).contains("Rimetti:"), "{}", words(&tree));
        assert!(nodes(&tree)
            .iter()
            .any(|n| n.key.as_deref() == Some("desk-show:recent")));
        let tree = act(
            &mut ws,
            UiAction::new("desk.show").with_payload(serde_json::json!({"tile": "recent"})),
        );
        assert_eq!(
            frames(&tree),
            ["pinned", "tasks", "base", "month", "recent"]
        );
        assert!(!words(&tree).contains("Rimetti:"));
    }

    #[test]
    fn tutti_tolti_la_scrivania_dice_come_tornare() {
        let vault = Vault::new();
        let mut ws = vault.open();
        ws.set_setting(DESK_TILES_KEY, SettingValue::List(Vec::new()))
            .unwrap();
        let tree = ws.render_view(&instance()).unwrap();
        assert!(frames(&tree).is_empty());
        let blob = words(&tree);
        assert!(blob.contains("La Scrivania è vuota"), "{blob}");
        assert!(
            blob.contains("Il mese") && blob.contains("Compiti di oggi"),
            "{blob}"
        );
        act(
            &mut ws,
            UiAction::new("desk.show").with_payload(serde_json::json!({"tile": "month"})),
        );
        assert_eq!(tiles(&ws), ["month"]);
    }

    #[test]
    fn un_ordine_scritto_a_mano_si_legge_senza_doppioni_ne_sconosciuti() {
        let vault = Vault::new();
        let mut ws = vault.open();
        ws.set_setting(
            DESK_TILES_KEY,
            SettingValue::List(vec![
                "month".into(),
                "meteo".into(),
                "month".into(),
                "pinned".into(),
            ]),
        )
        .unwrap();
        let tree = ws.render_view(&instance()).unwrap();
        assert_eq!(frames(&tree), ["month", "pinned"]);
    }

    #[test]
    fn le_appuntate_nell_ordine_scelto() {
        let vault = Vault::new();
        vault.put("Progetti/Lavoro.md", "# Lavoro\n");
        vault.put("b.md", "# B\n");
        let ws = vault.open();
        ws.set_pinned("b.md", true).unwrap();
        ws.set_pinned("Progetti/Lavoro.md", true).unwrap();
        let tree = ws.render_view(&instance()).unwrap();
        let pinned: Vec<String> = nodes(&tree)
            .into_iter()
            .filter_map(|n| {
                n.key
                    .as_deref()?
                    .strip_prefix("pinned:")
                    .map(str::to_string)
            })
            .collect();
        assert_eq!(pinned, ["b.md", "Progetti/Lavoro.md"]);
        assert!(words(&tree).contains("Lavoro Progetti"), "{}", words(&tree));
    }

    #[cfg(feature = "base")]
    #[test]
    fn la_base_scelta_si_mostra_e_cancellata_lo_dice() {
        let vault = Vault::new();
        vault.put(
            "Liste/Libri.base",
            "views:\n  - type: table\n    name: Tutti\n",
        );
        let mut ws = vault.open();
        let blob = words(&ws.render_view(&instance()).unwrap());
        assert!(blob.contains("Nessuna Base scelta"), "{blob}");
        let tree = act(
            &mut ws,
            UiAction::new("desk.base").with_fields(vec![FieldValue {
                field: "base".into(),
                value: UiValue::Text("Liste/Libri.base".into()),
            }]),
        );
        assert!(nodes(&tree).iter().any(|n| matches!(
            &n.kind,
            UiKind::Custom { ns, payload, .. }
                if ns == "fub:base" && payload["base"] == "Liste/Libri.base"
        )));
        // La Base se ne va: il riquadro lo dice col suo nome e ne fa scegliere
        // un'altra; l'impostazione resta com'era.
        ws.set_setting(
            DESK_BASE_KEY,
            SettingValue::Text("Liste/Vecchia.base".into()),
        )
        .unwrap();
        let tree = ws.render_view(&instance()).unwrap();
        let blob = words(&tree);
        assert!(blob.contains("La Base scelta non c'è più"), "{blob}");
        assert!(blob.contains("«Vecchia»"), "{blob}");
        assert!(nodes(&tree).iter().any(
            |n| matches!(&n.kind, UiKind::Select { options, value, .. }
                // «Nessuna» in testa e scelta, poi le Base che ci sono.
                if options.len() == 2 && options[0].value.is_empty() && value == &[String::new()])
        ));
    }

    #[test]
    fn senza_ricerca_i_compiti_lo_dicono_e_il_resto_si_vede() {
        let vault = Vault::new();
        vault.put("a.md", "- [ ] chiama\n");
        let ws = vault.open();
        let tree = ws.render_view(&instance()).unwrap();
        let blob = words(&tree);
        assert!(blob.contains("la ricerca"), "{blob}");
        assert_eq!(frames(&tree).len(), 5);
    }

    #[test]
    fn il_mese_ha_un_bottone_per_giorno() {
        let vault = Vault::new();
        let ws = vault.open();
        let tree = ws.render_view(&instance()).unwrap();
        let days = nodes(&tree)
            .into_iter()
            .filter(|n| {
                matches!(&n.kind, UiKind::Button { action, .. } if action.action.0 == "desk.day")
            })
            .count();
        assert!((28..=31).contains(&days), "{days}");
    }
}
