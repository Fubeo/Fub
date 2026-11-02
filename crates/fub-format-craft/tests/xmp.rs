//! Gli XMP di LightCraft: voto, etichetta, scelta e parole chiave letti in
//! attributi e in elementi, il modello che ne viene, i nomi della foto e della
//! copia `-Edit.psd`, e l'XML ostile.

use fub_abi::model::Span;
use fub_abi::ParseContext;
use fub_format_craft::xmp::{
    document_model, edit_copy_of, photo_candidates, read, Flag, PhotoMatch, PhotoMeta, XmpError,
    MAX_KEYWORDS, MAX_XMP_BYTES, MAX_XMP_DEPTH,
};
use serde_json::json;

/// Un XMP come quelli di LightCraft: i namespace dichiarati, i campi come
/// attributi di `rdf:Description`, le parole chiave in un `rdf:Bag`.
fn lightcraft(attributes: &str, inner: &str) -> String {
    format!(
        r#"<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:lc="https://lightcraft.example/ns/1.0/"
    {attributes}>
   {inner}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#
    )
}

fn subject(items: &[&str]) -> String {
    let lis: String = items
        .iter()
        .map(|i| format!("<rdf:li>{i}</rdf:li>"))
        .collect();
    format!("<dc:subject><rdf:Bag>{lis}</rdf:Bag></dc:subject>")
}

fn meta(xml: &str) -> PhotoMeta {
    read(xml.as_bytes()).unwrap()
}

fn rating_of(value: &str) -> Option<i8> {
    meta(&lightcraft(&format!("xmp:Rating=\"{value}\""), "")).rating
}

fn ctx() -> ParseContext {
    ParseContext::obsidian("Foto/IMG_0001.CR3.xmp")
}

#[test]
fn attributes_and_bag_as_lightcraft_writes_them() {
    let xml = lightcraft(
        r#"xmp:Rating="4" xmp:Label="Rosso" lc:flag="pick""#,
        &subject(&["New York", "mare"]),
    );
    assert_eq!(
        meta(&xml),
        PhotoMeta {
            rating: Some(4),
            label: Some("Rosso".into()),
            flag: Some(Flag::Pick),
            keywords: vec!["New York".into(), "mare".into()],
        }
    );
}

#[test]
fn fields_as_elements() {
    let xml = lightcraft(
        "",
        &format!(
            "<xmp:Rating>3</xmp:Rating><xmp:Label>Verde</xmp:Label>\
             <lc:flag>reject</lc:flag>{}",
            subject(&["bosco"])
        ),
    );
    let m = meta(&xml);
    assert_eq!(m.rating, Some(3));
    assert_eq!(m.label.as_deref(), Some("Verde"));
    assert_eq!(m.flag, Some(Flag::Reject));
    assert_eq!(m.keywords, vec!["bosco".to_string()]);
}

#[test]
fn a_seq_of_keywords_and_no_namespace_declarations() {
    // Scritto a mano, senza `xmlns`: i prefissi convenzionali bastano.
    let xml = "<rdf:RDF><rdf:Description xmp:Rating=\"2\">\
               <dc:subject><rdf:Seq><rdf:li>uno</rdf:li><rdf:li>due</rdf:li></rdf:Seq></dc:subject>\
               </rdf:Description></rdf:RDF>";
    let m = meta(xml);
    assert_eq!(m.rating, Some(2));
    assert_eq!(m.keywords, vec!["uno".to_string(), "due".to_string()]);
}

#[test]
fn a_namespace_under_another_prefix_is_recognised_by_its_uri() {
    let xml = r#"<r:RDF xmlns:r="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
        <r:Description xmlns:xap="http://ns.adobe.com/xap/1.0/" xap:Rating="5"/>
        </r:RDF>"#;
    assert_eq!(meta(xml).rating, Some(5));
}

#[test]
fn the_new_york_example_gives_tags_and_frontmatter() {
    let xml = lightcraft(
        r#"xmp:Rating="4" xmp:Label="Rosso" lc:flag="pick""#,
        &subject(&["New York", "mare"]),
    );
    let model = document_model(&ctx(), xml.as_bytes());
    assert_eq!(model.id.as_str(), "Foto/IMG_0001.CR3.xmp");
    assert_eq!(
        serde_json::Value::Object(model.frontmatter.0.clone()),
        json!({ "rating": 4, "label": "Rosso", "flag": "pick", "tags": ["New-York", "mare"] })
    );
    let tags: Vec<(&str, Span)> = model
        .tags
        .iter()
        .map(|t| (t.name.as_str(), t.span))
        .collect();
    assert_eq!(tags, vec![("New-York", Span::EMPTY), ("mare", Span::EMPTY)]);
    assert_eq!(model.text, "New York\nmare\nRosso");
    assert!(!model.frontmatter_present);
}

#[test]
fn the_frontmatter_has_only_the_keys_that_are_there() {
    let model = document_model(&ctx(), lightcraft("lc:flag=\"reject\"", "").as_bytes());
    assert_eq!(
        serde_json::Value::Object(model.frontmatter.0.clone()),
        json!({ "flag": "reject" })
    );
    assert!(model.tags.is_empty());
    assert_eq!(model.text, "");
}

#[test]
fn a_keyword_that_cannot_be_a_tag_stays_in_the_text() {
    let xml = lightcraft(
        "",
        &subject(&["R&amp;D", "1990", "##viaggi  in   treno", "#estate"]),
    );
    let model = document_model(&ctx(), xml.as_bytes());
    assert_eq!(
        model.frontmatter.get("tags"),
        Some(&json!(["viaggi-in-treno", "estate"]))
    );
    let names: Vec<&str> = model.tags.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, vec!["viaggi-in-treno", "estate"]);
    assert_eq!(model.text, "R&D\n1990\n##viaggi  in   treno\n#estate");
}

#[test]
fn two_keywords_with_the_same_tag_give_one_tag() {
    let xml = lightcraft("", &subject(&["New York", "New  York"]));
    let model = document_model(&ctx(), xml.as_bytes());
    assert_eq!(model.frontmatter.get("tags"), Some(&json!(["New-York"])));
    assert_eq!(model.tags.len(), 1);
}

#[test]
fn settings_are_never_read() {
    let xml = lightcraft(
        r#"crs:Exposure2012="+0.50" crs:Rating="1""#,
        "<crs:Look><rdf:Description xmp:Rating=\"1\"><dc:subject><rdf:Bag>\
         <rdf:li>segreto</rdf:li></rdf:Bag></dc:subject></rdf:Description></crs:Look>\
         <lc:settings><rdf:Bag><rdf:li>preset</rdf:li></rdf:Bag><xmp:Rating>2</xmp:Rating>\
         <lc:flag>pick</lc:flag></lc:settings>\
         <xmp:Rating>4</xmp:Rating>",
    );
    let m = meta(&xml);
    assert_eq!(
        m,
        PhotoMeta {
            rating: Some(4),
            ..PhotoMeta::default()
        }
    );
    let model = document_model(&ctx(), xml.as_bytes());
    assert!(!model.text.contains("segreto") && !model.text.contains("preset"));
}

#[test]
fn an_amp_inside_a_keyword() {
    let xml = lightcraft(
        "",
        &subject(&["Rock &amp; Roll", "a&#x20;b&#169;", "&lt;tag&gt;"]),
    );
    assert_eq!(
        meta(&xml).keywords,
        vec![
            "Rock & Roll".to_string(),
            "a b©".to_string(),
            "<tag>".to_string()
        ]
    );
}

#[test]
fn an_entity_declared_in_a_doctype_is_not_expanded() {
    let xml = r#"<?xml version="1.0"?>
<!DOCTYPE x [ <!ENTITY boom "ESPANSA"> <!ENTITY ext SYSTEM "file:///etc/passwd"> ]>
<rdf:RDF><rdf:Description xmp:Label="a&boom;b">
<dc:subject><rdf:Bag><rdf:li>x&boom;y&ext;z</rdf:li><rdf:li>&boom;</rdf:li></rdf:Bag></dc:subject>
</rdf:Description></rdf:RDF>"#;
    let m = meta(xml);
    assert_eq!(m.keywords, vec!["xyz".to_string()]);
    assert_eq!(m.label.as_deref(), Some("ab"));
}

#[test]
fn an_li_outside_dc_subject_is_ignored() {
    let xml = lightcraft(
        "",
        "<dc:creator><rdf:Seq><rdf:li>Fotografa</rdf:li></rdf:Seq></dc:creator>\
         <rdf:li>sciolto</rdf:li>",
    );
    assert!(meta(&xml).keywords.is_empty());
}

#[test]
fn ratings() {
    assert_eq!(rating_of("5.0"), Some(5));
    assert_eq!(rating_of("-1"), Some(-1));
    assert_eq!(rating_of("0"), Some(0));
    assert_eq!(rating_of(" 3 "), Some(3));
    assert_eq!(rating_of("6"), None);
    assert_eq!(rating_of("-2"), None);
    assert_eq!(rating_of("2.5"), None);
    assert_eq!(rating_of("NaN"), None);
    assert_eq!(rating_of("inf"), None);
    assert_eq!(rating_of(""), None);
    assert_eq!(rating_of("tre"), None);
}

#[test]
fn the_first_valid_value_wins() {
    let xml = lightcraft(
        "xmp:Rating=\"9\"",
        "<xmp:Rating>2</xmp:Rating><xmp:Rating>4</xmp:Rating>",
    );
    assert_eq!(meta(&xml).rating, Some(2));
}

#[test]
fn flags() {
    let flag_of = |v: &str| meta(&lightcraft(&format!("lc:flag=\"{v}\""), "")).flag;
    assert_eq!(flag_of("pick"), Some(Flag::Pick));
    assert_eq!(flag_of("reject"), Some(Flag::Reject));
    assert_eq!(flag_of("none"), None);
    // I nomi si confrontano così come sono scritti.
    assert_eq!(flag_of("Pick"), None);
    let model = document_model(&ctx(), lightcraft("lc:flag=\"none\"", "").as_bytes());
    assert!(model.frontmatter.get("flag").is_none());
}

#[test]
fn labels() {
    let label_of = |v: &str| meta(&lightcraft(&format!("xmp:Label=\"{v}\""), "")).label;
    assert_eq!(label_of(""), None);
    assert_eq!(label_of("   "), None);
    let long: String = "è".repeat(64);
    assert_eq!(label_of(&long), Some(long.clone()));
    assert_eq!(label_of(&"è".repeat(65)), None);
}

#[test]
fn at_most_500_keywords() {
    let words: Vec<String> = (0..=MAX_KEYWORDS).map(|i| format!("parola{i}")).collect();
    let refs: Vec<&str> = words.iter().map(String::as_str).collect();
    let m = meta(&lightcraft("", &subject(&refs)));
    assert_eq!(MAX_KEYWORDS, 500);
    assert_eq!(m.keywords.len(), 500);
    assert_eq!(m.keywords.first().map(String::as_str), Some("parola0"));
    assert_eq!(m.keywords.last().map(String::as_str), Some("parola499"));
}

#[test]
fn duplicates_do_not_count_toward_the_limit() {
    let mut words = vec!["doppia".to_string(); 600];
    words.push("ultima".into());
    let refs: Vec<&str> = words.iter().map(String::as_str).collect();
    assert_eq!(
        meta(&lightcraft("", &subject(&refs))).keywords,
        vec!["doppia".to_string(), "ultima".to_string()]
    );
}

#[test]
fn the_same_keyword_twice_and_blank_keywords() {
    let xml = lightcraft("", &subject(&["mare", "  ", "", "mare", " mare ", "monti"]));
    assert_eq!(
        meta(&xml).keywords,
        vec!["mare".to_string(), "monti".to_string()]
    );
}

#[test]
fn a_bom_is_skipped() {
    let mut bytes = b"\xEF\xBB\xBF".to_vec();
    bytes.extend_from_slice(lightcraft("xmp:Rating=\"1\"", "").as_bytes());
    assert_eq!(read(&bytes).unwrap().rating, Some(1));
}

#[test]
fn broken_xmps() {
    assert_eq!(read(b""), Err(XmpError::NotXml));
    assert_eq!(read(b"   \n"), Err(XmpError::NotXml));
    assert_eq!(read(b"non sono xml"), Err(XmpError::NotXml));
    assert_eq!(read(b"<a><b></a>"), Err(XmpError::NotXml));
    assert_eq!(read(b"<a>"), Err(XmpError::NotXml));
    assert_eq!(read(b"<a>&</a>"), Err(XmpError::NotXml));
    assert_eq!(
        read(b"<rdf:Description xmp:Rating=\"1\" xmp:Rating=\"2\"/>"),
        Err(XmpError::NotXml)
    );
    assert_eq!(read(b"testo <a/>"), Err(XmpError::NotXml));
    assert_eq!(read(b"<a/> coda"), Err(XmpError::NotXml));
    assert_eq!(read(b"\xFF\xFE<\0a\0/\0>\0"), Err(XmpError::NotXml));

    for bytes in [&b""[..], b"<a><b></a>"] {
        let model = document_model(&ctx(), bytes);
        assert!(model.frontmatter.is_empty());
        assert!(model.tags.is_empty());
        assert_eq!(model.text, "");
        assert_eq!(model.id.as_str(), "Foto/IMG_0001.CR3.xmp");
    }
}

#[test]
fn an_xmp_without_fields_is_empty_not_broken() {
    assert_eq!(read(b"<x:xmpmeta/>"), Ok(PhotoMeta::default()));
}

#[test]
fn too_large() {
    let mut bytes = lightcraft("xmp:Rating=\"1\"", "").into_bytes();
    bytes.resize(MAX_XMP_BYTES + 1, b' ');
    assert_eq!(read(&bytes), Err(XmpError::TooLarge));
    assert!(document_model(&ctx(), &bytes).frontmatter.is_empty());

    let mut fits = lightcraft("xmp:Rating=\"1\"", "").into_bytes();
    fits.resize(MAX_XMP_BYTES, b' ');
    assert_eq!(read(&fits).unwrap().rating, Some(1));
}

#[test]
fn too_deep() {
    let nested = |n: usize| format!("{}{}", "<a>".repeat(n), "</a>".repeat(n));
    assert!(read(nested(MAX_XMP_DEPTH).as_bytes()).is_ok());
    assert_eq!(
        read(nested(MAX_XMP_DEPTH + 1).as_bytes()),
        Err(XmpError::TooLarge)
    );
    let empty_at_bottom = format!(
        "{}<b/>{}",
        "<a>".repeat(MAX_XMP_DEPTH),
        "</a>".repeat(MAX_XMP_DEPTH)
    );
    assert_eq!(read(empty_at_bottom.as_bytes()), Err(XmpError::TooLarge));
}

#[test]
fn photo_names() {
    assert_eq!(
        photo_candidates("IMG_0001.CR3.xmp"),
        PhotoMatch::Exact("IMG_0001.CR3".into())
    );
    assert_eq!(
        photo_candidates("IMG_0001.xmp"),
        PhotoMatch::Stem("IMG_0001".into())
    );
    assert_eq!(photo_candidates("IMG.xmp"), PhotoMatch::Stem("IMG".into()));
    assert_eq!(
        photo_candidates("archivio.tar.xmp"),
        PhotoMatch::Exact("archivio.tar".into())
    );
    // L'estensione si toglie così com'è scritta, senza piegare il caso.
    assert_eq!(
        photo_candidates("IMG_0002.cr3.XMP"),
        PhotoMatch::Exact("IMG_0002.cr3".into())
    );
    // Le cartelle restano, e un punto in una cartella non è un'estensione.
    assert_eq!(
        photo_candidates("Foto/2026.10/IMG_0003.xmp"),
        PhotoMatch::Stem("Foto/2026.10/IMG_0003".into())
    );
    assert_eq!(
        photo_candidates("Foto/IMG_0003.NEF.xmp"),
        PhotoMatch::Exact("Foto/IMG_0003.NEF".into())
    );
    // Un file nascosto: `.CR3` non è un'estensione.
    assert_eq!(
        photo_candidates(".CR3.xmp"),
        PhotoMatch::Stem(".CR3".into())
    );
    // Nessuna estensione: nessuna foto.
    assert_eq!(photo_candidates("senza"), PhotoMatch::Stem(String::new()));
    assert_eq!(photo_candidates(".xmp"), PhotoMatch::Stem(String::new()));
    assert_eq!(photo_candidates(""), PhotoMatch::Stem(String::new()));
}

#[test]
fn edit_copies() {
    assert_eq!(edit_copy_of("IMG_0001.CR3"), "IMG_0001-Edit.psd");
    assert_eq!(edit_copy_of("Foto/IMG_0001.jpeg"), "Foto/IMG_0001-Edit.psd");
    assert_eq!(edit_copy_of("Foto/v1.2/IMG"), "Foto/v1.2/IMG-Edit.psd");
}
