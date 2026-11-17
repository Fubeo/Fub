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

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::event::{Actor, Event};
use fub_abi::model::DocId;
use fub_abi::Notice;
use fub_host::{Delivery, EventSink, Host};
use serde_json::json;

const BASE_FILE: &str = "Opere.base";
const BEFORE: &str = "views:\n  - name: Tabella   # la vista dei gesti\n    type: table\n    order: [file.name, stato]\n";

/// Tetto di sicurezza dell'attesa di un avviso. Non decide l'esito: il ponte
/// degli eventi consegna da un thread suo (`bridge.rs`), e l'attesa finisce
/// appena arriva ciò che si aspetta — di solito in pochi millisecondi. Il tetto
/// serve solo a non restare appesi se un difetto toglie l'avviso, ed è largo
/// perché su una macchina molto carica quel thread può restare fermo dei
/// secondi.
const SAFETY_CAP: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Recorder {
    notices: Mutex<Vec<Notice>>,
    arrived: Condvar,
}

impl EventSink for Recorder {
    fn emit(&self, notice: &Notice) -> Delivery {
        self.notices.lock().unwrap().push(notice.clone());
        self.arrived.notify_all();
        Delivery::Done
    }
}

fn is_base_change(notice: &Notice) -> bool {
    matches!(&notice.event, Event::DocumentChanged { id, .. } if id.as_str() == BASE_FILE)
}

impl Recorder {
    /// Dimentica gli avvisi arrivati finora.
    fn forget(&self) {
        self.notices.lock().unwrap().clear();
    }

    /// Gli avvisi di un cambio del `.base` che un gesto ha prodotto, presi
    /// **quando il ponte li ha consegnati tutti**.
    ///
    /// La consegna è asincrona: quando il comando torna, l'avviso è accodato sul
    /// bus ma il ponte può non averlo ancora passato al sink. Si aspetta quindi
    /// il primo cambio del `.base` e, se sta in un lotto, il `BatchEnded` di quel
    /// lotto: il bus consegna in ordine, quindi a quel punto ogni cambio del
    /// lotto è già arrivato e il conteggio è definitivo. Un cambio fuori lotto
    /// si rende subito, e l'asserzione lo boccia.
    fn base_changes_of_the_gesture(&self, step: &str) -> Vec<Notice> {
        let deadline = Instant::now() + SAFETY_CAP;
        let mut notices = self.notices.lock().unwrap();
        loop {
            if let Some(end) = gesture_end(&notices) {
                return notices.drain(..=end).filter(is_base_change).collect();
            }
            let left = deadline.saturating_duration_since(Instant::now());
            assert!(
                !left.is_zero(),
                "{step}: in {SAFETY_CAP:?} il ponte non ha consegnato il cambio \
                 del `.base` e la fine del suo lotto: {notices:?}"
            );
            notices = self.arrived.wait_timeout(notices, left).unwrap().0;
        }
    }
}

/// Dove finisce, fra gli avvisi consegnati, ciò che il gesto ha prodotto: il
/// primo cambio del `.base` se è fuori lotto, il `BatchEnded` del suo lotto se
/// ci sta dentro. `None` finché non è arrivato.
fn gesture_end(notices: &[Notice]) -> Option<usize> {
    let first = notices.iter().position(is_base_change)?;
    let Some(batch) = notices[first].origin.batch else {
        return Some(first);
    };
    notices[first..]
        .iter()
        .position(|notice| matches!(&notice.event, Event::BatchEnded { batch: ended, .. } if *ended == batch))
        .map(|offset| first + offset)
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
    sink.forget();

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
    one_user_change_in_a_batch(&sink.base_changes_of_the_gesture("gesto"), "gesto");

    host.invoke_user_command(None, "vault.undo", json!({}), InvokeMode::Apply)
        .expect("l'annulla riesce");
    let (undone, _) = host.read_document(None, &doc).unwrap();
    assert_eq!(undone, BEFORE, "l'annulla riporta i byte di prima");
    one_user_change_in_a_batch(&sink.base_changes_of_the_gesture("annulla"), "annulla");
}
