//! Il **canale dati**: chi risponde a una query, e chi la instrada.
//!
//! Prima di questo modulo il kernel rispondeva da sé a sette varianti su nove
//! di [`IndexQuery`] — un `match` con dei `return` anticipati, dentro
//! `Workspace::query_index` — e solo le due rimanenti arrivavano al ciclo sui
//! provider registrati. Il canale era quindi «dati verso le view» per chiunque
//! ma «dati **da** chiunque» per due varianti su nove: grafo semantico,
//! proprietà calcolate, health score, indice dei task e citazioni avevano una
//! strada sola, `IndexQuery::Custom`, cioè un vocabolario privato accanto a
//! quello ufficiale che diceva la stessa cosa.
//!
//! Qui dentro ci sono le tre cose che lo chiudono, e sono una sola vista da tre
//! lati:
//!
//! - `CoreIndex` (interno) — le risposte del kernel sono **un provider**, registrato per
//!   primo. Non un ramo prima del ciclo: un `IndexProvider` come gli altri, che
//!   dichiara ciò che serve e che si può sostituire chiedendolo per nome.
//! - `RouteTable` (interno) — chi serve cosa è **dichiarato alla registrazione**, non
//!   scoperto interpellando in ordine finché uno non risponde `BadArgs`. Un
//!   conflitto si vede al montaggio, e «nessuno la serve» è distinguibile da
//!   «chi la serve ha fallito».
//! - [`plan`] — il pianificatore, che è ciò che il linguaggio delle query
//!   ([`fub_abi::query`]) rende necessario e possibile: una domanda ha foglie
//!   di proprietari diversi, e qualcuno deve decidere chi valuta cosa e come si
//!   ricompone.
//!
//! [`IndexQuery`]: fub_abi::traits::IndexQuery

pub(crate) mod core;
pub mod plan;
pub(crate) mod routing;

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::sync::Arc;

use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexLoss, IndexProvider, IndexQuery, IndexResult, VaultEntry};
use fub_abi::PluginError;

pub(crate) use core::CoreIndex;
pub use routing::RouteConflict;
pub(crate) use routing::{RouteTable, Target};

pub(crate) type SharedIndexProvider = Arc<crate::poison::SharedShelter<Box<dyn IndexProvider>>>;

/// Lascia andare una fotografia di handle senza alcuna guardia del provider.
///
/// L'ultimo `Arc` può eseguire il distruttore di un provider nativo. Anche
/// quello è codice esterno: deve cadere dentro la rete contro i panici, dopo
/// che l'eventuale guardia `read`/`write` della callback è già uscita.
pub(crate) fn release_handles(
    providers: Vec<(String, SharedIndexProvider)>,
) -> Result<(), PluginError> {
    crate::safety::external(
        "rilascio degli handle staccati degli indici",
        |message| PluginError::Internal(message.into()),
        || {
            drop(providers);
            Ok(())
        },
    )
}

thread_local! {
    static ACTIVE_INDEXES: RefCell<BTreeSet<usize>> = const { RefCell::new(BTreeSet::new()) };
}

/// La stessa istanza mutabile non può rientrare nel proprio lock. Il timbro è
/// locale al thread: altre istanze e chiamate concorrenti conservano il normale
/// protocollo dell'handle. Il Drop ripristina il frame anche dopo un panic.
pub(crate) struct IndexCall(usize, std::marker::PhantomData<std::rc::Rc<()>>);

impl IndexCall {
    pub(crate) fn enter(who: &str, provider: &SharedIndexProvider) -> Result<Self, PluginError> {
        let identity = Arc::as_ptr(provider) as usize;
        if ACTIVE_INDEXES.with(|active| active.borrow_mut().insert(identity)) {
            Ok(Self(identity, std::marker::PhantomData))
        } else {
            Err(PluginError::Conflict(
                format!("l'indice `{who}` è già in chiamata su questo thread").into(),
            ))
        }
    }
}

impl Drop for IndexCall {
    fn drop(&mut self) {
        ACTIVE_INDEXES.with(|active| active.borrow_mut().remove(&self.0));
    }
}

/// Attraversa la porta `query` di un indice con la stessa rete usata dagli
/// altri callback dei provider. La guardia dell'handle appartiene al provider,
/// non al workspace: se il callback panica, lo srotolamento la rilascia dentro
/// [`safety::calling`](crate::safety::calling) e al chiamante torna un errore.
pub(crate) fn query_handle(
    who: &str,
    provider: &SharedIndexProvider,
    query: IndexQuery,
) -> Result<IndexResult, PluginError> {
    let _call = IndexCall::enter(who, provider)?;
    let detail = format!("{:?}", query.kind());
    let provider = provider.read();
    crate::safety::calling(who, Gate::IndexQuery, &detail, || provider.query(query))
}

/// Una fotografia immutabile del routing e degli handle degli indici esterni.
///
/// Prepararla richiede soltanto una lettura breve del [`Workspace`](crate::Workspace);
/// eseguirla non richiede più il suo prestito. Il core viene fornito da chi
/// monta il workspace tramite [`plan::QueryCore`], così ogni accesso allo stato
/// locale può prendere una nuova guardia breve senza attraversare il confine di
/// un provider.
pub struct PreparedIndexQuery {
    routes: RouteTable,
    providers: Vec<(String, SharedIndexProvider)>,
    routing_generation: u64,
}

/// Risposta staccata che non conserva più alcun handle del provider.
pub struct CompletedIndexQuery {
    pub(crate) result: IndexResult,
    pub(crate) routing_generation: u64,
}

impl PreparedIndexQuery {
    /// Esegue il piano congelato. Le callback degli indici usano soltanto gli
    /// handle contenuti nella fotografia; poi li rilascia nella rete esterna,
    /// prima che il chiamante rientri nel workspace.
    pub fn invoke(
        mut self,
        core: &dyn plan::QueryCore,
        query: IndexQuery,
    ) -> Result<CompletedIndexQuery, PluginError> {
        let outcome = plan::run_detached(&self, core, query);
        let providers = std::mem::take(&mut self.providers);
        let released = release_handles(providers);
        match (outcome, released) {
            (_, Err(error)) | (Err(error), Ok(())) => Err(error),
            (Ok(result), Ok(())) => Ok(CompletedIndexQuery {
                result,
                routing_generation: self.routing_generation,
            }),
        }
    }
}

use crate::organization::OrganizationStore;
use crate::providers::ProviderTable;
use crate::registry::FormatRegistry;
use crate::safety::Gate;
use crate::settings::SharedSettings;

/// Gli indici del workspace: quello del kernel, quelli registrati, e la tabella
/// che dice a chi va cosa.
///
/// È uno dei cinque componenti in cui il §8.1 scompone il `Workspace`
/// ([decisione 0022](../../../../docs/decisions/README.md)) — il
/// primo ad avere avuto un confine, con la 0019 — ed è tenuto insieme qui
/// perché le tre parti non hanno senso separate: una tabella di routing senza un core index che si dichiara come
/// gli altri instraderebbe due varianti su nove.
/// **La rete contro i panici, per chi alimenta** (§9.3 + §20.1): un indice che
/// pania mentre riceve un lotto non si porta via la scrittura di chi ha
/// chiamato, e non sparisce nemmeno in silenzio — il lotto che gli era stato
/// dato torna indietro come perduto, a suo nome.
///
/// `ids` è ciò che va dichiarato perduto **se pania**, e i tre chiamanti lo
/// passano diverso perché la domanda è diversa: chi alimenta perde ciò che gli
/// è stato dato, chi riconcilia perde dei morti di cui non si conosce il nome
/// (vedi [`reconcile_handles`]).
fn feeding<'a>(
    who: &str,
    gate: Gate,
    ids: impl Iterator<Item = &'a DocId>,
    f: impl FnOnce() -> Vec<IndexLoss>,
) -> Vec<IndexLoss> {
    let mut lost = Vec::new();
    match crate::safety::reporting(who, gate, "", || lost = f()) {
        // Ciò che il provider aveva già raccolto prima di paniare **non** si
        // usa: dopo un panico il suo stato è ignoto, e un elenco parziale
        // direbbe «solo questi» proprio nel caso in cui non lo si può sapere.
        Some(fault) => ids
            .map(|id| IndexLoss::new(id.clone(), fault.clone()))
            .collect(),
        None => lost,
    }
}

pub(crate) fn feed_handles(
    providers: &[(String, SharedIndexProvider)],
    models: &[DocumentModel],
) -> Vec<IndexLoss> {
    let mut lost = Vec::new();
    for (id, provider) in providers {
        let _call = match IndexCall::enter(id, provider) {
            Ok(call) => call,
            Err(error) => {
                lost.extend(
                    models
                        .iter()
                        .map(|model| IndexLoss::new(model.id.clone(), error.clone())),
                );
                continue;
            }
        };
        let mut provider = provider.write();
        lost.extend(feeding(
            id,
            Gate::IndexFeed,
            models.iter().map(|model| &model.id),
            || provider.on_documents_indexed(models),
        ));
    }
    lost
}

pub(crate) fn forget_handles(
    providers: &[(String, SharedIndexProvider)],
    ids: &[DocId],
) -> Vec<IndexLoss> {
    let mut lost = Vec::new();
    for (who, provider) in providers {
        let _call = match IndexCall::enter(who, provider) {
            Ok(call) => call,
            Err(error) => {
                lost.extend(
                    ids.iter()
                        .map(|id| IndexLoss::new(id.clone(), error.clone())),
                );
                continue;
            }
        };
        let mut provider = provider.write();
        lost.extend(feeding(who, Gate::IndexForget, ids.iter(), || {
            provider.on_documents_removed(ids)
        }));
    }
    lost
}

/// Interroga gli indici registrati usando soltanto handle staccati dal
/// `Workspace`. Chi chiama può quindi rilasciare `Custody<Workspace>` prima di
/// attraversare il confine del provider.
pub(crate) fn up_to_date_handles(
    providers: &[(String, SharedIndexProvider)],
    entries: &[VaultEntry],
) -> BTreeSet<DocId> {
    let mut agreed: BTreeSet<DocId> = entries.iter().map(|entry| entry.id.clone()).collect();
    for (id, index) in providers {
        if agreed.is_empty() {
            break;
        }
        let Ok(_call) = IndexCall::enter(id, index) else {
            return BTreeSet::new();
        };
        let index = index.read();
        let theirs =
            crate::safety::calling(
                id,
                Gate::IndexUpToDate,
                "",
                || Ok(index.up_to_date(entries)),
            )
            .unwrap_or_default();
        let theirs: BTreeSet<&DocId> = theirs.iter().collect();
        agreed.retain(|doc| theirs.contains(doc));
    }
    agreed
}

/// Riconcilia gli indici registrati usando una fotografia dei loro handle. Il
/// core resta al chiamante: è stato locale del `Workspace` e si finalizza sotto
/// il suo lock solo dopo il ritorno delle callback esterne.
pub(crate) fn reconcile_handles(
    providers: &[(String, SharedIndexProvider)],
    ids: &[DocId],
) -> Vec<IndexLoss> {
    let mut lost = Vec::new();
    for (plugin, index) in providers {
        let _call = match IndexCall::enter(plugin, index) {
            Ok(call) => call,
            Err(error) => {
                lost.extend(
                    ids.iter()
                        .take(1)
                        .map(|id| IndexLoss::new(id.clone(), error.clone())),
                );
                continue;
            }
        };
        let mut index = index.write();
        lost.extend(feeding(
            plugin,
            Gate::IndexReconcile,
            ids.iter().take(1),
            || index.reconcile(ids),
        ));
    }
    lost
}

pub(crate) struct Indexes {
    /// L'indice del kernel: metadati, tag, grafo. È `Target::Core` nella
    /// tabella, ed è registrato **per primo** — che è ciò che gli dà la
    /// precedenza sulle foglie che sa valutare, non un privilegio nel codice.
    pub(crate) core: CoreIndex,
    /// Gli indici registrati, col proprio id (che è anche il loro spazio dati).
    pub(crate) providers: ProviderTable<(String, SharedIndexProvider)>,
    pub(crate) routes: RouteTable,
    /// Cambia ogni volta che una fotografia di routing diventa obsoleta.
    routing_generation: u64,
}

impl Indexes {
    pub(crate) fn new(
        registry: Arc<FormatRegistry>,
        settings: SharedSettings,
        organization: Arc<OrganizationStore>,
        drafts: Arc<crate::drafts::Drafts>,
    ) -> Self {
        let core = CoreIndex::new(registry, settings, organization, drafts);
        let mut routes = RouteTable::default();
        routes
            .declare(Target::Core, &core.routes())
            .expect("la tabella è vuota: il primo a dichiarare non può confliggere");
        Indexes {
            core,
            providers: ProviderTable::new(),
            routes,
            routing_generation: 0,
        }
    }

    /// Un indice in più, con le rotte già dichiarate fuori dal workspace.
    pub(crate) fn declare_routes(
        &mut self,
        id: &str,
        routes: &[fub_abi::traits::QueryRoute],
    ) -> Result<Target, RouteConflict> {
        let target = Target::Provider(self.providers.len());
        self.routes.declare(target, routes).map_err(|mut c| {
            c.challenger = id.to_string();
            c
        })?;
        self.routing_generation = self.routing_generation.wrapping_add(1);
        Ok(target)
    }

    /// Come [`declare_routes`](Indexes::declare_routes), ma **sostituendo** chi rivendicava le
    /// stesse famiglie. È l'operazione che il dispatch per tentativi faceva
    /// senza dirlo (vinceva chi si era registrato prima, e nessuno lo sapeva):
    /// resta possibile, ma adesso chi la vuole la chiede per nome.
    pub(crate) fn declare_replacing(&mut self, index: &dyn IndexProvider) -> Target {
        let target = Target::Provider(self.providers.len());
        self.routes.replace(target, &index.routes());
        self.routing_generation = self.routing_generation.wrapping_add(1);
        target
    }

    /// Toglie gli indici di un plugin e li restituisce ancora **vivi**, perché
    /// chi li ha tolti deve poterli chiudere (§9.2: `flush` e poi `close`
    /// vogliono un host, e questo componente non ne ha uno).
    ///
    /// Le rotte seguono: quelle di chi se n'è andato spariscono, quelle di chi
    /// resta si spostano con lui ([`RouteTable::retarget`]).
    pub(crate) fn remove(&mut self, plugin: &str) -> Vec<(String, SharedIndexProvider)> {
        let doomed: Vec<usize> = self
            .providers
            .iter()
            .enumerate()
            .filter(|(_, (id, _))| id == plugin)
            .map(|(at, _)| at)
            .collect();
        if doomed.is_empty() {
            return Vec::new();
        }
        // La nuova posizione di chi resta è la vecchia meno quanti se ne sono
        // andati prima di lui. Si calcola **prima** di togliere, o le posizioni
        // da tradurre non esisterebbero più.
        let moved = |target: Target| match target {
            Target::Core => Some(Target::Core),
            Target::Provider(at) if doomed.contains(&at) => None,
            Target::Provider(at) => Some(Target::Provider(
                at - doomed.iter().filter(|&&d| d < at).count(),
            )),
        };
        self.routes.retarget(&moved);
        self.routing_generation = self.routing_generation.wrapping_add(1);
        let mut removed = Vec::with_capacity(doomed.len());
        let mut kept = Vec::new();
        for (at, entry) in self.providers.take().into_iter().enumerate() {
            if doomed.contains(&at) {
                removed.push(entry);
            } else {
                kept.push(entry);
            }
        }
        for entry in kept {
            self.providers.push(entry);
        }
        removed
    }

    pub(crate) fn ensure_mutation_available(&self) -> crate::error::Result<()> {
        for (who, provider) in self.providers.iter() {
            let identity = Arc::as_ptr(provider) as usize;
            if ACTIVE_INDEXES.with(|active| active.borrow().contains(&identity)) {
                return Err(crate::error::KernelError::IndexReentry(who.clone()));
            }
        }
        Ok(())
    }

    /// Interroga: il **percorso unico** di dispatch (vedi [`plan`]).
    pub(crate) fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        plan::run(self, query)
    }

    /// Congela routing e handle prima che l'host lasci andare
    /// `Custody<Workspace>`. Nessun provider viene interrogato durante questa
    /// fase.
    pub(crate) fn prepare_query(&self) -> PreparedIndexQuery {
        PreparedIndexQuery {
            routes: self.routes.clone(),
            providers: self.feed_handles(),
            routing_generation: self.routing_generation,
        }
    }

    /// Una risposta preparata non si applica a una tabella di routing diversa:
    /// l'handle resta vivo grazie all'`Arc`, ma non è più il proprietario della
    /// domanda. Restituirne comunque la risposta renderebbe visibile stato di
    /// un provider ritirato o sostituito.
    pub(crate) fn ensure_query_is_current(
        &self,
        routing_generation: u64,
    ) -> Result<(), PluginError> {
        if routing_generation == self.routing_generation {
            return Ok(());
        }
        Err(PluginError::Conflict(
            "il routing degli indici è cambiato durante la query".into(),
        ))
    }

    pub(crate) fn routing_generation(&self) -> u64 {
        self.routing_generation
    }

    /// Le quattro query composte dal `Workspace` possono seguire la fast-path
    /// locale soltanto finché la loro rotta appartiene davvero al core. Una
    /// sostituzione esplicita le trasforma in callback esterne come ogni altra.
    pub(crate) fn query_owner_is_external(&self, query: &IndexQuery) -> bool {
        matches!(self.routes.owner(&query.kind()), Some(Target::Provider(_)))
    }

    /// Chi risponderebbe a questa domanda, e come. Non attraversa il contratto —
    /// l'explain plan che 9.2 vorrà mostrare è un'altra cosa, con altri clienti
    /// — ma è ciò che rende il routing **provabile** invece che descritto: un
    /// test può dire «questa query va a tantivy, quest'altra la ricompone il
    /// kernel», ed è la stessa domanda che un profiler farà.
    pub(crate) fn plan_of(&self, query: &IndexQuery) -> plan::QueryPlan {
        plan::explain(self, query)
    }

    pub(crate) fn query_at(
        &self,
        target: Target,
        query: IndexQuery,
    ) -> Option<Result<IndexResult, PluginError>> {
        match target {
            Target::Core => Some(self.core.query(query)),
            Target::Provider(at) => self
                .providers
                .get(at)
                .map(|(id, provider)| query_handle(id, provider, query)),
        }
    }

    pub(crate) fn feed_handles(&self) -> Vec<(String, SharedIndexProvider)> {
        self.providers
            .iter()
            .map(|(id, provider)| (id.clone(), Arc::clone(provider)))
            .collect()
    }

    /// Il nome con cui un bersaglio compare in un piano o in un errore.
    pub(crate) fn name_of(&self, target: Target) -> String {
        match target {
            Target::Core => CORE_ID.to_string(),
            Target::Provider(at) => self
                .providers
                .get(at)
                .map(|(id, _)| id.clone())
                .unwrap_or_else(|| "?".to_string()),
        }
    }
}

/// L'id dell'indice del kernel. Non è uno spazio dati (il core non persiste
/// niente per conto proprio: la sua verità è il vault), è il nome con cui
/// compare in un piano e in un conflitto di registrazione.
pub const CORE_ID: &str = "fub.core";
