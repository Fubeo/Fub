//! Il **pianificatore**: chi valuta cosa, e come si ricompone.
//!
//! È la parte che il linguaggio delle query rende insieme necessaria e
//! possibile. Necessaria: una domanda come «le note `tipo: progetto` che parlano
//! di rust e non stanno in Archivio» ha tre foglie e due proprietari — il testo
//! lo sa solo chi indicizza il corpo, il frontmatter e le cartelle li sa il
//! kernel — e finché la query era una stringa opaca quel join non era
//! esprimibile, quindi non c'era niente da pianificare. Possibile: le foglie
//! hanno un proprietario **dichiarato**, quindi la scelta è una lettura di
//! tabella e non un tentativo.
//!
//! # Le tre regole, in ordine di precedenza
//!
//! 1. **Chi ha dichiarato la famiglia la serve.** Se qualcuno rivendica
//!    `QueryKind::Documents` è il motore delle query e riceve la domanda intera:
//!    è il modo in cui si cambia motore senza toccare il kernel.
//! 2. **Il pushdown.** Se ogni foglia di una clausola è valutabile da uno solo,
//!    la clausola gli va **intera**: chi indicizza il testo conosce anche
//!    cartelle e tag (li ha indicizzati apposta), e mandargli `testo AND
//!    cartella` come due domande da intersecare a mano vorrebbe dire buttare via
//!    il filtro dentro il motore — cioè il totale e le pagine veri, che è ciò
//!    che la decisione 0005 aveva costruito con l'ambito.
//! 3. **Altrimenti si ricompone qui**, foglia per foglia, con le combinazioni
//!    che stanno nel contratto ([`QueryEvaluator`]) e non in questo modulo:
//!    quello che AND e OR significano non deve poter divergere fra il kernel e
//!    chi implementa un indice.
//!
//! Quando una domanda porta un'espressione ma la serve **un altro** (i tag di un
//! sottoinsieme, i vicini di una selezione), ciò che quel destinatario non
//! saprebbe valutare viene **risolto prima** e sostituito con
//! [`QueryPredicate::Docs`]: chi la riceve non deve sapere da quale domanda
//! venisse.

use fubmd_abi::model::{DocId, Frontmatter};
use fubmd_abi::query::{
    Matches, QueryClause, QueryEvaluator, QueryExpr, QueryLiteral, QueryPredicate,
};
use fubmd_abi::traits::{
    DocumentMatch, IndexQuery, IndexResult, Page, Paged, PredicateKind, PropertySelect,
    PropertySort, QueryKind,
};
use fubmd_abi::PluginError;

use super::{Indexes, Target};
use crate::properties;

/// Il percorso di dispatch, che è **uno**.
pub(crate) fn run(indexes: &Indexes, query: IndexQuery) -> Result<IndexResult, PluginError> {
    let kind = query.kind();
    match indexes.routes.owner(&kind) {
        // Qualcuno ha dichiarato questa famiglia: gli si consegna la domanda,
        // con l'espressione già risolta per ciò che non saprebbe valutare.
        Some(target) => {
            let query = resolve_for(indexes, target, query)?;
            let index = indexes
                .at(target)
                .ok_or_else(|| PluginError::Unserved(format!("{kind:?}")))?;
            index.query(query)
        }
        // Nessuno: la sola famiglia che il kernel sa comporre da sé è
        // `Documents`, perché comporla È il pianificatore.
        None => match query {
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
            } => documents(indexes, matching, sort, select, page),
            other => Err(PluginError::Unserved(describe(&other))),
        },
    }
}

/// I documenti che combaciano, ricomposti da chi sa valutare le foglie.
fn documents(
    indexes: &Indexes,
    matching: QueryExpr,
    sort: Option<PropertySort>,
    select: PropertySelect,
    page: Option<Page>,
) -> Result<IndexResult, PluginError> {
    let router = Router { indexes };

    // Pushdown intero: una sola clausola, un solo valutatore, e niente che
    // questo modulo debba aggiungere dopo. È il percorso della ricerca pura, ed
    // è quello che tiene la paginazione alla sorgente (tantivy pagina meglio di
    // chi lo interroga: la pagina 40 non costa come le prime 40 insieme).
    if let Some(target) = sole_evaluator(indexes, matching.predicates()) {
        let pushable = target == Target::Core || (sort.is_none() && select.is_none());
        if pushable {
            let index = indexes
                .at(target)
                .expect("il bersaglio viene dalla tabella delle rotte");
            return index.query(IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
            });
        }
    }

    let matches = router.expr(&matching)?;
    Ok(IndexResult::Documents(finish(
        matches,
        sort.as_ref(),
        &select,
        page,
        |id| indexes.core.frontmatter(id),
    )))
}

/// Impagina, ordina e completa una risposta a `Documents`.
///
/// Sta qui e non in due posti perché la chiamano in due — il pianificatore
/// quando ricompone, e l'indice del kernel quando la domanda gli arriva intera —
/// e due implementazioni divergerebbero sul caso che nessuno prova: l'ordine di
/// chi non ha la chiave di ordinamento, o quello fra due documenti a pari
/// rilevanza.
pub(crate) fn finish<'a>(
    matches: Matches,
    sort: Option<&PropertySort>,
    select: &PropertySelect,
    page: Option<Page>,
    frontmatter: impl Fn(&DocId) -> Option<&'a Frontmatter>,
) -> Paged<DocumentMatch> {
    let mut rows = matches.into_vec();

    if !select.is_none() {
        for row in rows.iter_mut() {
            if let Some(fm) = frontmatter(&row.doc) {
                row.properties = properties::entries(fm, select);
            }
        }
    }

    match sort {
        // Senza chiave: prima la rilevanza (chi ha cercato si aspetta i
        // risultati migliori in cima), poi l'id. Chi non ha rilevanza va in
        // fondo, come chi non ha la chiave di ordinamento.
        None => rows.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.doc.cmp(&b.doc))
        }),
        Some(sort) => rows.sort_by(|a, b| {
            let av = frontmatter(&a.doc).and_then(|fm| fm.property(&sort.key));
            let bv = frontmatter(&b.doc).and_then(|fm| fm.property(&sort.key));
            properties::order_of(av.as_ref(), bv.as_ref(), sort.descending)
                .then_with(|| a.doc.cmp(&b.doc))
        }),
    }

    Paged::window(rows, page)
}

/// Il valutatore che sa **instradare**: ogni foglia al suo proprietario, la
/// struttura al contratto.
struct Router<'a> {
    indexes: &'a Indexes,
}

impl Router<'_> {
    /// Chiede a un indice i documenti di un'espressione che gli appartiene.
    fn ask(&self, target: Target, matching: QueryExpr) -> Result<Matches, PluginError> {
        let index = self
            .indexes
            .at(target)
            .ok_or_else(|| PluginError::Unserved("indice sparito dalla tabella".to_string()))?;
        let answer = index.query(IndexQuery::Documents {
            matching,
            sort: None,
            select: PropertySelect::None,
            page: None,
        })?;
        Ok(answer.documents()?.items.into_iter().collect())
    }
}

impl QueryEvaluator for Router<'_> {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.indexes.core.documents()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        let Some(kind) = PredicateKind::of(predicate) else {
            // `Docs` non ha proprietario: è già una risposta.
            return self.indexes.core.predicate(predicate);
        };
        let target = *self
            .indexes
            .routes
            .evaluators(&kind)
            .first()
            .ok_or_else(|| {
                PluginError::Unserved(format!("nessuno sa valutare questa foglia: {kind:?}"))
            })?;
        self.ask(target, QueryExpr::of(predicate.clone()))
    }

    /// Il pushdown di clausola: se **uno solo** sa valutare tutte le foglie di
    /// questa clausola, gliela si consegna intera invece di ricomporla qui.
    fn clause(&self, clause: &QueryClause) -> Result<Matches, PluginError> {
        if clause.all.len() > 1 {
            if let Some(target) = sole_evaluator(self.indexes, clause.predicates()) {
                return self.ask(
                    target,
                    QueryExpr {
                        any: vec![clause.clone()],
                    },
                );
            }
        }
        default_clause(self, clause)
    }
}

/// L'AND dei letterali, che è il default del contratto. Estratto perché
/// [`Router::clause`] lo usa come ripiego e un default di trait non si può
/// richiamare dall'override.
fn default_clause<E: QueryEvaluator + ?Sized>(
    evaluator: &E,
    clause: &QueryClause,
) -> Result<Matches, PluginError> {
    let mut acc: Option<Matches> = None;
    for literal in &clause.all {
        if acc.as_ref().is_some_and(|m| m.is_empty()) {
            break;
        }
        let next = evaluator.literal(literal)?;
        acc = Some(match acc {
            None => next,
            Some(so_far) => so_far.and(next),
        });
    }
    match acc {
        Some(matches) => Ok(matches),
        None => evaluator.universe(),
    }
}

/// L'unico indice che sa valutare **tutte** queste foglie, se c'è.
///
/// L'ordine è quello di registrazione, e l'indice del kernel è il primo: fra due
/// che sanno rispondere la stessa cosa vince chi c'era prima, che è l'unica
/// regola che non dipende da quale plugin è stato installato per ultimo.
fn sole_evaluator<'a>(
    indexes: &Indexes,
    predicates: impl Iterator<Item = &'a QueryPredicate>,
) -> Option<Target> {
    let mut candidates: Option<Vec<Target>> = None;
    let mut any = false;
    for predicate in predicates {
        any = true;
        let Some(kind) = PredicateKind::of(predicate) else {
            // `Docs` la legge chiunque: non restringe la scelta.
            continue;
        };
        let evaluators = indexes.routes.evaluators(&kind).to_vec();
        candidates = Some(match candidates {
            None => evaluators,
            Some(so_far) => so_far
                .into_iter()
                .filter(|t| evaluators.contains(t))
                .collect(),
        });
    }
    if !any {
        return None;
    }
    match candidates {
        // Solo foglie `Docs`: le sa leggere il kernel, che è il primo.
        None => Some(Target::Core),
        Some(remaining) => remaining.first().copied(),
    }
}

/// Sostituisce, dentro la query, i sottoalberi che il destinatario non saprebbe
/// valutare con i documenti che ne escono.
fn resolve_for(
    indexes: &Indexes,
    target: Target,
    query: IndexQuery,
) -> Result<IndexQuery, PluginError> {
    let Some(expr) = query.expression() else {
        return Ok(query);
    };
    if expr.is_everything() {
        return Ok(query);
    }
    let router = Router { indexes };
    let mut resolved = QueryExpr {
        any: Vec::with_capacity(expr.any.len()),
    };
    for clause in &expr.any {
        let mut all = Vec::with_capacity(clause.all.len());
        for literal in &clause.all {
            if can_evaluate(indexes, target, &literal.predicate) {
                all.push(literal.clone());
                continue;
            }
            let found = router.predicate(&literal.predicate)?;
            all.push(QueryLiteral {
                negated: literal.negated,
                predicate: QueryPredicate::Docs {
                    docs: found.ids().cloned().collect(),
                },
            });
        }
        resolved.any.push(QueryClause { all });
    }
    Ok(query.with_expression(resolved))
}

fn can_evaluate(indexes: &Indexes, target: Target, predicate: &QueryPredicate) -> bool {
    match PredicateKind::of(predicate) {
        // `Docs` la legge chiunque riceva un'espressione.
        None => true,
        Some(kind) => indexes.routes.evaluators(&kind).contains(&target),
    }
}

fn describe(query: &IndexQuery) -> String {
    match query {
        IndexQuery::Custom { ns, .. } => format!("estensione `{ns}` del canale dati"),
        other => format!("{:?}", other.kind()),
    }
}

// ---------------------------------------------------------------------------
// L'explain: cosa succederebbe, senza farlo succedere
// ---------------------------------------------------------------------------

/// Chi risponderebbe, e come.
///
/// Non attraversa il contratto: l'explain plan che 9.2 vorrà mostrare è
/// un'altra cosa, con altri clienti e un'altra forma. Questo serve a due cose
/// che valgono adesso — provare il routing invece di descriverlo, e dire in un
/// messaggio d'errore **chi** avrebbe dovuto rispondere.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueryPlan {
    /// La famiglia della domanda.
    pub kind: QueryKind,
    /// Chi la serve, se qualcuno.
    pub owner: Option<String>,
    /// I passi sulle foglie: cosa, a chi, e se è andato giù intero.
    pub steps: Vec<PlanStep>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanStep {
    pub what: String,
    pub evaluator: Option<String>,
    /// L'intera clausola è andata a un motore solo?
    pub pushed_down: bool,
}

pub(crate) fn explain(indexes: &Indexes, query: &IndexQuery) -> QueryPlan {
    let kind = query.kind();
    let owner = indexes.routes.owner(&kind).map(|t| indexes.name_of(t));
    let mut steps = Vec::new();
    if let Some(expr) = query.expression() {
        for clause in &expr.any {
            if clause.all.len() > 1 {
                if let Some(target) = sole_evaluator(indexes, clause.predicates()) {
                    steps.push(PlanStep {
                        what: clause
                            .predicates()
                            .map(name_of_predicate)
                            .collect::<Vec<_>>()
                            .join(" AND "),
                        evaluator: Some(indexes.name_of(target)),
                        pushed_down: true,
                    });
                    continue;
                }
            }
            for predicate in clause.predicates() {
                let evaluator = match PredicateKind::of(predicate) {
                    None => Some(indexes.name_of(Target::Core)),
                    Some(kind) => indexes
                        .routes
                        .evaluators(&kind)
                        .first()
                        .map(|t| indexes.name_of(*t)),
                };
                steps.push(PlanStep {
                    what: name_of_predicate(predicate),
                    evaluator,
                    pushed_down: false,
                });
            }
        }
    }
    QueryPlan { kind, owner, steps }
}

fn name_of_predicate(predicate: &QueryPredicate) -> String {
    match PredicateKind::of(predicate) {
        None => "docs".to_string(),
        Some(kind) => format!("{kind:?}").to_lowercase(),
    }
}
