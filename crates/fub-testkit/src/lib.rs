//! # fub-testkit — il banco di prova del lato **host**
//!
//! Costruire un vault, registrare un provider minimo, far girare un giro di
//! eventi e asserire su cosa è stato emesso. È il lato *host* del §16.2, e il
//! suo gemello è [`fub_sdk::testing`], che è il lato *provider*: là si prova
//! un provider **contro il contratto**, qui si prova qualcosa **contro il
//! kernel vero**. Due banchi, due crate, e la ragione per cui non possono
//! essere lo stesso sta nella [decisione
//! 0055](../../../docs/decisions/0055-il-banco-del-lato-host.md).
//!
//! # Perché è un builder e non una funzione `vault()`
//!
//! La voce prometteva che un banco solo assorbisse trentacinque helper. Contati,
//! quei trentacinque **non costruiscono lo stesso vault**: variano su cinque
//! assi indipendenti — dove sta la radice, quale formato è registrato, quali
//! plugin sono dichiarati, che file ci sono dentro, e se si è già scandito. Una
//! `fn vault() -> (TempDir, Workspace)` sola avrebbe servito il sottoinsieme che
//! non chiede niente e sarebbe stata scavalcata da tutti gli altri — che è
//! esattamente il modo in cui si arriva a trentacinque copie.
//!
//! Quindi il banco è un **builder su quegli assi**, e il default è il caso più
//! frequente: una radice temporanea, un formato di prova su `md`, nessun plugin,
//! nessun file, già scandito.
//!
//! ```no_run
//! use fub_testkit::Banco;
//!
//! let mut banco = Banco::nuovo().con_plugin("prova.plugin").monta();
//! banco.scrivi("nota.md", "corpo");
//! banco.reindex().expect("scansione");
//! ```
//!
//! # Cosa questo crate non è
//!
//! Non è il posto dei **dati** di un test. I banchi degli end-to-end di
//! `fub-format-markdown` e `fub-features` seminano un corpus con un
//! frontmatter e dei wikilink precisi, e quel corpus *è* il soggetto del test:
//! portarlo qui vorrebbe dire che questo crate spedisce i dati di prova di
//! quattro test che non si parlano. Quelli restano dove sono, e prendono da qui
//! solo l'impalcatura.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};

use fub_abi::event::{Event, EventKind, EventMask, Notice};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{EventHandler, HostApi, PluginManifest, PluginPermissions};
use fub_abi::{FormatProvider, PluginError};

use fub_kernel::{FormatRegistry, Trust, Workspace};

pub mod formato;

pub use formato::{EstrattoreDiProva, TestoDiProva};

/// Il registro degli eventi visti da [`Banco::eventi`], condiviso con la spia.
type Registro = Arc<Mutex<Vec<Event>>>;

// ---------------------------------------------------------------------------
// Il builder
// ---------------------------------------------------------------------------

/// Come si vuole il banco, prima che esista.
///
/// Ogni metodo è uno degli assi su cui i trentacinque helper contati dal §16.2
/// differivano davvero. Chi non ne tocca nessuno ottiene il caso più frequente.
pub struct Banco {
    radice: Radice,
    formati: FormatRegistry,
    /// `true` finché nessuno ha chiamato [`Banco::con_formato`] o
    /// [`Banco::senza_formato`]: serve a distinguere «va bene il default» da
    /// «lo voglio vuoto», che sono due richieste diverse e finora si scrivevano
    /// uguali.
    formato_predefinito: bool,
    plugin: Vec<String>,
    plugin_di_terzi: Vec<String>,
    file: Vec<(String, String)>,
    spia: bool,
    scandisci: bool,
}

/// Dove sta il vault: una cartella temporanea che il banco possiede, o una che
/// gli viene data e di cui non risponde.
enum Radice {
    Temporanea,
    Data(Utf8PathBuf),
}

impl Default for Banco {
    fn default() -> Self {
        Banco::nuovo()
    }
}

impl Banco {
    /// Un banco su una cartella temporanea, con il formato di prova su `md`,
    /// nessun plugin dichiarato e nessun file.
    pub fn nuovo() -> Self {
        Banco {
            radice: Radice::Temporanea,
            formati: FormatRegistry::new(),
            formato_predefinito: true,
            plugin: Vec::new(),
            plugin_di_terzi: Vec::new(),
            file: Vec::new(),
            spia: false,
            scandisci: true,
        }
    }

    /// Un banco su una cartella **data**, che il chiamante possiede e tiene in
    /// vita: è la forma dei test che aprono lo stesso vault due volte per
    /// provare che qualcosa è sopravvissuto alla chiusura.
    pub fn su(radice: impl AsRef<Utf8Path>) -> Self {
        Banco {
            radice: Radice::Data(radice.as_ref().to_path_buf()),
            ..Banco::nuovo()
        }
    }

    /// Registra un formato. Sostituisce il default invece di aggiungersi, la
    /// prima volta che lo si chiama.
    pub fn con_formato(mut self, provider: Box<dyn FormatProvider>) -> Self {
        self.formato_predefinito = false;
        self.formati
            .register(provider)
            .expect("nessun conflitto di estensioni sul banco");
        self
    }

    /// Nessun formato registrato: il vault non riconosce niente. È lo stato in
    /// cui un test guarda cosa fa il kernel su un file che nessuno rivendica.
    pub fn senza_formato(mut self) -> Self {
        self.formato_predefinito = false;
        self
    }

    /// Il formato di prova su un'estensione diversa da `md`.
    ///
    /// È l'asse su cui le nove `PlainProvider` del §16.2 differivano davvero:
    /// sei registravano `txt` e tre `md`, il che cambia quali file il kernel
    /// instrada — cioè non erano affatto la stessa struct scritta nove volte.
    pub fn con_estensione(self, ext: &str) -> Self {
        self.con_formato(Box::new(TestoDiProva::per_estensione(ext)))
    }

    /// Dichiara una feature di base. Il kernel non presta capacità a una
    /// stringa (§7.3): un id che nessuno ha dichiarato riceve un host che nega
    /// tutto, e dimenticarsene è il modo più frequente di scrivere un test che
    /// fallisce per il motivo sbagliato.
    pub fn con_plugin(mut self, id: &str) -> Self {
        self.plugin.push(id.to_string());
        self
    }

    /// Dichiara più feature di base in una volta.
    pub fn con_plugins<'a>(mut self, ids: impl IntoIterator<Item = &'a str>) -> Self {
        self.plugin.extend(ids.into_iter().map(str::to_string));
        self
    }

    /// Dichiara un plugin **di terzi** — `Trust::Community` e i permessi di
    /// base — invece di una feature di base. La differenza si vede dove il
    /// kernel guarda la fiducia prima di concedere qualcosa.
    pub fn con_plugin_di_terzi(mut self, id: &str) -> Self {
        self.plugin_di_terzi.push(id.to_string());
        self
    }

    /// Semina un file nel vault prima che il kernel lo guardi: è ciò che
    /// troverebbe aprendo una cartella che già esisteva.
    pub fn con_file(mut self, rel: &str, corpo: &str) -> Self {
        self.file.push((rel.to_string(), corpo.to_string()));
        self
    }

    /// Registra una spia che prende **ogni** evento, leggibile da
    /// [`Banco::eventi`]. È la seconda metà di ciò che il §16.2 chiede al banco
    /// del lato host: non solo costruire, ma «asserire su cosa è stato emesso».
    pub fn con_spia(mut self) -> Self {
        self.spia = true;
        self
    }

    /// Non scandire il vault al montaggio. Serve dove il test vuole guardare
    /// *la prima* scansione, che altrimenti sarebbe già avvenuta.
    pub fn senza_scansione(mut self) -> Self {
        self.scandisci = false;
        self
    }

    /// Costruisce il vault e monta il kernel.
    pub fn monta(mut self) -> Montato {
        if self.formato_predefinito {
            self.formati
                .register(Box::new(TestoDiProva::per_estensione("md")))
                .expect("il formato predefinito non collide con niente");
        }

        let (dir, root) = match &self.radice {
            Radice::Temporanea => {
                let dir = tempfile::tempdir().expect("cartella temporanea");
                let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf())
                    .expect("la cartella temporanea non è UTF-8");
                (Some(dir), root)
            }
            Radice::Data(root) => (None, root.clone()),
        };

        for (rel, corpo) in &self.file {
            scrivi_in(&root, rel, corpo);
        }

        let mut ws = Workspace::new(&root, self.formati).expect("la radice appena creata si apre");

        for id in &self.plugin {
            ws.register_core_feature(id, id)
                .expect("id di feature dichiarato una volta sola");
        }
        for id in &self.plugin_di_terzi {
            ws.register_plugin(
                PluginManifest::new(id, id).granting(PluginPermissions::core()),
                Trust::Community,
            )
            .expect("id di plugin dichiarato una volta sola");
        }

        let registro: Registro = Arc::default();
        if self.spia {
            ws.register_core_feature(SPIA, SPIA)
                .expect("l'id della spia è riservato al banco");
            ws.register_event_handler(SPIA, Box::new(Spia(registro.clone())))
                .expect("registrazione della spia");
        }

        if self.scandisci {
            ws.reindex().expect("scansione iniziale");
        }
        // Ciò che è stato emesso *montando* non è ciò che il test guarda: chi
        // chiede la spia vuole vedere gli eventi delle proprie mosse, non quelli
        // della semina. Chi vuole anche quelli usa `senza_scansione`.
        registro.lock().unwrap().clear();

        Montato {
            _dir: dir,
            root,
            ws,
            registro,
        }
    }
}

/// L'id sotto cui il banco registra la propria spia. È riservato: un test che
/// dichiarasse lo stesso id troverebbe un errore di registrazione al montaggio,
/// invece di due gestori che si contendono lo stesso nome.
pub const SPIA: &str = "fub.testkit.spia";

// ---------------------------------------------------------------------------
// Il banco montato
// ---------------------------------------------------------------------------

/// Un vault vero, con il kernel montato sopra.
///
/// Tiene in vita la cartella temporanea, che è la cosa che si dimentica: un
/// `let (_dir, ws) = vault();` con l'underscore sbagliato cancella il vault
/// prima del primo `assert`, e il test fallisce dicendo che un file non c'è.
pub struct Montato {
    _dir: Option<tempfile::TempDir>,
    root: Utf8PathBuf,
    ws: Workspace,
    registro: Registro,
}

impl Montato {
    /// La radice del vault.
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// Scrive un file **alle spalle del kernel**: è quel che fa un altro
    /// programma — o Obsidian — mentre Fub guarda altrove.
    pub fn scrivi(&self, rel: &str, corpo: &str) {
        scrivi_in(&self.root, rel, corpo);
    }

    /// Scrive dei **byte**, che è l'unico modo di mettere nel vault un file che
    /// non è testo — un allegato, o un documento con un encoding suo.
    pub fn scrivi_byte(&self, rel: &str, corpo: &[u8]) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("cartelle intermedie");
        }
        std::fs::write(&path, corpo).unwrap_or_else(|e| panic!("scrittura di `{rel}`: {e}"));
    }

    /// Legge un file dal disco, saltando il kernel.
    pub fn leggi(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel))
            .unwrap_or_else(|e| panic!("lettura di `{rel}`: {e}"))
    }

    /// Il file c'è sul disco?
    pub fn esiste(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }

    /// Gli eventi emessi da quando il banco è stato montato, in ordine.
    ///
    /// Vuoto se nessuno ha chiesto [`Banco::con_spia`] — e lo dice invece di
    /// far credere che non sia successo niente.
    pub fn eventi(&self) -> Vec<Event> {
        self.registro.lock().unwrap().clone()
    }

    /// I *tipi* degli eventi emessi, che è ciò su cui la maggior parte dei test
    /// asserisce: la variante, non il carico.
    pub fn tipi_eventi(&self) -> Vec<EventKind> {
        self.registro
            .lock()
            .unwrap()
            .iter()
            .map(Event::kind)
            .collect()
    }

    /// Dimentica gli eventi visti finora: il test che ha appena finito di
    /// preparare il terreno riparte da un registro vuoto.
    pub fn dimentica_eventi(&self) {
        self.registro.lock().unwrap().clear();
    }

    /// La via d'uscita per i builder del `Workspace` che **consumano `self`**.
    ///
    /// `Deref`/`DerefMut` prestano `&Workspace` e `&mut Workspace`, e non
    /// bastano per un `fn with_qualcosa(mut self, …) -> Self`: quello vuole il
    /// `Workspace` per valore, e il banco lo possiede.
    ///
    /// È deliberatamente **generale** invece di essere un metodo per ognuno di
    /// quei builder. Un banco che cresce di un metodo ogni volta che il kernel
    /// ne aggiunge uno è un banco che si riscrive dietro al kernel; e — che è
    /// peggio — un banco che *non* esprime un caso viene scavalcato con un
    /// helper scritto a mano accanto, che è precisamente il meccanismo con cui
    /// si è arrivati a trentacinque copie.
    ///
    /// ```no_run
    /// # use fub_testkit::Banco;
    /// # use std::sync::Arc;
    /// # fn esempio(states: Arc<fub_kernel::ViewStates>) {
    /// let banco = Banco::nuovo()
    ///     .monta()
    ///     .adatta(|ws| ws.with_view_states(states));
    /// # }
    /// ```
    pub fn adatta(mut self, f: impl FnOnce(Workspace) -> Workspace) -> Self {
        // Si sostituisce il `Workspace` in posto con un segnaposto per poterlo
        // dare per valore: il banco resta il proprietario e chi chiama non deve
        // saperlo.
        let segnaposto = Workspace::new(&self.root, FormatRegistry::new())
            .expect("la radice del banco è già stata aperta al montaggio");
        let vero = std::mem::replace(&mut self.ws, segnaposto);
        self.ws = f(vero);
        self
    }
}

impl std::ops::Deref for Montato {
    type Target = Workspace;
    fn deref(&self) -> &Workspace {
        &self.ws
    }
}

impl std::ops::DerefMut for Montato {
    fn deref_mut(&mut self) -> &mut Workspace {
        &mut self.ws
    }
}

// ---------------------------------------------------------------------------

fn scrivi_in(root: &Utf8Path, rel: &str, corpo: &str) {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("cartelle intermedie");
    }
    std::fs::write(&path, corpo).unwrap_or_else(|e| panic!("scrittura di `{rel}`: {e}"));
}

/// La spia: prende tutto e ricorda l'ordine.
struct Spia(Registro);

impl EventHandler for Spia {
    fn subscribed(&self) -> EventMask {
        EventMask::all()
    }

    fn handle(&mut self, notice: &Notice, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.0.lock().unwrap().push(notice.event.clone());
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Ciò che il banco *non* offre ancora, e chi lo chiede
// ---------------------------------------------------------------------------

/// Il §16.7 chiede un inventario dei provider ufficiali da cui i test iterino
/// invece di elencarli a mano — un `ogni_view_ufficiale()`. Il posto naturale è
/// questo modulo, e non c'è: costruirlo qui vorrebbe dire mettere
/// `fub-features` fra le dipendenze di questo crate, che è una decisione della
/// [seduta 16](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md) e non di
/// questa. La nota resta perché il posto sia già nominato quando quella voce si
/// aprirà.
#[doc(hidden)]
pub mod _dove_andra_ogni_view_ufficiale {}

// ---------------------------------------------------------------------------

/// Utilità di uso frequentissimo: un [`DocId`] da un letterale.
pub fn doc(id: &str) -> DocId {
    DocId::new(id)
}

/// Un [`DocumentModel`] nudo con un testo: ciò che un provider giocattolo
/// produrrebbe, per i test che vogliono un modello senza montare niente.
pub fn modello(id: &str, testo: &str) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.text = testo.to_string();
    m
}
