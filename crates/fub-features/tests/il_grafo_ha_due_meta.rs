// Senza la cargo feature `graph` (§16.3) questo banco non ha soggetto.
#![cfg(feature = "graph")]
//! **Il grafo è un componente diviso in due, e i due nomi che lo tengono insieme
//! non possono divergere in silenzio** (§3.3, decisione 0079).
//!
//! Il provider (`src/graph.rs`) manda i suoi dati dentro un
//! `UiKind::Custom { ns }`, e la shell li disegna perché riconosce quel `ns`. La
//! tab che lo ospita, dal canto suo, nomina la view per l'id della sua
//! `ViewSpec`. Sono due stringhe, scritte in due linguaggi, in due file che non
//! si compilano insieme: se una cambia e l'altra no, non diventa rosso niente —
//! il grafo si apre, e dentro c'è il **fallback**. Cioè il modo di rompersi che
//! il degrado garbato del contratto rende invisibile, proprio perché funziona.
//!
//! È lo stesso genere di presidio dei mirror TS↔Rust (`ts_mirror.rs`), su un
//! oggetto più piccolo: là si confronta la *forma* dei tipi, qui due *nomi*. E
//! come là, il verso è quello che conta: chi rinomina di qua trova subito il
//! posto di là a cui deve mettere mano.
//!
//! Non presidia che il renderer **funzioni** — quello si vede aprendolo, e non è
//! una cosa che un test di questo crate possa dire di una simulazione su canvas.
//! Presidia che i due capi si stiano parlando.

use fub_features::graph::{GRAPH_NS, GRAPH_VIEW};

/// La metà shell del componente.
fn meta_shell() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/panels/graph.ts"
    );
    std::fs::read_to_string(path)
        .expect("la metà shell del grafo sta in frontend/src/panels/graph.ts")
}

/// Il `ns` con cui il provider manda i dati è quello che la shell registra.
#[test]
fn i_due_capi_si_accordano_sul_namespace() {
    let shell = meta_shell();
    assert!(
        shell.contains(&format!("\"{GRAPH_NS}\"")),
        "la shell non registra un renderer per «{GRAPH_NS}»: il grafo mostrerebbe \
         il fallback senza che nulla lo dica"
    );
}

/// L'id della view che il provider dichiara è quello che il comando apre.
#[test]
fn i_due_capi_si_accordano_sull_id_della_view() {
    let shell = meta_shell();
    assert!(
        shell.contains(&format!("\"{GRAPH_VIEW}\"")),
        "la shell apre una tab su una view che non è «{GRAPH_VIEW}»: il riquadro \
         resterebbe vuoto"
    );
}

/// E il `ns` è **dichiarato una volta sola** di qua: due letterali uguali in due
/// punti del provider sarebbero lo stesso difetto un piano più giù.
#[test]
fn il_namespace_non_e_scritto_due_volte_nel_provider() {
    let provider = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/graph.rs"))
        .expect("il provider del grafo");
    // Una volta nella costante, e le altre occorrenze sono prosa fra apici
    // tipografici o dentro un `assert`: il letterale fra virgolette dritte è uno.
    let letterali = provider.matches(&format!("\"{GRAPH_NS}\"")).count();
    assert_eq!(
        letterali, 1,
        "«{GRAPH_NS}» è scritto {letterali} volte: la costante GRAPH_NS esiste per \
         essere l'unica"
    );
}
