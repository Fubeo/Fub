//! Il comando e il lavoro che scrivono il PDF di una nota nel vault.
//!
//! La vista misura e impagina, e manda l'[elenco delle
//! pagine](super::ElencoPagine) col comando [`PDF_WRITE_PAGES`]. Il comando
//! controlla subito ciò che può controllare senza scrivere (l'elenco si legge
//! ed è intero, la destinazione è un nome di PDF libero o da sostituire) e
//! accoda il lavoro [`PDF_WRITE_JOB`] fra i lavori del core: l'id del lavoro
//! torna nell'esito, nell'effetto [`PDF_QUEUED`], e il centro attività lo
//! mostra con la sua barra (una pagina per passo) e lo sa annullare.
//!
//! Il lavoro scrive il PDF in memoria e lo deposita nel vault **una volta
//! sola, alla fine**, con [`write_document_bytes`]: lo storage scrive in un
//! file temporaneo e lo rinomina, quindi il file arriva intero o non arriva.
//! Un lavoro annullato, scaduto o fallito non lascia niente; un disco pieno o
//! una cartella in sola lettura sono l'errore della scrittura, e il file
//! di prima (se si stava sostituendo) resta com'era.
//!
//! [`write_document_bytes`]: fub_abi::traits::VaultWrite::write_document_bytes

use std::cell::RefCell;

use fub_abi::command::{
    Args, Choice, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope,
    CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::rules::path_policy::{self, Naming};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{CommandProvider, HostApi, JobProgress, JobSpec};
use serde::Deserialize;

use super::writer::{scrivi_con, valida, Controllo, Interruzione, Opzioni, QualitaImmagini};
use super::{ElencoPagine, ErroreEsportazione, Risorse, MAX_ELENCO_BYTE, MAX_TEMPO_MS};
use crate::draw::per_il_pdf;

/// Scrive nel vault il PDF di un elenco di pagine.
pub const PDF_WRITE_PAGES: &str = "pdf.write_pages";

/// Il lavoro che il comando accoda: lo stesso nome del comando.
pub const PDF_WRITE_JOB: &str = "pdf.write_pages";

/// L'effetto dell'esito del comando: `{ "job_id": "<id>", "path": "<pdf>" }`.
pub const PDF_QUEUED: &str = "fub.pdf.queued";

const P_PAGES: &str = "pages";
const P_TARGET: &str = "target";
const P_IMAGES: &str = "images";
const P_REPLACE: &str = "replace";
const P_NOTE: &str = "note";

const IMAGES_FULL: &str = "full";
const IMAGES_LIGHT: &str = "light";

const PDF: &str = ".pdf";

const T_TITLE: &str = "pdf.write_pages.title";
const T_DESC: &str = "pdf.write_pages.desc";
const T_PAGES: &str = "pdf.write_pages.pages.title";
const T_PAGES_DESC: &str = "pdf.write_pages.pages.desc";
const T_TARGET: &str = "pdf.write_pages.target.title";
const T_TARGET_DESC: &str = "pdf.write_pages.target.desc";
const T_IMAGES: &str = "pdf.write_pages.images.title";
const T_IMAGES_DESC: &str = "pdf.write_pages.images.desc";
const T_IMAGES_FULL: &str = "pdf.write_pages.images.full";
const T_IMAGES_LIGHT: &str = "pdf.write_pages.images.light";
const T_REPLACE: &str = "pdf.write_pages.replace.title";
const T_REPLACE_DESC: &str = "pdf.write_pages.replace.desc";
const T_NOTE: &str = "pdf.write_pages.note.title";
const T_NOTE_DESC: &str = "pdf.write_pages.note.desc";

const P_PLAN: &str = "plan_pdf_write";
const D_QUEUED: &str = "done_pdf_queued";
const E_TOO_BIG: &str = "e_pdf_pages_too_big";
const E_UNREADABLE: &str = "e_pdf_pages_unreadable";
const E_VERSION: &str = "e_pdf_pages_version";
const E_PAGE_SIZE: &str = "e_pdf_page_size";
const E_PAGES: &str = "e_pdf_pages_count";
const E_BROKEN_PAGE: &str = "e_pdf_page_broken";
const E_BOOKMARKS: &str = "e_pdf_bookmarks_broken";
const E_DATA: &str = "e_pdf_data_too_long";
const E_FONT: &str = "e_pdf_font";
const E_TIME: &str = "e_pdf_time";
const E_CANCELLED: &str = "e_pdf_cancelled";
const E_NOT_PDF: &str = "e_pdf_target_not_pdf";
const E_NAME: &str = "e_pdf_target_name";
const E_TAKEN: &str = "e_pdf_target_taken";
const E_PAYLOAD: &str = "e_pdf_job_payload";

/// Le stringhe in italiano, aggiunte al catalogo del bundle dei disegni.
pub(crate) fn in_italian(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Scrivi il PDF della nota")
        .with(
            T_DESC,
            "Scrive nel vault il PDF delle pagine che la vista ha impaginato: testo \
             vero, caratteri incorporati, collegamenti e segnalibri.",
        )
        .with(T_PAGES, "Pagine")
        .with(T_PAGES_DESC, "L'elenco delle pagine della vista, in JSON.")
        .with(T_TARGET, "PDF")
        .with(
            T_TARGET_DESC,
            "Dove scrivere il PDF nel vault, con l'estensione `.pdf`.",
        )
        .with(T_IMAGES, "Immagini")
        .with(
            T_IMAGES_DESC,
            "Piene come sono, o alleggerite alla risoluzione che serve per stamparle.",
        )
        .with(T_IMAGES_FULL, "Piene")
        .with(T_IMAGES_LIGHT, "Alleggerite")
        .with(T_REPLACE, "Sostituisci")
        .with(T_REPLACE_DESC, "Se il PDF c'è già, lo sostituisce.")
        .with(T_NOTE, "Nota")
        .with(
            T_NOTE_DESC,
            "La nota da cui vengono titolo, autore e lingua, se le pagine non li dicono.",
        )
        .with(P_PLAN, "Scrive il PDF «{doc}» ({pages} pagine)")
        .with(D_QUEUED, "Scrivo il PDF «{doc}»…")
        .with(
            E_TOO_BIG,
            "La nota è troppo grande per un PDF solo: le pagine superano {max} MiB.",
        )
        .with(
            E_UNREADABLE,
            "Le pagine da scrivere non si leggono. Riapri la nota e riprova.",
        )
        .with(
            E_VERSION,
            "Le pagine vengono da una versione di Fub diversa ({found}, serve la {expected}). \
             Riapri la nota e riprova.",
        )
        .with(
            E_PAGE_SIZE,
            "La misura della pagina non è valida: scegline un'altra.",
        )
        .with(
            E_PAGES,
            "Il PDF avrebbe {pages} pagine: se ne scrivono da 1 a {max}. Dividi la nota \
             in più parti.",
        )
        .with(
            E_BROKEN_PAGE,
            "La pagina {page} non si è impaginata bene e il PDF non si è scritto. Riapri \
             la nota e riprova.",
        )
        .with(
            E_BOOKMARKS,
            "I titoli della nota non diventano segnalibri e il PDF non si è scritto. Riapri \
             la nota e riprova.",
        )
        .with(
            E_DATA,
            "Il titolo, l'autore o la lingua della nota superano {max} caratteri: \
             accorciali e riprova.",
        )
        .with(
            E_FONT,
            "Il carattere «{family}» non si incorpora nel PDF: scegline un altro e riprova.",
        )
        .with(
            E_TIME,
            "Il PDF non si è scritto in {seconds} secondi: la nota è troppo pesante. Prova \
             con le immagini alleggerite o dividila in più parti.",
        )
        .with(
            E_CANCELLED,
            "Scrittura del PDF annullata: nessun file è stato scritto.",
        )
        .with(
            E_NOT_PDF,
            "«{doc}» non è il nome di un PDF: deve finire con `.pdf`.",
        )
        .with(
            E_NAME,
            "Il PDF non può chiamarsi «{doc}»: il nome non passa le regole dei file nuovi.",
        )
        .with(
            E_TAKEN,
            "«{doc}» c'è già: scegli un altro nome, o chiedi di sostituirlo.",
        )
        .with(
            E_PAYLOAD,
            "Il lavoro del PDF ha ricevuto una richiesta che non si legge.",
        )
}

/// Le stesse stringhe in inglese.
pub(crate) fn in_english(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(T_TITLE, "Write the note PDF")
        .with(
            T_DESC,
            "Writes into the vault the PDF of the pages the view laid out: real text, \
             embedded fonts, links and bookmarks.",
        )
        .with(T_PAGES, "Pages")
        .with(T_PAGES_DESC, "The view's page list, as JSON.")
        .with(T_TARGET, "PDF")
        .with(
            T_TARGET_DESC,
            "Where to write the PDF in the vault, ending in `.pdf`.",
        )
        .with(T_IMAGES, "Images")
        .with(
            T_IMAGES_DESC,
            "Full as they are, or lightened to the resolution needed to print them.",
        )
        .with(T_IMAGES_FULL, "Full")
        .with(T_IMAGES_LIGHT, "Lightened")
        .with(T_REPLACE, "Replace")
        .with(T_REPLACE_DESC, "If the PDF already exists, replace it.")
        .with(T_NOTE, "Note")
        .with(
            T_NOTE_DESC,
            "The note that gives title, author and language when the pages do not.",
        )
        .with(P_PLAN, "Write the PDF «{doc}» ({pages} pages)")
        .with(D_QUEUED, "Writing the PDF «{doc}»…")
        .with(
            E_TOO_BIG,
            "The note is too large for one PDF: the pages exceed {max} MiB.",
        )
        .with(
            E_UNREADABLE,
            "The pages to write cannot be read. Reopen the note and try again.",
        )
        .with(
            E_VERSION,
            "The pages come from a different version of Fub ({found}, {expected} is needed). \
             Reopen the note and try again.",
        )
        .with(
            E_PAGE_SIZE,
            "The page size is not valid: choose another one.",
        )
        .with(
            E_PAGES,
            "The PDF would have {pages} pages: from 1 to {max} can be written. Split the \
             note into parts.",
        )
        .with(
            E_BROKEN_PAGE,
            "Page {page} was not laid out correctly and the PDF was not written. Reopen \
             the note and try again.",
        )
        .with(
            E_BOOKMARKS,
            "The note's headings do not become bookmarks and the PDF was not written. \
             Reopen the note and try again.",
        )
        .with(
            E_DATA,
            "The note's title, author or language exceed {max} characters: shorten them \
             and try again.",
        )
        .with(
            E_FONT,
            "The font «{family}» cannot be embedded in the PDF: choose another and try again.",
        )
        .with(
            E_TIME,
            "The PDF was not written within {seconds} seconds: the note is too heavy. Try \
             lightened images or split it into parts.",
        )
        .with(E_CANCELLED, "PDF writing cancelled: no file was written.")
        .with(
            E_NOT_PDF,
            "«{doc}» is not a PDF name: it must end in `.pdf`.",
        )
        .with(
            E_NAME,
            "The PDF cannot be called «{doc}»: the name breaks the rules for new files.",
        )
        .with(
            E_TAKEN,
            "«{doc}» already exists: choose another name, or ask to replace it.",
        )
        .with(
            E_PAYLOAD,
            "The PDF job received a request that cannot be read.",
        )
}

/// Le stringhe del comando e del lavoro aggiunte ai cataloghi di un bundle,
/// lingua per lingua: l'inventario le monta nel bundle dei disegni.
pub fn con_le_stringhe(catalogs: Vec<StringCatalog>) -> Vec<StringCatalog> {
    catalogs
        .into_iter()
        .map(|catalog| match catalog.locale.as_str() {
            "it" => in_italian(catalog),
            "en" => in_english(catalog),
            _ => catalog,
        })
        .collect()
}

/// Un fornitore di comandi con in più `pdf.write_pages`.
///
/// Il PDF delle note sta nel bundle dei disegni (ne usa i caratteri e si
/// accende con la stessa feature), ma il modulo dei disegni non lo nomina:
/// lo compone l'inventario, che è la tavola di montaggio
/// (`tests/independent_modules.rs`).
pub struct ConIlPdf<P>(pub P);

impl<P: CommandProvider> CommandProvider for ConIlPdf<P> {
    fn commands(&self) -> Vec<CommandSpec> {
        let mut specs = self.0.commands();
        specs.push(spec());
        specs
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command == PDF_WRITE_PAGES {
            return invoke(args, mode, host);
        }
        self.0.invoke(command, args, mode, host)
    }
}

/// La spec del comando, una sola per l'elenco e per i test.
pub(crate) fn spec() -> CommandSpec {
    CommandSpec::new(PDF_WRITE_PAGES, Text::key(T_TITLE))
        .describing(Text::key(T_DESC))
        .with_param(
            ParamSpec::new(P_PAGES, Text::key(T_PAGES), ParamKind::Text)
                .describing(Text::key(T_PAGES_DESC))
                .required(),
        )
        .with_param(
            ParamSpec::new(P_TARGET, Text::key(T_TARGET), ParamKind::Text)
                .describing(Text::key(T_TARGET_DESC))
                .required(),
        )
        .with_param(
            ParamSpec::new(
                P_IMAGES,
                Text::key(T_IMAGES),
                ParamKind::Choice(vec![
                    Choice::new(IMAGES_FULL, Text::key(T_IMAGES_FULL)),
                    Choice::new(IMAGES_LIGHT, Text::key(T_IMAGES_LIGHT)),
                ]),
            )
            .describing(Text::key(T_IMAGES_DESC)),
        )
        .with_param(
            ParamSpec::new(P_REPLACE, Text::key(T_REPLACE), ParamKind::Bool)
                .describing(Text::key(T_REPLACE_DESC)),
        )
        .with_param(
            ParamSpec::new(P_NOTE, Text::key(T_NOTE), ParamKind::Document)
                .describing(Text::key(T_NOTE_DESC)),
        )
        // Un file del vault, nuovo o al posto di un PDF che l'utente ha
        // chiesto di sostituire.
        .with_scope(CommandScope::writing(CommandReach::Document))
}

/// La richiesta che il comando accoda e il lavoro legge.
#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct Richiesta {
    pages: String,
    target: String,
    #[serde(default)]
    light: bool,
    #[serde(default)]
    replace: bool,
    /// I dati della nota, per ciò che l'elenco lascia vuoto.
    #[serde(default)]
    title: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    lang: String,
}

/// Esegue il comando: controlla elenco e destinazione e accoda il lavoro.
pub(crate) fn invoke(
    args: serde_json::Value,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let args = Args::new(&args);
    let pages = args.text(P_PAGES).unwrap_or_default();
    let elenco = leggi(pages).map_err(errore)?;
    let target = destinazione(args.text(P_TARGET).unwrap_or_default())?;
    let replace = args.flag(P_REPLACE, false);
    // Un PDF che c'è già si sostituisce solo se l'utente l'ha chiesto; il
    // lavoro lo richiede alla fine, sulla revisione che trova allora.
    match host.document_revision(&target) {
        Ok(_) if !replace => return Err(PluginError::AlreadyExists(one(E_TAKEN, &target))),
        Ok(_) | Err(PluginError::NotFound(_)) => {}
        Err(other) => return Err(other),
    }
    if !replace && host.free_name(&target) != target {
        return Err(PluginError::AlreadyExists(one(E_TAKEN, &target)));
    }
    if mode.is_dry_run() {
        let plan = CommandPlan::of_edits(
            Text::message(
                P_PLAN,
                vec![
                    Arg::text("doc", target.as_str()),
                    Arg::int("pages", elenco.pagine.len() as i64),
                ],
            ),
            Vec::new(),
        )
        .with_doc(target);
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }
    let (title, author, lang) = match args.document(P_NOTE) {
        Some(note) => dati_della_nota(&note, host),
        None => Default::default(),
    };
    let richiesta = Richiesta {
        pages: pages.to_owned(),
        target: target.as_str().to_owned(),
        light: args.text(P_IMAGES) == Some(IMAGES_LIGHT),
        replace,
        title,
        author,
        lang,
    };
    let payload = serde_json::to_value(&richiesta)
        .map_err(|_| PluginError::Internal(Text::key(E_PAYLOAD)))?;
    let id = host.spawn_job(JobSpec {
        job: PDF_WRITE_JOB.to_owned(),
        payload,
    })?;
    Ok(
        CommandOutcome::notify(one(D_QUEUED, &target)).with_effect(CommandEffect::Custom {
            ns: PDF_QUEUED.into(),
            payload: serde_json::json!({ "job_id": id.0.to_string(), "path": target.as_str() }),
        }),
    )
}

/// Il lavoro: scrive il PDF e lo deposita nel vault, alla fine e tutto
/// insieme. Restituisce `{ path, bytes, pages, warnings }`.
///
/// `job` è il nome del lavoro: uno che non è [`PDF_WRITE_JOB`] è
/// [`PluginError::UnknownJob`].
pub fn run_job(
    job: &str,
    payload: serde_json::Value,
    host: &mut dyn HostApi,
) -> Result<serde_json::Value, PluginError> {
    if job != PDF_WRITE_JOB {
        return Err(PluginError::UnknownJob(job.to_owned().into()));
    }
    let richiesta: Richiesta =
        serde_json::from_value(payload).map_err(|_| PluginError::BadArgs(Text::key(E_PAYLOAD)))?;
    let mut elenco = leggi(&richiesta.pages).map_err(errore)?;
    let target = destinazione(&richiesta.target)?;
    for (campo, dato) in [
        (&mut elenco.titolo, &richiesta.title),
        (&mut elenco.autore, &richiesta.author),
        (&mut elenco.lingua, &richiesta.lang),
    ] {
        if campo.trim().is_empty() {
            campo.clone_from(dato);
        }
    }
    // I dati della nota passano dallo stesso controllo dell'elenco.
    valida(&elenco).map_err(errore)?;
    let opzioni = Opzioni {
        immagini: if richiesta.light {
            QualitaImmagini::Alleggerite
        } else {
            QualitaImmagini::Piene
        },
    };
    let inizio = host.now_unix_millis();
    let ponte = Ponte {
        host: RefCell::new(host),
        inizio,
        riportate: RefCell::new(None),
    };
    let scritto =
        scrivi_con(&elenco, &ponte, &opzioni, &mut ControlloDelLavoro(&ponte)).map_err(errore)?;
    let host = ponte.host.into_inner();
    // L'ultima domanda prima di scrivere: un annullamento arrivato dopo
    // l'ultima pagina non lascia il file.
    if let Err(annullato @ PluginError::Cancelled(_)) = host.random_bytes(0) {
        return Err(annullato);
    }
    let expected = if richiesta.replace {
        match host.document_revision(&target) {
            Ok(revision) => Some(revision),
            Err(PluginError::NotFound(_)) => None,
            Err(other) => return Err(other),
        }
    } else {
        None
    };
    host.write_document_bytes(&target, &scritto.pdf, expected)?;
    Ok(serde_json::json!({
        "path": target.as_str(),
        "bytes": scritto.pdf.len(),
        "pages": elenco.pagine.len(),
        "warnings": scritto.avvisi,
    }))
}

/// L'elenco dal suo JSON, dopo il controllo del peso e prima di ogni altro.
fn leggi(json: &str) -> Result<ElencoPagine, ErroreEsportazione> {
    if json.len() > MAX_ELENCO_BYTE {
        return Err(ErroreEsportazione::ElencoTroppoGrande {
            byte: json.len() as u64,
        });
    }
    let elenco: ElencoPagine =
        serde_json::from_str(json).map_err(|e| ErroreEsportazione::ElencoIlleggibile {
            motivo: e.to_string(),
        })?;
    valida(&elenco)?;
    Ok(elenco)
}

/// La destinazione nella forma dei nomi del vault: un PDF dal nome valido.
fn destinazione(scritta: &str) -> Result<DocId, PluginError> {
    let percorso = path_policy::from_outside(scritta);
    let doc = DocId::new(percorso.clone());
    if !percorso.to_ascii_lowercase().ends_with(PDF) || percorso.len() <= PDF.len() {
        return Err(PluginError::BadArgs(one(E_NOT_PDF, &doc)));
    }
    path_policy::check(&percorso, Naming::New)
        .map_err(|_| PluginError::BadArgs(one(E_NAME, &doc)))?;
    Ok(doc)
}

/// Titolo, autore e lingua dal frontmatter della nota (`title`, `author`,
/// `lang` e i loro nomi italiani); il titolo, se manca, è il nome del file.
/// Una nota che non si legge non ferma il PDF: i dati restano vuoti.
fn dati_della_nota(note: &DocId, host: &dyn HostApi) -> (String, String, String) {
    let Ok(model) = host.read_model(note) else {
        return Default::default();
    };
    let campo = |chiavi: &[&str]| -> String {
        chiavi
            .iter()
            .find_map(|k| match model.frontmatter.0.get(*k)? {
                serde_json::Value::String(s) => Some(s.trim().to_owned()),
                serde_json::Value::Array(voci) => {
                    let nomi: Vec<&str> = voci.iter().filter_map(|v| v.as_str()).collect();
                    Some(nomi.join(", "))
                }
                _ => None,
            })
            .filter(|s| !s.is_empty())
            .unwrap_or_default()
    };
    let mut titolo = campo(&["title", "titolo"]);
    if titolo.is_empty() {
        let nome = note.as_str().rsplit('/').next().unwrap_or_default();
        titolo = nome
            .rsplit_once('.')
            .map_or(nome, |(stelo, _)| stelo)
            .to_owned();
    }
    (
        titolo,
        campo(&["author", "autore", "authors", "autori"]),
        campo(&["lang", "language", "lingua"]),
    )
}

/// L'errore della scrittura come lo vede chi ha chiesto il PDF.
fn errore(e: ErroreEsportazione) -> PluginError {
    let pagina = |page: usize| Text::message(E_BROKEN_PAGE, vec![Arg::int("page", page as i64)]);
    let testo = match e {
        ErroreEsportazione::Annullato => return PluginError::Cancelled(Text::key(E_CANCELLED)),
        ErroreEsportazione::Versione { trovata } => Text::message(
            E_VERSION,
            vec![
                Arg::int("found", i64::from(trovata)),
                Arg::int("expected", i64::from(super::VERSIONE)),
            ],
        ),
        ErroreEsportazione::MisuraPagina => Text::key(E_PAGE_SIZE),
        ErroreEsportazione::NumeroPagine { pagine } => Text::message(
            E_PAGES,
            vec![
                Arg::int("pages", pagine as i64),
                Arg::int("max", super::MAX_PAGINE as i64),
            ],
        ),
        ErroreEsportazione::TroppiPezzi { pagina: p }
        | ErroreEsportazione::MisuraPezzo { pagina: p, .. }
        | ErroreEsportazione::FacciaSconosciuta { pagina: p, .. }
        | ErroreEsportazione::Posizioni { pagina: p, .. }
        | ErroreEsportazione::VettoreTroppoGrande { pagina: p, .. }
        | ErroreEsportazione::TroppiCollegamenti { pagina: p }
        | ErroreEsportazione::CollegamentoRotto { pagina: p, .. } => pagina(p),
        ErroreEsportazione::SottoInsieme { famiglia, .. } => {
            Text::message(E_FONT, vec![Arg::text("family", famiglia)])
        }
        ErroreEsportazione::ElencoIlleggibile { .. } => Text::key(E_UNREADABLE),
        ErroreEsportazione::ElencoTroppoGrande { .. } => Text::message(
            E_TOO_BIG,
            vec![Arg::int("max", (MAX_ELENCO_BYTE >> 20) as i64)],
        ),
        ErroreEsportazione::TroppiSegnalibri { .. }
        | ErroreEsportazione::SegnalibroRotto { .. } => Text::key(E_BOOKMARKS),
        ErroreEsportazione::DatiTroppoLunghi => {
            Text::message(E_DATA, vec![Arg::int("max", super::MAX_TESTO_DATI as i64)])
        }
        ErroreEsportazione::TempoScaduto { secondi } => {
            Text::message(E_TIME, vec![Arg::int("seconds", secondi as i64)])
        }
    };
    PluginError::BadArgs(testo)
}

fn one(key: &str, doc: &DocId) -> Text {
    Text::message(key, vec![Arg::text("doc", doc.as_str())])
}

/// L'host del lavoro, prestato sia alle risorse (che leggono) sia al controllo
/// (che riporta l'avanzamento): lo scrittore li chiama uno alla volta, mai
/// insieme.
struct Ponte<'h> {
    host: RefCell<&'h mut dyn HostApi>,
    inizio: u64,
    /// L'ultimo avanzamento riportato, per non ripeterlo.
    riportate: RefCell<Option<usize>>,
}

impl Risorse for Ponte<'_> {
    /// Un carattere di Fub (`/fonts/<nome>`, come l'app lo serve) dal binario;
    /// ogni altro dal vault.
    fn carattere(&self, file: &str) -> Option<Vec<u8>> {
        let nome = file.trim_start_matches('/');
        if let Some(nome) = nome.strip_prefix("fonts/") {
            if let Some(byte) = per_il_pdf::file_di_fub(nome) {
                return Some(byte.to_vec());
            }
        }
        self.dal_vault(file)
    }

    fn immagine(&self, file: &str) -> Option<Vec<u8>> {
        self.dal_vault(file)
    }
}

impl Ponte<'_> {
    /// I byte di un file del vault per percorso. Un indirizzo con uno schema
    /// (`https:`, `data:`) non è del vault: il lavoro non va in rete.
    fn dal_vault(&self, file: &str) -> Option<Vec<u8>> {
        if file.contains("://") || file.starts_with("data:") {
            return None;
        }
        let percorso = path_policy::from_outside(file);
        path_policy::check(&percorso, Naming::Existing).ok()?;
        self.host
            .borrow()
            .read_document_bytes(&DocId::new(percorso))
            .ok()
    }
}

/// Il controllo del lavoro: a ogni passo chiede all'host se il lavoro è
/// ancora voluto, guarda l'orologio e riporta le pagine fatte.
struct ControlloDelLavoro<'p, 'h>(&'p Ponte<'h>);

impl Controllo for ControlloDelLavoro<'_, '_> {
    fn continua(&mut self, fatte: usize, pagine: usize) -> Result<(), Interruzione> {
        let mut host = self.0.host.borrow_mut();
        // L'host di un lavoro annullato rifiuta ogni capacità: questa è la
        // più leggera, e non legge niente.
        if let Err(PluginError::Cancelled(_)) = host.random_bytes(0) {
            return Err(Interruzione::Annullato);
        }
        let trascorsi = host.now_unix_millis().saturating_sub(self.0.inizio);
        if trascorsi > MAX_TEMPO_MS {
            return Err(Interruzione::TempoScaduto {
                secondi: MAX_TEMPO_MS / 1000,
            });
        }
        let mut riportate = self.0.riportate.borrow_mut();
        if *riportate != Some(fatte) {
            *riportate = Some(fatte);
            host.report_progress(JobProgress {
                done: fatte as u64,
                total: Some(pagine as u64),
                label: None,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "lavoro_tests.rs"]
mod tests;
