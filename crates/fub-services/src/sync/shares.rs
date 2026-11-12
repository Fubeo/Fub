//! La persistenza delle condivisioni: grant, inviti con le buste della
//! chiave del vault, e la risorsa ACL di un vault.

use super::*;

// ---------------------------------------------------------------------------
// Shares persistence: grants (mirrored into parent `state.acls`), invites
// with optional wrapped-VDK envelopes, owner vault-key envelopes.
// ---------------------------------------------------------------------------

/// Invite + optional wrapped VDK envelope for the invitee. The token and the
/// envelope travel out-of-band to the invitee (EXTERNAL BLOCKER: no
/// production delivery channel exists in this crate; the server only stores
/// the opaque envelope, never key cleartext).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredInvite {
    pub invite: acl::Invite,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrapped_vdk: Option<crate::crypto::WrappedVdk>,
    #[serde(default)]
    pub key_epoch: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SyncShares {
    #[serde(default)]
    pub grants: BTreeMap<String, ShareAcl>,
    #[serde(default)]
    pub invites: Vec<StoredInvite>,
    #[serde(default)]
    pub keys: BTreeMap<String, crate::crypto::WrappedVdk>,
    /// Owner-authorized epoch persisted with the wrapped VDK.
    #[serde(default)]
    pub key_epochs: BTreeMap<String, u32>,
}

fn shares_path(sync_dir: &Path) -> std::path::PathBuf {
    sync_dir.join("shares.json")
}

pub(super) fn load_shares(sync_dir: &Path) -> Result<SyncShares, String> {
    let Some(bytes) =
        schema::read_if_present(&shares_path(sync_dir)).map_err(|e| format!("shares read: {e}"))?
    else {
        return Ok(SyncShares::default());
    };
    let mut shares: SyncShares =
        serde_json::from_slice(&bytes).map_err(|e| format!("shares parse: {e}"))?;
    // A registry written before digests held usable invite bearers: convert
    // and rewrite it the first time it is read.
    let mut legacy = false;
    for stored in &mut shares.invites {
        legacy |= stored.invite.seal_legacy();
    }
    if legacy {
        save_shares(sync_dir, &shares)?;
    }
    Ok(shares)
}

pub(super) fn save_shares(sync_dir: &Path, shares: &SyncShares) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(shares).map_err(|e| format!("shares encode: {e}"))?;
    atomic_write(&shares_path(sync_dir), &bytes).map_err(|e| format!("shares write: {e}"))
}

/// Merge persisted grants into the live parent ACL map (union, highest role
/// wins) so revocation/rotation survive restarts.
pub(super) fn merge_grants(state: &mut ServiceState, shares: &SyncShares) {
    for (resource, acl) in &shares.grants {
        let live = state.acl_mut(resource);
        for g in &acl.grants {
            match live.role_of(&g.account_id) {
                Some(have) if have >= g.role => {}
                _ => live.grant(&g.account_id, g.role),
            }
        }
    }
}

/// ACL resource for a vault id.
pub fn vault_resource(vault_id: &str) -> String {
    format!("vault:{vault_id}")
}
