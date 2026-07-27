//! L'host e le sessioni: chi tiene aperti i vault, e chi li chiude.
//!
//! `Host` è ciò che prima si chiamava `AppState` e viveva nella colla Tauri.
//! La differenza non è il nome: è che le tre cose che rendevano quel tipo
//! inutilizzabile fuori dall'app — il montaggio cablato dentro un comando, il
//! watcher costruito sul posto e il ponte eventi che parlava a un webview —
//! adesso sono [`mount`](crate::mount), un [`WatcherFactory`] e un
//! [`EventSink`]. Chi non ha un webview passa un `NoWatcher` e nessun sink, e
//! ottiene lo stesso vault.
//!
//! **Le sessioni sono una mappa** (§9.6,
//! [decisione 0029](../../../docs/decisions/0029-chiudere-un-vault-e-chiuderli-tutti.md)).
//! Erano una `Option<VaultSession>` e aprire un vault chiudeva quello aperto:
//! il vault "corrente" non era una comodità della shell, era un'assunzione del
//! backend, e ogni cosa che avrà due vault davanti — una finestra per vault
//! (4.1), un confronto, un import da un vault all'altro (17), la CLI che ne
//! interroga uno mentre l'app ne tiene un altro — sarebbe passata da qui a
//! riscriverlo. Adesso `Host` tiene `root → VaultSession` e sa qual è il
//! corrente; chi non nomina un vault ottiene il corrente, che è ciò che la shell
//! fa oggi.
//!
//! Ne segue una cosa che prima costava un rimontaggio: **riaprire un vault già
//! aperto non lo riapre**. Prima la sessione vecchia veniva buttata e rifatta —
//! con la scansione, il lock di tantivy da riprendere e il rischio, se
//! l'apertura nuova falliva, di restare senza niente.
//!
//! **Due lock, e fanno due mestieri diversi.** Lo slot delle sessioni è un
//! `Mutex` e lo si tiene per il tempo di un `get` o di un `clone`; il
//! workspace è un [`RwLock`] e lo si tiene per il tempo di una lettura o di una
//! scrittura vera. Il secondo è il §8.3
//! ([decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md)),
//! e chi prende quale prestito **non è una convenzione**: da un
//! `RwLockReadGuard` non si chiama `write_document`, perché il `Workspace`
//! prende `&mut self` per scrivere e `&self` per leggere. Il compilatore fa la
//! classificazione, e i presidi in `tests/concorrenza.rs` guardano l'unico
//! errore che gli resta possibile — prendere il prestito esclusivo per una
//! lettura, che compila e rimette tutti in fila in silenzio.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, RwLock};

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::model::DocId;
use fubmd_abi::{Notice, PluginError};
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
    /// La radice, **canonica**: è la chiave con cui questa sessione si trova, e
    /// due nomi diversi dello stesso vault non devono essere due sessioni — la
    /// seconda troverebbe il lock dell'indice della prima.
    root: Utf8PathBuf,
    /// Il workspace, dietro il lock che distingue chi legge da chi scrive.
    ///
    /// Era un `Mutex`, ed è la §8.3. Il cambio non ha voluto niente — il
    /// `Workspace` era già `Sync`, perché i trait di provider dell'ABI sono
    /// `Send + Sync` — e ha comprato due cose, di cui la seconda non era
    /// prevista: N view che si ridisegnano insieme (da 7 a 25 volte più
    /// veloci), e soprattutto **chi salva che non viene più affamato**. Sotto
    /// il `Mutex` i lettori in ciclo stretto scavalcavano chi aspettava di
    /// scrivere, senza nessun limite: 6,4 secondi di attesa misurati per un
    /// salvataggio, contro 0,12 ms adesso. Il banco è `examples/contesa.rs`.
    workspace: Arc<RwLock<Workspace>>,
    /// Copia dello store delle versioni, se il versioning è acceso. L'altra
    /// vive dentro l'handler registrato nel workspace: il kernel non sa che il
    /// versioning esiste, ed è l'host a comporre le due metà.
    versions: Option<VersionStore>,
    /// Va tenuto in vita, e **lasciato andare per primo**: quando smette di
    /// guardare, il vault non cambia più da sotto a chi lo sta chiudendo.
    watcher: Box<dyn VaultWatcher>,
}

impl VaultSession {
    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    pub fn workspace(&self) -> &Arc<RwLock<Workspace>> {
        &self.workspace
    }

    pub fn versions(&self) -> Option<&VersionStore> {
        self.versions.as_ref()
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? (§9.7)
    pub fn is_watching(&self) -> bool {
        self.watcher.is_watching()
    }

    /// Chiude la sessione: **prima smette di guardare**, poi chiude il vault.
    ///
    /// L'ordine è il punto. Il watcher entra nel workspace da un thread suo:
    /// lasciarlo vivo durante la chiusura vorrebbe dire poter ricevere una
    /// sincronizzazione e un `flush_indexes` *dopo* che gli indici sono stati
    /// chiusi — cioè scrivere in un vault che si sta chiudendo, che è la
    /// versione a due thread del problema che questa funzione risolve.
    ///
    /// Gli errori tornano a chi chiude: la chiusura non si interrompe per uno di
    /// loro ([`Workspace::close`]), e chi ha un canale per dirli li mostra.
    pub fn close(self) -> Vec<PluginError> {
        let VaultSession {
            workspace, watcher, ..
        } = self;
        drop(watcher);
        let mut ws = workspace.write().expect("workspace avvelenato");
        ws.close()
    }
}

/// I vault aperti, e quale è quello corrente.
#[derive(Default)]
struct Sessions {
    open: BTreeMap<Utf8PathBuf, VaultSession>,
    /// Il vault "corrente" è **della shell**: serve a chi non ne nomina uno, e
    /// non è un'assunzione del backend. Chi chiude il corrente ne lascia un
    /// altro corrente se ce n'è, e nessuno se non ce n'è.
    current: Option<Utf8PathBuf>,
}

/// Chi monta FubMD e tiene aperti i vault.
pub struct Host {
    sessions: Mutex<Sessions>,
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
            sessions: Mutex::new(Sessions::default()),
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

    /// Apre un vault — monta, scansiona, accende il ponte, avvia il rilevatore —
    /// e lo rende **corrente**.
    ///
    /// Un vault **già aperto** non si riapre: diventa corrente e basta. Prima
    /// riaprirlo voleva dire buttare la sessione e rifarla, con la scansione da
    /// ripagare e il lock dell'indice da riprendere — e se la seconda apertura
    /// falliva non si tornava alla prima. Succedeva riaprendo lo stesso vault
    /// dal dialogo, e in sviluppo a ogni ricarica della pagina.
    pub fn open(&self, root: &Utf8Path) -> Result<VaultInfo, String> {
        if !root.is_dir() {
            return Err(format!("Non è una cartella valida: {root}"));
        }
        let root = canonical(root)?;

        {
            let mut sessions = self.sessions.lock().unwrap();
            if let Some(session) = sessions.open.get(&root) {
                let info = info_of(session);
                sessions.current = Some(root);
                return Ok(info);
            }
        }

        let crate::mount::Mounted {
            workspace: mut ws,
            versions,
        } = mount(&root)?;

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

        let workspace = Arc::new(RwLock::new(ws));
        // La bandiera del rilevamento è **del kernel** e la tiene chi guarda
        // (§9.7): così `Host::is_watching` e `IndexQuery::VaultStatus`
        // rispondono dallo stesso bit, e non da due idee di com'è andata.
        let watching = workspace.read().expect("workspace avvelenato").watch_flag();
        let watcher = self.watcher.start(&root, workspace.clone(), watching)?;

        let session = VaultSession {
            root: root.clone(),
            workspace,
            versions,
            watcher,
        };
        let info = info_of(&session);

        let mut sessions = self.sessions.lock().unwrap();
        sessions.open.insert(root.clone(), session);
        sessions.current = Some(root);
        Ok(info)
    }

    /// Chiude **un** vault: flush, `close` degli indici, disattivazione di ogni
    /// plugin (§9.5). Un vault che non è aperto è un errore, non un no-op: chi
    /// chiude nomina qualcosa che crede aperto.
    ///
    /// Se era il corrente, corrente diventa un altro dei vault aperti — o
    /// nessuno, se non ne restano.
    pub fn close_vault(&self, root: &Utf8Path) -> Result<Vec<PluginError>, String> {
        let root = canonical(root)?;
        let session = {
            let mut sessions = self.sessions.lock().unwrap();
            let Some(session) = sessions.open.remove(&root) else {
                return Err(format!("Nessun vault aperto su {root}."));
            };
            if sessions.current.as_ref() == Some(&root) {
                sessions.current = sessions.open.keys().next().cloned();
            }
            session
        };
        // Fuori dal lock delle sessioni: chiudere chiama i provider, e un
        // provider che chiedesse un altro vault si troverebbe davanti sé stesso.
        Ok(session.close())
    }

    /// Chiude **tutti** i vault aperti: è ciò che fa chi spegne l'app.
    ///
    /// «Chiuderne uno» e «chiuderli tutti» sono lo stesso codice, ed è la
    /// ragione per cui il §9.5 e il §9.6 sono stati decisi insieme.
    ///
    /// Fra vault diversi **non c'è un ordine che conti**: due vault non si
    /// conoscono, non condividono provider e non condividono spazio dati.
    /// L'ordine che conta è dentro ciascuno — l'inverso della dichiarazione dei
    /// suoi plugin — e lo tiene [`Workspace::close`].
    pub fn close(&self) -> Vec<PluginError> {
        let sessions = {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.current = None;
            std::mem::take(&mut sessions.open)
        };
        sessions
            .into_values()
            .flat_map(VaultSession::close)
            .collect()
    }

    /// I vault aperti, in ordine di path.
    pub fn vaults(&self) -> Vec<Utf8PathBuf> {
        self.sessions.lock().unwrap().open.keys().cloned().collect()
    }

    /// Il vault corrente, se ce n'è uno.
    pub fn current(&self) -> Option<Utf8PathBuf> {
        self.sessions.lock().unwrap().current.clone()
    }

    /// Rende corrente un vault già aperto.
    pub fn set_current(&self, root: &Utf8Path) -> Result<(), String> {
        let root = canonical(root)?;
        let mut sessions = self.sessions.lock().unwrap();
        if !sessions.open.contains_key(&root) {
            return Err(format!("Nessun vault aperto su {root}."));
        }
        sessions.current = Some(root);
        Ok(())
    }

    /// Fa qualcosa con una sessione: quella nominata, o la corrente se `vault` è
    /// `None`.
    ///
    /// È il punto unico in cui «quale vault» si risolve, ed è per questo che
    /// nessun chiamante deve saperlo: la shell passa ciò che ha (spesso niente),
    /// e chi ne ha due passa quale.
    pub fn with_session<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&VaultSession) -> R,
    ) -> Result<R, String> {
        let sessions = self.sessions.lock().unwrap();
        let key = match vault {
            Some(path) => canonical(Utf8Path::new(path))?,
            None => sessions
                .current
                .clone()
                .ok_or_else(|| "Nessun vault aperto.".to_string())?,
        };
        let session = sessions
            .open
            .get(&key)
            .ok_or_else(|| format!("Nessun vault aperto su {key}."))?;
        Ok(f(session))
    }

    /// Un handle clonato al workspace di un vault (o del corrente), o l'errore
    /// se non è aperto.
    pub fn workspace(&self, vault: Option<&str>) -> Result<Arc<RwLock<Workspace>>, String> {
        self.with_session(vault, |s| s.workspace.clone())
    }

    /// La radice del vault (o del corrente).
    pub fn root(&self, vault: Option<&str>) -> Result<Utf8PathBuf, String> {
        self.with_session(vault, |s| s.root.clone())
    }

    /// Questo vault ha il rilevamento delle modifiche esterne? `false` anche
    /// quando non è aperto (§9.7).
    pub fn is_watching(&self, vault: Option<&str>) -> bool {
        self.with_session(vault, VaultSession::is_watching)
            .unwrap_or(false)
    }

    // --- versioning --------------------------------------------------------
    //
    // Il kernel non sa che il versioning esiste: le versioni le tiene un
    // `EventHandler`, e il ripristino è una scrittura normale (D8). L'host
    // compone le due metà, che è esattamente ciò che dovrà fare per un plugin
    // di terzi.

    /// Lo store delle versioni di un vault, o l'errore se il versioning è
    /// spento: un chiamante che risponde "vuoto" quando la feature non c'è
    /// racconterebbe che non ci sono versioni, che è un'altra cosa.
    pub fn versions(&self, vault: Option<&str>) -> Result<VersionStore, String> {
        self.with_session(vault, |s| s.versions.clone())?
            .ok_or_else(|| "Versioning disattivato.".to_string())
    }

    pub fn list_versions(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<Vec<VersionRef>, String> {
        Ok(self.versions(vault)?.list(id))
    }

    /// Rileggere una versione passa dall'`HostApi` come tutto il resto: l'host
    /// presta al versioning le sue stesse capacità (`Workspace::with_host`), non
    /// una scorciatoia sul filesystem.
    pub fn read_version(&self, vault: Option<&str>, id: &DocId, ts: u64) -> Result<String, String> {
        let store = self.versions(vault)?;
        let ws = self.workspace(vault)?;
        let mut ws = ws.write().unwrap();
        ws.with_host(VERSIONING_ID, |host| store.read(id, ts, host))
            .map_err(|e| e.to_string())
    }

    /// Ripristina una versione riscrivendo il documento (D8): passa da parse,
    /// grafo, indici ed eventi come ogni altra modifica — e siccome passa dagli
    /// eventi, genera a sua volta uno snapshot. Il ripristino è annullabile.
    pub fn restore_version(&self, vault: Option<&str>, id: &DocId, ts: u64) -> Result<(), String> {
        let source = self.read_version(vault, id, ts)?;
        let ws = self.workspace(vault)?;
        let mut ws = ws.write().unwrap();
        ws.write_document(id, &source).map_err(|e| e.to_string())
    }

    // --- organizzazione del vault ------------------------------------------

    pub fn read_meta(&self, vault: Option<&str>) -> Result<WorkspaceMeta, String> {
        read_workspace_meta(&self.root(vault)?)
    }

    pub fn write_meta(&self, vault: Option<&str>, meta: &WorkspaceMeta) -> Result<(), String> {
        write_workspace_meta(&self.root(vault)?, meta)
    }
}

/// Ciò che la shell sa di un vault appena aperto.
fn info_of(session: &VaultSession) -> VaultInfo {
    let ws = session.workspace.read().expect("workspace avvelenato");
    VaultInfo {
        root: ws.root().to_string(),
        documents: ws.documents().into_iter().map(|d| d.0).collect(),
        extensions: ws.extensions(),
        plugins: ws.plugins(),
    }
}

/// La forma **canonica** di una radice: è la chiave delle sessioni.
///
/// Senza, `/vault` e `/vault/` — o un link simbolico e la sua destinazione —
/// sarebbero due sessioni sullo stesso vault, e la seconda si fermerebbe sul
/// lock che l'indice della prima tiene sulla propria cartella. Un path che non
/// si canonicalizza (non esiste, o non è leggibile) è un errore qui, dove si può
/// ancora dire quale.
fn canonical(root: &Utf8Path) -> Result<Utf8PathBuf, String> {
    let canonical = root
        .canonicalize()
        .map_err(|e| format!("non riesco a risolvere {root}: {e}"))?;
    Utf8PathBuf::from_path_buf(canonical).map_err(|p| format!("path non UTF-8: {}", p.display()))
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
