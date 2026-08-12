//! Il sidecar dell'**organizzazione** (§11.3): `.fub/workspace.json`, e chi lo
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
//! **non si riscrive**. Il file resta dov'era, `<root>/.fub/workspace.json`,
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
//!    fatta da un'**altra app a Fub aperto** migra: il rilevatore la riconosce
//!    e passa dallo stesso punto.
//! 2. **Si scrive per chiave, non a blob intero.** Prima la shell rileggeva
//!    tutto, cambiava un campo e riscriveva tutto: due finestre sullo stesso
//!    vault erano una *lost update* — la seconda che salva cancella ciò che ha
//!    fatto la prima, e nessuna delle due se ne accorge.
//! 3. **Si legge dal canale dati** ([`IndexQuery::Organization`](fub_abi::traits::IndexQuery::Organization)),
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
//! - la rinomina fatta **a Fub chiuso**: nessuno la vede, e al riavvio non c'è
//!   modo di sapere che `b.md` era `a.md`. È il §13.1 — il path è l'identità — e
//!   si chiude dando ai documenti un'identità che il path non è;
//! - la rinomina di una **cartella**: il kernel non ne ha una operazione, e da
//!   un'altra app arriva come N rinomine di documenti. Le icone delle *note*
//!   migrano quindi una per una (ci passano da qui), quella della cartella e il
//!   suo ordine no. Dedurre «la cartella X è diventata Y» da N rinomine che
//!   condividono un prefisso è un indovinello, non un fatto — e questo file
//!   tiene dati autorevoli.

use std::collections::HashSet;
use std::sync::{Arc, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::organization::Organization;
use fub_abi::rules::path_policy;
use fub_abi::DocId;
use serde::{Deserialize, Serialize};

use crate::storage::{non_lo_sovrascrivo, Durevole, VaultStorage};
use fub_abi::schema::SchemaVersion;

/// La versione di schema del file (§15.3).
///
/// Il file **nasce senza**: esiste dal giorno in cui il sidecar è stato scritto
/// dall'host, e nessuno gli aveva messo un numero. Un campo assente vale `0`
/// (`#[serde(default)]`), che è ≤ di questa, quindi un vault organizzato prima di
/// questa voce si apre e si legge; la prima scrittura lo porta alla 1. È il
/// motivo per cui la versione va messa *dal primo giorno* — la si aggiunge dopo
/// solo indovinando che ciò che non ce l'ha venga da prima.
const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Il file com'è su disco: l'organizzazione, più il numero di formato.
#[derive(Default, Serialize, Deserialize)]
struct OrganizationFile {
    #[serde(default)]
    version: SchemaVersion,
    #[serde(flatten)]
    organization: Organization,
}

/// Dove sta il sidecar, data la radice del vault.
///
/// In `.fub/`, che è un dot-dir: scansione, rilevatore e indice lo ignorano
/// già, quindi l'organizzazione non è un documento del vault che si vede nella
/// lista dei file.
pub fn organization_path(root: &Utf8Path) -> Utf8PathBuf {
    root.join(crate::vault::FUB_DIR).join("workspace.json")
}

/// L'organizzazione di **questo** vault.
///
/// `path: None` è lo store in memoria — quello di un test — che non tocca il
/// disco. Come per le impostazioni e per lo stato di vista, e per la stessa
/// ragione: un default che scrive è un difetto che si scopre tardi.
pub struct OrganizationStore {
    path: Option<Utf8PathBuf>,
    /// Il supporto del vault (§15.1), assente per lo store in memoria. Il
    /// sidecar sta in `.fub/`, cioè **dentro il vault**, e da qui in poi ci
    /// passa sopra come tutto il resto
    /// ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)).
    storage: Option<Arc<dyn VaultStorage>>,
    /// L'organizzazione, che è **anche** ciò che sta nel sidecar: un
    /// [`Durevole`] perché «su disco prima, in memoria dopo» non dipendesse dal
    /// fatto che chi scrive la prossima mutazione legga il commento sotto.
    data: RwLock<Durevole<Organization>>,
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
    pub fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> (Arc<Self>, Option<String>) {
        let path = organization_path(root);
        let (data, scartate, warning) = match load(&path, storage.as_ref()) {
            Ok((data, scartate)) => (data, scartate, None),
            Err(e) => (Organization::default(), Vec::new(), Some(e)),
        };
        (
            Arc::new(OrganizationStore {
                path: Some(path.clone()),
                storage: Some(storage),
                data: RwLock::new(Durevole::letto(data)),
                // Le chiavi che il recinto ha scartato **non** rendono il file
                // illeggibile: il resto dell'organizzazione vale, e la
                // scrittura successiva le lascerà indietro. Quello che non
                // possono fare è sparire in silenzio.
                warnings: RwLock::new(avviso_scartate(&path, scartate).into_iter().collect()),
            }),
            warning,
        )
    }

    /// Uno store che non tocca il disco.
    pub fn in_memory() -> Arc<Self> {
        Arc::new(OrganizationStore {
            path: None,
            storage: None,
            data: RwLock::new(Durevole::letto(Organization::default())),
            warnings: RwLock::new(Vec::new()),
        })
    }

    /// L'organizzazione intera: è ciò che il canale dati restituisce a
    /// [`IndexQuery::Organization`](fub_abi::traits::IndexQuery::Organization).
    pub fn snapshot(&self) -> Organization {
        (*self.data.read().expect("organizzazione")).clone()
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
        let mut cambiata = false;
        self.update(|org| cambiata = migra(org, from, to))?;
        Ok(cambiata)
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

    /// Applica `f` **a ciò che sta nel sidecar adesso**, e adotta il risultato.
    ///
    /// È il punto 2 in testa al modulo, che per un pezzo è stato solo scritto:
    /// «si scrive per chiave, non a blob intero». I mutatori qui sopra erano già
    /// per chiave, ma il file veniva ricomposto dalla copia presa
    /// **all'apertura** — cioè la lost update era stata spostata dalla shell al
    /// kernel invece che tolta, e con due finestre aperte sullo stesso vault
    /// l'icona messa nell'una spariva al primo pin messo nell'altra. Il
    /// cambiamento va quindi messo sopra il file riletto sotto lucchetto
    /// ([`VaultStorage::update`]), e ciò che si tiene in memoria è la fusione.
    fn update(&self, f: impl FnOnce(&mut Organization)) -> Result<(), String> {
        // Ogni mutazione passa di qui, e quindi ci passa anche l'invariante che
        // nessuna di loro deve poter rompere: vedi [`senza_doppioni`]. Metterla
        // dentro i mutatori vorrebbe dire ricordarsela al prossimo, e il
        // prossimo è chi scriverà il mutatore che ancora non c'è.
        let f = |org: &mut Organization| {
            f(org);
            senza_doppioni(org);
        };
        let mut data = self.data.write().expect("organizzazione");
        // Lo store in memoria — quello di un test — non ha un disco da
        // rileggere: ciò che c'è «adesso» è ciò che si ha.
        let (Some(path), Some(storage)) = (&self.path, &self.storage) else {
            let mut next = (**data).clone();
            f(&mut next);
            return data.scrivi(next, |_| Ok(()));
        };
        // Ciò che si ha in memoria viaggia con la fusione, e serve **solo** se
        // il file non c'è: vedi il § in testa a `fondi`.
        let in_memoria = (**data).clone();
        let mut scartate = Vec::new();
        let esito = data.aggiorna(|| fondi(storage.as_ref(), path, &in_memoria, &mut scartate, f));
        // Il file può essere stato riscritto a mano *dopo* l'apertura: la
        // fusione rilegge, e ciò che il recinto scarta lo si dice adesso.
        if let Some(avviso) = avviso_scartate(path, scartate) {
            self.warnings.write().expect("organizzazione").push(avviso);
        }
        esito
    }
}

/// Rilegge il sidecar, ci mette sopra `f`, lo riscrive: torna ciò che è finito
/// nel file.
///
/// Un file che **adesso** non si legge non si sovrascrive
/// ([`non_lo_sovrascrivo`]), e la domanda si fa qui perché qui c'è la risposta
/// vera: fra l'apertura e adesso ci può essere passato un editor di testo o una
/// sincronizzazione a metà, e ci può essere ripassato a rimettere a posto
/// (difetto 0170).
///
/// # Un file che non c'è non è un file vuoto
///
/// La rilettura sotto lucchetto risponde a «cosa c'è nel file adesso», e per un
/// file **sparito** la risposta letterale sarebbe `Organization::default()` —
/// cioè: nessuna icona, nessun preferito, nessun ordine. Presa alla lettera si
/// scriverebbe quella, e con lei la si adotterebbe in memoria: un sidecar
/// cancellato a metà sessione — da una sincronizzazione, da un editor, da chi
/// fa pulizia in `.fub/` — porterebbe via l'organizzazione di tutto il vault al
/// primo click, **senza che nessuno l'abbia chiesto**.
///
/// La base di una fusione senza file è quindi ciò che si ha in memoria, e il
/// primo cambiamento **ricostruisce** il sidecar invece di svuotarlo. È anche
/// l'unico verso coerente con la riga sopra: un file illeggibile ci si rifiuta
/// di sovrascriverlo perché l'organizzazione andrebbe persa, e obbedire a uno
/// assente sarebbe perderla per la stessa ragione, con una porta diversa.
///
/// Ciò che questa riparazione **non** è: un modo di rimettere la lost update.
/// Quando il file c'è, la memoria non si guarda affatto — la fusione parte dai
/// byte riletti, come deve.
fn fondi(
    storage: &dyn VaultStorage,
    path: &Utf8Path,
    in_memoria: &Organization,
    scartate: &mut Vec<String>,
    f: impl FnOnce(&mut Organization),
) -> Result<Organization, String> {
    // `f` si consuma dentro una `FnMut`, che per il tipo potrebbe girare più
    // volte: la `take` è come si dice al compilatore ciò che il supporto
    // garantisce, cioè una fusione sola.
    let mut f = Some(f);
    let mut fuso = None;
    let mut guasto = None;
    let esito = storage.update(path, &mut |attuale| {
        let letto = match attuale {
            Some(bytes) => decode(path, bytes),
            None => Ok((in_memoria.clone(), Vec::new())),
        };
        let disco = match letto {
            Ok((disco, fuori)) => {
                scartate.extend(fuori);
                disco
            }
            Err(e) => {
                guasto = Some(non_lo_sovrascrivo(
                    &e,
                    "l'organizzazione che contiene andrebbe persa",
                ));
                return Err(std::io::Error::other("il file non si è potuto leggere"));
            }
        };
        let mut next = disco.clone();
        f.take().expect("il supporto fonde una volta sola")(&mut next);
        if next == disco {
            // Niente è cambiato: non si tocca il disco. Cliccare due volte lo
            // stesso interruttore non è una scrittura.
            fuso = Some(next);
            return Ok(None);
        }
        let file = OrganizationFile {
            version: SCHEMA_VERSION,
            organization: next.clone(),
        };
        let json = match serde_json::to_vec_pretty(&file) {
            Ok(json) => json,
            Err(e) => {
                guasto = Some(e.to_string());
                return Err(std::io::Error::other("il file non si è potuto comporre"));
            }
        };
        fuso = Some(next);
        Ok(Some(json))
    });
    match (esito, guasto) {
        (_, Some(guasto)) => Err(guasto),
        (Err(e), None) => Err(format!("non riesco a scrivere {path}: {e}")),
        (Ok(()), None) => Ok(fuso.expect("una fusione riuscita ha lasciato l'organizzazione")),
    }
}

/// Le tre mosse di un rename dentro l'organizzazione. Torna `true` se la nota
/// era organizzata, cioè se qualcosa si è spostato davvero.
///
/// Le liste che riscrive possono nominare la destinazione già per conto loro:
/// che ne resti una copia sola non lo decide qui, lo decide
/// [`senza_doppioni`], che passa dopo **ogni** mutazione.
fn migra(org: &mut Organization, from: &str, to: &str) -> bool {
    let mut cambiata = false;
    if let Some(icon) = org.icons.remove(from) {
        org.icons.insert(to.to_string(), icon);
        cambiata = true;
    }
    for p in org.pinned.iter_mut() {
        if p == from {
            *p = to.to_string();
            cambiata = true;
        }
    }
    if let Some(names) = org.order.get_mut(parent_of(from)) {
        if let Some(at) = names.iter().position(|n| n == child_name(from)) {
            if parent_of(from) == parent_of(to) {
                names[at] = child_name(to).to_string();
            } else {
                names.remove(at);
            }
            cambiata = true;
        }
    }
    cambiata
}

/// Le liste dell'organizzazione sono **insiemi ordinati**: lo stesso id non ci
/// sta due volte.
///
/// Nasceva un doppione ogni volta che una mutazione portava un id **addosso a
/// un altro**, e il caso misurato è la rinomina ([`migra`]): appuntate `a.md` e
/// `c.md`, rinominare `a.md` in `c.md` scriveva `["c.md", "c.md"]`, e con lo
/// stesso gesto sull'ordine di una cartella l'esploratore mostrava la stessa
/// voce in due posti.
///
/// **Chi c'era già non si sposta**, cioè sopravvive la posizione della prima
/// occorrenza. Non è una politica nuova: è quella che
/// [`OrganizationStore::set_pinned`] scrive già a parole — appuntare due volte
/// la stessa nota non la sposta — e un insieme ordinato si comporta così anche
/// altrove. La posizione della copia migrata, invece, sarebbe una seconda
/// regola per lo stesso caso, e l'utente vedrebbe due esiti diversi a seconda di
/// come l'id è arrivato lì.
fn senza_doppioni(org: &mut Organization) {
    una_volta_sola(&mut org.pinned);
    una_volta_sola(&mut org.spaces);
    for nomi in org.order.values_mut() {
        una_volta_sola(nomi);
    }
}

/// La lista senza le ripetizioni, tenendo la **prima** di ognuna al suo posto.
fn una_volta_sola(lista: &mut Vec<String>) {
    let mut visti = HashSet::new();
    lista.retain(|id| visti.insert(id.clone()));
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

fn load(
    path: &Utf8Path,
    storage: &dyn VaultStorage,
) -> Result<(Organization, Vec<String>), String> {
    match storage.read(path) {
        Ok(raw) => decode(path, &raw),
        // Assente = vault mai personalizzato: è un esito normale.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok((Organization::default(), Vec::new()))
        }
        Err(e) => Err(format!("non riesco a leggere {path}: {e}")),
    }
}

/// La frase con cui le chiavi scartate arrivano a chi guarda, o `None` se non
/// ce n'è nessuna.
fn avviso_scartate(path: &Utf8Path, scartate: Vec<String>) -> Option<String> {
    (!scartate.is_empty()).then(|| {
        format!(
            "{path} nomina {} posizioni che non stanno in questo vault, e Fub \
             le lascia indietro: {}",
            scartate.len(),
            scartate.join(", ")
        )
    })
}

/// I byte del sidecar, giudicati. Sta a parte perché lo leggono in due —
/// l'apertura e ogni fusione ([`fondi`]) — e due letture con due idee di cosa
/// sia un file valido sarebbero due politiche.
///
/// Torna anche **le chiavi scartate dal recinto**: chi legge se ne fa carico
/// dicendolo, perché una chiave che sparisce senza che nessuno dica perché è
/// metà difetto.
fn decode(path: &Utf8Path, raw: &[u8]) -> Result<(Organization, Vec<String>), String> {
    let file: OrganizationFile = serde_json::from_slice(raw)
        .map_err(|e| format!("{path} non è un workspace.json valido: {e}"))?;
    if file.version > SCHEMA_VERSION {
        return Err(format!(
            "{path} è scritto nella versione {} di questo formato, e questa \
             copia di Fub legge fino alla {SCHEMA_VERSION}",
            file.version
        ));
    }
    let mut organization = file.organization;
    let scartate = recinta(&mut organization);
    Ok((organization, scartate))
}

/// Il recinto applicato alle chiavi del sidecar, che sono l'unico path del
/// vault che arrivava dal disco **senza passare da nessun varco**.
///
/// `.fub/workspace.json` è un file di testo dentro il vault: lo scrive Fub, ma
/// lo può scrivere anche una mano, una sincronizzazione o un altro strumento, e
/// ogni sua chiave nomina un documento o una cartella. Finché non passavano di
/// qui, un `"pinned": ["../../.ssh/authorized_keys"]` o un
/// `"icons": {"..\\..\\altrove": "📌"}` diventavano una riga della sidebar e un
/// path composto da chi la disegna. Era il difetto 0177, e la risposta è quella
/// di ogni altro ingresso: [`fenced_doc_id`], la stessa funzione dei comandi
/// IPC e del confine dei plugin — inclusa la sua tolleranza, così una chiave
/// scritta a mano con i separatori di Windows nomina ciò che voleva nominare
/// invece di essere buttata.
///
/// # Perché qui si pota, e in testa al modulo si dice di non potare
///
/// Non è la stessa potatura. Gli orfani che restano sono chiavi che nominano un
/// posto **che potrebbe tornare**: un file da un backup, un branch che si
/// rimonta. Una chiave che il recinto rifiuta non nomina un posto che può
/// tornare — nomina un posto che in questo vault non può esistere, perché
/// nessuna strada che crea o rinomina un documento la lascerebbe nascere. Non
/// si sta buttando un dato autorevole: si sta togliendo un nome che non è di
/// nessuno.
fn recinta(org: &mut Organization) -> Vec<String> {
    let mut scartate = Vec::new();
    org.icons = std::mem::take(&mut org.icons)
        .into_iter()
        .filter_map(|(k, v)| ammessa(&k, &mut scartate).map(|k| (k, v)))
        .collect();
    org.pinned = std::mem::take(&mut org.pinned)
        .into_iter()
        .filter_map(|p| ammessa(&p, &mut scartate))
        .collect();
    org.spaces = std::mem::take(&mut org.spaces)
        .into_iter()
        .filter_map(|s| ammessa(&s, &mut scartate))
        .collect();
    org.order = std::mem::take(&mut org.order)
        .into_iter()
        .filter_map(|(cartella, nomi)| {
            // La radice è la chiave vuota, ed è l'unica cartella che si nomina
            // non nominandola: il recinto la rifiuterebbe come «non nomina
            // niente», che qui è invece esattamente ciò che vuol dire.
            let cartella = match cartella.is_empty() {
                true => String::new(),
                false => ammessa(&cartella, &mut scartate)?,
            };
            // I valori non sono path ma **nomi di figli**, e chi disegna li
            // compone con la cartella: un nome che risale o che porta un
            // separatore comporrebbe un path che la chiave non dichiara. Un
            // nome è un path di un segmento solo, e si chiede così.
            let nomi = nomi
                .into_iter()
                .filter(|n| {
                    let dentro = path_policy::fenced(n).is_ok() && !n.contains(['/', '\\']);
                    if !dentro {
                        scartate.push(format!("{cartella}/{n}"));
                    }
                    dentro
                })
                .collect();
            Some((cartella, nomi))
        })
        .collect();
    scartate
}

/// Una chiave, se nomina un posto di questo vault. Vedi [`recinta`].
fn ammessa(chiave: &str, scartate: &mut Vec<String>) -> Option<String> {
    match path_policy::fenced_doc_id(&DocId::new(chiave)) {
        Ok(pulita) => Some(pulita.to_string()),
        Err(_) => {
            scartate.push(chiave.to_string());
            None
        }
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
    fn una_migrazione_non_lascia_lo_stesso_id_in_due_posti() {
        let store = OrganizationStore::in_memory();
        store.set_pinned("a.md", true).unwrap();
        store.set_pinned("c.md", true).unwrap();
        // `c.md` sta *prima* di `a.md` in una cartella e *dopo* nell'altra: se
        // sopravvivesse la copia migrata invece della prima, i due esiti
        // sarebbero l'uno il rovescio dell'altro.
        store
            .set_order("uno", vec!["c.md".into(), "x.md".into(), "a.md".into()])
            .unwrap();
        store
            .set_order("due", vec!["a.md".into(), "x.md".into(), "c.md".into()])
            .unwrap();

        assert!(store.migrate("uno/a.md", "uno/c.md").unwrap());
        assert!(store.migrate("due/a.md", "due/c.md").unwrap());
        assert!(store.migrate("a.md", "c.md").unwrap());

        let org = store.snapshot();
        assert_eq!(org.pinned, ["c.md"], "una nota appuntata una volta sola");
        assert_eq!(
            org.order["uno"],
            ["c.md", "x.md"],
            "chi c'era già non si sposta"
        );
        assert_eq!(
            org.order["due"],
            ["c.md", "x.md"],
            "e la copia che arriva addosso non porta via il posto di nessuno"
        );
    }

    #[test]
    fn un_ordine_con_un_doppione_non_lo_conserva() {
        let store = OrganizationStore::in_memory();
        store
            .set_order("", vec!["a.md".into(), "b.md".into(), "a.md".into()])
            .unwrap();
        assert_eq!(
            store.snapshot().order[""],
            ["a.md", "b.md"],
            "una lista di id è un insieme ordinato da qualunque porta arrivi"
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
        let (store, warning) = OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(warning.is_none());
        store.set_icon("a.md", Some("📌".into())).unwrap();

        let (riletto, warning) =
            OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
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

        let (store, warning) = OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
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

        let (store, warning) = OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(warning.is_some(), "e lo dice");
        let e = store
            .set_icon("a.md", Some("📌".into()))
            .expect_err("non si scrive su ciò che non si è letto");
        assert!(e.contains("non lo sovrascrive"), "{e}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), rotto);
    }

    /// **E un sidecar corretto a mano non aspetta una riapertura** (difetto
    /// 0170).
    ///
    /// La faccia opposta del precedente. Qui pesa più che per la
    /// configurazione, che al peggio si rifà cliccando: chi ha rotto il sidecar
    /// e lo rimette a posto si sentiva rispondere di no a ogni icona e ogni
    /// preferito finché non riapriva Fub, perché la bandiera che rispondeva
    /// l'aveva letta all'apertura e nessuno gliela rileggeva più.
    #[test]
    fn un_sidecar_corretto_a_mano_non_aspetta_una_riapertura() {
        let (_tmp, root) = tempdir();
        let path = organization_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{ \"icons\": {,} }").unwrap();

        let (store, warning) = OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(warning.is_some(), "e lo dice");

        std::fs::write(&path, "{ \"version\": 1, \"pinned\": [\"b.md\"] }").unwrap();

        store.set_icon("a.md", Some("📌".into())).expect(
            "il sidecar adesso si legge: rifiutare vorrebbe dire chiedere di \
             riaprire l'app per un file che è già a posto",
        );
        assert_eq!(
            store.snapshot().pinned,
            vec!["b.md".to_string()],
            "e si è fusi su ciò che il file corretto diceva, non sull'organizzazione \
             vuota dell'apertura"
        );
    }

    /// Il gemello del precedente sull'altro guasto: là il file **c'è e non si
    /// legge**, qui non c'è più. Le due risposte devono andare nello stesso
    /// verso — non si perde l'organizzazione — e ci vanno in due modi diversi,
    /// perché su un file rotto c'è qualcosa da non sovrascrivere e su uno
    /// sparito c'è solo da rifarlo.
    #[test]
    fn un_sidecar_sparito_a_meta_sessione_non_porta_via_l_organizzazione() {
        let (_tmp, root) = tempdir();
        let path = organization_path(&root);
        let (store, _) = OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
        store.set_icon("a.md", Some("📌".into())).unwrap();
        store.set_pinned("b.md", true).unwrap();

        // Qualcun altro lo toglie di sotto: una sincronizzazione, un editor,
        // chi fa pulizia in `.fub/`.
        std::fs::remove_file(&path).unwrap();

        store.set_icon("c.md", Some("📎".into())).unwrap();
        let org = store.snapshot();
        assert_eq!(
            org.icons.get("a.md").map(String::as_str),
            Some("📌"),
            "l'icona di prima è ancora lì"
        );
        assert_eq!(org.pinned, ["b.md"], "e il preferito pure");
        assert_eq!(org.icons.get("c.md").map(String::as_str), Some("📎"));

        // E il sidecar è tornato, con dentro tutto.
        let (riletto, warning) =
            OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
        assert!(warning.is_none(), "{warning:?}");
        assert_eq!(riletto.snapshot(), org);
    }

    #[test]
    fn un_file_dal_futuro_non_si_indovina() {
        let (_tmp, root) = tempdir();
        let path = organization_path(&root);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"version":99}"#).unwrap();
        let (_, warning) = OrganizationStore::open(&root, Arc::new(crate::storage::FsStorage));
        let warning = warning.expect("una versione che non si sa leggere si dice");
        assert!(warning.contains("99"), "{warning}");
    }
}
