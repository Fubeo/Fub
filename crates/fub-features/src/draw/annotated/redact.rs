//! Il PDF redatto: un documento nuovo, con le sole pagine.
//!
//! Una pagina con almeno una copertura diventa un'immagine ([`super::raster`]):
//! il contenuto sotto le coperture non c'è più, né come testo né come
//! disegno. Le altre pagine si copiano con il loro contenuto e le annotazioni
//! sopra, come nel PDF annotato ma dentro la pagina.
//!
//! Del documento originale si porta solo ciò che serve a mostrare le pagine:
//! il contenuto, le risorse, la geometria, i livelli con la loro
//! configurazione e la lingua. Restano fuori i segnalibri, gli allegati, gli
//! script e le azioni, i moduli con i loro dati, la struttura per
//! l'accessibilità, i metadati e le miniature: sono tutti posti dove il testo
//! di una pagina redatta può sopravvivere. La copia passa da [`Copier`] con
//! il recinto [`DOCUMENT`], che non attraversa pagine, annotazioni,
//! struttura, segnalibri né file incorporati.
//!
//! Le annotazioni del PDF (commenti, timbri, campi dei moduli) si disegnano
//! dentro la pagina con il loro aspetto, come le mostra l'editor, e non
//! restano annotazioni: una nota con un testo nascosto nel suo elenco dei
//! commenti sparisce con lei. Restano vive solo le note delle annotazioni
//! di Fub e i collegamenti delle pagine non redatte che portano a un indirizzo
//! o a un'altra pagina del documento.

use std::collections::BTreeSet;

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId};
use resvg::usvg::Tree;
use sha2::{Digest, Sha256};

use super::copy::{Copier, DOCUMENT};
use super::geometry::{inherited, rect, Geometry, Matrix};
use super::layers::Layers;
use super::overlay::{self, unit_to_annotations};
use super::page::{self, free_name, operands, real};
use super::raster::Image;
use super::write::{note_annotations, resolved_array, text, NoteMark};

/// La versione che il PDF redatto chiede almeno: i livelli sono del PDF 1.5.
const VERSION: (u32, u32) = (1, 5);

/// I tipi di annotazione di cui pdf.js disegna un aspetto suo quando il PDF
/// non ne scrive uno: senza aspetto scritto, nel PDF redatto non ci sono.
const SELF_DRAWN: [&[u8]; 11] = [
    b"Square",
    b"Circle",
    b"Line",
    b"PolyLine",
    b"Polygon",
    b"Ink",
    b"Highlight",
    b"Underline",
    b"Squiggly",
    b"StrikeOut",
    b"FreeText",
];

/// Le annotazioni di testo marcato, che pdf.js mostra solo con `/QuadPoints`
/// validi.
const MARKUP: [&[u8]; 4] = [b"Highlight", b"Underline", b"Squiggly", b"StrikeOut"];

/// I bit di `/F` che nascondono un'annotazione a schermo per pdf.js:
/// `Invisible`, `Hidden` e `NoView`.
const UNSEEN: i64 = 1 | 2 | 32;

/// Le azioni con nome che si limitano a sfogliare.
const NAVIGATION: [&[u8]; 4] = [b"NextPage", b"PrevPage", b"FirstPage", b"LastPage"];

/// Quanto si scende in un albero dei nomi.
const NAME_TREE_DEPTH: usize = 32;

/// L'aspetto di un'annotazione del PDF e dove va sulla pagina.
pub(super) struct Appearance {
    /// Il flusso dell'aspetto, nel documento originale.
    stream: ObjectId,
    /// Il riquadro dell'annotazione, che ritaglia il disegno come in pdf.js.
    rect: [f64; 4],
    /// Dallo spazio dell'aspetto, dopo la sua `/Matrix`, alla pagina.
    matrix: Matrix,
}

/// Le annotazioni del PDF di una pagina, come le disegna pdf.js.
pub(super) struct Found {
    pub(super) drawn: Vec<Appearance>,
    /// Le annotazioni che pdf.js disegnerebbe da sé, senza un aspetto
    /// scritto: qui mancano.
    pub(super) unshown: usize,
}

/// Le annotazioni di `page` che pdf.js disegna sulla pagina, nell'ordine di
/// `/Annots`, con le sue regole: niente finestre a comparsa, niente
/// annotazioni nascoste dai bit di `/F` o da un livello spento, l'aspetto
/// normale o quello dello stato `/AS`, e la trasformazione dell'algoritmo
/// della norma (12.5.5) che porta il riquadro dell'aspetto sul riquadro
/// dell'annotazione.
pub(super) fn appearances(doc: &Document, page: ObjectId, layers: &Layers) -> Found {
    let mut found = Found {
        drawn: Vec::new(),
        unshown: 0,
    };
    let annots = resolved_array(doc, doc.get_dictionary(page).ok(), b"Annots");
    for item in &annots {
        let Some(annotation) = doc
            .dereference(item)
            .ok()
            .and_then(|(_, value)| value.as_dict().ok())
        else {
            continue;
        };
        let subtype = annotation
            .get(b"Subtype")
            .and_then(Object::as_name)
            .ok()
            .unwrap_or(b"");
        if subtype == b"Popup" {
            continue;
        }
        let flags = annotation
            .get(b"F")
            .ok()
            .and_then(|value| super::geometry::number(doc, value))
            .map_or(0, |flags| flags as i64);
        if flags & UNSEEN != 0 {
            continue;
        }
        if MARKUP.contains(&subtype) && !quad_points(doc, annotation) {
            continue;
        }
        if let Ok(oc) = annotation.get(b"OC") {
            if !layers.visible(doc, oc) {
                continue;
            }
        }
        let Some(stream) = appearance(doc, annotation) else {
            if SELF_DRAWN.contains(&subtype) {
                found.unshown += 1;
            }
            continue;
        };
        let rect = annotation
            .get(b"Rect")
            .ok()
            .and_then(|value| rect(doc, value))
            .unwrap_or([0.0; 4]);
        let Ok(Object::Stream(form)) = doc.get_object(stream) else {
            continue;
        };
        let bbox = form
            .dict
            .get(b"BBox")
            .ok()
            .and_then(|value| numbers::<4>(doc, value))
            .map_or([0.0, 0.0, 1.0, 1.0], |b| {
                [
                    b[0].min(b[2]),
                    b[1].min(b[3]),
                    b[0].max(b[2]),
                    b[1].max(b[3]),
                ]
            });
        let own = form
            .dict
            .get(b"Matrix")
            .ok()
            .and_then(|value| numbers::<6>(doc, value))
            .map_or(Matrix::IDENTITY, Matrix);
        found.drawn.push(Appearance {
            stream,
            rect,
            matrix: placement(rect, bbox, own),
        });
    }
    found
}

/// L'aspetto che pdf.js usa: `/N` se è un flusso, altrimenti lo stato `/AS`
/// di `/N`.
fn appearance(doc: &Document, annotation: &Dictionary) -> Option<ObjectId> {
    let states = doc
        .dereference(annotation.get(b"AP").ok()?)
        .ok()?
        .1
        .as_dict()
        .ok()?;
    let normal = states.get(b"N").ok()?;
    let (id, value) = doc.dereference(normal).ok()?;
    match value {
        Object::Stream(_) => id,
        Object::Dictionary(states) => {
            let state = annotation.get(b"AS").and_then(Object::as_name).ok()?;
            let chosen = states.get(state).ok()?;
            match doc.dereference(chosen).ok()? {
                (Some(id), Object::Stream(_)) => Some(id),
                _ => None,
            }
        }
        _ => None,
    }
}

/// La trasformazione dall'aspetto alla pagina, quella di `getTransformMatrix`
/// in pdf.js: il riquadro dell'aspetto trasformato da `own` va sul riquadro
/// dell'annotazione. Con un riquadro senza area l'aspetto si sposta e basta.
fn placement(rect: [f64; 4], bbox: [f64; 4], own: Matrix) -> Matrix {
    let [x0, y0, x1, y1] = own.bounds(bbox);
    if x0 == x1 || y0 == y1 {
        return Matrix([1.0, 0.0, 0.0, 1.0, rect[0], rect[1]]);
    }
    let sx = (rect[2] - rect[0]) / (x1 - x0);
    let sy = (rect[3] - rect[1]) / (y1 - y0);
    Matrix([sx, 0.0, 0.0, sy, rect[0] - x0 * sx, rect[1] - y0 * sy])
}

/// Vero se `/QuadPoints` è un elenco di numeri lungo un multiplo di 8.
fn quad_points(doc: &Document, annotation: &Dictionary) -> bool {
    let Some(items) = annotation
        .get(b"QuadPoints")
        .ok()
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_array().ok())
    else {
        return false;
    };
    !items.is_empty()
        && items.len() % 8 == 0
        && items
            .iter()
            .all(|item| matches!(item, Object::Integer(_) | Object::Real(_)))
}

/// `N` numeri, diretti come li vuole pdf.js.
fn numbers<const N: usize>(doc: &Document, value: &Object) -> Option<[f64; N]> {
    let items = doc.dereference(value).ok()?.1.as_array().ok()?;
    if items.len() != N {
        return None;
    }
    let mut out = [0.0; N];
    for (slot, item) in out.iter_mut().zip(items) {
        *slot = match item {
            Object::Integer(n) => *n as f64,
            Object::Real(n) => f64::from(*n),
            _ => return None,
        };
    }
    out.iter().all(|v| v.is_finite()).then_some(out)
}

/// Il contenuto di una pagina copiata in un altro documento, con le cose da
/// disegnare sopra.
pub(super) struct Body {
    resources: Dictionary,
    xobjects: Dictionary,
    contents: Vec<Object>,
    /// Il contenuto che va sopra quello della pagina.
    above: String,
    /// Le annotazioni del PDF disegnate.
    pub(super) flattened: usize,
    pub(super) unshown: usize,
}

/// Le risorse e il contenuto della pagina `page`, copiati in `into`, con gli
/// aspetti delle sue annotazioni già sopra.
pub(super) fn body(
    copier: &mut Copier<'_>,
    layers: &Layers,
    page: ObjectId,
    into: &mut Document,
) -> Body {
    let source = copier.source();
    let own = page::resources(source, page);
    let xobjects = own
        .get(b"XObject")
        .ok()
        .and_then(|value| source.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .cloned()
        .unwrap_or_default();
    let resources = copier.dictionary(&own, into);
    let xobjects = copier.dictionary(&xobjects, into);
    let contents = page::contents(source, page)
        .iter()
        .map(|item| copier.value(item, into))
        .collect();
    let found = appearances(source, page, layers);
    let mut body = Body {
        resources,
        xobjects,
        contents,
        above: String::new(),
        flattened: 0,
        unshown: found.unshown,
    };
    for appearance in found.drawn {
        let Some(form) = copier.form(appearance.stream, into) else {
            continue;
        };
        let [x0, y0, x1, y1] = appearance.rect;
        let name = body.name(form);
        body.above.push_str(&format!(
            "q {} re W n {} cm /{name} Do Q\n",
            operands(&[x0, y0, x1 - x0, y1 - y0]),
            operands(&appearance.matrix.0),
        ));
        body.flattened += 1;
    }
    body
}

impl Body {
    /// Un nome nuovo fra gli XObject per `xobject`.
    fn name(&mut self, xobject: ObjectId) -> String {
        let name = free_name(&self.xobjects, "Fub");
        self.xobjects.set(name.clone(), Object::Reference(xobject));
        String::from_utf8_lossy(&name).into_owned()
    }

    /// Disegna sopra tutto il resto lo XObject delle annotazioni di Fub, fuori
    /// dalla struttura del documento come in [`page::draw`].
    pub(super) fn overlay(&mut self, xobject: ObjectId, matrix: Matrix) {
        let name = self.name(xobject);
        self.above.push_str(&format!(
            "/Artifact BMC q {} cm /{name} Do Q EMC\n",
            operands(&matrix.0)
        ));
    }

    /// Le risorse e l'elenco del contenuto. Il contenuto originale sta fra
    /// `q` e `Q`, così ciò che lascia nello stato grafico non sposta il
    /// disegno sopra; una pagina senza niente riceve un flusso vuoto, perché
    /// una pagina senza `/Contents` alcuni lettori la saltano.
    pub(super) fn finish(self, into: &mut Document) -> (Dictionary, Object) {
        let Body {
            mut resources,
            xobjects,
            contents,
            above,
            ..
        } = self;
        if !xobjects.is_empty() {
            resources.set("XObject", Object::Dictionary(xobjects));
        }
        let list = match (contents.is_empty(), above.is_empty()) {
            (true, _) => vec![Object::Reference(page::stream(
                into,
                Dictionary::new(),
                above.as_bytes(),
            ))],
            (false, true) => contents,
            (false, false) => {
                let mut list = Vec::with_capacity(contents.len() + 2);
                list.push(Object::Reference(page::stream(
                    into,
                    Dictionary::new(),
                    b"q\n",
                )));
                list.extend(contents);
                let tail = format!("\nQ\n{above}");
                list.push(Object::Reference(page::stream(
                    into,
                    Dictionary::new(),
                    tail.as_bytes(),
                )));
                list
            }
        };
        (resources, Object::Array(list))
    }
}

/// Ciò che la redazione ha tolto o non ha saputo portare, per il log.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Tally {
    /// Le annotazioni del PDF disegnate dentro le pagine.
    pub(super) flattened: usize,
    /// Le annotazioni senza un aspetto scritto, che mancano.
    pub(super) unshown: usize,
    /// I collegamenti tolti dalle pagine copiate perché eseguono uno script,
    /// aprono un file, inviano un modulo o portano a una destinazione che non
    /// c'è.
    pub(super) links: usize,
}

/// Il PDF redatto che si sta scrivendo.
pub(super) struct Redacted<'a> {
    source: &'a Document,
    layers: &'a Layers,
    doc: Document,
    copier: Copier<'a>,
    pages: ObjectId,
    /// Le pagine nuove, nell'ordine di quelle originali.
    kids: Vec<ObjectId>,
    pub(super) tally: Tally,
}

impl<'a> Redacted<'a> {
    /// Comincia il PDF redatto di `source`, che ha le pagine `pages` in
    /// ordine: ogni riferimento a una di loro diventa un riferimento alla
    /// pagina nuova, anche nei collegamenti.
    pub(super) fn new(
        source: &'a Document,
        layers: &'a Layers,
        pages: &[ObjectId],
    ) -> Redacted<'a> {
        let mut doc = Document::with_version("1.7");
        let root_pages = doc.new_object_id();
        let mut copier = Copier::new(source, &DOCUMENT);
        let mut seen = BTreeSet::new();
        let kids = pages
            .iter()
            .map(|old| {
                let new = doc.new_object_id();
                // Una pagina che l'albero elenca due volte: i riferimenti
                // vanno alla prima copia.
                if seen.insert(*old) {
                    copier.seed(*old, new);
                }
                new
            })
            .collect();
        Redacted {
            source,
            layers,
            doc,
            copier,
            pages: root_pages,
            kids,
            tally: Tally::default(),
        }
    }

    /// La pagina numero `index` (da 0) come immagine, con le note.
    pub(super) fn image(
        &mut self,
        index: usize,
        geometry: &Geometry,
        image: Image,
        notes: &[NoteMark],
    ) {
        let new = self.kids[index];
        let (width, height) = geometry.size();
        let unit = geometry.user_unit;
        let (width, height) = (width / unit, height / unit);
        let xobject = self.doc.add_object(image.xobject());
        let content = format!(
            "q {} cm /Fub Do Q\n",
            operands(&[width, 0.0, 0.0, height, 0.0, 0.0])
        );
        let contents = page::stream(&mut self.doc, Dictionary::new(), content.as_bytes());
        let mut dict = dictionary! {
            "Type" => "Page",
            "Parent" => self.pages,
            "MediaBox" => [0.0, 0.0, width, height].iter().map(|v| real(*v)).collect::<Vec<_>>(),
            "Resources" => dictionary! { "XObject" => dictionary! { "Fub" => xobject } },
            "Contents" => contents,
        };
        if unit != 1.0 {
            dict.set("UserUnit", real(unit));
        }
        let shown = Geometry {
            view: [0.0, 0.0, width, height],
            rotate: 0,
            user_unit: unit,
        };
        let annots = note_annotations(&mut self.doc, new, &shown, notes, None);
        if !annots.is_empty() {
            dict.set("Annots", annots);
        }
        self.doc.objects.insert(new, Object::Dictionary(dict));
    }

    /// La pagina numero `index` (da 0), `old` nel documento originale,
    /// copiata con le annotazioni di Fub `overlay` sopra e le note.
    pub(super) fn copy(
        &mut self,
        index: usize,
        old: ObjectId,
        geometry: &Geometry,
        overlay: Option<&Tree>,
        notes: &[NoteMark],
    ) -> Result<(), String> {
        let new = self.kids[index];
        let mut body = body(&mut self.copier, self.layers, old, &mut self.doc);
        self.tally.flattened += body.flattened;
        self.tally.unshown += body.unshown;
        if let Some(tree) = overlay {
            let xobject = overlay::convert(tree, &mut self.doc)?;
            body.overlay(
                xobject,
                unit_to_annotations(geometry.size()).then(geometry.page_space()),
            );
        }
        let (resources, contents) = body.finish(&mut self.doc);
        let mut dict = dictionary! {
            "Type" => "Page",
            "Parent" => self.pages,
            "Resources" => resources,
            "Contents" => contents,
        };
        // La geometria com'è scritta, così ogni lettore la legge come
        // l'originale; quella ereditata si porta sulla pagina, perché
        // l'albero nuovo non ha i nodi intermedi.
        for key in [b"MediaBox".as_slice(), b"CropBox", b"Rotate"] {
            if let Some(value) = inherited(self.source, old, key) {
                let value = self.copier.value(value, &mut self.doc);
                dict.set(key.to_vec(), value);
            }
        }
        let own = self.source.get_dictionary(old).ok();
        for key in [
            b"BleedBox".as_slice(),
            b"TrimBox",
            b"ArtBox",
            b"UserUnit",
            b"Group",
        ] {
            if let Some(value) = own.and_then(|own| own.get(key).ok()) {
                let value = self.copier.value(value, &mut self.doc);
                dict.set(key.to_vec(), value);
            }
        }
        let mut annots = self.links(old, new);
        annots.extend(note_annotations(&mut self.doc, new, geometry, notes, None));
        if !annots.is_empty() {
            dict.set("Annots", annots);
        }
        self.doc.objects.insert(new, Object::Dictionary(dict));
        Ok(())
    }

    /// I collegamenti della pagina che restano: verso un indirizzo, verso una
    /// pagina del documento, o che sfogliano. Del collegamento si porta il
    /// riquadro e il bordo; l'aspetto, se c'è, è già disegnato nella pagina.
    fn links(&mut self, old: ObjectId, new: ObjectId) -> Vec<Object> {
        let source = self.source;
        let annots = resolved_array(source, source.get_dictionary(old).ok(), b"Annots");
        let mut out = Vec::new();
        for item in &annots {
            let Some(link) = source
                .dereference(item)
                .ok()
                .and_then(|(_, value)| value.as_dict().ok())
            else {
                continue;
            };
            if link.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Link".as_slice()) {
                continue;
            }
            let Some(target) = self.target(link) else {
                self.tally.links += 1;
                continue;
            };
            let mut copied = dictionary! { "Type" => "Annot", "Subtype" => "Link", "P" => new };
            for key in [
                b"Rect".as_slice(),
                b"QuadPoints",
                b"Border",
                b"BS",
                b"C",
                b"H",
                b"F",
            ] {
                if let Ok(value) = link.get(key) {
                    let value = self.copier.value(value, &mut self.doc);
                    copied.set(key.to_vec(), value);
                }
            }
            match target {
                Target::Action(action) => copied.set("A", action),
                Target::Dest(dest) => copied.set("Dest", dest),
            }
            out.push(Object::Reference(self.doc.add_object(copied)));
        }
        out
    }

    /// Dove porta un collegamento, se è un posto sicuro.
    fn target(&mut self, link: &Dictionary) -> Option<Target> {
        let source = self.source;
        let action = link
            .get(b"A")
            .ok()
            .and_then(|value| source.dereference(value).ok())
            .and_then(|(_, value)| value.as_dict().ok());
        let Some(action) = action else {
            let dest = link.get(b"Dest").ok()?;
            return self.destination(dest).map(Target::Dest);
        };
        match action.get(b"S").and_then(Object::as_name).ok()? {
            b"URI" => {
                let uri = source.dereference(action.get(b"URI").ok()?).ok()?.1;
                let Object::String(bytes, format) = uri else {
                    return None;
                };
                Some(Target::Action(dictionary! {
                    "S" => "URI",
                    "URI" => Object::String(bytes.clone(), *format),
                }))
            }
            b"GoTo" => {
                let dest = self.destination(action.get(b"D").ok()?)?;
                Some(Target::Action(dictionary! { "S" => "GoTo", "D" => dest }))
            }
            b"Named" => {
                let name = action.get(b"N").and_then(Object::as_name).ok()?;
                NAVIGATION.contains(&name).then(|| {
                    Target::Action(
                        dictionary! { "S" => "Named", "N" => Object::Name(name.to_vec()) },
                    )
                })
            }
            _ => None,
        }
    }

    /// Una destinazione esplicita nel documento nuovo. Una destinazione con
    /// nome si risolve, perché i nomi del documento non si portano; una che
    /// porta a una pagina che non c'è non è una destinazione.
    fn destination(&mut self, dest: &Object) -> Option<Object> {
        let source = self.source;
        let explicit = match source.dereference(dest).ok()?.1 {
            Object::Array(items) => items.clone(),
            Object::Name(name) => named(source, name)?,
            Object::String(name, _) => named(source, name)?,
            _ => return None,
        };
        let first = explicit.first()?;
        let page = match first {
            Object::Reference(_) => self.copier.value(first, &mut self.doc),
            Object::Integer(_) => first.clone(),
            _ => return None,
        };
        if matches!(page, Object::Null) {
            return None;
        }
        let mut copied = vec![page];
        for item in &explicit[1..] {
            copied.push(self.copier.value(item, &mut self.doc));
        }
        Some(Object::Array(copied))
    }

    /// Il file.
    pub(super) fn finish(mut self) -> Result<Vec<u8>, String> {
        let source = self.source;
        let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => self.pages };
        if let Ok(original) = source.catalog() {
            for key in [b"OCProperties".as_slice(), b"Lang"] {
                if let Ok(value) = original.get(key) {
                    let value = self.copier.value(value, &mut self.doc);
                    catalog.set(key.to_vec(), value);
                }
            }
        }
        self.copier.finish(&mut self.doc);
        let count = self.kids.len() as i64;
        self.doc.objects.insert(
            self.pages,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => self.kids.iter().map(|id| Object::Reference(*id)).collect::<Vec<_>>(),
                "Count" => count,
            }),
        );
        let catalog = self.doc.add_object(catalog);
        let info = self
            .doc
            .add_object(dictionary! { "Producer" => text("Fub") });
        self.doc.trailer.set("Root", catalog);
        self.doc.trailer.set("Info", info);
        self.doc.version = version(source);

        // L'identificatore del file viene dai suoi byte: lo stesso PDF
        // redatto ha sempre lo stesso, e non dice niente dell'originale.
        let mut first = Vec::new();
        self.doc
            .save_to(&mut first)
            .map_err(|error| format!("the redacted PDF could not be written: {error}"))?;
        let id = Object::String(
            Sha256::digest(&first)[..16].to_vec(),
            lopdf::StringFormat::Hexadecimal,
        );
        self.doc.trailer.set("ID", vec![id.clone(), id]);
        let mut out = Vec::new();
        self.doc
            .save_to(&mut out)
            .map_err(|error| format!("the redacted PDF could not be written: {error}"))?;
        Ok(out)
    }
}

enum Target {
    Action(Dictionary),
    Dest(Object),
}

/// La destinazione con nome `name`: nell'albero `/Names /Dests` o nel
/// dizionario `/Dests` del catalogo, come array o come dizionario con `/D`.
fn named(doc: &Document, name: &[u8]) -> Option<Vec<Object>> {
    let catalog = doc.catalog().ok()?;
    let from_tree = catalog
        .get(b"Names")
        .ok()
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .and_then(|names| names.get(b"Dests").ok())
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_dict().ok())
        .and_then(|tree| name_tree(doc, tree, name, 0));
    let found = from_tree.or_else(|| {
        let dests = doc
            .dereference(catalog.get(b"Dests").ok()?)
            .ok()?
            .1
            .as_dict()
            .ok()?;
        dests.get(name).ok()
    })?;
    match doc.dereference(found).ok()?.1 {
        Object::Array(items) => Some(items.clone()),
        Object::Dictionary(dict) => doc
            .dereference(dict.get(b"D").ok()?)
            .ok()?
            .1
            .as_array()
            .ok()
            .cloned(),
        _ => None,
    }
}

/// Il valore di `key` in un albero dei nomi.
fn name_tree<'a>(
    doc: &'a Document,
    node: &'a Dictionary,
    key: &[u8],
    depth: usize,
) -> Option<&'a Object> {
    if depth > NAME_TREE_DEPTH {
        return None;
    }
    if let Some(names) = node
        .get(b"Names")
        .ok()
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_array().ok())
    {
        for pair in names.chunks(2) {
            if let [Object::String(name, _), value] = pair {
                if name.as_slice() == key {
                    return Some(value);
                }
            }
        }
    }
    let kids = node
        .get(b"Kids")
        .ok()
        .and_then(|value| doc.dereference(value).ok())
        .and_then(|(_, value)| value.as_array().ok())?;
    kids.iter().find_map(|kid| {
        let kid = doc.dereference(kid).ok()?.1.as_dict().ok()?;
        if let Some(limits) = kid
            .get(b"Limits")
            .ok()
            .and_then(|value| doc.dereference(value).ok())
            .and_then(|(_, value)| value.as_array().ok())
        {
            if let [Object::String(low, _), Object::String(high, _)] = limits.as_slice() {
                if key < low.as_slice() || key > high.as_slice() {
                    return None;
                }
            }
        }
        name_tree(doc, kid, key, depth + 1)
    })
}

/// La versione del PDF redatto: quella dell'originale, dall'intestazione o
/// dal catalogo, e almeno [`VERSION`].
fn version(source: &Document) -> String {
    let parse = |text: &str| -> Option<(u32, u32)> {
        let (major, minor) = text.trim().split_once('.')?;
        Some((major.parse().ok()?, minor.parse().ok()?))
    };
    let declared = source
        .catalog()
        .ok()
        .and_then(|catalog| catalog.get(b"Version").ok())
        .and_then(|value| value.as_name().ok())
        .and_then(|name| std::str::from_utf8(name).ok())
        .and_then(parse);
    let (major, minor) = [parse(&source.version), declared, Some(VERSION)]
        .into_iter()
        .flatten()
        .max()
        .unwrap_or(VERSION);
    format!("{major}.{minor}")
}

/// Le pagine dell'albero di `doc`, in ordine.
pub(super) fn page_list(doc: &Document) -> Vec<ObjectId> {
    doc.get_pages().into_values().collect()
}

/// I numeri delle pagine come si leggono in un elenco: `2, 5-7, 9`.
pub(super) fn ranges(numbers: &[u32]) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut run: Option<(u32, u32)> = None;
    for &n in numbers {
        run = match run {
            Some((start, end)) if n == end + 1 => Some((start, n)),
            Some((start, end)) => {
                out.push(span(start, end));
                Some((n, n))
            }
            None => Some((n, n)),
        };
    }
    if let Some((start, end)) = run {
        out.push(span(start, end));
    }
    out.join(", ")
}

fn span(start: u32, end: u32) -> String {
    if start == end {
        start.to_string()
    } else {
        format!("{start}-{end}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::Stream;

    fn form(bbox: [f64; 4], matrix: Option<[f64; 6]>) -> Stream {
        let mut dict = page::form(bbox, Dictionary::new());
        if let Some(matrix) = matrix {
            dict.set(
                "Matrix",
                matrix.iter().map(|v| real(*v)).collect::<Vec<_>>(),
            );
        }
        Stream::new(dict, b"0 0 m 1 1 l S".to_vec())
    }

    #[test]
    fn an_appearance_lands_on_the_rect_of_its_annotation() {
        // Senza `/Matrix`: il riquadro dell'aspetto va sul riquadro.
        let m = placement(
            [100.0, 200.0, 150.0, 220.0],
            [0.0, 0.0, 25.0, 10.0],
            Matrix::IDENTITY,
        );
        assert_eq!(m.apply(0.0, 0.0), (100.0, 200.0));
        assert_eq!(m.apply(25.0, 10.0), (150.0, 220.0));
        // Con una rotazione di 90°: la `/Matrix` la applica `Do`, e qui si
        // porta sul riquadro il riquadro già ruotato.
        let rotate = Matrix([0.0, 1.0, -1.0, 0.0, 0.0, 0.0]);
        let m = placement([10.0, 10.0, 20.0, 40.0], [0.0, 0.0, 30.0, 10.0], rotate);
        let total = rotate.then(m);
        let bounds = total.bounds([0.0, 0.0, 30.0, 10.0]);
        for (got, want) in bounds.iter().zip([10.0, 10.0, 20.0, 40.0]) {
            assert!((got - want).abs() < 1e-9, "{bounds:?}");
        }
        // Un aspetto senza area si sposta soltanto.
        assert_eq!(
            placement([5.0, 6.0, 7.0, 8.0], [0.0, 0.0, 0.0, 3.0], Matrix::IDENTITY),
            Matrix([1.0, 0.0, 0.0, 1.0, 5.0, 6.0])
        );
    }

    /// Una pagina con le annotazioni `annots`, ognuna con l'aspetto dato.
    fn page_with(annots: Vec<Dictionary>) -> (Document, ObjectId, Vec<ObjectId>) {
        let mut doc = Document::with_version("1.7");
        let mut streams = Vec::new();
        let mut refs = Vec::new();
        for mut annot in annots {
            let stream = doc.add_object(form([0.0, 0.0, 10.0, 10.0], None));
            streams.push(stream);
            if !annot.has(b"AP") {
                annot.set("AP", dictionary! { "N" => stream });
            }
            annot.set("Rect", vec![0.into(), 0.into(), 10.into(), 10.into()]);
            refs.push(Object::Reference(doc.add_object(annot)));
        }
        let page = doc.add_object(dictionary! { "Type" => "Page", "Annots" => refs });
        (doc, page, streams)
    }

    #[test]
    fn only_what_pdf_js_shows_is_drawn() {
        let (doc, page, streams) = page_with(vec![
            dictionary! { "Subtype" => "Square" },
            dictionary! { "Subtype" => "Popup" },
            dictionary! { "Subtype" => "Text", "F" => 2 },
            dictionary! { "Subtype" => "Stamp", "F" => 32 },
            dictionary! { "Subtype" => "FreeText", "F" => 1 },
            dictionary! { "Subtype" => "Highlight" },
            dictionary! { "Subtype" => "Highlight", "QuadPoints" => vec![Object::Integer(0); 8] },
            dictionary! { "Subtype" => "Widget", "F" => 4 },
        ]);
        let found = appearances(&doc, page, &Layers::default());
        let drawn: Vec<ObjectId> = found.drawn.iter().map(|a| a.stream).collect();
        assert_eq!(drawn, vec![streams[0], streams[6], streams[7]]);
        assert_eq!(found.unshown, 0);
    }

    #[test]
    fn the_state_picks_the_appearance_and_a_missing_one_is_counted() {
        let mut doc = Document::with_version("1.7");
        let on = doc.add_object(form([0.0, 0.0, 10.0, 10.0], None));
        let off = doc.add_object(form([0.0, 0.0, 10.0, 10.0], None));
        let rect = || vec![Object::Integer(0), 0.into(), 10.into(), 10.into()];
        let check = doc.add_object(dictionary! {
            "Subtype" => "Widget", "Rect" => rect(), "AS" => "Off",
            "AP" => dictionary! { "N" => dictionary! { "Yes" => on, "Off" => off } },
        });
        let unknown = doc.add_object(dictionary! {
            "Subtype" => "Widget", "Rect" => rect(), "AS" => "Maybe",
            "AP" => dictionary! { "N" => dictionary! { "Yes" => on } },
        });
        let bare = doc.add_object(dictionary! { "Subtype" => "Ink", "Rect" => rect() });
        let link = doc.add_object(dictionary! { "Subtype" => "Link", "Rect" => rect() });
        let page = doc.add_object(dictionary! {
            "Type" => "Page", "Annots" => vec![check.into(), unknown.into(), bare.into(), link.into()],
        });
        let found = appearances(&doc, page, &Layers::default());
        assert_eq!(
            found.drawn.iter().map(|a| a.stream).collect::<Vec<_>>(),
            vec![off]
        );
        // L'inchiostro senza aspetto pdf.js lo disegnerebbe; il collegamento no.
        assert_eq!(found.unshown, 1);
    }

    #[test]
    fn page_numbers_read_as_ranges() {
        assert_eq!(ranges(&[2]), "2");
        assert_eq!(ranges(&[1, 2, 3, 5, 7, 8]), "1-3, 5, 7-8");
        assert_eq!(ranges(&[]), "");
    }
}
