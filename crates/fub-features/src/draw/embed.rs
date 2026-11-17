//! Ciò che il disegno si porta dietro: le note del log, le opzioni di `usvg`,
//! le immagini del vault, i caratteri di Fub e i glifi che mancano.

use super::*;

/// Una nota su ciò che sta in `set`: quanti sono, detti con `one` o con
/// `many`, e i primi per nome.
pub(super) fn listed(set: &BTreeSet<String>, one: &str, many: &str) -> Option<String> {
    if set.is_empty() {
        return None;
    }
    let count = set.len();
    let listed: Vec<&str> = set.iter().take(LISTED).map(String::as_str).collect();
    let rest = count.saturating_sub(LISTED);
    Some(format!(
        "{count} {}: {}{}",
        if count == 1 { one } else { many },
        listed.join(", "),
        if rest > 0 {
            format!(" and {rest} more")
        } else {
            String::new()
        },
    ))
}

/// La nota dei riferimenti esterni rimasti fuori, i primi per nome; `within`
/// è ciò da cui puntano fuori (`the vault`, `the annotations`).
pub(super) fn external_note(external: &BTreeSet<String>, within: &str) -> Option<String> {
    listed(
        external,
        &format!("image reference points outside {within} and was not exported"),
        &format!("image references point outside {within} and were not exported"),
    )
}

/// La nota delle immagini del vault rimaste fuori per `why`, le prime per
/// nome.
pub(super) fn vault_note(why: LeftOut, images: &BTreeSet<String>) -> Option<String> {
    let (one, many) = match why {
        LeftOut::Missing => (
            "image is not in the vault and was not exported".to_string(),
            "images are not in the vault and were not exported".to_string(),
        ),
        LeftOut::NotRaster => (
            "vault image is not a readable PNG, JPEG, GIF or WebP image and was not exported"
                .to_string(),
            "vault images are not readable PNG, JPEG, GIF or WebP images and were not exported"
                .to_string(),
        ),
        LeftOut::Unreadable => (
            "vault image could not be read and was not exported".to_string(),
            "vault images could not be read and were not exported".to_string(),
        ),
        LeftOut::OverBudget => (
            format!(
                "vault image did not fit in the {VAULT_IMAGES_MIB} MiB of images of a drawing and was not exported"
            ),
            format!(
                "vault images did not fit in the {VAULT_IMAGES_MIB} MiB of images of a drawing and were not exported"
            ),
        ),
        LeftOut::OverExport => {
            let limit = PLUGIN_EXPORT_LIMIT / (1024 * 1024);
            (
                format!("vault image would take the export past {limit} MiB and keeps its path"),
                format!("vault images would take the export past {limit} MiB and keep their path"),
            )
        }
    };
    listed(images, &one, &many)
}

/// La nota di un PDF senza l'abbondanza chiesta: senza `viewBox` e senza
/// `width` e `height`, il disegno non dice dove finisce.
pub(super) const UNBLED_NOTE: &str =
    "the drawing has neither a viewBox nor a width and height, so its PDF has no bleed";

/// La nota dei caratteri che nessuno dei caratteri del disegno ha.
pub(super) fn glyphs_note(missing: &BTreeSet<char>) -> Option<String> {
    if missing.is_empty() {
        return None;
    }
    let chars: String = missing.iter().collect();
    Some(format!(
        "characters outside the drawing's fonts are drawn as a placeholder box: {chars}"
    ))
}

/// Il titolo del disegno, per i metadati del file: il titolo che il formato
/// legge dal documento (il primo heading di livello 1 del modello), altrimenti
/// il nome del file.
pub(super) fn title(host: &dyn ReadApi, doc: &DocId) -> String {
    host.read_model(doc)
        .ok()
        .and_then(|model| heading(&model.body))
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| doc.page_name().to_string())
}

pub(super) fn heading(blocks: &[Block]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        Block::Heading {
            level: 1, inlines, ..
        } => Some(
            inlines
                .iter()
                .filter_map(|inline| match inline {
                    Inline::Text(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect(),
        ),
        Block::Custom { blocks, .. } => heading(blocks),
        _ => None,
    })
}

/// Ciò che il risolutore delle immagini ha lasciato fuori.
#[derive(Default)]
pub(super) struct Refused {
    /// I riferimenti esterni, senza ripetizioni e in ordine: fuori dal vault
    /// per un disegno, fuori dal documento per le annotazioni.
    pub(super) external: BTreeSet<String>,
    /// Le immagini incorporate che non sono raster leggibili.
    pub(super) embedded: usize,
    /// Le immagini del vault rimaste fuori, per motivo.
    pub(super) vault: BTreeMap<LeftOut, BTreeSet<String>>,
}

impl Refused {
    /// Aggiunge ciò che ha lasciato fuori un'altra pagina dello stesso
    /// disegno. Le pagine sono lo stesso contenuto guardato in punti diversi:
    /// i riferimenti si contano una volta, e le immagini incorporate rotte
    /// quante ne ha la pagina che ne ha di più.
    pub(super) fn merge(&mut self, other: Refused) {
        self.external.extend(other.external);
        self.embedded = self.embedded.max(other.embedded);
        for (why, images) in other.vault {
            self.vault.entry(why).or_default().extend(images);
        }
    }
}

/// Quanto di un riferimento esterno finisce nel log.
pub(super) const HREF_SHOWN: usize = 120;

pub(super) fn lock(refused: &Mutex<Refused>) -> MutexGuard<'_, Refused> {
    // Un risolutore non va in panico mentre tiene il lucchetto: se succedesse,
    // il conto resterebbe comunque leggibile.
    refused
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Le opzioni di `usvg` per un documento. Sono il confine di questo modulo:
/// vedi la documentazione in testa al file. `vault` sono le immagini del vault
/// che il documento può nominare; senza, ogni riferimento resta fuori.
/// `typefaces` sceglie i caratteri del testo ([`typefaces`]).
pub(super) fn options<'a>(
    refused: &Arc<Mutex<Refused>>,
    vault: Option<&'a VaultImages<'a>>,
    typefaces: &'a Typefaces<'a>,
) -> usvg::Options<'a> {
    let embedded = Arc::clone(refused);
    let external = Arc::clone(refused);
    usvg::Options {
        resources_dir: None,
        font_family: SERIF.to_string(),
        image_href_resolver: ImageHrefResolver {
            resolve_data: Box::new(move |_, data, _| {
                let kind = raster(data);
                if kind.is_none() {
                    lock(&embedded).embedded += 1;
                }
                kind
            }),
            resolve_string: Box::new(move |href, _| {
                let shown: String = href.chars().take(HREF_SHOWN).collect();
                let (Some(vault), Some(path)) = (vault, vault_path(href)) else {
                    lock(&external).external.insert(shown);
                    return None;
                };
                match vault.image(&path) {
                    Ok(kind) => Some(kind),
                    Err(why) => {
                        lock(&external).vault.entry(why).or_default().insert(shown);
                        None
                    }
                }
            }),
        },
        fontdb: Arc::clone(fub_fonts()),
        font_resolver: typefaces.resolver(),
        ..usvg::Options::default()
    }
}

/// L'URI `data:` di un'immagine raster, col tipo che dicono i suoi byte.
pub(super) fn data_uri(kind: &ImageKind) -> Option<String> {
    let (media_type, bytes) = match kind {
        ImageKind::PNG(bytes) => ("image/png", bytes),
        ImageKind::JPEG(bytes) => ("image/jpeg", bytes),
        ImageKind::GIF(bytes) => ("image/gif", bytes),
        ImageKind::WEBP(bytes) => ("image/webp", bytes),
        ImageKind::SVG(_) => return None,
    };
    Some(format!(
        "data:{media_type};base64,{}",
        BASE64.encode(bytes.as_slice())
    ))
}

/// Un'immagine, se è di un formato raster che `usvg` sa misurare. Il formato
/// lo dicono i primi byte, non il tipo che il `data:` o il nome del file
/// dichiarano; la misura la prende `imagesize`, come in `usvg`, che
/// un'immagine senza misura la scarta senza dirlo.
pub(super) fn raster(data: Arc<Vec<u8>>) -> Option<ImageKind> {
    let bytes = data.as_slice();
    let kind: fn(Arc<Vec<u8>>) -> ImageKind = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        ImageKind::PNG
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        ImageKind::JPEG
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        ImageKind::GIF
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        ImageKind::WEBP
    } else {
        return None;
    };
    imagesize::blob_size(bytes)
        .is_ok_and(|size| size.width > 0 && size.height > 0)
        .then(|| kind(data))
}

/// Quanti MiB di immagini del vault porta al più un disegno: i byte restano in
/// memoria finché il disegno non è uscito.
const VAULT_IMAGES_MIB: usize = 64;
const VAULT_IMAGES_MAX: usize = VAULT_IMAGES_MIB * 1024 * 1024;

/// I tipi dei file che l'export legge come immagini del vault: i raster che
/// `resvg` e `svg2pdf` sanno disegnare.
const RASTER_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Il percorso del vault che un `href` d'immagine nomina, letto come lo legge
/// il client (`href` in `apps/client/src/editors/spatial/scene/values.ts`),
/// cioè come un URL: senza spazi e controlli ai due capi e senza tabulazioni e
/// a capo dentro. `None` per ciò che non è un percorso:
/// il valore vuoto, un frammento, `//host`, un URL col suo schema, `file:`
/// compreso.
pub(super) fn vault_path(href: &str) -> Option<String> {
    let url: String = href
        .trim_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let slash = |c: Option<char>| matches!(c, Some('/' | '\\'));
    let mut start = url.chars();
    if url.is_empty() || url.starts_with('#') || (slash(start.next()) && slash(start.next())) {
        return None;
    }
    let scheme = url.split_once(':').is_some_and(|(name, _)| {
        let mut chars = name.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    });
    (!scheme).then_some(url)
}

/// Perché un'immagine del vault è rimasta fuori, nell'ordine delle note del
/// log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum LeftOut {
    /// Il percorso non porta a un file del vault.
    Missing,
    /// Il file non è un raster leggibile: un altro tipo, un SVG, byte rotti.
    NotRaster,
    /// L'host non ha risposto, o non ha dato i byte.
    Unreadable,
    /// Il file non ci stava più nel tetto del disegno.
    OverBudget,
    /// Nell'SVG pulito, i suoi byte avrebbero portato l'export oltre
    /// [`PLUGIN_EXPORT_LIMIT`]: resta il percorso.
    OverExport,
}

/// Le immagini del vault di un disegno. Un percorso ([`vault_path`]) si risolve
/// dal disegno con la domanda dei collegamenti ([`IndexQuery::Resolve`]); il file deve avere il tipo di
/// un raster, e i suoi byte, letti dall'host, devono esserlo davvero
/// ([`raster`]).
///
/// Le immagini si leggono nell'ordine in cui `usvg` le incontra, finché ci
/// stanno nel tetto: una che non ci sta resta fuori, e le altre si leggono
/// ancora. La misura si chiede prima all'anagrafe, così un file che non ci sta
/// non si legge nemmeno. Un file si legge una volta per disegno, anche se il
/// disegno lo nomina più volte o per due percorsi.
pub(super) struct VaultImages<'h> {
    host: &'h dyn ReadApi,
    /// Il disegno: i percorsi sono relativi alla sua cartella.
    from: DocId,
    read: Mutex<ImagesRead>,
}

/// Ciò che le immagini del vault di un disegno hanno già dato.
#[derive(Default)]
struct ImagesRead {
    /// L'esito di ogni percorso già chiesto.
    paths: BTreeMap<String, Result<ImageKind, LeftOut>>,
    /// L'esito di ogni file già letto.
    files: BTreeMap<DocId, Result<ImageKind, LeftOut>>,
    /// I byte letti finora.
    bytes: usize,
}

impl<'h> VaultImages<'h> {
    pub(super) fn new(host: &'h dyn ReadApi, from: &DocId) -> Self {
        VaultImages {
            host,
            from: from.clone(),
            read: Mutex::new(ImagesRead::default()),
        }
    }

    /// L'immagine del vault a `path`, o perché resta fuori.
    pub(super) fn image(&self, path: &str) -> Result<ImageKind, LeftOut> {
        // Come per `Refused`: nessuno va in panico tenendo il lucchetto, e ciò
        // che è già stato letto resterebbe valido.
        let mut read = self
            .read
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(found) = read.paths.get(path) {
            return found.clone();
        }
        let found = self.find(path, &mut read);
        read.paths.insert(path.to_string(), found.clone());
        found
    }

    fn find(&self, path: &str, read: &mut ImagesRead) -> Result<ImageKind, LeftOut> {
        let file = match self.host.query_index(IndexQuery::Resolve {
            target: LinkTarget::Path(path.to_string()),
            from: Some(self.from.clone()),
        }) {
            Ok(IndexResult::Resolved(Some(found))) => found.doc,
            Ok(IndexResult::Resolved(None)) => return Err(LeftOut::Missing),
            _ => return Err(LeftOut::Unreadable),
        };
        if let Some(found) = read.files.get(&file) {
            return found.clone();
        }
        let found = self.read_file(&file, read);
        read.files.insert(file, found.clone());
        found
    }

    /// I byte di `file`, se è un raster che ci sta nel tetto.
    fn read_file(&self, file: &DocId, read: &mut ImagesRead) -> Result<ImageKind, LeftOut> {
        // Una nota, un disegno, un video: niente da leggere.
        if !mime_of(file).is_some_and(|mime| RASTER_TYPES.contains(&mime)) {
            return Err(LeftOut::NotRaster);
        }
        let room = VAULT_IMAGES_MAX - read.bytes;
        if self.size_of(file).is_some_and(|size| size > room as u64) {
            return Err(LeftOut::OverBudget);
        }
        let bytes = self
            .host
            .read_document_bytes(file)
            .map_err(|_| LeftOut::Unreadable)?;
        // L'anagrafe può non conoscere il file, o averne una misura vecchia.
        if bytes.len() > room {
            return Err(LeftOut::OverBudget);
        }
        let size = bytes.len();
        let kind = raster(Arc::new(bytes)).ok_or(LeftOut::NotRaster)?;
        read.bytes += size;
        Ok(kind)
    }

    /// La misura di `file` secondo l'anagrafe del vault, senza leggerlo.
    fn size_of(&self, file: &DocId) -> Option<u64> {
        let folder = file
            .as_str()
            .rsplit_once('/')
            .map_or("", |(folder, _)| folder);
        match self.host.query_index(IndexQuery::Entries {
            of_kind: None,
            within: Some(FolderScope::direct(folder)),
            page: None,
        }) {
            Ok(IndexResult::Entries(entries)) => entries
                .items
                .into_iter()
                .find(|entry| entry.id == *file)
                .map(|entry| entry.size),
            _ => None,
        }
    }
}

/// La famiglia con grazie, ed è anche quella di un testo senza `font-family`,
/// come il carattere di serie di un browser.
pub(super) const SERIF: &str = "Literata";
pub(super) const SANS: &str = "Inter";
pub(super) const MONO: &str = "JetBrains Mono";

/// I caratteri di Fub al 400 e al 700, il peso del testo e quello del
/// grassetto, in tondo e in corsivo.
///
/// Sono gli stessi tre che l'app distribuisce (Inter, Literata e JetBrains
/// Mono, i file variabili latin di `@fontsource-variable` 5.3.0, il tondo
/// `*-latin-wght-normal.woff2` e il corsivo `*-latin-wght-italic.woff2`)
/// fissati in istanze statiche: `usvg` 0.45 non sa scegliere un punto
/// dell'asse `wght` di un carattere variabile, e con il file variabile ogni
/// peso uscirebbe come il peso di serie del file. Gli altri pesi li fissa
/// l'export stesso dai file variabili, quando servono ([`typefaces`]). Le
/// istanze sono
/// riproducibili: fontTools 4.66.1, `font =
/// instancer.instantiateVariableFont(font, {"wght": 400 | 700},
/// updateFontNames=True)` sul file caricato con `recalcTimestamp=False`, che
/// restituisce un carattere nuovo e non cambia quello che riceve, salvato come
/// TrueType. La licenza è la SIL Open Font License 1.1 di tutti e tre i
/// caratteri, in `fonts/OFL.txt` accanto ai file.
pub(super) const FACES: [&[u8]; 12] = [
    include_bytes!("../../fonts/inter-400.ttf"),
    include_bytes!("../../fonts/inter-700.ttf"),
    include_bytes!("../../fonts/inter-italic-400.ttf"),
    include_bytes!("../../fonts/inter-italic-700.ttf"),
    include_bytes!("../../fonts/literata-400.ttf"),
    include_bytes!("../../fonts/literata-700.ttf"),
    include_bytes!("../../fonts/literata-italic-400.ttf"),
    include_bytes!("../../fonts/literata-italic-700.ttf"),
    include_bytes!("../../fonts/jetbrains-mono-400.ttf"),
    include_bytes!("../../fonts/jetbrains-mono-700.ttf"),
    include_bytes!("../../fonts/jetbrains-mono-italic-400.ttf"),
    include_bytes!("../../fonts/jetbrains-mono-italic-700.ttf"),
];

/// Il database dei caratteri di serie, costruito una volta per processo e
/// soltanto dai byte qui sopra: nessuna chiamata a `load_system_fonts`,
/// nessun file. Ogni albero ne ha una copia, a cui aggiunge i caratteri che
/// fissa ([`typefaces`]).
pub(super) fn fub_fonts() -> &'static Arc<fontdb::Database> {
    static FONTS: OnceLock<Arc<fontdb::Database>> = OnceLock::new();
    FONTS.get_or_init(|| {
        let mut db = fontdb::Database::new();
        for face in FACES {
            db.load_font_source(fontdb::Source::Binary(Arc::new(face)));
        }
        db.set_serif_family(SERIF);
        db.set_sans_serif_family(SANS);
        db.set_monospace_family(MONO);
        // Le due famiglie generiche che Fub non ha: una scelta dichiarata è
        // meglio del primo carattere che il ripiego trova.
        db.set_cursive_family(SERIF);
        db.set_fantasy_family(SANS);
        Arc::new(db)
    })
}

/// I caratteri del disegno che nessuno dei caratteri di Fub sa disegnare:
/// `usvg` li lascia sul glifo 0, il riquadro vuoto.
pub(super) fn missing_glyphs(tree: &Tree) -> BTreeSet<char> {
    fn visit(group: &usvg::Group, missing: &mut BTreeSet<char>) {
        for node in group.children() {
            match node {
                Node::Group(group) => visit(group, missing),
                Node::Text(text) => {
                    for span in text.layouted() {
                        for glyph in span.positioned_glyphs.iter().filter(|g| g.id.0 == 0) {
                            missing.extend(glyph.text.chars().filter(|c| !c.is_whitespace()));
                        }
                    }
                }
                Node::Path(_) | Node::Image(_) => {}
            }
            node.subroots(|root| visit(root, missing));
        }
    }
    let mut missing = BTreeSet::new();
    visit(tree.root(), &mut missing);
    missing
}
