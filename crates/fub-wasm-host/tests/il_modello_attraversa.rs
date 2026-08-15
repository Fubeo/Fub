//! **L'albero del documento passa il confine, e di là si cammina.**
//!
//! `read-model` è stata l'ultima capacità di `host-vault-read` a rispondere
//! `unserved`, e la ragione stava scritta nel verbale 0164: `document-model` è
//! l'albero più grande del contratto, e tradurlo è un passo suo. Questo file è
//! la prova che il passo è fatto — ma non prova la traduzione guardandola da
//! casa: la fa **camminare a un guest**. Un `.wasm` che non conosce `fub-abi`
//! chiede il modello di una nota vera, scende nell'arena piatta seguendo gli
//! indici, e risponde in JSON con ciò che ci ha trovato. Se i numeri sono quelli
//! del documento, l'albero è arrivato; se fossero zeri, sarebbe arrivato vuoto —
//! ed è esattamente la differenza che uno stub avrebbe nascosto.
//!
//! La seconda prova è il rovescio: un documento **malato**, con l'annidamento
//! spinto oltre il tetto che l'host dichiara, riceve un rifiuto che si legge
//! invece di portare giù il thread.
//!
//! # Il componente lo compila il test
//!
//! Come in `il_primo_componente.rs`: `esempi/modello-wasm` sta fuori dal
//! workspace e si compila per `wasm32-wasip2` da qui. Un test che si salta da
//! solo quando l'artefatto non c'è è un test che un giorno non gira più e
//! nessuno se ne accorge; se il bersaglio manca, il fallimento dice come
//! installarlo.

mod comune;

use std::time::Duration;

use camino::Utf8PathBuf;
use fub_abi::event::Event;
use fub_abi::traits::JobSpec;
use fub_abi::PluginError;
use fub_host::{Host, NoWatcher};
use fub_kernel::{Subscription, Trust};
use fub_wasm_host::WasmBundle;

const ID: &str = "demo.modello";

/// Quanto scende il documento malato: molto oltre il tetto dell'host, e ancora
/// abbastanza poco perché a produrlo sia una riga di file e non un generatore.
const ANNIDAMENTI: usize = 200;

// --- il banco ---------------------------------------------------------------

/// La nota che il componente andrà a leggere.
///
/// Non è un documento a caso: ogni riga ci sta per una parte dell'albero che
/// deve attraversare. Il frontmatter (con una proprietà da nominare per nome),
/// due intestazioni a livelli diversi, un wikilink, un tag, dell'enfasi dentro
/// un paragrafo, una lista con una task spuntata e una voce annidata, una
/// citazione che contiene a sua volta una lista — cioè blocchi dentro blocchi —
/// e un blocco di codice con la sua lingua. Un documento più povero direbbe
/// «qualcosa è arrivato» senza dire *che cosa*.
const NOTA: &str = "\
---
titolo: L'albero attraversa
peso: 3
---

# Il modello

Un paragrafo con un [[Nota]], un #prova e del **grassetto**.

## Dettagli

- primo
- [x] fatta
- terzo
  - annidato

> Una citazione con dentro una lista:
>
> - dentro

```rust
fn niente() {}
```
";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn nuovo() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        std::fs::write(root.join("Nota.md"), "# Nota\n").unwrap();
        std::fs::write(root.join("Modello.md"), NOTA).unwrap();
        // Il documento malato: duecento citazioni una dentro l'altra, che sono
        // duecento byte di file. Il costo di scriverlo è nullo, il costo di
        // tradurlo senza un tetto sarebbe lo stack del thread del job.
        std::fs::write(
            root.join("Profondo.md"),
            format!("{} fondo\n", ">".repeat(ANNIDAMENTI)),
        )
        .unwrap();
        Vault { _dir: dir, root }
    }
}

/// Un host headless col vault aperto e il componente montato.
fn banco(v: &Vault) -> (Host, Subscription) {
    let bundle = WasmBundle::da_file(
        &comune::componente("modello-wasm", "modello_wasm", ""),
        Trust::Community,
    )
    .expect("il componente si carica");

    let host = Host::new()
        .with_watcher(Box::new(NoWatcher))
        .with_job_threads(1);
    host.open(&v.root).expect("il vault si apre");
    host.wait_indexed(None).expect("l'apertura ha finito");
    let eventi = host
        .with_session(None, |s| s.workspace().read().unwrap().bus().subscribe())
        .expect("aperto");
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        s.bundles()
            .write()
            .unwrap()
            .mount(&bundle, &mut ws)
            .expect("il bundle si monta");
    })
    .expect("aperto");
    (host, eventi)
}

fn chiedi(host: &Host, job: &str) -> fub_abi::traits::JobId {
    host.with_session(None, |s| {
        let mut ws = s.workspace().write().unwrap();
        ws.with_host(ID, |h| {
            h.spawn_job(JobSpec {
                job: job.to_string(),
                payload: serde_json::json!(null),
            })
        })
        .expect("accodato")
    })
    .expect("aperto")
}

fn esito(eventi: &Subscription) -> (String, Result<serde_json::Value, PluginError>) {
    let scadenza = std::time::Instant::now() + Duration::from_secs(30);
    while std::time::Instant::now() < scadenza {
        if let Ok(notice) = eventi.recv_timeout(Duration::from_millis(200)) {
            if let Event::JobDone { job, result, .. } = notice.event {
                return (job, result);
            }
        }
    }
    panic!("nessun job è mai tornato: la coda non la drena nessuno");
}

// --- le prove ---------------------------------------------------------------

/// Il modello di una nota vera, chiesto da un componente e camminato da lui.
#[test]
fn un_componente_wasm_cammina_lalbero_del_documento() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v);

    chiedi(&host, "modello");
    let (job, result) = esito(&eventi);
    assert_eq!(job, "modello");
    let m = result.expect("il job è riuscito");

    // Chi è il documento, e che aveva un frontmatter: `frontmatter_presente` è
    // un sì/no che una mappa non sa dire (`---\n---` e nessun frontmatter danno
    // la stessa mappa vuota).
    assert_eq!(m["id"], "Modello.md");
    assert_eq!(m["frontmatter_presente"], true);
    assert_eq!(
        m["frontmatter"]["titolo"], "L'albero attraversa",
        "una proprietà del frontmatter, letta per nome di là dal confine: {m}"
    );
    assert_eq!(m["frontmatter"]["peso"], 3);

    // L'arena non è vuota, e le radici sono meno dei blocchi: la differenza
    // **è** l'annidamento, perché ogni blocco che non è radice è figlio di
    // qualcuno.
    let radici = m["radici"].as_u64().unwrap();
    let blocchi = m["blocchi"].as_u64().unwrap();
    assert!(radici > 0, "il corpo è arrivato: {m}");
    assert!(
        blocchi > radici,
        "ci sono blocchi che non sono radici, cioè figli: {m}"
    );
    assert!(
        m["inline"].as_u64().unwrap() > 0,
        "gli inline sono arrivati"
    );
    assert!(
        m["profondita"].as_u64().unwrap() >= 3,
        "la citazione contiene una lista che contiene un paragrafo: {m}"
    );

    // L'outline: due titoli, a due livelli, e il primo è quello scritto.
    assert_eq!(m["intestazioni"], 2);
    assert_eq!(m["prima_intestazione"], "Il modello");
    assert_eq!(m["livello_massimo"], 2);

    // Le tabelle piatte accanto all'albero.
    assert_eq!(m["link"], 1);
    assert_eq!(m["primo_link"], "wiki:Nota");
    assert_eq!(m["tag"], 1);

    // La lista: quattro voci in tutto (tre di primo livello più l'annidata), e
    // una sola spuntata. È la prova che `list-item` porta la sua task e non solo
    // dei paragrafi.
    assert_eq!(m["voci_lista"], 5);
    assert_eq!(m["task_spuntate"], 1);

    // Il blocco di codice porta la sua lingua.
    assert_eq!(m["lingua_codice"], "rust");

    // Il testo del primo paragrafo, **ricostruito seguendo gli `inline-ref`**:
    // se l'arena degli inline non si risolvesse, questa stringa sarebbe vuota o
    // monca del grassetto e del wikilink.
    assert_eq!(
        m["primo_paragrafo"], "Un paragrafo con un Nota, un #prova e del grassetto.",
        "gli inline si camminano per indice: {m}"
    );

    host.close();
}

/// Il rovescio: un documento annidato oltre il tetto dell'host riceve un
/// **rifiuto che si legge**.
///
/// Il tetto sta in `crate::modello` e vale 64 livelli; questo documento ne ha
/// duecento. Senza il tetto la traduzione ricorsiva scenderebbe fino in fondo, e
/// «fino in fondo» su un file che qualcuno può scrivere apposta non è un errore:
/// è lo stack del thread che finisce, cioè il processo dell'utente che muore.
/// Qui invece il componente resta vivo, il job torna, e l'errore dice il numero.
#[test]
fn un_documento_troppo_annidato_riceve_un_no_invece_di_far_cadere_lhost() {
    let v = Vault::nuovo();
    let (host, eventi) = banco(&v);

    chiedi(&host, "modello-profondo");
    let (job, result) = esito(&eventi);
    assert_eq!(job, "modello-profondo");
    let errore = result.expect_err("un albero oltre il tetto non attraversa");
    assert!(
        matches!(&errore, PluginError::Internal(t)
            if t.as_literal().is_some_and(|m| m.contains("annidamento"))),
        "il rifiuto nomina l'annidamento: {errore}"
    );

    // L'istanza è ancora viva: il rifiuto è passato come **valore**, non come
    // trap, e lo stesso componente risponde ancora a una domanda buona.
    chiedi(&host, "modello");
    let (_, result) = esito(&eventi);
    assert!(
        result.is_ok(),
        "dopo il no il componente è ancora in piedi: {result:?}"
    );

    host.close();
}
