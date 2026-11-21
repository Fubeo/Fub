//! Il corpo espanso di un oggetto con la ricetta (piano K6, T27;
//! `docs/reference/scene-format-recipe.md`, §5): la grafica che il motore
//! disegna, scritta in SVG semplice che ogni programma mostra uguale.
//!
//! Il motore sa già espandere un oggetto: la sua esportazione SVG cuoce gli
//! effetti dal vivo (`bake_document`), scrive l'aspetto in pila come più
//! elementi, le forme vive con la loro geometria, le ombre e le sfocature
//! come filtri. Qui l'oggetto va da solo, già nello spazio del genitore, su
//! un livello vuoto di un documento con le risorse di quello vero, e se ne
//! prende ciò che l'esportazione scrive dentro il livello e dentro `<defs>`.
//!
//! Il frammento diventa un elemento solo con l'id che la differenza ha
//! scelto: l'elemento stesso, se l'esportazione ne scrive uno senza
//! `transform` e senza risorse, se no un `<g>` che lo avvolge con le sue
//! risorse in una `<defs>`. Gli id che l'esportazione scrive (le risorse a
//! cui si rimanda) diventano id nuovi di Fub, e i prefissi che il frammento
//! usa si legano sull'elemento.

use std::sync::Arc;

use vectorcraft_doc::{Document, LayerColor, Node, NodeId, Scaling};
use vectorcraft_geom::{Affine, Rect};
use vectorcraft_svg::{ExportOptions, ImageMode, ObjectIds, Styling};

use crate::id::Specie;

/// I decimali delle coordinate del corpo espanso: quelli di serie
/// dell'esportazione del motore, più fini dei due della geometria di Fub
/// perché le curve cotte (angoli tondi, contorni) restino quelle.
const DECIMALI: u8 = 3;

/// Il documento su cui si esporta un oggetto alla volta: le risorse del
/// disegno vero (sfumature, motivi, simboli, stili), nessun livello, una
/// tavola nell'origine così le coordinate restano quelle dell'oggetto.
pub(crate) struct Stampo {
    doc: Document,
}

impl Stampo {
    /// Lo stampo per gli oggetti di `dopo`.
    pub(crate) fn di(dopo: &Document) -> Stampo {
        let mut doc = dopo.clone();
        doc.layers.clear();
        doc.page_isolate = false;
        doc.page_knockout = false;
        let mut tavola = Document::new(1.0, 1.0)
            .artboards
            .first()
            .cloned()
            .or_else(|| dopo.artboards.first().cloned());
        doc.artboards.clear();
        if let Some(t) = tavola.as_mut() {
            t.rect = Rect::new(0.0, 0.0, 1.0, 1.0);
            t.color = None;
            doc.artboards.push(t.clone());
        }
        Stampo { doc }
    }

    /// Il corpo espanso di `n` nello spazio del genitore (`locale` porta dal
    /// documento del motore lì), come un elemento solo con l'id `id`.
    /// `nuovo_id` dà gli id nuovi per le risorse e gli oggetti che il
    /// frammento nomina.
    pub(crate) fn corpo(
        &mut self,
        n: &Node,
        locale: Affine,
        id: &str,
        nuovo_id: &mut dyn FnMut(Specie) -> Result<String, String>,
    ) -> Result<String, String> {
        let mut copia = n.clone();
        copia.name = None;
        senza_nomi(&mut copia);
        copia.transform(locale, Scaling::from(true));
        let mut livello = Node::layer(NodeId(u64::MAX), "", LayerColor::Preset(0));
        livello.name = None;
        if let Some(figli) = livello.children_mut() {
            figli.push(Arc::new(copia));
        }
        self.doc.layers = vec![Arc::new(livello)];
        let opzioni = ExportOptions {
            artboard: Some(0),
            styling: Styling::PresentationAttributes,
            decimals: DECIMALI,
            object_ids: ObjectIds::Minimal,
            images: ImageMode::Embed,
            minify: true,
            outline_text: true,
            ..ExportOptions::default()
        };
        let svg = vectorcraft_svg::export(&self.doc, &opzioni);
        self.doc.layers.clear();
        let pezzi = Pezzi::di(&svg)?;
        pezzi.elemento(id, nuovo_id)
    }
}

/// Toglie i nomi agli oggetti dentro `n`: l'esportazione ne farebbe id.
fn senza_nomi(n: &mut Node) {
    if let Some(figli) = n.children_mut() {
        for c in figli.iter_mut() {
            let c = Arc::make_mut(c);
            c.name = None;
            senza_nomi(c);
        }
    }
}

/// Ciò che l'esportazione di un oggetto solo scrive: le risorse, gli
/// elementi del livello e i prefissi della radice.
#[derive(Debug, Default, PartialEq)]
struct Pezzi {
    /// Il contenuto della `<defs>` della radice.
    risorse: String,
    /// Gli elementi del livello, ognuno com'è scritto.
    elementi: Vec<String>,
    /// I prefissi che la radice lega, con il loro namespace.
    prefissi: Vec<(String, String)>,
}

impl Pezzi {
    fn di(svg: &str) -> Result<Pezzi, String> {
        let rotta = || "l'esportazione del motore non si legge".to_string();
        let radice = figli(svg, 0..svg.len())
            .ok_or_else(rotta)?
            .into_iter()
            .find(|(_, tag)| tag == "svg")
            .ok_or_else(rotta)?
            .0;
        let mut pezzi = Pezzi::default();
        let testo_radice = &svg[radice.clone()];
        for (k, v) in attributi(inizio(testo_radice)) {
            if let Some(p) = k.strip_prefix("xmlns:") {
                pezzi.prefissi.push((p.to_string(), v));
            }
        }
        let dentro = contenuto(svg, radice);
        let mut livelli = 0;
        for (r, tag) in figli(svg, dentro).ok_or_else(rotta)? {
            match tag.as_str() {
                "defs" => pezzi.risorse.push_str(&svg[contenuto(svg, r)]),
                "g" => {
                    livelli += 1;
                    for (e, _) in figli(svg, contenuto(svg, r)).ok_or_else(rotta)? {
                        pezzi.elementi.push(svg[e].to_string());
                    }
                }
                _ => {}
            }
        }
        if livelli > 1 {
            return Err("l'esportazione del motore scrive più di un livello".into());
        }
        Ok(pezzi)
    }

    /// Il frammento come un elemento solo con l'id `id`.
    fn elemento(
        mut self,
        id: &str,
        nuovo_id: &mut dyn FnMut(Specie) -> Result<String, String>,
    ) -> Result<String, String> {
        // Gli id dell'esportazione diventano id nuovi di Fub: le risorse
        // `r…`, il resto `o…`.
        let mut rinomina: Vec<(String, String)> = Vec::new();
        for vecchio in ids(&self.risorse) {
            rinomina.push((vecchio, nuovo_id(Specie::Risorsa)?));
        }
        for testo in &self.elementi {
            for vecchio in ids(testo) {
                if !rinomina.iter().any(|(v, _)| *v == vecchio) {
                    rinomina.push((vecchio, nuovo_id(Specie::Oggetto)?));
                }
            }
        }
        self.risorse = rinominato(&self.risorse, &rinomina);
        for e in &mut self.elementi {
            *e = rinominato(e, &rinomina);
        }
        let mut legami = String::new();
        let tutto = format!("{}{}", self.risorse, self.elementi.concat());
        for (p, ns) in &self.prefissi {
            if tutto.contains(&format!("<{p}:")) || tutto.contains(&format!(" {p}:")) {
                legami.push_str(&format!(
                    " xmlns:{p}=\"{}\"",
                    vectorcraft_svg::xml_escape(ns)
                ));
            }
        }
        let id_attr = format!(" id=\"{}\"", vectorcraft_svg::xml_escape(id));
        // Un elemento solo, senza risorse e senza una sua `transform` (che
        // l'impronta non conta), prende l'id se resta un elemento del
        // formato della scena: se no l'id va su un `<g>` che lo avvolge.
        if let ([solo], true) = (&self.elementi[..], self.risorse.is_empty()) {
            let tag = inizio(solo);
            let nomi: Vec<String> = attributi(tag).into_iter().map(|(k, _)| k).collect();
            if !nomi.iter().any(|k| k == "id" || k == "transform") {
                let dopo_il_nome = tag
                    .find(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
                    .unwrap_or(tag.len());
                let mut fuori = solo.clone();
                fuori.insert_str(dopo_il_nome, &format!("{id_attr}{legami}"));
                if nel_formato(&fuori, id) {
                    return Ok(fuori);
                }
            }
        }
        let mut fuori = format!("<g{id_attr}{legami}");
        if self.elementi.is_empty() && self.risorse.is_empty() {
            fuori.push_str("/>");
        } else {
            fuori.push('>');
            if !self.risorse.is_empty() {
                fuori.push_str(&format!("<defs>{}</defs>", self.risorse));
            }
            fuori.push_str(&self.elementi.concat());
            fuori.push_str("</g>");
        }
        if !nel_formato(&fuori, id) {
            return Err(format!(
                "il corpo espanso non è un elemento del formato della scena: {}",
                inizio(&fuori)
            ));
        }
        Ok(fuori)
    }
}

/// Vero se `elemento`, messo in un livello di un disegno di Fub, è un
/// elemento del formato della scena con l'id `id`: così la ricetta lo trova
/// alla riapertura. Ciò che sta dentro può essere estraneo: si conserva e si
/// disegna com'è.
fn nel_formato(elemento: &str, id: &str) -> bool {
    let disegno = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 1 1\"><g id=\"l00000000\" fub:layer=\"L\">{elemento}</g></svg>"
    );
    let Ok(scena) = fub_scene::read(&disegno) else {
        return false;
    };
    scena.read_only.is_empty()
        && scena.items.iter().any(|i| match i {
            fub_scene::Item::Element(e) => e.path == [0, 0] && e.id.as_deref() == Some(id),
            _ => false,
        })
}

/// Il tag d'apertura di un elemento, fino al `>` compreso.
fn inizio(elemento: &str) -> &str {
    match fine_del_tag(elemento, 0) {
        Some(i) => &elemento[..i],
        None => elemento,
    }
}

/// Dove finisce il tag che comincia in `da` (dopo il suo `>`), con i valori
/// fra virgolette saltati.
fn fine_del_tag(xml: &str, da: usize) -> Option<usize> {
    let b = xml.as_bytes();
    let mut i = da + 1;
    let mut virgolette: Option<u8> = None;
    while i < b.len() {
        match (virgolette, b[i]) {
            (Some(q), c) if c == q => virgolette = None,
            (Some(_), _) => {}
            (None, b'"' | b'\'') => virgolette = Some(b[i]),
            (None, b'>') => return Some(i + 1),
            _ => {}
        }
        i += 1;
    }
    None
}

/// Gli elementi figli nel tratto `dentro` di `xml`, ognuno con il suo tratto
/// intero e il suo nome; commenti, istruzioni e testo saltati. `None` per
/// un XML che non si chiude.
fn figli(
    xml: &str,
    dentro: std::ops::Range<usize>,
) -> Option<Vec<(std::ops::Range<usize>, String)>> {
    let mut fuori = Vec::new();
    let mut i = dentro.start;
    let mut aperto: Option<(usize, String)> = None;
    let mut profondita = 0usize;
    while let Some(k) = xml[i..dentro.end].find('<') {
        let da = i + k;
        let resto = &xml[da..dentro.end];
        if resto.starts_with("<!--") {
            i = da + resto.find("-->")? + 3;
            continue;
        }
        if resto.starts_with("<![CDATA[") {
            i = da + resto.find("]]>")? + 3;
            continue;
        }
        if resto.starts_with("<?") || resto.starts_with("<!") {
            i = fine_del_tag(xml, da)?;
            continue;
        }
        let a = fine_del_tag(xml, da)?;
        if a > dentro.end {
            return None;
        }
        let tag = &xml[da..a];
        if let Some(chiude) = tag.strip_prefix("</") {
            profondita = profondita.checked_sub(1)?;
            if profondita == 0 {
                let (inizio, nome) = aperto.take()?;
                if chiude.trim_end_matches('>').trim() != nome {
                    return None;
                }
                fuori.push((inizio..a, nome));
            }
        } else {
            let nome: String = tag[1..]
                .chars()
                .take_while(|c| !c.is_ascii_whitespace() && *c != '/' && *c != '>')
                .collect();
            if tag.ends_with("/>") {
                if profondita == 0 {
                    fuori.push((da..a, nome));
                }
            } else {
                if profondita == 0 {
                    aperto = Some((da, nome));
                }
                profondita += 1;
            }
        }
        i = a;
    }
    (profondita == 0).then_some(fuori)
}

/// Il contenuto dell'elemento nel tratto `r`, fra il suo tag d'apertura e
/// quello di chiusura; vuoto per un elemento che si chiude da sé.
fn contenuto(xml: &str, r: std::ops::Range<usize>) -> std::ops::Range<usize> {
    let elemento = &xml[r.clone()];
    let tag = fine_del_tag(elemento, 0).unwrap_or(elemento.len());
    if elemento[..tag].ends_with("/>") {
        return r.start + tag..r.start + tag;
    }
    match elemento.rfind("</") {
        Some(fine) if fine >= tag => r.start + tag..r.start + fine,
        _ => r.start + tag..r.start + tag,
    }
}

/// Gli attributi di un tag d'apertura, nell'ordine, con i valori come sono
/// scritti.
fn attributi(tag: &str) -> Vec<(String, String)> {
    let mut fuori = Vec::new();
    let b = tag.as_bytes();
    let mut i = tag
        .find(|c: char| c.is_ascii_whitespace())
        .unwrap_or(b.len());
    while i < b.len() {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let nome = i;
        while i < b.len()
            && b[i] != b'='
            && !b[i].is_ascii_whitespace()
            && b[i] != b'>'
            && b[i] != b'/'
        {
            i += 1;
        }
        if i == nome {
            i += 1;
            continue;
        }
        let k = tag[nome..i].to_string();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if b.get(i) != Some(&b'=') {
            continue;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let Some(&q) = b.get(i).filter(|q| **q == b'"' || **q == b'\'') else {
            break;
        };
        let Some(fine) = tag[i + 1..].find(q as char).map(|f| f + i + 1) else {
            break;
        };
        fuori.push((k, tag[i + 1..fine].to_string()));
        i = fine + 1;
    }
    fuori
}

/// Gli id che `testo` dà agli elementi, nell'ordine.
fn ids(testo: &str) -> Vec<String> {
    let mut fuori: Vec<String> = Vec::new();
    let mut da = 0;
    while let Some(i) = testo[da..].find(" id=\"") {
        let inizio = da + i + 5;
        let Some(fine) = testo[inizio..].find('"') else {
            break;
        };
        let id = &testo[inizio..inizio + fine];
        if !fuori.iter().any(|x| x == id) {
            fuori.push(id.to_string());
        }
        da = inizio + fine;
    }
    fuori
}

/// `testo` con ogni id di `rinomina` cambiato, dove si dà e dove si rimanda
/// (`url(#…)`, `href="#…"`).
fn rinominato(testo: &str, rinomina: &[(String, String)]) -> String {
    let mut fuori = testo.to_string();
    for (vecchio, nuovo) in rinomina {
        for (prima, dopo) in [
            (format!(" id=\"{vecchio}\""), format!(" id=\"{nuovo}\"")),
            (format!("#{vecchio})"), format!("#{nuovo})")),
            (format!("#{vecchio}\""), format!("#{nuovo}\"")),
            (format!("#{vecchio}'"), format!("#{nuovo}'")),
        ] {
            fuori = fuori.replace(&prima, &dopo);
        }
    }
    fuori
}

#[cfg(test)]
mod prove {
    use super::*;

    fn conta(specie: Specie, n: &mut usize) -> Result<String, String> {
        *n += 1;
        Ok(format!("{}{:08}", specie.prefisso(), n))
    }

    #[test]
    fn un_elemento_solo_prende_l_id() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>x</title><g><path d="M0 0 L1 1" fill="#000000"/></g></svg>"##;
        let mut n = 0;
        let e = Pezzi::di(svg)
            .expect("si legge")
            .elemento("oa1a1a1a1", &mut |s| conta(s, &mut n))
            .expect("un elemento");
        assert_eq!(
            e,
            r##"<path id="oa1a1a1a1" d="M0 0 L1 1" fill="#000000"/>"##
        );
    }

    #[test]
    fn le_risorse_vanno_in_un_gruppo_con_id_nuovi() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><defs><filter id="filter-1"><feOffset dx="1"/></filter></defs><g><g filter="url(#filter-1)"><path d="M0 0" xlink:title="a"/></g></g></svg>"##;
        let mut n = 0;
        let e = Pezzi::di(svg)
            .expect("si legge")
            .elemento("oa1a1a1a1", &mut |s| conta(s, &mut n))
            .expect("un elemento");
        assert_eq!(
            e,
            r##"<g id="oa1a1a1a1" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><filter id="r00000001"><feOffset dx="1"/></filter></defs><g filter="url(#r00000001)"><path d="M0 0" xlink:title="a"/></g></g>"##
        );
    }

    #[test]
    fn piu_elementi_o_una_transform_vanno_in_un_gruppo() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><path d="M0 0"/><path d="M1 1"/></g></svg>"##;
        let mut n = 0;
        let e = Pezzi::di(svg)
            .expect("si legge")
            .elemento("oa1a1a1a1", &mut |s| conta(s, &mut n))
            .expect("un elemento");
        assert_eq!(
            e,
            r##"<g id="oa1a1a1a1"><path d="M0 0"/><path d="M1 1"/></g>"##
        );
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><path transform="matrix(1 0 0 1 2 0)" d="M0 0"/></g></svg>"##;
        let e = Pezzi::di(svg)
            .expect("si legge")
            .elemento("oa1a1a1a1", &mut |s| conta(s, &mut n))
            .expect("un elemento");
        assert_eq!(
            e,
            r##"<g id="oa1a1a1a1"><path transform="matrix(1 0 0 1 2 0)" d="M0 0"/></g>"##
        );
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g/></svg>"##;
        let e = Pezzi::di(svg)
            .expect("si legge")
            .elemento("oa1a1a1a1", &mut |s| conta(s, &mut n))
            .expect("un elemento");
        assert_eq!(e, r##"<g id="oa1a1a1a1"/>"##);
    }
}
