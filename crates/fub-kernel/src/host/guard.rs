//! [`Guard`]: il rifiuto, scritto una volta sola.
//!
//! Una politica dice **di quali famiglie** un host può servirsi; il guard
//! avvolge un host qualsiasi e la fa rispettare. È il punto di applicazione che
//! il §7.3 cercava, e il posto dove atterrano le combinazioni che i permessi
//! chiedono senza che nessuna di esse costi una impl in più.

use std::sync::Arc;

use fub_abi::command::{CommandOutcome, PlannedEdit, Undone};
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::format::{DocumentFormat, LinkInsert};
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel, TaskMarker};
use fub_abi::net::{HttpRequest, HttpResponse, LimitedFetchError};
use fub_abi::options::permission;
use fub_abi::rules::folders;
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{
    DataRead, DataWrite, HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery, HostServices,
    IndexQuery, IndexResult, JobId, JobSpec, Page, Paged, PluginPermissions, SettingsRead,
    SettingsWrite, TransferRead, TrashEntry, VaultRead, VaultStructure, VaultWrite, ViewStateRead,
    ViewStateWrite,
};
use fub_abi::transfer::SourceHandle;
use fub_abi::{Event, PluginError};

use crate::workspace::Trust;

mod capability;
pub use capability::*;
mod network;
mod policy;
pub use policy::*;
mod ports;
pub use ports::*;

/// Un host con una politica davanti.
///
/// Delega ciò che la politica concede e nega il resto. Le venti famiglie [conta: guard-famiglie]
/// sono implementate una volta sola e valgono per **ogni** politica presente e
/// futura: è la differenza fra aggiungere una politica e aggiungere una impl
/// da venticinque metodi.
///
/// # Le sei capacità che non sanno dire di no
///
/// `emit`, `free_name`, `format_of`, `now_unix_millis`, `user_locale` e
/// `active_context` non restituiscono un `Result`. Negarle qui significa dare la
/// **risposta nulla** — nessun evento, il nome che è stato passato, nessun
/// formato, il tempo a zero, il locale del contratto, nessun contesto — perché
/// non c'è un canale per dire altro. È scritto in testa al modulo, ed è una
/// proprietà di quelle firme, non di questo wrapper.
///
/// L'elenco diceva **cinque** e ne nominava cinque, ma quelle senza esito erano
/// sette: `user_locale` e `random_bytes` c'erano e non erano contate. Il conto
/// stava fermo dalla [0021](../../../../docs/decisions/0185-capability-un-solo-guard.md), che
/// l'aveva fatto quando le due capacità della
/// [0039](../../../../docs/decisions/0192-impostazioni-locale-e-temi.md) non esistevano
/// ancora, e nessuna delle due si è aggiunta arrivando. Un elenco scritto a mano
/// che nessun presidio conta invecchia in silenzio: è lo stesso difetto che
/// `every_structural_capability_is_refused_by_the_same_gate` aveva già tolto
/// alle famiglie negate, e che qui non era stato tolto.
///
/// `random_bytes` ne è uscita con la
/// [0094](../../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md), che le ha
/// dato un esito. `user_locale` resta, e ci resta per una ragione buona: il
/// locale di default **è** la risposta del contratto per «nessuno me l'ha
/// detto», quindi negarla dà ciò che darebbe un host senza shell — non una
/// bugia. Era l'altro fallback muto del `Guard`, ed è la differenza fra i due
/// che ha fatto scrivere la 0094.
///
/// `active_context` è il terzo caso, ed è quello che alla regola della 0094 ha
/// dovuto aggiungere una clausola. Da quando i cancelli sono due
/// ([0095](../../../../docs/decisions/0189-ipc-sottile-e-tipizzato.md))
/// il rifiuto è anche **per campo**: `selections: None` a `Session` concessa e
/// `SessionSelection` negata. Quel `None` significa già «nessun cursore», cioè
/// **non** è la risposta vera — sarebbe la bugia che la 0094 condanna, se non
/// fosse per una differenza che vale la pena scrivere: chi la riceve può sapere
/// da sé perché la riceve, perché il permesso che non ha se l'è non-dichiarato
/// lui, nel proprio manifest. *Un fallback muto è onesto anche quando la
/// risposta nulla non è quella vera, purché chi la legge abbia già in mano il
/// motivo* — e un manifest è l'unico posto in cui questo capita.
pub struct Guard<H, P> {
    inner: H,
    policy: P,
}

impl<H, P: Policy> Guard<H, P> {
    pub fn new(inner: H, policy: P) -> Self {
        Guard { inner, policy }
    }

    /// `Ok` se la famiglia è concessa, altrimenti il rifiuto che nomina ciò che
    /// si stava facendo **e** perché non si è potuto.
    fn check(&self, cap: Capability, what: impl FnOnce() -> String) -> Result<(), PluginError> {
        match self.policy.denies(cap) {
            None => Ok(()),
            Some(why) => Err(PluginError::PermissionDenied(
                format!("{}: {why}", what()).into(),
            )),
        }
    }

    fn allows(&self, cap: Capability) -> bool {
        self.policy.denies(cap).is_none()
    }

    fn check_path(
        &self,
        cap: Capability,
        path: &str,
        what: impl FnOnce() -> String,
    ) -> Result<(), PluginError> {
        authorize_path(&self.policy, cap, path, what)
    }

    fn allows_path(&self, cap: Capability, path: &str) -> bool {
        self.allows(cap) && self.policy.denies_path(cap, path).is_none()
    }
}

/// Applica i due cancelli (famiglia e path) a un'operazione che deve essere
/// preparata fuori dal `Guard` preso in prestito dal workspace.
///
/// Il composition root usa questa porta prima di staccare parse, hook e indici
/// di una scrittura `JobHost`: la policy resta quella unica di [`Guard`], non
/// una seconda interpretazione nel proxy.
pub fn authorize_path<P: Policy>(
    policy: &P,
    cap: Capability,
    path: &str,
    what: impl FnOnce() -> String,
) -> Result<(), PluginError> {
    let action = what();
    if let Some(why) = policy.denies(cap) {
        return Err(PluginError::PermissionDenied(
            format!("{action}: {why}").into(),
        ));
    }
    if let Some(why) = policy.denies_path(cap, path) {
        return Err(PluginError::PermissionDenied(
            format!("{action}: {why}").into(),
        ));
    }
    Ok(())
}

/// **Chi può ripristinare cosa**: la regola unica di `restore_document`, per
/// [`Guard`] e per ogni host che ripristina fuori dal suo prestito
/// (`JobHost`).
///
/// Il cestino conserva il path d'origine di ogni voce, ed è su quello che si
/// giudica, **sempre**: una voce che viene da una cartella che il plugin non
/// può leggere, o non può riordinare, non gli appartiene, e una destinazione
/// esplicita non la rende sua. Prima, con `to` esplicito, l'origine non si
/// guardava affatto: un plugin confinato in `sandbox/` riportava in
/// `sandbox/` una nota cestinata da una cartella riservata, e poi la leggeva.
///
/// L'ordine fa parte della regola: una destinazione esplicita negata si
/// rifiuta **prima** di toccare il cestino (`listed` non viene chiamata); la
/// destinazione implicita, che è l'origine, si giudica dopo averla letta.
/// `listed` risolve la voce nella vista del chiamante, e ciò che non vede è
/// `NotFound`. Restituisce la voce e la destinazione autorizzata.
pub fn authorize_restore<P: Policy>(
    policy: &P,
    entry: &DocId,
    to: Option<&DocId>,
    listed: impl FnOnce() -> Result<TrashEntry, PluginError>,
) -> Result<(TrashEntry, DocId), PluginError> {
    let restoring_to = |target: &DocId| {
        authorize_path(policy, Capability::VaultStructure, target.as_str(), || {
            format!("restoring to `{target}`")
        })
    };
    if let Some(target) = to {
        restoring_to(target)?;
    }
    let listed = listed()?;
    let original = &listed.original;
    authorize_path(policy, Capability::VaultRead, original.as_str(), || {
        format!("restoring `{entry}`")
    })?;
    authorize_path(
        policy,
        Capability::VaultStructure,
        original.as_str(),
        || format!("restoring `{entry}`"),
    )?;
    let target = match to {
        Some(target) => target.clone(),
        None => {
            restoring_to(original)?;
            original.clone()
        }
    };
    Ok((listed, target))
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
