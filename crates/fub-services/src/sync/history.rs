//! Le versioni di un documento, il cestino e il ripristino.

use super::*;

/// Version chain per doc for the UI (`syncVersionRow` serde names exactly:
/// `doc_id, version, hash, ts_ms, vv_text`).
pub(super) fn admit_versions(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    let vault_id = query_get(query, "vault_id").unwrap_or("");
    if vault_id.is_empty() {
        return Err(HttpResponse::err(400, "missing vault_id"));
    }
    let resource = vault_resource(vault_id);
    check_role(state, &resource, &account, Role::Reader)?;
    let Some(doc_id) = query_get(query, "doc_id").filter(|id| !id.is_empty()) else {
        return Err(HttpResponse::err(400, "missing doc_id"));
    };
    let Some(doc_id) = decode_query_value(doc_id) else {
        return Err(HttpResponse::err(400, "bad encoded doc_id"));
    };
    if doc_id.is_empty() {
        return Err(HttpResponse::err(400, "missing doc_id"));
    }
    Ok(VaultWork {
        scope: scope_of(state, account, vault_id)?,
        vault_id: vault_id.to_string(),
        job: VaultJob::Versions { doc_id },
    })
}

pub(super) fn run_versions(scope: &VaultScope, doc_id: String) -> HttpResponse {
    let folded = match load_folded(&scope.dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    let versions: Vec<serde_json::Value> = folded
        .versions
        .get(&doc_id)
        .map(|chain| {
            chain
                .iter()
                .map(|v| {
                    serde_json::json!({
                        "doc_id": v.doc_id,
                        "op_id": v.op_id,
                        "version": v.version.to_string(),
                        "hash": v.hash,
                        "ts_ms": v.ts_ms,
                        "vv_text": v.vv_text,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    HttpResponse::json(
        200,
        &serde_json::json!({
            "doc_id": doc_id,
            "versions": versions,
            "in_trash": folded.trash.contains_key(&doc_id),
        }),
    )
}

pub(super) fn admit_trash(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct TrashReq {
        doc_id: String,
        vault_id: String,
    }
    let req: TrashReq =
        serde_json::from_slice(body).map_err(|_| HttpResponse::err(400, "bad trash body"))?;
    if req.vault_id.trim().is_empty() {
        return Err(HttpResponse::err(400, "missing vault_id"));
    }
    let resource = vault_resource(&req.vault_id);
    authorize(state, &resource, &account, Role::Writer)?;
    Ok(VaultWork {
        scope: scope_of(state, account, &req.vault_id)?,
        vault_id: req.vault_id,
        job: VaultJob::Trash { doc_id: req.doc_id },
    })
}

pub(super) fn run_trash(scope: &VaultScope, doc_id: String) -> HttpResponse {
    let dir = &scope.dir;
    let mut folded = match load_folded(dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    if folded
        .versions
        .get(&doc_id)
        .is_none_or(|chain| chain.is_empty())
    {
        return HttpResponse::err(409, "trash requires a version chain");
    }
    let now = schema::now_ms();
    // Trash without content: snapshot the current server vector so a later
    // restore is still a new write, never an old vector replayed.
    let mut vv = folded.server_vv.clone();
    vv_inc(&mut vv, "server");
    move_to_trash(&mut folded, &doc_id, vv, &scope.account, now);
    if let Err(e) = versions::save(dir, &folded) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(200, &serde_json::json!({ "trashed": doc_id }))
}

pub(super) fn admit_restore(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> Result<VaultWork, HttpResponse> {
    let account = account_of(state, auth)?;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RestoreReq {
        doc_id: String,
        vault_id: String,
        #[serde(default)]
        version: Option<String>,
    }
    let req: RestoreReq =
        serde_json::from_slice(body).map_err(|_| HttpResponse::err(400, "bad restore body"))?;
    if req.vault_id.trim().is_empty() {
        return Err(HttpResponse::err(400, "missing vault_id"));
    }
    let version = match req.version.as_deref() {
        Some(raw) => match raw.parse::<u64>() {
            Ok(version) if version > 0 && raw == version.to_string() => Some(version),
            _ => return Err(HttpResponse::err(400, "bad restore version")),
        },
        None => None,
    };
    let resource = vault_resource(&req.vault_id);
    authorize(state, &resource, &account, Role::Writer)?;
    Ok(VaultWork {
        scope: scope_of(state, account, &req.vault_id)?,
        vault_id: req.vault_id,
        job: VaultJob::Restore {
            doc_id: req.doc_id,
            version,
        },
    })
}

pub(super) fn run_restore(
    scope: &VaultScope,
    doc_id: String,
    requested_version: Option<u64>,
) -> HttpResponse {
    let dir = &scope.dir;
    let mut folded = match load_folded(dir) {
        Ok(folded) => folded,
        Err(response) => return response,
    };
    if folded
        .versions
        .get(&doc_id)
        .is_none_or(|chain| chain.is_empty())
    {
        return HttpResponse::err(409, "restore requires a version chain");
    }
    if let Some(version) = requested_version {
        let Some(source) = folded.versions.get(&doc_id).and_then(|chain| {
            chain
                .iter()
                .find(|entry| entry.version == version && !entry.deleted)
        }) else {
            return HttpResponse::err(404, "restore source version expired");
        };
        let op = match op_from_version(source) {
            Ok(op) => op,
            Err(e) => return HttpResponse::err(500, &e),
        };
        // No server mutation: the caller decrypts and CAS-writes locally,
        // then publishes a fresh encrypted op with a new vector.
        return HttpResponse::json(
            200,
            &serde_json::json!({
                "restored": doc_id, "version": version.to_string(),
                "source_op": op, "requires_fresh_push": true,
            }),
        );
    }
    let Some(trash) = folded.trash.get(&doc_id) else {
        return HttpResponse::err(404, "not in trash");
    };
    let Some(source) = trash.last_version.and_then(|version| {
        folded
            .versions
            .get(&doc_id)?
            .iter()
            .find(|v| v.version == version && !v.deleted)
    }) else {
        return HttpResponse::err(409, "restore source version expired; trash left intact");
    };
    let source_op_id = source.op_id.clone();
    match restore_from_trash(&mut folded, &doc_id) {
        Err(e) => HttpResponse::err(404, &e),
        Ok(version) => {
            // A replica is not a backup: restore only drops the trash marker.
            // The client must push a FRESH op with a bumped counter carrying
            // the restored bytes; the old vector is never replayed.
            if let Err(e) = versions::save(dir, &folded) {
                return HttpResponse::err(500, &e);
            }
            HttpResponse::json(
                200,
                &serde_json::json!({
                    "restored": doc_id,
                    "last_version": version.map(|n| n.to_string()),
                    "source_op_id": source_op_id,
                    "requires_fresh_push": true,
                }),
            )
        }
    }
}
