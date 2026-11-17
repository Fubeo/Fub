//! La fixture committata degli stili del documento: `styles`.

use super::*;

/// Uno stile del documento: un prototipo nella `defs` (formato della scena,
/// stili).
fn style(tag: &'static str, id: &str, name: &str) -> El {
    let style = El::new(tag)
        .a("id", id)
        .a("fub:role", "style")
        .a("fub:name", name);
    if tag == "polyline" {
        style.a("points", STYLE_GRAPHIC_POINTS)
    } else {
        style
    }
}

/// Un testo di una riga, con gli attributi di `text`.
pub(super) fn line(text: El, x: u32, words: &str) -> El {
    text.child(El::new("tspan").a("x", x).a("dy", 0).text(words))
}

pub(super) fn styles() -> String {
    let defs = El::new("defs")
        .a("id", "fub-defs")
        .child(swatch("r00000005", "Blu mare", "#0072b2"))
        .child(
            style("text", "r00000001", "Titolo del capitolo")
                .a("font-family", "Inter, sans-serif")
                .a("font-size", 48)
                .a("font-weight", 600)
                .a("fill", "#1a1a1a")
                .a("fub:leading", "1.2"),
        )
        // Uno stile di testo col colore di un campione, un titolo e il
        // sottolineato.
        .child(
            style("text", "r00000002", "Nota")
                .a("font-size", 14)
                .a("font-style", "italic")
                .a("letter-spacing", "0.5")
                .a("text-decoration", "underline")
                .a("fill", "url(#r00000005) #0072b2")
                .child(El::new("title").text("Le note a margine")),
        )
        // La sfumatura privata dello stile grafico, nel suo riquadro 100 × 100.
        .child(
            El::new("linearGradient")
                .a("id", "r00000003")
                .a("fub:role", "private")
                .a("gradientUnits", "userSpaceOnUse")
                .a("x1", 0)
                .a("y1", 0)
                .a("x2", 100)
                .a("y2", 0)
                .child(El::new("stop").a("offset", 0).a("stop-color", "#0072b2"))
                .child(El::new("stop").a("offset", 1).a("stop-color", "#56b4e9")),
        )
        .child(
            El::new("marker")
                .a("id", "r00000006")
                .a("fub:role", "shared")
                .a("refX", 5)
                .a("refY", 5)
                .a("markerWidth", 5)
                .a("markerHeight", 5)
                .a("orient", "auto-start-reverse")
                .a("viewBox", "0 0 10 10")
                .child(
                    El::new("path")
                        .a("d", "M0 0 L10 5 L0 10 Z")
                        .a("fill", "#000000"),
                ),
        )
        .child(
            style("polyline", "r00000004", "Riquadro")
                .a("fill", "url(#r00000003) #0072b2")
                .a("stroke", "#1a1a1a")
                .a("stroke-width", 2)
                .a("stroke-dasharray", "4 2")
                .a("stroke-linecap", "round")
                .a("stroke-linejoin", "round")
                .a("marker-end", "url(#r00000006)")
                .a("opacity", "0.9")
                .a("style", "mix-blend-mode: multiply"),
        )
        // Uno stile che nessuno segue resta.
        .child(
            style("polyline", "r00000007", "Avviso")
                .a("fill", "none")
                .a("stroke", "#d55e00"),
        )
        // Elementi che si dicono stili e non lo sono, estranei: senza nome,
        // con una riga, con una coordinata, con un'interlinea di quattro
        // decimali, con altri punti, girato, con un marcatore per
        // riempimento, e un tag che non fa stili.
        .child(
            El::new("text")
                .a("id", "r00000008")
                .a("fub:role", "style")
                .a("font-size", 12),
        )
        .child(line(style("text", "r00000009", "Righe"), 0, "Ciao"))
        .child(style("text", "r0000000a", "Spostato").a("x", 10))
        .child(style("text", "r0000000b", "Interlinea").a("fub:leading", "1.2345"))
        .child(
            El::new("polyline")
                .a("id", "r0000000c")
                .a("fub:role", "style")
                .a("fub:name", "Diagonale")
                .a("points", "0,0 100,100"),
        )
        .child(style("polyline", "r0000000d", "Girato").a("transform", "rotate(45)"))
        .child(style("polyline", "r0000000e", "Sbagliato").a("fill", "url(#r00000006) #000000"))
        .child(
            El::new("rect")
                .a("id", "r0000000f")
                .a("fub:role", "style")
                .a("fub:name", "Rettangolo")
                .a("width", 100)
                .a("height", 100),
        );
    let follows = |element: El, style: &str| element.a("fub:style", style);
    let text = |id: &str, y: u32, size: u32, fill: &str| {
        El::new("text")
            .a("id", id)
            .a("x", 100)
            .a("y", y)
            .a("font-size", size)
            .a("fill", fill)
    };
    let rect = |id: &str, x: u32, y: u32| {
        El::new("rect")
            .a("id", id)
            .a("x", x)
            .a("y", y)
            .a("width", 200)
            .a("height", 120)
            .a("fill", "#e69f00")
            .a("stroke", "#1a1a1a")
            .a("stroke-width", 2)
    };
    let first = layer("l00000001", "Livello 1")
        .child(line(
            follows(text("o00000001", 120, 48, "#1a1a1a"), "r00000001")
                .a("font-family", "Inter, sans-serif")
                .a("font-weight", 600),
            100,
            "Il ciclo dell'acqua",
        ))
        .child(line(
            follows(
                text("o00000002", 200, 14, "url(#r00000005) #0072b2"),
                "r00000002",
            )
            .a("font-style", "italic")
            .a("letter-spacing", "0.5")
            .a("text-decoration", "underline"),
            100,
            "Una nota",
        ))
        // Una forma che segue lo stile grafico con un riempimento suo: una
        // differenza locale, che il formato non scrive.
        .child(follows(rect("o00000003", 100, 300), "r00000004"))
        // Un gruppo che lo segue, con la sua spezzata.
        .child(
            follows(El::new("g").a("id", "o00000004"), "r00000004").child(
                El::new("polyline")
                    .a("id", "o00000005")
                    .a("points", "100,500 300,500 300,600")
                    .a("fill", "none")
                    .a("stroke", "#1a1a1a")
                    .a("marker-end", "url(#r00000006)"),
            ),
        )
        // S018: uno stile grafico su un testo, uno di testo su una forma, un
        // id che manca, un campione, uno stile estraneo.
        .child(line(
            follows(text("o00000006", 700, 16, "#1a1a1a"), "r00000004"),
            100,
            "Sbagliato",
        ))
        .child(follows(rect("o00000007", 400, 300), "r00000001"))
        .child(
            follows(El::new("ellipse"), "r0000000z")
                .a("id", "o00000008")
                .a("cx", 800)
                .a("cy", 360)
                .a("rx", 80)
                .a("ry", 50)
                .a("fill", "#009e73"),
        )
        .child(
            follows(El::new("circle"), "r00000005")
                .a("id", "o00000009")
                .a("cx", 1000)
                .a("cy", 360)
                .a("r", 50)
                .a("fill", "#56b4e9"),
        )
        .child(follows(rect("o0000000a", 1100, 300), "r00000008"))
        // Un collegamento non segue stili: `fub:style` resta e non dice
        // niente.
        .child(
            follows(
                El::new("a").a("id", "o0000000b").a("href", "note/acqua.md"),
                "r00000004",
            )
            .child(rect("o0000000c", 1300, 300)),
        );
    // Nemmeno un livello.
    let second = follows(layer("l00000002", "Note"), "r00000004");
    let root = svg(1600, 1000)
        .child(El::new("title").text("Gli stili"))
        .child(defs)
        .child(paper(1600, 1000))
        .child(first)
        .child(second);
    document(&root, "\n")
}
