//! Il codec OpenDocument di Fub: un `.odt` si apre modificabile, e un
//! salvataggio riscrive soltanto ciò che la superficie ha toccato.

mod common;

use std::io::{Cursor, Read, Write};

use fub_format_rich::projection::{
    Align, AtomKind, Block, Inline, Layout, Line, Look, Mark, Para, Projection, Role,
};
use fub_format_rich::{blank, open, save, Codec, ReadOnly, RichError, Saved};

const NAMESPACES: &str = concat!(
    "xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" ",
    "xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" ",
    "xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" ",
    "xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" ",
    "xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\" ",
    "xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" ",
    "xmlns:xlink=\"http://www.w3.org/1999/xlink\" ",
    "xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" ",
    "xmlns:config=\"urn:oasis:names:tc:opendocument:xmlns:config:1.0\" ",
    "office:version=\"1.3\""
);

/// Gli stili comuni di un documento di LibreOffice, ridotti all'osso.
const COMMON: &str = concat!(
    "<style:default-style style:family=\"paragraph\">",
    "<style:text-properties fo:language=\"it\" fo:country=\"IT\"/></style:default-style>",
    "<style:style style:name=\"Standard\" style:family=\"paragraph\"/>",
    "<style:style style:name=\"Text_20_body\" style:display-name=\"Text body\" ",
    "style:family=\"paragraph\" style:parent-style-name=\"Standard\"/>",
    "<style:style style:name=\"Strong_20_Emphasis\" style:family=\"text\">",
    "<style:text-properties fo:font-weight=\"bold\"/></style:style>",
    "<text:list-style style:name=\"Numbering_20_123\">",
    "<text:list-level-style-number text:level=\"1\" style:num-format=\"1\"/>",
    "<text:list-level-style-number text:level=\"2\" style:num-format=\"1\"/>",
    "</text:list-style>",
);

/// Gli stili automatici di `content.xml`.
const AUTO: &str = concat!(
    "<style:style style:name=\"P1\" style:family=\"paragraph\" style:parent-style-name=\"Standard\">",
    "<style:paragraph-properties fo:text-align=\"center\"/></style:style>",
    "<style:style style:name=\"T1\" style:family=\"text\">",
    "<style:text-properties fo:font-style=\"italic\"/></style:style>",
    "<text:list-style style:name=\"L1\">",
    "<text:list-level-style-bullet text:level=\"1\" text:bullet-char=\"•\"/>",
    "<text:list-level-style-bullet text:level=\"2\" text:bullet-char=\"◦\"/>",
    "</text:list-style>",
);

struct Fixture {
    body: String,
    auto: String,
    common: String,
    settings: Option<String>,
    manifest_extra: String,
    /// `style:font-face` di `content.xml`.
    faces: String,
}

impl Fixture {
    fn new(body: &str) -> Fixture {
        Fixture {
            body: body.to_string(),
            auto: AUTO.to_string(),
            common: COMMON.to_string(),
            settings: None,
            manifest_extra: String::new(),
            faces: String::new(),
        }
    }

    fn bytes(&self) -> Vec<u8> {
        let content = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<office:document-content {NAMESPACES}>\
             <office:font-face-decls>{}</office:font-face-decls>\
             <office:automatic-styles>{}</office:automatic-styles><office:body><office:text>\
             {}</office:text></office:body></office:document-content>",
            self.faces, self.auto, self.body
        );
        let styles = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<office:document-styles {NAMESPACES}>\
             <office:styles>{}</office:styles></office:document-styles>",
            self.common
        );
        let manifest = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<manifest:manifest \
             xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\">\
             <manifest:file-entry manifest:full-path=\"/\" \
             manifest:media-type=\"application/vnd.oasis.opendocument.text\"/>{}\
             </manifest:manifest>",
            self.manifest_extra
        );
        let mut entries: Vec<(&str, Vec<u8>)> = vec![
            (
                "mimetype",
                b"application/vnd.oasis.opendocument.text".to_vec(),
            ),
            ("content.xml", content.into_bytes()),
            ("styles.xml", styles.into_bytes()),
            ("Pictures/a.png", b"\x89PNG\r\n\x1a\n finta".to_vec()),
            ("META-INF/manifest.xml", manifest.into_bytes()),
        ];
        if let Some(settings) = &self.settings {
            entries.push((
                "settings.xml",
                format!(
                    "<office:document-settings {NAMESPACES}><office:settings>\
                     <config:config-item-set config:name=\"ooo:configuration-settings\">\
                     {settings}</config:config-item-set></office:settings>\
                     </office:document-settings>"
                )
                .into_bytes(),
            ));
        }
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            let method = if name == "mimetype" {
                zip::CompressionMethod::Stored
            } else {
                zip::CompressionMethod::Deflated
            };
            writer
                .start_file(
                    name,
                    zip::write::SimpleFileOptions::default().compression_method(method),
                )
                .unwrap();
            writer.write_all(&data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }
}

fn odt(body: &str) -> Vec<u8> {
    Fixture::new(body).bytes()
}

fn projection(bytes: &[u8]) -> Projection {
    let opened = open(Codec::Odt, bytes).unwrap();
    assert_eq!(opened.readonly, None, "{}", opened.projection);
    Projection::from_json(&opened.projection).unwrap()
}

fn readonly(bytes: &[u8]) -> Option<ReadOnly> {
    open(Codec::Odt, bytes).unwrap().readonly
}

fn saved(bytes: &[u8], projection: &Projection) -> Vec<u8> {
    match save(Codec::Odt, bytes, &projection.to_json().unwrap()).unwrap() {
        Saved::Bytes(bytes) => bytes,
        Saved::Unchanged => panic!("nothing was written"),
    }
}

fn raw(bytes: &[u8], name: &str) -> Vec<u8> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = Vec::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_end(&mut out)
        .unwrap();
    out
}

fn part(bytes: &[u8], name: &str) -> String {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut out = String::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_string(&mut out)
        .unwrap();
    out
}

fn body(bytes: &[u8]) -> String {
    let content = part(bytes, "content.xml");
    let start = content.find("<office:text>").unwrap() + "<office:text>".len();
    let end = content.find("</office:text>").unwrap();
    content[start..end].to_string()
}

fn para(projection: &Projection, index: usize) -> &Para {
    match &projection.blocks[index] {
        Block::Para(para) => para,
        Block::Table(_) => panic!("block {index} is a table"),
    }
}

fn para_mut(projection: &mut Projection, index: usize) -> &mut Para {
    match &mut projection.blocks[index] {
        Block::Para(para) => para,
        Block::Table(_) => panic!("block {index} is a table"),
    }
}

fn words(para: &Para) -> String {
    para.c
        .iter()
        .map(|inline| match inline {
            Inline::Text { x, .. } => x.as_str(),
            Inline::Atom { .. } => "□",
        })
        .collect()
}

fn texts(para: &Para) -> Vec<(&str, &[Mark])> {
    para.c
        .iter()
        .filter_map(|inline| match inline {
            Inline::Text { x, m, .. } => Some((x.as_str(), m.as_slice())),
            Inline::Atom { .. } => None,
        })
        .collect()
}

const PROSE: &str = concat!(
    "<text:sequence-decls><text:sequence-decl text:display-outline-level=\"0\" ",
    "text:name=\"Illustration\"/></text:sequence-decls>",
    "<text:h text:style-name=\"Standard\" text:outline-level=\"1\">Il titolo</text:h>",
    "<text:p text:style-name=\"P1\">Una prosa <text:span text:style-name=\"T1\">corsiva</text:span>",
    " e <text:span text:style-name=\"Strong_20_Emphasis\">forte</text:span>, con ",
    "<text:a xlink:type=\"simple\" xlink:href=\"https://example.org/\">un link</text:a>.</text:p>",
    "<text:p text:style-name=\"Standard\">Un&apos;altra riga<text:note text:id=\"ftn1\" ",
    "text:note-class=\"footnote\"><text:note-citation>1</text:note-citation><text:note-body>",
    "<text:p>La nota.</text:p></text:note-body></text:note> e un'immagine ",
    "<draw:frame draw:name=\"Immagine1\" svg:width=\"2.54cm\" svg:height=\"1cm\">",
    "<draw:image xlink:href=\"Pictures/a.png\"/></draw:frame>.</text:p>",
);

#[test]
fn si_apre_modificabile_con_ruoli_enfasi_e_oggetti() {
    let projection = projection(&odt(PROSE));
    assert_eq!(projection.lang.as_deref(), Some("it-IT"));
    assert_eq!(projection.blocks.len(), 3);
    assert_eq!(para(&projection, 0).role, Role::Heading { level: 1 });
    let prose = para(&projection, 1);
    assert_eq!(prose.role, Role::Body);
    assert_eq!(
        texts(prose),
        [
            ("Una prosa ", &[][..]),
            ("corsiva", &[Mark::I][..]),
            (" e ", &[][..]),
            ("forte", &[Mark::B][..]),
            (", con ", &[][..]),
            ("un link", &[][..]),
            (".", &[][..]),
        ]
    );
    assert!(prose
        .c
        .iter()
        .any(|i| matches!(i, Inline::Text { href: Some(h), .. } if h == "https://example.org/")));
    let other = para(&projection, 2);
    assert_eq!(words(other), "Un'altra riga□ e un'immagine □.");
    let kinds: Vec<(AtomKind, &str, Option<f32>)> = other
        .c
        .iter()
        .filter_map(|i| match i {
            Inline::Atom { kind, label, w, .. } => Some((*kind, label.as_str(), *w)),
            Inline::Text { .. } => None,
        })
        .collect();
    assert_eq!(kinds[0], (AtomKind::Note, "1", None));
    assert_eq!(kinds[1].0, AtomKind::Image);
    assert_eq!(kinds[1].1, "Immagine1");
    assert!((kinds[1].2.unwrap() - 72.0).abs() < 0.01);
}

#[test]
fn una_proiezione_non_toccata_non_scrive() {
    let bytes = odt(PROSE);
    let opened = open(Codec::Odt, &bytes).unwrap();
    assert_eq!(
        save(Codec::Odt, &bytes, &opened.projection),
        Ok(Saved::Unchanged)
    );
}

#[test]
fn cambiare_una_parola_tocca_soltanto_il_suo_paragrafo() {
    let bytes = odt(PROSE);
    let mut projection = projection(&bytes);
    if let Inline::Text { x, .. } = &mut para_mut(&mut projection, 1).c[0] {
        *x = "Una nuova prosa ".into();
    }
    let out = saved(&bytes, &projection);
    let (before, after) = (body(&bytes), body(&out));
    assert_eq!(
        after,
        before.replace("Una prosa ", "Una nuova prosa "),
        "the rest of the body moved"
    );
    // Le altre voci del pacchetto passano grezze e nello stesso ordine.
    let names = |bytes: &[u8]| -> Vec<String> {
        zip::ZipArchive::new(Cursor::new(bytes))
            .unwrap()
            .file_names()
            .map(|n| n.unwrap().into_owned())
            .collect()
    };
    assert_eq!(names(&out), names(&bytes));
    for name in [
        "styles.xml",
        "Pictures/a.png",
        "META-INF/manifest.xml",
        "mimetype",
    ] {
        assert_eq!(raw(&out, name), raw(&bytes, name), "{name}");
    }
    assert_eq!(para(&self::projection(&out), 1).c.len(), 7);
}

#[test]
fn gli_spazi_seguono_la_regola_di_odf() {
    let bytes = odt(concat!(
        "<text:p>  a  <text:span text:style-name=\"T1\"> b</text:span><text:s text:c=\"3\"/>c",
        "<text:tab/>d<text:line-break/> e </text:p>"
    ));
    let projection = projection(&bytes);
    // Lo spazio dopo un a capo non segue uno spazio: resta.
    assert_eq!(words(para(&projection, 0)), "a b   c\td\n e ");
    // Spazi doppi, iniziali e finali si scrivono e si rileggono uguali.
    let mut edited = projection.clone();
    para_mut(&mut edited, 0).c = vec![Inline::Text {
        x: "  due  spazi \t e \n poi ".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
    }];
    let out = saved(&bytes, &edited);
    assert_eq!(
        words(para(&self::projection(&out), 0)),
        "  due  spazi \t e \n poi "
    );
}

#[test]
fn un_enfasi_cambiata_diventa_uno_stile_automatico_riusato() {
    let bytes = odt("<text:p text:style-name=\"P1\">uno due</text:p><text:p>tre</text:p>");
    let mut projection = projection(&bytes);
    for i in 0..2 {
        if let Inline::Text { m, .. } = &mut para_mut(&mut projection, i).c[0] {
            *m = vec![Mark::B, Mark::U];
        }
    }
    let out = saved(&bytes, &projection);
    let content = part(&out, "content.xml");
    assert_eq!(content.matches("style:name=\"FubT").count(), 1, "{content}");
    let reopened = self::projection(&out);
    assert_eq!(
        texts(para(&reopened, 0)),
        [("uno due", &[Mark::B, Mark::U][..])]
    );
    assert_eq!(
        texts(para(&reopened, 1)),
        [("tre", &[Mark::B, Mark::U][..])]
    );
    // Togliere il grassetto di uno stile scrive il contrario dello stile.
    let bytes = odt(PROSE);
    let mut projection = self::projection(&bytes);
    if let Inline::Text { m, .. } = &mut para_mut(&mut projection, 1).c[3] {
        m.clear();
    }
    let reopened = self::projection(&saved(&bytes, &projection));
    assert_eq!(texts(para(&reopened, 1))[3], ("forte", &[][..]));
}

#[test]
fn carattere_dimensione_colori_e_maiuscole_diventano_uno_stile_automatico() {
    let bytes = odt("<text:p>uno</text:p><text:p>due</text:p>");
    let mut projection = projection(&bytes);
    let look = Look {
        font: Some("Courier New".into()),
        size: Some(18.0),
        color: Some("#c00000".into()),
        hl: Some("#00ff00".into()),
    };
    if let Inline::Text { m, f, .. } = &mut para_mut(&mut projection, 0).c[0] {
        *m = vec![Mark::H, Mark::Caps, Mark::SmallCaps];
        *f = look.clone();
    }
    let out = saved(&bytes, &projection);
    let content = part(&out, "content.xml");
    for attr in [
        "fo:font-family=\"&#39;Courier New&#39;\"",
        "fo:font-size=\"18pt\"",
        "fo:color=\"#c00000\"",
        "fo:background-color=\"#00ff00\"",
        "fo:text-transform=\"uppercase\"",
        "fo:font-variant=\"small-caps\"",
    ] {
        assert!(content.contains(attr), "{attr} in {content}");
    }
    let reopened = self::projection(&out);
    let Inline::Text { m, f, .. } = &para(&reopened, 0).c[0] else {
        panic!()
    };
    assert_eq!(
        (m.as_slice(), f),
        (&[Mark::H, Mark::Caps, Mark::SmallCaps][..], &look)
    );
    let Inline::Text { f, .. } = &para(&reopened, 1).c[0] else {
        panic!()
    };
    assert_eq!(*f, Look::default(), "l'altro paragrafo resta com'era");

    // Il colore automatico si scrive come il colore della finestra.
    let mut projection = reopened;
    if let Inline::Text { f, .. } = &mut para_mut(&mut projection, 0).c[0] {
        f.color = Some("auto".into());
    }
    let out = saved(&out, &projection);
    assert!(part(&out, "content.xml").contains("style:use-window-font-color=\"true\""));
    let reopened = self::projection(&out);
    let Inline::Text { f, .. } = &para(&reopened, 0).c[0] else {
        panic!()
    };
    assert_eq!(f.color, None, "il colore torna quello del paragrafo");
}

#[test]
fn allineamento_disposizione_e_stile_diventano_stili_automatici() {
    let mut fixture = Fixture::new(
        "<text:p text:style-name=\"P1\">uno</text:p><text:p>due</text:p>\
         <text:p text:style-name=\"Standard\">tre</text:p>",
    );
    fixture.common.push_str(
        "<style:style style:name=\"Title\" style:family=\"paragraph\" \
         style:parent-style-name=\"Standard\" style:class=\"chapter\">\
         <style:text-properties fo:font-size=\"28pt\"/></style:style>",
    );
    let bytes = fixture.bytes();
    let mut projection = projection(&bytes);
    let names: Vec<&str> = projection.styles.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        names,
        ["Standard", "Title"],
        "gli stili in uso e quelli di capitolo"
    );
    assert_eq!(projection.styles[1].f.size, Some(28.0));
    assert_eq!(para(&projection, 0).align, Some(Align::Center));
    assert_eq!(para(&projection, 0).s.as_deref(), Some("Standard"));
    assert_eq!(para(&projection, 1).s, None);

    let first = para_mut(&mut projection, 0);
    first.align = Some(Align::Right);
    first.p.left = Some(36.0);
    let second = para_mut(&mut projection, 1);
    second.p.before = Some(12.0);
    second.p.line = Some(Line::Multiple(1.5));
    para_mut(&mut projection, 2).s = Some("Title".into());
    let out = saved(&bytes, &projection);
    let content = part(&out, "content.xml");
    for attr in [
        "fo:text-align=\"end\"",
        "fo:margin-left=\"36pt\"",
        "fo:margin-top=\"12pt\"",
        "fo:line-height=\"150%\"",
        "text:style-name=\"Title\"",
    ] {
        assert!(content.contains(attr), "{attr} in {content}");
    }
    let mut reopened = self::projection(&out);
    let first = para(&reopened, 0);
    assert_eq!(
        (first.align, first.p.left, first.s.as_deref()),
        (Some(Align::Right), Some(36.0), Some("Standard")),
        "la copia dello stile automatico tiene il genitore"
    );
    assert_eq!(para(&reopened, 1).p.before, Some(12.0));
    assert_eq!(para(&reopened, 1).p.line, Some(Line::Multiple(1.5)));
    assert_eq!(para(&reopened, 2).s.as_deref(), Some("Title"));

    // Di nuovo come lo stile: a sinistra, senza rientro.
    let first = para_mut(&mut reopened, 0);
    first.align = None;
    first.p = Layout::default();
    let out = saved(&out, &reopened);
    let reopened = self::projection(&out);
    assert_eq!(
        (para(&reopened, 0).align, &para(&reopened, 0).p),
        (None, &Layout::default())
    );
}

#[test]
fn un_carattere_dichiarato_si_legge_con_la_sua_famiglia() {
    let mut fixture =
        Fixture::new("<text:p>uno <text:span text:style-name=\"T2\">due</text:span></text:p>");
    fixture.faces = "<style:font-face style:name=\"Liberation Serif1\" \
                     svg:font-family=\"&apos;Liberation Serif&apos;\"/>"
        .into();
    fixture.auto.push_str(
        "<style:style style:name=\"T2\" style:family=\"text\">\
         <style:text-properties style:font-name=\"Liberation Serif1\" fo:font-size=\"14pt\"/>\
         </style:style>",
    );
    let projection = projection(&fixture.bytes());
    let Inline::Text { x, f, .. } = &para(&projection, 0).c[1] else {
        panic!()
    };
    assert_eq!(x, "due");
    assert_eq!(f.font.as_deref(), Some("Liberation Serif"));
    assert_eq!(f.size, Some(14.0));
}

#[test]
fn un_titolo_nuovo_porta_il_suo_stile_e_la_formattazione_diretta() {
    let bytes = odt("<text:p text:style-name=\"P1\">Capitolo</text:p><text:p>testo</text:p>");
    let mut projection = projection(&bytes);
    para_mut(&mut projection, 0).role = Role::Heading { level: 2 };
    para_mut(&mut projection, 1).role = Role::Quote;
    let out = saved(&bytes, &projection);
    let styles = part(&out, "styles.xml");
    assert!(styles.contains("style:name=\"Heading_20_2\""), "{styles}");
    assert!(styles.contains("style:name=\"Quotations\""), "{styles}");
    let content = part(&out, "content.xml");
    // P1 era automatico: la copia tiene l'allineamento e cambia genitore.
    assert!(
        content.contains("style:parent-style-name=\"Heading_20_2\""),
        "{content}"
    );
    let reopened = self::projection(&out);
    assert_eq!(para(&reopened, 0).role, Role::Heading { level: 2 });
    assert_eq!(
        para(&reopened, 0).align,
        Some(fub_format_rich::projection::Align::Center)
    );
    assert_eq!(para(&reopened, 1).role, Role::Quote);
    // E all'indietro.
    let mut back = reopened.clone();
    para_mut(&mut back, 0).role = Role::Body;
    para_mut(&mut back, 1).role = Role::Body;
    let again = self::projection(&saved(&out, &back));
    assert_eq!(para(&again, 0).role, Role::Body);
    assert_eq!(para(&again, 1).role, Role::Body);
    assert!(!body(&saved(&out, &back)).contains("<text:h"));
}

const LIST: &str = concat!(
    "<text:p>prima</text:p>",
    "<text:list xml:id=\"list1\" text:style-name=\"L1\">",
    "<text:list-item><text:p>uno</text:p>",
    "<text:list><text:list-item><text:p>uno.a</text:p></text:list-item></text:list>",
    "</text:list-item>",
    "<text:list-item><text:p>due</text:p></text:list-item>",
    "<text:list-item><text:p>tre</text:p></text:list-item>",
    "</text:list>",
    "<text:p>dopo</text:p>",
);

#[test]
fn gli_elenchi_si_leggono_per_livelli() {
    let projection = projection(&odt(LIST));
    let roles: Vec<Role> = projection
        .blocks
        .iter()
        .map(|b| match b {
            Block::Para(p) => p.role,
            Block::Table(_) => panic!(),
        })
        .collect();
    let bullet = |level| Role::List {
        ordered: false,
        level,
    };
    assert_eq!(
        roles,
        [
            Role::Body,
            bullet(0),
            bullet(1),
            bullet(0),
            bullet(0),
            Role::Body
        ]
    );
}

#[test]
fn invio_in_un_elenco_aggiunge_una_voce_allo_stesso_elenco() {
    let bytes = odt(LIST);
    let mut projection = projection(&bytes);
    // ProseMirror spezza il paragrafo: le due metà portano lo stesso `k`.
    let mut copy = para(&projection, 3).clone();
    copy.c = vec![Inline::Text {
        x: "due e mezzo".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
    }];
    projection.blocks.insert(4, Block::Para(copy));
    let out = saved(&bytes, &projection);
    let body = body(&out);
    assert_eq!(body.matches("<text:list ").count(), 1, "{body}");
    assert_eq!(body.matches("xml:id=\"list1\"").count(), 1, "{body}");
    let reopened = self::projection(&out);
    assert_eq!(words(para(&reopened, 4)), "due e mezzo");
    assert_eq!(
        para(&reopened, 4).role,
        Role::List {
            ordered: false,
            level: 0
        }
    );
}

#[test]
fn un_paragrafo_entra_ed_esce_da_un_elenco() {
    let bytes = odt(LIST);
    let mut projection = projection(&bytes);
    // «dopo» diventa voce dell'elenco che lo precede; «due» ne esce.
    para_mut(&mut projection, 5).role = Role::List {
        ordered: false,
        level: 0,
    };
    para_mut(&mut projection, 3).role = Role::Body;
    let out = saved(&bytes, &projection);
    let body = body(&out);
    // L'elenco diviso: la seconda parte continua la numerazione e non ripete
    // l'id della prima.
    assert_eq!(body.matches("xml:id=\"list1\"").count(), 1, "{body}");
    assert!(body.contains("text:continue-numbering=\"true\""), "{body}");
    let reopened = self::projection(&out);
    assert_eq!(para(&reopened, 3).role, Role::Body);
    assert_eq!(
        para(&reopened, 5).role,
        Role::List {
            ordered: false,
            level: 0
        }
    );
    // Un livello in più resta nella voce di prima.
    let mut deeper = reopened.clone();
    para_mut(&mut deeper, 4).role = Role::List {
        ordered: false,
        level: 1,
    };
    let again = self::projection(&saved(&out, &deeper));
    assert_eq!(
        para(&again, 4).role,
        Role::List {
            ordered: false,
            level: 1
        }
    );
}

#[test]
fn un_elenco_nuovo_ha_lo_stile_della_sua_specie() {
    let bytes = odt("<text:p>uno</text:p><text:p>due</text:p>");
    let mut projection = projection(&bytes);
    for i in 0..2 {
        para_mut(&mut projection, i).role = Role::List {
            ordered: true,
            level: 0,
        };
    }
    let out = saved(&bytes, &projection);
    let body = body(&out);
    assert_eq!(body.matches("<text:list ").count(), 1, "{body}");
    assert!(
        body.contains("text:style-name=\"Numbering_20_123\""),
        "{body}"
    );
    let reopened = self::projection(&out);
    for i in 0..2 {
        assert_eq!(
            para(&reopened, i).role,
            Role::List {
                ordered: true,
                level: 0
            }
        );
    }
    // Senza uno stile della specie, il codec ne scrive uno.
    let mut bullets = reopened.clone();
    para_mut(&mut bullets, 0).role = Role::Body;
    para_mut(&mut bullets, 1).role = Role::Body;
    let mut fixture = Fixture::new("<text:p>uno</text:p>");
    fixture.auto = String::new();
    let bytes = fixture.bytes();
    let mut projection = self::projection(&bytes);
    para_mut(&mut projection, 0).role = Role::List {
        ordered: false,
        level: 0,
    };
    let out = saved(&bytes, &projection);
    assert!(part(&out, "content.xml").contains("<text:list-style style:name=\"FubL1\">"));
    assert_eq!(
        para(&self::projection(&out), 0).role,
        Role::List {
            ordered: false,
            level: 0
        }
    );
}

const TABLE: &str = concat!(
    "<table:table table:name=\"Tabella1\"><table:table-column table:number-columns-repeated=\"2\"/>",
    "<table:table-header-rows><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell>",
    "<table:table-cell><text:p>B</text:p></table:table-cell></table:table-row></table:table-header-rows>",
    "<table:table-row><table:table-cell table:number-columns-spanned=\"2\"><text:p>unite</text:p>",
    "</table:table-cell><table:covered-table-cell/></table:table-row>",
    "<table:table-row><table:table-cell><text:p>1</text:p></table:table-cell>",
    "<table:table-cell/></table:table-row>",
    "</table:table>",
);

#[test]
fn le_righe_di_una_tabella_si_aggiungono_e_si_tolgono() {
    let bytes = odt(TABLE);
    let mut projection = projection(&bytes);
    let Block::Table(table) = &mut projection.blocks[0] else {
        panic!("not a table");
    };
    assert_eq!(table.rows.len(), 3);
    assert_eq!(table.rows[1].cells.len(), 1);
    assert!(table.rows[2].cells[1].blocks.is_empty());
    // Una riga nuova copia quella accanto; la riga unita se ne va.
    let mut row = table.rows[2].clone();
    if let Block::Para(p) = &mut row.cells[0].blocks[0] {
        p.c = vec![Inline::Text {
            x: "2".into(),
            k: None,
            m: Vec::new(),
            href: None,
            f: Look::default(),
        }];
    }
    table.rows.push(row);
    table.rows.remove(1);
    let out = saved(&bytes, &projection);
    let body = body(&out);
    assert_eq!(
        body.matches("<table:table-header-rows>").count(),
        1,
        "{body}"
    );
    assert!(!body.contains("unite"));
    let reopened = self::projection(&out);
    let Block::Table(table) = &reopened.blocks[0] else {
        panic!("not a table");
    };
    let firsts: Vec<String> = table
        .rows
        .iter()
        .map(|r| match &r.cells[0].blocks[0] {
            Block::Para(p) => words(p),
            Block::Table(_) => panic!(),
        })
        .collect();
    assert_eq!(firsts, ["A", "1", "2"]);
}

#[test]
fn le_righe_unite_non_si_spostano() {
    let bytes = odt(concat!(
        "<table:table table:name=\"T\"><table:table-column/>",
        "<table:table-row><table:table-cell table:number-rows-spanned=\"2\"><text:p>a</text:p>",
        "</table:table-cell></table:table-row>",
        "<table:table-row><table:covered-table-cell/><table:table-cell><text:p>b</text:p>",
        "</table:table-cell></table:table-row></table:table>"
    ));
    let mut projection = projection(&bytes);
    let Block::Table(table) = &mut projection.blocks[0] else {
        panic!("not a table");
    };
    table.rows.swap(0, 1);
    assert!(matches!(
        save(Codec::Odt, &bytes, &projection.to_json().unwrap()),
        Err(RichError::Codec(_))
    ));
    // Il testo delle celle invece si scrive.
    let mut projection = self::projection(&bytes);
    let Block::Table(table) = &mut projection.blocks[0] else {
        panic!("not a table");
    };
    if let Block::Para(p) = &mut table.rows[1].cells[0].blocks[0] {
        if let Inline::Text { x, .. } = &mut p.c[0] {
            x.push_str("bis");
        }
    }
    assert!(body(&saved(&bytes, &projection)).contains("bbis"));
}

#[test]
fn un_oggetto_estraneo_o_ripetuto_non_si_scrive() {
    let bytes = odt(PROSE);
    let projection = projection(&bytes);
    let note = para(&projection, 2)
        .c
        .iter()
        .find(|i| {
            matches!(
                i,
                Inline::Atom {
                    kind: AtomKind::Note,
                    ..
                }
            )
        })
        .unwrap()
        .clone();
    let mut twice = projection.clone();
    para_mut(&mut twice, 0).c.push(note);
    assert!(matches!(
        save(Codec::Odt, &bytes, &twice.to_json().unwrap()),
        Err(RichError::Missing(_))
    ));
    // Un oggetto di un altro documento.
    let other = self::projection(&odt(
        "<text:p><text:bookmark text:name=\"altrove\"/>x</text:p>",
    ));
    let mut foreign = projection.clone();
    para_mut(&mut foreign, 0)
        .c
        .push(para(&other, 0).c[0].clone());
    assert!(matches!(
        save(Codec::Odt, &bytes, &foreign.to_json().unwrap()),
        Err(RichError::Missing(_))
    ));
    // Un'immagine copiata invece si ripete.
    let image = para(&projection, 2)
        .c
        .iter()
        .find(|i| {
            matches!(
                i,
                Inline::Atom {
                    kind: AtomKind::Image,
                    ..
                }
            )
        })
        .unwrap()
        .clone();
    let mut copied = projection.clone();
    para_mut(&mut copied, 0).c.push(image);
    let out = saved(&bytes, &copied);
    assert_eq!(body(&out).matches("Pictures/a.png").count(), 2);
}

#[test]
fn le_parti_che_la_proiezione_non_mostra_restano_al_loro_posto() {
    let bytes = odt(concat!(
        "<text:sequence-decls/>",
        "<text:p>fuori</text:p>",
        "<text:section text:name=\"Sezione1\"><text:p>dentro</text:p></text:section>",
        "<!-- un commento -->",
        "<text:p>dopo</text:p>"
    ));
    let mut projection = projection(&bytes);
    assert_eq!(projection.blocks.len(), 3);
    if let Inline::Text { x, .. } = &mut para_mut(&mut projection, 1).c[0] {
        x.push_str(" ancora");
    }
    let mut copy = para(&projection, 1).clone();
    copy.c = vec![Inline::Text {
        x: "nuovo".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
    }];
    projection.blocks.insert(2, Block::Para(copy));
    let out = saved(&bytes, &projection);
    assert_eq!(
        body(&out),
        concat!(
            "<text:sequence-decls/>",
            "<text:p>fuori</text:p>",
            "<text:section text:name=\"Sezione1\"><text:p>dentro ancora</text:p>",
            "<text:p>nuovo</text:p></text:section>",
            "<!-- un commento -->",
            "<text:p>dopo</text:p>"
        )
    );
}

#[test]
fn ciò_che_il_documento_dice_di_sé_apre_in_sola_lettura() {
    let tracked = odt(concat!(
        "<text:tracked-changes><text:changed-region text:id=\"c1\"><text:insertion>",
        "<office:change-info/></text:insertion></text:changed-region></text:tracked-changes>",
        "<text:p>x</text:p>"
    ));
    assert_eq!(readonly(&tracked), Some(ReadOnly::Revisions));
    let mut recording = Fixture::new("<text:p>x</text:p>");
    recording.settings = Some(
        "<config:config-item config:name=\"RecordChanges\" config:type=\"boolean\">true\
         </config:config-item>"
            .into(),
    );
    assert_eq!(readonly(&recording.bytes()), Some(ReadOnly::TrackChanges));
    let protected = odt(
        "<text:section text:name=\"S\" text:protected=\"true\"><text:p>x</text:p></text:section>",
    );
    assert_eq!(readonly(&protected), Some(ReadOnly::Protected));
    for bytes in [tracked, recording.bytes(), protected] {
        let mut projection =
            Projection::from_json(&open(Codec::Odt, &bytes).unwrap().projection).unwrap();
        projection.readonly = None;
        assert!(matches!(
            save(Codec::Odt, &bytes, &projection.to_json().unwrap()),
            Err(RichError::ReadOnly(_))
        ));
    }
    let mut encrypted = Fixture::new("<text:p>x</text:p>");
    encrypted.manifest_extra = "<manifest:file-entry manifest:full-path=\"content.xml\">\
         <manifest:encryption-data/></manifest:file-entry>"
        .into();
    assert_eq!(
        open(Codec::Odt, &encrypted.bytes()),
        Err(RichError::Encrypted)
    );
}

#[test]
fn ciò_che_il_codec_non_rappresenta_si_apre_con_l_importatore() {
    for body in [
        "<text:list><text:list-item/></text:list><text:p>x</text:p>",
        "<text:p>a<!-- commento -->b</text:p>",
        "<text:numbered-paragraph><text:p>x</text:p></text:numbered-paragraph>",
    ] {
        let bytes = odt(body);
        assert_eq!(readonly(&bytes), Some(ReadOnly::Import), "{body}");
        let mut projection =
            Projection::from_json(&open(Codec::Odt, &bytes).unwrap().projection).unwrap();
        projection.readonly = None;
        assert_eq!(
            save(Codec::Odt, &bytes, &projection.to_json().unwrap()),
            Err(RichError::ReadOnly(ReadOnly::Import))
        );
    }
    // Due elenchi uguali vicini, riscritti, diventerebbero uno.
    let twins = odt(concat!(
        "<text:list text:style-name=\"L1\"><text:list-item><text:p>a</text:p></text:list-item></text:list>",
        "<text:list text:style-name=\"L1\"><text:list-item><text:p>b</text:p></text:list-item></text:list>",
    ));
    assert_eq!(readonly(&twins), Some(ReadOnly::Projection));
}

#[test]
fn un_salto_pagina_nel_testo_non_si_scrive() {
    let bytes = odt("<text:p>x</text:p>");
    let mut projection = projection(&bytes);
    if let Inline::Text { x, .. } = &mut para_mut(&mut projection, 0).c[0] {
        x.push('\u{c}');
    }
    assert!(matches!(
        save(Codec::Odt, &bytes, &projection.to_json().unwrap()),
        Err(RichError::Codec(_))
    ));
}

#[test]
fn un_documento_nuovo_si_crea_e_si_scrive() {
    let bytes = blank(Codec::Odt).unwrap();
    let mut projection = projection(&bytes);
    let first = para_mut(&mut projection, 0);
    first.c = vec![Inline::Text {
        x: "Ciao".into(),
        k: None,
        m: vec![Mark::I],
        href: None,
        f: Look::default(),
    }];
    first.role = Role::Heading { level: 1 };
    let reopened = self::projection(&saved(&bytes, &projection));
    assert_eq!(para(&reopened, 0).role, Role::Heading { level: 1 });
    assert_eq!(texts(para(&reopened, 0)), [("Ciao", &[Mark::I][..])]);
}

#[test]
fn un_odt_di_wordcraft_si_apre_modificabile() {
    let bytes = wordcraft_formats::odt::export(&common::sample()).unwrap();
    let mut projection = projection(&bytes);
    let index = projection
        .blocks
        .iter()
        .position(|b| matches!(b, Block::Para(p) if !p.c.is_empty() && p.role == Role::Body))
        .unwrap();
    para_mut(&mut projection, index).c.push(Inline::Text {
        x: " (rivisto)".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
    });
    let reopened = self::projection(&saved(&bytes, &projection));
    assert!(words(para(&reopened, index)).ends_with(" (rivisto)"));
}
