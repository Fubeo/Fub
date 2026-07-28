//! **Che specie di file è questo**, e che tipo di contenuto porta (§14.1).
//!
//! È la regola con cui una scansione del vault divide ciò che trova in tre:
//! documenti, allegati, e ciò che non è né l'uno né l'altro. Sta qui e non nel
//! kernel per la ragione del modulo [`super`]: chi indicizza, chi disegna e a M5
//! un guest WASM devono dividere allo **stesso** modo, o due elenchi dello stesso
//! vault conterebbero cose diverse.
//!
//! # La specie non è una proprietà del file
//!
//! È una proprietà del file **dato chi è registrato adesso**: un `.canvas` è
//! [`EntryKind::Unknown`] finché nessuno rivendica quell'estensione e
//! [`EntryKind::Document`] il giorno che qualcuno la rivendica, senza che il file
//! sia cambiato di un byte. Per questo [`kind_of`] prende le estensioni dei
//! documenti come **parametro** invece di tenersele in una costante, e per
//! questo la specie non si persiste: si ricalcola (vedi
//! `fubmd_kernel::entries`).
//!
//! # Il MIME è dedotto dal nome, e lo si dice
//!
//! [`mime_of`] guarda l'**estensione**, non i byte. È la stessa scelta di
//! [`VaultRead::format_of`](crate::traits::VaultRead::format_of) e ha lo stesso
//! pregio: si risponde su una lista intera senza aprire un file. Ha anche lo
//! stesso limite, ed è dichiarato — un `.png` che dentro è un JPEG risponde
//! `image/png`. Chi ha bisogno della verità dei byte (un renderer che decodifica,
//! una verifica d'integrità) la legge dai byte; chi deve decidere se mostrare
//! un'anteprima o quale icona disegnare non deve aprire mille file per farlo.
//!
//! La tabella è **esplicita e corta**: sono i tipi che un vault di note contiene
//! davvero. Una dipendenza per una tabella di trenta righe la si paga in
//! catena di fornitura (decisione 0001) e non in righe di codice, e ciò che
//! manca da qui non diventa invisibile — diventa [`EntryKind::Unknown`], che è
//! una risposta e non un buco.

use crate::model::DocId;
use crate::traits::EntryKind;

/// La specie di un file del vault, date le estensioni che un
/// [`FormatProvider`](crate::format::FormatProvider) rivendica.
///
/// L'ordine dei tre casi non è arbitrario: chi rivendica l'estensione vince
/// sempre. Un `.md` resta un documento anche se domani qualcuno mettesse
/// `text/markdown` nella tabella dei MIME, perché il vault ha un provider che
/// lo sa parsare — ed è quella la differenza che conta a valle.
pub fn kind_of(id: &DocId, doc_extensions: &[String]) -> EntryKind {
    let ext = extension_of(id.as_str());
    match ext {
        Some(ext) if doc_extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)) => {
            EntryKind::Document
        }
        Some(ext) if mime_for_ext(ext).is_some() => EntryKind::Asset,
        _ => EntryKind::Unknown,
    }
}

/// Il tipo di contenuto di un file, dedotto dall'estensione. `None` = non lo
/// sappiamo, che è la risposta onesta per un `.dat`.
pub fn mime_of(id: &DocId) -> Option<&'static str> {
    extension_of(id.as_str()).and_then(mime_for_ext)
}

/// L'estensione di un path, senza punto e senza cartella. `None` per un file
/// che non ne ha (`LICENSE`) e per uno che è **solo** estensione
/// (`.gitignore`): là il punto iniziale non separa un nome da un tipo.
fn extension_of(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => Some(ext),
        _ => None,
    }
}

/// La tabella, per famiglia. Il confronto è **senza distinzione di caso**:
/// `FOTO.PNG` arriva dalle fotocamere e dai vault che vengono da Windows.
fn mime_for_ext(ext: &str) -> Option<&'static str> {
    let ext = ext.to_ascii_lowercase();
    Some(match ext.as_str() {
        // Immagini: la famiglia che un vault di note contiene di più.
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/vnd.microsoft.icon",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "tif" | "tiff" => "image/tiff",
        // Audio e video: le registrazioni di una riunione, i memo vocali.
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        // Documenti che non sono note: quelli che si allegano a una nota.
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "odt" => "application/vnd.oasis.opendocument.text",
        "rtf" => "application/rtf",
        // Dati e archivi.
        "csv" => "text/csv",
        "json" => "application/json",
        "zip" => "application/zip",
        "gz" => "application/gzip",
        "7z" => "application/x-7z-compressed",
        // Caratteri: ci finiscono nei vault che portano con sé un tema (6.2).
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn md() -> Vec<String> {
        vec![String::from("md")]
    }

    #[test]
    fn chi_rivendica_lestensione_vince_sempre() {
        assert_eq!(
            kind_of(&DocId::new("note/a.md"), &md()),
            EntryKind::Document
        );
        assert_eq!(
            kind_of(&DocId::new("img/foto.png"), &md()),
            EntryKind::Asset
        );
        // Il caso non conta, né per i documenti né per gli allegati.
        assert_eq!(kind_of(&DocId::new("A.MD"), &md()), EntryKind::Document);
        assert_eq!(kind_of(&DocId::new("FOTO.PNG"), &md()), EntryKind::Asset);
    }

    #[test]
    fn sconosciuto_e_una_risposta_non_un_buco() {
        // Un `.canvas` oggi non lo rivendica nessuno: il vault lo vede e dice
        // che non sa cosa sia. Domani, con un provider registrato, la stessa
        // riga risponde `Document` senza che il file sia cambiato.
        assert_eq!(
            kind_of(&DocId::new("board.canvas"), &md()),
            EntryKind::Unknown
        );
        assert_eq!(
            kind_of(&DocId::new("board.canvas"), &["md".into(), "canvas".into()]),
            EntryKind::Document
        );
        // Senza estensione, e con la sola estensione: nessuno dei due dice
        // niente sul contenuto.
        assert_eq!(kind_of(&DocId::new("LICENSE"), &md()), EntryKind::Unknown);
        assert_eq!(
            kind_of(&DocId::new(".gitignore"), &md()),
            EntryKind::Unknown
        );
    }

    #[test]
    fn il_mime_viene_dal_nome_e_lo_dice_la_firma() {
        assert_eq!(mime_of(&DocId::new("img/foto.PNG")), Some("image/png"));
        assert_eq!(mime_of(&DocId::new("a/b/rec.m4a")), Some("audio/mp4"));
        assert_eq!(
            mime_of(&DocId::new("note/a.md")),
            None,
            "un documento non è un allegato"
        );
        assert_eq!(mime_of(&DocId::new("dati.dat")), None);
    }
}
