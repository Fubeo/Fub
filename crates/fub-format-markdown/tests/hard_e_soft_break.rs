//! **Hard e soft break restano due nodi distinti, dal parse alla resa.**
//!
//! Il difetto ([`todo.md`] voce MEDIUM) era in `convert_inlines`:
//! `NodeValue::SoftBreak` e `NodeValue::LineBreak` producevano lo **stesso**
//! `Inline::Text(" ")`. Il hard break spariva — un documento che in Obsidian
//! si legge su due righe ne tornava una — e al giro dopo i due `Text`
//! adiacenti diventavano un nodo solo: la forma del modello cambiava fra
//! round 1 e round 2, cioè un documento riscritto due volte non era più
//! fermo.
//!
//! Il modello adesso ha due varianti proprie, `Inline::HardBreak` (a-capo
//! duro: `  ` o `\` a fine riga) e `Inline::SoftBreak` (a-capo morbido), e
//! questo banco presidia il patto end-to-end: il parser le distingue, il
//! serializer le riscrive ciascuna nella sua forma (il duro canonico a due
//! spazi, il morbido col solo a-capo), e il render mantiene la semantica
//! (`<br />` contro spazio). Niente di qui gira: è il banco mirato che il
//! coordinatore eseguirà con la validazione.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{Block, DocumentModel, Inline};
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("il caso è markdown, e il markdown parsa")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("il modello si serializza")
}

fn inlines(doc: &DocumentModel) -> &[Inline] {
    match &doc.body[0] {
        Block::Paragraph { inlines, .. } => inlines,
        _ => panic!("atteso un paragrafo come primo blocco"),
    }
}

/// **Il parser distingue i due ingressi.** Lo stesso testo con un a-capo
/// semplice produce un `SoftBreak`; con due spazi o una barra rovescia
/// produce un `HardBreak` — e i due nodi non sono intercambiabili.
#[test]
fn il_parser_distingue_il_duro_dal_morbido() {
    let morbido = parse("una riga\nseconda riga\n");
    assert_eq!(
        inlines(&morbido),
        &[
            Inline::Text("una riga".into()),
            Inline::SoftBreak,
            Inline::Text("seconda riga".into()),
        ],
        "l'a-capo semplice non è un salto di riga nella resa"
    );

    let duro_a_due_spazi = parse("una riga  \nseconda riga\n");
    assert_eq!(
        inlines(&duro_a_due_spazi),
        &[
            Inline::Text("una riga".into()),
            Inline::HardBreak,
            Inline::Text("seconda riga".into()),
        ],
        "due spazi a fine riga sono un a-capo duro"
    );

    let duro_a_barra = parse("una riga\\\nseconda riga\n");
    assert_eq!(
        inlines(&duro_a_barra),
        &[
            Inline::Text("una riga".into()),
            Inline::HardBreak,
            Inline::Text("seconda riga".into()),
        ],
        "la barra rovescia a fine riga è l'altra forma del duro"
    );
}

/// **Il serializer non li collassa.** Riscritto, il morbido torna col solo
/// a-capo e il duro (in entrambe le sue forme di partenza) torna nella forma
/// canonica a due spazi — e il secondo giro è fermo, che è la proprietà che
/// il vecchio `Text(" ")` violava.
#[test]
fn il_serializer_li_riscrive_ciascuno_nella_sua_forma() {
    for (nome, sorgente, atteso) in [
        (
            "morbido",
            "una riga\nseconda riga\n",
            "una riga\nseconda riga\n",
        ),
        (
            "duro a due spazi",
            "una riga  \nseconda riga\n",
            "una riga  \nseconda riga\n",
        ),
        (
            "duro a barra rovescia",
            "una riga\\\nseconda riga\n",
            "una riga  \nseconda riga\n",
        ),
    ] {
        let uno = serialize(&parse(sorgente));
        assert_eq!(
            uno, atteso,
            "«{nome}»: il giro ha scritto il file diverso dalla forma che gli\n\
             spetta — il duro va nella forma a due spazi, il morbido resta col\n\
             solo a-capo.\n  sorgente:  {sorgente:?}\n  riscritto: {uno:?}"
        );
        let due = serialize(&parse(&uno));
        assert_eq!(
            due, uno,
            "«{nome}»: la seconda riscrittura non coincide con la prima: il\n\
             documento si muove a ogni salvataggio.\n  primo giro:  {uno:?}\n  \
             secondo giro: {due:?}"
        );
    }
}

/// **La forma del modello non cambia fra un giro e l'altro.** È il sintomo
/// che il `Text(" ")` produceva: al giro dopo i due `Text` adiacenti
/// diventavano un nodo solo. Adesso i due modelli hanno gli stessi inline.
#[test]
fn la_forma_del_modello_non_cambia_fra_un_giro_e_l_altro() {
    for (nome, sorgente) in [
        ("morbido", "una riga\nseconda riga\n"),
        ("duro a due spazi", "una riga  \nseconda riga\n"),
        ("duro a barra rovescia", "una riga\\\nseconda riga\n"),
    ] {
        let uno = parse(sorgente);
        let due = parse(&serialize(&uno));
        assert_eq!(
            inlines(&uno),
            inlines(&due),
            "«{nome}»: il giro ha cambiato la forma degli inline del paragrafo"
        );
    }
}

/// **Il render mantiene la semantica.** Il duro cambia riga davvero
/// (`<br />`); il morbido resta uno spazio, che è ciò che un a-capo singolo
/// significa in markdown.
#[test]
fn il_render_mantiene_la_semantica() {
    let html = |src: &str| {
        MarkdownProvider::new()
            .render_html(&parse(src), &Default::default())
            .expect("la resa riesce")
    };

    let morbido = html("una riga\nseconda riga\n");
    assert!(
        !morbido.contains("<br"),
        "un a-capo morbido non è un salto di riga: {morbido}"
    );
    assert!(
        morbido.contains("una riga seconda riga"),
        "il morbido si legge come uno spazio: {morbido}"
    );

    let duro = html("una riga  \nseconda riga\n");
    assert!(
        duro.contains("una riga<br />seconda riga"),
        "il duro deve cambiare riga: {duro}"
    );

    let duro_a_barra = html("una riga\\\nseconda riga\n");
    assert!(
        duro_a_barra.contains("una riga<br />seconda riga"),
        "anche la barra rovescia è un duro: {duro_a_barra}"
    );
}
