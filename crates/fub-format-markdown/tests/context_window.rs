//! **Il contesto di un blocco lungo è una finestra attorno al link, e quello
//! di un blocco corto è il blocco.**
//!
//! È il banco che **aggancia** la regola di `fub_abi::rules::snippet` al
//! parser: la regola può esistere ed essere perfetta, e il provider può
//! dimenticarsi di chiamarla — e nessun altro banco se ne accorge, perché
//! `the_corpus.rs` verifica solo che il contesto ci sia e non sia vuoto. Qui si
//! asserisce il comportamento osservabile nei due versi:
//!
//! 1. un blocco che supera il tetto produce un contesto **tagliato** — con
//!    l'ellissi — che contiene ancora il link;
//! 2. un blocco che sta nel tetto produce un contesto **uguale** al blocco:
//!    è la compatibilità con ciò che il campo diceva prima della regola, e
//!    l'unico posto in cui l'uguaglianza è lecita (la finestra coincide col
//!    blocco).
//!
//! Il caso 2 è anche ciò che tiene vive le fixture e gli assert storici
//! (`graph.rs` e `lib.rs` asseriscono contesti corti per intero): se la
//! finestra cambiasse forma anche per i blocchi corti, questo banco va rosso.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::DocumentModel;
use fub_format_markdown::MarkdownProvider;

fn parse(source: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&source.into(), &ParseContext::obsidian("finestra/nota.md"))
        .expect("markdown parses")
}

/// Un blocco di prosa che supera il tetto: il link deve restare visibile e
/// l'ellissi deve dire che il contesto è tagliato.
#[test]
fn long_block_context_is_a_window_showing_the_link() {
    let attorno = "parole ".repeat(60); // 420 caratteri
    let src = format!("{attorno}[[Nota]]{attorno}");
    let doc = parse(&src);
    let link = doc.links.iter().find(|the| the.context.is_some()).unwrap();
    let ctx = link.context.as_deref().unwrap();
    assert!(
        ctx.contains('…'),
        "a block beyond the cap must show the ellipsis, not the entire block"
    );
    assert!(
        ctx.contains("Nota"),
        "the window must contain the link it refers to: «{ctx}»"
    );
    assert!(
        ctx.chars().count() <= 222,
        "the window fits within the cap plus two ellipses: «{ctx}»"
    );
}

/// Un blocco che sta nel tetto: il contesto è il blocco, parola per parola —
/// la finestra coincide col blocco e nessuna ellissi deve comparire.
#[test]
fn short_block_context_is_the_block() {
    let doc = parse("Vedi [[Nota]] qui.");
    let ctx = doc.links[0].context.as_deref().unwrap();
    assert_eq!(ctx, "Vedi Nota qui.");
    assert!(!ctx.contains('…'));
}

/// Il ripiego testuale degli embed misura la posizione sul testo decodificato:
/// markup e caratteri multibyte precedenti non possono produrre un indice interno
/// al carattere.
#[test]
fn an_embed_after_multibyte_text_has_valid_context() {
    let source = "A🎉 [[Altra]], ![[Nota]] dopo";
    let doc = parse(source);
    let link = doc.links.iter().find(|link| link.embed).unwrap();
    assert_eq!(link.context.as_deref(), Some("A🎉 Altra, ![[Nota]] dopo"));
}
