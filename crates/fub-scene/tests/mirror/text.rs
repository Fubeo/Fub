//! Le fixture committate del testo, delle tavole e della legenda: `text`,
//! `boards` e `legend`.

use super::*;

pub(super) fn text() -> String {
    let defs = El::new("defs")
        .a("id", "fub-defs")
        .child(
            El::new("path")
                .a("id", "r00000001")
                .a("fub:role", "private")
                .a("d", "M40 400 C160 300 280 300 400 400"),
        )
        .child(
            El::new("path")
                .a("id", "r00000002")
                .a("fub:role", "shared")
                .a("d", "M440 400 A120 120 0 0 1 680 400")
                .child(El::new("title").text("Arco")),
        )
        // Un tracciato con una trasformazione: estraneo.
        .raw(r#"<path id="r00000003" d="M40 540 L400 540" transform="rotate(5)"/>"#);
    let area = El::new("text")
        .a("id", "o00000001")
        .a("fub:wrap", 240)
        .a("x", 40)
        .a("y", 60)
        .a("fill", "#000000")
        .a("font-family", "Inter, sans-serif")
        .a("font-size", 20)
        .child(
            El::new("tspan")
                .a("x", 40)
                .a("dy", 0)
                .text("L'acqua del mare sale"),
        )
        .child(
            El::new("tspan")
                .a("fub:join", "space")
                .a("x", 40)
                .a("dy", 24)
                .markup(r#"in cielo e <tspan font-style="italic">torna</tspan> giù:"#),
        )
        .child(
            El::new("tspan")
                .a("fub:join", "space")
                .a("x", 40)
                .a("dy", 24)
                .text("precipitevolissimevol"),
        )
        .child(
            El::new("tspan")
                .a("fub:join", "word")
                .a("x", 40)
                .a("dy", 24)
                .text("mente."),
        )
        .child(El::new("tspan").a("x", 40).a("dy", 24).text("\u{a0}"))
        .child(El::new("tspan").a("x", 40).a("dy", 24).text("Fine."));
    // Una larghezza che non si legge: il testo resta modificabile, ma le sue
    // righe sono righe.
    let unread = El::new("text")
        .a("id", "o00000002")
        .a("fub:wrap", "-5")
        .a("x", 400)
        .a("y", 60)
        .a("font-size", 20)
        .child(El::new("tspan").a("x", 400).a("dy", 0).text("Due"))
        .child(
            El::new("tspan")
                .a("fub:join", "word")
                .a("x", 400)
                .a("dy", 24)
                .text("righe"),
        );
    let root = svg(800, 600)
        .a("xmlns:xlink", "http://www.w3.org/1999/xlink")
        .child(El::new("title").text("Testo"))
        .child(defs)
        .child(paper(800, 600))
        .child(
            layer("l00000001", "Livello 1")
                .child(area)
                .child(unread)
                .child(
                    El::new("text")
                        .a("id", "o00000003")
                        .a("fill", "#0072b2")
                        .a("font-size", 24)
                        .a("text-anchor", "middle")
                        .child(
                            El::new("textPath")
                                .a("startOffset", "50%")
                                .a("href", "#r00000001")
                                .markup(r#"Sopra <tspan font-weight="bold">la</tspan> collina"#),
                        ),
                )
                .child(
                    El::new("text")
                        .a("id", "o00000004")
                        .a("font-size", 18)
                        .child(
                            El::new("textPath")
                                .a("startOffset", 12)
                                .a("xlink:href", "#r00000002")
                                .text("Lungo l'arco"),
                        ),
                )
                // Estranei: un testo su tracciato con `x` e `y`, uno che
                // segue il tracciato con la trasformazione.
                .raw(r##"<text id="o00000005" x="40" y="500"><textPath href="#r00000001">Con x e y</textPath></text>"##)
                .raw(r##"<text id="o00000006"><textPath href="#r00000003">Storto</textPath></text>"##),
        );
    document(&root, "\n")
}

pub(super) fn boards() -> String {
    let sheet = |id: &str, board: &str, rect: [u32; 4]| {
        El::new("rect")
            .a("id", id)
            .a("fub:role", "paper")
            .a("fub:board", board)
            .a("x", rect[0])
            .a("y", rect[1])
            .a("width", rect[2])
            .a("height", rect[3])
            .a("fill", "#ffffff")
    };
    let board = |id: &str, view_box: &str| {
        El::new("view")
            .a("id", id)
            .a("fub:role", "board")
            .a("viewBox", view_box)
    };
    let root = svg(1300, 900)
        .child(El::new("title").text("Storia"))
        .child(sheet("fub-paper", "b00000001", [0, 0, 600, 400]))
        .child(sheet("c00000001", "b00000002", [700, 0, 600, 400]))
        // Le carte che non vanno con la loro tavola (S015): la seconda della
        // stessa tavola, una di una tavola che non c'è, una con un'altra
        // geometria e una senza tavola.
        .child(sheet("c00000002", "b00000002", [700, 0, 600, 400]))
        .child(sheet("c00000003", "b0000000z", [0, 500, 300, 200]))
        .child(sheet("c00000004", "b00000003", [0, 500, 300, 250]))
        .raw(r##"<rect fub:role="paper" x="400" y="750" width="100" height="100" fill="#ffffff"/>"##)
        .child(board("b00000001", "0 0 600 400").child(El::new("title").text("Copertina")))
        .child(
            board("b00000002", "700,0,600,400")
                .child(El::new("title").text("  Due\n  tavole "))
                .child(El::new("desc").text("La seconda")),
        )
        // Senza nome: si chiama col suo id.
        .child(board("b00000003", "0 500 300 200"))
        // Il nome del disegno e quello di una tavola prima (S016); un
        // attributo `fub:*` sconosciuto resta.
        .child(
            board("b00000004", "400 500 300 200")
                .a("fub:note", "sì")
                .child(El::new("title").text("Storia")),
        )
        .child(board("b00000005", "800 500 300 200").child(El::new("title").text("Copertina")))
        // Estranei: senza ruolo, larga zero, con un altro attributo SVG,
        // senza id, con un altro figlio.
        .raw(r#"<view id="v1" viewBox="0 0 10 10"/>"#)
        .raw(r#"<view id="b00000006" fub:role="board" viewBox="0 0 0 10"/>"#)
        .raw(r#"<view id="b00000007" fub:role="board" viewBox="0 0 10 10" preserveAspectRatio="none"/>"#)
        .raw(r#"<view fub:role="board" viewBox="0 0 10 10"/>"#)
        .raw(r#"<view id="b00000008" fub:role="board" viewBox="0 0 10 10"><g/></view>"#)
        .child(
            layer("l00000001", "Livello 1")
                // Una tavola sta solo nella radice.
                .raw(r#"<view id="b00000009" fub:role="board" viewBox="0 0 10 10"/>"#)
                .child(
                    El::new("rect")
                        .a("id", "o00000001")
                        .a("x", 40)
                        .a("y", 40)
                        .a("width", 200)
                        .a("height", 100)
                        .a("fill", "#0072b2"),
                ),
        );
    document(&root, "\n")
}

/// Un riquadro pieno per `legend`.
fn key_tile(id: &str, x: u32, y: u32, height: u32, fill: &str) -> El {
    El::new("rect")
        .a("id", id)
        .a("x", x)
        .a("y", y)
        .a("width", 60)
        .a("height", height)
        .a("fill", fill)
}

/// `legend`: riquadri il cui colore fa da codice.
pub(super) fn legend() -> String {
    let defs = El::new("defs")
        .a("id", "fub-defs")
        .child(swatch("r00000001", "Verde chiaro", "#b2df8a"))
        .child(
            El::new("linearGradient")
                .a("id", "r00000002")
                .a("fub:role", "private")
                .a("x1", 0)
                .a("y1", 0)
                .a("x2", 1)
                .a("y2", 0)
                .child(El::new("stop").a("offset", 0).a("stop-color", "#fb9a99"))
                .child(El::new("stop").a("offset", 1).a("stop-color", "#fdbf6f")),
        )
        .child(
            El::new("clipPath")
                .a("id", "r00000003")
                .a("fub:role", "private")
                .a("clipPathUnits", "objectBoundingBox")
                .child(
                    El::new("circle")
                        .a("cx", "0.5")
                        .a("cy", "0.5")
                        .a("r", "0.5"),
                ),
        );
    // Una carta colorata: il colore di un riquadro non opaco si compone su
    // di lei.
    let colored = El::new("rect")
        .a("id", "fub-paper")
        .a("fub:role", "paper")
        .a("x", 0)
        .a("y", 0)
        .a("width", 800)
        .a("height", 400)
        .a("fill", "#f0f0f0");
    let pen: Vec<Sample> = (0..3)
        .map(|i| Sample {
            x: 400.0 + 20.0 * f64::from(i),
            y: 340.0,
            p: None,
            t: 8.0 * f64::from(i),
            tilt: None,
        })
        .collect();
    let root = svg(800, 400)
        .child(El::new("title").text("Legenda"))
        .child(defs)
        .child(colored)
        .child(
            layer("l00000001", "Livello 1")
                // Il verde chiaro, una volta per campione e una in chiaro, e
                // il blu chiaro due volte: due codici confusi.
                .child(key_tile("o00000001", 40, 40, 40, "url(#r00000001) #000000"))
                .child(key_tile("o00000002", 120, 40, 40, "#a6cee3"))
                .child(key_tile("o00000003", 200, 40, 40, "#b2df8a"))
                .child(key_tile("o00000004", 280, 40, 40, "#a6cee3"))
                // Il blu al 50% sulla carta, in un gruppo: #88b4d2, un terzo
                // codice, confuso con tutti e due.
                .child(
                    El::new("g")
                        .a("id", "o00000005")
                        .a("opacity", "0.5")
                        .child(key_tile("o00000006", 40, 120, 40, "#1f78b4"))
                        .child(key_tile("o00000007", 120, 120, 40, "#1f78b4")),
                )
                // Due riquadri quasi neri: 7:1 col resto, nessuna confusione.
                .child(key_tile("o00000008", 40, 200, 40, "#1f1f1f"))
                .child(key_tile("o00000009", 120, 200, 40, "#1f1f1f"))
                // Ciò che non conta: una sfumatura, un ritaglio, una figura
                // senza altezza e due tratti a penna. Ognuno, se contasse,
                // darebbe un colore di codice in più.
                .child(key_tile(
                    "o0000000a",
                    200,
                    200,
                    40,
                    "url(#r00000002) #fb9a99",
                ))
                .child(key_tile(
                    "o0000000b",
                    280,
                    200,
                    40,
                    "url(#r00000002) #fb9a99",
                ))
                .child(
                    key_tile("o0000000c", 360, 200, 40, "#fdbf6f")
                        .a("clip-path", "url(#r00000003)"),
                )
                .child(
                    key_tile("o0000000d", 440, 200, 40, "#fdbf6f")
                        .a("clip-path", "url(#r00000003)"),
                )
                .child(key_tile("o0000000e", 520, 200, 0, "#cab2d6"))
                .child(key_tile("o0000000f", 600, 200, 0, "#cab2d6"))
                .child(drawn(
                    "o00000010",
                    "pen",
                    "2026-10-01T09:21:00.000Z",
                    BRUSH,
                    &pen,
                    Scale::S10,
                    "#6a3d9a",
                ))
                .child(drawn(
                    "o00000011",
                    "pen",
                    "2026-10-01T09:21:01.000Z",
                    BRUSH,
                    &pen,
                    Scale::S10,
                    "#6a3d9a",
                )),
        );
    document(&root, "\n")
}
