// Senza la cargo feature `base` i comandi delle Basi non sono registrati.
#![cfg(feature = "base")]
//! **Il gesto della barra di una Base e il suo «Annulla», come li vede la
//! shell.** `base.view.set` e poi `vault.undo`, dall'host vero: ognuno riscrive
//! il `.base` ed emette il suo `DocumentChanged` **dell'utente, dentro un
//! lotto**. È la forma che la sessione del documento aspetta per ricaricare in
//! silenzio una scrittura annunciata (`expectWrite` in
//! `apps/client/src/state/document-session.ts`): soltanto un evento
//! dell'utente consuma l'annuncio, e uno fuori lotto con un salvataggio in
//! volo è l'eco di quel salvataggio. Un evento con un'altra origine farebbe
//! dire «è cambiato su disco» a ogni gesto.

use std::sync::{Arc, Mutex};

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::{Actor, Event};
use fub_abi::model::DocId;
use fub_abi::Notice;
use fub_host::{Delivery, EventSink, Host};
use serde_json::json;

const BASE_FILE: &str = "Opere.base";
const BEFORE: &str = "views:\n  - name: Tabella   # la vista dei gesti\n    type: table\n    order: [file.name, stato]\n";

#[derive(Default)]
struct Recorder(Mutex<Vec<Notice>>);

impl EventSink for Recorder {
    fn emit(&self, notice: &Notice) -> Delivery {
        self.0.lock().unwrap().push(notice.clone());
        Delivery::Done
    }
}

impl Recorder {
    /// Gli avvisi di un cambio del `.base` arrivati finora, e la lista si vuota.
    fn base_changes(&self) -> Vec<Notice> {
        std::mem::take(&mut *self.0.lock().unwrap())
            .into_iter()
            .filter(|notice| matches!(&notice.event, Event::DocumentChanged { id, .. } if id.as_str() == BASE_FILE))
            .collect()
    }
}

fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_owned()).unwrap();
    std::fs::write(root.join(BASE_FILE), BEFORE).unwrap();
    std::fs::write(
        root.join("Nebbia.md"),
        "---\nstato: Arrivata\n---\n# Nebbia\n",
    )
    .unwrap();
    (dir, root)
}

/// Il cambio del `.base` è uno, dell'utente, in un lotto.
fn one_user_change_in_a_batch(notices: &[Notice], step: &str) {
    assert_eq!(notices.len(), 1, "{step}: {notices:?}");
    let origin = &notices[0].origin;
    assert_eq!(origin.actor, Actor::User, "{step}: l'evento è dell'utente");
    assert!(origin.batch.is_some(), "{step}: l'evento sta in un lotto");
}

#[test]
fn il_gesto_e_il_suo_annulla_si_dicono_come_cambi_dell_utente_in_un_lotto() {
    let (_dir, root) = vault();
    let sink = Arc::new(Recorder::default());
    let host = Host::without_watcher().with_sink(sink.clone());
    host.open(&root).unwrap();
    host.wait_indexed(None).unwrap();
    let doc = DocId::new(BASE_FILE);
    let (_, revision) = host.read_document(None, &doc).unwrap();
    sink.base_changes();

    let outcome = host
        .invoke_user_command(
            None,
            "base.view.set",
            json!({ "doc": BASE_FILE, "view": "Tabella", "key": "sort", "value": "[{\"key\":\"stato\",\"descending\":false}]", "base": revision.0 }),
            InvokeMode::Apply,
        )
        .expect("il gesto si scrive");
    assert!(outcome.undo.is_some(), "il gesto si annulla");
    let (written, _) = host.read_document(None, &doc).unwrap();
    assert_ne!(written, BEFORE, "il gesto ha scritto");
    one_user_change_in_a_batch(&sink.base_changes(), "gesto");

    host.invoke_user_command(None, "vault.undo", json!({}), InvokeMode::Apply)
        .expect("l'annulla riesce");
    let (undone, _) = host.read_document(None, &doc).unwrap();
    assert_eq!(undone, BEFORE, "l'annulla riporta i byte di prima");
    one_user_change_in_a_batch(&sink.base_changes(), "annulla");
}
