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
fn metadata_shell() -> String {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/panels/graph.ts"
    );
    std::fs::read_to_string(path)
        .expect("la metà shell del grafo sta in frontend/src/panels/graph.ts")
}

/// Il `ns` con cui il provider manda i dati è quello che la shell registra.
#[test]
fn the_two_ends_is_agree_on_the_namespace() {
    let shell = metadata_shell();
    assert!(
        shell.contains(&format!("\"{GRAPH_NS}\"")),
        "la shell non registra un renderer per «{GRAPH_NS}»: il grafo mostrerebbe \
         il fallback senza che nulla lo dica"
    );
}

/// L'id della view che il provider dichiara è quello che il comando apre.
#[test]
fn the_two_ends_is_agree_on_the_id_of_the_view() {
    let shell = metadata_shell();
    assert!(
        shell.contains(&format!("\"{GRAPH_VIEW}\"")),
        "la shell apre una tab su una view che non è «{GRAPH_VIEW}»: il riquadro \
         resterebbe vuoto"
    );
}

/// E il `ns` è **dichiarato una volta sola** di qua: due letterali uguali in due
/// punti del provider sarebbero lo stesso difetto un piano più giù.
#[test]
fn the_namespace_does_not_and_written_two_times_in_the_provider() {
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

/// Il provider del grafo, letto come testo: le costanti di protocollo sono
/// private (`OPEN`, `DOC`, `NODES`, `EDGES`, `FROM`, `TO`), quindi non si
/// importano — si presidia che il letterale esista, come già per `GRAPH_NS`.
fn metadata_provider() -> String {
    std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/graph.rs"))
        .expect("il provider del grafo")
}

/// L'azione del click e la chiave del suo payload sono le due stringhe più
/// sensibili del contratto: un click che non apre la nota giusta è un fallimento
/// silenzioso. Sono letterali **quotati** da entrambi i lati — la shell ha
/// `const APRI = "open"` e `const DOC = "doc"`, il provider ha le gemelle —
/// quindi il presidio è lo stesso del `ns`: il letterale fra virgolette dritte.
#[test]
fn the_keys_of_the_action_is_agree_between_the_two_ends() {
    let shell = metadata_shell();
    let provider = metadata_provider();
    for letterale in ["open", "doc"] {
        let quoted = format!("\"{letterale}\"");
        assert!(
            shell.contains(&quoted),
            "la shell non dichiara il letterale «{letterale}»: il click del grafo \
             non parlerebbe la stessa lingua del provider"
        );
        assert!(
            provider.contains(&quoted),
            "il provider non dichiara il letterale «{letterale}»: la shell leggerebbe \
             una chiave che nessuno manda"
        );
    }
}

/// Le quattro chiavi del payload (`nodes`, `edges`, `from`, `to`) non sono
/// stringhe nella shell ma nomi di campo digitati: la shell legge `o.nodes`,
/// `o.edges`, `e.from`, `e.to`. Il provider invece le scrive come letterali
/// quotati (`const NODES: &str = "nodes"`). Il presidio è asimmetrico di
/// proposito: da un lato il letterale del protocollo, dall'altro l'accesso che
/// lo consuma — se uno dei due cambia e l'altro no, il grafo si disegna vuoto o
/// legge `undefined`, e questo test lo dice.
#[test]
fn the_keys_of_the_payload_is_agree_between_the_two_ends() {
    let shell = metadata_shell();
    let provider = metadata_provider();
    // (letterale nel provider, accesso nella shell)
    for (letterale, accesso) in [
        ("nodes", "o.nodes"),
        ("edges", "o.edges"),
        ("from", "e.from"),
        ("to", "e.to"),
    ] {
        assert!(
            provider.contains(&format!("\"{letterale}\"")),
            "il provider non dichiara la chiave «{letterale}»: la shell non \
             riceverebbe quel campo"
        );
        assert!(
            shell.contains(accesso),
            "la shell non legge «{accesso}»: il campo «{letterale}» che il provider \
             manda resterebbe non letto"
        );
    }
}
