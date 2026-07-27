//! I record che l'host consegna a chi lo ha montato.
//!
//! Non sono tipi «dell'app»: erano tali finché l'unico chiamante era un comando
//! Tauri, ma un'API locale (27.2) risponderebbe con gli stessi tre e una CLI
//! (27.1) stamperebbe i primi due. Restano rispecchiati in
//! `frontend/src/host/contract.ts`, e il legame è la fixture di
//! `crates/fubmd-app/tests/ts_mirror_app.rs`: il mirror sta dal lato dell'app
//! perché è l'app a farli attraversare l'IPC, e `fubmd-app` li ri-esporta.

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_kernel::{PluginInfo, RenderedDocument};
use serde::{Deserialize, Serialize};

/// Rispecchiato da `VaultInfo` in `frontend/src/host/contract.ts`; il legame è la
/// fixture di `crates/fubmd-app/tests/ts_mirror_app.rs`.
#[derive(Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub documents: Vec<String>,
    /// Le estensioni che i provider registrati gestiscono (minuscole, senza
    /// punto). Il frontend le usa per ricavare il "nome pagina" di un `DocId`
    /// senza cablare `.md`: quale sia l'estensione di un documento lo sanno i
    /// `FormatDescriptor`, non la UI.
    pub extensions: Vec<String>,
    /// **Chi è attivo** (§7.6): i plugin dichiarati, con manifest, fiducia,
    /// permessi e ciò che hanno registrato.
    ///
    /// Era un booleano — `versioning: bool` — cioè un campo **per feature**
    /// dentro un record IPC: con i moduli del 21.2 sarebbero diventati venti
    /// booleani, e ognuno una modifica al record, al mirror TS e alla fixture.
    /// La shell adesso non chiede «il versioning è acceso?»: chiede chi c'è, e
    /// guarda se fra loro c'è chi le serve. È la stessa domanda che il pannello
    /// plugin (20.1), il developer mode (20.2) e la diagnostica (24.2) faranno,
    /// e nessuno dei tre avrà bisogno di un campo suo.
    pub plugins: Vec<PluginInfo>,
}

/// Rispecchiato da `EmbedContent` in `frontend/src/host/contract.ts` (fixture di
/// `crates/fubmd-app/tests/ts_mirror_app.rs`).
///
/// Porta un [`RenderedDocument`] e non una stringa perché un embed passa dai
/// renderer registrati come l'anteprima: un diagramma dentro una nota trasclusa
/// resta un diagramma, e le sue parti dichiarative vanno montate dal frontend
/// dentro il segnaposto che ha appena idratato.
#[derive(Serialize)]
pub struct EmbedContent {
    pub doc_id: String,
    #[serde(flatten)]
    pub content: RenderedDocument,
}

// --- organizzazione del vault ----------------------------------------------
//
// Icone, note appuntate, ordinamenti scelti a mano e spazio attivo vivono nel
// sidecar `.fubmd/workspace.json`, dentro il vault: le note restano markdown
// puro e l'organizzazione viaggia col vault (sync, git). A differenza di
// `.fubmd-data` questi dati sono autorevoli, non derivati: persi, non si
// ricostruiscono. Il kernel non ne sa nulla — `.fubmd` è un dot-dir, quindi
// scansione, watcher e indice lo ignorano già.
//
// Sta nell'host e non nella colla Tauri perché è **stato del vault**, non del
// webview: chiunque apra il vault lo legge, e il §11.3 lo assorbirà nel kernel.

/// Metadati di organizzazione del vault (rispecchiato da `WorkspaceMeta` in
/// `frontend/src/host/contract.ts`). Le chiavi sono path relativi al vault: `DocId` per
/// le note, path di cartella senza slash finale per le cartelle (`""` è la
/// radice).
#[derive(Default, Serialize, Deserialize)]
pub struct WorkspaceMeta {
    /// path → emoji mostrata accanto al nome.
    #[serde(default)]
    pub icons: std::collections::BTreeMap<String, String>,
    /// Note appuntate in cima alla sidebar, nell'ordine scelto.
    #[serde(default)]
    pub pinned: Vec<String>,
    /// cartella → nomi dei figli nell'ordine scelto a mano; chi non compare
    /// segue in ordine alfabetico.
    #[serde(default)]
    pub order: std::collections::BTreeMap<String, Vec<String>>,
    /// Cartelle registrate come "spazi": la striscia di icone in cima alla
    /// sidebar, nell'ordine in cui appaiono. QUALE spazio è selezionato è
    /// stato di vista, per-macchina: sta al frontend, non qui.
    #[serde(default)]
    pub spaces: Vec<String>,
}

/// Dove sta il sidecar, data la radice del vault.
pub fn workspace_meta_path(root: &Utf8Path) -> Utf8PathBuf {
    root.join(".fubmd").join("workspace.json")
}

/// File assente = vault mai personalizzato: si risponde col default, non con
/// un errore. Un file presente ma malformato invece È un errore: sovrascriverlo
/// in silenzio con il default butterebbe via l'organizzazione dell'utente.
pub fn read_workspace_meta(root: &Utf8Path) -> Result<WorkspaceMeta, String> {
    let path = workspace_meta_path(root);
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|e| format!("{path} non è un workspace.json valido: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(WorkspaceMeta::default()),
        Err(e) => Err(format!("non riesco a leggere {path}: {e}")),
    }
}

pub fn write_workspace_meta(root: &Utf8Path, meta: &WorkspaceMeta) -> Result<(), String> {
    let path = workspace_meta_path(root);
    let dir = path
        .parent()
        .expect("il sidecar sta sempre in una cartella");
    std::fs::create_dir_all(dir).map_err(|e| format!("non riesco a creare {dir}: {e}"))?;
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("non riesco a scrivere {path}: {e}"))
}
