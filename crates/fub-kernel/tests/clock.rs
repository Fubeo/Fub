//! Il kernel legge l'orologio che gli dà chi lo compone.
//!
//! Registro, cestino e job non chiamano l'orologio di sistema: un banco con un
//! [`ManualClock`] decide l'istante, e il vault lo porta nei nomi e nelle righe.

use std::sync::Arc;

use fub_abi::edit::WriteBase;
use fub_testkit::{doc, Bench, ManualClock};

/// 2001-09-09T01:46:40Z, un istante che si riconosce nel nome del cestino.
const INSTANT: u64 = 1_000_000_000_000;

#[test]
fn the_trash_and_the_journal_read_the_clock_they_were_given() {
    let clock = Arc::new(ManualClock::at(INSTANT));
    let mut bench = Bench::new()
        .with_file("Nota.md", "# Nota\n")
        .with_clock(clock.clone())
        .mounts();

    bench
        .delete_document(&doc("Nota.md"))
        .expect("the note goes to the trash");
    // Il secondo omonimo trova il posto preso e prende il timbro dell'istante.
    bench
        .write_document(&doc("Nota.md"), "# Di nuovo\n", WriteBase::Dictated)
        .expect("the name is free again");
    let trashed = bench
        .delete_document(&doc("Nota.md"))
        .expect("the namesake goes to the trash");
    assert!(
        trashed.as_str().contains("2001-09-09T01-46-40"),
        "the trash name carries the injected instant: {trashed}"
    );
    let entry = bench
        .list_trash()
        .expect("the trash lists")
        .into_iter()
        .find(|entry| entry.id == trashed)
        .expect("the trashed note is listed");
    assert_eq!(entry.deleted_at, INSTANT / 1_000, "seconds in the listing");

    let journal = bench.journal().expect("the journal reads");
    let last = journal.records.last().expect("the deletion is recorded");
    assert_eq!(
        last.at, INSTANT,
        "the journal row carries the injected instant"
    );

    clock.advance(60_000);
    assert_eq!(bench.now_unix_millis(), INSTANT + 60_000);
}
