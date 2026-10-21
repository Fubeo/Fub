//! Scrive i file del corpus (`tests/corpus/`), costruiti a mano dalle
//! specifiche (ECMA-376, ODF 1.3, RTF 1.9, MS-DOC): il primo nucleo della
//! matrice, senza file prodotti da Word, LibreOffice o Google Docs. Ogni file è
//! scritto apposta, con autori e testi di prova, e ha la licenza di Fub.
//!
//! I file si committano; il generatore serve a rifarli o ad aggiungerne, non
//! gira nei test. Le voci ZIP hanno la data fissa del formato (1980), quindi
//! due esecuzioni danno gli stessi byte con la stessa versione di `zip`.
//!
//! ```text
//! cargo run -p fub-format-rich --example genera_corpus
//! ```

use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const WML: &str = "application/vnd.openxmlformats-officedocument.wordprocessingml";

/// Un PNG di un pixel.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus");
    let files: Vec<(&str, Vec<u8>)> = vec![
        ("docx/stili-elenchi-tabelle.docx", stili_elenchi_tabelle()),
        ("docx/senza-perdite.docx", senza_perdite()),
        ("docx/segni-di-word.docx", segni_di_word()),
        ("docx/revisioni-testo.docx", revisioni_testo()),
        (
            "docx/revisioni-senza-perdite.docx",
            revisioni_senza_perdite(),
        ),
        ("docx/revisioni-formato.docx", revisioni_formato()),
        ("docx/commenti.docx", commenti()),
        ("docx/oggetti.docx", oggetti()),
        ("docx/altchunk.docx", altchunk()),
        ("docx/scritture.docx", scritture()),
        ("docx/controlli.docx", controlli()),
        ("docx/pacchetto.docx", pacchetto()),
        ("docx/protetto.docx", protetto()),
        ("docx/ostile-troncato.docx", troncato()),
        ("docx/ostile-voci-duplicate.docx", voci_duplicate()),
        ("docx/ostile-xml-malformato.docx", xml_malformato()),
        ("docx/ostile-profondo.docx", profondo()),
        ("docx/ostile-dimensione-falsa.docx", dimensione_falsa()),
        ("odt/semplice.odt", odt_semplice()),
        ("rtf/semplice.rtf", rtf_semplice()),
        ("rtf/tabella.rtf", rtf_tabella()),
        ("doc/semplice.doc", doc_semplice()),
        ("doc/cifrato.doc", doc_cifrato()),
    ];
    for (name, bytes) in files {
        write(&root, name, &bytes);
    }
}

fn write(root: &Path, name: &str, bytes: &[u8]) {
    let path = root.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, bytes).unwrap();
    println!("{name}: {} byte", bytes.len());
}

// --- Pacchetti OPC ---------------------------------------------------------

/// Uno ZIP con queste voci, compresse come le comprime Word.
fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in entries {
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zw.start_file(*name, options).unwrap();
        zw.write_all(bytes).unwrap();
    }
    zw.finish().unwrap().into_inner()
}

/// Un `.docx`: le parti con il loro tipo di contenuto (`None` per quelle che
/// prendono il tipo dall'estensione) e le relazioni di ogni parte sorgente.
struct Package {
    parts: Vec<(String, Option<String>, Vec<u8>)>,
    rels: Vec<(String, Vec<String>)>,
}

impl Package {
    fn new(document: &str) -> Package {
        let mut package = Package {
            parts: Vec::new(),
            rels: Vec::new(),
        };
        package.part(
            "word/document.xml",
            Some(&format!("{WML}.document.main+xml")),
            document,
        );
        package.rel("", "rId1", "officeDocument", "word/document.xml");
        package
    }

    fn part(
        &mut self,
        name: &str,
        content_type: Option<&str>,
        data: impl AsRef<[u8]>,
    ) -> &mut Self {
        self.parts.push((
            name.to_string(),
            content_type.map(str::to_string),
            data.as_ref().to_vec(),
        ));
        self
    }

    /// Una relazione dalla parte `source` (`""` per il pacchetto); il tipo è
    /// breve per quelli di officeDocument, intero altrimenti.
    fn rel(&mut self, source: &str, id: &str, kind: &str, target: &str) -> &mut Self {
        let kind = match kind.contains("://") {
            true => kind.to_string(),
            false => format!("{REL}/{kind}"),
        };
        let external = target.contains("://");
        let line = format!(
            r#"<Relationship Id="{id}" Type="{kind}" Target="{target}"{}/>"#,
            if external {
                r#" TargetMode="External""#
            } else {
                ""
            }
        );
        match self.rels.iter_mut().find(|(s, _)| s == source) {
            Some((_, lines)) => lines.push(line),
            None => self.rels.push((source.to_string(), vec![line])),
        }
        self
    }

    fn bytes(&self) -> Vec<u8> {
        let mut types = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="html" ContentType="text/html"/>"#,
        );
        for (name, content_type, _) in &self.parts {
            if let Some(content_type) = content_type {
                types.push_str(&format!(
                    r#"<Override PartName="/{name}" ContentType="{content_type}"/>"#
                ));
            }
        }
        types.push_str("</Types>");
        let mut entries: Vec<(String, Vec<u8>)> =
            vec![("[Content_Types].xml".into(), types.into_bytes())];
        for (source, lines) in &self.rels {
            let name = match source.rsplit_once('/') {
                Some((dir, file)) => format!("{dir}/_rels/{file}.rels"),
                None if source.is_empty() => "_rels/.rels".to_string(),
                None => format!("_rels/{source}.rels"),
            };
            let xml = format!(
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{PKG_REL}">{}</Relationships>"#,
                lines.concat()
            );
            entries.push((name, xml.into_bytes()));
        }
        for (name, _, data) in &self.parts {
            entries.push((name.clone(), data.clone()));
        }
        let borrowed: Vec<(&str, &[u8])> = entries
            .iter()
            .map(|(n, b)| (n.as_str(), b.as_slice()))
            .collect();
        zip(&borrowed)
    }
}

fn document(body: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"><w:body>{body}</w:body></w:document>"#
    )
}

fn story(root: &str, inner: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:{root} xmlns:w="{W}" xmlns:r="{R}">{inner}</w:{root}>"#
    )
}

fn p(text: &str) -> String {
    format!(r#"<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#)
}

fn styled(style: &str, text: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>"#
    )
}

const SECT: &str = r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>"#;

/// Gli stili come li scrive Word. Con `lossless` mancano la lingua
/// dell'Asia orientale dei valori predefiniti e il rientro dello stile di
/// tabella, che il motore di oggi perde: quei file misurano le modifiche.
fn styles(lossless: bool) -> String {
    let xml = story(
        "styles",
        r#"<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="MS Mincho" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="it-IT" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style><w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>"#,
    );
    match lossless {
        true => xml
            .replace(r#" w:eastAsia="ja-JP""#, "")
            .replace(r#"<w:tblInd w:w="0" w:type="dxa"/>"#, ""),
        false => xml,
    }
}

fn settings(extra: &str) -> String {
    story(
        "settings",
        &format!(
            r#"<w:zoom w:percent="100"/>{extra}<w:defaultTabStop w:val="708"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>"#
        ),
    )
}

/// Il pacchetto di un documento con gli stili e le impostazioni.
fn with_styles(body: &str, settings_extra: &str) -> Package {
    with_styles_of(body, settings_extra, false)
}

fn with_styles_of(body: &str, settings_extra: &str, lossless: bool) -> Package {
    let mut package = Package::new(&document(body));
    package
        .part(
            "word/styles.xml",
            Some(&format!("{WML}.styles+xml")),
            styles(lossless),
        )
        .rel("word/document.xml", "rIdStyles", "styles", "styles.xml")
        .part(
            "word/settings.xml",
            Some(&format!("{WML}.settings+xml")),
            settings(settings_extra),
        )
        .rel(
            "word/document.xml",
            "rIdSettings",
            "settings",
            "settings.xml",
        );
    package
}

// --- I .docx ---------------------------------------------------------------

/// Word moderno: stili, un elenco, una tabella con celle unite in larghezza e
/// in altezza, un'intestazione con il numero di pagina, una nota e due
/// sezioni, la seconda orizzontale.
fn stili_elenchi_tabelle() -> Vec<u8> {
    word_moderno(false)
}

/// Lo stesso documento senza ciò che il motore di oggi perde: gli stili di
/// [`styles`] con `lossless`, e il numero di pagina come campo complesso
/// invece di `w:fldSimple`.
fn senza_perdite() -> Vec<u8> {
    word_moderno(true)
}

/// I segni che Word lascia in ogni file e che rigenera a ogni salvataggio, su
/// un documento che il motore di oggi riscrive senza perdite: gli `rsid`, gli
/// errori di ortografia segnati, l'ultima impaginazione, gli id dei
/// paragrafi, le statistiche di `app.xml`. Si apre modificabile soltanto
/// grazie alle normalizzazioni dichiarate. Il segnalibro `_GoBack` c'è perché
/// Word lo scrive sempre: il motore lo conserva, e non serve normalizzarlo.
fn segni_di_word() -> Vec<u8> {
    let body = [
        r#"<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00A1B2C3" w:rsidP="00D4E5F6" w14:paraId="1F2E3D4C" w14:textId="77AA88BB"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r w:rsidRPr="00D4E5F6"><w:t>Segni di Word</w:t></w:r></w:p>"#,
        r#"<w:p w:rsidR="00A1B2C3" w:rsidRDefault="00D4E5F6" w14:paraId="2A3B4C5D" w14:textId="11223344"><w:r><w:t xml:space="preserve">Una parola </w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:t>sbagliatta</w:t></w:r><w:proofErr w:type="spellEnd"/><w:r><w:t xml:space="preserve"> e un </w:t></w:r><w:r><w:rPr><w:color w:val="c00000"/><w:sz w:val="24"/></w:rPr><w:t>colore</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>"#,
        r#"<w:bookmarkStart w:id="0" w:name="Segno"/><w:p w:rsidR="00D4E5F6" w:rsidRDefault="00D4E5F6"><w:r><w:lastRenderedPageBreak/><w:t>Una pagina nuova cominciava qui.</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>"#,
        r#"<w:p w:rsidR="00D4E5F6" w:rsidRDefault="00D4E5F6"><w:r><w:t>L'ultima modifica.</w:t></w:r><w:bookmarkStart w:id="1" w:name="_GoBack"/><w:bookmarkEnd w:id="1"/></w:p>"#,
        r#"<w:sectPr w:rsidR="00A1B2C3"><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>"#,
    ]
    .concat();
    let mut package = with_styles_of(
        &body,
        r#"<w:rsids><w:rsidRoot w:val="00A1B2C3"/><w:rsid w:val="00A1B2C3"/><w:rsid w:val="00D4E5F6"/></w:rsids>"#,
        true,
    );
    package
        .part(
            "docProps/app.xml",
            Some("application/vnd.openxmlformats-officedocument.extended-properties+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>Normal.dotm</Template><TotalTime>3</TotalTime><Pages>2</Pages><Words>17</Words><Characters>98</Characters><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><Lines>1</Lines><Paragraphs>4</Paragraphs><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><CharactersWithSpaces>114</CharactersWithSpaces><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>"#,
        )
        .rel("", "rId3", "extended-properties", "docProps/app.xml");
    package.bytes()
}

fn word_moderno(lossless: bool) -> Vec<u8> {
    let item = |text: &str| {
        format!(
            r#"<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    };
    // Una cella vuota ha un paragrafo senza tratti, come lo scrive Word.
    let cell = |props: &str, text: &str| {
        let para = match text {
            "" => "<w:p/>".to_string(),
            text => p(text),
        };
        format!(r#"<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>{props}</w:tcPr>{para}</w:tc>"#)
    };
    let table = format!(
        r#"<w:tbl><w:tblPr><w:tblStyle w:val="TableNormal"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>{}{}</w:tr><w:tr>{}{}{}</w:tr><w:tr>{}{}{}</w:tr></w:tbl>"#,
        cell(r#"<w:gridSpan w:val="2"/>"#, "Intestazione unita"),
        cell("", "Terza"),
        cell(r#"<w:vMerge w:val="restart"/>"#, "Alta"),
        cell("", "Uno"),
        cell("", "Due"),
        cell("<w:vMerge/>", ""),
        cell("", "Tre"),
        cell("", "Quattro"),
    );
    let body = [
        styled("Heading1", "Relazione di prova"),
        p("Un paragrafo di corpo con una nota.").replace(
            "</w:t></w:r></w:p>",
            r#"</w:t></w:r><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r></w:p>"#,
        ),
        item("Prima voce"),
        item("Seconda voce"),
        table,
        r#"<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:pPr><w:r><w:t>Fine della prima sezione.</w:t></w:r></w:p>"#.to_string(),
        styled("Heading2", "Una sezione orizzontale"),
        p("Il testo della seconda sezione."),
        r#"<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1417" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>"#.to_string(),
    ]
    .concat();
    let numbering = story(
        "numbering",
        r#"<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#,
    );
    let field = match lossless {
        true => {
            r#"<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>"#
        }
        false => r#"<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>"#,
    };
    let header = story(
        "hdr",
        &format!(r#"<w:p><w:r><w:t xml:space="preserve">Pagina </w:t></w:r>{field}</w:p>"#),
    );
    let footnotes = story(
        "footnotes",
        r#"<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Il testo della nota.</w:t></w:r></w:p></w:footnote>"#,
    );
    let mut package = with_styles_of(
        &body,
        r#"<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>"#,
        lossless,
    );
    package
        .part(
            "word/numbering.xml",
            Some(&format!("{WML}.numbering+xml")),
            numbering,
        )
        .rel(
            "word/document.xml",
            "rIdNumbering",
            "numbering",
            "numbering.xml",
        )
        .part(
            "word/header1.xml",
            Some(&format!("{WML}.header+xml")),
            header,
        )
        .rel("word/document.xml", "rIdHeader", "header", "header1.xml")
        .part(
            "word/footnotes.xml",
            Some(&format!("{WML}.footnotes+xml")),
            footnotes,
        )
        .rel(
            "word/document.xml",
            "rIdFootnotes",
            "footnotes",
            "footnotes.xml",
        );
    package.bytes()
}

/// Revisioni del testo nel corpo: un inserimento, un'eliminazione e uno
/// spostamento, con la registrazione attiva.
fn revisioni_testo() -> Vec<u8> {
    revisioni(false)
}

/// Le stesse revisioni con gli stili che il motore di oggi conserva.
fn revisioni_senza_perdite() -> Vec<u8> {
    revisioni(true)
}

fn revisioni(lossless: bool) -> Vec<u8> {
    let body = [
        styled("Heading1", "Bozza con revisioni"),
        r#"<w:p><w:r><w:t xml:space="preserve">Il testo </w:t></w:r><w:ins w:id="1" w:author="Ada Rossi" w:date="2026-10-01T09:00:00Z"><w:r><w:t xml:space="preserve">aggiunto </w:t></w:r></w:ins><w:del w:id="2" w:author="Bea Neri" w:date="2026-10-01T09:05:00Z"><w:r><w:delText xml:space="preserve">tolto </w:delText></w:r></w:del><w:r><w:t>resta.</w:t></w:r></w:p>"#.to_string(),
        r#"<w:p><w:moveFromRangeStart w:id="3" w:author="Ada Rossi" w:date="2026-10-01T09:10:00Z" w:name="move1"/><w:moveFrom w:id="4" w:author="Ada Rossi" w:date="2026-10-01T09:10:00Z"><w:r><w:t>Frase spostata.</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="3"/></w:p>"#.to_string(),
        p("Un paragrafo in mezzo."),
        r#"<w:p><w:moveToRangeStart w:id="5" w:author="Ada Rossi" w:date="2026-10-01T09:10:00Z" w:name="move1"/><w:moveTo w:id="6" w:author="Ada Rossi" w:date="2026-10-01T09:10:00Z"><w:r><w:t>Frase spostata.</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="5"/></w:p>"#.to_string(),
        SECT.to_string(),
    ]
    .concat();
    with_styles_of(&body, "<w:trackRevisions/>", lossless).bytes()
}

/// Una modifica di formato tracciata (`w:rPrChange`), che la superficie non
/// mostra.
fn revisioni_formato() -> Vec<u8> {
    let body = [
        p("Un paragrafo normale."),
        r#"<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada Rossi" w:date="2026-10-02T10:00:00Z"><w:rPr/></w:rPrChange></w:rPr><w:t>Diventato grassetto.</w:t></w:r></w:p>"#.to_string(),
        SECT.to_string(),
    ]
    .concat();
    with_styles(&body, "").bytes()
}

/// Commenti con una risposta e uno risolto, come li scrive Word moderno
/// (`commentsExtended`, `commentsIds`).
fn commenti() -> Vec<u8> {
    let body = [
        r#"<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Una frase da rivedere.</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>"#.to_string(),
        r#"<w:p><w:commentRangeStart w:id="2"/><w:r><w:t>Un'altra, già sistemata.</w:t></w:r><w:commentRangeEnd w:id="2"/><w:r><w:commentReference w:id="2"/></w:r></w:p>"#.to_string(),
        SECT.to_string(),
    ]
    .concat();
    let comment = |id: u32, by: &str, para: &str, text: &str| {
        format!(
            r#"<w:comment w:id="{id}" w:author="{by}" w:date="2026-10-03T08:00:00Z" w:initials="X"><w:p w14:paraId="{para}" w14:textId="77777777"><w:r><w:annotationRef/></w:r><w:r><w:t>{text}</w:t></w:r></w:p></w:comment>"#
        )
    };
    let comments = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="{W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">{}{}{}</w:comments>"#,
        comment(0, "Redazione", "1A2B3C01", "Da rivedere."),
        comment(1, "Ada Rossi", "1A2B3C02", "Fatto, mi pare."),
        comment(2, "Redazione", "1A2B3C03", "Risolto."),
    );
    let extended = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:commentEx w15:paraId="1A2B3C01" w15:done="0"/><w15:commentEx w15:paraId="1A2B3C02" w15:paraIdParent="1A2B3C01" w15:done="0"/><w15:commentEx w15:paraId="1A2B3C03" w15:done="1"/></w15:commentsEx>"#;
    let ids = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"><w16cid:commentId w16cid:paraId="1A2B3C01" w16cid:durableId="11111111"/><w16cid:commentId w16cid:paraId="1A2B3C02" w16cid:durableId="22222222"/><w16cid:commentId w16cid:paraId="1A2B3C03" w16cid:durableId="33333333"/></w16cid:commentsIds>"#;
    let mut package = with_styles(&body, "");
    package
        .part(
            "word/comments.xml",
            Some(&format!("{WML}.comments+xml")),
            comments,
        )
        .rel(
            "word/document.xml",
            "rIdComments",
            "comments",
            "comments.xml",
        )
        .part(
            "word/commentsExtended.xml",
            Some(&format!("{WML}.commentsExtended+xml")),
            extended,
        )
        .rel(
            "word/document.xml",
            "rIdCommentsEx",
            "http://schemas.microsoft.com/office/2011/relationships/commentsExtended",
            "commentsExtended.xml",
        )
        .part(
            "word/commentsIds.xml",
            Some(&format!("{WML}.commentsIds+xml")),
            ids,
        )
        .rel(
            "word/document.xml",
            "rIdCommentsIds",
            "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds",
            "commentsIds.xml",
        );
    package.bytes()
}

fn picture(id: u32, rel: &str) -> String {
    format!(
        r#"<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{id}" name="pixel.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>"#
    )
}

/// Oggetti: un'immagine in riga, una ancorata, una casella di testo DrawingML
/// con il ripiego VML e un'equazione.
fn oggetti() -> Vec<u8> {
    let inline = format!(
        r#"<w:p><w:r><w:t xml:space="preserve">In riga: </w:t></w:r><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Immagine 1" descr="Un pixel"/>{}</wp:inline></w:drawing></w:r></w:p>"#,
        picture(1, "rIdImg")
    );
    let anchored = format!(
        r#"<w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="914400" cy="914400"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="2" name="Immagine 2"/>{}</wp:anchor></w:drawing></w:r><w:r><w:t>Ancorata.</w:t></w:r></w:p>"#,
        picture(2, "rIdImg")
    );
    let textbox = r##"<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><wp:extent cx="1828800" cy="457200"/><wp:docPr id="3" name="Casella 3"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>Testo nella casella.</w:t></w:r></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="Casella3" type="#_x0000_t202" style="width:144pt;height:36pt"><v:textbox><w:txbxContent><w:p><w:r><w:t>Testo nella casella.</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>"##;
    let equation = r#"<w:p><w:r><w:t xml:space="preserve">Una formula: </w:t></w:r><m:oMath><m:r><m:t>a</m:t></m:r><m:r><m:t>+</m:t></m:r><m:r><m:t>b</m:t></m:r></m:oMath></w:p>"#;
    let body = [
        inline,
        anchored,
        textbox.into(),
        equation.into(),
        SECT.into(),
    ]
    .concat();
    let mut package = with_styles(&body, "");
    package.part("word/media/image1.png", None, PNG).rel(
        "word/document.xml",
        "rIdImg",
        "image",
        "media/image1.png",
    );
    package.bytes()
}

/// Un contenuto importato da HTML (`w:altChunk`), come lo scrivono i
/// generatori HTML→DOCX.
fn altchunk() -> Vec<u8> {
    let body = [
        p("Prima del contenuto importato."),
        r#"<w:altChunk r:id="rIdChunk"/>"#.to_string(),
        p("Dopo il contenuto importato."),
        SECT.to_string(),
    ]
    .concat();
    let mut package = with_styles(&body, "");
    package
        .part(
            "word/afchunk.html",
            None,
            "<html><body><p>Un paragrafo <b>importato</b> da HTML.</p></body></html>",
        )
        .rel("word/document.xml", "rIdChunk", "aFChunk", "afchunk.html");
    package.bytes()
}

/// Scritture: impaginazione dell'Asia orientale, ruby, testo da destra a
/// sinistra e una sezione in verticale.
fn scritture() -> Vec<u8> {
    let body = [
        r#"<w:p><w:r><w:rPr><w:rFonts w:hint="eastAsia"/><w:eastAsianLayout w:id="1" w:combine="1"/><w:lang w:eastAsia="ja-JP"/></w:rPr><w:t>日本語</w:t></w:r></w:p>"#.to_string(),
        r#"<w:p><w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="distributeSpace"/><w:hps w:val="11"/><w:hpsRaise w:val="20"/><w:hpsBaseText w:val="22"/><w:lid w:val="ja-JP"/></w:rubyPr><w:rt><w:r><w:t>かんじ</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>漢字</w:t></w:r></w:rubyBase></w:ruby></w:r></w:p>"#.to_string(),
        r#"<w:p><w:pPr><w:bidi/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rtl/><w:lang w:bidi="he-IL"/></w:rPr><w:t>שלום עולם</w:t></w:r></w:p>"#.to_string(),
        r#"<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/><w:lang w:bidi="ar-SA"/></w:rPr><w:t>مرحبا بالعالم</w:t></w:r></w:p>"#.to_string(),
        r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/><w:textDirection w:val="tbRl"/></w:sectPr>"#.to_string(),
    ]
    .concat();
    with_styles(&body, "").bytes()
}

/// Content control di blocco e in riga, e un campo di modulo legacy.
fn controlli() -> Vec<u8> {
    let body = [
        p("Prima dei controlli."),
        r#"<w:sdt><w:sdtPr><w:alias w:val="Riquadro"/><w:tag w:val="riquadro"/><w:id w:val="101"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Dentro il controllo, primo.</w:t></w:r></w:p><w:p><w:r><w:t>Dentro il controllo, secondo.</w:t></w:r></w:p></w:sdtContent></w:sdt>"#.to_string(),
        r#"<w:p><w:r><w:t xml:space="preserve">Nome: </w:t></w:r><w:sdt><w:sdtPr><w:id w:val="102"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>Ada</w:t></w:r></w:sdtContent></w:sdt></w:p>"#.to_string(),
        r#"<w:p><w:r><w:t xml:space="preserve">Campo: </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Testo1"/><w:enabled/><w:calcOnExit w:val="0"/><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>valore</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>"#.to_string(),
        SECT.to_string(),
    ]
    .concat();
    with_styles(&body, "").bytes()
}

/// Il pacchetto: proprietà del documento (principali, estese, personalizzate),
/// una parte custom XML e un collegamento esterno.
fn pacchetto() -> Vec<u8> {
    let body = [
        r#"<w:p><w:r><w:t xml:space="preserve">Un collegamento </w:t></w:r><w:hyperlink r:id="rIdLink"><w:r><w:t>esterno</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>"#.to_string(),
        SECT.to_string(),
    ]
    .concat();
    let mut package = with_styles(&body, "");
    package
        .rel("word/document.xml", "rIdLink", "hyperlink", "https://example.org/prova")
        .part(
            "customXml/item1.xml",
            None,
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><prova xmlns="urn:fub:corpus"><voce>valore</voce></prova>"#,
        )
        .part(
            "customXml/itemProps1.xml",
            Some("application/vnd.openxmlformats-officedocument.customXmlProperties+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="{11111111-2222-3333-4444-555555555555}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>"#,
        )
        .rel("word/document.xml", "rIdCustom", "customXml", "../customXml/item1.xml")
        .rel("customXml/item1.xml", "rId1", "customXmlProps", "itemProps1.xml")
        .part(
            "docProps/core.xml",
            Some("application/vnd.openxmlformats-package.core-properties+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Pacchetto di prova</dc:title><dc:creator>Ada Rossi</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T09:00:00Z</dcterms:created></cp:coreProperties>"#,
        )
        .rel(
            "",
            "rId2",
            "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
            "docProps/core.xml",
        )
        .part(
            "docProps/app.xml",
            Some("application/vnd.openxmlformats-officedocument.extended-properties+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Generatore del corpus di Fub</Application><Pages>1</Pages></Properties>"#,
        )
        .rel("", "rId3", "extended-properties", "docProps/app.xml")
        .part(
            "docProps/custom.xml",
            Some("application/vnd.openxmlformats-officedocument.custom-properties+xml"),
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Progetto"><vt:lpwstr>Corpus</vt:lpwstr></property></Properties>"#,
        )
        .rel("", "rId4", "custom-properties", "docProps/custom.xml");
    package.bytes()
}

/// Un documento protetto contro le modifiche.
fn protetto() -> Vec<u8> {
    let body = [p("Un testo che non si modifica."), SECT.to_string()].concat();
    with_styles(
        &body,
        r#"<w:documentProtection w:edit="readOnly" w:enforcement="1"/>"#,
    )
    .bytes()
}

// --- Ostili -------------------------------------------------------------

fn troncato() -> Vec<u8> {
    let mut bytes = stili_elenchi_tabelle();
    bytes.truncate(bytes.len() / 2);
    bytes
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// Uno ZIP scritto a mano, senza compressione: ammette due voci con lo stesso
/// nome, che `zip` rifiuta di scrivere.
fn raw_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        let offset = out.len() as u32;
        let (crc, size, len) = (crc32(data), data.len() as u32, name.len() as u16);
        let header = |out: &mut Vec<u8>, central: bool| {
            if central {
                out.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
                out.extend_from_slice(&20u16.to_le_bytes());
            } else {
                out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            }
            out.extend_from_slice(&20u16.to_le_bytes()); // versione
            out.extend_from_slice(&0u16.to_le_bytes()); // flag
            out.extend_from_slice(&0u16.to_le_bytes()); // stored
            out.extend_from_slice(&0u16.to_le_bytes()); // ora
            out.extend_from_slice(&0x0021u16.to_le_bytes()); // 1980-01-01
            out.extend_from_slice(&crc.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&size.to_le_bytes());
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes()); // extra
            if central {
                out.extend_from_slice(&0u16.to_le_bytes()); // commento
                out.extend_from_slice(&0u16.to_le_bytes()); // disco
                out.extend_from_slice(&0u16.to_le_bytes()); // attributi interni
                out.extend_from_slice(&0u32.to_le_bytes()); // attributi esterni
                out.extend_from_slice(&offset.to_le_bytes());
            }
            out.extend_from_slice(name.as_bytes());
        };
        header(&mut out, false);
        out.extend_from_slice(data);
        header(&mut central, true);
    }
    let at = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    let n = entries.len() as u16;
    out.extend_from_slice(&n.to_le_bytes());
    out.extend_from_slice(&n.to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&at.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

/// Due `word/document.xml` con testi diversi: quale vale dipenderebbe dal
/// lettore.
fn voci_duplicate() -> Vec<u8> {
    let types = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="{WML}.document.main+xml"/></Types>"#
    );
    let rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="{PKG_REL}"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="word/document.xml"/></Relationships>"#
    );
    let one = document(&[p("La prima copia."), SECT.to_string()].concat());
    let two = document(&[p("La seconda copia."), SECT.to_string()].concat());
    raw_zip(&[
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", rels.as_bytes()),
        ("word/document.xml", one.as_bytes()),
        ("word/document.xml", two.as_bytes()),
    ])
}

fn xml_malformato() -> Vec<u8> {
    let broken = document(&[p("Un paragrafo."), "<w:p><w:r><w:t>non chiuso".into()].concat());
    Package::new(&broken).bytes()
}

/// Un annidamento più profondo dei limiti del lettore.
fn profondo() -> Vec<u8> {
    let depth = 2048;
    let open = "<w:sdt><w:sdtContent>".repeat(depth);
    let close = "</w:sdtContent></w:sdt>".repeat(depth);
    Package::new(&document(&format!("{open}{}{close}{SECT}", p("In fondo.")))).bytes()
}

/// Una parte che si gonfia a 32 MiB mentre l'intestazione ZIP dice 64 byte:
/// il lettore deve fidarsi di ciò che legge, non di ciò che dichiara.
fn dimensione_falsa() -> Vec<u8> {
    let mut package = Package::new(&document(
        &[p("Un documento piccolo."), SECT.to_string()].concat(),
    ));
    package.part("word/media/zeri.bin", None, vec![0u8; 32 << 20]);
    let mut bytes = package.bytes();
    let name = b"word/media/zeri.bin";
    let mut at = 0;
    while let Some(found) = find(&bytes[at..], name) {
        let start = at + found;
        // L'intestazione locale ha il nome a 30 byte, quella centrale a 46; la
        // dimensione decompressa sta a 22 e a 24.
        for (signature, name_at, size_at) in [(0x0403_4b50u32, 30, 22), (0x0201_4b50u32, 46, 24)] {
            if start >= name_at {
                let header = start - name_at;
                if bytes[header..header + 4] == signature.to_le_bytes() {
                    bytes[header + size_at..header + size_at + 4]
                        .copy_from_slice(&64u32.to_le_bytes());
                }
            }
        }
        at = start + name.len();
    }
    bytes
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

// --- OpenDocument, RTF, Word 97-2003 --------------------------------------

/// Un `.odt` con un titolo, una nota, una tabella e una sezione.
fn odt_semplice() -> Vec<u8> {
    let ns = r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:0.9" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3""#;
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ns}><office:automatic-styles><style:style style:name="P1" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">Verbale di prova</text:h><text:p>Un paragrafo con una nota<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>Il testo della nota.</text:p></text:note-body></text:note>.</text:p><text:p text:style-name="P1">In grassetto.</text:p><table:table table:name="Tabella1"><table:table-column table:number-columns-repeated="2"/><table:table-row><table:table-cell office:value-type="string"><text:p>Uno</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Due</text:p></table:table-cell></table:table-row></table:table><text:section text:name="Sezione1"><text:p>Dentro la sezione.</text:p></text:section></office:text></office:body></office:document-content>"#
    );
    let styles = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ns}><office:styles><style:style style:name="Standard" style:family="paragraph"/></office:styles></office:document-styles>"#
    );
    let meta = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-meta {ns}><office:meta><meta:generator>Generatore del corpus di Fub</meta:generator><dc:title>Verbale di prova</dc:title></office:meta></office:document-meta>"#
    );
    let manifest = r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>"#;
    // `mimetype` per primo e non compresso, come vuole ODF.
    let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zw.start_file(
        "mimetype",
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
    )
    .unwrap();
    zw.write_all(b"application/vnd.oasis.opendocument.text")
        .unwrap();
    for (name, data) in [
        ("content.xml", content.as_bytes()),
        ("styles.xml", styles.as_bytes()),
        ("meta.xml", meta.as_bytes()),
        ("META-INF/manifest.xml", manifest.as_bytes()),
    ] {
        zw.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        zw.write_all(data).unwrap();
    }
    zw.finish().unwrap().into_inner()
}

fn rtf_semplice() -> Vec<u8> {
    br"{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman Times New Roman;}{\f1\fswiss Arial;}}{\colortbl;\red0\green0\blue0;\red192\green0\blue0;}{\info{\title Lettera di prova}{\author Ada Rossi}}
\pard\sb240\sa120\b\fs32 Lettera di prova\b0\fs22\par
\pard Un paragrafo con {\i corsivo}, {\b grassetto} e {\cf2 colore}. Caff\'e8 e citt\'e0.\par
\pard Un secondo paragrafo.\par
}"
    .to_vec()
}

fn rtf_tabella() -> Vec<u8> {
    br"{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}
\pard Prima della tabella.\par
\trowd\trgaph108\cellx3000\cellx6000\pard\intbl Uno\cell Due\cell\row
\trowd\trgaph108\cellx3000\cellx6000\pard\intbl Tre\cell Quattro\cell\row
\pard Dopo la tabella.\par
}"
    .to_vec()
}

fn cfb(streams: &[(&str, &[u8])]) -> Vec<u8> {
    let mut comp = cfb::CompoundFile::create(Cursor::new(Vec::new())).unwrap();
    for (name, data) in streams {
        comp.create_stream(format!("/{name}"))
            .unwrap()
            .write_all(data)
            .unwrap();
    }
    comp.flush().unwrap();
    comp.into_inner().into_inner()
}

/// Un Word 97 minimo: una FIB, un pezzo di testo in UTF-16 e la tabella dei
/// pezzi (MS-DOC 2.4.1, 2.8.35).
fn doc_semplice() -> Vec<u8> {
    const TEXT_FC: u32 = 0x600;
    const CLX_AT: u32 = 0x40;
    let text = "Un documento Word 97-2003.\rUn secondo paragrafo.\r";
    let units: Vec<u8> = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let chars = text.encode_utf16().count() as u32;
    let mut plc = Vec::new();
    plc.extend_from_slice(&0u32.to_le_bytes());
    plc.extend_from_slice(&chars.to_le_bytes());
    plc.extend_from_slice(&[0, 0]);
    plc.extend_from_slice(&TEXT_FC.to_le_bytes());
    plc.extend_from_slice(&0u16.to_le_bytes());
    let mut clx = vec![0x02u8];
    clx.extend_from_slice(&(plc.len() as u32).to_le_bytes());
    clx.extend_from_slice(&plc);
    let mut table = vec![0u8; CLX_AT as usize];
    table.extend_from_slice(&clx);

    let mut fib = vec![0u8; 0x9A + 0x5D * 8 + 2];
    let put16 =
        |v: &mut Vec<u8>, at: usize, x: u16| v[at..at + 2].copy_from_slice(&x.to_le_bytes());
    let put32 =
        |v: &mut Vec<u8>, at: usize, x: u32| v[at..at + 4].copy_from_slice(&x.to_le_bytes());
    put16(&mut fib, 0x00, 0xA5EC); // wIdent
    put16(&mut fib, 0x02, 0x00C1); // nFib di Word 97
    put16(&mut fib, 0x0A, 0x1000); // fExtChar; fWhichTblStm a 0: la tabella è `0Table`
    put16(&mut fib, 0x0C, 0x00BF);
    put16(&mut fib, 0x20, 0x000E); // csw
    put16(&mut fib, 0x3E, 0x0016); // cslw
    put32(&mut fib, 0x40, 0x1000); // cbMac
    put32(&mut fib, 0x4C, chars); // ccpText
    put16(&mut fib, 0x98, 0x005D); // cbRgFcLcb
    put32(&mut fib, 0x9A + 33 * 8, CLX_AT); // fcClx
    put32(&mut fib, 0x9A + 33 * 8 + 4, clx.len() as u32); // lcbClx
    let mut word = vec![0u8; TEXT_FC as usize];
    word[..fib.len()].copy_from_slice(&fib);
    word.extend_from_slice(&units);
    cfb(&[("WordDocument", &word), ("0Table", &table)])
}

/// Un contenitore OLE con i flussi di un Word cifrato con una password.
fn doc_cifrato() -> Vec<u8> {
    cfb(&[("EncryptionInfo", &[0; 16]), ("EncryptedPackage", &[0; 16])])
}
