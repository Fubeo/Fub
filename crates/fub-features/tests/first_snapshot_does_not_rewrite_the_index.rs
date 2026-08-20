// Il banco di questa feature vive con lei: senza la cargo feature `versioning`
// (§16.3) il modulo non è compilato, e un test che lo nomina non avrebbe un
// soggetto.
#![cfg(feature = "versioning")]
//! La passata sull'intero vault scrive `versions.json` **una volta**, non una
//! per nota.
//!
//! # Perché un conto e non un tempo
//!
//! Il difetto che questo banco presidia era quadratico nei **byte scritti**: la
//! passata riscriveva l'indice intero a ogni fotografia, quindi su N note
//! scriveva N indici di taglia crescente. Un presidio a cronometro lo vedrebbe
//! anche lui, ma direbbe cose diverse su macchine diverse e a carico diverso —
//! cioè non sarebbe un segnale. Il conto delle `data_write` è lo stesso numero
//! ovunque, e la soglia qui sotto non è una stima: è un'uguaglianza.
//!
//! # Chi è stato rosso e chi no
//!
//! **Rosso**: `la__before_fotografia_scrive_l_indice__a_volta_sola`. Con la forma
//! precedente — l'indice scritto dentro ogni `Inner::applica` — falliva con
//! `volte = 200` invece di `1`, e i byte passati per `versions.json` erano
//! 2 687 519 invece di 26 711 su un vault di 200 note.
//!
//! **Verdi anche prima, e dichiarato**: gli altri due. Non provano che qualcosa
//! sia cambiato, provano che qualcosa **non** è cambiato — l'indice finale dice
//! ancora tutto, e una passata interrotta si recupera ancora tutta. Sono la
//! metà che tiene ferma la correttezza mentre la prima metà toglie il lavoro,
//! e senza di loro il conto sopra si porterebbe al verde anche scrivendo un
//! indice troncato.

use fub_abi::event::{Event, Notice};
use fub_abi::traits::{DataRead, EventHandler};
use fub_features::{VersionStore, VersioningHandler};
use fub_sdk::testing::MemoryHost;

/// L'indice dello store del versioning, nello spazio dati del plugin. È privato
/// nel modulo, e qui si nomina il path perché è ciò che un plugin di terzi
/// vedrebbe: il banco guarda lo spazio dati, non l'interno della feature.
const INDEX_FILE: &str = "versions.json";

/// Quante note. Non tre: un difetto quadratico su tre note non si vede, e la
/// taglia serve a rendere il numero sbagliato **grande** invece che discutibile.
const NOTE: usize = 200;

fn vault_grande() -> MemoryHost {
    let mut host = MemoryHost::new();
    for the in 0..NOTE {
        host = host.with_document(
            &format!("note/{the:04}.md"),
            &format!("# Nota {the}\n\nUn corpo qualsiasi, lungo abbastanza da non\nessere un caso degenere.\n"),
        );
    }
    host
}

#[test]
fn the__before_snapshot_writes_the_index__a_time_single() {
    let mut host = vault_grande();
    let store = VersionStore::open(&mut host).expect("apertura");
    let handler = VersioningHandler::new(store.clone());

    handler
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia");

    // La passata ha fatto il suo lavoro: senza questo, un indice scritto zero
    // volte passerebbe la prova qui sotto a mani basse.
    assert_eq!(
        store.documents().len(),
        NOTE,
        "la passata non ha fotografato tutto il vault"
    );

    let (times, byte) = host.writes_on(INDEX_FILE);
    assert_eq!(
        times, 1,
        "l'indice è stato scritto {times} volte per {NOTE} note: la passata \
         riscrive l'intero `versions.json` a ogni fotografia"
    );
    // E il verso che il conto delle volte da solo non vedrebbe: quella sola
    // scrittura ha messo giù l'indice **intero**, non un troncone. Il conto è
    // cieco alla taglia, e senza questa riga si porterebbe al verde anche una
    // passata che scrive una volta sola un indice vuoto.
    let on_the_disk = host.data_read(INDEX_FILE).expect("lettura").expect("c'è");
    assert_eq!(
        byte,
        on_the_disk.len(),
        "i byte scritti non sono quelli dell'indice che è rimasto sul disco"
    );
}

/// Il presidio del conto è cieco a ciò che non gli si dice di guardare, e la
/// cosa che deve restare vera non è «si scrive poco»: è che alla fine sul disco
/// ci sia **lo stesso indice** che ci sarebbe stato scrivendolo ogni volta.
///
/// Quindi: si riapre lo store da quel solo indice, e deve nominare tutte le
/// note con tutte le loro versioni, leggibili.
#[test]
fn the_index_written_once_says_everything_it_used_to() {
    let mut host = vault_grande();
    let store = VersionStore::open(&mut host).expect("apertura");
    let handler = VersioningHandler::new(store.clone());
    handler
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia");
    drop(handler);
    drop(store);

    // Riaperto **dall'indice**: se la passata avesse lasciato sul disco un
    // indice parziale, di qui uscirebbe uno store che non nomina le ultime.
    let reopened = VersionStore::open(&mut host).expect("riapertura");
    assert_eq!(reopened.documents().len(), NOTE);
    for id in reopened.documents() {
        let versions = reopened.list(&id);
        assert_eq!(versions.len(), 1, "{id} ha {} versioni", versions.len());
        assert!(
            reopened.read(&id, versions[0].ts, &host).is_ok(),
            "l'indice nomina una versione di {id} e il contenuto non c'è"
        );
    }
}

/// La domanda che decide se questa riparazione sia lecita: **cosa vede
/// l'utente dopo un crash a metà passata?**
///
/// Con l'indice scritto a ogni fotografia, un processo ucciso a metà lasciava
/// sul disco un indice che nominava le prime k note — e il blob della (k+1)-esima,
/// già scritto, restava orfano per sempre.
///
/// Con l'indice scritto una volta sola, l'indice a metà passata **non c'è**: la
/// passata lo toglie prima di cominciare. E un indice che non c'è è esattamente
/// la condizione che [`VersionStore::open`] sa gestire — ricostruisce dallo
/// store, dove ogni cartella dice di chi è e ogni file dice quando. Quindi si
/// recupera **tutto**, compreso il blob che prima restava orfano.
///
/// Il banco costruisce il crash senza thread: la scrittura dell'indice viene
/// negata, cioè la passata arriva in fondo e l'ultimo atto fallisce. È il
/// momento peggiore possibile.
#[test]
fn an_interrupted_pass_loses_nothing_because_the_index_is_rebuilt() {
    let mut host = vault_grande();
    let store = VersionStore::open(&mut host).expect("apertura");
    let handler = VersioningHandler::new(store.clone());
    host.denies_write(INDEX_FILE);

    // La passata non solleva: una nota non salvata è un `Trouble`, non un
    // fallimento dell'apertura. Ma l'indice non è stato scritto.
    handler
        .first_snapshot_of_the_vault(&mut host)
        .expect("la prima fotografia non fa cadere l'apertura");
    drop(handler);
    drop(store);
    assert_eq!(
        host.writes_on(INDEX_FILE),
        (0, 0),
        "l'indice è stato scritto: il crash non è stato costruito"
    );

    // Il processo riparte. L'indice non c'è, quindi si ricostruisce dallo
    // store — e ci ritrova tutto.
    let reopened = VersionStore::open(&mut host).expect("riapertura");
    assert_eq!(
        reopened.documents().len(),
        NOTE,
        "la ricostruzione ha perso delle storie: la passata interrotta non è \
         gratis da riprendere"
    );
    for id in reopened.documents() {
        let versions = reopened.list(&id);
        assert_eq!(versions.len(), 1);
        assert!(reopened.read(&id, versions[0].ts, &host).is_ok());
    }
}

/// **`VaultOpened` non fotografa più** (0154): la passata è diventata
/// copy-on-first-write, e l'evento da solo non produce niente. È la metà che
/// tiene fermo il taglio «fuori dall'apertura»: se qualcuno rimette il ramo
/// nell'handler, questo banco è rosso.
#[test]
fn the_vaultopened_event_does_not_snapshot_again() {
    let mut host = MemoryHost::new().with_document("a.md", "com'era");
    let store = VersionStore::open(&mut host).expect("apertura");
    let mut handler = VersioningHandler::new(store.clone());

    handler
        .handle(
            &Notice::of(Event::VaultOpened {
                root: "/vault".into(),
            }),
            &mut host,
        )
        .expect("l'handler risponde");

    assert!(
        store.documents().is_empty(),
        "VaultOpened ha fotografato: la passata non sta più nell'handler"
    );
}
