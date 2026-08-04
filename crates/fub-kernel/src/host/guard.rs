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

/// Le sedici famiglie di capacità [conta: guard-famiglie], come nomi su cui
/// una politica risponde.
///
/// Sono i quattordici trait di `fub_abi::traits` **più due**, e non è una
/// duplicazione: là sono ciò che un host **sa fare**, qui ciò che gli si
/// **concede**. Le due liste devono coprire le stesse cose, e il presidio è
/// che [`Guard`] non compila se un trait non è coperto.
///
/// # Perché sedici e non quattordici
///
/// Per dodici trait su quattordici la corrispondenza è uno a uno, ed era vera
/// per tutti e quattordici fino alla
/// [0095](../../../docs/decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md).
/// [`HostEnv`] ne porta **tre** perché è il solo trait che presta, dallo stesso
/// metodo, una cosa della macchina e due dell'utente: l'orologio e il caso
/// sono [`Capability::Env`], quale nota è aperta è [`Capability::Session`], il
/// testo selezionato è [`Capability::SessionSelection`].
///
/// La scomposizione in sotto-trait — la strada della
/// [0021](../../../docs/decisions/0021-il-confine.md), che è ciò che di norma
/// rende una famiglia esattamente un trait — qui **non era disponibile**: le
/// tre cose escono da una firma sola, e un trait in più non spacca un record in
/// due. Spaccare il record era un'opzione, ed è quella che si è scartata; vedi
/// il verbale. Il prezzo è che l'invariante da presidiare cambia forma: non
/// «una famiglia, un trait», ma «nessun trait senza almeno una famiglia».
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
    /// Sapere che ore sono, e tirare a sorte.
    ///
    /// **Non** «cosa guarda l'utente»: quella era qui, e se n'è andata con la
    /// [0095](../../../docs/decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md).
    /// Ciò che resta è della macchina, non di chi la usa, e per questo non ha
    /// un permesso.
    Env,
    /// Sapere **quale nota** l'utente sta guardando, e in che modalità.
    ///
    /// È il contesto senza il suo contenuto: il pannello, il documento, la
    /// modalità. Il nome di una nota non è il suo testo, ma è comunque un fatto
    /// dell'utente — per questo ha un permesso, e per questo non sta con
    /// l'orologio.
    Session,
    /// Leggere il **testo selezionato**, verbatim.
    ///
    /// Sta accanto a [`Capability::Session`] e non dentro, perché la leva che
    /// serve all'utente è proprio fra le due: concedere «sai che nota guardo» e
    /// negare «sai cosa ci sto scrivendo». Chi ha questa e non quella non
    /// riceve niente — il testo arriva dentro il contesto, e senza contesto non
    /// c'è dove metterlo.
    SessionSelection,
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
    pub const ALL: [Capability; 16] = [
        Capability::VaultRead,
        Capability::VaultWrite,
        Capability::VaultStructure,
        Capability::DataRead,
        Capability::DataWrite,
        Capability::Query,
        Capability::Env,
        Capability::Session,
        Capability::SessionSelection,
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
            // Cosa guarda l'utente e cosa ha selezionato sono **due** permessi
            // perché sono due domande, e la risposta a una non implica l'altra:
            // un pannello che segna la sezione corrente vuole la prima, un
            // contatore di parole della selezione tutte e due. Non si
            // appoggiano a `read-vault` — che pure governa il contenuto dei
            // documenti — perché appoggiarcisi renderebbe impossibile la sola
            // cosa che questi due esistono per permettere: concedere il vault e
            // negare la selezione.
            Capability::Session => Some(permission::READ_SESSION),
            Capability::SessionSelection => Some(permission::READ_SELECTION),
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
/// Una politica è **piccola per costruzione**: risponde a sedici nomi [conta: guard-famiglie]
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
            // Leggere la sessione non è un effetto: una simulazione che non
            // sapesse quale nota è aperta direbbe cosa farebbe **su un'altra**.
            | Capability::Session
            | Capability::SessionSelection
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
/// Sedici bit in un `u16` — cioè **tutti**, da quando le famiglie sono sedici:
/// la prossima che nascesse vuole un `u32`, e il presidio dei discriminanti è
/// il posto in cui ci si accorge di doverlo cambiare invece di perdere un bit
/// in silenzio. Sedici bit: è la forma che rende [`Granted`] clonabile senza
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
/// Delega ciò che la politica concede e nega il resto. Le sedici famiglie [conta: guard-famiglie]
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
/// stava fermo dalla [0021](../../../docs/decisions/0021-il-confine.md), che
/// l'aveva fatto quando le due capacità della
/// [0039](../../../docs/decisions/0039-il-locale-e-il-caso.md) non esistevano
/// ancora, e nessuna delle due si è aggiunta arrivando. Un elenco scritto a mano
/// che nessun presidio conta invecchia in silenzio: è lo stesso difetto che
/// `every_structural_capability_is_refused_by_the_same_gate` aveva già tolto
/// alle famiglie negate, e che qui non era stato tolto.
///
/// `random_bytes` ne è uscita con la
/// [0094](../../../docs/decisions/0094-un-tetto-che-si-fa-sentire.md), che le ha
/// dato un esito. `user_locale` resta, e ci resta per una ragione buona: il
/// locale di default **è** la risposta del contratto per «nessuno me l'ha
/// detto», quindi negarla dà ciò che darebbe un host senza shell — non una
/// bugia. Era l'altro fallback muto del `Guard`, ed è la differenza fra i due
/// che ha fatto scrivere la 0094.
///
/// `active_context` è il terzo caso, ed è quello che alla regola della 0094 ha
/// dovuto aggiungere una clausola. Da quando i cancelli sono due
/// ([0095](../../../docs/decisions/0095-cosa-guardo-e-cosa-sto-scrivendo.md))
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

    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        // L'unico dei quattro che ha un esito, e l'unico che ne aveva bisogno.
        // Rendeva il vuoto — che è ancora, come diceva la 0039, meglio di byte
        // fissi che collidono — ma il vuoto è una *politica travestita da dato*:
        // arrivava a chi chiama indistinguibile dal troncamento sopra il tetto,
        // e i due si correggono in modi opposti (chiedere meno serve nel primo
        // caso, non serve a niente nel secondo). Adesso il rifiuto dice anche
        // PERCHÉ, che è ciò che il `Guard` sa e nessun'altra risposta poteva
        // portare (decisione 0094).
        self.check(Capability::Env, || format!("chiedere {n} byte di caso"))?;
        self.inner.random_bytes(n)
    }

    fn active_context(&self) -> Option<ViewContext> {
        // **Il solo metodo del `Guard` con due cancelli**, e li ha perché
        // pubblica due cose dell'utente che si concedono separatamente
        // (decisione 0095). Senza `Session` non c'è contesto; con `Session` e
        // senza `SessionSelection` c'è il contesto e non il testo.
        //
        // Senza esito, quindi il rifiuto è muto in entrambi i casi, e in
        // entrambi la risposta nulla è già una frase del dominio: `None` = «la
        // shell non ne ha ancora pubblicato uno», `selections: None` = «nessun
        // cursore» (modalità di lettura, o nessun documento). Non è la risposta
        // *vera* — questo è il punto in cui si va oltre il criterio della 0094 —
        // ma chi la riceve sa da sé perché la riceve: **è nel proprio
        // manifest**, e un permesso che non si è dichiarato non è una sorpresa
        // che arriva a tempo d'esecuzione.
        let mut context = self
            .allows(Capability::Session)
            .then(|| self.inner.active_context())
            .flatten()?;
        if !self.allows(Capability::SessionSelection) {
            context.selections = None;
        }
        Some(context)
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

    /// Una politica che nega una famiglia sola: serve a provare il cancello di
    /// [`Capability::Env`], che `ReadOnly` **concede** — leggere che ore sono
    /// non è un effetto — e che quindi il presidio delle capacità simulate non
    /// esercita.
    struct Nega(Capability);

    impl Policy for Nega {
        fn denies(&self, cap: Capability) -> Option<String> {
            (cap == self.0).then(|| "per prova".to_string())
        }
    }

    /// Un host che concede entropia a chiunque gliela chieda: ciò che si prova
    /// qui è il cancello, non ciò che sta dietro.
    struct Generoso;

    impl HostEnv for Generoso {
        fn now_unix_millis(&self) -> u64 {
            0
        }

        fn user_locale(&self) -> Locale {
            Locale::default()
        }

        fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
            Ok(vec![7; n as usize])
        }

        fn active_context(&self) -> Option<ViewContext> {
            None
        }
    }

    /// Un host che un contesto ce l'ha, con dentro una nota e del testo
    /// selezionato: è il solo modo di provare che il cancello della selezione
    /// taglia **un campo** e non la risposta intera.
    struct ConContesto;

    impl HostEnv for ConContesto {
        fn now_unix_millis(&self) -> u64 {
            0
        }

        fn user_locale(&self) -> Locale {
            Locale::default()
        }

        fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
            Ok(vec![7; n as usize])
        }

        fn active_context(&self) -> Option<ViewContext> {
            Some(
                ViewContext::new("pane-1")
                    .with_doc(Some(DocId::new("Diario/2026-08-04.md")))
                    .with_selections(Some(fub_abi::session::SelectionSet::anchored(
                        fub_abi::model::Span::new(0, 7),
                        "segreto",
                    ))),
            )
        }
    }

    /// **La leva che la 0095 esiste per dare**: il vault concesso, la nota
    /// concessa, il testo no.
    ///
    /// È il caso del diario — «sai che nota guardo, non sai cosa ci sto
    /// scrivendo» — e non sarebbe stato esprimibile appoggiando la selezione a
    /// `read-vault`, che è la strada che la §23.5 raccomandava per prima:
    /// negarla lì avrebbe reso il plugin cieco sul vault, cioè avrebbe tolto
    /// all'utente proprio la scelta fine.
    #[test]
    fn denying_the_selection_leaves_the_note_visible() {
        let guard = Guard::new(ConContesto, Nega(Capability::SessionSelection));
        let context = guard
            .active_context()
            .expect("negare la selezione non nega il contesto");
        assert_eq!(
            context.doc,
            Some(DocId::new("Diario/2026-08-04.md")),
            "quale nota guardo resta concesso: è l'altro permesso"
        );
        assert!(
            context.selections.is_none(),
            "il testo selezionato non deve attraversare: {:?}",
            context.selections
        );
    }

    /// L'altro cancello, quello grosso: senza `Session` non c'è contesto, e con
    /// lui se ne va anche il testo — che è dentro, e senza un contesto non ha
    /// dove stare.
    #[test]
    fn denying_the_session_takes_the_selection_with_it() {
        let guard = Guard::new(ConContesto, Nega(Capability::Session));
        assert!(
            guard.active_context().is_none(),
            "senza `Session` la risposta è quella di un host senza shell"
        );
    }

    /// Il cancello dell'orologio non è più quello della sessione, ed è **tutta
    /// la voce**: prima erano la stessa famiglia, quindi negare il testo
    /// selezionato voleva dire negare che ore sono.
    #[test]
    fn the_clock_and_the_session_are_no_longer_the_same_gate() {
        let senza_sessione = Guard::new(ConContesto, Nega(Capability::Session));
        assert_eq!(
            senza_sessione.now_unix_millis(),
            0,
            "l'orologio è della macchina: negare la sessione non lo tocca"
        );
        let senza_orologio = Guard::new(ConContesto, Nega(Capability::Env));
        assert!(
            senza_orologio.active_context().is_some(),
            "e viceversa: negare l'orologio non nega quale nota è aperta"
        );
    }

    /// Il caso negato **dice di essere negato**, e non rende il vuoto.
    ///
    /// Era l'unico fallback muto del `Guard` che mentiva: un `Vec` vuoto arriva
    /// a chi chiama identico al troncamento sopra il tetto, e i due si
    /// correggono in modi opposti — chiedere meno serve in un caso e non serve
    /// a niente nell'altro (§23.12, decisione 0094). Un `assert` sulla
    /// lunghezza sarebbe passato anche prima: solo la variante lo presidia.
    #[test]
    fn denied_entropy_says_so_instead_of_answering_empty() {
        let guard = Guard::new(Generoso, Nega(Capability::Env));
        let err = guard
            .random_bytes(16)
            .expect_err("senza `Env` non si concede entropia");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "il rifiuto deve nominare il permesso: {err}"
        );
        assert!(
            err.message().to_string().contains("16"),
            "e deve dire cosa si stava facendo: {err}"
        );
    }

    /// Negare un'altra famiglia non tocca questa: il cancello è per famiglia, e
    /// un `check` sulla capacità sbagliata passerebbe di qui rosso.
    #[test]
    fn a_different_denial_leaves_entropy_alone() {
        let guard = Guard::new(Generoso, Nega(Capability::VaultWrite));
        assert_eq!(guard.random_bytes(4).unwrap().len(), 4);
    }

    /// `ALL` è l'unico elenco scritto a mano rimasto in questo modulo, e tutto
    /// il resto gli sta a valle: `Granted::new` ci folda sopra per calcolare i
    /// permessi, e il presidio delle capacità simulate
    /// (`kernel/tests/invoke_command.rs`) ci ricava l'insieme che pretende di
    /// aver provato. Una famiglia che non finisse qui sparirebbe da entrambi
    /// **restando verde** — e il commento sopra `ALL` diceva che «nascerebbe
    /// negata a tutti, che è il modo giusto di sbagliare, ma va visto»: la prima
    /// metà è vera per costruzione, la seconda non lo era da nessuna parte.
    ///
    /// La lunghezza dichiarata (`[Capability; 16]`) obbliga a **toccare**
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
        assert!(
            Capability::ALL.len() <= u16::BITS as usize,
            "`CapabilitySet` tiene le famiglie in un `u16`, e con la 0095 i bit \
             sono finiti esattamente: la diciassettesima vuole un `u32`, e \
             senza questa riga se ne accorgerebbe `1 << cap` andando in \
             overflow — in debug con un panic, in release in silenzio."
        );
    }
}
