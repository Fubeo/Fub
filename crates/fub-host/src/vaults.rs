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
//! tutto ciò che era aperto tre settimane fa. La shell all'avvio non chiede
//! l'insieme dei vault aperti tre settimane fa: chiede **un** path, l'ultimo
//! `last_opened` ancora sul disco, e il registro è la memoria di recency che le
//! lo dà.

use crate::custody::Custody;
use std::collections::BTreeMap;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::schema::SchemaVersion;
use fub_abi::PluginError;
use serde::{Deserialize, Serialize};

/// La versione di schema del file (§15.3).
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Quanti vault **non preferiti** si ricordano. I preferiti non si contano e
/// non scadono: sono una scelta, i recenti sono una traccia.
///
/// Il tetto è dichiarato e non silenzioso: chi cade fuori esce dall'elenco, e
/// l'unica cosa che si perde è la comodità di ritrovarlo in un click — il vault
/// è sul disco dov'era.
const RECENT: usize = 20;

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
    ///
    /// Una voce che nasce da un gesto che *non* è un'apertura — un nome, una
    /// preferenza, le scorciatoie già guardate — porta l'istante di quel gesto,
    /// cioè il momento in cui questa macchina l'ha conosciuta. Non è un tempo
    /// finto: è la risposta vera alla domanda che l'elenco fa («quanto è
    /// recente questo vault per me»), e l'alternativa — un «mai aperto» a
    /// parte — vorrebbe comunque decidere dove ordinarlo, cioè la stessa
    /// scelta con uno stato in più da tenere.
    #[serde(default)]
    pub last_opened: u64,
    /// Le scorciatoie di **questo vault che l'utente ha già guardato**, chiave
    /// → accordo (§23.13).
    ///
    /// È l'unico campo del registro che non descrive il vault: descrive cosa
    /// questa macchina ha visto di lui, ed è il verso in cui la domanda va
    /// fatta. *«Ho già aperto questo vault»* non basta — il file può cambiare
    /// stanotte, per una sincronizzazione o per un collega — mentre *«ho già
    /// visto questi tasti»* regge in tutti e due i casi.
    ///
    /// Sta **qui** e non in un elenco a parte per la ragione che rende un
    /// registro un registro: `forget` lo porta via col resto, e due elenchi
    /// indicizzati sulla stessa radice sarebbero due cose da tenere allineate
    /// nel momento in cui una delle due si dimentica.
    ///
    /// Che sia una copia degli accordi e non un'impronta è deliberato: la
    /// domanda si fa **una chiave alla volta**, perché adottare la scorciatoia
    /// di un comando non è dire di sì a quella di un altro. Un'impronta sola
    /// costerebbe meno e saprebbe rispondere solo tutto o niente.
    #[serde(default)]
    pub keys_seen: BTreeMap<String, String>,
}

#[derive(Default, Serialize, Deserialize)]
struct RegistryFile {
    version: SchemaVersion,
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
    entries: Custody<Vec<VaultEntry>>,
}

impl VaultRegistry {
    /// Apre il registro di una cartella di configurazione. Un file illeggibile
    /// non impedisce di aprire un vault: si riparte da vuoto e si dice cosa è
    /// successo — un elenco di scorciatoie non vale un'app che non parte.
    pub fn open(path: &Utf8Path) -> (Self, Option<String>) {
        let (entries, warning) = match load(path) {
            Ok(entries) => (entries, None),
            Err(and) => (Vec::new(), Some(and)),
        };
        (
            VaultRegistry {
                path: Some(path.to_owned()),
                readable: warning.is_none(),
                entries: Custody::new("il registro dei vault", entries),
            },
            warning,
        )
    }

    /// Un registro che non tocca il disco.
    pub fn in_memory() -> Self {
        VaultRegistry {
            path: None,
            readable: true,
            entries: Custody::empty("il registro dei vault"),
        }
    }

    /// I vault conosciuti: prima i preferiti, poi i recenti, ognuno dal più
    /// recente. L'ordine è **del registro** e non di chi disegna: due elenchi
    /// ordinati in due posti sarebbero due idee di cosa vuol dire "recente".
    pub fn list(&self) -> Vec<VaultEntry> {
        // Nessun canale d'errore in questa firma (decisione 0120): un registro
        // avvelenato risponde «non ne conosco», e la porta ha già scritto la
        // riga che dice perché. È un elenco di comodità, non un dato del vault.
        let Ok(guard) = self.entries.read() else {
            return Vec::new();
        };
        let mut entries = guard.clone();
        entries.sort_by(|a, b| {
            b.favorite
                .cmp(&a.favorite)
                .then(b.last_opened.cmp(&a.last_opened))
                .then(a.root.cmp(&b.root))
        });
        entries
    }

    /// I vault conosciuti in **ordine di recenza** — dal più recente — senza
    /// che i preferiti saltino davanti: l'avvio chiede *l'ultimo aperto*, e un
    /// preferito più vecchio non lo è.
    ///
    /// A differenza di [`list`](Self::list), che mette i preferiti prima per
    /// il dialogo di scelta, questa ordina solo per `last_opened` (a parità per
    /// `root`, come là): la domanda è «quale è stato usato per ultimo», e un
    /// appunto non è un uso.
    pub fn in_recency_order(&self) -> Vec<VaultEntry> {
        let Ok(guard) = self.entries.read() else {
            return Vec::new();
        };
        let mut entries = guard.clone();
        entries.sort_by(|a, b| b.last_opened.cmp(&a.last_opened).then(a.root.cmp(&b.root)));
        entries
    }

    /// L'ultimo vault aperto, secondo il registro: la voce con `last_opened`
    /// massimo (a parità, `root` meno in ordine lessicografico). Non usa
    /// [`list`](Self::list), che mette i preferiti davanti: un preferito più
    /// vecchio non vince sull'ultimo aperto.
    ///
    /// La voce c'è anche se la cartella non esiste più: chi la guarda —
    /// [`Host::ultimo_vault`](crate::Host::ultimo_vault) — scorre i candidati e
    /// salta chi non è più sul disco.
    pub fn last_opened(&self) -> Option<VaultEntry> {
        self.in_recency_order().into_iter().next()
    }

    /// Questa radice è in elenco **esattamente sotto questo nome**?
    ///
    /// È la domanda che permette di non richiedere al disco una chiave che si
    /// conosce già ([`Host::chiave`](crate::Host)): una voce del registro è
    /// canonica per contratto — l'apertura l'ha scritta così — quindi un nome
    /// che combacia con una voce *è* la chiave, e non c'è niente da risolvere.
    /// La domanda è deliberatamente letterale e non «sono la stessa cartella»:
    /// per rispondere a quella servirebbe il disco, cioè la cosa che qui non
    /// c'è.
    pub fn knows(&self, root: &Utf8Path) -> bool {
        self.entries
            .read()
            .is_ok_and(|entries| entries.iter().any(|and| and.root == root.as_str()))
    }

    /// Un vault è stato aperto: entra nell'elenco, o risale in cima.
    pub fn notes_opened(&self, root: &Utf8Path, now: u64) -> Result<(), PluginError> {
        self.update(root, |entry| entry.last_opened = now)
    }

    pub fn set_favorite(&self, root: &Utf8Path, favorite: bool) -> Result<(), PluginError> {
        self.update(root, |entry| entry.favorite = favorite)
    }

    /// Le scorciatoie di questo vault che l'utente ha già guardato (§23.13).
    /// Vuoto per un vault mai visto, e anche per uno visto mille volte che non
    /// ne ha mai portata nessuna: sono lo stesso caso, ed è giusto — in
    /// entrambi non c'è niente che qualcuno debba adottare.
    pub fn seen_keys(&self, root: &Utf8Path) -> BTreeMap<String, String> {
        let Ok(entries) = self.entries.read() else {
            return BTreeMap::new();
        };
        entries
            .iter()
            .find(|and| and.root == root.as_str())
            .map(|and| and.keys_seen.clone())
            .unwrap_or_default()
    }

    /// L'utente ha guardato queste scorciatoie di questo vault.
    ///
    /// **Sostituisce** invece di fondere, e la differenza si vede nel caso che
    /// conta: una scorciatoia tolta dal file del vault deve uscire anche da qui,
    /// o il giorno che qualcuno ne rimette una uguale la troverebbe già
    /// approvata da una decisione presa su un altro valore.
    pub fn notes_keys_seen(
        &self,
        root: &Utf8Path,
        keys: BTreeMap<String, String>,
    ) -> Result<(), PluginError> {
        self.update(root, |entry| entry.keys_seen = keys.clone())
    }

    /// **L'aspetto intero**: l'icona (`None` = nessuna) e il nome (vuoto =
    /// quello della cartella).
    ///
    /// I due parametri sono i due campi di [`VaultEntry`] **nelle loro stesse
    /// forme**, e non è un'economia di tipi: è ciò che impedisce alla firma di
    /// dire due cose. Il nome è stato un `Option<String>`, e un `Option` a un
    /// confine ha due letture — «lascialo com'era» e «azzeralo» — che nessuna
    /// firma distingue; quella accanto sceglieva già la seconda, questa
    /// sceglieva la prima, e chi leggeva `set_look(root, icona, None)` non
    /// aveva modo di sapere che gliene stava applicando due opposte. Un `String`
    /// la variante ambigua non ce l'ha: chi non vuole più un nome scrive il
    /// vuoto, che è la stessa cosa che legge da `known_vaults`.
    ///
    /// **È un `set` e non una modifica parziale**: chi cambia solo il nome
    /// rimanda l'icona che ha letto. Il verso opposto — due parametri che
    /// dicono «lascia com'era» — vorrebbe un `Option<Option<String>>` per
    /// l'icona, cioè tre stati per rispondere a una domanda che ne ha due.
    pub fn set_look(
        &self,
        root: &Utf8Path,
        icon: Option<String>,
        name: String,
    ) -> Result<(), PluginError> {
        self.update(root, |entry| {
            entry.icon = icon.clone();
            entry.name = name.clone();
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
    pub fn forget(&self, forms: &[Utf8PathBuf]) -> Result<(), PluginError> {
        self.mutate(|next| next.retain(|and| !forms.iter().any(|f| f.as_str() == and.root)))
    }

    /// Come per lo store di configurazione: **su disco prima, in memoria dopo**.
    /// Al contrario, un salvataggio fallito lascerebbe il registro in memoria
    /// diverso da quello sul disco, e il chiamante che ha ricevuto l'errore non
    /// avrebbe modo di saperlo.
    fn update(&self, root: &Utf8Path, f: impl FnOnce(&mut VaultEntry)) -> Result<(), PluginError> {
        let root = root.as_str();
        self.mutate(|next| {
            match next.iter_mut().find(|and| and.root == root) {
                Some(entry) => f(entry),
                None => {
                    let mut entry = VaultEntry {
                        root: root.to_string(),
                        name: String::new(),
                        icon: None,
                        favorite: false,
                        // Una voce nasce **adesso**, anche quando il gesto che
                        // la crea non è un'apertura. Zero è l'epoca, cioè per
                        // il tetto qui sotto «la più vecchia di tutte»: il
                        // vault a cui l'utente ha appena dato un nome sarebbe
                        // stato il primo a essere sfrattato, e fino ad allora
                        // l'ultimo dell'elenco. La data sta qui e non nei
                        // singoli mutatori perché è del **nascere** e non del
                        // gesto: chi aggiungerà un `set_…` la eredita senza
                        // doverla sapere, e chi apre davvero la sovrascrive
                        // subito sotto con la sua (`note_opened`).
                        last_opened: fub_kernel::time::now_unix_millis(),
                        keys_seen: BTreeMap::new(),
                    };
                    f(&mut entry);
                    next.push(entry);
                }
            }
            // Il tetto si applica **dopo** l'aggiornamento e ai soli non
            // preferiti, così l'ultimo aperto non può mai essere quello che
            // esce.
            let mut recent: Vec<usize> = next
                .iter()
                .enumerate()
                .filter(|(_, and)| !and.favorite)
                .map(|(the, _)| the)
                .collect();
            if recent.len() > RECENT {
                recent.sort_by_key(|&the| std::cmp::Reverse(next[the].last_opened));
                let to_remove: std::collections::BTreeSet<usize> =
                    recent.into_iter().skip(RECENT).collect();
                let mut the = 0;
                next.retain(|_| {
                    let keep = !to_remove.contains(&the);
                    the += 1;
                    keep
                });
            }
        })
    }

    /// Una mutazione del registro, applicata a **ciò che il file dice adesso**.
    ///
    /// Il tetto dei recenti rende la cosa più visibile che altrove: due
    /// installazioni che ricompongono l'elenco dalla propria copia non si
    /// cancellano solo l'ultimo vault aperto dall'altra — si cancellano i
    /// **preferiti**, che sono una scelta e non una traccia. Quindi la
    /// mutazione si applica all'elenco reopened sotto lock
    /// ([`fub_kernel::update_atomic`],
    /// [0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)),
    /// e il tetto si applica dopo la fusione: se l'altra installazione ha
    /// aperto dei vault, quelli sono nell'elenco e il tetto li conta.
    fn mutate(&self, f: impl FnOnce(&mut Vec<VaultEntry>)) -> Result<(), PluginError> {
        let mut entries = self.entries.write()?;
        let Some(path) = &self.path else {
            f(&mut entries);
            return Ok(());
        };
        self.refusal(path)?;
        // L'aggiornamento parla una lingua sola (`String`) e qui gli esiti sono
        // due: il mondo — un disco pieno, un file che non si rilegge — e un
        // difetto nostro, cioè una struttura che non si serializza. La seconda
        // si riconosce da dove nasce, e resta un `Internal` come prima.
        let mut defect = None;
        *entries = fub_kernel::update_atomic(
            path,
            || load(path),
            |disk| {
                f(disk);
                encode(disk).inspect_err(|and| defect = Some(and.clone()))
            },
        )
        .map_err(|and| match defect {
            Some(d) => PluginError::Internal(d.into()),
            None => PluginError::Io(and.into()),
        })?;
        Ok(())
    }

    /// Il rifiuto di riscrivere un file che all'apertura non si è letto.
    fn refusal(&self, path: &Utf8Path) -> Result<(), PluginError> {
        if !self.readable {
            // `Io` e non `PermissionDenied`: nessuno ha negato un permesso, è un
            // file che non si può usare — e il verbo che chi legge deve leggere
            // è «correggilo e riapri», non «non ti è consentito».
            return Err(PluginError::Io(
                format!(
                    "{path} non si è potuto leggere all'apertura: Fub non lo \
                     sovrascrive, o i vault che ci sono elencati andrebbero persi. \
                     Correggilo o spostalo, e riapri."
                )
                .into(),
            ));
        }
        Ok(())
    }
}

/// L'elenco com'è sul disco. **Assente = nessun vault conosciuto**, che è ciò
/// che ha una installazione nuova e non un errore.
fn load(path: &Utf8Path) -> Result<Vec<VaultEntry>, String> {
    match std::fs::read_to_string(path) {
        Ok(json) => match serde_json::from_str::<RegistryFile>(&json) {
            Ok(file) if file.version <= SCHEMA_VERSION => Ok(file.vaults),
            Ok(file) => Err(format!(
                "{path} è scritto nella versione {} di questo formato, e questa \
                 copia di Fub legge fino alla {SCHEMA_VERSION}",
                file.version
            )),
            Err(and) => Err(format!("{path} non è un vaults.json valido: {and}")),
        },
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(and) => Err(format!("non riesco a leggere {path}: {and}")),
    }
}

fn encode(entries: &[VaultEntry]) -> Result<Vec<u8>, String> {
    let file = RegistryFile {
        version: SCHEMA_VERSION,
        vaults: entries.to_vec(),
    };
    serde_json::to_vec_pretty(&file).map_err(|and| and.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_vault_reopened_goes_back_in_top_without_duplicates() {
        let reg = VaultRegistry::in_memory();
        reg.notes_opened(Utf8Path::new("/a"), 100).unwrap();
        reg.notes_opened(Utf8Path::new("/b"), 200).unwrap();
        reg.notes_opened(Utf8Path::new("/a"), 300).unwrap();
        let list = reg.list();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].root, "/a");
    }

    #[test]
    fn the_favorites_are_in_top_and_not_expire() {
        let reg = VaultRegistry::in_memory();
        reg.notes_opened(Utf8Path::new("/vecchio"), 1).unwrap();
        reg.set_favorite(Utf8Path::new("/vecchio"), true).unwrap();
        for the in 0..(RECENT + 5) {
            reg.notes_opened(Utf8Path::new(&format!("/v{the}")), 100 + the as u64)
                .unwrap();
        }
        let list = reg.list();
        assert_eq!(list[0].root, "/vecchio", "il preferito è in cima");
        assert_eq!(
            list.len(),
            RECENT + 1,
            "il tetto vale per i recenti, non per i preferiti"
        );
        // E chi esce è il più vecchio fra i recenti, mai l'ultimo aperto.
        assert!(list.iter().any(|and| and.root == format!("/v{}", RECENT + 4)));
        assert!(!list.iter().any(|and| and.root == "/v0"));
    }

    /// **Ciò che l'utente ha appena scelto non nasce già il più vecchio di
    /// tutti.**
    ///
    /// Una voce nasce anche da un gesto che non è un'apertura — dare un nome a
    /// una chiavetta staccata, appuntarla, ricordarsi quali scorciatoie sono
    /// state guardate — e nasceva con `last_opened` a zero, cioè con l'epoca,
    /// che è esattamente il valore che il tetto qui sotto legge come «la più
    /// vecchia di tutte»: il vault appena battezzato era il primo a uscire
    /// dall'elenco, e finché ci restava stava in fondo, sotto quelli aperti
    /// l'ultima volta un anno fa.
    #[test]
    fn a_entry_born_from_a_gesture_not_and_already_the_more_old() {
        let reg = VaultRegistry::in_memory();
        for the in 0..RECENT {
            reg.notes_opened(Utf8Path::new(&format!("/v{the}")), 100 + the as u64)
                .unwrap();
        }

        reg.set_look(
            Utf8Path::new("/chiavetta"),
            Some("usb".into()),
            "La chiavetta".into(),
        )
        .unwrap();

        let list = reg.list();
        assert_eq!(list.len(), RECENT, "il tetto vale come prima");
        assert_eq!(
            list[0].root, "/chiavetta",
            "e chi è appena stato scelto è il più recente, non il più vecchio"
        );
        assert!(
            !list.iter().any(|and| and.root == "/v0"),
            "chi esce è il recente più vecchio davvero"
        );

        // Il secondo gesto lo eredita: la data non sta nel corpo di `set_look`
        // ma nel punto in cui una voce nasce.
        let mut keys = BTreeMap::new();
        keys.insert("mod+k".to_string(), "vault.cerca".to_string());
        reg.notes_keys_seen(Utf8Path::new("/terza"), keys).unwrap();
        let third = reg
            .list()
            .into_iter()
            .find(|and| and.root == "/terza")
            .expect("la voce c'è");
        assert!(third.last_opened > 0, "e nemmeno questa nasce all'epoca");
    }

    #[test]
    fn forget_removes_from_the_list_and_enough() {
        let reg = VaultRegistry::in_memory();
        reg.notes_opened(Utf8Path::new("/a"), 1).unwrap();
        reg.forget(&[Utf8PathBuf::from("/a")]).unwrap();
        assert!(reg.list().is_empty());
    }

    /// Le forme di una radice sono **alternative**, non un elenco di vault: chi
    /// dimentica ne conosce due della stessa cartella e non sa quale sia
    /// scritta, e nessuna delle due deve poter mancare il bersaglio.
    #[test]
    fn forget_takes_the_root_in_every_form_in_which_and_written() {
        let reg = VaultRegistry::in_memory();
        reg.notes_opened(Utf8Path::new("/private/a"), 1).unwrap();
        reg.notes_opened(Utf8Path::new("/b"), 2).unwrap();
        reg.forget(&[Utf8PathBuf::from("/a"), Utf8PathBuf::from("/private/a")])
            .unwrap();
        let remain: Vec<String> = reg.list().into_iter().map(|and| and.root).collect();
        assert_eq!(remain, vec!["/b".to_string()], "e solo quella radice");
    }

    #[test]
    fn the_record_survives_a_a_round_on_disk() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();
        let (reg, warning) = VaultRegistry::open(&path);
        assert!(warning.is_none(), "un file che non c'è non è un errore");
        reg.notes_opened(Utf8Path::new("/a"), 42).unwrap();
        reg.set_look(Utf8Path::new("/a"), Some("📓".into()), "Diario".into())
            .unwrap();

        let (reopened, warning) = VaultRegistry::open(&path);
        assert!(warning.is_none());
        let list = reopened.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].icon.as_deref(), Some("📓"));
        assert_eq!(list[0].name, "Diario");
        assert_eq!(list[0].last_opened, 42);
    }

    /// Due installazioni sulla stessa cartella di configurazione, e nessuna
    /// delle due cancella i vault dell'altra.
    ///
    /// Qui la perdita non sarebbe una traccia ma una **scelta**: la seconda
    /// finestra che apre un vault ricomponeva l'elenco dalla propria copia, e
    /// con lui se ne andavano i preferiti che l'altra aveva appuntato dopo la
    /// sua apertura. Due registri sullo stesso file **sono** il caso: ognuno ha
    /// letto una volta e da lì tiene la sua copia
    /// ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)).
    #[test]
    fn two_installations_not_is_delete_the_vault() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();

        let (before, _) = VaultRegistry::open(&path);
        let (second, _) = VaultRegistry::open(&path);

        before.notes_opened(Utf8Path::new("/diario"), 1).unwrap();
        before.set_favorite(Utf8Path::new("/diario"), true).unwrap();
        second.notes_opened(Utf8Path::new("/lavoro"), 2).unwrap();

        let (third, warning) = VaultRegistry::open(&path);
        assert!(warning.is_none(), "{warning:?}");
        let roots: Vec<String> = third.list().into_iter().map(|and| and.root).collect();
        assert_eq!(roots, vec!["/diario".to_string(), "/lavoro".to_string()]);
        assert!(
            third.list()[0].favorite,
            "e il preferito della prima è ancora un preferito"
        );
    }

    /// **Due installazioni che imparano un tasto nello stesso momento non se ne
    /// perdono uno** (difetto 0204).
    ///
    /// Il promemoria delle scorciatoie già mostrate è un campo di una voce come
    /// gli altri, e passa dalla stessa porta: chi scrive rilegge il file sotto
    /// il lucchetto e riapplica lì la propria riga, invece di ricomporre
    /// l'elenco dalla copia che ha in mano
    /// ([0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)).
    /// La `seconda` apre **prima** che la `prima` scriva, che è la sola forma in
    /// cui la sua copia è vecchia davvero: senza la rilettura il suo
    /// promemoria si porta via quello dell'altra.
    ///
    /// Il gemello qui sopra prova la stessa strada sulle voci; questo la prova
    /// sul campo che il difetto nominava, ed è per lui che porta un nome suo:
    /// chi domani ricomponesse l'elenco qui dentro leggerebbe «i vault non si
    /// cancellano» e non «i tasti visti non si perdono».
    #[test]
    fn two_installations_that_learn_a_key_not_if_of_it_lose_a() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();

        let (before, _) = VaultRegistry::open(&path);
        let (second, _) = VaultRegistry::open(&path);

        let seen =
            |key: &str, command: &str| BTreeMap::from([(key.to_string(), command.to_string())]);
        before
            .notes_keys_seen(Utf8Path::new("/diario"), seen("mod+k", "vault.cerca"))
            .unwrap();
        second
            .notes_keys_seen(Utf8Path::new("/lavoro"), seen("mod+j", "vault.salta"))
            .unwrap();

        let (third, warning) = VaultRegistry::open(&path);
        assert!(warning.is_none(), "{warning:?}");
        let seen: Vec<(String, Vec<String>)> = third
            .list()
            .into_iter()
            .map(|and| (and.root, and.keys_seen.into_keys().collect()))
            .collect();
        assert_eq!(
            seen,
            vec![
                ("/diario".to_string(), vec!["mod+k".to_string()]),
                ("/lavoro".to_string(), vec!["mod+j".to_string()]),
            ],
            "un tasto imparato da una delle due installazioni è sparito: alla \
             riapertura Fub richiede di adottare una scorciatoia a cui l'utente \
             ha già risposto"
        );
    }

    /// Togliere il nome scelto **torna al nome della cartella**, che è ciò che
    /// il vuoto vuol dire in [`VaultEntry::name`]. E togliere l'icona la toglie.
    ///
    /// **Questo banco è verde per costruzione** e va detto: prova la forma
    /// nuova, in cui il nome è un `String` e il vuoto è l'unico modo di dire
    /// «non ne ho scelto uno». Con la firma di prima la stessa riga passava
    /// scrivendo `Some(String::new())` — la via c'era, ed è la ragione per cui
    /// questo non è mai stato un difetto di comportamento. Quello che non c'era
    /// è una firma che lo dicesse: `None` sembrava l'azzeramento perché il
    /// parametro accanto lo era, e chi lo scriveva si azzerava l'icona senza
    /// toccare il nome. Il banco sta qui perché nessuno rimetta un `Option` per
    /// «lasciarlo com'era».
    #[test]
    fn remove_the_name_selected_returns_to_the_name_of_the_folder() {
        let reg = VaultRegistry::in_memory();
        reg.notes_opened(Utf8Path::new("/a"), 1).unwrap();
        reg.set_look(Utf8Path::new("/a"), Some("📓".into()), "Diario".into())
            .unwrap();
        assert_eq!(reg.list()[0].name, "Diario");

        reg.set_look(Utf8Path::new("/a"), None, String::new())
            .unwrap();
        let entry = reg.list().remove(0);
        assert_eq!(entry.name, "", "vuoto = il nome della cartella");
        assert_eq!(entry.icon, None, "e l'icona si toglie con `None`");
    }

    #[test]
    fn a_file_broken_not_prevents_of_open_a_vault() {
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
    fn a_file_broken_not_the_rewrites_the_first_vault_open() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = Utf8PathBuf::from_path_buf(dir.path().join("vaults.json")).unwrap();
        let broken = "{ questo non è json";
        std::fs::write(&path, broken).unwrap();
        let (reg, _) = VaultRegistry::open(&path);

        let and = reg
            .notes_opened(Utf8Path::new("/vault"), 1)
            .expect_err("scrivere su un registro che non si è letto è un rifiuto");
        assert!(
            matches!(and, PluginError::Io(_)),
            "un registro che non si è letto è il mondo, non un bug: {and}"
        );
        assert!(and.to_string().contains("non lo sovrascrive"), "{and}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
    }
}
