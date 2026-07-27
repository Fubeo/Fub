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
//!   ([`fubmd_abi::query`]) rende necessario e possibile: una domanda ha foglie
//!   di proprietari diversi, e qualcuno deve decidere chi valuta cosa e come si
//!   ricompone.
//!
//! [`IndexQuery`]: fubmd_abi::traits::IndexQuery

pub(crate) mod core;
pub mod plan;
pub(crate) mod routing;

use std::sync::Arc;

use fubmd_abi::model::{DocId, DocumentModel};
use fubmd_abi::traits::{IndexProvider, IndexQuery, IndexResult};
use fubmd_abi::PluginError;

pub(crate) use core::CoreIndex;
pub use routing::RouteConflict;
pub(crate) use routing::{RouteTable, Target};

use crate::providers::ProviderTable;
use crate::registry::FormatRegistry;

/// Gli indici del workspace: quello del kernel, quelli registrati, e la tabella
/// che dice a chi va cosa.
///
/// È uno dei cinque componenti in cui il §8.1 scompone il `Workspace`
/// ([decisione 0022](../../../docs/decisions/0022-il-kernel-a-pezzi.md)) — il
/// primo ad avere avuto un confine, con la 0019 — ed è tenuto insieme qui
/// perché le tre parti non hanno senso separate: una tabella di routing senza un core index che si dichiara come
/// gli altri instraderebbe due varianti su nove.
pub(crate) struct Indexes {
    /// L'indice del kernel: metadati, tag, grafo. È `Target::Core` nella
    /// tabella, ed è registrato **per primo** — che è ciò che gli dà la
    /// precedenza sulle foglie che sa valutare, non un privilegio nel codice.
    pub(crate) core: CoreIndex,
    /// Gli indici registrati, col proprio id (che è anche il loro spazio dati).
    pub(crate) providers: ProviderTable<(String, Box<dyn IndexProvider>)>,
    pub(crate) routes: RouteTable,
}

impl Indexes {
    pub(crate) fn new(registry: Arc<FormatRegistry>) -> Self {
        let core = CoreIndex::new(registry);
        let mut routes = RouteTable::default();
        routes
            .declare(Target::Core, &core.routes())
            .expect("la tabella è vuota: il primo a dichiarare non può confliggere");
        Indexes {
            core,
            providers: ProviderTable::new(),
            routes,
        }
    }

    /// Un indice in più, con ciò che ha dichiarato di servire.
    pub(crate) fn declare(
        &mut self,
        id: &str,
        index: &dyn IndexProvider,
    ) -> Result<Target, RouteConflict> {
        let target = Target::Provider(self.providers.len());
        self.routes
            .declare(target, &index.routes())
            .map_err(|mut c| {
                c.challenger = id.to_string();
                c
            })?;
        Ok(target)
    }

    /// Come [`declare`](Indexes::declare), ma **sostituendo** chi rivendicava le
    /// stesse famiglie. È l'operazione che il dispatch per tentativi faceva
    /// senza dirlo (vinceva chi si era registrato prima, e nessuno lo sapeva):
    /// resta possibile, ma adesso chi la vuole la chiede per nome.
    pub(crate) fn declare_replacing(&mut self, index: &dyn IndexProvider) -> Target {
        let target = Target::Provider(self.providers.len());
        self.routes.replace(target, &index.routes());
        target
    }

    /// Toglie gli indici di un plugin e li restituisce ancora **vivi**, perché
    /// chi li ha tolti deve poterli chiudere (§9.2: `flush` e poi `close`
    /// vogliono un host, e questo componente non ne ha uno).
    ///
    /// Le rotte seguono: quelle di chi se n'è andato spariscono, quelle di chi
    /// resta si spostano con lui ([`RouteTable::retarget`]).
    pub(crate) fn remove(&mut self, plugin: &str) -> Vec<(String, Box<dyn IndexProvider>)> {
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

    /// Un documento indicizzato va all'indice del kernel e poi a tutti quelli
    /// registrati.
    ///
    /// I registrati passano dalla rete contro i panici (§9.3): questo giro è
    /// dentro **ogni scrittura**, cioè sotto il prestito esclusivo di chi ha
    /// chiamato, e un indice che pania su un documento strano si porterebbe via
    /// il vault invece che sé stesso. Il kernel non ha come dirglielo — la firma
    /// non rende niente — quindi il panico si ferma e si racconta, come l'errore
    /// di un handler. L'indice del kernel **non** è in rete: se pania lui è un
    /// difetto del kernel, e nasconderlo vorrebbe dire cercarlo poi in un vault
    /// che risponde a metà.
    pub(crate) fn on_document_indexed(&mut self, model: &DocumentModel) {
        self.core.on_document_indexed(model);
        for (id, index) in self.providers.iter_mut() {
            crate::safety::notifying(id, "indicizzando un documento", || {
                index.on_document_indexed(model)
            });
        }
    }

    pub(crate) fn on_document_removed(&mut self, id: &DocId) {
        self.core.on_document_removed(id);
        for (plugin, index) in self.providers.iter_mut() {
            crate::safety::notifying(plugin, "togliendo un documento", || {
                index.on_document_removed(id)
            });
        }
    }

    pub(crate) fn reconcile(&mut self, ids: &[DocId]) {
        self.core.reconcile(ids);
        for (_, index) in self.providers.iter_mut() {
            index.reconcile(ids);
        }
    }

    /// Interroga: il **percorso unico** di dispatch (vedi [`plan`]).
    pub(crate) fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        plan::run(self, query)
    }

    /// Chi risponderebbe a questa domanda, e come. Non attraversa il contratto —
    /// l'explain plan che 9.2 vorrà mostrare è un'altra cosa, con altri clienti
    /// — ma è ciò che rende il routing **provabile** invece che descritto: un
    /// test può dire «questa query va a tantivy, quest'altra la ricompone il
    /// kernel», ed è la stessa domanda che un profiler farà.
    pub(crate) fn plan_of(&self, query: &IndexQuery) -> plan::QueryPlan {
        plan::explain(self, query)
    }

    /// L'indice a cui punta un bersaglio (il core non ha un id di plugin).
    pub(crate) fn at(&self, target: Target) -> Option<&dyn IndexProvider> {
        match target {
            Target::Core => Some(&self.core),
            Target::Provider(at) => self.providers.get(at).map(|(_, p)| p.as_ref()),
        }
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
pub const CORE_ID: &str = "fubmd.core";
