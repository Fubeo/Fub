//! Il **banco del lato provider**: un host in memoria, e una suite di
//! conformità con cui provare un provider contro il **contratto**.
//!
//! Stava in `fub-features`, privato e `#[cfg(test)]` — cioè raggiungibile
//! nemmeno dagli integration test del suo stesso crate, solo dai suoi unit test.
//! Ora è qui ([decisione
//! 0054](../../../../docs/decisions/0196-test-e-artefatti-generati.md)).
//!
//! Serve a provare le feature **contro il contratto** e non contro il kernel:
//! una feature scritta come la scriverebbe un plugin non deve avere altro modo
//! di toccare il mondo che l'[`HostApi`], e un doppio in memoria lo dimostra
//! meglio di un vault vero (i test e2e col kernel vero ci sono comunque, in
//! `tests/`).
//!
//! Il pezzo che conta è l'**orologio che si muove a comando**: è il guadagno di
//! aver messo il tempo nel contratto, e permette di invecchiare le fasce di
//! ritenzione del versioning senza piantare timestamp finti dentro lo store.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub mod conformance;

use fub_abi::command::CommandOutcome;
use fub_abi::edit::{EditReport, EditRequest, Revision, WriteBase};
use fub_abi::event::Event;
use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor, LinkInsert};
use fub_abi::locale::Locale;
use fub_abi::model::{DateFormats, DocId, DocumentModel, Heading, LinkTarget, Span, TaskMarker};
use fub_abi::net::{HttpRequest, HttpResponse};
use fub_abi::query::{in_folder, Matches, QueryEvaluator, QueryPredicate};
use fub_abi::rules::path_policy::{self, fenced_doc_id, Naming};
use fub_abi::rules::{media, properties, trash};
use fub_abi::session::{
    AnchoredSelection, AnchoredSelections, PaneMode, SelectionSet, ViewContext,
};
use fub_abi::settings::{SettingEntry, SettingSource, SettingSpec, SettingValue};
use fub_abi::traits::{
    BacklinkRef, DataRead, DataWrite, HostCommands, HostEnv, HostEvents, HostNetwork, HostQuery,
    HostServices, IndexQuery, IndexResult, JobId, JobSpec, LinkDirection, NeighborRef, Page, Paged,
    SettingsRead, SettingsWrite, TagCount, TransferRead, TrashEntry, VaultEntry, VaultRead,
    VaultStructure, VaultWrite, ViewStateRead, ViewStateWrite,
};
use fub_abi::transfer::{ExportProvider, ImportProvider, MemorySink, PLUGIN_EXPORT_LIMIT};
use fub_abi::{PluginError, MAX_RANDOM_BYTES};

mod data;
mod lookup;
mod selection;
mod services;
mod setup;
mod write;

use selection::{unseeded, Selection};

/// Il nome di un documento che **nasce** in questo doppio: il recinto l'ha già
/// messo [`fenced_doc_id`], qui si aggiunge la portabilità e la forma NFC
/// (§15.5), come fa `KernelHost::create_document`.
fn born_here(id: &DocId) -> Result<DocId, PluginError> {
    path_policy::check(id.as_str(), Naming::New)
        .map_err(|why| PluginError::BadArgs(format!("`{id}`: {why}").into()))?;
    Ok(DocId::new(path_policy::normalized(id.as_str())))
}

/// Il recinto sui path dello **spazio dati**.
///
/// L'host vero confina ogni plugin nella sua cartella
/// (`Workspace::plugin_data_path`); questo doppio non ha cartelle, quindi non
/// può confinare — ma la metà che *è* una regola del contratto, cioè che un
/// path non risale e non nomina un'unità, la applica, ed è la stessa funzione.
fn fence_data(path: &str) -> Result<(), PluginError> {
    path_policy::fenced(path)
        .map_err(|why| PluginError::PermissionDenied(format!("`{path}`: {why}").into()))
}

/// Storage dei blob e dei documenti in memoria, più un orologio pilotabile.
#[derive(Default)]
pub struct MemoryHost {
    blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    /// Blob derivati della cache, separati dai dati autorevoli.
    cache_blobs: Mutex<BTreeMap<String, Vec<u8>>>,
    /// Le sorgenti di import aperte (decisione 0102): chiave → byte.
    ///
    /// In memoria come tutto il resto, ma dietro un handle come quelle vere, ed
    /// è il punto: chi scrive un importer che legge a pezzi deve poterlo provare
    /// senza un kernel e senza un file. Si semina con
    /// [`MemoryHost::with_source`].
    sources: Mutex<BTreeMap<u64, Vec<u8>>>,
    /// Contatore da cui nascono le chiavi delle sorgenti. Sale e non si ricicla,
    /// come nel kernel vero.
    next_source: AtomicU64,
    /// I documenti **a byte**, come stanno nel vault vero: un doppio che li
    /// tenesse come `String` non saprebbe rappresentare un allegato, e chi
    /// scrive un estrattore a `SourceKind::Bytes` non avrebbe come provarlo
    /// senza un kernel (§21.8).
    docs: Mutex<BTreeMap<String, Vec<u8>>>,
    now: AtomicU64,
    /// Il contesto servito da [`HostEnv::active_context`], come lo
    /// pubblicherebbe la shell.
    context: Mutex<Option<ViewContext>>,
    /// Quante volte [`HostEnv::active_context`] è stato chiamato.
    ///
    /// È lo stesso conto delle letture del vault, per il canale che non passa
    /// da un path: `active_context` **clona** il contesto — quindi anche il
    /// testo di ogni selezione — e chiederlo due volte nello stesso render è
    /// una copia buttata che nessun'altra traccia lascerebbe vedere, perché lo
    /// stato dopo è identico allo stato prima. Anche qui è un conto di
    /// operazioni e non un tempo.
    reads_from_context: AtomicU64,
    /// Backlink finti per [`HostQuery::query_index`], seminati per target. Il
    /// doppio non ha un grafo: risponde solo a ciò che gli è stato messo dentro,
    /// ed è quanto basta a provare una view contro il contratto.
    backlinks: Mutex<BTreeMap<String, Vec<BacklinkRef>>>,
    /// Outline finti per [`HostQuery::query_index`], seminati per documento: il
    /// doppio non parsa, come non parsa il kernel dietro `IndexQuery::Outline`.
    outlines: Mutex<BTreeMap<String, Vec<Heading>>>,
    /// Aggregazione dei tag finta per [`IndexQuery::Tags`].
    tags: Mutex<Vec<TagCount>>,
    /// Archi finti per [`IndexQuery::Neighbors`], seminati come coppie
    /// (sorgente, destinazione). Il doppio non ha un grafo — come per i
    /// backlink — e la ragione per cui questo campo esiste comunque è che una
    /// vista a grafo (§3.3) chiede il vault **intero** in una domanda sola, e
    /// senza un ramo qui si proverebbe solo end-to-end.
    edges: Mutex<Vec<(String, String)>>,
    /// Modelli finti per [`VaultRead::read_model`], seminati per documento. Il
    /// doppio **non parsa** — come non parsa per l'outline — e la ragione è la
    /// stessa: un host in memoria che si portasse dentro un `FormatProvider`
    /// proverebbe la feature contro *quel* provider invece che contro il
    /// contratto. Chi vuole il parse vero ha i test end-to-end col kernel.
    models: Mutex<BTreeMap<String, DocumentModel>>,
    /// Formati finti per [`VaultRead::format_of`], seminati per **estensione**
    /// senza il punto — che è la chiave con cui risponde anche il registro vero.
    formats: Mutex<BTreeMap<String, DocumentFormat>>,
    /// Il cestino: id nel cestino → (voce, byte). È in memoria come il
    /// resto, ma ha la stessa forma di quello vero — due id per voce, e il
    /// ripristino che rifiuta un path occupato — perché è quella forma che le
    /// feature provano. I byte sono quelli grezzi del vault: un allegato
    /// cestinato resta byte, non testo.
    trash: Mutex<BTreeMap<String, (TrashEntry, Vec<u8>)>>,
    /// Acceso, la **prossima** `free_name` occupa il nome che risponde.
    ///
    /// Si spegne da sé, perché la corsa da provare è quella di *una* domanda: un
    /// interruttore che restasse acceso renderebbe ogni nome libero occupato, e
    /// il banco proverebbe «create_document rifiuta sempre» invece di «rifiuta
    /// chi ha perso la corsa».
    steals_the_name_free: AtomicBool,
    /// Contatore per timbrare le voci del cestino con id distinti.
    trashed: AtomicU64,
    /// Le impostazioni **dichiarate** (§11.1) e ciò che è stato scritto: il
    /// doppio tiene un livello solo, perché la precedenza fra i due livelli è
    /// del kernel e si prova là — qui si prova che una feature legge la propria
    /// configurazione dall'`HostApi` e non da una variabile d'ambiente.
    settings: Mutex<BTreeMap<String, (SettingSpec, Option<SettingValue>)>>,
    /// L'esemplare di view per conto del quale questo doppio sta agendo (§11.2).
    /// `None` — il default — è «non si sta disegnando nessuna view», ed è la
    /// condizione in cui lo stato di vista non c'è: chi prova una view che
    /// ricorda qualcosa lo dice con [`MemoryHost::with_instance`].
    view_instance: Mutex<Option<String>>,
    /// (esemplare, chiave) → valore. Il proprietario **non** è nella chiave
    /// perché questo doppio lo dà a un provider solo, e non ha un id da
    /// timbrargli: il recinto fra proprietari è del kernel e si prova là.
    view_state: Mutex<BTreeMap<(String, String), serde_json::Value>>,
    /// Il locale servito da [`HostEnv::locale`], come lo comporrebbe il kernel
    /// dopo aver sentito la shell e le impostazioni (§12.3). Il default è quello
    /// del contratto — lingua indeterminata, UTC — perché un banco che partisse
    /// italiano nasconderebbe proprio i posti in cui una feature dà per scontata
    /// una lingua.
    locale: Mutex<Locale>,
    /// Contatore da cui [`HostEnv::random_bytes`] deriva byte deterministici.
    entropy: AtomicU64,
    /// Un host che **non concede entropia**: `random_bytes` rende
    /// `PermissionDenied`. Non è un capriccio del doppio, è la condizione di un
    /// `Guard` senza `Capability::Env` — e l'unico modo di provare che chi
    /// costruisce un id se ne accorga invece di produrne uno tutto a zeri.
    without_entropy: std::sync::atomic::AtomicBool,
    /// Le risposte di rete **preparate**, nell'ordine in cui verranno servite.
    ///
    /// Vuota è il default, e il default **rifiuta**: un banco che rispondesse
    /// `200` a una richiesta che nessuno ha preparato renderebbe verde un test
    /// che chiede alla rete cose che il suo autore non sapeva di chiedere. Il
    /// rifiuto è `Unserved` e non un errore inventato, perché è esattamente ciò
    /// che risponde un host montato senza client (§23.3): il doppio non finge
    /// di avere un filo.
    answers: Mutex<std::collections::VecDeque<Result<HttpResponse, PluginError>>>,
    /// Le richieste **viste**, in ordine. È la metà che serve ad asserire: che
    /// un provider abbia chiesto *quell'URL con quel verbo* è la cosa che si
    /// vuole provare, e senza questo elenco si potrebbe solo provare cosa ne ha
    /// fatto.
    requests: Mutex<Vec<HttpRequest>>,
    /// I path dello spazio dati su cui `data_write` rifiuta. Vuoto è il
    /// default. Si accende con [`MemoryHost::denies_write`].
    writes_negate: Mutex<std::collections::BTreeSet<String>>,
    /// Il **conto** delle `data_write`, per path: quante volte e quanti byte.
    ///
    /// I blob dicono com'è finito lo spazio dati; questo dice **quanto è
    /// costato arrivarci**, ed è l'unica delle due cose che vede un difetto di
    /// prestazioni. Un file riscritto mille volte e uno scritto una sola
    /// lasciano lo stesso `blobs`, e senza questo contatore un presidio sulla
    /// quantità di lavoro sarebbe verde in tutti e due i casi. È un conto di
    /// operazioni e non un tempo apposta: su una macchina condivisa un tempo
    /// non è un segnale.
    writes: Mutex<BTreeMap<String, (usize, usize)>>,
    /// Il **conto** delle letture, per path: quante volte e quanti byte.
    ///
    /// L'altra metà di [`MemoryHost::scritture_su`], e serve per la stessa
    /// ragione rovesciata: i blob e i documenti dicono cosa c'è, non **quante
    /// volte è stato aperto**. Un comando che rilegge il vault intero e uno che
    /// chiede solo le note che gli servono lasciano dietro di sé esattamente lo
    /// stesso stato, e senza questo conto un presidio sulla quantità di lettura
    /// sarebbe verde in tutti e due i casi.
    ///
    /// Ci finiscono le letture del **vault** (per `DocId`) e quelle dello
    /// **spazio dati** (per path): sono i due canali da cui si legge, e la
    /// chiave è quella con cui il chiamante ha chiesto. Anche qui è un conto di
    /// operazioni e non un tempo: su una macchina condivisa un tempo non è un
    /// segnale.
    reads: Mutex<BTreeMap<String, (usize, usize)>>,
    /// Gli importer e gli exporter del banco, in ordine di registrazione: è
    /// il registro che [`HostServices::run_import`] e
    /// [`HostServices::run_export`] interrogano. Si seminano con
    /// [`MemoryHost::with_import_provider`] e
    /// [`MemoryHost::with_export_provider`].
    imports: Mutex<Vec<SharedImport>>,
    exports: Mutex<Vec<Arc<dyn ExportProvider>>>,
}

type SharedImport = Arc<Mutex<Box<dyn ImportProvider>>>;

impl VaultRead for MemoryHost {
    fn read_document(&self, id: &DocId) -> Result<String, PluginError> {
        let bytes = self.read_document_bytes(id)?;
        // Come il vault vero: non si indovina un encoding, si dice di no.
        String::from_utf8(bytes)
            .map_err(|and| PluginError::Io(format!("{id} non è UTF-8: {and}").into()))
    }

    fn read_document_bytes(&self, id: &DocId) -> Result<Vec<u8>, PluginError> {
        let id = fenced_doc_id(id)?;
        let bytes = self
            .docs
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::NotFound(id.to_string().into()))?;
        // Solo le letture **riuscite**, come per le scritture: chiedere un
        // documento che non c'è non è lavoro fatto sul disco.
        self.record_read(id.as_str(), bytes.len());
        Ok(bytes)
    }

    fn document_revision(&self, id: &DocId) -> Result<Revision, PluginError> {
        // Sui byte grezzi, non sul testo: per un sorgente UTF-8 è la stessa
        // impronta (`of` è `of_bytes` del testo), ma un allegato non è testo e
        // `read_document` lo rifiuterebbe — mentre la revisione è di ciò che
        // sta nel vault, non di ciò che si riesce a leggere come testo.
        Ok(Revision::of_bytes(&self.read_document_bytes(id)?))
    }

    /// In ordine di id e a finestra, come il kernel: un doppio che
    /// restituisse tutto in ordine di hash farebbe passare i test a chi si
    /// affida a un ordine che in produzione non c'è. Soltanto i documenti,
    /// come nel vault vero: un allegato o un file che nessun formato serve sta
    /// nell'anagrafe ([`IndexQuery::Entries`]), non qui.
    fn list_documents(&self, page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        Ok(Paged::window(self.documents(), page))
    }

    /// Il modello **seminato**, non uno parsato: un documento che esiste ma di
    /// cui nessuno ha seminato il modello risponde come uno che non esiste — chi
    /// prova una feature sul modello deve dire quale modello sta provando.
    fn read_model(&self, id: &DocId) -> Result<DocumentModel, PluginError> {
        let id = fenced_doc_id(id)?;
        self.models
            .lock()
            .unwrap()
            .get(id.as_str())
            .cloned()
            .ok_or_else(|| PluginError::Internal(format!("{id}: nessun modello seminato").into()))
    }

    /// Il registro **seminato**, e sotto di esso il markdown che ogni vault di
    /// Fub serve comunque: vedi [`formato_di_serie`].
    fn format_of(&self, id: &DocId) -> Option<DocumentFormat> {
        let ext = id
            .as_str()
            .rsplit_once('.')
            .map(|(_, and)| and.to_lowercase())?;
        if let Some(seeded) = self.formats.lock().unwrap().get(&ext) {
            return Some(seeded.clone());
        }
        format_of_series(&ext)
    }

    /// La convenzione D3 su ciò che questo host ha in memoria: `nome.md`,
    /// `nome 1.md`, … Nel kernel la stessa risposta guarda anche il disco
    /// (`Workspace::free_name`), che qui non c'è.
    fn free_name(&self, id: &DocId) -> DocId {
        let mut docs = self.docs.lock().unwrap();
        let (stem, ext) = match id.as_str().rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.contains('/') => {
                (stem, format!(".{ext}"))
            }
            _ => (id.as_str(), String::new()),
        };
        let free = (0u32..)
            .map(|n| match n {
                0 => id.clone(),
                n => DocId::new(format!("{stem} {n}{ext}")),
            })
            .find(|c| !docs.contains_key(c.as_str()))
            .expect("la sequenza dei candidati è infinita");
        // **Qualcun altro prende il nome fra la domanda e la scrittura.**
        //
        // È la corsa che `free_name` dichiara di non chiudere — *«non prenota
        // niente: fra la domanda e la scrittura il nome può diventare occupato,
        // e a quel punto è la scrittura a dirlo»* — e che nessun banco di questo
        // repo costruiva. Senza una maniglia non è costruibile senza thread, e
        // con i thread sarebbe una speranza sulla schedulazione invece di un
        // fatto: qui la finestra si apre dove è dichiarata, cioè dentro la
        // risposta, e chi legge il banco vede il momento esatto.
        if self.steals_the_name_free.swap(false, Ordering::SeqCst) {
            docs.insert(free.as_str().to_string(), b"di qualcun altro".to_vec());
        }
        free
    }

    /// Il Markdown di serie scrive il link come il provider vero; un formato
    /// seminato con [`with_format`](MemoryHost::with_format) non ha una
    /// grammatica qui, e risponde «non so» come un provider senza
    /// l'operazione. Un link che la grammatica non sa scrivere è `internal`,
    /// come nel kernel, che riceve dal provider un errore di serializzazione.
    /// La parità col provider vero la prova
    /// `markdown_writes_links_and_ticks_alike` in `both_hosts_answer_alike`.
    fn format_link(&self, doc: &DocId, link: &LinkInsert) -> Result<Option<String>, PluginError> {
        if !self.speaks_series_markdown(doc) {
            return Ok(None);
        }
        series_markdown::link(link).map_err(|why| PluginError::Internal(why.into()))
    }

    /// Come [`format_link`](VaultRead::format_link): il simbolo del Markdown di
    /// serie, sulla revisione dei byte che il doppio ha adesso.
    fn task_state_edit(
        &self,
        doc: &DocId,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Option<EditRequest>, PluginError> {
        if !self.speaks_series_markdown(doc) {
            return Ok(None);
        }
        let source = self.read_document(doc)?;
        let edits = series_markdown::task(&source, marker, done)
            .map_err(|why| PluginError::Internal(why.into()))?;
        Ok(Some(EditRequest::new(Revision::of(&source), edits)))
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        let trash = self.trash.lock().unwrap();
        let mut entries: Vec<TrashEntry> = trash.values().map(|(and, _)| and.clone()).collect();
        entries.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(a.id.cmp(&b.id)));
        Ok(entries)
    }
}

/// Le due scritture mirate del Markdown di serie, per il doppio.
///
/// Sono la grammatica di `fub-format-markdown` ridotta a ciò che le feature
/// chiedono: un wikilink, un embed e il simbolo di un task. Il doppio non può
/// dipendere dal provider (vedi `models`), e la copia è tenuta onesta dal
/// banco di parità del kernel.
mod series_markdown {
    use fub_abi::edit::TextEdit;
    use fub_abi::format::LinkInsert;
    use fub_abi::model::{parse_wikilink_inner, Span, TaskMarker};

    pub(super) fn link(link: &LinkInsert) -> Result<Option<String>, String> {
        let Some(inside) = link.target.wiki_inner() else {
            return Ok(None);
        };
        let label = link.label.as_deref().filter(|label| *label != inside);
        let inner = match label {
            Some(label) => format!("{inside}|{label}"),
            None => inside.clone(),
        };
        let read_back = parse_wikilink_inner(&inner);
        if inner.contains(['[', ']', '\n', '\r'])
            || read_back.target != link.target
            || read_back.alias.as_deref() != label
        {
            return Err(format!("«{inner}» non si scrive in un wikilink"));
        }
        let bang = if link.embed { "!" } else { "" };
        Ok(Some(format!("{bang}[[{inner}]]")))
    }

    pub(super) fn task(
        source: &str,
        marker: &TaskMarker,
        done: bool,
    ) -> Result<Vec<TextEdit>, String> {
        let Some(symbol) = source.get(marker.span.start..marker.span.end) else {
            return Err("il marcatore è fuori dalla sorgente".to_string());
        };
        if symbol.chars().count() != 1 || !between_the_brackets_of_an_item(source, marker.span) {
            return Err(format!(
                "nessun task ha il marcatore in {}..{}",
                marker.span.start, marker.span.end
            ));
        }
        let wanted = if done { "x" } else { " " };
        Ok(vec![TextEdit::replace(marker.span, wanted)])
    }

    /// Il carattere fra le parentesi di un elemento d'elenco — `- [ ]`,
    /// `1. [x]`, anche citato (`> - [ ]`) — seguito da uno spazio o dalla fine
    /// della riga. È il task del provider ridotto a una riga: senza, il doppio
    /// scriveva la spunta su qualunque byte gli si indicasse, anche in mezzo
    /// alla prosa, dove il kernel rifiuta. Un elenco dentro un blocco di
    /// codice qui passa: la riga non sa di stare in un blocco.
    fn between_the_brackets_of_an_item(source: &str, span: Span) -> bool {
        let line = source[..span.start].rfind('\n').map_or(0, |at| at + 1);
        let Some(before) = source[line..span.start].strip_suffix('[') else {
            return false;
        };
        let closes = source[span.end..]
            .strip_prefix(']')
            .is_some_and(|rest| rest.is_empty() || rest.starts_with([' ', '\t', '\n', '\r']));
        let head = before.trim_start_matches([' ', '\t', '>']);
        let gap = match head.strip_prefix(['-', '*', '+']) {
            Some(gap) => gap,
            None => {
                let digits =
                    head.len() - head.trim_start_matches(|c: char| c.is_ascii_digit()).len();
                match head[digits..].strip_prefix(['.', ')']) {
                    Some(gap) if (1..=9).contains(&digits) => gap,
                    _ => return false,
                }
            }
        };
        closes && !gap.is_empty() && gap.trim_start_matches([' ', '\t']).is_empty()
    }
}

/// **Il markdown, che ogni vault di Fub serve.**
///
/// Il registro dei formati di questo doppio è ciò che gli si semina con
/// [`MemoryHost::with_format`], e finché era *soltanto* quello il doppio si
/// comportava come un vault in cui non è registrato nessun provider: `format_of`
/// rispondeva «non so» per ogni estensione, e la scrittura scriveva lo stesso —
/// mentre il kernel, che un registro ce l'ha, risponde `unserved` a chi prova a
/// scrivere un formato che nessuno parsa. Un plugin che crea `appunti.txt`
/// passava di qua e si rompeva di là (difetto 0222).
///
/// Il markdown non si semina perché non è una scelta di chi scrive il banco: è
/// ciò che il core registra in ogni vault, ed è la ragione per cui un doppio
/// vuoto deve rispondere *come un vault vero* e non *come un vault vuoto*. Chi
/// ne serve altri li dichiara, e chi vuole un markdown diverso lo sovrascrive —
/// `with_format` vince, perché il registro seminato si guarda per primo.
///
/// Le capacità sono **quelle del provider vero**, sintassi di lettura
/// comprese: una feature che decide da una capacità (scrivere un blocco, una
/// proprietà, un `[[link]]`, leggere le note a piè di pagina dal modello) deve
/// ricevere qui la risposta che riceve nel vault. Il doppio non parsa — i
/// modelli si seminano, vedi `read_model` — ma la dichiarazione dice cosa il
/// formato *sa*, non chi lo sta parsando.
fn format_of_series(ext: &str) -> Option<DocumentFormat> {
    matches!(ext, "md" | "markdown").then(|| DocumentFormat {
        descriptor: FormatDescriptor::text("markdown", "Markdown (Obsidian)", &["md", "markdown"]),
        capabilities: FormatCapabilities::of(&[
            fub_abi::options::syntax::WIKILINKS,
            fub_abi::options::syntax::TAGS,
            fub_abi::options::syntax::FRONTMATTER,
            fub_abi::options::syntax::CALLOUTS,
            fub_abi::options::syntax::EMBEDS,
            fub_abi::options::syntax::FOOTNOTES,
            fub_abi::options::syntax::DEFINITION_LISTS,
            fub_abi::options::syntax::MATH,
            fub_abi::options::source::PROSE,
        ]),
    })
}

#[cfg(test)]
mod tests;
