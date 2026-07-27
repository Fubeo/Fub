//! # fubmd-host — chi monta FubMD
//!
//! Il **composition root** e la sessione di un vault aperto, fuori da qualunque
//! host concreto: registro dei formati, dichiarazione delle feature ufficiali,
//! indice di ricerca, versioning, view, comandi, sintassi innestate e renderer
//! si montano qui — non dentro un `#[tauri::command]`.
//!
//! La ragione è il conto del §8.2: quel montaggio ha **cinque clienti
//! previsti** — la CLI (27.1), l'API locale (27.2), l'headless degli e2e (17.2
//! e 27.4), il mobile (26.2) e la PWA (26.3) — e finché stava dentro un comando
//! Tauri nessuno di loro poteva riusarlo. Ognuno avrebbe finito per ricopiarlo,
//! cioè per avere una **propria idea** di quali feature esistono e in che ordine
//! si registrano; e due idee diverse della stessa tabella di montaggio non si
//! accorgono mai di essere diverse, perché nessuna delle due è scritta in un
//! posto dove l'altra la legge.
//!
//! **Invariante:** questo crate non dipende da `tauri`. È il rovescio del §16.3
//! — quello divide le feature, questo separa *chi le monta* da *chi disegna* —
//! ed è presidiata da `crates/fubmd-abi/tests/dependency_invariant.rs`, perché
//! «`fubmd-app` è ridotto a colla Tauri» detto e basta è un'affermazione, non
//! una proprietà.
//!
//! ## Le tre porte verso l'host concreto
//!
//! Ciò che di un'app vera *non* può stare qui non è il montaggio: sono i tre
//! punti in cui il montaggio tocca il mondo, e ognuno ha un trait.
//!
//! - [`WatcherFactory`]/[`VaultWatcher`] — chi vede le scritture altrui. Il
//!   debouncer di `notify` è **un'**implementazione (dietro la cargo feature
//!   `notify-watcher`, accesa di default), [`NoWatcher`] è l'altra.
//! - [`EventSink`] — dove finiscono gli eventi del kernel una volta usciti.
//!   Per l'app è il webview; per una CLI è stdout; per gli e2e è niente.
//! - [`Host::open`] — chi decide *quando* si apre. L'host non apre da sé.
//!
//! ## Le capacità di un lavoro lungo
//!
//! [`JobHost`] è l'`HostApi` che un job riceve (§9.1,
//! [decisione 0027](../../../docs/decisions/0027-il-lavoro-lungo-vede-il-vault.md)),
//! e sta qui per la stessa ragione del `RwLock`: il kernel non sa che esiste un
//! lock, e un host che ne prende uno **per chiamata** può nascere solo dove il
//! lock è di casa.
//!
//! ## Chi possiede i bundle
//!
//! [`BundleRegistry`] è chi monta un plugin coi suoi provider e lo **possiede**
//! finché è vivo (§9.3,
//! [decisione 0031](../../../docs/decisions/0031-chi-possiede-i-bundle.md)). Sta
//! qui e non nel kernel per una ragione sola: l'`HostApi` non ha capacità di
//! registrazione ([decisione 0013](../../../docs/decisions/0013-elenco-delle-capacita.md)),
//! quindi un plugin non può registrarsi da sé — qualcuno che ha un
//! `&mut Workspace` deve leggergli il manifest, dichiararlo, attivarlo e
//! registrare ciò che offre. [`mount`] è la tabella delle otto righe ufficiali,
//! e ogni riga è un [`Bundle`] come lo sarà un plugin di terzi.
//!
//! ## Cosa NON è ancora qui
//!
//! Il §8.2 elencava anche il runner dei job e lo storage del §15.1. Il runner
//! resta del §9.3 — un pool, e la cancellazione che va disegnata **con** lui;
//! [`JobHost`] è ciò che quel pool avrà da passare al job, e
//! [`BundleRegistry::plugin`] è dove troverà il corpo da eseguire.

pub mod jobs;
pub mod mount;
pub mod records;
pub mod registry;
pub mod session;
pub mod settings;
pub mod watcher;

pub use jobs::JobHost;
pub use mount::{mount, Mounted};
pub use records::{EmbedContent, VaultInfo, WorkspaceMeta};
pub use registry::{Bundle, BundleError, BundleRegistry, OnlyProviders};
pub use session::{doc_id, EventSink, Host, VaultSession};
pub use settings::{initial_vault, versioning_enabled};
pub use watcher::{NoWatcher, VaultWatcher, WatcherFactory};

#[cfg(feature = "notify-watcher")]
pub use watcher::NotifyWatcher;
