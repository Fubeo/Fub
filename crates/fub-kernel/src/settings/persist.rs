//! La lettura e la scrittura dei file di livello: il giudizio su ciò che si
//! legge, la codifica, il salvataggio del vault e dei suoi profili.

use super::*;

/// Legge un file di livello. **Assente = mai configurato**, che è un esito
/// normale e non un errore; **malformato è un errore**, e ciò che si fa dopo lo
/// decide chi legge — sovrascriverlo col default in silenzio butterebbe via la
/// configurazione dell'utente, che è la stessa regola del sidecar
/// dell'organizzazione.
///
/// Chi legge i byte è un parametro, e non è pignoleria: il livello del **vault**
/// li prende dal supporto (§15.1) e quello della **macchina** dal filesystem,
/// perché sta fuori da ogni vault. La regola con cui si giudica ciò che si è
/// letto è però la stessa, e scriverla due volte sarebbe due idee di cosa vuol
/// dire «configurazione illeggibile».
pub(super) fn load_raw_from(
    path: &Utf8Path,
    read: impl FnOnce(&Utf8Path) -> std::io::Result<Vec<u8>>,
) -> Result<SettingsFile, String> {
    match read(path) {
        Ok(raw) => {
            let file: SettingsFile = serde_json::from_slice(&raw)
                .map_err(|and| format!("{path} non è un settings.json valido: {and}"))?;
            if file.version > SCHEMA_VERSION {
                return Err(format!(
                    "{path} è scritto nella versione {} di questo formato, e questa \
                     copia di Fub legge fino alla {SCHEMA_VERSION}",
                    file.version
                ));
            }
            Ok(file)
        }
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => Ok(SettingsFile {
            active_profile: default_profile_name(),
            ..SettingsFile::default()
        }),
        Err(and) => Err(format!("non riesco a leggere {path}: {and}")),
    }
}

pub(super) fn supported_values(file: &SettingsFile) -> BTreeMap<String, SettingValue> {
    file.values
        .iter()
        .filter_map(|(key, value)| {
            serde_json::from_value(value.clone())
                .ok()
                .map(|v| (key.clone(), v))
        })
        .collect()
}

pub(super) fn load_from(
    path: &Utf8Path,
    read: impl FnOnce(&Utf8Path) -> std::io::Result<Vec<u8>>,
) -> Result<BTreeMap<String, SettingValue>, String> {
    load_raw_from(path, read).map(|file| supported_values(&file))
}

/// I byte di un file di livello.
///
/// Che poi si scrivano **atomicamente** non è più una scelta di questa funzione:
/// lo sono entrambe le scritture che la usano, quella del supporto (§15.1) e
/// quella della macchina, perché l'atomicità è scesa sotto tutte e due
/// ([0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)). E
/// qui conta: questo file si riscrive a ogni interruttore toccato, e un JSON
/// troncato da un crash è una configurazione che al riavvio è *malformata* —
/// cioè, per la regola di [`load_from`], un errore che blocca la lettura di
/// tutte le altre chiavi.
pub(super) fn encode(file: &SettingsFile) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(file).map_err(|and| and.to_string())
}

/// Scrive **una chiave** del livello della macchina, fondendola con ciò che sul
/// disco c'è adesso.
///
/// Non prende la mappa del chiamante e non è un dettaglio: la sua copia è
/// vecchia dall'apertura, e ricomporre il file da lì cancella le chiavi che
/// un'altra installazione ha scritto nel frattempo. Ciò che si scrive è la
/// **chiave toccata**, applicata al file riletto sotto lock
/// ([`update_atomic`], [0066](../../../docs/decisions/0195-versioni-indipendenti.md)),
/// e la mappa che torna è quella fusa — che il chiamante adotta al posto della
/// propria.
pub(super) fn store(
    path: &Utf8Path,
    key: &str,
    value: Option<SettingValue>,
) -> Result<BTreeMap<String, SettingValue>, String> {
    update_atomic(
        path,
        || load_raw_from(path, |p| std::fs::read(p)).map_err(|and| do_not_overwrite(&and, LOSS)),
        |disk| {
            match &value {
                Some(v) => {
                    disk.values.insert(
                        key.to_string(),
                        serde_json::to_value(v).map_err(|e| e.to_string())?,
                    );
                }
                None => {
                    disk.values.remove(key);
                }
            }
            disk.version = SCHEMA_VERSION;
            encode(disk)
        },
    )
    .map(|disk| supported_values(&disk))
}

/// Scrive **una chiave** del livello del vault, fondendola con ciò che sul
/// supporto c'è adesso. Torna la mappa fusa.
///
/// È la gemella di [`store`] — stessa regola, altro livello — e per un pezzo non
/// lo è stata: il livello del vault ricomponeva il file intero dalla copia presa
/// **all'apertura**, cioè la *lost update* che la 0066 aveva tolto alla macchina
/// e lasciata dove pesa di più. La macchina è di una installazione sola; il file
/// del vault lo condividono due finestre sullo stesso vault e due macchine che
/// lo sincronizzano, ed è lì che «l'altra ha scritto dopo che io avevo letto»
/// smette di essere teorico.
///
/// **Il file riletto è anche il cancello**: se adesso è malformato non lo si
/// sovrascrive ([`do_not_overwrite`]), e la domanda si fa qui perché qui c'è
/// la risposta vera — fra l'apertura e questa scrittura il file può essere stato
/// rotto da un editor di testo o da una sincronizzazione a metà, e può essere
/// stato **rimesso a posto** dalla stessa mano (difetto 0170).
pub(super) fn store_vault(
    storage: &dyn VaultStorage,
    path: &Utf8Path,
    key: &str,
    value: Option<SettingValue>,
) -> Result<BTreeMap<String, SettingValue>, String> {
    // Il valore **non si consuma**, e la ragione non è di stile. `fondi` è una
    // `FnMut`: il supporto la può chiamare due volte, ed è ciò che farebbe un
    // supporto che riprova quando qualcun altro gli ha cambiato il file sotto.
    // Prima qui c'era un `Option::take` con un `expect` accanto — «il supporto
    // fonde una volta sola» — cioè una promessa che nella firma non c'è: chi
    // avesse montato un supporto suo l'avrebbe scoperta con un panico, e un
    // panico uccide il processo (0032). Rileggerlo a ogni giro è anche l'unica
    // cosa *giusta* da fare: la seconda fusione parte da byte diversi.
    let mut zone = None;
    // Il guasto di *dominio* viaggia di fianco invece che dentro l'`io::Error`,
    // o la sua frase uscirebbe da qui avvolta in un «non riesco a scrivere» che
    // dice la cosa sbagliata: il file non si è potuto **leggere**.
    let mut failure = None;
    let outcome = storage.update(path, &mut |current| {
        let new = load_raw_from(path, |_| match current {
            Some(bytes) => Ok(bytes.to_vec()),
            None => Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "mai configurato",
            )),
        });
        let mut disk = match new {
            Ok(disk) => disk,
            Err(and) => {
                failure = Some(do_not_overwrite(&and, LOSS));
                return Err(std::io::Error::other("il file non si è potuto leggere"));
            }
        };
        match &value {
            Some(v) => {
                disk.values.insert(
                    key.to_string(),
                    serde_json::to_value(v).map_err(std::io::Error::other)?,
                );
            }
            None => {
                disk.values.remove(key);
            }
        }
        disk.version = SCHEMA_VERSION;
        let bytes = match encode(&disk) {
            Ok(bytes) => bytes,
            Err(and) => {
                failure = Some(and);
                return Err(std::io::Error::other("il file non si è potuto comporre"));
            }
        };
        zone = Some(supported_values(&disk));
        Ok(Some(bytes))
    });
    match (outcome, failure) {
        (_, Some(failure)) => Err(failure),
        (Err(and), None) => Err(format!("non riesco a scrivere {path}: {and}")),
        // Un supporto che dice di aver scritto senza aver fuso niente non
        // lascia una mappa da adottare, e qui c'era un `expect`: la stessa
        // promessa non scritta di sopra, dall'altro lato. Adesso è un errore
        // come tutti gli altri — chi ha montato quel supporto legge una frase e
        // la sua configurazione in memoria resta quella di prima, invece di
        // perdere il processo.
        (Ok(()), None) => zone.ok_or_else(|| {
            format!("{path}: il supporto ha detto di aver scritto senza fondere niente")
        }),
    }
}

pub(super) fn change_vault_profiles(
    storage: &dyn VaultStorage,
    path: &Utf8Path,
    change: impl Fn(&mut SettingsFile) -> Result<(), String>,
) -> Result<SettingsFile, String> {
    let mut written = None;
    let mut failure = None;
    let outcome = storage.update(path, &mut |current| {
        let mut file = match load_raw_from(path, |_| match current {
            Some(bytes) => Ok(bytes.to_vec()),
            None => Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
        }) {
            Ok(file) => file,
            Err(error) => {
                failure = Some(do_not_overwrite(&error, LOSS));
                return Err(std::io::Error::other("unreadable settings"));
            }
        };
        if let Err(error) = change(&mut file) {
            failure = Some(error);
            return Err(std::io::Error::other("invalid profile operation"));
        }
        file.version = SCHEMA_VERSION;
        match encode(&file) {
            Ok(bytes) => {
                written = Some(file);
                Ok(Some(bytes))
            }
            Err(error) => {
                failure = Some(error);
                Err(std::io::Error::other("unserializable settings"))
            }
        }
    });
    if let Some(error) = failure {
        return Err(error);
    }
    outcome.map_err(|e| format!("non riesco a scrivere {path}: {e}"))?;
    written.ok_or_else(|| format!("{path}: settings were not written"))
}

/// Ciò che si perderebbe sovrascrivendo un file di livello che non si rilegge:
/// il testo che [`do_not_overwrite`] mette dopo la ragione, uguale per i due
/// livelli perché la perdita è la stessa.
pub(super) const LOSS: &str = "la configurazione che contiene andrebbe persa";

/// Il rifiuto di chi non trova lo schema di una chiave, detto **una volta** per
/// tutti e due gli store: il livello macchina e quello di un vault rispondono
/// alla stessa domanda, e due frasi diverse per lo stesso guasto manderebbero a
/// cercare la differenza dove non c'è.
pub(super) fn undeclared(key: &str) -> PluginError {
    PluginError::BadArgs(format!("nessuno ha dichiarato l'impostazione `{key}`").into())
}
