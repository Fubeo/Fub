//! What GridCraft writes from its model keeps the file's own form while the model still holds
//! what was read: unmodelled attributes, elements it never reads, the theme and the core
//! properties as they were.

use gridcraft_model::{Orientation, Workbook};

use crate::package::Package;
use crate::{read_xlsx, write_xlsx};

const THEME: &str = r#"<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Ufficio"><a:themeElements><a:clrScheme name="Ufficio"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Ufficio"><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>"#;
const CORE: &str = r#"<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Bilancio</dc:title><cp:lastModifiedBy>Anna</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-02T03:04:05Z</dcterms:created></cp:coreProperties>"#;
const SHEET: &str = r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision"><sheetPr codeName="Foglio1" filterMode="0"><outlinePr summaryBelow="0"/><pageSetUpPr autoPageBreaks="0"/></sheetPr><sheetFormatPr baseColWidth="10" defaultRowHeight="14.4" x14ac:dyDescent="0.3" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="B2:C3"/></mergeCells><phoneticPr fontId="1" type="noConversion"/><pageMargins left="0.3" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="256" horizontalDpi="300" verticalDpi="300" copies="2"/><ignoredErrors><ignoredError sqref="A1" numberStoredAsText="1" xr:uid="x"/></ignoredErrors></worksheet>"#;

fn source() -> Vec<u8> {
    source_with(SHEET)
}

fn source_with(sheet: &str) -> Vec<u8> {
    let types = r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#;
    let root = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#;
    let wb = r#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr codeName="QuestaCartella" defaultThemeVersion="166925" filterPrivacy="1"/><sheets><sheet name="Dati" sheetId="1" r:id="rId1"/></sheets><webPublishing codePage="1252"/></workbook>"#;
    let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>"#;
    super::make_zip(&[
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", root.as_bytes()),
        ("docProps/core.xml", CORE.as_bytes()),
        ("xl/workbook.xml", wb.as_bytes()),
        ("xl/_rels/workbook.xml.rels", rels.as_bytes()),
        ("xl/theme/theme1.xml", THEME.as_bytes()),
        ("xl/worksheets/sheet1.xml", sheet.as_bytes()),
    ])
}

fn part(bytes: &[u8], name: &str) -> String {
    let mut pkg = Package::open(bytes).unwrap();
    String::from_utf8(pkg.read(name).unwrap().unwrap()).unwrap()
}

fn saved(wb: &Workbook) -> Vec<u8> {
    let bytes = write_xlsx(wb).unwrap();
    // Every part GridCraft writes stays well-formed XML, without an attribute twice.
    let mut pkg = Package::open(&bytes).unwrap();
    for name in ["xl/workbook.xml", "xl/worksheets/sheet1.xml"] {
        let text = String::from_utf8(pkg.read(name).unwrap().unwrap()).unwrap();
        let mut reader = quick_xml::Reader::from_str(&text);
        loop {
            match reader.read_event().unwrap() {
                quick_xml::events::Event::Eof => break,
                quick_xml::events::Event::Start(e) | quick_xml::events::Event::Empty(e) => {
                    for a in e.attributes() {
                        a.unwrap_or_else(|err| panic!("{name}: {err}: {text}"));
                    }
                }
                _ => {}
            }
        }
    }
    bytes
}

#[test]
fn an_open_and_save_keeps_the_forms_of_the_file() {
    let (wb, report) = read_xlsx(&source()).unwrap();
    assert_eq!(report.warnings, ["no styles part"]);
    let bytes = saved(&wb);
    assert_eq!(part(&bytes, "xl/theme/theme1.xml"), THEME);
    assert_eq!(part(&bytes, "docProps/core.xml"), CORE);
    let book = part(&bytes, "xl/workbook.xml");
    assert!(book.contains(r#"<workbookPr filterPrivacy="1" codeName="QuestaCartella" defaultThemeVersion="166925"/>"#), "{book}");
    assert!(book.contains(r#"<webPublishing codePage="1252"/>"#), "{book}");
    let sheet = part(&bytes, "xl/worksheets/sheet1.xml");
    for kept in [
        r#"<sheetPr codeName="Foglio1" filterMode="0"><outlinePr summaryBelow="0"/><pageSetUpPr autoPageBreaks="0"/></sheetPr>"#,
        r#"<sheetFormatPr defaultRowHeight="14.4" baseColWidth="10"/>"#,
        r#"</mergeCells><phoneticPr fontId="1" type="noConversion"/>"#,
        r#"<pageMargins left="0.3" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>"#,
        r#"<pageSetup paperSize="256" horizontalDpi="300" verticalDpi="300" copies="2"/>"#,
        r#"<ignoredErrors><ignoredError sqref="A1" numberStoredAsText="1"/></ignoredErrors>"#,
    ] {
        assert!(sheet.contains(kept), "{kept} in {sheet}");
    }
    // And again from GridCraft's own file.
    let (back, _) = read_xlsx(&bytes).unwrap();
    assert_eq!(part(&saved(&back), "xl/worksheets/sheet1.xml"), sheet);
}

#[test]
fn a_change_to_the_model_writes_gridcraft_own_form() {
    let (mut wb, _) = read_xlsx(&source()).unwrap();
    wb.theme.colors[4] = 0x112233;
    wb.props.title = "Altro".into();
    let s = wb.sheet_mut(0).unwrap();
    s.print.orientation = Orientation::Landscape;
    s.print.paper = "A4".into();
    s.default_row_height = 30.0;
    let bytes = saved(&wb);
    assert!(part(&bytes, "xl/theme/theme1.xml").contains("112233"));
    let core = part(&bytes, "docProps/core.xml");
    assert!(core.contains("<dc:title>Altro</dc:title>") && !core.contains("lastModifiedBy"), "{core}");
    let sheet = part(&bytes, "xl/worksheets/sheet1.xml");
    assert!(sheet.contains(r#"<pageSetup paperSize="9" orientation="landscape" horizontalDpi="300" verticalDpi="300" copies="2"/>"#), "{sheet}");
    assert!(sheet.contains(r#"customHeight="1""#), "{sheet}");
}

#[test]
fn a_sheet_without_a_page_setup_keeps_having_none_until_one_is_chosen() {
    let bare = SHEET.replace(r#"<pageSetup paperSize="256" horizontalDpi="300" verticalDpi="300" copies="2"/>"#, "");
    let (mut wb, _) = read_xlsx(&source_with(&bare)).unwrap();
    let sheet = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(!sheet.contains("<pageSetup"), "{sheet}");
    wb.sheet_mut(0).unwrap().print.orientation = Orientation::Landscape;
    let sheet = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(sheet.contains(r#"<pageSetup orientation="landscape"/>"#), "{sheet}");
}

fn styles_of(wb: &Workbook) -> String {
    part(&write_xlsx(wb).unwrap(), "xl/styles.xml")
}

#[test]
fn style_records_keep_the_form_of_the_file_until_their_model_changes() {
    let font = r#"<font><sz val="11"/><color theme="4" tint="-0.249977111117893"/><name val="Calibri Light"/><scheme val="major"/></font>"#;
    let fill = r#"<fill><patternFill patternType="solid"><fgColor theme="6" tint="-0.499984740745262"/><bgColor indexed="64"/></patternFill></fill>"#;
    let styles = format!(
        r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>{font}</fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>{fill}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#
    );
    let rels = r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#;
    let file = super::minimal(r#"<sheetData><row r="1"><c r="A1" s="1"><v>1</v></c></row></sheetData>"#, &[("xl/styles.xml", &styles)], rels, "");
    let (mut wb, _) = read_xlsx(&file).unwrap();
    let out = styles_of(&wb);
    assert!(out.contains(font) && out.contains(fill), "{out}");
    // A changed record is written in GridCraft's own form; the others stay as they were.
    let a1 = gridcraft_core::CellRef::new(0, 0);
    let s = wb.sheet(0).unwrap().style_id(a1);
    let bold = wb.styles.derive(s, |st| st.font.bold = true);
    wb.sheet_mut(0).unwrap().set_style(a1, bold);
    let out = styles_of(&wb);
    assert!(out.contains(r#"<font><b/><sz val="11"/><color theme="4" tint="-0.25"/><name val="Calibri Light"/>"#) && out.contains(fill), "{out}");
}

#[test]
fn a_stated_swiss_family_is_not_the_same_font_as_none() {
    let styles = r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><sz val="10"/><name val="Arial"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>"#;
    let rels = r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#;
    let file = super::minimal(r#"<sheetData><row r="1"><c r="A1" s="1"><v>1</v></c></row></sheetData>"#, &[("xl/styles.xml", styles)], rels, "");
    let (wb, _) = read_xlsx(&file).unwrap();
    let a1 = wb.sheet(0).unwrap().style_id(gridcraft_core::CellRef::new(0, 0));
    assert_eq!(wb.styles.get(a1).font.family, Some(2));
    let out = styles_of(&wb);
    assert!(out.contains(r#"<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><sz val="10"/><name val="Arial"/><family val="2"/></font></fonts>"#), "{out}");
}

#[test]
fn a_cell_format_keeps_its_named_style_and_its_quote_prefix() {
    let styles = r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><u/><sz val="11"/><color theme="10"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs><cellStyles count="2"><cellStyle name="Collegamento" xfId="1" builtinId="8"/><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>"#;
    let rels = r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#;
    let cells = r#"<sheetData><row r="1"><c r="A1" s="1" t="inlineStr"><is><t>link</t></is></c><c r="B1" s="2" t="inlineStr"><is><t>=1</t></is></c></row></sheetData>"#;
    let (wb, _) = read_xlsx(&super::minimal(cells, &[("xl/styles.xml", styles)], rels, "")).unwrap();
    let out = styles_of(&wb);
    assert!(out.contains(r#"<cellStyle name="Collegamento" xfId="1" builtinId="8"/>"#), "{out}");
    assert!(out.contains(r#"fontId="1" fillId="0" borderId="0" xfId="1""#), "{out}");
    assert!(out.contains(r#"xfId="0" quotePrefix="1"/>"#), "{out}");
}

#[test]
fn column_widths_keep_the_digits_of_the_file() {
    let sheet = SHEET.replace(
        r#"<sheetData>"#,
        r#"<cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="3" width="20.5703125" customWidth="1"/></cols><sheetData>"#,
    );
    let (mut wb, _) = read_xlsx(&source_with(&sheet)).unwrap();
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains(r#"<col min="1" max="1" width="40" customWidth="1"/><col min="2" max="3" width="20.5703125" customWidth="1"/>"#), "{out}");
    // A width changed to one the file never had is GridCraft's.
    wb.sheet_mut(0).unwrap().cols.get_mut(&0).unwrap().size = Some(100.0);
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains(r#"<col min="1" max="1" width="14.28125" customWidth="1"/>"#), "{out}");
}

#[test]
fn a_split_view_and_unused_fit_counts_stay_as_the_file_had_them() {
    let sheet = SHEET
        .replace(
            "<sheetFormatPr",
            r#"<sheetViews><sheetView workbookViewId="0"><pane xSplit="16230" ySplit="3840" topLeftCell="AQ1000" activePane="bottomRight"/><selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews><sheetFormatPr"#,
        )
        .replace(r#"<pageSetup paperSize="256""#, r#"<pageSetup paperSize="256" fitToHeight="0""#);
    let (mut wb, _) = read_xlsx(&source_with(&sheet)).unwrap();
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(
        out.contains(r#"<pane xSplit="16230" ySplit="3840" topLeftCell="AQ1000" activePane="bottomRight"/><selection pane="bottomRight" activeCell="B2" sqref="B2"/>"#),
        "{out}"
    );
    assert!(out.contains(r#"<pageSetup paperSize="256" fitToHeight="0""#), "{out}");
    // Freezing panes replaces the split.
    wb.sheet_mut(0).unwrap().freeze = Some((1, 0));
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(!out.contains("16230") && out.contains(r#"state="frozen""#), "{out}");
}

#[test]
fn a_formula_keeps_the_spelling_of_the_file_while_it_is_the_same_formula() {
    let sheet = SHEET.replace(
        r#"<c r="A1"><v>1</v></c>"#,
        r#"<c r="A1"><v>1</v></c><c r="B1"><f>SUM( A1 , 2 )</f><v>3</v></c><c r="C1"><f>_xlfn.XLOOKUP(A1, A1:A3,B1:B3)</f><v>3</v></c>"#,
    );
    let (mut wb, _) = read_xlsx(&source_with(&sheet)).unwrap();
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains("<f>SUM( A1 , 2 )</f>") && out.contains("<f>_xlfn.XLOOKUP(A1, A1:A3,B1:B3)</f>"), "{out}");
    let formula = Some(std::sync::Arc::new(gridcraft_model::Formula::new("SUM(A1,3)")));
    let cell = gridcraft_model::Cell { value: gridcraft_core::Value::Number(4.0), formula, style: gridcraft_model::StyleId::DEFAULT, rich: None };
    wb.sheet_mut(0).unwrap().set_cell(gridcraft_core::CellRef::new(0, 1), cell);
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains("<f>SUM(A1,3)</f>"), "{out}");
}

#[test]
fn margins_keep_their_digits_until_they_change() {
    let sheet = SHEET.replace(r#"header="0.3" footer="0.3""#, r#"header="0.31496062992125984" footer="0.3""#);
    let (mut wb, _) = read_xlsx(&source_with(&sheet)).unwrap();
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains(r#"header="0.31496062992125984" footer="0.3"/>"#), "{out}");
    wb.sheet_mut(0).unwrap().print.margins[0] = 1.0;
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains(r#"<pageMargins left="1" right="0.7" top="0.75" bottom="0.75" header="0.31496063" footer="0.3"/>"#), "{out}");
}

#[test]
fn formatted_runs_of_a_text_stay_until_the_text_changes() {
    let sst = r#"<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><r><rPr><b/><sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t>Uno</t></r><r><t xml:space="preserve"> due</t></r></si><si><t>Tre</t></si></sst>"#;
    let rels = r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>"#;
    let body = r#"<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><r><rPr><i/></rPr><t>Quattro</t></r></is></c></row></sheetData>"#;
    let (mut wb, _) = read_xlsx(&super::minimal(body, &[("xl/sharedStrings.xml", sst)], rels, "")).unwrap();
    let a1 = gridcraft_core::CellRef::new(0, 0);
    assert_eq!(wb.sheet(0).unwrap().cell(a1).unwrap().value, gridcraft_core::Value::Text("Uno due".into()));
    let out = part(&write_xlsx(&wb).unwrap(), "xl/sharedStrings.xml");
    let runs = r#"<si><r><rPr><b/><sz val="11"/><color theme="1"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t>Uno</t></r><r><t xml:space="preserve"> due</t></r></si>"#;
    assert!(out.contains(runs), "{out}");
    assert!(out.contains("<si><t>Tre</t></si>") && out.contains(r#"<r><rPr><i/></rPr><t>Quattro</t></r>"#), "{out}");
    wb.sheet_mut(0).unwrap().set_value(a1, gridcraft_core::Value::Text("Cinque".into()));
    let out = part(&write_xlsx(&wb).unwrap(), "xl/sharedStrings.xml");
    assert!(!out.contains("<b/>") && out.contains("<si><t>Cinque</t></si>"), "{out}");
}

#[test]
fn a_note_keeps_its_formatted_text_until_it_changes() {
    let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/></Relationships>"#;
    let runs = r#"<r><rPr><b/><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t>Anna:</t></r><r><rPr><sz val="9"/><color indexed="81"/><rFont val="Tahoma"/><family val="2"/></rPr><t xml:space="preserve">
da rivedere</t></r>"#;
    let comments = format!(
        r#"<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Anna</author></authors><commentList><comment ref="A1" authorId="0"><text>{runs}</text></comment></commentList></comments>"#
    );
    let body = r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>"#;
    let (mut wb, _) =
        read_xlsx(&super::minimal(body, &[("xl/worksheets/_rels/sheet1.xml.rels", rels), ("xl/comments1.xml", &comments)], "", "")).unwrap();
    let a1 = gridcraft_core::CellRef::new(0, 0);
    assert_eq!(wb.sheet(0).unwrap().comments[&a1].text, "da rivedere");
    let out = part(&write_xlsx(&wb).unwrap(), "xl/comments1.xml");
    assert!(out.contains(&format!("<text>{runs}</text>")), "{out}");
    // A note moved by an inserted row is the same note.
    let note = wb.sheet_mut(0).unwrap().comments.remove(&a1).unwrap();
    wb.sheet_mut(0).unwrap().comments.insert(gridcraft_core::CellRef::new(1, 0), note.clone());
    let out = part(&write_xlsx(&wb).unwrap(), "xl/comments1.xml");
    assert!(out.contains(&format!(r#"<comment ref="A2" authorId="0"><text>{runs}</text>"#)), "{out}");
    wb.sheet_mut(0).unwrap().comments.clear();
    wb.sheet_mut(0).unwrap().comments.insert(a1, note);
    wb.sheet_mut(0).unwrap().comments.get_mut(&a1).unwrap().text = "fatto".into();
    let out = part(&write_xlsx(&wb).unwrap(), "xl/comments1.xml");
    assert!(out.contains("<text><r><t>fatto</t></r></text>"), "{out}");
}

#[test]
fn a_link_keeps_the_text_it_displays_and_a_zero_default_width_stays() {
    let sheet = SHEET
        .replace(r#"<sheetFormatPr baseColWidth="10""#, r#"<sheetFormatPr baseColWidth="10" defaultColWidth="0" zeroHeight="1""#)
        .replace("</mergeCells>", r#"</mergeCells><hyperlinks><hyperlink ref="A1" location="Dati!B2" display="Vai al totale"/><hyperlink ref="A2" location="Dati!B2" display="Totale"/><hyperlink ref="A3" location="Dati!C3"/></hyperlinks>"#);
    let (mut wb, _) = read_xlsx(&source_with(&sheet)).unwrap();
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains(r#" defaultColWidth="0""#), "{out}");
    for kept in [
        r#"<hyperlink ref="A1" location="Dati!B2" display="Vai al totale"/>"#,
        r#"<hyperlink ref="A2" location="Dati!B2" display="Totale"/>"#,
        r#"<hyperlink ref="A3" location="Dati!C3" display="Dati!C3"/>"#,
    ] {
        assert!(out.contains(kept), "{kept} in {out}");
    }
    // A link moved to another cell keeps its text only while no other link to it reads differently.
    let links = &mut wb.sheet_mut(0).unwrap().hyperlinks;
    let a3 = links.remove(&gridcraft_core::CellRef::new(2, 0)).unwrap();
    links.insert(gridcraft_core::CellRef::new(3, 0), a3);
    let a1 = links.remove(&gridcraft_core::CellRef::new(0, 0)).unwrap();
    links.insert(gridcraft_core::CellRef::new(4, 0), a1);
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(out.contains(r#"<hyperlink ref="A4" location="Dati!C3" display="Dati!C3"/>"#), "{out}");
    assert!(out.contains(r#"<hyperlink ref="A5" location="Dati!B2" display="Dati!B2"/>"#), "{out}");
}

#[test]
fn excel_2010_conditional_formats_stay_while_the_rules_are_the_ones_read() {
    let cf = r#"<conditionalFormatting sqref="A1:A9"><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF63C384"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:id>{9B4F274F-F774-40EE-9C50-A8B810847010}</x14:id></ext></extLst></cfRule></conditionalFormatting><conditionalFormatting sqref="B1:B9"><cfRule type="cellIs" priority="2" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>"#;
    let x14 = r#"<x14:conditionalFormattings><x14:conditionalFormatting><x14:cfRule type="dataBar" id="{9B4F274F-F774-40EE-9C50-A8B810847010}"><x14:dataBar minLength="0" maxLength="100" border="1" negativeBarBorderColorSameAsPositive="0"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:borderColor rgb="FF63C384"/><x14:negativeFillColor rgb="FFFF0000"/><x14:axisColor rgb="FF000000"/></x14:dataBar></x14:cfRule><xm:sqref>A1:A9</xm:sqref></x14:conditionalFormatting><x14:conditionalFormatting><x14:cfRule type="iconSet" priority="1" id="{23404A22-2791-4FFE-B3BF-645D3DA783FE}"><x14:iconSet iconSet="3Stars"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>67</xm:f></x14:cfvo></x14:iconSet></x14:cfRule><xm:sqref>C1:C9</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings>"#;
    let ext = format!(
        r#"<extLst><ext uri="{{78C0D931-6437-407d-A8EE-F0AAD7539E65}}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">{x14}</ext></extLst>"#
    );
    let sheet =
        SHEET.replace(r#"type="noConversion"/>"#, &format!(r#"type="noConversion"/>{cf}"#)).replace("</worksheet>", &format!("{ext}</worksheet>"));
    let (mut wb, _) = read_xlsx(&source_with(&sheet)).unwrap();
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    for kept in [
        r#"<cfRule type="dataBar" priority="3">"#,
        r#"<x14:id>{9B4F274F-F774-40EE-9C50-A8B810847010}</x14:id>"#,
        r#"priority="2" operator="greaterThan""#,
        x14,
        r#"<ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}""#,
    ] {
        assert!(out.contains(kept), "{kept} in {out}");
    }
    // A rule changed: GridCraft's own form, which has no rules only Excel 2010 has.
    wb.sheet_mut(0).unwrap().cond_formats.remove(1);
    let out = part(&saved(&wb), "xl/worksheets/sheet1.xml");
    assert!(!out.contains("3Stars") && out.contains(r#"<cfRule type="dataBar" priority="1">"#), "{out}");
}

#[test]
fn the_drawing_of_the_notes_stays_while_the_notes_sit_where_they_were() {
    let rels = r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>"#;
    let comments = r#"<?xml version="1.0"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Anna</author></authors><commentList><comment ref="B2" authorId="0"><text><t>nota</t></text></comment></commentList></comments>"#;
    let vml = "<xml xmlns:v=\"urn:schemas-microsoft-com:vml\" xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:x=\"urn:schemas-microsoft-com:office:excel\">\n <o:shapelayout v:ext=\"edit\">\n  <o:idmap v:ext=\"edit\" data=\"1\"/>\n </o:shapelayout><v:shapetype id=\"_x0000_t202\" coordsize=\"21600,21600\" o:spt=\"202\" path=\"m,l,21600r21600,l21600,xe\"><v:stroke joinstyle=\"miter\"/></v:shapetype>\n <v:shape id=\"_x0000_s1025\" type=\"#_x0000_t202\" style=\"position:absolute;margin-left:107.25pt;width:96pt;height:55.5pt;z-index:1;visibility:hidden;mso-wrap-style:tight\" fillcolor=\"infoBackground [80]\"><x:ClientData ObjectType=\"Note\"><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>";
    let body = r#"<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><legacyDrawing r:id="rId2"/>"#;
    let parts = [("xl/worksheets/_rels/sheet1.xml.rels", rels), ("xl/comments1.xml", comments), ("xl/drawings/vmlDrawing1.vml", vml)];
    let (mut wb, _) = read_xlsx(&super::minimal(body, &parts, "", "")).unwrap();
    assert_eq!(part(&write_xlsx(&wb).unwrap(), "xl/drawings/vmlDrawing1.vml"), vml);
    // The text of a note is not in its drawing.
    let b2 = gridcraft_core::CellRef::new(1, 1);
    wb.sheet_mut(0).unwrap().comments.get_mut(&b2).unwrap().text = "altra".into();
    assert_eq!(part(&write_xlsx(&wb).unwrap(), "xl/drawings/vmlDrawing1.vml"), vml);
    let note = wb.sheet_mut(0).unwrap().comments.remove(&b2).unwrap();
    wb.sheet_mut(0).unwrap().comments.insert(gridcraft_core::CellRef::new(2, 1), note);
    let out = part(&write_xlsx(&wb).unwrap(), "xl/drawings/vmlDrawing1.vml");
    assert!(out.contains("<x:Row>2</x:Row>") && !out.contains("infoBackground"), "{out}");
}

/// Each part of `bytes`, with `edit` applied to its text.
fn edited(bytes: &[u8], edit: &dyn Fn(&str, String) -> String) -> Vec<u8> {
    use std::io::Read as _;
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap();
    let mut parts = Vec::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i).unwrap();
        let mut data = Vec::new();
        f.read_to_end(&mut data).unwrap();
        let name = f.name().unwrap().to_string();
        let data = match String::from_utf8(data) {
            Ok(text) => edit(&name, text).into_bytes(),
            Err(e) => e.into_bytes(),
        };
        parts.push((name, data));
    }
    let parts: Vec<(&str, &[u8])> = parts.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();
    super::make_zip(&parts)
}

#[test]
fn a_drawing_and_its_charts_stay_as_the_file_had_them_while_their_objects_do() {
    use gridcraft_model::{Anchor, Chart, ChartKind, Image, LegendPos, Series, Sheet};
    let mut s = Sheet::new("Dati");
    s.set_value(gridcraft_core::CellRef::new(0, 0), gridcraft_core::Value::Number(1.0));
    let anchor = Anchor { cell: gridcraft_core::CellRef::new(0, 2), width: 300.0, height: 200.0, ..Anchor::default() };
    let png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
    s.images.push(Image { id: 1, anchor, data: std::sync::Arc::new(png), mime: "image/png".into(), alt: "logo".into() });
    let series = Series {
        name: None,
        categories: None,
        values: "Dati!$A$1:$A$1".into(),
        bubble_sizes: None,
        color: None,
        secondary: false,
        kind: None,
        smooth: false,
        trendlines: Vec::new(),
        quartiles: Default::default(),
    };
    s.charts.push(Chart {
        id: 2,
        kind: ChartKind::Line,
        anchor,
        title: None,
        series: vec![series],
        legend: LegendPos::Bottom,
        data_labels: false,
        gridlines: true,
        style: 2,
        x_title: None,
        y_title: None,
        source: None,
        by_rows: false,
        pivot: None,
    });
    let own = write_xlsx(&Workbook { sheets: vec![std::sync::Arc::new(s)], ..Workbook::default() }).unwrap();
    // What Excel writes and GridCraft does not.
    let file = edited(&own, &|name, text| match name {
        "xl/charts/chart1.xml" => text.replacen("<c:roundedCorners", r#"<c:lang val="it-IT"/><c:roundedCorners"#, 1),
        "xl/drawings/drawing1.xml" => text.replace("<xdr:clientData/>", r#"<xdr:clientData fLocksWithSheet="0"/>"#),
        _ => text,
    });
    let chart = part(&file, "xl/charts/chart1.xml");
    let drawing = part(&file, "xl/drawings/drawing1.xml");
    assert!(chart.contains("c:lang") && drawing.contains("fLocksWithSheet"), "{drawing}");
    let (mut wb, _) = read_xlsx(&file).unwrap();
    let out = write_xlsx(&wb).unwrap();
    assert_eq!(part(&out, "xl/charts/chart1.xml"), chart);
    assert!(part(&out, "xl/drawings/drawing1.xml").contains("fLocksWithSheet"));
    // A chart changed is written by GridCraft, and the drawing that holds it too.
    std::sync::Arc::make_mut(&mut wb.sheets[0]).charts[0].gridlines = false;
    let out = write_xlsx(&wb).unwrap();
    assert!(!part(&out, "xl/charts/chart1.xml").contains("c:lang"));
    assert!(!part(&out, "xl/drawings/drawing1.xml").contains("fLocksWithSheet"));
}
