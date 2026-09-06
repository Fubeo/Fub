"""Temporary branch-only M5 patch, removed before the final PR."""
from pathlib import Path


def replace(path, old, new):
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f"Expected unique source in {path}: {old[:100]}")
    p.write_text(text.replace(old, new, 1))


Path("crates/fub-host/src/source.rs").write_text(r'''//! Discovery iniettata dalla composizione: il kernel non conosce i backend.
use std::sync::Arc;
use camino::Utf8Path;
use fub_abi::PluginError;
use crate::Bundle;

/// Esito della discovery: pacchetti validi e rifiuti indipendenti.
#[derive(Default)]
#[must_use]
pub struct BundleDiscovery {
    /// Bundle conosciuti, non attivati e privi di autorizzazione implicita.
    pub bundles: Vec<Arc<dyn Bundle>>,
    /// Rifiuti nominati che non devono nascondere gli altri pacchetti.
    pub errors: Vec<PluginError>,
}

/// Porta locale della composizione, non un'estensione del contratto ABI.
///
/// La sorgente può validare un pacchetto ma non decide se attivarlo. Ogni
/// apertura ricostruisce l'inventario: trovare byte non equivale a fidarsi.
pub trait BundleSource: Send + Sync {
    /// Scopre i bundle della configurazione macchina, senza montarli.
    fn discover(&self, config_dir: &Utf8Path) -> Result<BundleDiscovery, PluginError>;
}
''')
replace("crates/fub-host/src/lib.rs", "pub mod registry;", "pub mod registry;\nmod source;\npub use source::{BundleDiscovery, BundleSource};")
replace("crates/fub-host/src/session.rs", "    config_dir: Option<Utf8PathBuf>,", "    config_dir: Option<Utf8PathBuf>,\n    bundle_source: Option<Box<dyn crate::BundleSource>>,")
replace("crates/fub-host/src/session.rs", "            config_dir: None,", "            config_dir: None,\n            bundle_source: None,")
replace("crates/fub-host/src/session.rs", "    pub fn installed() -> Self {", '''    pub fn installed() -> Self {''')
replace("crates/fub-host/src/session.rs", "    /// Come [`installed`](Host::installed),", '''    /// Aggiunge la discovery dei componenti della macchina.
    ///
    /// Un componente esterno resta spento a ogni apertura. L'attivazione passa
    /// da `set_plugin_enabled`, anche se un vault porta una preferenza diversa:
    /// la presenza sul disco e le impostazioni del vault non sono un consenso.
    pub fn with_bundle_source(mut self, source: Box<dyn crate::BundleSource>) -> Self {
        self.bundle_source = Some(source);
        self
    }

    /// Come [`installed`](Host::installed),''')
replace("crates/fub-host/src/session.rs", '        let registry = Custody::new("i componenti montati", registry);', '''        if let (Some(source), Some(config_dir)) = (&self.bundle_source, &self.config_dir) {
            match source.discover(config_dir) {
                Ok(found) => {
                    for bundle in found.bundles {
                        let id = bundle.manifest().id;
                        if registry.knows(&id) {
                            tracing::error!(target: "fub.host", "component identity already known: {id}");
                            continue;
                        }
                        // Soltanto l'inventario: nessun activate durante discovery.
                        registry.remember(bundle);
                    }
                    for error in found.errors {
                        tracing::error!(target: "fub.host", "component skipped: {error}");
                    }
                }
                Err(error) => tracing::error!(target: "fub.host", "component discovery failed: {error}"),
            }
        }
        let registry = Custody::new("i componenti montati", registry);''')
replace("crates/fub-wasm-host/src/lib.rs", "mod directory;", "mod directory;\nmod source;\npub use source::WasmSource;")
Path("crates/fub-wasm-host/src/source.rs").write_text(r'''//! Adattatore della directory alla porta di discovery dell'host.
use std::sync::Arc;
use camino::Utf8Path;
use fub_abi::PluginError;
use fub_host::{Bundle, BundleDiscovery, BundleSource};
use crate::ComponentDirectory;

/// Scopre componenti di comunità senza attivarli o promuoverne la fiducia.
#[derive(Debug, Default)]
pub struct WasmSource;
impl BundleSource for WasmSource {
    fn discover(&self, config_dir: &Utf8Path) -> Result<BundleDiscovery, PluginError> {
        let found = ComponentDirectory::new(config_dir).discover()?;
        Ok(BundleDiscovery {
            bundles: found.components.into_iter().map(|bundle| Arc::new(bundle) as Arc<dyn Bundle>).collect(),
            errors: found.errors,
        })
    }
}
''')
replace("crates/fub-app/Cargo.toml", "fub-kernel.workspace = true", "fub-kernel.workspace = true\nfub-wasm-host.workspace = true")
replace("crates/fub-app/src/lib.rs", "Host::installed()", "Host::installed().with_bundle_source(Box::new(fub_wasm_host::WasmSource))")

component = "crates/fub-wasm-host/src/component.rs"
replace(component, "    UnservedFamilies(String),", '''    UnservedFamilies(String),
    /// Un provider esportato non ha ancora un proxy: rifiutarlo evita un mount
    /// apparentemente riuscito che scarta in silenzio una parte del plugin.
    #[error("il componente esporta provider che questo host non serve: {0}")]
    UnservedProviders(String),
    /// Un export presente non rispetta la firma del contratto.
    #[error("export del componente incompatibile: {0}")]
    InvalidExport(String),''')
replace(component, "const HOST_FAMILY_PREFIX: &str = \"fub:abi/host-\";", '''const HOST_FAMILY_PREFIX: &str = "fub:abi/host-";

fn family(name: &str, base: &str) -> bool {
    name == base || name.strip_prefix(base).is_some_and(|suffix| suffix.starts_with('@'))
}

const PROVIDERS_SERVED: &[&str] = &["fub:abi/plugin", "fub:abi/command", "fub:abi/view"];''')
replace(component, ".any(|s| name.starts_with(s))", ".any(|s| family(name, s))")
replace(component, "        cap_the_rest(&mut linker, &engine, &component)", '''        let exports: Vec<String> = component.component_type().exports(&engine)
            .map(|(name, _)| name.to_string()).collect();
        let unsupported: Vec<&str> = exports.iter()
            .filter(|name| name.starts_with("fub:abi/"))
            .filter(|name| !PROVIDERS_SERVED.iter().any(|base| family(name, base)))
            .map(String::as_str).collect();
        if !unsupported.is_empty() {
            return Err(LoadError::UnservedProviders(unsupported.join(", ")));
        }
        cap_the_rest(&mut linker, &engine, &component)''')
replace(component, "        let command_indices = w_command::GuestIndices::new(&pre).ok();", '''        let command_indices = if exports.iter().any(|name| family(name, "fub:abi/command")) {
            Some(w_command::GuestIndices::new(&pre).map_err(|error|
                LoadError::InvalidExport(format!("fub:abi/command: {error:#}")))?)
        } else { None };''')
replace(component, "        let view_indices = w_view::GuestIndices::new(&pre).ok();", '''        let view_indices = if exports.iter().any(|name| family(name, "fub:abi/view")) {
            Some(w_view::GuestIndices::new(&pre).map_err(|error|
                LoadError::InvalidExport(format!("fub:abi/view: {error:#}")))?)
        } else { None };''')

# Unsupported providers are real compiled components with stub bodies. The
# rejection must precede instantiation, so none of those bodies can be called.
probe = Path("esempi/provider-probe-wasm")
(probe / "src").mkdir(parents=True, exist_ok=True)
(probe / "wit").mkdir(exist_ok=True)
replace("Cargo.toml", '    "esempi/vault-view-wasm",', '    "esempi/vault-view-wasm",\n    "esempi/provider-probe-wasm",')
(probe / "Cargo.toml").write_text('''[package]
name = "provider-probe-wasm"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[features]
format = []
index = []
events = []

[dependencies]
wit-bindgen = "0.60"
''')
source = "//! Solo fixture negativa: i corpi non devono mai essere eseguiti.\n"
wit = "package esempio:provider-probe;\n\n"
for feature, interface in [("format", "format"), ("index", "index"), ("events", "event-handler")]:
    wit += f"world probe-{feature} {{\n    export fub:abi/plugin@0.1.1;\n    export fub:abi/{interface}@0.1.1;\n}}\n"
    source += f'''#[cfg(feature = "{feature}")]
wit_bindgen::generate!({{
    path: ["../../crates/fub-abi/wit/fub", "wit"],
    world: "esempio:provider-probe/probe-{feature}",
    generate_all,
    stubs: true,
}});
'''
(probe / "wit/probe.wit").write_text(wit)
(probe / "src/lib.rs").write_text(source)
Path("crates/fub-wasm-host/tests/provider_decisions.rs").write_text(r'''//! Un provider non implementato è nominato prima di istanziare, non ignorato.
mod common;
use fub_wasm_host::{Component, LoadError};

#[test]
fn format_index_and_event_handlers_are_explicitly_refused() {
    for (feature, interface) in [("format", "format"), ("index", "index"), ("events", "event-handler")] {
        let path = common::component("provider-probe-wasm", "provider_probe_wasm", feature);
        let error = Component::from_file(&path).err().expect("provider privo di proxy");
        assert!(matches!(error, LoadError::UnservedProviders(_)), "{error}");
        assert!(error.to_string().contains(&format!("fub:abi/{interface}@0.1.1")), "{error}");
    }
}
''')

Path("crates/fub-wasm-host/examples").mkdir(exist_ok=True)
Path("crates/fub-wasm-host/examples/components.rs").write_text(r'''//! Percorso autore riprodotto dai test: installare non significa attivare.
use camino::Utf8Path;
use fub_abi::{traits::ViewInstance, PluginError};
use fub_host::Host;
use fub_wasm_host::{ComponentDirectory, WasmSource};

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), PluginError> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["inspect", source] => println!("{:#?}", ComponentDirectory::inspect(Utf8Path::new(source))?),
        ["install", config, source] => {
            let manifest = ComponentDirectory::new(Utf8Path::new(config)).install(Utf8Path::new(source))?;
            println!("{} installato; resta spento fino all'attivazione esplicita", manifest.id);
        }
        ["list", config] => {
            let found = ComponentDirectory::new(Utf8Path::new(config)).discover()?;
            for bundle in found.components {
                use fub_host::Bundle;
                println!("{} (spento)", bundle.manifest().id);
            }
            if !found.errors.is_empty() {
                for error in &found.errors { eprintln!("{error}"); }
                return Err(PluginError::BadArgs("discovery con pacchetti rifiutati".into()));
            }
        }
        ["remove", config, id] => {
            ComponentDirectory::new(Utf8Path::new(config)).remove(id)?;
            println!("{id}: rimosso il pacchetto, conservati i dati del plugin");
        }
        ["run-view", config, vault, id, view] => {
            let host = Host::new().with_config_dir(Utf8Path::new(config))
                .with_bundle_source(Box::new(WasmSource));
            let result = (|| {
                host.open(Utf8Path::new(vault))?;
                host.wait_indexed(None)?;
                let warnings = host.set_plugin_enabled(None, id, true)?;
                if let Some(error) = warnings.into_iter().next() { return Err(error); }
                let tree = host.with_session(None, |session| {
                    session.workspace().read()?.render_view(&ViewInstance::only(*view))
                })??;
                println!("{}", serde_json::to_string_pretty(&tree).map_err(|e| PluginError::Internal(e.to_string().into()))?);
                let warnings = host.set_plugin_enabled(None, id, false)?;
                if let Some(error) = warnings.into_iter().next() { return Err(error); }
                Ok(())
            })();
            let close_errors = host.close();
            result?;
            if let Some(error) = close_errors.into_iter().next() { return Err(error); }
        }
        _ => return Err(PluginError::BadArgs(concat!(
            "Uso: components inspect FILE | install CONFIG FILE | list CONFIG | ",
            "remove CONFIG ID | run-view CONFIG VAULT ID VIEW. ",
            "Chiudere tutte le sessioni prima di remove; l'installazione non autorizza l'esecuzione."
        ).into())),
    }
    Ok(())
}
''')

Path("crates/fub-wasm-host/tests/discovery_in_the_host.rs").write_text(r'''//! Il binario conosce la sorgente, non gli id dei componenti installati.
mod common;
use camino::Utf8PathBuf;
use fub_abi::{traits::ViewInstance, PluginError};
use fub_host::{Host, NoWatcher};
use fub_wasm_host::{ComponentDirectory, WasmSource};

#[test]
fn discovery_is_not_consent_and_removal_preserves_plugin_data() {
    let component = common::component("vault-view-wasm", "vault_view_wasm", "");
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    let config = root.join("config");
    let vault = root.join("vault");
    std::fs::create_dir(&vault).unwrap();
    std::fs::write(vault.join("Nota.md"), "# Nota\n").unwrap();
    let mut packages = ComponentDirectory::new(&config);
    let manifest = packages.install(&component).unwrap();
    let id = manifest.id.as_str();
    let view = ViewInstance::only("demo.vault-view:documents");
    let host = Host::new().with_config_dir(&config).with_watcher(Box::new(NoWatcher))
        .with_bundle_source(Box::new(WasmSource));
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| {
        assert!(session.bundles().read().unwrap().knows(id));
        assert!(!session.bundles().read().unwrap().ids().contains(&id));
        assert!(matches!(session.workspace().read().unwrap().render_view(&view), Err(PluginError::UnknownView(_))));
    }).unwrap();
    assert!(host.set_plugin_enabled(None, id, true).unwrap().is_empty());
    host.with_session(None, |session| assert!(session.workspace().read().unwrap().render_view(&view).is_ok())).unwrap();
    assert!(host.close().is_empty());
    // Anche la preferenza "abilitato" nel vault non costituisce consenso.
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| assert!(!session.bundles().read().unwrap().ids().contains(&id))).unwrap();
    assert!(host.set_plugin_enabled(None, id, true).unwrap().is_empty());
    assert!(host.set_plugin_enabled(None, id, false).unwrap().is_empty());
    assert!(host.close().is_empty());
    let user_data = vault.join(".fub/plugins").join(id).join("keep.bin");
    std::fs::create_dir_all(user_data.parent().unwrap()).unwrap();
    std::fs::write(&user_data, b"dati autorevoli").unwrap();
    packages.remove(id).unwrap();
    assert_eq!(std::fs::read(&user_data).unwrap(), b"dati autorevoli");
    host.open(&vault).unwrap();
    host.wait_indexed(None).unwrap();
    host.with_session(None, |session| assert!(!session.bundles().read().unwrap().knows(id))).unwrap();
    assert!(host.close().is_empty());
}
''')

p = Path("crates/fub-wasm-host/tests/views_cross_the_boundary.rs")
p.write_text(p.read_text() + r'''

struct NativeView;
impl fub_abi::traits::ViewProvider for NativeView {
    fn views(&self) -> Vec<fub_abi::traits::ViewSpec> {
        vec![fub_abi::traits::ViewSpec {
            id: "demo.native:documents".into(), title: "Documenti del vault".into(),
            surface: fub_abi::traits::ViewSurface::RightSidebar,
            refresh: Default::default(), follows: Default::default(), params: vec![],
            icon: Some("files".into()), order: 10, open_by_default: false,
            preferred_size: Some(280), closable: true,
        }]
    }
    fn render_view(&self, _: &ViewInstance, host: &dyn fub_abi::traits::ReadApi) -> Result<fub_abi::ui::UiNode, PluginError> {
        use fub_abi::ui::{UiNode, ActionRef, ActionId};
        let mut ids = host.list_documents(None)?.items;
        ids.sort_by(|a, b| a.0.cmp(&b.0));
        let mut items = Vec::new();
        for id in ids {
            let text = host.read_document(&id)?;
            items.push(UiNode {
                key: Some(id.0.clone()),
                kind: UiKind::ListItem {
                    title: id.0.clone().into(),
                    subtitle: Some(format!("{} caratteri", text.chars().count()).into()),
                    action: Some(ActionRef { action: ActionId("open".into()), payload: serde_json::json!(id.0) }),
                    selected: false,
                },
            });
        }
        Ok(UiNode { key: Some("documents".into()), kind: UiKind::List { items } })
    }
    fn on_action(&mut self, _: &ViewInstance, action: UiAction, _: &mut dyn fub_abi::traits::HostApi) -> Result<ViewUpdate, PluginError> {
        Ok(ViewUpdate::Navigate { doc_id: serde_json::from_value(action.payload).map_err(|error| PluginError::BadArgs(error.to_string().into()))? })
    }
}

#[test]
fn native_and_wasm_views_have_the_same_observable_tree_and_action() {
    with_view(|ws, _, bundle| {
        use fub_host::Bundle;
        let mut manifest = bundle.manifest();
        manifest.id = "demo.native".into();
        ws.register_plugin(manifest, Trust::Community).unwrap();
        ws.register_view_provider("demo.native", Box::new(NativeView)).unwrap();
        let native = ViewInstance::only("demo.native:documents");
        let wasm = ViewInstance::only(VIEW);
        assert_eq!(ws.render_view(&native).unwrap(), ws.render_view(&wasm).unwrap());
        let action = || UiAction::new("open").with_payload(serde_json::json!("Nota.md"));
        assert_eq!(ws.view_action(&native, action()).unwrap(), ws.view_action(&wasm, action()).unwrap());
    });
}
''')
