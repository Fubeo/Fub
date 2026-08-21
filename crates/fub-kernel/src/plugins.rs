//! Il **registro dei plugin**: chi è registrato, cosa ha dichiarato, cosa ha
//! registrato (§7.3, §7.4, §7.6).
//!
//! Prima di questo modulo il kernel non conservava manifest: `register_*`
//! prendeva una **stringa**, e da quella stringa nasceva lo spazio dati del
//! provider e nient'altro. Le conseguenze erano tre, e sono le tre voci che
//! questo modulo chiude insieme:
//!
//! - **§7.3 — il punto di applicazione non esisteva.** `PluginPermissions`
//!   stava nel contratto e non lo leggeva nessuno; `KernelHost` portava
//!   `plugin: &str` e non sapeva *di chi* fossero le capacità che stava
//!   prestando. `Trust` esisteva ed era un parametro del solo
//!   `register_view_provider`: un `IndexProvider` di terzi avrebbe ricevuto
//!   ogni documento del vault senza che `read_vault` fosse mai consultato.
//! - **§7.4 — gli id non erano di nessuno.** Nessuna regola di namespace,
//!   nessun conflitto: due view con lo stesso id, e la seconda irraggiungibile
//!   in silenzio.
//! - **§7.6 — non c'era un inventario.** La shell sapeva un booleano
//!   (`versioning`) e nient'altro: non quali provider, indici, comandi fossero
//!   attivi, con quale versione, quali permessi, quale fiducia.
//!
//! # La forma
//!
//! Una **dichiarazione** ([`Workspace::register_plugin`]) precede ogni
//! registrazione, e dice chi è: id, versione, versione di ABI, permessi,
//! fiducia. Le registrazioni successive nominano quell'id; un id che nessuno ha
//! dichiarato è un errore, **non** un plugin creato al volo.
//!
//! Che sia un errore e non un default è il punto: il grado di fiducia più
//! restrittivo fra quelli che girano è già ciò che si ottiene dimenticandosi di
//! dichiararlo ([`Trust::default`]), e concedere `Trust::Core` a chi non si è
//! presentato sarebbe la regola opposta nello stesso kernel.
//!
//! [`Workspace::register_plugin`]: crate::Workspace::register_plugin

use fub_abi::rules::ids::{self, IdFault, Owner};
use fub_abi::text::StringCatalog;
use fub_abi::traits::{PluginManifest, QueryRoute, TimerSpec};
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

use crate::host::Granted;
use crate::index::RouteConflict;
use crate::workspace::Trust;

/// Che specie di cosa un plugin ha registrato.
///
/// Serve a due mestieri e per questo è un enum e non otto liste: l'inventario
/// del §7.6 (*cosa è attivo*) e la **contesa dei nomi** del §7.4 (*chi possiede
/// già questo id*), che è la stessa domanda letta al contrario.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationKind {
    View,
    Command,
    Index,
    EventHandler,
    Import,
    Export,
    Syntax,
    Renderer,
    /// Un servizio offerto agli altri plugin (§7.5).
    Service,
}

impl RegistrationKind {
    /// Come si chiama in un messaggio d'errore.
    pub fn what(self) -> &'static str {
        match self {
            RegistrationKind::View => "view",
            RegistrationKind::Command => "command",
            RegistrationKind::Index => "route",
            RegistrationKind::EventHandler => "handler",
            RegistrationKind::Import => "importer",
            RegistrationKind::Export => "export destination",
            RegistrationKind::Syntax => "syntax rule",
            RegistrationKind::Renderer => "renderer",
            RegistrationKind::Service => "service",
        }
    }

    /// I nomi di questa specie stanno in uno spazio a sé?
    ///
    /// Sì per tutte tranne le due che **non nominano niente**: un event handler
    /// e un importer non hanno un id proprio — si registrano e basta — e per
    /// loro l'unico nome in gioco è quello del plugin.
    fn names(self) -> bool {
        !matches!(
            self,
            RegistrationKind::EventHandler | RegistrationKind::Import
        )
    }
}

/// Una cosa che un plugin ha registrato: la specie e il nome.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registration {
    pub kind: RegistrationKind,
    /// L'id registrato. Per le specie che non nominano niente
    /// (`RegistrationKind::names` falso) è l'id del plugin stesso: una riga
    /// nell'inventario ci vuole comunque, o «ho registrato un handler» non si
    /// potrebbe dire.
    pub id: String,
}

/// Un plugin dichiarato, con ciò che ha dichiarato e ciò che ha registrato.
pub struct PluginEntry {
    pub manifest: PluginManifest,
    pub trust: Trust,
    /// La politica già calcolata: è ciò che ogni host di questo plugin monta
    /// davanti a sé. Sta qui e non si ricalcola a ogni prestito perché un host
    /// si presta a ogni evento consegnato, e un `BTreeMap` clonato per evento
    /// per handler è un costo che non compra niente.
    pub(crate) granted: Granted,
    pub registrations: Vec<Registration>,
}

/// Perché una registrazione non è avvenuta.
///
/// **Ogni variante vuol dire "non è registrato"**, e non "è registrato a metà":
/// è la disciplina che la decisione 0017 ha fissato per i renderer e la 0019
/// per le rotte, applicata a tutte le famiglie. L'unica eccezione è dichiarata
/// e si chiama [`RegistryError::Activate`] — là il provider **è** registrato e
/// non ha ritrovato la propria memoria, che è lento e non sbagliato.
#[derive(Debug)]
pub enum RegistryError {
    /// Un id che nessuno ha dichiarato con `register_plugin`.
    UnknownPlugin(String),
    /// Due plugin con lo stesso id.
    DuplicatePlugin(String),
    /// Un plugin **revocato** che prova a registrare qualcosa (§7.3).
    ///
    /// `Trust::Revoked` non è un grado di fiducia più basso, è l'assenza del
    /// permesso di essere eseguito — e una regola sintattica o un renderer
    /// registrati sono codice che gira a ogni parse e a ogni anteprima, senza
    /// passare da nessun guard. Negarlo qui, al varco unico di ogni
    /// registrazione, è l'unico posto in cui la revoca vale per **tutte** le
    /// famiglie: dichiararsi resta possibile, perché per dire che qualcuno è
    /// revocato bisogna sapere che esiste.
    Revoked(String),
    /// Un nome che chi lo registra non può nominare (§7.4).
    Namespace(IdFault),
    /// Un nome già rivendicato da qualcun altro. Chi vuole **sostituire** lo
    /// chiede per nome (`replace_*`), che è la differenza fra scavalcare
    /// qualcuno e farlo per sbaglio.
    Claimed {
        kind: RegistrationKind,
        id: String,
        incumbent: String,
        challenger: String,
    },
    /// Una rotta di query già rivendicata (decisione 0019).
    Route(RouteConflict),
    /// Una regola sintattica in conflitto (decisione 0017).
    Syntax(crate::syntax::SyntaxConflict),
    /// Un renderer in conflitto (decisione 0017).
    Renderer(crate::renderer::RendererConflict),
    /// Un plugin che ha bisogno di servizi che nessuno offre (§7.5). Non si
    /// dichiara affatto: «attivo ma degradato» è uno stato che nessuno prova.
    MissingRequirement {
        plugin: String,
        requires: Vec<String>,
    },
    /// Un `ServiceProvider` registrato da un plugin che non dichiara di offrire
    /// niente: quasi certamente manca il `provides` del manifest.
    NothingProvided(String),
    /// L'indice **è** registrato e la sua `activate` è fallita: reindicizzerà
    /// tutto, che è lento e non sbagliato.
    Activate(PluginError),
    /// Una **disattivazione** chiesta mentre i provider sono in prestito, cioè
    /// da dentro la chiamata di un provider (§9.4).
    ///
    /// È un rifiuto e non un rinvio, e la ragione non è la prudenza: durante un
    /// prestito la tabella dei provider è **vuota** — le voci sono in mano a chi
    /// le sta chiamando — quindi una rimozione calcolata lì sopra toglierebbe
    /// zero provider e li vedrebbe tornare tutti al ripristino. Chi lo riceve
    /// non ha perso niente: la sua chiamata sta tornando, e fuori da lì la
    /// stessa domanda si risponde per intero.
    Busy(String),
    /// Una **chiave di impostazione** già dichiarata da un altro plugin
    /// (§11.1). Non è un `Claimed` con una specie in più: quelli sono nomi di
    /// *registrazioni*, questo è un nome che vive nel manifest e viene
    /// dichiarato prima di ogni registrazione — e chi lo riceve non ha nemmeno
    /// un provider da togliere.
    Setting(String),
    /// Una **sveglia** senza nome, o due sveglie omonime dello stesso
    /// componente (§22.1). Non è un `Namespace`: il nome di una sveglia è
    /// nudo per contratto, e ciò che va verificato non è chi la può nominare
    /// ma che chi la riceve sappia quale è suonata.
    Timer { plugin: String, timer: String },
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RegistryError::UnknownPlugin(id) => write!(
                f,
                "`{id}` non è un plugin dichiarato: chi registra qualcosa si dichiara prima \
                 (register_plugin), o le sue capacità non hanno un proprietario"
            ),
            RegistryError::DuplicatePlugin(id) => {
                write!(f, "un plugin con id `{id}` è già dichiarato")
            }
            RegistryError::Revoked(id) => write!(
                f,
                "`{id}` è revocato e non registra niente: la revoca non è un permesso \
                 in meno, è l'assenza del permesso di essere eseguito"
            ),
            RegistryError::Namespace(fault) => write!(f, "{fault}"),
            RegistryError::Timer { plugin, timer } if timer.is_empty() => write!(
                f,
                "`{plugin}` declares a timer without a name: the receiver has no \
                 way to know which one rang"
            ),
            RegistryError::Timer { plugin, timer } => write!(
                f,
                "`{plugin}` declares two timers named `{timer}`: they would be two \
                 events indistinguishable by the receiver"
            ),
            RegistryError::Claimed {
                kind,
                id,
                incumbent,
                challenger,
            } => write!(
                f,
                "{} `{id}` already belongs to `{incumbent}`: `{challenger}` cannot register it \
                 (to replace it, ask by name)",
                kind.what()
            ),
            RegistryError::MissingRequirement { plugin, requires } => write!(
                f,
                "`{plugin}` requires {} that nobody offers: it is not declared \
                 (whoever mounts it must mount them first)",
                requires
                    .iter()
                    .map(|r| format!("`{r}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            RegistryError::NothingProvided(plugin) => write!(
                f,
                "`{plugin}` registers a ServiceProvider but its manifest declares no \
                 `provides`: it is the manifest that says what it offers"
            ),
            RegistryError::Route(c) => write!(f, "{c}"),
            RegistryError::Syntax(c) => write!(f, "{c}"),
            RegistryError::Renderer(c) => write!(f, "{c}"),
            RegistryError::Activate(and) => write!(f, "{and}"),
            RegistryError::Busy(id) => write!(
                f,
                "`{id}` cannot be deactivated from inside a provider call: \
                 providers are on loan there, and what is not in the table \
                 cannot be removed (ask again after the call returns)"
            ),
            RegistryError::Setting(why) => write!(f, "{why}"),
        }
    }
}

impl std::error::Error for RegistryError {}

/// Chi è registrato, in ordine di dichiarazione.
#[derive(Default)]
pub struct PluginRegistry {
    entries: Vec<PluginEntry>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Dichiara un plugin. Id già dichiarato → conflitto.
    pub fn declare(&mut self, manifest: PluginManifest, trust: Trust) -> Result<(), RegistryError> {
        if self.entries.iter().any(|and| and.manifest.id == manifest.id) {
            return Err(RegistryError::DuplicatePlugin(manifest.id));
        }
        let granted = Granted::new(&manifest.id, &manifest.permissions, trust);
        self.entries.push(PluginEntry {
            manifest,
            trust,
            granted,
            registrations: Vec::new(),
        });
        Ok(())
    }

    /// Rifà la politica di un plugin **togliendo** dai permessi del suo
    /// manifest quelli che l'utente ha negato (§23.17).
    ///
    /// # È una sottrazione, e non un secondo elenco
    ///
    /// La negazione non arriva fino a [`Granted`]: si applica **prima**, sulla
    /// mappa del manifest, e ciò che resta è un manifest più povero. Da questo
    /// discendono tre proprietà che un campo `denied` dentro la politica non
    /// avrebbe avuto:
    ///
    /// - **non può concedere.** Una mappa a cui si tolgono chiavi non ne
    ///   acquista, quindi nessun valore scritto in un file di configurazione —
    ///   nemmeno quello di un vault che arriva da fuori — può dare a un
    ///   componente un permesso che il suo manifest non dichiarava;
    /// - **nega anche il parametro.** Togliere `fub:network` spegne insieme
    ///   *se* e *dove*: la famiglia cade, e con lei l'allowlist. Se la
    ///   negazione fosse un secondo elenco letto accanto, chi la scrive
    ///   dovrebbe ricordarsi di spegnere due cose;
    /// - **non c'è un secondo ordine di cancelli da tenere allineato.** Il
    ///   `Guard` continua a fare le due domande che faceva — la famiglia, poi
    ///   l'host — e non sa che qualcuno ha detto di no.
    ///
    /// Torna `false` se il plugin non è dichiarato: è il caso di chi scrive la
    /// chiave di un componente spento, e non è un errore — la chiave resta nel
    /// file e tornerà a valere quando il componente si riaccende.
    pub(crate) fn restrict(&mut self, plugin: &str, denied: &[String]) -> bool {
        let Some(entry) = self.entries.iter_mut().find(|and| and.manifest.id == plugin) else {
            return false;
        };
        let mut permissions = entry.manifest.permissions.clone();
        for key in denied {
            permissions.granted.remove(key);
        }
        entry.granted = Granted::new(&entry.manifest.id, &permissions, entry.trust);
        true
    }

    pub fn get(&self, id: &str) -> Option<&PluginEntry> {
        self.entries.iter().find(|and| and.manifest.id == id)
    }

    pub fn iter(&self) -> std::slice::Iter<'_, PluginEntry> {
        self.entries.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// La politica da montare davanti a un host intestato a `plugin`.
    ///
    /// Un id **sconosciuto** riceve una politica che nega tutto. È il caso di
    /// chi presta un host a un id che nessuno ha dichiarato (per esempio
    /// `Workspace::with_host` chiamato a vanvera): la risposta giusta non è
    /// concedere in bianco, ed è un rifiuto che si legge nel messaggio invece
    /// di essere un `unwrap` che sparisce.
    pub(crate) fn granted(&self, plugin: &str) -> Granted {
        match self.get(plugin) {
            Some(entry) => entry.granted.clone(),
            None => Granted::undeclared(plugin),
        }
    }

    /// Il proprietario che ha già registrato questo nome, se c'è.
    pub fn owner_of(&self, kind: RegistrationKind, id: &str) -> Option<&str> {
        self.entries
            .iter()
            .find(|and| and.registrations.iter().any(|r| r.kind == kind && r.id == id))
            .map(|and| and.manifest.id.as_str())
    }

    /// Il grado di fiducia di un plugin dichiarato.
    pub fn trust_of(&self, plugin: &str) -> Option<Trust> {
        self.get(plugin).map(|and| and.trust)
    }

    /// I cataloghi di stringhe di un plugin dichiarato, con la lingua in cui è
    /// scritto (§12.1). Chi non è dichiarato non ha catalogo — e non è un caso
    /// da segnalare: è l'ultimo gradino della scala, la chiave nuda.
    pub fn strings_of(&self, plugin: &str) -> (&[StringCatalog], &str) {
        match self.get(plugin) {
            Some(and) => (&and.manifest.strings, and.manifest.default_locale.as_str()),
            None => (&[], ""),
        }
    }

    /// Le **sveglie dichiarate** da chi è dichiarato adesso (§22.1, decisione
    /// 0069): l'id del componente e la sua `TimerSpec`.
    ///
    /// Non c'è un registro suo, e non è una scorciatoia: il manifest lo tiene
    /// già questo registro, e una seconda copia sarebbe un secondo posto da
    /// tenere allineato a `retire` — cioè il modo di far suonare la sveglia di
    /// un componente che se n'è andato.
    pub fn timers(&self) -> Vec<(&str, &TimerSpec)> {
        self.iter()
            .flat_map(|and| {
                and.manifest
                    .timers
                    .iter()
                    .map(move |t| (and.manifest.id.as_str(), t))
            })
            .collect()
    }

    /// Chi può nominare cosa, per un plugin dichiarato: il core nomina anche
    /// nudo, gli altri solo dentro il proprio id (§7.4).
    fn owner<'a>(&'a self, plugin: &'a str) -> Owner<'a> {
        match self.trust_of(plugin) {
            Some(Trust::Core) => Owner::Core,
            _ => Owner::Plugin(plugin),
        }
    }

    /// **Il varco unico di ogni registrazione** (§7.3 + §7.4): il plugin è
    /// dichiarato, i nomi sono suoi, e nessuno di essi è già di qualcun altro.
    ///
    /// Prende **tutti** i nomi in una volta e non uno alla volta perché la
    /// risposta deve essere tutto-o-niente: un provider che offre tre view e ne
    /// nomina bene due non ne registra due.
    pub fn admit(
        &self,
        plugin: &str,
        kind: RegistrationKind,
        ids: &[String],
    ) -> Result<(), RegistryError> {
        self.admission(plugin, kind, ids, true)
    }

    /// Il varco di chi **sostituisce**: le stesse domande di
    /// [`admit`](PluginRegistry::admit) meno la contesa, perché prendere il
    /// posto di chi c'era è precisamente ciò che si è chiesto di fare.
    ///
    /// Esiste per un motivo solo, e non è la simmetria: una sostituzione ha due
    /// effetti — togliere chi c'era e mettersi al suo posto — e **il permesso va
    /// chiesto prima di entrambi**. Chiedendolo dopo il primo, un rifiuto
    /// lascerebbe un vault senza la view di chi c'era e un messaggio che dice
    /// «non è registrato»: lo stato a metà che nessuna variante di
    /// [`RegistryError`] descrive.
    ///
    /// Sostituire resta una cosa che si chiede: la regola dei nomi vale come
    /// sempre, e un terzo che nomina nudo l'id del core non lo scavalca né lo
    /// cancella.
    pub fn admit_replacing(
        &self,
        plugin: &str,
        kind: RegistrationKind,
        ids: &[String],
    ) -> Result<(), RegistryError> {
        self.admission(plugin, kind, ids, false)
    }

    /// Il varco di chi **rinegozia i propri nomi**: un provider che cambia idea
    /// su ciò che offre (`refresh_specs`).
    ///
    /// Come [`admit`](PluginRegistry::admit), con una differenza sola: ciò che è
    /// **già suo** non è una contesa con sé stesso. Tutto il resto vale — un
    /// nome fuori dal proprio namespace resta inammissibile, e un nome di
    /// qualcun altro resta suo — perché il giorno che un provider potrà
    /// rinominare le proprie view a runtime, poterlo fare senza passare di qui
    /// vorrebbe dire che la regola dei nomi vale alla registrazione e mai più.
    ///
    /// Un id ripetuto **dentro la stessa dichiarazione** è un conflitto del
    /// plugin con sé stesso: alla registrazione lo vedeva la contesa (il secondo
    /// provider trovava il primo), e qui, dove il proprietario è lo stesso, non
    /// lo vedrebbe più nessuno.
    pub fn admit_refreshing(
        &self,
        plugin: &str,
        kind: RegistrationKind,
        ids: &[String],
    ) -> Result<(), RegistryError> {
        self.admission(plugin, kind, ids, false)?;
        if !kind.names() {
            return Ok(());
        }
        for (at, id) in ids.iter().enumerate() {
            if ids[..at].contains(id) {
                return Err(RegistryError::Claimed {
                    kind,
                    id: id.clone(),
                    incumbent: plugin.to_string(),
                    challenger: plugin.to_string(),
                });
            }
            if let Some(incumbent) = self.owner_of(kind, id) {
                if incumbent != plugin {
                    return Err(RegistryError::Claimed {
                        kind,
                        id: id.clone(),
                        incumbent: incumbent.to_string(),
                        challenger: plugin.to_string(),
                    });
                }
            }
        }
        Ok(())
    }

    /// La sola regola dei nomi (§7.4), per i nomi che una registrazione
    /// **dichiara senza registrarli**.
    ///
    /// Ne esiste una famiglia sola oggi, e sono i `produces` di una
    /// [`SyntaxRule`](fub_abi::custom::SyntaxRule): i `custom_kind` che una
    /// regola si impegna a emettere. Non passano da
    /// [`admit`](PluginRegistry::admit) perché non sono una rivendicazione —
    /// due regole che producono lo stesso kind sono legittime, ed è come si
    /// scrivono due dialetti della stessa famiglia — ma la domanda «questo nome
    /// è tuo?» vale per loro come per ogni altro: senza, un terzo dichiara
    /// `produces: ["callout"]` e si fa disegnare dal renderer del core.
    pub fn check_names(&self, plugin: &str, ids: &[String]) -> Result<(), RegistryError> {
        if self.get(plugin).is_none() {
            return Err(RegistryError::UnknownPlugin(plugin.to_string()));
        }
        let owner = self.owner(plugin);
        for id in ids {
            ids::check(id, owner).map_err(RegistryError::Namespace)?;
        }
        Ok(())
    }

    fn admission(
        &self,
        plugin: &str,
        kind: RegistrationKind,
        ids: &[String],
        contested: bool,
    ) -> Result<(), RegistryError> {
        let Some(entry) = self.get(plugin) else {
            return Err(RegistryError::UnknownPlugin(plugin.to_string()));
        };
        // Prima di ogni altra domanda, e prima del ramo che lascia passare le
        // specie che non nominano niente: un revocato non registra **nessuna**
        // specie, e un handler di eventi è codice che gira quanto una view.
        if !entry.trust.runs() {
            return Err(RegistryError::Revoked(plugin.to_string()));
        }
        if !kind.names() {
            return Ok(());
        }
        let owner = self.owner(plugin);
        for id in ids {
            ids::check(id, owner).map_err(RegistryError::Namespace)?;
            if !contested {
                continue;
            }
            if let Some(incumbent) = self.owner_of(kind, id) {
                return Err(RegistryError::Claimed {
                    kind,
                    id: id.clone(),
                    incumbent: incumbent.to_string(),
                    challenger: plugin.to_string(),
                });
            }
        }
        Ok(())
    }

    /// Segna ciò che un plugin ha registrato. Da chiamare **dopo** che
    /// [`admit`](PluginRegistry::admit) è passata.
    pub fn record(&mut self, plugin: &str, kind: RegistrationKind, ids: &[String]) {
        let Some(entry) = self.entries.iter_mut().find(|and| and.manifest.id == plugin) else {
            return;
        };
        if ids.is_empty() {
            entry.registrations.push(Registration {
                kind,
                id: plugin.to_string(),
            });
            return;
        }
        for id in ids {
            entry.registrations.push(Registration {
                kind,
                id: id.clone(),
            });
        }
    }

    /// Rifà da capo le registrazioni di una specie fatte da un plugin.
    ///
    /// È l'altra metà di [`admit_refreshing`](PluginRegistry::admit_refreshing):
    /// chi cambia idea su ciò che offre cambia anche ciò che l'inventario dice
    /// di lui, o il §7.6 racconterebbe la registrazione invece dello stato. Un
    /// elenco vuoto è una risposta — un provider che non offre più niente non
    /// lascia una riga di ricordo.
    pub fn resettle(&mut self, plugin: &str, kind: RegistrationKind, ids: &[String]) {
        let Some(entry) = self.entries.iter_mut().find(|and| and.manifest.id == plugin) else {
            return;
        };
        entry.registrations.retain(|r| r.kind != kind);
        for id in ids {
            entry.registrations.push(Registration {
                kind,
                id: id.clone(),
            });
        }
    }

    /// I nomi che un plugin ha registrato di una specie, nell'ordine in cui li
    /// ha registrati.
    ///
    /// Serve alla disattivazione (§9.4): togliere una regola sintattica o un
    /// renderer vuol dire sapere **quali** sono suoi, e l'unico che lo sa è
    /// l'inventario — i due registri di destinazione tengono l'id della regola,
    /// non quello di chi l'ha registrata.
    pub fn ids_of(&self, plugin: &str, kind: RegistrationKind) -> Vec<String> {
        self.get(plugin)
            .map(|and| {
                and.registrations
                    .iter()
                    .filter(|r| r.kind == kind)
                    .map(|r| r.id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Toglie un plugin dal registro e restituisce ciò che era: è la
    /// **disattivazione** (§9.4), vista dal lato di chi teneva la dichiarazione.
    ///
    /// Sparisce l'intera riga, non le sue sole registrazioni, e la ragione è
    /// l'inventario del §7.6: «dichiarato con zero registrazioni» è uno stato
    /// vero e diverso — è chi si è presentato e non ha registrato niente — e
    /// usarlo anche per dire «spento» renderebbe i due indistinguibili proprio
    /// nel posto in cui si va a leggere cosa è attivo. Riaccendere passa dalla
    /// stessa porta della prima volta: `register_plugin`, e poi i `register_*`.
    pub fn retire(&mut self, plugin: &str) -> Option<PluginEntry> {
        let at = self.entries.iter().position(|and| and.manifest.id == plugin)?;
        Some(self.entries.remove(at))
    }

    /// Toglie dall'inventario le registrazioni di una specie fatte da un
    /// plugin: è ciò che serve a una **sostituzione**, dove chi entra prende il
    /// posto di chi c'era.
    pub fn forget(&mut self, kind: RegistrationKind, ids: &[String]) {
        for entry in self.entries.iter_mut() {
            entry
                .registrations
                .retain(|r| !(r.kind == kind && ids.contains(&r.id)));
        }
    }
}

/// Una riga dell'inventario di ciò che è attivo (§7.6): ciò che la shell può
/// sapere di un plugin senza avere il kernel fra le mani.
///
/// È il tipo che fa sparire `VaultInfo.versioning: bool` — un booleano **per
/// feature** dentro un record IPC, che con i moduli del 21.2 sarebbe diventato
/// venti booleani, e ognuno una modifica al record, al mirror e alla fixture.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    /// La versione del contratto contro cui è scritto.
    pub abi_version: String,
    pub trust: Trust,
    /// I permessi **concessi**, con i loro parametri: è la mappa del manifest,
    /// non un elenco di booleani.
    pub permissions: fub_abi::options::OptionMap,
    /// Cosa ha registrato. Vuoto è una risposta: un plugin dichiarato che non
    /// ha registrato niente è precisamente ciò che si vuole poter vedere.
    pub registrations: Vec<Registration>,
}

impl PluginInfo {
    pub(crate) fn of(entry: &PluginEntry) -> Self {
        PluginInfo {
            id: entry.manifest.id.clone(),
            name: entry.manifest.name.clone(),
            version: entry.manifest.version.clone(),
            abi_version: entry.manifest.abi_version.clone(),
            trust: entry.trust,
            permissions: entry.manifest.permissions.granted.clone(),
            registrations: entry.registrations.clone(),
        }
    }
}

/// Le query custom che un indice rivendica: i soli nomi di una rotta che
/// stanno in uno spazio condiviso, e quindi i soli su cui la regola del §7.4
/// ha qualcosa da dire.
///
/// Le rotte **non** custom (`Documents`, `Tags`, …) sono nomi del contratto,
/// non di chi le serve: chi le rivendica non le sta nominando, le sta servendo,
/// e il conflitto lo vede la tabella delle rotte (decisione 0019).
pub fn custom_namespaces(routes: &[QueryRoute]) -> Vec<String> {
    use fub_abi::traits::{PredicateKind, QueryKind};
    routes
        .iter()
        .filter_map(|route| match route {
            QueryRoute::Query(QueryKind::Custom(ns)) => Some(ns.clone()),
            QueryRoute::Predicate(PredicateKind::Custom(ns)) => Some(ns.clone()),
            _ => None,
        })
        .collect()
}

/// Chi offre un servizio, per `ns`: la tabella di instradamento del §7.5.
///
/// È una funzione e non un campo perché la verità sta nei manifest — un
/// servizio lo dichiara chi lo offre, e tenerne una seconda copia vorrebbe dire
/// tenerle allineate.
impl PluginRegistry {
    /// Il plugin che offre questo servizio, se c'è. Un plugin revocato non lo
    /// offre: `Trust::Revoked` non è un grado più basso, è l'assenza del
    /// permesso di essere eseguiti.
    pub fn provider_of(&self, service: &str) -> Option<&str> {
        self.iter()
            .find(|and| and.trust.runs() && and.manifest.provides.iter().any(|s| s == service))
            .map(|and| and.manifest.id.as_str())
    }

    /// I requisiti di un manifest che nessuno offre.
    pub fn missing_requirements(&self, manifest: &PluginManifest) -> Vec<String> {
        manifest
            .requires
            .iter()
            .filter(|r| self.provider_of(r).is_none())
            .cloned()
            .collect()
    }
}
