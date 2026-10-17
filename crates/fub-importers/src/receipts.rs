//! **Le ricevute di un import** (FUB-007).
//!
//! # Il problema
//!
//! Il commit di un import tiene un journal con la preimmagine di ogni bersaglio
//! del piano, e lo scrive **prima** dell'apply. L'apply lo fa l'importer, e può
//! durare: le scritture degli altri non si fermano (il job non prende il turno
//! di scrittura del vault per tutta la durata), quindi fra il journal e la fine
//! dell'apply un altro scrittore può creare un bersaglio che il piano dava per
//! nuovo, o modificare uno che l'import ha già sostituito. Se l'apply poi
//! fallisce, il rollback deve sapere **che cosa ha scritto l'import**: il
//! journal non lo dice, perché è scritto prima. Senza una prova, cestinerebbe la
//! nota di un altro o riporterebbe indietro la sua modifica.
//!
//! # La ricevuta
//!
//! Chi scrive un bersaglio è l'importer, e solo lui sa che l'ha scritto e con
//! quale **revisione** l'ha lasciato. Ci pensa lui, subito dopo ogni scrittura
//! riuscita: salva una ricevuta `{doc, revisione}` nello spazio dati del plugin,
//! prima di passare al bersaglio dopo. Il rollback agisce soltanto dove la
//! revisione attuale è quella della ricevuta: se è cambiata, la modifica non è
//! dell'import e non si tocca.
//!
//! Il committer dice all'importer *dove* lasciare le ricevute con un'opzione
//! riservata della richiesta, [`OPTION`], che porta il nome del job e, per ogni
//! bersaglio che l'apply sostituisce, la revisione vista dal preflight. Quella
//! seconda metà serve alla scrittura: la sostituzione è condizionata alla
//! revisione del preflight (`DescendsFrom`), così una modifica arrivata dopo non
//! viene coperta. Confronto e scrittura sono un'operazione sola dell'host.
//!
//! Un importer che non conosce l'opzione (un componente di terzi) scrive senza
//! ricevute: per i suoi bersagli il rollback torna alla prova di prima — ciò che
//! il rapporto dell'import dichiara scritto, con l'impronta riletta a
//! posteriori — e dove non c'è nemmeno quella, si ferma con un conflitto.
//!
//! # Dove stanno
//!
//! ```text
//! imports/receipts/<job>/<impronta del documento>.json
//! ```
//!
//! Una per bersaglio. Un crash fra la scrittura e la ricevuta lascia un
//! bersaglio scritto e senza ricevuta, cioè ambiguo: il rollback non lo indovina.
//! Il commit le raccoglie nel proprio journal quando chiude, e le toglie.

use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocId;
use fub_abi::traits::HostApi;
use fub_abi::transfer::ImportRequest;
use fub_abi::PluginError;
use serde_json::{Map, Value};

use crate::common::content_hash_hex;

/// La chiave riservata di [`ImportRequest::options`] con cui il committer arma
/// le ricevute: `{"job": "...", "expect": {"<documento>": "<revisione>"}}`.
pub const OPTION: &str = "fub.receipts";

#[derive(serde::Serialize, serde::Deserialize)]
struct Receipt {
    doc: String,
    revision: String,
}

fn path(job: &str, doc: &DocId) -> String {
    format!(
        "imports/receipts/{job}/{}.json",
        content_hash_hex(doc.as_str().as_bytes())
    )
}

/// Arma la richiesta di un apply: le ricevute vanno sotto `job`, e ogni
/// bersaglio di `expect` si sostituisce solo se ha ancora quella revisione.
/// Rende `false` se le opzioni della richiesta non sono un oggetto: l'apply
/// procede come prima, senza ricevute.
pub(crate) fn arm(
    request: &mut ImportRequest,
    job: &str,
    expect: impl IntoIterator<Item = (DocId, Revision)>,
) -> bool {
    let expect: Map<String, Value> = expect
        .into_iter()
        .map(|(doc, revision)| (doc.as_str().to_owned(), Value::String(revision.0)))
        .collect();
    let armed = serde_json::json!({ "job": job, "expect": expect });
    match &mut request.options {
        Value::Object(options) => {
            options.insert(OPTION.to_owned(), armed);
        }
        Value::Null => {
            request.options = Value::Object(Map::from_iter([(OPTION.to_owned(), armed)]));
        }
        _ => return false,
    }
    true
}

fn job(request: &ImportRequest) -> Option<&str> {
    request.options.get(OPTION)?.get("job")?.as_str()
}

/// Questa richiesta chiede le ricevute?
pub fn armed(request: &ImportRequest) -> bool {
    job(request).is_some()
}

/// La base con cui sostituire `doc`: la revisione che il preflight ha visto, se
/// il committer l'ha detta; altrimenti la scrittura cieca di sempre.
pub fn base_for(request: &ImportRequest, doc: &DocId) -> WriteBase {
    request
        .options
        .get(OPTION)
        .and_then(|armed| armed.get("expect"))
        .and_then(|expect| expect.get(doc.as_str()))
        .and_then(Value::as_str)
        .map_or(WriteBase::Dictated, |revision| {
            WriteBase::DescendsFrom(Revision::new(revision))
        })
}

/// La revisione che il preflight ha visto su `doc`, se l'ha detta.
pub fn expected(request: &ImportRequest, doc: &DocId) -> Option<Revision> {
    match base_for(request, doc) {
        WriteBase::DescendsFrom(revision) => Some(revision),
        WriteBase::Dictated => None,
    }
}

/// Lascia la ricevuta di `doc`, scritto adesso con `revision`. Non fa niente se
/// la richiesta non chiede ricevute. Un errore qui ferma l'import: un bersaglio
/// scritto e senza ricevuta è proprio ciò che il rollback non saprebbe
/// riconoscere.
pub fn record(
    host: &mut dyn HostApi,
    request: &ImportRequest,
    doc: &DocId,
    revision: &Revision,
) -> Result<(), PluginError> {
    let Some(job) = job(request) else {
        return Ok(());
    };
    let raw = serde_json::to_vec(&Receipt {
        doc: doc.as_str().to_owned(),
        revision: revision.0.clone(),
    })
    .map_err(|e| PluginError::Internal(format!("receipt cannot be serialized: {e}").into()))?;
    host.data_write(&path(job, doc), &raw)
}

/// La revisione che l'import ha lasciato su `doc`, se ne ha lasciato la ricevuta.
/// Una ricevuta che non si legge o che nomina un altro documento vale come
/// assente: è ciò che il rollback tratta da ambiguo, e non indovina.
pub(crate) fn read(
    host: &dyn HostApi,
    job: &str,
    doc: &DocId,
) -> Result<Option<Revision>, PluginError> {
    let Some(raw) = host.data_read(&path(job, doc))? else {
        return Ok(None);
    };
    Ok(serde_json::from_slice::<Receipt>(&raw)
        .ok()
        .filter(|receipt| receipt.doc == doc.as_str())
        .map(|receipt| Revision::new(receipt.revision)))
}

/// Toglie le ricevute di `docs`. Quelle che mancano non sono un errore.
pub(crate) fn clear<'a>(
    host: &mut dyn HostApi,
    job: &str,
    docs: impl IntoIterator<Item = &'a DocId>,
) -> Result<(), PluginError> {
    for doc in docs {
        host.data_remove(&path(job, doc))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::{DataRead, DataWrite};
    use fub_sdk::testing::MemoryHost;

    fn armed_request(job: &str, expect: &[(&str, &str)]) -> ImportRequest {
        let mut request = ImportRequest::apply();
        assert!(arm(
            &mut request,
            job,
            expect
                .iter()
                .map(|(doc, revision)| (DocId::new(*doc), Revision::new(*revision))),
        ));
        request
    }

    #[test]
    fn a_request_without_the_option_asks_for_nothing() {
        let request = ImportRequest::apply();
        assert!(!armed(&request));
        assert!(matches!(
            base_for(&request, &DocId::new("A.md")),
            WriteBase::Dictated
        ));
        let mut host = MemoryHost::new();
        record(
            &mut host,
            &request,
            &DocId::new("A.md"),
            &Revision::new("r"),
        )
        .unwrap();
        assert!(host
            .data_read(&path("any", &DocId::new("A.md")))
            .unwrap()
            .is_none());
    }

    #[test]
    fn the_option_keeps_the_options_the_importer_already_has() {
        let mut request = ImportRequest::apply();
        request.options = serde_json::json!({ "delimiter": ";" });
        assert!(arm(&mut request, "job", []));
        assert_eq!(request.options["delimiter"], ";");
        assert!(armed(&request));
    }

    #[test]
    fn a_target_the_preflight_saw_is_replaced_only_from_that_revision() {
        let request = armed_request("job", &[("A.md", "sha256:aa")]);
        assert_eq!(
            expected(&request, &DocId::new("A.md")),
            Some(Revision::new("sha256:aa"))
        );
        assert_eq!(expected(&request, &DocId::new("B.md")), None);
    }

    #[test]
    fn a_receipt_is_read_back_for_its_own_document_only() {
        let request = armed_request("job", &[]);
        let mut host = MemoryHost::new();
        let doc = DocId::new("A.md");
        record(&mut host, &request, &doc, &Revision::new("sha256:bb")).unwrap();
        assert_eq!(
            read(&host, "job", &doc).unwrap(),
            Some(Revision::new("sha256:bb"))
        );
        assert_eq!(read(&host, "job", &DocId::new("B.md")).unwrap(), None);
        assert_eq!(read(&host, "other", &doc).unwrap(), None);
        clear(&mut host, "job", [&doc]).unwrap();
        assert_eq!(read(&host, "job", &doc).unwrap(), None);
    }

    #[test]
    fn a_receipt_that_cannot_be_read_counts_as_missing() {
        let mut host = MemoryHost::new();
        let doc = DocId::new("A.md");
        host.data_write(&path("job", &doc), b"{ torn").unwrap();
        assert_eq!(read(&host, "job", &doc).unwrap(), None);
    }
}
