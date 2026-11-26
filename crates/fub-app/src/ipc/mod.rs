//! La superficie IPC di Fub: ogni `#[tauri::command]` e l'elenco chiuso che
//! li registra ([`handler`]), un file per tema.
//!
//! **Una cartella, non un file.** Fino al 2026-11-26 la superficie stava tutta
//! in `lib.rs` (oltre 4.000 righe); la regola che le prove di
//! `tests/lean_ipc.rs` presidiano — una superficie sola, leggibile per intero,
//! con un elenco chiuso — vale adesso per questa cartella: un comando fuori da
//! `src/ipc/` o un file della cartella che le prove non conoscono è rosso.
//!
//! I comandi sono `pub(crate)`: `run()` in `lib.rs` monta [`handler`], e il
//! resto del crate (i moduli di prova, `support`, `mobile`) li raggiunge per
//! nome come quando stavano nella radice. Ogni modulo è `#[macro_use]` perché
//! `generate_handler!` trovi le macro che `#[tauri::command]` genera accanto a
//! ciascun comando.

use std::collections::BTreeMap;
use std::io::Read;
use std::io::Write;
use std::sync::Arc;

use camino::Utf8Path;
use camino::Utf8PathBuf;
use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::format::SourceKind;
use fub_abi::grid::{GridApplyRequest, GridCommit, GridSurfaceSpec, GridWindowRequest};
use fub_abi::locale::Locale;
use fub_abi::session::ViewContext;
use fub_abi::settings::{SettingScope, SettingValue};
use fub_abi::theme::ThemeLight;
use fub_abi::traits::{IndexQuery, IndexResult, JobId, ViewInstance, ViewSpec};
use fub_abi::ui::{ActionId, FieldValue, UiAction, UiNode, ViewUpdate};
use fub_abi::{
    DrawingCommandInfo, DrawingCommandRequest, DrawingGesture, DrawingOpen, DrawingOutcome,
    DrawingSync, DrawingSynced, GridBytesSession, GridBytesWindow, GridCommandOutcome,
    GridCommandRequest, GridCommandState, GridSelection, Notice, PluginError,
};
use fub_host::{
    componenti, doc_id, document_text, Delivery, DocumentText, EventSink, Host, OpenKey,
    ShellNotice,
};
use fub_wasm_host::catalog::{CatalogEntry, CatalogError, CatalogTrust, SignedFeed};
use fub_wasm_host::installed::Consent;
use fub_wasm_host::managed::{InstalledOperation, InstalledPluginManager, InstalledShutdown};
use tauri::{AppHandle, Emitter, Manager, State};

use super::*;

#[macro_use]
mod artifacts;
#[macro_use]
mod commands;
#[macro_use]
mod components;
#[macro_use]
mod context;
#[macro_use]
mod craft;
#[macro_use]
mod data;
#[macro_use]
mod diagnostics;
#[macro_use]
mod documents;
#[macro_use]
mod drawing;
#[macro_use]
mod events;
#[macro_use]
mod grid;
#[macro_use]
mod keybindings;
#[macro_use]
mod lanes;
#[macro_use]
mod live_commands;
#[macro_use]
mod mobile_commands;
#[macro_use]
mod opened;
#[macro_use]
mod plugins;
#[macro_use]
mod resource_stream;
#[macro_use]
mod settings;
#[macro_use]
mod themes;
#[macro_use]
mod vaults;
#[macro_use]
mod viewer;
#[macro_use]
mod views;
#[macro_use]
mod windows;
pub(crate) use artifacts::*;
pub(crate) use commands::*;
pub use components::*;
pub(crate) use context::*;
pub(crate) use craft::*;
pub(crate) use data::*;
pub(crate) use diagnostics::*;
pub use documents::*;
pub(crate) use drawing::*;
pub(crate) use events::*;
pub(crate) use grid::*;
pub(crate) use keybindings::*;
pub(crate) use lanes::*;
pub(crate) use live_commands::*;
pub(crate) use mobile_commands::*;
pub(crate) use opened::*;
pub(crate) use plugins::*;
pub(crate) use resource_stream::*;
pub(crate) use settings::*;
pub use themes::*;
pub use vaults::*;
pub(crate) use viewer::*;
pub(crate) use views::*;
pub(crate) use windows::*;

/// L'elenco chiuso dei comandi che il webview può invocare: `run()` lo passa a
/// `invoke_handler`. Un nome in più qui è superficie in più, e le prove di
/// `tests/lean_ipc.rs` e `tests/ipc_permissions.rs` lo leggono da questo file.
pub(crate) fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        open_vault,
        close_vault,
        list_vaults,
        discard_draft,
        set_active_context,
        set_system_locale,
        set_current_vault,
        initial_vault,
        session_notice,
        save_artifact,
        print_artifact,
        reveal_in_system,
        external_editors,
        open_with,
        craft_render,
        demo_root,
        open_demo,
        close_demo,
        reset_demo,
        startup_diagnostics,
        support_preview,
        support_export,
        config_health,
        recover_config,
        open_document_window,
        close_document_window,
        finish_main_close,
        read_document,
        warm_engine,
        document_closed,
        resource_open,
        resource_read_chunk,
        resource_close,
        resource_write,
        viewer_open,
        viewer_control,
        viewer_save,
        map_tile,
        list_grid_surfaces,
        open_grid_bytes,
        grid_bytes_window,
        apply_grid_bytes,
        grid_bytes_commands,
        grid_bytes_command,
        close_grid_bytes,
        open_drawing,
        drawing_sync,
        drawing_gesture,
        drawing_commands,
        drawing_command,
        close_drawing,
        write_document,
        save_draft,
        list_bundles,
        list_themes,
        read_theme,
        check_theme_folder,
        install_theme_from_folder,
        discard_theme_folder,
        link_theme_folder,
        unlink_theme_folder,
        theme_link,
        list_installed_plugins,
        plugin_budget_snapshot,
        plugin_limited_mode,
        catalog_search,
        catalog_install,
        catalog_update,
        catalog_rollback,
        catalog_revoke,
        catalog_install_theme,
        catalog_update_theme,
        catalog_rollback_theme,
        catalog_revoke_theme,
        list_views,
        render_view,
        view_action,
        list_commands,
        invoke_command,
        query_index,
        cancel_job,
        set_icon,
        set_pinned,
        set_space,
        set_order,
        set_setting,
        reset_setting,
        settings_profiles,
        export_settings_profile,
        import_settings_profile,
        duplicate_settings_profile,
        switch_settings_profile,
        reset_settings_profile,
        frame_capabilities,
        setting_requires_reopen,
        view_state,
        set_view_state,
        install_plugin,
        set_installed_plugin_enabled,
        set_installed_plugin_consent,
        remove_installed_plugin,
        set_plugin_enabled,
        components_map,
        components_apply,
        known_vaults,
        set_vault_favorite,
        set_vault_look,
        forget_vault,
        pending_keybindings,
        adopt_keybindings,
        discard_keybindings,
        mobile_validate_capture,
        mobile_submit_capture,
        mobile_storage_roots,
        mobile_storage_preference,
        mobile_set_storage_preference,
        mobile_wasm_report,
        mobile_classify_opened_url,
        mobile_register_tree_grant,
        mobile_shared_mount_mode,
        mobile_pick_tree,
        mobile_verify_tree,
        mobile_open_shared,
        mobile_close_shared,
        mobile_copy_tree,
        live_start,
        live_pairing,
        live_send,
        live_status,
        live_stop,
    ]
}
