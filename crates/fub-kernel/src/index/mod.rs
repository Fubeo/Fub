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

use std::collections::BTreeSet;
use std::sync::Arc;

use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexLoss, IndexProvider, IndexQuery, IndexResult, VaultEntry};
use fub_abi::PluginError;

pub(crate) use core::CoreIndex;
pub use routing::RouteConflict;
pub(crate) use routing::{RouteTable, Target};

use crate::organization::OrganizationStore;
use crate::providers::ProviderTable;
use crate::registry::FormatRegistry;
use crate::safety::Gate;
use crate::settings::SharedSettings;

/// Gli indici del workspace: quello del kernel, quelli registrati, e la tabella
/// che dice a chi va cosa.
///
/// È uno dei cinque componenti in cui il §8.1 scompone il `Workspace`
/// ([decisione 0022](../../../docs/decisions/0022-il-kernel-a-pezzi.md)) — il
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
/// (vedi [`Indexes::reconcile`]).
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

    /// Un lotto di documenti va all'indice del kernel e poi a tutti quelli
    /// registrati, e ciò che nessuno ha preso **torna indietro** (§20.1).
    ///
    /// I registrati passano dalla rete contro i panici (§9.3): questo giro è
    /// dentro **ogni scrittura**, cioè sotto il prestito esclusivo di chi ha
    /// chiamato, e un indice che pania su un documento strano si porterebbe via
    /// il vault invece che sé stesso. Un panico qui **è** una perdita, e adesso
    /// si dice come si dice ogni altra: chi pania alimentando non ha preso
    /// niente di ciò che gli era stato dato, quindi il lotto intero torna
    /// indietro a suo nome. Prima si fermava e finiva su `stderr`, che è il
    /// posto dove il §20.2 ha smesso di mandare le cose.
    ///
    /// L'indice del kernel **non** è in rete: se pania lui è un difetto del
    /// kernel, e nasconderlo vorrebbe dire cercarlo poi in un vault che
    /// risponde a metà.
    pub(crate) fn on_documents_indexed(&mut self, models: &[DocumentModel]) -> Vec<IndexLoss> {
        let mut lost = self.core.on_documents_indexed(models);
        for (id, index) in self.providers.iter_mut() {
            lost.extend(feeding(
                id,
                Gate::IndexFeed,
                models.iter().map(|m| &m.id),
                || index.on_documents_indexed(models),
            ));
        }
        lost
    }

    pub(crate) fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let mut lost = self.core.on_documents_removed(ids);
        for (plugin, index) in self.providers.iter_mut() {
            lost.extend(feeding(plugin, Gate::IndexForget, ids.iter(), || {
                index.on_documents_removed(ids)
            }));
        }
        lost
    }

    /// **Cosa hanno già tutti**, di queste voci (§14.2): l'intersezione delle
    /// risposte, non l'unione.
    ///
    /// L'intersezione perché un documento si salta solo se **nessuno** lo
    /// aspetta: basta un indice che non ce l'ha, e il kernel deve comunque
    /// leggerlo e parsarlo per darglielo — a quel punto tanto vale darlo a
    /// tutti, che è ciò che rende il salto un tutto-o-niente per documento e
    /// non una consegna a metà.
    ///
    /// Senza indici registrati l'intersezione è l'insieme intero, ed è la
    /// risposta giusta e non un caso limite: se nessuno aspetta niente, non
    /// c'è niente da rileggere per nessuno.
    ///
    /// Chi pania rispondendo non blocca l'apertura, e non fa nemmeno saltare
    /// niente: si porta via solo la propria risposta, che senza di lui è vuota
    /// — cioè «mandami tutto», che è il verso sicuro dello sbaglio.
    pub(crate) fn up_to_date(&self, entries: &[VaultEntry]) -> BTreeSet<DocId> {
        let mut agreed: BTreeSet<DocId> = entries.iter().map(|and| and.id.clone()).collect();
        for (id, index) in self.providers.iter() {
            if agreed.is_empty() {
                break;
            }
            let theirs = crate::safety::calling(id, Gate::IndexUpToDate, "", || {
                Ok(index.up_to_date(entries))
            })
            .unwrap_or_default();
            let theirs: BTreeSet<&DocId> = theirs.iter().collect();
            agreed.retain(|id| theirs.contains(id));
        }
        agreed
    }

    /// Chi non è riuscito ad allinearsi lo dice, e **nomina i morti che si
    /// tiene**: gli id che tornano di qui non stanno in `ids` — sono ciò che
    /// l'indice ha in più, cioè quello che avrebbe dovuto dimenticare.
    ///
    /// La rete contro i panici c'è come nell'alimentazione, ma ciò che torna
    /// indietro è **diverso**: chi pania riconciliando non ha lasciato indietro
    /// i documenti che gli sono stati dati (quelli ci sono), ha lasciato
    /// indietro dei morti di cui nessuno conosce il nome — nemmeno il kernel,
    /// che sa solo chi è vivo. La perdita si nomina quindi sul primo id del
    /// lotto se c'è, e su nessuno se il vault è vuoto: dice *quale indice* e
    /// *cosa è successo*, che è ciò su cui si può agire (riaprire il vault),
    /// e non finge di sapere un elenco che non esiste.
    pub(crate) fn reconcile(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        let mut lost = self.core.reconcile(ids);
        for (plugin, index) in self.providers.iter_mut() {
            lost.extend(feeding(
                plugin,
                Gate::IndexReconcile,
                ids.iter().take(1),
                || index.reconcile(ids),
            ));
        }
        lost
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
pub const CORE_ID: &str = "fub.core";
