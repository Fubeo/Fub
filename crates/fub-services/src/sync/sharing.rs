//! Inviti, accettazione, revoca e chiave del vault.

use super::*;

pub(super) fn handle_invite(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct InviteReq {
        #[serde(default)]
        vault_id: Option<String>,
        #[serde(default)]
        resource: Option<String>,
        role: Role,
        #[serde(default)]
        ttl_ms: Option<u64>,
        #[serde(default)]
        code: Option<String>,
        #[serde(default)]
        wrapped_vdk: Option<crate::crypto::WrappedVdk>,
        /// Binds the invite to one account: nobody else can accept it.
        #[serde(default)]
        invitee: Option<String>,
    }
    let req: InviteReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad invite body"),
    };
    if let Role::Owner = req.role {
        // Ownership transfers out-of-band, never by self-serve invite.
        return HttpResponse::err(403, "cannot invite owner");
    }
    let resource = req
        .resource
        .unwrap_or_else(|| vault_resource(req.vault_id.as_deref().unwrap_or("default")));
    if let Err(r) = authorize(state, &resource, &account, Role::Admin) {
        return r;
    }
    if let Err(r) = step_up_mfa(state, &account, req.code.as_deref()) {
        return r;
    }
    // Validate an attached wrapped-VDK envelope structurally (opaque to the
    // server: current KDF version, well-formed base64, 12 B nonce). The
    // envelope is produced client-side with `crypto::wrap_vdk` from the
    // explicit vault passphrase — never the account password.
    if let Some(w) = &req.wrapped_vdk {
        if w.kdf.ver != crate::crypto::KDF_VERSION {
            return HttpResponse::err(400, "stale wrap version");
        }
        if crate::crypto::unwrap_vdk_shape_ok(w).is_err() {
            return HttpResponse::err(400, "bad wrapped vdk");
        }
    }
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    merge_grants(state, &shares);
    let vault = resource.strip_prefix("vault:").unwrap_or("");
    let key_epoch = shares.key_epochs.get(vault).copied().unwrap_or(0);
    let ttl = req.ttl_ms.unwrap_or(7 * 24 * 3600 * 1000);
    if ttl == 0 || ttl > MAX_INVITE_TTL_MS {
        return HttpResponse::err(400, "invite ttl out of range");
    }
    // `shares.json` si legge a ogni richiesta: gli inviti usati o scaduti
    // escono, quelli pendenti hanno un tetto per risorsa.
    let now = schema::now_ms();
    shares
        .invites
        .retain(|stored| !stored.invite.accepted && stored.invite.expires_ms >= now);
    let pending = shares
        .invites
        .iter()
        .filter(|stored| stored.invite.resource == resource)
        .count();
    if pending >= MAX_PENDING_INVITES {
        return HttpResponse::err(429, "too many pending invites");
    }
    let (mut invite, token) = match acl::new_invite(&resource, req.role, ttl) {
        Ok(i) => i,
        Err(e) => return HttpResponse::err(500, &e),
    };
    invite.invitee = req.invitee;
    let reply = serde_json::json!({
        "token_b64": token,
        "resource": invite.resource,
        "role": invite.role,
        "expires_ms": invite.expires_ms,
    });
    shares.invites.push(StoredInvite {
        invite,
        wrapped_vdk: req.wrapped_vdk,
        key_epoch,
    });
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(201, &reply)
}

pub(super) fn handle_invite_accept(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct AcceptReq {
        token_b64: String,
    }
    let req: AcceptReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad accept body"),
    };
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    merge_grants(state, &shares);
    let pos = shares
        .invites
        .iter()
        .position(|s| s.invite.matches(&req.token_b64) && !s.invite.accepted);
    let pos = match pos {
        Some(p) => p,
        None => return HttpResponse::err(404, "invite not found"),
    };
    let wrapped = shares.invites[pos].wrapped_vdk.clone();
    let resource = shares.invites[pos].invite.resource.clone();
    let vault = resource.strip_prefix("vault:").unwrap_or("");
    if shares.invites[pos].key_epoch != shares.key_epochs.get(vault).copied().unwrap_or(0) {
        return HttpResponse::err(410, "invite key epoch expired; request a new invite");
    }
    // STR-03: the grant is staged on a copy of the ACL, made durable, and
    // only then published to the live map. A failed save answers 500 and
    // leaves the invitee exactly as unauthorized as before.
    let mut staged = state
        .acls
        .get(&resource)
        .cloned()
        .unwrap_or_else(|| ShareAcl::new(&resource));
    if let Err(e) = acl::accept_invite(&mut shares.invites[pos].invite, &mut staged, &account) {
        return HttpResponse::err(410, &e);
    }
    for (res, live) in &state.acls {
        shares.grants.insert(res.clone(), live.clone());
    }
    shares.grants.insert(resource.clone(), staged.clone());
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    state.acls.insert(resource.clone(), staged);
    HttpResponse::json(
        200,
        &serde_json::json!({
            "resource": shares.invites[pos].invite.resource,
            "role": shares.invites[pos].invite.role,
            // The invitee's wrapped VDK envelope when the inviter attached
            // one; the client unwraps it locally with `crypto::unwrap_vdk`
            // from the out-of-band passphrase. No envelope = the inviter
            // delivers the key by another explicit channel (external).
            "wrapped_vdk": wrapped,
            "key_epoch": shares.invites[pos].key_epoch,
        }),
    )
}

pub(super) fn handle_revoke(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct RevokeReq {
        #[serde(default)]
        vault_id: Option<String>,
        #[serde(default)]
        resource: Option<String>,
        account_id: String,
        #[serde(default)]
        code: Option<String>,
    }
    let req: RevokeReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad revoke body"),
    };
    let resource = req
        .resource
        .unwrap_or_else(|| vault_resource(req.vault_id.as_deref().unwrap_or("default")));
    if let Err(r) = authorize(state, &resource, &account, Role::Admin) {
        return r;
    }
    if let Err(r) = step_up_mfa(state, &account, req.code.as_deref()) {
        return r;
    }
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    merge_grants(state, &shares);
    // Staged like an accept: the live ACL changes only after the save.
    let mut staged = state
        .acls
        .get(&resource)
        .cloned()
        .unwrap_or_else(|| ShareAcl::new(&resource));
    match acl::check_revoke(&staged, &account, &req.account_id) {
        Ok(()) => staged.revoke(&req.account_id),
        Err(acl::RevokeDenied::LastOwner) => {
            return HttpResponse::err(409, "cannot revoke the last owner")
        }
        Err(acl::RevokeDenied::Outranked) => {
            return HttpResponse::err(403, "forbidden: cannot revoke an equal or higher role")
        }
    }
    for (res, live) in &state.acls {
        shares.grants.insert(res.clone(), live.clone());
    }
    shares.grants.insert(resource.clone(), staged.clone());
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    state.acls.insert(resource.clone(), staged);
    // Revocation removes FUTURE access only: copies the revoked account
    // already downloaded survive. There is no remote wipe, by design.
    HttpResponse::json(
        200,
        &serde_json::json!({
            "revoked": req.account_id,
            "resource": resource,
            "note": "already-downloaded copies survive revocation; no remote wipe",
        }),
    )
}

/// Store the owner's wrapped-VDK envelope (opaque). Rotation = store a new
/// envelope produced client-side with `crypto::wrap_vdk`; the old envelope
/// is dropped, but copies already downloaded under it survive (documented,
/// P16.8).
pub(super) fn handle_vault_key_store(
    state: &mut ServiceState,
    auth: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct KeyReq {
        vault_id: String,
        wrapped: crate::crypto::WrappedVdk,
        /// Required only to replace an existing envelope: compare-and-swap
        /// prevents a stale writer from silently rotating another key.
        #[serde(default)]
        expected_wrapped_hash: Option<String>,
        #[serde(default)]
        key_epoch: Option<u32>,
    }
    let req: KeyReq = match serde_json::from_slice(body) {
        Ok(r) => r,
        Err(_) => return HttpResponse::err(400, "bad vault-key body"),
    };
    if req.vault_id.trim().is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(&req.vault_id);
    if let Err(r) = authorize(state, &resource, &account, Role::Owner) {
        return r;
    }
    if req.wrapped.kdf.ver != crate::crypto::KDF_VERSION {
        return HttpResponse::err(400, "stale wrap version");
    }
    if crate::crypto::unwrap_vdk_shape_ok(&req.wrapped).is_err() {
        return HttpResponse::err(400, "bad wrapped vdk");
    }
    let dir = sync_dir_of(state);
    let mut shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    if let Some(existing) = shares.keys.get(&req.vault_id) {
        let existing_bytes = match serde_json::to_vec(existing) {
            Ok(bytes) => bytes,
            Err(e) => return HttpResponse::err(500, &format!("vault key encode: {e}")),
        };
        let new_bytes = match serde_json::to_vec(&req.wrapped) {
            Ok(bytes) => bytes,
            Err(e) => return HttpResponse::err(500, &format!("vault key encode: {e}")),
        };
        if existing_bytes == new_bytes
            && req
                .key_epoch
                .unwrap_or_else(|| shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0))
                == shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0)
        {
            return HttpResponse::json(
                200,
                &serde_json::json!({ "stored": req.vault_id,
                "key_epoch": shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0) }),
            );
        }
        if req.expected_wrapped_hash.as_deref()
            != Some(versions::sha256_b64(&existing_bytes).as_str())
        {
            return HttpResponse::err(
                409,
                "vault key exists; rotation requires current wrapped hash",
            );
        }
    }
    let old_epoch = shares.key_epochs.get(&req.vault_id).copied().unwrap_or(0);
    let requested_epoch = req.key_epoch.unwrap_or_else(|| {
        if shares.keys.contains_key(&req.vault_id) {
            old_epoch
        } else {
            1
        }
    });
    if shares.keys.contains_key(&req.vault_id) {
        if old_epoch.checked_add(1) != Some(requested_epoch) {
            return HttpResponse::err(409, "key rotation requires the next explicit epoch");
        }
    } else if requested_epoch != 0 && requested_epoch != 1 {
        return HttpResponse::err(409, "initial vault key must start at epoch zero");
    }
    shares.keys.insert(req.vault_id.clone(), req.wrapped);
    shares
        .key_epochs
        .insert(req.vault_id.clone(), requested_epoch);
    if let Err(e) = save_shares(&dir, &shares) {
        return HttpResponse::err(500, &e);
    }
    HttpResponse::json(
        200,
        &serde_json::json!({ "stored": req.vault_id,
        "key_epoch": requested_epoch }),
    )
}

pub(super) fn handle_vault_key_get(
    state: &mut ServiceState,
    auth: Option<&str>,
    query: &[(String, String)],
) -> HttpResponse {
    let account = match account_of(state, auth) {
        Ok(id) => id,
        Err(r) => return r,
    };
    let vault_id = query_get(query, "vault_id").unwrap_or("");
    if vault_id.is_empty() {
        return HttpResponse::err(400, "missing vault_id");
    }
    let resource = vault_resource(vault_id);
    if let Err(r) = check_role(state, &resource, &account, Role::Reader) {
        return r;
    }
    let dir = sync_dir_of(state);
    let shares = match load_shares(&dir) {
        Ok(s) => s,
        Err(e) => return HttpResponse::err(500, &e),
    };
    match shares.keys.get(vault_id) {
        None => HttpResponse::err(404, "no vault key"),
        Some(w) => {
            let encoded = match serde_json::to_vec(w) {
                Ok(bytes) => bytes,
                Err(e) => return HttpResponse::err(500, &format!("vault key encode: {e}")),
            };
            HttpResponse::json(
                200,
                &serde_json::json!({
                    "wrapped": w,
                    "wrapped_hash": versions::sha256_b64(&encoded),
                    "key_epoch": shares.key_epochs.get(vault_id).copied().unwrap_or(0),
                }),
            )
        }
    }
}
