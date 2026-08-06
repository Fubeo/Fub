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
//! [0131](../../../docs/decisions/0131-tre-stati-e-la-firma-che-ne-diceva-due.md).
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
use fub_testkit::{doc, Banco, TestoDiProva};

/// La mappa che un provider scrive quando vuole dire tre cose diverse: questa
/// la so fare, questa la so fare **con questo dettaglio**, questa la conosco e
/// **qui non la faccio**.
fn sintassi_di_prova() -> OptionMap {
    OptionMap::new()
        .on(syntax::TAGS)
        .with(syntax::CALLOUTS, serde_json::json!(["note"]))
        .with(syntax::WIKILINKS, false)
}

fn banco() -> fub_testkit::Montato {
    Banco::nuovo()
        .senza_formato()
        .con_formato(
            TestoDiProva::per_estensione("txt")
                .con_sintassi(sintassi_di_prova())
                .boxed(),
        )
        .monta()
}

/// **Le due domande hanno lo stesso soggetto.**
///
/// Non si confrontano contro un elenco scritto a mano — sarebbe un terzo elenco
/// da tenere allineato, cioè il difetto un gradino più su — ma **l'una contro
/// l'altra**: qualunque sintassi che una delle due nomina e l'altra no è la
/// divergenza, quale che sia il nome.
#[test]
fn le_forme_dichiarate_sono_le_capacita_effettive() {
    let banco = banco();
    let id = doc("nota.txt");

    let capacita = banco.format_of(&id).expect("il formato è registrato");
    let nominate: Vec<&str> = capacita
        .capabilities
        .syntax
        .active()
        .map(|(k, _)| k)
        .collect();
    let forme: Vec<String> = banco
        .syntax_forms(&id)
        .into_iter()
        .map(|f| f.name)
        .collect();

    assert_eq!(
        forme, nominate,
        "`syntax_forms` e `format_of` nominano insiemi diversi di sintassi: \
         una superficie di scrittura decorerebbe una sintassi che il parse non \
         legge, o viceversa"
    );
}

/// **Una sintassi dichiarata e spenta non si disegna**, ed è il caso concreto
/// su cui la divergenza si vedeva.
///
/// `.with(nome, false)` è l'unico modo che un provider ha di dire «questa la
/// conosco e qui non la faccio» — spegnerla togliendola direbbe «non so cosa
/// sia» — e la regola di `OptionMap` è che spenta è spenta: chi legge per agire
/// non deve vederla.
#[test]
fn una_sintassi_spenta_dal_provider_non_arriva_a_chi_disegna() {
    let banco = banco();
    let id = doc("nota.txt");

    assert!(
        !banco
            .format_of(&id)
            .expect("il formato è registrato")
            .capabilities
            .supports(syntax::WIKILINKS),
        "un `false` esplicito spegne: è la regola di `OptionMap`"
    );
    let forme: Vec<String> = banco
        .syntax_forms(&id)
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert!(
        !forme.iter().any(|n| n == syntax::WIKILINKS),
        "la sintassi spenta è arrivata a chi disegna: {forme:?}"
    );
    // E le altre due ci sono, o la prova sarebbe soddisfatta da un elenco vuoto.
    assert!(forme.iter().any(|n| n == syntax::TAGS));
    assert!(forme.iter().any(|n| n == syntax::CALLOUTS));
}
