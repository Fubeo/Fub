//! Il tetto ai nodi dell'export: un disegno che lo supera si rifiuta con un
//! errore tipizzato, uno che ci sta si esporta intero.

use fub_scene::export::{self, Background, DeriveError, Scope, Source};
use fub_scene::{ReadError, MAX_EXPORT_NODES};

/// Un SVG di `nodes` nodi: la radice e `nodes - 1` gruppi vuoti, senza
/// spazi fra loro, che sarebbero nodi di testo.
fn drawing(nodes: usize) -> String {
    let open = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">"#;
    let mut text = String::with_capacity(open.len() + nodes * 4 + 6);
    text.push_str(open);
    for _ in 1..nodes {
        text.push_str("<g/>");
    }
    text.push_str("</svg>");
    text
}

#[test]
fn un_disegno_al_tetto_dei_nodi_si_esporta_intero() {
    let text = drawing(MAX_EXPORT_NODES);
    let source = Source::read(&text).expect("al tetto il disegno si legge");
    let derived = source
        .derive(&Scope::Drawing, Background::None)
        .expect("e si esporta");
    assert_eq!(
        derived.matches("<g/>").count(),
        MAX_EXPORT_NODES - 1,
        "l'export non tronca niente"
    );
}

#[test]
fn un_disegno_oltre_il_tetto_dei_nodi_si_rifiuta_con_il_suo_errore() {
    let text = drawing(MAX_EXPORT_NODES + 1);
    let Err(error) = Source::read(&text) else {
        panic!("un nodo di troppo non si legge");
    };
    let ReadError::TooManyNodes { offset } = error else {
        panic!("il rifiuto dice perché: {error:?}");
    };
    assert_eq!(&text[offset..offset + 4], "<g/>", "{offset}");
    assert_eq!(
        text.len() - offset,
        "<g/></svg>".len(),
        "il primo di troppo è l'ultimo gruppo"
    );

    let refused = export::derive(&text, &Scope::Drawing, Background::None).unwrap_err();
    assert!(matches!(
        refused,
        DeriveError::Read(ReadError::TooManyNodes { .. })
    ));
    assert_eq!(refused.kind(), "too-many-nodes");
}

#[test]
fn la_lettura_dell_editor_non_ha_il_tetto_dell_export() {
    // L'editor legge fino a `MAX_EDIT_BYTES` e giudica da sé gli elementi:
    // il tetto dell'export non gli cambia niente.
    let text = drawing(MAX_EXPORT_NODES + 1);
    assert!(text.len() <= fub_scene::MAX_EDIT_BYTES);
    let scene = fub_scene::read(&text).expect("l'editor la legge");
    assert!(!scene.editable(), "in sola lettura, per i troppi elementi");
}
