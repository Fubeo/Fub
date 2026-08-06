//! [`OptionMap`] — *cosa è acceso, e con quale parametro*.
//!
//! È la risposta comune ai quattro tipi che il §3.5 nomina insieme: uno, tre o
//! cinque booleani dove la domanda che arriva ha una **coda aperta**. Le ~50
//! estensioni sintattiche del 5.2, i bersagli di rendering del 6.3, i permessi
//! del 20.3: nessuno dei tre insiemi è chiuso, e ognuno di loro, scritto come
//! campi, costa un campo del contratto per voce.
//!
//! Ciò che scade col freeze non è la **larghezza** di quei tipi — un campo
//! appeso in fondo a un `record` è additivo, e il presidio della
//! [decisione 0002](../../../docs/decisions/0002-additivita-del-contratto.md)
//! lo fa passare. A scadere è la **forma**: sostituire N booleani con una mappa
//! è la sola cosa che dopo il freeze non si fa più.
//!
//! # La chiave
//!
//! `ns:nome`. Il namespace è di chi definisce la voce: `fub` per il core (le
//! costanti stanno in [`syntax`], [`render_option`] e [`permission`]), l'id del
//! plugin per tutti gli altri. Due estensioni che vogliono chiamarsi allo stesso
//! modo hanno **due chiavi diverse**, e la collisione che il §3.1 nota — «due
//! estensioni che rivendicano la stessa sintassi non hanno nemmeno un posto dove
//! collidere» — smette di essere silenziosa perché ha un posto dove accadere.
//! La regola generale dei namespace resta del §7.4: qui c'è la sua applicazione
//! a questo tipo, e [`OptionMap::malformed`] è il punto dove si controlla.
//!
//! # Presenza e valore
//!
//! **Presente = acceso**, e il valore è il *parametro*. Un `false` esplicito
//! spegne; qualunque altro valore accende e porta con sé il suo dettaglio (una
//! allowlist, un livello, un elenco di varianti). È la stessa regola per le
//! quattro sedi, così chi ne impara una le sa tutte — e vale in particolare per
//! le [`FormatCapabilities`](crate::format::FormatCapabilities), dove il valore
//! è ciò che un booleano non poteva dire.
//!
//! # Gli stati sono **tre**, e uno dei tre non è «no»
//!
//! *Assente*, *spenta*, *accesa*: la regola qui sopra ne distingue tre, e
//! [`OptionMap::enabled`] ne dice due — perché la domanda che gli si fa ne
//! ammette due sole. Chi parsa deve sapere se accendere una sintassi, e *perché*
//! non è accesa non gli cambia una riga. Ma chi **mostra**, chi **negozia** e chi
//! **sovrappone** una mappa a un'altra la terza risposta ce l'ha eccome: una
//! voce che nessuno ha mai nominato è una voce su cui non si è deciso, una voce
//! messa a `false` è una voce su cui qualcuno ha deciso di no.
//!
//! [`OptionMap::status`] è la firma che non butta via quella differenza, e
//! [`OptionMap::enabled`] è la sua **proiezione** — scritta come tale, così che
//! le due non possano dire cose diverse. Non è una migrazione: il dato ce
//! l'aveva già (`get` torna un `Option<&Value>`), e ciò che mancava era il nome
//! con cui chiederlo.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Il namespace del core. Ogni chiave dichiarata da Fub comincia di qui.
pub const CORE_NS: &str = "fub";

/// Compone una chiave: `ns` + `nome`.
pub fn key(ns: &str, name: &str) -> String {
    format!("{ns}:{name}")
}

/// Una mappa `ns:nome` → parametro.
///
/// `BTreeMap` e non `HashMap`: l'ordine di iterazione è dato, non caso. Al
/// confine questa mappa è una **lista di coppie** (`option-map` nel WIT) perché
/// WIT non ha mappe; l'ordine stabile è ciò che rende quella lista confrontabile
/// e la sua serializzazione riproducibile.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct OptionMap {
    entries: BTreeMap<String, serde_json::Value>,
}

impl OptionMap {
    pub fn new() -> Self {
        Self::default()
    }

    /// Accende una voce senza parametro.
    pub fn on(mut self, key: impl Into<String>) -> Self {
        self.entries
            .insert(key.into(), serde_json::Value::Bool(true));
        self
    }

    /// Accende una voce col suo parametro.
    pub fn with(mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) -> Self {
        self.entries.insert(key.into(), value.into());
        self
    }

    pub fn set(&mut self, key: impl Into<String>, value: impl Into<serde_json::Value>) {
        self.entries.insert(key.into(), value.into());
    }

    pub fn remove(&mut self, key: &str) -> Option<serde_json::Value> {
        self.entries.remove(key)
    }

    /// Il parametro di una voce, se c'è.
    pub fn get(&self, key: &str) -> Option<&serde_json::Value> {
        self.entries.get(key)
    }

    /// In che **stato** è una voce: assente, spenta, o accesa col suo
    /// parametro.
    ///
    /// È la firma che risponde per intero, e [`enabled`](Self::enabled) è la sua
    /// proiezione sulla domanda a due valori. Le due stanno in quest'ordine e
    /// non nell'altro perché la tabella dei casi è **una**: finché `enabled`
    /// aveva il proprio `match`, aggiungere qui una riga senza aggiungerla là
    /// era una cosa che si poteva fare compilando.
    pub fn status(&self, key: &str) -> OptionStatus<'_> {
        self.entries.get(key).map_or(OptionStatus::Unset, status_of)
    }

    /// La voce è **accesa**? Assente = no; `false` esplicito = no; qualunque
    /// altro valore = sì, ed è il valore a portare il dettaglio.
    ///
    /// I due «no» non vogliono dire la stessa cosa — vedi
    /// [`status`](Self::status) — e questa firma li unisce di proposito: chi
    /// parsa, chi rende e chi apre un cancello fa la stessa cosa nei due casi, e
    /// obbligarli a un `match` a tre rami di cui due identici sarebbe rumore.
    pub fn enabled(&self, key: &str) -> bool {
        self.status(key).is_on()
    }

    /// Le voci **accese**, col loro parametro.
    ///
    /// È [`iter`](Self::iter) meno quelle spente, e serve a chi deve *elencare*
    /// ciò che è acceso invece di chiederlo per nome. Che non ci fosse è la
    /// ragione per cui `DocumentStore::syntax_forms` e `format_of` rispondevano
    /// due cose diverse sulla stessa mappa: la prima iterava, la seconda
    /// chiedeva, e la differenza era esattamente una voce a `false`.
    pub fn active(&self) -> impl Iterator<Item = (&str, &serde_json::Value)> {
        self.entries
            .iter()
            .filter(|(_, v)| status_of(v).is_on())
            .map(|(k, v)| (k.as_str(), v))
    }

    /// Il parametro come stringa, per le voci che ne portano una.
    pub fn as_str(&self, key: &str) -> Option<&str> {
        self.entries.get(key)?.as_str()
    }

    /// Il parametro come elenco di stringhe: la forma delle allowlist.
    pub fn as_strings(&self, key: &str) -> Vec<String> {
        match self.entries.get(key).and_then(|v| v.as_array()) {
            Some(items) => items
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect(),
            None => Vec::new(),
        }
    }

    pub fn contains(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &serde_json::Value)> {
        self.entries.iter().map(|(k, v)| (k.as_str(), v))
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.keys().map(String::as_str)
    }

    /// Le voci di un namespace, col nome già privato del prefisso.
    pub fn in_ns<'a>(
        &'a self,
        ns: &'a str,
    ) -> impl Iterator<Item = (&'a str, &'a serde_json::Value)> {
        let prefix = format!("{ns}:");
        self.entries
            .iter()
            .filter_map(move |(k, v)| k.strip_prefix(prefix.as_str()).map(|name| (name, v)))
    }

    /// Il namespace di una chiave, se la chiave ne ha uno.
    pub fn ns_of(key: &str) -> Option<&str> {
        let (ns, name) = key.split_once(':')?;
        (!ns.is_empty() && !name.is_empty()).then_some(ns)
    }

    /// Le chiavi senza namespace: quelle che il §7.4 chiama collisioni in
    /// attesa. Non è un errore *qui* — è il punto in cui chi applica la regola
    /// va a guardare, invece di scoprirlo quando due plugin si sovrascrivono.
    pub fn malformed(&self) -> Vec<&str> {
        self.entries
            .keys()
            .map(String::as_str)
            .filter(|k| Self::ns_of(k).is_none())
            .collect()
    }

    /// Fonde `other` dentro `self`: chi arriva dopo vince, **sulla singola
    /// chiave**. È la sovrapposizione vault → cartella → nota del 28 e del 6.2,
    /// ed è per chiave e non per mappa proprio perché una nota che accende una
    /// sintassi non deve spegnere tutte le altre.
    pub fn overlay(mut self, other: &OptionMap) -> Self {
        for (k, v) in &other.entries {
            self.entries.insert(k.clone(), v.clone());
        }
        self
    }
}

/// **La tabella dei casi, in una copia sola.**
///
/// Sta qui e non dentro `status` perché [`OptionMap::active`] ha bisogno della
/// stessa risposta partendo da un valore che ha già in mano, e passare da
/// `status` vorrebbe dire ricercare la chiave che si sta iterando.
fn status_of(value: &serde_json::Value) -> OptionStatus<'_> {
    match value {
        serde_json::Value::Bool(false) | serde_json::Value::Null => OptionStatus::Off,
        altro => OptionStatus::On(altro),
    }
}

/// Lo stato di una voce di [`OptionMap`]: **tre** casi, non due.
///
/// # Perché non è un `Option<bool>`
///
/// Perché il terzo caso porta un dato che gli altri due non hanno. `On` non è
/// «sì»: è «sì, **con questo parametro**», e il parametro è metà del valore
/// della mappa — l'allowlist di `fub:network`, i tipi di callout che un provider
/// sa fare. Un `Option<bool>` avrebbe distinto i tre stati e buttato via
/// esattamente la cosa per cui questa mappa esiste, cioè avrebbe riprodotto il
/// difetto un gradino più su.
///
/// # Perché `Unset` e `Off` sono separati e nessuno dei due è un errore
///
/// Sono la differenza fra *non si è deciso* e *si è deciso di no*, ed è la
/// differenza che [`OptionMap::overlay`] esiste per far viaggiare: una nota che
/// scrive `fub:wikilinks: false` sopra un vault che li accende sta dicendo
/// qualcosa, e se il livello di sotto non l'avesse detto affatto sarebbe un'altra
/// frase. Chi sovrappone tiene la distinzione (la mappa la conserva); chi legge
/// per agire la perde, e va bene — è il verso in cui si può perdere.
///
/// Non attraversa il confine: al confine c'è la **mappa**, e un `option-entry`
/// assente o messo a `false` porta i tre stati per conto suo. Questo tipo è il
/// nome che quei tre stati hanno di qua, e per questo non ha una forma WIT né
/// una `Serialize`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OptionStatus<'a> {
    /// Nessuno ha nominato questa voce.
    Unset,
    /// Qualcuno l'ha nominata per spegnerla (`false`, o `null`).
    Off,
    /// Accesa, col suo parametro — che è `true` quando non ne porta uno.
    On(&'a serde_json::Value),
}

impl<'a> OptionStatus<'a> {
    /// La proiezione sulla domanda a due valori.
    pub fn is_on(&self) -> bool {
        matches!(self, OptionStatus::On(_))
    }

    /// Il **parametro**, che esiste solo se la voce è accesa: una voce spenta
    /// non ne ha uno, e una assente nemmeno.
    ///
    /// Non torna il `Value` di una voce spenta di proposito — sarebbe
    /// `Bool(false)`, cioè un parametro che non parametrizza niente, e chi lo
    /// leggesse per sbaglio troverebbe un dato dove non c'è una scelta.
    pub fn parameter(&self) -> Option<&'a serde_json::Value> {
        match self {
            OptionStatus::On(v) => Some(v),
            _ => None,
        }
    }
}

impl<K: Into<String>, V: Into<serde_json::Value>> FromIterator<(K, V)> for OptionMap {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Self {
        OptionMap {
            entries: iter
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        }
    }
}

/// I nomi di sintassi che il core conosce: **lo stesso vocabolario** per
/// [`FormatCapabilities`](crate::format::FormatCapabilities) (*cosa so fare*) e
/// per [`ParseContext`](crate::format::ParseContext) (*cosa devo accendere*).
///
/// Erano due tipi con due elenchi di booleani, e il §3.4 e il §3.5 dicono che
/// sono la stessa domanda vista da due lati. Con un vocabolario solo, una
/// sintassi nuova si dichiara una volta e le due parti si parlano; con due, la
/// terza sintassi le fa divergere.
pub mod syntax {
    use super::CORE_NS;

    /// Compone il nome di una sintassi del core.
    pub fn core(name: &str) -> String {
        super::key(CORE_NS, name)
    }

    pub const WIKILINKS: &str = "fub:wikilinks";
    pub const TAGS: &str = "fub:tags";
    pub const FRONTMATTER: &str = "fub:frontmatter";
    pub const CALLOUTS: &str = "fub:callouts";
    pub const EMBEDS: &str = "fub:embeds";
    /// Blocchi e formule matematiche (`$…$`, `$$…$$`).
    pub const MATH: &str = "fub:math";
    /// Note a piè di pagina.
    pub const FOOTNOTES: &str = "fub:footnotes";
    /// Definition list.
    pub const DEFINITION_LISTS: &str = "fub:definition-lists";
    /// `==evidenziato==`.
    pub const HIGHLIGHT: &str = "fub:highlight";
    /// I diagrammi a blocco recintato: mermaid, PlantUML, Graphviz, D2.
    pub const DIAGRAMS: &str = "fub:diagrams";
}

/// Le opzioni di rendering del core — il *come*, mentre
/// [`RenderTarget`](crate::format::RenderTarget) è il *per chi*.
pub mod render_option {
    /// I wikilink escono come data-attribute che il frontend risolve, invece
    /// che come `href` veri.
    pub const WIKILINKS_AS_DATA_ATTRS: &str = "fub:wikilinks-as-data-attrs";
    /// Gli `id` di blocco: l'ancora che rende un blocco indirizzabile.
    pub const ANCHORS: &str = "fub:anchors";
}

/// I permessi che il core conosce. Il valore è il **parametro** del permesso:
/// una allowlist per la rete, un elenco di prefissi per il vault e per il
/// filesystem esterno. Il punto di applicazione non esiste ancora, ed è il
/// §7.3: qui c'è la forma, che è la metà che scade col freeze.
pub mod permission {
    /// Leggere il vault. Parametro: elenco di prefissi di path, assente = tutto.
    pub const READ_VAULT: &str = "fub:read-vault";
    /// Scrivere nel vault. Stesso parametro.
    pub const WRITE_VAULT: &str = "fub:write-vault";
    /// Rete. Parametro: allowlist di host (20.3, «network allowlist»).
    pub const NETWORK: &str = "fub:network";
    /// Appunti di sistema.
    pub const CLIPBOARD: &str = "fub:clipboard";
    pub const CAMERA: &str = "fub:camera";
    pub const MICROPHONE: &str = "fub:microphone";
    /// Filesystem fuori dal vault. Parametro: elenco di path (20.3, «file
    /// allowlist»).
    pub const EXTERNAL_FS: &str = "fub:external-fs";
    /// Invocare i comandi del registro
    /// ([`HostCommands::run_command`](crate::traits::HostCommands::run_command)).
    ///
    /// È il permesso che **moltiplica**: chi lo ottiene può fare tutto ciò che
    /// sanno fare i comandi registrati, compresi quelli che scrivono. Sta
    /// accanto agli altri e non dentro `write-vault` perché un plugin può
    /// legittimamente volere l'uno senza l'altro — una macro che compone
    /// comandi altrui non scrive niente di suo, e un formattatore che riscrive
    /// una nota non ha motivo di invocare nessuno.
    pub const RUN_COMMAND: &str = "fub:run-command";
    /// Chiamare i servizi offerti da altri plugin
    /// ([`HostServices::call_service`](crate::traits::HostServices::call_service)).
    ///
    /// È un permesso a sé e non un sinonimo di `run-command`: un comando è una
    /// cosa che l'utente potrebbe fare da sé dalla palette, un servizio è una
    /// superficie che un plugin offre a un altro. Chi concede l'uno non ha
    /// detto niente sull'altro.
    pub const CALL_SERVICE: &str = "fub:call-service";
    /// Scrivere le impostazioni
    /// ([`SettingsWrite`](crate::traits::SettingsWrite)) — quelle che si sono
    /// dichiarate scrivibili da un programma.
    ///
    /// **Leggerle non ha un permesso** e non è una dimenticanza: uno schema è
    /// pubblico per costruzione (lo si legge dal manifest di chi lo dichiara) e
    /// questo store non contiene segreti, per regola scritta
    /// ([`crate::settings`]). Scriverle sì, e con un secondo cancello sulla
    /// chiave: il permesso dice *chi*, `program_writable` dice *cosa* — perché
    /// il divieto che conta, privacy e AI, non dipende da chi sta chiedendo.
    pub const WRITE_SETTINGS: &str = "fub:write-settings";
    /// Sapere **cosa guarda l'utente**: quale nota è aperta nel pannello con il
    /// focus, e in che modalità
    /// ([`HostEnv::active_context`](crate::traits::HostEnv::active_context)).
    ///
    /// Non è l'orologio, e non sta con lui: che ore sono è una proprietà della
    /// macchina, quale nota ho aperto è una proprietà di **me**. Il nome di una
    /// nota è già un fatto privato per chi tiene un diario, e per molto tempo
    /// è viaggiato sotto la sola famiglia che nessun manifest dichiarava.
    pub const READ_SESSION: &str = "fub:read-session";
    /// Leggere il **testo che l'utente ha selezionato**, verbatim.
    ///
    /// Sta accanto a [`READ_SESSION`] e non dentro, perché sono due domande
    /// diverse e un utente può voler rispondere di sì all'una e di no
    /// all'altra: *«questo plugin può sapere che nota sto guardando, non cosa
    /// ci sto scrivendo»*. Un pannello che segna la sezione corrente ha
    /// bisogno del primo e non del secondo; un contatore di parole della
    /// selezione ha bisogno di entrambi.
    ///
    /// **Non è un sottoinsieme di [`READ_VAULT`]**, ed è la ragione per cui non
    /// gli si è appoggiato: chi legge il vault legge un documento *che ha
    /// nominato*, chi legge la selezione riceve senza chiedere ciò che l'utente
    /// sta facendo adesso — e alla granularità con cui lo fa, perché la shell
    /// pubblica il contesto a ogni movimento del cursore. Appoggiarlo a
    /// `read-vault` avrebbe reso impossibile la cosa che questo permesso
    /// esiste per permettere: concedere il vault e negare la selezione.
    pub const READ_SELECTION: &str = "fub:read-selection";
    /// Leggere le **bozze**: ciò che l'utente stava scrivendo e non ha salvato
    /// ([`IndexQuery::Drafts`](crate::traits::IndexQuery::Drafts)).
    ///
    /// **Non è [`READ_VAULT`] con un altro nome, e non gli sta sotto.** Un
    /// documento salvato lo si legge **nominandolo**, ed è testo che l'utente
    /// ha deciso di consegnare al disco; una bozza non ha un nome da chiedere —
    /// la risposta le porta **tutte insieme, col testo dentro** — ed è
    /// precisamente ciò che l'utente *non* ha ancora deciso di consegnare. La
    /// [0088](../../../docs/decisions/0088-cio-che-non-e-ancora-successo.md)
    /// lo dice nella riga con cui nega per sempre la scrittura: *«il testo che
    /// l'utente non ha ancora salvato è il dato più privato che un vault
    /// contenga»*. Quella frase vale anche in lettura, perché la minaccia da
    /// cui difende è la **riservatezza** e non l'integrità.
    ///
    /// Sta **al posto** di `read-vault` su quella variante e non accanto, così
    /// che la leva valga nei due versi: *«puoi leggere le mie note, non ciò che
    /// sto scrivendo adesso»* e *«puoi ritrovare ciò che non ho salvato, il
    /// resto del vault no»*. Un pannello di recupero è la seconda frase, ed è
    /// il solo cliente che questa domanda abbia mai avuto.
    pub const READ_DRAFTS: &str = "fub:read-drafts";

    /// **Tutti e tredici** [conta: permessi-dichiarabili], in ordine di
    /// dichiarazione: l'elenco che questo host sa nominare.
    ///
    /// Serve a chi deve *mostrarli* — un pannello, una CLI, il momento in cui
    /// qualcuno accetta un componente — e la ragione per cui è una costante e
    /// non una convenzione sul prefisso è la stessa di `Capability::ALL`, che
    /// sta nel kernel e che questo crate non può nominare: una chiave che nascesse
    /// e non finisse qui **non sarebbe negabile**, cioè comparirebbe nel
    /// manifest e non sotto gli occhi di chi la concede. Che l'elenco sia
    /// chiuso è ciò che permette di dire, di una qualunque, *questo host non la
    /// conosce* — e un permesso che l'host non conosce non recinta niente, il
    /// che è un'informazione e non un dettaglio.
    ///
    /// Il presidio che lo tiene onesto sta accanto al `Guard`
    /// (`ogni_permesso_di_una_famiglia_e_nominato`): ogni famiglia che ha un
    /// permesso ha il proprio nome qui dentro. Il verso opposto **non** è
    /// presidiato e non deve esserlo — [`CAMERA`], [`MICROPHONE`],
    /// [`EXTERNAL_FS`] e [`CLIPBOARD`] sono nomi senza famiglia, cioè permessi
    /// che si dichiarano e che nessuna capacità di oggi consuma. Toglierli
    /// perché «non fanno niente» vorrebbe dire scoprire il giorno della prima
    /// capacità che il nome era libero.
    pub const ALL: [&str; 13] = [
        READ_VAULT,
        WRITE_VAULT,
        NETWORK,
        CLIPBOARD,
        CAMERA,
        MICROPHONE,
        EXTERNAL_FS,
        RUN_COMMAND,
        CALL_SERVICE,
        WRITE_SETTINGS,
        READ_SESSION,
        READ_SELECTION,
        READ_DRAFTS,
    ];

    /// Il nome di un permesso senza il suo namespace: `fub:network` →
    /// `network`.
    ///
    /// È la metà che entra in una chiave d'impostazione
    /// ([`settings::permission_key`](crate::settings::permission_key)) e in una
    /// chiave di catalogo, e sta qui perché lo spezzettamento della chiave è
    /// della mappa che la definisce — non di chi la mostra.
    pub fn name_of(permission: &str) -> &str {
        match permission.split_once(':') {
            Some((_, name)) => name,
            None => permission,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn presenza_e_valore() {
        let m = OptionMap::new()
            .on(syntax::TAGS)
            .with(syntax::WIKILINKS, false)
            .with(permission::NETWORK, json!(["api.example.com"]));

        assert!(m.enabled(syntax::TAGS));
        // Un `false` esplicito è diverso da assente, e spegne.
        assert!(!m.enabled(syntax::WIKILINKS));
        assert!(m.contains(syntax::WIKILINKS));
        assert!(!m.enabled(syntax::MATH));
        assert!(!m.contains(syntax::MATH));
        // Un valore che non è booleano accende E porta il dettaglio: è ciò che
        // un booleano non poteva fare.
        assert!(m.enabled(permission::NETWORK));
        assert_eq!(m.as_strings(permission::NETWORK), vec!["api.example.com"]);
    }

    /// **Gli stati sono tre**, e la firma comoda ne dice due *proiettando*
    /// invece di rispondere per conto suo.
    ///
    /// L'elenco qui sotto è tutte e sole le forme che un valore JSON può avere,
    /// e va provato rosso **togliendone una**: se si toglie `null`, o il
    /// booleano `true`, nessuno si accorge che la tabella non le copre più.
    #[test]
    fn gli_stati_di_una_voce_sono_tre_e_non_due() {
        let m = OptionMap::new()
            .with("fub:spenta", false)
            .with("fub:nulla", serde_json::Value::Null)
            .with("fub:accesa", true)
            .with("fub:parametrica", json!(["api.example.com"]))
            .with("fub:zero", json!(0));

        // Il caso che il booleano non sapeva dire: due `false` diversi.
        assert_eq!(m.status("fub:mai-nominata"), OptionStatus::Unset);
        assert_eq!(m.status("fub:spenta"), OptionStatus::Off);
        assert_eq!(m.status("fub:nulla"), OptionStatus::Off);
        assert_eq!(m.status("fub:accesa"), OptionStatus::On(&json!(true)));
        assert_eq!(
            m.status("fub:parametrica"),
            OptionStatus::On(&json!(["api.example.com"]))
        );
        // `0` è un parametro, non uno spegnimento: la regola è «presente =
        // acceso», non «il valore è veritiero».
        assert_eq!(m.status("fub:zero"), OptionStatus::On(&json!(0)));

        // E `enabled` è la proiezione: stessa tabella, meno informazione.
        for key in [
            "fub:mai-nominata",
            "fub:spenta",
            "fub:nulla",
            "fub:accesa",
            "fub:parametrica",
            "fub:zero",
        ] {
            assert_eq!(
                m.enabled(key),
                m.status(key).is_on(),
                "`enabled` e `status` non dicono la stessa cosa su `{key}`"
            );
        }

        // Il parametro c'è solo dove c'è una scelta: una voce spenta non ne ha
        // uno, e `Bool(false)` non deve poter passare per tale.
        assert_eq!(m.status("fub:spenta").parameter(), None);
        assert_eq!(m.status("fub:mai-nominata").parameter(), None);
        assert_eq!(
            m.status("fub:parametrica").parameter(),
            Some(&json!(["api.example.com"]))
        );
    }

    /// **Elencare ciò che è acceso** non è iterare la mappa, ed è la differenza
    /// che faceva divergere `syntax_forms` da `format_of`.
    #[test]
    fn active_e_iter_meno_le_spente() {
        let m = OptionMap::new()
            .on(syntax::TAGS)
            .with(syntax::WIKILINKS, false)
            .with(syntax::MATH, serde_json::Value::Null)
            .with(syntax::CALLOUTS, json!(["note", "warning"]));

        let accese: Vec<&str> = m.active().map(|(k, _)| k).collect();
        assert_eq!(accese, vec![syntax::CALLOUTS, syntax::TAGS]);
        assert_eq!(
            m.iter().count(),
            4,
            "`iter` le porta tutte, spente comprese"
        );
        // E il parametro viaggia con la voce: elencare non è perdere.
        let callouts = m.active().find(|(k, _)| *k == syntax::CALLOUTS).unwrap().1;
        assert_eq!(callouts, &json!(["note", "warning"]));
    }

    #[test]
    fn il_namespace_separa_chi_definisce_la_voce() {
        let m = OptionMap::new()
            .on(syntax::TAGS)
            .on("terzi:tags")
            .on("senza-namespace");

        assert_eq!(OptionMap::ns_of(syntax::TAGS), Some("fub"));
        assert_eq!(OptionMap::ns_of("terzi:tags"), Some("terzi"));
        assert_eq!(OptionMap::ns_of("senza-namespace"), None);
        // Due `tags` con due proprietari sono due voci, non una collisione.
        assert!(m.enabled(syntax::TAGS) && m.enabled("terzi:tags"));
        assert_eq!(m.malformed(), vec!["senza-namespace"]);

        let core: Vec<&str> = m.in_ns("fub").map(|(n, _)| n).collect();
        assert_eq!(core, vec!["tags"]);
    }

    #[test]
    fn overlay_e_per_chiave_non_per_mappa() {
        let vault = OptionMap::new().on(syntax::TAGS).on(syntax::WIKILINKS);
        let nota = OptionMap::new().with(syntax::WIKILINKS, false);
        let effettivo = vault.overlay(&nota);
        // La nota spegne i wikilink e NON si porta via i tag.
        assert!(effettivo.enabled(syntax::TAGS));
        assert!(!effettivo.enabled(syntax::WIKILINKS));
    }

    /// L'elenco dei permessi è **chiuso e senza doppioni**, e ogni nome sta nel
    /// namespace del core: sono le tre proprietà su cui poggia il fatto che un
    /// pannello possa mostrarli tutti sapendo di averli mostrati tutti.
    #[test]
    fn l_elenco_dei_permessi_e_chiuso() {
        let unici: std::collections::BTreeSet<&str> = permission::ALL.iter().copied().collect();
        assert_eq!(unici.len(), permission::ALL.len(), "un nome è ripetuto");
        for nome in permission::ALL {
            assert_eq!(
                OptionMap::ns_of(nome),
                Some(CORE_NS),
                "`{nome}` non è nel namespace del core"
            );
            assert!(!permission::name_of(nome).is_empty());
        }
        assert_eq!(permission::name_of(permission::NETWORK), "network");
        // Una chiave senza namespace è sé stessa: chi la mostra non deve
        // inventarsi un pezzo che non c'è.
        assert_eq!(permission::name_of("nudo"), "nudo");
    }

    #[test]
    fn serializza_come_oggetto_e_in_ordine_stabile() {
        let m = OptionMap::new().on(syntax::WIKILINKS).on(syntax::TAGS);
        let s = serde_json::to_string(&m).expect("serializza");
        assert_eq!(s, r#"{"fub:tags":true,"fub:wikilinks":true}"#);
        let back: OptionMap = serde_json::from_str(&s).expect("deserializza");
        assert_eq!(back, m);
    }
}
