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
//!    chi implementa un indice. Per la stessa ragione la **coda** — ordine,
//!    colonne, finestra — è [`fub_abi::rules::properties::finish`]: la chiama
//!    chiunque rivendichi `Documents`, e dal kernel ci si passa da un punto
//!    solo — `CoreIndex::finish_documents` — perché quella coda vuole anche i
//!    formati di data che il vault dichiara (decisione 0108) e due chiamanti
//!    che se li passano per conto loro sono due risposte diverse alla stessa
//!    domanda.
//!
//! Quando una domanda porta un'espressione ma la serve **un altro** (i tag di un
//! sottoinsieme, i vicini di una selezione), ciò che quel destinatario non
//! saprebbe valutare viene **risolto prima** e sostituito con
//! [`QueryPredicate::Docs`]: chi la riceve non deve sapere da quale domanda
//! venisse.

use std::cell::RefCell;

use fub_abi::model::DocId;
use fub_abi::query::{
    Matches, QueryClause, QueryEvaluator, QueryExpr, QueryLiteral, QueryPredicate,
};
use fub_abi::traits::{
    DocumentMatch, Excerpts, IndexQuery, IndexResult, Page, PredicateKind, PropertySelect,
    PropertySort, QueryKind,
};
use fub_abi::PluginError;

use super::{Indexes, Target};

/// Il percorso di dispatch, che è **uno**.
pub(crate) fn run(indexes: &Indexes, query: IndexQuery) -> Result<IndexResult, PluginError> {
    let kind = query.kind();
    match indexes.routes.owner(&kind) {
        // Qualcuno ha dichiarato questa famiglia: gli si consegna la domanda,
        // con l'espressione già risolta per ciò che non saprebbe valutare.
        Some(target) => {
            let query = resolve_for(indexes, target, query)?;
            indexes
                .query_at(target, query)
                .ok_or_else(|| PluginError::Unserved(format!("{kind:?}").into()))?
        }
        // Nessuno: la sola famiglia che il kernel sa comporre da sé è
        // `Documents`, perché comporla È il pianificatore.
        None => match query {
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
                excerpts,
            } => documents(indexes, matching, sort, select, page, excerpts),
            other => Err(PluginError::Unserved(describe(&other).into())),
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
    excerpts: Excerpts,
) -> Result<IndexResult, PluginError> {
    let router = Router::new(indexes);

    // Pushdown intero: una sola clausola, un solo valutatore, e niente che
    // questo modulo debba aggiungere dopo. Vale **solo verso il core**, e la
    // restrizione è la coda di [`CoreIndex::finish_documents`].
    //
    // La coda di una risposta a `Documents` — ordine, colonne, finestra — è del
    // contratto (decisione 0020): a pari rilevanza la parità si rompe per
    // `DocId`, perché serve un ordine totale e stabile o una risposta paginata
    // ripete e salta righe fra una pagina e l'altra. Il core quella coda la
    // applica (è `finish` che chiama); un indice di terzi no — tantivy rompe la
    // parità per indirizzo di segmento, che non è l'ordine dei `DocId` e cambia
    // quando i segmenti si fondono. Consegnargli anche la **finestra** vorrebbe
    // dire lasciargli scegliere quali righe stanno nella pagina con un ordine
    // che il contratto non promette, e la divergenza sarebbe muta.
    //
    // Il prezzo è che una ricerca pura materializza tutti i suoi risultati
    // invece di farsi impaginare da tantivy. Non è un costo nuovo: è quello che
    // ogni domanda mista già paga, perché `Router::ask` chiede senza finestra.
    // È un costo di **selezione**, e resta; quello che non resta è che chi
    // seleziona debba anche *raccontare* ogni riga che sta per essere buttata —
    // vedi `Router::ask` e [`rehydrate`] (§21.9).
    if only_evaluator(indexes, matching.predicates()) == Some(Target::Core) {
        return indexes
            .query_at(
                Target::Core,
                IndexQuery::Documents {
                    matching,
                    sort,
                    select,
                    page,
                    excerpts,
                },
            )
            .expect("il bersaglio core esiste sempre");
    }

    let matches = router.expr(&matching)?;
    let mut answer = indexes
        .core
        .finish_documents(matches, sort.as_ref(), &select, page);
    if excerpts.wanted() {
        rehydrate(indexes, &router.asked.borrow(), &mut answer.items)?;
    }
    Ok(IndexResult::Documents(answer))
}

/// Gli estratti delle righe **rimaste**, chiesti a chi li sa fare.
///
/// È la seconda metà della §21.9, e la prima è in [`Router::ask`]: chi
/// seleziona non genera estratti, perché non sa ancora quali righe
/// sopravvivranno alla finestra. Qui le righe si sanno — sono venti, non
/// duemila — e si torna da chi ha valutato la foglia di testo con la stessa
/// espressione ristretta a quei documenti.
///
/// La mossa non è nuova: è quella che il pianificatore fa già in
/// [`resolve_for`] — un'espressione che il destinatario non saprebbe valutare
/// diventa [`QueryPredicate::Docs`] — applicata **dopo** invece che prima. Ed è
/// la stessa disciplina con cui il kernel aggiunge le occorrenze
/// (`Workspace::localize`, §21.3): si arricchisce la pagina, non il vault.
fn rehydrate(
    indexes: &Indexes,
    asked: &[(Target, QueryExpr)],
    rows: &mut [DocumentMatch],
) -> Result<(), PluginError> {
    if rows.is_empty() || asked.is_empty() {
        return Ok(());
    }
    let docs: Vec<DocId> = rows.iter().map(|row| row.doc.clone()).collect();
    for (target, expr) in asked {
        let Some(answer) = indexes.query_at(
            *target,
            IndexQuery::Documents {
                matching: narrowed(expr, &docs),
                sort: None,
                select: PropertySelect::None,
                page: None,
                excerpts: Excerpts::Attach,
            },
        ) else {
            continue;
        };
        let answer = answer?;
        // In `Matches`, non in una `BTreeMap` nuda: un provider può rispondere
        // con **due righe per lo stesso documento** — un indice a segmenti ne
        // emette una per segmento — e con un `.collect()` sulla mappa la
        // seconda cancellava la prima in silenzio, portandosi via le occorrenze
        // dell'altro segmento. `Matches::insert` passa da
        // `DocumentMatch::absorb`, che è dove sta scritto come si fondono
        // rilevanza, estratto, proprietà e occorrenze (decisione 0049).
        let mut told: Matches = answer.documents()?.items.into_iter().collect();
        for row in rows.iter_mut() {
            if let Some(m) = told.take(&row.doc) {
                row.absorb(m);
            }
        }
    }
    Ok(())
}

/// La stessa espressione, ristretta a un insieme di documenti.
///
/// Il letterale in più va in **ogni** clausola, perché le clausole sono in OR:
/// aggiungerlo a una sola restringerebbe quel ramo e lascerebbe gli altri
/// liberi di riportare indietro il vault.
fn narrowed(expr: &QueryExpr, docs: &[DocId]) -> QueryExpr {
    let restriction = QueryLiteral {
        negated: false,
        predicate: QueryPredicate::Docs {
            docs: docs.to_vec(),
        },
    };
    QueryExpr {
        any: expr
            .any
            .iter()
            .map(|clause| {
                let mut all = clause.all.clone();
                all.push(restriction.clone());
                QueryClause { all }
            })
            .collect(),
    }
}

/// Il valutatore che sa **instradare**: ogni foglia al suo proprietario, la
/// struttura al contratto.
struct Router<'a> {
    indexes: &'a Indexes,
    /// Cosa è stato chiesto **a chi**, per le sole espressioni che portano una
    /// foglia di testo — cioè le sole che avrebbero un estratto da dare.
    ///
    /// Serve perché la domanda si fa in due tempi (§21.9): qui si seleziona, e
    /// gli estratti si chiedono dopo la finestra, a chi ha selezionato. Senza
    /// questo elenco il secondo tempo dovrebbe indovinare il destinatario, o
    /// ricominciare dal routing con una domanda diversa da quella che ha
    /// prodotto le righe.
    ///
    /// `RefCell` perché [`QueryEvaluator`] valuta con `&self`: il valutatore è
    /// un lettore per il contratto, e ciò che si annota qui non è un risultato —
    /// è la traccia di chi è stato interrogato.
    asked: RefCell<Vec<(Target, QueryExpr)>>,
}

impl<'a> Router<'a> {
    fn new(indexes: &'a Indexes) -> Self {
        Router {
            indexes,
            asked: RefCell::new(Vec::new()),
        }
    }
}

impl Router<'_> {
    /// Chiede a un indice i documenti di un'espressione che gli appartiene.
    ///
    /// **Senza estratti**: qui si sta selezionando, e quali righe resteranno lo
    /// deciderà la finestra di `CoreIndex::finish_documents`. Chiederli adesso vorrebbe
    /// dire farne uno per ogni documento che combacia — misurato: duemila
    /// estratti per mostrarne venti, ventuno millisecondi su ventitré (§21.9).
    /// Li richiede [`rehydrate`], quando le righe sono quelle vere.
    fn ask(&self, target: Target, matching: QueryExpr) -> Result<Matches, PluginError> {
        if matching
            .predicates()
            .any(|p| matches!(p, QueryPredicate::Text(_)))
        {
            self.asked.borrow_mut().push((target, matching.clone()));
        }
        let answer = self
            .indexes
            .query_at(
                target,
                IndexQuery::Documents {
                    matching,
                    sort: None,
                    select: PropertySelect::None,
                    page: None,
                    excerpts: Excerpts::Omit,
                },
            )
            .ok_or_else(|| {
                PluginError::Unserved("index disappeared from the route table".to_string().into())
            })??;
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
                PluginError::Unserved(
                    format!("nobody knows how to evaluate this leaf: {kind:?}").into(),
                )
            })?;
        self.ask(target, QueryExpr::of(predicate.clone()))
    }

    /// Il pushdown di clausola: se **uno solo** sa valutare tutte le foglie di
    /// questa clausola, gliela si consegna intera invece di ricomporla qui.
    fn clause(&self, clause: &QueryClause) -> Result<Matches, PluginError> {
        if clause.all.len() > 1 {
            if let Some(target) = only_evaluator(self.indexes, clause.predicates()) {
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
fn only_evaluator<'a>(
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
    // «Ogni documento» si consegna **detto in quel modo**, non con l'albero da
    // cui è venuto: una clausola vuota in OR rende l'espressione tutta, ma le
    // foglie che le stanno accanto restano di chi le sa valutare, e il
    // destinatario si troverebbe a dover valutare una foglia che non ha
    // dichiarato. Rispondeva `Unserved` a una domanda la cui risposta è tutto.
    if expr.is_everything() {
        return Ok(query.with_expression(QueryExpr::all()));
    }
    let router = Router::new(indexes);
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
        IndexQuery::Custom { ns, .. } => format!("`{ns}` extension of the data channel"),
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
                if let Some(target) = only_evaluator(indexes, clause.predicates()) {
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
