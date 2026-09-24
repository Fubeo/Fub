//! Minimal streaming XML layer over `quick-xml` 0.41 (default features).
//!
//! One tiny DOM-less pull API for ENEX / Tomboy / generic XML so the three
//! importers share the same entity decoding, depth guard and tag-text
//! collection instead of each growing its own ad-hoc scanner.
//!
//! Hostile input (deep nesting, megabyte attributes, entity expansion) is
//! rejected with `BadArgs`, never truncated silently: `quick-xml` 0.41 does
//! not expand custom entities by default and this layer caps depth, text
//! length and total collected text.

use fub_abi::PluginError;
use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use crate::common::{bad_args, MAX_SOURCE_BYTES};

/// Depth above which nesting is treated as hostile.
pub const MAX_DEPTH: usize = 256;
/// Longest single text run collected.
pub const MAX_TEXT_RUN: usize = 4 * 1024 * 1024;
/// Total text collected across one document.
pub const MAX_TOTAL_TEXT: usize = 32 * 1024 * 1024;

/// One open element.
#[derive(Debug, Clone, Default)]
pub struct OpenTag {
    pub name: String,
    pub attrs: Vec<(String, String)>,
}

/// Callback interface: implementors receive start/end/text events; the driver
/// owns depth accounting and the text caps.
pub trait XmlSink {
    fn start(&mut self, tag: &OpenTag) -> Result<(), PluginError>;
    fn text(&mut self, text: &str) -> Result<(), PluginError>;
    fn end(&mut self, name: &str) -> Result<(), PluginError>;
}

/// Parse `xml` (already decoded UTF-8) into `sink`.
pub fn parse_str(xml: &str, sink: &mut dyn XmlSink) -> Result<(), PluginError> {
    if xml.len() as u64 > MAX_SOURCE_BYTES * 2 {
        return Err(bad_args(
            "XML source exceeds the 128 MiB pre-decode ceiling",
        ));
    }
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = true;
    reader.config_mut().check_end_names = true;
    let mut depth = 0usize;
    let mut total_text = 0usize;
    loop {
        let ev = reader
            .read_event()
            .map_err(|e| bad_args(format!("malformed XML: {e}")))?;
        match ev {
            Event::Start(e) => {
                depth += 1;
                if depth > MAX_DEPTH {
                    return Err(bad_args("XML nesting exceeds 256 levels"));
                }
                sink.start(&open_tag(&e)?)?;
            }
            Event::Empty(e) => {
                // `expand_empty_elements` already turns `<a/>` into
                // start+end, but keep the arm so a config change cannot
                // silently drop elements.
                let tag = open_tag(&e)?;
                depth += 1;
                if depth > MAX_DEPTH {
                    return Err(bad_args("XML nesting exceeds 256 levels"));
                }
                sink.start(&tag)?;
                sink.end(&tag.name)?;
                depth -= 1;
            }
            Event::End(e) => {
                let name = tag_name(e.name().into_inner());
                sink.end(&name)?;
                depth = depth.saturating_sub(1);
            }
            Event::Text(e) => {
                let decoded = e
                    .xml_content(quick_xml::XmlVersion::Explicit1_0)
                    .map_err(|e| bad_args(format!("XML text is not decodable: {e}")))?;
                let unescaped = quick_xml::escape::unescape(&decoded)
                    .map_err(|e| bad_args(format!("bad XML entity: {e}")))?;
                if unescaped.len() > MAX_TEXT_RUN {
                    return Err(bad_args("XML text run exceeds 4 MiB"));
                }
                total_text += unescaped.len();
                if total_text > MAX_TOTAL_TEXT {
                    return Err(bad_args("XML text exceeds 32 MiB"));
                }
                if !unescaped.is_empty() {
                    sink.text(&unescaped)?;
                }
            }
            Event::CData(e) => {
                let raw = std::str::from_utf8(&e[..])
                    .map_err(|_| bad_args("CDATA section is not UTF-8"))?;
                if raw.len() > MAX_TEXT_RUN {
                    return Err(bad_args("XML CDATA exceeds 4 MiB"));
                }
                total_text += raw.len();
                if total_text > MAX_TOTAL_TEXT {
                    return Err(bad_args("XML text exceeds 32 MiB"));
                }
                if !raw.is_empty() {
                    sink.text(raw)?;
                }
            }
            Event::GeneralRef(reference) => {
                let character = reference
                    .resolve_char_ref()
                    .map_err(|error| bad_args(format!("bad XML reference: {error}")))?;
                let mut buffer = [0; 4];
                let text = match character {
                    Some(character) => character.encode_utf8(&mut buffer),
                    None => {
                        let name = reference
                            .decode()
                            .map_err(|error| bad_args(format!("bad XML reference: {error}")))?;
                        quick_xml::escape::resolve_xml_entity(&name)
                            .ok_or_else(|| bad_args("custom XML entities are not supported"))?
                    }
                };
                total_text += text.len();
                if total_text > MAX_TOTAL_TEXT {
                    return Err(bad_args("XML text exceeds 32 MiB"));
                }
                sink.text(text)?;
            }
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
            Event::Eof => break,
        }
    }
    if depth != 0 {
        return Err(bad_args("XML ends inside an open element"));
    }
    Ok(())
}

fn tag_name(raw: &[u8]) -> String {
    // Qualified names are compared verbatim (`evernote:note` is not `note`);
    // case is significant in XML. Non-UTF-8 tag names are hostile input.
    String::from_utf8_lossy(raw).into_owned()
}

fn open_tag(e: &BytesStart<'_>) -> Result<OpenTag, PluginError> {
    let name = tag_name(e.name().into_inner());
    if name.len() > 1024 {
        return Err(bad_args("XML tag name exceeds 1 KiB"));
    }
    let mut attrs = Vec::new();
    for attr in e.attributes() {
        let attr = attr.map_err(|e| bad_args(format!("bad XML attribute: {e}")))?;
        let key = String::from_utf8_lossy(attr.key.into_inner()).into_owned();
        if key.len() > 1024 {
            return Err(bad_args("XML attribute name exceeds 1 KiB"));
        }
        let value = attr
            .normalized_value(quick_xml::XmlVersion::Explicit1_0)
            .map_err(|e| bad_args(format!("bad XML attribute value: {e}")))?
            .into_owned();
        if value.len() > MAX_TEXT_RUN {
            return Err(bad_args("XML attribute value exceeds 4 MiB"));
        }
        attrs.push((key, value));
    }
    Ok(OpenTag { name, attrs })
}

/// Convenience collector: full element tree text for tiny documents.
///
/// Depth-first `(path, text)` pairs; used only by the generic importer for
/// small XML. Large inputs should implement [`XmlSink`] directly.
#[derive(Default)]
pub struct TreeSink {
    stack: Vec<String>,
    pub texts: Vec<(String, String)>,
}

impl XmlSink for TreeSink {
    fn start(&mut self, tag: &OpenTag) -> Result<(), PluginError> {
        self.stack.push(tag.name.clone());
        let prefix = self.stack.join("/");
        for (k, v) in &tag.attrs {
            self.texts.push((format!("{prefix}@{}", k), v.clone()));
        }
        Ok(())
    }
    fn text(&mut self, text: &str) -> Result<(), PluginError> {
        let t = text.trim();
        if !t.is_empty() {
            self.texts.push((self.stack.join("/"), t.to_string()));
        }
        Ok(())
    }
    fn end(&mut self, _name: &str) -> Result<(), PluginError> {
        self.stack.pop();
        Ok(())
    }
}
