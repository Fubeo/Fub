//! Prove dei caratteri dei disegni, e i caratteri di prova che le altre prove
//! del disegno usano.

use std::path::PathBuf;
use std::sync::Arc;

use kurbo::Shape;
use resvg::tiny_skia::Pixmap;
use resvg::usvg;
use resvg::usvg::fontdb;
use serde_json::Value;
use skrifa::instance::{Location, Size};
use skrifa::outline::DrawSettings;
use skrifa::raw::{FontData, FontRef, TableProvider};
use skrifa::{GlyphId, MetadataProvider, Tag};
use write_fonts::from_obj::ToOwnedTable;
use write_fonts::tables::name::Name;
use write_fonts::FontBuilder;

use super::describe::{by_name, by_panose, by_shape, Generic, Slot};
use super::instance::{shortest, Contours};
use super::*;

/// Un carattere variabile distribuito con l'app.
pub(crate) fn app_font(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/public/fonts")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// Un'istanza statica di fontTools, accanto al crate.
fn static_font(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fonts")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// Lo stesso carattere con un altro nome di famiglia, perché le prove non
/// usino un nome di Fub.
pub(crate) fn renamed(sfnt: &[u8], family: &str) -> Vec<u8> {
    let font = FontRef::new(sfnt).unwrap();
    let mut name: Name = font.name().unwrap().to_owned_table();
    for record in name.name_record.iter_mut() {
        let id = record.name_id.to_u16();
        if matches!(id, 1 | 16 | 21) {
            record.string = family.to_string().into();
        } else if matches!(id, 4 | 6 | 17 | 22) && id != 17 {
            let full = if id == 6 {
                family.replace(' ', "")
            } else {
                family.to_string()
            };
            record.string = full.into();
        }
    }
    let mut out = FontBuilder::new();
    out.add_table(&name).unwrap();
    out.copy_missing_tables(font);
    out.build()
}

/// Una collezione con i caratteri dati, ognuno con le sue tabelle.
pub(crate) fn collection(fonts: &[&[u8]]) -> Vec<u8> {
    let header = 12 + 4 * fonts.len();
    let mut directories = Vec::new();
    let mut size = header;
    for font in fonts {
        let tables = usize::from(u16::from_be_bytes([font[4], font[5]]));
        directories.push(size);
        size += 12 + 16 * tables;
    }
    let mut out = vec![0u8; size];
    out[..4].copy_from_slice(b"ttcf");
    out[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
    out[8..12].copy_from_slice(&(fonts.len() as u32).to_be_bytes());
    for (i, (font, at)) in fonts.iter().zip(&directories).enumerate() {
        out[12 + 4 * i..16 + 4 * i].copy_from_slice(&(*at as u32).to_be_bytes());
        let tables = usize::from(u16::from_be_bytes([font[4], font[5]]));
        out[*at..*at + 12].copy_from_slice(&font[..12]);
        for t in 0..tables {
            let record = &font[12 + 16 * t..28 + 16 * t];
            let offset = u32::from_be_bytes(record[8..12].try_into().unwrap()) as usize;
            let length = u32::from_be_bytes(record[12..16].try_into().unwrap()) as usize;
            while !out.len().is_multiple_of(4) {
                out.push(0);
            }
            let moved = out.len() as u32;
            out.extend_from_slice(&font[offset..offset + length]);
            let slot = *at + 12 + 16 * t;
            out[slot..slot + 8].copy_from_slice(&record[..8]);
            out[slot + 8..slot + 12].copy_from_slice(&moved.to_be_bytes());
            out[slot + 12..slot + 16].copy_from_slice(&record[12..16]);
        }
    }
    out
}

/// Lo stesso carattere con un altro `fsType`, la licenza d'incorporarlo.
pub(crate) fn with_fs_type(sfnt: &[u8], fs_type: u16) -> Vec<u8> {
    let font = FontRef::new(sfnt).unwrap();
    let record = font
        .table_directory()
        .table_records()
        .iter()
        .find(|record| record.tag() == Tag::new(b"OS/2"))
        .unwrap();
    let at = record.offset() as usize + 8;
    let mut out = sfnt.to_vec();
    out[at..at + 2].copy_from_slice(&fs_type.to_be_bytes());
    out
}

#[test]
fn the_licence_says_whether_a_font_embeds() {
    let font = decode(&app_font("inter-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    assert!(embeddable(&font, 0));
    let cases = [
        (0x0000, true),
        (0x0002, false),
        (0x0004, true),
        (0x0008, true),
        // Due usi insieme: vale quello che concede di più.
        (0x0006, true),
        (0x0100, false),
        (0x0108, false),
        (0x0200, false),
    ];
    for (fs_type, expected) in cases {
        let font = with_fs_type(&font, fs_type);
        assert_eq!(embeddable(&font, 0), expected, "{fs_type:#06x}");
    }
    assert!(embeddable(b"not a font", 0));
}

fn tags(sfnt: &[u8]) -> Vec<String> {
    FontRef::new(sfnt)
        .unwrap()
        .table_directory()
        .table_records()
        .iter()
        .map(|record| record.tag().to_string())
        .collect()
}

#[test]
fn a_woff2_becomes_the_font_inside_and_a_plain_font_stays_as_it_is() {
    let woff2 = app_font("inter-latin-wght-normal.woff2");
    let sfnt = decode(&woff2).unwrap();
    assert_eq!(&sfnt[..4], b"\0\x01\0\0");
    assert!(FontRef::new(&sfnt).is_ok());
    let ttf = static_font("inter-400.ttf");
    assert!(matches!(decode(&ttf).unwrap(), Cow::Borrowed(_)));
}

#[test]
fn what_is_not_a_font_or_promises_too_much_is_refused() {
    assert_eq!(decode(b"<svg/>").unwrap_err(), FontError::NotAFont);
    assert_eq!(decode(b"").unwrap_err(), FontError::NotAFont);
    // Un WOFF2 che promette un carattere più grande del tetto non si apre.
    let mut woff2 = app_font("inter-latin-wght-normal.woff2");
    woff2[16..20].copy_from_slice(&(MAX_FONT_BYTES as u32 + 1).to_be_bytes());
    assert_eq!(decode(&woff2).unwrap_err(), FontError::TooLarge);
    let mut woff = b"wOFF".to_vec();
    woff.resize(44, 0);
    woff[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
    assert_eq!(decode(&woff).unwrap_err(), FontError::TooLarge);
    // Troncato, è un carattere rovinato, non un panico.
    let woff2 = app_font("inter-latin-wght-normal.woff2");
    assert!(matches!(
        decode(&woff2[..woff2.len() / 2]),
        Err(FontError::Damaged(_))
    ));
    assert!(matches!(decode(&woff2[..10]), Err(FontError::Damaged(_))));
}

#[test]
fn a_variable_font_says_its_family_axes_weights_and_generic() {
    let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    let faces = describe(&sfnt).unwrap();
    assert_eq!(faces.len(), 1);
    let inter = &faces[0];
    assert_eq!(inter.family, "Inter");
    assert_eq!(inter.weight, [100.0, 900.0]);
    assert_eq!(inter.stretch, [100.0, 100.0]);
    assert_eq!(inter.generic, Generic::SansSerif);
    assert_eq!(
        inter.styles,
        [Slot {
            style: Style::Normal,
            fixed: vec![]
        }]
    );
    assert_eq!(inter.axes.len(), 1);
    assert_eq!(inter.axes[0].tag, "wght");
    assert!(inter.is_reserved());

    let italic = decode(&app_font("inter-latin-wght-italic.woff2"))
        .unwrap()
        .into_owned();
    assert_eq!(describe(&italic).unwrap()[0].styles[0].style, Style::Italic);
    let serif = decode(&app_font("literata-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    assert_eq!(describe(&serif).unwrap()[0].generic, Generic::Serif);
    let mono = decode(&app_font("jetbrains-mono-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    assert_eq!(describe(&mono).unwrap()[0].generic, Generic::Monospace);

    let bold = describe(&static_font("inter-700.ttf")).unwrap();
    assert_eq!(bold[0].weight, [700.0, 700.0]);
    assert!(bold[0].axes.is_empty());
}

#[test]
fn the_generic_comes_from_the_name_then_the_file_then_the_letters() {
    assert_eq!(by_name("Noto Sans Mono"), Some(Generic::Monospace));
    assert_eq!(by_name("Microsoft Sans Serif"), Some(Generic::SansSerif));
    assert_eq!(by_name("PT Serif Caption"), Some(Generic::Serif));
    assert_eq!(by_name("Roboto-Slab"), Some(Generic::Serif));
    assert_eq!(by_name("Dancing Script"), Some(Generic::Cursive));
    assert_eq!(by_name("Monoton"), None);
    assert_eq!(by_name("Literata"), None);
    assert_eq!(
        by_panose(&[2, 11, 5, 3, 0, 0, 0, 0, 0, 0], 0),
        Some(Generic::SansSerif)
    );
    assert_eq!(
        by_panose(&[2, 2, 5, 3, 0, 0, 0, 0, 0, 0], 0),
        Some(Generic::Serif)
    );
    assert_eq!(
        by_panose(&[3, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0),
        Some(Generic::Cursive)
    );
    assert_eq!(by_panose(&[0; 10], 0x0105), Some(Generic::Serif));
    assert_eq!(by_panose(&[0; 10], 0x0800), Some(Generic::SansSerif));
    assert_eq!(by_panose(&[0; 10], 0), None);
    // Literata non lo dice né col nome né col file: lo dicono le lettere,
    // anche in corsivo, e un corsivo senza grazie resta senza.
    for (name, expected) in [
        ("literata-latin-wght-normal.woff2", Generic::Serif),
        ("literata-latin-wght-italic.woff2", Generic::Serif),
        ("inter-latin-wght-normal.woff2", Generic::SansSerif),
        ("inter-latin-wght-italic.woff2", Generic::SansSerif),
    ] {
        let sfnt = decode(&app_font(name)).unwrap().into_owned();
        assert_eq!(
            by_shape(&FontRef::new(&sfnt).unwrap()),
            Some(expected),
            "{name}"
        );
    }
    let renamed = renamed(&static_font("literata-400.ttf"), "Prova");
    assert_eq!(describe(&renamed).unwrap()[0].generic, Generic::Serif);
}

#[test]
fn a_renamed_face_is_called_by_its_new_name() {
    let sfnt = renamed(&static_font("literata-400.ttf"), "Prova Serif");
    let face = &describe(&sfnt).unwrap()[0];
    assert_eq!(face.family, "Prova Serif");
    assert!(face.is_called("prova serif"));
    assert!(!face.is_reserved());
}

#[test]
fn a_collection_has_one_face_per_font_and_each_comes_out_alone() {
    let first = renamed(&static_font("inter-400.ttf"), "Prima");
    let second = renamed(&static_font("literata-700.ttf"), "Seconda");
    let ttc = collection(&[&first, &second]);
    let faces = describe(&ttc).unwrap();
    let names: Vec<_> = faces
        .iter()
        .map(|face| (face.index, face.family.as_str()))
        .collect();
    assert_eq!(names, [(0, "Prima"), (1, "Seconda")]);
    let alone = instance(&ttc, 1, &[]).unwrap();
    assert_eq!(&alone[..4], b"\0\x01\0\0");
    let face = &describe(&alone).unwrap()[0];
    assert_eq!(
        (face.family.as_str(), face.weight),
        ("Seconda", [700.0, 700.0])
    );
    assert_eq!(instance(&ttc, 2, &[]).unwrap_err(), FontError::NoFace(2));
    assert_eq!(instance(&first, 1, &[]).unwrap_err(), FontError::NoFace(1));
    // Una faccia statica fuori da una collezione esce com'è.
    assert_eq!(instance(&first, 0, &[]).unwrap(), first);
}

#[test]
fn the_shared_vectors_choose_the_same_face() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/scene-fonts/choose.json");
    let text = std::fs::read_to_string(&path).unwrap();
    let vectors: Vec<Value> = serde_json::from_str(&text).unwrap();
    assert!(vectors.len() >= 30);
    for vector in vectors {
        let name = vector["name"].as_str().unwrap();
        let files: Vec<Vec<Face>> = serde_json::from_value(vector["files"].clone())
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let files: Vec<&[Face]> = files.iter().map(Vec::as_slice).collect();
        let family = vector["family"].as_str().unwrap();
        if let Some(generic) = vector["expect"].get("generic") {
            let expected: Generic = serde_json::from_value(generic.clone()).unwrap();
            assert_eq!(family_generic(&files, family), Some(expected), "{name}");
            continue;
        }
        let request: Request = serde_json::from_value(vector["request"].clone()).unwrap();
        let actual =
            choose(&files, family, &request).map(|choice| serde_json::to_value(choice).unwrap());
        let expected = &vector["expect"];
        match (actual, expected) {
            (None, Value::Null) => {}
            (Some(actual), Value::Object(_)) => {
                assert_eq!(actual["file"], expected["file"], "{name}");
                assert_eq!(actual["face"], expected["face"], "{name}");
                let pairs = |value: &Value| -> Vec<(String, f64)> {
                    value["coordinates"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|c| {
                            (
                                c["tag"].as_str().unwrap().to_string(),
                                c["value"].as_f64().unwrap(),
                            )
                        })
                        .collect()
                };
                assert_eq!(pairs(&actual), pairs(expected), "{name}");
            }
            (actual, expected) => panic!("{name}: {actual:?} invece di {expected}"),
        }
    }
}

/// Le misure di un glifo, per confrontare due caratteri glifo per glifo:
/// la larghezza, il riquadro dei contorni, l'area che racchiudono e la
/// loro lunghezza.
fn glyphs(sfnt: &[u8]) -> Vec<(u16, [f64; 4], f64, f64)> {
    let font = FontRef::new(sfnt).unwrap();
    let outlines = font.outline_glyphs();
    let hmtx = font.hmtx().unwrap();
    let location = Location::default();
    (0..font.maxp().unwrap().num_glyphs())
        .map(|gid| {
            let id = GlyphId::new(u32::from(gid));
            let mut pen = Contours::default();
            if let Some(glyph) = outlines.get(id) {
                glyph
                    .draw(
                        DrawSettings::unhinted(Size::unscaled(), &location),
                        &mut pen,
                    )
                    .unwrap();
            }
            let path = pen.finish();
            let b = path.bounding_box();
            let area = path.area();
            (
                hmtx.advance(id).unwrap(),
                [b.x0, b.y0, b.x1, b.y1],
                area,
                path.perimeter(0.1),
            )
        })
        .collect()
}

/// Un testo disegnato da `resvg` con un carattere solo.
fn render(sfnt: Vec<u8>, text: &str) -> Pixmap {
    let mut db = fontdb::Database::new();
    db.load_font_source(fontdb::Source::Binary(Arc::new(sfnt)));
    let family = db.faces().next().unwrap().families[0].0.clone();
    let svg = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="120"><text x="10" y="90" font-family="{family}" font-size="72">{text}</text></svg>"#
    );
    let options = usvg::Options {
        fontdb: Arc::new(db),
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(&svg, &options).unwrap();
    let mut pixmap = Pixmap::new(1400, 120).unwrap();
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );
    pixmap
}

/// Quanti pixel cambiano di più di un ottavo fra due immagini.
fn changed(a: &Pixmap, b: &Pixmap) -> usize {
    a.data()
        .chunks(4)
        .zip(b.data().chunks(4))
        .filter(|(x, y)| x[3].abs_diff(y[3]) > 32)
        .count()
}

const KERNED: &str = "AVATAR WAVE Ty To Yo P. «Vè»";

#[test]
fn the_bold_instance_is_the_one_fonttools_made() {
    // Il grassetto di Inter che l'export usa da sempre l'ha fissato
    // fontTools, dallo stesso file variabile: l'istanza di qui deve
    // essere lo stesso carattere, glifo per glifo, entro un'unità per
    // punto. Un punto può cadere sull'altra unità: fontTools conta le
    // coordinate normalizzate coi decimali, la specifica e i motori in
    // F2Dot14, e il punto di Inter sale a 324,505 unità, 325 qui e 324
    // in fontTools.
    let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    let coordinates = [Coordinate {
        tag: "wght".into(),
        value: 700.0,
    }];
    let ours = instance(&sfnt, 0, &coordinates).unwrap();
    let theirs = static_font("inter-700.ttf");
    let (a, b) = (glyphs(&ours), glyphs(&theirs));
    assert_eq!(a.len(), b.len());
    for (gid, (mine, other)) in a.iter().zip(&b).enumerate() {
        assert!(
            mine.0.abs_diff(other.0) <= 1,
            "glifo {gid}: larghezza {} invece di {}",
            mine.0,
            other.0
        );
        for k in 0..4 {
            assert!(
                (mine.1[k] - other.1[k]).abs() <= 1.0,
                "glifo {gid}: riquadro {:?} invece di {:?}",
                mine.1,
                other.1
            );
        }
        // Un'unità su tutto il contorno sposta l'area al più della sua
        // lunghezza; un grassetto sbagliato di cento la sposta di dieci.
        assert!(
            (mine.2 - other.2).abs() <= other.3.max(1.0),
            "glifo {gid}: area {} invece di {}",
            mine.2,
            other.2
        );
    }
    // La crenatura del grassetto: lo stesso testo esce uguale.
    let pixels = changed(&render(ours, KERNED), &render(theirs, KERNED));
    assert!(pixels <= 60, "{pixels} pixel diversi");
}

#[test]
fn the_kerning_of_the_bold_is_not_the_kerning_of_the_regular() {
    // La prova di sopra vede la crenatura: col GPOS di serie, il
    // grassetto ha la crenatura del tondo e il testo si sposta.
    let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    let coordinates = [Coordinate {
        tag: "wght".into(),
        value: 700.0,
    }];
    let ours = instance(&sfnt, 0, &coordinates).unwrap();
    let font = FontRef::new(&ours).unwrap();
    let original = FontRef::new(&sfnt).unwrap();
    let mut unsettled = FontBuilder::new();
    unsettled.add_raw(
        Tag::new(b"GPOS"),
        original.data_for_tag(Tag::new(b"GPOS")).unwrap().as_bytes(),
    );
    unsettled.copy_missing_tables(font);
    let unsettled = unsettled.build();
    let theirs = static_font("inter-700.ttf");
    let settled = changed(&render(ours, KERNED), &render(theirs.clone(), KERNED));
    let default = changed(&render(unsettled, KERNED), &render(theirs, KERNED));
    assert!(
        default > settled * 4 && default > 200,
        "{default} contro {settled}"
    );
}

#[test]
fn an_instance_has_no_axes_and_says_its_weight() {
    let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    let coordinates = [Coordinate {
        tag: "wght".into(),
        value: 600.0,
    }];
    let font = instance(&sfnt, 0, &coordinates).unwrap();
    let tables = tags(&font);
    for gone in ["fvar", "gvar", "avar", "HVAR", "MVAR", "STAT"] {
        assert!(
            !tables.iter().any(|tag| tag == gone),
            "{gone} in {tables:?}"
        );
    }
    for kept in [
        "glyf", "loca", "hmtx", "cmap", "name", "GPOS", "GSUB", "OS/2", "post",
    ] {
        assert!(tables.iter().any(|tag| tag == kept), "manca {kept}");
    }
    let face = &describe(&font).unwrap()[0];
    assert_eq!(face.weight, [600.0, 600.0]);
    assert!(face.axes.is_empty());
    assert_eq!(face.family, "Inter");
    let read = FontRef::new(&font).unwrap();
    assert_eq!(read.os2().unwrap().us_weight_class(), 600);
    // Un'istanza si rilegge con `fontdb`, e il punto di un asse fuori dal
    // carattere si ferma al bordo.
    let heavy = instance(
        &sfnt,
        0,
        &[Coordinate {
            tag: "wght".into(),
            value: 2000.0,
        }],
    )
    .unwrap();
    assert_eq!(describe(&heavy).unwrap()[0].weight, [900.0, 900.0]);
    // Due istanze dello stesso punto sono gli stessi byte.
    assert_eq!(instance(&sfnt, 0, &coordinates).unwrap(), font);
}

#[test]
fn an_instance_has_its_own_postscript_name() {
    let names = |file: &str, weights: &[f64]| -> Vec<String> {
        let sfnt = decode(&app_font(file)).unwrap().into_owned();
        weights
            .iter()
            .map(|weight| {
                let coordinates = [Coordinate {
                    tag: "wght".into(),
                    value: *weight,
                }];
                let font = instance(&sfnt, 0, &coordinates).unwrap();
                let mut db = fontdb::Database::new();
                db.load_font_source(fontdb::Source::Binary(Arc::new(font)));
                let name = db.faces().next().unwrap().post_script_name.clone();
                name
            })
            .collect()
    };
    assert_eq!(
        names(
            "inter-latin-wght-normal.woff2",
            &[400.0, 600.0, 650.0, 700.0]
        ),
        [
            "Inter-Regular",
            "Inter-SemiBold",
            "Inter_650wght",
            "Inter-Bold"
        ]
    );
    // Il corsivo di Literata non ha istanze con nome né un prefisso suo.
    assert_eq!(
        names("literata-latin-wght-italic.woff2", &[400.0, 600.0, 650.5]),
        [
            "Literata-Italic",
            "LiterataItalic_600wght",
            "LiterataItalic_650.5wght"
        ]
    );
    assert_eq!(shortest(87.5), "87.5");
    assert_eq!(shortest(-12.0), "-12");
    assert_eq!(shortest(-0.0), "0");
    assert_eq!(shortest(1.0 / 3.0), "0.33333");
    assert_eq!(shortest(650.0), "650");
}

#[test]
fn the_default_point_keeps_the_outlines_and_drops_the_axes() {
    let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
        .unwrap()
        .into_owned();
    let font = instance(&sfnt, 0, &[]).unwrap();
    let read = FontRef::new(&font).unwrap();
    let original = FontRef::new(&sfnt).unwrap();
    assert!(read.axes().is_empty());
    assert_eq!(
        read.data_for_tag(Tag::new(b"glyf")).unwrap().as_bytes(),
        original.data_for_tag(Tag::new(b"glyf")).unwrap().as_bytes()
    );
    assert_eq!(describe(&font).unwrap()[0].weight, [400.0, 400.0]);
}

#[test]
fn every_app_font_survives_an_instance_at_every_weight_of_the_menu() {
    for name in [
        "inter-latin-wght-normal.woff2",
        "inter-latin-wght-italic.woff2",
        "literata-latin-wght-normal.woff2",
        "literata-latin-wght-italic.woff2",
        "jetbrains-mono-latin-wght-normal.woff2",
        "jetbrains-mono-latin-wght-italic.woff2",
    ] {
        let sfnt = decode(&app_font(name)).unwrap().into_owned();
        for weight in [300.0, 500.0, 800.0] {
            let font = instance(
                &sfnt,
                0,
                &[Coordinate {
                    tag: "wght".into(),
                    value: weight,
                }],
            )
            .unwrap_or_else(|e| panic!("{name} {weight}: {e}"));
            let read = FontRef::new(&font).unwrap();
            let gpos = read.gpos().unwrap();
            // Il GPOS riscritto si rilegge, e tutto il carattere anche.
            assert!(gpos.lookup_list().is_ok(), "{name}");
            assert!(!glyphs(&font).is_empty());
            let _ = FontData::new(&font);
        }
    }
}
