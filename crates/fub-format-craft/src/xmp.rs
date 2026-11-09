//! Gli XMP che LightCraft scrive accanto a una foto: voto, etichetta, scelta e
//! parole chiave, letti per diventare proprietà e tag di Fub.
//!
//! Le regolazioni (`crs:*`, `lc:settings`) non si leggono mai: i loro
//! sottoalberi si saltano interi, e niente di ciò che contengono entra nel
//! modello. Fub non scrive mai un XMP.
//!
//! # I nomi
//!
//! Un nome si riconosce dal suo namespace quando è uno di quelli noti (RDF,
//! `xmp`, Dublin Core, Camera Raw), altrimenti dal prefisso convenzionale con
//! cui LightCraft lo scrive (`rdf:`, `xmp:`, `dc:`, `crs:`, `lc:`): così un XMP
//! scritto a mano senza le dichiarazioni `xmlns` si legge lo stesso, e `lc:`,
//! di cui il namespace non è documentato, si riconosce dal prefisso. I nomi si
//! confrontano così come sono scritti, senza piegare il caso.
//!
//! # L'XML ostile
//!
//! Le entità non si espandono mai: un `<!DOCTYPE>` si ignora, e un riferimento
//! a un'entità che non è una delle cinque predefinite si salta. Un file sopra
//! [`MAX_XMP_BYTES`] o annidato oltre [`MAX_XMP_DEPTH`] dà
//! [`XmpError::TooLarge`]; un XML malformato dà [`XmpError::NotXml`].

use std::borrow::Cow;

use fub_abi::model::{DocId, DocumentModel, Frontmatter, Span, Tag};
use fub_abi::rules::tag::frontmatter_tags;
use fub_abi::ParseContext;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::{QName, ResolveResult};
use quick_xml::{NsReader, XmlVersion};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// L'XMP più grande che si legge.
pub const MAX_XMP_BYTES: usize = 8 * 1024 * 1024;
/// Le parole chiave al massimo di un XMP.
pub const MAX_KEYWORDS: usize = 500;
/// L'annidamento più profondo che si legge. Un XMP di LightCraft ne usa una
/// decina di livelli.
pub const MAX_XMP_DEPTH: usize = 256;
/// L'etichetta più lunga che si tiene, in caratteri.
pub const MAX_LABEL_CHARS: usize = 64;

/// Il voto più basso: -1 è «scartata».
const MIN_RATING: i8 = -1;
/// Il voto più alto.
const MAX_RATING: i8 = 5;

const RDF_NS: &[u8] = b"http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const XMP_NS: &[u8] = b"http://ns.adobe.com/xap/1.0/";
const DC_NS: &[u8] = b"http://purl.org/dc/elements/1.1/";
const CRS_NS: &[u8] = b"http://ns.adobe.com/camera-raw-settings/1.0/";

/// Il BOM di UTF-8, che un XMP salvato da un editor di testo può avere.
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";

/// Ciò che un XMP dice della sua foto.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PhotoMeta {
    /// Il voto, da -1 (scartata) a 5.
    pub rating: Option<i8>,
    /// L'etichetta di colore, non vuota.
    pub label: Option<String>,
    /// La scelta; `lc:flag="none"` è `None`.
    pub flag: Option<Flag>,
    /// Le parole chiave di `dc:subject`, senza doppioni, nell'ordine del file.
    pub keywords: Vec<String>,
}

/// La scelta di una foto. In JSON `"pick"` o `"reject"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Flag {
    Pick,
    Reject,
}

impl Flag {
    /// Il valore della proprietà `flag`, lo stesso che LightCraft scrive.
    pub fn as_str(self) -> &'static str {
        match self {
            Flag::Pick => "pick",
            Flag::Reject => "reject",
        }
    }
}

/// Perché un XMP non si legge. Senza testi.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum XmpError {
    /// Non è un XML leggibile: malformato, non UTF-8, vuoto, senza elementi o
    /// con del testo fuori dalla radice.
    NotXml,
    /// Supera [`MAX_XMP_BYTES`], o è annidato oltre [`MAX_XMP_DEPTH`].
    TooLarge,
}

/// La foto a cui un XMP appartiene, detta dal suo nome: chi guarda il vault
/// sceglie fra i file che ci sono.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PhotoMatch {
    /// `IMG_0001.CR3.xmp`: la foto è esattamente `IMG_0001.CR3`.
    Exact(String),
    /// `IMG_0001.xmp`: la foto è un file accanto che si chiama
    /// `IMG_0001.<ext>`, con un'estensione diversa da quella dell'XMP.
    Stem(String),
}

/// Legge voto, etichetta, scelta e parole chiave.
///
/// Voto, etichetta e scelta si leggono sia come attributi di
/// `rdf:Description` (`xmp:Rating="3"`) sia come elementi
/// (`<xmp:Rating>3</xmp:Rating>`); vale il primo valore valido del file. Le
/// parole chiave sono i `rdf:li` dentro `dc:subject`, col testo ricomposto
/// dai pezzi e dai riferimenti (le cinque entità predefinite e i riferimenti
/// numerici); un `rdf:li` fuori da `dc:subject` si ignora.
pub fn read(bytes: &[u8]) -> Result<PhotoMeta, XmpError> {
    if bytes.len() > MAX_XMP_BYTES {
        return Err(XmpError::TooLarge);
    }
    let bytes = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);

    let mut reader = NsReader::from_reader(bytes);
    {
        let config = reader.config_mut();
        config.trim_text(false);
        config.expand_empty_elements = false;
        config.check_end_names = true;
    }

    let mut acc = Accumulator::default();
    let mut depth = 0usize;
    let mut seen_element = false;
    // La profondità dell'elemento che si sta saltando (`crs:*`, `lc:settings`).
    let mut skip_from: Option<usize> = None;
    // La profondità del `dc:subject` aperto.
    let mut subject_at: Option<usize> = None;
    // Il campo che si sta leggendo come testo di un elemento.
    let mut capture: Option<Capture> = None;
    let mut buf = Vec::new();

    loop {
        buf.clear();
        let event = reader
            .read_event_into(&mut buf)
            .map_err(|_| XmpError::NotXml)?;
        match event {
            Event::Start(start) => {
                depth += 1;
                if depth > MAX_XMP_DEPTH {
                    return Err(XmpError::TooLarge);
                }
                seen_element = true;
                if skip_from.is_some() {
                    continue;
                }
                let kind = classify_element(&reader, &start);
                if kind.is_skipped() {
                    skip_from = Some(depth);
                    continue;
                }
                if kind == Kind::Description {
                    read_attributes(&reader, &start, &mut acc)?;
                }
                if capture.is_some() {
                    continue;
                }
                let field = match kind {
                    Kind::Rating => Some(Field::Rating),
                    Kind::Label => Some(Field::Label),
                    Kind::Flag => Some(Field::Flag),
                    Kind::Subject => {
                        subject_at.get_or_insert(depth);
                        None
                    }
                    Kind::Li if subject_at.is_some() => Some(Field::Keyword),
                    _ => None,
                };
                if let Some(field) = field {
                    capture = Some(Capture {
                        field,
                        depth,
                        text: String::new(),
                    });
                }
            }
            Event::Empty(start) => {
                if depth + 1 > MAX_XMP_DEPTH {
                    return Err(XmpError::TooLarge);
                }
                seen_element = true;
                if skip_from.is_some() || capture.is_some() {
                    continue;
                }
                // Un elemento vuoto non ha testo: conta solo per gli
                // attributi di `rdf:Description`.
                if classify_element(&reader, &start) == Kind::Description {
                    read_attributes(&reader, &start, &mut acc)?;
                }
            }
            Event::End(_) => {
                if skip_from == Some(depth) {
                    skip_from = None;
                } else if skip_from.is_none() {
                    if capture.as_ref().is_some_and(|c| c.depth == depth) {
                        if let Some(done) = capture.take() {
                            acc.offer(done.field, &done.text);
                        }
                    } else if subject_at == Some(depth) {
                        subject_at = None;
                    }
                }
                depth = depth.checked_sub(1).ok_or(XmpError::NotXml)?;
            }
            Event::Text(text) => {
                // Fuori dalla radice c'è solo spazio: altro testo vuol dire
                // che non è XML (o è UTF-16, che qui non si legge).
                if depth == 0 && !text.iter().all(u8::is_ascii_whitespace) {
                    return Err(XmpError::NotXml);
                }
                if skip_from.is_none() {
                    if let Some(open) = capture.as_mut() {
                        let text = text
                            .xml_content(XmlVersion::Implicit1_0)
                            .map_err(|_| XmpError::NotXml)?;
                        open.text.push_str(&text);
                    }
                }
            }
            Event::CData(text) => {
                if skip_from.is_none() {
                    if let Some(open) = capture.as_mut() {
                        let text = text.decode().map_err(|_| XmpError::NotXml)?;
                        open.text.push_str(&text);
                    }
                }
            }
            Event::GeneralRef(reference) => {
                if skip_from.is_none() {
                    if let Some(open) = capture.as_mut() {
                        // Un riferimento numerico non valido o un'entità che
                        // non è predefinita si saltano: mai espanse.
                        match reference.resolve_char_ref() {
                            Ok(Some(ch)) => open.text.push(ch),
                            Ok(None) => {
                                let name = reference.decode().map_err(|_| XmpError::NotXml)?;
                                if let Some(value) = resolve_predefined_entity(&name) {
                                    open.text.push_str(value);
                                }
                            }
                            Err(_) => {}
                        }
                    }
                }
            }
            Event::Eof => break,
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
        }
    }

    if depth != 0 || !seen_element {
        return Err(XmpError::NotXml);
    }
    Ok(acc.meta)
}

/// Il modello del documento di un XMP: proprietà, tag e testo. Un XMP rotto dà
/// il modello vuoto.
///
/// Il frontmatter ha le sole chiavi presenti fra `rating`, `label`, `flag`
/// (`"pick"` o `"reject"`) e `tags`. Un tag è la parola chiave senza i `#`
/// iniziali e con ogni serie di spazi diventata `-` («New York» →
/// `New-York`); vale come tag solo ciò che la regola dei tag di `fub-abi`
/// accetta, e una parola che non può esserlo (`R&D`, `1990`) resta nel testo.
/// Il testo sono le parole chiave e poi l'etichetta, una per riga.
pub fn document_model(ctx: &ParseContext, bytes: &[u8]) -> DocumentModel {
    let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
    let Ok(meta) = read(bytes) else {
        return model;
    };

    let mut map = Map::new();
    if let Some(rating) = meta.rating {
        map.insert("rating".to_string(), Value::from(rating));
    }
    if let Some(label) = &meta.label {
        map.insert("label".to_string(), Value::from(label.as_str()));
    }
    if let Some(flag) = meta.flag {
        map.insert("flag".to_string(), Value::from(flag.as_str()));
    }

    let tags = keyword_tags(&meta.keywords);
    if !tags.is_empty() {
        map.insert(
            "tags".to_string(),
            Value::Array(tags.iter().map(|t| Value::from(t.as_str())).collect()),
        );
    }
    model.frontmatter = Frontmatter(map);
    model.tags = tags
        .into_iter()
        .map(|name| Tag {
            name,
            span: Span::EMPTY,
        })
        .collect();

    let mut lines: Vec<&str> = meta.keywords.iter().map(String::as_str).collect();
    if let Some(label) = &meta.label {
        lines.push(label);
    }
    model.text = lines.join("\n");
    model
}

/// La foto che il nome dell'XMP indica.
///
/// Si toglie l'ultima estensione così com'è scritta: se resta un nome con
/// un'estensione (`IMG_0001.CR3`) la foto è esattamente quella, altrimenti è
/// un file accanto con quel gambo. Il nome può portare le cartelle
/// (`Foto/IMG_0001.xmp`), che restano nella risposta. Un nome senza
/// estensione dà un gambo vuoto, che non nomina nessun file.
pub fn photo_candidates(xmp_name: &str) -> PhotoMatch {
    let Some((stem, _)) = split_extension(xmp_name) else {
        return PhotoMatch::Stem(String::new());
    };
    if split_extension(stem).is_some() {
        PhotoMatch::Exact(stem.to_string())
    } else {
        PhotoMatch::Stem(stem.to_string())
    }
}

/// Gli XMP che possono stare accanto a `photo`, nell'ordine in cui valgono:
/// prima il nome intero più `.xmp` (`IMG_0001.CR3` → `IMG_0001.CR3.xmp`),
/// poi il nome senza l'ultima estensione più `.xmp` (`IMG_0001.xmp`). Sono le
/// due forme di [`photo_candidates`], lette al contrario: le cartelle restano
/// e i nomi sono così come sono scritti, senza piegare il caso.
///
/// Un nome senza estensione (`IMG`, `.nascosto`) ha soltanto la prima forma;
/// un nome vuoto, o che finisce con `/`, nessuna. Un nome che è già un `.xmp`
/// non è il suo stesso XMP: la seconda forma, che lo ripeterebbe, non c'è.
pub fn sidecar_candidates(photo: &str) -> Vec<String> {
    if photo.is_empty() || photo.ends_with('/') {
        return Vec::new();
    }
    let mut out = vec![format!("{photo}.xmp")];
    if let Some((stem, _)) = split_extension(photo) {
        let stem_form = format!("{stem}.xmp");
        if stem_form != photo {
            out.push(stem_form);
        }
    }
    out
}

/// Il nome della copia che PhotoCraft crea con «Modifica in PhotoCraft»:
/// `IMG_0001.CR3` → `IMG_0001-Edit.psd`. Le cartelle restano; un nome senza
/// estensione prende solo il suffisso.
pub fn edit_copy_of(photo: &str) -> String {
    let stem = split_extension(photo).map_or(photo, |(stem, _)| stem);
    format!("{stem}-Edit.psd")
}

/// Divide `nome.ext` in gambo ed estensione, guardando solo l'ultimo pezzo
/// del percorso. Non c'è estensione se il punto è il primo carattere del nome
/// (`.xmp` è un file nascosto) o l'ultimo (`foto.`).
fn split_extension(path: &str) -> Option<(&str, &str)> {
    let name_start = path.rfind('/').map_or(0, |i| i + 1);
    let dot = path[name_start..].rfind('.')? + name_start;
    if dot == name_start || dot + 1 == path.len() {
        return None;
    }
    Some((&path[..dot], &path[dot + 1..]))
}

/// I tag delle parole chiave, nell'ordine, senza doppioni, filtrati dalla
/// regola dei tag di `fub-abi`.
fn keyword_tags(keywords: &[String]) -> Vec<String> {
    let candidates: Vec<Value> = keywords
        .iter()
        .map(|k| Value::from(tag_name_of(k)))
        .collect();
    let mut probe = Map::new();
    probe.insert("tags".to_string(), Value::Array(candidates));
    let mut out: Vec<String> = Vec::new();
    for tag in frontmatter_tags(&Frontmatter(probe)) {
        if !out.contains(&tag) {
            out.push(tag);
        }
    }
    out
}

/// La parola chiave come nome di tag: senza i `#` iniziali, e ogni serie di
/// spazi (gli stessi spazi che la regola dei tag usa per separare) diventata
/// un `-`.
fn tag_name_of(keyword: &str) -> String {
    let bare = keyword.trim_start_matches('#').trim();
    let mut out = String::with_capacity(bare.len());
    let mut in_space = false;
    for c in bare.chars() {
        if c.is_whitespace() {
            if !in_space {
                out.push('-');
            }
            in_space = true;
        } else {
            out.push(c);
            in_space = false;
        }
    }
    out
}

/// I campi che si leggono come testo di un elemento.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Field {
    Rating,
    Label,
    Flag,
    Keyword,
}

/// Un elemento aperto il cui testo diventa un campo.
struct Capture {
    field: Field,
    depth: usize,
    text: String,
}

/// Ciò che si è letto finora: per voto, etichetta e scelta vale il primo
/// valore valido.
#[derive(Default)]
struct Accumulator {
    meta: PhotoMeta,
}

impl Accumulator {
    fn offer(&mut self, field: Field, raw: &str) {
        match field {
            Field::Rating => {
                if self.meta.rating.is_none() {
                    self.meta.rating = parse_rating(raw);
                }
            }
            Field::Label => {
                if self.meta.label.is_none() {
                    self.meta.label = parse_label(raw);
                }
            }
            Field::Flag => {
                if self.meta.flag.is_none() {
                    self.meta.flag = parse_flag(raw);
                }
            }
            Field::Keyword => {
                let keyword = raw.trim();
                if !keyword.is_empty()
                    && self.meta.keywords.len() < MAX_KEYWORDS
                    && !self.meta.keywords.iter().any(|k| k == keyword)
                {
                    self.meta.keywords.push(keyword.to_string());
                }
            }
        }
    }
}

/// Il voto: un numero intero da -1 a 5, anche scritto come reale (`"5.0"`,
/// perché `xmp:Rating` è un reale). Ogni altra cosa non è un voto.
fn parse_rating(raw: &str) -> Option<i8> {
    let value: f64 = raw.trim().parse().ok()?;
    if !value.is_finite() || value.fract() != 0.0 {
        return None;
    }
    if value < f64::from(MIN_RATING) || value > f64::from(MAX_RATING) {
        return None;
    }
    // Il valore è intero e nell'intervallo: la conversione è esatta.
    i8::try_from(value as i32).ok()
}

/// L'etichetta: non vuota e lunga al massimo [`MAX_LABEL_CHARS`] caratteri.
fn parse_label(raw: &str) -> Option<String> {
    let label = raw.trim();
    let chars = label.chars().count();
    (1..=MAX_LABEL_CHARS)
        .contains(&chars)
        .then(|| label.to_string())
}

/// La scelta: `pick` o `reject`; `none` e ogni altro valore non sono una
/// scelta.
fn parse_flag(raw: &str) -> Option<Flag> {
    match raw.trim() {
        "pick" => Some(Flag::Pick),
        "reject" => Some(Flag::Reject),
        _ => None,
    }
}

/// Che cosa un nome è, per questo lettore.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Description,
    Li,
    Subject,
    Rating,
    Label,
    Flag,
    /// `crs:*`: le regolazioni di sviluppo, mai lette.
    CameraRaw,
    /// `lc:settings`: le regolazioni di LightCraft, mai lette.
    LightCraftSettings,
    Other,
}

impl Kind {
    fn is_skipped(self) -> bool {
        matches!(self, Kind::CameraRaw | Kind::LightCraftSettings)
    }
}

/// I namespace che si riconoscono.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ns {
    Rdf,
    Xmp,
    Dc,
    Crs,
    Lc,
    Other,
}

/// Il namespace di un nome: dall'URI se è noto, altrimenti dal prefisso
/// convenzionale.
fn namespace_of(resolved: &ResolveResult<'_>, name: QName<'_>) -> Ns {
    if let ResolveResult::Bound(ns) = resolved {
        match ns.as_ref() {
            RDF_NS => return Ns::Rdf,
            XMP_NS => return Ns::Xmp,
            DC_NS => return Ns::Dc,
            CRS_NS => return Ns::Crs,
            _ => {}
        }
    }
    match name.prefix().map(|p| p.into_inner()) {
        Some(b"rdf") => Ns::Rdf,
        Some(b"xmp") => Ns::Xmp,
        Some(b"dc") => Ns::Dc,
        Some(b"crs") => Ns::Crs,
        Some(b"lc") => Ns::Lc,
        _ => Ns::Other,
    }
}

fn kind_of(ns: Ns, local: &[u8]) -> Kind {
    match (ns, local) {
        (Ns::Rdf, b"Description") => Kind::Description,
        (Ns::Rdf, b"li") => Kind::Li,
        (Ns::Dc, b"subject") => Kind::Subject,
        (Ns::Xmp, b"Rating") => Kind::Rating,
        (Ns::Xmp, b"Label") => Kind::Label,
        (Ns::Lc, b"flag") => Kind::Flag,
        (Ns::Lc, b"settings") => Kind::LightCraftSettings,
        (Ns::Crs, _) => Kind::CameraRaw,
        _ => Kind::Other,
    }
}

fn classify_element(reader: &NsReader<&[u8]>, start: &BytesStart<'_>) -> Kind {
    let name = start.name();
    let (resolved, local) = reader.resolver().resolve_element(name);
    kind_of(namespace_of(&resolved, name), local.into_inner())
}

/// Gli attributi di un `rdf:Description`: voto, etichetta e scelta. Il valore
/// si normalizza come vuole XML, con le sole entità predefinite; un'entità
/// sconosciuta si salta.
fn read_attributes(
    reader: &NsReader<&[u8]>,
    start: &BytesStart<'_>,
    acc: &mut Accumulator,
) -> Result<(), XmpError> {
    for attribute in start.attributes() {
        let attribute = attribute.map_err(|_| XmpError::NotXml)?;
        let (resolved, local) = reader.resolver().resolve_attribute(attribute.key);
        let field = match kind_of(namespace_of(&resolved, attribute.key), local.into_inner()) {
            Kind::Rating => Field::Rating,
            Kind::Label => Field::Label,
            Kind::Flag => Field::Flag,
            _ => continue,
        };
        let value: Cow<'_, str> = attribute
            .normalized_value_with(XmlVersion::Implicit1_0, 1, |name| {
                Some(resolve_predefined_entity(name).unwrap_or(""))
            })
            .map_err(|_| XmpError::NotXml)?;
        acc.offer(field, &value);
    }
    Ok(())
}
