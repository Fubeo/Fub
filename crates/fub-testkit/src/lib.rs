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

pub mod format;

pub use format::{SampleExtractor, SampleText};

/// Il registro degli eventi visti da [`Banco::eventi`], condiviso con la spia.
type Record = Arc<Mutex<Vec<Event>>>;

// ---------------------------------------------------------------------------
// Il builder
// ---------------------------------------------------------------------------

/// Come si vuole il banco, prima che esista.
///
/// Ogni metodo è uno degli assi su cui i trentacinque helper contati dal §16.2
/// differivano davvero. Chi non ne tocca nessuno ottiene il caso più frequente.
pub struct Bench {
    root: Root,
    formats: FormatRegistry,
    /// `true` finché nessuno ha chiamato [`Banco::con_formato`] o
    /// [`Banco::senza_formato`]: serve a distinguere «va bene il default» da
    /// «lo voglio vuoto», che sono due richieste diverse e finora si scrivevano
    /// uguali.
    format_default: bool,
    plugin: Vec<String>,
    plugin_of_third_party: Vec<String>,
    file: Vec<(String, String)>,
    probe: bool,
    scan: bool,
}

/// Dove sta il vault: una cartella temporanea che il banco possiede, o una che
/// gli viene data e di cui non risponde.
enum Root {
    Temporary,
    Data(Utf8PathBuf),
}

impl Default for Bench {
    fn default() -> Self {
        Bench::new()
    }
}

impl Bench {
    /// Un banco su una cartella temporanea, con il formato di prova su `md`,
    /// nessun plugin dichiarato e nessun file.
    pub fn new() -> Self {
        Bench {
            root: Root::Temporary,
            formats: FormatRegistry::new(),
            format_default: true,
            plugin: Vec::new(),
            plugin_of_third_party: Vec::new(),
            file: Vec::new(),
            probe: false,
            scan: true,
        }
    }

    /// Un banco su una cartella **data**, che il chiamante possiede e tiene in
    /// vita: è la forma dei test che aprono lo stesso vault due volte per
    /// provare che qualcosa è sopravvissuto alla chiusura.
    pub fn on(root: impl AsRef<Utf8Path>) -> Self {
        Bench {
            root: Root::Data(root.as_ref().to_path_buf()),
            ..Bench::new()
        }
    }

    /// Registra un formato. Sostituisce il default invece di aggiungersi, la
    /// prima volta che lo si chiama.
    pub fn with_format(mut self, provider: Box<dyn FormatProvider>) -> Self {
        self.format_default = false;
        self.formats
            .register(provider)
            .expect("nessun conflitto di estensioni sul banco");
        self
    }

    /// Nessun formato registrato: il vault non riconosce niente. È lo stato in
    /// cui un test guarda cosa fa il kernel su un file che nessuno rivendica.
    pub fn without_format(mut self) -> Self {
        self.format_default = false;
        self
    }

    /// Il formato di prova su un'estensione diversa da `md`.
    ///
    /// È l'asse su cui le nove `PlainProvider` del §16.2 differivano davvero:
    /// sei registravano `txt` e tre `md`, il che cambia quali file il kernel
    /// instrada — cioè non erano affatto la stessa struct scritta nove volte.
    pub fn with_extension(self, ext: &str) -> Self {
        self.with_format(Box::new(SampleText::by_extension(ext)))
    }

    /// Dichiara una feature di base. Il kernel non presta capacità a una
    /// stringa (§7.3): un id che nessuno ha dichiarato riceve un host che nega
    /// tutto, e dimenticarsene è il modo più frequente di scrivere un test che
    /// fallisce per il motivo sbagliato.
    pub fn with_plugin(mut self, id: &str) -> Self {
        self.plugin.push(id.to_string());
        self
    }

    /// Dichiara più feature di base in una volta.
    pub fn with_plugins<'a>(mut self, ids: impl IntoIterator<Item = &'a str>) -> Self {
        self.plugin.extend(ids.into_iter().map(str::to_string));
        self
    }

    /// Dichiara un plugin **di terzi** — `Trust::Community` e i permessi di
    /// base — invece di una feature di base. La differenza si vede dove il
    /// kernel guarda la fiducia prima di concedere qualcosa.
    pub fn with_third_party_plugin(mut self, id: &str) -> Self {
        self.plugin_of_third_party.push(id.to_string());
        self
    }

    /// Semina un file nel vault prima che il kernel lo guardi: è ciò che
    /// troverebbe aprendo una cartella che già esisteva.
    pub fn with_file(mut self, rel: &str, body: &str) -> Self {
        self.file.push((rel.to_string(), body.to_string()));
        self
    }

    /// Registra una spia che prende **ogni** evento, leggibile da
    /// [`Banco::eventi`]. È la seconda metà di ciò che il §16.2 chiede al banco
    /// del lato host: non solo costruire, ma «asserire su cosa è stato emesso».
    pub fn with_spy(mut self) -> Self {
        self.probe = true;
        self
    }

    /// Non scandire il vault al montaggio. Serve dove il test vuole guardare
    /// *la prima* scansione, che altrimenti sarebbe già avvenuta.
    pub fn without_scan(mut self) -> Self {
        self.scan = false;
        self
    }

    /// Costruisce il vault e monta il kernel.
    pub fn mounts(mut self) -> Mounted {
        if self.format_default {
            self.formats
                .register(Box::new(SampleText::by_extension("md")))
                .expect("il formato predefinito non collide con niente");
        }

        let (dir, root) = match &self.root {
            Root::Temporary => {
                let dir = tempfile::tempdir().expect("cartella temporanea");
                let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf())
                    .expect("la cartella temporanea non è UTF-8");
                (Some(dir), root)
            }
            Root::Data(root) => (None, root.clone()),
        };

        for (rel, body) in &self.file {
            write_in(&root, rel, body);
        }

        let mut ws = Workspace::new(&root, self.formats).expect("la radice appena creata si apre");

        for id in &self.plugin {
            ws.register_core_feature(id, id)
                .expect("id di feature dichiarato una volta sola");
        }
        for id in &self.plugin_of_third_party {
            ws.register_plugin(
                PluginManifest::new(id, id).granting(PluginPermissions::core()),
                Trust::Community,
            )
            .expect("id di plugin dichiarato una volta sola");
        }

        let journal: Record = Arc::default();
        if self.probe {
            ws.register_core_feature(SPY, SPY)
                .expect("l'id della spia è riservato al banco");
            ws.register_event_handler(SPY, Box::new(Spy(journal.clone())))
                .expect("registrazione della spia");
        }

        if self.scan {
            ws.reindex().expect("scansione iniziale");
        }
        // Ciò che è stato emesso *montando* non è ciò che il test guarda: chi
        // chiede la spia vuole vedere gli eventi delle proprie mosse, non quelli
        // della semina. Chi vuole anche quelli usa `senza_scansione`.
        journal.lock().unwrap().clear();

        Mounted {
            _dir: dir,
            root,
            ws,
            journal,
        }
    }
}

/// L'id sotto cui il banco registra la propria spia. È riservato: un test che
/// dichiarasse lo stesso id troverebbe un errore di registrazione al montaggio,
/// invece di due gestori che si contendono lo stesso nome.
pub const SPY: &str = "fub.testkit.spia";

// ---------------------------------------------------------------------------
// Il banco montato
// ---------------------------------------------------------------------------

/// Un vault vero, con il kernel montato sopra.
///
/// Tiene in vita la cartella temporanea, che è la cosa che si dimentica: un
/// `let (_dir, ws) = vault();` con l'underscore sbagliato cancella il vault
/// prima del primo `assert`, e il test fallisce dicendo che un file non c'è.
pub struct Mounted {
    _dir: Option<tempfile::TempDir>,
    root: Utf8PathBuf,
    ws: Workspace,
    journal: Record,
}

impl Mounted {
    /// La radice del vault.
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// Scrive un file **alle spalle del kernel**: è quel che fa un altro
    /// programma — o Obsidian — mentre Fub guarda altrove.
    pub fn write(&self, rel: &str, body: &str) {
        write_in(&self.root, rel, body);
    }

    /// Scrive dei **byte**, che è l'unico modo di mettere nel vault un file che
    /// non è testo — un allegato, o un documento con un encoding suo.
    pub fn write_byte(&self, rel: &str, body: &[u8]) {
        let path = self.root.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("cartelle intermedie");
        }
        std::fs::write(&path, body).unwrap_or_else(|and| panic!("scrittura di `{rel}`: {and}"));
    }

    /// Legge un file dal disco, saltando il kernel.
    pub fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.root.join(rel))
            .unwrap_or_else(|and| panic!("lettura di `{rel}`: {and}"))
    }

    /// Il file c'è sul disco?
    pub fn exists(&self, rel: &str) -> bool {
        self.root.join(rel).exists()
    }

    /// Gli eventi emessi da quando il banco è stato montato, in ordine.
    ///
    /// Vuoto se nessuno ha chiesto [`Banco::con_spia`] — e lo dice invece di
    /// far credere che non sia successo niente.
    pub fn events(&self) -> Vec<Event> {
        self.journal.lock().unwrap().clone()
    }

    /// I *tipi* degli eventi emessi, che è ciò su cui la maggior parte dei test
    /// asserisce: la variante, non il carico.
    pub fn event_kinds(&self) -> Vec<EventKind> {
        self.journal
            .lock()
            .unwrap()
            .iter()
            .map(Event::kind)
            .collect()
    }

    /// Dimentica gli eventi visti finora: il test che ha appena finito di
    /// preparare il terreno riparte da un registro vuoto.
    pub fn forgets_events(&self) {
        self.journal.lock().unwrap().clear();
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
    ///     .adapt(|ws| ws.with_view_states(states));
    /// # }
    /// ```
    pub fn adapt(mut self, f: impl FnOnce(Workspace) -> Workspace) -> Self {
        // Si sostituisce il `Workspace` in posto con un segnaposto per poterlo
        // dare per valore: il banco resta il proprietario e chi chiama non deve
        // saperlo.
        let placeholder = Workspace::new(&self.root, FormatRegistry::new())
            .expect("la radice del banco è già stata aperta al montaggio");
        let real = std::mem::replace(&mut self.ws, placeholder);
        self.ws = f(real);
        self
    }
}

impl std::ops::Deref for Mounted {
    type Target = Workspace;
    fn deref(&self) -> &Workspace {
        &self.ws
    }
}

impl std::ops::DerefMut for Mounted {
    fn deref_mut(&mut self) -> &mut Workspace {
        &mut self.ws
    }
}

// ---------------------------------------------------------------------------

fn write_in(root: &Utf8Path, rel: &str, body: &str) {
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("cartelle intermedie");
    }
    std::fs::write(&path, body).unwrap_or_else(|and| panic!("scrittura di `{rel}`: {and}"));
}

/// La spia: prende tutto e ricorda l'ordine.
struct Spy(Record);

impl EventHandler for Spy {
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
pub mod _where_will_every_official_view_go {}

// ---------------------------------------------------------------------------

/// Utilità di uso frequentissimo: un [`DocId`] da un letterale.
pub fn doc(id: &str) -> DocId {
    DocId::new(id)
}

/// Un [`DocumentModel`] nudo con un testo: ciò che un provider giocattolo
/// produrrebbe, per i test che vogliono un modello senza montare niente.
pub fn model(id: &str, text: &str) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.text = text.to_string();
    m
}
