//! L'host e la sessione: chi tiene aperto un vault, e chi lo chiude.
//!
//! `Host` è ciò che prima si chiamava `AppState` e viveva nella colla Tauri.
//! La differenza non è il nome: è che le tre cose che rendevano quel tipo
//! inutilizzabile fuori dall'app — il montaggio cablato dentro un comando, il
//! watcher costruito sul posto e il ponte eventi che parlava a un webview —
//! adesso sono [`mount`](crate::mount), un [`WatcherFactory`] e un
//! [`EventSink`]. Chi non ha un webview passa un `NoWatcher` e nessun sink, e
//! ottiene lo stesso vault.
//!
//! **Una sessione sola.** `Host` tiene una `Option<VaultSession>`, come prima:
//! aprire un vault chiude quello aperto. Le sessioni multiple sono il §9.6, e
//! quando arriveranno il posto dove mettere la mappa è questo — non ventidue
//! comandi IPC.

use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::model::DocId;
use fubmd_abi::Notice;
use fubmd_features::{VersionRef, VersionStore, VERSIONING_ID};
use fubmd_kernel::Workspace;

use crate::mount::mount;
use crate::records::{read_workspace_meta, write_workspace_meta, VaultInfo, WorkspaceMeta};
use crate::watcher::{VaultWatcher, WatcherFactory};

/// Dove finiscono gli eventi del kernel una volta usciti dall'host.
///
/// Il kernel ha già un bus e chiunque può abbonarsi: questo trait esiste perché
/// il ponte va **acceso nel momento giusto** — dopo la scansione iniziale e
/// prima che il watcher possa emettere il primo evento — e quel momento lo
/// conosce solo chi apre. Lasciarlo al chiamante voleva dire lasciargli una
/// finestra in cui gli eventi si perdono.
///
/// Per l'app è il webview (`fubmd://event`); per un'API locale sarebbero SSE o
/// websocket; per una CLI stdout; per un e2e headless, niente — e "niente" qui
/// si dice non passando nessun sink, non passandone uno che butta via, così il
/// thread del ponte non nasce nemmeno.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, notice: &Notice);
}

/// Sessione di un vault aperto: il workspace condiviso, la metà leggibile del
/// versioning, e il rilevatore tenuto vivo.
pub struct VaultSession {
    workspace: Arc<Mutex<Workspace>>,
    /// Copia dello store delle versioni, se il versioning è acceso. L'altra
    /// vive dentro l'handler registrato nel workspace: il kernel non sa che il
    /// versioning esiste, ed è l'host a comporre le due metà.
    versions: Option<VersionStore>,
    /// Va solo tenuto in vita: quando la sessione cade, smette di guardare.
    watcher: Box<dyn VaultWatcher>,
}

impl VaultSession {
    pub fn workspace(&self) -> &Arc<Mutex<Workspace>> {
        &self.workspace
    }

    pub fn versions(&self) -> Option<&VersionStore> {
        self.versions.as_ref()
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? (§9.7)
    pub fn is_watching(&self) -> bool {
        self.watcher.is_watching()
    }
}

/// Chi monta FubMD e tiene il vault aperto.
pub struct Host {
    session: Mutex<Option<VaultSession>>,
    watcher: Box<dyn WatcherFactory>,
    sink: Option<Arc<dyn EventSink>>,
}

impl Default for Host {
    fn default() -> Self {
        Self::new()
    }
}

impl Host {
    /// Un host col rilevatore di default e nessun ponte eventi.
    ///
    /// Il rilevatore di default è `notify` se la cargo feature
    /// `notify-watcher` è accesa (lo è), e [`NoWatcher`](crate::NoWatcher)
    /// altrimenti — cioè su PWA e mobile, dove `notify` non esiste affatto.
    pub fn new() -> Self {
        #[cfg(feature = "notify-watcher")]
        let watcher: Box<dyn WatcherFactory> = Box::new(crate::watcher::NotifyWatcher);
        #[cfg(not(feature = "notify-watcher"))]
        let watcher: Box<dyn WatcherFactory> = Box::new(crate::watcher::NoWatcher);
        Self {
            session: Mutex::new(None),
            watcher,
            sink: None,
        }
    }

    /// Sostituisce il rilevatore. Un e2e headless passa `NoWatcher`.
    pub fn with_watcher(mut self, watcher: Box<dyn WatcherFactory>) -> Self {
        self.watcher = watcher;
        self
    }

    /// Accende il ponte eventi verso `sink`.
    pub fn with_sink(mut self, sink: Arc<dyn EventSink>) -> Self {
        self.sink = Some(sink);
        self
    }

    /// Apre un vault: monta, scansiona, accende il ponte, avvia il rilevatore.
    pub fn open(&self, root: &Utf8Path) -> Result<VaultInfo, String> {
        if !root.is_dir() {
            return Err(format!("Non è una cartella valida: {root}"));
        }

        // La sessione precedente si chiude **prima** che la nuova si apra, e non
        // dopo: l'indice di ricerca tiene un lock esclusivo di scrittura sulla
        // propria cartella, e tantivy quel lock lo aspetta *bloccando*. Aprendo la
        // nuova sessione sullo stesso vault mentre la vecchia è ancora viva, il
        // comando si pianta per sempre — nessun errore, nessun log, la finestra
        // resta a metà. Succede riaprendo lo stesso vault dal dialogo, e in
        // sviluppo a ogni ricarica della pagina.
        //
        // Prezzo dichiarato: se l'apertura nuova fallisce, non si torna alla
        // vecchia. È la scelta onesta — la sessione vecchia ha già un watcher e un
        // indice su un vault che l'utente ha detto di voler lasciare.
        drop(self.session.lock().unwrap().take());

        let crate::mount::Mounted {
            workspace: mut ws,
            versions,
        } = mount(root)?;

        ws.reindex().map_err(|e| e.to_string())?;

        // Ponte eventi kernel → sink (thread dedicato che vive quanto il bus).
        //
        // Acceso **dopo** la scansione: gli eventi che `reindex` emette sono il
        // vault che si popola, non il vault che cambia, e la shell li leggerebbe
        // come un temporale di modifiche. È il comportamento di prima, ed è
        // deliberato — il freno e il raggruppamento sono il §10.2.
        if let Some(sink) = &self.sink {
            let rx = ws.bus().subscribe();
            let sink = sink.clone();
            std::thread::spawn(move || {
                while let Ok(notice) = rx.recv() {
                    sink.emit(&notice);
                }
            });
        }

        let workspace = Arc::new(Mutex::new(ws));
        let watcher = self.watcher.start(root, workspace.clone())?;

        let info = {
            let ws = workspace.lock().unwrap();
            VaultInfo {
                root: ws.root().to_string(),
                documents: ws.documents().into_iter().map(|d| d.0).collect(),
                extensions: ws.extensions(),
                plugins: ws.plugins(),
            }
        };

        *self.session.lock().unwrap() = Some(VaultSession {
            workspace,
            versions,
            watcher,
        });
        Ok(info)
    }

    /// Chiude la sessione, se ce n'è una.
    ///
    /// Oggi vuol dire "lasciala cadere": il watcher si ferma perché il debouncer
    /// viene distrutto, e il resto se ne va con lui. **Non** c'è un flush
    /// finale, né un `deactivate` sui provider, né un `close` sugli indici — è
    /// il §9.5, ed è aperto. Il metodo esiste perché quando quel lavoro si farà,
    /// il posto dove metterlo è questo, e perché finora non c'era nemmeno un
    /// posto.
    pub fn close(&self) {
        drop(self.session.lock().unwrap().take());
    }

    /// Un handle clonato al workspace corrente, o errore se nessun vault è
    /// aperto.
    pub fn workspace(&self) -> Result<Arc<Mutex<Workspace>>, String> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .map(|s| s.workspace.clone())
            .ok_or_else(|| "Nessun vault aperto.".to_string())
    }

    /// La radice del vault aperto.
    pub fn root(&self) -> Result<Utf8PathBuf, String> {
        let ws = self.workspace()?;
        let ws = ws.lock().unwrap();
        Ok(ws.root().to_owned())
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? `false` anche
    /// quando non c'è nessun vault aperto (§9.7).
    pub fn is_watching(&self) -> bool {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(VaultSession::is_watching)
    }

    // --- versioning --------------------------------------------------------
    //
    // Il kernel non sa che il versioning esiste: le versioni le tiene un
    // `EventHandler`, e il ripristino è una scrittura normale (D8). L'host
    // compone le due metà, che è esattamente ciò che dovrà fare per un plugin
    // di terzi.

    /// Lo store delle versioni della sessione, o l'errore se il versioning è
    /// spento: un chiamante che risponde "vuoto" quando la feature non c'è
    /// racconterebbe che non ci sono versioni, che è un'altra cosa.
    pub fn versions(&self) -> Result<VersionStore, String> {
        self.session
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|s| s.versions.clone())
            .ok_or_else(|| "Versioning disattivato.".to_string())
    }

    pub fn list_versions(&self, id: &DocId) -> Result<Vec<VersionRef>, String> {
        Ok(self.versions()?.list(id))
    }

    /// Rileggere una versione passa dall'`HostApi` come tutto il resto: l'host
    /// presta al versioning le sue stesse capacità (`Workspace::with_host`), non
    /// una scorciatoia sul filesystem.
    pub fn read_version(&self, id: &DocId, ts: u64) -> Result<String, String> {
        let store = self.versions()?;
        let ws = self.workspace()?;
        let mut ws = ws.lock().unwrap();
        ws.with_host(VERSIONING_ID, |host| store.read(id, ts, host))
            .map_err(|e| e.to_string())
    }

    /// Ripristina una versione riscrivendo il documento (D8): passa da parse,
    /// grafo, indici ed eventi come ogni altra modifica — e siccome passa dagli
    /// eventi, genera a sua volta uno snapshot. Il ripristino è annullabile.
    pub fn restore_version(&self, id: &DocId, ts: u64) -> Result<(), String> {
        let source = self.read_version(id, ts)?;
        let ws = self.workspace()?;
        let mut ws = ws.lock().unwrap();
        ws.write_document(id, &source).map_err(|e| e.to_string())
    }

    // --- organizzazione del vault ------------------------------------------

    pub fn read_meta(&self) -> Result<WorkspaceMeta, String> {
        read_workspace_meta(&self.root()?)
    }

    pub fn write_meta(&self, meta: &WorkspaceMeta) -> Result<(), String> {
        write_workspace_meta(&self.root()?, meta)
    }
}

/// [`DocId`] da input non fidato: la stessa validazione del kernel
/// (`fubmd_kernel::valid_doc_id`), applicata sul confine — nessun chiamante
/// costruisce un `DocId` non sanitizzato da ciò che arriva da fuori.
///
/// Sta qui e non nella colla Tauri perché il webview non è l'unico "fuori": la
/// CLI riceve argomenti, l'API locale riceve path, e una seconda copia di
/// questa riga sarebbe una seconda idea di cosa sia un id accettabile.
pub fn doc_id(raw: &str) -> Result<DocId, String> {
    fubmd_kernel::valid_doc_id(raw).map_err(|e| e.to_string())
}
