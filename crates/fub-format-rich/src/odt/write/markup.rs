//! Il markup che lo scrittore tocca: attributi di un tag, `xml:id` già
//! scritti, involucri di un tratto, il testo con la regola degli spazi di ODF
//! e le sostituzioni nei byte di partenza.

use std::collections::HashSet;
use std::ops::Range;

use crate::odt::keys::{self, name_of, opening};
use crate::odt::xml;
use crate::RichError;

pub(super) fn style_attr(attrs: &[(String, String)]) -> Option<String> {
    attrs
        .iter()
        .find(|(k, _)| k == "text:style-name")
        .map(|(_, v)| v.clone())
}

pub(super) fn set_attr(attrs: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    match (attrs.iter().position(|(k, _)| k == key), value) {
        (Some(at), Some(value)) => attrs[at].1 = value,
        (Some(at), None) => {
            attrs.remove(at);
        }
        (None, Some(value)) => attrs.push((key.to_string(), value)),
        (None, None) => {}
    }
}

pub(super) fn attr<'v>(attrs: &'v [(String, String)], key: &str) -> Option<&'v str> {
    attrs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

pub(super) fn quoted(value: &str) -> String {
    let mut out = String::new();
    xml::escape_attr(value, &mut out);
    out
}

/// Gli `xml:id` scritti in questi byte.
pub(super) fn ids_in(bytes: &[u8], into: &mut HashSet<String>) {
    let needle = b" xml:id=\"";
    let mut at = 0;
    while let Some(found) = bytes[at..].windows(needle.len()).position(|w| w == needle) {
        let start = at + found + needle.len();
        let Some(len) = bytes[start..].iter().position(|&b| b == b'"') else {
            return;
        };
        into.insert(String::from_utf8_lossy(&bytes[start..start + len]).into_owned());
        at = start + len;
    }
}

/// Gli stili di tratto degli involucri, dal più esterno.
pub(super) fn layers(wrap: &[String]) -> Vec<Vec<String>> {
    wrap.iter()
        .map(|tag| match keys::tag(tag) {
            Some((name, attrs)) if name == "text:span" || name == "text:a" => {
                let mut out: Vec<String> = attr(&attrs, "text:class-names")
                    .map(|n| n.split_whitespace().map(str::to_string).collect())
                    .unwrap_or_default();
                out.extend(attr(&attrs, "text:style-name").map(str::to_string));
                out
            }
            _ => Vec::new(),
        })
        .collect()
}

pub(super) fn href_of(wrap: &[String]) -> Option<String> {
    wrap.iter().rev().find_map(|tag| {
        (name_of(tag) == "text:a").then(|| {
            keys::tag(tag)
                .and_then(|(_, attrs)| attr(&attrs, "xlink:href").map(str::to_string))
                .unwrap_or_default()
        })
    })
}

pub(super) fn splice(source: &[u8], mut splices: Vec<(Range<usize>, String)>) -> Vec<u8> {
    splices.sort_by_key(|(range, _)| (range.start, range.end));
    let mut out = Vec::with_capacity(source.len());
    let mut at = 0;
    for (range, text) in splices {
        out.extend_from_slice(&source[at..range.start]);
        out.extend_from_slice(text.as_bytes());
        at = range.end;
    }
    out.extend_from_slice(&source[at..]);
    out
}

/// Porta gli involucri aperti a quelli voluti.
pub(super) fn sync(stack: &mut Vec<String>, want: &[String], out: &mut String) {
    let common = stack.iter().zip(want).take_while(|(a, b)| a == b).count();
    while stack.len() > common {
        let tag = stack.pop().expect("not empty");
        out.push_str(&format!("</{}>", name_of(&tag)));
    }
    for tag in &want[common..] {
        out.push_str(&opening(tag));
        stack.push(tag.clone());
    }
}

/// Il testo di un tratto con la regola degli spazi di ODF: uno spazio
/// letterale soltanto dopo un carattere visibile, `text:s` per gli altri.
pub(super) fn text(x: &str, space_ok: &mut bool, out: &mut String) -> Result<(), RichError> {
    let mut chars = x.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            ' ' => {
                let mut n = 1;
                while chars.peek() == Some(&' ') {
                    chars.next();
                    n += 1;
                }
                if *space_ok {
                    out.push(' ');
                    n -= 1;
                }
                match n {
                    0 => {}
                    1 => out.push_str("<text:s/>"),
                    n => out.push_str(&format!("<text:s text:c=\"{n}\"/>")),
                }
                *space_ok = false;
            }
            '\t' => {
                out.push_str("<text:tab/>");
                *space_ok = false;
            }
            '\n' => {
                out.push_str("<text:line-break/>");
                *space_ok = false;
            }
            '\u{c}' | '\u{e}' => {
                return Err(RichError::Codec(
                    "odt: a page or column break inside a paragraph cannot be written".into(),
                ))
            }
            c if (c as u32) < 0x20 || matches!(c, '\u{fffe}' | '\u{ffff}') => {
                return Err(RichError::Codec(format!(
                    "odt: character U+{:04X} cannot be written",
                    c as u32
                )))
            }
            c => {
                let mut buf = [0; 4];
                xml::escape_text(c.encode_utf8(&mut buf), out);
                *space_ok = true;
            }
        }
    }
    Ok(())
}
