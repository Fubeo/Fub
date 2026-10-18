//! Il pacchetto OpenDocument: un archivio zip di parti XML e di file.
//!
//! Il codec legge `content.xml`, `styles.xml`, `settings.xml` e il manifesto,
//! e ne riscrive al più le prime due. Ogni altra voce passa nel file nuovo così
//! com'è, compressa come prima e nello stesso ordine: `mimetype` resta la
//! prima, non compressa, come vuole il formato. Un'immagine nuova si aggiunge
//! in fondo, con la sua voce nel manifesto.

use std::io::{Cursor, Read, Write};

use crate::{RichError, MAX_SOURCE_BYTES};

pub(crate) const CONTENT: &str = "content.xml";
pub(crate) const STYLES: &str = "styles.xml";
const SETTINGS: &str = "settings.xml";
const MANIFEST: &str = "META-INF/manifest.xml";

/// Le parti che il codec legge.
#[derive(Clone, Debug)]
pub(crate) struct Package {
    pub content: Vec<u8>,
    pub styles: Option<Vec<u8>>,
    pub settings: Option<Vec<u8>>,
}

fn codec(error: impl std::fmt::Display) -> RichError {
    RichError::Codec(format!("odt package: {error}"))
}

impl Package {
    pub fn read(bytes: &[u8]) -> Result<Package, RichError> {
        if bytes.len() > MAX_SOURCE_BYTES {
            return Err(RichError::TooLarge(bytes.len()));
        }
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(codec)?;
        let manifest = part(&mut archive, MANIFEST)?;
        // Una parte cifrata non si legge senza la password, e il manifesto lo
        // dice prima di ogni tentativo.
        if manifest
            .as_deref()
            .is_some_and(|m| find(m, b"encryption-data"))
        {
            return Err(RichError::Encrypted);
        }
        let content = part(&mut archive, CONTENT)?
            .ok_or_else(|| RichError::Codec("odt package without content.xml".into()))?;
        Ok(Package {
            content,
            styles: part(&mut archive, STYLES)?,
            settings: part(&mut archive, SETTINGS)?,
        })
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn part(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> Result<Option<Vec<u8>>, RichError> {
    let file = match archive.by_name(name) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(error) => return Err(codec(error)),
    };
    if file.size() > MAX_SOURCE_BYTES as u64 {
        return Err(RichError::TooLarge(
            usize::try_from(file.size()).unwrap_or(usize::MAX),
        ));
    }
    let mut out = Vec::new();
    // Il limite vale anche per ciò che l'intestazione non dichiara.
    file.take(MAX_SOURCE_BYTES as u64 + 1)
        .read_to_end(&mut out)
        .map_err(codec)?;
    if out.len() > MAX_SOURCE_BYTES {
        return Err(RichError::TooLarge(out.len()));
    }
    Ok(Some(out))
}

/// Il pacchetto `bytes` con queste parti al posto delle loro, e i file
/// `added` (percorso, tipo, byte) che ancora non ha: ogni altra voce si copia
/// grezza, senza decomprimerla.
pub(crate) fn replace(
    bytes: &[u8],
    parts: &[(&str, &[u8])],
    added: &[(String, &'static str, Vec<u8>)],
) -> Result<Vec<u8>, RichError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(codec)?;
    let names = archive
        .file_names()
        .map(|name| name.map(|name| name.into_owned()))
        .collect::<Result<Vec<String>, _>>()
        .map_err(codec)?;
    let added: Vec<_> = added
        .iter()
        .filter(|(path, ..)| !names.contains(path))
        .collect();
    let manifest = match added.is_empty() {
        true => None,
        false => {
            let old = part(&mut archive, MANIFEST)?
                .ok_or_else(|| RichError::Codec("odt package without a manifest".into()))?;
            Some(manifest_with(&old, &added)?)
        }
    };
    let mut parts = parts.to_vec();
    if let Some(manifest) = &manifest {
        parts.push((MANIFEST, manifest));
    }
    let parts = &parts[..];
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let deflated = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut written = vec![false; parts.len()];
    for index in 0..archive.len() {
        let file = archive.by_index_raw(index).map_err(codec)?;
        let name = file.name().map_err(codec)?.into_owned();
        match parts.iter().position(|(part, _)| *part == name) {
            Some(at) => {
                drop(file);
                writer.start_file(name, deflated).map_err(codec)?;
                writer.write_all(parts[at].1).map_err(codec)?;
                written[at] = true;
            }
            None => writer.raw_copy_file(file).map_err(codec)?,
        }
    }
    if let Some(missing) = written.iter().position(|done| !done) {
        return Err(RichError::Codec(format!(
            "odt package without {}",
            parts[missing].0
        )));
    }
    // Un'immagine è già compressa: si conserva com'è.
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (path, _, bytes) in &added {
        writer.start_file(path.as_str(), stored).map_err(codec)?;
        writer.write_all(bytes).map_err(codec)?;
    }
    Ok(writer.finish().map_err(codec)?.into_inner())
}

/// Il manifesto con una voce per ogni file aggiunto.
fn manifest_with(
    old: &[u8],
    added: &[&(String, &'static str, Vec<u8>)],
) -> Result<Vec<u8>, RichError> {
    const END: &[u8] = b"</manifest:manifest>";
    let at = old
        .windows(END.len())
        .rposition(|w| w == END)
        .ok_or_else(|| RichError::Codec("odt manifest without its end".into()))?;
    let mut out = old[..at].to_vec();
    for (path, mime, _) in added {
        out.extend_from_slice(
            format!(
                "<manifest:file-entry manifest:full-path=\"{path}\" \
                 manifest:media-type=\"{mime}\"/>"
            )
            .as_bytes(),
        );
    }
    out.extend_from_slice(&old[at..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data, stored) in entries {
            let method = if *stored {
                zip::CompressionMethod::Stored
            } else {
                zip::CompressionMethod::Deflated
            };
            let options = zip::write::SimpleFileOptions::default().compression_method(method);
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn le_altre_voci_passano_identiche_e_nello_stesso_ordine() {
        let bytes = package(&[
            ("mimetype", b"application/vnd.oasis.opendocument.text", true),
            ("content.xml", b"<a/>", false),
            ("Pictures/x.png", b"\x89PNG....", false),
        ]);
        let out = replace(&bytes, &[(CONTENT, b"<b/>")], &[]).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(out.as_slice())).unwrap();
        let names: Vec<String> = archive
            .file_names()
            .map(|n| n.unwrap().into_owned())
            .collect();
        assert_eq!(names, ["mimetype", "content.xml", "Pictures/x.png"]);
        let mimetype = archive.by_index_raw(0).unwrap();
        assert_eq!(mimetype.compression(), zip::CompressionMethod::Stored);
        drop(mimetype);
        let read = Package::read(&out).unwrap();
        assert_eq!(read.content, b"<b/>");
    }

    #[test]
    fn un_immagine_nuova_entra_in_fondo_e_nel_manifesto_una_volta() {
        let bytes = package(&[
            ("mimetype", b"application/vnd.oasis.opendocument.text", true),
            (
                MANIFEST,
                b"<manifest:manifest><manifest:file-entry manifest:full-path=\"/\"/></manifest:manifest>",
                false,
            ),
            ("content.xml", b"<a/>", false),
            ("Pictures/x.png", b"vecchia", false),
        ]);
        let added = [
            ("Pictures/y.png".to_string(), "image/png", b"nuova".to_vec()),
            ("Pictures/x.png".to_string(), "image/png", b"altra".to_vec()),
        ];
        let out = replace(&bytes, &[(CONTENT, b"<b/>")], &added).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(out.as_slice())).unwrap();
        let names: Vec<String> = archive
            .file_names()
            .map(|n| n.unwrap().into_owned())
            .collect();
        assert_eq!(
            names,
            [
                "mimetype",
                MANIFEST,
                "content.xml",
                "Pictures/x.png",
                "Pictures/y.png"
            ]
        );
        let manifest = part(&mut archive, MANIFEST).unwrap().unwrap();
        let manifest = String::from_utf8(manifest).unwrap();
        assert_eq!(manifest.matches("Pictures/").count(), 1, "{manifest}");
        assert!(manifest.ends_with(
            "<manifest:file-entry manifest:full-path=\"Pictures/y.png\" \
             manifest:media-type=\"image/png\"/></manifest:manifest>"
        ));
        let old = part(&mut archive, "Pictures/x.png").unwrap().unwrap();
        assert_eq!(old, b"vecchia");
    }

    #[test]
    fn un_manifesto_con_cifratura_è_un_file_cifrato() {
        let bytes = package(&[
            ("mimetype", b"application/vnd.oasis.opendocument.text", true),
            (
                MANIFEST,
                b"<manifest:manifest><manifest:file-entry><manifest:encryption-data/></manifest:file-entry></manifest:manifest>",
                false,
            ),
            ("content.xml", b"xx", false),
        ]);
        assert_eq!(Package::read(&bytes).unwrap_err(), RichError::Encrypted);
    }

    #[test]
    fn senza_content_non_è_un_documento() {
        let bytes = package(&[("mimetype", b"x", true)]);
        assert!(matches!(Package::read(&bytes), Err(RichError::Codec(_))));
        assert!(matches!(Package::read(b"nope"), Err(RichError::Codec(_))));
    }
}
