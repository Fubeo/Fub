//! I caratteri con cui l'export disegna il testo: quelli di Fub a ogni peso,
//! e quelli del vault.
//!
//! `usvg` chiede un carattere per ogni pezzo di testo, con la sua lista di
//! famiglie, il peso, lo stile e la larghezza ([`Typefaces::resolver`]). La
//! lista si legge come la legge la superficie dell'editor, una famiglia dopo
//! l'altra:
//!
//! - una famiglia di Fub (Inter, Literata, JetBrains Mono) è il suo file
//!   variabile fissato al peso chiesto: 600 esce 600, come sulla superficie, e
//!   non come il 700 più vicino. Al 400 e al 700 sono le istanze statiche di
//!   sempre ([`super::FACES`]);
//! - una famiglia generica è la famiglia di Fub che la rappresenta: `serif` e
//!   `cursive` Literata, `sans-serif` e `fantasy` Inter, `monospace` JetBrains
//!   Mono;
//! - ogni altra famiglia si cerca fra i caratteri del vault, i file `.ttf`,
//!   `.otf`, `.woff` e `.woff2`, con la scelta della faccia dei CSS
//!   ([`fonts::choose`]), e la faccia scelta si fissa nel punto chiesto
//!   ([`fonts::instance`]);
//! - una famiglia che non c'è passa la mano alla seguente, e il log lo dice;
//!   in fondo c'è sempre Literata, come il carattere di serie di un testo.
//!
//! Un carattere che la faccia scelta non ha si cerca nelle famiglie che
//! seguono nella stessa lista, poi nei caratteri di Fub: come sulla
//! superficie, che però alla fine lo chiederebbe al sistema.
//!
//! Le facce dei file del vault si leggono alla prima famiglia che Fub non ha,
//! una volta per export ([`VaultFonts`]); quando una faccia serve davvero, i
//! byte letti la confermano. Un disegno
//! porta al più 64 MiB di caratteri fissati, di Fub e del vault: una faccia che
//! non ci sta passa la mano come una che non c'è. Un carattere la cui licenza
//! non lascia incorporarlo (`fsType`) disegna il suo testo a tracciati nel
//! PDF, dove un carattere si incorpora ([`restricted`]).

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use fub_abi::model::DocId;
use fub_abi::rules::media::mime_of;
use fub_abi::traits::{EntryKind, IndexQuery, IndexResult, ReadApi, VaultEntry};
use resvg::usvg::{self, fontdb, FontFamily, FontResolver, FontStretch, FontStyle, Node, Tree};
use skrifa::raw::FontRef;
use skrifa::MetadataProvider;

use super::fonts::{self, Coordinate, Face, FontError, Request, Style};
use super::{fub_fonts, listed, MONO, SANS, SERIF};

/// Quanti MiB di caratteri fissati porta al più un disegno.
pub(super) const TYPEFACES_MIB: usize = 64;
const TYPEFACES_MAX: usize = TYPEFACES_MIB * 1024 * 1024;

/// I tipi dei file che l'export legge come caratteri del vault.
const FONT_TYPES: [&str; 4] = ["font/ttf", "font/otf", "font/woff", "font/woff2"];

/// I file variabili dei caratteri di Fub, gli stessi che l'app distribuisce
/// (`apps/client/public/fonts`, `@fontsource-variable` 5.3.0): da questi si
/// fissano i pesi che non sono 400 né 700.
const FUB_FILES: [&[u8]; 6] = [
    include_bytes!("../../fonts/inter-latin-wght-normal.woff2"),
    include_bytes!("../../fonts/inter-latin-wght-italic.woff2"),
    include_bytes!("../../fonts/literata-latin-wght-normal.woff2"),
    include_bytes!("../../fonts/literata-latin-wght-italic.woff2"),
    include_bytes!("../../fonts/jetbrains-mono-latin-wght-normal.woff2"),
    include_bytes!("../../fonts/jetbrains-mono-latin-wght-italic.woff2"),
];

/// Un file di Fub decodificato, con le sue facce.
struct FubFile {
    sfnt: Vec<u8>,
    faces: Vec<Face>,
}

fn fub_files() -> &'static [FubFile] {
    static FILES: OnceLock<Vec<FubFile>> = OnceLock::new();
    FILES.get_or_init(|| {
        FUB_FILES
            .iter()
            .filter_map(|bytes| {
                let sfnt = fonts::decode(bytes).ok()?.into_owned();
                let faces = fonts::describe(&sfnt).ok()?;
                Some(FubFile { sfnt, faces })
            })
            .collect()
    })
}

/// Le dodici facce statiche di Fub nel database di serie, per famiglia, stile
/// e peso. Il database di un albero ne è una copia, con gli stessi `ID`.
fn statics() -> &'static BTreeMap<(String, bool, u16), fontdb::ID> {
    static STATICS: OnceLock<BTreeMap<(String, bool, u16), fontdb::ID>> = OnceLock::new();
    STATICS.get_or_init(|| {
        fub_fonts()
            .faces()
            .filter_map(|face| {
                let family = face.families.first()?.0.clone();
                let italic = face.style != fontdb::Style::Normal;
                Some(((family, italic, face.weight.0), face.id))
            })
            .collect()
    })
}

/// Da dove viene una faccia fissata.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Source {
    /// Uno dei file variabili di Fub ([`FUB_FILES`]).
    Fub(usize),
    /// Un file del vault.
    Vault(DocId),
}

/// Una faccia fissata: da dove, quale faccia del file, e i punti degli assi
/// in 16.16, che si confrontano esatti.
type Key = (Source, u32, Vec<(String, i64)>);

fn key_of(source: Source, index: u32, coordinates: &[Coordinate]) -> Key {
    let points = coordinates
        .iter()
        .map(|each| (each.tag.clone(), (each.value * 65536.0).round() as i64))
        .collect();
    (source, index, points)
}

/// I caratteri del vault per un export: le facce di ogni file, lette alla
/// prima famiglia che Fub non ha e tenute per tutti i disegni dell'export.
/// Non durano di più: un file cambiato dopo si rilegge all'export dopo.
#[derive(Default)]
pub(super) struct VaultFonts {
    catalog: Mutex<Option<Catalog>>,
}

/// I file di caratteri del vault, in ordine di percorso, con le loro facce, e
/// quelli che non si leggono come caratteri.
#[derive(Clone, Default)]
struct Catalog {
    files: Vec<(DocId, Arc<Vec<Face>>)>,
    unreadable: BTreeSet<String>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Nessuno va in panico tenendo il lucchetto; se succedesse, ciò che c'è
    // resterebbe valido.
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// I caratteri di un disegno che si esporta. `vault` è chi legge il vault,
/// coi caratteri che l'export ne ha già letto; senza, come per le annotazioni
/// di un PDF, ci sono soltanto quelli di Fub.
pub(super) struct Typefaces<'h> {
    vault: Option<(&'h dyn ReadApi, &'h VaultFonts)>,
    /// I byte di caratteri fissati che il disegno porta al più.
    limit: usize,
    state: Mutex<State>,
}

/// Ciò che i caratteri di un disegno hanno già fatto, da una pagina all'altra.
#[derive(Default)]
struct State {
    /// I file di caratteri del vault, in ordine di percorso, con le loro
    /// facce: `None` finché nessuno ha chiesto una famiglia che Fub non ha.
    files: Option<Vec<(DocId, Arc<Vec<Face>>)>>,
    /// Le facce fissate, coi loro byte; `None` per una che non si è fissata.
    fixed: BTreeMap<Key, Option<Arc<Vec<u8>>>>,
    /// I byte fissati finora, entro [`Typefaces::limit`].
    bytes: usize,
    /// Le famiglie che non ci sono, né di Fub né nel vault.
    missing: BTreeSet<String>,
    /// I file di caratteri del vault che non si sono letti.
    unreadable: BTreeSet<String>,
    /// Vero se una faccia scelta non si è potuta fissare: allora i file
    /// illeggibili contano anche senza famiglie che mancano.
    failed: bool,
    /// Le facce che non ci stavano più nel tetto, per nome.
    over: BTreeSet<String>,
    /// Le famiglie che nel PDF sono uscite a tracciati.
    outlined: BTreeSet<String>,
}

/// Ciò che un albero ha caricato nel suo database.
#[derive(Default)]
struct Loaded {
    ids: BTreeMap<Key, fontdb::ID>,
    /// Per ogni carattere scelto, le famiglie che restano della sua lista e la
    /// faccia chiesta: dove cercare i caratteri che non ha.
    rest: BTreeMap<fontdb::ID, (Vec<FontFamily>, Request)>,
}

/// Com'è andata la ricerca di una famiglia fra i caratteri del vault.
enum Lookup {
    Found(fontdb::ID),
    /// Il vault non ha la famiglia.
    Absent,
    /// La famiglia c'è, ma la sua faccia non si è caricata: il motivo è già
    /// annotato.
    Failed,
    /// Le facce lette prima non erano più quelle del file: si sceglie di nuovo.
    Stale,
}

/// Com'è andato il caricamento di una faccia fissata.
enum Fixed {
    Id(fontdb::ID),
    Over,
    Failed,
}

impl<'h> Typefaces<'h> {
    pub(super) fn new(vault: Option<(&'h dyn ReadApi, &'h VaultFonts)>) -> Self {
        Typefaces {
            vault,
            limit: TYPEFACES_MAX,
            state: Mutex::new(State::default()),
        }
    }

    /// Il risolutore dei caratteri di un albero.
    pub(super) fn resolver<'a>(&'a self) -> FontResolver<'a> {
        let loaded = Arc::new(Mutex::new(Loaded::default()));
        let fallback = Arc::clone(&loaded);
        FontResolver {
            select_font: Box::new(move |font, db| self.select(font, db, &mut lock(&loaded))),
            select_fallback: Box::new(move |c, used, db| {
                self.fallback(c, used, db, &mut lock(&fallback))
            }),
        }
    }

    /// Annota che le famiglie `families` sono uscite a tracciati nel PDF.
    pub(super) fn outlined(&self, families: BTreeSet<String>) {
        lock(&self.state).outlined.extend(families);
    }

    /// Le note del log: le famiglie che mancano, i file che non si leggono,
    /// le facce oltre il tetto e il testo a tracciati.
    pub(super) fn notes(&self) -> Vec<String> {
        let state = lock(&self.state);
        let unreadable = if state.failed || !state.missing.is_empty() {
            &state.unreadable
        } else {
            &BTreeSet::new()
        };
        [
            if self.vault.is_some() {
                listed(
                    &state.missing,
                    "font family is not in Fub or in the vault and was replaced",
                    "font families are not in Fub or in the vault and were replaced",
                )
            } else {
                listed(
                    &state.missing,
                    "font family is not in Fub and was replaced",
                    "font families are not in Fub and were replaced",
                )
            },
            listed(
                unreadable,
                "vault font file could not be read",
                "vault font files could not be read",
            ),
            listed(
                &state.over,
                &format!(
                    "font did not fit in the {TYPEFACES_MIB} MiB of fonts of a drawing and was replaced"
                ),
                &format!(
                    "fonts did not fit in the {TYPEFACES_MIB} MiB of fonts of a drawing and were replaced"
                ),
            ),
            listed(
                &state.outlined,
                "font does not allow embedding, so the PDF pages that use it have their text drawn as outlines",
                "fonts do not allow embedding, so the PDF pages that use them have their text drawn as outlines",
            ),
        ]
        .into_iter()
        .flatten()
        .collect()
    }

    fn select(
        &self,
        font: &usvg::Font,
        db: &mut Arc<fontdb::Database>,
        loaded: &mut Loaded,
    ) -> Option<fontdb::ID> {
        let request = request_of(font);
        let families = font.families();
        for (at, family) in families.iter().enumerate() {
            if let Some(id) = self.face(family, &request, db, loaded, true) {
                let rest = &families[at + 1..];
                let (known, _) = loaded
                    .rest
                    .entry(id)
                    .or_insert_with(|| (Vec::new(), request));
                for family in rest {
                    if !known.contains(family) {
                        known.push(family.clone());
                    }
                }
                return Some(id);
            }
        }
        let id = self.fub(SERIF, &request, db, loaded)?;
        loaded
            .rest
            .entry(id)
            .or_insert_with(|| (Vec::new(), request));
        Some(id)
    }

    fn fallback(
        &self,
        c: char,
        used: &[fontdb::ID],
        db: &mut Arc<fontdb::Database>,
        loaded: &mut Loaded,
    ) -> Option<fontdb::ID> {
        let (rest, request) = used
            .first()
            .and_then(|base| loaded.rest.get(base).cloned())
            .unwrap_or((Vec::new(), Request::REGULAR));
        let fub = [SERIF, SANS, MONO].map(|family| FontFamily::Named(family.to_string()));
        for family in rest.iter().chain(&fub) {
            let Some(id) = self.face(family, &request, db, loaded, false) else {
                continue;
            };
            if !used.contains(&id) && has_char(db, id, c) {
                return Some(id);
            }
        }
        None
    }

    /// La faccia di `family` per `request`; `report` annota la famiglia che
    /// non c'è.
    fn face(
        &self,
        family: &FontFamily,
        request: &Request,
        db: &mut Arc<fontdb::Database>,
        loaded: &mut Loaded,
        report: bool,
    ) -> Option<fontdb::ID> {
        let name = match family {
            FontFamily::Serif | FontFamily::Cursive => return self.fub(SERIF, request, db, loaded),
            FontFamily::SansSerif | FontFamily::Fantasy => {
                return self.fub(SANS, request, db, loaded)
            }
            FontFamily::Monospace => return self.fub(MONO, request, db, loaded),
            FontFamily::Named(name) => name.trim(),
        };
        if let Some(fub) = fonts::reserved(name) {
            return self.fub(fub, request, db, loaded);
        }
        // Le facce lette prima possono non essere più quelle del file: allora
        // si sceglie di nuovo, una volta.
        for _ in 0..2 {
            match self.in_vault(name, request, db, loaded) {
                Lookup::Found(id) => return Some(id),
                Lookup::Absent => {
                    if report {
                        lock(&self.state).missing.insert(name.to_string());
                    }
                    return None;
                }
                Lookup::Failed => return None,
                Lookup::Stale => continue,
            }
        }
        None
    }

    /// Una faccia di Fub: la statica al 400 e al 700, se no il file variabile
    /// fissato al peso chiesto. Oltre il tetto, la statica più vicina.
    fn fub(
        &self,
        family: &str,
        request: &Request,
        db: &mut Arc<fontdb::Database>,
        loaded: &mut Loaded,
    ) -> Option<fontdb::ID> {
        let nearest = |db: &fontdb::Database| {
            db.query(&fontdb::Query {
                families: &[fontdb::Family::Name(family)],
                weight: fontdb::Weight(request.weight.round().clamp(1.0, 1000.0) as u16),
                stretch: fontdb::Stretch::Normal,
                style: match request.style {
                    Style::Normal => fontdb::Style::Normal,
                    Style::Italic => fontdb::Style::Italic,
                    Style::Oblique => fontdb::Style::Oblique,
                },
            })
        };
        let files = fub_files();
        let all: Vec<&[Face]> = files.iter().map(|file| file.faces.as_slice()).collect();
        let Some(choice) = fonts::choose_reserved(&all, family, request) else {
            return nearest(db);
        };
        let file = &files[choice.file];
        let face = &file.faces[choice.face];
        let italic = face.styles.iter().all(|slot| slot.style != Style::Normal);
        let weight = choice
            .coordinates
            .iter()
            .find(|each| each.tag == "wght")
            .map(|each| each.value);
        if let Some(weight @ (400.0 | 700.0)) = weight {
            let found = statics().get(&(family.to_string(), italic, weight as u16));
            if let Some(id) = found {
                return Some(*id);
            }
        }
        let read = || Ok(Cow::Borrowed(file.sfnt.as_slice()));
        let source = Source::Fub(choice.file);
        match self.fix(source, face.index, &choice.coordinates, read, db, loaded) {
            Fixed::Id(id) => Some(id),
            Fixed::Over => {
                let name = named(family, face, &choice.coordinates);
                lock(&self.state).over.insert(name);
                nearest(db)
            }
            Fixed::Failed => nearest(db),
        }
    }

    fn in_vault(
        &self,
        name: &str,
        request: &Request,
        db: &mut Arc<fontdb::Database>,
        loaded: &mut Loaded,
    ) -> Lookup {
        let Some((host, shared)) = self.vault else {
            return Lookup::Absent;
        };
        let catalog = self.catalog(host, shared);
        let all: Vec<&[Face]> = catalog.iter().map(|(_, faces)| faces.as_slice()).collect();
        let Some(choice) = fonts::choose(&all, name, request) else {
            return Lookup::Absent;
        };
        let (doc, faces) = &catalog[choice.file];
        let face = &faces[choice.face];
        let mut stale = false;
        let read = || {
            let bytes = host
                .read_document_bytes(doc)
                .map_err(|error| FontError::Damaged(error.to_string()))?;
            if bytes.len() > fonts::MAX_FONT_BYTES {
                return Err(FontError::TooLarge);
            }
            let sfnt = fonts::decode(&bytes)?.into_owned();
            // I byte confermano le facce lette prima, o le correggono.
            let fresh = fonts::describe(&sfnt)?;
            if fresh != **faces {
                self.refresh(shared, doc, fresh);
                stale = true;
                return Err(FontError::Damaged("changed".into()));
            }
            Ok(Cow::Owned(sfnt))
        };
        let fixed = self.fix(
            Source::Vault(doc.clone()),
            face.index,
            &choice.coordinates,
            read,
            db,
            loaded,
        );
        let mut state = lock(&self.state);
        match fixed {
            Fixed::Id(id) => Lookup::Found(id),
            Fixed::Over => {
                state
                    .over
                    .insert(named(&face.family, face, &choice.coordinates));
                Lookup::Failed
            }
            Fixed::Failed if stale => {
                // La faccia letta prima non resta fra quelle che non si fissano.
                let key = key_of(Source::Vault(doc.clone()), face.index, &choice.coordinates);
                state.fixed.remove(&key);
                Lookup::Stale
            }
            Fixed::Failed => {
                state.unreadable.insert(doc.to_string());
                state.failed = true;
                Lookup::Failed
            }
        }
    }

    /// Le facce nuove di `doc`, per il disegno e per l'export.
    fn refresh(&self, shared: &VaultFonts, doc: &DocId, faces: Vec<Face>) {
        let faces = Arc::new(faces);
        let update = |files: &mut Vec<(DocId, Arc<Vec<Face>>)>| {
            for (each, known) in files.iter_mut() {
                if each == doc {
                    *known = Arc::clone(&faces);
                }
            }
        };
        if let Some(files) = lock(&self.state).files.as_mut() {
            update(files);
        }
        if let Some(catalog) = lock(&shared.catalog).as_mut() {
            update(&mut catalog.files);
        }
    }

    /// I file di caratteri del vault con le loro facce: quelli che l'export
    /// ha letto, o letti adesso.
    fn catalog(&self, host: &dyn ReadApi, shared: &VaultFonts) -> Vec<(DocId, Arc<Vec<Face>>)> {
        if let Some(files) = &lock(&self.state).files {
            return files.clone();
        }
        let catalog = lock(&shared.catalog)
            .get_or_insert_with(|| read_catalog(host))
            .clone();
        let mut state = lock(&self.state);
        state.unreadable.extend(catalog.unreadable);
        state.files = Some(catalog.files.clone());
        catalog.files
    }

    /// I byte della faccia `index` di `source` fissata in `coordinates`,
    /// caricati nel database dell'albero.
    fn fix<'s>(
        &self,
        source: Source,
        index: u32,
        coordinates: &[Coordinate],
        read: impl FnOnce() -> Result<Cow<'s, [u8]>, FontError>,
        db: &mut Arc<fontdb::Database>,
        loaded: &mut Loaded,
    ) -> Fixed {
        let key = key_of(source, index, coordinates);
        if let Some(id) = loaded.ids.get(&key) {
            return Fixed::Id(*id);
        }
        let known = lock(&self.state).fixed.get(&key).cloned();
        let bytes = match known {
            Some(known) => known,
            None => {
                // Senza il lucchetto: `read` può aver bisogno dello stato.
                let made = read().and_then(|sfnt| fonts::instance(&sfnt, index, coordinates));
                let mut state = lock(&self.state);
                match made {
                    Ok(bytes) if state.bytes + bytes.len() > self.limit => return Fixed::Over,
                    Ok(bytes) => {
                        state.bytes += bytes.len();
                        let bytes = Arc::new(bytes);
                        state.fixed.insert(key.clone(), Some(Arc::clone(&bytes)));
                        Some(bytes)
                    }
                    Err(_) => {
                        state.fixed.insert(key.clone(), None);
                        None
                    }
                }
            }
        };
        let Some(bytes) = bytes else {
            return Fixed::Failed;
        };
        let ids = Arc::make_mut(db).load_font_source(fontdb::Source::Binary(bytes));
        let Some(id) = ids.first().copied() else {
            return Fixed::Failed;
        };
        loaded.ids.insert(key, id);
        Fixed::Id(id)
    }
}

/// I file di caratteri del vault, in ordine di percorso, e le loro facce.
fn read_catalog(host: &dyn ReadApi) -> Catalog {
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: Some(EntryKind::Asset),
        within: None,
        page: None,
    }) {
        Ok(IndexResult::Entries(entries)) => entries.items,
        _ => Vec::new(),
    };
    let mut catalog = Catalog::default();
    for entry in entries
        .into_iter()
        .filter(|entry| mime_of(&entry.id).is_some_and(|mime| FONT_TYPES.contains(&mime)))
    {
        match faces_of(host, &entry) {
            Some(faces) => catalog.files.push((entry.id, Arc::new(faces))),
            None => {
                catalog.unreadable.insert(entry.id.to_string());
            }
        }
    }
    catalog
}

/// Le facce di un file del vault; `None` per un file che non si legge come
/// carattere.
fn faces_of(host: &dyn ReadApi, entry: &VaultEntry) -> Option<Vec<Face>> {
    if entry.size > fonts::MAX_FONT_BYTES as u64 {
        return None;
    }
    let bytes = host.read_document_bytes(&entry.id).ok()?;
    if bytes.len() > fonts::MAX_FONT_BYTES {
        return None;
    }
    fonts::describe(&fonts::decode(&bytes).ok()?).ok()
}

/// Il nome di una faccia fissata, per il log: la famiglia e il peso.
fn named(family: &str, face: &Face, coordinates: &[Coordinate]) -> String {
    let weight = coordinates
        .iter()
        .find(|each| each.tag == "wght")
        .map_or(face.weight[0], |each| each.value);
    format!("{family} {weight}")
}

/// La faccia chiesta da un pezzo di testo.
fn request_of(font: &usvg::Font) -> Request {
    Request {
        weight: f64::from(font.weight()),
        style: match font.style() {
            FontStyle::Normal => Style::Normal,
            FontStyle::Italic => Style::Italic,
            FontStyle::Oblique => Style::Oblique,
        },
        stretch: match font.stretch() {
            FontStretch::UltraCondensed => 50.0,
            FontStretch::ExtraCondensed => 62.5,
            FontStretch::Condensed => 75.0,
            FontStretch::SemiCondensed => 87.5,
            FontStretch::Normal => 100.0,
            FontStretch::SemiExpanded => 112.5,
            FontStretch::Expanded => 125.0,
            FontStretch::ExtraExpanded => 150.0,
            FontStretch::UltraExpanded => 200.0,
        },
    }
}

/// Se la faccia `id` sa disegnare `c`.
fn has_char(db: &fontdb::Database, id: fontdb::ID, c: char) -> bool {
    db.with_face_data(id, |data, index| {
        FontRef::from_index(data, index).is_ok_and(|font| font.charmap().map(c).is_some())
    })
    .unwrap_or(false)
}

/// Le famiglie dei caratteri che il testo di `tree` usa e che non si lasciano
/// incorporare in un PDF: il suo testo va a tracciati.
pub(super) fn restricted(tree: &Tree) -> BTreeSet<String> {
    fn visit(group: &usvg::Group, used: &mut BTreeSet<fontdb::ID>) {
        for node in group.children() {
            match node {
                Node::Group(group) => visit(group, used),
                Node::Text(text) => {
                    for span in text.layouted() {
                        used.extend(span.positioned_glyphs.iter().map(|glyph| glyph.font));
                    }
                }
                Node::Path(_) | Node::Image(_) => {}
            }
            node.subroots(|root| visit(root, used));
        }
    }
    let mut used = BTreeSet::new();
    visit(tree.root(), &mut used);
    let db = tree.fontdb();
    used.into_iter()
        .filter(|id| {
            db.with_face_data(*id, |data, index| !fonts::embeddable(data, index))
                .unwrap_or(false)
        })
        .filter_map(|id| Some(db.face(id)?.families.first()?.0.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
    use fub_abi::transfer::{
        ExportProvider, ExportReport, ExportRequest, ExportSelection, MemorySink,
    };
    use fub_sdk::testing::MemoryHost;
    use resvg::tiny_skia::{Pixmap, Transform};

    use super::super::fonts::tests::{app_font, renamed, with_fs_type};
    use super::super::{options, Refused, DRAW_PDF, DRAW_PNG};
    use super::*;
    use crate::{PdfExport, PngExport};

    const NAMES: [&str; 6] = [
        "inter-latin-wght-normal.woff2",
        "inter-latin-wght-italic.woff2",
        "literata-latin-wght-normal.woff2",
        "literata-latin-wght-italic.woff2",
        "jetbrains-mono-latin-wght-normal.woff2",
        "jetbrains-mono-latin-wght-italic.woff2",
    ];

    fn host() -> MemoryHost {
        MemoryHost::new().with_format(
            "svg",
            DocumentFormat {
                descriptor: FormatDescriptor::text("svg", "Drawing", &["svg"]),
                capabilities: FormatCapabilities::default(),
            },
        )
    }

    /// Un carattere variabile di Fub col nome di una famiglia del vault.
    fn vault_font(name: &str, family: &str) -> Vec<u8> {
        renamed(&fonts::decode(&app_font(name)).unwrap(), family)
    }

    /// Un disegno con un testo solo.
    fn text(family: &str, weight: u16, content: &str) -> String {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="64"><text x="8" y="46" font-family="{family}" font-weight="{weight}" font-size="40">{content}</text></svg>"#
        )
    }

    /// I pixel di `svg` disegnato coi caratteri `typefaces`.
    fn pixels(svg: &str, typefaces: &Typefaces<'_>) -> Vec<u8> {
        let refused = Arc::new(Mutex::new(Refused::default()));
        let tree = Tree::from_str(svg, &options(&refused, None, typefaces)).unwrap();
        render(&tree)
    }

    fn render(tree: &Tree) -> Vec<u8> {
        let size = tree.size().to_int_size();
        let mut pixmap = Pixmap::new(size.width(), size.height()).unwrap();
        resvg::render(tree, Transform::default(), &mut pixmap.as_mut());
        pixmap.take()
    }

    /// Quanto inchiostro: la somma delle opacità.
    fn ink(pixels: &[u8]) -> usize {
        pixels.chunks(4).map(|px| usize::from(px[3])).sum()
    }

    fn export(
        provider: &dyn ExportProvider,
        target: &str,
        host: &MemoryHost,
        docs: &[&str],
    ) -> ExportReport {
        let request = ExportRequest::new(
            target,
            ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
        );
        provider
            .export(&request, host, &mut MemorySink::default())
            .unwrap()
    }

    fn messages(report: &ExportReport) -> Vec<String> {
        report.log.iter().map(|note| note.message.clone()).collect()
    }

    #[test]
    fn fubs_variable_files_are_the_apps_own() {
        for (bytes, name) in FUB_FILES.iter().zip(NAMES) {
            assert!(*bytes == app_font(name).as_slice(), "{name}");
        }
        assert_eq!(fub_files().len(), FUB_FILES.len());
        let mut keys: Vec<_> = statics().keys().cloned().collect();
        keys.sort();
        let mut expected = Vec::new();
        for family in [SANS, MONO, SERIF] {
            for italic in [false, true] {
                for weight in [400, 700] {
                    expected.push((family.to_string(), italic, weight));
                }
            }
        }
        assert_eq!(keys, expected);
    }

    #[test]
    fn a_weight_between_the_statics_is_drawn_at_that_weight() {
        let fonts = Typefaces::new(None);
        let at = |weight| pixels(&text("Inter, sans-serif", weight, "Acqua"), &fonts);
        let (regular, semibold, bold) = (at(400), at(600), at(700));
        assert!(ink(&regular) < ink(&semibold) && ink(&semibold) < ink(&bold));

        // Il 600 è il file variabile fissato a 600, non il 700 più vicino.
        let sfnt = fonts::decode(&app_font(NAMES[0])).unwrap().into_owned();
        let wght = |value| {
            vec![Coordinate {
                tag: "wght".into(),
                value,
            }]
        };
        let instance = fonts::instance(&sfnt, 0, &wght(600.0)).unwrap();
        let mut db = fontdb::Database::new();
        db.load_font_source(fontdb::Source::Binary(Arc::new(instance)));
        let alone = usvg::Options {
            fontdb: Arc::new(db),
            ..usvg::Options::default()
        };
        let tree = Tree::from_str(&text("Inter", 600, "Acqua"), &alone).unwrap();
        assert!(render(&tree) == semibold);

        // Al 400 e al 700 restano le istanze statiche delle baseline.
        let statics = usvg::Options {
            fontdb: Arc::clone(fub_fonts()),
            ..usvg::Options::default()
        };
        for (weight, drawn) in [(400, &regular), (700, &bold)] {
            let tree = Tree::from_str(&text("Inter", weight, "Acqua"), &statics).unwrap();
            assert!(render(&tree) == *drawn, "{weight}");
        }
        assert!(fonts.notes().is_empty());
    }

    #[test]
    fn a_vault_family_is_drawn_with_its_own_font() {
        let host = host().with_binary_document(
            "Caratteri/Prova Mono.ttf",
            &vault_font(NAMES[4], "Prova Mono"),
        );
        let shared = VaultFonts::default();
        let fonts = Typefaces::new(Some((&host, &shared)));
        let drawn = pixels(&text("'Prova Mono', serif", 600, "Acqua"), &fonts);
        let mono = pixels(&text("'JetBrains Mono'", 600, "Acqua"), &fonts);
        let serif = pixels(&text("serif", 600, "Acqua"), &fonts);
        assert!(drawn == mono);
        assert!(drawn != serif);
        // Il nome si scrive come si vuole, come nei CSS.
        assert!(pixels(&text("'PROVA MONO'", 600, "Acqua"), &fonts) == mono);
        assert!(fonts.notes().is_empty(), "{:?}", fonts.notes());
    }

    #[test]
    fn a_missing_family_passes_to_the_next_and_says_so() {
        let host = host();
        let shared = VaultFonts::default();
        let fonts = Typefaces::new(Some((&host, &shared)));
        let inter = pixels(&text("Inter", 400, "Acqua"), &fonts);
        let literata = pixels(&text("Literata", 400, "Acqua"), &fonts);
        assert!(pixels(&text("Nessuna, sans-serif", 400, "Acqua"), &fonts) == inter);
        assert!(pixels(&text("'Neanche questa'", 400, "Acqua"), &fonts) == literata);
        assert_eq!(
            fonts.notes(),
            ["2 font families are not in Fub or in the vault and were replaced: Neanche questa, Nessuna"]
        );
        // Senza il vault, come per le annotazioni di un PDF.
        let fub = Typefaces::new(None);
        pixels(&text("Nessuna, sans-serif", 400, "Acqua"), &fub);
        assert_eq!(
            fub.notes(),
            ["1 font family is not in Fub and was replaced: Nessuna"]
        );
    }

    #[test]
    fn a_character_the_font_lacks_comes_from_the_next_family() {
        // Il latino di Inter non ha la «Ă», quello di JetBrains Mono e di
        // Literata sì.
        let host =
            host().with_binary_document("Caratteri/Prova.ttf", &vault_font(NAMES[0], "Prova"));
        let shared = VaultFonts::default();
        let fonts = Typefaces::new(Some((&host, &shared)));
        let next = pixels(&text("Prova, 'JetBrains Mono'", 400, "Ă"), &fonts);
        assert!(next == pixels(&text("'JetBrains Mono'", 400, "Ă"), &fonts));
        // Senza una famiglia dopo, i caratteri di Fub, da Literata.
        let fub = pixels(&text("Prova", 400, "Ă"), &fonts);
        assert!(fub == pixels(&text("Literata", 400, "Ă"), &fonts));
        assert!(next != fub);
        assert!(fonts.notes().is_empty(), "{:?}", fonts.notes());
    }

    #[test]
    fn fonts_past_the_limit_are_replaced_and_said() {
        let host = host().with_binary_document(
            "Caratteri/Prova Mono.ttf",
            &vault_font(NAMES[4], "Prova Mono"),
        );
        let shared = VaultFonts::default();
        let mut fonts = Typefaces::new(Some((&host, &shared)));
        fonts.limit = 0;
        // Di Fub, la statica più vicina; del vault, la famiglia dopo.
        let bold = pixels(&text("Inter", 700, "Acqua"), &fonts);
        assert!(pixels(&text("Inter", 600, "Acqua"), &fonts) == bold);
        let serif = pixels(&text("serif", 600, "Acqua"), &fonts);
        assert!(pixels(&text("'Prova Mono', serif", 600, "Acqua"), &fonts) == serif);
        assert_eq!(
            fonts.notes(),
            ["3 fonts did not fit in the 64 MiB of fonts of a drawing and were replaced: Inter 600, Literata 600, Prova Mono 600"]
        );
    }

    #[test]
    fn the_vault_is_read_only_when_a_family_is_not_fubs() {
        let font = vault_font(NAMES[4], "Prova Mono");
        let host = host()
            .with_document("solo Fub.svg", &text("Inter, sans-serif", 600, "Acqua"))
            .with_document("uno.svg", &text("'Prova Mono'", 600, "Acqua"))
            .with_document("due.svg", &text("'Prova Mono'", 600, "Acqua"))
            .with_binary_document("Caratteri/Prova Mono.ttf", &font)
            .with_binary_document("Caratteri/Rotto.ttf", b"not a font");
        let report = export(&PngExport, DRAW_PNG, &host, &["solo Fub.svg"]);
        assert!(report.log.is_empty(), "{:?}", report.log);
        assert_eq!(host.reads_on("Caratteri/Prova Mono.ttf"), (0, 0));
        assert_eq!(host.reads_on("Caratteri/Rotto.ttf"), (0, 0));

        // Le facce una volta per export, i byte una volta per disegno.
        let report = export(&PngExport, DRAW_PNG, &host, &["uno.svg", "due.svg"]);
        assert_eq!(report.artifacts.len(), 2);
        assert!(report.log.is_empty(), "{:?}", report.log);
        assert_eq!(
            host.reads_on("Caratteri/Prova Mono.ttf"),
            (3, 3 * font.len())
        );
        assert_eq!(host.reads_on("Caratteri/Rotto.ttf").0, 1);
    }

    #[test]
    fn an_unreadable_font_file_is_named_when_a_family_is_missing() {
        let host = host()
            .with_document("prova.svg", &text("Nessuna, serif", 400, "Acqua"))
            .with_binary_document("Caratteri/Rotto.ttf", b"not a font");
        let report = export(&PngExport, DRAW_PNG, &host, &["prova.svg"]);
        assert_eq!(report.artifacts.len(), 1);
        assert_eq!(
            messages(&report),
            [
                "1 font family is not in Fub or in the vault and was replaced: Nessuna",
                "1 vault font file could not be read: Caratteri/Rotto.ttf",
            ]
        );
        assert!(report
            .log
            .iter()
            .all(|note| note.entry.as_deref() == Some("prova.svg")));
    }

    #[test]
    fn a_font_that_forbids_embedding_is_outlined_in_the_pdf() {
        let open = vault_font(NAMES[4], "Aperta");
        let closed = with_fs_type(&vault_font(NAMES[4], "Riservata"), 0x0002);
        let host = host()
            .with_document("aperta.svg", &text("Aperta", 400, "Acqua"))
            .with_document("riservata.svg", &text("Riservata", 400, "Acqua"))
            .with_binary_document("Caratteri/Aperta.ttf", &open)
            .with_binary_document("Caratteri/Riservata.ttf", &closed);
        let pdf = |doc| {
            let report = export(&PdfExport, DRAW_PDF, &host, &[doc]);
            let bytes = report.artifacts[0].as_bytes().unwrap().to_vec();
            (
                String::from_utf8_lossy(&bytes).into_owned(),
                messages(&report),
            )
        };
        let (embedded, log) = pdf("aperta.svg");
        assert!(embedded.contains("/FontFile2"));
        assert!(log.is_empty(), "{log:?}");
        let (outlined, log) = pdf("riservata.svg");
        assert!(!outlined.contains("/FontFile"));
        assert_eq!(
            log,
            ["1 font does not allow embedding, so the PDF pages that use it have their text drawn as outlines: Riservata"]
        );
        // L'immagine non incorpora niente, e non lo dice.
        let report = export(&PngExport, DRAW_PNG, &host, &["riservata.svg"]);
        assert!(report.log.is_empty(), "{:?}", report.log);
    }
}
