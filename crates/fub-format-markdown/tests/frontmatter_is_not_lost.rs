//! **Un frontmatter non sparisce: né quando non si sa leggere, né quando non si
//! sa scrivere.**
//!
//! Il difetto era uno solo — *il frontmatter si perde in silenzio* — ma aveva
//! due metà con gravità diversa, e i presidi sono due perché le due metà si
//! rompono in modi diversi.
//!
//! # La metà che si può misurare: il giro completo
//!
//! Un frontmatter con una virgola sbagliata cadeva in `Frontmatter::default()`
//! dentro un `_ =>`. Da lì in poi era **indistinguibile da un frontmatter
//! assente**, e il primo salvataggio che passasse dal modello lo cancellava dal
//! disco. La forma del presidio è il giro completo — sorgente → modello →
//! sorgente — perché è l'unica in cui la perdita si vede: guardare il solo
//! modello direbbe «frontmatter vuoto», che è esattamente la bugia.
//!
//! # La metà che non si può misurare, e perché il presidio è di forma
//!
//! L'altra metà era `if let Ok(yaml) = serde_yaml_ng::to_string(...)`: quando
//! la scrittura in YAML fallisce, il blocco intero veniva **saltato** e la
//! funzione tornava una sorgente valida e amputata.
//!
//! Quel fallimento è stato **cercato, non assunto**: `to_string` su una
//! `serde_json::Map` non fallisce — [`la_forma_del_frontmatter_non_fa_fallire_lo_yaml`]
//! lo misura su tutto ciò che dentro un frontmatter ci può stare, caratteri di
//! controllo e chiavi ostili compresi. Non esiste quindi un input che renda
//! rossa una prova di comportamento, e fingere il contrario vorrebbe dire
//! scrivere un test verde in tutti e due i mondi.
//!
//! Ciò che resta misurabile è **la forma della funzione**, ed è ciò che
//! [`il_serializer_non_ingoia_i_propri_fallimenti`] guarda: una `serialize` che
//! torna `String` non ha nessun posto dove mettere un fallimento, quindi lo
//! ingoierà — se non questo, il prossimo. È la stessa specie di garanzia di
//! `crates/fub-abi/tests/serialize_non_riscrive.rs`, e per la stessa ragione:
//! intercetta il **gesto**, non l'occorrenza.

use fub_abi::format::{FormatProvider, ParseContext};
use fub_abi::model::{custom_kind, Block, DocumentModel};
use fub_format_markdown::MarkdownProvider;

fn parse(src: &str) -> DocumentModel {
    MarkdownProvider::new()
        .parse(&src.into(), &ParseContext::obsidian("nota.md"))
        .expect("markdown parses")
}

fn serialize(model: &DocumentModel) -> String {
    MarkdownProvider::new()
        .serialize(model)
        .expect("the model serializes")
}

/// I frontmatter che **non** si proiettano su una mappa JSON, e il perché.
const ILLEGGIBILI: &[(&str, &str)] = &[
    ("comma", "---\ntags: [a, b\n---\n\nCorpo della nota.\n"),
    ("colon", "---\ntitolo: a: b\n---\n\nCorpo della nota.\n"),
    (
        "tabulazione",
        "---\ntags:\n\t- a\n---\n\nCorpo della nota.\n",
    ),
    (
        "non è una mappa",
        "---\nsolo del testo\n---\n\nCorpo della nota.\n",
    ),
    ("è un elenco", "---\n- a\n- b\n---\n\nCorpo della nota.\n"),
];

/// **Il presidio della prima metà.** Sorgente → modello → sorgente: i due
/// sorgenti devono contenere lo stesso frontmatter.
#[test]
fn unreadable_frontmatter_survives_the_full_round_trip() {
    for (case, source) in ILLEGGIBILI {
        let model = parse(source);
        let rewritten = serialize(&model);

        assert_eq!(
            &rewritten.as_str(),
            source,
            "«{case}»: il giro completo ha riscritto il documento senza il suo\n\
             frontmatter. Il parser non l'ha capito, e questo è un fatto; averlo\n\
             cancellato dal disco è una decisione, e non l'ha presa nessuno.",
        );

        // E il giro è **stabile**: rileggere ciò che si è scritto non aggiunge
        // né toglie niente, altrimenti la perdita sarebbe solo più lenta.
        assert_eq!(
            serialize(&parse(&rewritten)),
            rewritten,
            "«{case}»: il secondo giro non coincide col primo.",
        );
    }
}

/// Il testo conservato è **verbatim**, e porta con sé il motivo per cui non si
/// è potuto leggere: senza il motivo resta una perdita muta, solo rimandata.
#[test]
fn the_preserved_block_states_what_it_preserves_and_why() {
    for (case, source) in ILLEGGIBILI {
        let model = parse(source);

        let Some(Block::Custom {
            custom_kind: kind,
            attrs,
            span,
            ..
        }) = model.body.first()
        else {
            panic!("«{case}»: il frontmatter illeggibile non è nel modello");
        };
        assert_eq!(kind, custom_kind::FRONTMATTER_UNPARSED, "«{case}»");

        let text = attrs
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert!(
            source.starts_with(text),
            "«{case}»: il testo conservato non è quello del file:\n{text:?}",
        );
        // Lo span nomina il pezzo di sorgente che il blocco rivendica: è la
        // promessa che ogni blocco del modello fa, e vale anche per questo.
        assert_eq!(
            source[span.start..span.end].trim_end(),
            text.trim_end(),
            "«{case}»: lo span non nomina il frontmatter",
        );

        let reason = attrs
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        assert!(
            !reason.trim().is_empty(),
            "«{case}»: nessun motivo: l'utente vedrebbe le proprietà svanire\n\
             senza un avviso, che è metà del difetto.",
        );

        // E si vede: il degrado generico di un blocco senza figli sarebbe un
        // `<div>` vuoto, cioè di nuovo niente.
        let html = MarkdownProvider::new()
            .render_html(&model, &Default::default())
            .expect("la resa riesce");
        assert!(
            html.contains("block-frontmatter-unparsed") && html.contains("<pre>"),
            "«{case}»: il frontmatter illeggibile non compare nell'anteprima:\n{html}",
        );
    }
}

/// Un frontmatter **leggibile** resta quello di prima: il ramo nuovo non si
/// prende ciò che non è suo.
#[test]
fn readable_frontmatter_is_not_routed_through_the_new_path() {
    let model = parse("---\ntitolo: Nota\ntags:\n  - a\n---\n\nCorpo.\n");
    assert_eq!(
        model.frontmatter.get("titolo").and_then(|v| v.as_str()),
        Some("Nota")
    );
    assert!(
        !model.body.iter().any(|b| matches!(
            b,
            Block::Custom { custom_kind, .. } if custom_kind == custom_kind::FRONTMATTER_UNPARSED
        )),
        "un frontmatter letto non lascia dietro di sé un blocco verbatim"
    );
    assert!(serialize(&model).starts_with("---\ntitolo: Nota\n"));
}

/// **Il presidio della seconda metà.** `serialize` deve avere un posto dove
/// mettere un fallimento, e non deve avere posti dove nasconderlo.
///
/// Legge il proprio sorgente come testo: è la maglia che questo repo sa già
/// tessere (`serialize_non_riscrive.rs`), e la sola disponibile per una
/// riparazione che nessun input sa rendere rossa.
#[test]
fn the_serializer_does_not_swallownits_own_failures() {
    const SOURCE: &str = include_str!("../src/serialize.rs");

    assert!(
        SOURCE.contains("pub fn serialize(model: &DocumentModel) -> Result<String, FormatError>"),
        "`serialize` non torna un `Result`: una funzione che non può fallire\n\
         davanti a qualcosa che non sa scrivere può solo **saltarlo**, ed è\n\
         esattamente il difetto che questo file presidia.",
    );

    // Le forme con cui un fallimento si perde per strada. Non sono tutte le
    // forme possibili — nessuna lettura testuale lo è — ma sono quelle con cui
    // il difetto era stato scritto la prima volta. I commenti non contano: è lì
    // che si spiega perché quelle forme non ci sono.
    for form in ["if let Ok(", "let Ok(", ".ok()", ".unwrap_or_default()"] {
        for (n, row) in SOURCE.lines().enumerate() {
            if row.trim_start().starts_with("//") {
                continue;
            }
            assert!(
                !row.contains(form),
                "src/serialize.rs:{}: `{form}` scarta un fallimento invece di\n\
                 farlo risalire. Il documento uscirebbe valido e amputato, che è\n\
                 la forma peggiore: chi lo scrive sul disco non ha niente da\n\
                 guardare, e il contenuto è già perso.\n  {row}",
                n + 1,
            );
        }
    }
}

/// **La misura che rende onesto il presidio qui sopra**: il fallimento del
/// frontmatter è irraggiungibile, e non è un'opinione scritta in un commento.
///
/// Se un giorno smettesse di esserlo — una `cargo update`, o un tipo nuovo
/// dentro un `serde_json::Value` — questo test diventa rosso, e la propagazione
/// che oggi è una cintura in più diventa la strada.
#[test]
fn frontmatter_shape_does_not_cause_yaml_failure() {
    let ostili = serde_json::json!({
        "nul": "x\u{0}y",
        "campanello": "x\u{7}y",
        "escape": "x\u{1b}y",
        "cancella": "x\u{7f}y",
        "non stampabile": "x\u{fffe}y\u{ffff}",
        "": "chiave vuota",
        "---": "una chiave che sembra un delimitatore",
        "a capo": "riga1\nriga2\n---\nriga3",
        "annidato": { "a": [1, 2.5, null, true, { "b": "\u{0}" }] },
        "vuoto": null,
    });
    let mut map = ostili.as_object().expect("è un oggetto").clone();
    // E una profondità che nessun frontmatter scritto a mano raggiunge.
    let mut profondo = serde_json::json!("fondo");
    for _ in 0..256 {
        profondo = serde_json::json!([profondo]);
    }
    map.insert("profondo".to_string(), profondo);

    let outcome = serde_yaml_ng::to_string(&map);
    assert!(
        outcome.is_ok(),
        "`serde_yaml_ng::to_string` ha fallito su un frontmatter: il ramo\n\
         d'errore di `serialize` non è più irraggiungibile, e la prima metà di\n\
         questo file va riscritta come prova di comportamento.\n{:?}",
        outcome.err(),
    );
}
