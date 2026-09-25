//! Publish view over local site records and cached dry-run manifests.
//!
//! Site selection, preview and version actions share one view instance: view
//! state belongs to an instance, so separate panels cannot share a selection.
//! Network work is queued through the existing publish commands.

use fub_abi::event::{EventKind, EventMask};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    HostApi, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, UiValue, ViewUpdate};
use fub_abi::PluginError;

/// Provider id (registration + view-state namespace).
pub const PUBLISH_ID: &str = "fub.publish";
/// The single mounted site, preview and activity panel.
pub const PUBLISH_SITES_VIEW: &str = "publish.sites";

/// View-state key holding the selected `site_id` (per-exemplar).
pub const SELECTED_SITE: &str = "publish.selected_site";

/// Actions served by `on_action` (payload keys documented per action).
pub const ACTION_SELECT: &str = "select";
pub const ACTION_DRY_RUN: &str = "dry-run";
pub const ACTION_COMMIT: &str = "commit";
pub const ACTION_UNPUBLISH: &str = "unpublish";
pub const ACTION_ROLLBACK: &str = "rollback";
/// Il sì e il no alla domanda che ritirare o tornare indietro fanno prima.
pub const ACTION_CONFIRM: &str = "confirm";
pub const ACTION_CANCEL: &str = "cancel";

/// L'azione in attesa di risposta (`{action, version?}`), finché non si risponde.
const PENDING: &str = "publish.pending";

/// Le stringhe dei pannelli e dei comandi di pubblicazione, nelle due lingue.
pub fn catalog() -> Vec<StringCatalog> {
    let it = StringCatalog::new("it")
        .with("view.sites", "Pubblicazione")
        .with("site.label", "Id del sito")
        .with("site.placeholder", "lettere minuscole, cifre, - o _")
        .with("site.choose", "Scegli il sito")
        .with(
            "site.invalid",
            "L'id del sito va da 1 a 64 caratteri fra lettere minuscole, cifre, - e _.",
        )
        .with("site.first", "Prima si sceglie un sito.")
        .with(
            "site.mismatch",
            "L'azione è di un altro sito: il pannello si aggiorna.",
        )
        .with(
            "sites.none",
            "Ancora nessun sito. Scrivi qui sopra l'id di un sito per fare una prova.",
        )
        .with(
            "site.live",
            "online la v{version} · {pages} pagine · {assets} file",
        )
        .with(
            "site.live_locked",
            "online la v{version} · protetto · {pages} pagine · {assets} file",
        )
        .with(
            "site.offline",
            "non online · {pages} pagine · {assets} file",
        )
        .with(
            "site.offline_locked",
            "non online · protetto · {pages} pagine · {assets} file",
        )
        .with("manifest.title", "Cosa si pubblica: {site}")
        .with(
            "manifest.none",
            "Nessuna prova in memoria: fai una prova prima di pubblicare.",
        )
        .with(
            "manifest.summary",
            "Prova v{version} · {pages} pagine · {assets} file · {private} private escluse",
        )
        .with("manifest.added", "+ {path} (nuova)")
        .with("manifest.modified", "~ {path} (cambiata)")
        .with("manifest.unchanged", "= {path}")
        .with("manifest.removed", "− {path} (tolta)")
        .with("manifest.private", "− {path} (privata, esclusa)")
        .with("manifest.warning", "! {warning}")
        .with("dry_run", "Fai una prova")
        .with("commit", "Pubblica")
        .with(
            "commit.needs_dry_run",
            "Per pubblicare serve una prova non vuota di questo sito.",
        )
        .with("versions.title", "Versioni")
        .with("versions.none", "Ancora nessuna versione pubblicata.")
        .with("version", "v{version}")
        .with("version.live", "v{version} · online")
        .with("rollback", "Torna a questa versione")
        .with(
            "rollback.question",
            "Rimettere online la v{version} al posto di quella attuale?",
        )
        .with(
            "rollback.invalid",
            "Questa versione non c'è più: il pannello si aggiorna.",
        )
        .with("unpublish", "Ritira il sito")
        .with(
            "unpublish.question",
            "Togliere il sito dalla rete? Le versioni restano, ma non si annulla.",
        )
        .with("unpublish.needs_live", "Il sito non è online.")
        .with("confirm", "Sì, procedi")
        .with("cancel", "Annulla");
    let en = StringCatalog::new("en")
        .with("view.sites", "Publishing")
        .with("site.label", "Site ID")
        .with("site.placeholder", "lowercase letters, digits, - or _")
        .with("site.choose", "Choose site")
        .with(
            "site.invalid",
            "A site ID is 1 to 64 lowercase letters, digits, - or _.",
        )
        .with("site.first", "Choose a site first.")
        .with(
            "site.mismatch",
            "The action belongs to another site: the panel is refreshing.",
        )
        .with(
            "sites.none",
            "No sites yet. Enter a site ID above to run a dry run.",
        )
        .with(
            "site.live",
            "v{version} live · {pages} pages · {assets} files",
        )
        .with(
            "site.live_locked",
            "v{version} live · protected · {pages} pages · {assets} files",
        )
        .with("site.offline", "not live · {pages} pages · {assets} files")
        .with(
            "site.offline_locked",
            "not live · protected · {pages} pages · {assets} files",
        )
        .with("manifest.title", "What gets published: {site}")
        .with(
            "manifest.none",
            "No dry run cached: run one before publishing.",
        )
        .with(
            "manifest.summary",
            "Dry run v{version} · {pages} pages · {assets} files · {private} private excluded",
        )
        .with("manifest.added", "+ {path} (new)")
        .with("manifest.modified", "~ {path} (changed)")
        .with("manifest.unchanged", "= {path}")
        .with("manifest.removed", "− {path} (removed)")
        .with("manifest.private", "− {path} (private, excluded)")
        .with("manifest.warning", "! {warning}")
        .with("dry_run", "Dry run")
        .with("commit", "Publish")
        .with(
            "commit.needs_dry_run",
            "Publishing needs a nonempty dry run of this site.",
        )
        .with("versions.title", "Versions")
        .with("versions.none", "No published versions yet.")
        .with("version", "v{version}")
        .with("version.live", "v{version} · live")
        .with("rollback", "Go back to this version")
        .with(
            "rollback.question",
            "Put v{version} back online instead of the current one?",
        )
        .with(
            "rollback.invalid",
            "This version no longer exists: the panel is refreshing.",
        )
        .with("unpublish", "Unpublish")
        .with(
            "unpublish.question",
            "Take the site offline? Versions stay, but this cannot be undone.",
        )
        .with("unpublish.needs_live", "The site is not live.")
        .with("confirm", "Yes, go ahead")
        .with("cancel", "Cancel");
    let (it, en) = super::commands::catalog_rows(it, en);
    vec![it, en]
}

/// Payload / field keys.
pub const SITE: &str = "site_id";
pub const VERSION: &str = "version";

/// Per-site record as persisted by the commands layer under
/// `sites/<site_id>/record.json` (serde names match the backend
/// `SiteRecord`, with `u64`-as-string versions — see `wire` there).
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct SiteView {
    #[serde(default)]
    pub site_id: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub collaborators: Vec<String>,
    #[serde(default)]
    pub live_version: Option<String>,
    #[serde(default)]
    pub versions: Vec<String>,
    #[serde(default)]
    pub page_count: usize,
    #[serde(default)]
    pub asset_count: usize,
    #[serde(default)]
    pub password_protected: bool,
}

/// Derived dry-run plan stored alongside the exact export in the plugin cache.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DryRunView {
    #[serde(default)]
    pub would_publish: Vec<String>,
    #[serde(default)]
    pub excluded_private: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    pub diff: super::site::ManifestDiff,
}

#[derive(serde::Deserialize)]
struct CachedPreview {
    plan: DryRunView,
    export: super::site::ExportSnapshot,
}

/// The site panel set. Stateless across renders (like `TrashView`):
/// per-exemplar questions live in view-state, never in fields.
pub struct PublishViews;

impl PublishViews {
    pub fn boxed() -> Box<dyn ViewProvider> {
        Box::new(Self)
    }
    fn selected(host: &dyn ReadApi) -> Option<String> {
        host.view_state(SELECTED_SITE)
            .ok()
            .flatten()
            .and_then(|value| value.as_str().map(str::to_string))
            .filter(|site| super::site::valid_site_id(site))
    }

    fn site_ids(host: &dyn ReadApi) -> Vec<String> {
        let mut ids: Vec<String> = host
            .data_list("sites")
            .unwrap_or_default()
            .into_iter()
            .filter_map(|path| {
                let id = path.strip_prefix("sites/")?.strip_suffix("/record.json")?;
                super::site::valid_site_id(id).then(|| id.to_string())
            })
            .collect();
        ids.sort();
        ids.dedup();
        ids
    }

    fn site(host: &dyn ReadApi, site_id: &str) -> SiteView {
        let path = format!("sites/{site_id}/record.json");
        let mut site: SiteView = host
            .data_read(&path)
            .ok()
            .flatten()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        site.site_id = site_id.to_string();
        site
    }

    fn dry_run(host: &dyn ReadApi, site_id: &str) -> Option<CachedPreview> {
        let path = format!("sites/{site_id}/export.json");
        host.cache_read(&path)
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<CachedPreview>(&bytes).ok())
            .filter(|preview| {
                preview.export.manifest.site_id == site_id
                    && preview.export.manifest.no_private_leak
                    && preview.plan.would_publish == preview.export.manifest.allowlist
            })
    }
}

impl ViewProvider for PublishViews {
    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            PUBLISH_SITES_VIEW,
            Text::key("view.sites"),
            ViewSurface::LeftSidebar,
        )
        .with_icon("publish")
        .ordered(30)]
    }

    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Jobs write the cache/records after the command has returned.
            refresh: EventMask::of([
                EventKind::IndexUpdated,
                EventKind::BatchEnded,
                EventKind::JobDone,
            ]),
            follows: Default::default(),
        }
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        match instance.view.as_str() {
            PUBLISH_SITES_VIEW => Ok(sites_tree(host)),
            _ => Err(PluginError::UnknownView(instance.view.clone().into())),
        }
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            ACTION_SELECT => {
                let site = action
                    .payload
                    .get(SITE)
                    .and_then(|value| value.as_str())
                    .or_else(|| {
                        action.field(SITE).and_then(|value| match value {
                            UiValue::Text(site) => Some(site.as_str()),
                            _ => None,
                        })
                    })
                    .unwrap_or("")
                    .trim();
                if !super::site::valid_site_id(site) {
                    return Err(PluginError::BadArgs(Text::key("site.invalid")));
                }
                host.set_view_state(
                    SELECTED_SITE,
                    Some(serde_json::Value::String(site.to_string())),
                )?;
                self.render_view(instance, host)
                    .map(|root| ViewUpdate::Replace { root })
            }
            ACTION_DRY_RUN => {
                let site = selected_site(&action, host)?;
                host.run_command(
                    super::commands::PUBLISH_DRY_RUN,
                    serde_json::json!({ "site": site }),
                )?;
                Ok(ViewUpdate::None)
            }
            ACTION_COMMIT => {
                let site = selected_site(&action, host)?;
                if PublishViews::dry_run(host, &site)
                    .is_none_or(|preview| preview.export.manifest.pages.is_empty())
                {
                    return Err(PluginError::BadArgs(Text::key("commit.needs_dry_run")));
                }
                host.run_command(
                    super::commands::PUBLISH_COMMIT,
                    serde_json::json!({ "site": site }),
                )?;
                Ok(ViewUpdate::None)
            }
            // Ritirare e tornare indietro cambiano ciò che è online: il
            // pannello chiede prima, al posto dei bottoni.
            ACTION_UNPUBLISH | ACTION_ROLLBACK => {
                selected_site(&action, host)?;
                let mut pending = action.payload.clone();
                if let Some(object) = pending.as_object_mut() {
                    object.insert("action".into(), action.action.0.clone().into());
                }
                host.set_view_state(PENDING, Some(pending))?;
                self.render_view(instance, host)
                    .map(|root| ViewUpdate::Replace { root })
            }
            ACTION_CANCEL => {
                host.set_view_state(PENDING, None)?;
                self.render_view(instance, host)
                    .map(|root| ViewUpdate::Replace { root })
            }
            ACTION_CONFIRM => {
                let pending = host.view_state(PENDING)?;
                host.set_view_state(PENDING, None)?;
                let Some(pending) = pending else {
                    return Ok(ViewUpdate::None);
                };
                let action = UiAction::new(
                    pending
                        .get("action")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                )
                .with_payload(pending.clone());
                let update = self.apply_confirmed(&action, host)?;
                self.render_view(instance, host)
                    .map(|root| ViewUpdate::Replace { root })
                    .or(Ok(update))
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

impl PublishViews {
    /// Il gesto confermato: le stesse verifiche di prima, ora che si è detto sì.
    fn apply_confirmed(
        &self,
        action: &UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            ACTION_UNPUBLISH => {
                let site = selected_site(action, host)?;
                let record = PublishViews::site(host, &site);
                if !record.live_version.as_deref().is_some_and(|live| {
                    live.parse::<u64>().is_ok_and(|n| n > 0)
                        && record.versions.iter().any(|version| version == live)
                }) {
                    return Err(PluginError::BadArgs(Text::key("unpublish.needs_live")));
                }
                host.run_command(
                    super::commands::PUBLISH_UNPUBLISH,
                    serde_json::json!({ "site": site }),
                )?;
                Ok(ViewUpdate::None)
            }
            ACTION_ROLLBACK => {
                let site = selected_site(action, host)?;
                let version = action
                    .payload
                    .get(VERSION)
                    .and_then(|value| value.as_str())
                    .filter(|version| version.parse::<u64>().is_ok_and(|n| n > 0))
                    .ok_or_else(|| PluginError::BadArgs(Text::key("rollback.invalid")))?;
                if !PublishViews::site(host, &site)
                    .versions
                    .iter()
                    .any(|v| v == version)
                {
                    return Err(PluginError::BadArgs(Text::key("rollback.invalid")));
                }
                host.run_command(
                    super::commands::PUBLISH_ROLLBACK,
                    serde_json::json!({ "site": site, "to_version": version }),
                )?;
                Ok(ViewUpdate::None)
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn selected_site(action: &UiAction, host: &dyn HostApi) -> Result<String, PluginError> {
    let site = PublishViews::selected(host)
        .ok_or_else(|| PluginError::BadArgs(Text::key("site.first")))?;
    if action.payload.get(SITE).and_then(|value| value.as_str()) != Some(site.as_str()) {
        return Err(PluginError::BadArgs(Text::key("site.mismatch")));
    }
    Ok(site)
}

fn sites_tree(host: &dyn ReadApi) -> UiNode {
    let ids = PublishViews::site_ids(host);
    let selected = PublishViews::selected(host);
    let mut children = vec![UiNode::new(UiKind::Form {
        children: vec![UiNode::new(UiKind::TextInput {
            field: SITE.to_string(),
            label: Some(Text::key("site.label")),
            value: selected.clone().unwrap_or_default(),
            placeholder: Some(Text::key("site.placeholder")),
            action: None,
        })
        .with_key(SITE)],
        submit_label: Text::key("site.choose"),
        submit: ActionRef::new(ACTION_SELECT),
    })];
    if ids.is_empty() && selected.is_none() {
        children.push(UiNode::empty_state(Text::key("sites.none")));
    } else if !ids.is_empty() {
        children.push(UiNode::list(
            ids.into_iter()
                .map(|id| {
                    let site = PublishViews::site(host, &id);
                    site_row(&site, selected.as_deref() == Some(id.as_str()))
                })
                .collect(),
        ));
    }
    if let Some(site_id) = selected {
        let pending = host.view_state(PENDING).ok().flatten();
        children.push(preview_tree(host, &site_id));
        children.push(activity_tree(host, &site_id, pending.as_ref()));
    }
    UiNode::column(1, children)
}

fn site_row(site: &SiteView, selected: bool) -> UiNode {
    // Una frase intera per stato: un pezzo tradotto dentro l'argomento di
    // un'altra frase arriverebbe come chiave nuda.
    let mut args = vec![
        Arg::int("pages", site.page_count as i64),
        Arg::int("assets", site.asset_count as i64),
    ];
    let key = match (site.live_version.as_deref(), site.password_protected) {
        (Some(version), locked) => {
            args.push(Arg::text("version", version));
            if locked {
                "site.live_locked"
            } else {
                "site.live"
            }
        }
        (None, true) => "site.offline_locked",
        (None, false) => "site.offline",
    };
    UiNode::keyed(
        format!("site:{}", site.site_id),
        fub_abi::ui::UiKind::ListItem {
            title: Text::from(site.site_id.clone()),
            subtitle: Some(Text::message(key, args)),
            action: Some(ActionRef::with(
                ACTION_SELECT,
                serde_json::json!({ SITE: site.site_id }),
            )),
            selected,
        },
    )
}

fn preview_tree(host: &dyn ReadApi, site_id: &str) -> UiNode {
    let mut children = vec![UiNode::heading(
        2,
        Text::message("manifest.title", vec![Arg::text("site", site_id)]),
    )];
    let preview = PublishViews::dry_run(host, site_id);
    match &preview {
        None => children.push(UiNode::empty_state(Text::key("manifest.none"))),
        Some(preview) => {
            let manifest = &preview.export.manifest;
            children.push(UiNode::text(Text::message(
                "manifest.summary",
                vec![
                    Arg::text("version", manifest.version.to_string()),
                    Arg::int("pages", manifest.pages.len() as i64),
                    Arg::int("assets", manifest.assets.len() as i64),
                    Arg::int("private", preview.plan.excluded_private.len() as i64),
                ],
            )));
            let line = |key: &str, path: &String| {
                UiNode::text(Text::message(key, vec![Arg::text("path", path.clone())]))
            };
            for path in &preview.plan.diff.added {
                children.push(line("manifest.added", path));
            }
            for path in &preview.plan.diff.modified {
                children.push(line("manifest.modified", path));
            }
            for path in &preview.plan.diff.unchanged {
                children.push(line("manifest.unchanged", path));
            }
            for path in &preview.plan.diff.removed {
                children.push(line("manifest.removed", path));
            }
            for path in &preview.plan.excluded_private {
                children.push(line("manifest.private", path));
            }
            for warning in &preview.plan.warnings {
                children.push(UiNode::text(Text::message(
                    "manifest.warning",
                    vec![Arg::text("warning", warning.clone())],
                )));
            }
        }
    }
    children.push(UiNode::button(
        Text::key("dry_run"),
        Intent::Neutral,
        ActionRef::with(ACTION_DRY_RUN, serde_json::json!({ SITE: site_id })),
    ));
    if preview.is_some_and(|preview| !preview.export.manifest.pages.is_empty()) {
        children.push(UiNode::button(
            Text::key("commit"),
            Intent::Primary,
            ActionRef::with(ACTION_COMMIT, serde_json::json!({ SITE: site_id })),
        ));
    }
    UiNode::column(1, children)
}

/// I bottoni di un gesto che chiede prima: la domanda, il sì e il no.
fn asking(question: Text) -> Vec<UiNode> {
    vec![
        UiNode::text(question),
        UiNode::button(
            Text::key("confirm"),
            Intent::Danger,
            ActionRef::new(ACTION_CONFIRM),
        ),
        UiNode::button(
            Text::key("cancel"),
            Intent::Neutral,
            ActionRef::new(ACTION_CANCEL),
        ),
    ]
}

fn activity_tree(host: &dyn ReadApi, site_id: &str, pending: Option<&serde_json::Value>) -> UiNode {
    let pending_action = pending
        .and_then(|p| p.get("action"))
        .and_then(|a| a.as_str());
    let pending_version = pending
        .and_then(|p| p.get(VERSION))
        .and_then(|v| v.as_str());
    let site = PublishViews::site(host, site_id);
    let versions: Vec<&str> = site
        .versions
        .iter()
        .map(String::as_str)
        .filter(|version| version.parse::<u64>().is_ok_and(|n| n > 0))
        .collect();
    let mut children = vec![UiNode::heading(2, Text::key("versions.title"))];
    if versions.is_empty() {
        children.push(UiNode::empty_state(Text::key("versions.none")));
    } else {
        children.push(UiNode::list(
            versions
                .into_iter()
                .rev()
                .map(|version| {
                    let current = site.live_version.as_deref() == Some(version);
                    let mut row = vec![UiNode::list_item(
                        Text::message(
                            if current { "version.live" } else { "version" },
                            vec![Arg::text("version", version)],
                        ),
                        None,
                        None,
                    )];
                    if pending_action == Some(ACTION_ROLLBACK) && pending_version == Some(version) {
                        row.extend(asking(Text::message(
                            "rollback.question",
                            vec![Arg::text("version", version)],
                        )));
                    } else if !current {
                        // Tornare alla versione che è già online non fa niente.
                        row.push(UiNode::button(
                            Text::key("rollback"),
                            Intent::Neutral,
                            ActionRef::with(
                                ACTION_ROLLBACK,
                                serde_json::json!({ SITE: site_id, VERSION: version }),
                            ),
                        ));
                    }
                    UiNode::keyed(
                        format!("version:{version}"),
                        UiKind::Stack {
                            dir: fub_abi::ui::Axis::Column,
                            gap: 0,
                            children: row,
                        },
                    )
                })
                .collect(),
        ));
    }
    if site.live_version.as_deref().is_some_and(|live| {
        live.parse::<u64>().is_ok_and(|n| n > 0)
            && site.versions.iter().any(|version| version == live)
    }) {
        if pending_action == Some(ACTION_UNPUBLISH) {
            children.extend(asking(Text::key("unpublish.question")));
        } else {
            children.push(UiNode::button(
                Text::key("unpublish"),
                Intent::Danger,
                ActionRef::with(ACTION_UNPUBLISH, serde_json::json!({ SITE: site_id })),
            ));
        }
    }
    UiNode::column(1, children)
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::{DataWrite, ViewProvider, ViewStateRead, ViewStateWrite};
    use fub_abi::ui::FieldValue;
    use fub_sdk::testing::MemoryHost;

    fn host_with_site() -> MemoryHost {
        let mut host = MemoryHost::new();
        host.data_write(
            "sites/blog/record.json",
            &serde_json::to_vec(&SiteView {
                site_id: "blog".to_string(),
                owner: "alice".to_string(),
                collaborators: vec!["bob".to_string()],
                live_version: Some("9007199254740993".to_string()),
                versions: vec!["1".to_string(), "9007199254740993".to_string()],
                page_count: 4,
                asset_count: 1,
                password_protected: true,
            })
            .unwrap(),
        )
        .unwrap();
        host.cache_write(
            "sites/blog/export.json",
            &serde_json::to_vec(&serde_json::json!({
                "plan": {
                    "would_publish": ["index.html"],
                    "excluded_private": ["notes/secret.md"],
                    "warnings": ["review generated links"],
                    "diff": { "added": ["index.html"], "modified": [], "unchanged": [], "removed": [] }
                },
                "export": {
                    "manifest": {
                        "site_id": "blog",
                        "version": "1",
                        "allowlist": ["index.html"],
                        "pages": [{ "path": "index.html", "doc_id": "index.md", "html_sha": "hash" }],
                        "assets": [],
                        "no_private_leak": true
                    },
                    "vault": [{ "doc_id": "index.md", "allowed": true, "excluded": false, "linked_only": false }],
                    "pages": [{ "path": "index.html", "doc_id": "index.md", "html": "<h1>Index</h1>" }],
                    "assets": []
                }
            }))
            .unwrap(),
        )
        .unwrap();
        host
    }

    fn find_action<'a>(tree: &'a UiNode, id: &str) -> Option<&'a ActionRef> {
        if let UiKind::Button { action, .. } = &tree.kind {
            if action.action.0 == id {
                return Some(action);
            }
        }
        tree.children()
            .into_iter()
            .find_map(|child| find_action(child, id))
    }

    fn has_action(tree: &UiNode, id: &str) -> bool {
        find_action(tree, id).is_some()
    }

    #[test]
    fn first_site_can_be_chosen_without_a_remote_record() {
        let mut host = MemoryHost::new().with_instance("e");
        let instance = ViewInstance::only(PUBLISH_SITES_VIEW);
        let tree = PublishViews.render_view(&instance, &host).unwrap();
        let UiKind::Stack { children, .. } = tree.kind else {
            panic!("publish panel")
        };
        assert!(matches!(children[0].kind, UiKind::Form { .. }));
        assert!(!has_action(&UiNode::column(1, children), ACTION_COMMIT));

        let update = PublishViews
            .on_action(
                &instance,
                UiAction::new(ACTION_SELECT).with_fields(vec![FieldValue {
                    field: SITE.into(),
                    value: UiValue::Text("first-site".into()),
                }]),
                &mut host,
            )
            .unwrap();
        let ViewUpdate::Replace { root } = update else {
            panic!("selection must redraw")
        };
        assert!(has_action(&root, ACTION_DRY_RUN));
        assert_eq!(
            find_action(&root, ACTION_DRY_RUN).unwrap().payload[SITE],
            "first-site"
        );
        assert!(!has_action(&root, ACTION_COMMIT));
        assert!(!has_action(&root, ACTION_UNPUBLISH));
        assert!(!has_action(&root, ACTION_ROLLBACK));
        assert_eq!(
            host.view_state(SELECTED_SITE).unwrap(),
            Some(serde_json::json!("first-site"))
        );
    }

    #[test]
    fn cached_manifest_and_real_versions_control_actions() {
        let mut host = host_with_site().with_instance("e");
        host.set_view_state(SELECTED_SITE, Some(serde_json::json!("blog")))
            .unwrap();
        let tree = PublishViews
            .render_view(&ViewInstance::only(PUBLISH_SITES_VIEW), &host)
            .unwrap();
        let text = format!("{tree:?}");
        assert!(host.network_requests().is_empty());
        assert!(
            text.contains("index.html") && text.contains("secret.md"),
            "{text}"
        );
        assert!(text.contains("9007199254740993"), "{text}");
        assert!(has_action(&tree, ACTION_COMMIT));
        assert!(has_action(&tree, ACTION_UNPUBLISH));
        assert!(has_action(&tree, ACTION_ROLLBACK));
        for id in [
            ACTION_DRY_RUN,
            ACTION_COMMIT,
            ACTION_UNPUBLISH,
            ACTION_ROLLBACK,
        ] {
            assert_eq!(find_action(&tree, id).unwrap().payload[SITE], "blog");
        }
        // Si torna solo a una versione che non è già online: la v1.
        assert_eq!(
            find_action(&tree, ACTION_ROLLBACK).unwrap().payload[VERSION],
            "1"
        );
    }

    /// Ritirare e tornare indietro chiedono prima: il primo click disegna la
    /// domanda, il no rimette i bottoni, e solo il sì fa partire il comando.
    /// `MemoryHost` non sa eseguire comandi, quindi un comando partito prima
    /// del sì sarebbe un errore.
    #[test]
    fn unpublish_and_rollback_ask_before_they_run() {
        let mut host = host_with_site().with_instance("e");
        host.set_view_state(SELECTED_SITE, Some(serde_json::json!("blog")))
            .unwrap();
        let instance = ViewInstance::only(PUBLISH_SITES_VIEW);
        let click = |host: &mut MemoryHost, action: ActionRef| {
            PublishViews.on_action(
                &instance,
                UiAction::new(action.action.0).with_payload(action.payload),
                host,
            )
        };
        let tree = PublishViews.render_view(&instance, &host).unwrap();
        let unpublish = find_action(&tree, ACTION_UNPUBLISH).unwrap().clone();
        let ViewUpdate::Replace { root } = click(&mut host, unpublish).unwrap() else {
            panic!("la domanda si disegna")
        };
        assert!(has_action(&root, ACTION_CONFIRM));
        assert!(!has_action(&root, ACTION_UNPUBLISH));

        let ViewUpdate::Replace { root } = click(&mut host, ActionRef::new(ACTION_CANCEL)).unwrap()
        else {
            panic!("il pannello si ridisegna")
        };
        assert!(has_action(&root, ACTION_UNPUBLISH));
        assert!(!has_action(&root, ACTION_CONFIRM));

        let rollback = find_action(&root, ACTION_ROLLBACK).unwrap().clone();
        click(&mut host, rollback).unwrap();
        let error = click(&mut host, ActionRef::new(ACTION_CONFIRM)).unwrap_err();
        assert!(
            matches!(&error, PluginError::UnknownCommand(command)
                if *command == super::super::commands::PUBLISH_ROLLBACK),
            "{error:?}"
        );
    }

    #[test]
    fn no_cached_manifest_means_no_commit_action() {
        let mut host = host_with_site().with_instance("e");
        host.set_view_state(SELECTED_SITE, Some(serde_json::json!("another")))
            .unwrap();
        let tree = PublishViews
            .render_view(&ViewInstance::only(PUBLISH_SITES_VIEW), &host)
            .unwrap();
        assert!(has_action(&tree, ACTION_DRY_RUN));
        assert!(!has_action(&tree, ACTION_COMMIT));
        assert!(!has_action(&tree, ACTION_UNPUBLISH));
    }
}
