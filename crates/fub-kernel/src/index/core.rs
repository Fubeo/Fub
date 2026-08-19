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
    Frontmatter, Heading, Link, LinkTarget, Tag,
};
use fub_abi::query::{
    in_folder, parent_folder, within_folder, Matches, QueryEvaluator, QueryPredicate,
};
use fub_abi::rules::properties;
use fub_abi::settings::SettingValue;
use fub_abi::traits::{
    DocPosition, DocumentMatch, DraftInfo, EntryKind, FolderScope, HostApi, IndexLoss,
    IndexProvider, IndexQuery, IndexResult, IndexingState, JobId, JobProgress, JobStatus,
    LinkDirection, Page, Paged, PredicateKind, PropertySelect, PropertySort, QueryKind, QueryRoute,
    ResolvedRef, VaultEntry, VaultFolder, VaultStatus,
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
    pub(crate) nomi: NomiDellAnagrafe,
    /// Le voci di `entries` **che non si scrivono in anagrafe**: quelle la cui
    /// data non era nel passato nel momento in cui la si è letta (difetto
    /// 0187).
    ///
    /// Quasi sempre vuoto, e non è una terza anagrafe: è la stessa risposta
    /// che la regola *racily clean* dava a `load` guardando un numero in testa
    /// alla tabella, presa però dove la domanda ha senso — al momento
    /// dell'osservazione — e tenuta da parte fino a quando serve, cioè quando
    /// qualcuno scrive. Ci si passa dalle stesse due porte di `nomi`.
    osservate_nel_proprio_istante: BTreeSet<DocId>,
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

/// Il **file** che un path nomina dentro un'anagrafe, se c'è — di qualunque
/// specie (§14.1).
///
/// Funzione libera e non metodo perché il suo cliente non è solo l'indice: la
/// usa il controllo di salute, che riceve l'anagrafe e non chi la tiene.
pub(crate) fn resolve_entry_in(
    entries: &BTreeMap<DocId, VaultEntry>,
    nomi: &NomiDellAnagrafe,
    source: &DocId,
    target: &LinkTarget,
) -> Option<DocId> {
    let raw = match target {
        // Un wikilink nomina un file **per nome**, come nomina una nota per
        // nome: `![[foto.png]]` è il modo in cui si incorpora un allegato.
        LinkTarget::Wiki { page, .. } => return nomi.nominato(page),
        LinkTarget::Path(raw) => raw,
        // Il mondo esterno non è nel vault.
        LinkTarget::Url(_) => return None,
    };
    let path = fub_abi::rules::path::resolve_against(source, raw)?;
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
    nomi.con_la_chiave_di_path(&fub_abi::rules::path::resolution_key(id.as_str()))
}

/// **I nomi dell'anagrafe**, dalla chiave di risoluzione ai file che la portano.
///
/// Risolvere un riferimento è una domanda **per chiave**, e prima era una
/// scansione: si calcolavano fino a due chiavi per ogni voce del vault e si
/// chiudeva con un `min_by_key`, che non cortocircuita — quindi trovare costava
/// quanto non trovare. Il chiamante caro non è il controllo di salute ma
/// `entry_rewrite_plan`, che chiede una volta per ogni link di ogni documento:
/// su ventimila voci, spostare un allegato voleva dire decine di minuti
/// (difetto 0115). Qui la chiave si calcola **una volta per voce, quando la
/// voce entra**, e la domanda diventa una ricerca in una mappa. È la stessa
/// forma che il grafo ha da sempre per le note (`path_index`), portata
/// sull'anagrafe.
///
/// **Due mappe e non una**, perché le domande sono due e mescolarle darebbe
/// risposte sbagliate: un `[[foto.png]]` può trovare un file che si chiama così
/// in fondo a una cartella, un path scritto per intero no — e se stessero
/// insieme, un `a/foto.png` indicizzato per nome verrebbe reso a chi ha scritto
/// il path `foto.png`, che è un file diverso.
///
/// Il prezzo è due chiavi in memoria per voce, ed è il conto che questa forma
/// paga per non riscandire: un'anagrafe di ventimila file tiene quarantamila
/// stringhe corte invece di ricalcolarne quarantamila **a ogni link**.
#[derive(Debug, Default)]
pub(crate) struct NomiDellAnagrafe {
    /// La chiave del **path intero**, per ogni voce di qualunque specie: è ciò
    /// che serve al ripiego di [`resolve_entry_in`], che riconcilia NFD e NFC
    /// dopo che il confronto esatto ha già detto di no. I documenti ci sono
    /// perché quel ripiego li considera.
    per_path: BTreeMap<String, BTreeSet<DocId>>,
    /// Le chiavi con cui un **nome** trova un file che non è un documento: il
    /// nome del file con la sua estensione — che è come si scrive
    /// `![[foto.png]]` — e il path intero, per chi disambigua scrivendolo.
    ///
    /// I documenti restano fuori: quelli li risolve il grafo, che conosce anche
    /// gli alias, e chi chiama prova prima lui.
    per_nome: BTreeMap<String, BTreeSet<DocId>>,
}

impl NomiDellAnagrafe {
    /// I nomi di un'anagrafe che c'è già, in una passata.
    ///
    /// **Solo per i banchi**, e la riga che lo dice è il `cfg`: in produzione
    /// non esiste un'anagrafe senza chi la mantiene — a `entries` si arriva
    /// dalle due porte di [`CoreIndex`], che tengono i nomi al passo. Chi
    /// invece un'anagrafe se la costruisce a mano per provarci sopra una regola
    /// (il controllo di salute, che riceve le due mappe e non l'indice) ha
    /// bisogno di questa, e averla `pub(crate)` in produzione vorrebbe dire
    /// tenere aperta una seconda via per fare i nomi — cioè il modo in cui due
    /// elenchi cominciano a divergere.
    #[cfg(test)]
    pub(crate) fn di(entries: &BTreeMap<DocId, VaultEntry>) -> Self {
        let mut nomi = NomiDellAnagrafe::default();
        for (id, entry) in entries {
            nomi.inserisci(id, entry.kind);
        }
        nomi
    }

    /// Registra una voce, con la sua specie.
    ///
    /// Toglie prima di mettere perché la stessa voce può rientrare cambiando
    /// specie, e una chiave vecchia rimasta dietro risponderebbe con un file
    /// che non si chiama più così.
    pub(crate) fn inserisci(&mut self, id: &DocId, kind: EntryKind) {
        self.togli(id);
        let path = fub_abi::rules::path::resolution_key(id.as_str());
        let nome = fub_abi::rules::path::resolution_key(file_name_of(id.as_str()));
        ricorda(&mut self.per_path, &path, id);
        if kind != EntryKind::Document {
            ricorda(&mut self.per_nome, &path, id);
            ricorda(&mut self.per_nome, &nome, id);
        }
    }

    /// Toglie una voce da tutte le chiavi che la portavano.
    ///
    /// Le chiavi si ricalcolano dall'id invece di tenerle scritte: sono due
    /// stringhe corte, e un secondo elenco da mantenere è un secondo elenco che
    /// può divergere dal primo. La specie qui non serve — togliere da una chiave
    /// che non c'era non è un errore.
    pub(crate) fn togli(&mut self, id: &DocId) {
        let path = fub_abi::rules::path::resolution_key(id.as_str());
        let nome = fub_abi::rules::path::resolution_key(file_name_of(id.as_str()));
        scorda(&mut self.per_path, &path, id);
        scorda(&mut self.per_nome, &path, id);
        scorda(&mut self.per_nome, &nome, id);
    }

    pub(crate) fn svuota(&mut self) {
        self.per_path.clear();
        self.per_nome.clear();
    }

    /// Il file che un **nome** nomina, fra quelli che non sono documenti (§14.1).
    ///
    /// La regola è quella dei wikilink fra note, e lo è di proposito: si
    /// confronta la chiave di risoluzione (trim, NFC, minuscolo) contro il nome
    /// del file con la sua estensione, o contro il path intero. Fra omonimi
    /// vince il più vicino alla radice, e a parità l'ordine dei path: la stessa
    /// regola del grafo, perché due regole di risoluzione in un'app sola sono
    /// due risposte alla stessa domanda.
    ///
    /// Gli omonimi di una chiave sono pochi — è la ragione per cui questa forma
    /// guadagna: il `min_by_key` è rimasto, ma gira su loro e non sul vault.
    pub(crate) fn nominato(&self, name: &str) -> Option<DocId> {
        let wanted = fub_abi::rules::path::resolution_key(name);
        if wanted.is_empty() {
            return None;
        }
        self.per_nome
            .get(&wanted)?
            .iter()
            // Il più vicino alla radice, e a parità il primo in ordine di path:
            // il gruppo è ordinato, quindi `min_by_key` è stabile.
            .min_by_key(|id| id.as_str().matches('/').count())
            .cloned()
    }

    /// La voce il cui **path intero** ha questa chiave: la prima in ordine di
    /// path, che è ciò che rispondeva la scansione.
    pub(crate) fn con_la_chiave_di_path(&self, chiave: &str) -> Option<DocId> {
        self.per_path.get(chiave)?.iter().next().cloned()
    }
}

fn ricorda(mappa: &mut BTreeMap<String, BTreeSet<DocId>>, chiave: &str, id: &DocId) {
    if chiave.is_empty() {
        return;
    }
    mappa
        .entry(chiave.to_string())
        .or_default()
        .insert(id.clone());
}

fn scorda(mappa: &mut BTreeMap<String, BTreeSet<DocId>>, chiave: &str, id: &DocId) {
    if let Some(gruppo) = mappa.get_mut(chiave) {
        gruppo.remove(id);
        if gruppo.is_empty() {
            mappa.remove(chiave);
        }
    }
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
    /// **Condiviso** con chi tiene vivo il rilevatore (`fub-host`): il kernel
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
    /// **A che punto è l'indicizzazione dell'apertura** (§15.7).
    ///
    /// Il *lavoro* dell'indicizzazione sta fuori dal kernel — è
    /// l'[`Indicizzazione`](crate::Indicizzazione), che chi ha i thread si passa
    /// di fetta in fetta — e qui sta solo ciò che se ne **osserva**. È la stessa
    /// divisione della bandiera del rilevamento
    /// ([0030](../../../docs/decisions/0030-il-rilevamento-si-puo-chiedere.md))
    /// e del campanello dei job
    /// ([0032](../../../docs/decisions/0032-il-runner-dei-job.md)): il kernel
    /// non fa il mestiere, ma è l'unico posto da cui la domanda si può fare.
    pub(crate) indexing: IndexingState,
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
            indexing: self.indexing,
        }
    }
}

/// **I lavori lunghi vivi** (§10.3, decisione 0035): da quando il kernel
/// accetta un job a quando ne riconsegna l'esito.
///
/// È una tabella e non un conto, ed è ciò che permette al centro attività di
/// **riconciliare**: gli eventi del ciclo di un job sono recuperabili
/// ([`Event::is_recoverable`](fub_abi::Event::is_recoverable)) proprio perché
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
    /// I formati di data che **questo vault dichiara** (§8.2), letti adesso.
    ///
    /// A ogni domanda e non una volta al montaggio, per la ragione per cui le
    /// impostazioni sono condivise e non copiate: chi cambia la dichiarazione
    /// cambia il valore di ogni proprietà data del vault, e un indice che
    /// rispondesse con com'era al montaggio direbbe che il filtro non trova
    /// **anche dopo** che l'utente ha riparato la causa.
    pub(crate) fn date_formats(&self) -> DateFormats {
        let declared = self
            .settings
            .read()
            .ok()
            .and_then(|s| s.effective(crate::properties::DATE_FORMAT).ok())
            .and_then(|(v, _)| match v {
                SettingValue::Text(s) => Some(s),
                _ => None,
            });
        crate::properties::date_formats(declared.as_deref())
    }

    /// La **coda** di una risposta `Documents`, con dentro le due cose che il
    /// kernel sa e [`properties::finish`] no: i formati che il vault dichiara e
    /// dove si legge il frontmatter.
    ///
    /// Esiste perché i chiamanti sono **due** — questo indice quando la domanda
    /// gli arriva intera, e il pianificatore quando la ricompone — e ognuno dei
    /// due passava i formati per conto suo. Due siti che devono passare lo
    /// stesso valore sono un sito che prima o poi passa l'altro: chi ricompone
    /// avrebbe ordinato le date come testo mentre chi risponde intero le
    /// ordinava per istante, sulla **stessa** domanda, e nessuno avrebbe
    /// confrontato le due risposte perché non si vedono fra loro. Con la coda
    /// qui, il terzo chiamante eredita la dichiarazione senza saperla.
    ///
    /// I punti da cui il kernel monta quella coda a mano sono
    /// **uno** [conta: code-delle-documents-nel-kernel], ed è un conto e non un
    /// test perché nessun test può vedere una rotta che ancora non esiste, e il
    /// compilatore non sa distinguere un `&DateFormats` giusto da uno sbagliato.
    pub(crate) fn finish_documents(
        &self,
        matches: Matches,
        sort: Option<&PropertySort>,
        select: &PropertySelect,
        page: Option<Page>,
    ) -> Paged<DocumentMatch> {
        properties::finish(matches, sort, select, page, &self.date_formats(), |id| {
            self.frontmatter(id)
        })
    }

    pub(crate) fn new(
        registry: Arc<FormatRegistry>,
        settings: SharedSettings,
        organization: Arc<OrganizationStore>,
        drafts: Arc<Drafts>,
    ) -> Self {
        CoreIndex {
            metas: BTreeMap::new(),
            entries: BTreeMap::new(),
            nomi: NomiDellAnagrafe::default(),
            osservate_nel_proprio_istante: BTreeSet::new(),
            folders: BTreeSet::new(),
            tags: TagCounts::default(),
            graph: LinkGraph::default(),
            graph_update: GraphUpdate::default(),
            graph_epoch: 0,
            registry,
            watch: WatchState::default(),
            jobs: JobsState::default(),
            settings,
            organization,
            drafts,
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
        self.nomi.svuota();
        self.folders.clear();
        self.tags.clear();
        self.graph_epoch = 0;
    }

    /// Rimette in cache i metadati di un documento **senza riaprirlo** (§14.2):
    /// è la strada che l'anagrafe apre, e l'unica differenza con
    /// [`on_documents_indexed`](IndexProvider::on_documents_indexed) è che qui il
    /// modello non c'è — non è stato parsato, perché il file non è stato letto.
    ///
    /// Il grafo non si tocca: chi chiama è `reindex` / `finish_index`, che lo
    /// ricostruisce in blocco alla fine (un `upsert` per documento, a caldo,
    /// vedrebbe un insieme ancora incompleto). L'epoca avanza lo stesso: i
    /// metadati da cui il grafo si ricostruisce sono cambiati.
    pub(crate) fn restore(&mut self, id: &DocId, meta: StoredMeta) {
        self.graph_epoch = self.graph_epoch.wrapping_add(1);
        self.tags
            .upsert_names(id, meta.tags.iter().map(String::as_str));
        self.metas.insert(
            id.clone(),
            DocMeta {
                id: id.clone(),
                frontmatter: meta.frontmatter,
                outline: meta.outline,
                links: meta.links,
                anchors: meta.anchors,
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
            anchors: meta.anchors.clone(),
            tags: self.tags.names_of(id),
        })
    }

    /// Il **file** che un riferimento nomina, se il vault ce l'ha — di
    /// qualunque specie (§14.1).
    pub(crate) fn resolve_entry(&self, source: &DocId, target: &LinkTarget) -> Option<DocId> {
        resolve_entry_in(&self.entries, &self.nomi, source, target)
    }

    /// Mette (o aggiorna) una voce dell'anagrafe.
    /// **Cosa cambia** se questo modello sostituisce quello che c'è (§22.2,
    /// decisione 0069).
    ///
    /// Si chiama **prima** di [`on_documents_indexed`](IndexProvider::on_documents_indexed)
    /// e prima che l'anagrafe sia toccata, ed è l'unico momento in cui il
    /// vecchio e il nuovo esistono insieme: il modello è appena arrivato, i
    /// metadati di prima sono ancora in `metas` e i tag di prima ancora in
    /// `tags`. Costa zero letture dal disco — è l'esito che la §22.2 dice
    /// «si ha in mano e si butta».
    ///
    /// Un documento che **nasce** non ha un prima, e per lui tutto è nuovo:
    /// [`DocChanges::everything`], che è la risposta vera e non una comodità —
    /// chi si è abbonato ai cambi di tag vuole sapere della nota che nasce
    /// con un tag.
    pub(crate) fn changes_for(&self, model: &DocumentModel, new: &Revision) -> DocChanges {
        let Some(before) = self.metas.get(&model.id) else {
            return DocChanges::everything();
        };
        let mut changes = DocChanges::default();
        // Il corpo non sta in cache (è lo split metadata/body): a rispondere è
        // l'impronta che l'anagrafe teneva del giro prima. Se non ce l'ha —
        // una voce entrata senza fingerprint — la risposta onesta è «sì»:
        // dire di no vorrebbe dire far perdere un risveglio a chi ha ragione.
        let body_changed = match self
            .entries
            .get(&model.id)
            .and_then(|e| e.fingerprint.as_ref())
        {
            Some(old) => old != new,
            None => true,
        };
        if body_changed {
            changes.aspects.push(DocChange::Body);
        }
        let keys = changed_properties(&before.frontmatter, &model.frontmatter);
        if !keys.is_empty() {
            changes.aspects.push(DocChange::Frontmatter);
            changes.properties = keys;
        }
        let (added, removed) = tag_diff(&self.tags.names_of(&model.id), &model.tags);
        if !added.is_empty() || !removed.is_empty() {
            changes.aspects.push(DocChange::Tags);
            changes.tags_added = added;
            changes.tags_removed = removed;
        }
        if before.links != model.links {
            changes.aspects.push(DocChange::Links);
        }
        if before.outline != model.outline {
            changes.aspects.push(DocChange::Outline);
        }
        if before.anchors != model.anchors {
            changes.aspects.push(DocChange::Anchors);
        }
        changes
    }

    pub(crate) fn set_entry(&mut self, entry: VaultEntry) {
        // **La regola *racily clean*, posta dove si osserva** (difetto 0187).
        //
        // Una data che non è strettamente nel passato rispetto a adesso è una
        // data che può ancora cambiare senza cambiare: il file può essere
        // riscritto in questo stesso millisecondo, dopo che l'abbiamo guardato,
        // e `mtime + size` direbbe lo stesso di prima. Quella voce si tiene in
        // memoria — dove è vera, perché il contenuto lo si è appena letto — e
        // **non si scrive** in anagrafe, così la prossima apertura la rilegge
        // invece di crederle.
        //
        // Sta qui e non nei chiamanti perché qui ci passano tutti: la
        // scansione, il rilevatore, la scrittura che sa cosa ha scritto. Ed è
        // qui e non alla scrittura della tabella perché è *adesso* il momento
        // dell'osservazione: fra questa riga e l'anagrafe scritta su disco ci
        // sta una sessione intera, e una soglia presa là dichiarerebbe pulito
        // tutto ciò che si è visto qui.
        if entry.mtime < crate::time::now_unix_millis() {
            self.osservate_nel_proprio_istante.remove(&entry.id);
        } else {
            self.osservate_nel_proprio_istante.insert(entry.id.clone());
        }
        self.nomi.inserisci(&entry.id, entry.kind);
        self.entries.insert(entry.id.clone(), entry);
    }

    /// Se di questa voce **non ci si può fidare fino alla prossima apertura**:
    /// la sua data non era nel passato quando la si è letta, quindi una
    /// scrittura arrivata subito dopo sarebbe indistinguibile da nessuna
    /// scrittura (difetto 0187). Chi scrive l'anagrafe la salta.
    pub(crate) fn osservata_nel_proprio_istante(&self, id: &DocId) -> bool {
        self.osservate_nel_proprio_istante.contains(id)
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
        for folder in fub_abi::query::folders_of(id) {
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
        self.nomi.togli(id);
        self.osservate_nel_proprio_istante.remove(id);
        self.entries.remove(id).map(|e| e.kind)
    }

    pub(crate) fn rebuild_graph(&mut self) {
        let _fase = tracing::info_span!(target: "fub.apertura", "rebuild_graph").entered();
        self.graph = LinkGraph::build(self.metas.values());
    }

    /// Il frontmatter di un documento, per chi compone una riga di risposta.
    pub(crate) fn frontmatter(&self, id: &DocId) -> Option<&Frontmatter> {
        self.metas.get(id).map(|m| &m.frontmatter)
    }

    /// Cosa nomina un riferimento: **quale** documento e, quando il riferimento
    /// porta un punto, **dove dentro** (decisione 0049).
    ///
    /// Prima di quella firma la risposta era un `DocId` e basta, e questo è il
    /// punto in cui si vedeva: `heading` e `block` di un `LinkTarget::Wiki`
    /// venivano scartati con un `..` — non per dimenticanza, ma perché non
    /// c'era dove metterli. Il modello li parsa dalla
    /// [0003](../../../../docs/decisions/0003-modello-del-documento.md), il
    /// confine li trasporta, la shell li rispecchia, e si perdevano nell'ultimo
    /// centimetro.
    ///
    /// I due spazi di nomi restano due, come li ha separati la 0003: `^blocco`
    /// si cerca fra le ancore, `#Sezione` fra gli heading dell'outline. Se il
    /// riferimento nomina un punto che non c'è più, la risposta resta il
    /// documento con `at: None` — un heading rinominato apre la nota in cima,
    /// che è più di quel che faceva prima e meno di una bugia.
    fn resolve(&self, target: &LinkTarget, from: Option<&DocId>) -> Option<ResolvedRef> {
        let doc = match target {
            // `[[#Sezione]]` e `[[#^blocco]]` nominano il documento che li
            // ospita, e senza un ospite non nominano niente: è la stessa
            // ragione per cui `from` esiste per i path relativi — la domanda
            // non è intera finché non si dice da dove la si fa.
            _ if target.names_host() => {
                let host = from?;
                self.metas.contains_key(host).then(|| host.clone())?
            }
            LinkTarget::Wiki { page, .. } => self.graph.resolve_wiki(page)?,
            // Un path relativo senza un documento che lo ospiti è relativo alla
            // radice: `DocId("")` non è un documento, è la cartella da cui
            // `resolve_against` parte, ed è la stessa che userebbe una nota
            // nella radice.
            LinkTarget::Path(raw) => self
                .graph
                .resolve_path(from.unwrap_or(&DocId::new("")), raw)?,
            // Il mondo esterno non è nel vault, e dirlo è una risposta: chi
            // passa qui l'esito di `classify` senza filtrarlo prima riceve
            // `None` invece di un errore.
            LinkTarget::Url(_) => return None,
        };
        let at = match target {
            LinkTarget::Wiki { heading, block, .. } => {
                self.position_in(&doc, heading.as_deref(), block.as_deref())
            }
            _ => None,
        };
        Some(ResolvedRef { doc, at })
    }

    /// Il punto che un `[[Nota#Sezione]]` o un `[[Nota#^blocco]]` nomina dentro
    /// `doc`.
    ///
    /// La revisione arriva dall'anagrafe (§14.1) e non da una lettura fatta
    /// apposta: l'impronta di un documento è già lì, calcolata quando il kernel
    /// ne ha letto i byte per parsarlo. Senza impronta non si produce una
    /// posizione — una coordinata che non sa dire *di quando* è una coordinata
    /// che chi la usa dovrebbe indovinare, e il contratto ha deciso di non
    /// permetterlo (`DocPosition::revision` non è opzionale).
    fn position_in(
        &self,
        doc: &DocId,
        heading: Option<&str>,
        block: Option<&str>,
    ) -> Option<DocPosition> {
        let meta = self.metas.get(doc)?;
        let (span, anchor) = match (block, heading) {
            (Some(id), _) => {
                let wanted = canonical_anchor(id);
                let found = meta.anchors.iter().find(|a| a.id == wanted)?;
                (found.span, wanted)
            }
            // La regola sta nel contratto (`heading_matches`) e non qui: chi
            // **scrive** l'ancora di un titolo e chi la **cerca** sono la
            // stessa cosa in due versi, e due copie non saprebbero nominare la
            // seconda di due sezioni omonime allo stesso modo. L'ancora che
            // torna è quella del titolo trovato, non quella ricalcolata sulla
            // domanda: `#Ciao, Mondo!` trova `ciao-mondo`, e il chiamante ha
            // diritto all'id vero.
            (None, Some(text)) => {
                let found = meta.outline.iter().find(|h| heading_matches(text, h))?;
                (found.span, found.slug.clone())
            }
            (None, None) => return None,
        };
        let revision = self.entries.get(doc)?.fingerprint.clone()?;
        Some(DocPosition::at(span, revision).with_anchor(anchor))
    }

    /// I documenti in relazione di link con `doc`, secondo il verso chiesto.
    ///
    /// Una volta ciascuno: [`LinkGraph::linked`] risponde con un insieme, e
    /// prima che quella firma esistesse questa funzione elencava *link* e non
    /// *documenti* — una nota che ne citava un'altra due volte compariva due
    /// volte. Non si vedeva perché a valle c'è il `BTreeMap` di [`Matches`], che
    /// li assorbiva: il difetto era coperto da un dettaglio d'implementazione di
    /// qualcun altro, ed è il modo in cui un difetto sopravvive a un refactor.
    fn linked(&self, doc: &DocId, direction: LinkDirection) -> BTreeSet<DocId> {
        self.graph.linked(doc, direction)
    }
}

impl QueryEvaluator for CoreIndex {
    fn universe(&self) -> Result<Matches, PluginError> {
        Ok(Matches::of_docs(self.metas.keys().cloned()))
    }

    fn predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        match predicate {
            QueryPredicate::Property { filter } => {
                let formats = self.date_formats();
                Ok(Matches::of_docs(
                    self.metas
                        .iter()
                        .filter(|(_, meta)| properties::test(&meta.frontmatter, filter, &formats))
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
            // Ciò che è rimasto non salvato (§15.2): il kernel è l'unico che
            // può rispondere, perché è l'unico che possiede quel posto sul
            // disco — e l'unico che sa, dall'anagrafe, se la nota c'è ancora.
            QueryRoute::Query(QueryKind::Drafts),
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
            // La resa di un documento (§1.6, decisione 0163): il kernel la
            // instrada come Outline — è una domanda che ha un solo risponditore,
            // e il risponditore è il kernel. La query arriva a
            // `Workspace::query_index`, che intercetta prima di `indexes.query`
            // perché `CoreIndex` non ha i documenti né i renderer.
            QueryRoute::Query(QueryKind::RenderPreview),
            QueryRoute::Query(QueryKind::RenderEmbed),
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

    /// Non perde niente, e la lista vuota che restituisce è un fatto e non una
    /// scorciatoia: questo indice tiene i propri metadati in memoria, e una
    /// `BTreeMap` che accetta una chiave non ha un modo di rifiutarla. Il
    /// giorno che ne avesse uno — un tetto, una quota — sarebbe qui che lo
    /// direbbe.
    fn on_documents_indexed(&mut self, docs: &[DocumentModel]) -> Vec<IndexLoss> {
        if !docs.is_empty() {
            self.graph_epoch = self.graph_epoch.wrapping_add(1);
        }
        for doc in docs {
            self.tags.upsert(&doc.id, &doc.tags);
            let meta = DocMeta::from(doc);
            if self.graph_update == GraphUpdate::Incremental {
                self.graph.upsert(&meta);
            }
            self.metas.insert(meta.id.clone(), meta);
        }
        Vec::new()
    }

    fn on_documents_removed(&mut self, ids: &[DocId]) -> Vec<IndexLoss> {
        if !ids.is_empty() {
            self.graph_epoch = self.graph_epoch.wrapping_add(1);
        }
        for id in ids {
            if self.metas.remove(id).is_none() {
                continue;
            }
            self.tags.remove(id);
            if self.graph_update == GraphUpdate::Incremental {
                self.graph.remove(id);
            }
        }
        Vec::new()
    }

    /// L'indice del kernel **è** la verità corrente: non ha niente da
    /// riconciliare con essa. Il rebuild completo, quando è la strategia
    /// scelta, lo chiude il workspace dopo la scansione.
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

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
                // Nessun estratto da omettere: questo indice non ha il corpo dei
                // documenti (è lo split metadata/body di M2), quindi seleziona e
                // basta — e una risposta senza estratti è già ciò che dà.
                excerpts: _,
            } => {
                let matches = self.expr(&matching)?;
                Ok(IndexResult::Documents(self.finish_documents(
                    matches,
                    sort.as_ref(),
                    &select,
                    page,
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
                    &self.date_formats(),
                );
                Ok(IndexResult::PropertyValues(Paged::window(facets, page)))
            }
            IndexQuery::VaultHealth { check, page } => {
                let issues = health::run(
                    check,
                    self.metas
                        .iter()
                        .map(|(id, m)| (id, m.links.as_slice(), &m.frontmatter)),
                    // Il risolutore è il grafo **più l'anagrafe** (§14.1): il
                    // grafo sa dove arriva un link fra note, l'anagrafe sa se
                    // il PNG che una nota mostra c'è davvero. Con il solo grafo
                    // la seconda domanda non era rispondibile, e l'unica cosa
                    // onesta che si poteva fare era tacere su ogni allegato.
                    &health::VaultView {
                        graph: &self.graph,
                        entries: &self.entries,
                        nomi: &self.nomi,
                    },
                    &self.registry.all_extensions(),
                    &self.date_formats(),
                );
                Ok(IndexResult::VaultHealth(Paged::window(issues, page)))
            }
            IndexQuery::Drafts { page } => {
                // Il guasto risale a chi ha chiesto la pagina invece di
                // diventare una pagina vuota: chiedere le bozze e riceverne
                // zero perché la cartella non si è letta è il modo in cui il
                // recupero di un testo non salvato non viene offerto a nessuno.
                let drafts = self.drafts.read().map_err(|e| {
                    PluginError::Io(
                        format!("le bozze non si sono lette ({}): {e}", self.drafts.dir()).into(),
                    )
                })?;
                // **Qui `Paged::from_source` non guadagna niente**, ed è un
                // fatto misurato dal banco del §17.1 (decisione 0113) e non una
                // scelta di comodo: la linearità di questa famiglia sta *a
                // monte*, in `drafts.read()`, che apre e deserializza ogni
                // bozza del disco prima che questa riga cominci; e il `map` qui
                // sotto **sposta** il testo invece di copiarlo, quindi
                // costruirlo fuori dalla finestra non alloca. Chi volesse
                // rendere costante il prezzo di questa pagina deve paginare la
                // lettura, che è un'altra cosa e sta dall'altra parte.
                let items = drafts
                    .drafts
                    .into_iter()
                    .map(|d| {
                        let entry = self.entries.get(&d.doc);
                        DraftInfo {
                            doc: d.doc,
                            at: d.at,
                            base: d.base,
                            // L'anagrafe è la fonte di entrambi: `exists` è
                            // «c'è una voce», `current` è l'impronta che
                            // qualcuno ha già pagato. Nessuna delle due apre un
                            // file — offrire un recupero non deve costare una
                            // rilettura del vault.
                            exists: entry.is_some(),
                            current: entry.and_then(|e| e.fingerprint.clone()),
                            text: d.text,
                        }
                    })
                    .collect::<Vec<_>>();
                Ok(IndexResult::Drafts(Paged::window(items, page)))
            }
            // Il filtro sta **prima** della finestra, e non è un dettaglio: una
            // pagina tagliata sull'anagrafe intera e poi filtrata sarebbe una
            // pagina con dentro un numero di righe che dipende da cosa c'è nel
            // resto del vault (§14.4).
            IndexQuery::Entries {
                of_kind,
                within,
                page,
            } => Ok(IndexResult::Entries(Paged::from_source(
                self.entries
                    .values()
                    .filter(|e| of_kind.is_none_or(|k| e.kind == k))
                    .filter(|e| match &within {
                        Some(scope) => in_folder(&e.id, &scope.path, scope.descendants),
                        None => true,
                    }),
                page,
                // La clonazione è **qui dentro** e non un `.cloned()` sulla
                // catena: il filtro cammina l'anagrafe intera per dire quanti
                // sono, ma una `VaultEntry` la si copia solo se sta nella
                // finestra.
                VaultEntry::clone,
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
            IndexQuery::Resolve { target, from } => {
                Ok(IndexResult::Resolved(self.resolve(&target, from.as_ref())))
            }
            // La resa è intercettata da `Workspace::query_index` prima di
            // arrivare qui: `CoreIndex` non possiede i documenti né i renderer.
            // Questi bracci non si raggiungono mai, ma il `match` è esaustivo e
            // non accetta un `_` — vedi la 0104.
            IndexQuery::RenderPreview { .. } | IndexQuery::RenderEmbed { .. } => {
                Err(PluginError::Internal(
                    "la resa è di `Workspace::query_index`, non dell'indice del kernel".into(),
                ))
            }
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

/// I tag comparsi e quelli spariti. Le grafie e non le chiavi canoniche, perché
/// è la grafia che chi si è abbonato ha scritto nella propria automazione.
fn tag_diff(before: &[String], after: &[Tag]) -> (Vec<String>, Vec<String>) {
    let old: BTreeSet<&String> = before.iter().collect();
    let new: BTreeSet<&String> = after.iter().map(|t| &t.name).collect();
    let added: Vec<String> = new.difference(&old).map(|t| (*t).clone()).collect();
    let removed: Vec<String> = old.difference(&new).map(|t| (*t).clone()).collect();
    (added, removed)
}
