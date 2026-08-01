//! I record che l'host consegna a chi lo ha montato.
//!
//! Non sono tipi «dell'app»: erano tali finché l'unico chiamante era un comando
//! Tauri, ma un'API locale (27.2) risponderebbe con gli stessi tre e una CLI
//! (27.1) stamperebbe i primi due. Restano rispecchiati in
//! `frontend/src/host/contract.ts`, e il legame è la fixture di
//! `crates/fub-app/tests/ts_mirror_app.rs`: il mirror sta dal lato dell'app
//! perché è l'app a farli attraversare l'IPC, e `fub-app` li ri-esporta.

use fub_abi::error::PluginError;
use fub_kernel::{PluginInfo, RenderedDocument};
use serde::Serialize;

/// Rispecchiato da `VaultInfo` in `frontend/src/host/contract.ts`; il legame è la
/// fixture di `crates/fub-app/tests/ts_mirror_app.rs`.
#[derive(Serialize)]
pub struct VaultInfo {
    pub root: String,
    // `documents` **non c'è più** (§14.4): l'apertura di un vault portava con sé
    // l'elenco intero delle note, cioè diecimila righe per disegnarne venti — e
    // lo portava *dentro un record*, dove una finestra non si può nemmeno
    // chiedere. Chi ne vuole una parte la chiede a `IndexQuery::Entries`, che
    // pagina e sa dire *quale cartella*.
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
    /// **Cosa non si è letto** (§15.7): i documenti che la scansione ha trovato
    /// e di cui non si è potuto vedere il contenuto. Vuoto è il caso normale, e
    /// vuol dire che il vault si è aperto intero.
    ///
    /// Sta qui **oltre** che nella coda eventi, e non al posto suo. Ogni scarto
    /// esce anche come [`Event::Trouble`](fub_abi::event::Event::Trouble) con
    /// il documento per soggetto, che è il canale con cui lo si racconta a chi
    /// ha una superficie; ma quel canale ha un budget e sotto carico può
    /// troncare (§20.5) — e un'apertura di vault *è* il carico. «Questo vault si
    /// è aperto intero» è una proprietà dell'**operazione**, e chi la chiama la
    /// deve poter leggere dal suo esito, non ricostruire da una sequenza di
    /// incidenti che potrebbe non aver ricevuto tutta.
    ///
    /// **Nessuno lo disegna ancora**: la superficie dove la shell direbbe
    /// «questo vault si è aperto a metà» è il §20.4 e non c'è. Il mirror TS ce
    /// l'ha perché la fixture pretende che i due lati combacino, non perché la
    /// UI lo usi.
    pub unread: Vec<UnreadDoc>,
}

/// Un documento che l'apertura non ha potuto guardare, sulla via dell'IPC.
///
/// È [`fub_kernel::Scarto`] con il `DocId` già in stringa, come ogni altro id
/// che attraversa questo confine. Rispecchiato da `UnreadDoc` in
/// `frontend/src/host/contract.ts`.
#[derive(Clone, Serialize)]
pub struct UnreadDoc {
    pub doc_id: String,
    /// Cosa ha risposto il disco, o il parser: lo stesso errore che viaggia
    /// dentro `Event::Trouble`, quindi il lato TS ha già il tipo per leggerlo.
    pub why: PluginError,
}

/// Rispecchiato da `EmbedContent` in `frontend/src/host/contract.ts` (fixture di
/// `crates/fub-app/tests/ts_mirror_app.rs`).
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
