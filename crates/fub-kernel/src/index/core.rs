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

use crate::drafts::Drafts;
use fub_abi::edit::Revision;
use fub_abi::event::{DocChange, DocChanges};
use fub_abi::model::{
    canonical_anchor, canonical_tag, heading_matches, Anchor, DateFormats, DocId, DocumentModel,
    Frontmatter, Heading, Link, LinkTarget, PropertyTypes,
};
use fub_abi::query::{
    in_folder, parent_folder, within_folder, Matches, QueryEvaluator, QueryPredicate,
};
use fub_abi::rules::properties;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{
    BacklinkRef, DocPosition, DocumentMatch, DraftInfo, EntryKind, FolderScope, HostApi, IndexLoss,
    IndexProvider, IndexQuery, IndexResult, IndexingState, JobId, JobProgress, JobStatus,
    LinkDirection, NeighborRef, Page, Paged, PredicateKind, PropertySelect, PropertySort,
    QueryKind, QueryRoute, ResolvedRef, VaultEntry, VaultFolder, VaultStatus,
};
use fub_abi::PluginError;

use crate::entries::StoredMeta;
use crate::graph::{GraphSource, LinkGraph};
use crate::health;
use crate::organization::OrganizationStore;
use crate::registry::FormatRegistry;
use crate::settings::SharedSettings;
use crate::tag_counts::TagCounts;
use crate::workspace::GraphUpdate;

mod entries;
mod methods;
mod provider;
mod states;

use entries::{count_direct, resolve_entry_in_folder, subtree_start};
pub(crate) use entries::{resolve_entry_in, EntryNames};
pub(crate) use states::{JobsState, WatchState};

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
    /// Le ancore di blocco (`^abc`), piatte come le consegna il modello.
    ///
    /// Sono qui dalla decisione 0049, e sono l'unica metà del corpo che questa
    /// cache tiene: senza, `[[Nota#^blocco]]` resta risolvibile solo a *quale
    /// documento*, che è il buco della §21.10. Costano quanto l'outline — un
    /// record corto per ancora, non un albero — e sono la stessa specie di dato:
    /// **dove sta un punto nominabile**, per heading là e per blocco qui.
    pub(crate) anchors: Vec<Anchor>,
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
            anchors: model.anchors.clone(),
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
    /// I nomi di `entries`, mantenuti insieme a lei (difetto 0115).
    ///
    /// Non è una seconda anagrafe ed è ricavato: ci si passa dalle due sole
    /// porte che toccano `entries` — [`set_entry`](CoreIndex::set_entry) e
    /// [`remove_entry`](CoreIndex::remove_entry) — che è la ragione per cui un
    /// conto ricavato qui non può divergere da ciò da cui è ricavato.
    pub(crate) names: EntryNames,
    /// Le voci di `entries` **che non si scrivono in anagrafe**: quelle la cui
    /// data non era nel passato nel momento in cui la si è letta (difetto
    /// 0187).
    ///
    /// Quasi sempre vuoto, e non è una terza anagrafe: è la stessa risposta
    /// che la regola *racily clean* dava a `load` guardando un numero in testa
    /// alla tabella, presa però dove la domanda ha senso — al momento
    /// dell'osservazione — e tenuta da parte fino a quando serve, cioè quando
    /// qualcuno scrive. Ci si passa dalle stesse due porte di `nomi`.
    observed_in_the_own_instant: BTreeSet<DocId>,
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
    /// Generazione dei metadati da cui il grafo si ricostruisce. Avanza a ogni
    /// `restore` / alimentazione / rimozione: una fotografia presa prima non
    /// si installa sopra una scrittura arrivata in mezzo.
    pub(crate) graph_epoch: u64,
    /// Serve a un controllo solo — distinguere un link a una nota da un
    /// riferimento a un allegato — ed è **condiviso** col workspace invece che
    /// copiato: due elenchi di estensioni sarebbero due idee di cosa è un
    /// documento, e la seconda mentirebbe in silenzio il giorno che i formati
    /// si registrano a caldo.
    registry: Arc<FormatRegistry>,
    /// Che rapporto ha questo vault con il disco (§9.7).
    ///
    /// Sta qui e non sul `Workspace` per la ragione della
    /// [0019](../../../../docs/decisions/0182-provider-e-porte-generiche.md): *le risposte
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
    /// **Cosa è rimasto non salvato** (§15.2), e per la quarta volta la ragione
    /// della 0019: è una risposta del kernel, e le risposte del kernel sono un
    /// provider. Condiviso col workspace come i due di sopra — a scrivere le
    /// bozze è chi batte sulla tastiera, e questo indice le legge.
    ///
    /// Che una bozza non sia dato d'*indice* non è un'obiezione: non lo è
    /// nemmeno il rapporto col disco, e sta qui da prima. Ciò che questa
    /// tabella instrada è **chi risponde a quale domanda**, e a questa risponde
    /// il kernel.
    drafts: Arc<Drafts>,
}

/// Traduce un glob di path una volta per query. `*` non attraversa cartelle,
/// `**` sì; nessun pattern può imporre una scansione senza limite di lavoro.
fn path_glob(glob: &str) -> Result<regex::Regex, PluginError> {
    if glob.len() > 256 {
        return Err(PluginError::BadArgs("path glob exceeds 256 bytes".into()));
    }
    let mut pattern = String::from("^");
    let mut chars = glob.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                pattern.push_str(".*");
            }
            '*' => pattern.push_str("[^/]*"),
            '?' => pattern.push_str("[^/]"),
            other => pattern.push_str(&regex::escape(&other.to_string())),
        }
    }
    pattern.push('$');
    regex::Regex::new(&pattern)
        .map_err(|err| PluginError::BadArgs(format!("invalid path glob: {err}").into()))
}

impl QueryEvaluator for CoreIndex {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.metas.keys().cloned()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        match predicate {
            QueryPredicate::Property { filter } => {
                let formats = self.date_formats();
                let types = self.property_types();
                Ok(Matches::of_docs(
                    self.metas
                        .iter()
                        .filter(|(_, metadata)| {
                            properties::test_with_types(
                                &metadata.frontmatter,
                                filter,
                                &formats,
                                &types,
                            )
                        })
                        .map(|(id, _)| id.clone()),
                ))
            }
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
            QueryPredicate::Path { glob } => {
                let pattern = path_glob(glob)?;
                Ok(Matches::of_docs(
                    self.metas
                        .keys()
                        .filter(|id| pattern.is_match(id.as_str()))
                        .cloned(),
                ))
            }
            QueryPredicate::File { extension } => {
                if extension.is_empty()
                    || extension.len() > 32
                    || extension.chars().any(|ch| matches!(ch, '/' | '\\' | '.'))
                {
                    return Err(PluginError::BadArgs("invalid file extension".into()));
                }
                Ok(Matches::of_docs(
                    self.metas
                        .keys()
                        .filter(|id| {
                            id.as_str()
                                .rsplit_once('.')
                                .is_some_and(|(_, suffix)| suffix.eq_ignore_ascii_case(extension))
                        })
                        .cloned(),
                ))
            }
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
                format!("the kernel index does not evaluate this leaf: {other:?}").into(),
            )),
        }
    }
}

/// Le chiavi di frontmatter nate, morte o cambiate di valore, ordinate e senza
/// ripetizioni.
///
/// Costa un passaggio su ognuna delle due mappe, con una ricerca per chiave
/// sull'altra — non un confronto a coppie. È la ragione per cui questo diff si
/// può permettere di girare a ogni scrittura. L'ordinamento in coda è
/// **necessario** e non cosmetico: la mappa del frontmatter conserva l'ordine
/// del file (`preserve_order`), quindi due documenti con le stesse chiavi
/// scritte in ordine diverso produrrebbero due elenchi che non si confrontano.
fn changed_properties(before: &Frontmatter, after: &Frontmatter) -> Vec<String> {
    let mut keys = Vec::new();
    for (key, value) in before.0.iter() {
        if after.get(key) != Some(value) {
            keys.push(key.clone());
        }
    }
    for key in after.0.keys() {
        if !before.0.contains_key(key) {
            keys.push(key.clone());
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

/// I tag di un documento: quelli nel testo e quelli dichiarati nel
/// frontmatter (`tags:`), nella regola del contratto.
fn document_tag_names(doc: &DocumentModel) -> Vec<String> {
    let mut names: Vec<String> = doc.tags.iter().map(|t| t.name.clone()).collect();
    names.extend(fub_abi::rules::tag::frontmatter_tags(&doc.frontmatter));
    names
}

/// I tag comparsi e quelli spariti. Le grafie e non le chiavi canoniche, perché
/// è la grafia che chi si è abbonato ha scritto nella propria automazione.
fn tag_diff(before: &[String], after: &[String]) -> (Vec<String>, Vec<String>) {
    let old: BTreeSet<&String> = before.iter().collect();
    let new: BTreeSet<&String> = after.iter().collect();
    let added: Vec<String> = new.difference(&old).map(|t| (*t).clone()).collect();
    let removed: Vec<String> = old.difference(&new).map(|t| (*t).clone()).collect();
    (added, removed)
}

#[cfg(test)]
mod tests;
