// Il banco vive con la sua feature (§16.3): senza `stats` il modulo non è
// compilato, e un test che lo nomina non avrebbe un soggetto.
#![cfg(feature = "stats")]
//! **Il pannello statistiche dichiara di seguire tutto il contesto, e usa tutto
//! il contesto** — e per ridisegnarsi lo chiede una volta sola.
//!
//! Una riga d'audit diceva che `StatsView` «dichiara `ContextMask::all()` e
//! rilegge il documento intero a ogni movimento del cursore». La seconda metà è
//! vera e non è riparabile da qui: la catena è cursore → rimbalzo di 150 ms di
//! `scheduleContext` → `set_active_context` → `stale-views` → `render_view`, e
//! l'unico segnale di invalidazione che il contratto offre a una view,
//! `document_revision`, è `Revision::of(&read_source(id))` — cioè **la stessa
//! lettura** che si vorrebbe evitare. Una cache qui non si sa scrivere senza
//! aggiungere al contratto, e aggiungere al contratto non è una riparazione di
//! prestazioni.
//!
//! La prima metà, invece, è **falsa**, e questo banco è la ragione per cui non
//! tornerà a sembrare vera: `ContextKind` ha esattamente tre casi e il pannello
//! li usa tutti e tre. Il `match` esaustivo qui sotto è ciò che lo tiene onesto
//! il giorno in cui i casi diventano quattro: non compila più finché qualcuno
//! non risponde alla domanda «e questo, il pannello lo usa?».
//!
//! # La lettura di troppo che la riga non nominava
//!
//! Contando, `render_view` chiedeva il contesto **due volte** — una per
//! ricavarne il documento, una per la selezione e la modalità — sotto un
//! commento che dichiarava il contrario. Non era gratis: `active_context()`
//! **clona** il `ViewContext`, cioè anche il testo di ogni selezione. Su una
//! nota da 42 KB con otto cursori da 2400 caratteri, un render costava 38
//! allocazioni e 82 250 byte; con una lettura sola ne costa **27 e 62 759** —
//! un quarto buttato, su un pannello che si ridisegna a ogni movimento del
//! cursore. La lettura del documento (una, 42 000 byte) non cambia: è l'altra
//! metà della riga, quella che resta aperta.
//!
//! # Cos'è rosso
//!
//! `il_render__and__a_fotografia_sola` conta le chiamate ad `active_context` — il
//! contatore è di [`MemoryHost`], accanto a quello delle letture del vault, e
//! nasce qui perché una copia buttata non lascia nessun'altra traccia: lo stato
//! dopo è identico allo stato prima. *Provato in rosso* rimettendo la forma
//! vecchia: 2 letture del contesto contro 1.
//!
//! `segue_esattamente_i_tre_pezzi__of_contesto_che_usa` è rosso in tutti e due i
//! versi: se il pannello dichiarasse meno di quel che usa (una parte cambia il
//! disegno ma non è nella maschera) e se dichiarasse più di quel che usa (una
//! parte è nella maschera e cambiarla non cambia niente, cioè il pannello si
//! fa svegliare per nulla).

use fub_abi::session::{ContextKind, PaneMode, SelectionSet, ViewContext};
use fub_abi::traits::{ViewInstance, ViewProvider};
use fub_abi::ui::{UiKind, UiNode};
use fub_features::{StatsView, STATS_VIEW};
use fub_sdk::testing::MemoryHost;

const NOTE_DOC: &str = "nota.md";
const OTHER: &str = "altra.md";

/// Il pannello disegnato, ridotto alle stringhe che l'utente legge: è
/// l'osservabile, ed è ciò rispetto a cui «cambia il render» vuol dire qualcosa.
fn texts(tree: &UiNode) -> Vec<String> {
    let UiKind::Stack { children, .. } = &tree.kind else {
        panic!("il pannello è uno stack")
    };
    children
        .iter()
        .filter_map(|c| match &c.kind {
            UiKind::Text { content } => Some(content.to_string()),
            _ => None,
        })
        .collect()
}

fn host() -> MemoryHost {
    MemoryHost::new()
        .with_document(NOTE_DOC, "una nota di prova con sei parole in tutto\n")
        .with_document(OTHER, "due\n")
}

fn draws(host: &MemoryHost) -> Vec<String> {
    let tree = StatsView
        .render_view(&ViewInstance::only(STATS_VIEW), host)
        .expect("il pannello disegna");
    texts(&tree)
}

/// **Una lettura del contesto per render.** Non è un dettaglio di spesa: è la
/// ragione per cui ciò che il pannello mostra è coerente. Con due letture il
/// documento veniva dalla prima e la selezione dalla seconda, e niente nel tipo
/// diceva che fossero lo stesso contesto — fra le due la shell può avere
/// pubblicato un altro pane.
#[test]
fn the_render__and__a_snapshot_single() {
    let host = host();
    host.set_active(Some(NOTE_DOC));
    host.set_selections(&[(0, "una nota")]);

    let before = host.reads_from_context();
    let (reads_first, _) = host.reads_on(NOTE_DOC);
    let _ = draws(&host);

    assert_eq!(
        host.reads_from_context() - before,
        1,
        "un render deve chiedere il contesto una volta sola: `active_context` \
         clona il contesto, testo delle selezioni compreso — vedi il § in testa"
    );
    let (reads_after, _) = host.reads_on(NOTE_DOC);
    assert_eq!(
        reads_after - reads_first,
        1,
        "e deve aprire il documento una volta sola"
    );
}

/// **La maschera dichiarata è esattamente ciò che il disegno usa.**
///
/// Il `match` è esaustivo apposta: `ContextKind` ha tre casi oggi, e se ne
/// arriva un quarto questo banco smette di compilare finché qualcuno non dice
/// se il pannello lo usa. È la forma che un `for` su una lista scritta a mano
/// non avrebbe.
#[test]
fn follows_exactly_the_three_context_pieces_it_uses() {
    let mask = StatsView.interests(&ViewInstance::only(STATS_VIEW)).follows;

    for kind in [
        ContextKind::Document,
        ContextKind::Selection,
        ContextKind::Mode,
    ] {
        let host = host();
        // Il contesto di partenza, uguale per tutti e tre i giri.
        host.set_context(Some(
            ViewContext::new("main")
                .with_doc(Some(fub_abi::model::DocId::new(NOTE_DOC)))
                .with_selections(Some(SelectionSet::caret(0))),
        ));
        let before = draws(&host);

        // Cambia **solo** quel pezzo di contesto.
        match kind {
            ContextKind::Document => host.set_active(Some(OTHER)),
            ContextKind::Selection => host.set_selections(&[(0, "una nota")]),
            ContextKind::Mode => host.set_mode(PaneMode::Reading),
        }
        let after = draws(&host);

        assert_eq!(
            mask.contains(kind),
            before != after,
            "il pannello dichiara {kind:?} nella sua `follows`? {}. Cambiare \
             {kind:?} cambia ciò che disegna? {}. Le due risposte devono \
             coincidere: dichiararne di meno vuol dire mostrare un conto \
             vecchio, dichiararne di più vuol dire farsi svegliare per nulla — \
             prima {before:?}, dopo {after:?}",
            mask.contains(kind),
            before != after,
        );
    }
}
