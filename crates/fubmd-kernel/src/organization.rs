//! Il sidecar dell'**organizzazione** (§11.3): `.fubmd/workspace.json`, e chi lo
//! possiede.
//!
//! # Cosa cambia rispetto a prima
//!
//! Il file c'era già, e stava fuori da ogni disciplina: lo leggevano e scrivevano
//! due funzioni dell'host con `std::fs` nudo, senza versione di schema, senza
//! scrittura atomica, e con la migrazione sui rename scritta in **TypeScript**
//! (`migrateOrganization`). Erano dati **autorevoli** — persi, non si
//! ricostruiscono — tenuti peggio di quelli derivati.
//!
//! Adesso è il kernel a possederlo, gemello di [`crate::settings`] e con la
//! stessa disciplina della [decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md):
//! versione di schema, [`write_atomic`], e un file che non si è potuto leggere
//! **non si riscrive**. Il file resta dov'era, `<root>/.fubmd/workspace.json`,
//! perché quello è il posto giusto: l'organizzazione **viaggia col vault**, ed è
//! ciò che la distingue dallo stato di vista (§11.2), che vive nella cartella
//! della macchina.
//!
//! # Le tre conseguenze del possesso
//!
//! 1. **La migrazione dei rename è del kernel**, e sta dentro l'operazione che
//!    sposta l'identità (`migrate_identity`) — non su un evento. La coda degli
//!    eventi ha un budget e può troncare (0034): un dato autorevole non può
//!    dipendere da una consegna best-effort. Ne segue anche che una rinomina
//!    fatta da un'**altra app a FubMD aperto** migra: il rilevatore la riconosce
//!    e passa dallo stesso punto.
//! 2. **Si scrive per chiave, non a blob intero.** Prima la shell rileggeva
//!    tutto, cambiava un campo e riscriveva tutto: due finestre sullo stesso
//!    vault erano una *lost update* — la seconda che salva cancella ciò che ha
//!    fatto la prima, e nessuna delle due se ne accorge.
//! 3. **Si legge dal canale dati** ([`IndexQuery::Organization`](fubmd_abi::traits::IndexQuery::Organization)),
//!    quindi anche un provider può chiederla. Prima era un comando IPC: una cosa
//!    che la shell sapeva chiedere e nessun altro.
//!
//! # Gli orfani restano, ed è una scelta
//!
//! Una chiave che punta a un path che non esiste più **non si pota**. Non è una
//! dimenticanza: un vault cambia anche fuori di qui — un file torna da un
//! backup, un `git checkout` cambia branch, una cartella si rimonta — e potare
//! l'icona di una nota che ricomparirà domani vuol dire distruggere un dato
//! autorevole per fare ordine in un file di poche righe. Il costo di tenerli è
//! una riga di JSON; quello di sbagliare a toglierli non si ripara.
//!
//! Restano scoperti i due casi in cui un orfano nasce **senza** che nessuno lo
//! veda, e sono scoperti perché stanno altrove:
//!
//! - la rinomina fatta **a FubMD chiuso**: nessuno la vede, e al riavvio non c'è
//!   modo di sapere che `b.md` era `a.md`. È il §13.1 — il path è l'identità — e
//!   si chiude dando ai documenti un'identità che il path non è;
//! - la rinomina di una **cartella**: il kernel non ne ha una operazione, e da
//!   un'altra app arriva come N rinomine di documenti. Le icone delle *note*
//!   migrano quindi una per una (ci passano da qui), quella della cartella e il
//!   suo ordine no. Dedurre «la cartella X è diventata Y» da N rinomine che
//!   condividono un prefisso è un indovinello, non un fatto — e questo file
//!   tiene dati autorevoli.

use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::organization::Organization;
use serde::{Deserialize, Serialize};

use crate::settings::write_atomic;

/// La versione di schema del file (§15.3).
///
/// Il file **nasce senza**: esiste dal giorno in cui il sidecar è stato scritto
/// dall'host, e nessuno gli aveva messo un numero. Un campo assente vale `0`
/// (`#[serde(default)]`), che è ≤ di questa, quindi un vault organizzato prima di
/// questa voce si apre e si legge; la prima scrittura lo porta alla 1. È il
/// motivo per cui la versione va messa *dal primo giorno* — la si aggiunge dopo
/// solo indovinando che ciò che non ce l'ha venga da prima.
const SCHEMA_VERSION: u32 = 1;

/// Il file com'è su disco: l'organizzazione, più il numero di formato.
#[derive(Default, Serialize, Deserialize)]
struct OrganizationFile {
    #[serde(default)]
    version: u32,
    #[serde(flatten)]
    organization: Organization,
}

/// Dove sta il sidecar, data la radice del vault.
///
/// In `.fubmd/`, che è un dot-dir: scansione, rilevatore e indice lo ignorano
/// già, quindi l'organizzazione non è un documento del vault che si vede nella
/// lista dei file.
pub fn organization_path(root: &Utf8Path) -> Utf8PathBuf {
    root.join(crate::vault::FUBMD_DIR).join("workspace.json")
}

/// L'organizzazione di **questo** vault.
///
/// `path: None` è lo store in memoria — quello di un test — che non tocca il
/// disco. Come per le impostazioni e per lo stato di vista, e per la stessa
/// ragione: un default che scrive è un difetto che si scopre tardi.
pub struct OrganizationStore {
    path: Option<Utf8PathBuf>,
    /// Il file si è letto? Se no **non lo si riscrive**, ed è qui che questa
    /// regola conta più che altrove: la configurazione al peggio si rifà
    /// cliccando gli stessi interruttori, l'organizzazione di un vault di mille
    /// note no.
    readable: bool,
    data: RwLock<Organization>,
    /// Cosa è andato storto **dopo** l'apertura: una migrazione che non si è
    /// potuta scrivere. Chi monta le mostra e se ne fa carico svuotandole, come
    /// per gli avvisi della configurazione.
    warnings: RwLock<Vec<String>>,
}

impl OrganizationStore {
    /// Apre il sidecar di un vault. Un file illeggibile **non impedisce di
    /// aprirlo**: torna l'avviso, si lavora con l'organizzazione vuota, e le
    /// scritture successive vengono rifiutate una per una invece di seppellire
    /// ciò che non si è riusciti a leggere.
    pub fn open(root: &Utf8Path) -> (Arc<Self>, Option<String>) {
        let path = organization_path(root);
        let (data, warning) = match load(&path) {
            Ok(data) => (data, None),
            Err(e) => (Organization::default(), Some(e)),
        };
        (
            Arc::new(OrganizationStore {
                path: Some(path),
                readable: warning.is_none(),
                data: RwLock::new(data),
                warnings: RwLock::new(Vec::new()),
            }),
            warning,
        )
    }

    /// Uno store che non tocca il disco.
    pub fn in_memory() -> Arc<Self> {
        Arc::new(OrganizationStore {
            path: None,
            readable: true,
            data: RwLock::new(Organization::default()),
            warnings: RwLock::new(Vec::new()),
        })
    }

    /// L'organizzazione intera: è ciò che il canale dati restituisce a
    /// [`IndexQuery::Organization`](fubmd_abi::traits::IndexQuery::Organization).
    pub fn snapshot(&self) -> Organization {
        self.data.read().expect("organizzazione").clone()
    }

    /// L'emoji di un path (`None` la toglie).
    pub fn set_icon(&self, path: &str, icon: Option<String>) -> Result<(), String> {
        self.update(|org| match icon {
            Some(icon) => {
                org.icons.insert(path.to_string(), icon);
            }
            None => {
                org.icons.remove(path);
            }
        })
    }

    /// Appunta o spunta una nota. Appuntata va **in fondo** all'elenco, che è
    /// l'ordine in cui l'utente le ha appuntate — e appuntare due volte la
    /// stessa non la sposta.
    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), String> {
        self.update(|org| match pinned {
            true => {
                if !org.pinned.iter().any(|p| p == id) {
                    org.pinned.push(id.to_string());
                }
            }
            false => org.pinned.retain(|p| p != id),
        })
    }

    /// Registra o toglie una cartella dagli spazi.
    pub fn set_space(&self, path: &str, is_space: bool) -> Result<(), String> {
        self.update(|org| match is_space {
            true => {
                if !org.spaces.iter().any(|s| s == path) {
                    org.spaces.push(path.to_string());
                }
            }
            false => org.spaces.retain(|s| s != path),
        })
    }

    /// L'ordine scelto a mano dei figli di una cartella. Un elenco vuoto
    /// **dimentica** l'ordine invece di scriverne uno vuoto: torna a valere
    /// l'alfabetico, che è ciò che significa.
    pub fn set_order(&self, folder: &str, names: Vec<String>) -> Result<(), String> {
        self.update(|org| match names.is_empty() {
            true => {
                org.order.remove(folder);
            }
            false => {
                org.order.insert(folder.to_string(), names);
            }
        })
    }

    /// Un rename porta con sé **icona, pin e posto nell'ordinamento**: sono
    /// attaccati alla nota, non al suo vecchio path.
    ///
    /// Torna `true` se qualcosa è cambiato — cioè se la nota era organizzata:
    /// per il caso normale (una nota qualunque, senza icona né pin) non si
    /// tocca il disco affatto.
    ///
    /// Lo spostamento **in un'altra cartella** toglie il posto nell'ordine
    /// invece di portarselo: un ordine è dei figli di *quella* cartella, e un
    /// nome che non è più suo figlio non ci sta dentro. Nella cartella nuova la
    /// nota entra in coda all'alfabetico, come una appena creata — che è ciò che
    /// è, per quella cartella.
    pub fn migrate(&self, from: &str, to: &str) -> Result<bool, String> {
        let mut data = self.data.write().expect("organizzazione");
        let mut next = data.clone();
        let mut cambiata = false;

        if let Some(icon) = next.icons.remove(from) {
            next.icons.insert(to.to_string(), icon);
            cambiata = true;
        }
        for p in next.pinned.iter_mut() {
            if p == from {
                *p = to.to_string();
                cambiata = true;
            }
        }
        if let Some(names) = next.order.get_mut(parent_of(from)) {
            if let Some(at) = names.iter().position(|n| n == child_name(from)) {
                if parent_of(from) == parent_of(to) {
                    names[at] = child_name(to).to_string();
                } else {
                    names.remove(at);
                }
                cambiata = true;
            }
        }
        if !cambiata {
            return Ok(false);
        }
        self.store(&next)?;
        *data = next;
        Ok(true)
    }

    /// Gli avvisi accumulati dopo l'apertura, svuotandoli: chi li prende se ne
    /// fa carico.
    pub fn take_warnings(&self) -> Vec<String> {
        std::mem::take(&mut *self.warnings.write().expect("organizzazione"))
    }

    /// Annota che una migrazione non si è potuta scrivere.
    ///
    /// Serve a `migrate_identity`, che **non torna un `Result`** e non può
    /// tornarlo: il rename del file è già avvenuto, e fallire lì vorrebbe dire
    /// annullare una rinomina riuscita perché un'icona non si è spostata. Il
    /// verso giusto è: la rinomina vale, l'icona resta indietro, e qualcuno lo
    /// dice.
    pub(crate) fn warn(&self, message: String) {
        self.warnings.write().expect("organizzazione").push(message);
    }

    fn update(&self, f: impl FnOnce(&mut Organization)) -> Result<(), String> {
        let mut data = self.data.write().expect("organizzazione");
        let mut next = data.clone();
        f(&mut next);
        if next == *data {
            // Niente è cambiato: non si tocca il disco. Cliccare due volte lo
            // stesso interruttore non è una scrittura.
            return Ok(());
        }
        self.store(&next)?;
        *data = next;
        Ok(())
    }

    /// **Su disco prima, in memoria dopo**: al contrario, una scrittura fallita
    /// lascerebbe in memoria un'organizzazione che il file non ha, e il
    /// chiamante che ha ricevuto l'errore non avrebbe modo di saperlo.
    fn store(&self, org: &Organization) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if !self.readable {
            return Err(format!(
                "{path} non si è potuto leggere all'apertura: FubMD non lo \
                 sovrascrive, o l'organizzazione che contiene andrebbe persa. \
                 Correggilo o spostalo, e riapri."
            ));
        }
        let file = OrganizationFile {
            version: SCHEMA_VERSION,
            organization: org.clone(),
        };
        let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        write_atomic(path, json.as_bytes())
    }
}

/// La cartella di un path (`""` per la radice), con la stessa regola del
/// frontend che questa funzione sostituisce.
fn parent_of(path: &str) -> &str {
    match path.rsplit_once('/') {
        Some((parent, _)) => parent,
        None => "",
    }
}

/// Il nome di un path dentro la sua cartella.
fn child_name(path: &str) -> &str {
    match path.rsplit_once('/') {
        Some((_, name)) => name,
        None => path,
    }
}

fn load(path: &Utf8Path) -> Result<Organization, String> {
    match std::fs::read_to_string(path) {
        Ok(json) => {
            let file: OrganizationFile = serde_json::from_str(&json)
                .map_err(|e| format!("{path} non è un workspace.json valido: {e}"))?;
            if file.version > SCHEMA_VERSION {
                return Err(format!(
                    "{path} è scritto nella versione {} di questo formato, e questa \
                     copia di FubMD legge fino alla {SCHEMA_VERSION}",
                    file.version
                ));
            }
            Ok(file.organization)
        }
        // Assente = vault mai personalizzato: è un esito normale.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Organization::default()),
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
    fn scrivere_una_chiave_non_tocca_le_altre() {
        // È la ragione per cui i mutatori sono per chiave e non a blob intero:
        // con due finestre aperte, chi salvava per ultimo cancellava l'altro.
        let store = OrganizationStore::in_memory();
        store.set_icon("note/a.md", Some("📌".into())).unwrap();
        store.set_pinned("note/b.md", true).unwrap();
        store.set_space("note", true).unwrap();
        let org = store.snapshot();
        assert_eq!(org.icons.get("note/a.md").map(String::as_str), Some("📌"));
        assert_eq!(org.pinned, ["note/b.md"]);
        assert_eq!(org.spaces, ["note"]);
    }

    #[test]
    fn appuntare_due_volte_non_raddoppia_ne_sposta() {
        let store = OrganizationStore::in_memory();
        store.set_pinned("a.md", true).unwrap();
        store.set_pinned("b.md", true).unwrap();
        store.set_pinned("a.md", true).unwrap();
        assert_eq!(store.snapshot().pinned, ["a.md", "b.md"]);
        store.set_pinned("a.md", false).unwrap();
        assert_eq!(store.snapshot().pinned, ["b.md"]);
    }

    #[test]
    fn un_ordine_vuoto_si_dimentica() {
        let store = OrganizationStore::in_memory();
        store.set_order("note", vec!["b.md".into()]).unwrap();
        assert!(store.snapshot().order.contains_key("note"));
        store.set_order("note", Vec::new()).unwrap();
        assert!(
            !store.snapshot().order.contains_key("note"),
            "torna a valere l'alfabetico, che è ciò che significa"
        );
    }

    #[test]
    fn un_rename_porta_con_se_icona_pin_e_posto() {
        let store = OrganizationStore::in_memory();
        store.set_icon("a.md", Some("📌".into())).unwrap();
        store.set_pinned("a.md", true).unwrap();
        store
            .set_order("", vec!["a.md".into(), "b.md".into()])
            .unwrap();

        assert!(store.migrate("a.md", "c.md").unwrap());
        let org = store.snapshot();
        assert_eq!(org.icons.get("c.md").map(String::as_str), Some("📌"));
        assert!(!org.icons.contains_key("a.md"));
        assert_eq!(org.pinned, ["c.md"]);
        assert_eq!(org.order[""], ["c.md", "b.md"]);
    }

    #[test]
    fn spostare_in_unaltra_cartella_lascia_il_posto_nellordine() {
        let store = OrganizationStore::in_memory();
        store.set_icon("a.md", Some("📌".into())).unwrap();
        store
            .set_order("", vec!["a.md".into(), "b.md".into()])
            .unwrap();

        assert!(store.migrate("a.md", "note/a.md").unwrap());
        let org = store.snapshot();
        assert_eq!(
            org.icons.get("note/a.md").map(String::as_str),
            Some("📌"),
            "l'icona è della nota, e la segue ovunque"
        );
        assert_eq!(
            org.order[""],
            ["b.md"],
            "il posto invece era dei figli di quella cartella"
        );
    }

    #[test]
    fn una_nota_non_organizzata_non_fa_scrivere_niente() {
        let store = OrganizationStore::in_memory();
        store.set_icon("a.md", Some("📌".into())).unwrap();
        assert!(
            !store.migrate("b.md", "c.md").unwrap(),
            "niente da migrare, nessuna scrittura"
        );
    }

    #[test]
    fn sopravvive_a_un_giro_su_disco() {
        let (_tmp, root) = tempdir();
        let (store, warning) = OrganizationStore::open(&root);
        assert!(warning.is_none());
        store.set_icon("a.md", Some("📌".into())).unwrap();

        let (riletto, warning) = OrganizationStore::open(&root);
        assert!(warning.is_none());
        assert_eq!(
            riletto.snapshot().icons.get("a.md").map(String::as_str),
            Some("📌")
        );
    }

    /// Il file **nasce senza versione**: quello scritto prima di questa voce si
    /// apre, si legge, e la prima scrittura lo porta alla 1.
    #[test]
    fn un_sidecar_scritto_prima_di_questa_voce_si_legge() {
        let (_tmp, root) = tempdir();
        let path = organization_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"icons":{"a.md":"📌"},"pinned":["a.md"],"order":{},"spaces":[]}"#,
        )
        .unwrap();

        let (store, warning) = OrganizationStore::open(&root);
        assert!(warning.is_none(), "{warning:?}");
        assert_eq!(store.snapshot().pinned, ["a.md"]);

        store.set_icon("b.md", Some("📎".into())).unwrap();
        let scritto = std::fs::read_to_string(&path).unwrap();
        assert!(scritto.contains("\"version\": 1"), "{scritto}");
    }

    /// La regola della 0036, dove conta più che altrove: la configurazione al
    /// peggio si rifà cliccando, l'organizzazione di mille note no.
    #[test]
    fn un_file_rotto_non_lo_riscrive_la_prima_scrittura() {
        let (_tmp, root) = tempdir();
        let path = organization_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let rotto = "{ \"icons\": {,} }";
        std::fs::write(&path, rotto).unwrap();

        let (store, warning) = OrganizationStore::open(&root);
        assert!(warning.is_some(), "e lo dice");
        let e = store
            .set_icon("a.md", Some("📌".into()))
            .expect_err("non si scrive su ciò che non si è letto");
        assert!(e.contains("non lo sovrascrive"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), rotto);
    }

    #[test]
    fn un_file_dal_futuro_non_si_indovina() {
        let (_tmp, root) = tempdir();
        let path = organization_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"version":99}"#).unwrap();
        let (_, warning) = OrganizationStore::open(&root);
        let warning = warning.expect("una versione che non si sa leggere si dice");
        assert!(warning.contains("99"), "{warning}");
    }
}
