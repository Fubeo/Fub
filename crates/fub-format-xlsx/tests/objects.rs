//! Gli oggetti di una cartella nella finestra: un'immagine, una forma e un
//! grafico in un disegno di DrawingML come lo scrive Excel, e un grafico
//! sparkline nell'estensione del foglio.

mod common;

use base64::Engine as _;
use common::{sheet, Package};
use fub_abi::{
    GridBytesProvider, GridBytesSession, GridBytesWindow, GridCommand, GridCommandOutcome,
    GridCommandRequest, GridJournal, GridObjectKind, GridObjectMissing, GridShapeAlign,
    GridShapeAnchor, GridShapeKind, GridWindowRequest, Revision, MAX_GRID_MEDIA_BYTES,
};
use fub_format_xlsx::grid::{XlsxGridProvider, XLSX_GRID_SURFACE};

const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

fn anchor(from: (u32, u32), to: (u32, u32), edit_as: &str, body: &str) -> String {
    format!(
        "<xdr:twoCellAnchor{edit_as}><xdr:from><xdr:col>{}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>{}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>{body}<xdr:clientData/></xdr:twoCellAnchor>",
        from.1, from.0, to.1, to.0
    )
}

fn picture(id: u32, name: &str, descr: &str, rel: &str) -> String {
    format!(
        r#"<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="{id}" name="{name}" descr="{descr}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="{rel}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>"#
    )
}

/// Una cartella con i valori 3, 5 e 2 in A1:A3, un grafico sparkline in B5 e
/// un disegno: un'immagine in B2:C3, una seconda in un formato che il browser
/// non mostra, un rettangolo con il testo in E2:G4 e un istogramma di A1:A3 in
/// A7:F20.
fn workbook() -> Vec<u8> {
    let drawing = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="{R}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">{}{}{}{}</xdr:wsDr>"#,
        anchor(
            (1, 1),
            (3, 2),
            r#" editAs="oneCell""#,
            &picture(2, "Immagine 1", "Il logo", "rImg")
        ),
        anchor(
            (1, 8),
            (3, 9),
            r#" editAs="oneCell""#,
            &picture(3, "Immagine 2", "", "rEmf")
        ),
        anchor(
            (1, 4),
            (4, 7),
            "",
            r#"<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="4" name="Rettangolo 3"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="it-IT" sz="1100"/><a:t>Totale</a:t></a:r></a:p></xdr:txBody></xdr:sp>"#,
        ),
        anchor(
            (6, 0),
            (20, 5),
            "",
            r#"<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="5" name="Grafico 4"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rChart"/></a:graphicData></a:graphic></xdr:graphicFrame>"#,
        ),
    );
    let chart = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Vendite</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:f>Foglio1!$A$1:$A$3</c:f></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>"#;
    let drawing_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImg" Type="{R}/image" Target="../media/image1.png"/><Relationship Id="rEmf" Type="{R}/image" Target="../media/image2.emf"/><Relationship Id="rChart" Type="{R}/chart" Target="../charts/chart1.xml"/></Relationships>"#
    );
    let body = r#"<sheetData><row r="1"><c r="A1"><v>3</v></c></row><row r="2"><c r="A2"><v>5</v></c></row><row r="3"><c r="A3"><v>2</v></c></row></sheetData><drawing r:id="rD"/><extLst><ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:sparklineGroup displayEmptyCellsAs="gap"><x14:colorSeries rgb="FF376092"/><x14:sparklines><x14:sparkline><xm:f>Foglio1!A1:A3</xm:f><xm:sqref>B5</xm:sqref></x14:sparkline></x14:sparklines></x14:sparklineGroup></x14:sparklineGroups></ext></extLst>"#;
    Package {
        sheets: vec![sheet("Foglio1", body)],
        sheet_rels: vec![(
            0,
            format!(
                r#"<Relationship Id="rD" Type="{R}/drawing" Target="../drawings/drawing1.xml"/>"#
            ),
        )],
        parts: vec![
            (
                "xl/drawings/drawing1.xml",
                "application/vnd.openxmlformats-officedocument.drawing+xml",
                drawing.into_bytes(),
            ),
            (
                "xl/drawings/_rels/drawing1.xml.rels",
                "application/vnd.openxmlformats-package.relationships+xml",
                drawing_rels.into_bytes(),
            ),
            (
                "xl/charts/chart1.xml",
                "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
                chart.as_bytes().to_vec(),
            ),
            (
                "xl/media/image1.png",
                "image/png",
                base64::engine::general_purpose::STANDARD
                    .decode(PNG)
                    .unwrap(),
            ),
            (
                "xl/media/image2.emf",
                "image/x-emf",
                vec![1, 0, 0, 0, 0x6c, 0, 0, 0],
            ),
        ],
        ..Package::default()
    }
    .bytes()
}

struct Opened {
    provider: XlsxGridProvider,
    session: GridBytesSession,
}

fn opened() -> Opened {
    opened_from(&workbook())
}

fn opened_from(bytes: &[u8]) -> Opened {
    let bytes = bytes.to_vec();
    let mut provider = XlsxGridProvider::new();
    let session = provider
        .open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            &GridJournal::new(),
        )
        .expect("la cartella si apre");
    Opened { provider, session }
}

impl Opened {
    fn window(&mut self, rows: (u32, u32), columns: (u32, u32), known: &[&str]) -> GridBytesWindow {
        let window = self
            .provider
            .window(
                &self.session.instance,
                GridWindowRequest {
                    revision: self.session.revision.clone(),
                    sheet: self.session.sheets[0].id.clone(),
                    row_start: rows.0,
                    row_count: rows.1,
                    column_start: columns.0,
                    column_count: columns.1,
                    known_media: known.iter().map(|key| (*key).to_owned()).collect(),
                },
            )
            .expect("window");
        window
            .validate()
            .expect("la finestra rispetta il contratto");
        window
    }

    /// Dà un comando sulla revisione corrente, e la porta avanti.
    fn command(&mut self, id: &str, params: &str) -> GridCommandOutcome {
        let outcome = self
            .provider
            .command(
                &self.session.instance,
                GridCommandRequest {
                    revision: self.session.revision.clone(),
                    command: GridCommand {
                        id: id.into(),
                        params: params.into(),
                        sheet: self.session.sheets[0].id.clone(),
                        selection: "A1".into(),
                        active: "A1".into(),
                    },
                },
            )
            .unwrap_or_else(|error| panic!("{id}: {error:?}"));
        self.session.revision = outcome.commit.revision.clone();
        outcome
    }
}

/// Una cartella con le immagini PNG `images`, una per riga dalla prima, e
/// nient'altro.
fn with_images(images: &[Vec<u8>]) -> Vec<u8> {
    let anchors: String = (0..images.len())
        .map(|index| {
            let row = u32::try_from(index).unwrap() * 4;
            anchor(
                (row, 0),
                (row + 3, 2),
                r#" editAs="oneCell""#,
                &picture(10 + row, "Immagine", "", &format!("r{index}")),
            )
        })
        .collect();
    let drawing = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="{R}">{anchors}</xdr:wsDr>"#
    );
    let relations: String = (0..images.len())
        .map(|index| {
            format!(
                r#"<Relationship Id="r{index}" Type="{R}/image" Target="../media/image{index}.png"/>"#
            )
        })
        .collect();
    let mut parts = vec![
        (
            "xl/drawings/drawing1.xml".to_owned(),
            "application/vnd.openxmlformats-officedocument.drawing+xml",
            drawing.into_bytes(),
        ),
        (
            "xl/drawings/_rels/drawing1.xml.rels".to_owned(),
            "application/vnd.openxmlformats-package.relationships+xml",
            format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{relations}</Relationships>"#
            )
            .into_bytes(),
        ),
    ];
    for (index, data) in images.iter().enumerate() {
        parts.push((
            format!("xl/media/image{index}.png"),
            "image/png",
            data.clone(),
        ));
    }
    Package {
        sheets: vec![sheet(
            "Foglio1",
            r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><drawing r:id="rD"/>"#,
        )],
        sheet_rels: vec![(
            0,
            format!(
                r#"<Relationship Id="rD" Type="{R}/drawing" Target="../drawings/drawing1.xml"/>"#
            ),
        )],
        parts: parts
            .iter()
            .map(|(name, kind, data)| (name.as_str(), *kind, data.clone()))
            .collect(),
        ..Package::default()
    }
    .bytes()
}

/// Byte che cominciano come un PNG, lunghi `len`, diversi per `seed`.
fn png_like(len: usize, seed: u8) -> Vec<u8> {
    let mut data = base64::engine::general_purpose::STANDARD
        .decode(PNG)
        .unwrap();
    data.resize(len, seed);
    data
}

#[test]
fn la_finestra_porta_immagini_forme_grafici_e_sparkline_nell_ordine_del_disegno() {
    let mut opened = opened();
    let codes: Vec<&str> = opened
        .session
        .notices
        .iter()
        .map(|notice| notice.code.as_str())
        .collect();
    assert!(
        !codes.iter().any(|code| code.starts_with("not-shown-")),
        "gli oggetti si mostrano: {codes:?}"
    );
    let window = opened.window((0, 30), (0, 10), &[]);
    let kinds: Vec<GridObjectKind> = window.objects.iter().map(|object| object.kind).collect();
    assert_eq!(
        kinds,
        [
            GridObjectKind::Sparkline,
            GridObjectKind::Image,
            GridObjectKind::Image,
            GridObjectKind::Shape,
            GridObjectKind::Chart,
        ]
    );

    let sparkline = &window.objects[0];
    assert_eq!((sparkline.row, sparkline.column), (4, 1));
    assert!(sparkline
        .svg
        .as_deref()
        .is_some_and(|svg| svg.starts_with("<svg")));

    let image = &window.objects[1];
    assert_eq!(
        (image.row, image.column, image.alt.as_str()),
        (1, 1, "Il logo")
    );
    assert!(image.width > 0.0 && image.height > 0.0);
    let media = image.media.as_ref().expect("i byte dell'immagine");
    assert_eq!(media.mime, "image/png");
    assert_eq!(media.key.len(), 32);
    let data = base64::engine::general_purpose::STANDARD
        .decode(media.data.as_deref().expect("la prima volta, i byte"))
        .unwrap();
    assert!(data.starts_with(b"\x89PNG"));

    let emf = &window.objects[2];
    assert_eq!(emf.missing, Some(GridObjectMissing::Unsupported));
    assert!(emf.media.is_none());

    let shape = window.objects[3]
        .shape
        .as_ref()
        .expect("l'aspetto della forma");
    assert_eq!(shape.kind, GridShapeKind::Rectangle);
    assert_eq!(shape.fill.as_deref(), Some("#4472C4"));
    assert_eq!(shape.line, None, "il contorno è spento");
    assert_eq!(shape.text, "Totale");
    assert_eq!(
        (shape.align, shape.anchor),
        (GridShapeAlign::Center, GridShapeAnchor::Middle)
    );
    assert_eq!((window.objects[3].row, window.objects[3].column), (1, 4));

    let chart = &window.objects[4];
    assert_eq!(
        (chart.row, chart.column, chart.alt.as_str()),
        (6, 0, "Vendite")
    );
    let svg = chart.svg.as_deref().expect("il disegno del grafico");
    assert!(svg.starts_with("<svg") && svg.contains("Vendite"), "{svg}");
}

#[test]
fn i_byte_di_un_immagine_che_la_shell_ha_gia_non_tornano() {
    let mut opened = opened();
    let first = opened.window((0, 30), (0, 10), &[]);
    let key = first.objects[1].media.as_ref().unwrap().key.clone();
    let again = opened.window((0, 30), (0, 10), &[&key]);
    let media = again.objects[1].media.as_ref().unwrap();
    assert_eq!(media.key, key, "la chiave è la stessa in ogni finestra");
    assert_eq!(media.data, None);
}

#[test]
fn un_oggetto_ancorato_fuori_dalla_finestra_che_la_tocca_arriva_lo_stesso() {
    let mut opened = opened();
    // Il grafico comincia in A7 e arriva alla riga 21: una finestra dalla
    // riga 15 lo tocca, una dalla riga 40 no.
    let touching = opened.window((14, 4), (0, 3), &[]);
    let kinds: Vec<GridObjectKind> = touching.objects.iter().map(|object| object.kind).collect();
    assert_eq!(kinds, [GridObjectKind::Chart]);
    assert!(opened.window((40, 4), (0, 3), &[]).objects.is_empty());
}

#[test]
fn un_immagine_oltre_la_misura_non_porta_i_byte() {
    // In base64 i byte crescono di un terzo: questi passano la misura.
    let large = MAX_GRID_MEDIA_BYTES / 4 * 3 + 3;
    let mut opened = opened_from(&with_images(&[png_like(large, 1)]));
    let window = opened.window((0, 8), (0, 4), &[]);
    assert_eq!(window.objects.len(), 1);
    assert_eq!(window.objects[0].missing, Some(GridObjectMissing::TooLarge));
    assert!(window.objects[0].media.is_none());
}

#[test]
fn le_immagini_che_una_finestra_non_porta_arrivano_con_la_dopo() {
    // Due immagini da poco più di 2 MiB in base64: la finestra ne porta
    // 4 MiB, la seconda arriva con la sua chiave e senza byte.
    let size = 3 * 512 * 1024 + 3;
    let mut opened = opened_from(&with_images(&[png_like(size, 1), png_like(size, 2)]));
    let first = opened.window((0, 8), (0, 4), &[]);
    assert_eq!(first.objects.len(), 2);
    let carried = first.objects[0].media.as_ref().unwrap();
    let left = first.objects[1].media.as_ref().unwrap();
    assert!(carried.data.is_some());
    assert_eq!(left.data, None, "oltre i byte della finestra");
    assert_ne!(carried.key, left.key);
    let next = opened.window((0, 8), (0, 4), &[&carried.key]);
    assert_eq!(next.objects[0].media.as_ref().unwrap().data, None);
    assert!(next.objects[1].media.as_ref().unwrap().data.is_some());
}

#[test]
fn una_casella_di_testo_si_inserisce_si_scrive_si_sposta_e_resta_nel_file() {
    let bytes = workbook();
    let mut opened = opened_from(&bytes);
    let mut journal = String::new();
    let step = |opened: &mut Opened, journal: &mut String, id: &str, params: &str| {
        let outcome = opened.command(id, params);
        let edit = &outcome.commit.edit;
        let (from, to) = (edit.from as usize, edit.to as usize);
        *journal = format!("{}{}{}", &journal[..from], edit.inserted, &journal[to..]);
        outcome
    };
    let inserted = step(
        &mut opened,
        &mut journal,
        "insert.textBox",
        r#"{"at":"H2","width":120,"height":40,"text":"Nota"}"#,
    );
    let result: serde_json::Value =
        serde_json::from_str(inserted.result.as_deref().expect("il risultato")).unwrap();
    let id = result["shape"].as_u64().expect("l'id della casella");
    step(
        &mut opened,
        &mut journal,
        "shape.setText",
        &format!(r#"{{"id":{id},"text":"Nota di marzo"}}"#),
    );
    step(
        &mut opened,
        &mut journal,
        "object.move",
        &format!(r#"{{"kind":"shape","id":{id},"at":"I4","dx":5,"dy":2,"width":150,"height":50}}"#),
    );
    let shown = |window: &GridBytesWindow| {
        window
            .objects
            .iter()
            .find(|object| object.kind == GridObjectKind::Shape && u64::from(object.id) == id)
            .map(|object| {
                (
                    object.row,
                    object.column,
                    object.dx,
                    object.dy,
                    object.width,
                    object.height,
                    object.shape.as_ref().unwrap().text.clone(),
                )
            })
    };
    let moved = (3, 8, 5.0, 2.0, 150.0, 50.0, "Nota di marzo".to_owned());
    assert_eq!(
        shown(&opened.window((0, 30), (0, 12), &[])),
        Some(moved.clone())
    );

    // Il giornale si rifà, e il file salvato ha la casella dove è stata
    // lasciata, con l'immagine e il grafico di prima.
    let mut again = XlsxGridProvider::new();
    let reopened = again
        .open(
            XLSX_GRID_SURFACE,
            &bytes,
            Revision::of_bytes(&bytes),
            &GridJournal::parse(&journal).unwrap(),
        )
        .unwrap();
    assert_eq!(reopened.revision, opened.session.revision);
    let saved = again
        .bytes_to_write(&reopened.instance, reopened.revision.clone())
        .unwrap();
    let mut read = opened_from(&saved);
    let window = read.window((0, 30), (0, 12), &[]);
    assert_eq!(shown(&window), Some(moved));
    let kinds: Vec<GridObjectKind> = window.objects.iter().map(|object| object.kind).collect();
    assert!(
        kinds.contains(&GridObjectKind::Image) && kinds.contains(&GridObjectKind::Chart),
        "{kinds:?}"
    );

    // Cancellata, non c'è più.
    step(
        &mut opened,
        &mut journal,
        "object.delete",
        &format!(r#"{{"kind":"shape","id":{id}}}"#),
    );
    assert_eq!(shown(&opened.window((0, 30), (0, 12), &[])), None);
}
