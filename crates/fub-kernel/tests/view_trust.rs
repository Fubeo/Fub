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
use fub_abi::error::PluginError;
use fub_abi::traits::{
    HostApi, PluginManifest, ReadApi, ViewInstance, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, UiAction, UiKind, UiNode, ViewUpdate};
use fub_kernel::{data_root, FormatRegistry, Trust, Workspace};

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
    /// La maschera è dell'**esemplare** (§22.3): si prende da *quella* spec,
    /// non dalla prima dell'elenco — un provider che ne dichiara due darebbe a
    /// tutte e due la maschera della prima.
    fn interests(
        &self,
        instance: &fub_abi::traits::ViewInstance,
    ) -> fub_abi::traits::ViewInterests {
        self.views()
            .into_iter()
            .find(|s| s.id == instance.view)
            .map(|s| fub_abi::traits::ViewInterests {
                refresh: s.refresh,
                follows: s.follows,
            })
            .unwrap_or_default()
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(self.id, self.id, ViewSurface::RightSidebar)]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        _host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        if instance.view != self.id {
            return Err(PluginError::UnknownView(instance.view.clone().into()));
        }
        Ok(self.tree.clone())
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
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

/// Dichiara un plugin e registra la sua view, in una riga sola.
///
/// Il grado di fiducia sta nella **dichiarazione** e non nella registrazione
/// della view: era un parametro del solo `register_view_provider`, e la
/// conseguenza era che un `IndexProvider` di terzi non ne aveva nessuno (§7.3).
fn monta(ws: &mut Workspace, plugin: &str, trust: Trust, provider: Box<dyn ViewProvider>) {
    let manifest = match trust {
        Trust::Core => PluginManifest::core(plugin, plugin),
        _ => PluginManifest::new(plugin, plugin),
    };
    ws.register_plugin(manifest, trust).expect("dichiarato");
    ws.register_view_provider(plugin, provider)
        .expect("registrato");
}

fn html() -> UiNode {
    // Annidato di proposito: il rifiuto non deve dipendere dalla posizione.
    UiNode::column(
        0,
        vec![UiNode::list(vec![UiNode::new(UiKind::Html {
            html: "<script>ipc()</script>".into(),
        })])],
    )
}

fn dichiarativo() -> UiNode {
    UiNode::column(
        4,
        vec![UiNode::list_item(
            "voce",
            None,
            Some(ActionRef::with("open", serde_json::json!({"doc": "a.md"}))),
        )],
    )
}

#[test]
fn a_trusted_provider_may_return_active_content() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    monta(
        &mut ws,
        "core.fidato",
        Trust::Core,
        Puppet::boxed("fidata", html(), ViewUpdate::None),
    );

    // Le feature ufficiali *usano* `Html` (l'anteprima di un backlink lo è):
    // vietarlo a tutti non sarebbe sicurezza, sarebbe rompere il core.
    assert_eq!(
        ws.render_view(&ViewInstance::only("fidata"))
            .expect("albero fidato"),
        html()
    );
}

#[test]
fn an_untrusted_provider_cannot_smuggle_active_content() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    monta(
        &mut ws,
        "terzi.ostile",
        Trust::Community,
        Puppet::boxed("terzi.ostile:ostile", html(), ViewUpdate::None),
    );

    let err = ws
        .render_view(&ViewInstance::only("terzi.ostile:ostile"))
        .expect_err("deve essere rifiutato");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "atteso permesso negato, trovato {err:?}"
    );
}

#[test]
fn an_untrusted_provider_may_still_describe_a_ui() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    monta(
        &mut ws,
        "terzi.perbene",
        Trust::Community,
        Puppet::boxed("terzi.perbene:perbene", dichiarativo(), ViewUpdate::None),
    );

    // Il confine non è "i plugin non disegnano": è "i plugin descrivono, il core
    // disegna". Tutto il dichiarativo passa.
    assert_eq!(
        ws.render_view(&ViewInstance::only("terzi.perbene:perbene"))
            .unwrap(),
        dichiarativo()
    );
}

#[test]
fn the_same_guard_applies_to_what_comes_back_from_an_action() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    monta(
        &mut ws,
        "terzi.tardivo",
        Trust::Community,
        Puppet::boxed(
            "terzi.tardivo:tardivo",
            dichiarativo(),
            ViewUpdate::Replace { root: html() },
        ),
    );

    // Un albero pulito al rendering e sporco al primo click sarebbe la strada
    // più ovvia per aggirare un controllo fatto solo in `render_view`.
    assert!(ws
        .render_view(&ViewInstance::only("terzi.tardivo:tardivo"))
        .is_ok());
    let err = ws
        .view_action(
            &ViewInstance::only("terzi.tardivo:tardivo"),
            UiAction::new("click"),
        )
        .expect_err("anche l'aggiornamento deve essere validato");
    assert!(matches!(err, PluginError::PermissionDenied(_)));
}

#[test]
fn a_patch_carries_a_tree_too_and_gets_the_same_guard() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    monta(
        &mut ws,
        "terzi.chirurgo",
        Trust::Community,
        Puppet::boxed(
            "terzi.chirurgo:chirurgo",
            dichiarativo(),
            ViewUpdate::Patch {
                key: "riga-1".into(),
                node: html(),
            },
        ),
    );

    // `Patch` è l'altro modo di far arrivare un albero alla shell, ed è più
    // stretto solo nella *dimensione*: un nodo sostituito è un nodo che entra
    // nella webview esattamente come quelli di `Replace`. Guardare solo
    // `Replace` sarebbe presidiare la porta larga e lasciare aperta quella
    // piccola, che è la stessa porta.
    assert!(ws
        .render_view(&ViewInstance::only("terzi.chirurgo:chirurgo"))
        .is_ok());
    let err = ws
        .view_action(
            &ViewInstance::only("terzi.chirurgo:chirurgo"),
            UiAction::new("click"),
        )
        .expect_err("anche una patch deve essere validata");
    assert!(matches!(err, PluginError::PermissionDenied(_)));
}

#[test]
fn navigate_and_none_are_not_trees_and_pass() {
    let fx = Fixture::new();
    let mut ws = fx.workspace();
    monta(
        &mut ws,
        "terzi.navigante",
        Trust::Community,
        Puppet::boxed(
            "terzi.navigante:navigante",
            dichiarativo(),
            ViewUpdate::Navigate {
                doc_id: "a.md".into(),
            },
        ),
    );

    let update = ws
        .view_action(
            &ViewInstance::only("terzi.navigante:navigante"),
            UiAction::new("open"),
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
    monta(
        &mut ws,
        "terzi.diario",
        Trust::Community,
        Puppet::boxed("terzi.diario:diario", dichiarativo(), ViewUpdate::None),
    );

    ws.view_action(
        &ViewInstance::only("terzi.diario:diario"),
        UiAction::new("premuto"),
    )
    .unwrap();

    let scritto = data_root(&fx.root)
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
    monta(
        &mut ws,
        "core.una",
        Trust::Core,
        Puppet::boxed("una", dichiarativo(), ViewUpdate::None),
    );

    // "Non esiste" e "è vuota" sono due risposte diverse: confonderle
    // nasconderebbe un id sbagliato dietro un pannello vuoto.
    assert!(matches!(
        ws.render_view(&ViewInstance::only("inesistente")),
        Err(PluginError::UnknownView(_))
    ));
    assert_eq!(
        ws.views().iter().map(|v| v.id.clone()).collect::<Vec<_>>(),
        vec!["una".to_string()]
    );
}
