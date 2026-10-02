//! Il codec di `fub:ink` e la lettura di `fub:brush` (§5): andata e ritorno
//! con l'errore della quantizzazione, ogni input malformato con il suo errore,
//! e la diagnostica S004 e S010 sui tratti di una scena.

mod common;

use common::{at, doc, load};
use fub_scene::ink::{INK_MAX_BYTES, INK_MAX_SAMPLES, MAX_SAFE_INTEGER};
use fub_scene::{Brush, BrushError, Code, Ink, InkError, Role, Sample, Scale, Severity};

/// Un generatore pseudo-casuale con seme fisso: xorshift64*.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn between(&mut self, min: f64, max: f64) -> f64 {
        min + (max - min) * self.next()
    }
}

/// Un tratto che va avanti e indietro, con pressione e inclinazione a scelta.
fn stroke(rng: &mut Rng, count: usize, pressure: bool, tilt: bool) -> Vec<Sample> {
    let (mut x, mut y, mut t) = (rng.between(-500.0, 500.0), rng.between(-500.0, 500.0), 0.0);
    (0..count)
        .map(|i| {
            if i > 0 {
                x += rng.between(-3.0, 3.0);
                y += rng.between(-3.0, 3.0);
                t += rng.between(0.0, 12.0);
            }
            Sample {
                x,
                y,
                p: pressure.then(|| rng.between(-0.1, 1.1)),
                t,
                tilt: tilt.then(|| (rng.between(0.0, 95.0), rng.between(-10.0, 370.0))),
            }
        })
        .collect()
}

#[test]
fn a_round_trip_loses_only_the_quantization() {
    let mut rng = Rng(0x00f0_bd4a_2026_1002);
    for scale in [Scale::S10, Scale::S100] {
        for (pressure, tilt) in [(false, false), (true, false), (false, true), (true, true)] {
            for count in [1, 2, 137, INK_MAX_SAMPLES] {
                let samples = stroke(&mut rng, count, pressure, tilt);
                let ink = Ink::quantize(&samples, scale).unwrap();
                let text = ink.encode();
                assert!(text.len() <= INK_MAX_BYTES);
                let read = Ink::decode(&text).unwrap();
                assert_eq!(read, ink);
                assert_eq!(read.encode(), text);
                assert_eq!(read.len(), count);
                let half = 0.5 / scale.factor() + 1e-9;
                let p = read.channel('p');
                let t = read.channel('t').unwrap();
                for (i, sample) in samples.iter().enumerate() {
                    let [x, y] = read.point(i);
                    assert!((x - sample.x).abs() <= half && (y - sample.y).abs() <= half);
                    assert!((read.sample(i)[t] as f64 - sample.t).abs() <= 0.5);
                    if let (Some(p), Some(raw)) = (p, sample.p) {
                        let quantized = read.sample(i)[p] as f64 / 255.0;
                        assert!((quantized - raw.clamp(0.0, 1.0)).abs() <= 0.5 / 255.0 + 1e-9);
                    }
                }
                if count > 1 {
                    // I tratti vanno anche indietro: ci sono delta negativi.
                    assert!(text.split(' ').skip(4).any(|s| s.contains('-')));
                }
            }
        }
    }
}

#[test]
fn quantization_follows_the_typescript_rules() {
    let sample = |x: f64, p: Option<f64>, tilt: Option<(f64, f64)>| Sample {
        x,
        y: 0.0,
        p,
        t: 0.0,
        tilt,
    };
    let quantize = |s: Sample| Ink::quantize(&[s], Scale::S100).unwrap();
    // `floor(v × 100 + 0,5)`: i mezzi vanno verso l'alto, anche sotto zero.
    assert_eq!(quantize(sample(0.005, None, None)).sample(0)[0], 1);
    assert_eq!(quantize(sample(-0.005, None, None)).sample(0)[0], 0);
    assert_eq!(quantize(sample(-0.0051, None, None)).sample(0)[0], -1);
    assert_eq!(quantize(sample(120.5, None, None)).channels(), "xyt");
    // Pressione portata in 0…1, poi per 255.
    assert_eq!(quantize(sample(0.0, Some(1.5), None)).sample(0)[2], 255);
    assert_eq!(quantize(sample(0.0, Some(-1.0), None)).sample(0)[2], 0);
    assert_eq!(quantize(sample(0.0, Some(0.5), None)).sample(0)[2], 128);
    // Altitudine portata in 0…90, azimut modulo 360.
    let tilted = quantize(sample(0.0, Some(0.5), Some((120.0, 359.5))));
    assert_eq!(tilted.channels(), "xyptaz");
    assert_eq!(&tilted.sample(0)[4..], [90, 0]);
    assert_eq!(
        &quantize(sample(0.0, None, Some((-5.0, -1.0)))).sample(0)[3..],
        [0, 359]
    );
    assert_eq!(
        &quantize(sample(0.0, None, Some((45.4, 720.6)))).sample(0)[3..],
        [45, 1]
    );
}

#[test]
fn quantization_refuses_what_it_could_not_write() {
    let base = Sample {
        x: 0.0,
        y: 0.0,
        p: None,
        t: 0.0,
        tilt: None,
    };
    let at = |t: f64| Sample { t, ..base };
    assert_eq!(Ink::quantize(&[], Scale::S100), Err(InkError::NoSamples));
    assert_eq!(
        Ink::quantize(&[at(0.3)], Scale::S100),
        Err(InkError::FirstTime)
    );
    let many = vec![base; INK_MAX_SAMPLES + 1];
    assert_eq!(
        Ink::quantize(&many, Scale::S100),
        Err(InkError::TooManySamples)
    );
    let mixed = [
        base,
        Sample {
            p: Some(0.5),
            ..base
        },
    ];
    assert_eq!(
        Ink::quantize(&mixed, Scale::S10),
        Err(InkError::MixedChannels { sample: 1 })
    );
    let mixed = [
        base,
        Sample {
            tilt: Some((1.0, 2.0)),
            ..base
        },
    ];
    assert_eq!(
        Ink::quantize(&mixed, Scale::S10),
        Err(InkError::MixedChannels { sample: 1 })
    );
    let broken = [
        base,
        Sample {
            y: f64::NAN,
            ..base
        },
    ];
    assert_eq!(
        Ink::quantize(&broken, Scale::S10),
        Err(InkError::NonFinite { sample: 1 })
    );
    let broken = [
        base,
        Sample {
            x: f64::INFINITY,
            ..base
        },
    ];
    assert_eq!(
        Ink::quantize(&broken, Scale::S10),
        Err(InkError::NonFinite { sample: 1 })
    );
    let huge = [base, Sample { x: 1e15, ..base }];
    assert_eq!(
        Ink::quantize(&huge, Scale::S100),
        Err(InkError::Overflow { sample: 1 })
    );
}

#[test]
fn every_malformed_ink_has_its_error() {
    for (text, error) in [
        ("", InkError::Syntax),
        ("1", InkError::Syntax),
        ("1 s100", InkError::Syntax),
        ("1  s100 cxy 0,0", InkError::Syntax),
        (" 1 s100 cxy 0,0", InkError::Syntax),
        ("1 s100 cxy 0,0 ", InkError::Syntax),
        ("1 s100 cxy 0,0  1,1", InkError::Syntax),
        ("2 s100 cxy 0,0", InkError::Version),
        ("01 s100 cxy 0,0", InkError::Version),
        ("1 s1000 cxy 0,0", InkError::Scale),
        ("1 S100 cxy 0,0", InkError::Scale),
        ("1 s100 xy 0,0", InkError::Channels),
        ("1 s100 cyx 0,0", InkError::Channels),
        ("1 s100 cx 0", InkError::Channels),
        ("1 s100 cxyy 0,0,0", InkError::Channels),
        ("1 s100 cxypp 0,0,0,0", InkError::Channels),
        ("1 s100 cxy1 0,0,0", InkError::Channels),
        ("1 s100 Cxy 0,0", InkError::Channels),
        ("1 s100 cxya 0,0,0", InkError::Tilt),
        ("1 s100 cxyz 0,0,0", InkError::Tilt),
        ("1 s100 cxy", InkError::NoSamples),
        ("1 s100 cxy 0", InkError::Arity { sample: 0 }),
        ("1 s100 cxy 0,0 1,1,1", InkError::Arity { sample: 1 }),
        ("1 s100 cxy 0,0 1", InkError::Arity { sample: 1 }),
        ("1 s100 cxy 0,0 1,", InkError::Integer { sample: 1 }),
        ("1 s100 cxy 0,0 ,1", InkError::Integer { sample: 1 }),
        ("1 s100 cxy 0,0 +1,1", InkError::Integer { sample: 1 }),
        ("1 s100 cxy 0.5,0", InkError::Integer { sample: 0 }),
        ("1 s100 cxy 1e3,0", InkError::Integer { sample: 0 }),
        ("1 s100 cxy -,0", InkError::Integer { sample: 0 }),
        ("1 s100 cxy 0,0\t1,1", InkError::Integer { sample: 0 }),
        (
            "1 s100 cxy 9007199254740992,0",
            InkError::Overflow { sample: 0 },
        ),
        (
            "1 s100 cxy 9007199254740991,0 1,0",
            InkError::Overflow { sample: 1 },
        ),
        (
            "1 s100 cxy -9007199254740991,0 -1,0",
            InkError::Overflow { sample: 1 },
        ),
        ("1 s100 cxyt 0,0,5", InkError::FirstTime),
        (
            "1 s100 cxypt 0,0,256,0",
            InkError::Range {
                sample: 0,
                channel: 'p',
            },
        ),
        (
            "1 s100 cxypt 0,0,255,0 0,0,-256,1",
            InkError::Range {
                sample: 1,
                channel: 'p',
            },
        ),
        (
            "1 s100 cxyaz 0,0,91,0",
            InkError::Range {
                sample: 0,
                channel: 'a',
            },
        ),
        (
            "1 s100 cxyaz 0,0,0,359 0,0,0,1",
            InkError::Range {
                sample: 1,
                channel: 'z',
            },
        ),
        (
            "1 s100 cxyaz 0,0,0,-1",
            InkError::Range {
                sample: 0,
                channel: 'z',
            },
        ),
    ] {
        assert_eq!(Ink::decode(text), Err(error), "{text:?}");
    }
}

#[test]
fn the_limits_are_inclusive() {
    // 10 000 campioni sì, 10 001 no.
    let samples = |n: usize| format!("1 s10 cxy 0,0{}", " 1,-1".repeat(n - 1));
    assert_eq!(
        Ink::decode(&samples(INK_MAX_SAMPLES)).unwrap().len(),
        INK_MAX_SAMPLES
    );
    assert_eq!(
        Ink::decode(&samples(INK_MAX_SAMPLES + 1)),
        Err(InkError::TooManySamples)
    );
    // 512 KiB sì, un byte in più no: gli zeri in testa sono ammessi.
    let sized = |bytes: usize| {
        let head = "1 s100 cxy 0,";
        format!("{head}{}1", "0".repeat(bytes - head.len() - 1))
    };
    assert_eq!(sized(INK_MAX_BYTES).len(), INK_MAX_BYTES);
    assert!(Ink::decode(&sized(INK_MAX_BYTES)).is_ok());
    assert_eq!(
        Ink::decode(&sized(INK_MAX_BYTES + 1)),
        Err(InkError::TooLarge)
    );
    // Gli interi al bordo dei numeri sicuri di JavaScript.
    let edge = format!("1 s100 cxy {MAX_SAFE_INTEGER},-{MAX_SAFE_INTEGER} -1,1");
    let ink = Ink::decode(&edge).unwrap();
    assert_eq!(ink.sample(1), [MAX_SAFE_INTEGER - 1, -MAX_SAFE_INTEGER + 1]);
}

#[test]
fn optional_and_unknown_channels() {
    let ink = Ink::decode("1 s10 cxy 5,-5").unwrap();
    assert_eq!(
        (ink.len(), ink.duration(), ink.unknown_channels()),
        (1, None, String::new())
    );
    let ink = Ink::decode("1 s10 cxyqtWp 0,0,7,0,1,255 1,1,-7,30,2,-255").unwrap();
    assert_eq!(ink.unknown_channels(), "qW");
    assert_eq!(ink.duration(), Some(30));
    assert_eq!(ink.sample(1), [1, 1, 0, 30, 3, 0]);
    // Un canale noto si controlla anche in mezzo agli sconosciuti.
    assert_eq!(
        Ink::decode("1 s10 cxyqp 0,0,0,300"),
        Err(InkError::Range {
            sample: 0,
            channel: 'p'
        })
    );
}

#[test]
fn new_checks_what_encode_will_write() {
    assert!(Ink::new(Scale::S10, "xy", vec![0, 0, -3, 4]).is_ok());
    assert_eq!(Ink::new(Scale::S10, "xy", vec![]), Err(InkError::NoSamples));
    assert_eq!(
        Ink::new(Scale::S10, "xy", vec![0, 0, 1]),
        Err(InkError::Arity { sample: 1 })
    );
    assert_eq!(
        Ink::new(Scale::S10, "yx", vec![0, 0]),
        Err(InkError::Channels)
    );
    let far = vec![MAX_SAFE_INTEGER, 0, -MAX_SAFE_INTEGER, 0];
    assert_eq!(
        Ink::new(Scale::S10, "xy", far),
        Err(InkError::Overflow { sample: 1 })
    );
    assert_eq!(
        Ink::new(Scale::S10, "xy", vec![i64::MIN, 0]),
        Err(InkError::Overflow { sample: 0 })
    );
    assert_eq!(
        Ink::new(Scale::S10, "xyt", vec![0, 0, 1]),
        Err(InkError::FirstTime)
    );
}

#[test]
fn the_canonical_brush_reads_back() {
    let brush = Brush::parse(
        "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0",
    )
    .unwrap();
    assert_eq!(
        brush,
        Brush {
            size: 4.0,
            sim: false,
            ..Brush::default()
        }
    );
}

#[test]
fn a_missing_key_takes_the_default_of_get_stroke() {
    let brush = Brush::parse("pf1").unwrap();
    assert_eq!(brush, Brush::default());
    assert_eq!(brush.size, 16.0);
    assert!(brush.cap_start && brush.cap_end && brush.sim);
    let brush = Brush::parse("pf1 size=2.5 sim=0").unwrap();
    assert_eq!((brush.size, brush.thinning, brush.sim), (2.5, 0.5, false));
}

#[test]
fn unknown_keys_are_kept_in_order_even_repeated() {
    let brush = Brush::parse("pf1 future=x size=3 other=1=2 future=y").unwrap();
    let unknown: Vec<_> = brush
        .unknown
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    assert_eq!(
        unknown,
        [("future", "x"), ("other", "1=2"), ("future", "y")]
    );
    assert_eq!(brush.size, 3.0);
}

#[test]
fn brush_values_are_svg_numbers_between_xml_spaces() {
    let brush = Brush::parse(
        "  pf1\tsize=1e1\n thinning=-.25\r\nsmoothing=+0.75  streamline=1. capEnd=0.0 ",
    )
    .unwrap();
    assert_eq!(brush.size, 10.0);
    assert_eq!(brush.thinning, -0.25);
    assert_eq!(brush.smoothing, 0.75);
    assert_eq!(brush.streamline, 1.0);
    assert!(!brush.cap_end);
    assert!(Brush::parse("pf1 capStart=1e0 sim=-0").is_ok());
    assert_eq!(Brush::parse("pf1 thinning=-1").unwrap().thinning, -1.0);
    assert_eq!(Brush::parse("pf1 taperEnd=1000").unwrap().taper_end, 1000.0);
}

#[test]
fn every_malformed_brush_has_its_error() {
    for (text, error) in [
        ("", BrushError::Algorithm),
        ("pf2 size=4", BrushError::Algorithm),
        ("PF1", BrushError::Algorithm),
        ("size=4 pf1", BrushError::Algorithm),
        ("pf1size=4", BrushError::Algorithm),
        ("pf1 size", BrushError::Entry),
        ("pf1 =4", BrushError::Entry),
        ("pf1 size=", BrushError::Entry),
        ("pf1 future=", BrushError::Entry),
        ("pf1 size=4 size=5", BrushError::Repeated("size")),
        ("pf1 sim=1 future=1 sim=1", BrushError::Repeated("sim")),
        ("pf1 size=0x10", BrushError::Number("size")),
        ("pf1 size=Infinity", BrushError::Number("size")),
        ("pf1 size=4px", BrushError::Number("size")),
        ("pf1 size=1e400", BrushError::Number("size")),
        ("pf1 thinning=.", BrushError::Number("thinning")),
        ("pf1 taperStart=1e", BrushError::Number("taperStart")),
        ("pf1 capEnd=true", BrushError::Number("capEnd")),
        ("pf1 size=0", BrushError::Range("size")),
        ("pf1 size=-2", BrushError::Range("size")),
        ("pf1 thinning=1.5", BrushError::Range("thinning")),
        ("pf1 thinning=-1.01", BrushError::Range("thinning")),
        ("pf1 smoothing=-0.1", BrushError::Range("smoothing")),
        ("pf1 streamline=2", BrushError::Range("streamline")),
        ("pf1 taperStart=-1", BrushError::Range("taperStart")),
        ("pf1 taperEnd=-0.5", BrushError::Range("taperEnd")),
        ("pf1 capStart=2", BrushError::Range("capStart")),
        ("pf1 sim=0.5", BrushError::Range("sim")),
    ] {
        assert_eq!(Brush::parse(text), Err(error), "{text:?}");
    }
}

/// Un tratto con inchiostro e pennello dati.
fn stroke_doc(attributes: &str) -> String {
    doc(&format!(
        r##"<path id="o1" fub:tool="pen" d="M0 0 Q1 1 2 2 Z" fill="#0072b2" {attributes}/>"##
    ))
}

const BRUSH: &str = r#"fub:brush="pf1 size=4 sim=0""#;

#[test]
fn a_valid_stroke_is_redrawable() {
    let scene = load(&stroke_doc(&format!(
        r#"{BRUSH} fub:ink="1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8""#
    )));
    let stroke = at(&scene, &[0]).unwrap().stroke.clone().unwrap();
    assert!(stroke.redrawable);
    assert_eq!((stroke.samples, stroke.duration), (Some(3), Some(16)));
    assert!(scene.diagnostics.is_empty());
    assert!(scene.editable());
}

#[test]
fn an_invalid_ink_or_brush_is_s004_and_keeps_the_stroke_editable() {
    for (attributes, details) in [
        (
            format!(r#"{BRUSH} fub:ink="1 s100 cxy 0,0 1""#),
            vec!["fub:ink arity 1"],
        ),
        (
            format!(r#"{BRUSH} fub:ink="1 s100 cxyp 0,0,300""#),
            vec!["fub:ink range 0 p"],
        ),
        (BRUSH.to_owned(), vec!["fub:ink missing"]),
        (
            r#"fub:ink="1 s10 cxy 0,0""#.to_owned(),
            vec!["fub:brush missing"],
        ),
        (
            r#"fub:ink="1 s10 cxy 0,0" fub:brush="pf1 size=4 size=4""#.to_owned(),
            vec!["fub:brush repeated size"],
        ),
        (
            r#"fub:ink="2 s10 cxy 0,0" fub:brush="pf2""#.to_owned(),
            vec!["fub:ink version", "fub:brush algorithm"],
        ),
    ] {
        let source = stroke_doc(&attributes);
        let scene = load(&source);
        let element = at(&scene, &[0]).unwrap();
        assert_eq!(element.role, Role::Stroke, "{attributes}");
        assert!(!element.stroke.as_ref().unwrap().redrawable);
        let found: Vec<_> = scene
            .diagnostics
            .iter()
            .map(|d| d.detail.as_deref().unwrap())
            .collect();
        assert_eq!(found, details, "{attributes}");
        assert!(scene
            .diagnostics
            .iter()
            .all(|d| d.code == Code::S004 && d.severity == Severity::Error));
        assert!(scene
            .diagnostics
            .iter()
            .all(|d| d.span == Some(element.span)));
        // Il documento resta modificabile.
        assert!(scene.editable());
    }
}

#[test]
fn unknown_channels_are_s010() {
    let scene = load(&stroke_doc(&format!(
        r#"{BRUSH} fub:ink="1 s100 cxytq 0,0,0,5 1,1,4,-5""#
    )));
    let stroke = at(&scene, &[0]).unwrap().stroke.clone().unwrap();
    assert!(!stroke.redrawable);
    assert_eq!((stroke.samples, stroke.duration), (Some(2), Some(4)));
    assert_eq!(scene.diagnostics.len(), 1);
    let diagnostic = &scene.diagnostics[0];
    assert_eq!(
        (diagnostic.code, diagnostic.severity),
        (Code::S010, Severity::Info)
    );
    assert_eq!(diagnostic.detail.as_deref(), Some("q"));
}

#[test]
fn ink_and_brush_matter_only_on_strokes() {
    // Su un tracciato o su un elemento estraneo non si leggono.
    let source = doc(
        r#"<path d="M0 0" fub:ink="rotto" fub:brush="rotto"/><use fub:tool="pen" fub:ink="x"/>"#,
    );
    let scene = load(&source);
    assert!(scene.diagnostics.iter().all(|d| d.code == Code::S002));
    assert!(at(&scene, &[0]).unwrap().stroke.is_none());
}
