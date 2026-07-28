//! Il **registro dei vault** (§11.1): quali si sono aperti, quali sono
//! preferiti, come si chiamano e con che icona.
//!
//! # Perché sta qui, e perché non poteva stare altrove
//!
//! La [decisione 0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)
//! ha chiuso la metà kernel del §9.6 — l'host tiene una **mappa** di sessioni e
//! sa qual è la corrente — e ha lasciato aperta questa: *un elenco di vault non
//! sta in nessun vault*. Non è una battuta sul dove metterlo: un file dentro
//! `Progetti/` che elenca anche `Diario/` è un file che, spostando `Progetti/`,
//! racconta una cosa falsa su un vault che non ha mai visto. L'unico posto che
//! regge la domanda è il livello **macchina**, che prima di questa voce non
//! esisteva affatto — ed è la ragione per cui il §9.6 non si poteva chiudere
//! senza il §11.1.
//!
//! # Perché è un file suo e non una chiave di impostazione
//!
//! Perché un'impostazione ha **un valore** e questo ha **dei record**. Una
//! chiave di tipo lista avrebbe potuto tenere i path, e poi avrebbe voluto
//! un'altra chiave per le icone e un'altra per i preferiti, tutte e tre da
//! tenere allineate per indice: cioè una tabella scritta in tre colonne che non
//! si parlano. Stessa cartella, stessa disciplina (versione di schema §15.3 e
//! scrittura atomica), due file.
//!
//! # Cosa NON tiene
//!
//! *Quali vault sono aperti adesso*: quello è [`Host`](crate::Host), è stato di
//! processo e muore con lui. Qui c'è la memoria fra un avvio e l'altro, che è
//! un'altra cosa e va tenuta separata — o riaprire l'app riaprirebbe da sé
//! tutto ciò che era aperto tre settimane fa.

use std::sync::Mutex;

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::PluginError;
use serde::{Deserialize, Serialize};

/// La versione di schema del file (§15.3).
const SCHEMA_VERSION: u32 = 1;

/// Quanti vault **non preferiti** si ricordano. I preferiti non si contano e
/// non scadono: sono una scelta, i recenti sono una traccia.
///
/// Il tetto è dichiarato e non silenzioso: chi cade fuori esce dall'elenco, e
/// l'unica cosa che si perde è la comodità di ritrovarlo in un click — il vault
/// è sul disco dov'era.
const RECENTI: usize = 20;

/// Un vault che questa macchina conosce.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VaultEntry {
    /// La radice, **canonica**: è la stessa chiave con cui `Host` riconosce una
    /// sessione, o `/vault` e `/vault/` sarebbero due voci dello stesso vault.
    pub root: String,
    /// Come si chiama per un umano. Vuoto = il nome della cartella, e chi
    /// disegna lo ricava da sé: memorizzarlo qui vorrebbe dire mostrare il nome
    /// vecchio dopo una rinomina della cartella.
    #[serde(default)]
    pub name: String,
    /// L'emoji accanto al nome, se l'utente ne ha scelta una.
    #[serde(default)]
    pub icon: Option<String>,
    /// Appuntato in cima: non scade e non si conta nel tetto dei recenti.
    #[serde(default)]
    pub favorite: bool,
    /// Millisecondi dall'epoca UNIX dell'ultima apertura. È l'ordine
    /// dell'elenco, ed è l'unico campo che il registro scrive da sé.
    #[serde(default)]
    pub last_opened: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct RegistryFile {
    version: u32,
    #[serde(default)]
    vaults: Vec<VaultEntry>,
}

/// Il registro, con il file su cui vive.
///
/// `path: None` è il registro **in memoria**, che è ciò che ha un host senza
/// installazione — un e2e headless, una CLI di prova — e non un caso
/// degenere: ricorda finché dura il processo, e non scrive nella cartella di
/// configurazione di chi sta eseguendo dei test.
pub struct VaultRegistry {
    path: Option<Utf8PathBuf>,
    /// Il file si è letto? Se no **non lo si riscrive**. Ripartire da vuoto è
    /// giusto per *leggere* — un elenco di scorciatoie non vale un'app che non
    /// parte — e sarebbe distruttivo per *scrivere*: il primo vault aperto dopo
    /// riscriverebbe il file intero da un elenco vuoto, e i preferiti di chi ha
    /// sbagliato una virgola sparirebbero senza che nessuno glielo dica.
    readable: bool,
    entries: Mutex<Vec<VaultEntry>>,
}

impl VaultRegistry {
    /// Apre il registro di una cartella di configurazione. Un file illeggibile
    /// non impedisce di aprire un vault: si riparte da vuoto e si dice cosa è
    /// successo — un elenco di scorciatoie non vale un'app che non parte.
    pub fn open(path: &Utf8Path) -> (Self, Option<String>) {
        let (entries, warning) = match std::fs::read_to_string(path) {
            Ok(json) => match serde_json::from_str::<RegistryFile>(&json) {
                Ok(file) if file.version <= SCHEMA_VERSION => (file.vaults, None),
                Ok(file) => (
                    Vec::new(),
                    Some(format!(
                        "{path} è scritto nella versione {} di questo formato, e questa \
                         copia di FubMD legge fino alla {SCHEMA_VERSION}",
                        file.version
                    )),
                ),
                Err(e) => (
                    Vec::new(),
                    Some(format!("{path} non è un vaults.json valido: {e}")),
                ),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (Vec::new(), None),
            Err(e) => (
                Vec::new(),
                Some(format!("non riesco a leggere {path}: {e}")),
            ),
        };
        (
            VaultRegistry {
                path: Some(path.to_owned()),
                readable: warning.is_none(),
                entries: Mutex::new(entries),
            },
            warning,
        )
    }

    /// Un registro che non tocca il disco.
    pub fn in_memory() -> Self {
        VaultRegistry {
            path: None,
            readable: true,
            entries: Mutex::new(Vec::new()),
        }
    }

    /// I vault conosciuti: prima i preferiti, poi i recenti, ognuno dal più
    /// recente. L'ordine è **del registro** e non di chi disegna: due elenchi
    /// ordinati in due posti sarebbero due idee di cosa vuol dire "recente".
    pub fn list(&self) -> Vec<VaultEntry> {
        let mut entries = self.entries.lock().expect("registro dei vault").clone();
        entries.sort_by(|a, b| {
            b.favorite
                .cmp(&a.favorite)
                .then(b.last_opened.cmp(&a.last_opened))
                .then(a.root.cmp(&b.root))
        });
        entries
    }

    /// Un vault è stato aperto: entra nell'elenco, o risale in cima.
    pub fn note_opened(&self, root: &Utf8Path, now: u64) -> Result<(), PluginError> {
        self.update(root, |entry| entry.last_opened = now)
    }

    pub fn set_favorite(&self, root: &Utf8Path, favorite: bool) -> Result<(), PluginError> {
        self.update(root, |entry| entry.favorite = favorite)
    }

    /// L'icona (`None` la toglie) e il nome (vuoto = quello della cartella).
    pub fn set_look(
        &self,
        root: &Utf8Path,
        icon: Option<String>,
        name: Option<String>,
    ) -> Result<(), PluginError> {
        self.update(root, |entry| {
            entry.icon = icon.clone();
            if let Some(name) = name.clone() {
                entry.name = name;
            }
        })
    }

    /// Dimentica un vault. **Non lo tocca sul disco**, ed è tutto ciò che questa
    /// funzione fa: un registro che cancellasse i vault sarebbe un elenco di
    /// scorciatoie con il potere di distruggere ciò a cui puntano.
    ///
    /// Prende **le forme** di una radice e non una radice, perché chi dimentica
    /// è l'unico che non può canonicalizzare: [`VaultEntry::root`] è canonica
    /// per contratto, ma la cartella di un vault dimenticato spesso non esiste
    /// più — e su un path che non esiste `canonicalize` non risponde. Quindi si
    /// cancella per **entrambe** le forme, quella data e la canonica se c'è, e
    /// una sola volta: due `forget` sarebbero due scritture del file per un
    /// vault solo.
    ///
    /// Chi passa una forma sola non paga niente: `retain` guarda una stringa in
    /// più per voce.
    pub fn forget(&self, forme: &[Utf8PathBuf]) -> Result<(), PluginError> {
        let mut entries = self.entries.lock().expect("registro dei vault");
        let mut next = entries.clone();
        next.retain(|e| !forme.iter().any(|f| f.as_str() == e.root));
        self.save(&next)?;
        *entries = next;
        Ok(())
    }

    /// Come per lo store di configurazione: **su disco prima, in memoria dopo**.
    /// Al contrario, un salvataggio fallito lascerebbe il registro in memoria
    /// diverso da quello sul disco, e il chiamante che ha ricevuto l'errore non
    /// avrebbe modo di saperlo.
    fn update(&self, root: &Utf8Path, f: impl FnOnce(&mut VaultEntry)) -> Result<(), PluginError> {
        let mut entries = self.entries.lock().expect("registro dei vault");
        let mut next = entries.clone();
        let root = root.as_str();
        match next.iter_mut().find(|e| e.root == root) {
            Some(entry) => f(entry),
            None => {
                let mut entry = VaultEntry {
                    root: root.to_string(),
                    name: String::new(),
                    icon: None,
                    favorite: false,
                    last_opened: 0,
                };
                f(&mut entry);
                next.push(entry);
            }
        }
        // Il tetto si applica **dopo** l'aggiornamento e ai soli non preferiti,
        // così l'ultimo aperto non può mai essere quello che esce.
        let mut recenti: Vec<usize> = next
            .iter()
            .enumerate()
            .filter(|(_, e)| !e.favorite)
            .map(|(i, _)| i)
            .collect();
        if recenti.len() > RECENTI {
            recenti.sort_by_key(|&i| std::cmp::Reverse(next[i].last_opened));
            let da_togliere: std::collections::BTreeSet<usize> =
                recenti.into_iter().skip(RECENTI).collect();
            let mut i = 0;
            next.retain(|_| {
                let tenere = !da_togliere.contains(&i);
                i += 1;
                tenere
            });
        }
        self.save(&next)?;
        *entries = next;
        Ok(())
    }

    fn save(&self, entries: &[VaultEntry]) -> Result<(), PluginError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if !self.readable {
            // `Io` e non `PermissionDenied`: nessuno ha negato un permesso, è un
            // file che non si può usare — e il verbo che chi legge deve leggere
            // è «correggilo e riapri», non «non ti è consentito».
            return Err(PluginError::Io(
                format!(
                    "{path} non si è potuto leggere all'apertura: FubMD non lo \
                     sovrascrive, o i vault che ci sono elencati andrebbero persi. \
                     Correggilo o spostalo, e riapri."
                )
                .into(),
            ));
        }
        let file = RegistryFile {
            version: SCHEMA_VERSION,
            vaults: entries.to_vec(),
        };
        // Serializzare una struttura nostra che non serializza è un difetto di
        // chi l'ha scritta, non il mondo: qui `Internal` è la verità.
        let json = serde_json::to_string_pretty(&file)
            .map_err(|e| PluginError::Internal(e.to_string().into()))?;
        fubmd_kernel::write_atomic(path, json.as_bytes()).map_err(|e| PluginError::Io(e.into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_vault_riaperto_risale_in_cima_senza_duplicarsi() {
        let reg = VaultRegistry::in_memory();
        reg.note_opened(Utf8Path::new("/a"), 100).unwrap();
        reg.note_opened(Utf8Path::new("/b"), 200).unwrap();
        reg.note_opened(Utf8Path::new("/a"), 300).unwrap();
        let list = reg.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].root, "/a");
    }

    #[test]
    fn i_preferiti_stanno_in_cima_e_non_scadono() {
        let reg = VaultRegistry::in_memory();
        reg.note_opened(Utf8Path::new("/vecchio"), 1).unwrap();
        reg.set_favorite(Utf8Path::new("/vecchio"), true).unwrap();
        for i in 0..(RECENTI + 5) {
            reg.note_opened(Utf8Path::new(&format!("/v{i}")), 100 + i as u64)
                .unwrap();
        }
        let list = reg.list();
        assert_eq!(list[0].root, "/vecchio", "il preferito è in cima");
        assert_eq!(
            list.len(),
            RECENTI + 1,
            "il tetto vale per i recenti, non per i preferiti"
        );
        // E chi esce è il più vecchio fra i recenti, mai l'ultimo aperto.
        assert!(list.iter().any(|e| e.root == format!("/v{}", RECENTI + 4)));
        assert!(!list.iter().any(|e| e.root == "/v0"));
    }

    #[test]
    fn dimenticare_toglie_dall_elenco_e_basta() {
        let reg = VaultRegistry::in_memory();
        reg.note_opened(Utf8Path::new("/a"), 1).unwrap();
        reg.forget(&[Utf8PathBuf::from("/a")]).unwrap();
        assert!(reg.list().is_empty());
    }

    /// Le forme di una radice sono **alternative**, non un elenco di vault: chi
    /// dimentica ne conosce due della stessa cartella e non sa quale sia
    /// scritta, e nessuna delle due deve poter mancare il bersaglio.
    #[test]
    fn dimenticare_prende_la_radice_in_ogni_forma_in_cui_e_scritta() {
        let reg = VaultRegistry::in_memory();
        reg.note_opened(Utf8Path::new("/private/a"), 1).unwrap();
        reg.note_opened(Utf8Path::new("/b"), 2).unwrap();
        reg.forget(&[Utf8PathBuf::from("/a"), Utf8PathBuf::from("/private/a")])
            .unwrap();
        let restano: Vec<String> = reg.list().into_iter().map(|e| e.root).collect();
        assert_eq!(restano, vec!["/b".to_string()], "e solo quella radice");
    }

    #[test]
    fn il_registro_sopravvive_a_un_giro_su_disco() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();
        let (reg, warning) = VaultRegistry::open(&path);
        assert!(warning.is_none(), "un file che non c'è non è un errore");
        reg.note_opened(Utf8Path::new("/a"), 42).unwrap();
        reg.set_look(
            Utf8Path::new("/a"),
            Some("📓".into()),
            Some("Diario".into()),
        )
        .unwrap();

        let (riletto, warning) = VaultRegistry::open(&path);
        assert!(warning.is_none());
        let list = riletto.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].icon.as_deref(), Some("📓"));
        assert_eq!(list[0].name, "Diario");
        assert_eq!(list[0].last_opened, 42);
    }

    #[test]
    fn un_file_rotto_non_impedisce_di_aprire_un_vault() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();
        std::fs::write(&path, "{ questo non è json").unwrap();
        let (reg, warning) = VaultRegistry::open(&path);
        assert!(warning.is_some(), "e lo dice");
        assert!(reg.list().is_empty());
    }

    /// …e non lo cancella nemmeno dopo. Ripartire da vuoto è giusto per
    /// **leggere** e sarebbe distruttivo per **scrivere**: il primo vault
    /// aperto riscriverebbe il file intero da un elenco vuoto, e i preferiti di
    /// chi ha sbagliato una virgola sparirebbero senza che nessuno glielo dica.
    #[test]
    fn un_file_rotto_non_lo_riscrive_il_primo_vault_aperto() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();
        let rotto = "{ questo non è json";
        std::fs::write(&path, rotto).unwrap();
        let (reg, _) = VaultRegistry::open(&path);

        let e = reg
            .note_opened(Utf8Path::new("/vault"), 1)
            .expect_err("scrivere su un registro che non si è letto è un rifiuto");
        assert!(
            matches!(e, PluginError::Io(_)),
            "un registro che non si è letto è il mondo, non un bug: {e}"
        );
        assert!(e.to_string().contains("non lo sovrascrive"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), rotto);
    }
}
