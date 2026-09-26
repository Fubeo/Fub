//! La cattura rapida: un testo che arriva da fuori (il clipper del browser, la
//! condivisione mobile, la CLI, un URI `fub://capture`) e diventa una nota del
//! vault.
//!
//! È **un** comando dell'host, [`CAPTURE_APPLY`], e i trasporti lo chiamano
//! invece di ricomporlo. Erano quattro copie, e divergevano nel nome della
//! nota, nel separatore fra i blocchi, nella riga della fonte e nel controllo
//! del vault. La validazione è quella di [`validate_capture_v1`]; le scritture
//! passano dai comandi del registro (`note.create`, `note.from_template`,
//! `note.daily`, `note.property.set`), con le loro regole di nome e di formato.
//!
//! **L'ordine delle scritture è la garanzia.** Ogni controllo viene prima di
//! ogni scrittura: il formato della destinazione deve dichiarare
//! [`source::PROSE`], perché il testo catturato è Markdown scritto dentro un
//! sorgente. Poi le proprietà, che ripetute non cambiano niente, e per ultimo
//! il testo, in una scrittura sola: è l'unico passo che ripetuto duplicherebbe
//! qualcosa, quindi un nuovo tentativo dopo un errore non trova mai metà
//! cattura. Una nota nata da questa cattura e rimasta senza testo torna nel
//! cestino.
//!
//! [`new_note`] è `fub://new` con le stesse regole: il nome dal titolo quando
//! manca, il titolo `# …` dove comincia il corpo, e le stesse garanzie.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::model::DocId;
use fub_abi::options::{source, syntax};
use fub_abi::rules::folders;
use fub_abi::rules::path_policy::{self, Naming};
use fub_abi::text::{Arg, Text};
use fub_abi::PluginError;

use crate::automation::{
    validate_capture_v1, validate_target_path, validate_title, AutomationError, CaptureMode,
    CapturePayloadV1,
};
use crate::Host;

/// L'id del comando.
pub const CAPTURE_APPLY: &str = "capture.apply";

const PAYLOAD: &str = "payload_json";
const TEMPLATE: &str = "template";

// I comandi del registro che la cattura compone. Si nominano per id: ognuno è
// di una feature che si può spegnere, e allora la risposta giusta è il suo
// `UnknownCommand`, prima di qualunque scrittura.
const NOTE_CREATE: &str = "note.create";
const NOTE_FROM_TEMPLATE: &str = "note.from_template";
const NOTE_DAILY: &str = "note.daily";
const NOTE_PROPERTY_SET: &str = "note.property.set";
const NOTE_TRASH: &str = "note.trash";

/// Quanto del titolo diventa nome: abbastanza per riconoscerlo, e sotto il
/// limite di un segmento anche con l'estensione e con caratteri da 4 byte.
const STEM_MAX_CHARS: usize = 80;
const STEM_MAX_BYTES: usize = 200;

/// La spec del comando: una sola, per l'elenco e per il dispatcher.
pub(crate) fn spec() -> CommandSpec {
    CommandSpec::new(CAPTURE_APPLY, Text::key("host.capture.title"))
        .describing(Text::key("host.capture.desc"))
        .with_param(
            ParamSpec::new(
                PAYLOAD,
                Text::key("host.param.capture_payload"),
                ParamKind::Text,
            )
            .required(),
        )
        .with_param(ParamSpec::new(
            TEMPLATE,
            Text::key("host.param.template"),
            ParamKind::Text,
        ))
        .with_scope(CommandScope::writing(CommandReach::Vault))
}

/// `capture.apply` dal registro: il payload arriva come testo JSON, come ogni
/// forma strutturata che attraversa `invoke_command`.
pub(crate) fn invoke(
    host: &Host,
    vault: Option<&str>,
    args: serde_json::Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    spec().validate_args(&args)?;
    let args = Args::new(&args);
    let raw = args.text(PAYLOAD).expect("spec validata");
    let payload: CapturePayloadV1 = serde_json::from_str(raw).map_err(|why| {
        PluginError::BadArgs(Text::message(
            "host.capture.payload",
            vec![Arg::text("why", why.to_string())],
        ))
    })?;
    let template = args.text(TEMPLATE);
    if mode.is_dry_run() {
        let doc = plan(host, vault, &payload, template)?;
        let summary = Text::message(
            "host.capture.plan",
            vec![
                Arg::text("title", payload.title.trim()),
                Arg::text("doc", doc.as_str()),
            ],
        );
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
            CommandPlan::of_edits(summary, Vec::new()).with_doc(doc),
        )));
    }
    let doc = apply(host, vault, &payload, template)?;
    Ok(CommandOutcome::notify(Text::message(
        "host.capture.done",
        vec![Arg::text("doc", doc.as_str())],
    ))
    .with_effect(CommandEffect::Navigate { doc }))
}

/// Dove andrebbe la cattura, senza scrivere niente: ogni controllo di
/// [`apply`] che si può fare prima di una scrittura.
pub fn plan(
    host: &Host,
    vault: Option<&str>,
    payload: &CapturePayloadV1,
    template: Option<&str>,
) -> Result<DocId, PluginError> {
    Capture::clip(host, vault, payload, template)?.planned()
}

/// Scrive la cattura e dice in quale documento.
///
/// Il vault è quello che il payload nomina, altrimenti `vault`, e deve essere
/// già aperto: aprirlo, e decidere se chi chiede può scriverci, è del
/// trasporto. `template` vale soltanto per `create`.
pub fn apply(
    host: &Host,
    vault: Option<&str>,
    payload: &CapturePayloadV1,
    template: Option<&str>,
) -> Result<DocId, PluginError> {
    let capture = Capture::clip(host, vault, payload, template)?;
    let planned = capture.planned()?;
    capture.write(&planned)
}

/// La nota che `fub://new` chiede.
#[derive(Clone, Copy, Debug, Default)]
pub struct NewNote<'a> {
    /// La cartella, se il nome non ne nomina già una.
    pub folder: Option<&'a str>,
    /// Il nome voluto. Senza, quello del titolo; senza titolo, quello che
    /// sceglie il comando.
    pub name: Option<&'a str>,
    /// Il titolo, che la nota riceve in testa al corpo come `# {title}`.
    pub title: Option<&'a str>,
    /// Il template da cui nasce, invece di una nota vuota.
    pub template: Option<&'a str>,
}

/// Crea la nota di `fub://new` e dice quale; in [`InvokeMode::DryRun`] dice
/// soltanto quale nascerebbe, dopo gli stessi controlli. Nome, posto del
/// titolo e ordine delle scritture sono quelli della cattura.
pub fn new_note(
    host: &Host,
    vault: Option<&str>,
    note: &NewNote<'_>,
    mode: InvokeMode,
) -> Result<DocId, PluginError> {
    let capture = Capture::new_note(host, vault, note)?;
    let planned = capture.planned()?;
    if mode.is_dry_run() {
        return Ok(planned);
    }
    capture.write(&planned)
}

/// Una cattura validata, con la destinazione già decisa.
struct Capture<'a> {
    host: &'a Host,
    vault: Option<&'a str>,
    target: Target,
    content: Content<'a>,
}

/// Che cosa si scrive nel documento.
enum Content<'a> {
    /// Il blocco di una cattura: il titolo, il testo e la fonte.
    Clip(&'a CapturePayloadV1),
    /// Soltanto il titolo, in testa al corpo: `fub://new?title=`.
    Title(&'a str),
    /// Niente: la nota nasce com'è.
    Nothing,
}

/// Dove va il testo.
enum Target {
    /// Un documento che c'è già: `append` e `prepend`.
    Existing { doc: DocId, prepend: bool },
    /// Un documento che un comando del registro crea, o apre se c'è già
    /// (`note.daily`).
    Made {
        command: &'static str,
        args: serde_json::Value,
    },
}

impl<'a> Capture<'a> {
    fn clip(
        host: &'a Host,
        vault: Option<&'a str>,
        payload: &'a CapturePayloadV1,
        template: Option<&str>,
    ) -> Result<Self, PluginError> {
        validate_capture_v1(payload).map_err(invalid)?;
        let template = template.map(str::trim).filter(|t| !t.is_empty());
        if let Some(template) = template {
            if payload.target.mode != CaptureMode::Create {
                return Err(PluginError::BadArgs(Text::key(
                    "host.capture.template_mode",
                )));
            }
            validate_target_path("template", template, false).map_err(invalid)?;
        }
        let target = match payload.target.mode {
            CaptureMode::Append | CaptureMode::Prepend => {
                let note = payload.target.note.as_deref().unwrap_or_default();
                Target::Existing {
                    doc: crate::doc_id(&path_policy::from_outside(note))?,
                    prepend: payload.target.mode == CaptureMode::Prepend,
                }
            }
            CaptureMode::Daily => Target::Made {
                command: NOTE_DAILY,
                args: serde_json::json!({}),
            },
            CaptureMode::Create => {
                let mut args = new_note_args(
                    payload.target.folder.as_deref(),
                    payload.target.note.as_deref(),
                    Some(&payload.title),
                );
                match template {
                    Some(template) => {
                        args.insert(TEMPLATE.into(), template.into());
                        Target::Made {
                            command: NOTE_FROM_TEMPLATE,
                            args: args.into(),
                        }
                    }
                    None => {
                        // Le proprietà nascono con la nota, nella stessa
                        // creazione: non c'è un momento in cui manchino.
                        if let Some(properties) = &payload.properties {
                            let json = serde_json::Value::Object(properties.clone()).to_string();
                            args.insert("properties".into(), json.into());
                        }
                        Target::Made {
                            command: NOTE_CREATE,
                            args: args.into(),
                        }
                    }
                }
            }
        };
        Ok(Capture {
            host,
            vault: payload.target.vault.as_deref().or(vault),
            target,
            content: Content::Clip(payload),
        })
    }

    fn new_note(
        host: &'a Host,
        vault: Option<&'a str>,
        note: &NewNote<'a>,
    ) -> Result<Self, PluginError> {
        for (field, value, is_new) in [
            ("folder", note.folder, true),
            ("name", note.name, true),
            ("template", note.template, false),
        ] {
            if let Some(value) = value {
                validate_target_path(field, value, is_new).map_err(invalid)?;
            }
        }
        if let Some(title) = note.title {
            validate_title(title).map_err(invalid)?;
        }
        let title = note.title.map(str::trim);
        let mut args = new_note_args(note.folder, note.name, title);
        let command = match note.template.map(str::trim).filter(|t| !t.is_empty()) {
            Some(template) => {
                args.insert(TEMPLATE.into(), template.into());
                NOTE_FROM_TEMPLATE
            }
            None => NOTE_CREATE,
        };
        Ok(Capture {
            host,
            vault,
            target: Target::Made {
                command,
                args: args.into(),
            },
            content: title.map_or(Content::Nothing, Content::Title),
        })
    }

    /// Il documento che la cattura scriverebbe, dopo i controlli che non
    /// scrivono: che il documento ci sia se deve esserci, e che il suo
    /// formato accetti il testo, se ce n'è, e le proprietà, se ce ne sono.
    fn planned(&self) -> Result<DocId, PluginError> {
        let doc = match &self.target {
            Target::Existing { doc, .. } => {
                self.host.read_document(self.vault, doc)?;
                doc.clone()
            }
            Target::Made { command, args } => {
                let outcome = self.host.invoke_user_command(
                    self.vault,
                    command,
                    args.clone(),
                    InvokeMode::DryRun,
                )?;
                match outcome.effect {
                    CommandEffect::Plan(plan) => plan
                        .docs
                        .into_iter()
                        .next()
                        .ok_or_else(|| unnamed(command))?,
                    _ => return Err(unnamed(command)),
                }
            }
        };
        if let Content::Nothing = self.content {
            return Ok(doc);
        }
        let format = self.host.format_of(self.vault, &doc)?;
        let understands = |name: &str| {
            format
                .as_ref()
                .is_some_and(|format| format.capabilities.supports(name))
        };
        if !understands(source::PROSE) {
            return Err(PluginError::BadArgs(Text::message(
                "host.capture.not_prose",
                vec![Arg::text("doc", doc.as_str())],
            )));
        }
        let properties = self.properties_asked();
        if properties.is_some_and(|p| !p.is_empty()) && !understands(syntax::FRONTMATTER) {
            return Err(PluginError::BadArgs(Text::message(
                "host.capture.no_properties",
                vec![Arg::text("doc", doc.as_str())],
            )));
        }
        Ok(doc)
    }

    /// Le scritture, nell'ordine che rende sicuro un nuovo tentativo.
    fn write(&self, planned: &DocId) -> Result<DocId, PluginError> {
        let (doc, fresh) = match &self.target {
            Target::Existing { doc, .. } => (doc.clone(), false),
            Target::Made { command, args } => {
                // `note.daily` apre la nota del giorno se c'è già: è nata qui
                // soltanto se prima non c'era. Gli altri due creano sempre.
                let fresh = *command != NOTE_DAILY || !self.exists(planned)?;
                let outcome = self.host.invoke_user_command(
                    self.vault,
                    command,
                    args.clone(),
                    InvokeMode::Apply,
                )?;
                match outcome.effect {
                    CommandEffect::Navigate { doc } => (doc, fresh),
                    _ => return Err(unnamed(command)),
                }
            }
        };
        if let Err(error) = self.properties(&doc).and_then(|()| self.text(&doc)) {
            if fresh {
                // La nota è nata qui e non ha ricevuto il testo: torna nel
                // cestino, così un nuovo tentativo ritrova il vault di prima.
                // Se anche questo fallisce, l'errore da dire resta il primo.
                let _ = self.host.invoke_user_command(
                    self.vault,
                    NOTE_TRASH,
                    serde_json::json!({ "doc": doc.as_str() }),
                    InvokeMode::Apply,
                );
            }
            return Err(error);
        }
        Ok(doc)
    }

    fn exists(&self, doc: &DocId) -> Result<bool, PluginError> {
        match self.host.read_document(self.vault, doc) {
            Ok(_) => Ok(true),
            Err(PluginError::NotFound(_)) => Ok(false),
            Err(error) => Err(error),
        }
    }

    /// Le proprietà che il payload chiede, nessuna fuori da una cattura.
    fn properties_asked(&self) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
        match self.content {
            Content::Clip(payload) => payload.properties.as_ref(),
            Content::Title(_) | Content::Nothing => None,
        }
    }

    /// Le proprietà del payload, una per una. Ripeterle non cambia niente, ed
    /// è per questo che vengono prima del testo. Una nota di `note.create` le
    /// ha già, dalla nascita.
    fn properties(&self, doc: &DocId) -> Result<(), PluginError> {
        if matches!(
            self.target,
            Target::Made {
                command: NOTE_CREATE,
                ..
            }
        ) {
            return Ok(());
        }
        for (key, value) in self.properties_asked().into_iter().flatten() {
            // Il valore viaggia come JSON, che il comando legge come YAML: una
            // stringa resta una stringa anche quando si legge come un numero.
            self.host.invoke_user_command(
                self.vault,
                NOTE_PROPERTY_SET,
                serde_json::json!({ "doc": doc.as_str(), "key": key, "value": value.to_string() }),
                InvokeMode::Apply,
            )?;
        }
        Ok(())
    }

    /// Il testo catturato, in una scrittura sola che discende dalla lettura.
    fn text(&self, doc: &DocId) -> Result<(), PluginError> {
        if let Content::Nothing = self.content {
            return Ok(());
        }
        let (source, revision) = self.host.read_document(self.vault, doc)?;
        let eol = if source.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let (chunk, in_front) = match self.content {
            Content::Clip(payload) => (
                self.chunk(payload, eol)?,
                matches!(self.target, Target::Existing { prepend: true, .. }),
            ),
            Content::Title(title) => (format!("# {title}{eol}"), true),
            Content::Nothing => return Ok(()),
        };
        let text = if in_front {
            let (before, after) = source.split_at(self.body_start(doc, &source, &revision)?);
            let mut text = joined(before, &chunk, eol);
            if !after.is_empty() && !after.starts_with(['\n', '\r']) {
                text.push_str(eol);
            }
            text.push_str(after);
            text
        } else {
            joined(&source, &chunk, eol)
        };
        self.host
            .write_document(self.vault, doc, &text, WriteBase::DescendsFrom(revision))?;
        Ok(())
    }

    /// Il blocco che la cattura scrive: il titolo, il testo e la fonte se c'è,
    /// con una riga vuota fra le parti e i terminatori di riga del documento.
    /// La riga della fonte è nella lingua del vault.
    fn chunk(&self, payload: &CapturePayloadV1, eol: &str) -> Result<String, PluginError> {
        let markdown = payload.markdown.replace("\r\n", "\n");
        let mut parts = vec![
            format!("# {}", payload.title.trim()),
            markdown.trim_matches('\n').to_string(),
        ];
        let url = payload.source_url.as_deref().map(str::trim);
        if let Some(url) = url.filter(|url| !url.is_empty()) {
            let line = Text::message("host.capture.source", vec![Arg::text("url", url)]);
            parts.push(self.host.core_phrase(self.vault, line)?);
        }
        let mut chunk = parts.join("\n\n");
        chunk.push('\n');
        Ok(match eol {
            "\n" => chunk,
            eol => chunk.replace('\n', eol),
        })
    }

    /// Dove comincia il corpo, che è dove `prepend` scrive: dopo il
    /// frontmatter, che deve restare la prima cosa del file. Lo dice il
    /// modello, qualunque sia la sintassi del frontmatter; letto fra due
    /// letture con la stessa revisione, parla dello stesso testo.
    fn body_start(
        &self,
        doc: &DocId,
        source: &str,
        revision: &Revision,
    ) -> Result<usize, PluginError> {
        let model = self.host.read_model(self.vault, doc)?;
        let (_, again) = self.host.read_document(self.vault, doc)?;
        if &again != revision {
            return Err(PluginError::Conflict(Text::message(
                "host.capture.moved",
                vec![Arg::text("doc", doc.as_str())],
            )));
        }
        if !model.frontmatter_present {
            return Ok(if source.starts_with('\u{FEFF}') {
                '\u{FEFF}'.len_utf8()
            } else {
                0
            });
        }
        let Some(first) = model.body.first() else {
            return Ok(source.len());
        };
        let content = first.span().start;
        let head = source.get(..content).ok_or_else(|| {
            PluginError::Internal(format!("`{doc}`: il primo blocco è fuori dal sorgente").into())
        })?;
        // La riga del primo blocco, se prima di lui ci sono soltanto spazi: il
        // blocco catturato non spezza un rientro.
        let row = head.rfind(['\n', '\r']).map_or(0, |at| at + 1);
        Ok(if head[row..].chars().all(|c| c == ' ' || c == '\t') {
            row
        } else {
            content
        })
    }
}

/// Gli argomenti di `note.create` e `note.from_template` per il nome chiesto:
/// `name` se c'è, altrimenti il titolo ([`title_stem`]), e dentro `folder`.
/// Senza un nome, il nome lo sceglie il comando e la cartella gli si passa
/// com'è.
fn new_note_args(
    folder: Option<&str>,
    name: Option<&str>,
    title: Option<&str>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut args = serde_json::Map::new();
    let folder = folder
        .map(|folder| folders::normalized(&path_policy::from_outside(folder)).to_string())
        .filter(|folder| !folder.is_empty());
    let name = name
        .map(path_policy::from_outside)
        .filter(|name| !name.is_empty())
        .or_else(|| title.and_then(title_stem));
    match (name, folder) {
        (Some(name), Some(folder)) => {
            args.insert("name".into(), format!("{folder}/{name}").into());
        }
        (Some(name), None) => {
            args.insert("name".into(), name.into());
        }
        (None, Some(folder)) => {
            args.insert("folder".into(), folder.into());
        }
        (None, None) => {}
    }
    args
}

/// Il titolo come nome di file: un segmento solo, senza i caratteri che un
/// filesystem si riserva, senza punti ai bordi (in testa nasconde il file, in
/// coda Windows lo tronca) e abbastanza corto. `None` se non ne esce un nome
/// nuovo valido, e allora il nome lo sceglie il comando.
fn title_stem(title: &str) -> Option<String> {
    let plain: String = title
        .chars()
        .map(|c| {
            if path_policy::RESERVED_CHARS.contains(&c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut stem = String::new();
    for c in words.trim_start_matches('.').chars().take(STEM_MAX_CHARS) {
        if stem.len() + c.len_utf8() > STEM_MAX_BYTES {
            break;
        }
        stem.push(c);
    }
    let stem = stem
        .trim_end_matches(|c: char| c == '.' || c.is_whitespace())
        .trim_start();
    (!stem.is_empty() && path_policy::check(stem, Naming::New).is_ok()).then(|| stem.to_string())
}

/// `before` e poi `after`, con esattamente una riga vuota in mezzo. Le righe
/// vuote che `before` ha già contano, e niente di suo si toglie; un `before`
/// vuoto (al più il BOM) non vuole separatore.
fn joined(before: &str, after: &str, eol: &str) -> String {
    let mut text = before.to_string();
    if !before.trim_start_matches('\u{FEFF}').is_empty() {
        for _ in trailing_breaks(before).min(2)..2 {
            text.push_str(eol);
        }
    }
    text.push_str(after);
    text
}

/// Quanti a-capo chiudono `text`; `\r\n` ne conta uno.
fn trailing_breaks(text: &str) -> usize {
    let mut rest = text;
    let mut count = 0;
    while let Some(shorter) = rest
        .strip_suffix("\r\n")
        .or_else(|| rest.strip_suffix('\n'))
    {
        rest = shorter;
        count += 1;
    }
    count
}

/// Un argomento rifiutato dalle regole dell'automazione.
fn invalid(error: AutomationError) -> PluginError {
    error.to_plugin_error()
}

/// Un comando del registro che non ha detto quale documento ha toccato.
fn unnamed(command: &str) -> PluginError {
    PluginError::Internal(format!("`{command}` non ha nominato un documento").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_becomes_one_portable_segment() {
        assert_eq!(
            title_stem("Rust: una guida / parte 2?").as_deref(),
            Some("Rust una guida parte 2")
        );
        assert_eq!(title_stem("...nascosto.").as_deref(), Some("nascosto"));
        assert_eq!(title_stem("Report v1.2").as_deref(), Some("Report v1.2"));
        assert_eq!(title_stem("???"), None);
        assert_eq!(title_stem("CON"), None, "un device DOS non è un nome");
        let long = "è".repeat(STEM_MAX_CHARS * 2);
        let stem = title_stem(&long).unwrap();
        assert_eq!(stem.chars().count(), STEM_MAX_CHARS);
        assert!(stem.len() <= STEM_MAX_BYTES);
    }

    #[test]
    fn one_blank_line_separates_and_nothing_is_removed() {
        assert_eq!(joined("", "B\n", "\n"), "B\n");
        assert_eq!(joined("\u{FEFF}", "B\n", "\n"), "\u{FEFF}B\n");
        assert_eq!(joined("A", "B\n", "\n"), "A\n\nB\n");
        assert_eq!(joined("A\n", "B\n", "\n"), "A\n\nB\n");
        assert_eq!(joined("A\n\n", "B\n", "\n"), "A\n\nB\n");
        assert_eq!(joined("A\n\n\n", "B\n", "\n"), "A\n\n\nB\n");
        assert_eq!(joined("A\r\n", "B\r\n", "\r\n"), "A\r\n\r\nB\r\n");
    }
}
