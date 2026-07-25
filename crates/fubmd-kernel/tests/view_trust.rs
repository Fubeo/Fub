//! Il confine di fiducia della UI, dove viene applicato.
//!
//! `UiNode::Html` e `UiNode::WebView` iniettano contenuto attivo nella webview
//! principale, che ha l'IPC con pieni privilegi: un plugin sandboxato che potesse
//! emetterle aggirerebbe la sandbox passando dalla UI. La regola era **scritta**
//! (`UiNode::validate_untrusted`, con i suoi test) ma non **applicata**: la
//! funzione non aveva chiamanti.
//!
//! Qui si prova il varco: ogni albero che entra nell'host passa da
//! `Workspace::render_view` / `view_action`, e da un provider non fidato il
//! contenuto attivo non passa. Oggi nessun provider non fidato esiste — è il
//! punto: il presidio deve esserci *prima* del primo, non dopo.

use camino::Utf8PathBuf;
use fubmd_abi::error::PluginError;
use fubmd_abi::traits::{HostApi, ViewPlacement, ViewProvider, ViewSpec};
use fubmd_abi::ui::{ActionId, Axis, UiAction, UiNode, ViewUpdate};
use fubmd_kernel::{FormatRegistry, Trust, Workspace};

/// Un provider che restituisce ciò che gli si dice di restituire, e che scrive
/// nel proprio storage per far vedere di che id è intestato l'host che riceve.
struct Puppet {
    id: &'static str,
    tree: UiNode,
    on_action: ViewUpdate,
}

impl Puppet {
    /// Restituisce già il `Box<dyn ViewProvider>` perché è la forma in cui il
    /// workspace lo vuole, e nei test conta la brevità del punto di chiamata.
    fn boxed(id: &'static str, tree: UiNode, on_action: ViewUpdate) -> Box<dyn ViewProvider> {
        Box::new(Puppet {
            id,
            tree,
            on_action,
        })
    }
}

impl ViewProvider for Puppet {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec {
            id: self.id.to_string(),
            title: self.id.to_string(),
            placement: ViewPlacement::RightSidebar,
            refresh: Default::default(),
        }]
    }

    fn render_view(&self, view: &str, _host: &dyn HostApi) -> Result<UiNode, PluginError> {
        if view != self.id {
            return Err(PluginError::UnknownView(view.to_string()));
        }
        Ok(self.tree.clone())
    }

    fn on_action(
        &self,
        _view: &str,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        // Le azioni arrivano con l'host: un provider può reagire scrivendo nel
        // proprio spazio dati, e qui serve a controllare *di chi* sia lo spazio.
        host.data_write("ultima-azione.txt", action.action.0.as_bytes())?;
        Ok(self.on_action.clone())
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Fixture { _dir: dir, root }
    }

    fn workspace(&self) -> Workspace {
        Workspace::new(&self.root, FormatRegistry::new())
    }
}

fn html() -> UiNode {
    // Annidato di proposito: il rifiuto non deve dipendere dalla posizione.
    UiNode::Stack {
        dir: Axis::Column,
        gap: 0,
        children: vec![UiNode::List {
            items: vec![UiNode::Html {
                html: "<script>ipc()</script>".into(),
            }],
        }],
    }
}

fn dichiarativo() -> UiNode {
    UiNode::Stack {
        dir: Axis::Column,
        gap: 4,
        children: vec![UiNode::ListItem {
            title: "voce".into(),
            subtitle: None,
            action: Some(ActionId("open:a.md".into())),
        }],
    }
}

#[test]
fn a_trusted_provider_may_return_active_content() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "core.fidato",
        Trust::Trusted,
        Puppet::boxed("fidata", html(), ViewUpdate::None),
    );

    // Le feature ufficiali *usano* `Html` (l'anteprima di un backlink lo è):
    // vietarlo a tutti non sarebbe sicurezza, sarebbe rompere il core.
    assert_eq!(ws.render_view("fidata").expect("albero fidato"), html());
}

#[test]
fn an_untrusted_provider_cannot_smuggle_active_content() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "terzi.ostile",
        Trust::Untrusted,
        Puppet::boxed("ostile", html(), ViewUpdate::None),
    );

    let err = ws.render_view("ostile").expect_err("deve essere rifiutato");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "atteso permesso negato, trovato {err:?}"
    );
}

#[test]
fn an_untrusted_provider_may_still_describe_a_ui() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "terzi.perbene",
        Trust::Untrusted,
        Puppet::boxed("perbene", dichiarativo(), ViewUpdate::None),
    );

    // Il confine non è "i plugin non disegnano": è "i plugin descrivono, il core
    // disegna". Tutto il dichiarativo passa.
    assert_eq!(ws.render_view("perbene").unwrap(), dichiarativo());
}

#[test]
fn the_same_guard_applies_to_what_comes_back_from_an_action() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "terzi.tardivo",
        Trust::Untrusted,
        Puppet::boxed(
            "tardivo",
            dichiarativo(),
            ViewUpdate::Replace { root: html() },
        ),
    );

    // Un albero pulito al rendering e sporco al primo click sarebbe la strada
    // più ovvia per aggirare un controllo fatto solo in `render_view`.
    assert!(ws.render_view("tardivo").is_ok());
    let err = ws
        .view_action(
            "tardivo",
            UiAction {
                action: ActionId("click".into()),
                payload: serde_json::Value::Null,
            },
        )
        .expect_err("anche l'aggiornamento deve essere validato");
    assert!(matches!(err, PluginError::PermissionDenied(_)));
}

#[test]
fn navigate_and_none_are_not_trees_and_pass() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "terzi.navigante",
        Trust::Untrusted,
        Puppet::boxed(
            "navigante",
            dichiarativo(),
            ViewUpdate::Navigate {
                doc_id: "a.md".into(),
            },
        ),
    );

    let update = ws
        .view_action(
            "navigante",
            UiAction {
                action: ActionId("open:a.md".into()),
                payload: serde_json::Value::Null,
            },
        )
        .expect("navigare non è iniettare");
    assert_eq!(
        update,
        ViewUpdate::Navigate {
            doc_id: "a.md".into()
        }
    );
}

#[test]
fn an_action_reaches_the_provider_with_its_own_data_space() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "terzi.diario",
        Trust::Untrusted,
        Puppet::boxed("diario", dichiarativo(), ViewUpdate::None),
    );

    ws.view_action(
        "diario",
        UiAction {
            action: ActionId("premuto".into()),
            payload: serde_json::Value::Null,
        },
    )
    .unwrap();

    let scritto = fx
        .root
        .join(".fubmd-data")
        .join("plugins")
        .join("terzi.diario")
        .join("ultima-azione.txt");
    assert_eq!(
        std::fs::read_to_string(&scritto).expect("il provider ha scritto nel suo recinto"),
        "premuto"
    );
}

#[test]
fn a_view_nobody_offers_is_unknown_not_empty() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    ws.register_view_provider(
        "core.una",
        Trust::Trusted,
        Puppet::boxed("una", dichiarativo(), ViewUpdate::None),
    );

    // "Non esiste" e "è vuota" sono due risposte diverse: confonderle
    // nasconderebbe un id sbagliato dietro un pannello vuoto.
    assert!(matches!(
        ws.render_view("inesistente"),
        Err(PluginError::UnknownView(_))
    ));
    assert_eq!(
        ws.views().iter().map(|v| v.id.clone()).collect::<Vec<_>>(),
        vec!["una".to_string()]
    );
}
