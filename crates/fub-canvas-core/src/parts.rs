//! Gli estratti della lavagna: il campo `fub:parts` di una scheda di file,
//! letto e scritto come lo legge e lo scrive la shell.
//!
//! Un estratto è una finestra sul file vero, non una copia: una scheda `file`
//! col `subpath` sulla prima parte (`#page=3`, `#Varianza`), così Obsidian ne
//! mostra almeno quella, e tutte le parti scelte sotto la chiave
//! [`PARTS_KEY`]. Le regole sono quelle di `docs/reference/canvas-parts.md` e
//! dei vettori di `apps/client/src/__fixtures__/canvas-parts/`
//! (`tests/parts_vectors.rs`), che il lettore TypeScript
//! (`apps/client/src/editors/canvas/parts.ts`) fa girare uguali.
//!
//! - **La lettura** ([`read_parts`], [`node_parts`]) non tocca il file: il
//!   campo resta nei campi sconosciuti della scheda (`extra`). Un campo che
//!   Fub non capisce, o che il `subpath` smentisce, si conserva byte per byte
//!   ([`PartsState::Kept`], con la ragione) e la scheda mostra ciò che dice il
//!   `subpath`, come Obsidian.
//! - **La scrittura** ([`write_parts`]) dà il `subpath` della prima parte e il
//!   valore del campo, `None` quando il `subpath` dice già tutto (una pagina,
//!   una sezione, l'immagine intera e dritta). I numeri si scrivono come li
//!   scrive JavaScript: [`crate::js::encode`] del valore dà gli stessi byte di
//!   `JSON.stringify` nella shell.
//!
//! Il giro non perde niente: [`CanvasParts::to_value`] di un campo letto,
//! codificato come JavaScript, dà gli stessi byte del campo codificato allo
//! stesso modo, coi campi sconosciuti nel loro ordine.

use std::collections::HashSet;

use serde_json::{Map, Number, Value};
use thiserror::Error;

use crate::model::{Canvas, CanvasNode, CanvasNodeType, MAX_SAFE_INTEGER};

/// La chiave degli estratti, su una scheda `file`.
pub const PARTS_KEY: &str = "fub:parts";

/// Le pagine al più che Fub scrive in un estratto `pages`; ne legge di più.
pub const PARTS_MAX_WRITTEN_PAGES: usize = 1000;

/// Di quanto un `rect` può uscire da 0…1 per gli errori d'arrotondamento.
pub const RECT_TOLERANCE: f64 = 1e-6;

/// Come si mettono le pagine di un estratto `pages`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum PagesLayout {
    /// Una pagina alla volta.
    One,
    /// In fila, da sinistra a destra.
    Row,
    /// In colonna, dall'alto in basso.
    Column,
}

impl PagesLayout {
    /// Il nome nel file.
    pub fn as_str(self) -> &'static str {
        match self {
            PagesLayout::One => "one",
            PagesLayout::Row => "row",
            PagesLayout::Column => "column",
        }
    }

    fn parse(name: &str) -> Option<PagesLayout> {
        match name {
            "one" => Some(PagesLayout::One),
            "row" => Some(PagesLayout::Row),
            "column" => Some(PagesLayout::Column),
            _ => None,
        }
    }

    /// La regola di serie quando `layout` manca: una pagina sola, grande;
    /// fino a tre in fila; da quattro in su una alla volta.
    pub fn default_for(pages: usize) -> PagesLayout {
        match pages {
            2 | 3 => PagesLayout::Row,
            _ => PagesLayout::One,
        }
    }
}

/// Un rettangolo in frazioni della pagina o dell'immagine come si vede,
/// dall'angolo in alto a sinistra: `[x, y, larghezza, altezza]` nel file.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PartRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl PartRect {
    /// Tutta la pagina: `[0, 0, 1, 1]`.
    pub const WHOLE: PartRect = PartRect {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    };

    /// I lati sono positivi e il rettangolo sta in 0…1, a meno di
    /// [`RECT_TOLERANCE`].
    pub fn is_valid(&self) -> bool {
        let tolerance = RECT_TOLERANCE;
        self.width > 0.0
            && self.height > 0.0
            && self.x >= -tolerance
            && self.y >= -tolerance
            && self.x + self.width <= 1.0 + tolerance
            && self.y + self.height <= 1.0 + tolerance
    }

    fn from_value(value: &Value) -> Option<PartRect> {
        let Value::Array(items) = value else {
            return None;
        };
        let [x, y, width, height] = items.as_slice() else {
            return None;
        };
        let rect = PartRect {
            x: x.as_f64()?,
            y: y.as_f64()?,
            width: width.as_f64()?,
            height: height.as_f64()?,
        };
        rect.is_valid().then_some(rect)
    }

    fn to_value(self) -> Value {
        Value::Array(
            [self.x, self.y, self.width, self.height]
                .into_iter()
                .map(number)
                .collect(),
        )
    }
}

/// Le quattro specie della versione 1, coi loro campi noti.
#[derive(Clone, Debug, PartialEq)]
pub enum PartsKind {
    /// Pagine di un PDF, da 1, nell'ordine di scelta e senza doppioni.
    /// `layout` è `None` quando il file non lo dice: allora vale
    /// [`PagesLayout::default_for`].
    Pages {
        pages: Vec<u64>,
        layout: Option<PagesLayout>,
    },
    /// Un rettangolo di una pagina di un PDF. `key` è l'impronta della
    /// pagina, facoltativa.
    Region {
        page: u64,
        rect: PartRect,
        key: Option<String>,
    },
    /// Sezioni di una nota, ognuna come Obsidian la scrive dopo il `#`
    /// (`Capitolo#Varianza` compreso).
    Sections { sections: Vec<String> },
    /// Un ritaglio di un'immagine, girato di `rotate` gradi in senso orario
    /// (`None`: 0).
    Image { rect: PartRect, rotate: Option<f64> },
}

impl PartsKind {
    /// Il nome della specie nel file.
    pub fn name(&self) -> &'static str {
        match self {
            PartsKind::Pages { .. } => "pages",
            PartsKind::Region { .. } => "region",
            PartsKind::Sections { .. } => "sections",
            PartsKind::Image { .. } => "image",
        }
    }

    /// I campi noti della specie, nell'ordine in cui si scrivono dopo `kind`.
    fn fields(&self) -> &'static [&'static str] {
        match self {
            PartsKind::Pages { .. } => &["pages", "layout"],
            PartsKind::Region { .. } => &["page", "rect", "key"],
            PartsKind::Sections { .. } => &["sections"],
            PartsKind::Image { .. } => &["rect", "rotate"],
        }
    }
}

/// Un campo `fub:parts` valido: la specie coi suoi campi e i campi
/// sconosciuti, nel loro ordine.
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasParts {
    pub kind: PartsKind,
    pub extra: Map<String, Value>,
}

impl CanvasParts {
    /// Un estratto senza campi sconosciuti.
    pub fn new(kind: PartsKind) -> Self {
        CanvasParts {
            kind,
            extra: Map::new(),
        }
    }

    /// Legge il valore della chiave [`PARTS_KEY`]; l'errore dice perché si
    /// conserva senza mostrarlo. Non guarda il file né il `subpath`: lo fa
    /// [`node_parts`].
    pub fn from_value(value: &Value) -> Result<CanvasParts, PartsKept> {
        let Value::Object(fields) = value else {
            return Err(PartsKept::Object);
        };
        let kind = match fields.get("kind") {
            Some(Value::String(kind)) => kind.as_str(),
            _ => return Err(PartsKept::Kind),
        };
        let kind = match kind {
            "pages" => read_pages(fields)?,
            "region" => read_region(fields)?,
            "sections" => read_sections(fields)?,
            "image" => read_image(fields)?,
            _ => return Err(PartsKept::Kind),
        };
        let known = kind.fields();
        let extra = fields
            .iter()
            .filter(|(key, _)| key.as_str() != "kind" && !known.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        Ok(CanvasParts { kind, extra })
    }

    /// Il campo come valore JSON: `kind`, i campi noti nell'ordine della
    /// specie (gli assenti non ci sono), poi i campi sconosciuti nel loro
    /// ordine. Un numero intero si scrive intero, come in JavaScript.
    pub fn to_value(&self) -> Value {
        let mut map = Map::with_capacity(4 + self.extra.len());
        map.insert(
            "kind".to_owned(),
            Value::String(self.kind.name().to_owned()),
        );
        match &self.kind {
            PartsKind::Pages { pages, layout } => {
                map.insert(
                    "pages".to_owned(),
                    Value::Array(pages.iter().map(|&page| Value::from(page)).collect()),
                );
                if let Some(layout) = layout {
                    map.insert("layout".to_owned(), Value::from(layout.as_str()));
                }
            }
            PartsKind::Region { page, rect, key } => {
                map.insert("page".to_owned(), Value::from(*page));
                map.insert("rect".to_owned(), rect.to_value());
                if let Some(key) = key {
                    map.insert("key".to_owned(), Value::from(key.as_str()));
                }
            }
            PartsKind::Sections { sections } => {
                map.insert(
                    "sections".to_owned(),
                    Value::Array(sections.iter().map(|s| Value::from(s.as_str())).collect()),
                );
            }
            PartsKind::Image { rect, rotate } => {
                map.insert("rect".to_owned(), rect.to_value());
                if let Some(rotate) = rotate {
                    map.insert("rotate".to_owned(), number(*rotate));
                }
            }
        }
        let known = self.kind.fields();
        for (key, value) in &self.extra {
            if key != "kind" && !known.contains(&key.as_str()) {
                map.insert(key.clone(), value.clone());
            }
        }
        Value::Object(map)
    }

    /// Il `subpath` che la prima parte dà: `#page=3` per `pages`, `#page=7`
    /// per `region`, `#Varianza` per `sections`, nessuno per `image`.
    pub fn subpath(&self) -> Option<String> {
        match &self.kind {
            PartsKind::Pages { pages, .. } => pages.first().map(|page| format!("#page={page}")),
            PartsKind::Region { page, .. } => Some(format!("#page={page}")),
            PartsKind::Sections { sections } => sections.first().map(|s| format!("#{s}")),
            PartsKind::Image { .. } => None,
        }
    }

    /// La specie va bene per il file: `pages` e `region` su un PDF,
    /// `sections` su una nota, `image` su un'immagine.
    pub fn fits(&self, file: &str) -> bool {
        let wanted = match self.kind {
            PartsKind::Pages { .. } | PartsKind::Region { .. } => PartsFile::Pdf,
            PartsKind::Sections { .. } => PartsFile::Note,
            PartsKind::Image { .. } => PartsFile::Image,
        };
        PartsFile::of(file) == Some(wanted)
    }

    /// Come si mettono le pagine di un estratto `pages`: `layout` se c'è,
    /// sennò la regola di serie; `None` per le altre specie.
    pub fn layout(&self) -> Option<PagesLayout> {
        match &self.kind {
            PartsKind::Pages { pages, layout } => {
                Some(layout.unwrap_or_else(|| PagesLayout::default_for(pages.len())))
            }
            _ => None,
        }
    }

    /// Il campo dice soltanto ciò che il `subpath` dice già: una pagina, una
    /// sezione, l'immagine intera e dritta, senza campi sconosciuti.
    fn is_redundant(&self) -> bool {
        if !self.extra.is_empty() {
            return false;
        }
        match &self.kind {
            PartsKind::Pages { pages, .. } => pages.len() == 1,
            PartsKind::Sections { sections } => sections.len() == 1,
            PartsKind::Image { rect, rotate } => {
                *rect == PartRect::WHOLE && rotate.is_none_or(|r| r == 0.0)
            }
            PartsKind::Region { .. } => false,
        }
    }
}

/// Le specie di file che un estratto conosce, dall'estensione.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum PartsFile {
    Pdf,
    Note,
    Image,
}

impl PartsFile {
    /// Dall'estensione dell'ultimo segmento del percorso, in minuscolo, senza
    /// `#…`: le stesse di `cardKindOf` nella shell (`note`, `pdf`, `image`).
    fn of(file: &str) -> Option<PartsFile> {
        let path = file.split('#').next().unwrap_or(file);
        let base = path.rsplit('/').next().unwrap_or(path);
        let point = base.rfind('.')?;
        if point == 0 || point == base.len() - 1 {
            return None;
        }
        match base[point + 1..].to_ascii_lowercase().as_str() {
            "pdf" => Some(PartsFile::Pdf),
            "md" | "markdown" => Some(PartsFile::Note),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" | "heic"
            | "tif" | "tiff" => Some(PartsFile::Image),
            _ => None,
        }
    }
}

/// Perché un campo `fub:parts` si conserva senza mostrarlo; la scheda mostra
/// ciò che dice il suo `subpath`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Error)]
pub enum PartsKept {
    /// La scheda non è di tipo `file`: il campo si conserva e si ignora.
    #[error("the parts are not on a file card")]
    Node,
    /// `fub:parts` non è un oggetto.
    #[error("the parts are not an object")]
    Object,
    /// `kind` manca, non è una stringa o è una specie sconosciuta.
    #[error("the parts have no known kind")]
    Kind,
    /// La specie non va bene per il file della scheda.
    #[error("the parts kind does not fit the file")]
    File,
    /// Un campo noto della specie non vale.
    #[error("a parts field is not valid")]
    Field,
    /// Il `subpath` della scheda non è quello che la prima parte darebbe.
    #[error("the subpath is not the one of the first part")]
    Subpath,
}

impl PartsKept {
    /// Il nome della ragione, come nei vettori e nel TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            PartsKept::Node => "node",
            PartsKept::Object => "object",
            PartsKept::Kind => "kind",
            PartsKept::File => "file",
            PartsKept::Field => "field",
            PartsKept::Subpath => "subpath",
        }
    }
}

/// Lo stato del campo di una scheda.
#[derive(Clone, Debug, PartialEq)]
pub enum PartsState {
    /// Valido: la scheda mostra queste parti.
    Ok(CanvasParts),
    /// Si conserva così com'è e la scheda mostra il suo `subpath`.
    Kept(PartsKept),
}

/// Il campo di una scheda, letto.
#[derive(Clone, Debug, PartialEq)]
pub struct PartsRead {
    /// L'id della scheda.
    pub node: String,
    pub state: PartsState,
}

/// Il campo `fub:parts` della scheda, letto; `None` se la scheda non l'ha.
pub fn node_parts(node: &CanvasNode) -> Option<PartsState> {
    let value = node.extra.get(PARTS_KEY)?;
    Some(match check(node, value) {
        Ok(parts) => PartsState::Ok(parts),
        Err(reason) => PartsState::Kept(reason),
    })
}

/// I campi `fub:parts` di `canvas`, nell'ordine di `nodes`; una scheda senza
/// la chiave non compare.
pub fn read_parts(canvas: &Canvas) -> Vec<PartsRead> {
    canvas
        .nodes
        .iter()
        .filter_map(|node| {
            node_parts(node).map(|state| PartsRead {
                node: node.id.clone(),
                state,
            })
        })
        .collect()
}

/// Le regole nell'ordine dei vettori: il tipo della scheda, la forma, il file,
/// il `subpath`.
fn check(node: &CanvasNode, value: &Value) -> Result<CanvasParts, PartsKept> {
    if node.node_type != CanvasNodeType::File {
        return Err(PartsKept::Node);
    }
    let parts = CanvasParts::from_value(value)?;
    if !parts.fits(node.file.as_deref().unwrap_or("")) {
        return Err(PartsKept::File);
    }
    if node.subpath.as_deref() != parts.subpath().as_deref() {
        return Err(PartsKept::Subpath);
    }
    Ok(parts)
}

/// Che cosa scrivere su una scheda per mostrare un estratto.
#[derive(Clone, Debug, PartialEq)]
pub struct PartsWrite {
    /// Il `subpath` della prima parte; `None`: la scheda non ne ha.
    pub subpath: Option<String>,
    /// Il valore di `fub:parts`; `None`: la chiave non c'è.
    pub parts: Option<Value>,
}

/// Perché Fub non scrive un estratto.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Error)]
pub enum PartsRefused {
    /// La specie non va bene per il file.
    #[error("the parts kind does not fit the file")]
    File,
    /// Un campo non vale come non varrebbe alla lettura.
    #[error("a parts field is not valid")]
    Field,
    /// Più di [`PARTS_MAX_WRITTEN_PAGES`] pagine.
    #[error("too many pages")]
    Pages,
    /// Una rotazione che non è un multiplo di 90 gradi.
    #[error("the rotation is not a multiple of 90 degrees")]
    Rotate,
}

impl PartsRefused {
    /// Il nome della ragione, come nei vettori e nel TypeScript.
    pub fn as_str(self) -> &'static str {
        match self {
            PartsRefused::File => "file",
            PartsRefused::Field => "field",
            PartsRefused::Pages => "pages",
            PartsRefused::Rotate => "rotate",
        }
    }
}

/// Il `subpath` e il campo che Fub scrive per mostrare `parts` del file
/// `file`.
///
/// Le regole della lettura valgono anche qui, più due: al più
/// [`PARTS_MAX_WRITTEN_PAGES`] pagine, e una rotazione multipla di 90 gradi,
/// riportata fra 0 e 270 (0 non si scrive). Un estratto che il `subpath` dice
/// già tutto non scrive il campo.
pub fn write_parts(file: &str, parts: &CanvasParts) -> Result<PartsWrite, PartsRefused> {
    let mut parts = parts.clone();
    // Lo stesso controllo della lettura, sul valore che si scriverebbe.
    let checked = CanvasParts::from_value(&parts.to_value()).map_err(|_| PartsRefused::Field)?;
    if checked != parts {
        return Err(PartsRefused::Field);
    }
    if !parts.fits(file) {
        return Err(PartsRefused::File);
    }
    match &mut parts.kind {
        PartsKind::Pages { pages, .. } if pages.len() > PARTS_MAX_WRITTEN_PAGES => {
            return Err(PartsRefused::Pages);
        }
        PartsKind::Image { rotate, .. } => {
            if let Some(degrees) = *rotate {
                if degrees % 90.0 != 0.0 {
                    return Err(PartsRefused::Rotate);
                }
                let turned = ((degrees % 360.0) + 360.0) % 360.0;
                *rotate = (turned != 0.0).then_some(turned);
            }
        }
        _ => {}
    }
    let subpath = parts.subpath();
    let parts = (!parts.is_redundant()).then(|| parts.to_value());
    Ok(PartsWrite { subpath, parts })
}

fn read_pages(fields: &Map<String, Value>) -> Result<PartsKind, PartsKept> {
    let Some(Value::Array(items)) = fields.get("pages") else {
        return Err(PartsKept::Field);
    };
    if items.is_empty() {
        return Err(PartsKept::Field);
    }
    let mut seen = HashSet::with_capacity(items.len());
    let mut pages = Vec::with_capacity(items.len());
    for item in items {
        let page = page_number(item).ok_or(PartsKept::Field)?;
        if !seen.insert(page) {
            return Err(PartsKept::Field);
        }
        pages.push(page);
    }
    let layout = match fields.get("layout") {
        None => None,
        Some(Value::String(name)) => Some(PagesLayout::parse(name).ok_or(PartsKept::Field)?),
        Some(_) => return Err(PartsKept::Field),
    };
    Ok(PartsKind::Pages { pages, layout })
}

fn read_region(fields: &Map<String, Value>) -> Result<PartsKind, PartsKept> {
    let page = fields
        .get("page")
        .and_then(page_number)
        .ok_or(PartsKept::Field)?;
    let rect = fields
        .get("rect")
        .and_then(PartRect::from_value)
        .ok_or(PartsKept::Field)?;
    let key = match fields.get("key") {
        None => None,
        Some(Value::String(key)) => Some(key.clone()),
        Some(_) => return Err(PartsKept::Field),
    };
    Ok(PartsKind::Region { page, rect, key })
}

fn read_sections(fields: &Map<String, Value>) -> Result<PartsKind, PartsKept> {
    let Some(Value::Array(items)) = fields.get("sections") else {
        return Err(PartsKept::Field);
    };
    if items.is_empty() {
        return Err(PartsKept::Field);
    }
    let mut seen = HashSet::with_capacity(items.len());
    let mut sections = Vec::with_capacity(items.len());
    for item in items {
        let Value::String(section) = item else {
            return Err(PartsKept::Field);
        };
        if section.is_empty() || !seen.insert(section.as_str()) {
            return Err(PartsKept::Field);
        }
        sections.push(section.clone());
    }
    Ok(PartsKind::Sections { sections })
}

fn read_image(fields: &Map<String, Value>) -> Result<PartsKind, PartsKept> {
    let rect = fields
        .get("rect")
        .and_then(PartRect::from_value)
        .ok_or(PartsKept::Field)?;
    let rotate = match fields.get("rotate") {
        None => None,
        Some(Value::Number(degrees)) => Some(degrees.as_f64().ok_or(PartsKept::Field)?),
        Some(_) => return Err(PartsKept::Field),
    };
    Ok(PartsKind::Image { rect, rotate })
}

/// Un numero di pagina: un intero da 1 a 2^53−1, comunque scritto (`3.0`
/// vale 3, come in JavaScript).
fn page_number(value: &Value) -> Option<u64> {
    let page = value.as_f64()?;
    let in_range = page >= 1.0 && page <= MAX_SAFE_INTEGER as f64;
    (in_range && page.fract() == 0.0).then_some(page as u64)
}

/// Un numero come lo scrive JavaScript: un intero sicuro senza decimali,
/// il resto come decimale (`-0` è 0).
fn number(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() <= MAX_SAFE_INTEGER as f64 {
        return Value::from(x as i64);
    }
    Number::from_f64(x).map_or(Value::Null, Value::Number)
}
