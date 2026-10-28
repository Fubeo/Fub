//! Cartelle di prova scritte a mano: il pacchetto minimo di SpreadsheetML, con
//! i fogli, gli stili e le parti che un test chiede.

#![allow(dead_code)]

use std::io::{Cursor, Write};

pub const NS: &str = r#"xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;

/// Gli stili di prova, nell'ordine di `cellXfs`:
///
/// 0. Normale;
/// 1. percentuale `0.00%`;
/// 2. data e ora (formato 22);
/// 3. grassetto, corsivo, rosso, centrato;
/// 4. riempimento giallo, testo automatico;
/// 5. data `yyyy-mm-dd`;
/// 6. numeri negativi rossi `0;[Red]-0`;
/// 7. testo nel colore 1 del tema (il nero del testo), a sinistra.
pub const STYLES: &str = r#"<numFmts count="3"><numFmt numFmtId="164" formatCode="0.00%"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="0;[Red]-0"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><i/><sz val="11"/><color rgb="FFFF0000"/><name val="Calibri"/></font><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>"#;

/// Un foglio: il nome, l'XML fra `<worksheet>` e `</worksheet>` e se è
/// nascosto.
pub struct SheetPart<'a> {
    pub name: &'a str,
    pub body: &'a str,
    pub hidden: bool,
}

pub fn sheet<'a>(name: &'a str, body: &'a str) -> SheetPart<'a> {
    SheetPart {
        name,
        body,
        hidden: false,
    }
}

/// Il pacchetto: i fogli, gli attributi di `workbookPr` (per esempio
/// `date1904="1"`), l'XML in più di `workbook.xml` dopo `<sheets>`, e le parti
/// in più con la loro relazione dalla cartella.
#[derive(Default)]
pub struct Package<'a> {
    pub sheets: Vec<SheetPart<'a>>,
    pub workbook_pr: &'a str,
    pub workbook_tail: &'a str,
    /// (percorso nel pacchetto, tipo di contenuto, contenuto).
    pub parts: Vec<(&'a str, &'a str, Vec<u8>)>,
    /// (id, tipo completo, destinazione) delle relazioni in più di
    /// `workbook.xml`.
    pub workbook_rels: Vec<(&'a str, &'a str, &'a str)>,
    /// Le relazioni dei fogli: (indice del foglio, XML delle relazioni).
    pub sheet_rels: Vec<(usize, String)>,
    /// Il tipo di contenuto della parte principale; vuoto per `.xlsx`.
    pub main_type: &'a str,
    /// Gli stili di `styles.xml`; vuoto per `STYLES`.
    pub styles: &'a str,
}

impl Package<'_> {
    pub fn bytes(&self) -> Vec<u8> {
        let mut overrides = String::new();
        let main = if self.main_type.is_empty() {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
        } else {
            self.main_type
        };
        overrides.push_str(&format!(
            r#"<Override PartName="/xl/workbook.xml" ContentType="{main}"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>"#
        ));
        let mut sheets = String::new();
        let mut rels =
            format!(r#"<Relationship Id="rStyles" Type="{R}/styles" Target="styles.xml"/>"#);
        for (index, part) in self.sheets.iter().enumerate() {
            let n = index + 1;
            overrides.push_str(&format!(
                r#"<Override PartName="/xl/worksheets/sheet{n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>"#
            ));
            let state = if part.hidden {
                r#" state="hidden""#
            } else {
                ""
            };
            sheets.push_str(&format!(
                r#"<sheet name="{}" sheetId="{n}"{state} r:id="rSheet{n}"/>"#,
                part.name
            ));
            rels.push_str(&format!(
                r#"<Relationship Id="rSheet{n}" Type="{R}/worksheet" Target="worksheets/sheet{n}.xml"/>"#
            ));
        }
        for (id, kind, target) in &self.workbook_rels {
            rels.push_str(&format!(
                r#"<Relationship Id="{id}" Type="{kind}" Target="{target}"/>"#
            ));
        }
        for (path, kind, _) in &self.parts {
            overrides.push_str(&format!(
                r#"<Override PartName="/{path}" ContentType="{kind}"/>"#
            ));
        }
        let mut files: Vec<(String, Vec<u8>)> = vec![
            (
                "[Content_Types].xml".into(),
                format!(
                    r#"{HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{overrides}</Types>"#
                )
                .into_bytes(),
            ),
            (
                "_rels/.rels".into(),
                format!(
                    r#"{HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>"#
                )
                .into_bytes(),
            ),
            (
                "xl/workbook.xml".into(),
                format!(
                    r#"{HEAD}<workbook {NS}><workbookPr {}/><sheets>{sheets}</sheets>{}</workbook>"#,
                    self.workbook_pr, self.workbook_tail
                )
                .into_bytes(),
            ),
            (
                "xl/_rels/workbook.xml.rels".into(),
                format!(
                    r#"{HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>"#
                )
                .into_bytes(),
            ),
            (
                "xl/styles.xml".into(),
                format!(
                    r#"{HEAD}<styleSheet {NS}>{}</styleSheet>"#,
                    if self.styles.is_empty() {
                        STYLES
                    } else {
                        self.styles
                    }
                )
                .into_bytes(),
            ),
        ];
        for (index, part) in self.sheets.iter().enumerate() {
            files.push((
                format!("xl/worksheets/sheet{}.xml", index + 1),
                format!(r#"{HEAD}<worksheet {NS}>{}</worksheet>"#, part.body).into_bytes(),
            ));
        }
        for (index, xml) in &self.sheet_rels {
            files.push((
                format!("xl/worksheets/_rels/sheet{}.xml.rels", index + 1),
                format!(
                    r#"{HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{xml}</Relationships>"#
                )
                .into_bytes(),
            ));
        }
        for (path, _, bytes) in &self.parts {
            files.push((path.to_string(), bytes.clone()));
        }
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in files {
            writer
                // Unix anche su Windows: le revisioni delle fixture non
                // dipendono dalla macchina.
                .start_file(
                    name,
                    zip::write::SimpleFileOptions::default().system(zip::System::Unix),
                )
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}

/// Una cartella di un foglio.
pub fn one_sheet(body: &str) -> Vec<u8> {
    Package {
        sheets: vec![sheet("Foglio1", body)],
        ..Package::default()
    }
    .bytes()
}

/// Un file cifrato con una password: un compound file con il pacchetto cifrato.
pub fn encrypted() -> Vec<u8> {
    let mut file = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    file.create_stream("/EncryptionInfo")
        .unwrap()
        .write_all(&[4, 0, 4, 0, 0x40, 0, 0, 0])
        .unwrap();
    file.create_stream("/EncryptedPackage")
        .unwrap()
        .write_all(&[0; 64])
        .unwrap();
    file.flush().unwrap();
    file.into_inner().into_inner()
}

/// Esegue LibreOffice (`FUB_SOFFICE`) su `inputs`, con un profilo suo e un
/// limite di due minuti.
pub fn soffice(
    soffice: &std::ffi::OsStr,
    dir: &std::path::Path,
    to: &str,
    inputs: &[std::path::PathBuf],
) {
    let mut child = std::process::Command::new(soffice)
        .arg("--headless")
        .arg(format!(
            "-env:UserInstallation=file://{}",
            dir.join("profilo").display()
        ))
        .args(["--convert-to", to, "--outdir"])
        .arg(dir)
        .args(inputs)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if start.elapsed() > std::time::Duration::from_secs(120) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("LibreOffice non ha finito in due minuti ({to})");
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    assert!(status.success(), "LibreOffice: {status}");
}
