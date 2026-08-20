//! Il banco di prova regge, contro il kernel vero.
//!
//! Questo file è la **misura** del §16.2, e va letto contandogli le righe: da
//! qui alla prima asserzione ce ne sono quattro, e la mediana degli altri
//! trentadue file di `kernel/tests/` è centotrentacinque. È anche l'unico modo
//! onesto di chiudere quella voce — un banco che nessuno ha ancora usato per
//! scrivere qualcosa di nuovo è una promessa, non un guadagno.
//!
//! E prova qualcosa di suo: se `fub-testkit` mentisse, mentirebbero in blocco
//! tutti i test che ci si appoggiano, e lo farebbero **passando**. Un banco
//! condiviso è codice di produzione dei test, e va provato come tale.

use fub_abi::edit::WriteBase;
use fub_abi::event::EventKind;
use fub_testkit::{doc, Bench, SampleExtractor};

#[test]
fn the_bench_registers_the_format_on_the_requested_extension() {
    // È l'asse su cui le nove `PlainProvider` differivano davvero — sei su
    // `txt`, tre su `md` — e quindi l'asse che il banco non può sbagliare: chi
    // chiede `txt` e ottiene `md` scrive un test che prova il vuoto.
    let bench = Bench::new()
        .with_extension("txt")
        .with_file("nota.txt", "body")
        .with_file("altra.md", "body")
        .mounts();

    assert!(
        bench.format_of(&doc("nota.txt")).is_some(),
        "the bench registered the format on `txt`: a `.txt` must be its own"
    );
    assert!(
        bench.format_of(&doc("altra.md")).is_none(),
        "and nobody registered `md`: a `.md` belongs to nobody.\n\
         If this fails, `with_extension` does not route where it says, and every test\n\
         using it is proving nothing without realizing it."
    );
}

#[test]
fn two_formats_on_two_extensions_coexist() {
    let bench = Bench::new()
        .with_extension("txt")
        .with_format(SampleExtractor::by_extension("log").boxed())
        .mounts();

    assert!(bench.format_of(&doc("a.txt")).is_some());
    assert!(bench.format_of(&doc("b.log")).is_some());
}

#[test]
fn the_spy_sees_what_the_kernel_emits_not_what_happened_during_mount() {
    let mut bench = Bench::new().with_spy().with_plugin("test.app").mounts();

    // Il registro parte vuoto: la semina e la scansione iniziale non sono ciò
    // che il test guarda.
    assert_eq!(bench.events(), vec![]);

    bench.with_host("test.app", |host| {
        host.write_document(&doc("nuova.md"), "body", WriteBase::Dictated)
            .expect("write allowed");
    });

    assert!(
        bench.event_kinds().contains(&EventKind::DocumentChanged),
        "writing a document emits a `DocumentChanged`; seen: {:?}",
        bench.event_kinds()
    );
}

#[test]
fn an_undeclared_id_receives_no_capabilities() {
    // Il §7.3 al banco: `con_plugin` non è un abbellimento, è la differenza fra
    // un host che concede e uno che nega tutto. Dimenticarlo è il modo più
    // frequente di far fallire un test per il motivo sbagliato, e il banco lo
    // rende una riga invece di una scoperta.
    let mut bench = Bench::new().mounts();

    let result = bench.with_host("never.declared", |host| {
        host.write_document(&doc("x.md"), "y", WriteBase::Dictated)
    });
    assert!(
        result.is_err(),
        "an id that nobody declared receives a host that denies everything"
    );
}
