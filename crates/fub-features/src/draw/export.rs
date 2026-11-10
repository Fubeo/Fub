//! Gli `ExportProvider` dei disegni e il giro comune: quali file, quali pagine,
//! cosa è andato e cosa no (`export_drawings`, `Drawing`).

use super::*;

/// L'export in PNG: un'immagine per disegno, per tavola o per la selezione,
/// con lo sfondo trasparente come quello del disegno.
///
/// Le opzioni comuni a ogni formato sono in [`choice`]. La misura la dice
/// `scale` (numero, di serie 2, oltre 0 e al massimo 8), i pixel
/// dell'immagine per unità del disegno, o `width` (intero da 1 a 16 384), la
/// larghezza esatta in pixel. L'immagine dichiara la densità corrispondente
/// (`pHYs`), quindi incollata in un documento ha la misura del disegno e non
/// quella dei suoi pixel. Un'immagine che supererebbe 16 384 pixel di lato o
/// 32 milioni di pixel esce alla scala più grande che ci sta, e il log lo
/// dice.
#[derive(Default)]
pub struct PngExport;

/// L'export in JPEG: l'immagine del PNG posata sul bianco, con la stessa
/// misura e le stesse opzioni. Qualità 90, il colore senza sottocampionare, e
/// dei metadati solo la densità.
#[derive(Default)]
pub struct JpegExport;

/// L'export in SVG: per disegno, per tavola o per la selezione, il testo
/// derivato e ripulito per il web (`fub_scene::export::clean`). Le immagini
/// del vault restano riferimenti per percorso, e il log lo dice.
#[derive(Default)]
pub struct SvgExport;

/// L'export in PDF: un file vettoriale per disegno, una pagina della misura del
/// disegno (96 pixel CSS per pollice), con il testo selezionabile nei caratteri
/// di Fub incorporati. Le tavole sono un file solo, una pagina per tavola
/// nell'ordine del documento, ciascuna con un segnalibro col suo nome.
#[derive(Default)]
pub struct PdfExport;

/// L'export in Excalidraw: per disegno, per tavola o per la selezione, un
/// file `.excalidraw` coi rettangoli, le ellissi, i rombi, le linee, le
/// frecce agganciate, i testi e le etichette che Excalidraw modifica, le
/// tavole come riquadri, e come immagine ciò che non ha una forma sua
/// ([`interop`]). Il log dice ciò che cambia.
#[derive(Default)]
pub struct ExcalidrawExport;

/// L'export in draw.io: un file `.drawio` per disegno, con le forme, i
/// connettori agganciati, i testi, le etichette e i livelli che draw.io
/// modifica, e come immagine il resto ([`interop`]). Le tavole sono un file
/// solo, una pagina per tavola. Il log dice ciò che cambia.
#[derive(Default)]
pub struct DrawioExport;

impl ExportProvider for ExcalidrawExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_EXCALIDRAW.to_string(),
            name: "Excalidraw (editable shapes)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_EXCALIDRAW)?;
        let choice = Choice::read(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            Format::Excalidraw,
            &choice,
            &mut |drawing, file, out, report| {
                interop::write(interop::Target::Excalidraw, drawing, file, out, report)
            },
        )
    }
}

impl ExportProvider for DrawioExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_DRAWIO.to_string(),
            name: "draw.io (editable shapes, one page per board)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_DRAWIO)?;
        let choice = Choice::read(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            Format::Drawio,
            &choice,
            &mut |drawing, file, out, report| {
                interop::write(interop::Target::Drawio, drawing, file, out, report)
            },
        )
    }
}

impl ExportProvider for PngExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_PNG.to_string(),
            name: "PNG (one image per drawing)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_PNG)?;
        let choice = Choice::read(&request.options)?;
        let size = raster_size(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            Format::Png,
            &choice,
            &mut |drawing, file, out, report| {
                write_raster(drawing, file, size, Format::Png, out, report)
            },
        )
    }
}

impl ExportProvider for JpegExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_JPEG.to_string(),
            name: "JPEG (one image per drawing, on white)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_JPEG)?;
        let choice = Choice::read(&request.options)?;
        let size = raster_size(&request.options)?;
        export_drawings(
            request,
            host,
            out,
            Format::Jpeg,
            &choice,
            &mut |drawing, file, out, report| {
                write_raster(drawing, file, size, Format::Jpeg, out, report)
            },
        )
    }
}

impl ExportProvider for SvgExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_SVG.to_string(),
            name: "SVG (one clean file per drawing, for the web)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_SVG)?;
        let choice = Choice::read(&request.options)?;
        export_drawings(request, host, out, Format::Svg, &choice, &mut write_svg)
    }
}

impl ExportProvider for PdfExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![ExportTarget {
            id: DRAW_PDF.to_string(),
            name: "PDF (one vector file per drawing)".to_string(),
            extension: None,
        }]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
        out: &mut dyn ArtifactSink,
    ) -> Result<ExportReport, PluginError> {
        check_target(request, DRAW_PDF)?;
        let choice = Choice {
            print: print_setup(&request.options)?,
            ..Choice::read(&request.options)?
        };
        export_drawings(
            request,
            host,
            out,
            Format::Pdf,
            &choice,
            &mut |drawing, file, out, report| write_pdf(drawing, file, &choice.print, out, report),
        )
    }
}

pub(super) fn check_target(request: &ExportRequest, target: &str) -> Result<(), PluginError> {
    if request.target == target {
        return Ok(());
    }
    Err(PluginError::BadArgs(Text::message(
        E_TARGET,
        vec![Arg::text("target", request.target.clone())],
    )))
}

/// Il formato di una destinazione dei disegni.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Format {
    Png,
    Jpeg,
    Svg,
    Pdf,
    Excalidraw,
    Drawio,
}

impl Format {
    fn extension(self) -> &'static str {
        match self {
            Format::Png => "png",
            Format::Jpeg => "jpg",
            Format::Svg => "svg",
            Format::Pdf => "pdf",
            Format::Excalidraw => "excalidraw",
            Format::Drawio => "drawio",
        }
    }

    /// Le tavole stanno in un file solo, una pagina ciascuna.
    fn has_pages(self) -> bool {
        matches!(self, Format::Pdf | Format::Drawio)
    }
}

/// Com'è andato un file. `Err` del chiamante resta per ciò che ferma l'export
/// intero, cioè un sink che non accetta più byte.
pub(super) enum Outcome {
    Done,
    Failed(String),
}

/// Perché i file di un disegno non si scrivono: una richiesta che non vale
/// per quel disegno ferma l'export prima di ogni file, un disegno che non si
/// legge ferma soltanto sé.
enum Problem {
    Stop(PluginError),
    Failed(String),
}

/// Una pagina di un file: il testo da cui esce, l'ambito con cui è stato
/// derivato, per una tavola il suo nome e, se il testo ha l'abbondanza di un
/// PDF intorno, la misura in pixel CSS della pagina senza.
pub(super) struct Page<'b> {
    pub(super) text: Cow<'b, [u8]>,
    pub(super) scope: Scope,
    pub(super) board: Option<String>,
    pub(super) frame: Option<[f64; 2]>,
}

/// Un file da scrivere: il percorso, e le pagine, che sono una tranne nel PDF
/// delle tavole.
pub(super) struct File<'b> {
    pub(super) path: String,
    pub(super) pages: Vec<Page<'b>>,
}

impl File<'_> {
    /// Ciò che precede la nota di un file che non è il disegno intero: il
    /// nome della tavola, quando il disegno ha più file.
    pub(super) fn about(&self) -> String {
        match &self.pages[..] {
            [Page {
                board: Some(name), ..
            }] => format!("{name}: "),
            _ => String::new(),
        }
    }
}

/// Scrive un file nel formato del provider.
type Writer<'a> = dyn FnMut(
        &mut Drawing<'_>,
        &File<'_>,
        &mut dyn ArtifactSink,
        &mut ExportReport,
    ) -> Result<Outcome, PluginError>
    + 'a;

/// Il percorso comune ai formati: la selezione ridotta ai disegni, un nome
/// per ciascuno, i file di ciascuno, la scrittura, il log.
fn export_drawings(
    request: &ExportRequest,
    host: &dyn ReadApi,
    out: &mut dyn ArtifactSink,
    format: Format,
    choice: &Choice,
    write: &mut Writer<'_>,
) -> Result<ExportReport, PluginError> {
    // Il disegno è già un `.svg`: l'SVG del disegno intero, con il suo nome,
    // salvato accanto lo sovrascriverebbe. Ha la parola fra parentesi, come
    // il PDF annotato.
    let label = match (format, &choice.part) {
        (Format::Svg, Part::Drawing) => Some(annotated::suffix(&request.options, EXPORTED_SUFFIX)?),
        _ => None,
    };
    let selected = request.selection.resolve(host)?;
    let (drawings, others): (Vec<DocId>, Vec<DocId>) =
        selected.into_iter().partition(|doc| is_drawing(host, doc));
    if drawings.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_NO_DRAWINGS)));
    }
    if choice.part != Part::Drawing && drawings.len() > 1 {
        return Err(PluginError::BadArgs(Text::message(
            E_ONE_DRAWING,
            vec![Arg::int("count", drawings.len() as i64)],
        )));
    }
    let mut report = ExportReport::default();
    if !others.is_empty() {
        report.log.push(TransferNote::info(match others.len() {
            1 => "1 selected document is not a drawing and was skipped".to_string(),
            n => format!("{n} selected documents are not drawings and were skipped"),
        }));
    }
    let mut first_failure: Option<(DocId, String)> = None;
    let mut exported = 0usize;
    // Ciò che l'export tiene ancora, per le immagini che l'SVG pulito porta
    // dentro: passa da un disegno all'altro.
    let mut room = PLUGIN_EXPORT_LIMIT;
    // I caratteri del vault, letti una volta per tutti i disegni.
    let vault_fonts = VaultFonts::default();
    for (doc, path) in drawings.iter().zip(artifact_names(
        &drawings,
        format.extension(),
        label.as_deref(),
    )) {
        let mut failed = |reason: String, report: &mut ExportReport| {
            report
                .log
                .push(TransferNote::warning(reason.clone()).about(doc.to_string()));
            first_failure.get_or_insert((doc.clone(), reason));
        };
        let bytes = match host.read_document_bytes(doc) {
            Ok(bytes) => bytes,
            Err(error) => {
                failed(error.to_string(), &mut report);
                continue;
            }
        };
        let files = match files(doc, &bytes, choice, format, path) {
            Ok(files) => files,
            Err(Problem::Stop(error)) => return Err(error),
            Err(Problem::Failed(reason)) => {
                failed(reason, &mut report);
                continue;
            }
        };
        let mut drawing = Drawing::new(host, &vault_fonts, doc, room);
        let mut done = 0usize;
        for file in &files {
            match write(&mut drawing, file, out, &mut report)? {
                Outcome::Done => done += 1,
                Outcome::Failed(reason) => failed(format!("{}{reason}", file.about()), &mut report),
            }
        }
        room = drawing.room;
        if done > 0 {
            drawing.notes(&mut report);
        }
        exported += done;
    }
    match first_failure {
        // Niente da consegnare: l'esito è un errore, e il primo motivo è
        // quello che chi ha chiesto l'export vede.
        Some((doc, reason)) if exported == 0 => Err(PluginError::BadArgs(Text::message(
            E_NONE_EXPORTED,
            vec![
                Arg::text("doc", doc.to_string()),
                Arg::text("reason", reason),
            ],
        ))),
        _ => Ok(report),
    }
}

/// Un documento è un disegno quando il suo formato è quello dei disegni. Lo
/// dice il formato che il vault gli assegna, non l'estensione: un `.svg` resta
/// un allegato finché il formato `svg` non è montato, e allora non è un
/// disegno nemmeno qui.
fn is_drawing(host: &dyn ReadApi, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == FORMAT_ID)
}

/// Il nome dell'artefatto di ciascun disegno: il path del documento con
/// l'estensione del formato, così l'esito ripete le cartelle del vault, e con
/// `label` fra parentesi se c'è (`acqua (exported).svg`). Ciò che
/// collide (`Mare.svg` e `mare.svg`, che in una cartella che non distingue le
/// maiuscole sono un file solo) prende il numero della convenzione D3 dopo il
/// nome del disegno (`<nome> 1`, `<nome> 1 (exported)`), con la stessa chiave con cui il sink rifiuterebbe il
/// secondo ([`Names`]). I nomi si danno prima di leggere, quindi non
/// dipendono da quali disegni si lasciano leggere.
fn artifact_names(docs: &[DocId], extension: &str, label: Option<&str>) -> Vec<String> {
    let mut names = Names::default();
    docs.iter()
        .map(|doc| {
            let base = strip_ext(doc.as_str());
            names.take(|n| {
                let name = match n {
                    0 => base.clone(),
                    n => format!("{base} {n}"),
                };
                match label {
                    None => format!("{name}.{extension}"),
                    Some(label) => format!("{name} ({label}).{extension}"),
                }
            })
        })
        .collect()
}

/// Il testo di una pagina e, se ha l'abbondanza intorno, la misura della
/// pagina senza ([`Page::frame`]).
type Derived<'b> = (Cow<'b, [u8]>, Option<[f64; 2]>);

/// I file di un disegno per `choice`, con il nome `path` del disegno intero.
///
/// Il disegno intero con la carta e senza abbondanza sono i byte del
/// documento, così come sono: i file di prima. Il resto passa dalla
/// derivazione, che vuole un SVG in UTF-8; le tavole e gli oggetti chiesti
/// devono esserci tutti prima che si scriva un file.
///
/// L'abbondanza di un PDF è in millimetri sulla carta: la derivazione la
/// vuole in pixel della pagina, quindi divisa per la scala con cui la pagina
/// va sulla carta ([`print::layout`]).
fn files<'b>(
    doc: &DocId,
    bytes: &'b [u8],
    choice: &Choice,
    format: Format,
    path: String,
) -> Result<Vec<File<'b>>, Problem> {
    let whole = |(text, frame): Derived<'b>| {
        vec![File {
            path: path.clone(),
            pages: vec![Page {
                text,
                scope: Scope::Drawing,
                board: None,
                frame,
            }],
        }]
    };
    if choice.is_whole() {
        return Ok(whole((Cow::Borrowed(bytes), None)));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Problem::Failed(not_utf8()))?;
    let source = Source::read(text).map_err(|error| Problem::Failed(unreadable(&error)))?;
    let derive = |scope: &Scope| -> Result<Derived<'b>, Problem> {
        let problem = |error| derive_problem(doc, error);
        let setup = &choice.print;
        let frame = match setup.bleed > 0.0 {
            true => source.frame(scope).map_err(problem)?,
            false => None,
        };
        let bleed = frame.map_or(0.0, |[width, height]| {
            let scale = print::layout(width, height, setup).scale;
            setup.bleed * PX_PER_MM / scale
        });
        let text = source
            .derive_bled(scope, choice.background, bleed)
            .map_err(problem)?;
        Ok((Cow::Owned(text.into_bytes()), frame))
    };
    let base = strip_ext(doc.as_str());
    let extension = format.extension();
    match &choice.part {
        Part::Drawing => Ok(whole(derive(&Scope::Drawing)?)),
        Part::Selection { scope, suffix } => {
            let (text, frame) = derive(scope)?;
            Ok(vec![File {
                path: format!("{base} ({suffix}).{extension}"),
                pages: vec![Page {
                    text,
                    scope: scope.clone(),
                    board: None,
                    frame,
                }],
            }])
        }
        Part::Boards(ids) => {
            let boards = source.boards();
            if let Some(missing) = ids.iter().find(|id| !boards.iter().any(|b| &b.id == *id)) {
                return Err(derive_problem(
                    doc,
                    DeriveError::UnknownBoard(missing.clone()),
                ));
            }
            // L'ordine del documento, non quello della richiesta; il numero
            // di una tavola senza nome è la sua posizione fra tutte.
            let chosen: Vec<(usize, &Board)> = boards
                .iter()
                .enumerate()
                .filter(|(_, board)| ids.contains(&board.id))
                .map(|(at, board)| (at + 1, board))
                .collect();
            let mut pages = Vec::with_capacity(chosen.len());
            for (_, board) in &chosen {
                let scope = Scope::Board(board.id.clone());
                let (text, frame) = derive(&scope)?;
                pages.push(Page {
                    text,
                    scope,
                    board: Some(board.name.clone()),
                    frame,
                });
            }
            let mut names = Names::default();
            if format.has_pages() {
                let path = match &chosen[..] {
                    [(number, board)] => {
                        names.labelled(&base, &board_label(&board.name, *number), extension)
                    }
                    _ => format!("{base}.{extension}"),
                };
                return Ok(vec![File { path, pages }]);
            }
            Ok(chosen
                .iter()
                .zip(pages)
                .map(|((number, board), page)| File {
                    path: names.labelled(&base, &board_label(&board.name, *number), extension),
                    pages: vec![page],
                })
                .collect())
        }
    }
}

/// Ciò che una derivazione rifiutata vuol dire per l'export.
fn derive_problem(doc: &DocId, error: DeriveError) -> Problem {
    let stop =
        |key: &str, args: Vec<Arg>| Problem::Stop(PluginError::BadArgs(Text::message(key, args)));
    match error {
        DeriveError::UnknownBoard(board) => stop(
            E_BOARD,
            vec![Arg::text("doc", doc.to_string()), Arg::text("board", board)],
        ),
        DeriveError::UnknownObject(id) => stop(
            E_OBJECT,
            vec![Arg::text("doc", doc.to_string()), Arg::text("id", id)],
        ),
        // Le opzioni le hanno già controllate: qui non arrivano.
        DeriveError::EmptySelection | DeriveError::BadBox => {
            Problem::Failed("the selection has no objects or no area".to_string())
        }
        DeriveError::Read(error) => Problem::Failed(unreadable(&error)),
    }
}

pub(super) fn not_utf8() -> String {
    "not a readable SVG drawing: the text is not UTF-8".to_string()
}

/// Il motivo, per il log, di un testo che la scena non legge.
pub(super) fn unreadable(error: &ReadError) -> String {
    match error {
        ReadError::Malformed { offset, kind } => {
            format!("not a readable SVG drawing: malformed XML at byte {offset} ({kind:?})")
        }
        ReadError::NotSvg { offset } => format!(
            "not a readable SVG drawing: the root at byte {offset} is not an SVG svg element"
        ),
    }
}

/// Un disegno che si esporta: il titolo, le immagini del vault che le sue
/// pagine nominano, lette una volta per tutte, e ciò che la lettura ha
/// lasciato fuori.
pub(super) struct Drawing<'h> {
    pub(super) doc: DocId,
    pub(super) title: String,
    images: VaultImages<'h>,
    /// I caratteri che le sue pagine nominano, di Fub e del vault.
    pub(super) typefaces: Typefaces<'h>,
    refused: Refused,
    /// I caratteri che nessuno dei suoi caratteri ha.
    missing: BTreeSet<char>,
    /// Vero se il PDF ha chiesto l'abbondanza e il disegno intero non dice
    /// la sua misura, quindi non ne ha.
    pub(super) unbled: bool,
    /// I byte che l'export tiene ancora, entro [`PLUGIN_EXPORT_LIMIT`]: l'SVG
    /// pulito ci misura le immagini che porta dentro, così un file che non
    /// ci starebbe tiene il percorso di quelle di troppo invece di fallire.
    /// La stessa regola vale con ogni host, e i file restano gli stessi.
    pub(super) room: usize,
}

impl<'h> Drawing<'h> {
    fn new(host: &'h dyn ReadApi, vault_fonts: &'h VaultFonts, doc: &DocId, room: usize) -> Self {
        Drawing {
            doc: doc.clone(),
            title: title(host, doc),
            images: VaultImages::new(host, doc),
            typefaces: Typefaces::new(Some((host, vault_fonts))),
            refused: Refused::default(),
            missing: BTreeSet::new(),
            unbled: false,
            room,
        }
    }

    /// L'albero di una pagina. `Err` è il motivo, per il log: un disegno che
    /// non si legge non ferma gli altri.
    pub(super) fn tree(&mut self, text: &[u8]) -> Result<Tree, String> {
        let refused = Arc::new(Mutex::new(Refused::default()));
        let tree = Tree::from_data(
            text,
            &options(&refused, Some(&self.images), &self.typefaces),
        )
        .map_err(|error| format!("not a readable SVG drawing: {error}"))?;
        self.refused.merge(std::mem::take(&mut *lock(&refused)));
        self.missing.extend(missing_glyphs(&tree));
        Ok(tree)
    }

    /// L'URI `data:` dell'immagine del vault che `href` nomina, letta come
    /// per gli altri formati: nell'SVG pulito un percorso del vault, fuori dal
    /// vault, non porterebbe a niente. `None` per ciò che non è un percorso,
    /// che resta com'è, e per un'immagine che resta fuori, che il log dice;
    /// anche per una che non sta più in `room`, i byte che il file ha ancora.
    pub(super) fn embed(&mut self, href: &str, room: &mut usize) -> Option<String> {
        let path = vault_path(href)?;
        let found = self.images.image(&path).and_then(|kind| {
            data_uri(&kind)
                .filter(|uri| uri.len() <= *room)
                .ok_or(LeftOut::OverExport)
        });
        match found {
            Ok(uri) => {
                *room -= uri.len();
                Some(uri)
            }
            Err(why) => {
                let shown: String = href.chars().take(HREF_SHOWN).collect();
                self.refused.vault.entry(why).or_default().insert(shown);
                None
            }
        }
    }

    /// Le note di un disegno esportato: ciò che è rimasto fuori, i caratteri
    /// che non ci sono e quelli che mancano, e l'abbondanza che non c'è.
    fn notes(&self, report: &mut ExportReport) {
        let refused = &self.refused;
        let embedded = (refused.embedded > 0).then(|| {
            let count = refused.embedded;
            format!(
                "{count} embedded {} and {} not exported",
                if count == 1 {
                    "image is not a readable PNG, JPEG, GIF or WebP image"
                } else {
                    "images are not readable PNG, JPEG, GIF or WebP images"
                },
                if count == 1 { "was" } else { "were" },
            )
        });
        let notes = std::iter::once(external_note(&refused.external, "the vault"))
            .chain(
                refused
                    .vault
                    .iter()
                    .map(|(why, images)| vault_note(*why, images)),
            )
            .chain([
                embedded,
                glyphs_note(&self.missing),
                self.unbled.then(|| UNBLED_NOTE.to_string()),
            ])
            .chain(self.typefaces.notes().into_iter().map(Some));
        for message in notes.flatten() {
            report
                .log
                .push(TransferNote::warning(message).about(self.doc.to_string()));
        }
    }
}
