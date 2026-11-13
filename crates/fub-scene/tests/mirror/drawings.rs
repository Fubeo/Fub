//! Le fixture committate di base: `sparse`, `foreign`, `crlf-bom` e
//! `doctype`.

use super::*;

// ---------------------------------------------------------------------------
// Le quattro fixture committate.
// ---------------------------------------------------------------------------

/// `sparse`: l'esempio di §13 allargato a ogni ruolo.
pub(super) fn sparse() -> String {
    let pen: Vec<Sample> = (0..12)
        .map(|i| {
            let i = f64::from(i);
            Sample {
                x: 120.5 + 2.5 * i + 0.013 * (i % 3.0),
                y: 30.2 - 0.37 * i,
                p: Some((100.0 + 10.0 * i) / 255.0),
                t: 8.0 * i,
                tilt: None,
            }
        })
        .collect();
    let highlighter: Vec<Sample> = (0..5)
        .map(|i| {
            let i = f64::from(i);
            Sample {
                x: 300.0 + 40.0 * i,
                y: 455.0,
                p: None,
                t: 16.0 * i,
                tilt: None,
            }
        })
        .collect();
    let group = El::new("g")
        .a("id", "o00000010")
        .a("fub:locked", "true")
        .a("transform", "matrix(0.866 0.5 -0.5 0.866 40 -20)")
        .child(
            El::new("rect")
                .a("id", "o00000011")
                .a("x", 900)
                .a("y", 100)
                .a("width", 160)
                .a("height", 90)
                .a("rx", 12)
                .a("fill", "#009e73"),
        )
        .child(
            El::new("circle")
                .a("id", "o00000012")
                .a("cx", 1200)
                .a("cy", 150)
                .a("r", 40)
                .a("fill", "#cc79a7"),
        )
        .child(
            El::new("line")
                .a("id", "o00000013")
                .a("x1", 900)
                .a("y1", 250)
                .a("x2", "1.5in")
                .a("y2", 250)
                .a("stroke", "#000000")
                .a("stroke-width", 2)
                .a("stroke-dasharray", "8 4"),
        )
        .child(
            El::new("polyline")
                .a("id", "o00000014")
                .a("points", "900,300 950,280 1000,320 1050,290")
                .a("fill", "none")
                .a("stroke", "#0072b2")
                .a("stroke-width", 3),
        )
        .child(
            El::new("polygon")
                .a("id", "o00000015")
                .a("points", "1100 300 1160 340 1080 360")
                .a("fill", "#d55e00")
                .a("opacity", "0.8")
                .a("display", "none"),
        )
        .child(
            El::new("path")
                .a("id", "o00000016")
                .a(
                    "d",
                    "M900 400 C950 350 1000 450 1050 400 A40 40 0 0 1 1130 400 Q1160 360 1190 400 Z",
                )
                .a("fill", "none")
                .a("stroke", "#000000")
                .a("stroke-width", 2),
        )
        .child(
            El::new("image")
                .a("id", "o00000017")
                .a("x", 1250)
                .a("y", 300)
                .a("width", 200)
                .a("height", 150)
                .a("preserveAspectRatio", "xMidYMid slice")
                .a("href", "foto/mare.png"),
        )
        // Un elemento estraneo dentro un gruppo modificabile: un blocco.
        .child(El::new("use").a("href", "#o1a2b3c4d").a("x", 10));
    let text = El::new("text")
        .a("id", "o9i0j1k2l")
        .a("x", 720)
        .a("y", 460)
        .a("fill", "#000000")
        .a("font-family", "Inter, sans-serif")
        .a("font-size", 32)
        .child(El::new("tspan").a("x", 720).a("dy", 0).text("Evaporazione"))
        .child(El::new("tspan").a("x", 720).a("dy", 40).text("& condensa"))
        // Una riga coi pezzi e la tipografia: corsivo, spaziatura, colore,
        // grassetto e sottolineato in un pezzo.
        .child(
            El::new("tspan")
                .a("x", 720)
                .a("dy", 40)
                .a("font-style", "italic")
                .a("letter-spacing", 1.5)
                .markup(r##"in <tspan fill="#0072b2" font-weight="bold" text-decoration="underline">pioggia</tspan>"##),
        );
    let first = layer("l3f8a0c2d", "Livello 1")
        .child(
            El::new("ellipse")
                .a("id", "o1a2b3c4d")
                .a("cx", 300)
                .a("cy", 200)
                .a("rx", 120)
                .a("ry", 60)
                .a("fill", "none")
                .a("stroke", "#0072b2")
                .a("stroke-width", 4),
        )
        .child(
            El::new("path")
                .a("id", "o5e6f7g8h")
                .a("fub:shape", "arrow")
                .a("fub:geom", "420 200 700 420")
                .a(
                    "d",
                    "M420 200 L700 420 M682.18 417.45 L700 420 L693.3 403.29",
                )
                .a("fill", "none")
                .a("stroke", "#000000")
                .a("stroke-width", 4)
                .a("stroke-linecap", "round")
                .a("stroke-linejoin", "round"),
        )
        .child(text)
        .child(drawn(
            "o7k2m9x4q",
            "pen",
            "2026-10-01T09:20:31.250Z",
            &format!("{BRUSH} sim=0"),
            &pen,
            Scale::S100,
            "#d55e00",
        ))
        .child(drawn(
            "o00000001",
            "highlighter",
            "2026-10-01T09:20:33.000Z",
            &format!("{BRUSH} sim=1"),
            &highlighter,
            Scale::S10,
            "#f0e442",
        ))
        .child(group)
        .child(
            El::new("a")
                .a("id", "o00000020")
                .a("href", "note/acqua.md")
                .child(El::new("title").text("Il ciclo nella nota"))
                .child(
                    El::new("rect")
                        .a("id", "o00000021")
                        .a("x", 1400)
                        .a("y", 800)
                        .a("width", 120)
                        .a("height", 60)
                        .a("fill", "#56b4e9")
                        .child(El::new("title").text("Nuvola")),
                ),
        )
        .child(
            El::new("path")
                .a("id", "o00000022")
                .a("fub:shape", "polygon")
                .a("fub:geom", "1300 560 80 6 0 8")
                .a(
                    "d",
                    "M1264.62 629.28 A8 8 0 0 1 1257.69 625.28 L1222.31 564 A8 8 0 0 1 1222.31 556 \
                     L1257.69 494.72 A8 8 0 0 1 1264.62 490.72 L1335.38 490.72 A8 8 0 0 1 1342.31 494.72 \
                     L1377.69 556 A8 8 0 0 1 1377.69 564 L1342.31 625.28 A8 8 0 0 1 1335.38 629.28 Z",
                )
                .a("fill", "none")
                .a("stroke", "#0072b2")
                .a("stroke-width", 4),
        )
        .child(
            El::new("path")
                .a("id", "o00000023")
                .a("fub:shape", "star")
                .a("fub:geom", "1100 820 70 5 0.382 0 0")
                .a(
                    "d",
                    "M1100 750 L1115.72 798.37 L1166.57 798.37 L1125.43 828.26 L1141.14 876.63 \
                     L1100 846.74 L1058.86 876.63 L1074.57 828.26 L1033.43 798.37 L1084.28 798.37 Z",
                )
                .a("fill", "#009e73"),
        )
        // Un contorno a spessore variabile: il `d` lo calcola la superficie.
        .child(
            El::new("path")
                .a("id", "o00000024")
                .a("fub:shape", "width")
                .a("fub:geom", "round round 0 1 1 0.4 8 6 1 0 0 M1200 960 L1300 960 L1360 1020")
                .a(
                    "d",
                    "M1200 961 A1 1 0 0 1 1199 960 A1 1 0 0 1 1200 959 C1224.65 955.02 1249.29 952 1273.94 952 \
                     C1282.63 952 1291.31 952.09 1300 952.31 A7.69 7.69 0 0 1 1305.44 954.56 \
                     C1324.93 975.07 1343.44 996.56 1360 1020 \
                     C1338.12 1003.06 1317.57 984.79 1297.73 965.8 C1289.8 965.94 1281.87 966 1273.94 966 \
                     C1249.29 966 1224.65 963.87 1200 961 Z",
                )
                .a("fill", "#cc79a7"),
        )
        // Un arancione sulla carta bianca: S009.
        .child(drawn(
            "o00000032",
            "pen",
            "2026-10-01T09:21:02.000Z",
            &format!("{BRUSH} sim=1"),
            &highlighter,
            Scale::S100,
            "#e69f00",
        ));
    let notes = layer("l9z8y7x6w", "Appunti")
        .a("fub:locked", "true")
        .a("display", "none")
        // Un inchiostro rotto: S004, il tratto si sposta ma non si ridisegna.
        .child(stroke(
            "o00000030",
            "pen",
            "2026-10-01T09:21:00.000Z",
            &format!("{BRUSH} sim=1"),
            "1 s100 cxy 0,0 1",
            "M0 0 L1 1 Z",
            "#000000",
        ))
        // Un canale sconosciuto: S010.
        .child(stroke(
            "o00000031",
            "pen",
            "2026-10-01T09:21:01.000Z",
            &format!("{BRUSH} sim=1"),
            "1 s10 cxytq 1000,1000,0,5 10,5,8,-5",
            "M100 100 L101 100.5 Z",
            "#000000",
        ))
        .child(
            El::new("image")
                .a("id", "o00000033")
                .a("x", 10)
                .a("y", 10)
                .a("width", 8)
                .a("height", 8)
                .a("href", "data:image/png;base64,iVBORw0KGgo="),
        )
        .child(El::new("g").a("id", "o00000034"));
    let root = svg(1600, 1000)
        .child(El::new("title").text("Ciclo dell'acqua"))
        .child(El::new("desc").text("Dal mare alle nuvole, e ritorno"))
        .child(paper(1600, 1000))
        .child(first)
        .child(notes);
    document(&root, "\n")
}

/// `foreign`: un SVG d'altri, con un esempio per regola di §4.
pub(super) fn foreign() -> String {
    let root = El::new("svg")
        .a("xmlns", SVG_NS)
        .a("xmlns:xlink", "http://www.w3.org/1999/xlink")
        .a("xmlns:inkscape", "http://www.inkscape.org/namespaces/inkscape")
        .a("xmlns:sodipodi", "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd")
        .a("width", "210mm")
        .a("height", "148mm")
        .a("viewBox", "0 0 210 148")
        .a("onload", "init()")
        .child(El::new("title").text("Mappa del quartiere"))
        .raw(r##"<defs><linearGradient id="cielo"><stop offset="0" stop-color="#56b4e9"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>"##)
        .raw("<style><![CDATA[ .strada { stroke: #999999; } ]]></style>")
        .raw(r#"<sodipodi:namedview id="vista" inkscape:zoom="1"/>"#)
        .child(
            El::new("g")
                .a("id", "strade")
                .a("inkscape:groupmode", "layer")
                .a("inkscape:label", "Strade")
                // Una classe CSS: estraneo.
                .raw(r#"<path class="strada" d="M10 10 H200"/>"#)
                .raw(r##"<path d="M10 20 H200" stroke="#999999" stroke-width="2"/>"##)
                // Un `d` malformato, una percentuale, un `url(` verso una
                // risorsa del tipo sbagliato: la sfumatura nella `defs` è
                // modificabile, ma non è un filtro.
                .raw(r#"<path d="M10 30 L20"/>"#)
                .raw(r#"<rect x="5%" y="0" width="10" height="10"/>"#)
                .raw(r#"<rect x="20" y="40" width="30" height="20" filter="url(#cielo)"/>"#)
                // Un attributo di Inkscape non decide niente.
                .raw(r##"<rect x="60" y="40" width="30" height="20" rx="4" fill="#cc79a7" inkscape:label="Piazza"/>"##)
                // Un gestore di evento e un colore funzionale.
                .raw(r#"<circle cx="100" cy="50" r="5" onclick="apri()"/>"#)
                .raw(r#"<ellipse cx="120" cy="50" rx="6" ry="4" fill="rgb(0,0,0)"/>"#),
        )
        .child(
            El::new("g")
                .a("id", "etichette")
                .a("inkscape:groupmode", "layer")
                .a("inkscape:label", "Etichette")
                // Righe di Inkscape: `y` sui `tspan`, che §4 non ammette.
                .raw(r#"<text x="10" y="80" xml:space="preserve"><tspan sodipodi:role="line" x="10" y="80">Via Roma</tspan><tspan sodipodi:role="line" x="10" y="90">Piazza &amp; mercato</tspan></text>"#)
                // Testo fuori dai `tspan`: estraneo. Poi un `text` con le
                // righe di FubDraw, modificabile.
                .raw(r#"<text x="10" y="100" font-size="4.2333px">Scuola</text>"#)
                .raw(r#"<text x="10" y="110"><tspan x="10" dy="0">Parco</tspan></text>"#)
                .raw(r#"<a href="javascript:alert(1)"><text x="10" y="120">Clicca</text></a>"#)
                .raw(r#"<a xlink:href="quartiere/parco.md"><rect x="150" y="100" width="20" height="10"/></a>"#)
                // Pezzi fuori da §4: un pezzo dentro un pezzo, un pezzo con la
                // sua `x`, una sottolineatura su un gruppo, un corsivo e una
                // spaziatura che §4 non legge.
                .raw(r#"<text x="10" y="114"><tspan x="10" dy="0">a<tspan>b<tspan>c</tspan></tspan></tspan></text>"#)
                .raw(r#"<text x="10" y="116"><tspan x="10" dy="0">a<tspan x="20">b</tspan></tspan></text>"#)
                .raw(r#"<g text-decoration="underline"><rect width="1" height="1"/></g>"#)
                .raw(r#"<text x="10" y="118" font-style="slanted"><tspan x="10" dy="0">c</tspan></text>"#)
                .raw(r#"<text x="10" y="119" letter-spacing="10%"><tspan x="10" dy="0">d</tspan></text>"#),
        )
        .raw(r#"<image x="150" y="10" width="40" height="30" href="https://example.org/foto.jpg"/>"#)
        .raw(r#"<image x="150" y="50" width="10" height="10" href="data:image/svg+xml,%3Csvg%2F%3E"/>"#)
        .raw(r##"<use href="#strade" x="0" y="5"/>"##)
        .raw(r#"<foreignObject x="0" y="130" width="100" height="18"><div xmlns="http://www.w3.org/1999/xhtml">Nota <b>importante</b></div></foreignObject>"#)
        .raw("<script>console.log('mai eseguito')</script>")
        .raw("<?elabora questa istruzione?>")
        .raw(r#"<polygon points="0,0 10,0 5"/>"#)
        .raw(r##"<polyline points="0,140 10,145 20,140" fill="none" stroke="#000000"/>"##);
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n\
         <!-- Creato da un altro programma -->\n\
         {}<!-- fine -->\n",
        document(&root, "\n")
    )
}

/// `crlf-bom`: BOM, CRLF e caratteri che in UTF-16 valgono due unità.
pub(super) fn crlf_bom() -> String {
    let root = svg(800, 600)
        .child(El::new("title").text("Città di 東京 🌧"))
        .child(paper(800, 600))
        .child(
            layer("l00000001", "Livello — uno")
                .raw("<!-- un commento\r\n     su due righe -->")
                .child(
                    El::new("text")
                        .a("id", "o00000001")
                        .a("x", 40)
                        .a("y", 80)
                        .a("font-family", "Literata, serif")
                        .a("font-size", 24)
                        .child(El::new("tspan").a("x", 40).a("dy", 0).text("Perché sì 😀"))
                        .child(El::new("tspan").a("x", 40).a("dy", 30).text("𝄞 e ♪")),
                )
                .child(
                    El::new("rect")
                        .a("id", "o00000002")
                        .a("x", 40)
                        .a("y", 200)
                        .a("width", 100)
                        .a("height", 50)
                        .a("fill", "#0072b2")
                        // Un attributo `fub:*` sconosciuto con un a capo.
                        .a("fub:nota", "prima riga\nseconda"),
                ),
        );
    format!("\u{feff}{}", document(&root, "\r\n"))
}

/// `doctype`: entità interne, nei namespace e nel testo.
pub(super) fn doctype() -> String {
    let root = El::new("svg")
        .a("xmlns", "&ns_svg;")
        .a("xmlns:fub", "&ns_fub;")
        .a("fub:version", 1)
        .a("viewBox", "0 0 100 100")
        .a("width", 100)
        .a("height", 100)
        .raw("<title>&luogo; d'inverno</title>")
        .child(paper(100, 100))
        .child(
            layer("l00000001", "Livello 1")
                .child(
                    El::new("rect")
                        .a("id", "o00000001")
                        .a("x", 10)
                        .a("y", 10)
                        .a("width", 20)
                        .a("height", 20)
                        .a("fill", "#0072b2"),
                )
                .raw(r#"<text x="10" y="60"><tspan x="10" dy="0">&luogo;</tspan></text>"#),
        );
    // Gli escape del writer non toccano le entità: si rimettono a mano.
    let body = document(&root, "\n").replace("&amp;ns_", "&ns_");
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE svg [\n  \
         <!ENTITY ns_svg \"{SVG_NS}\">\n  \
         <!ENTITY ns_fub \"{FUB_NS}\">\n  \
         <!ENTITY luogo \"Giardino\">\n\
         ]>\n{body}"
    )
}
