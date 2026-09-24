//! Publish view over local site records and cached dry-run manifests.
//!
//! Site selection, preview and version actions share one view instance: view
//! state belongs to an instance, so separate panels cannot share a selection.
//! Network work is queued through the existing publish commands.

use fub_abi::event::{EventKind, EventMask};
use fub_abi::text::Text;
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
            Text::from("Publish sites"),
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
                    return Err(PluginError::BadArgs(
                        "site must be 1-64 lowercase letters, digits, - or _".into(),
                    ));
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
                    return Err(PluginError::BadArgs(
                        "commit requires a nonempty cached dry-run for this site".into(),
                    ));
                }
                host.run_command(
                    super::commands::PUBLISH_COMMIT,
                    serde_json::json!({ "site": site }),
                )?;
                Ok(ViewUpdate::None)
            }
            ACTION_UNPUBLISH => {
                let site = selected_site(&action, host)?;
                let record = PublishViews::site(host, &site);
                if !record.live_version.as_deref().is_some_and(|live| {
                    live.parse::<u64>().is_ok_and(|n| n > 0)
                        && record.versions.iter().any(|version| version == live)
                }) {
                    return Err(PluginError::BadArgs(
                        "unpublish requires a live site".into(),
                    ));
                }
                host.run_command(
                    super::commands::PUBLISH_UNPUBLISH,
                    serde_json::json!({ "site": site }),
                )?;
                Ok(ViewUpdate::None)
            }
            ACTION_ROLLBACK => {
                let site = selected_site(&action, host)?;
                let version = action
                    .payload
                    .get(VERSION)
                    .and_then(|value| value.as_str())
                    .filter(|version| version.parse::<u64>().is_ok_and(|n| n > 0))
                    .ok_or_else(|| {
                        PluginError::BadArgs("rollback needs a string u64 version".into())
                    })?;
                if !PublishViews::site(host, &site)
                    .versions
                    .iter()
                    .any(|v| v == version)
                {
                    return Err(PluginError::BadArgs(
                        "rollback needs an existing version".into(),
                    ));
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
        .ok_or_else(|| PluginError::BadArgs("choose a site first".into()))?;
    if action.payload.get(SITE).and_then(|value| value.as_str()) != Some(site.as_str()) {
        return Err(PluginError::BadArgs(
            "action site differs from selected site".into(),
        ));
    }
    Ok(site)
}

fn sites_tree(host: &dyn ReadApi) -> UiNode {
    let ids = PublishViews::site_ids(host);
    let selected = PublishViews::selected(host);
    let mut children = vec![UiNode::new(UiKind::Form {
        children: vec![UiNode::new(UiKind::TextInput {
            field: SITE.to_string(),
            label: Some(Text::from("Site ID")),
            value: selected.clone().unwrap_or_default(),
            placeholder: Some(Text::from("lowercase letters, digits, - or _")),
            action: None,
        })
        .with_key(SITE)],
        submit_label: Text::from("Choose site"),
        submit: ActionRef::new(ACTION_SELECT),
    })];
    if ids.is_empty() && selected.is_none() {
        children.push(UiNode::empty_state(Text::from(
            "No sites yet. Enter a site ID above to start a dry run.",
        )));
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
        children.push(preview_tree(host, &site_id));
        children.push(activity_tree(host, &site_id));
    }
    UiNode::column(1, children)
}

fn site_row(site: &SiteView, selected: bool) -> UiNode {
    let live = site
        .live_version
        .as_deref()
        .map(|v| format!("live v{v}"))
        .unwrap_or_else(|| "no live version".to_string());
    let lock = if site.password_protected {
        " · locked"
    } else {
        ""
    };
    UiNode::keyed(
        format!("site:{}", site.site_id),
        fub_abi::ui::UiKind::ListItem {
            title: Text::from(site.site_id.clone()),
            subtitle: Some(Text::from(format!(
                "{live}{lock} · {} pages · {} assets",
                site.page_count, site.asset_count
            ))),
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
        Text::from(format!("Manifest: {site_id}")),
    )];
    let preview = PublishViews::dry_run(host, site_id);
    match &preview {
        None => children.push(UiNode::empty_state(Text::from(
            "No cached manifest. Run a dry run before committing.",
        ))),
        Some(preview) => {
            let manifest = &preview.export.manifest;
            children.push(UiNode::text(Text::from(format!(
                "Cached manifest v{} · {} pages · {} assets · {} private excluded",
                manifest.version,
                manifest.pages.len(),
                manifest.assets.len(),
                preview.plan.excluded_private.len()
            ))));
            for path in &preview.plan.diff.added {
                children.push(UiNode::text(Text::from(format!("+ {path}"))));
            }
            for path in &preview.plan.diff.modified {
                children.push(UiNode::text(Text::from(format!("~ {path}"))));
            }
            for path in &preview.plan.diff.unchanged {
                children.push(UiNode::text(Text::from(format!("= {path}"))));
            }
            for path in &preview.plan.diff.removed {
                children.push(UiNode::text(Text::from(format!("- {path}"))));
            }
            for path in &preview.plan.excluded_private {
                children.push(UiNode::text(Text::from(format!("- (private) {path}"))));
            }
            for warning in &preview.plan.warnings {
                children.push(UiNode::text(Text::from(format!("! {warning}"))));
            }
        }
    }
    children.push(UiNode::button(
        Text::from("Dry run"),
        Intent::Neutral,
        ActionRef::with(ACTION_DRY_RUN, serde_json::json!({ SITE: site_id })),
    ));
    if preview.is_some_and(|preview| !preview.export.manifest.pages.is_empty()) {
        children.push(UiNode::button(
            Text::from("Commit cached manifest"),
            Intent::Primary,
            ActionRef::with(ACTION_COMMIT, serde_json::json!({ SITE: site_id })),
        ));
    }
    UiNode::column(1, children)
}

fn activity_tree(host: &dyn ReadApi, site_id: &str) -> UiNode {
    let site = PublishViews::site(host, site_id);
    let versions: Vec<&str> = site
        .versions
        .iter()
        .map(String::as_str)
        .filter(|version| version.parse::<u64>().is_ok_and(|n| n > 0))
        .collect();
    let mut children = vec![UiNode::heading(2, Text::from("Versions"))];
    if versions.is_empty() {
        children.push(UiNode::empty_state(Text::from(
            "No committed versions yet.",
        )));
    } else {
        children.push(UiNode::list(
            versions
                .into_iter()
                .rev()
                .map(|version| {
                    let current = site.live_version.as_deref() == Some(version);
                    UiNode::keyed(
                        format!("version:{version}"),
                        UiKind::Stack {
                            dir: fub_abi::ui::Axis::Column,
                            gap: 0,
                            children: vec![
                                UiNode::list_item(
                                    Text::from(format!(
                                        "v{version}{}",
                                        if current { " (live)" } else { "" }
                                    )),
                                    None,
                                    None,
                                ),
                                UiNode::button(
                                    Text::from("Rollback"),
                                    Intent::Neutral,
                                    ActionRef::with(
                                        ACTION_ROLLBACK,
                                        serde_json::json!({ SITE: site_id, VERSION: version }),
                                    ),
                                ),
                            ],
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
        children.push(UiNode::button(
            Text::from("Unpublish"),
            Intent::Danger,
            ActionRef::with(ACTION_UNPUBLISH, serde_json::json!({ SITE: site_id })),
        ));
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
        assert_eq!(
            find_action(&tree, ACTION_ROLLBACK).unwrap().payload[VERSION],
            "9007199254740993"
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
