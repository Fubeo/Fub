//! [`Guard`]: il rifiuto, scritto una volta sola.
//!
//! Una politica dice **di quali famiglie** un host può servirsi; il guard
//! avvolge un host qualsiasi e la fa rispettare. È il punto di applicazione che
//! il §7.3 cercava, e il posto dove atterrano le combinazioni che i permessi
//! chiedono senza che nessuna di esse costi una impl in più.

use std::sync::Arc;

use fub_abi::command::{CommandOutcome, Undone};
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::format::DocumentFormat;
use fub_abi::locale::Locale;
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::net::{HttpRequest, HttpResponse};
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

/// Le diciannove famiglie di capacità [conta: guard-famiglie], come nomi su
/// cui una politica risponde.
///
/// Sono i sedici trait di `fub_abi::traits` **più tre**, e non è una
/// duplicazione: là sono ciò che un host **sa fare**, qui ciò che gli si
/// **concede**. Le due liste devono coprire le stesse cose, e il presidio è
/// che [`Guard`] non compila se un trait non è coperto.
///
/// # Perché diciannove e non quattordici
///
/// Per tredici trait su sedici la corrispondenza è uno a uno, ed era vera
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
///
/// [`HostQuery`] ne porta **due** dalla
/// [0096](../../../docs/decisions/0096-una-bozza-non-e-una-nota.md), e per una
/// ragione diversa da quella di [`HostEnv`]: là le tre cose escono insieme da
/// un record, qui escono da **richieste diverse** — una [`IndexQuery`] nomina
/// già la propria famiglia ([`fub_abi::traits::QueryKind`]), e le bozze sono
/// l'unica il cui contenuto non è nel vault. Il cancello guarda quindi *quale*
/// domanda passa, che è la prima volta che il `Guard` legge un argomento invece
/// del solo metodo — vedi [`Guard::query_capability`].
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
    /// Interrogare l'indice — **tranne** le bozze, che hanno la loro.
    Query,
    /// Leggere le **bozze**: ciò che l'utente stava scrivendo e non ha salvato.
    ///
    /// È l'unica famiglia che non copre un trait né un metodo, ma **una
    /// variante di una richiesta**: [`IndexQuery::Drafts`] passa di qui e ogni
    /// altra passa da [`Capability::Query`]. Il taglio è lì perché è lì che sta
    /// la differenza — non fra due canali, ma fra ciò che l'utente ha
    /// consegnato al disco e ciò che non ha ancora deciso di consegnare.
    ///
    /// Sta **al posto** di [`Capability::Query`] e non sopra: chi ha questa e
    /// non quella legge le bozze e nient'altro, che è il pannello di recupero;
    /// chi ha quella e non questa legge tutto il vault e non ciò che si sta
    /// scrivendo adesso. Sono le due frasi che l'utente deve poter dire, e una
    /// famiglia cumulativa ne avrebbe resa inesprimibile la prima.
    Drafts,
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
    /// **Parlare con qualcosa che non sta sul disco** (§23.3).
    ///
    /// È una famiglia il cui permesso dice non solo *se* ma anche **dove**:
    /// `fub:network` porta una allowlist di host, confrontata da
    /// [`Policy::denies_host`]. Le allowlist di prefissi del vault e del
    /// contesto usano invece [`Policy::denies_path`]: host e path hanno domini
    /// e semantiche distinti.
    Network,
    /// Leggere le impostazioni dichiarate (§11.1).
    SettingsRead,
    /// Scrivere quelle che si sono dichiarate scrivibili da un programma.
    SettingsWrite,
    /// Rileggere lo stato di vista del proprio esemplare (§11.2).
    ViewStateRead,
    /// Ricordarlo.
    ViewStateWrite,
    /// **Leggere la sorgente di un import** che l'host tiene aperta (0102).
    ///
    /// L'unica famiglia che non presta niente del vault né della macchina:
    /// presta una cosa sola, quella che l'utente ha appena scelto in un dialogo
    /// di sistema, e la nomina con una chiave che l'host ha timbrato. Per
    /// questo non ha un permesso del manifest — vedi
    /// [`Capability::permission`] — e per questo esiste comunque come famiglia:
    /// una politica deve poterla negare (il safe mode la nega come tutto il
    /// resto), e senza un nome non ci sarebbe niente da negare.
    Transfer,
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
    pub const ALL: [Capability; 19] = [
        Capability::VaultRead,
        Capability::VaultWrite,
        Capability::VaultStructure,
        Capability::DataRead,
        Capability::DataWrite,
        Capability::Query,
        Capability::Drafts,
        Capability::Env,
        Capability::Session,
        Capability::SessionSelection,
        Capability::Events,
        Capability::Commands,
        Capability::Services,
        Capability::Network,
        Capability::SettingsRead,
        Capability::SettingsWrite,
        Capability::ViewStateRead,
        Capability::ViewStateWrite,
        Capability::Transfer,
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
            // Le bozze non stanno sotto `read-vault`, e non è una sfumatura:
            // chi legge il vault legge un documento **che ha nominato**, chi
            // legge le bozze riceve in blocco il testo che l'utente non ha
            // ancora deciso di salvare. È la stessa forma della coppia
            // `read-session`/`read-selection` (0095), applicata al canale dati
            // invece che al contesto — e per la stessa ragione: appoggiarcele
            // renderebbe impossibile la sola cosa che questo permesso esiste
            // per permettere, cioè concedere il vault e negare le bozze.
            Capability::Drafts => Some(permission::READ_DRAFTS),
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
            Capability::Network => Some(permission::NETWORK),
            Capability::SettingsWrite => Some(permission::WRITE_SETTINGS),
            // Leggere la configurazione non ha un permesso, e non è una
            // dimenticanza: uno schema è pubblico per costruzione — sta nel
            // manifest di chi lo dichiara — e questo store non contiene segreti,
            // per regola scritta (`fub_abi::settings`). Ciò che si recinta è
            // la scrittura, e lì i cancelli sono due.
            // Lo stato di vista sta nel proprio recinto come i blob, e per la
            // stessa ragione non è un permesso dichiarabile: quello che si
            // legge e si scrive è già solo il proprio.
            // Leggere la sorgente di un import non è un permesso, e qui la
            // ragione è più forte che altrove: il recinto **è già stato
            // disegnato dall'utente**, e non da noi. Ha scelto quel file in un
            // dialogo di sistema un istante fa; l'handle nomina quello e
            // nient'altro, e nessuno può fabbricarne uno. Un `fub:read-source`
            // nel manifest chiederebbe una seconda volta della stessa cosa —
            // che è il modo di rendere i permessi rumore, cioè di far dire di
            // sì senza guardare anche a quelli che contano.
            Capability::Transfer
            | Capability::ViewStateRead
            | Capability::ViewStateWrite
            | Capability::DataRead
            | Capability::DataWrite
            | Capability::Env
            | Capability::Events
            | Capability::SettingsRead => None,
        }
    }

    /// Questa famiglia **cambia il vault dell'utente**?
    ///
    /// Sono le due della scrittura — il testo di un documento e la struttura —
    /// e non ogni famiglia il cui nome contiene `Write`: i propri blob, la
    /// configurazione e lo stato di vista cambiano cose che il vault non
    /// contiene, e chi le confondesse chiederebbe `write-settings` per
    /// annullare una rinomina.
    ///
    /// Il `match` è **esaustivo di proposito**, e senza un `_`: una famiglia
    /// nuova non compila finché qualcuno non ha detto se il vault lo tocca. Con
    /// un ramo di scarto atterrerebbe su `false` restando verde, e il cancello
    /// di [`HostCommands::undo_last`], che è l'unico posto che questa domanda la
    /// fa, tornerebbe silenziosamente più largo di quello che aveva ammesso
    /// l'operazione.
    pub fn writes_the_vault(self) -> bool {
        match self {
            Capability::VaultWrite | Capability::VaultStructure => true,
            Capability::VaultRead
            | Capability::DataRead
            | Capability::DataWrite
            | Capability::Query
            | Capability::Drafts
            | Capability::Env
            | Capability::Session
            | Capability::SessionSelection
            | Capability::Events
            | Capability::Commands
            | Capability::Services
            | Capability::Network
            | Capability::SettingsRead
            | Capability::SettingsWrite
            | Capability::ViewStateRead
            | Capability::ViewStateWrite
            | Capability::Transfer => false,
        }
    }
}

/// Chi decide quali famiglie un host può servire.
///
/// Una politica è **piccola per costruzione**: risponde a diciannove nomi [conta: guard-famiglie]
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

    /// La ragione per cui questo documento è fuori dal recinto di path, o `None`.
    ///
    /// È deliberatamente distinta da [`Policy::denies_host`]: i path si
    /// confrontano per segmento dentro la radice del vault, non per nome.
    /// Il parametro identifica la porta (lettura, scrittura, sessione o bozza).
    fn denies_path(&self, _cap: Capability, _path: &str) -> Option<String> {
        None
    }

    /// La ragione per cui questo host è fuori dal recinto, o `None`.
    ///
    /// Gli host si confrontano per nome nello spazio pubblico; non condividono
    /// la semantica dei prefissi di path.
    fn denies_host(&self, _host: &str) -> Option<String> {
        None
    }
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

    fn denies_path(&self, cap: Capability, path: &str) -> Option<String> {
        self.0
            .denies_path(cap, path)
            .or_else(|| self.1.denies_path(cap, path))
    }

    fn denies_host(&self, host: &str) -> Option<String> {
        self.0
            .denies_host(host)
            .or_else(|| self.1.denies_host(host))
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
            // **Una `DryRun` che scarica non è una simulazione**, ed è la
            // stessa ragione dei servizi qui sotto vista da fuori: un servizio
            // può uscire dalla simulazione perché gira con le capacità di chi
            // lo offre, una richiesta di rete perché l'effetto **non è
            // nell'host**. Un `POST` crea qualcosa dall'altra parte, e perfino
            // un `GET` viene contato, fatturato e registrato da chi risponde:
            // sono le sole cose che questo processo non può ritirare nemmeno
            // volendo. `run_command` invece passa, perché il comando invocato
            // riceve a sua volta un host simulato — e questa è la differenza
            // esatta: una catena che l'host governa contro un mondo che non
            // conosce.
            | Capability::Network
            // Un servizio di un altro plugin può **scrivere**, e girerebbe con
            // le capacità di CHI LO OFFRE: un dry-run che potesse chiamarlo
            // avrebbe una scala per uscire dalla simulazione. `run_command`
            // invece passa, perché il comando invocato riceve a sua volta un
            // host simulato — è la differenza fra una catena che l'host governa
            // e una superficie che non conosce.
            | Capability::Services => Some(self.why.to_string()),
            Capability::VaultRead
            // Leggere la sorgente di un import non è un effetto — è una
            // lettura, e di una cosa che nel vault non è nemmeno entrata. Una
            // preview della decisione 0006 è **esattamente** una simulazione, e
            // negarla qui vorrebbe dire che il piano di una migrazione non può
            // essere calcolato senza farla.
            | Capability::Transfer
            | Capability::DataRead
            | Capability::Query
            // Rileggere ciò che si stava scrivendo non è un effetto, come non
            // lo è nessun'altra lettura: una simulazione che non vedesse le
            // bozze direbbe cosa farebbe su un vault diverso da quello che
            // l'utente ha davanti. È il permesso a decidere chi le vede, non la
            // modalità.
            | Capability::Drafts
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
    /// Gli host a cui `fub:network` consente di connettersi, se ne ha
    /// dichiarati.
    ///
    /// `None` = il permesso c'è **senza parametro**, cioè *qualunque host* —
    /// la regola uniforme di [`OptionMap`](fub_abi::options): presente =
    /// acceso, il valore è il parametro. Non è la regola comoda per questa
    /// chiave, e c'è stata la tentazione di ribaltarla («senza elenco, nessun
    /// host»); ribaltarla avrebbe reso `network` **l'unica chiave del contratto
    /// la cui assenza di parametro significa il contrario che altrove**, cioè
    /// avrebbe rotto la sola proprietà per cui una mappa sola governa quattro
    /// sedi: chi ne impara una le sa tutte. Ciò che l'utente vede resta
    /// diverso, ed è lì che deve esserlo — «può connettersi a qualunque host»
    /// non è la stessa frase di «può connettersi a api.acme.com».
    ///
    /// I significati sono **tre**, e il terzo è quello che si scopre sbagliando:
    /// `None` = qualunque host; `Some(elenco)` = quegli host; `Some(vuoto)` = un
    /// parametro che c'è e non è un elenco di host, cioè **nessun** host. Il
    /// terzo esiste perché senza di lui un manifest scritto male —
    /// `"fub:network": "api.acme.com"`, la stringa invece dell'elenco — cadeva
    /// nel primo: un errore di battitura che *intende restringere* apriva a
    /// tutto, in silenzio. Un parametro illeggibile non è l'assenza di un
    /// parametro, e le due cose non possono avere la stessa risposta.
    ///
    /// Un `Arc` perché [`Granted`] si clona a ogni prestito, e l'elenco è dello
    /// stesso manifest per tutta la vita del montaggio.
    network: Option<Arc<[Box<str>]>>,
    /// Prefissi di documento per le letture, o `None` senza parametro.
    read_paths: Option<Arc<[Box<str>]>>,
    /// Prefissi di documento per le scritture, o `None` senza parametro.
    write_paths: Option<Arc<[Box<str>]>>,
    /// Prefissi di documento per le bozze e il contesto di sessione.
    draft_paths: Option<Arc<[Box<str>]>>,
    session_paths: Option<Arc<[Box<str>]>>,
    selection_paths: Option<Arc<[Box<str>]>>,
    /// `None` = il plugin non è dichiarato affatto, che è un no diverso da
    /// «non ha quel permesso» e va detto diverso.
    trust: Option<Trust>,
}

/// Le famiglie concesse, come insieme.
///
/// Diciotto bit in un `u32`, ed era un `u16` fino alla diciassettesima
/// famiglia. Il numero sta scritto perché è il conto che ha già morso una
/// volta: se qui e in [`Capability::ALL`] non dicono la stessa cosa, la riga da
/// credere è `ALL`.
///
/// **È il primo limite strutturale che questo elenco abbia incontrato**, e vale
/// la pena che resti scritto: con la 0095 le famiglie erano diventate sedici,
/// cioè esattamente i bit disponibili, e la 0096 le ha portate a diciassette.
/// Senza questo cambio `1 << cap` sarebbe andato in overflow — in debug con un
/// panic, in release **in silenzio**, cioè con una famiglia concessa a chi non
/// l'aveva dichiarata. A vederlo è stato l'`assert` in coda a
/// `the_discriminants_cover_every_family`, scritto quando i bit erano appena
/// finiti e proprio perché finivano: il presidio ha fatto il suo mestiere una
/// riga prima del danno.
///
/// Un `u32` regge fino a trentadue famiglie, e la stessa riga se ne accorgerà
/// di nuovo. Il tipo largo è la forma che rende [`Granted`] clonabile senza
/// allocare, ed è anche il motivo per cui [`Capability`] è un enum piccolo e
/// chiuso invece di una stringa — e per cui i suoi discriminanti devono restare
/// contigui, che è ciò che presidia `the_discriminants_cover_every_family`.
///
/// Che l'insieme non si **persista** da nessuna parte è ciò che ha reso questo
/// cambio meccanico: si ricalcola da [`Capability::ALL`] a ogni registrazione,
/// quindi allargare il tipo non ha una migrazione dietro. Se un giorno lo si
/// salvasse su disco, quella proprietà se ne andrebbe con la prima riga.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CapabilitySet(u32);

impl CapabilitySet {
    pub fn contains(self, cap: Capability) -> bool {
        self.0 & (1 << cap as u32) != 0
    }

    pub fn with(mut self, cap: Capability) -> Self {
        self.0 |= 1 << cap as u32;
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
        // L'allowlist si legge **una volta**, qui, e non a ogni richiesta: è la
        // stessa ragione per cui le famiglie diventano una maschera invece di
        // restare una mappa da interrogare.
        //
        // Si legge il valore **grezzo** e non `as_strings`, che appiattisce su
        // un elenco vuoto tre cose diverse — assente, vuoto, malformato — e qui
        // la terza deve fallire chiusa invece di confondersi con la prima. Vedi
        // il campo `network`.
        let network = match permissions.granted.get(permission::NETWORK) {
            // Assente, o acceso senza parametro: qualunque host.
            None | Some(serde_json::Value::Bool(_)) | Some(serde_json::Value::Null) => None,
            // Un elenco vuoto è un parametro che dice «non restringo», ed è la
            // regola uniforme della mappa: presente = acceso. Ci si appoggia la
            // UI dei permessi, che per questo mostra e non edita.
            Some(serde_json::Value::Array(items)) if items.is_empty() => None,
            Some(serde_json::Value::Array(items)) => Some(
                items
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(normalized_host)
                    .collect(),
            ),
            // Un parametro che non è un elenco: recinto che non nomina nessuno.
            Some(_) => Some(Arc::from([])),
        };
        let read_paths = path_allowlist(permissions, permission::READ_VAULT);
        let write_paths = path_allowlist(permissions, permission::WRITE_VAULT);
        let draft_paths = path_allowlist(permissions, permission::READ_DRAFTS);
        let session_paths = path_allowlist(permissions, permission::READ_SESSION);
        let selection_paths = path_allowlist(permissions, permission::READ_SELECTION);
        Granted {
            plugin: Arc::from(plugin),
            allowed,
            network,
            read_paths,
            write_paths,
            draft_paths,
            session_paths,
            selection_paths,
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
            network: None,
            read_paths: None,
            write_paths: None,
            draft_paths: None,
            session_paths: None,
            selection_paths: None,
            trust: None,
        }
    }

    /// Le famiglie concesse: è ciò che l'inventario del §7.6 mostrerebbe se
    /// qualcuno volesse vedere i permessi già risolti invece che dichiarati.
    pub fn allowed(&self) -> CapabilitySet {
        self.allowed
    }
}

/// Un host come lo si confronta: minuscolo, senza il punto finale della forma
/// assoluta del DNS.
///
/// Non fa altro, e in particolare **non fa punycode**: `xn--acme-...` e il nome
/// scritto in unicode resterebbero due stringhe diverse. È un limite vero e sta
/// scritto invece che scoperto — chi dichiara un host internazionalizzato lo
/// dichiara nella forma in cui l'URL lo porterà.
fn normalized_host(host: &str) -> Box<str> {
    host.trim()
        .trim_end_matches('.')
        .to_ascii_lowercase()
        .into_boxed_str()
}

/// Legge un elenco di prefissi: assente o vuoto significa vault intero.
fn path_allowlist(permissions: &PluginPermissions, key: &str) -> Option<Arc<[Box<str>]>> {
    match permissions.granted.get(key) {
        None | Some(serde_json::Value::Bool(_)) | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::Array(items)) if items.is_empty() => None,
        Some(serde_json::Value::Array(items)) if items.iter().all(|v| v.as_str().is_some()) => {
            Some(Arc::from(
                items
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(|path| folders::normalized(path).to_owned().into_boxed_str())
                    .collect::<Vec<_>>(),
            ))
        }
        Some(_) => Some(Arc::from([])),
    }
}

impl Granted {
    /// L'host di questa allowlist copre `target`?
    ///
    /// Due forme, e la seconda è quella che rende la prima sicura:
    ///
    /// - `api.acme.com` copre **esattamente** `api.acme.com`;
    /// - `*.acme.com` copre ogni sottodominio *proprio* — `api.acme.com` sì,
    ///   `acme.com` no, e `evil-acme.com` **no**.
    ///
    /// La seconda riga è il difetto che una `ends_with` nuda avrebbe: chi
    /// dichiara `acme.com` sperando nei sottodomini si ritroverebbe a coprire
    /// `evil-acme.com`, che è un dominio di qualcun altro. Il carattere `*` è
    /// obbligatorio proprio perché *«voglio anche i sottodomini»* sia una cosa
    /// che si dice invece di una che succede.
    fn covers(pattern: &str, target: &str) -> bool {
        match pattern.strip_prefix("*.") {
            Some(suffix) => {
                target.len() > suffix.len() + 1 && target.ends_with(&format!(".{suffix}"))
            }
            None => pattern == target,
        }
    }
}

impl Policy for Granted {
    fn denies_path(&self, cap: Capability, path: &str) -> Option<String> {
        let allowed = match cap {
            Capability::VaultRead => &self.read_paths,
            Capability::Query => return None,
            Capability::VaultWrite | Capability::VaultStructure => &self.write_paths,
            Capability::Drafts => &self.draft_paths,
            Capability::Session => &self.session_paths,
            Capability::SessionSelection => &self.selection_paths,
            _ => return None,
        };
        match allowed {
            None => None,
            Some(prefixes) if prefixes.iter().any(|prefix| folders::contains(prefix, path)) => None,
            Some(prefixes) if prefixes.is_empty() => Some(format!(
                "the path parameter of `{}` is not a list of folders, and until it is one it reads nothing — `{path}` included",
                cap.permission().unwrap_or("the capability")
            )),
            Some(prefixes) => Some(format!(
                "`{}` does not allow `{path}` (allowed prefixes: `{}`)",
                self.plugin,
                prefixes.join("`, `")
            )),
        }
    }

    fn denies_host(&self, host: &str) -> Option<String> {
        let target = normalized_host(host);
        match &self.network {
            None => None,
            Some(allowed) if allowed.iter().any(|p| Granted::covers(p, &target)) => None,
            Some(allowed) if allowed.is_empty() => Some(format!(
                "the `{}` parameter of `{}` is not a list of hosts, and until it is one it connects to nothing — `{target}` included",
                permission::NETWORK,
                self.plugin
            )),
            Some(allowed) => Some(format!(
                "`{}` declared `{}` and not `{target}`",
                self.plugin,
                allowed.join("`, `")
            )),
        }
    }

    fn denies(&self, cap: Capability) -> Option<String> {
        match self.trust {
            None => Some(format!("`{}` non è un plugin dichiarato", self.plugin)),
            Some(trust) if !trust.runs() => Some(format!("`{}` è revocato", self.plugin)),
            Some(_) if self.allowed.contains(cap) => None,
            Some(_) => Some(format!(
                "`{}` non ha dichiarato il permesso `{}`",
                self.plugin,
                cap.permission()
                    .expect("a family denied by permissions has one")
            )),
        }
    }
}

/// Un host con una politica davanti.
///
/// Delega ciò che la politica concede e nega il resto. Le diciannove famiglie [conta: guard-famiglie]
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

    fn check_path(
        &self,
        cap: Capability,
        path: &str,
        what: impl FnOnce() -> String,
    ) -> Result<(), PluginError> {
        let action = what();
        self.check(cap, || action.clone())?;
        if let Some(why) = self.policy.denies_path(cap, path) {
            return Err(PluginError::PermissionDenied(
                format!("{action}: {why}").into(),
            ));
        }
        Ok(())
    }

    fn allows_path(&self, cap: Capability, path: &str) -> bool {
        self.allows(cap) && self.policy.denies_path(cap, path).is_none()
    }
}

impl<H: VaultRead, P: Policy> VaultRead for Guard<H, P> {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading `{id}`")
        })?;
        self.inner.read_document(id)
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        // Stesso permesso della lettura di testo, e non uno suo: vedi la firma
        // nel contratto — i byte non sono un grado di fiducia in più.
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading bytes of `{id}`")
        })?;
        self.inner.read_document_bytes(id)
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading revision of `{id}`")
        })?;
        self.inner.document_revision(id)
    }

    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        self.check(Capability::VaultRead, || "listing documents".into())?;
        let mut page = self.inner.list_documents(page)?;
        let before = page.items.len();
        page.items.retain(|id| {
            self.policy
                .denies_path(Capability::VaultRead, id.as_str())
                .is_none()
        });
        if page.items.len() != before {
            page.total = page.items.len() as u32;
        }
        Ok(page)
    }

    fn free_name(&self, id: &DocId) -> DocId {
        // Senza esito: la risposta nulla è l'id che è stato passato — «nessun
        // nome è noto come libero». Chi lo usa per creare riceve comunque un
        // rifiuto da `create_document`, che un esito ce l'ha.
        if self.allows_path(Capability::VaultRead, id.as_str()) {
            self.inner.free_name(id)
        } else {
            id.clone()
        }
    }

    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        self.check_path(Capability::VaultRead, id.as_str(), || {
            format!("reading model of `{id}`")
        })?;
        self.inner.read_model(id)
    }

    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        // Senza esito: `None` qui significa già «nessuno lo rivendica», ed è la
        // risposta nulla più vicina al vero che questa firma sappia dare.
        self.allows_path(Capability::VaultRead, id.as_str())
            .then(|| self.inner.format_of(id))
            .flatten()
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        self.check(Capability::VaultRead, || "listing trash".into())?;
        let entries = self
            .inner
            .list_trash()?
            .into_iter()
            .filter(|entry| {
                self.policy
                    .denies_path(Capability::VaultRead, entry.original.as_str())
                    .is_none()
            })
            .collect();
        Ok(entries)
    }
}

impl<H: VaultWrite, P: Policy> VaultWrite for Guard<H, P> {
    fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.check_path(Capability::VaultWrite, id.as_str(), || {
            format!("writing `{id}`")
        })?;
        self.inner.write_document(id, source, base)
    }

    fn apply_edit(&mut self, id: &DocId, request: EditRequest) -> Result<EditReport, PluginError> {
        self.check_path(Capability::VaultWrite, id.as_str(), || {
            format!("editing `{id}`")
        })?;
        self.inner.apply_edit(id, request)
    }
}

impl<H: VaultStructure, P: Policy> VaultStructure for Guard<H, P> {
    fn create_document(&mut self, id: &DocId, source: &str) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, id.as_str(), || {
            format!("creating `{id}`")
        })?;
        self.inner.create_document(id, source)
    }

    fn rename_document(&mut self, from: &DocId, to: &DocId) -> Result<(), PluginError> {
        self.check_path(Capability::VaultStructure, from.as_str(), || {
            format!("renaming `{from}`")
        })?;
        self.check_path(Capability::VaultStructure, to.as_str(), || {
            format!("renaming to `{to}`")
        })?;
        self.inner.rename_document(from, to)
    }

    fn trash_document(&mut self, id: &DocId) -> Result<DocId, PluginError> {
        self.check_path(Capability::VaultStructure, id.as_str(), || {
            format!("trashing `{id}`")
        })?;
        self.inner.trash_document(id)
    }

    fn restore_document(&mut self, entry: &DocId, to: Option<DocId>) -> Result<DocId, PluginError> {
        self.check_path(Capability::VaultStructure, entry.as_str(), || {
            format!("restoring `{entry}`")
        })?;
        if let Some(to) = &to {
            self.check_path(Capability::VaultStructure, to.as_str(), || {
                format!("restoring to `{to}`")
            })?;
        }
        self.inner.restore_document(entry, to)
    }
    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.check(Capability::VaultStructure, || "emptying trash".into())?;
        self.inner.empty_trash()
    }
}

impl<H: DataRead, P: Policy> DataRead for Guard<H, P> {
    fn data_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.check(Capability::DataRead, || format!("reading blob `{path}`"))?;
        self.inner.data_read(path)
    }

    fn data_list(&self, prefix: &str) -> Result<Vec<String>, PluginError> {
        self.check(Capability::DataRead, || "listing blobs".into())?;
        self.inner.data_list(prefix)
    }

    fn cache_read(&self, path: &str) -> Result<Option<Vec<u8>>, PluginError> {
        self.check(Capability::DataRead, || {
            format!("reading cache blob `{path}`")
        })?;
        self.inner.cache_read(path)
    }
}

impl<H: DataWrite, P: Policy> DataWrite for Guard<H, P> {
    fn data_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || format!("writing blob `{path}`"))?;
        self.inner.data_write(path, bytes)
    }

    fn data_remove(&mut self, path: &str) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || format!("removing blob `{path}`"))?;
        self.inner.data_remove(path)
    }

    fn cache_write(&mut self, path: &str, bytes: &[u8]) -> Result<(), PluginError> {
        self.check(Capability::DataWrite, || {
            format!("writing cache blob `{path}`")
        })?;
        self.inner.cache_write(path, bytes)
    }
}

impl<H: SettingsRead, P: Policy> SettingsRead for Guard<H, P> {
    fn setting(&self, key: &str) -> Result<SettingValue, PluginError> {
        self.check(Capability::SettingsRead, || {
            format!("reading setting `{key}`")
        })?;
        self.inner.setting(key)
    }
}

impl<H: SettingsWrite, P: Policy> SettingsWrite for Guard<H, P> {
    fn set_setting(&mut self, key: &str, value: SettingValue) -> Result<(), PluginError> {
        self.check(Capability::SettingsWrite, || {
            format!("writing setting `{key}`")
        })?;
        self.inner.set_setting(key, value)
    }

    fn reset_setting(&mut self, key: &str) -> Result<(), PluginError> {
        self.check(Capability::SettingsWrite, || {
            format!("resetting setting `{key}`")
        })?;
        self.inner.reset_setting(key)
    }
}

impl<H: ViewStateRead, P: Policy> ViewStateRead for Guard<H, P> {
    fn view_state(&self, key: &str) -> Result<Option<serde_json::Value>, PluginError> {
        self.check(Capability::ViewStateRead, || {
            format!("re-reading view state `{key}`")
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
            format!("writing view state `{key}`")
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
        // **Il solo metodo del `Guard` con due cancelli**, e li ha perché
        self.check(Capability::Env, || format!("requesting {n} random bytes"))?;
        self.inner.random_bytes(n)
    }

    fn active_context(&self) -> Option<ViewContext> {
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
        // Senza esito: il silenzio è il no. Un `DocumentChanged` emesso da una
        let mut context = self
            .allows(Capability::Session)
            .then(|| self.inner.active_context())
            .flatten()?;
        if context.doc.as_ref().is_some_and(|doc| {
            self.policy
                .denies_path(Capability::Session, doc.as_str())
                .is_some()
        }) {
            return None;
        }
        if context
            .doc
            .as_ref()
            .is_none_or(|doc| !self.allows_path(Capability::SessionSelection, doc.as_str()))
        {
            context.selections = None;
        }
        Some(context)
    }
}

impl<H: HostEvents, P: Policy> HostEvents for Guard<H, P> {
    fn emit(&mut self, event: Event) {
        // simulazione farebbe ricaricare l'editor su una modifica che non è
        // avvenuta.
        // Quale famiglia governa **questa** domanda, e cosa si stava facendo.
        if self.allows(Capability::Events) {
            self.inner.emit(event);
        }
    }

    fn spawn_job(&mut self, spec: JobSpec) -> Result<JobId, PluginError> {
        self.check(Capability::Events, || "spawning a job".into())?;
        self.inner.spawn_job(spec)
    }
}

impl<H: HostQuery, P: Policy> HostQuery for Guard<H, P> {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        let (cap, what) = Guard::<H, P>::query_capability(&query.kind());
        self.check(cap, || what.into())?;
        let result = self.inner.query_index(query)?;
        if cap == Capability::Drafts {
            if let IndexResult::Drafts(mut page) = result {
                let before = page.items.len();
                page.items.retain(|draft| {
                    self.policy
                        .denies_path(Capability::Drafts, draft.doc.as_str())
                        .is_none()
                });
                if page.items.len() != before {
                    page.total = page.items.len() as u32;
                }
                return Ok(IndexResult::Drafts(page));
            }
        }
        Ok(result)
    }
}

impl<H, P: Policy> Guard<H, P> {
    ///
    /// Il `match` è **esaustivo di proposito**, e senza un `_`: una famiglia di
    /// query nuova non compila finché qualcuno non ha detto sotto quale
    /// permesso passa. Con un ramo di scarto la variante nuova sarebbe
    /// atterrata su [`Capability::Query`] restando verde — che è esattamente il
    /// modo in cui [`IndexQuery::Drafts`] ci è atterrata, e ci è restata per
    /// otto verbali.
    ///
    /// È anche il primo punto in cui il `Guard` legge un **argomento** e non
    /// solo il metodo. Non spacca il canale dati della
    /// [0019](../../../docs/decisions/0019-il-canale-dati.md) — resta una
    /// domanda sola con un instradamento solo — e non allarga la [`Policy`],
    /// che continua a rispondere a nomi e a non sapere niente di query: è la
    /// stessa mossa di `undo_last`, che da un metodo ricava più famiglie perché
    /// più d'una sono le cose che fa.
    // **Due cancelli**, e non è pignoleria. Annullare è invocare — i passi
    fn query_capability(kind: &fub_abi::traits::QueryKind) -> (Capability, &'static str) {
        use fub_abi::traits::QueryKind;
        match kind {
            QueryKind::Drafts => (Capability::Drafts, "reading drafts"),
            QueryKind::Documents
            | QueryKind::Backlinks
            | QueryKind::Outline
            | QueryKind::Tags
            | QueryKind::Neighbors
            | QueryKind::PropertyValues
            | QueryKind::VaultHealth
            | QueryKind::Custom(_)
            | QueryKind::VaultStatus
            | QueryKind::Jobs
            | QueryKind::Settings
            | QueryKind::Organization
            | QueryKind::Resolve
            | QueryKind::Entries
            | QueryKind::Folders
            | QueryKind::RenderPreview
            | QueryKind::RenderEmbed
            | QueryKind::SyntaxForms => (Capability::Query, "querying the index"),
        }
    }
}

impl<H: HostCommands, P: Policy> HostCommands for Guard<H, P> {
    fn run_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        self.check(Capability::Commands, || format!("invoking `{command}`"))?;
        self.inner.run_command(command, args)
    }

    fn undo_last(&mut self) -> Result<Option<Undone>, PluginError> {
        // di un annullamento sono per metà comandi — ma è anche, sempre e per
        // definizione, **scrivere**: e ciò che scrive non passa dal recinto del
        // chiamante, perché a eseguirlo è il kernel. Senza il secondo un host di
        // sola lettura avrebbe una scala per riscrivere il vault, e un plugin
        // senza `write-vault` un modo di disfare il lavoro di qualcuno.
        //
        // # Il secondo cancello non è più largo di quello che ha ammesso l'operazione
        //
        // Chiedeva [`Capability::VaultWrite`] e basta, cioè *il testo di un
        // documento*, mentre i passi che sta per far girare disfano ciò che una
        // rinomina, una creazione o un cestinamento avevano fatto — e quelle
        // sono passate da [`Capability::VaultStructure`]. Chi aveva il permesso
        // per una sola delle due famiglie disfaceva anche l'altra: il cancello
        // dell'annullamento era più largo di quello dell'operazione, il che è il
        // solo modo in cui un recinto può perdere restando scritto.
        //
        // La specie **qui non si sa**, e non è una svista di questa riga: la
        // pila è privata del kernel (vedi
        // [`HostCommands::undo_last`](fub_abi::traits::HostCommands::undo_last)),
        // il `Guard` sta davanti a un host e non dentro, e la voce in cima la
        // vede solo chi la esegue. Non sapendo quale delle due sia, si chiedono
        // **tutte e due**: un cancello che indovina è un cancello che sbaglia
        // metà delle volte, e la metà in cui sbaglia lascia passare. Il prezzo è
        // per chi avesse una delle due famiglie e non l'altra — che oggi non è
        // nessuno, perché `write-vault` le concede insieme
        // ([`Capability::permission`]) e `ReadOnly` le nega insieme.
        //
        // L'elenco non è scritto qui: lo dà [`Capability::writes_the_vault`], il
        // cui `match` esaustivo obbliga una famiglia nuova a dichiararsi. Così
        // il giorno che il vault avesse una terza specie di scrittura, questo
        // cancello la eredita senza che nessuno se ne debba ricordare.
        // Un cancello solo: *dove* qui non si pone, perché un handle non nomina un
        // posto che si possa scegliere — nomina la sorgente che l'host ha aperto.
        self.check(Capability::Commands, || "undoing".into())?;
        for cap in Capability::ALL.into_iter().filter(|c| c.writes_the_vault()) {
            self.check(cap, || "undoing".into())?;
        }
        self.inner.undo_last()
    }
}

impl<H: TransferRead, P: Policy> TransferRead for Guard<H, P> {
    /// È la differenza con `fub:network`, che di cancelli ne ha due.
    /// **Due cancelli, e il secondo è il primo parametro di permesso che questo
    /// repo legge.** La famiglia dice *se*, l'allowlist dice *dove*, e senza il
    fn read_source(
        &self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        self.check(Capability::Transfer, || "reading import source".to_string())?;
        self.inner.read_source(handle, offset, len)
    }
}

impl<H: HostNetwork, P: Policy> HostNetwork for Guard<H, P> {
    /// secondo il permesso prometterebbe una cosa che non fa — che è la
    /// differenza fra un recinto che perde e una frase falsa scritta dall'app.
    ///
    /// L'ordine conta e non è indifferente: prima la famiglia, così chi non ha
    /// `fub:network` legge *«non hai dichiarato il permesso»* e non un elenco
    /// di host che non lo riguarda.
    ///
    /// L'URL si legge **qui e una volta sola**. Non c'è un campo `host` accanto
    /// nella richiesta apposta: due posti in cui è scritto dove si va sono due
    /// posti che possono non essere d'accordo, e chi controlla ne guarderebbe
    /// uno solo.
    // Lo schema si guarda **dopo** i permessi, perché «non ti è concesso»
    // è una frase più utile di «l'URL è fatto male» a chi ha sbagliato
    fn fetch(&self, request: HttpRequest) -> Result<HttpResponse, PluginError> {
        let (scheme, host) = split_url(&request.url)?;
        self.check(Capability::Network, || format!("connecting to `{host}`"))?;
        if let Some(why) = self.policy.denies_host(&host) {
            return Err(PluginError::PermissionDenied(
                format!("connecting to `{host}`: {why}").into(),
            ));
        }
        // tutte e due.
        // Lo schema e l'host di un URL, senza tirarsi dietro un parser di URL.
        //
        if scheme != "https" && !is_loopback(&host) {
            return Err(PluginError::BadArgs(
                format!(
                    "`{scheme}` is not `https`: in plaintext the allowlist promises one \
                     host and the network delivers another. The local loop is an \
                     exception, because there is no network to traverse"
                )
                .into(),
            ));
        }
        self.inner.fetch(request)
    }

    fn fetch_cancelled(
        &self,
        request: HttpRequest,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<HttpResponse, PluginError> {
        let (scheme, host) = split_url(&request.url)?;
        self.check(Capability::Network, || format!("connecting to `{host}`"))?;
        if let Some(why) = self.policy.denies_host(&host) {
            return Err(PluginError::PermissionDenied(
                format!("connecting to `{host}`: {why}").into(),
            ));
        }
        if scheme != "https" && !is_loopback(&host) {
            return Err(PluginError::BadArgs(
                format!(
                    "`{scheme}` is not `https`: in plaintext the allowlist promises one \
                     host and the network delivers another. The local loop is an \
                     exception, because there is no network to traverse"
                )
                .into(),
            ));
        }
        self.inner.fetch_cancelled(request, cancelled)
    }
}

/// Fa **una** cosa e la fa stretta: quello che serve al cancello è dove si va,
/// e dove si va sta fra `://` e il primo `/`, `?` o `#`, meno le credenziali e
/// meno la porta. Ciò che questa funzione non sa fare — normalizzare i percorsi,
/// decodificare le sequenze percentuali, capire l'IDN — non le serve, perché non
/// costruisce l'URL: lo legge chi poi si connetterà davvero, e il cancello
/// guarda la stessa stringa.
///
/// Le credenziali (`user:pass@`) si scartano ed è la riga che conta: senza,
/// `https://api.acme.com@evil.example/` avrebbe un «host» che comincia con un
/// nome dichiarato e finisce su una macchina di qualcun altro. È il modo più
/// vecchio di far leggere a un umano un indirizzo e a una macchina un altro.
// Dopo l'ultima `@` c'è l'host: prima ci sono le credenziali.
// IPv6 letterale: `[::1]:8080`.
fn split_url(url: &str) -> Result<(String, String), PluginError> {
    let malformed =
        || PluginError::BadArgs(format!("`{url}` is not a readable absolute URL").into());
    let (scheme, rest) = url.split_once("://").ok_or_else(malformed)?;
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .filter(|a| !a.is_empty())
        .ok_or_else(malformed)?;
    // L'host è **questa macchina**?
    let hostport = authority.rsplit('@').next().unwrap_or(authority);
    let host = match hostport.strip_prefix('[') {
        //
        Some(inside) => inside.split(']').next().unwrap_or(inside),
        None => hostport.split(':').next().unwrap_or(hostport),
    };
    if host.is_empty() {
        return Err(malformed());
    }
    Ok((
        scheme.trim().to_ascii_lowercase(),
        normalized_host(host).into_string(),
    ))
}

/// Serve a una regola sola e vale la pena scriverla: `http` in chiaro è
/// rifiutato ovunque tranne qui, perché un modello che gira sul computer di chi
/// usa l'app — `http://localhost:11434` — non attraversa nessuna rete, e
/// pretendere TLS verso sé stessi vorrebbe dire escludere dal contratto
/// l'unico modo di usare l'AI senza mandare le proprie note a qualcuno.
///
/// L'indirizzo si **parsa**, e non si confronta come testo: `127.` come prefisso
/// di stringa non è una famiglia di indirizzi, è una famiglia di *nomi*.
/// `127.0.0.1.evil.example` è un nome registrabile — la prima etichetta di un
/// dominio può cominciare con una cifra — e con un `starts_with` si prendeva
/// l'esenzione di questa funzione: `http` in chiaro verso la macchina di
/// qualcun altro, cioè esattamente l'unica cosa che la regola esiste per
/// impedire. Chi è loopback lo dice [`IpAddr`](std::net::IpAddr), che quel
/// conto lo sa fare per `127.0.0.0/8` e per `::1` insieme; `localhost` resta a
/// parte perché è un nome, non un indirizzo.
// ---------------------------------------------------------------------------
/// Una politica che nega una famiglia sola: serve a provare il cancello di
fn is_loopback(host: &str) -> bool {
    host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

impl<H: HostServices, P: Policy> HostServices for Guard<H, P> {
    fn call_service(
        &mut self,
        service: &str,
        method: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        self.check(Capability::Services, || {
            format!("calling `{service}.{method}`")
        })?;
        self.inner.call_service(service, method, args)
    }
}

// [`Capability::Env`], che `ReadOnly` **concede** — leggere che ore sono

#[cfg(test)]
mod tests {
    use super::*;

    /// non è un effetto — e che quindi il presidio delle capacità simulate non
    /// esercita.
    /// Un host che concede entropia a chiunque gliela chieda: ciò che si prova
    /// qui è il cancello, non ciò che sta dietro.
    struct Negate(Capability);

    impl Policy for Negate {
        fn denies(&self, cap: Capability) -> Option<String> {
            (cap == self.0).then(|| "for testing".to_string())
        }
    }

    /// Un host che un contesto ce l'ha, con dentro una nota e del testo
    /// selezionato: è il solo modo di provare che il cancello della selezione
    struct Generous;

    impl HostEnv for Generous {
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

    /// taglia **un campo** e non la risposta intera.
    /// **La leva che la 0095 esiste per dare**: il vault concesso, la nota
    /// concessa, il testo no.
    struct WithContext;

    impl HostEnv for WithContext {
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

    ///
    /// È il caso del diario — «sai che nota guardo, non sai cosa ci sto
    /// scrivendo» — e non sarebbe stato esprimibile appoggiando la selezione a
    /// `read-vault`, che è la strada che la §23.5 raccomandava per prima:
    /// negarla lì avrebbe reso il plugin cieco sul vault, cioè avrebbe tolto
    /// all'utente proprio la scelta fine.
    /// L'altro cancello, quello grosso: senza `Session` non c'è contesto, e con
    /// lui se ne va anche il testo — che è dentro, e senza un contesto non ha
    #[test]
    fn denying_the_selection_leaves_the_notes_visible() {
        let guard = Guard::new(WithContext, Negate(Capability::SessionSelection));
        let context = guard
            .active_context()
            .expect("denying the selection does not deny the context");
        assert_eq!(
            context.doc,
            Some(DocId::new("Diario/2026-08-04.md")),
            "which note I am looking at stays granted: it is the other permission"
        );
        assert!(
            context.selections.is_none(),
            "the selected text must not come through: {:?}",
            context.selections
        );
    }

    /// dove stare.
    /// Il cancello dell'orologio non è più quello della sessione, ed è **tutta
    /// la voce**: prima erano la stessa famiglia, quindi negare il testo
    #[test]
    fn denying_the_session_takes_the_selection_with_it() {
        let guard = Guard::new(WithContext, Negate(Capability::Session));
        assert!(
            guard.active_context().is_none(),
            "without `Session` the answer is that of a host without a shell"
        );
    }

    /// selezionato voleva dire negare che ore sono.
    /// Il caso negato **dice di essere negato**, e non rende il vuoto.
    ///
    #[test]
    fn the_clock_and_the_session_are_no_longer_the_same_gate() {
        let no_session = Guard::new(WithContext, Negate(Capability::Session));
        assert_eq!(
            no_session.now_unix_millis(),
            0,
            "the clock belongs to the machine: denying the session does not touch it"
        );
        let no_clock = Guard::new(WithContext, Negate(Capability::Env));
        assert!(
            no_clock.active_context().is_some(),
            "and vice versa: denying the clock does not deny which note is open"
        );
    }

    /// Era l'unico fallback muto del `Guard` che mentiva: un `Vec` vuoto arriva
    /// a chi chiama identico al troncamento sopra il tetto, e i due si
    /// correggono in modi opposti — chiedere meno serve in un caso e non serve
    /// a niente nell'altro (§23.12, decisione 0094). Un `assert` sulla
    /// lunghezza sarebbe passato anche prima: solo la variante lo presidia.
    /// Negare un'altra famiglia non tocca questa: il cancello è per famiglia, e
    /// un `check` sulla capacità sbagliata passerebbe di qui rosso.
    #[test]
    fn session_context_honors_its_document_prefix() {
        let permissions = PluginPermissions {
            granted: [
                (permission::READ_SESSION, serde_json::json!(["Diario"])),
                (permission::READ_SELECTION, serde_json::json!(["Diario"])),
            ]
            .into_iter()
            .collect(),
        };
        let guard = Guard::new(
            WithContext,
            Granted::new("p", &permissions, Trust::Community),
        );
        assert!(guard.active_context().is_some());

        let permissions = PluginPermissions {
            granted: [(permission::READ_SESSION, serde_json::json!(["Progetti"]))]
                .into_iter()
                .collect(),
        };
        let guard = Guard::new(
            WithContext,
            Granted::new("p", &permissions, Trust::Community),
        );
        assert!(guard.active_context().is_none());
    }

    #[test]
    fn denied_entropy_says_so_instead_of_answering_empty() {
        let guard = Guard::new(Generous, Negate(Capability::Env));
        let err = guard
            .random_bytes(16)
            .expect_err("without `Env` entropy is not granted");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "the refusal must name the permission: {err}"
        );
        assert!(
            err.message().to_string().contains("16"),
            "and it must say what was being done: {err}"
        );
    }

    /// Un host che annulla e basta: ciò che si prova qui è il cancello, non ciò
    /// che sta dietro. Un `undo_last` arrivato fin qui è un annullamento
    #[test]
    fn a_different_denial_leaves_entropy_alone() {
        let guard = Guard::new(Generous, Negate(Capability::VaultWrite));
        assert_eq!(guard.random_bytes(4).unwrap().len(), 4);
    }

    /// **eseguito**, ed è esattamente ciò che i banchi qui sotto pretendono di
    /// vedere o di non vedere.
    /// **Disfare chiede lo stesso permesso di fare.**
    ///
    struct Undoes;

    impl HostCommands for Undoes {
        fn run_command(
            &mut self,
            _command: &str,
            _args: serde_json::Value,
        ) -> Result<CommandOutcome, PluginError> {
            unreachable!("no bench in this module invokes a command")
        }

        fn undo_last(&mut self) -> Result<Option<Undone>, PluginError> {
            Ok(Some(Undone::whole(fub_abi::text::Text::Literal(
                "the rename".into(),
            ))))
        }
    }

    /// La voce in cima alla pila può essere l'inverso di una rinomina, di una
    /// creazione o di un cestinamento — cose che sono passate da
    /// [`Capability::VaultStructure`] — e il cancello dell'annullamento chiedeva
    /// la sola [`Capability::VaultWrite`]: chi aveva il permesso di riscrivere
    /// il testo di una nota poteva disfare un trasloco che non avrebbe potuto
    /// fare. Un recinto che perde restando scritto è il difetto peggiore che un
    /// recinto possa avere, perché nessuno lo va a rileggere.
    /// L'altra metà, che è ciò che rende il banco qui sopra una misura e non un
    /// divieto: con le famiglie della scrittura concesse l'annullamento arriva
    #[test]
    fn undo_does_not_undo_a_family_that_is_not_granted() {
        let mut guard = Guard::new(Undoes, Negate(Capability::VaultStructure));
        let err = guard
            .undo_last()
            .expect_err("without `VaultStructure` a rename is not undone");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "the refusal must be a permission refusal: {err}"
        );
        assert!(
            err.message().to_string().contains("undoing"),
            "and it must say what was being done: {err}"
        );
    }

    /// all'host e torna con la sua voce. Una famiglia estranea negata non lo
    /// tocca — il cancello resta quello dell'annullamento, non un no generico.
    /// L'ultima famiglia dichiarata, nominata dal **compilatore** e non da un
    /// conto.
    #[test]
    fn with_the_granted_families_the_undo_passes() {
        let mut guard = Guard::new(Undoes, Negate(Capability::Network));
        let undone = guard
            .undo_last()
            .expect("denying the network has nothing to do with undoing")
            .expect("the host has an entry to undo");
        assert_eq!(
            undone.label,
            fub_abi::text::Text::Literal("the rename".into())
        );
    }

    ///
    /// L'aritmetica del presidio qui sotto sa dire se `ALL` è coerente con sé
    /// stesso — niente buchi, niente doppioni — e non sa quante famiglie
    /// esistano fuori di lui: togliere l'**ultima** riga e portare la lunghezza
    /// a diciotto la lascia verde, perché `visti` e `attesi` diventano tutti e
    /// due `0..17`. Cioè restava scoperto il caso che capita davvero, ed è
    /// quello per cui il presidio esiste: aggiungo una famiglia in fondo e mi
    /// dimentico `ALL`.
    ///
    /// Il `match` è esaustivo apposta e non ha altro mestiere: una famiglia
    /// nuova non compila finché non le si dà un posto qui. Lo ha trovato la
    /// [§23.2](../../../../docs/decisions/0104-la-superficie-di-scrittura-si-presta.md)
    /// provando rosso il presidio gemello delle superfici, che da questo aveva
    /// copiato la forma **e il buco**.
    /// `ALL` è l'unico elenco scritto a mano rimasto in questo modulo, e tutto
    /// il resto gli sta a valle: `Granted::new` ci folda sopra per calcolare i
    fn last_declared_family(cap: Capability) -> u16 {
        match cap {
            Capability::VaultRead => 0,
            Capability::VaultWrite => 1,
            Capability::VaultStructure => 2,
            Capability::DataRead => 3,
            Capability::DataWrite => 4,
            Capability::Query => 5,
            Capability::Drafts => 6,
            Capability::Env => 7,
            Capability::Session => 8,
            Capability::SessionSelection => 9,
            Capability::Events => 10,
            Capability::Commands => 11,
            Capability::Services => 12,
            Capability::Network => 13,
            Capability::SettingsRead => 14,
            Capability::SettingsWrite => 15,
            Capability::ViewStateRead => 16,
            Capability::ViewStateWrite => 17,
            Capability::Transfer => 18,
        }
    }

    /// permessi, e il presidio delle capacità simulate
    /// (`kernel/tests/invoke_command.rs`) ci ricava l'insieme che pretende di
    /// aver provato. Una famiglia che non finisse qui sparirebbe da entrambi
    /// **restando verde** — e il commento sopra `ALL` diceva che «nascerebbe
    /// negata a tutti, che è il modo giusto di sbagliare, ma va visto»: la prima
    /// metà è vera per costruzione, la seconda non lo era da nessuna parte.
    ///
    /// La lunghezza dichiarata (`[Capability; N]`, oggi diciotto) obbliga a **toccare**
    /// l'elenco quando l'enum cresce, ma non a metterci dentro la variante
    /// giusta: chi ha fretta soddisfa il compilatore duplicando una riga già
    /// presente, e la famiglia nuova non viene iterata mai.
    ///
    /// Questo lo chiude senza una proc-macro, sfruttando ciò su cui
    /// [`CapabilitySet`] fa già affidamento (`1 << cap as u32`): i discriminanti
    /// sono contigui da zero, quindi pretendere che quelli di `ALL` siano
    /// esattamente `0..len` vieta insieme i duplicati e i buchi. Duplicare una
    /// riga è rosso; dimenticare la variante nuova è rosso — **tranne in coda**,
    /// e per quello c'è `last_declared_family`.
    // E ognuna al **posto** che l'enum le dà. L'aritmetica qui sotto
    // ordina prima di confrontare, quindi due righe scambiate le sfuggono:
    #[test]
    fn the_discriminants_cover_every_family() {
        assert_eq!(
            Capability::ALL.len(),
            last_declared_family(Capability::Transfer) as usize + 1,
            "`Capability::ALL` is shorter than the enum: there is a family that \
             the compiler knows and the list does not name. It is the case the \
             arithmetic below does not see."
        );

        // l'ha misurato la verifica del rosso della
        // [0105](../../../../docs/decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md),
        // scambiando `SettingsRead` e `SettingsWrite` e trovando il workspace
        // interamente verde. Il presidio gemello delle superfici questo ciclo
        // ce l'aveva; questo, da cui quello aveva copiato la forma, no — ed è
        // la seconda zona cieca che si scopre guardando l'originale invece del
        // ricalco.
        // **Ogni permesso che governa una famiglia ha un nome nell'elenco che si
        // mostra** (§23.17).
        for &cap in &Capability::ALL {
            assert_eq!(
                Capability::ALL[last_declared_family(cap) as usize],
                cap,
                "`{cap:?}` is not in `ALL` at the position the enum declaration \
                 gives it: two lines have been swapped, and whoever reads `ALL` \
                 to know the permission order reads an order that is not the \
                 real one."
            );
        }

        let mut seen: Vec<u16> = Capability::ALL.iter().map(|&c| c as u16).collect();
        seen.sort_unstable();
        let expected: Vec<u16> = (0..Capability::ALL.len() as u16).collect();
        assert_eq!(
            seen, expected,
            "`Capability::ALL` does not cover every family of the enum exactly \
             once: either a line is duplicated, or the new family was not added \
             and the length was made to work with a duplicate. Whatever is not \
             in `ALL` is not granted by `Granted::new` and not expected by the \
             simulated-capability guard: it disappears from both while staying \
             green."
        );
        assert!(
            Capability::ALL.len() <= u32::BITS as usize,
            "`CapabilitySet` holds families in a `u32`. It was a `u16`, and the \
             bits really did run out: with 0095 the families were sixteen — \
             exactly the bits — and 0096 gated them to seventeen. This line \
             noticed before `1 << cap` overflowed (in debug with a panic, in \
             release **silently**, that is granting a family to someone who had \
             not declared it). At thirty-three it will happen again: widen the \
             type, do not remove the assert."
        );
    }

    ///
    /// È il presidio che rende vera la parola *tutti* del pannello dei permessi:
    /// una famiglia nuova col suo permesso nuovo, dimenticato in
    /// [`permission::ALL`](fub_abi::options::permission::ALL), sarebbe un
    /// cancello che esiste, che l'utente non vede e che non può negare — cioè
    /// esattamente il difetto da cui questa voce è nata, ripetuto in silenzio.
    ///
    /// Il verso opposto **non** si presidia, ed è deliberato: `fub:camera`,
    /// `fub:microphone`, `fub:read-clipboard`, `fub:write-clipboard` e
    /// `fub:external-fs` sono nomi che nessuna famiglia consuma ancora, e
    /// pretendere la corrispondenza piena costringerebbe a toglierli — cioè a
    /// lasciare liberi cinque nomi che qualcun altro potrebbe prendersi.
    ///
    /// E un nome tenuto senza famiglia va tenuto **della grana giusta**: gli
    /// appunti erano uno e sono due dalla 0144, perché una spunta sola diceva
    /// insieme *«può incollare»* e *«può leggere ciò che hai copiato»*, e la
    /// grana di un permesso si corregge gratis solo finché nessun manifest l'ha
    /// scritto.
    /// Un host che risponde a qualunque domanda: ciò che si prova qui è quale
    /// **cancello** attraversa, non cosa c'è dietro.
    #[test]
    fn every_family_permission_is_named() {
        for cap in Capability::ALL {
            let Some(key) = cap.permission() else {
                continue;
            };
            assert!(
                permission::ALL.contains(&key),
                "family {cap:?} is governed by `{key}`, which is not in \
                 `permission::ALL`: no panel would show it, and the \
                 kernel would not fabricate the key used to deny it."
            );
        }
    }

    /// **La leva che questa decisione esiste per dare, primo verso**: il vault
    /// concesso, le bozze no.
    struct ScopedDrafts;

    impl HostQuery for ScopedDrafts {
        fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
            match query {
                IndexQuery::Drafts { .. } => Ok(IndexResult::Drafts(Paged::all(vec![
                    fub_abi::traits::DraftInfo {
                        doc: DocId::new("Progetti/2026.md"),
                        at: 0,
                        base: None,
                        exists: true,
                        current: None,
                        text: "inside".into(),
                    },
                    fub_abi::traits::DraftInfo {
                        doc: DocId::new("Altro/2026.md"),
                        at: 0,
                        base: None,
                        exists: true,
                        current: None,
                        text: "outside".into(),
                    },
                ]))),
                _ => Ok(IndexResult::Documents(Paged::all(Vec::new()))),
            }
        }
    }

    #[test]
    fn draft_results_are_filtered_one_item_at_a_time() {
        let granted = with_paths(permission::READ_DRAFTS, &["Progetti"]);
        let guard = Guard::new(ScopedDrafts, granted);
        let IndexResult::Drafts(page) = guard
            .query_index(IndexQuery::Drafts { page: None })
            .expect("drafts are granted")
        else {
            panic!("expected draft result");
        };
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].doc, DocId::new("Progetti/2026.md"));
    }

    struct IndexHost;

    impl HostQuery for IndexHost {
        fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
            match query {
                IndexQuery::Drafts { .. } => Ok(IndexResult::Drafts(Paged::all(vec![
                    fub_abi::traits::DraftInfo {
                        doc: DocId::new("Diario/2026-08-04.md"),
                        at: 0,
                        base: None,
                        exists: true,
                        current: None,
                        text: "I have not saved it yet".into(),
                    },
                ]))),
                _ => Ok(IndexResult::Documents(Paged::all(Vec::new()))),
            }
        }
    }

    ///
    /// Prima della 0096 questo caso non era esprimibile — `IndexQuery::Drafts`
    /// passava da `Capability::Query`, cioè dallo stesso `fub:read-vault` che
    /// governa i documenti salvati — e la frase *«puoi cercare nelle mie note,
    /// non puoi leggere ciò che sto scrivendo adesso»* non aveva una spunta con
    /// cui dirsi.
    /// **Secondo verso, ed è quello che la forma cumulativa avrebbe reso
    /// impossibile**: le bozze concesse, il vault no.
    #[test]
    fn denying_drafts_leaves_the_rest_of_the_index_readable() {
        let guard = Guard::new(IndexHost, Negate(Capability::Drafts));
        guard
            .query_index(IndexQuery::Documents {
                matching: Default::default(),
                sort: None,
                select: Default::default(),
                excerpts: Default::default(),
                page: None,
            })
            .expect("the rest of the index stays readable: it is the other permission");
        let err = guard
            .query_index(IndexQuery::Drafts { page: None })
            .expect_err("drafts are denied");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "and the refusal must say so instead of returning an empty list: {err}"
        );
        assert!(
            err.message().to_string().contains("drafts"),
            "the refusal names what was being done: {err}"
        );
    }

    ///
    /// È il pannello di recupero dopo un crash — l'unico cliente che questa
    /// domanda abbia mai avuto — e chiede una cosa sola: ritrovare ciò che si
    /// stava scrivendo. Farlo dipendere da `read-vault` gli avrebbe fatto
    /// chiedere l'intero vault per leggere il testo che l'utente non gli ha
    /// consegnato, che è il modo in cui i permessi smettono di significare
    /// qualcosa.
    /// Un host che risponde `200` a chiunque: ciò che si prova qui è il
    /// cancello, non cosa c'è dall'altra parte del filo.
    #[test]
    fn granting_drafts_alone_does_not_open_the_index() {
        let guard = Guard::new(IndexHost, Negate(Capability::Query));
        match guard.query_index(IndexQuery::Drafts { page: None }) {
            Ok(IndexResult::Drafts(page)) => {
                assert_eq!(page.items.len(), 1, "drafts pass through");
            }
            other => panic!("drafts must pass with their own permission: {other:?}"),
        }
        assert!(
            guard
                .query_index(IndexQuery::Documents {
                    matching: Default::default(),
                    sort: None,
                    select: Default::default(),
                    excerpts: Default::default(),
                    page: None,
                })
                .is_err(),
            "and they must not open the rest of the index"
        );
    }

    fn with_paths(key: &str, paths: &[&str]) -> Granted {
        let mut permissions = PluginPermissions::of(&[]);
        permissions.granted.set(
            key,
            serde_json::Value::Array(
                paths
                    .iter()
                    .map(|path| serde_json::Value::String((*path).into()))
                    .collect(),
            ),
        );
        Granted::new("p", &permissions, Trust::Community)
    }

    #[test]
    fn permission_prefixes_are_folder_scoped_on_every_document_port() {
        let granted = with_paths(permission::READ_VAULT, &["Progetti/"]);
        assert!(granted
            .denies_path(Capability::VaultRead, "Progetti/Alpha.md")
            .is_none());
        assert!(granted
            .denies_path(Capability::VaultRead, "Altro/Alpha.md")
            .is_some());
        assert!(granted
            .denies_path(Capability::VaultRead, "Progetti-vecchi/Alpha.md")
            .is_some());
        assert!(
            granted
                .denies_path(Capability::Query, "Altro/Alpha.md")
                .is_none(),
            "Query is aggregate and must not apply vault path prefixes"
        );
    }

    #[test]
    fn a_missing_path_parameter_keeps_the_vault_unrestricted() {
        let granted = Granted::new(
            "p",
            &PluginPermissions::of(&[permission::READ_VAULT]),
            Trust::Community,
        );
        assert!(granted
            .denies_path(Capability::VaultRead, "Altro/Alpha.md")
            .is_none());
    }

    #[test]
    fn session_and_selection_paths_are_independent() {
        let session = with_paths(permission::READ_SESSION, &["Progetti"]);
        assert!(session
            .denies_path(Capability::Session, "Progetti/Alpha.md")
            .is_none());
        assert!(session
            .denies_path(Capability::Session, "Altro/Alpha.md")
            .is_some());
        let selection = with_paths(permission::READ_SELECTION, &["Progetti"]);
        assert!(selection
            .denies_path(Capability::SessionSelection, "Altro/Alpha.md")
            .is_some());
    }

    struct WithNetwork;

    impl HostNetwork for WithNetwork {
        fn fetch(&self, _request: HttpRequest) -> Result<HttpResponse, PluginError> {
            Ok(HttpResponse {
                status: 200,
                headers: Vec::new(),
                body: b"hello".to_vec(),
            })
        }
    }

    fn with_network(hosts: &[&str]) -> Granted {
        let mut permissions = PluginPermissions::of(&[]);
        permissions.granted.set(
            permission::NETWORK,
            serde_json::Value::Array(
                hosts
                    .iter()
                    .map(|h| serde_json::Value::String((*h).into()))
                    .collect(),
            ),
        );
        Granted::new("p", &permissions, Trust::Community)
    }

    /// recinto che perde.
    ///
    /// Prima della 0097 il parametro di un permesso non lo leggeva nessuno:
    /// `fub:network` con un elenco dentro concedeva esattamente quanto
    /// `fub:network` nudo.
    /// **Il modo in cui un'allowlist si scavalca**, e la riga che lo impedisce.
    ///
    #[test]
    fn the_manifest_says_where_and_it_is_true() {
        let guard = Guard::new(WithNetwork, with_network(&["api.acme.com"]));
        guard
            .fetch(HttpRequest::get("https://api.acme.com/v1/note"))
            .expect("the declared host passes");
        let err = guard
            .fetch(HttpRequest::get("https://altrove.example/raccogli"))
            .expect_err("the undeclared one does not");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "and the refusal names the permission: {err}"
        );
        assert!(
            err.message().to_string().contains("api.acme.com"),
            "saying what was declared: {err}"
        );
    }

    /// Un host dichiarato che risponde `302` verso uno che non lo è porterebbe
    /// fuori dal recinto senza che nessuno l'abbia deciso — e un client che
    /// segue i redirect lo farebbe **in silenzio**, perché l'allowlist non ce
    /// l'ha e non deve averla. Qui il salto è una **seconda chiamata**, quindi
    /// ripassa dal cancello e il cancello lo ferma.
    /// Le credenziali in un URL sono il modo più vecchio di far leggere a un
    /// umano un indirizzo e a una macchina un altro.
    #[test]
    fn a_redirect_out_of_the_fence_is_a_second_call_and_is_stopped() {
        let guard = Guard::new(WithNetwork, with_network(&["api.acme.com"]));
        let answer = HttpResponse {
            status: 302,
            headers: vec![fub_abi::net::HttpHeader::new(
                "Location",
                "https://altrove.example/raccogli",
            )],
            body: Vec::new(),
        };
        let salto = answer.redirect_to().expect("it is a redirect");
        assert!(
            guard.fetch(HttpRequest::get(salto)).is_err(),
            "following the jump is asking again, and the second question is \
             the one the fence stops"
        );
    }

    /// Il carattere `*` è obbligatorio proprio perché *«voglio anche i
    /// sottodomini»* sia una cosa che si dice invece di una che succede — e
    #[test]
    fn credentials_do_not_borrow_an_allowed_name() {
        let guard = Guard::new(WithNetwork, with_network(&["api.acme.com"]));
        assert!(
            guard
                .fetch(HttpRequest::get("https://api.acme.com@evil.example/x"))
                .is_err(),
            "the host is what is after the last `@`, not what is read before it"
        );
    }

    /// perché una `ends_with` nuda regalerebbe a chi dichiara `acme.com` il
    /// dominio di qualcun altro.
    /// `fub:network` senza parametro è *qualunque host*, per la regola uniforme
    /// di `OptionMap`. Ciò che cambia non è il cancello: è la frase che
    #[test]
    fn a_wildcard_does_not_hand_over_someone_elses_domain() {
        let guard = Guard::new(WithNetwork, with_network(&["*.acme.com"]));
        guard
            .fetch(HttpRequest::get("https://api.acme.com/x"))
            .expect("a proper subdomain passes");
        assert!(
            guard.fetch(HttpRequest::get("https://acme.com/x")).is_err(),
            "the bare domain does not: `*.` demands one level more"
        );
        assert!(
            guard
                .fetch(HttpRequest::get("https://evil-acme.com/x"))
                .is_err(),
            "and a name that ends up there by chance even less so"
        );
    }

    /// l'utente legge quando gli si chiede di accettare.
    /// Senza il permesso non si esce, e il rifiuto parla del **permesso** e non
    /// di un elenco di host che non lo riguarda.
    #[test]
    fn no_allowlist_means_anywhere_and_that_is_the_uniform_rule() {
        let mut permissions = PluginPermissions::of(&[]);
        permissions.granted.set(permission::NETWORK, true);
        let guard = Guard::new(
            WithNetwork,
            Granted::new("p", &permissions, Trust::Community),
        );
        guard
            .fetch(HttpRequest::get("https://ovunque.example/x"))
            .expect("no list means no fence: present = on");
    }

    /// In chiaro l'allowlist promette un host e la rete ne consegna un altro —
    /// tranne verso sé stessi, dove non c'è rete da attraversare e dove vive un
    #[test]
    fn without_the_permission_the_refusal_names_the_permission() {
        let guard = Guard::new(
            WithNetwork,
            Granted::new("p", &PluginPermissions::of(&[]), Trust::Community),
        );
        let err = guard
            .fetch(HttpRequest::get("https://api.acme.com/x"))
            .expect_err("no permission, no network");
        assert!(
            err.message().to_string().contains(permission::NETWORK),
            "whoever lacks the permission must read which one they are missing: {err}"
        );
    }

    /// modello che gira sulla macchina di chi usa l'app.
    /// **Il prefisso `127.` è una famiglia di nomi, non di indirizzi.**
    ///
    #[test]
    fn plaintext_is_refused_except_towards_this_machine() {
        let guard = Guard::new(WithNetwork, with_network(&["api.acme.com", "localhost"]));
        let err = guard
            .fetch(HttpRequest::get("http://api.acme.com/x"))
            .expect_err("`http` outward is refused");
        assert!(matches!(err, PluginError::BadArgs(_)), "{err}");
        guard
            .fetch(HttpRequest::get("http://localhost:11434/api/generate"))
            .expect("toward this machine yes: that is where a local model runs");
    }

    /// `127.0.0.1.evil.example` è registrabile — la prima etichetta di un
    /// dominio può cominciare con una cifra — e con un confronto per testo si
    /// prendeva l'esenzione del loopback: `http` in chiaro verso la macchina di
    /// qualcun altro, cioè l'unica cosa che la regola esiste per impedire.
    /// **Un parametro illeggibile non è l'assenza di un parametro.**
    ///
    #[test]
    fn a_name_that_starts_like_a_loopback_address_is_not_this_machine() {
        let guard = Guard::new(
            WithNetwork,
            with_network(&["*.evil.example", "127.0.0.1", "::1"]),
        );
        let err = guard
            .fetch(HttpRequest::get("http://127.0.0.1.evil.example/x"))
            .expect_err("it is someone else's name, and in plaintext you do not go there");
        assert!(matches!(err, PluginError::BadArgs(_)), "{err}");
        guard
            .fetch(HttpRequest::get("http://127.0.0.1:11434/api/generate"))
            .expect("the real address yes");
        guard
            .fetch(HttpRequest::get("http://[::1]:11434/api/generate"))
            .expect("and its IPv6 form too");
    }

    /// `"fub:network": "api.acme.com"` — la stringa invece dell'elenco — è un
    /// manifest scritto male, e prima cadeva sul ramo «nessun elenco», cioè
    /// *qualunque host*: un errore di battitura che intende restringere apriva
    /// a tutto, senza che niente lo dicesse. Adesso il recinto c'è e non nomina
    /// nessuno.
    /// **Una `DryRun` che scarica non è una simulazione.** L'effetto non è
    /// nell'host — un `POST` crea qualcosa dall'altra parte, e perfino un `GET`
    #[test]
    fn a_malformed_allowlist_fences_everything_out() {
        for wrong in [
            serde_json::json!("api.acme.com"),
            serde_json::json!(7),
            serde_json::json!([1, 2]),
            serde_json::json!({ "host": "api.acme.com" }),
        ] {
            let mut permissions = PluginPermissions::of(&[]);
            permissions.granted.set(permission::NETWORK, wrong.clone());
            let guard = Guard::new(
                WithNetwork,
                Granted::new("p", &permissions, Trust::Community),
            );
            let err = guard
                .fetch(HttpRequest::get("https://api.acme.com/x"))
                .expect_err("a malformed parameter grants nothing");
            assert!(
                matches!(err, PluginError::PermissionDenied(_)),
                "and it says so as a denied permission ({wrong}): {err}"
            );
            assert!(
                err.message().to_string().contains("is not a list of hosts"),
                "sending you to look for the flaw in the manifest and not in \
                 the URL ({wrong}): {err}"
            );
        }
    }

    /// viene contato e registrato da chi risponde — quindi è la sola specie di
    /// effetto che questo processo non può ritirare nemmeno volendo.
    /// I due permessi sono **due chiavi diverse**, e il presidio è che nessuna
    /// apra la porta dell'altra.
    #[test]
    fn a_simulation_does_not_reach_the_network() {
        let guard = Guard::new(
            WithNetwork,
            ReadOnly {
                why: "a simulation does not write",
            },
        );
        assert!(
            guard
                .fetch(HttpRequest::get("https://api.acme.com/x"))
                .is_err(),
            "simulating a download would be downloading"
        );
    }

    ///
    /// Senza questa riga la coppia avrebbe potuto nascere con `read-drafts`
    /// mappato su `fub:read-vault` — cioè con un nome nuovo davanti al cancello
    /// vecchio, che è la forma in cui un permesso sembra esserci e non c'è.
    /// mappato su `fub:read-vault` — cioè con un nome nuovo davanti al cancello
    /// vecchio, che è la forma in cui un permesso sembra esserci e non c'è.
    #[test]
    fn the_two_permissions_are_not_the_same_key() {
        assert_eq!(Capability::Query.permission(), Some(permission::READ_VAULT));
        assert_eq!(
            Capability::Drafts.permission(),
            Some(permission::READ_DRAFTS)
        );
        let only_vault = PluginPermissions::of(&[permission::READ_VAULT]);
        let granted = Granted::new("p", &only_vault, Trust::Community);
        assert!(
            granted.denies(Capability::Query).is_none(),
            "`read-vault` grants the index"
        );
        assert!(
            granted.denies(Capability::Drafts).is_some(),
            "but not drafts: they were the same checkbox in the same manifest"
        );
    }
}
