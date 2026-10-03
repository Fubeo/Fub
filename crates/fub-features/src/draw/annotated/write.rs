//! Il PDF annotato: l'originale, e dopo un aggiornamento con le annotazioni.
//!
//! Il file che esce comincia con i byte del PDF, identici: le annotazioni
//! sono un **aggiornamento incrementale** in coda, come quello che scrive un
//! lettore quando si salva un commento. Ciò che l'originale ha (struttura,
//! moduli, firme, segnalibri, metadati) resta com'è, e un lettore può ancora
//! risalire alla versione di prima. Un PDF che `lopdf` ha dovuto ricostruire,
//! perché la sua tabella dei riferimenti non si legge, non regge un
//! aggiornamento: allora il file si riscrive intero.
//!
//! Le annotazioni stanno in un livello del PDF (un gruppo di contenuto
//! facoltativo) che porta il nome delle annotazioni: nel pannello dei livelli
//! di un lettore si nascondono e si mostrano insieme, note comprese. Ogni
//! pagina annotata riceve il disegno, un Form XObject, e una nota del PDF
//! (`/Text`) per ogni nota che si vede, con il corpo: i lettori la mostrano
//! nell'elenco dei commenti.

use std::collections::BTreeSet;

use lopdf::{dictionary, Dictionary, Document, IncrementalDocument, Object, ObjectId};

use super::geometry::Geometry;
use super::page::{self, real};

/// La misura dell'icona di una nota che non mostra testo, in punti come si
/// vedono.
const ICON: f64 = 20.0;

/// Il giallo delle note, quello dell'evidenziatore (`#f0e442`).
const NOTE_COLOR: [f64; 3] = [240.0 / 255.0, 228.0 / 255.0, 66.0 / 255.0];

/// La versione che le annotazioni chiedono: i livelli sono del PDF 1.5.
const VERSION: (u32, u32) = (1, 5);

/// Le chiavi del trailer che un file nuovo o un aggiornamento portano. Le
/// altre sono della tabella dei riferimenti dell'originale (`/W`, `/Index`,
/// `/XRefStm`…), e il file nuovo ha la sua.
const TRAILER: [&[u8]; 4] = [b"Root", b"Info", b"ID", b"Prev"];

/// Una nota da mettere su una pagina.
pub(super) struct NoteMark {
    /// Il riquadro del testo della nota, nello spazio delle annotazioni.
    pub(super) rect: [f64; 4],
    /// Il corpo, con gli a capo come `\n`.
    pub(super) body: String,
    /// Il nome dell'annotazione del PDF (`/NM`): l'id della nota.
    pub(super) name: Option<String>,
    /// Vero se la nota non mostra testo sulla pagina: allora ha un'icona,
    /// altrimenti la nota è il riquadro del suo testo.
    pub(super) icon: bool,
}

/// Il PDF che si sta annotando.
pub(super) struct Annotated {
    pub(super) doc: Document,
    /// Il primo numero di oggetto che l'originale non usa.
    first_new: u32,
    /// Gli oggetti dell'originale che cambiano: le pagine annotate e il
    /// catalogo.
    touched: BTreeSet<ObjectId>,
    /// Il livello delle annotazioni.
    pub(super) layer: ObjectId,
}

impl Annotated {
    /// Comincia l'aggiornamento di `doc`, creando il livello `name`.
    pub(super) fn new(doc: Document, name: &str) -> Result<Annotated, String> {
        let mut doc = doc;
        let first_new = doc.max_id + 1;
        let catalog = catalog(&doc)?;
        let layer = doc.add_object(dictionary! { "Type" => "OCG", "Name" => text(name) });
        let mut properties = resolved_dict(&doc, doc.get_dictionary(catalog).ok(), b"OCProperties");
        let mut groups = resolved_array(&doc, Some(&properties), b"OCGs");
        groups.push(Object::Reference(layer));
        let mut default = resolved_dict(&doc, Some(&properties), b"D");
        if default
            .get(b"BaseState")
            .and_then(Object::as_name)
            .is_ok_and(|state| state == b"OFF")
        {
            let mut on = resolved_array(&doc, Some(&default), b"ON");
            on.push(Object::Reference(layer));
            default.set("ON", on);
        }
        // Senza `/Order` un lettore può non elencare nessun livello: l'elenco
        // nuovo li ha tutti, il nostro per ultimo.
        let mut order = if default.has(b"Order") {
            resolved_array(&doc, Some(&default), b"Order")
        } else {
            groups[..groups.len() - 1].to_vec()
        };
        order.push(Object::Reference(layer));
        default.set("Order", order);
        properties.set("OCGs", groups);
        properties.set("D", default);
        let dict = doc
            .get_dictionary_mut(catalog)
            .map_err(|_| "the PDF catalog is not a dictionary".to_string())?;
        dict.set("OCProperties", properties);
        let mut annotated = Annotated {
            doc,
            first_new,
            touched: BTreeSet::from([catalog]),
            layer,
        };
        annotated.require_version(catalog);
        Ok(annotated)
    }

    /// Mette sulla pagina `page` lo XObject del disegno, nel livello, con la
    /// trasformazione dal quadrato dello XObject allo spazio della pagina.
    pub(super) fn draw(
        &mut self,
        page: ObjectId,
        xobject: ObjectId,
        matrix: super::geometry::Matrix,
    ) {
        if let Ok(Object::Stream(stream)) = self.doc.get_object_mut(xobject) {
            stream.dict.set("OC", Object::Reference(self.layer));
        }
        page::draw(&mut self.doc, page, xobject, matrix);
        self.touched.insert(page);
    }

    /// Aggiunge alla pagina le note, nell'ordine dato, nel livello.
    pub(super) fn notes(&mut self, page: ObjectId, geometry: &Geometry, notes: &[NoteMark]) {
        if notes.is_empty() {
            return;
        }
        let mut annots = resolved_array(&self.doc, self.doc.get_dictionary(page).ok(), b"Annots");
        annots.extend(note_annotations(
            &mut self.doc,
            page,
            geometry,
            notes,
            Some(self.layer),
        ));
        if let Ok(dict) = self.doc.get_dictionary_mut(page) {
            dict.set("Annots", annots);
            self.touched.insert(page);
        }
    }

    /// Vero se il file uscirà come aggiornamento dell'originale; falso se si
    /// riscrive intero.
    pub(super) fn incremental(&self) -> bool {
        incremental(&self.doc)
    }

    /// Porta la versione del PDF a quella che le annotazioni chiedono, con la
    /// `/Version` del catalogo: in un aggiornamento l'intestazione non si
    /// riscrive.
    fn require_version(&mut self, catalog: ObjectId) {
        let header = parse_version(&self.doc.version);
        let declared = self
            .doc
            .get_dictionary(catalog)
            .ok()
            .and_then(|dict| dict.get(b"Version").ok())
            .and_then(|value| value.as_name().ok())
            .and_then(|name| std::str::from_utf8(name).ok())
            .and_then(parse_version);
        let current = header.max(declared).unwrap_or(VERSION);
        if current < VERSION {
            let name = format!("{}.{}", VERSION.0, VERSION.1);
            if let Ok(dict) = self.doc.get_dictionary_mut(catalog) {
                dict.set("Version", Object::Name(name.into_bytes()));
            }
        }
    }

    /// Il file: l'originale `bytes` con l'aggiornamento in coda, o il file
    /// riscritto intero se l'originale non regge un aggiornamento.
    pub(super) fn finish(self, bytes: Vec<u8>) -> Result<Vec<u8>, String> {
        let Annotated {
            mut doc,
            first_new,
            touched,
            ..
        } = self;
        let mut out = Vec::new();
        if incremental(&doc) {
            let changed: Vec<(ObjectId, Object)> = doc
                .objects
                .iter()
                .filter(|(id, _)| id.0 >= first_new || touched.contains(id))
                .map(|(id, object)| (*id, object.clone()))
                .collect();
            // I byte prima di `%PDF-` non sono del PDF, e gli scostamenti
            // della sua tabella contano da lì.
            let start = header_offset(&bytes);
            let mut bytes = bytes;
            bytes.drain(..start);
            let mut update = IncrementalDocument::create_from(bytes, doc);
            update.new_document.objects.extend(changed);
            keep_trailer(&mut update.new_document.trailer);
            update
                .save_to(&mut out)
                .map_err(|error| format!("the annotated PDF could not be written: {error}"))?;
        } else {
            keep_trailer(&mut doc.trailer);
            doc.trailer.remove(b"Prev");
            doc.encryption_state = None;
            if parse_version(&doc.version).is_none_or(|version| version < VERSION) {
                doc.version = format!("{}.{}", VERSION.0, VERSION.1);
            }
            doc.save_to(&mut out)
                .map_err(|error| format!("the annotated PDF could not be written: {error}"))?;
        }
        Ok(out)
    }
}

/// Un aggiornamento si appoggia alla tabella dei riferimenti dell'originale:
/// ci vuole che `lopdf` l'abbia letta, e non ricostruita cercando gli
/// oggetti, e che di un PDF cifrato sappia di nuovo cifrare.
fn incremental(doc: &Document) -> bool {
    doc.xref_start != 0
        && doc
            .encryption_state
            .as_ref()
            .is_none_or(|state| state.encrypt_object_id().is_some())
}

/// Dove comincia il PDF dentro `bytes`: all'intestazione `%PDF-`, come lo
/// legge `lopdf`.
pub(super) fn header_offset(bytes: &[u8]) -> usize {
    bytes.windows(5).position(|w| w == b"%PDF-").unwrap_or(0)
}

fn keep_trailer(trailer: &mut Dictionary) {
    let keys: Vec<Vec<u8>> = trailer
        .iter()
        .map(|(key, _)| key.clone())
        .filter(|key| !TRAILER.contains(&key.as_slice()))
        .collect();
    for key in keys {
        trailer.remove(&key);
    }
}

/// Le note di una pagina come annotazioni `/Text` del PDF, nell'ordine dato:
/// i riferimenti da aggiungere a `/Annots`. Una nota che mostra testo ha per
/// riquadro quello del testo e un aspetto vuoto, perché il testo lo disegna
/// già il disegno; una nota senza testo ha l'icona dei commenti. Con `layer`
/// le note stanno nel livello delle annotazioni.
pub(super) fn note_annotations(
    doc: &mut Document,
    page: ObjectId,
    geometry: &Geometry,
    notes: &[NoteMark],
    layer: Option<ObjectId>,
) -> Vec<Object> {
    let back = geometry.page_space();
    let mut names = BTreeSet::new();
    let mut out = Vec::with_capacity(notes.len());
    for note in notes {
        let (area, flags) = if note.icon {
            let [x, y, ..] = note.rect;
            // L'icona non gira e non cresce con lo zoom, come quella di un
            // commento scritto in un lettore.
            (back.bounds([x, y, x + ICON, y + ICON]), 4_i64 | 8 | 16)
        } else {
            (back.bounds(note.rect), 4_i64)
        };
        let appearance = note_appearance(doc, &area, note.icon);
        let mut dict = dictionary! {
            "Type" => "Annot",
            "Subtype" => "Text",
            "Rect" => area.iter().map(|v| real(*v)).collect::<Vec<_>>(),
            "Contents" => text(&note.body),
            "F" => flags,
            "C" => NOTE_COLOR.iter().map(|v| real(*v)).collect::<Vec<_>>(),
            "Name" => "Note",
            "Open" => false,
            "P" => page,
            "AP" => dictionary! { "N" => appearance },
        };
        if let Some(layer) = layer {
            dict.set("OC", layer);
        }
        if let Some(name) = note
            .name
            .as_deref()
            .filter(|name| names.insert(name.to_string()))
        {
            dict.set("NM", text(name));
        }
        out.push(Object::Reference(doc.add_object(dict)));
    }
    out
}

/// L'aspetto di una nota: l'icona, o niente sopra il testo, che il disegno
/// mostra già.
fn note_appearance(doc: &mut Document, area: &[f64; 4], icon: bool) -> ObjectId {
    let (bbox, content): ([f64; 4], &[u8]) = if icon {
        (
            [0.0, 0.0, ICON, ICON],
            b"q 1 w 0.2 0.2 0.2 RG 0.941 0.894 0.259 rg 2.5 1.5 15 17 re B \
              5.5 14 m 14.5 14 l 5.5 10.5 m 14.5 10.5 l 5.5 7 m 11.5 7 l S Q\n",
        )
    } else {
        ([0.0, 0.0, area[2] - area[0], area[3] - area[1]], b"")
    };
    page::stream(doc, page::form(bbox, Dictionary::new()), content)
}

/// Il catalogo del PDF.
pub(super) fn catalog(doc: &Document) -> Result<ObjectId, String> {
    doc.trailer
        .get(b"Root")
        .and_then(Object::as_reference)
        .ok()
        .filter(|id| doc.get_dictionary(*id).is_ok())
        .ok_or_else(|| "the PDF has no catalog".to_string())
}

/// Il dizionario alla voce `key` di `dict`, anche dietro un riferimento, come
/// copia da modificare; vuoto se non c'è.
pub(super) fn resolved_dict(doc: &Document, dict: Option<&Dictionary>, key: &[u8]) -> Dictionary {
    dict.and_then(|dict| dict.get(key).ok())
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .cloned()
        .unwrap_or_default()
}

/// L'array alla voce `key` di `dict`, anche dietro un riferimento, come copia
/// da modificare; vuoto se non c'è.
pub(super) fn resolved_array(doc: &Document, dict: Option<&Dictionary>, key: &[u8]) -> Vec<Object> {
    dict.and_then(|dict| dict.get(key).ok())
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_array().ok())
        .cloned()
        .unwrap_or_default()
}

/// Una stringa di testo del PDF: ASCII stampabile così com'è, altrimenti
/// UTF-16BE con il BOM.
pub(super) fn text(value: &str) -> Object {
    if value
        .bytes()
        .all(|b| (0x20..0x7F).contains(&b) || b == b'\n')
    {
        return Object::string_literal(value.as_bytes().to_vec());
    }
    let mut bytes = vec![0xFE, 0xFF];
    for unit in value.encode_utf16() {
        bytes.extend(unit.to_be_bytes());
    }
    Object::String(bytes, lopdf::StringFormat::Hexadecimal)
}

fn parse_version(text: &str) -> Option<(u32, u32)> {
    let (major, minor) = text.trim().split_once('.')?;
    Some((major.parse().ok()?, minor.parse().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Stream;

    /// Un PDF di due pagine scritto da `lopdf`, con o senza tabella in flusso.
    pub(crate) fn two_pages(streams: bool) -> Vec<u8> {
        let mut doc = Document::with_version("1.4");
        let pages = doc.new_object_id();
        let mut kids = Vec::new();
        for text in ["Uno", "Due"] {
            let content = doc.add_object(Stream::new(
                Dictionary::new(),
                format!("BT /F1 24 Tf 72 720 Td ({text}) Tj ET").into_bytes(),
            ));
            kids.push(Object::Reference(doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages,
                "Contents" => content,
            })));
        }
        let font = doc.add_object(
            dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica" },
        );
        doc.objects.insert(
            pages,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => 2,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
            }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        if streams {
            doc.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceStream;
        } else {
            doc.reference_table.cross_reference_type = lopdf::xref::XrefType::CrossReferenceTable;
        }
        doc.save_to(&mut out).unwrap();
        out
    }

    fn annotate(bytes: &[u8]) -> Vec<u8> {
        let doc = Document::load_mem(bytes).unwrap();
        let first = doc.get_pages()[&1];
        let mut annotated = Annotated::new(doc, "Revisione è").unwrap();
        let xobject = annotated.doc.add_object(Stream::new(
            page::form([0.0, 0.0, 1.0, 1.0], Dictionary::new()),
            b"0 0 1 1 re f".to_vec(),
        ));
        let geometry = Geometry::of(&annotated.doc, first);
        annotated.draw(first, xobject, geometry.page_space());
        annotated.notes(
            first,
            &geometry,
            &[
                NoteMark {
                    rect: [10.0, 20.0, 110.0, 34.0],
                    body: "Primo\nsecondo".into(),
                    name: Some("o1".into()),
                    icon: false,
                },
                NoteMark {
                    rect: [300.0, 400.0, 304.0, 412.0],
                    body: "Solo corpo".into(),
                    name: Some("o1".into()),
                    icon: true,
                },
            ],
        );
        annotated.finish(bytes.to_vec()).unwrap()
    }

    #[test]
    fn the_original_bytes_come_first_and_the_update_reads_back() {
        for streams in [false, true] {
            let original = two_pages(streams);
            let out = annotate(&original);
            assert!(out.starts_with(&original), "streams={streams}");
            assert_eq!(out.windows(5).filter(|w| *w == b"%PDF-").count(), 1);

            let doc = Document::load_mem(&out).unwrap();
            assert!(
                doc.xref_start > original.len() - 64,
                "si legge la tabella nuova"
            );
            let pages = doc.get_pages();
            assert_eq!(pages.len(), 2);
            let first = doc.get_dictionary(pages[&1]).unwrap();
            let contents = first.get(b"Contents").unwrap().as_array().unwrap();
            assert_eq!(contents.len(), 3);
            let annots = first.get(b"Annots").unwrap().as_array().unwrap();
            assert_eq!(annots.len(), 2);
            let note = doc
                .get_dictionary(annots[0].as_reference().unwrap())
                .unwrap();
            assert_eq!(note.get(b"Subtype").unwrap().as_name().unwrap(), b"Text");
            assert_eq!(
                note.get(b"Contents").unwrap().as_str().unwrap(),
                b"Primo\nsecondo"
            );
            assert_eq!(note.get(b"F").unwrap().as_i64().unwrap(), 4);
            // `/NM` è unico nella pagina: il secondo `o1` non lo riceve.
            assert!(note.has(b"NM"));
            let icon = doc
                .get_dictionary(annots[1].as_reference().unwrap())
                .unwrap();
            assert!(!icon.has(b"NM"));
            assert_eq!(icon.get(b"F").unwrap().as_i64().unwrap(), 28);
            // La seconda pagina non cambia.
            assert!(!doc.get_dictionary(pages[&2]).unwrap().has(b"Annots"));

            let catalog = doc.catalog().unwrap();
            assert_eq!(catalog.get(b"Version").unwrap().as_name().unwrap(), b"1.5");
            let properties = catalog.get(b"OCProperties").unwrap().as_dict().unwrap();
            let groups = properties.get(b"OCGs").unwrap().as_array().unwrap();
            assert_eq!(groups.len(), 1);
            let layer = doc
                .get_dictionary(groups[0].as_reference().unwrap())
                .unwrap();
            let name = layer.get(b"Name").unwrap().as_str().unwrap();
            assert_eq!(&name[..2], &[0xFE, 0xFF], "un nome non ASCII è UTF-16");
        }
    }

    #[test]
    fn an_existing_layer_list_keeps_its_layers() {
        let mut doc = Document::load_mem(&two_pages(false)).unwrap();
        let old = doc.add_object(dictionary! { "Type" => "OCG", "Name" => text("Vecchio") });
        let catalog = catalog(&doc).unwrap();
        let ocgs = doc.add_object(Object::Array(vec![old.into()]));
        doc.get_dictionary_mut(catalog).unwrap().set(
            "OCProperties",
            dictionary! { "OCGs" => ocgs, "D" => dictionary! { "BaseState" => "OFF", "ON" => vec![old.into()] } },
        );
        let annotated = Annotated::new(doc, "Nuovo").unwrap();
        let layer = annotated.layer;
        let doc = &annotated.doc;
        let properties = doc
            .catalog()
            .unwrap()
            .get(b"OCProperties")
            .unwrap()
            .as_dict()
            .unwrap();
        assert_eq!(
            properties.get(b"OCGs").unwrap().as_array().unwrap(),
            &vec![Object::Reference(old), Object::Reference(layer)]
        );
        let default = properties.get(b"D").unwrap().as_dict().unwrap();
        assert_eq!(
            default.get(b"ON").unwrap().as_array().unwrap(),
            &vec![Object::Reference(old), Object::Reference(layer)]
        );
        assert_eq!(
            default.get(b"Order").unwrap().as_array().unwrap(),
            &vec![Object::Reference(old), Object::Reference(layer)]
        );
        // L'array condiviso dell'originale non cambia.
        assert_eq!(doc.get_object(ocgs).unwrap().as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_reconstructed_pdf_is_rewritten_whole() {
        let mut broken = two_pages(false);
        // Una tabella che non si legge: `lopdf` ricostruisce cercando gli
        // oggetti, e `xref_start` resta zero.
        let at = broken.windows(5).rposition(|w| w == b"xref\n").unwrap();
        broken[at..at + 4].copy_from_slice(b"xxxx");
        let doc = Document::load_mem(&broken).unwrap();
        assert_eq!(doc.xref_start, 0);
        let out = annotate(&broken);
        let doc = Document::load_mem(&out).unwrap();
        assert_ne!(doc.xref_start, 0);
        assert_eq!(doc.get_pages().len(), 2);
        assert_eq!(doc.version, "1.5");
    }

    #[test]
    fn junk_before_the_header_is_not_part_of_the_pdf() {
        let mut original = b"junk\n".to_vec();
        original.extend(two_pages(false));
        let out = annotate(&original);
        assert!(out.starts_with(b"%PDF-"));
        let doc = Document::load_mem(&out).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
        let first = doc.get_dictionary(doc.get_pages()[&1]).unwrap();
        assert_eq!(first.get(b"Annots").unwrap().as_array().unwrap().len(), 2);
    }

    #[test]
    fn text_strings_are_ascii_or_utf16() {
        assert_eq!(text("Abc (1)"), Object::string_literal("Abc (1)"));
        let Object::String(bytes, _) = text("è") else {
            panic!()
        };
        assert_eq!(bytes, vec![0xFE, 0xFF, 0x00, 0xE8]);
    }
}
