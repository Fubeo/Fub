//! Tipi d'errore del contratto. Tutti serializzabili così da poter
//! attraversare il confine WASM (M5) e l'IPC verso il frontend.

use serde::{Deserialize, Serialize};

/// Errore prodotto da un `FormatProvider`.
#[derive(Clone, Debug, PartialEq, thiserror::Error, Serialize, Deserialize)]
pub enum FormatError {
    #[error("parse fallito: {0}")]
    Parse(String),
    #[error("render fallito: {0}")]
    Render(String),
    #[error("serialize fallito: {0}")]
    Serialize(String),
    #[error("formato non supportato: {0}")]
    Unsupported(String),
}

/// Errore prodotto da un plugin (nativo o WASM).
#[derive(Clone, Debug, PartialEq, thiserror::Error, Serialize, Deserialize)]
pub enum PluginError {
    #[error("comando sconosciuto: {0}")]
    UnknownCommand(String),
    #[error("view sconosciuta: {0}")]
    UnknownView(String),
    #[error("job sconosciuto: {0}")]
    UnknownJob(String),
    #[error("argomenti non validi: {0}")]
    BadArgs(String),
    #[error("permesso negato: {0}")]
    PermissionDenied(String),
    #[error("errore interno del plugin: {0}")]
    Internal(String),
    /// Il sorgente su cui l'operazione era stata calcolata non è più quello
    /// (vedi [`EditRequest::base`](crate::edit::EditRequest::base)).
    ///
    /// È un caso a sé e non un [`BadArgs`](PluginError::BadArgs) perché è
    /// l'unico errore del confine che **non è una colpa di chi chiama**: gli
    /// argomenti erano giusti quando li ha calcolati, e la risposta giusta è
    /// ricalcolare, non correggere. Chi non li distingue riprova all'infinito
    /// una richiesta malformata, o rinuncia a una che sarebbe riuscita.
    #[error("il documento è cambiato nel frattempo: {0}")]
    Conflict(String),
    /// **Nessuno serve questa domanda**: nessun indice registrato ha dichiarato
    /// la rotta che servirebbe (vedi [`QueryRoute`](crate::traits::QueryRoute)).
    ///
    /// È un caso a sé, e distinguerlo è metà del valore del routing dichiarato:
    /// prima «nessuno la serve» e «chi la serve ha fallito» arrivavano al
    /// chiamante nella stessa forma — un `BadArgs`, per giunta quello
    /// dell'ultimo interpellato — e chi disegna non poteva sapere se mostrare
    /// «installa un indice» o «qualcosa è andato storto».
    #[error("nessun indice serve questa domanda: {0}")]
    Unserved(String),
}
