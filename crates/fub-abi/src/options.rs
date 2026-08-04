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

    /// La voce è **accesa**? Assente = no; `false` esplicito = no; qualunque
    /// altro valore = sì, ed è il valore a portare il dettaglio.
    pub fn enabled(&self, key: &str) -> bool {
        match self.entries.get(key) {
            None => false,
            Some(serde_json::Value::Bool(b)) => *b,
            Some(serde_json::Value::Null) => false,
            Some(_) => true,
        }
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
