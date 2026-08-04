//! Le **impostazioni**: cosa un componente dichiara di poter configurare, e in
//! che forma il valore torna indietro (§11.1).
//!
//! # Lo schema sta nel manifest, non in un provider
//!
//! [`SettingSpec`] è un campo di
//! [`PluginManifest`](crate::traits::PluginManifest), come `provides` e
//! `requires`, e non il ritorno di un `SettingsProvider` da registrare. La
//! ragione è l'ordine dei passi del montaggio: la dichiarazione viene **prima**
//! di `Plugin::activate`, e il primo cliente vero delle impostazioni è proprio
//! un `activate` che deve sapere se la sua feature è accesa. Uno schema
//! registrato dopo l'attivazione sarebbe uno schema che non c'è nel momento in
//! cui serve, e chi lo leggesse riceverebbe il default anche quando l'utente ha
//! deciso il contrario — cioè l'unico errore che questa voce esiste per non
//! avere.
//!
//! Ne segue anche che un componente **non può dichiarare una chiave dopo**:
//! l'insieme delle chiavi di un plugin è il suo manifest, e ciò che il file di
//! configurazione contiene e nessuno dichiara resta lì senza essere letto,
//! invece di diventare uno spazio chiave→valore libero. Uno store senza schema
//! è ciò che la [decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md)
//! ha tolto (`storage_*`), e non rientra dalla finestra della configurazione.
//!
//! # La chiave è un nome, e ha un proprietario
//!
//! Le «chiavi di impostazione» sono uno degli otto spazi di nomi del §7.4
//! ([`rules::ids`](crate::rules::ids)): il core nomina nudo (`versioning.enabled`),
//! un plugin nomina dentro il proprio id (`com.acme.tasks:board.columns`). Non è
//! una convenzione: è la condizione perché la dichiarazione riesca, ed è ciò che
//! rende impossibile a due plugin contendersi una chiave — la sola cosa che, in
//! un file di configurazione condiviso, nessuno si accorgerebbe mai di aver
//! perso.
//!
//! # Un posto solo, e l'eccezione che lo conferma
//!
//! Un'impostazione vive nel **vault**, in `.fub/settings.json`: un file
//! visibile, copiabile, che viaggia col vault a cui si riferisce. È la
//! [0076](../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md), e
//! costa una riga di regole invece di due — «prima guardo qui, poi lì» era la
//! parte del §11.1 che nessuno avrebbe indovinato guardando il file.
//!
//! [`SettingScope`] resta perché resta il caso che l'ha fatto nascere, uno
//! solo: la **diagnostica** (`log.*`) deve valere anche quando un vault non si
//! apre, cioè quando una chiave che vive nel vault non è nemmeno leggibile. Le
//! chiavi [`SettingScope::Machine`] scritte in un `.fub/settings.json` si
//! **ignorano**, e chi le legge lo dice.
//!
//! # Cosa NON entra, e va detto
//!
//! - **I segreti.** Una chiave d'API di un servizio non è un'impostazione:
//!   questo store è un file JSON in chiaro, leggibile da chiunque possa
//!   interrogare il canale dati, e prometterne la riservatezza sarebbe la
//!   promessa vera a metà del quinto giro. Quando ci sarà un portachiavi di
//!   sistema sarà una capacità sua, con una firma sua.
//! - **Lo stato di vista** (scroll, sezioni collassate, tab attiva): è §11.2,
//!   ed è per-macchina *e per-pannello*, cioè una terza cosa che non ha né la
//!   forma di uno schema dichiarato né quella di un file che viaggia.
//! - **Il layout** (§11.2 anche lui): salvabile e ripristinabile, con più
//!   configurazioni per lo stesso utente. Un'impostazione ha un valore alla
//!   volta; un layout ne ha uno per nome.

use serde::{Deserialize, Serialize};

use crate::text::{Localize, Text};
use crate::ui::UiOption;

/// Dove un'impostazione ha il diritto di stare.
///
/// Il posto normale è **uno**, il vault; [`Machine`](SettingScope::Machine) è
/// l'eccezione dichiarata di chi non può dipendere da un vault aperto. Due e
/// non tre: il terzo — «profilo/portable» — non è un posto in cui cercare un
/// valore, è **dove sta il livello macchina**, e lo decide chi monta
/// (`fub_host::config_dir`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingScope {
    /// Del vault: sta in `.fub/settings.json`, **viaggia** col vault, ed è
    /// l'unico posto in cui quel valore esiste. Senza vault aperto vale il
    /// default dello schema — che per tema e lingua è «come il sistema».
    #[default]
    Vault,
    /// Della macchina: il livello del log, e per ora nient'altro. Non viaggia,
    /// e un vault che provasse a dichiararla non viene ascoltato.
    Machine,
}

/// Di che specie è un'impostazione, **col suo default dentro**.
///
/// Il default sta nella specie e non in un campo accanto perché sono la stessa
/// informazione detta una volta: un `Toggle` senza `default: bool` non
/// esisterebbe, e un `default` accanto a una specie che non lo accetta sarebbe
/// un caso da validare a ogni lettura.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SettingKind {
    /// Acceso o spento.
    Toggle { default: bool },
    /// Un numero, con gli estremi che chi disegna il campo usa e chi scrive il
    /// valore deve rispettare. Fuori intervallo è un rifiuto e non un
    /// arrotondamento: un valore corretto in silenzio è un valore che l'utente
    /// non ha scelto e non sa di non avere.
    Number {
        default: f64,
        min: Option<f64>,
        max: Option<f64>,
    },
    /// Testo libero.
    Text { default: String },
    /// Una fra N. Le opzioni sono [`UiOption`] — le stesse di un
    /// [`UiKind::Select`](crate::ui::UiKind::Select) — perché valore ed etichetta
    /// sono due cose anche qui: una scelta che è anche la propria etichetta non
    /// si può localizzare (§12.1).
    Choice {
        default: String,
        options: Vec<UiOption>,
    },
    /// Un elenco di stringhe: gli id dei plugin spenti, le cartelle escluse.
    ///
    /// Questa shell lo **mostra** e non lo edita: un editor di liste è un widget
    /// che il protocollo di UI non ha, e finché non ce l'ha si cambia dal
    /// comando che lo scrive. Dichiararlo lo stesso è ciò che permette a
    /// «quali plugin sono spenti» di essere un'impostazione come le altre invece
    /// di un file inventato accanto.
    List { default: Vec<String> },
}

impl SettingKind {
    /// Il valore che vale quando nessuno ha deciso.
    pub fn default_value(&self) -> SettingValue {
        match self {
            SettingKind::Toggle { default } => SettingValue::Toggle(*default),
            SettingKind::Number { default, .. } => SettingValue::Number(*default),
            SettingKind::Text { default } => SettingValue::Text(default.clone()),
            SettingKind::Choice { default, .. } => SettingValue::Text(default.clone()),
            SettingKind::List { default } => SettingValue::List(default.clone()),
        }
    }

    /// Questo valore è accettabile per questa specie? La ragione, se no.
    ///
    /// Torna una frase e non un booleano perché il chiamante la mette in un
    /// `PluginError::BadArgs`, e «valore non valido» non aiuta nessuno a
    /// correggere un file scritto a mano.
    pub fn rejects(&self, value: &SettingValue) -> Option<String> {
        match (self, value) {
            (SettingKind::Toggle { .. }, SettingValue::Toggle(_)) => None,
            (SettingKind::Number { min, max, .. }, SettingValue::Number(n)) => {
                if min.is_some_and(|m| *n < m) || max.is_some_and(|m| *n > m) {
                    return Some(format!(
                        "{n} è fuori dall'intervallo ammesso ({}…{})",
                        min.map(|m| m.to_string()).unwrap_or_else(|| "-∞".into()),
                        max.map(|m| m.to_string()).unwrap_or_else(|| "+∞".into()),
                    ));
                }
                None
            }
            (SettingKind::Text { .. }, SettingValue::Text(_)) => None,
            (SettingKind::Choice { options, .. }, SettingValue::Text(v)) => {
                if options.iter().any(|o| &o.value == v) {
                    None
                } else {
                    Some(format!(
                        "`{v}` non è fra le scelte ammesse ({})",
                        options
                            .iter()
                            .map(|o| o.value.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                }
            }
            (SettingKind::List { .. }, SettingValue::List(_)) => None,
            (kind, value) => Some(format!(
                "un'impostazione di specie `{}` non accetta un valore `{}`",
                kind.name(),
                value.name()
            )),
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            SettingKind::Toggle { .. } => "toggle",
            SettingKind::Number { .. } => "number",
            SettingKind::Text { .. } => "text",
            SettingKind::Choice { .. } => "choice",
            SettingKind::List { .. } => "list",
        }
    }
}

/// Il valore di un'impostazione.
///
/// **Non tagged**: un `.fub/settings.json` si apre con un editor di testo, si
/// mette sotto git e lo si legge in una diff, e `{"kind":"toggle","value":true}`
/// al posto di `true` renderebbe quel file illeggibile per guadagnare un'ambiguità
/// che non c'è — le quattro specie hanno quattro forme JSON distinte. Chi
/// deserializza sa comunque cosa aspettarsi, perché la specie la dichiara lo
/// schema.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SettingValue {
    Toggle(bool),
    Number(f64),
    Text(String),
    List(Vec<String>),
}

impl SettingValue {
    pub fn name(&self) -> &'static str {
        match self {
            SettingValue::Toggle(_) => "toggle",
            SettingValue::Number(_) => "number",
            SettingValue::Text(_) => "text",
            SettingValue::List(_) => "list",
        }
    }

    /// Il booleano, se è un interruttore. Chi chiede «è acceso?» a una chiave
    /// che non è un interruttore ha sbagliato chiave, e riceve `None` invece di
    /// un `false` che somiglia a una risposta.
    pub fn as_toggle(&self) -> Option<bool> {
        match self {
            SettingValue::Toggle(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self {
            SettingValue::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            SettingValue::Text(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_list(&self) -> Option<&[String]> {
        match self {
            SettingValue::List(v) => Some(v),
            _ => None,
        }
    }
}

/// Un'impostazione **dichiarata**: come si chiama, cosa vuol dire, dove sta e
/// chi la può scrivere.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettingSpec {
    /// La chiave, con la regola dei nomi del §7.4.
    pub key: String,
    /// Come si chiama per un umano.
    pub label: Text,
    /// Cosa fa, in prosa. È l'unica cosa che chi non ha scritto il plugin legge
    /// per decidere se toccarla.
    pub description: Text,
    /// Sotto quale intestazione raggrupparla nel form. Vuoto = le sciolte in
    /// fondo.
    ///
    /// È un [`Text`] come le altre due, e questo dice una cosa sul
    /// raggruppamento: chi disegna raggruppa per **intestazione risolta**, non
    /// per una chiave. La conseguenza va detta — due componenti che scrivono la
    /// stessa intestazione finiscono insieme, e due che la traducono
    /// diversamente finiscono separati — ed è la stessa che valeva prima, quando
    /// il campo era prosa libera. L'alternativa (una chiave di gruppo distinta
    /// dal suo titolo) è la forma giusta il giorno che i gruppi diventeranno
    /// ordinabili o annidati; oggi sarebbero due campi per dire una cosa.
    pub group: Text,
    pub scope: SettingScope,
    pub kind: SettingKind,
    /// **Un programma la può scrivere?**
    ///
    /// È il residuo che la [decisione 0010](../../../docs/decisions/0010-comando-descritto-a-una-macchina.md)
    /// aveva lasciato aperto: `CommandReach::Settings` diceva che un comando può
    /// toccare la configurazione, e non c'era nessuno schema che dicesse *quali
    /// chiavi*. Questa è la risposta, ed è **per chiave** invece che per
    /// famiglia perché la riga non negoziabile — privacy e AI non si spostano
    /// da sole — non è una proprietà di chi scrive: è una proprietà di ciò che
    /// si scrive.
    ///
    /// Il default è `false`, per la regola di [`Trust::default`]: ciò che si
    /// ottiene dimenticandosi di dichiarare non può essere più di ciò che si
    /// ottiene dichiarando. Un'impostazione che nessuno ha marcato resta
    /// dell'utente.
    pub program_writable: bool,
}

impl SettingSpec {
    /// Un interruttore, acceso o spento di default. È la forma più comune: una
    /// feature che si può spegnere.
    pub fn toggle(key: impl Into<String>, label: impl Into<Text>, default: bool) -> Self {
        SettingSpec::new(key, label, SettingKind::Toggle { default })
    }

    pub fn new(key: impl Into<String>, label: impl Into<Text>, kind: SettingKind) -> Self {
        SettingSpec {
            key: key.into(),
            label: label.into(),
            description: Text::default(),
            group: Text::default(),
            scope: SettingScope::Vault,
            kind,
            program_writable: false,
        }
    }

    pub fn describing(mut self, description: impl Into<Text>) -> Self {
        self.description = description.into();
        self
    }

    pub fn grouped(mut self, group: impl Into<Text>) -> Self {
        self.group = group.into();
        self
    }

    /// Della macchina, non del vault: non viaggia, e un vault che la dichiara
    /// non viene ascoltato.
    pub fn per_machine(mut self) -> Self {
        self.scope = SettingScope::Machine;
        self
    }

    /// Un programma la può scrivere (comandi, plugin col permesso
    /// `fub:write-settings`).
    pub fn program_writable(mut self) -> Self {
        self.program_writable = true;
        self
    }
}

/// La chiave d'impostazione con cui si riconfigura la scorciatoia di un comando
/// (§18.2).
///
/// Una chiave **per comando**, di specie [`SettingKind::Text`], col suggerimento
/// dichiarato dalla `CommandSpec` come default. Le due alternative sono state
/// scartate e la ragione sta nella
/// [0077](../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md): una lista
/// di stringhe `"note.create=Mod-Alt-k"` è un formato dentro un formato — la
/// stessa cosa che `LOG_VERBOSE` aveva già rifiutato — e un `SettingKind::Map`
/// è **firma** a ridosso del freeze di M4, che pagherebbero host, shell, WIT e
/// il pannello che le disegna.
///
/// La chiave nasce nel namespace del proprietario del comando, e per farlo si
/// spezza l'id sul primo `:` come vuole la regola dei nomi
/// ([`rules::ids`](crate::rules::ids)): `note.create` diventa `keys.note.create`,
/// `com.acme:tasks.add` diventa `com.acme:keys.tasks.add`. Il prefisso non può
/// stare davanti a tutto (`keys.com.acme:tasks.add` sarebbe un id nudo
/// dichiarato da un plugin, cioè inammissibile), e questa funzione è l'unico
/// posto in cui la composizione si scrive — la shell ne tiene il gemello, e i
/// due si provano sullo stesso elenco di casi.
pub fn keybinding_key(command_id: &str) -> String {
    match command_id.split_once(':') {
        Some((ns, name)) => format!("{ns}:keys.{name}"),
        None => format!("keys.{command_id}"),
    }
}

/// La chiave d'impostazione con cui si **nega a un componente un permesso che
/// il suo manifest dichiara** (§23.17).
///
/// Una chiave per coppia *(componente, permesso)*, di specie
/// [`SettingKind::Toggle`] e con **`true` come default**: ciò che il manifest
/// dichiara è concesso finché qualcuno non dice di no, che è la sola forma
/// compatibile con ciò che c'era prima — un permesso mai visto da nessuno non
/// deve cominciare a mancare perché ha acquistato un interruttore.
///
/// # Perché è la stessa mossa di [`keybinding_key`], e dove si scosta
///
/// Uguale per il motivo che conta: la fabbrica la **chiave**, non il plugin. Le
/// due alternative sono le stesse che la
/// [0077](../../docs/decisions/0077-una-scorciatoia-e-una-chiave.md) ha
/// scartato — una lista di stringhe `"com.acme fub:network"` è un formato dentro
/// un formato, un `SettingKind::Map` è firma a ridosso del freeze — e qui c'è
/// una terza ragione che là non c'era: con una chiave per coppia, **negare un
/// permesso eredita da solo tutto ciò che le impostazioni sanno già fare**, cioè
/// da dove viene il valore, l'azzeramento che lo fa ricadere, l'evento che
/// avvisa le altre finestre e il fatto che non sia scrivibile da un programma.
///
/// Si scosta in **un** punto, e va detto perché è la sola asimmetria: un id di
/// comando è unico da sé (`note.create`), quindi `keys.note.create` non collide
/// con nessuno; un nome di permesso invece è lo **stesso per tutti** — dieci
/// componenti dichiarano `fub:read-vault` — e quindi il componente deve entrare
/// nella chiave. L'unico posto in cui può entrare, per la regola dei nomi del
/// §7.4, è la fessura del namespace: `com.acme:permissions.read-vault`.
///
/// Ne segue che **anche una feature ufficiale nomina col proprio id** invece che
/// nudo, che è l'unico posto del repo in cui il core non usa la sua licenza di
/// nominare nudo. La licenza esiste perché il core dichiara chiavi
/// *dell'applicazione* (`versioning.enabled`, `plugins.disabled`): qui non c'è
/// niente dell'applicazione, perché **ogni permesso è di esattamente un
/// componente** — e una chiave nuda dovrebbe comunque portarsi dentro il nome
/// del componente per non collidere, cioè scriverlo due volte in due posti
/// diversi della stessa stringa.
pub fn permission_key(plugin: &str, permission: &str) -> String {
    format!(
        "{plugin}:permissions.{}",
        crate::options::permission::name_of(permission)
    )
}

/// Il componente e il permesso che una chiave fabbricata da
/// [`permission_key`] nomina, o `None` se non è una di quelle.
///
/// Esiste perché la scrittura di un'impostazione arriva con una chiave e basta,
/// e chi la riceve deve sapere **se ha appena cambiato un recinto**: senza
/// questa lettura, negare un permesso avrebbe effetto alla riapertura del vault
/// invece che subito — e la 0097 ha scritto il precedente opposto
/// (`JobHost::fetch` rilegge il permesso a ogni chiamata invece di catturarlo).
///
/// Il permesso torna **qualificato** (`fub:network`, non `network`): è la forma
/// in cui lo porta il manifest, cioè quella con cui chi chiama lo confronterà.
pub fn permission_of_key(key: &str) -> Option<(&str, String)> {
    let (plugin, rest) = key.split_once(':')?;
    let name = rest.strip_prefix("permissions.")?;
    if plugin.is_empty() || name.is_empty() {
        return None;
    }
    Some((plugin, crate::options::key(crate::options::CORE_NS, name)))
}

/// Da dove viene il valore che si sta leggendo.
///
/// Serve a chi disegna il form — «questa la stai sovrascrivendo per questo
/// vault» è un'informazione che l'utente vede solo se qualcuno gliela dice — e a
/// chi resetta: azzerare una chiave la fa **ricadere** al livello sotto, che non
/// è sempre il default.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingSource {
    /// Nessuno ha deciso: è il default dello schema.
    #[default]
    Default,
    /// Deciso una volta per questa macchina.
    Machine,
    /// Deciso per questo vault, e vince.
    Vault,
}

/// Una riga di configurazione **risolta**: lo schema, il valore che vale
/// adesso, e da dove viene.
///
/// È la risposta di [`IndexQuery::Settings`](crate::traits::IndexQuery::Settings),
/// cioè ciò che la shell disegna. I tre campi insieme e non tre query separate
/// perché sono la stessa domanda: un form che chiedesse gli schemi da una parte
/// e i valori dall'altra avrebbe due risposte da riconciliare, e le
/// riconcilierebbe male ogni volta che un valore cambia fra le due chiamate.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettingEntry {
    pub spec: SettingSpec,
    pub value: SettingValue,
    pub source: SettingSource,
}

impl Localize for SettingSpec {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        visit(&mut self.label);
        visit(&mut self.description);
        visit(&mut self.group);
        self.kind.visit_texts(visit);
    }
}

impl Localize for SettingKind {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        match self {
            SettingKind::Choice { options, .. } => options.visit_texts(visit),
            SettingKind::Toggle { .. }
            | SettingKind::Number { .. }
            | SettingKind::Text { .. }
            | SettingKind::List { .. } => {}
        }
    }
}

/// Una voce **intera**, com'è quando esce verso chi disegna: schema, valore e
/// provenienza. È lo schema a portare i testi — un [`SettingValue`] è dato
/// dell'utente, e non si traduce.
impl Localize for SettingEntry {
    fn visit_texts(&mut self, visit: &mut dyn FnMut(&mut Text)) {
        self.spec.visit_texts(visit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La chiave di un permesso e la sua lettura al contrario sono **una
    /// funzione sola vista da due lati**, e si provano insieme: è la coppia da
    /// cui dipende che negare abbia effetto adesso invece che alla riapertura.
    #[test]
    fn la_chiave_di_un_permesso_si_compone_e_si_rilegge() {
        for plugin in ["com.acme", "fub.search"] {
            for permesso in crate::options::permission::ALL {
                let chiave = permission_key(plugin, permesso);
                assert_eq!(
                    permission_of_key(&chiave),
                    Some((plugin, permesso.to_string())),
                    "`{chiave}` non si rilegge"
                );
            }
        }
        assert_eq!(
            permission_key("com.acme", "fub:read-vault"),
            "com.acme:permissions.read-vault"
        );
        // **Anche una feature ufficiale nomina col proprio id.** Un nome di
        // permesso è lo stesso per tutti, quindi il componente deve stare nella
        // chiave, e la fessura del namespace è l'unico posto in cui il §7.4 lo
        // lascia entrare.
        assert_eq!(
            permission_key("fub.search", "fub:read-vault"),
            "fub.search:permissions.read-vault"
        );
    }

    /// Ciò che **non** è una chiave di permesso non deve somigliarci: chi
    /// scrive un'impostazione qualunque non deve veder ricalcolare un recinto.
    #[test]
    fn una_chiave_qualunque_non_e_un_permesso() {
        for chiave in [
            "plugins.disabled",
            "versioning.enabled",
            "com.acme:permissions.",
            ":permissions.network",
            "permissions.network",
            "com.acme:keys.tasks.add",
            "com.acme:permission.network",
        ] {
            assert_eq!(permission_of_key(chiave), None, "`{chiave}`");
        }
    }

    #[test]
    fn il_default_esce_dalla_specie() {
        assert_eq!(
            SettingKind::Toggle { default: true }.default_value(),
            SettingValue::Toggle(true)
        );
        // Una scelta ha per valore il testo dell'opzione: `Choice` è un `Text`
        // con un recinto, non una quinta specie di valore.
        assert_eq!(
            SettingKind::Choice {
                default: "scuro".into(),
                options: vec![UiOption::new("scuro", "Scuro")],
            }
            .default_value(),
            SettingValue::Text("scuro".into())
        );
    }

    #[test]
    fn una_scelta_fuori_elenco_e_un_rifiuto_che_elenca() {
        let kind = SettingKind::Choice {
            default: "chiaro".into(),
            options: vec![
                UiOption::new("chiaro", "Chiaro"),
                UiOption::new("scuro", "Scuro"),
            ],
        };
        let why = kind
            .rejects(&SettingValue::Text("verde".into()))
            .expect("`verde` non è fra le scelte");
        assert!(why.contains("chiaro, scuro"), "{why}");
        assert!(kind.rejects(&SettingValue::Text("scuro".into())).is_none());
    }

    #[test]
    fn un_numero_fuori_intervallo_non_si_arrotonda() {
        let kind = SettingKind::Number {
            default: 12.0,
            min: Some(8.0),
            max: Some(72.0),
        };
        assert!(kind.rejects(&SettingValue::Number(4.0)).is_some());
        assert!(kind.rejects(&SettingValue::Number(8.0)).is_none());
        // E la specie sbagliata è un rifiuto anche quando il valore sarebbe
        // sensato: un `true` in un campo numerico è un file scritto male, non
        // un uno.
        assert!(kind.rejects(&SettingValue::Toggle(true)).is_some());
    }

    /// Il file si legge a occhio: è la ragione dell'`untagged`.
    #[test]
    fn un_valore_si_scrive_come_lo_scriverebbe_un_umano() {
        let json = serde_json::to_string(&SettingValue::Toggle(false)).unwrap();
        assert_eq!(json, "false");
        let letto: SettingValue = serde_json::from_str("[\"a\",\"b\"]").unwrap();
        assert_eq!(letto, SettingValue::List(vec!["a".into(), "b".into()]));
    }
}
