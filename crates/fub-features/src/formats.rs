//! Le domande che una feature fa al formato prima di scrivere nel sorgente.
//!
//! Le feature scrivono byte: un frontmatter, un blocco accodato, una
//! sostituzione. Sono scritture giuste soltanto per un formato che le capisce,
//! e il kernel non le ferma tutte: un `.base` con un frontmatter davanti si
//! analizza lo stesso e perde le viste. La risposta viene dalle capacità che
//! il provider dichiara ([`format_of`](fub_abi::traits::VaultRead::format_of)),
//! mai dall'estensione.

use fub_abi::error::PluginError;
use fub_abi::format::LinkInsert;
use fub_abi::model::{DocId, LinkTarget};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::VaultRead;

/// La chiave dell'errore «questo formato non lo supporta». Ogni feature che
/// usa questo modulo la porta nel proprio catalogo con [`speaking`].
pub(crate) const E_FORMAT_UNSUPPORTED: &str = "e_format_unsupported";

/// Il formato di `doc` dichiara la capacità `name`? Un documento che nessun
/// provider rivendica non la dichiara.
pub(crate) fn understands(host: &(impl VaultRead + ?Sized), doc: &DocId, name: &str) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.capabilities.supports(name))
}

/// Come [`understands`], ma come errore tipizzato: un argomento che nomina un
/// documento su cui l'operazione non ha senso.
pub(crate) fn require(
    host: &(impl VaultRead + ?Sized),
    doc: &DocId,
    name: &str,
) -> Result<(), PluginError> {
    if understands(host, doc, name) {
        Ok(())
    } else {
        Err(unsupported(doc))
    }
}

/// L'errore di [`require`], per chi l'ha già deciso da sé.
pub(crate) fn unsupported(doc: &DocId) -> PluginError {
    PluginError::BadArgs(Text::message(
        E_FORMAT_UNSUPPORTED,
        vec![Arg::text("doc", doc.as_str())],
    ))
}

/// Il riferimento scritto nella grammatica del formato di `doc`.
///
/// La sintassi la sceglie il provider ([`VaultRead::format_link`]); un formato
/// che non sa scrivere quel riferimento è l'errore di [`require`], non un
/// `[[…]]` scritto lo stesso.
pub(crate) fn link_text(
    host: &(impl VaultRead + ?Sized),
    doc: &DocId,
    link: &LinkInsert,
) -> Result<String, PluginError> {
    host.format_link(doc, link)?.ok_or_else(|| unsupported(doc))
}

/// Un collegamento alla pagina `page`, con `label` se diversa.
pub(crate) fn wikilink(page: &str, label: Option<&str>, embed: bool) -> LinkInsert {
    LinkInsert {
        target: LinkTarget::wiki(page),
        label: label.map(str::to_string),
        embed,
    }
}

/// Aggiunge ai cataloghi di una feature la stringa dell'errore di formato.
pub(crate) fn speaking(mut catalogs: Vec<StringCatalog>) -> Vec<StringCatalog> {
    for catalog in &mut catalogs {
        let templates = match catalog.locale.as_str() {
            "it" => [
                "Il formato di {doc} non supporta questa operazione.",
                "Nessun formato installato serve l'estensione «{ext}» scelta per le note nuove.",
            ],
            "en" => [
                "The format of {doc} does not support this operation.",
                "No installed format serves the extension \"{ext}\" chosen for new notes.",
            ],
            _ => continue,
        };
        for (key, template) in [E_FORMAT_UNSUPPORTED, E_NO_NEW_NOTE_FORMAT]
            .into_iter()
            .zip(templates)
        {
            catalog
                .entries
                .insert(key.to_string(), template.to_string());
        }
    }
    catalogs
}

/// La chiave del core che sceglie l'estensione delle note nuove. La dichiara
/// il bundle core e la legge anche il kernel quando crea una nota senza
/// estensione: è una regola sola, non due convenzioni.
pub(crate) const NEW_NOTE_EXTENSION: &str = "files.new-note-extension";

/// Il default che il core dichiara per [`NEW_NOTE_EXTENSION`]. Vale soltanto
/// su un host che non dichiara la chiave, come un banco senza il bundle core.
const DECLARED_DEFAULT: &str = "md";

/// La chiave di catalogo dell'errore «nessun formato per le note nuove».
pub(crate) const E_NO_NEW_NOTE_FORMAT: &str = "e_no_new_note_format";

/// L'estensione con cui nasce una nota a cui l'utente non ne ha data una.
///
/// È l'impostazione del core, e vale solo se un provider la rivendica: un
/// valore che nessun formato serve darebbe un file che il vault non apre.
pub(crate) fn new_note_extension(
    host: &(impl VaultRead + fub_abi::traits::SettingsRead + ?Sized),
) -> Result<String, PluginError> {
    let chosen = match host.setting(NEW_NOTE_EXTENSION) {
        Ok(fub_abi::settings::SettingValue::Text(ext)) => ext,
        _ => DECLARED_DEFAULT.to_string(),
    };
    let ext = chosen.trim().trim_start_matches('.').to_ascii_lowercase();
    if !ext.is_empty()
        && !ext.contains(['/', '.'])
        && host.format_of(&DocId::new(format!("x.{ext}"))).is_some()
    {
        Ok(ext)
    } else {
        Err(PluginError::BadArgs(Text::message(
            E_NO_NEW_NOTE_FORMAT,
            vec![Arg::text("ext", chosen)],
        )))
    }
}

/// L'estensione di un documento, se l'ultimo segmento ne porta una.
pub(crate) fn extension_of(doc: &DocId) -> Option<&str> {
    let last = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
    match last.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => Some(ext),
        _ => None,
    }
}

/// Il path scritto dall'utente, con `extension` se il suo ultimo segmento non
/// porta già un'estensione che un formato del vault serve.
///
/// «Progetti/Idee» riceve l'estensione e «Lavagna.canvas» no. «Report v1.2» la
/// riceve: `.2` non è un formato, e il punto è del nome. Guardare soltanto se
/// c'è un punto lasciava «Report v1.2» senza formato, e la creazione falliva.
/// È la regola con cui il kernel nomina una nota nuova (`new_notes_id`): la
/// domanda si fa al formato, non alla forma del nome.
///
/// Un nome che finisce col punto resta com'è: la regola dei nomi nuovi lo
/// rifiuta e spiega perché, mentre un'estensione aggiunta lo nasconderebbe.
pub(crate) fn with_extension(
    host: &(impl VaultRead + ?Sized),
    name: &str,
    extension: &str,
) -> String {
    let last = name.rsplit('/').next().unwrap_or(name);
    if last.ends_with('.') || host.format_of(&DocId::new(name)).is_some() {
        name.to_string()
    } else {
        format!("{name}.{extension}")
    }
}

/// Il nome scelto dall'utente per un documento che esiste già: senza
/// estensione eredita quella del documento, così una rinomina non cambia mai
/// il formato di un file.
pub(crate) fn keeping_extension(
    host: &(impl VaultRead + ?Sized),
    doc: &DocId,
    name: &str,
) -> String {
    match extension_of(doc) {
        Some(ext) => with_extension(host, name, ext),
        None => name.to_string(),
    }
}
