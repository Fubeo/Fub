//! Le fixture committate delle risorse e dei campioni: `resources` e
//! `swatches`.

use super::*;

/// `resources`: la `fub-defs` dopo il titolo e prima della carta, con ogni
/// tipo di risorsa, e un livello con chi le usa.
pub(super) fn resources() -> String {
    let defs = El::new("defs")
        .a("id", "fub-defs")
        .child(
            El::new("linearGradient")
                .a("id", "r00000001")
                .a("fub:role", "private")
                .a("x1", 0)
                .a("y1", 0)
                .a("x2", 1)
                .a("y2", 0)
                .child(El::new("stop").a("offset", 0).a("stop-color", "#0072b2"))
                .child(
                    El::new("stop")
                        .a("offset", 1)
                        .a("stop-color", "#56b4e9")
                        .a("stop-opacity", "0.5"),
                ),
        )
        .child(
            El::new("radialGradient")
                .a("id", "r00000002")
                .a("fub:role", "private")
                .a("cx", "0.5")
                .a("cy", "0.5")
                .a("r", "0.5")
                .a("fx", "0.3")
                .a("fy", "0.3")
                .a("spreadMethod", "reflect")
                .child(El::new("title").text("Sole"))
                .child(El::new("stop").a("offset", 0).a("stop-color", "#e69f00"))
                .child(
                    El::new("stop")
                        .a("offset", "100%")
                        .a("stop-color", "#d55e00"),
                ),
        )
        .child(
            El::new("pattern")
                .a("id", "r00000003")
                .a("fub:role", "shared")
                .a("x", 0)
                .a("y", 0)
                .a("width", 20)
                .a("height", 20)
                .a("patternUnits", "userSpaceOnUse")
                .child(
                    El::new("rect")
                        .a("x", 0)
                        .a("y", 0)
                        .a("width", 10)
                        .a("height", 10)
                        .a("fill", "url(#r00000001) #0072b2"),
                ),
        )
        .child(
            El::new("marker")
                .a("id", "r00000004")
                .a("fub:role", "shared")
                .a("refX", 5)
                .a("refY", 5)
                .a("markerWidth", 10)
                .a("markerHeight", 10)
                .a("orient", "auto-start-reverse")
                .a("viewBox", "0 0 10 10")
                .child(
                    El::new("path")
                        .a("d", "M0 0 L10 5 L0 10 Z")
                        .a("fill", "#000000"),
                ),
        )
        .child(
            El::new("clipPath")
                .a("id", "r00000005")
                .a("fub:role", "private")
                .a("clipPathUnits", "objectBoundingBox")
                .child(
                    El::new("circle")
                        .a("cx", "0.5")
                        .a("cy", "0.5")
                        .a("r", "0.5"),
                ),
        )
        .child(
            El::new("mask")
                .a("id", "r00000006")
                .a("fub:role", "private")
                .a("maskContentUnits", "objectBoundingBox")
                .child(
                    El::new("rect")
                        .a("x", 0)
                        .a("y", 0)
                        .a("width", 1)
                        .a("height", 1)
                        .a("fill", "#ffffff"),
                ),
        )
        .child(
            El::new("filter")
                .a("id", "r00000007")
                .a("fub:role", "shared")
                .a("x", "-0.2")
                .a("y", "-0.2")
                .a("width", "1.4")
                .a("height", "1.4")
                .child(
                    El::new("feGaussianBlur")
                        .a("in", "SourceAlpha")
                        .a("stdDeviation", 4)
                        .a("result", "ombra"),
                )
                .child(
                    El::new("feOffset")
                        .a("in", "ombra")
                        .a("dx", 2)
                        .a("dy", 3)
                        .a("result", "spostata"),
                )
                .child(
                    El::new("feMerge")
                        .child(El::new("feMergeNode").a("in", "spostata"))
                        .child(El::new("feMergeNode").a("in", "SourceGraphic")),
                ),
        )
        .child(
            El::new("filter")
                .a("id", "r00000008")
                .a("fub:role", "shared")
                .child(
                    El::new("feDropShadow")
                        .a("dx", 0)
                        .a("dy", 2)
                        .a("stdDeviation", 2)
                        .a("flood-color", "#000000")
                        .a("flood-opacity", "0.3"),
                ),
        )
        // Una sfumatura che ne eredita un'altra, come le scrive Inkscape:
        // estranea.
        .raw(r##"<linearGradient id="inkscape1" xlink:href="#r00000001"/>"##);
    // Giallo sul verde: sotto 3:1, ma dentro un filtro i colori che si
    // vedono non si sanno.
    let shadowed = El::new("g")
        .a("id", "o00000005")
        .a("filter", "url(#r00000007)")
        .child(
            El::new("rect")
                .a("id", "o00000006")
                .a("x", 40)
                .a("y", 320)
                .a("width", 160)
                .a("height", 80)
                .a("fill", "#009e73"),
        )
        .child(
            El::new("text")
                .a("id", "o00000007")
                .a("x", 60)
                .a("y", 370)
                .a("fill", "#f0e442")
                .a("font-size", 24)
                .child(El::new("tspan").a("x", 60).a("dy", 0).text("Ombra")),
        );
    let root = svg(800, 600)
        .a("xmlns:xlink", "http://www.w3.org/1999/xlink")
        .child(El::new("title").text("Risorse"))
        .child(defs)
        .child(paper(800, 600))
        .child(
            layer("l00000001", "Livello 1")
                .child(
                    El::new("rect")
                        .a("id", "o00000001")
                        .a("x", 40)
                        .a("y", 40)
                        .a("width", 200)
                        .a("height", 120)
                        .a("fill", "url(#r00000001) #4593ce"),
                )
                .child(
                    El::new("circle")
                        .a("id", "o00000002")
                        .a("cx", 400)
                        .a("cy", 100)
                        .a("r", 60)
                        .a("fill", "url(#r00000002) #e69f00")
                        .a("stroke", "url(#r00000003) #000000")
                        .a("stroke-width", 8),
                )
                .child(
                    El::new("path")
                        .a("id", "o00000003")
                        .a("d", "M40 250 L300 250")
                        .a("fill", "none")
                        .a("stroke", "#000000")
                        .a("stroke-width", 2)
                        .a("marker-end", "url(#r00000004)"),
                )
                .child(
                    El::new("image")
                        .a("id", "o00000004")
                        .a("x", 500)
                        .a("y", 40)
                        .a("width", 160)
                        .a("height", 120)
                        .a("clip-path", "url(#r00000005)")
                        .a("href", "foto.png")
                        .child(El::new("title").text("Il porto")),
                )
                .child(shadowed)
                .child(
                    El::new("text")
                        .a("id", "o00000008")
                        .a("x", 300)
                        .a("y", 370)
                        .a("fill", "url(#r00000001) #0072b2")
                        .a("font-size", 32)
                        .child(El::new("tspan").a("x", 300).a("dy", 0).text("Cielo")),
                )
                .child(
                    El::new("rect")
                        .a("id", "o00000009")
                        .a("x", 500)
                        .a("y", 200)
                        .a("width", 100)
                        .a("height", 60)
                        .a("fill", "#cc79a7")
                        .a("mask", "url(#r00000006)")
                        .a("filter", "url(#r00000008)"),
                )
                // Estranei: chi usa la sfumatura estranea, un marcatore del
                // tipo sbagliato, un id che manca (S014).
                .raw(r#"<rect x="500" y="300" width="100" height="60" fill="url(#inkscape1)"/>"#)
                .raw(r##"<path d="M40 450 L300 450" stroke="#000000" marker-start="url(#r00000001)"/>"##)
                .raw(r#"<rect x="620" y="300" width="100" height="60" fill="url(#r0000000z) #cccccc"/>"#),
        );
    document(&root, "\n")
}

/// Un campione del documento come lo scrive FubDraw.
pub(super) fn swatch(id: &str, name: &str, color: &str) -> El {
    El::new("linearGradient")
        .a("id", id)
        .a("fub:role", "swatch")
        .a("fub:name", name)
        .a("gradientUnits", "userSpaceOnUse")
        .child(El::new("stop").a("stop-color", color))
}

pub(super) fn swatches() -> String {
    let defs = El::new("defs")
        .a("id", "fub-defs")
        .child(swatch("r00000001", "Blu mare", "#0072b2"))
        // Un campione che nessuno usa resta.
        .child(swatch("r00000002", "Vermiglio", "#d55e00"))
        // Come lo scrive Inkscape: l'`offset`, l'opacità piena, un titolo,
        // un attributo suo e un colore col nome.
        .child(
            El::new("linearGradient")
                .a("id", "r00000003")
                .a("fub:role", "swatch")
                .a("fub:name", "Verde & bosco")
                .a("inkscape:swatch", "solid")
                .child(El::new("title").text("Il verde del bosco"))
                .child(
                    El::new("stop")
                        .a("offset", 0)
                        .a("stop-color", "green")
                        .a("stop-opacity", 1),
                ),
        )
        // Sfumature che si dicono campioni e non lo sono: risorse senza
        // ciclo di vita. Due `stop`, le coordinate, la trasparenza, un nome
        // vuoto, nessun nome, una sfumatura radiale, un `stop` senza colore.
        .child(
            El::new("linearGradient")
                .a("id", "r00000004")
                .a("fub:role", "swatch")
                .a("fub:name", "Due")
                .child(El::new("stop").a("offset", 0).a("stop-color", "#000000"))
                .child(El::new("stop").a("offset", 1).a("stop-color", "#ffffff")),
        )
        .child(
            El::new("linearGradient")
                .a("id", "r00000005")
                .a("fub:role", "swatch")
                .a("fub:name", "Coordinate")
                .a("x2", 1)
                .child(El::new("stop").a("stop-color", "#009e73")),
        )
        .child(
            El::new("linearGradient")
                .a("id", "r00000006")
                .a("fub:role", "swatch")
                .a("fub:name", "Velo")
                .child(
                    El::new("stop")
                        .a("stop-color", "#56b4e9")
                        .a("stop-opacity", "0.5"),
                ),
        )
        .child(
            El::new("linearGradient")
                .a("id", "r00000007")
                .a("fub:role", "swatch")
                .a("fub:name", " ")
                .child(El::new("stop").a("stop-color", "#e69f00")),
        )
        .child(
            El::new("linearGradient")
                .a("id", "r00000008")
                .a("fub:role", "swatch")
                .child(El::new("stop").a("stop-color", "#f0e442")),
        )
        .child(
            El::new("radialGradient")
                .a("id", "r00000009")
                .a("fub:role", "swatch")
                .a("fub:name", "Tondo")
                .child(El::new("stop").a("stop-color", "#cc79a7")),
        )
        .child(
            El::new("linearGradient")
                .a("id", "r0000000a")
                .a("fub:role", "swatch")
                .a("fub:name", "Senza colore")
                .child(El::new("stop").a("offset", 0)),
        )
        // Un motivo che usa un campione nel suo contenuto.
        .child(
            El::new("pattern")
                .a("id", "r0000000b")
                .a("fub:role", "shared")
                .a("x", 0)
                .a("y", 0)
                .a("width", 20)
                .a("height", 20)
                .a("patternUnits", "userSpaceOnUse")
                .child(
                    El::new("rect")
                        .a("x", 0)
                        .a("y", 0)
                        .a("width", 10)
                        .a("height", 10)
                        .a("fill", "url(#r00000001) #0072b2"),
                ),
        )
        // Un campione chiaro, per il contrasto (S009).
        .child(swatch("r0000000c", "Giallo", "#f0e442"))
        // Un motivo del documento, un `pattern` col suo nome: un campione
        // anche lui.
        .child(
            El::new("pattern")
                .a("id", "r0000000d")
                .a("fub:role", "swatch")
                .a("fub:name", "Pois")
                .a("patternUnits", "userSpaceOnUse")
                .a("x", 0)
                .a("y", 0)
                .a("width", 12)
                .a("height", 12)
                .child(
                    El::new("circle")
                        .a("cx", 6)
                        .a("cy", 6)
                        .a("r", 3)
                        .a("fill", "#cc79a7"),
                ),
        )
        // Motivi che si dicono campioni senza un nome: risorse senza ciclo
        // di vita.
        .child(
            El::new("pattern")
                .a("id", "r0000000e")
                .a("fub:role", "swatch")
                .a("fub:name", " ")
                .a("width", 10)
                .a("height", 10),
        )
        .child(
            El::new("pattern")
                .a("id", "r0000000f")
                .a("fub:role", "swatch")
                .a("width", 10)
                .a("height", 10),
        );
    let root = svg(800, 600)
        .a(
            "xmlns:inkscape",
            "http://www.inkscape.org/namespaces/inkscape",
        )
        .child(El::new("title").text("Campioni"))
        .child(defs)
        .child(paper(800, 600))
        .child(
            layer("l00000001", "Livello 1")
                .child(
                    El::new("rect")
                        .a("id", "o00000001")
                        .a("x", 40)
                        .a("y", 40)
                        .a("width", 200)
                        .a("height", 120)
                        .a("fill", "url(#r00000001) #0072b2")
                        .a("stroke", "url(#r00000003) #008000")
                        .a("stroke-width", 4),
                )
                // Una linea orizzontale: il suo riquadro non ha altezza, e il
                // campione si vede lo stesso.
                .child(
                    El::new("line")
                        .a("id", "o00000002")
                        .a("x1", 40)
                        .a("y1", 220)
                        .a("x2", 400)
                        .a("y2", 220)
                        .a("stroke", "url(#r00000001) #0072b2")
                        .a("stroke-width", 6),
                )
                .child(
                    El::new("text")
                        .a("id", "o00000003")
                        .a("x", 40)
                        .a("y", 320)
                        .a("fill", "url(#r00000003) #008000")
                        .a("font-size", 32)
                        .child(
                            El::new("tspan")
                                .a("x", 40)
                                .a("dy", 0)
                                .markup(r##"Bosco <tspan fill="#d55e00">rosso</tspan>"##),
                        ),
                )
                .child(
                    El::new("rect")
                        .a("id", "o00000004")
                        .a("x", 440)
                        .a("y", 40)
                        .a("width", 200)
                        .a("height", 120)
                        .a("fill", "url(#r0000000b) #0072b2"),
                )
                .child(
                    El::new("rect")
                        .a("id", "o00000005")
                        .a("x", 440)
                        .a("y", 200)
                        .a("width", 200)
                        .a("height", 120)
                        .a("fill", "url(#r00000004) #808080"),
                )
                // Il nero sul blu del campione, che S009 legge come fondo.
                .child(
                    El::new("text")
                        .a("id", "o00000006")
                        .a("x", 60)
                        .a("y", 120)
                        .a("fill", "#000000")
                        .a("font-size", 16)
                        .child(El::new("tspan").a("x", 60).a("dy", 0).text("Sul blu")),
                )
                // Un ripiego rimasto indietro: si vede il giallo del campione,
                // e S009 misura quello.
                .child(
                    El::new("text")
                        .a("id", "o00000007")
                        .a("x", 440)
                        .a("y", 400)
                        .a("fill", "url(#r0000000c) #000000")
                        .a("font-size", 16)
                        .child(El::new("tspan").a("x", 440).a("dy", 0).text("Giallo")),
                )
                // Chi usa il motivo, col suo colore di ripiego.
                .child(
                    El::new("rect")
                        .a("id", "o00000008")
                        .a("x", 600)
                        .a("y", 440)
                        .a("width", 120)
                        .a("height", 80)
                        .a("fill", "url(#r0000000d) #e3b4cf"),
                ),
        );
    document(&root, "\n")
}
