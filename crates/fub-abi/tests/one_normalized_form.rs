//! **L'identità di un nome non dipende dalla codifica con cui è scritto**
//! (difetto 0140).
//!
//! `é` si scrive in due modi — `U+00E9`, oppure `e` seguito da `U+0301` — e i
//! due sono byte diversi. Nessun utente li ha scelti: un vault sincronizzato
//! con macOS ha i nomi in NFD, ciò che si digita su Linux o Windows è NFC, e un
//! copia-incolla porta dentro quella che c'era. Quindi ogni regola che risponde
//! a «questi due nomi sono lo stesso nome» deve rispondere **sì**, e nei due
//! versi — chi cerca in NFC dentro il NFD e chi cerca in NFD dentro il NFC.
//!
//! [`resolution_key`] lo faceva da sempre e le altre quattro no, ognuna con la
//! sua conseguenza: un tag contato due volte con lo stesso nome sullo schermo,
//! un `[[Nota#^ancora]]` che non aggancia, un `id=` HTML in cui l'accento non
//! divergeva ma **spariva** (una `Mn` non è alfanumerica, quindi il filtro di
//! `heading_slug` la buttava via), e una ricerca che non trova la parola che si
//! vede nella nota.
//!
//! # Perché un banco solo per cinque funzioni
//!
//! Perché la frase che chiudono è una. Le cinque restano **cinque regole** — la
//! decisione 0136 ha stabilito che devono essere più d'una e che ognuna
//! dichiara perché diverge — ma divergono su *cosa* confrontano, non su come
//! sono scritti i caratteri che confrontano: quello è
//! `rules::composition::composed`, e chi la chiama non deve ripensarci. Il
//! sesto chiamante la eredita chiamandola, e
//! `una_regola_di_nome_si_dichiara.rs` lo vede — `composed(` è un gesto NFC per
//! quel conto, quindi una regola nuova che non compone si legge dalla sua
//! famiglia.
//!
//! # Cosa **non** sta qui, e dove sta
//!
//! `prefix_len_ci` è la quinta di questa famiglia ed è privata del kernel,
//! perché produce offset dentro il sorgente e non una chiave. La sua coppia
//! NFC/NFD sta accanto a lei, in `crates/fub-kernel/src/occurrences.rs`
//! (`la_codifica_di_un_accento_non_nasconde_una_parola`): un banco di `fub-abi`
//! non la può chiamare, e renderla pubblica per provarla vorrebbe dire
//! allargare una superficie per la comodità di un test.

use fub_abi::model::{
    canonical_anchor, canonical_tag, heading_matches, heading_slug, Heading, Span,
};
use fub_abi::rules::composition::composed;
use fub_abi::rules::path::{exact_key, resolution_key};

/// Le coppie con cui si prova: la stessa parola, scritta nei due modi.
///
/// Non sono varianti inventate: `Café` è il caso che i verbali già citano,
/// `caffè` è la parola italiana più probabile in un vault, e `Ångström` porta
/// una lettera che in NFD si decompone in tre code point e in NFC in uno.
/// **Le cinque regole rispondono sulla stessa forma.**
fn pairs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Café", "Cafe\u{301}"),
        ("caffè", "caffe\u{300}"),
        ("Ångström", "A\u{30a}ngstro\u{308}m"),
    ]
}

#[test]
fn the_two_spellings_are_different_bytes_or_this_bench_proves_nothing() {
    for (nfc, nfd) in pairs() {
        assert_eq!(
            nfc, nfd,
            "`{nfc}` and its decomposed form are the same byte sequence: the pair does not \
             mette alla prova nessuna regola"
        );
        assert_eq!(
            composed(nfd),
            nfc,
            "the composed form of `{nfd}` is not `{nfc}`"
        );
    }
}

///
/// Una per riga e non una funzione sola con un ciclo, perché ciò che si vuole
/// leggere quando una diventa rossa è **quale** ha smesso di comporre.
/// **E la forma composta è quella che vince**, non una terza.
#[test]
fn a_name_key_does_not_change_with_encoding() {
    for (nfc, nfd) in pairs() {
        assert_eq!(
            resolution_key(nfc),
            resolution_key(nfd),
            "`resolution_key` distingue le due scritture di `{nfc}`"
        );
        assert_eq!(
            exact_key(nfc),
            exact_key(nfd),
            "`exact_key` distingue le due scritture di `{nfc}`"
        );
        assert_eq!(
            canonical_tag(nfc),
            canonical_tag(nfd),
            "`canonical_tag` conta due tag dove l'utente ne vede uno: `{nfc}`"
        );
        assert_eq!(
            canonical_anchor(nfc),
            canonical_anchor(nfd),
            "`canonical_anchor` non aggancia l'ancora `{nfc}` scritta nell'altra forma"
        );
        assert_eq!(
            heading_slug(nfc),
            heading_slug(nfd),
            "`heading_slug` dà due id allo stesso titolo `{nfc}`"
        );
    }
}

///
/// Senza questa riga il banco sopra passerebbe anche con cinque regole che
/// decompongono tutte allo stesso modo — la stessa risposta, ma su una chiave
/// che nessun altro pezzo del sistema scrive. La forma è quella di
/// `resolution_key`, che è l'origine dichiarata (decisione 0136).
/// **L'accento non spariva soltanto: cambiava parola.**
#[test]
fn the_form_on_which_is_judges_and_that_composed() {
    assert_eq!(canonical_tag("Cafe\u{301}"), "café");
    assert_eq!(canonical_anchor("  Cafe\u{301} "), "café");
    assert_eq!(heading_slug("Cafe\u{301} Nero"), "café-nero");
    assert_eq!(exact_key("  Cafe\u{301}  "), "Café");
}

///
/// È la metà del difetto che non si vedeva confrontando due chiavi fra loro —
/// `heading_slug` su NFD dava `cafe`, che è un'altra parola e per giunta una
/// che qualcun altro può aver scritto davvero. Due titoli diversi finivano con
/// lo stesso `id=` HTML, e il primo si prendeva l'ancora del secondo.
/// **La gemella che legge trova il titolo nei due versi, e su tutti e due i
#[test]
fn two_titles_different_not_end_on_the_same_id() {
    assert_eq!(
        heading_slug("Cafe\u{301}"),
        heading_slug("Cafe"),
        "`Café` e `Cafe` sono due titoli, e due titoli non condividono un id"
    );
    assert_eq!(heading_slug("Cafe"), "cafe");
}

/// rami.**
///
/// [`heading_matches`] è una disgiunzione: lo slug **oppure** la chiave di
/// risoluzione del testo. Il secondo ramo la NFC la faceva già, e questo è il
/// motivo per cui il difetto non si vedeva come link rotto — copriva il primo.
/// Qui si prova il ramo dello slug **da solo**, con un titolo che il secondo
/// ramo non aggancia perché il testo non è quello cercato.
    // `Café Nero` cercato come slug (`café-nero`) non è il testo del titolo:
#[test]
fn the_slug_branch_hooks_too() {
    let heading = |text: &str| Heading {
        level: 2,
        text: text.to_string(),
        slug: heading_slug(text),
        span: Span::EMPTY,
        explicit_anchor: None,
    };
    // il ramo di `resolution_key` dice no, e a rispondere resta solo lo slug.
    // il ramo di `resolution_key` dice no, e a rispondere resta solo lo slug.
    let nfd = heading("Cafe\u{301} Nero");
    assert_eq!(
        resolution_key("café-nero"),
        resolution_key(&nfd.text),
        "the second branch must not be able to respond, or the first is not tested"
    );
    assert!(
        heading_matches("café-nero", &nfd),
        "lo slug composto non aggancia il titolo scritto in NFD"
    );

    let nfc = heading("Café Nero");
    assert!(
        heading_matches("cafe\u{301}-nero", &nfc),
        "lo slug scritto in NFD non aggancia il titolo composto"
    );
}
