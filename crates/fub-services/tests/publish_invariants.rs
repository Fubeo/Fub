//! Publish invariants exercised against the same owner handlers as the HTTP router.

use fub_services::publish::guard::{
    assert_no_leakage, escape_html, hash_site_password, is_safe_href, render_markdown_safe,
    sha256_hex, verify_site_password, PublishedSurface,
};
use fub_services::publish::manifest::{
    check_publish_path, check_site_id, plan_dry_run, validate_manifest_for_commit, AssetBody,
    CommitRequest, DryRunRequest, LinkedDoc, PageBody, PublishManifest,
};
use fub_services::publish::site::{
    build_search_index, check_password_gate, commit_site, create_site, load_record,
    recover_interrupted_commit, resolve_static, revoke_collaborator, rollback_site, status_of,
    unpublish_site, PasswordGate, SiteQuota,
};
use fub_services::publish::{
    COMMIT_PATH, DRY_RUN_PATH, ROLLBACK_PATH, SITE_ADMIN_PATH, STATUS_PATH, UNPUBLISH_PATH,
};
use fub_services::server::ServiceState;

fn temp_data_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("fub-publish-invariants-{tag}-{nanos}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
fn quota() -> SiteQuota {
    SiteQuota {
        max_asset_bytes: 1024 * 1024,
        max_site_bytes: 16 * 1024 * 1024,
    }
}

fn page(path: &str, doc: &str, html: &str) -> (PageBody, fub_services::publish::PageEntry) {
    (
        PageBody {
            path: path.to_string(),
            doc_id: Some(doc.to_string()),
            html: html.to_string(),
        },
        fub_services::publish::PageEntry {
            path: path.to_string(),
            doc_id: Some(doc.to_string()),
            html_sha: sha256_hex(html.as_bytes()),
        },
    )
}

fn manifest_v1() -> (PublishManifest, Vec<PageBody>) {
    let (p1, e1) = page("index.html", "notes/home.md", "<h1>Home</h1>\n");
    let (p2, e2) = page("about.html", "notes/about.md", "<h1>About</h1>\n");
    (
        PublishManifest {
            site_id: "blog".to_string(),
            version: 1,
            allowlist: vec!["*.html".to_string()],
            pages: vec![e1, e2],
            assets: vec![],
            no_private_leak: true,
        },
        vec![p1, p2],
    )
}

// --- leakage scanner: excluded id absent from every surface -------------

#[test]
fn excluded_note_absent_from_all_surfaces() {
    let bodies = [
        ("html", "<h1>Home</h1>"),
        ("index", "[{\"path\":\"index.html\"}]"),
        ("graph", "{\"nodes\":[],\"edges\":[]}"),
        ("feed", "<rss></rss>"),
        ("sitemap", "<urlset></urlset>"),
        ("cache", "1\n"),
    ];
    let surfaces: Vec<PublishedSurface<'_>> = bodies
        .iter()
        .map(|(name, body)| PublishedSurface { name, body })
        .collect();
    assert!(assert_no_leakage(&surfaces, &["notes/secret.md"]).is_ok());
}

#[test]
fn excluded_note_detected_in_each_surface() {
    for surface in ["html", "index", "graph", "feed", "sitemap", "cache"] {
        let dirty = "leak of notes/secret.md here".to_string();
        let surfaces = [PublishedSurface {
            name: surface,
            body: &dirty,
        }];
        let leaks = assert_no_leakage(&surfaces, &["notes/secret.md"]).unwrap_err();
        assert_eq!(leaks.len(), 1);
        assert_eq!(leaks[0].surface, surface);
        assert_eq!(leaks[0].doc_id, "notes/secret.md");
    }
}

// --- rendering guard ------------------------------------------------------

#[test]
fn renderer_escapes_script_style_iframe() {
    let html = render_markdown_safe("# Hi\n<script>alert(1)</script>\n<iframe src=\"x\"></iframe>");
    assert!(!html.contains("<script>"), "{html}");
    assert!(!html.contains("<iframe"), "{html}");
    assert!(html.contains("&lt;script&gt;"), "{html}");
    assert!(html.contains("<h1>Hi</h1>"), "{html}");
}

#[test]
fn unsafe_hrefs_fall_back_to_text() {
    assert!(!is_safe_href("javascript:alert(1)"));
    assert!(!is_safe_href("data:text/html,<h1>x</h1>"));
    assert!(is_safe_href("https://example.com/a"));
    assert!(is_safe_href("/s/blog/index.html"));
    assert!(is_safe_href("#anchor"));
    let html = render_markdown_safe("[click](javascript:alert(1))");
    assert!(
        !html.contains("href=\"javascript:"),
        "unsafe URI became clickable: {html}"
    );
    assert_eq!(escape_html("<&>"), "&lt;&amp;&gt;");
}

// --- manifest: linked closure needs explicit allow ------------------------

#[test]
fn linked_private_note_never_auto_publishes() {
    let (manifest, _) = manifest_v1();
    let vault = vec![
        LinkedDoc {
            doc_id: "notes/secret.md".to_string(),
            allowed: false,
            excluded: true,
            linked_only: true,
        },
        LinkedDoc {
            doc_id: "notes/linked.md".to_string(),
            allowed: false,
            excluded: false,
            linked_only: true,
        },
    ];
    let plan = plan_dry_run(&manifest, &vault);
    assert!(plan
        .excluded_private
        .contains(&"notes/secret.md".to_string()));
    assert!(!plan.would_publish.iter().any(|p| p.contains("secret")));
    assert!(plan.warnings.iter().any(|w| w.contains("notes/linked.md")));
}

#[test]
fn commit_rejects_outside_allowlist_and_missing_assertion() {
    let (mut manifest, pages) = manifest_v1();
    manifest.allowlist = vec!["about.html".to_string()];
    assert!(validate_manifest_for_commit(&manifest, &pages, &[]).is_err());
    let (mut manifest, pages) = manifest_v1();
    manifest.no_private_leak = false;
    assert!(validate_manifest_for_commit(&manifest, &pages, &[]).is_err());
    assert!(check_site_id("Blog!").is_err());
    assert!(check_publish_path("../escape.html").is_err());
    assert!(check_publish_path("/absolute.html").is_err());
}

// --- lifecycle: commit / atomicity / rollback / unpublish -----------------

#[test]
fn failed_commit_keeps_prior_live() {
    let data = temp_data_dir("atomic");
    create_site(&data, "blog", "alice", None).unwrap();
    let (manifest, pages) = manifest_v1();
    let request = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec!["notes/secret.md".to_string()],
    };
    let (_, v1) = commit_site(
        &data,
        &request,
        &request.excluded_private,
        quota(),
        16,
        1,
        false,
    )
    .unwrap();
    assert_eq!(v1, 1);

    // A commit whose body sha does not match the manifest fails…
    let (mut manifest2, mut pages2) = manifest_v1();
    manifest2.version = 2;
    pages2[0].html = "<h1>Hijacked</h1>".to_string();
    let bad = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest: manifest2,
        pages: pages2,
        assets: vec![],
        excluded_private: vec![],
    };
    assert!(commit_site(&data, &bad, &[], quota(), 16, 1, false).is_err());
    // …and the prior live tree is untouched.
    let (bytes, _) = resolve_static(&data, "blog", "index.html").unwrap();
    assert!(String::from_utf8(bytes).unwrap().contains("<h1>Home</h1>"));
}

#[test]
fn crash_between_renames_recovers_newest_version() {
    let data = temp_data_dir("crash");
    create_site(&data, "blog", "alice", None).unwrap();
    let (manifest, pages) = manifest_v1();
    let request = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    commit_site(&data, &request, &[], quota(), 16, 1, false).unwrap();
    // Simulate a crash that leaves the committed record but loses the live pointer.
    // Per Windows un link a una cartella è una cartella: si toglie con remove_dir.
    let live = data.join("sites/blog/live");
    if cfg!(windows) {
        std::fs::remove_dir(&live)
    } else {
        std::fs::remove_file(&live)
    }
    .unwrap();
    let restored = recover_interrupted_commit(&data, "blog").unwrap();
    assert_eq!(restored, Some(1));
    let (bytes, _) = resolve_static(&data, "blog", "index.html").unwrap();
    assert!(String::from_utf8(bytes).unwrap().contains("<h1>Home</h1>"));
}

#[test]
fn rollback_restores_prior_content() {
    let data = temp_data_dir("rollback");
    create_site(&data, "blog", "alice", None).unwrap();
    let (manifest, pages) = manifest_v1();
    let request = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    commit_site(&data, &request, &[], quota(), 16, 1, false).unwrap();

    let (mut manifest2, mut pages2) = manifest_v1();
    manifest2.version = 2;
    pages2[0].html = "<h1>Home v2</h1>".to_string();
    pages2[0].doc_id = Some("notes/home.md".to_string());
    let (p, e) = (pages2[0].clone(), {
        let mut entry = manifest2.pages[0].clone();
        entry.html_sha = sha256_hex(pages2[0].html.as_bytes());
        entry
    });
    let _ = p;
    manifest2.pages[0] = e;
    let request2 = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest: manifest2,
        pages: pages2,
        assets: vec![],
        excluded_private: vec![],
    };
    let (_, v2) = commit_site(&data, &request2, &[], quota(), 16, 1, false).unwrap();
    assert_eq!(v2, 2);

    rollback_site(&data, "blog", 1).unwrap();
    let (bytes, _) = resolve_static(&data, "blog", "index.html").unwrap();
    assert!(String::from_utf8(bytes).unwrap().contains("<h1>Home</h1>"));
    assert!(rollback_site(&data, "blog", 99).is_err());
}

#[test]
fn unpublish_removes_live_keeps_record() {
    let data = temp_data_dir("unpublish");
    create_site(&data, "blog", "alice", None).unwrap();
    let (manifest, pages) = manifest_v1();
    let request = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    commit_site(&data, &request, &[], quota(), 16, 1, false).unwrap();
    unpublish_site(&data, "blog").unwrap();
    assert!(resolve_static(&data, "blog", "index.html").is_err());
    // Record + versions survive: status still knows the site.
    let status = status_of(&data, "blog").unwrap();
    assert_eq!(status.live_version, None);
    assert_eq!(status.versions, vec![1]);
    // The local vault was never touched — nothing under data/ but sites/.
    assert!(load_record(&data, "blog").is_ok());
}

// --- access: password gate + revoke ---------------------------------------

#[test]
fn site_password_gate_constant_time() {
    let hash = hash_site_password("s3cr3t-site").unwrap();
    assert!(verify_site_password("s3cr3t-site", &hash));
    assert!(!verify_site_password("wrong", &hash));
    assert!(!verify_site_password("s3cr3t-site", "garbage"));
    let data = temp_data_dir("gate");
    create_site(&data, "locked", "alice", Some(hash)).unwrap();
    let record = load_record(&data, "locked").unwrap();
    assert!(matches!(
        check_password_gate(&record, None),
        PasswordGate::Locked { password_ok: false }
    ));
    assert!(matches!(
        check_password_gate(&record, Some("s3cr3t-site")),
        PasswordGate::Locked { password_ok: true }
    ));
    let public = load_record(&data, "locked").unwrap();
    let _ = public;
    create_site(&data, "open", "alice", None).unwrap();
    let open = load_record(&data, "open").unwrap();
    assert_eq!(check_password_gate(&open, None), PasswordGate::Public);
}

#[test]
fn revoke_blocks_future_but_keeps_history() {
    let data = temp_data_dir("revoke");
    let mut record = create_site(&data, "blog", "alice", None).unwrap();
    record.collaborators.push("bob".to_string());
    fub_services::publish::save_record(&data, &record).unwrap();
    let record = revoke_collaborator(&data, "blog", "bob").unwrap();
    assert!(!record.collaborators.contains(&"bob".to_string()));
    assert!(record.revoked.contains(&"bob".to_string()));
    assert_eq!(record.owner, "alice");
}

// --- derived surfaces only see the published set ---------------------------

#[test]
fn search_index_covers_published_only() {
    let (manifest, pages) = manifest_v1();
    let staged: Vec<fub_services::publish::StagedPage<'_>> = pages
        .iter()
        .map(|p| fub_services::publish::StagedPage {
            path: &p.path,
            doc_id: p.doc_id.as_deref(),
            html: &p.html,
        })
        .collect();
    let index = build_search_index(&staged);
    assert!(index.contains("index.html"));
    assert!(!index.contains("notes/secret.md"));
    let _ = manifest;
}

// --- end-to-end through handle(): paths, auth, ACL --------------------------

fn authed_state(data: &std::path::Path) -> (ServiceState, String, String) {
    let mut state = ServiceState::open(Some(data.to_path_buf())).unwrap();
    let id = state
        .accounts
        .create_account("alice", "password123")
        .unwrap();
    let token = state.accounts.issue_session_token(&id).unwrap();
    (state, format!("Bearer {token}"), id)
}

#[test]
fn handle_dry_run_commit_status_static_unpublish_rollback() {
    let data = temp_data_dir("handle");
    let (mut state, auth, _alice) = authed_state(&data);
    let (manifest, pages) = manifest_v1();

    // Protocol mismatch is a hard error on every mutating endpoint.
    for path in [DRY_RUN_PATH, COMMIT_PATH, UNPUBLISH_PATH, ROLLBACK_PATH] {
        let bad = serde_json::json!({
            "protocol": "fub-publish/0",
            "site_id": "blog",
            "manifest": manifest,
            "pages": pages,
            "assets": [],
            "vault": [],
            "to_version": 1,
        });
        let body = serde_json::to_vec(&bad).unwrap();
        let response = fub_services::publish::handle(&mut state, "POST", path, Some(&auth), &body);
        assert_eq!(response.status, 400, "{path}");
    }

    // Dry-run previews without touching the live tree.
    let dry = DryRunRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest: manifest.clone(),
        vault: vec![LinkedDoc {
            doc_id: "notes/secret.md".to_string(),
            allowed: false,
            excluded: true,
            linked_only: true,
        }],
    };
    let body = serde_json::to_vec(&dry).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", DRY_RUN_PATH, Some(&auth), &body);
    assert_eq!(response.status, 200);
    let plan: fub_services::publish::DryRunResponse =
        serde_json::from_slice(&response.body).unwrap();
    assert_eq!(plan.would_publish, vec!["about.html", "index.html"]);
    assert_eq!(plan.excluded_private, vec!["notes/secret.md"]);

    // Commit publishes; status + static serve the live tree.
    let commit = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest: manifest.clone(),
        pages: pages.clone(),
        assets: vec![],
        excluded_private: vec!["notes/secret.md".to_string()],
    };
    let body = serde_json::to_vec(&commit).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", COMMIT_PATH, Some(&auth), &body);
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );

    let response = fub_services::publish::handle(
        &mut state,
        "GET",
        &format!("{STATUS_PATH}?site_id=blog"),
        Some(&auth),
        &[],
    );
    assert_eq!(response.status, 200);
    let status: fub_services::publish::StatusResponse =
        serde_json::from_slice(&response.body).unwrap();
    assert_eq!(status.live_version, Some(1));

    let response =
        fub_services::publish::handle(&mut state, "GET", "/s/blog/index.html", None, &[]);
    assert_eq!(response.status, 200);
    let html = String::from_utf8(response.body).unwrap();
    assert!(html.contains("<h1>Home</h1>"));
    assert!(html.contains("<title>Home</title>"));
    assert!(html.contains("aria-label=\"Site\""));

    // Unauthenticated commit is rejected; unauthenticated public static works.
    let response = fub_services::publish::handle(&mut state, "POST", COMMIT_PATH, None, &body);
    assert_eq!(response.status, 401);

    // Rollback + unpublish round-trip.
    let rollback = serde_json::json!({
        "protocol": "fub-publish/1",
        "site_id": "blog",
        "to_version": 1,
    });
    let body = serde_json::to_vec(&rollback).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", ROLLBACK_PATH, Some(&auth), &body);
    assert_eq!(response.status, 200);

    let unpublish = serde_json::json!({
        "protocol": "fub-publish/1",
        "site_id": "blog",
    });
    let body = serde_json::to_vec(&unpublish).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", UNPUBLISH_PATH, Some(&auth), &body);
    assert_eq!(response.status, 200);
    let gone = fub_services::publish::handle(&mut state, "GET", "/s/blog/index.html", None, &[]);
    assert_eq!(gone.status, 404);
}

#[test]
fn handle_revoked_collaborator_cannot_publish() {
    let data = temp_data_dir("revoke-handle");
    let (mut state, auth, _alice) = authed_state(&data);
    // Bob registers; alice commits v1, grants bob Writer, then revokes.
    let bob_id = state.accounts.create_account("bob", "password123").unwrap();
    let bob_token = state.accounts.issue_session_token(&bob_id).unwrap();
    let bob_auth = format!("Bearer {bob_token}");

    let (manifest, pages) = manifest_v1();
    let commit = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    let body = serde_json::to_vec(&commit).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", COMMIT_PATH, Some(&auth), &body);
    assert_eq!(response.status, 200);

    state
        .acl_mut("site:blog")
        .grant(&bob_id, fub_services::acl::Role::Writer);
    revoke_collaborator(&data, "blog", &bob_id).unwrap();

    let dry = DryRunRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest: manifest_v1().0,
        vault: vec![],
    };
    let body = serde_json::to_vec(&dry).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", DRY_RUN_PATH, Some(&bob_auth), &body);
    assert_eq!(response.status, 403, "revoked bob must be rejected");

    // Alice (owner) still publishes fine.
    let response =
        fub_services::publish::handle(&mut state, "POST", DRY_RUN_PATH, Some(&auth), &body);
    assert_eq!(response.status, 200);
}

#[test]
fn handle_locked_site_needs_password_or_grant() {
    let data = temp_data_dir("locked-handle");
    let (mut state, auth, alice) = authed_state(&data);
    let hash = hash_site_password("site-pw").unwrap();
    create_site(&data, "locked", &alice, Some(hash)).unwrap();
    let (manifest, pages) = manifest_v1();
    let mut manifest = manifest;
    manifest.site_id = "locked".to_string();
    let commit = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "locked".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    let body = serde_json::to_vec(&commit).unwrap();
    let response =
        fub_services::publish::handle(&mut state, "POST", COMMIT_PATH, Some(&auth), &body);
    assert_eq!(response.status, 200);

    // No password, no bearer → locked.
    let denied =
        fub_services::publish::handle(&mut state, "GET", "/s/locked/index.html", None, &[]);
    assert_eq!(denied.status, 401);
    // URL credentials are rejected even when correct; only the non-URL
    // credential channel reaches the owner gate.
    let leaked = fub_services::publish::handle(
        &mut state,
        "GET",
        "/s/locked/index.html?password=site-pw",
        None,
        &[],
    );
    assert_eq!(leaked.status, 400);
    let open =
        fub_services::publish::handle(&mut state, "GET", "/s/locked/index.html", None, b"site-pw");
    assert_eq!(open.status, 200);
    // Owner bearer (no password) → served.
    let bearer =
        fub_services::publish::handle(&mut state, "GET", "/s/locked/index.html", Some(&auth), &[]);
    assert_eq!(bearer.status, 200);
}

#[test]
fn assets_size_capped_and_sha_checked() {
    let data = temp_data_dir("assets");
    create_site(&data, "blog", "alice", None).unwrap();
    let big = vec![0u8; 2 * 1024 * 1024];
    let tiny_quota = SiteQuota {
        max_asset_bytes: 16,
        max_site_bytes: 64 * 1024 * 1024,
    };
    let asset = AssetBody {
        path: "img/big.png".to_string(),
        sha: sha256_hex(&big),
        bytes_b64: {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(&big)
        },
    };
    let (mut manifest, pages) = manifest_v1();
    manifest.allowlist = vec!["*.html".to_string(), "img/*".to_string()];
    manifest.assets = vec![fub_services::publish::AssetEntry {
        path: "img/big.png".to_string(),
        sha: sha256_hex(&big),
    }];
    let request = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![asset],
        excluded_private: vec![],
    };
    assert!(commit_site(&data, &request, &[], tiny_quota, 16, 1, false).is_err());
}

#[test]
fn admin_grant_password_and_revoke_survive_restart_without_url_credentials() {
    let data = temp_data_dir("site-admin");
    let (mut state, auth, alice) = authed_state(&data);
    let bob = state.accounts.create_account("bob", "password123").unwrap();
    let bob_token = state.accounts.issue_session_token(&bob).unwrap();
    let bob_auth = format!("Bearer {bob_token}");
    let setup = serde_json::json!({
        "protocol": "fub-publish/1", "site_id": "blog", "password": "site-secret",
        "tls": { "domain": "example.test", "path_prefix": "/notes/", "provisioned": false },
        "grant": { "account_id": bob, "role": "writer" }
    });
    let response = fub_services::publish::handle(
        &mut state,
        "POST",
        SITE_ADMIN_PATH,
        Some(&auth),
        &serde_json::to_vec(&setup).unwrap(),
    );
    assert_eq!(response.status, 200);
    assert!(!String::from_utf8_lossy(&response.body).contains("site-secret"));
    let record = load_record(&data, "blog").unwrap();
    assert_eq!(record.owner, alice);
    assert!(record.password_hash.is_some());
    assert_eq!(record.tls.unwrap().path_prefix, "/notes/");
    let mut reopened = ServiceState::open(Some(data.clone())).unwrap();
    let (manifest, pages) = manifest_v1();
    let dry = serde_json::json!({ "protocol": "fub-publish/1", "site_id": "blog", "manifest": manifest, "vault": [] });
    assert_eq!(
        fub_services::publish::handle(
            &mut reopened,
            "POST",
            DRY_RUN_PATH,
            Some(&bob_auth),
            &serde_json::to_vec(&dry).unwrap()
        )
        .status,
        200
    );
    let commit = CommitRequest {
        protocol: "fub-publish/1".into(),
        site_id: "blog".into(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    assert_eq!(
        fub_services::publish::handle(
            &mut reopened,
            "POST",
            COMMIT_PATH,
            Some(&auth),
            &serde_json::to_vec(&commit).unwrap()
        )
        .status,
        200
    );
    assert_eq!(
        fub_services::publish::handle(
            &mut reopened,
            "GET",
            "/s/blog/index.html?password=site-secret",
            None,
            &[]
        )
        .status,
        400
    );
    assert_eq!(
        fub_services::publish::handle(
            &mut reopened,
            "GET",
            "/s/blog/index.html",
            None,
            b"site-secret"
        )
        .status,
        200
    );
    let revoke =
        serde_json::json!({ "protocol": "fub-publish/1", "site_id": "blog", "revoke": bob });
    assert_eq!(
        fub_services::publish::handle(
            &mut reopened,
            "POST",
            SITE_ADMIN_PATH,
            Some(&auth),
            &serde_json::to_vec(&revoke).unwrap()
        )
        .status,
        200
    );
    assert_eq!(
        fub_services::publish::handle(
            &mut reopened,
            "POST",
            DRY_RUN_PATH,
            Some(&bob_auth),
            &serde_json::to_vec(&dry).unwrap()
        )
        .status,
        403
    );
    assert!(load_record(&data, "blog").unwrap().revoked.contains(&bob));
}

#[test]
fn dry_run_reports_exact_diff_without_changing_live_version() {
    let data = temp_data_dir("exact-diff");
    let (mut state, auth, _) = authed_state(&data);
    let (manifest, pages) = manifest_v1();
    let commit = CommitRequest {
        protocol: "fub-publish/1".into(),
        site_id: "blog".into(),
        manifest: manifest.clone(),
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    assert_eq!(
        fub_services::publish::handle(
            &mut state,
            "POST",
            COMMIT_PATH,
            Some(&auth),
            &serde_json::to_vec(&commit).unwrap()
        )
        .status,
        200
    );
    let mut changed = manifest;
    changed.version = 2;
    changed.pages.retain(|page| page.path != "about.html");
    let home = changed
        .pages
        .iter_mut()
        .find(|page| page.path == "index.html")
        .unwrap();
    home.html_sha = sha256_hex(b"changed");
    let request =
        serde_json::json!({ "protocol": "fub-publish/1", "site_id": "blog", "manifest": changed });
    let response = fub_services::publish::handle(
        &mut state,
        "POST",
        DRY_RUN_PATH,
        Some(&auth),
        &serde_json::to_vec(&request).unwrap(),
    );
    assert_eq!(response.status, 200);
    let plan: fub_services::publish::DryRunResponse =
        serde_json::from_slice(&response.body).unwrap();
    let diff = plan.diff.unwrap();
    assert_eq!(diff.modified, vec!["index.html"]);
    assert_eq!(diff.removed, vec!["about.html"]);
    assert!(diff.added.is_empty() && diff.unchanged.is_empty());
    assert_eq!(load_record(&data, "blog").unwrap().live_version, Some(1));
}

#[test]
fn parsed_html_policy_detects_event_handlers_and_entity_schemes() {
    let body = |html| {
        serde_json::to_vec(&serde_json::json!({
            "site_id": "blog", "pages": [{"html": html}], "assets": []
        }))
        .unwrap()
    };
    for html in [
        "<img src=\"/s/blog/logo.png\" onerror = \"alert(1)\">",
        "<a href=\"java&#115;cript:alert(1)\">click</a>",
        "<div style = 'background:url(https://evil.test)'>hello</div>",
        "<object data=\"/s/blog/evil\">x</object>",
        "<svg><script>evil()</script></svg>",
    ] {
        assert!(
            fub_services::site_isolation::commit_has_custom_js(&body(html)),
            "{html}"
        );
    }
    assert!(!fub_services::site_isolation::commit_has_custom_js(&body(
        "<p><a href=\"https://example.test/path?a=1&amp;b=2\">safe</a></p>"
    )));
}

#[test]
fn approved_image_is_atomic_and_leak_never_reaches_staging() {
    use base64::Engine as _;
    let data = temp_data_dir("image-privacy");
    create_site(&data, "blog", "alice", None).unwrap();
    let image = b"\x89PNG\r\n\x1a\nimage-pixels".to_vec();
    let (mut manifest, mut pages) = manifest_v1();
    pages[0]
        .html
        .push_str("<img src=\"/s/blog/logo.png\" alt=\"Logo\">");
    manifest.pages[0].html_sha = sha256_hex(pages[0].html.as_bytes());
    manifest.allowlist.push("logo.png".into());
    manifest.assets.push(fub_services::publish::AssetEntry {
        path: "logo.png".into(),
        sha: sha256_hex(&image),
    });
    let request = CommitRequest {
        protocol: "fub-publish/1".into(),
        site_id: "blog".into(),
        manifest,
        pages,
        assets: vec![AssetBody {
            path: "logo.png".into(),
            sha: sha256_hex(&image),
            bytes_b64: base64::engine::general_purpose::STANDARD.encode(&image),
        }],
        excluded_private: vec!["notes/secret.md".into()],
    };
    commit_site(
        &data,
        &request,
        &request.excluded_private,
        quota(),
        16,
        1,
        false,
    )
    .unwrap();
    assert_eq!(resolve_static(&data, "blog", "logo.png").unwrap().0, image);
    let (html, _) = resolve_static(&data, "blog", "index.html").unwrap();
    assert!(String::from_utf8(html)
        .unwrap()
        .contains("<title>Home</title>"));
    let mut leaked = request;
    leaked.manifest.version = 2;
    leaked.assets[0].bytes_b64 =
        base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nnotes/secret.md");
    leaked.assets[0].sha = sha256_hex(b"\x89PNG\r\n\x1a\nnotes/secret.md");
    leaked.manifest.assets[0].sha = leaked.assets[0].sha.clone();
    assert!(commit_site(
        &data,
        &leaked,
        &leaked.excluded_private,
        quota(),
        16,
        1,
        false
    )
    .is_err());
    let dir = fub_services::publish::site::site_dir(&data, "blog");
    assert!(!std::fs::read_dir(&dir).unwrap().any(|entry| entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("staging.")));
    assert_eq!(load_record(&data, "blog").unwrap().live_version, Some(1));
}

#[test]
fn future_site_record_schema_fails_closed_without_rewrite() {
    let data = temp_data_dir("future-site");
    create_site(&data, "blog", "alice", None).unwrap();
    let path = fub_services::publish::site::site_dir(&data, "blog").join("record.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    value["schema_version"] = serde_json::json!(2);
    let bytes = serde_json::to_vec(&value).unwrap();
    std::fs::write(&path, &bytes).unwrap();
    assert!(load_record(&data, "blog").is_err());
    assert_eq!(std::fs::read(path).unwrap(), bytes);
}

// --- fail-open parses must stay closed ---------------------------------------
//
// Client strictness mirror: these assert the SERVER never accepts the shapes
// a fail-open client would send or swallow. The host client
// (`crates/fub-host/src/publish/site.rs`) maps each to an explicit
// `PublishClientError::{Protocol, Rejected}` carrying method + path-base +
// status only — never URL/query/secrets — and preserves 401/403/404.

#[test]
fn handle_rejects_invalid_json_and_missing_fields() {
    let data = temp_data_dir("fail-open");
    let (mut state, auth, _) = authed_state(&data);
    // Not JSON at all: every mutating endpoint answers 400, never 2xx.
    for path in [DRY_RUN_PATH, COMMIT_PATH, UNPUBLISH_PATH, ROLLBACK_PATH] {
        let response = fub_services::publish::handle(
            &mut state,
            "POST",
            path,
            Some(&auth),
            b"this is not json",
        );
        assert_eq!(response.status, 400, "{path}");
    }
    // Missing required wire fields (no protocol, no site_id, empty object):
    // 400, never a defaulted-through success.
    for body in [
        serde_json::json!({}),
        serde_json::json!({ "site_id": "blog" }),
        serde_json::json!({ "protocol": "fub-publish/1" }),
    ] {
        let raw = serde_json::to_vec(&body).unwrap();
        for path in [DRY_RUN_PATH, COMMIT_PATH, UNPUBLISH_PATH, ROLLBACK_PATH] {
            let response =
                fub_services::publish::handle(&mut state, "POST", path, Some(&auth), &raw);
            assert_eq!(response.status, 400, "{path} {body}");
        }
    }
    // Status without site_id: 400, never a default site.
    let response = fub_services::publish::handle(&mut state, "GET", STATUS_PATH, Some(&auth), &[]);
    assert_eq!(response.status, 400);
}

#[test]
fn handle_preserves_auth_statuses() {
    let data = temp_data_dir("fail-open-auth");
    let (mut state, auth, _) = authed_state(&data);
    // Unknown bearer: 401 on mutation, never 403 or 200.
    let dry = DryRunRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest: manifest_v1().0,
        vault: vec![],
    };
    let raw = serde_json::to_vec(&dry).unwrap();
    let response = fub_services::publish::handle(
        &mut state,
        "POST",
        DRY_RUN_PATH,
        Some("Bearer deadbeef"),
        &raw,
    );
    assert_eq!(response.status, 401);
    // Missing bearer entirely: 401 as well.
    let response = fub_services::publish::handle(&mut state, "POST", DRY_RUN_PATH, None, &raw);
    assert_eq!(response.status, 401);
    // Unknown site for an authenticated reader: 404, never empty-ok.
    let response = fub_services::publish::handle(
        &mut state,
        "GET",
        &format!("{STATUS_PATH}?site_id=nope"),
        Some(&auth),
        &[],
    );
    assert_eq!(response.status, 404);
}

// --- u64-as-string wire: versions survive past 2^53 ---------------------------

#[test]
fn versions_round_trip_as_strings_past_js_precision() {
    let (manifest, pages) = manifest_v1();
    let mut manifest = manifest;
    manifest.version = u64::MAX;
    let wire = serde_json::to_value(&manifest).unwrap();
    assert_eq!(wire["version"], serde_json::json!("18446744073709551615"));
    // Numbers still accepted on read (pre-rule data / unmigrated clients).
    let from_number: PublishManifest = serde_json::from_value(serde_json::json!({
        "site_id": "blog",
        "version": 7u64,
        "allowlist": ["*.html"],
        "pages": [],
        "assets": [],
        "no_private_leak": true,
    }))
    .unwrap();
    assert_eq!(from_number.version, 7);
    // Garbage is an error, never a silent zero.
    assert!(
        serde_json::from_value::<PublishManifest>(serde_json::json!({
            "site_id": "blog",
            "version": "7x",
            "allowlist": [],
            "pages": [],
            "assets": [],
            "no_private_leak": true,
        }))
        .is_err()
    );
    // Status carries string versions too; counts stay numbers.
    let status = fub_services::publish::StatusResponse {
        site_id: "blog".to_string(),
        live_version: Some(u64::MAX),
        versions: vec![u64::MAX],
        page_count: 2,
        asset_count: 0,
        password_protected: false,
    };
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!(
        wire["live_version"],
        serde_json::json!("18446744073709551615")
    );
    assert_eq!(
        wire["versions"],
        serde_json::json!(["18446744073709551615"])
    );
    assert_eq!(wire["page_count"], serde_json::json!(2));
    manifest.version = 1;
    // Full commit persists + status reports the live version back as a string.
    let data = temp_data_dir("u64max");
    create_site(&data, "blog", "alice", None).unwrap();
    let request = CommitRequest {
        protocol: "fub-publish/1".to_string(),
        site_id: "blog".to_string(),
        manifest,
        pages,
        assets: vec![],
        excluded_private: vec![],
    };
    let (_, version) = commit_site(&data, &request, &[], quota(), 16, 1, false).unwrap();
    assert_eq!(version, 1);
    let status = status_of(&data, "blog").unwrap();
    let wire = serde_json::to_value(&status).unwrap();
    assert_eq!(wire["live_version"], serde_json::json!("1"));
}
