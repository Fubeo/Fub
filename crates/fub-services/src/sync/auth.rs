//! Gli aiuti di autenticazione: l'account, il ruolo, la MFA, il protocollo
//! sul filo e l'AAD di un op.

use super::*;

// ---------------------------------------------------------------------------
// Auth helpers (parent `AccountStore`, exact names).
// ---------------------------------------------------------------------------

pub(super) fn account_of(state: &ServiceState, auth: Option<&str>) -> Result<String, HttpResponse> {
    // Exact parent hook: `ServiceState::bearer`, one status mapping for both.
    state.bearer(auth)
}

fn unclaimed_vault(
    state: &ServiceState,
    resource: &str,
    shares: &SyncShares,
) -> Result<bool, HttpResponse> {
    let Some(vault_id) = resource.strip_prefix("vault:") else {
        return Ok(false);
    };
    if shares.keys.contains_key(vault_id) {
        return Ok(false);
    }
    let folded =
        versions::load(&vault_dir_of(state, vault_id)?).map_err(|e| HttpResponse::err(500, &e))?;
    Ok(!folded
        .versions
        .values()
        .flatten()
        .any(|v| v.vault_id == vault_id))
}

pub(super) fn check_role(
    state: &ServiceState,
    resource: &str,
    account_id: &str,
    need: Role,
) -> Result<(), HttpResponse> {
    let shares = load_shares(&sync_dir(&state.data_dir)).map_err(|e| HttpResponse::err(500, &e))?;
    match state
        .acls
        .get(resource)
        .or_else(|| shares.grants.get(resource))
    {
        Some(acl) => acl::check(acl, account_id, need).map_err(|e| HttpResponse::err(403, &e)),
        None if unclaimed_vault(state, resource, &shares)? => Ok(()),
        None => Err(HttpResponse::err(
            403,
            "vault has no recoverable owner grant",
        )),
    }
}

/// Persist the first owner grant before accepting any vault content. A
/// restarted service must never mistake an existing key or version chain for
/// an unclaimed vault and let the next authenticated writer take ownership.
pub(super) fn authorize(
    state: &mut ServiceState,
    resource: &str,
    account: &str,
    need: Role,
) -> Result<(), HttpResponse> {
    let dir = sync_dir(&state.data_dir);
    let mut shares = load_shares(&dir).map_err(|e| HttpResponse::err(500, &e))?;
    merge_grants(state, &shares);
    if !state.acls.contains_key(resource) {
        if !unclaimed_vault(state, resource, &shares)? {
            return Err(HttpResponse::err(
                403,
                "vault has no recoverable owner grant",
            ));
        }
        // Ogni vault rivendicato resta in `shares.json`, letto a ogni
        // richiesta, e ha la propria quota di byte: senza tetto per account
        // uno solo li moltiplicherebbe a piacere.
        let owned = shares
            .grants
            .iter()
            .filter(|(owned, acl)| {
                owned.starts_with("vault:") && acl.role_of(account) == Some(Role::Owner)
            })
            .count();
        if owned >= usize::from(state.config.quotas.max_vaults) {
            return Err(HttpResponse::err(413, "vault quota exceeded"));
        }
        let mut grant = ShareAcl::new(resource);
        grant.grant(account, Role::Owner);
        shares.grants.insert(resource.to_string(), grant.clone());
        save_shares(&dir, &shares).map_err(|e| HttpResponse::err(500, &e))?;
        state.acls.insert(resource.to_string(), grant);
        return Ok(());
    }
    let acl = state.acls.get(resource).expect("just ensured");
    acl::check(acl, account, need).map_err(|e| HttpResponse::err(403, &e))
}

/// Step-up MFA for sensitive ops (invite/revoke): when the caller enrolled
/// TOTP, a fresh `code` is required via the exact parent hook
/// `LoginRateLimit::check_totp` (which wraps `mfa::verify_totp` with window,
/// anti-replay and rate limiting). No TOTP enrolled: the session token
/// suffices (MFA was enforced at login in `main.rs`).
pub(super) fn step_up_mfa(
    state: &mut ServiceState,
    account_id: &str,
    code: Option<&str>,
) -> Result<(), HttpResponse> {
    // Il record TOTP è una copia: `check_totp` lo aggiorna in locale, e il
    // contatore usato torna nell'account (persistito) prima di concedere.
    let Some(mut record) = state.accounts.totp(account_id).active else {
        return Ok(());
    };
    let code = code
        .filter(|c| !c.trim().is_empty())
        .ok_or_else(|| HttpResponse::err(401, "mfa required"))?;
    match state
        .totp_attempts
        .check_totp(&mut record, account_id, code)
    {
        Ok(true) => state
            .accounts
            .update_totp(account_id, |totp| totp.active = Some(record))
            .map_err(|e| HttpResponse::err(500, &e)),
        Ok(false) => Err(HttpResponse::err(401, "bad totp")),
        Err(e) => Err(HttpResponse::err(429, &e)),
    }
}

pub(super) fn check_wire_protocol(peer: &Option<String>) -> Result<(), HttpResponse> {
    if let Some(p) = peer {
        crate::routing::assert_protocol(p, SYNC_PROTOCOL)
            .map_err(|_| HttpResponse::err(400, "protocol mismatch"))?;
    }
    Ok(())
}

/// Canonical envelope check (Main): recompute `canonical_aad_json` from the
/// op FIELDS and compare structurally with the wire `aad` echo when present.
/// The wire `aad` is NEVER trusted: an op whose echo is the old 4-field pipe
/// form, or whose recomputed canonical form the client cannot reproduce, is a
/// hard 400. Missing `vault_id`/empty vv/rename mismatch are hard rejects.
/// The server is opaque to keys so it cannot `aad_verify`-decrypt; the client
/// MUST `aad_verify` before any apply (see `remote::aad_verify`).
pub(super) fn check_op_aad(op: &SyncOp) -> Result<crate::crypto::SyncEnvelope, String> {
    if op.op_id.trim().is_empty()
        || op.replica_id.trim().is_empty()
        || op.doc_id.trim().is_empty()
        || op.vault_id.trim().is_empty()
    {
        return Err("bad op identity".to_string());
    }
    if op.vv.is_empty() {
        return Err("empty version vector".to_string());
    }
    if op.nonce_b64.trim().is_empty() || op.ciphertext_b64.trim().is_empty() {
        return Err("empty envelope".to_string());
    }
    // Ciphertext size bound (decode length, not base64 length).
    if op.ciphertext_b64.len() > (versions::MAX_OP_BYTES * 4) / 3 + 64 {
        return Err("op too large".to_string());
    }
    // Rename routing coherence: kind==rename iff both ends present AND equal
    // to the kind payload; non-rename ops must carry no rename ends.
    match &op.kind {
        OpKind::Rename { from, to } => {
            if from.trim().is_empty() || to.trim().is_empty() {
                return Err("bad rename routing".to_string());
            }
            if op.rename_from.as_deref() != Some(from.as_str())
                || op.rename_to.as_deref() != Some(to.as_str())
            {
                return Err("rename routing mismatch".to_string());
            }
            if op.doc_id != *from {
                return Err("rename doc_id must equal rename from".to_string());
            }
        }
        _ => {
            if op.rename_from.is_some() || op.rename_to.is_some() {
                return Err("rename routing mismatch".to_string());
            }
        }
    }
    let envelope = crate::crypto::SyncEnvelope {
        protocol: SYNC_PROTOCOL.to_string(),
        vault_id: op.vault_id.clone(),
        key_epoch: op.key_epoch,
        op_id: op.op_id.clone(),
        replica_id: op.replica_id.clone(),
        doc_id: op.doc_id.clone(),
        kind: op.kind.as_str().to_string(),
        vv: op.vv.clone(),
        ts_ms: op.ts_ms,
        rename_from: op.rename_from.clone(),
        rename_to: op.rename_to.clone(),
    };
    // Structural recompute: the canonical JSON must round-trip through the
    // envelope shape (non-empty, rename-coherent). The wire `aad` echo, when
    // present, must equal the recomputed canonical form byte-for-byte;
    // absent echo is fine (recomputed anyway). Old pipe form never equals
    // canonical JSON, so downgrade attempts fail closed here.
    let canonical = crate::crypto::canonical_aad_json(&envelope);
    if canonical.is_empty() {
        return Err("bad envelope".to_string());
    }
    if !op.aad.trim().is_empty() && op.aad != canonical {
        return Err("aad mismatch: wire aad is not canonical".to_string());
    }
    Ok(envelope)
}
