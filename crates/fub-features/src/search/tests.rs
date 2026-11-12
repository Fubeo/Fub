//! Test della ricerca: gli aiuti comuni, poi un file per area.

use super::*;
use fub_sdk::testing::MemoryHost;
// Le famiglie che il doppio serve a questi test: dal §7.1 un host è la
// somma di dieci trait, e i metodi di un trait si vedono se il trait è in
// scope — anche quando l'oggetto li ha tutti.
use camino::Utf8PathBuf;
use fub_abi::model::Tag;
use fub_abi::query::QueryLiteral;
use fub_abi::settings::{SettingScope, SettingValue};
use fub_abi::traits::PropertySelect;
use fub_abi::traits::{DataRead, DataWrite, SettingsWrite};

fn doc(id: &str, text: &str) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(id));
    m.text = text.to_string();
    m
}

fn tmp() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = Utf8PathBuf::from_path_buf(dir.path().join("index")).expect("utf8");
    (dir, path)
}

/// Apre l'indice **come lo apre il kernel**: costruzione e poi `activate`
/// con un host. Chiamarlo così nei test è il punto: un indice che
/// funzionasse solo senza attivazione non sarebbe l'indice che gira.
fn open(path: &Utf8Path, host: &mut MemoryHost) -> SearchIndex {
    let mut idx = SearchIndex::open_dir(path).expect("apertura indice");
    idx.activate(host).expect("attivazione indice");
    idx
}

/// Un indice nuovo con il suo host: il caso di gran lunga più comune.
fn fresh(path: &Utf8Path) -> (SearchIndex, MemoryHost) {
    let mut host = MemoryHost::new();
    let idx = open(path, &mut host);
    (idx, host)
}

fn search(idx: &SearchIndex, q: &str) -> Vec<DocumentMatch> {
    page_of(idx, text(q), Some(Page::first(10))).items
}

/// Una clausola sola: i letterali in AND, che è la forma in cui il
/// pianificatore consegna una clausola a questo indice.
fn clause(literals: Vec<QueryLiteral>) -> QueryExpr {
    QueryExpr {
        any: vec![QueryClause { all: literals }],
    }
}

fn lit(predicate: QueryPredicate) -> QueryLiteral {
    QueryLiteral {
        negated: false,
        predicate,
    }
}

fn text(q: &str) -> QueryExpr {
    clause(vec![lit(QueryPredicate::Text(TextQuery::terms(q)))])
}

/// Il testo con l'ultimo termine **incompleto**: la forma che manda una
/// casella mentre si digita (§21.2).
fn partial_text(q: &str) -> QueryExpr {
    clause(vec![lit(QueryPredicate::Text(
        TextQuery::terms(q).while_typing(),
    ))])
}

fn tag(name: &str, descendants: bool) -> QueryExpr {
    clause(vec![lit(QueryPredicate::Tag {
        name: name.to_string(),
        descendants,
    })])
}

/// L'interrogazione con la finestra, cioè la firma vera del contratto.
fn page_of(idx: &SearchIndex, matching: QueryExpr, page: Option<Page>) -> Paged<DocumentMatch> {
    match idx.query(IndexQuery::Documents {
        matching,
        sort: None,
        select: PropertySelect::None,
        page,
        excerpts: Excerpts::Attach,
    }) {
        Ok(IndexResult::Documents(hits)) => hits,
        other => panic!("attesi documenti, trovato {other:?}"),
    }
}

/// Il manifest come lo vede lo storage del plugin.
fn manifest_of(host: &MemoryHost) -> Manifest {
    let raw = host
        .data_read(MANIFEST)
        .expect("storage leggibile")
        .expect("il manifest c'è");
    serde_json::from_slice(&raw).expect("manifest valido")
}

fn put_manifest(host: &mut MemoryHost, m: &Manifest) {
    host.data_write(MANIFEST, &serde_json::to_vec(m).unwrap())
        .unwrap();
}

// Una nota con dei tag: la usano i test dei tag (`ranking`) e quelli
// dell'ambito (`window`).
fn tagged(id: &str, body: &str, tags: &[&str]) -> DocumentModel {
    let mut m = doc(id, body);
    m.tags = tags
        .iter()
        .map(|t| Tag {
            name: t.to_string(),
            span: Span::EMPTY,
        })
        .collect();
    m
}

mod freshness;
mod ranking;
mod window;
