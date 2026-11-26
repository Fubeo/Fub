//! **I temi come bundle** (§29.4): la porta unica del [`BundleRegistry`], i
//! cancelli del manifest che si applicano **prima** di toccare il disco, e
//! l'installazione da cartella — atomica, anti-traversal, anti-collisione.
//!
//! Le prove sono due giri. Il primo monta un workspace vero e guarda
//! l'inventario: il tema di serie è nella tabella di `mount` con `kind =
//! theme` e `mounted`, e un tema installato nella cartella di configurazione
//! entra dalla stessa porta. Il secondo prova le porte di `theme` da sole,
//! senza un vault: il motore sbagliato e i permessi si respingono **per
//! nome**, prima di scrivere una riga, e l'installazione non lascia né un tema
//! a metà né una destinazione toccata.

#[cfg(feature = "notify-watcher")]
use std::sync::mpsc;
#[cfg(feature = "notify-watcher")]
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::settings::SettingScope;
use fub_host::registry::BundleKind;
use fub_host::theme::{
    ThemeBlock, ThemeFolderCheck, ThemeFolderInstall, ThemeFolderLink, ThemeFolderRefusal,
    ThemeLink, ThemeLinkState,
};
use fub_host::Host;

// Le prove stanno in un file per tema; gli aiuti che un file presta agli altri
// (scrivere un tema, accendere la modalità sviluppatore, collegare una
// cartella) sono `pub(super)` e arrivano a tutti da qui.
#[path = "themes/caratteri.rs"]
mod caratteri;
#[path = "themes/collegare.rs"]
mod collegare;
#[path = "themes/collegata.rs"]
mod collegata;
#[path = "themes/extends.rs"]
mod extends;
#[path = "themes/icone.rs"]
mod icone;
#[path = "themes/installare.rs"]
mod installare;
#[path = "themes/serie.rs"]
mod serie;
#[cfg(feature = "notify-watcher")]
use collegare::*;
use extends::*;
use installare::*;
use serie::*;

/// L'albero di un tema installabile: manifest valido + un foglio per luce.
/// Il contenuto del foglio non conta (i cancelli CSS girano nella shell), ma
/// un tema senza file oltre al manifest non è una cartella realistica.
fn write_theme(root: &Utf8Path, id: &str, engine: &str, extra: &str) {
    std::fs::create_dir_all(root).unwrap();
    let manifest = format!(
        r#"{{"id": "{id}", "name": "Prova", "version": "1.0.0", "engine": "{engine}", "lights": ["light", "dark"], "asset_namespace": "theme://{id}/", "motion": ["opacity", "transform"]{extra}}}"#
    );
    std::fs::write(root.join("manifest.json"), manifest).unwrap();
    std::fs::write(root.join("sheet-light.css"), "body { color: #333; }\n").unwrap();
    std::fs::write(root.join("sheet-dark.css"), "body { color: #ddd; }\n").unwrap();
    std::fs::write(root.join("skin.css"), ".surface { color: inherit; }\n").unwrap();
}

fn folders() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    (dir, path)
}

fn installed(config: &Utf8Path) -> Host {
    Host::without_watcher().with_config_dir(config)
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let (dir, root) = folders();
    std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
    (dir, root)
}
