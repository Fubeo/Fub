//! La fixture committata dei connettori: `connectors`.

use super::*;

/// Un rettangolo di `connectors`.
fn box_of(id: &str, x: u32, y: u32, width: u32, height: u32, fill: &str) -> El {
    El::new("rect")
        .a("id", id)
        .a("x", x)
        .a("y", y)
        .a("width", width)
        .a("height", height)
        .a("rx", 8)
        .a("fill", fill)
}

/// Un connettore come lo scrive FubDraw: `fub:shape`, `fub:geom`, `fub:from`
/// e `fub:to` fra gli attributi noti, `d` ricalcolato dalla geometria.
fn connector(id: &str, geom: &str, from: Option<&str>, to: Option<&str>, d: &str) -> El {
    let mut element = El::new("path")
        .a("id", id)
        .a("fub:shape", "connector")
        .a("fub:geom", geom);
    if let Some(from) = from {
        element = element.a("fub:from", from);
    }
    if let Some(to) = to {
        element = element.a("fub:to", to);
    }
    element
        .a("d", d)
        .a("fill", "none")
        .a("stroke", "#000000")
        .a("stroke-width", 2)
        .a("stroke-linecap", "round")
        .a("stroke-linejoin", "round")
}

/// `connectors`: tre rettangoli e le linee che li uniscono.
pub(super) fn connectors() -> String {
    let defs = El::new("defs").a("id", "fub-defs").child(
        El::new("marker")
            .a("id", "r00000001")
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
    );
    // Un gomito dal lato alto del primo rettangolo, sopra e giù fino a metà
    // del lato alto del secondo.
    let elbow = connector(
        "o00000004",
        "elbow 140 60 140 30 440 30 440 300",
        Some("o00000001 top"),
        Some("o00000002 auto"),
        "M140 60 L140 30 L440 30 L440 300",
    )
    .a("marker-end", "url(#r00000001)");
    // Una curva dal lato basso del primo al lato sinistro del secondo.
    let curve = connector(
        "o00000005",
        "curved 140 140 140 240 260 340 360 340",
        Some("o00000001 bottom"),
        Some("o00000002 left"),
        "M140 140 C140 240 260 340 360 340",
    );
    // Una linea dritta dal terzo rettangolo, con il capo finale libero.
    let free = connector(
        "o00000006",
        "straight 670 140 670 250",
        Some("o00000003 bottom"),
        None,
        "M670 140 L670 250",
    )
    .a("marker-end", "url(#r00000001)");
    // Un aggancio fuori grammatica: il connettore resta un connettore, con
    // quel capo libero.
    let loose = connector(
        "o00000007",
        "straight 520 340 600 100",
        Some("o00000002 middle"),
        Some("o00000003 left"),
        "M520 340 L600 100",
    );
    let label = El::new("text")
        .a("id", "o00000008")
        .a("fub:along", "o00000004 0.5 6")
        .a("x", 410)
        .a("y", 24)
        .a("fill", "#000000")
        .a("font-size", 16)
        .a("text-anchor", "middle")
        .child(El::new("tspan").a("x", 410).a("dy", 0).text("Invio"));
    let root = svg(800, 600)
        .child(El::new("title").text("Connettori"))
        .child(defs)
        .child(paper(800, 600))
        .child(
            layer("l00000001", "Livello 1")
                .child(box_of("o00000001", 60, 60, 160, 80, "#e69f00"))
                .child(box_of("o00000002", 360, 300, 160, 80, "#56b4e9"))
                .child(box_of("o00000003", 600, 60, 140, 80, "#cc79a7"))
                .child(elbow)
                .child(curve)
                .child(free)
                .child(loose)
                .child(label)
                // Un `fub:geom` fuori grammatica (un valore dispari) lascia un
                // tracciato che si legge da `d`, e i suoi agganci restano.
                .child(
                    El::new("path")
                        .a("id", "o00000009")
                        .a("fub:shape", "connector")
                        .a("fub:geom", "elbow 520 360 580 360 580")
                        .a("fub:from", "o00000002 right")
                        .a("d", "M520 360 L580 360 L580 480")
                        .a("fill", "none")
                        .a("stroke", "#000000")
                        .a("stroke-width", 2),
                )
                // Un'etichetta fuori grammatica (`t` oltre 1) è un testo e
                // basta.
                .child(
                    El::new("text")
                        .a("id", "o0000000a")
                        .a("fub:along", "o00000004 1.5 6")
                        .a("x", 600)
                        .a("y", 520)
                        .a("fill", "#000000")
                        .a("font-size", 16)
                        .child(El::new("tspan").a("x", 600).a("dy", 0).text("Fuori")),
                )
                // Un'ellisse con la sua etichetta in un gruppo, su due righe;
                // e un secondo testo con un `fub:inside` fuori grammatica.
                .child(
                    El::new("g")
                        .a("id", "o0000000b")
                        .child(
                            El::new("ellipse")
                                .a("id", "o0000000c")
                                .a("cx", 200)
                                .a("cy", 480)
                                .a("rx", 90)
                                .a("ry", 45)
                                .a("fill", "#f0e442"),
                        )
                        .child(
                            El::new("text")
                                .a("id", "o0000000d")
                                .a("fub:inside", "o0000000c")
                                .a("fub:wrap", 115.28)
                                .a("x", 0)
                                .a("y", 0)
                                .a("fill", "#000000")
                                .a("font-size", 16)
                                .a("text-anchor", "middle")
                                .a("transform", "matrix(1 0 0 1 200 474.4)")
                                .child(El::new("tspan").a("x", 0).a("dy", 0).text("Controllo"))
                                .child(
                                    El::new("tspan")
                                        .a("fub:join", "space")
                                        .a("x", 0)
                                        .a("dy", 19.2)
                                        .text("finito"),
                                ),
                        )
                        .child(
                            El::new("text")
                                .a("id", "o0000000e")
                                .a("fub:inside", "o0000000c sopra")
                                .a("x", 200)
                                .a("y", 420)
                                .a("fill", "#000000")
                                .a("font-size", 16)
                                .a("text-anchor", "middle")
                                .child(El::new("tspan").a("x", 200).a("dy", 0).text("Sopra")),
                        ),
                ),
        );
    document(&root, "\n")
}
