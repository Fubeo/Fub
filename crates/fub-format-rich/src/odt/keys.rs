//! I dati opachi dei nodi della proiezione di un OpenDocument.
//!
//! Come per Word (vedi `blob`), ogni nodo porta i propri dati e non un indice
//! nel file: qui sono i byte originali dei tag che lo contengono, così come
//! stanno in `content.xml`. Un paragrafo spezzato in due porta lo stesso tag
//! nelle due metà, una riga aggiunta quello della riga accanto, e lo scrittore
//! li rimette tali e quali.

use serde::{Deserialize, Serialize};

use super::xml;

/// Un paragrafo: il suo tag d'apertura e gli elenchi che lo contengono, dal
/// più esterno.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ParaKey {
    pub tag: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub list: Vec<Level>,
}

/// Un livello d'elenco attorno a un paragrafo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Level {
    /// Il tag di `text:list`.
    pub list: String,
    /// Il tag di `text:list-item` o `text:list-header`.
    pub item: String,
    /// Il paragrafo è il primo della voce: la voce comincia con lui.
    pub open: bool,
}

/// Un tratto di testo: i tag degli involucri (`text:span`, `text:a`,
/// `loext:content-control`) che lo contengono, dal più esterno.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct RunKey {
    pub wrap: Vec<String>,
}

/// Un oggetto: il suo XML intero, e gli involucri che lo contengono.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct AtomKey {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub wrap: Vec<String>,
    pub xml: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TableKey {
    pub open: String,
    /// Ciò che sta prima delle righe: colonne, titolo, descrizione.
    pub head: String,
    /// Le righe si aggiungono, si spostano e si tolgono: falso quando una
    /// cella si estende su più righe, e spostarle romperebbe la griglia.
    pub rows: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct RowKey {
    pub open: String,
    /// Una riga d'intestazione, dentro `table:table-header-rows`.
    #[serde(default)]
    pub header: bool,
    /// Le celle coperte prima della prima cella.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub lead: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct CellKey {
    /// Il tag d'apertura, o la cella vuota intera (`<table:table-cell/>`).
    pub open: String,
    /// Le celle coperte che la seguono.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub tail: String,
}

/// Il nome e gli attributi di un tag d'apertura (anche vuoto, `<a/>`).
pub(crate) fn tag(tag: &str) -> Option<(String, Vec<(String, String)>)> {
    let empty = if tag.ends_with("/>") {
        tag.to_string()
    } else {
        format!("{}/>", tag.strip_suffix('>')?)
    };
    let tree = xml::single_element(empty.as_bytes())?;
    let e = tree.element(tree.root)?;
    Some((e.name.clone(), e.attrs.clone()))
}

/// Il tag d'apertura con questo nome e questi attributi, non vuoto.
pub(crate) fn rebuild(name: &str, attrs: &[(String, String)]) -> String {
    xml::open_tag(name, attrs, false)
}

/// Il tag nella forma non vuota: `<a x="1"/>` diventa `<a x="1">`.
pub(crate) fn opening(tag: &str) -> String {
    match tag.strip_suffix("/>") {
        Some(head) => format!("{}>", head.trim_end()),
        None => tag.to_string(),
    }
}

/// Il nome dell'elemento di un tag.
pub(crate) fn name_of(tag: &str) -> &str {
    let body = tag.trim_start_matches('<');
    let end = body
        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .unwrap_or(body.len());
    &body[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_tag_si_legge_e_si_riapre() {
        let (name, attrs) = tag("<text:p text:style-name=\"P1\" xml:id=\"a&amp;b\">").unwrap();
        assert_eq!(name, "text:p");
        assert_eq!(attrs[1], ("xml:id".to_string(), "a&b".to_string()));
        assert_eq!(tag("<text:p/>").unwrap().0, "text:p");
        assert!(tag("text").is_none());
        assert_eq!(opening("<text:p a=\"1\" />"), "<text:p a=\"1\">");
        assert_eq!(opening("<text:p>"), "<text:p>");
        assert_eq!(name_of("<text:list-item>"), "text:list-item");
        assert_eq!(name_of("<text:p/>"), "text:p");
    }
}
