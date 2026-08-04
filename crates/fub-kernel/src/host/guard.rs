//! [`Guard`]: il rifiuto, scritto una volta sola.
//!
//! Una politica dice **di quali famiglie** un host può servirsi; il guard
//! avvolge un host qualsiasi e la fa rispettare. È il punto di applicazione che
//! il §7.3 cercava, e il posto dove atterrano le combinazioni che i permessi
//! chiedono senza che nessuna di esse costi una impl in più.

use std::sync::Arc;

use fub_abi::command::CommandOutcome;
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::format::DocumentFormat;
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::options::permission;
use fub_abi::session::ViewContext;
use fub_abi::settings::SettingValue;
use fub_abi::text::Text;
use fub_abi::traits::{
    DataRead, DataWrite, HostCommands, HostEnv, HostEvents, HostQuery, HostServices, IndexQuery,
    IndexResult, JobId, JobSpec, Page, Paged, PluginPermissions, SettingsRead, SettingsWrite,
    TrashEntry, VaultRead, VaultStructure, VaultWrite, ViewStateRead, ViewStateWrite,
};
use fub_abi::{Event, PluginError};

use crate::workspace::Trust;

/// Le quattordici famiglie di capacità [conta: guard-famiglie], come nomi su cui
/// una politica risponde.
///
/// Sono esattamente i quattordici trait [conta: guard-famiglie] di
/// `fub_abi::traits`, e non è una
/// duplicazione: là sono ciò che un host **sa fare**, qui ciò che gli si
/// **concede**. Le due liste devono restare la stessa lista, e il presidio è
/// che [`Guard`] non compila se una famiglia non è coperta.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Capability {
    /// Leggere il vault: sorgente, modello, elenco, cestino.
    VaultRead,
    /// Scrivere il testo di un documento.
    VaultWrite,
    /// Creare, rinominare, cestinare, ripristinare, distruggere.
    VaultStructure,
    /// Rileggere i propri blob persistenti.
    DataRead,
    /// Scrivere i propri blob persistenti.
    DataWrite,
    /// Interrogare l'indice.
    Query,
    /// Sapere che ore sono e cosa guarda l'utente.
    Env,
    /// Emettere eventi, chiedere job.
    Events,
    /// Invocare i comandi del registro.
    Commands,
    /// Chiamare i servizi offerti dagli altri plugin (§7.5).
    Services,
    /// Leggere le impostazioni dichiarate (§11.1).
    SettingsRead,
    /// Scrivere quelle che si sono dichiarate scrivibili da un programma.
    SettingsWrite,
    /// Rileggere lo stato di vista del proprio esemplare (§11.2).
    ViewStateRead,
    /// Ricordarlo.
    ViewStateWrite,
}

impl Capability {
    /// Tutte, in ordine di dichiarazione. Serve a calcolare una
    /// [`CapabilitySet`] senza scrivere l'elenco una seconda volta: se una
    /// famiglia nascesse e non finisse qui, nascerebbe negata a tutti — che è
    /// il modo giusto di sbagliare, ma va visto.
    ///
    /// «Va visto» è stato per molto tempo una raccomandazione e basta: adesso lo
    /// vede `tests::i_discriminanti_coprono_ogni_famiglia`, perché tutto ciò che
    /// itera le capacità sta a valle di questo elenco — i permessi concessi da
    /// [`Granted::new`] e il presidio delle capacità simulate in
    /// `kernel/tests/invoke_command.rs` — e una famiglia che non ci finisse
    /// sparirebbe da entrambi restando verde.
    pub const ALL: [Capability; 14] = [
        Capability::VaultRead,
        Capability::VaultWrite,
        Capability::VaultStructure,
        Capability::DataRead,
        Capability::DataWrite,
        Capability::Query,
        Capability::Env,
        Capability::Events,
        Capability::Commands,
        Capability::Services,
        Capability::SettingsRead,
        Capability::SettingsWrite,
        Capability::ViewStateRead,
        Capability::ViewStateWrite,
    ];

    /// Il permesso del core che governa questa famiglia, se ce n'è uno.
    ///
    /// `None` non vuol dire "sempre concessa": vuol dire che **non è un
    /// permesso dichiarabile nel manifest** — i propri blob stanno nel proprio
    /// recinto, l'orologio non è del vault. Una politica può negarle lo stesso,
    /// per ragioni sue.
    pub fn permission(self) -> Option<&'static str> {
        match self {
            // Il canale dati è derivato dal vault: chi non lo può leggere non
            // lo può nemmeno interrogare in aggregato — anzi, meno che mai,
            // perché una risposta aggregata non ha un path da confrontare con
            // una allowlist.
            Capability::VaultRead | Capability::Query => Some(permission::READ_VAULT),
            Capability::VaultWrite | Capability::VaultStructure => Some(permission::WRITE_VAULT),
            Capability::Commands => Some(permission::RUN_COMMAND),
            Capability::Services => Some(permission::CALL_SERVICE),
            Capability::SettingsWrite => Some(permission::WRITE_SETTINGS),
            // Leggere la configurazione non ha un permesso, e non è una
            // dimenticanza: uno schema è pubblico per costruzione — sta nel
            // manifest di chi lo dichiara — e questo store non contiene segreti,
            // per regola scritta (`fub_abi::settings`). Ciò che si recinta è
            // la scrittura, e lì i cancelli sono due.
            // Lo stato di vista sta nel proprio recinto come i blob, e per la
            // stessa ragione non è un permesso dichiarabile: quello che si
            // legge e si scrive è già solo il proprio.
            Capability::ViewStateRead
            | Capability::ViewStateWrite
            | Capability::DataRead
            | Capability::DataWrite
            | Capability::Env
            | Capability::Events
            | Capability::SettingsRead => None,
        }
    }
}

/// Chi decide quali famiglie un host può servire.
///
/// Una politica è **piccola per costruzione**: risponde a quattordici nomi [conta: guard-famiglie]
/// e non
/// sa niente di documenti, di blob o di comandi. È ciò che permette di comporne
/// due senza chiedersi cosa significhi comporre venticinque metodi.
pub trait Policy: Send + Sync {
    /// La ragione per cui questa famiglia è negata, o `None` se è concessa.
    ///
    /// La ragione è una frase che finisce nel messaggio d'errore dopo ciò che
    /// si stava facendo: «creare `Nota.md`: **il comando si è dichiarato di
    /// sola lettura**».
    fn denies(&self, cap: Capability) -> Option<String>;
}

/// Due politiche insieme: nega chi nega per primo.
///
/// È la **combinatoria** del §7.3 — `write_vault` × `Trust` × simulazione —
/// senza un tipo per combinazione: un comando di sola lettura di un plugin
/// senza permessi è `(ReadOnly, Granted)`, e la prima ragione che si applica è
/// quella che l'utente legge.
impl<A: Policy, B: Policy> Policy for (A, B) {
    fn denies(&self, cap: Capability) -> Option<String> {
        self.0.denies(cap).or_else(|| self.1.denies(cap))
    }
}

/// «Questo non deve scrivere», con la ragione già scritta.
///
/// Copre i due casi della decisione 0010: un comando che si sta **simulando**,
/// e un comando che si è **dichiarato** di sola lettura. Le letture passano;
/// i comandi passano anche loro, ma l'host sottostante gira in
/// [`InvokeMode::DryRun`](fub_abi::command::InvokeMode::DryRun) — se qui si
/// rispondesse `permission-denied`, simulare una macro non direbbe *niente* di
/// ciò che farebbe, perché tutto ciò che una macro fa è invocare altri comandi.
pub struct ReadOnly {
    /// La ragione del divieto: finisce nel messaggio.
    pub why: &'static str,
}

impl Policy for ReadOnly {
    fn denies(&self, cap: Capability) -> Option<String> {
        match cap {
            Capability::VaultWrite
            | Capability::VaultStructure
            | Capability::DataWrite
            // Cambiare la configurazione è l'effetto meno ritirabile di tutti:
            // sopravvive alla sessione, e una simulazione che spegnesse il
            // versioning lo lascerebbe spento.
            | Capability::SettingsWrite
            // Ricordare dove si era rimasti sopravvive alla simulazione come
            // ci sopravvive un blob: una prova a vuoto che spostasse lo scroll
            // avrebbe lasciato dietro di sé l'unica cosa che doveva non fare.
            | Capability::ViewStateWrite
            // Un evento emesso e un job lanciato sono effetti che una
            // simulazione non può ritirare: il `DocumentChanged` finto fa
            // ricaricare l'editor, il job rientra quando la simulazione è
            // finita da un pezzo.
            | Capability::Events
            // Un servizio di un altro plugin può **scrivere**, e girerebbe con
            // le capacità di CHI LO OFFRE: un dry-run che potesse chiamarlo
            // avrebbe una scala per uscire dalla simulazione. `run_command`
            // invece passa, perché il comando invocato riceve a sua volta un
            // host simulato — è la differenza fra una catena che l'host governa
            // e una superficie che non conosce.
            | Capability::Services => Some(self.why.to_string()),
            Capability::VaultRead
            | Capability::DataRead
            | Capability::Query
            | Capability::Env
            | Capability::SettingsRead
            // Rileggere dove si era rimasti non è un effetto: una simulazione
            // che disegnasse una view senza il suo scroll mostrerebbe una cosa
            // diversa da quella che l'utente ha davanti.
            | Capability::ViewStateRead
            | Capability::Commands => None,
        }
    }
}

/// Ciò che un plugin ha **dichiarato** e l'host gli ha concesso: il §7.3.
///
/// Nasce dal registro dei plugin — non dal plugin, che i permessi li dichiara
/// ma non se li concede — e porta anche il grado di fiducia, che è l'altra
/// metà: [`Trust::Revoked`] non è un permesso in meno, è l'assenza del permesso
/// di essere eseguiti, e nega **tutto**.
///
/// Prima di questa politica `PluginPermissions` esisteva nel contratto e non lo
/// leggeva nessuno: era una dichiarazione senza lettore, cioè una promessa
/// vera a metà e in silenzio.
///
/// È `Clone` ed è **piccola** — un `Arc<str>`, una maschera, un grado —
/// perché si monta davanti a un host a ogni prestito, e un host si presta a
/// ogni evento consegnato a ogni handler: clonare lì la mappa dei permessi
/// sarebbe un costo per ogni evento del vault.
#[derive(Clone)]
pub struct Granted {
    /// Chi sta usando le capacità: un rifiuto che non dice a chi si riferisce
    /// non è diagnosticabile in un montaggio con venti plugin.
    plugin: Arc<str>,
    /// Le famiglie concesse, calcolate una volta alla dichiarazione.
    allowed: CapabilitySet,
    /// `None` = il plugin non è dichiarato affatto, che è un no diverso da
    /// «non ha quel permesso» e va detto diverso.
    trust: Option<Trust>,
}

/// Le famiglie concesse, come insieme.
///
/// Quattordici bit in un `u16`: è la forma che rende [`Granted`] clonabile senza
/// allocare, ed è anche il motivo per cui [`Capability`] è un enum piccolo e
/// chiuso invece di una stringa — e per cui i suoi discriminanti devono restare
/// contigui, che è ciò che presidia `i_discriminanti_coprono_ogni_famiglia`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CapabilitySet(u16);

impl CapabilitySet {
    pub fn contains(self, cap: Capability) -> bool {
        self.0 & (1 << cap as u16) != 0
    }

    pub fn with(mut self, cap: Capability) -> Self {
        self.0 |= 1 << cap as u16;
        self
    }
}

impl Granted {
    /// La politica di un plugin dichiarato: ciò che i suoi permessi accendono,
    /// più le famiglie che un permesso non lo hanno affatto (i propri blob,
    /// l'orologio, gli eventi).
    pub fn new(plugin: &str, permissions: &PluginPermissions, trust: Trust) -> Self {
        let allowed = Capability::ALL
            .iter()
            .fold(CapabilitySet::default(), |set, &cap| {
                match cap.permission() {
                    None => set.with(cap),
                    Some(key) if permissions.has(key) => set.with(cap),
                    Some(_) => set,
                }
            });
        Granted {
            plugin: Arc::from(plugin),
            allowed,
            trust: Some(trust),
        }
    }

    /// La politica di un id che **nessuno ha dichiarato**: nega tutto.
    ///
    /// Non è un caso limite da nascondere: è la risposta che rende inutile
    /// registrare qualcosa senza presentarsi, e il messaggio dice esattamente
    /// cosa manca.
    pub fn undeclared(plugin: &str) -> Self {
        Granted {
            plugin: Arc::from(plugin),
            allowed: CapabilitySet::default(),
            trust: None,
        }
    }

    /// Le famiglie concesse: è ciò che l'inventario del §7.6 mostrerebbe se
    /// qualcuno volesse vedere i permessi già risolti invece che dichiarati.
    pub fn allowed(&self) -> CapabilitySet {
        self.allowed
    }
}

impl Policy for Granted {
    fn denies(&self, cap: Capability) -> Option<String> {
        match self.trust {
            None => Some(format!("`{}` non è un plugin dichiarato", self.plugin)),
            Some(trust) if !trust.runs() => Some(format!("`{}` è revocato", self.plugin)),
            Some(_) if self.allowed.contains(cap) => None,
            Some(_) => Some(format!(
                "`{}` non ha dichiarato il permesso `{}`",
                self.plugin,
                cap.permission()
                    .expect("una famiglia negata dai permessi ne ha uno")
            )),
        }
    }
}

/// Un host con una politica davanti.
///
/// Delega ciò che la politica concede e nega il resto. Le quattordici famiglie [conta: guard-famiglie]
/// sono implementate una volta sola e valgono per **ogni** politica presente e
/// futura: è la differenza fra aggiungere una politica e aggiungere una impl
/// da venticinque metodi.
///
/// # Le cinque capacità che non sanno dire di no
///
/// `emit`, `free_name`, `format_of`, `now_unix_millis` e `active_context` non
/// restituiscono un `Result`. Negarle qui significa dare la **risposta nulla**
/// — nessun evento, il nome che è stato passato, nessun formato, il tempo a
/// zero, nessun contesto — perché non c'è un canale per dire altro. È scritto
/// in testa al modulo, ed è una proprietà di quelle firme, non di questo
/// wrapper.
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
}

impl<H: VaultRead, P: Policy> VaultRead for Guard<H, P> {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.check(Capability::VaultRead, || format!("leggere `{id}`"))?;
        self.inner.read_document(id)
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        // Stesso permesso della lettura di testo, e non uno suo: vedi la firma
        // nel contratto — i byte non sono un grado di fiducia in più.
        self.check(Capability::VaultRead, || {
            format!("leggere i byte di `{id}`")
        })?;
        self.inner.read_document_bytes(id)
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        self.check(Capability::VaultRead, || {
            format!("leggere la revisione di `{id}`")
        })?;
        self.inner.document_revision(id)
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        self.check(Capability::VaultRead, || "elencare i documenti".into())?;
        self.inner.list_documents(page)
    }

    fn free_name(&self, id: &DocId) -> DocId {
        // Senza esito: la risposta nulla è l'id che è stato passato — «nessun
        // nome è noto come libero». Chi lo usa per creare riceve comunque un
        // rifiuto da `create_document`, che un esito ce l'ha.
        if self.allows(Capability::VaultRead) {
            self.inner.free_name(id)
        } else {
            id.clone()
        }
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.check(Capability::VaultRead, || {
            format!("leggere il modello di `{id}`")
        })?;
        self.inner.read_model(id)
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        // Senza esito: `None` qui significa già «nessuno lo rivendica», ed è la
        // risposta nulla più vicina al vero che questa firma sappia dare.
        self.allows(Capability::VaultRead)
            .then(|| self.inner.format_of(id))
            .flatten()
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.check(Capability::VaultRead, || "elencare il cestino".into())?;
        self.inner.list_trash()
    }
}

impl<H: VaultWrite, P: Policy> VaultWrite for Guard<H, P> {
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.check(Capability::VaultWrite, || format!("scrivere `{id}`"))?;
        self.inner.write_document(id, source, base)
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        self.check(Capability::VaultWrite, || format!("modificare `{id}`"))?;
        self.inner.apply_edit(id, request)
    }
}

impl<H: VaultStructure, P: Policy> VaultStructure for Guard<H, P> {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.check(Capability::VaultStructure, || format!("creare `{id}`"))?;
        self.inner.create_document(id, source)
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        self.check(Capability::VaultStructure, || {
            format!("rinominare `{from}`")
        })?;
        self.inner.rename_document(from, to)
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        self.check(Capability::VaultStructure, || format!("cestinare `{id}`"))?;
        self.inner.trash_document(id)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        self.check(Capability::VaultStructure, || {
            format!("ripristinare `{entry}`")
        })?;
        self.inner.restore_document(entry, to)
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.check(Capability::VaultStructure, || "svuotare il cestino".into())?;
        self.inner.empty_trash()
    }
}

impl<H: DataRead, P: Policy> DataRead for Guard<H, P> {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.check(Capability::DataRead, || format!("leggere il blob `{path}`"))?;
        self.inner.data_read(path)
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        self.check(Capability::DataRead, || "elencare i blob".into())?;
        self.inner.data_list(prefix)
    }
}

impl<H: DataWrite, P: Policy> DataWrite for Guard<H, P> {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || {
            format!("scrivere il blob `{path}`")
        })?;
        self.inner.data_write(path, bytes)
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || {
            format!("cancellare il blob `{path}`")
        })?;
        self.inner.data_remove(path)
    }
}

impl<H: SettingsRead, P: Policy> SettingsRead for Guard<H, P> {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.check(Capability::SettingsRead, || {
            format!("leggere l'impostazione `{key}`")
        })?;
        self.inner.setting(key)
    }
}

impl<H: SettingsWrite, P: Policy> SettingsWrite for Guard<H, P> {
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        self.check(Capability::SettingsWrite, || {
            format!("scrivere l'impostazione `{key}`")
        })?;
        self.inner.set_setting(key, value)
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        self.check(Capability::SettingsWrite, || {
            format!("azzerare l'impostazione `{key}`")
        })?;
        self.inner.reset_setting(key)
    }
}

impl<H: ViewStateRead, P: Policy> ViewStateRead for Guard<H, P> {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        self.check(Capability::ViewStateRead, || {
            format!("rileggere lo stato di vista `{key}`")
        })?;
        self.inner.view_state(key)
    }
}

impl<H: ViewStateWrite, P: Policy> ViewStateWrite for Guard<H, P> {
    fn set_view_state(
        &mut self,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        self.check(Capability::ViewStateWrite, || {
            format!("ricordare lo stato di vista `{key}`")
        })?;
        self.inner.set_view_state(key, value)
    }
}

impl<H: HostEnv, P: Policy> HostEnv for Guard<H, P> {
    fn now_unix_millis(&self) -> u64 {
        // Senza esito. Zero è l'epoca UNIX: una data che nessun vault contiene
        // e che chi la stampa riconosce, invece di un tempo plausibile e falso.
        if self.allows(Capability::Env) {
            self.inner.now_unix_millis()
        } else {
            0
        }
    }

    fn user_locale(&self) -> Locale {
        // Senza esito. Il locale di default è già la risposta del contratto per
        // «nessuno me l'ha detto»: lingua indeterminata, UTC, ISO 8601. Chi non
        // ha la capacità riceve quindi ciò che riceverebbe un host senza shell,
        // non un locale plausibile e falso.
        if self.allows(Capability::Env) {
            self.inner.user_locale()
        } else {
            Locale::default()
        }
    }

    fn random_bytes(&self, n: u32) -> Vec<u8> {
        // Senza esito, e il vuoto è la sola risposta onesta: dei byte fissi
        // sarebbero identità che collidono, e chi li genera non ha modo di
        // accorgersene finché due note non hanno lo stesso id.
        if self.allows(Capability::Env) {
            self.inner.random_bytes(n)
        } else {
            Vec::new()
        }
    }

    fn active_context(&self) -> Option<ViewContext> {
        // Senza esito, e qui `None` è già una risposta del contratto: «la shell
        // non ne ha ancora pubblicato uno».
        self.allows(Capability::Env)
            .then(|| self.inner.active_context())
            .flatten()
    }
}

impl<H: HostEvents, P: Policy> HostEvents for Guard<H, P> {
    fn emit(&mut self, event: Event) {
        // Senza esito: il silenzio è il no. Un `DocumentChanged` emesso da una
        // simulazione farebbe ricaricare l'editor su una modifica che non è
        // avvenuta.
        if self.allows(Capability::Events) {
            self.inner.emit(event);
        }
    }

    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        self.check(Capability::Events, || "lanciare un job".into())?;
        self.inner.spawn_job(spec)
    }
}

impl<H: HostQuery, P: Policy> HostQuery for Guard<H, P> {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        self.check(Capability::Query, || "interrogare l'indice".into())?;
        self.inner.query_index(query)
    }
}

impl<H: HostCommands, P: Policy> HostCommands for Guard<H, P> {
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.check(Capability::Commands, || format!("invocare `{command}`"))?;
        self.inner.run_command(command, args)
    }

    fn undo_last(&mut self) -> Result<Option<Text>, PluginError> {
        // **Due** controlli, e non è pignoleria. Annullare è invocare — i passi
        // di un annullamento sono per metà comandi — ma è anche, sempre e per
        // definizione, **scrivere**: e ciò che scrive non passa dal recinto del
        // chiamante, perché a eseguirlo è il kernel. Senza il secondo controllo
        // un host di sola lettura avrebbe una scala per riscrivere il vault, e
        // un plugin senza `write-vault` un modo di disfare il lavoro di
        // qualcuno.
        self.check(Capability::Commands, || "annullare".into())?;
        self.check(Capability::VaultWrite, || "annullare".into())?;
        self.inner.undo_last()
    }
}

impl<H: HostServices, P: Policy> HostServices for Guard<H, P> {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.check(Capability::Services, || {
            format!("chiamare `{service}.{method}`")
        })?;
        self.inner.call_service(service, method, args)
    }
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// `ALL` è l'unico elenco scritto a mano rimasto in questo modulo, e tutto
    /// il resto gli sta a valle: `Granted::new` ci folda sopra per calcolare i
    /// permessi, e il presidio delle capacità simulate
    /// (`kernel/tests/invoke_command.rs`) ci ricava l'insieme che pretende di
    /// aver provato. Una famiglia che non finisse qui sparirebbe da entrambi
    /// **restando verde** — e il commento sopra `ALL` diceva che «nascerebbe
    /// negata a tutti, che è il modo giusto di sbagliare, ma va visto»: la prima
    /// metà è vera per costruzione, la seconda non lo era da nessuna parte.
    ///
    /// La lunghezza dichiarata (`[Capability; 14]`) obbliga a **toccare**
    /// l'elenco quando l'enum cresce, ma non a metterci dentro la variante
    /// giusta: chi ha fretta soddisfa il compilatore duplicando una riga già
    /// presente, e la famiglia nuova non viene iterata mai.
    ///
    /// Questo lo chiude senza una proc-macro, sfruttando ciò su cui
    /// [`CapabilitySet`] fa già affidamento (`1 << cap as u16`): i discriminanti
    /// sono contigui da zero, quindi pretendere che quelli di `ALL` siano
    /// esattamente `0..len` vieta insieme i duplicati e i buchi. Duplicare una
    /// riga è rosso; dimenticare la variante nuova è rosso.
    #[test]
    fn i_discriminanti_coprono_ogni_famiglia() {
        let mut visti: Vec<u16> = Capability::ALL.iter().map(|&c| c as u16).collect();
        visti.sort_unstable();
        let attesi: Vec<u16> = (0..Capability::ALL.len() as u16).collect();
        assert_eq!(
            visti, attesi,
            "`Capability::ALL` non copre una volta sola ogni famiglia dell'enum: \
             o una riga è duplicata, o la famiglia nuova non è stata aggiunta e \
             la lunghezza è stata fatta tornare con un doppione. Chi non è in \
             `ALL` non viene concesso da `Granted::new` e non viene preteso dal \
             presidio delle capacità simulate: sparisce da tutti e due restando \
             verde."
        );
    }
}
