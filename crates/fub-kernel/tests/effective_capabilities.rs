//! **Cosa il kernel dice di saper fare su un documento, e chi glielo chiede.**
//!
//! Ci sono due accessori che rispondono alla stessa domanda con due parole
//! diverse: [`Workspace::format_of`] dice *che sintassi capirebbe* e
//! [`Workspace::syntax_forms`] dice *a cosa somigliano quelle sintassi*. Sono
//! due domande apposta — la seconda serve alla superficie di scrittura, che non
//! ha il provider — ma poggiano sulla **stessa** `OptionMap`, e finché una
//! iterava e l'altra chiedeva `enabled` c'era una risposta su cui divergevano:
//! una voce dichiarata e messa a `false`.
//!
//! Nessun provider di questo repo la scrive, il che è precisamente il motivo per
//! cui la divergenza poteva restare lì per sempre: la si vede solo costruendo il
//! caso, ed è quello che fa questo file. Il verbale è la
//! [0131](../../../docs/decisions/0192-impostazioni-locale-e-temi.md).
//!
//! # Perché la prova sta qui e non sul mirror
//!
//! `crates/fub-host/tests/sintassi_dichiarata.rs` emette la dichiarazione da un
//! montaggio **vero**, e un montaggio vero registra i provider di questo repo:
//! non ha un posto in cui infilare un provider che spegne una sintassi, e
//! dargliene uno vorrebbe dire far dipendere un file committato da un caso di
//! prova. Là si prova che ciò che il montaggio dichiara è ciò che la shell legge;
//! qui si prova che le due domande hanno **lo stesso soggetto**.

use fub_abi::options::syntax;
use fub_abi::OptionMap;
use fub_testkit::{doc, Bench, SampleText};

/// La mappa che un provider scrive quando vuole dire tre cose diverse: questa
/// la so fare, questa la so fare **con questo dettaglio**, questa la conosco e
/// **qui non la faccio**.
fn test_syntax() -> OptionMap {
    OptionMap::new()
        .on(syntax::TAGS)
        .with(syntax::CALLOUTS, serde_json::json!(["note"]))
        .with(syntax::WIKILINKS, false)
}

fn bench() -> fub_testkit::Mounted {
    Bench::new()
        .without_format()
        .with_format(
            SampleText::by_extension("txt")
                .with_syntax(test_syntax())
                .boxed(),
        )
        .mounts()
}

/// **Le due domande hanno lo stesso soggetto.**
///
/// Non si confrontano contro un elenco scritto a mano — sarebbe un terzo elenco
/// da tenere allineato, cioè il difetto un gradino più su — ma **l'una contro
/// l'altra**: qualunque sintassi che una delle due nomina e l'altra no è la
/// divergenza, quale che sia il nome.
#[test]
fn the_declared_forms_are_the_effective_capabilities() {
    let bench = bench();
    let id = doc("nota.txt");

    let caps = bench.format_of(&id).expect("the format is registered");
    let named: Vec<&str> = caps.capabilities.syntax.active().map(|(k, _)| k).collect();
    let forms: Vec<String> = bench
        .syntax_forms(&id)
        .into_iter()
        .map(|f| f.name)
        .collect();

    assert_eq!(
        forms, named,
        "`syntax_forms` and `format_of` name different sets of syntax: \
         an editor surface would decorate a syntax the parse does not \
         read, or vice versa"
    );
}

/// **Una sintassi dichiarata e spenta non si disegna**, ed è il caso concreto
/// su cui la divergenza si vedeva.
///
/// `.with(name, false)` è l'unico modo che un provider ha di dire «questa la
/// conosco e qui non la faccio» — spegnerla togliendola direbbe «non so cosa
/// sia» — e la regola di `OptionMap` è che spenta è spenta: chi legge per agire
/// non deve vederla.
#[test]
fn a_syntax_turned_off_by_the_provider_does_not_reach_the_drawer() {
    let bench = bench();
    let id = doc("nota.txt");

    assert!(
        !bench
            .format_of(&id)
            .expect("the format is registered")
            .capabilities
            .supports(syntax::WIKILINKS),
        "an explicit `false` turns off: that is the rule of `OptionMap`"
    );
    let forms: Vec<String> = bench
        .syntax_forms(&id)
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert!(
        !forms.iter().any(|n| n == syntax::WIKILINKS),
        "the turned-off syntax reached the drawer: {forms:?}"
    );
    // E le altre due ci sono, o la prova sarebbe soddisfatta da un elenco vuoto.
    assert!(forms.iter().any(|n| n == syntax::TAGS));
    assert!(forms.iter().any(|n| n == syntax::CALLOUTS));
}
