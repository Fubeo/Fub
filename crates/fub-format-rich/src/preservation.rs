//! Il controllo di Fub che nessun contenuto di un `.docx` si perda, posseduto da
//! Fub e indipendente dal motore che sorveglia.
//!
//! Il controllo misura i byte con [`crate::inventory`] in due momenti:
//!
//! - **all'apertura**, sui byte del file e su quelli di una prova a vuoto del
//!   codec (scrivere il documento letto senza modificarlo): ciò che il codec
//!   perderebbe da solo apre il documento in sola lettura
//!   ([`ReadOnly::Codec`](crate::ReadOnly::Codec));
//! - **a ogni salvataggio**, sui byte nuovi e su quelli della prova a vuoto
//!   della base. La prova all'apertura dimostra che il codec conserva il
//!   documento *così com'è*; una modifica cambia il modello, e il codec ha rami
//!   che dipendono dal modello (un budget sugli oggetti incorporati, parti
//!   proprie o condivise, relazioni tolte). Ciò che l'utente non ha toccato
//!   deve uscire identico: ogni blocco del corpo che il modello voluto ha uguale
//!   alla base, con le note e le caselle che mostra, e ogni classe di parti il
//!   cui dato nel modello non è cambiato. Ciò che l'utente ha toccato lo
//!   verifica già la rilettura del modello ([`crate::fidelity::reads_back`]).
//!
//! In più, al salvataggio: nessuna parte da copiare compare in più copie di
//! quante ne chiedano il modello voluto o la base, e nessun riferimento a una
//! relazione resta senza la sua relazione.
//!
//! L'inventario conta anche i valori, in forma canonica, e il testo di ogni
//! paragrafo: un valore cambiato non passa come uno sparito. Le
//! normalizzazioni dichiarate in [`crate::inventory`] sono i soli segni che
//! non si contano, ciascuna con la sua ragione ([`normalizations`]).
//!
//! La prova a vuoto accettata all'apertura si ricorda per l'impronta dei byte
//! del file (`remember`, `remembered`): il writer è deterministico, e il
//! salvataggio dopo un'apertura degli stessi byte non rifà la prova.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};

use wordcraft_doc::{Block, Document, Part, PartKind};

use crate::fidelity::{each_paragraph, shown};
use crate::inventory::{
    self, equal_differences, inventory, open_differences, Counts, Difference, Inventory,
    InventoryError, Key, DOCUMENT,
};

/// Perché un controllo non passa.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Finding {
    /// Il pacchetto non si inventaria: si fallisce chiusi.
    Unreadable(InventoryError),
    /// Il codec perderebbe o aggiungerebbe queste chiavi.
    Differences(Vec<Difference>),
}

fn findings(differences: Vec<Difference>) -> Result<(), Finding> {
    match differences.is_empty() {
        true => Ok(()),
        false => Err(Finding::Differences(differences)),
    }
}

/// La prova a vuoto di un file che la regola all'apertura ha accettato: il suo
/// inventario, che ogni salvataggio sulla stessa base confronta con i byte
/// nuovi.
#[derive(Debug)]
pub(crate) struct Baseline {
    dry: Inventory,
}

/// La regola all'apertura, sui byte del file e su quelli della prova a vuoto.
pub(crate) fn check_open(original: &[u8], dry: &[u8]) -> Result<Baseline, Finding> {
    let original = inventory(original).map_err(Finding::Unreadable)?;
    let dry = inventory(dry).map_err(Finding::Unreadable)?;
    findings(open_differences(&original, &dry))?;
    Ok(Baseline { dry })
}

/// La regola a ogni salvataggio. `baseline` è la prova a vuoto di `base`,
/// `new` sono i byte che il codec ha scritto per `wanted`.
pub(crate) fn check_save(
    baseline: &Baseline,
    new: &[u8],
    base: &Document,
    wanted: &Document,
) -> Result<(), Finding> {
    let new = inventory(new).map_err(Finding::Unreadable)?;
    findings(save_differences(&baseline.dry, &new, base, wanted))
}

/// Quante prove a vuoto si ricordano.
const REMEMBERED: usize = 8;

/// Le ultime prove a vuoto accettate, per impronta dei byte del file. Il
/// writer è deterministico (lo prova il banco del corpus), quindi gli stessi
/// byte danno la stessa prova: l'impronta fa da revisione, e una base cambiata
/// ha un'impronta nuova. Il salvataggio, che di solito segue l'apertura degli
/// stessi byte, non riscrive né reinventaria la base.
static BASELINES: Mutex<VecDeque<(String, Arc<Baseline>)>> = Mutex::new(VecDeque::new());

/// La chiave con cui una base si ricorda.
pub(crate) fn key(bytes: &[u8]) -> String {
    inventory::sha256(bytes)
}

/// La prova a vuoto accettata per questi byte, se si ricorda.
pub(crate) fn remembered(key: &str) -> Option<Arc<Baseline>> {
    let baselines = BASELINES.lock().ok()?;
    baselines
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, baseline)| Arc::clone(baseline))
}

/// Ricorda la prova a vuoto accettata per questi byte.
pub(crate) fn remember(key: String, baseline: Arc<Baseline>) {
    let Ok(mut baselines) = BASELINES.lock() else {
        return;
    };
    baselines.retain(|(k, _)| *k != key);
    if baselines.len() == REMEMBERED {
        baselines.pop_front();
    }
    baselines.push_back((key, baseline));
}

fn save_differences(
    dry: &Inventory,
    new: &Inventory,
    base: &Document,
    wanted: &Document,
) -> Vec<Difference> {
    let mut out = Vec::new();

    // I blocchi del corpo che l'utente non ha toccato: uguali uno a uno.
    let pairs = untouched_blocks(base, wanted);
    let aligned = dry.body.len() == base.body.len() && new.body.len() == wanted.body.len();
    if aligned {
        for (b, w) in &pairs {
            out.extend(equal_differences(
                &dry.body[*b],
                &new.body[*w],
                &format!("block {b}: "),
            ));
        }
    } else {
        out.push(Difference {
            key: format!(
                "body blocks: {} in the model, {} written",
                wanted.body.len(),
                new.body.len()
            ),
            before: dry.body.len() as u64,
            after: new.body.len() as u64,
        });
    }

    // Le classi di parti fuori dal corpo il cui dato non è cambiato.
    let touched = touched_regions(base, wanted, &pairs);
    let (dry_rest, new_rest) = (dry.outside_body(), new.outside_body());
    let regions: BTreeSet<String> = dry_rest
        .keys()
        .chain(new_rest.keys())
        .filter_map(region)
        .collect();
    for name in regions {
        if touched.contains(name.as_str()) {
            continue;
        }
        out.extend(equal_differences(
            &of_region(&dry_rest, &name),
            &of_region(&new_rest, &name),
            "",
        ));
    }

    // Le parti copiate: non più copie di quante ne chiedano il modello voluto
    // o la base.
    let wanted_blobs = blobs(wanted);
    for (key, after) in &new.all {
        let Key::Part { sha256, .. } = key else {
            continue;
        };
        let before = dry.all.get(key).copied().unwrap_or(0);
        let asked = wanted_blobs.get(sha256.as_str()).copied().unwrap_or(0);
        if *after > before.max(asked) {
            out.push(Difference {
                key: key.to_string(),
                before,
                after: *after,
            });
        }
    }

    for dangling in new.dangling.difference(&dry.dangling) {
        out.push(Difference {
            key: format!("dangling reference {dangling}"),
            before: 0,
            after: 1,
        });
    }
    out
}

/// La regione di una chiave fuori dal corpo: la classe della parte, o la
/// classe della sorgente con `→` per le sue relazioni. Le parti copiate hanno
/// una regola loro.
fn region(key: &Key) -> Option<String> {
    match key {
        Key::Part { .. } => None,
        Key::Relationship { source, .. } => Some(format!("{source}→")),
        key => Some(key.class().to_string()),
    }
}

fn of_region(counts: &Counts, name: &str) -> Counts {
    counts
        .iter()
        .filter(|(key, _)| region(key).as_deref() == Some(name))
        .map(|(key, n)| (key.clone(), *n))
        .collect()
}

/// Quante volte ogni contenuto di byte compare fra le immagini e le parti
/// conservate del modello, per impronta.
fn blobs(document: &Document) -> BTreeMap<String, u64> {
    let mut out = BTreeMap::new();
    for bytes in document.media.values().chain(document.passthrough.values()) {
        *out.entry(inventory::sha256(bytes)).or_default() += 1;
    }
    out
}

/// Le storie di un genere, come multinsieme dei loro contenuti.
fn stories(document: &Document, kind: PartKind) -> Vec<&Part> {
    let mut out: Vec<&Part> = document.parts.values().filter(|p| p.kind == kind).collect();
    out.sort_by_key(|part| format!("{part:?}"));
    out
}

/// Le regioni fuori dal corpo che il salvataggio può cambiare, perché il dato
/// che le scrive è cambiato nel modello. Ogni regione che non è qui deve
/// uscire identica alla prova a vuoto della base.
fn touched_regions(
    base: &Document,
    wanted: &Document,
    pairs: &[(usize, usize)],
) -> BTreeSet<&'static str> {
    let mut out = BTreeSet::new();
    let changed = |kind: PartKind| stories(base, kind) != stories(wanted, kind);
    let kept: BTreeSet<usize> = pairs.iter().map(|(_, w)| *w).collect();
    let body = pairs.len() != base.body.len() || kept.len() != wanted.body.len();
    // Una sezione chiusa da un paragrafo toccato, nella base o nel voluto.
    let kept_base: BTreeSet<usize> = pairs.iter().map(|(b, _)| *b).collect();
    let sections = |document: &Document, kept: &BTreeSet<usize>| {
        document.body.iter().enumerate().any(|(at, block)| {
            !kept.contains(&at)
                && block
                    .as_para()
                    .is_some_and(|paragraph| paragraph.section.is_some())
        })
    };
    let section = base.last_section != wanted.last_section
        || sections(base, &kept_base)
        || sections(wanted, &kept);
    if base.last_section != wanted.last_section {
        out.insert(DOCUMENT);
    }
    if body || section {
        // Le relazioni del documento principale seguono i blocchi.
        out.insert("document→");
    }
    if changed(PartKind::Header) || changed(PartKind::Footer) || section {
        out.extend(["header", "footer", "header→", "footer→"]);
    }
    let footnotes =
        changed(PartKind::Footnote) || base.footnote_separators != wanted.footnote_separators;
    if footnotes {
        out.extend(["footnotes", "footnotes→"]);
    }
    let endnotes =
        changed(PartKind::Endnote) || base.endnote_separators != wanted.endnote_separators;
    if endnotes {
        out.extend(["endnotes", "endnotes→"]);
    }
    if changed(PartKind::Comment) || base.comments != wanted.comments {
        out.extend([
            "comments",
            "comments→",
            "commentsextended",
            "commentsids",
            "commentsextensible",
            "people",
        ]);
    }
    if base.styles != wanted.styles {
        out.insert("styles");
    }
    if base.numbering != wanted.numbering {
        out.insert("numbering");
    }
    // Le impostazioni nominano i separatori delle note (`w:footnotePr`).
    if base.settings != wanted.settings || footnotes || endnotes {
        out.insert("settings");
    }
    if base.core != wanted.core {
        out.insert("core-properties");
    }
    if base.custom_props != wanted.custom_props {
        out.insert("custom-properties");
    }
    out
}

/// Le storie che un blocco mostra, anche attraverso le caselle di testo dentro
/// le caselle di testo.
fn shown_stories(document: &Document, block: &Block) -> Vec<u32> {
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let mut todo = Vec::new();
    each_paragraph(block, &mut |paragraph| todo.extend(shown(paragraph)));
    while let Some(id) = todo.pop() {
        if !seen.insert(id) {
            continue;
        }
        out.push(id);
        if let Some(part) = document.parts.get(&id) {
            for block in &part.blocks {
                each_paragraph(block, &mut |paragraph| todo.extend(shown(paragraph)));
            }
        }
    }
    out
}

/// Lo stesso blocco nei due modelli, con le stesse storie che mostra.
fn same_block(base: &Document, b: &Block, wanted: &Document, w: &Block) -> bool {
    if b != w {
        return false;
    }
    shown_stories(base, b)
        .into_iter()
        .all(|id| base.parts.get(&id) == wanted.parts.get(&id))
}

/// Oltre questa misura il tratto centrale non si allinea, e conta come
/// toccato: il confronto resta lineare sui documenti grandi.
const MAX_ALIGN: usize = 4096;

/// Le coppie (blocco della base, blocco voluto) che l'utente non ha toccato,
/// nell'ordine: il prefisso e il suffisso comuni, poi la sottosequenza comune
/// più lunga del tratto centrale.
pub(crate) fn untouched_blocks(base: &Document, wanted: &Document) -> Vec<(usize, usize)> {
    let (b, w) = (&base.body, &wanted.body);
    let eq = |i: usize, j: usize| same_block(base, &b[i], wanted, &w[j]);
    let mut prefix = 0;
    while prefix < b.len() && prefix < w.len() && eq(prefix, prefix) {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < b.len() - prefix
        && suffix < w.len() - prefix
        && eq(b.len() - 1 - suffix, w.len() - 1 - suffix)
    {
        suffix += 1;
    }
    let mut out: Vec<(usize, usize)> = (0..prefix).map(|i| (i, i)).collect();
    let (bm, wm) = (b.len() - prefix - suffix, w.len() - prefix - suffix);
    if bm > 0 && wm > 0 && bm <= MAX_ALIGN && wm <= MAX_ALIGN {
        // La tabella della sottosequenza comune, dal fondo.
        let mut table = vec![vec![0u32; wm + 1]; bm + 1];
        for i in (0..bm).rev() {
            for j in (0..wm).rev() {
                table[i][j] = if eq(prefix + i, prefix + j) {
                    table[i + 1][j + 1] + 1
                } else {
                    table[i + 1][j].max(table[i][j + 1])
                };
            }
        }
        let (mut i, mut j) = (0, 0);
        while i < bm && j < wm {
            if eq(prefix + i, prefix + j) {
                out.push((prefix + i, prefix + j));
                i += 1;
                j += 1;
            } else if table[i + 1][j] >= table[i][j + 1] {
                i += 1;
            } else {
                j += 1;
            }
        }
    }
    out.extend((0..suffix).map(|k| (b.len() - suffix + k, w.len() - suffix + k)));
    out
}

/// Il resoconto di misura di un `.docx`: ciò che una prova a vuoto del codec
/// cambierebbe, chiave per chiave, e le normalizzazioni dichiarate che ha
/// applicato. Serve a progettare la garanzia e a scegliere le normalizzazioni
/// sui file del corpus; non decide niente.
pub fn report(bytes: &[u8]) -> Result<String, crate::RichError> {
    use std::fmt::Write;
    let document = crate::Codec::Docx.read(bytes)?;
    let dry = crate::Codec::Docx.write(&document)?;
    let unreadable = |error: InventoryError| crate::RichError::Codec(format!("inventory: {error}"));
    let original = inventory(bytes).map_err(unreadable)?;
    let written = inventory(&dry).map_err(unreadable)?;
    let mut out = String::new();
    let differences = open_differences(&original, &written);
    let _ = writeln!(out, "differenze all'apertura: {}", differences.len());
    for difference in &differences {
        let _ = writeln!(out, "  {difference}");
    }
    for normalization in inventory::NORMALIZATIONS {
        let count = |inventory: &Inventory| {
            inventory
                .normalized
                .get(normalization.what)
                .copied()
                .unwrap_or(0)
        };
        let (before, after) = (count(&original), count(&written));
        if before + after > 0 {
            let _ = writeln!(
                out,
                "normalizzazione «{}»: {before} nel file, {after} nella prova a vuoto",
                normalization.what
            );
        }
    }
    Ok(out)
}

/// Le normalizzazioni dichiarate, con la ragione di ciascuna.
pub fn normalizations() -> impl Iterator<Item = (&'static str, &'static str)> {
    inventory::NORMALIZATIONS.iter().map(|n| (n.what, n.why))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};

    use crate::Codec;

    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
    const CT: &str = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    const ROOT: &str = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    const IMAGE: &str = r#"<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Picture 1"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="a.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n uno";

    fn entries(bytes: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut z = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        (0..z.len())
            .map(|i| {
                let mut f = z.by_index(i).unwrap();
                let mut out = Vec::new();
                f.read_to_end(&mut out).unwrap();
                (f.name().unwrap().to_string(), out)
            })
            .collect()
    }

    fn zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zw.start_file(name.as_str(), zip::write::SimpleFileOptions::default())
                .unwrap();
            zw.write_all(bytes).unwrap();
        }
        zw.finish().unwrap().into_inner()
    }

    /// I byte con una parte riscritta da `f` e queste voci in più.
    fn rewrite(
        bytes: &[u8],
        name: &str,
        f: impl Fn(&str) -> String,
        extra: &[(&str, &[u8])],
    ) -> Vec<u8> {
        let mut all = entries(bytes);
        let entry = all.iter_mut().find(|(n, _)| n == name).expect("parte");
        entry.1 = f(std::str::from_utf8(&entry.1).unwrap()).into_bytes();
        all.extend(extra.iter().map(|(n, b)| (n.to_string(), b.to_vec())));
        zip(&all)
    }

    /// Un documento con un paragrafo che porta `w:permStart`, una foto e un
    /// paragrafo da modificare; la base, il voluto con l'ultimo paragrafo
    /// cambiato, la prova a vuoto della base e i byte del voluto.
    fn scene() -> (Document, Document, Vec<u8>, Vec<u8>) {
        let (base, wanted, _, dry, new) = scene_with_file();
        (base, wanted, dry, new)
    }

    fn scene_with_file() -> (Document, Document, Vec<u8>, Vec<u8>, Vec<u8>) {
        let document = format!(
            r#"<w:document {W}><w:body><w:p><w:permStart w:id="7" w:edGrp="everyone"/><w:r><w:t>Primo</w:t></w:r><w:permEnd w:id="7"/></w:p>{IMAGE}<w:p><w:r><w:t>Ultimo</w:t></w:r></w:p><w:sectPr/></w:body></w:document>"#
        );
        let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>"#;
        let file = zip(&[
            ("[Content_Types].xml".into(), CT.as_bytes().to_vec()),
            ("_rels/.rels".into(), ROOT.as_bytes().to_vec()),
            ("word/document.xml".into(), document.into_bytes()),
            (
                "word/_rels/document.xml.rels".into(),
                rels.as_bytes().to_vec(),
            ),
            ("word/media/a.png".into(), PNG.to_vec()),
        ]);
        let base = Codec::Docx.read(&file).unwrap();
        let dry = Codec::Docx.write(&base).unwrap();
        assert_eq!(
            check_open(&file, &dry).map(|_| ()),
            Ok(()),
            "la scena deve aprirsi modificabile"
        );
        let mut wanted = base.clone();
        let last = wanted.body.len() - 1;
        let Some(Block::Para(paragraph)) = wanted.body.get_mut(last).map(std::sync::Arc::make_mut)
        else {
            panic!("l'ultimo blocco non è un paragrafo")
        };
        paragraph.text.push_str(" cambiato");
        let new = Codec::Docx.write(&wanted).unwrap();
        (base, wanted, file, dry, new)
    }

    fn baseline(dry: &[u8]) -> Baseline {
        Baseline {
            dry: inventory(dry).unwrap(),
        }
    }

    #[test]
    fn i_byte_del_codec_passano() {
        let (base, wanted, dry, new) = scene();
        assert_eq!(check_save(&baseline(&dry), &new, &base, &wanted), Ok(()));
    }

    /// Un elemento che il modello non possiede, sparito da un blocco che
    /// l'utente non ha toccato.
    #[test]
    fn un_elemento_in_meno_in_un_blocco_non_toccato_non_passa() {
        let (base, wanted, dry, new) = scene();
        let new = rewrite(
            &new,
            "word/document.xml",
            |xml| {
                let start = xml.find("<w:permStart").expect("permStart scritto");
                let end = start + xml[start..].find("/>").unwrap() + 2;
                format!("{}{}", &xml[..start], &xml[end..])
            },
            &[],
        );
        let Err(Finding::Differences(found)) = check_save(&baseline(&dry), &new, &base, &wanted)
        else {
            panic!("la perdita è passata")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.contains("block 0") && d.key.contains("permStart")),
            "{found:?}"
        );
    }

    /// La relazione della foto che punta a una parte con altri byte.
    #[test]
    fn una_relazione_verso_la_parte_sbagliata_non_passa() {
        let (_, _, dry, _) = scene();
        let image = entries(&dry)
            .into_iter()
            .find(|(_, b)| b == PNG)
            .map(|(n, _)| n.trim_start_matches("word/").to_string())
            .expect("foto scritta");
        let wrong = rewrite(
            &dry,
            "word/_rels/document.xml.rels",
            |xml| xml.replace(&image, "media/altra.png"),
            &[("word/media/altra.png", b"\x89PNG\r\n\x1a\n due")],
        );
        let Err(Finding::Differences(found)) = check_open(&dry, &wrong).map(|_| ()) else {
            panic!("la relazione sbagliata è passata")
        };
        assert!(
            found.iter().any(|d| d.key.contains("relationship")),
            "{found:?}"
        );
    }

    /// La stessa foto copiata due volte, sotto due nomi raggiunti da due
    /// relazioni: il modello ne chiede una.
    #[test]
    fn una_parte_copiata_duplicata_non_passa() {
        let (base, wanted, dry, new) = scene();
        let new = rewrite(
            &new,
            "word/_rels/document.xml.rels",
            |xml| {
                xml.replace(
                    "</Relationships>",
                    r#"<Relationship Id="rIdCopia" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/copia.png"/></Relationships>"#,
                )
            },
            &[("word/media/copia.png", PNG)],
        );
        let Err(Finding::Differences(found)) = check_save(&baseline(&dry), &new, &base, &wanted)
        else {
            panic!("la copia doppia è passata")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.starts_with("part ") && d.after == 2),
            "{found:?}"
        );
    }

    /// Un valore cambiato con gli stessi conteggi (`foo="A"` che diventa
    /// `foo="B"`): all'apertura e in un blocco non toccato.
    #[test]
    fn un_valore_cambiato_non_passa() {
        let (base, wanted, file, dry, new) = scene_with_file();
        let other = |xml: &str| xml.replace(r#"w:edGrp="everyone""#, r#"w:edGrp="editors""#);
        let changed = rewrite(&dry, "word/document.xml", other, &[]);
        let Err(Finding::Differences(found)) = check_open(&file, &changed).map(|_| ()) else {
            panic!("il valore cambiato è passato all'apertura")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.contains("block 0") && d.key.contains(r#"edGrp="everyone""#)),
            "{found:?}"
        );
        let new = rewrite(&new, "word/document.xml", other, &[]);
        let Err(Finding::Differences(found)) = check_save(&baseline(&dry), &new, &base, &wanted)
        else {
            panic!("il valore cambiato è passato al salvataggio")
        };
        assert!(found.iter().any(|d| d.key.contains("block 0")), "{found:?}");
    }

    /// Il testo di un paragrafo che l'utente non ha toccato.
    #[test]
    fn il_testo_di_un_blocco_non_toccato_non_cambia() {
        let (base, wanted, dry, new) = scene();
        let new = rewrite(
            &new,
            "word/document.xml",
            |xml| xml.replace(">Primo<", ">Prima<"),
            &[],
        );
        let Err(Finding::Differences(found)) = check_save(&baseline(&dry), &new, &base, &wanted)
        else {
            panic!("il testo cambiato è passato")
        };
        assert!(
            found
                .iter()
                .any(|d| d.key.contains("block 0") && d.key.contains("text of")),
            "{found:?}"
        );
    }

    /// La prova a vuoto accettata si ricorda per l'impronta dei byte: altri
    /// byte non la trovano.
    #[test]
    fn la_prova_a_vuoto_si_ricorda_per_contenuto() {
        let (_, _, file, dry, _) = scene_with_file();
        let accepted = Arc::new(check_open(&file, &dry).unwrap());
        remember(key(&file), Arc::clone(&accepted));
        let found = remembered(&key(&file)).expect("ricordata");
        assert!(Arc::ptr_eq(&found, &accepted));
        let mut other = file.clone();
        other.push(0);
        assert!(remembered(&key(&other)).is_none());
    }

    /// Un content control di blocco: i suoi paragrafi sono blocchi uno per uno,
    /// come nel modello.
    #[test]
    fn i_blocchi_dentro_un_content_control_si_contano_uno_per_uno() {
        let document = format!(
            r#"<w:document {W}><w:body><w:p/><w:sdt><w:sdtPr><w:id w:val="3"/></w:sdtPr><w:sdtContent><w:p/><w:p/></w:sdtContent><w:sdtEndPr/></w:sdt><w:sectPr/></w:body></w:document>"#
        );
        let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>"#;
        let file = zip(&[
            ("[Content_Types].xml".into(), CT.as_bytes().to_vec()),
            ("_rels/.rels".into(), ROOT.as_bytes().to_vec()),
            ("word/document.xml".into(), document.into_bytes()),
            (
                "word/_rels/document.xml.rels".into(),
                rels.as_bytes().to_vec(),
            ),
        ]);
        let found = inventory(&file).unwrap();
        assert_eq!(found.body.len(), 3);
        let sdt = Key::Element {
            class: DOCUMENT.into(),
            ns: "http://schemas.openxmlformats.org/wordprocessingml/2006/main".into(),
            name: "sdtPr".into(),
        };
        assert_eq!(
            found.body[1].get(&sdt),
            Some(&1),
            "l'involucro va con il primo blocco"
        );
        assert_eq!(found.body[2].get(&sdt), None);
    }
}
