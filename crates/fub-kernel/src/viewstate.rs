//! Lo **stato di vista** (§11.2): dove un esemplare di view ricorda lo scroll,
//! le sezioni collassate, il filtro corrente, la scheda attiva.
//!
//! # Perché non è né una impostazione né un blob
//!
//! È il terzo dei tre stati che la seduta 11 teneva insieme, e si distingue
//! dagli altri due per **dove non deve andare**:
//!
//! - non è una **impostazione** ([`crate::settings`]): un'impostazione ha un
//!   valore per chiave e la decide l'utente; questo ha un valore per *esemplare*
//!   e non lo decide nessuno — si deposita mentre si guarda. Metterlo là avrebbe
//!   voluto dire un pannello di impostazioni con dentro lo scroll di ieri;
//! - non è un **blob** (`data_*`): quelli vivono dentro il vault, quindi
//!   viaggiano con lui. Lo scroll di ieri sul portatile non è un fatto sul
//!   vault, e sincronizzarlo vorrebbe dire far litigare due macchine su dove si
//!   era rimasti.
//!
//! Vive quindi nella cartella di configurazione della **macchina**, accanto alle
//! impostazioni di macchina e al registro dei vault
//! ([decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)),
//! con la stessa disciplina: versione di schema, scrittura atomica, e un file
//! che non si è potuto leggere **non si riscrive**.
//!
//! # Un file solo, e il vault è la prima chiave
//!
//! Non un file per vault: i vault che una macchina conosce sono venti più i
//! preferiti (il tetto del registro), e un file per ognuno vorrebbe dire una
//! cartella di file dal nome illeggibile — perché il nome dovrebbe essere
//! l'impronta di un path — che nessuno saprebbe più mettere in relazione con
//! niente. Con il root come prima chiave il file si apre e si legge.
//!
//! Ne segue chi lo pota: **dimenticare un vault dimentica come lo si stava
//! guardando** ([`ViewStates::forget_vault`], chiamata da chi tiene il
//! registro). Senza quella riga il file sarebbe l'unico posto del progetto che
//! cresce e non cala mai.
//!
//! # La chiave è di chi scrive, e non è un parametro
//!
//! Tre livelli sotto il vault: **chi** (l'id del plugin), **quale esemplare**
//! ([`ViewInstance::instance`](fub_abi::traits::ViewInstance), che dalla
//! decisione 0007 è già «quale delle tre istanze di questa view sono io») e la
//! chiave che il provider sceglie. I primi due li timbra l'host, come l'id di un
//! job nella 0035: se fossero parametri, un provider potrebbe leggere lo scroll
//! di un altro, e due pannelli aperti sullo stesso vault si sovrascriverebbero a
//! vicenda credendo di ricordare.

use std::collections::BTreeMap;
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use serde::{Deserialize, Serialize};

use crate::storage::{non_lo_sovrascrivo, update_atomic};
use fub_abi::schema::SchemaVersion;

/// La versione di schema del file (§15.3).
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// chiave → valore, per un esemplare.
type Keys = BTreeMap<String, serde_json::Value>;
/// esemplare → le sue chiavi.
type Instances = BTreeMap<String, Keys>;
/// proprietario → i suoi esemplari.
type Owners = BTreeMap<String, Instances>;

#[derive(Default, Serialize, Deserialize)]
struct ViewStateFile {
    version: SchemaVersion,
    /// root del vault → ciò che su questa macchina si ricorda di lui.
    #[serde(default)]
    vaults: BTreeMap<String, Owners>,
}

/// Lo stato di vista di **questa macchina**, per tutti i vault che conosce.
///
/// Condiviso (`Arc`) come il livello macchina delle impostazioni e per la stessa
/// ragione: i vault aperti insieme sono N e la macchina è una. `path: None` è lo
/// store in memoria — quello di un test e di un e2e headless, che non deve
/// scrivere nella cartella di configurazione di chi esegue la suite.
pub struct ViewStates {
    path: Option<Utf8PathBuf>,
    vaults: RwLock<BTreeMap<String, Owners>>,
}

impl ViewStates {
    /// Apre (o crea al primo salvataggio) il file della macchina. Un file
    /// illeggibile non impedisce di aprire un vault: torna l'avviso, e si
    /// riparte da vuoto — perdere lo scroll non vale un'app che non parte.
    pub fn open(path: &Utf8Path) -> (Arc<Self>, Option<String>) {
        let (vaults, warning) = match load(path) {
            Ok(vaults) => (vaults, None),
            Err(e) => (BTreeMap::new(), Some(e)),
        };
        (
            Arc::new(ViewStates {
                path: Some(path.to_owned()),
                vaults: RwLock::new(vaults),
            }),
            warning,
        )
    }

    /// Uno store che non tocca il disco.
    pub fn in_memory() -> Arc<Self> {
        Arc::new(ViewStates {
            path: None,
            vaults: RwLock::new(BTreeMap::new()),
        })
    }

    /// Ciò che questo esemplare aveva salvato sotto questa chiave.
    pub fn get(
        &self,
        vault: &str,
        owner: &str,
        instance: &str,
        key: &str,
    ) -> Option<serde_json::Value> {
        self.vaults
            .read()
            .expect("stato di vista")
            .get(vault)?
            .get(owner)?
            .get(instance)?
            .get(key)
            .cloned()
    }

    /// Salva (`Some`) o dimentica (`None`). Scrive **su disco prima e in memoria
    /// dopo**, come lo store delle impostazioni: al contrario, una scrittura
    /// fallita lascerebbe in memoria un valore che il file non ha, e il
    /// chiamante che ha ricevuto l'errore non avrebbe modo di saperlo.
    pub fn set(
        &self,
        vault: &str,
        owner: &str,
        instance: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), String> {
        self.muta(|next| match value {
            Some(v) => {
                next.entry(vault.to_string())
                    .or_default()
                    .entry(owner.to_string())
                    .or_default()
                    .entry(instance.to_string())
                    .or_default()
                    .insert(key.to_string(), v);
            }
            // Dimenticare pota anche i contenitori rimasti vuoti: un esemplare
            // chiuso non deve lasciare dietro di sé una parentesi graffa vuota
            // per ogni volta che qualcuno lo ha aperto.
            None => {
                if let Some(keys) = next
                    .get_mut(vault)
                    .and_then(|o| o.get_mut(owner))
                    .and_then(|i| i.get_mut(instance))
                {
                    keys.remove(key);
                }
                prune(next, vault, owner, instance);
            }
        })
    }

    /// Dimentica tutto di un vault: lo chiama chi lo toglie dal registro.
    ///
    /// È la potatura di cui questo file ha bisogno per non crescere e basta, ed
    /// è anche la cosa giusta da fare: chi dimentica un vault non si aspetta che
    /// riaprendolo fra un anno le cartelle siano ancora aperte com'erano.
    ///
    /// # Perché prende **tutte** le forme e non una
    ///
    /// Perché una radice sola è nominabile in più modi — quello che l'utente ha
    /// scritto e la sua forma canonica — e la chiave qui è la stringa, quindi
    /// dimenticare *un* vault vuol dire togliere *N* chiavi. Chiamare N volte
    /// una funzione che ne toglie una era N scritture dello stesso file: se la
    /// seconda non riusciva — il disco pieno, un'altra finestra che ha appena
    /// riscritto il file — la prima era già andata, e restava un vault
    /// **mezzo** dimenticato, con lo scroll ancora lì sotto l'altro nome.
    ///
    /// Con la firma che prende l'insieme quel mezzo non esiste: è
    /// [`ViewStates::muta`] una volta sola, cioè una sola scrittura atomica,
    /// che o toglie tutte le forme o non ne toglie nessuna. È la stessa riga di
    /// `Registry::forget`, che dallo stesso chiamante riceve lo stesso elenco —
    /// e chi le chiama entrambe non ha più modo di scrivere il ciclo che stava
    /// fra le due.
    ///
    /// # E perché non chiede prima se c'è
    ///
    /// C'era una scorciatoia — *se in memoria non c'è, non costa una scrittura*
    /// — e chiedeva alla copia sbagliata. La copia in memoria è vecchia per
    /// definizione ([`ViewStates::muta`]: è **il disco** che si rilegge sotto
    /// lock, apposta), quindi lo scroll depositato da un'altra finestra di Fub
    /// dopo la nostra apertura sta nel file e non qui: la scorciatoia lo
    /// dichiarava assente, tornava `Ok`, e quel vault restava là dentro per
    /// sempre — dimenticato dal registro, dove l'utente lo vede, e ricordato in
    /// un file che non cala mai, che è precisamente ciò che questa funzione
    /// esiste per evitare. Costava una scrittura risparmiata su un gesto che si
    /// fa una volta ogni tanto.
    pub fn forget_vault(&self, forme: &[Utf8PathBuf]) -> Result<(), String> {
        self.muta(|next| {
            for forma in forme {
                next.remove(forma.as_str());
            }
        })
    }

    /// Una mutazione dello stato di vista: si applica a ciò che **sul disco c'è
    /// adesso**, non alla copia in memoria di chi la chiede.
    ///
    /// È la forma che il §15.2 chiede a chi ricompone un file della macchina
    /// ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)):
    /// due finestre di Fub aperte insieme depositano scroll di esemplari
    /// diversi, e ricomporre il file dalla propria copia vuol dire cancellare
    /// quelli dell'altra. Ciò che le due si scambiano non è mai la stessa
    /// chiave, quindi la fusione le tiene entrambe.
    ///
    /// La mutazione si scrive **una volta sola** e vale per i due casi: in
    /// memoria si applica alla mappa che c'è, su disco a quella riletta.
    fn muta(&self, f: impl FnOnce(&mut BTreeMap<String, Owners>)) -> Result<(), String> {
        let mut vaults = self.vaults.write().expect("stato di vista");
        let Some(path) = &self.path else {
            f(&mut vaults);
            return Ok(());
        };
        *vaults = update_atomic(
            path,
            // La rilettura è il cancello: vedi `non_lo_sovrascrivo`.
            || {
                load(path).map_err(|e| {
                    non_lo_sovrascrivo(&e, "lo stato di vista che contiene andrebbe perso")
                })
            },
            |disco| {
                f(disco);
                encode(disco)
            },
        )?;
        Ok(())
    }
}

fn encode(vaults: &BTreeMap<String, Owners>) -> Result<Vec<u8>, String> {
    let file = ViewStateFile {
        version: SCHEMA_VERSION,
        vaults: vaults.clone(),
    };
    serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())
}

/// Toglie i contenitori rimasti vuoti dopo un `set(.., None)`.
fn prune(vaults: &mut BTreeMap<String, Owners>, vault: &str, owner: &str, instance: &str) {
    let Some(owners) = vaults.get_mut(vault) else {
        return;
    };
    if let Some(instances) = owners.get_mut(owner) {
        if instances.get(instance).is_some_and(|k| k.is_empty()) {
            instances.remove(instance);
        }
        if instances.is_empty() {
            owners.remove(owner);
        }
    }
    if owners.is_empty() {
        vaults.remove(vault);
    }
}

fn load(path: &Utf8Path) -> Result<BTreeMap<String, Owners>, String> {
    match std::fs::read_to_string(path) {
        Ok(json) => {
            let file: ViewStateFile = serde_json::from_str(&json)
                .map_err(|e| format!("{path} non è uno stato di vista valido: {e}"))?;
            if file.version > SCHEMA_VERSION {
                return Err(format!(
                    "{path} è scritto nella versione {} di questo formato, e questa \
                     copia di Fub legge fino alla {SCHEMA_VERSION}",
                    file.version
                ));
            }
            Ok(file.vaults)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("non riesco a leggere {path}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir() -> (tempfile::TempDir, Utf8PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
        (dir, path)
    }

    #[test]
    fn due_esemplari_della_stessa_view_hanno_due_stati() {
        // È la ragione per cui la chiave porta l'esemplare e non solo la view:
        // lo stesso pannello aperto due volte ha due scroll, ed è il
        // «per-pannello» che il §11.2 chiedeva.
        let states = ViewStates::in_memory();
        states
            .set("/v", "p", "uno", "scroll", Some(serde_json::json!(10)))
            .unwrap();
        states
            .set("/v", "p", "due", "scroll", Some(serde_json::json!(99)))
            .unwrap();
        assert_eq!(
            states.get("/v", "p", "uno", "scroll"),
            Some(serde_json::json!(10))
        );
        assert_eq!(
            states.get("/v", "p", "due", "scroll"),
            Some(serde_json::json!(99))
        );
    }

    #[test]
    fn lo_stesso_esemplare_in_due_vault_non_si_mescola() {
        let states = ViewStates::in_memory();
        states
            .set("/a", "p", "i", "aperte", Some(serde_json::json!(["x"])))
            .unwrap();
        assert_eq!(states.get("/b", "p", "i", "aperte"), None);
    }

    #[test]
    fn un_proprietario_non_vede_la_chiave_di_un_altro() {
        let states = ViewStates::in_memory();
        states
            .set("/v", "p", "i", "k", Some(serde_json::json!(1)))
            .unwrap();
        assert_eq!(states.get("/v", "altro", "i", "k"), None);
    }

    #[test]
    fn dimenticare_una_chiave_non_lascia_contenitori_vuoti() {
        let states = ViewStates::in_memory();
        states
            .set("/v", "p", "i", "k", Some(serde_json::json!(1)))
            .unwrap();
        states.set("/v", "p", "i", "k", None).unwrap();
        assert!(
            states.vaults.read().unwrap().is_empty(),
            "potato fino in cima"
        );
    }

    #[test]
    fn dimenticare_un_vault_dimentica_come_lo_si_guardava() {
        let states = ViewStates::in_memory();
        states
            .set("/a", "p", "i", "k", Some(serde_json::json!(1)))
            .unwrap();
        states
            .set("/b", "p", "i", "k", Some(serde_json::json!(2)))
            .unwrap();
        states.forget_vault(&[Utf8PathBuf::from("/a")]).unwrap();
        assert_eq!(states.get("/a", "p", "i", "k"), None);
        assert_eq!(states.get("/b", "p", "i", "k"), Some(serde_json::json!(2)));
    }

    /// 0089 — **le forme di una radice se ne vanno insieme**, e in una mossa
    /// sola.
    ///
    /// Un vault è nominabile in due modi (quello dato e la forma canonica) e
    /// qui la chiave è la stringa, quindi dimenticarlo tocca due chiavi. Il
    /// ciclo che stava dal lato dell'host ne faceva due scritture dello stesso
    /// file, e la seconda che non riesce lasciava il vault mezzo dimenticato.
    ///
    /// Questa metà del banco è **verde per costruzione**, e va detto: il tipo
    /// della firma prende l'insieme, quindi il ciclo non è più scrivibile e non
    /// c'è una versione di questo codice in cui il banco potrebbe fallire. È il
    /// compilatore a presidiare, non l'asserzione; l'asserzione dice cosa il
    /// compilatore sta proteggendo.
    #[test]
    fn le_forme_di_una_radice_se_ne_vanno_in_una_mossa_sola() {
        let states = ViewStates::in_memory();
        for forma in ["/var/vault", "/private/var/vault"] {
            states
                .set(forma, "p", "i", "k", Some(serde_json::json!(1)))
                .unwrap();
        }
        states
            .forget_vault(&[
                Utf8PathBuf::from("/var/vault"),
                Utf8PathBuf::from("/private/var/vault"),
            ])
            .unwrap();
        assert!(
            states.vaults.read().unwrap().is_empty(),
            "nessuna delle due forme resta indietro"
        );
    }

    /// 0089, la metà che **è** rossa — e non era quella scritta nella riga.
    ///
    /// La scorciatoia «se in memoria non c'è, non costa una scrittura»
    /// interrogava la copia vecchia per decidere di non guardare quella fresca.
    /// Qui il file cresce dopo l'apertura — che è ciò che fa una seconda
    /// finestra di Fub aperta sullo stesso vault, e la ragione per cui `muta`
    /// rilegge il disco sotto lock — e con la scorciatoia `forget_vault`
    /// rispondeva `Ok` senza togliere niente: il vault spariva dal registro, e
    /// il suo scroll restava in un file che non cala mai.
    #[test]
    fn dimentica_anche_cio_che_e_arrivato_nel_file_dopo_l_apertura() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("view-state.json");
        let (states, _) = ViewStates::open(&path);

        // Un'altra finestra deposita lo scroll di un vault che questa copia in
        // memoria non ha mai visto.
        let (altra, _) = ViewStates::open(&path);
        altra
            .set("/a", "p", "i", "k", Some(serde_json::json!(1)))
            .unwrap();

        states.forget_vault(&[Utf8PathBuf::from("/a")]).unwrap();

        let (riletto, warning) = ViewStates::open(&path);
        assert!(warning.is_none());
        assert_eq!(
            riletto.get("/a", "p", "i", "k"),
            None,
            "dimenticare guarda il file, non il ricordo che se ne aveva"
        );
    }

    #[test]
    fn sopravvive_a_un_giro_su_disco() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("view-state.json");
        let (states, warning) = ViewStates::open(&path);
        assert!(warning.is_none());
        states
            .set("/v", "p", "i", "scroll", Some(serde_json::json!(42)))
            .unwrap();

        let (riletto, warning) = ViewStates::open(&path);
        assert!(warning.is_none());
        assert_eq!(
            riletto.get("/v", "p", "i", "scroll"),
            Some(serde_json::json!(42))
        );
    }

    /// La regola della 0036, di nuovo: leggere a vuoto salva il file per il
    /// tempo di **una** scrittura, perché scriverne una lo riscrive intero.
    #[test]
    fn un_file_rotto_non_lo_riscrive_la_prima_scrittura() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("view-state.json");
        let rotto = "{ \"version\": 1, \"vaults\": {,} }";
        std::fs::write(&path, rotto).unwrap();

        let (states, warning) = ViewStates::open(&path);
        assert!(warning.is_some(), "e lo dice");
        let e = states
            .set("/v", "p", "i", "k", Some(serde_json::json!(1)))
            .expect_err("non si scrive su ciò che non si è letto");
        assert!(e.contains("non lo sovrascrive"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), rotto);
    }

    /// **E un file corretto a mano non aspetta una riapertura** (difetto 0170).
    ///
    /// La faccia opposta del precedente, ed è la più silenziosa delle tre: qui
    /// nessuno vede il rifiuto: uno scroll che non si deposita non lo dice a
    /// nessuno, e si scopre riaprendo — cioè con l'unico gesto che rimetteva a
    /// posto anche la bandiera.
    #[test]
    fn un_file_corretto_a_mano_non_aspetta_una_riapertura() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("view-state.json");
        std::fs::write(&path, "{ \"version\": 1, \"vaults\": {,} }").unwrap();

        let (states, warning) = ViewStates::open(&path);
        assert!(warning.is_some(), "e lo dice");

        std::fs::write(
            &path,
            "{ \"version\": 1, \"vaults\": { \"/v\": { \"p\": { \"i\": { \"k\": 1 } } } } }",
        )
        .unwrap();

        states
            .set("/v", "p", "i", "altra", Some(serde_json::json!(2)))
            .expect("il file adesso si legge, e non c'è niente da riaprire");
        assert_eq!(
            states.get("/v", "p", "i", "k"),
            Some(serde_json::json!(1)),
            "e ciò che il file corretto diceva è la base della fusione"
        );
    }

    #[test]
    fn un_file_dal_futuro_non_si_indovina() {
        let (_tmp, dir) = tempdir();
        let path = dir.join("view-state.json");
        std::fs::write(&path, "{ \"version\": 99, \"vaults\": {} }").unwrap();
        let (_, warning) = ViewStates::open(&path);
        let warning = warning.expect("una versione che non si sa leggere si dice");
        assert!(warning.contains("99"), "{warning}");
    }
}
