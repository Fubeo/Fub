//! Le politiche: sola lettura, permessi concessi e la loro composizione.

use super::*;

/// Chi decide quali famiglie un host può servire.
///
/// Una politica è **piccola per costruzione**: risponde a venti nomi [conta: guard-famiglie]
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
            // Nessun metodo dell'host notifica: dentro una simulazione non c'è
            // niente da negare. Chi notifica è l'app, che chiede la politica
            // del componente (`Workspace::granted_policy`) e non simula mai.
            | Capability::Notifications
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
    pub(super) plugin: Arc<str>,
    /// Le famiglie concesse, calcolate una volta alla dichiarazione.
    pub(super) allowed: CapabilitySet,
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
    pub(super) network: Option<Arc<[Box<str>]>>,
    /// Prefissi di documento per le letture, o `None` senza parametro.
    pub(super) read_paths: Option<Arc<[Box<str>]>>,
    /// Prefissi di documento per le scritture, o `None` senza parametro.
    pub(super) write_paths: Option<Arc<[Box<str>]>>,
    /// Prefissi di documento per le bozze e il contesto di sessione.
    pub(super) draft_paths: Option<Arc<[Box<str>]>>,
    pub(super) session_paths: Option<Arc<[Box<str>]>>,
    pub(super) selection_paths: Option<Arc<[Box<str>]>>,
    /// `None` = il plugin non è dichiarato affatto, che è un no diverso da
    /// «non ha quel permesso» e va detto diverso.
    pub(super) trust: Option<Trust>,
}

/// Le famiglie concesse, come insieme.
///
/// Venti bit in un `u32`, ed era un `u16` fino alla diciassettesima
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
pub struct CapabilitySet(pub(super) u32);

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
pub(super) fn normalized_host(host: &str) -> Box<str> {
    host.trim()
        .trim_end_matches('.')
        .to_ascii_lowercase()
        .into_boxed_str()
}

/// Legge un elenco di prefissi: assente o vuoto significa vault intero.
pub(super) fn path_allowlist(
    permissions: &PluginPermissions,
    key: &str,
) -> Option<Arc<[Box<str>]>> {
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
    pub(super) fn covers(pattern: &str, target: &str) -> bool {
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
