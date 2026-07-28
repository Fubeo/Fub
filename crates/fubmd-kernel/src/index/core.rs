//! L'indice del **kernel**: metadati parsati, conteggi dei tag, grafo dei link.
//!
//! Queste risposte c'erano già. Non erano un indice: erano un `match` con dei
//! `return` anticipati in cima a `query_index`, e la conseguenza non era di
//! stile — sette varianti su nove non arrivavano a **nessun** provider
//! registrato, e nessuno se ne accorgeva leggendo il contratto. Un autore di
//! plugin vedeva nove varianti e ne poteva servire due.
//!
//! Adesso sono un [`IndexProvider`] come gli altri, registrato per primo. Cosa
//! cambia davvero, in tre punti:
//!
//! 1. **Il percorso di dispatch è uno.** Non «prima il kernel, poi il ciclo»:
//!    una tabella, e chi c'è dentro.
//! 2. **Il kernel non è più il primo rispondente non scavalcabile.** Chi vuole
//!    servire i tag o la salute del vault con un motore proprio lo dichiara, e
//!    la sostituzione si chiede per nome
//!    (`Workspace::replace_index_provider`) invece di essere impossibile.
//! 3. **Le regole escono da dietro un `match` privato** e diventano
//!    l'implementazione di un trait: si leggono, si provano, e a M5 si possono
//!    mettere alla prova contro la stessa conformance suite di un indice di
//!    terzi.
//!
//! Quello che **non** cambia è dove sta la verità: grafo e metadati restano del
//! kernel perché ne è l'unica fonte, e duplicarli dentro un altro indice
//! creerebbe una seconda verità che può divergere dalla prima. La differenza è
//! che adesso quella scelta è **dichiarata** — chi la volesse contraddire
//! troverebbe un conflitto di registrazione, non un ordine di montaggio che
//! decide in silenzio.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use fubmd_abi::model::{
    canonical_tag, DocId, DocumentModel, Frontmatter, Heading, Link, LinkTarget,
};
use fubmd_abi::query::{
    in_folder, parent_folder, within_folder, Matches, QueryEvaluator, QueryPredicate,
};
use fubmd_abi::rules::properties;
use fubmd_abi::traits::{
    EntryKind, FolderScope, HostApi, IndexProvider, IndexQuery, IndexResult, JobId, JobProgress,
    JobStatus, LinkDirection, Paged, PredicateKind, QueryKind, QueryRoute, VaultEntry, VaultFolder,
    VaultStatus,
};
use fubmd_abi::PluginError;

use crate::entries::StoredMeta;
use crate::graph::{GraphSource, LinkGraph};
use crate::health;
use crate::organization::OrganizationStore;
use crate::registry::FormatRegistry;
use crate::settings::SharedSettings;
use crate::tag_counts::TagCounts;
use crate::workspace::GraphUpdate;

/// I metadati di un documento tenuti in cache: identità, frontmatter (alias),
/// outline, link — ciò che le mutazioni devono mantenere e che grafo, canale
/// metadata e riscrittura dei link consumano.
///
/// Il **corpo** (albero dei blocchi) e il **testo piano** non ci sono: è lo
/// split metadata/body di M2. Il render li riparsa dal disco on demand — è
/// per-documento e su richiesta, mentre questa cache è per-vault e sempre
/// calda: tenerci dentro i corpi significava pagare la memoria dell'intero
/// vault per servire letture che il disco serve benissimo. I tag non ci sono
/// per lo stesso principio: il loro stato aggregato vive in [`TagCounts`],
/// mantenuto incrementalmente, e il contributo per-nota lo ricorda lui.
pub(crate) struct DocMeta {
    pub(crate) id: DocId,
    pub(crate) frontmatter: Frontmatter,
    pub(crate) outline: Vec<Heading>,
    pub(crate) links: Vec<Link>,
}

/// I metadati si prendono da un modello **prestato**, perché l'alimentazione è
/// quella di ogni indice (`&DocumentModel`) e non più un passaggio di proprietà
/// riservato al kernel. Il costo è la copia di frontmatter, outline e link — non
/// del corpo, che in cache non ci va: è lo split metadata/body, ed è ciò che
/// rende questa copia più piccola del modello che l'ha generata.
impl From<&DocumentModel> for DocMeta {
    fn from(model: &DocumentModel) -> Self {
        DocMeta {
            id: model.id.clone(),
            frontmatter: model.frontmatter.clone(),
            outline: model.outline.clone(),
            links: model.links.clone(),
        }
    }
}

impl GraphSource for DocMeta {
    fn graph_id(&self) -> &DocId {
        &self.id
    }

    fn graph_aliases(&self) -> Vec<String> {
        self.frontmatter.aliases()
    }

    fn graph_links(&self) -> &[Link] {
        &self.links
    }
}

pub(crate) struct CoreIndex {
    /// La cache dei metadati. È l'insieme dei documenti indicizzati:
    /// `contains_key` qui È «il workspace lo conosce».
    ///
    /// `BTreeMap` e non `HashMap`, ed è una conseguenza della finestra sulla
    /// lista documenti (§5.5): l'ordine ce l'ha per costruzione, quindi
    /// `list_documents` non riordina più il vault a ogni chiamata e una pagina
    /// si taglia dall'iteratore senza materializzare il resto. Il costo è un
    /// `log n` per lettura invece di un `1`, su una mappa che sta in RAM.
    pub(crate) metas: BTreeMap<DocId, DocMeta>,
    /// **L'anagrafe**: ogni file del vault, non solo le note (§14.1).
    ///
    /// È l'insieme di cui `metas` è il sottoinsieme dei documenti, e le due
    /// mappe non si fondono per la ragione per cui esistono entrambe: di un
    /// documento si sa cosa c'è dentro, di una voce si sa che c'è. Fondendole,
    /// ogni lettore dei metadati avrebbe dovuto chiedersi a ogni riga se quella
    /// nota è una nota.
    ///
    /// `BTreeMap` per l'ordine, come `metas` e per lo stesso motivo: è ciò che
    /// rende stabile una risposta paginata.
    pub(crate) entries: BTreeMap<DocId, VaultEntry>,
    /// **Le cartelle** (§14.3), come la camminata le ha viste.
    ///
    /// Un insieme di path e non una mappa di record: ciò che si sa di una
    /// cartella — quante sottocartelle ha, quanti file — si **conta** dalle due
    /// mappe ordinate quando qualcuno lo chiede, e costa il sottoalbero invece
    /// del vault. Tenerlo scritto vorrebbe dire mantenerlo a ogni file che
    /// nasce o muore, cioè un secondo conto che può divergere dal primo.
    ///
    /// Non si deduce dai path dei file, ed è il punto della voce: una cartella
    /// vuota non compare in nessun path e c'è lo stesso; una cartella che resta
    /// vuota perché la sua ultima nota è finita nel cestino resta lì, perché è
    /// ciò che è successo davvero sul disco.
    pub(crate) folders: BTreeSet<String>,
    /// I conteggi dei tag, mantenuti incrementalmente come il grafo: le
    /// interrogazioni sui tag rispondono da qui, senza O(vault).
    pub(crate) tags: TagCounts,
    pub(crate) graph: LinkGraph,
    pub(crate) graph_update: GraphUpdate,
    /// Serve a un controllo solo — distinguere un link a una nota da un
    /// riferimento a un allegato — ed è **condiviso** col workspace invece che
    /// copiato: due elenchi di estensioni sarebbero due idee di cosa è un
    /// documento, e la seconda mentirebbe in silenzio il giorno che i formati
    /// si registrano a caldo.
    registry: Arc<FormatRegistry>,
    /// Che rapporto ha questo vault con il disco (§9.7).
    ///
    /// Sta qui e non sul `Workspace` per la ragione della
    /// [0019](../../../../docs/decisions/0019-il-canale-dati.md): *le risposte
    /// del kernel sono un provider*, e questa è una risposta del kernel. Metterla
    /// sul workspace avrebbe voluto dire intercettare una variante **prima** del
    /// router — cioè rimettere il ramo privilegiato che quella decisione ha
    /// tolto.
    pub(crate) watch: WatchState,
    /// **Cosa sta girando adesso** (§10.3), per la stessa ragione della riga
    /// sopra: è una risposta del kernel, e le risposte del kernel sono un
    /// provider (decisione 0019).
    pub(crate) jobs: JobsState,
    /// **Com'è configurato questo vault** (§11.1), e per la terza volta la
    /// stessa ragione. È **condiviso** col workspace, come `registry`: lo
    /// riempie chi dichiara un plugin, lo scrive chi tocca un interruttore, e
    /// questo indice lo legge — una copia sarebbe una configurazione che
    /// risponde a com'era al montaggio.
    settings: SharedSettings,
    /// **Com'è organizzato questo vault** (§11.3): icone, appuntate,
    /// ordinamenti, spazi. Condiviso col workspace come `settings`, e per la
    /// stessa ragione — lo scrive chi appunta una nota, e questo indice lo
    /// legge; una copia risponderebbe con com'era al montaggio.
    ///
    /// Che sia qui è il guadagno di questa voce: prima l'organizzazione non era
    /// interrogabile affatto — la leggeva un comando IPC, quindi la sapeva
    /// chiedere la shell e nessun altro.
    organization: Arc<OrganizationStore>,
}

/// Il **file** che un path nomina dentro un'anagrafe, se c'è — di qualunque
/// specie (§14.1).
///
/// Funzione libera e non metodo perché il suo cliente non è solo l'indice: la
/// usa il controllo di salute, che riceve l'anagrafe e non chi la tiene.
pub(crate) fn resolve_entry_in(
    entries: &BTreeMap<DocId, VaultEntry>,
    source: &DocId,
    target: &LinkTarget,
) -> Option<DocId> {
    let raw = match target {
        // Un wikilink nomina un file **per nome**, come nomina una nota per
        // nome: `![[foto.png]]` è il modo in cui si incorpora un allegato.
        LinkTarget::Wiki { page, .. } => return named_entry_in(entries, page),
        LinkTarget::Path(raw) => raw,
        // Il mondo esterno non è nel vault.
        LinkTarget::Url(_) => return None,
    };
    let path = fubmd_abi::rules::path::resolve_against(source, raw)?;
    let id = DocId::new(path);
    if entries.contains_key(&id) {
        return Some(id);
    }
    // Ripiego, e non è pignoleria: macOS scrive i nomi dei file in NFD e i
    // link si digitano in NFC, quindi il confronto byte a byte manca
    // esattamente i nomi accentati. La chiave di risoluzione le riconcilia (è
    // la stessa regola con cui il grafo indicizza), e si paga solo quando il
    // confronto esatto ha già detto di no — cioè su un riferimento che sta per
    // essere dichiarato rotto.
    let key = fubmd_abi::rules::path::resolution_key(id.as_str());
    entries
        .keys()
        .find(|other| fubmd_abi::rules::path::resolution_key(other.as_str()) == key)
        .cloned()
}

/// Il file che un **nome** nomina, fra quelli che non sono documenti (§14.1).
///
/// La regola è quella dei wikilink fra note, e lo è di proposito: si confronta
/// la chiave di risoluzione (trim, NFC, minuscolo) contro il **nome del file
/// con la sua estensione** — che è come si scrive `![[foto.png]]` — o contro il
/// path intero, per chi disambigua scrivendolo. Fra omonimi vince il più vicino
/// alla radice, e a parità l'ordine dei path: la stessa regola del grafo, perché
/// due regole di risoluzione in un'app sola sono due risposte alla stessa
/// domanda.
///
/// I documenti restano fuori: quelli li risolve il grafo, che conosce anche gli
/// alias. Chi chiama prova prima lui.
pub(crate) fn named_entry_in(entries: &BTreeMap<DocId, VaultEntry>, name: &str) -> Option<DocId> {
    let wanted = fubmd_abi::rules::path::resolution_key(name);
    if wanted.is_empty() {
        return None;
    }
    entries
        .iter()
        .filter(|(_, entry)| entry.kind != EntryKind::Document)
        .map(|(id, _)| id)
        .filter(|id| {
            let key = fubmd_abi::rules::path::resolution_key(id.as_str());
            key == wanted
                || fubmd_abi::rules::path::resolution_key(file_name_of(id.as_str())) == wanted
        })
        // Il più vicino alla radice, e a parità il primo in ordine di path:
        // `BTreeMap` li offre già ordinati, quindi `min_by_key` è stabile.
        .min_by_key(|id| id.as_str().matches('/').count())
        .cloned()
}

/// Il nome di un file dentro il suo path.
fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Il primo path che può stare dentro `folder`, in una mappa ordinata per path.
///
/// I path di un sottoalbero sono **contigui** nell'ordine lessicografico, e
/// questa è la loro soglia: da qui in poi, finché il prefisso regge, c'è solo
/// roba di quella cartella. Per la radice è la stringa vuota, cioè tutto.
fn subtree_start(folder: &str) -> String {
    if folder.is_empty() {
        String::new()
    } else {
        format!("{folder}/")
    }
}

/// Quanti, fra i path ordinati che l'iteratore produce **a partire dalla
/// soglia** di `folder`, le stanno direttamente dentro.
///
/// Il `take_while` è ciò che rende il conto proporzionale al sottoalbero e non
/// al vault: appena il prefisso non regge più, il resto della mappa non si
/// guarda. Per la radice il prefisso è vuoto e si guarda tutto — che è giusto,
/// perché i figli della radice si contano una volta sola.
fn count_direct<'a>(paths: impl Iterator<Item = &'a str>, folder: &str) -> u32 {
    let prefix = subtree_start(folder);
    paths
        .take_while(|path| path.starts_with(&prefix))
        .filter(|path| parent_folder(path) == folder)
        .count()
        .min(u32::MAX as usize) as u32
}

/// Il fatto che il §9.7 rende interrogabile: se qualcuno vede le scritture
/// altrui, e cosa è già andato storto nel leggerle.
#[derive(Default)]
pub(crate) struct WatchState {
    /// **Condiviso** con chi tiene vivo il rilevatore (`fubmd-host`): il kernel
    /// non sa cosa sia un watcher, e questo è tutto ciò che gliene serve sapere.
    ///
    /// Un `Arc<AtomicBool>` e non un `bool`, perché la risposta deve poter
    /// diventare `false` **mentre il vault è aperto**. Prima
    /// `VaultWatcher::is_watching` rispondeva *per costruzione* — distingueva
    /// «non ho avviato un debouncer» da «ne ho avviato uno», e un debouncer
    /// morto continuava a rispondere `true`.
    pub(crate) watching: Arc<AtomicBool>,
    failures: u32,
    last_error: Option<String>,
}

impl WatchState {
    /// Registra l'esito di una sincronizzazione per-path.
    ///
    /// Sta **dentro** il kernel, ed è il punto: i due chiamanti veri scrivevano
    /// `let _ = ws.sync_path(…)`, quindi il `Result` c'era e non lo leggeva
    /// nessuno. Registrandolo qui, un chiamante distratto non può più nasconderlo
    /// — al più non lo guarda lui, ma il vault se lo ricorda.
    fn note(&mut self, error: impl std::fmt::Display) {
        self.failures = self.failures.saturating_add(1);
        self.last_error = Some(error.to_string());
    }

    fn status(&self) -> VaultStatus {
        VaultStatus {
            watching: self.watching.load(Ordering::Relaxed),
            sync_failures: self.failures,
            last_sync_error: self.last_error.clone(),
        }
    }
}

/// **I lavori lunghi vivi** (§10.3, decisione 0035): da quando il kernel
/// accetta un job a quando ne riconsegna l'esito.
///
/// È una tabella e non un conto, ed è ciò che permette al centro attività di
/// **riconciliare**: gli eventi del ciclo di un job sono recuperabili
/// ([`Event::is_recoverable`](fubmd_abi::Event::is_recoverable)) proprio perché
/// c'è questa, e senza di essa il canale più fitto del contratto sarebbe l'unico
/// che non si può frenare.
///
/// `BTreeMap` per l'ordine, e la chiave è il **numero** dentro il [`JobId`] e
/// non l'id: un `JobId` è opaco per contratto — chi lo ordina sta assumendo
/// qualcosa che l'host non gli deve — e l'unico che quell'assunzione la può
/// fare è chi i numeri li assegna, cioè questo kernel. Ne esce l'elenco
/// nell'ordine in cui il lavoro è stato chiesto, che è l'unico che chi guarda
/// riconosce.
#[derive(Default)]
pub(crate) struct JobsState {
    live: BTreeMap<u64, JobStatus>,
}

impl JobsState {
    /// Un job è stato accettato: da qui è vivo, e da qui si vede.
    ///
    /// Il `since` lo prende chi accetta e non chi chiede: è il momento in cui il
    /// kernel se ne è fatto carico, e un job che aspetta un thread libero è già
    /// in attesa da allora.
    pub(crate) fn accepted(&mut self, id: JobId, job: &str, plugin: &str) {
        self.live.insert(
            id.0,
            JobStatus {
                id,
                job: job.to_string(),
                plugin: plugin.to_string(),
                since: crate::time::now_unix_millis(),
                progress: None,
            },
        );
    }

    /// Registra un progresso, e dice se il job era **vivo**.
    ///
    /// Il `false` non è pignoleria: un progresso che arriva per un job già
    /// concluso — l'host che lo timbra gira su un altro thread, e fra il suo
    /// ultimo passo e l'esito ci sta di tutto — non deve far ricomparire una
    /// riga nel centro attività. Chi lo riceve non lo emette nemmeno.
    pub(crate) fn progressed(&mut self, id: JobId, progress: JobProgress) -> bool {
        match self.live.get_mut(&id.0) {
            Some(status) => {
                status.progress = Some(progress);
                true
            }
            None => false,
        }
    }

    /// Di chi è questo job, se è ancora vivo. Serve a intestargli il proprio
    /// progresso: l'origine di un `job-progress` è il plugin che sta lavorando,
    /// e chi timbra l'evento ha in mano l'id, non il nome.
    pub(crate) fn owner(&self, id: JobId) -> String {
        self.live
            .get(&id.0)
            .map(|status| status.plugin.clone())
            .unwrap_or_default()
    }

    /// L'esito è tornato: il job smette di essere vivo.
    pub(crate) fn finished(&mut self, id: JobId) {
        self.live.remove(&id.0);
    }

    pub(crate) fn live(&self) -> Vec<JobStatus> {
        self.live.values().cloned().collect()
    }
}

impl CoreIndex {
    pub(crate) fn new(
        registry: Arc<FormatRegistry>,
        settings: SharedSettings,
        organization: Arc<OrganizationStore>,
    ) -> Self {
        CoreIndex {
            metas: BTreeMap::new(),
            entries: BTreeMap::new(),
            folders: BTreeSet::new(),
            tags: TagCounts::default(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            registry,
            watch: WatchState::default(),
            jobs: JobsState::default(),
            settings,
            organization,
        }
    }

    /// Registra un fallimento di sincronizzazione (§9.7).
    pub(crate) fn note_sync_failure(&mut self, error: impl std::fmt::Display) {
        self.watch.note(error);
    }

    pub(crate) fn contains(&self, id: &DocId) -> bool {
        self.metas.contains_key(id)
    }

    /// Gli id indicizzati, in ordine. L'ordine non è una cortesia: è ciò che
    /// rende stabile una risposta paginata.
    pub(crate) fn ids(&self) -> impl Iterator<Item = &DocId> {
        self.metas.keys()
    }

    pub(crate) fn documents(&self) -> Vec<DocId> {
        self.metas.keys().cloned().collect()
    }

    pub(crate) fn clear(&mut self) {
        self.metas.clear();
        self.entries.clear();
        self.folders.clear();
        self.tags.clear();
    }

    /// Rimette in cache i metadati di un documento **senza riaprirlo** (§14.2):
    /// è la strada che l'anagrafe apre, e l'unica differenza con
    /// [`on_document_indexed`](IndexProvider::on_document_indexed) è che qui il
    /// modello non c'è — non è stato parsato, perché il file non è stato letto.
    ///
    /// Il grafo non si tocca: chi chiama è `reindex`, che lo ricostruisce in
    /// blocco alla fine (la risoluzione dei wikilink dipende dall'insieme
    /// intero, e un `upsert` per documento non lo saprebbe).
    pub(crate) fn restore(&mut self, id: &DocId, meta: StoredMeta) {
        self.tags
            .upsert_names(id, meta.tags.iter().map(String::as_str));
        self.metas.insert(
            id.clone(),
            DocMeta {
                id: id.clone(),
                frontmatter: meta.frontmatter,
                outline: meta.outline,
                links: meta.links,
            },
        );
    }

    /// Ciò che di un documento va scritto nell'anagrafe perché la prossima
    /// apertura non debba riaprirlo.
    pub(crate) fn stored_meta(&self, id: &DocId) -> Option<StoredMeta> {
        let meta = self.metas.get(id)?;
        Some(StoredMeta {
            frontmatter: meta.frontmatter.clone(),
            outline: meta.outline.clone(),
            links: meta.links.clone(),
            tags: self.tags.names_of(id),
        })
    }

    /// Il **file** che un riferimento nomina, se il vault ce l'ha — di
    /// qualunque specie (§14.1).
    pub(crate) fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId> {
        resolve_entry_in(&self.entries, source, target)
    }

    /// Mette (o aggiorna) una voce dell'anagrafe.
    pub(crate) fn set_entry(&mut self, entry: VaultEntry) {
        self.entries.insert(entry.id.clone(), entry);
    }

    /// Mette una cartella fra quelle che ci sono (§14.3).
    pub(crate) fn set_folder(&mut self, path: impl Into<String>) {
        let path = path.into();
        if !path.is_empty() {
            self.folders.insert(path);
        }
    }

    /// Registra le cartelle che un path **attraversa**, dalla radice in giù.
    ///
    /// Serve a chi tocca un file solo (il rilevatore, una scrittura): un file
    /// che nasce in `a/b/c.md` dice che `a` e `a/b` esistono, e senza questa
    /// riga l'albero non le vedrebbe fino alla riapertura del vault. Il
    /// contrario non vale — cancellare l'ultimo file di una cartella **non**
    /// toglie la cartella, perché sul disco c'è ancora.
    pub(crate) fn ensure_folders_of(&mut self, id: &DocId) {
        for folder in fubmd_abi::query::folders_of(id) {
            self.set_folder(folder);
        }
    }

    /// Le cartelle chieste, col conto di cosa contengono.
    ///
    /// I conti si fanno qui e non si tengono scritti: le due mappe sono
    /// ordinate, quindi contare i figli diretti di una cartella costa il suo
    /// sottoalbero e non il vault, e un conto ricavato non può divergere da ciò
    /// da cui è ricavato.
    fn folders_under(&self, under: Option<&FolderScope>) -> Vec<VaultFolder> {
        self.folders
            .iter()
            .filter(|path| match under {
                Some(scope) => within_folder(parent_folder(path), &scope.path, scope.descendants),
                None => true,
            })
            .map(|path| {
                let from = subtree_start(path);
                VaultFolder {
                    folders: count_direct(
                        self.folders.range(from.clone()..).map(String::as_str),
                        path,
                    ),
                    entries: count_direct(
                        self.entries
                            .range(DocId::new(from)..)
                            .map(|(id, _)| id.as_str()),
                        path,
                    ),
                    path: path.clone(),
                }
            })
            .collect()
    }

    /// Toglie una voce dall'anagrafe, e dice **cosa era**: è l'unico momento in
    /// cui la sua specie si può ancora sapere, ed è ciò che un evento di
    /// sparizione deve portare con sé.
    pub(crate) fn remove_entry(&mut self, id: &DocId) -> Option<EntryKind> {
        self.entries.remove(id).map(|e| e.kind)
    }

    pub(crate) fn rebuild_graph(&mut self) {
        self.graph = LinkGraph::build(self.metas.values());
    }

    /// Il frontmatter di un documento, per chi compone una riga di risposta.
    pub(crate) fn frontmatter(&self, id: &DocId) -> Option<&Frontmatter> {
        self.metas.get(id).map(|m| &m.frontmatter)
    }

    /// I documenti in relazione di link con `doc`, secondo il verso chiesto.
    fn linked(&self, doc: &DocId, direction: LinkDirection) -> Vec<DocId> {
        match direction {
            LinkDirection::Outbound => self.graph.outgoing(doc),
            LinkDirection::Inbound => self
                .graph
                .backlinks(doc)
                .into_iter()
                .map(|b| b.source)
                .collect(),
            LinkDirection::Both => {
                let mut all = self.graph.outgoing(doc);
                all.extend(self.graph.backlinks(doc).into_iter().map(|b| b.source));
                all
            }
        }
    }
}

impl QueryEvaluator for CoreIndex {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.metas.keys().cloned()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        match predicate {
            QueryPredicate::Property { filter } => Ok(Matches::of_docs(
                self.metas
                    .iter()
                    .filter(|(_, meta)| properties::test(&meta.frontmatter, filter))
                    .map(|(id, _)| id.clone()),
            )),
            QueryPredicate::Tag { name, descendants } => {
                let wanted = canonical_tag(name);
                Ok(Matches::of_docs(self.tags.docs_with(&wanted, *descendants)))
            }
            QueryPredicate::Folder { path, descendants } => Ok(Matches::of_docs(
                self.metas
                    .keys()
                    .filter(|id| in_folder(id, path, *descendants))
                    .cloned(),
            )),
            QueryPredicate::Linked { doc, direction } => Ok(Matches::of_docs(
                self.linked(doc, *direction)
                    .into_iter()
                    .filter(|id| self.metas.contains_key(id)),
            )),
            // Ciò che il pianificatore ha già risolto per conto di qualcun
            // altro: si prende per buono, ristretto a ciò che esiste.
            QueryPredicate::Docs { docs } => Ok(Matches::of_docs(
                docs.iter()
                    .filter(|id| self.metas.contains_key(id))
                    .cloned(),
            )),
            other => Err(PluginError::Unserved(
                format!("l'indice del kernel non valuta questa foglia: {other:?}").into(),
            )),
        }
    }
}

impl IndexProvider for CoreIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![
            // Le famiglie di cui il kernel è l'unica fonte di verità.
            QueryRoute::Query(QueryKind::Backlinks),
            QueryRoute::Query(QueryKind::Outline),
            QueryRoute::Query(QueryKind::Tags),
            QueryRoute::Query(QueryKind::Neighbors),
            QueryRoute::Query(QueryKind::PropertyValues),
            QueryRoute::Query(QueryKind::VaultHealth),
            // Il rapporto col disco (§9.7): il kernel è l'unico che può
            // rispondere, perché è l'unico che conosce insieme l'esito delle
            // sincronizzazioni e il fatto — passatogli da chi monta — che un
            // rilevatore ci sia.
            QueryRoute::Query(QueryKind::VaultStatus),
            // Cosa sta girando (§10.3): di nuovo il kernel, e di nuovo perché è
            // l'unico che li conosce tutti — chi possiede i thread sa quali
            // sono partiti, non quali stanno per partire.
            QueryRoute::Query(QueryKind::Jobs),
            // Com'è configurato (§11.1): ancora il kernel, e stavolta si vede a
            // occhio — lo schema sta nel registro dei plugin, il valore nello
            // store di configurazione, e nessun altro li ha tutti e due.
            QueryRoute::Query(QueryKind::Settings),
            // Com'è organizzato (§11.3): il kernel possiede il sidecar, quindi
            // è l'unico che può rispondere. Prima non poteva rispondere
            // nessuno: la domanda non passava dal canale dati affatto.
            QueryRoute::Query(QueryKind::Organization),
            // Cosa nomina un riferimento (§13.1): il kernel, perché risolvere è
            // una funzione del grafo — gli omonimi si dirimono per distanza
            // dalla radice, e gli alias stanno in un indice che tiene solo lui.
            // Prima rispondeva solo alla shell, per un comando IPC scritto
            // apposta.
            QueryRoute::Query(QueryKind::Resolve),
            // Cosa c'è nel vault (§14.1): il kernel, per esclusione — l'anagrafe
            // la costruisce chi cammina il disco, e nessun altro cammina il
            // disco. Prima questa domanda non si poteva fare affatto: la lista
            // dei documenti filtrava per estensione, quindi di un PNG non
            // sapeva rispondere nemmeno che c'era.
            QueryRoute::Query(QueryKind::Entries),
            // Quali cartelle ci sono (§14.3): il kernel, e per la stessa
            // ragione — una cartella la vede chi cammina il disco. Prima non la
            // vedeva nessuno: le cartelle esistevano solo come prefissi dei
            // path delle note, dentro l'albero della shell.
            QueryRoute::Query(QueryKind::Folders),
            // Le foglie che sa valutare dai metadati in cache. `Text` non c'è, e
            // non è una lacuna: il kernel non indicizza il corpo, e prometterlo
            // vorrebbe dire scandire il vault a ogni ricerca.
            QueryRoute::Predicate(PredicateKind::Property),
            QueryRoute::Predicate(PredicateKind::Tag),
            QueryRoute::Predicate(PredicateKind::Folder),
            QueryRoute::Predicate(PredicateKind::Linked),
        ]
    }

    /// Niente da ricaricare: la memoria di questo indice è il vault, e la
    /// riscansione la fa il workspace all'apertura.
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_document_indexed(&mut self, doc: &DocumentModel) {
        self.tags.upsert(&doc.id, &doc.tags);
        let meta = DocMeta::from(doc);
        if self.graph_update == GraphUpdate::Incremental {
            self.graph.upsert(&meta);
        }
        self.metas.insert(meta.id.clone(), meta);
    }

    fn on_document_removed(&mut self, id: &DocId) {
        if self.metas.remove(id).is_none() {
            return;
        }
        self.tags.remove(id);
        if self.graph_update == GraphUpdate::Incremental {
            self.graph.remove(id);
        }
    }

    /// L'indice del kernel **è** la verità corrente: non ha niente da
    /// riconciliare con essa. Il rebuild completo, quando è la strategia
    /// scelta, lo chiude il workspace dopo la scansione.
    fn reconcile(&mut self, _ids: &[DocId]) {}

    /// Non persiste niente: ciò che sa lo ricostruisce dal vault, che è la
    /// definizione di stato derivato.
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    /// Non tiene niente che vada lasciato andare: la memoria di questo indice è
    /// memoria, e se ne va con lui. La riga c'è perché il contratto non ha un
    /// default (decisione 0028), ed è il caso che quel default avrebbe reso
    /// indistinguibile da «non ci ho pensato».
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            // Arriva quando il pianificatore consegna un sottoalbero di foglie
            // che questo indice ha dichiarato: la struttura la regge
            // `QueryEvaluator`, che è scritta una volta sola nel contratto.
            IndexQuery::Documents {
                matching,
                sort,
                select,
                page,
            } => {
                let matches = self.expr(&matching)?;
                Ok(IndexResult::Documents(properties::finish(
                    matches,
                    sort.as_ref(),
                    &select,
                    page,
                    |id| self.frontmatter(id),
                )))
            }
            IndexQuery::Backlinks { target, page } => Ok(IndexResult::Backlinks(Paged::window(
                self.graph.backlinks(&target),
                page,
            ))),
            IndexQuery::Outline { doc } => Ok(IndexResult::Outline(
                self.metas
                    .get(&doc)
                    .map(|m| m.outline.clone())
                    .unwrap_or_default(),
            )),
            IndexQuery::Tags { matching, page } => {
                let counts = if matching.is_everything() {
                    // Lo snapshot incrementale: niente O(vault) a ogni
                    // interrogazione — e il pannello interroga a ogni
                    // salvataggio.
                    self.tags.snapshot()
                } else {
                    let selected = self.expr(&matching)?;
                    self.tags.snapshot_of(selected.ids())
                };
                Ok(IndexResult::Tags(Paged::window(counts, page)))
            }
            IndexQuery::Neighbors {
                seeds,
                direction,
                depth,
                page,
            } => {
                let from = self.expr(&seeds)?;
                let mut all = Vec::new();
                // I semi in ordine di id, e i vicini di ognuno di seguito: senza
                // un ordine totale la seconda pagina di un grafo grande
                // ripeterebbe righe della prima.
                for seed in from.ids() {
                    all.extend(self.graph.neighbors(seed, direction, depth));
                }
                Ok(IndexResult::Neighbors(Paged::window(all, page)))
            }
            IndexQuery::PropertyValues {
                key,
                matching,
                page,
            } => {
                let selected = self.expr(&matching)?;
                let facets = properties::facets(
                    selected
                        .ids()
                        .filter_map(|id| self.metas.get(id).map(|m| (id, &m.frontmatter))),
                    &key,
                );
                Ok(IndexResult::PropertyValues(Paged::window(facets, page)))
            }
            IndexQuery::VaultHealth { check, page } => {
                let issues = health::run(
                    check,
                    self.metas.iter().map(|(id, m)| (id, m.links.as_slice())),
                    // Il risolutore è il grafo **più l'anagrafe** (§14.1): il
                    // grafo sa dove arriva un link fra note, l'anagrafe sa se
                    // il PNG che una nota mostra c'è davvero. Con il solo grafo
                    // la seconda domanda non era rispondibile, e l'unica cosa
                    // onesta che si poteva fare era tacere su ogni allegato.
                    &health::VaultView {
                        graph: &self.graph,
                        entries: &self.entries,
                    },
                    &self.registry.all_extensions(),
                );
                Ok(IndexResult::VaultHealth(Paged::window(issues, page)))
            }
            // Il filtro sta **prima** della finestra, e non è un dettaglio: una
            // pagina tagliata sull'anagrafe intera e poi filtrata sarebbe una
            // pagina con dentro un numero di righe che dipende da cosa c'è nel
            // resto del vault (§14.4).
            IndexQuery::Entries {
                of_kind,
                within,
                page,
            } => Ok(IndexResult::Entries(Paged::window(
                self.entries
                    .values()
                    .filter(|e| of_kind.is_none_or(|k| e.kind == k))
                    .filter(|e| match &within {
                        Some(scope) => in_folder(&e.id, &scope.path, scope.descendants),
                        None => true,
                    })
                    .cloned()
                    .collect(),
                page,
            ))),
            IndexQuery::Folders { under, page } => Ok(IndexResult::Folders(Paged::window(
                self.folders_under(under.as_ref()),
                page,
            ))),
            IndexQuery::Custom { ns, .. } => Err(PluginError::Unserved(
                format!("l'indice del kernel non estende il canale: `{ns}`").into(),
            )),
            IndexQuery::VaultStatus => Ok(IndexResult::VaultStatus(self.watch.status())),
            IndexQuery::Jobs => Ok(IndexResult::Jobs(self.jobs.live())),
            IndexQuery::Organization => Ok(IndexResult::Organization(self.organization.snapshot())),
            IndexQuery::Settings { plugin } => Ok(IndexResult::Settings(
                self.settings
                    .read()
                    .expect("store di configurazione")
                    .entries(plugin.as_deref()),
            )),
            // Le tre specie di bersaglio hanno tre regole diverse, e il punto di
            // questa variante è **non** inventarne una quarta che le indovini:
            // chi chiede dice di che specie è il riferimento, perché lo sa — è
            // ciò che ha parsato, o ciò che `LinkTarget::classify` gli ha
            // risposto.
            IndexQuery::Resolve { target, from } => Ok(IndexResult::Resolved(match &target {
                LinkTarget::Wiki { page, .. } => self.graph.resolve_wiki(page),
                // Un path relativo senza un documento che lo ospiti è relativo
                // alla radice: `DocId("")` non è un documento, è la cartella da
                // cui `resolve_against` parte, ed è la stessa che userebbe una
                // nota nella radice.
                LinkTarget::Path(raw) => self
                    .graph
                    .resolve_path(from.as_ref().unwrap_or(&DocId::new("")), raw),
                // Il mondo esterno non è nel vault, e dirlo è una risposta: chi
                // passa qui l'esito di `classify` senza filtrarlo prima riceve
                // `None` invece di un errore.
                LinkTarget::Url(_) => None,
            })),
        }
    }
}
