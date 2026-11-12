//! Il file PDF intorno al pezzo che scrive `svg2pdf`, e il pezzo rimesso
//! in un ordine che non dipende dal caso.
//!
//! `svg2pdf::to_chunk` restituisce gli oggetti del disegno, con la radice
//! in un XObject di un punto per un punto. Qui il pezzo si rilegge (lo ha
//! scritto `pdf-writer`, quindi la grammatica è quella e nient'altro), si
//! ordinano le chiavi di ogni dizionario, si rinumerano gli oggetti in
//! ampiezza dalla radice, e si scrive il file intorno: catalogo, una
//! pagina della misura del disegno, i metadati. Le tavole sono un pezzo
//! per pagina, nello stesso file, con un segnalibro ciascuna; ciò che i
//! pezzi hanno uguale si scrive una volta.
//!
//! Una pagina di stampa ([`Print`]) è la carta, con il disegno al suo
//! posto, i riquadri della rifilatura e dell'abbondanza (`/TrimBox`,
//! `/BleedBox`) e i segni nel colore di registro, che inchiostra ogni
//! lastra (`/Separation /All`); il catalogo chiede allora di stampare
//! senza adattare la pagina e di scegliere il cassetto dalla sua misura.

use std::collections::{BTreeMap, VecDeque};

use fub_scene::export::print::{self, MarkShapes, Marks, Sheet, MARK_WEIGHT_PT};
use resvg::usvg::{Group, Node, Transform, Tree};

/// Il lato più lungo di una pagina in unità PDF: oltre, i lettori la
/// tagliano, e la pagina dichiara un'unità più grande (`UserUnit`).
const PAGE_MAX: f64 = 14_400.0;
/// Punti per pixel CSS: 72 per pollice contro 96.
const PT_PER_PX: f64 = 0.75;
/// Quanto possono annidarsi dizionari e array: `pdf-writer` ne scrive
/// pochi livelli, e un pezzo che ne avesse di più non è suo.
const DEPTH_MAX: usize = 64;
/// La risoluzione, in punti per pollice sulla pagina, degli effetti che
/// il PDF non sa disegnare, come le ombre e le sfocature: `svg2pdf` li
/// dipinge in un'immagine, e 300 è quella della stampa.
const EFFECTS_DPI: f32 = 300.0;
/// I pixel più grandi di un effetto dipinto: 4096 × 4096, 64 MB in
/// memoria. Se a [`EFFECTS_DPI`] un effetto ne avesse di più, la pagina
/// li dipinge tutti a una risoluzione più bassa, e l'export si fa.
const EFFECT_PIXELS_MAX: f32 = 16_777_216.0;

/// Le opzioni di `svg2pdf` per `tree`, che ha `units_per_inch` unità per
/// pollice: 96 un disegno, 72 le annotazioni di un PDF. `svg2pdf` dipinge
/// ogni gruppo con un filtro in un'immagine grande quanto la regione del
/// filtro, nelle coordinate di chi lo contiene, per `raster_scale`; una
/// scala sola vale per tutta la pagina, e si sceglie perché ogni effetto
/// abbia almeno [`EFFECTS_DPI`], anche dentro un gruppo ingrandito, finché
/// il più grande sta in [`EFFECT_PIXELS_MAX`].
pub(super) fn options(tree: &Tree, units_per_inch: f32) -> svg2pdf::ConversionOptions {
    let base = EFFECTS_DPI / units_per_inch;
    let mut effects = Effects::default();
    effects.visit(tree.root(), Transform::default());
    let wanted = if effects.magnified > 0.0 {
        base * effects.magnified
    } else {
        base
    };
    let largest = effects.area * wanted * wanted;
    svg2pdf::ConversionOptions {
        raster_scale: if largest > EFFECT_PIXELS_MAX {
            (EFFECT_PIXELS_MAX / effects.area).sqrt()
        } else {
            wanted
        },
        ..svg2pdf::ConversionOptions::default()
    }
}

/// Ciò che conta dei filtri di un albero per la scala delle immagini.
#[derive(Default)]
struct Effects {
    /// Quanto chi contiene un filtro lo ingrandisce sulla pagina, al
    /// più: 0 senza filtri.
    magnified: f32,
    /// L'area più grande di una regione di filtro, nelle coordinate in
    /// cui `svg2pdf` la dipinge.
    area: f32,
}

impl Effects {
    /// Visita `group`, che sta in coordinate che `outer` porta sulla
    /// pagina. Un filtro dentro un filtro si dipinge col primo, e conta
    /// soltanto per eccesso.
    fn visit(&mut self, group: &Group, outer: Transform) {
        if !group.filters().is_empty() {
            if let Some(region) = group.layer_bounding_box().transform(group.transform()) {
                self.area = self.area.max(region.width() * region.height());
            }
            self.magnified = self.magnified.max(stretch(outer));
        }
        let inner = outer.pre_concat(group.transform());
        for node in group.children() {
            if let Node::Group(child) = node {
                self.visit(child, inner);
            }
        }
    }
}

/// Quanto `transform` allunga al più un segmento: la più lunga delle
/// immagini dei due assi, che per una rotazione e una scala è esatta.
fn stretch(transform: Transform) -> f32 {
    let x = transform.sx.hypot(transform.ky);
    let y = transform.kx.hypot(transform.sy);
    x.max(y)
}

/// Un valore PDF. I numeri, i nomi e le stringhe restano i byte scritti,
/// perché si riscrivono tali e quali.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Value {
    Raw(Vec<u8>),
    Ref(u32),
    Array(Vec<Value>),
    Dict(Vec<(Vec<u8>, Value)>),
}

/// Un oggetto indiretto: il valore e, se è un flusso, i suoi byte.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Object {
    pub(super) id: u32,
    pub(super) value: Value,
    pub(super) stream: Option<Vec<u8>>,
}

/// Una pagina di stampa, in punti con l'origine in alto a sinistra: la
/// carta con la rifilatura e l'abbondanza, il rettangolo del disegno, che
/// la rifilatura taglia, e i segni.
pub(super) struct Print {
    sheet: Sheet,
    drawing: [f64; 4],
    marks: MarkShapes,
}

impl Print {
    /// La pagina `sheet` per un disegno di `drawn` pixel CSS, la misura
    /// dell'albero, la cui rifilatura ne misura `trim`: ciò che avanza è
    /// l'abbondanza, metà per lato.
    pub(super) fn new(sheet: Sheet, drawn: [f64; 2], trim: [f64; 2], marks: Marks) -> Print {
        let points = PT_PER_PX * sheet.scale;
        let outset = [(drawn[0] - trim[0]) / 2.0, (drawn[1] - trim[1]) / 2.0];
        Print {
            drawing: [
                sheet.trim[0] - outset[0] * points,
                sheet.trim[1] - outset[1] * points,
                drawn[0] * points,
                drawn[1] * points,
            ],
            marks: print::mark_shapes(&sheet, marks),
            sheet,
        }
    }
}

/// Una pagina da scrivere: gli oggetti del pezzo di `svg2pdf`, il suo
/// XObject, la misura del disegno in pixel CSS, la pagina di stampa se
/// non è quella di sempre e, per una tavola, il segnalibro.
pub(super) struct Page {
    objects: Vec<Object>,
    root: u32,
    width: f32,
    height: f32,
    print: Option<Print>,
    bookmark: Option<String>,
}

impl Page {
    /// Rilegge il pezzo `chunk`, con la radice `root`.
    pub(super) fn read(
        chunk: &[u8],
        root: i32,
        width: f32,
        height: f32,
        print: Option<Print>,
        bookmark: Option<String>,
    ) -> Result<Page, String> {
        let root = u32::try_from(root).map_err(|_| "invalid root object".to_string())?;
        Ok(Page {
            objects: parse(chunk)?,
            root,
            width,
            height,
            print,
            bookmark,
        })
    }
}

/// Il file: il catalogo, l'albero delle pagine, ogni pagina col suo
/// contenuto, i metadati, i segnalibri se le pagine ne hanno, e il
/// disegno di ogni pagina.
///
/// I numeri degli oggetti sono fissi: 1 il catalogo, 2 le pagine, poi
/// pagina e contenuto di ciascuna, i metadati, la radice dei segnalibri e
/// un segnalibro per pagina, e dopo il disegno. Con una pagina senza
/// segnalibro, cioè il disegno intero o la selezione, è il file di una
/// pagina di sempre: catalogo, pagine, pagina, contenuto, metadati, e il
/// disegno dal 6.
pub(super) fn document(mut pages: Vec<Page>, title: &str) -> Result<Vec<u8>, String> {
    if pages.is_empty() {
        return Err("a document without pages".to_string());
    }
    let count = pages.len() as u32;
    let page_id = |at: u32| 3 + 2 * at;
    let info = 3 + 2 * count;
    let marked: Vec<(u32, String)> = pages
        .iter_mut()
        .enumerate()
        .filter_map(|(at, page)| Some((at as u32, page.bookmark.take()?)))
        .collect();
    let outlines = (!marked.is_empty()).then_some(info + 1);
    let first = match outlines {
        Some(outlines) => outlines + 1 + marked.len() as u32,
        None => info + 1,
    };

    let sizes: Vec<(f32, f32, Option<Print>)> = pages
        .iter_mut()
        .map(|page| (page.width, page.height, page.print.take()))
        .collect();
    let (drawing, roots) = drawings(pages, first)?;

    let mut preferences = vec![(name("DisplayDocTitle"), raw("true"))];
    if sizes.iter().any(|(_, _, print)| print.is_some()) {
        // La carta è già quella giusta: la stampa non la adatta, e il
        // cassetto si sceglie dalla sua misura.
        preferences.push((name("PickTrayByPDFSize"), raw("true")));
        preferences.push((name("PrintScaling"), raw("/None")));
    }
    let mut catalog = vec![
        (name("Type"), raw("/Catalog")),
        (name("Pages"), Value::Ref(2)),
        (name("ViewerPreferences"), Value::Dict(preferences)),
    ];
    if let Some(outlines) = outlines {
        catalog.push((name("Outlines"), Value::Ref(outlines)));
        catalog.push((name("PageMode"), raw("/UseOutlines")));
    }
    let mut objects = vec![
        Object {
            id: 1,
            value: Value::Dict(catalog),
            stream: None,
        },
        Object {
            id: 2,
            value: Value::Dict(vec![
                (name("Type"), raw("/Pages")),
                (
                    name("Kids"),
                    Value::Array((0..count).map(|at| Value::Ref(page_id(at))).collect()),
                ),
                (name("Count"), raw(&count.to_string())),
            ]),
            stream: None,
        },
    ];
    for (at, ((width, height, print), root)) in (0..count).zip(sizes.into_iter().zip(roots)) {
        let (page, content) = match print {
            None => page(width, height, page_id(at) + 1, root),
            Some(print) => print_page(&print, page_id(at) + 1, root),
        };
        objects.push(Object {
            id: page_id(at),
            value: page,
            stream: None,
        });
        objects.push(Object {
            id: page_id(at) + 1,
            value: Value::Dict(Vec::new()),
            stream: Some(content),
        });
    }
    objects.push(Object {
        id: info,
        value: Value::Dict(vec![
            (name("Title"), Value::Raw(text_string(title))),
            (name("Producer"), raw("(Fub)")),
        ]),
        stream: None,
    });
    if let Some(outlines) = outlines {
        let item = |at: usize| outlines + 1 + at as u32;
        objects.push(Object {
            id: outlines,
            value: Value::Dict(vec![
                (name("Type"), raw("/Outlines")),
                (name("First"), Value::Ref(item(0))),
                (name("Last"), Value::Ref(item(marked.len() - 1))),
                (name("Count"), raw(&marked.len().to_string())),
            ]),
            stream: None,
        });
        for (at, (page, bookmark)) in marked.iter().enumerate() {
            let mut entries = vec![
                (name("Title"), Value::Raw(text_string(bookmark))),
                (name("Parent"), Value::Ref(outlines)),
            ];
            if at > 0 {
                entries.push((name("Prev"), Value::Ref(item(at - 1))));
            }
            if at + 1 < marked.len() {
                entries.push((name("Next"), Value::Ref(item(at + 1))));
            }
            entries.push((
                name("Dest"),
                Value::Array(vec![Value::Ref(page_id(*page)), raw("/Fit")]),
            ));
            objects.push(Object {
                id: item(at),
                value: Value::Dict(entries),
                stream: None,
            });
        }
    }
    objects.extend(drawing);
    Ok(file(&objects, &format!("/Info {info} 0 R /Root 1 0 R")))
}

/// Una pagina della misura del disegno, `width` × `height` pixel CSS, che
/// mostra l'XObject `drawing`, e il suo contenuto, l'oggetto `content`.
fn page(width: f32, height: f32, content: u32, drawing: u32) -> (Value, Vec<u8>) {
    // In `f64`: le cifre che si scrivono sono quattro dopo la virgola, e su
    // un lato di 14 400 punti un `f32` ne ha già perse.
    let (width, height) = (f64::from(width) * PT_PER_PX, f64::from(height) * PT_PER_PX);
    let unit = user_unit(width.max(height));
    let (width, height) = (width / unit, height / unit);

    let mut page = vec![
        (name("Type"), raw("/Page")),
        (name("Parent"), Value::Ref(2)),
        (
            name("MediaBox"),
            Value::Array(vec![raw("0"), raw("0"), number(width), number(height)]),
        ),
        (
            name("Resources"),
            Value::Dict(vec![
                (
                    name("XObject"),
                    Value::Dict(vec![(name("D"), Value::Ref(drawing))]),
                ),
                (
                    name("ProcSet"),
                    Value::Array(vec![raw("/PDF"), raw("/ImageC"), raw("/ImageB")]),
                ),
            ]),
        ),
        (name("Contents"), Value::Ref(content)),
        (
            name("Group"),
            Value::Dict(vec![
                (name("Type"), raw("/Group")),
                (name("S"), raw("/Transparency")),
                (name("I"), raw("true")),
                (name("K"), raw("false")),
                (name("CS"), raw("/DeviceRGB")),
            ]),
        ),
    ];
    if unit > 1.0 {
        page.push((name("UserUnit"), number(unit)));
    }
    let content = format!(
        "q {} 0 0 {} 0 0 cm /D Do Q",
        text(number(width)),
        text(number(height))
    )
    .into_bytes();
    (Value::Dict(page), content)
}

/// L'unità di una pagina il cui lato più lungo misura `side` punti: 1, o
/// quella che la porta dentro [`PAGE_MAX`]. Si arrotonda per eccesso alla
/// cifra che si scrive: così la pagina resta dentro il lato massimo anche
/// dopo l'arrotondamento.
fn user_unit(side: f64) -> f64 {
    ((side / PAGE_MAX * 10_000.0).ceil() / 10_000.0).max(1.0)
}

/// Il tratto dei quattro archi di Bézier con cui si disegna un cerchio:
/// 4 (√2 − 1) / 3 del raggio.
const KAPPA: f64 = 0.552_284_749_830_793_6;

/// Una pagina di stampa, che mostra l'XObject `drawing` al suo posto, e
/// il suo contenuto, l'oggetto `content`: il disegno, e poi i segni.
fn print_page(print: &Print, content: u32, drawing: u32) -> (Value, Vec<u8>) {
    let sheet = &print.sheet;
    let unit = user_unit(sheet.width.max(sheet.height));
    // Dai punti con l'origine in alto a sinistra alle unità della pagina,
    // con l'origine in basso a sinistra.
    let x = |x: f64| x / unit;
    let y = |y: f64| (sheet.height - y) / unit;
    let n = |value: f64| text(number(value));
    let rect = |left: f64, top: f64, right: f64, bottom: f64| {
        Value::Array(vec![
            number(x(left)),
            number(y(bottom)),
            number(x(right)),
            number(y(top)),
        ])
    };
    let [left, top, width, height] = sheet.trim;
    let (right, bottom) = (left + width, top + height);
    let bleed = sheet.bleed;

    let mut resources = vec![
        (
            name("XObject"),
            Value::Dict(vec![(name("D"), Value::Ref(drawing))]),
        ),
        (
            name("ProcSet"),
            Value::Array(vec![raw("/PDF"), raw("/ImageC"), raw("/ImageB")]),
        ),
    ];
    let marked = !print.marks.lines.is_empty();
    if marked {
        // Il colore di registro: inchiostra ogni lastra, e chi non separa
        // lo mostra col nero di tutti e quattro gli inchiostri.
        resources.push((
            name("ColorSpace"),
            Value::Dict(vec![(
                name("R"),
                Value::Array(vec![
                    raw("/Separation"),
                    raw("/All"),
                    raw("/DeviceCMYK"),
                    Value::Dict(vec![
                        (name("C0"), Value::Array(vec![raw("0"); 4])),
                        (name("C1"), Value::Array(vec![raw("1"); 4])),
                        (name("Domain"), Value::Array(vec![raw("0"), raw("1")])),
                        (name("FunctionType"), raw("2")),
                        (name("N"), raw("1")),
                    ]),
                ]),
            )]),
        ));
    }
    let mut page = vec![
        (name("Type"), raw("/Page")),
        (name("Parent"), Value::Ref(2)),
        (
            name("MediaBox"),
            Value::Array(vec![
                raw("0"),
                raw("0"),
                number(sheet.width / unit),
                number(sheet.height / unit),
            ]),
        ),
        (
            name("BleedBox"),
            rect(
                (left - bleed).max(0.0),
                (top - bleed).max(0.0),
                (right + bleed).min(sheet.width),
                (bottom + bleed).min(sheet.height),
            ),
        ),
        (name("TrimBox"), rect(left, top, right, bottom)),
        (name("Resources"), Value::Dict(resources)),
        (name("Contents"), Value::Ref(content)),
        (
            name("Group"),
            Value::Dict(vec![
                (name("Type"), raw("/Group")),
                (name("S"), raw("/Transparency")),
                (name("I"), raw("true")),
                (name("K"), raw("false")),
                (name("CS"), raw("/DeviceRGB")),
            ]),
        ),
    ];
    if unit > 1.0 {
        page.push((name("UserUnit"), number(unit)));
    }

    let [dx, dy, dw, dh] = print.drawing;
    let mut content = format!(
        "q {} 0 0 {} {} {} cm /D Do Q",
        n(dw / unit),
        n(dh / unit),
        n(x(dx)),
        n(y(dy + dh))
    );
    if marked {
        content.push_str(&format!("\nq /R CS 1 SCN {} w", n(MARK_WEIGHT_PT / unit)));
        for &[x1, y1, x2, y2] in &print.marks.lines {
            content.push_str(&format!(
                "\n{} {} m {} {} l S",
                n(x(x1)),
                n(y(y1)),
                n(x(x2)),
                n(y(y2))
            ));
        }
        for &[cx, cy, r] in &print.marks.circles {
            let (cx, cy, r) = (x(cx), y(cy), r / unit);
            let k = KAPPA * r;
            content.push_str(&format!(
                "\n{} {} m {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c S",
                n(cx + r), n(cy),
                n(cx + r), n(cy + k), n(cx + k), n(cy + r), n(cx), n(cy + r),
                n(cx - k), n(cy + r), n(cx - r), n(cy + k), n(cx - r), n(cy),
                n(cx - r), n(cy - k), n(cx - k), n(cy - r), n(cx), n(cy - r),
                n(cx + k), n(cy - r), n(cx + r), n(cy - k), n(cx + r), n(cy),
            ));
        }
        content.push_str("\nQ");
    }
    (Value::Dict(page), content.into_bytes())
}

/// Gli oggetti dei disegni delle pagine in forma canonica, numerati da
/// `first`, e il numero dell'XObject di ogni pagina.
///
/// Un disegno solo è il pezzo di `svg2pdf` rinumerato. Con più pagine, ciò
/// che due pagine hanno uguale si scrive una volta ([`merge_equal`]): le
/// tavole sono lo stesso disegno guardato in punti diversi, e ogni pezzo
/// porta le stesse immagini e spesso gli stessi caratteri.
fn drawings(pages: Vec<Page>, first: u32) -> Result<(Vec<Object>, Vec<u32>), String> {
    if let [_] = &pages[..] {
        let page = pages.into_iter().next().expect("una pagina");
        return Ok((canonical(page.objects, page.root, first)?, vec![first]));
    }
    // Prima ogni pezzo per sé, con numeri che non si toccano.
    let mut all = Vec::new();
    let mut roots = Vec::with_capacity(pages.len());
    let mut next = first;
    for page in pages {
        let objects = canonical(page.objects, page.root, next)?;
        roots.push(next);
        next = next
            .checked_add(objects.len() as u32)
            .ok_or_else(|| "too many objects".to_string())?;
        all.extend(objects);
    }
    let all = merge_equal(all, &mut roots);
    canonical_from(all, &roots, first)
}

/// Unisce gli oggetti uguali: lo stesso valore, una volta che i
/// riferimenti puntano agli oggetti già uniti, e lo stesso flusso. Si
/// ripete finché c'è qualcosa da unire, perché due oggetti diventano
/// uguali quando lo diventano quelli a cui puntano. `roots` passano agli
/// oggetti che restano.
fn merge_equal(objects: Vec<Object>, roots: &mut [u32]) -> Vec<Object> {
    use sha2::{Digest, Sha256};
    use std::collections::hash_map::{Entry, HashMap};

    let digests: BTreeMap<u32, [u8; 32]> = objects
        .iter()
        .filter_map(|object| Some((object.id, Sha256::digest(object.stream.as_ref()?).into())))
        .collect();
    let mut alias: BTreeMap<u32, u32> = BTreeMap::new();
    let resolve = |alias: &BTreeMap<u32, u32>, mut id: u32| {
        while let Some(&to) = alias.get(&id) {
            id = to;
        }
        id
    };
    let mut objects = objects;
    loop {
        let mut seen: HashMap<(Vec<u8>, Option<[u8; 32]>), u32> = HashMap::new();
        let mut kept = Vec::with_capacity(objects.len());
        let before = alias.len();
        for mut object in objects {
            redirect(&mut object.value, &|id| resolve(&alias, id));
            let mut key = Vec::new();
            write_value(&object.value, &mut key);
            let digest = digests.get(&object.id).copied();
            match seen.entry((key, digest)) {
                Entry::Occupied(twin) => {
                    alias.insert(object.id, *twin.get());
                }
                Entry::Vacant(free) => {
                    free.insert(object.id);
                    kept.push(object);
                }
            }
        }
        objects = kept;
        if alias.len() == before {
            break;
        }
    }
    for root in roots.iter_mut() {
        *root = resolve(&alias, *root);
    }
    objects
}

fn redirect(value: &mut Value, to: &dyn Fn(u32) -> u32) {
    match value {
        Value::Ref(id) => *id = to(*id),
        Value::Dict(entries) => entries
            .iter_mut()
            .for_each(|(_, value)| redirect(value, to)),
        Value::Array(items) => items.iter_mut().for_each(|value| redirect(value, to)),
        Value::Raw(_) => {}
    }
}

fn name(key: &str) -> Vec<u8> {
    format!("/{key}").into_bytes()
}

fn raw(token: &str) -> Value {
    Value::Raw(token.as_bytes().to_vec())
}

/// Un numero come lo scrive un PDF: senza esponente, con al massimo
/// quattro decimali, senza zeri in coda e senza il segno davanti a uno
/// zero.
fn number(value: f64) -> Value {
    let mut text = format!("{value:.4}");
    while text.contains('.') && (text.ends_with('0') || text.ends_with('.')) {
        text.pop();
    }
    if text == "-0" {
        text.remove(0);
    }
    Value::Raw(text.into_bytes())
}

fn text(value: Value) -> String {
    let mut out = Vec::new();
    write_value(&value, &mut out);
    String::from_utf8_lossy(&out).into_owned()
}

/// Una stringa di testo PDF: ASCII stampabile così com'è, altrimenti
/// UTF-16BE con il BOM, in esadecimale.
pub(super) fn text_string(title: &str) -> Vec<u8> {
    if title.bytes().all(|b| (0x20..0x7F).contains(&b)) {
        let mut out = vec![b'('];
        for b in title.bytes() {
            if matches!(b, b'(' | b')' | b'\\') {
                out.push(b'\\');
            }
            out.push(b);
        }
        out.push(b')');
        return out;
    }
    let mut out = b"<FEFF".to_vec();
    for unit in title.encode_utf16() {
        out.extend(format!("{unit:04X}").into_bytes());
    }
    out.push(b'>');
    out
}

// --- lettura ------------------------------------------------------------

fn is_white(b: u8) -> bool {
    matches!(b, b'\0' | b'\t' | b'\n' | b'\x0C' | b'\r' | b' ')
}

fn is_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

struct Reader<'a> {
    src: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn fail<T>(&self, what: &str) -> Result<T, String> {
        Err(format!("unexpected PDF data at byte {}: {what}", self.at))
    }

    fn peek(&self) -> Option<u8> {
        self.src.get(self.at).copied()
    }

    fn rest(&self) -> &[u8] {
        &self.src[self.at.min(self.src.len())..]
    }

    fn skip_white(&mut self) {
        while let Some(b) = self.peek() {
            if is_white(b) {
                self.at += 1;
            } else if b == b'%' {
                while self.peek().is_some_and(|b| b != b'\n' && b != b'\r') {
                    self.at += 1;
                }
            } else {
                break;
            }
        }
    }

    /// Una parola: tutto fino al primo spazio o delimitatore.
    fn word(&mut self) -> &[u8] {
        let start = self.at;
        while self
            .peek()
            .is_some_and(|b| !is_white(b) && !is_delimiter(b))
        {
            self.at += 1;
        }
        &self.src[start..self.at]
    }

    fn keyword(&mut self, expected: &[u8]) -> Result<(), String> {
        self.skip_white();
        if self.word() == expected {
            Ok(())
        } else {
            self.fail(&format!("expected `{}`", String::from_utf8_lossy(expected)))
        }
    }

    fn unsigned(&mut self) -> Result<u32, String> {
        self.skip_white();
        let word = self.word();
        match std::str::from_utf8(word).ok().and_then(|w| w.parse().ok()) {
            Some(n) => Ok(n),
            None => self.fail("expected an object number"),
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > DEPTH_MAX {
            return self.fail("nested too deeply");
        }
        self.skip_white();
        let start = self.at;
        match self.peek() {
            None => self.fail("end of data"),
            Some(b'<') if self.rest().starts_with(b"<<") => {
                self.at += 2;
                let mut entries = Vec::new();
                loop {
                    self.skip_white();
                    if self.rest().starts_with(b">>") {
                        self.at += 2;
                        return Ok(Value::Dict(entries));
                    }
                    let Value::Raw(key) = self.value(depth + 1)? else {
                        return self.fail("a dictionary key must be a name");
                    };
                    if !key.starts_with(b"/") {
                        return self.fail("a dictionary key must be a name");
                    }
                    let value = self.value(depth + 1)?;
                    entries.push((key, value));
                }
            }
            Some(b'<') => {
                while self.peek().is_some_and(|b| b != b'>') {
                    self.at += 1;
                }
                if self.peek().is_none() {
                    return self.fail("unterminated hex string");
                }
                self.at += 1;
                Ok(Value::Raw(self.src[start..self.at].to_vec()))
            }
            Some(b'[') => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip_white();
                    if self.peek() == Some(b']') {
                        self.at += 1;
                        return Ok(Value::Array(items));
                    }
                    items.push(self.value(depth + 1)?);
                }
            }
            Some(b'(') => {
                let mut open = 0usize;
                loop {
                    match self.peek() {
                        None => return self.fail("unterminated string"),
                        Some(b'\\') => self.at += 1,
                        Some(b'(') => open += 1,
                        Some(b')') => {
                            open -= 1;
                            if open == 0 {
                                self.at += 1;
                                break;
                            }
                        }
                        Some(_) => {}
                    }
                    self.at += 1;
                }
                Ok(Value::Raw(self.src[start..self.at].to_vec()))
            }
            Some(b'/') => {
                self.at += 1;
                self.word();
                Ok(Value::Raw(self.src[start..self.at].to_vec()))
            }
            Some(_) => {
                let word = self.word().to_vec();
                if word.is_empty() {
                    return self.fail("unexpected delimiter");
                }
                // `N 0 R` è un riferimento: tre parole, da leggere insieme.
                if word.iter().all(u8::is_ascii_digit) {
                    let back = self.at;
                    self.skip_white();
                    let generation = self.word().to_vec();
                    self.skip_white();
                    if generation == b"0" && self.word() == b"R" {
                        let id = std::str::from_utf8(&word).ok().and_then(|w| w.parse().ok());
                        return match id {
                            Some(id) => Ok(Value::Ref(id)),
                            None => self.fail("object number out of range"),
                        };
                    }
                    self.at = back;
                }
                Ok(Value::Raw(word))
            }
        }
    }

    fn object(&mut self) -> Result<Object, String> {
        let id = self.unsigned()?;
        self.keyword(b"0")?;
        self.keyword(b"obj")?;
        let value = self.value(0)?;
        self.skip_white();
        let mut stream = None;
        if self.rest().starts_with(b"stream") {
            self.at += b"stream".len();
            if self.rest().starts_with(b"\r\n") {
                self.at += 2;
            } else if self.peek() == Some(b'\n') {
                self.at += 1;
            } else {
                return self.fail("a stream starts on its own line");
            }
            let length = match &value {
                Value::Dict(entries) => entries.iter().find_map(|(key, value)| match value {
                    Value::Raw(n) if key == b"/Length" => std::str::from_utf8(n)
                        .ok()
                        .and_then(|n| n.parse::<usize>().ok()),
                    _ => None,
                }),
                _ => None,
            };
            let Some(length) = length else {
                return self.fail("a stream without a direct length");
            };
            let end = self
                .at
                .checked_add(length)
                .filter(|end| *end <= self.src.len());
            let Some(end) = end else {
                return self.fail("a stream longer than the data");
            };
            stream = Some(self.src[self.at..end].to_vec());
            self.at = end;
            self.keyword(b"endstream")?;
        }
        self.keyword(b"endobj")?;
        Ok(Object { id, value, stream })
    }
}

/// Gli oggetti di un pezzo scritto da `pdf-writer`, nell'ordine del pezzo.
pub(super) fn parse(chunk: &[u8]) -> Result<Vec<Object>, String> {
    let mut reader = Reader { src: chunk, at: 0 };
    let mut objects = Vec::new();
    loop {
        reader.skip_white();
        if reader.peek().is_none() {
            return Ok(objects);
        }
        objects.push(reader.object()?);
    }
}

// --- l'ordine -----------------------------------------------------------

/// Ordina le chiavi di ogni dizionario. In PDF l'ordine delle chiavi non
/// significa niente, quindi è l'unica forma che non cambia fra due export.
fn sort_keys(value: &mut Value) {
    match value {
        Value::Dict(entries) => {
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            for (_, value) in entries {
                sort_keys(value);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(sort_keys),
        Value::Raw(_) | Value::Ref(_) => {}
    }
}

fn refs(value: &Value, found: &mut Vec<u32>) {
    match value {
        Value::Ref(id) => found.push(*id),
        Value::Dict(entries) => entries.iter().for_each(|(_, value)| refs(value, found)),
        Value::Array(items) => items.iter().for_each(|value| refs(value, found)),
        Value::Raw(_) => {}
    }
}

fn renumber(value: &mut Value, map: &BTreeMap<u32, u32>) {
    match value {
        Value::Ref(id) => *id = map[id],
        Value::Dict(entries) => entries
            .iter_mut()
            .for_each(|(_, value)| renumber(value, map)),
        Value::Array(items) => items.iter_mut().for_each(|value| renumber(value, map)),
        Value::Raw(_) => {}
    }
}

/// Gli oggetti in forma canonica: chiavi ordinate, numeri dati in ampiezza
/// dalla radice a partire da `first`, nell'ordine dei numeri. Un oggetto
/// che dalla radice non si raggiunge non serve alla pagina e resta fuori;
/// un riferimento a un oggetto che il pezzo non contiene è un errore.
pub(super) fn canonical(
    objects: Vec<Object>,
    root: u32,
    first: u32,
) -> Result<Vec<Object>, String> {
    canonical_from(objects, &[root], first).map(|(objects, _)| objects)
}

/// Come [`canonical`], dalle radici `roots` nel loro ordine; dà anche i
/// numeri nuovi delle radici.
fn canonical_from(
    objects: Vec<Object>,
    roots: &[u32],
    first: u32,
) -> Result<(Vec<Object>, Vec<u32>), String> {
    let mut by_id = BTreeMap::new();
    for mut object in objects {
        sort_keys(&mut object.value);
        if by_id.insert(object.id, object).is_some() {
            return Err("an object number is used twice".to_string());
        }
    }
    let mut map = BTreeMap::new();
    let mut queue = VecDeque::new();
    for &root in roots {
        if !map.contains_key(&root) {
            map.insert(root, first + map.len() as u32);
            queue.push_back(root);
        }
    }
    let mut order = Vec::new();
    while let Some(id) = queue.pop_front() {
        let Some(object) = by_id.get(&id) else {
            return Err(format!("object {id} is referenced but missing"));
        };
        order.push(id);
        let mut found = Vec::new();
        refs(&object.value, &mut found);
        for next in found {
            if !map.contains_key(&next) {
                let number = first + map.len() as u32;
                map.insert(next, number);
                queue.push_back(next);
            }
        }
    }
    let objects = order
        .into_iter()
        .filter_map(|id| by_id.remove(&id))
        .map(|mut object| {
            object.id = map[&object.id];
            renumber(&mut object.value, &map);
            object
        })
        .collect();
    Ok((objects, roots.iter().map(|root| map[root]).collect()))
}

// --- scrittura ----------------------------------------------------------

fn write_value(value: &Value, out: &mut Vec<u8>) {
    match value {
        Value::Raw(token) => out.extend_from_slice(token),
        Value::Ref(id) => out.extend(format!("{id} 0 R").into_bytes()),
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b' ');
                }
                write_value(item, out);
            }
            out.push(b']');
        }
        Value::Dict(entries) => {
            out.extend_from_slice(b"<<");
            for (i, (key, value)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(b' ');
                }
                out.extend_from_slice(key);
                out.push(b' ');
                write_value(value, out);
            }
            out.extend_from_slice(b">>");
        }
    }
}

/// Il file: intestazione, oggetti in ordine di numero, tabella dei
/// riferimenti incrociati e trailer, senza date e senza `/ID`. `trailer`
/// sono le voci del trailer oltre a `/Size`, già scritte.
pub(super) fn file(objects: &[Object], trailer: &str) -> Vec<u8> {
    let mut out = b"%PDF-1.7\n%\x80\x80\x80\x80\n".to_vec();
    let mut offsets = BTreeMap::new();
    for object in objects {
        offsets.insert(object.id, out.len());
        out.extend(format!("{} 0 obj\n", object.id).into_bytes());
        let mut value = object.value.clone();
        if let (Value::Dict(entries), Some(stream)) = (&mut value, &object.stream) {
            entries.retain(|(key, _)| key != b"/Length");
            entries.push((b"/Length".to_vec(), raw(&stream.len().to_string())));
            entries.sort_by(|a, b| a.0.cmp(&b.0));
        }
        write_value(&value, &mut out);
        if let Some(stream) = &object.stream {
            out.extend_from_slice(b"\nstream\n");
            out.extend_from_slice(stream);
            out.extend_from_slice(b"\nendstream");
        }
        out.extend_from_slice(b"\nendobj\n");
    }
    let size = offsets.keys().next_back().map_or(1, |last| last + 1);
    let xref = out.len();
    out.extend(format!("xref\n0 {size}\n0000000000 65535 f\r\n").into_bytes());
    for id in 1..size {
        match offsets.get(&id) {
            Some(offset) => out.extend(format!("{offset:010} 00000 n\r\n").into_bytes()),
            None => out.extend_from_slice(b"0000000000 65535 f\r\n"),
        }
    }
    out.extend(
        format!("trailer\n<<{trailer} /Size {size}>>\nstartxref\n{xref}\n%%EOF\n").into_bytes(),
    );
    out
}
