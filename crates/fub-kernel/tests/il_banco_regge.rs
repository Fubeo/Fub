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

use fub_abi::event::EventKind;
use fub_testkit::{doc, Banco, TestoDiProva};

#[test]
fn il_banco_registra_il_formato_sull_estensione_che_gli_si_chiede() {
    // È l'asse su cui le nove `PlainProvider` differivano davvero — sei su
    // `txt`, tre su `md` — e quindi l'asse che il banco non può sbagliare: chi
    // chiede `txt` e ottiene `md` scrive un test che prova il vuoto.
    let banco = Banco::nuovo()
        .con_estensione("txt")
        .con_file("nota.txt", "corpo")
        .con_file("altra.md", "corpo")
        .monta();

    assert!(
        banco.format_of(&doc("nota.txt")).is_some(),
        "il banco ha registrato il formato su `txt`: un `.txt` dev'essere suo"
    );
    assert!(
        banco.format_of(&doc("altra.md")).is_none(),
        "e nessuno ha registrato `md`: un `.md` non è di nessuno.\n\
         Se questa cade, `con_estensione` non instrada dove dice, e ogni test\n\
         che la usa sta provando il vuoto senza accorgersene."
    );
}

#[test]
fn due_formati_su_due_estensioni_convivono() {
    let banco = Banco::nuovo()
        .con_estensione("txt")
        .con_formato(TestoDiProva::per_estensione("log").boxed())
        .monta();

    assert!(banco.format_of(&doc("a.txt")).is_some());
    assert!(banco.format_of(&doc("b.log")).is_some());
}

#[test]
fn la_spia_vede_cio_che_il_kernel_emette_e_non_cio_che_e_successo_montando() {
    let mut banco = Banco::nuovo().con_spia().con_plugin("prova").monta();

    // Il registro parte vuoto: la semina e la scansione iniziale non sono ciò
    // che il test guarda.
    assert_eq!(banco.eventi(), vec![]);

    banco.with_host("prova", |host| {
        host.write_document(&doc("nuova.md"), "corpo", None)
            .expect("scrittura consentita");
    });

    assert!(
        banco.tipi_eventi().contains(&EventKind::DocumentChanged),
        "scrivere un documento emette un `DocumentChanged`; visti: {:?}",
        banco.tipi_eventi()
    );
}

#[test]
fn un_id_non_dichiarato_non_riceve_capacita() {
    // Il §7.3 al banco: `con_plugin` non è un abbellimento, è la differenza fra
    // un host che concede e uno che nega tutto. Dimenticarlo è il modo più
    // frequente di far fallire un test per il motivo sbagliato, e il banco lo
    // rende una riga invece di una scoperta.
    let mut banco = Banco::nuovo().monta();

    let esito = banco.with_host("mai.dichiarato", |host| {
        host.write_document(&doc("x.md"), "y", None)
    });
    assert!(
        esito.is_err(),
        "un id che nessuno ha dichiarato riceve un host che nega tutto"
    );
}
