//! Il **linguaggio delle interrogazioni**: l'albero che sostituisce la stringa.
//!
//! Prima di questo modulo la domanda «quali documenti?» si faceva con
//! `IndexQuery::FullText { query: String }`, e quella stringa finiva dritta nel
//! `QueryParser` di tantivy: la sintassi di ricerca che l'utente digitava **era**
//! quella di una dipendenza. Finché è così non hanno su cosa poggiare né il
//! query builder visuale, né le query salvate e parametriche, né l'explain plan,
//! né la possibilità di cambiare motore — e la ricerca per testo non si può
//! comporre con una sul frontmatter, perché le due non parlano la stessa lingua.
//!
//! Qui la query è **dato del contratto**, e il testo libero è una foglia sola.
//!
//! # La forma: due livelli, in forma normale disgiuntiva
//!
//! Una [`QueryExpr`] è un OR di [`QueryClause`], una clausola è un AND di
//! [`QueryLiteral`], un letterale è un [`QueryPredicate`] eventualmente negato.
//! Non è un albero di profondità arbitraria, e la ragione non è di gusto: al
//! confine WIT i tipi ricorsivi passano solo per **arena** (è il prezzo che
//! `block`, `inline` e `ui-node` pagano già), e un'arena per una query che un
//! umano compone a mano costerebbe un mirror in più a ogni voce del linguaggio,
//! per sempre. La DNF esprime **ogni** combinazione booleana — chi ha
//! `(a OR b) AND (c OR d)` la distribuisce, ed è ciò che fa comunque un
//! pianificatore — e ha in più la proprietà che serve qui: è la stessa forma che
//! un query builder mostra a schermo (gruppi di righe in OR, righe in AND), e
//! quindi l'unica traduzione fra la UI e il contratto è nessuna.
//!
//! **Vuoto significa "tutto"**, in entrambi i livelli: `any: []` è ogni
//! documento del vault, e così una clausola senza letterali. È la query da cui
//! parte un builder che non ha ancora nessun filtro, ed è l'identità dell'AND —
//! sceglierla è ciò che permette di scrivere «tutti i documenti» senza una
//! variante apposta.
//!
//! # Chi valuta cosa
//!
//! Un predicato è un **fatto sul vault**, non un servizio: `#rust` seleziona le
//! stesse note per chiunque le conti. Per questo un predicato può avere più di un
//! valutatore (il testo di tantivy conosce anche cartelle e tag, perché li ha
//! indicizzati) e chi pianifica sceglie a chi mandarlo — mentre una *variante*
//! di [`IndexQuery`](crate::traits::IndexQuery) ha un proprietario solo, perché
//! lì la risposta la **compone** chi la serve. La differenza è dichiarata in
//! [`QueryRoute`](crate::traits::QueryRoute).
//!
//! La **struttura** invece non si delega mai: cosa significhino OR, AND e la
//! negazione è scritto una volta, in [`QueryEvaluator`], e lo usano il
//! pianificatore del kernel e chiunque implementi un indice. Un provider che
//! riceve un sottoalbero tutto suo può tradurlo nel proprio motore (è ciò che
//! fa la ricerca full-text, e si chiama pushdown); se non vuole, implementa i
//! due metodi delle foglie e la struttura gliela regge questo modulo.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::PluginError;
use crate::model::DocId;
use crate::traits::{DocumentMatch, LinkDirection, PropertyFilter};

/// Un'interrogazione sui documenti: le clausole sono in **OR**, e vuoto è
/// **ogni documento**.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct QueryExpr {
    #[serde(default)]
    pub any: Vec<QueryClause>,
}

/// Una clausola: i letterali sono in **AND**, e vuota è **ogni documento**.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct QueryClause {
    #[serde(default)]
    pub all: Vec<QueryLiteral>,
}

/// Un predicato, eventualmente negato.
///
/// La negazione sta sul letterale e non su un nodo `not` perché in forma
/// normale è lì che finisce comunque (De Morgan la spinge fino alle foglie), e
/// perché è la casella «diverso da» che un builder disegna accanto alla riga.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QueryLiteral {
    #[serde(default)]
    pub negated: bool,
    pub predicate: QueryPredicate,
}

/// Le foglie del linguaggio: ognuna è un fatto sul vault che qualcuno sa
/// verificare.
///
/// Nessun payload è uno scalare o una sequenza nuda: un `variant` fatto così
/// non attraversa il JSON col tag interno (vedi il § in testa a
/// [`crate::model`]), e questo enum viaggia sull'IPC a ogni ricerca. Chi porta
/// una lista la porta dentro un campo (`docs`), chi porta un record lo porta e
/// basta (`text`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QueryPredicate {
    /// Il testo cercato: **l'unica stringa libera del contratto**, e il motivo
    /// per cui esiste questo modulo. Chi la serve la tokenizza come vuole, ma
    /// non ci trova dentro operatori: la struttura è fuori, qui.
    Text(TextQuery),
    /// Una prova sul frontmatter, con le regole di [`PropertyTest`].
    ///
    /// [`PropertyTest`]: crate::traits::PropertyTest
    Property { filter: PropertyFilter },
    /// Un tag in forma canonica (senza `#`). Con `descendants` prende anche la
    /// sua gerarchia: `progetto` include `progetto/casa`.
    Tag { name: String, descendants: bool },
    /// Una cartella del vault (path relativo senza slash finale, `""` = radice).
    /// Con `descendants` prende anche le sottocartelle.
    Folder { path: String, descendants: bool },
    /// I documenti in relazione di link con `doc`: `inbound` = quelli che lo
    /// **nominano** (i suoi backlink), `outbound` = quelli **nominati** da lui.
    Linked {
        doc: DocId,
        direction: LinkDirection,
    },
    /// Questi documenti, per nome. È la foglia in cui il pianificatore
    /// **risolve** un sottoalbero che il destinatario non saprebbe valutare: chi
    /// riceve `docs` non deve sapere da quale domanda veniva. Serve anche a chi
    /// interroga: le proprietà di una selezione sono una query, non un giro.
    Docs { docs: Vec<DocId> },
    /// Varco di estensione: un predicato di terzi, con namespace (`ns` = id del
    /// plugin). Chi non lo rivendica non lo riceve mai — non c'è un `BadArgs` da
    /// restituire, perché il routing è dichiarato.
    Custom {
        ns: String,
        predicate: serde_json::Value,
    },
}

/// La foglia di testo: cosa cercare, come, e dove.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextQuery {
    /// I termini come li ha scritti chi cerca. Non è un linguaggio: due parole
    /// sono due termini, non «due parole e un operatore implicito da
    /// documentare».
    pub text: String,
    #[serde(default)]
    pub mode: TextMode,
    /// In quali campi cercare. Vuoto = quelli che il provider indicizza, con i
    /// suoi pesi — è il default, ed è ciò che una casella di ricerca manda.
    #[serde(default)]
    pub fields: Vec<TextField>,
}

impl TextQuery {
    /// I termini, ovunque il provider guardi: la forma che manda una casella di
    /// ricerca.
    pub fn terms(text: impl Into<String>) -> Self {
        TextQuery {
            text: text.into(),
            mode: TextMode::Terms,
            fields: Vec::new(),
        }
    }
}

/// Come si intende la stringa di [`TextQuery`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextMode {
    /// Tutti i termini devono comparire, in qualunque ordine. È ciò che si
    /// aspetta chi digita due parole.
    #[default]
    Terms,
    /// La sequenza esatta, nell'ordine: le virgolette di una ricerca, senza le
    /// virgolette.
    Phrase,
}

/// Dove cercare il testo. Non è l'elenco dei campi di un motore — è ciò che
/// **ogni** motore di note deve saper distinguere, o «cerca solo nel titolo»
/// diventerebbe un pezzo di sintassi da comporre a mano.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextField {
    /// Il nome della nota (il `page_name` del suo id).
    Name,
    /// Il corpo del documento.
    Body,
    /// I suoi tag, in forma canonica.
    Tags,
}

impl QueryExpr {
    /// Ogni documento del vault.
    pub fn all() -> Self {
        QueryExpr::default()
    }

    /// Un predicato solo — la query più corta che esista.
    pub fn of(predicate: QueryPredicate) -> Self {
        QueryExpr {
            any: vec![QueryClause {
                all: vec![QueryLiteral {
                    negated: false,
                    predicate,
                }],
            }],
        }
    }

    /// Questi documenti e basta: la forma in cui un pianificatore consegna un
    /// sottoalbero già risolto.
    pub fn docs(docs: Vec<DocId>) -> Self {
        QueryExpr::of(QueryPredicate::Docs { docs })
    }

    /// Seleziona ogni documento? (nessuna clausola, o una clausola vuota)
    pub fn is_everything(&self) -> bool {
        self.any.is_empty() || self.any.iter().any(|c| c.all.is_empty())
    }

    /// I predicati che compaiono, in ordine di apparizione: è ciò su cui si
    /// decide **a chi** va una query, e ciò che un explain plan elenca.
    pub fn predicates(&self) -> impl Iterator<Item = &QueryPredicate> {
        self.any
            .iter()
            .flat_map(|c| c.all.iter().map(|l| &l.predicate))
    }
}

impl QueryClause {
    pub fn predicates(&self) -> impl Iterator<Item = &QueryPredicate> {
        self.all.iter().map(|l| &l.predicate)
    }
}

// ---------------------------------------------------------------------------
// Le regole delle foglie, in un posto solo
// ---------------------------------------------------------------------------
//
// Cosa vuol dire "sta in questa cartella" e "porta questo tag" lo chiedono in
// due: il kernel, che risponde dai metadati in cache, e chi indicizza, che
// risponde dal proprio motore. Scritte due volte divergerebbero sul caso che
// nessuno prova — la radice, il tag annidato — e la divergenza sarebbe muta:
// due conteggi plausibili e diversi.

/// Le cartelle a cui un documento appartiene, dalla radice in giù: `""`
/// (la radice) e ogni antenata fino a quella che lo contiene.
pub fn folders_of(doc: &DocId) -> Vec<String> {
    let mut out = vec![String::new()];
    let Some((dir, _)) = doc.as_str().rsplit_once('/') else {
        return out;
    };
    let mut acc = String::new();
    for part in dir.split('/') {
        if !acc.is_empty() {
            acc.push('/');
        }
        acc.push_str(part);
        out.push(acc.clone());
    }
    out
}

/// La cartella che contiene il documento (`""` se sta nella radice).
pub fn folder_of(doc: &DocId) -> String {
    doc.as_str()
        .rsplit_once('/')
        .map(|(dir, _)| dir.to_string())
        .unwrap_or_default()
}

/// Il documento sta in questa cartella? Con `descendants`, anche in una sua
/// discendente. `path` senza slash finale; `""` è la radice — e la radice con
/// `descendants` è tutto il vault.
pub fn in_folder(doc: &DocId, path: &str, descendants: bool) -> bool {
    let path = path.trim_end_matches('/');
    let own = folder_of(doc);
    if descendants {
        path.is_empty() || own == path || own.strip_prefix(path).is_some_and(|r| r.starts_with('/'))
    } else {
        own == path
    }
}

/// Un tag (in forma canonica) soddisfa la richiesta? Con `descendants`, anche
/// la sua gerarchia: `progetto` prende `progetto/casa`.
pub fn tag_matches(tag: &str, wanted: &str, descendants: bool) -> bool {
    tag == wanted || (descendants && tag.strip_prefix(wanted).is_some_and(|r| r.starts_with('/')))
}

/// Le forme sotto cui un tag canonico si lascia trovare da un predicato con
/// `descendants`: sé stesso e ogni suo antenato.
pub fn tag_ancestors(tag: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut acc = String::new();
    for part in tag.split('/') {
        if !acc.is_empty() {
            acc.push('/');
        }
        acc.push_str(part);
        out.push(acc.clone());
    }
    out
}

// ---------------------------------------------------------------------------
// La valutazione: la struttura in un posto solo
// ---------------------------------------------------------------------------

/// L'insieme selezionato da una porzione di query, con ciò che il testo vi ha
/// aggiunto.
///
/// È ordinato per [`DocId`] per costruzione, e non è un dettaglio: una risposta
/// paginata senza ordine totale ripete o salta righe fra una pagina e l'altra, e
/// l'unione di due rami valutati da due provider diversi non avrebbe nessun
/// ordine naturale da cui partire.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Matches(BTreeMap<DocId, DocumentMatch>);

impl Matches {
    pub fn new() -> Self {
        Matches(BTreeMap::new())
    }

    /// I soli id, senza rilevanza né estratti: chi seleziona e basta.
    pub fn of_docs(docs: impl IntoIterator<Item = DocId>) -> Self {
        Matches(
            docs.into_iter()
                .map(|doc| (doc.clone(), DocumentMatch::of(doc)))
                .collect(),
        )
    }

    pub fn insert(&mut self, m: DocumentMatch) {
        match self.0.get_mut(&m.doc) {
            Some(existing) => existing.absorb(m),
            None => {
                self.0.insert(m.doc.clone(), m);
            }
        }
    }

    pub fn contains(&self, doc: &DocId) -> bool {
        self.0.contains_key(doc)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn ids(&self) -> impl Iterator<Item = &DocId> {
        self.0.keys()
    }

    pub fn get_mut(&mut self, doc: &DocId) -> Option<&mut DocumentMatch> {
        self.0.get_mut(doc)
    }

    /// In ordine di `DocId`. Chi vuole un altro ordine (rilevanza, una
    /// proprietà) lo impone dopo: qui l'ordine è quello che rende stabile la
    /// paginazione.
    pub fn into_vec(self) -> Vec<DocumentMatch> {
        self.0.into_values().collect()
    }

    /// Intersezione: sopravvive chi sta in entrambi, e ciò che i due rami sanno
    /// del documento si fonde.
    pub fn and(mut self, other: Matches) -> Matches {
        let mut kept = Matches::new();
        for (doc, m) in other.0 {
            if let Some(mine) = self.0.remove(&doc) {
                let mut merged = mine;
                merged.absorb(m);
                kept.0.insert(doc, merged);
            }
        }
        kept
    }

    /// Unione.
    pub fn or(mut self, other: Matches) -> Matches {
        for (_, m) in other.0 {
            self.insert(m);
        }
        self
    }

    /// Complemento rispetto all'insieme dato (l'universo di chi valuta).
    pub fn not(self, universe: Matches) -> Matches {
        let mut left = universe;
        left.0.retain(|doc, _| !self.0.contains_key(doc));
        left
    }
}

impl FromIterator<DocumentMatch> for Matches {
    fn from_iter<I: IntoIterator<Item = DocumentMatch>>(iter: I) -> Self {
        let mut matches = Matches::new();
        for m in iter {
            matches.insert(m);
        }
        matches
    }
}

/// Chi sa valutare le **foglie**; la struttura gliela regge questo trait.
///
/// I due metodi da scrivere sono [`universe`](QueryEvaluator::universe) — quali
/// documenti esistono, che serve alla negazione — e
/// [`predicate`](QueryEvaluator::predicate). Tutto il resto ha un default, ed è
/// esattamente ciò che «le regole in un posto solo» vuol dire per il linguaggio
/// delle query: nessuno riscrive cosa vuol dire AND, e due implementazioni non
/// possono divergere su `NOT` di un insieme vuoto.
///
/// Chi pianifica sopra più provider sovrascrive
/// [`clause`](QueryEvaluator::clause): è lì che si decide se un'intera clausola
/// può andare a un motore solo invece di essere ricomposta a mano.
pub trait QueryEvaluator {
    /// Ogni documento su cui questa valutazione ha giurisdizione.
    fn universe(&self) -> Result<Matches, PluginError>;

    /// I documenti che verificano il predicato.
    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError>;

    /// Un letterale: il predicato, o il suo complemento.
    fn literal(&self, literal: &QueryLiteral) -> Result<Matches, PluginError> {
        let found = self.predicate(&literal.predicate)?;
        if literal.negated {
            Ok(found.not(self.universe()?))
        } else {
            Ok(found)
        }
    }

    /// Una clausola: l'AND dei suoi letterali. Vuota = ogni documento.
    fn clause(&self, clause: &QueryClause) -> Result<Matches, PluginError> {
        let mut acc: Option<Matches> = None;
        for literal in &clause.all {
            // Un AND che ha già perso tutto non interroga il resto: è il taglio
            // che rende gratis `#inesistente AND <ricerca costosa>`, e il
            // motivo per cui sta **prima** della valutazione.
            if acc.as_ref().is_some_and(|m| m.is_empty()) {
                break;
            }
            let next = self.literal(literal)?;
            acc = Some(match acc {
                None => next,
                Some(so_far) => so_far.and(next),
            });
        }
        match acc {
            Some(matches) => Ok(matches),
            None => self.universe(),
        }
    }

    /// L'espressione: l'OR delle sue clausole. Nessuna clausola = ogni
    /// documento.
    fn expr(&self, expr: &QueryExpr) -> Result<Matches, PluginError> {
        if expr.any.is_empty() {
            return self.universe();
        }
        let mut acc = Matches::new();
        for clause in &expr.any {
            acc = acc.or(self.clause(clause)?);
        }
        Ok(acc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::{PropertyFilter, PropertyTest};

    /// Un valutatore finto: l'universo sono cinque note, e l'unico predicato che
    /// conosce è `Docs`.
    struct Finto;

    fn doc(n: &str) -> DocId {
        DocId::new(n)
    }

    impl QueryEvaluator for Finto {
        fn universe(&self) -> Result<Matches, PluginError> {
            Ok(Matches::of_docs(
                ["a.md", "b.md", "c.md", "d.md", "e.md"].map(doc),
            ))
        }
        fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
            match predicate {
                QueryPredicate::Docs { docs } => Ok(Matches::of_docs(docs.clone())),
                other => Err(PluginError::BadArgs(format!("non mio: {other:?}"))),
            }
        }
    }

    fn ids(m: Matches) -> Vec<String> {
        m.ids().map(|d| d.0.clone()).collect()
    }

    fn some(names: &[&str]) -> QueryLiteral {
        QueryLiteral {
            negated: false,
            predicate: QueryPredicate::Docs {
                docs: names.iter().map(|n| doc(n)).collect(),
            },
        }
    }

    #[test]
    fn vuoto_vuol_dire_tutto_ed_e_lidentita_dellintersezione() {
        let tutto = Finto.expr(&QueryExpr::all()).unwrap();
        assert_eq!(ids(tutto).len(), 5, "nessuna clausola = ogni documento");

        // Una clausola vuota è l'identità: in OR con un'altra, il risultato è
        // comunque tutto — ed è il motivo per cui `is_everything` la riconosce.
        let con_vuota = QueryExpr {
            any: vec![
                QueryClause { all: vec![] },
                QueryClause {
                    all: vec![some(&["a.md"])],
                },
            ],
        };
        assert!(con_vuota.is_everything());
        assert_eq!(Finto.expr(&con_vuota).unwrap().len(), 5);
    }

    #[test]
    fn and_or_e_negazione_sono_scritti_una_volta_sola() {
        // (a,b) AND (b,c) = b
        let clausola = QueryClause {
            all: vec![some(&["a.md", "b.md"]), some(&["b.md", "c.md"])],
        };
        assert_eq!(ids(Finto.clause(&clausola).unwrap()), vec!["b.md"]);

        // (a) OR (c) = a,c — e l'ordine è quello dei DocId, non quello di
        // scrittura: senza, la seconda pagina di una risposta non combacia.
        let unione = QueryExpr {
            any: vec![
                QueryClause {
                    all: vec![some(&["c.md"])],
                },
                QueryClause {
                    all: vec![some(&["a.md"])],
                },
            ],
        };
        assert_eq!(ids(Finto.expr(&unione).unwrap()), vec!["a.md", "c.md"]);

        // NOT (a,b,c,d) = e — il complemento è rispetto all'universo di chi
        // valuta, che è l'unica risposta possibile a "tutto tranne".
        let negata = QueryExpr {
            any: vec![QueryClause {
                all: vec![QueryLiteral {
                    negated: true,
                    predicate: QueryPredicate::Docs {
                        docs: ["a.md", "b.md", "c.md", "d.md"].map(doc).to_vec(),
                    },
                }],
            }],
        };
        assert_eq!(ids(Finto.expr(&negata).unwrap()), vec!["e.md"]);
    }

    #[test]
    fn un_and_gia_vuoto_non_interroga_il_resto() {
        // Il secondo letterale è un predicato che questo valutatore NON sa
        // servire: se venisse interrogato, il test sarebbe un errore invece che
        // un insieme vuoto.
        let clausola = QueryClause {
            all: vec![
                some(&[]),
                QueryLiteral {
                    negated: false,
                    predicate: QueryPredicate::Property {
                        filter: PropertyFilter {
                            key: "x".into(),
                            test: PropertyTest::Exists,
                        },
                    },
                },
            ],
        };
        assert!(Finto.clause(&clausola).unwrap().is_empty());
    }

    #[test]
    fn una_query_attraversa_il_json_come_la_manda_la_shell() {
        let expr = QueryExpr {
            any: vec![QueryClause {
                all: vec![
                    QueryLiteral {
                        negated: false,
                        predicate: QueryPredicate::Text(TextQuery::terms("rust async")),
                    },
                    QueryLiteral {
                        negated: true,
                        predicate: QueryPredicate::Tag {
                            name: "archivio".into(),
                            descendants: true,
                        },
                    },
                ],
            }],
        };
        let json = serde_json::to_string(&expr).expect("una query è JSON, o non arriva a nessuno");
        assert_eq!(
            serde_json::from_str::<QueryExpr>(&json).unwrap(),
            expr,
            "round-trip: è la stessa serializzazione che attraversa l'IPC"
        );
        assert!(
            json.contains("\"kind\":\"text\""),
            "tag adiacente, non nudo"
        );
    }
}
