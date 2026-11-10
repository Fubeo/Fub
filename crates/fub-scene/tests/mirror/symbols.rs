//! Le fixture committate dei simboli e delle ripetizioni: `symbols` e
//! `repeats`.

use super::*;

pub(super) fn symbols() -> String {
    let symbol = |id: &str| El::new("symbol").a("id", id).a("overflow", "visible");
    let instance =
        |id: &str, symbol: &str| El::new("use").a("id", id).a("href", format!("#{symbol}"));
    let defs = El::new("defs")
        .a("id", "fub-defs")
        // Una lampadina, nelle coordinate del simbolo attorno all'origine:
        // la sfumatura che usa viene dopo, e il testo bianco e minuscolo
        // non si confronta col fondo ma resta troppo piccolo (S013).
        .child(
            symbol("r00000001")
                .child(El::new("title").text("Lampadina"))
                .child(
                    El::new("circle")
                        .a("id", "o00000001")
                        .a("cx", 0)
                        .a("cy", 0)
                        .a("r", 20)
                        .a("fill", "url(#r00000002) #f0e442"),
                )
                .child(
                    El::new("rect")
                        .a("id", "o00000002")
                        .a("x", -8)
                        .a("y", 18)
                        .a("width", 16)
                        .a("height", 12)
                        .a("fill", "#999999"),
                )
                .child(
                    El::new("text")
                        .a("id", "o00000003")
                        .a("x", -6)
                        .a("y", 2)
                        .a("font-size", 6)
                        .a("fill", "#ffffff")
                        .child(El::new("tspan").a("x", -6).a("dy", 0).text("ON")),
                ),
        )
        .child(
            El::new("linearGradient")
                .a("id", "r00000002")
                .a("fub:role", "private")
                .a("x1", 0)
                .a("y1", 0)
                .a("x2", 0)
                .a("y2", 1)
                .child(El::new("stop").a("offset", 0).a("stop-color", "#f0e442"))
                .child(El::new("stop").a("offset", 1).a("stop-color", "#e69f00")),
        )
        // Un quadro copiato da una libreria, con una lampadina più piccola
        // e una parte estranea, che resta com'è.
        .child(
            symbol("r00000003")
                .a(
                    "fub:source",
                    "Simboli/Impianti.svg#r00000004 0123456789abcdef",
                )
                .child(El::new("title").text("Quadro"))
                .child(
                    El::new("rect")
                        .a("id", "o00000004")
                        .a("x", 0)
                        .a("y", 0)
                        .a("width", 80)
                        .a("height", 60)
                        .a("fill", "#0072b2"),
                )
                .child(
                    instance("o00000005", "r00000001")
                        .a("transform", "translate(40 30) scale(0.5)"),
                )
                .child(El::new("switch").child(El::new("rect").a("width", 10).a("height", 10))),
        )
        // Simboli estranei: uno che contiene sé stesso, due che si
        // contengono a vicenda, uno senza `overflow`, uno con un `viewBox`.
        .child(symbol("r00000005").child(instance("o00000006", "r00000005")))
        .child(symbol("r00000006").child(instance("o00000007", "r00000007")))
        .child(symbol("r00000007").child(instance("o00000008", "r00000006")))
        .child(
            El::new("symbol")
                .a("id", "r00000008")
                .child(El::new("rect").a("width", 10).a("height", 10)),
        )
        .child(
            symbol("r00000009")
                .a("viewBox", "0 0 10 10")
                .child(El::new("rect").a("width", 10).a("height", 10)),
        )
        // Un simbolo che usa un simbolo estraneo: il simbolo vale, l'istanza
        // dentro è estranea.
        .child(
            symbol("r0000000a")
                .child(
                    El::new("circle")
                        .a("id", "o00000009")
                        .a("cx", 0)
                        .a("cy", 0)
                        .a("r", 5)
                        .a("fill", "#009e73"),
                )
                .child(instance("o0000000a", "r00000006")),
        );
    let first = layer("l00000001", "Livello 1")
        .child(instance("o00000010", "r00000001").a("transform", "translate(200 150)"))
        // Con `xlink:href`, ruotata e con un titolo.
        .child(
            El::new("use")
                .a("id", "o00000011")
                .a("xlink:href", "#r00000003")
                .a("transform", "translate(400 100) rotate(30)")
                .a("opacity", "0.8")
                .child(El::new("title").text("Quadro principale")),
        )
        // Un testo bianco sopra la lampadina: l'istanza copre il fondo come
        // un'immagine, e il contrasto non si sa.
        .child(line(
            El::new("text")
                .a("id", "o00000012")
                .a("x", 190)
                .a("y", 152)
                .a("font-size", 16)
                .a("fill", "#ffffff"),
            190,
            "Luce",
        ))
        // Un'istanza nascosta non conta nel riquadro del disegno.
        .child(
            El::new("g")
                .a("id", "o00000013")
                .a("display", "none")
                .child(instance("o00000014", "r00000001").a("transform", "translate(5000 5000)")),
        )
        .child(instance("o00000015", "r0000000a").a("transform", "translate(600 400)"))
        // Istanze estranee: con una posizione, con un riempimento che il
        // simbolo erediterebbe, di un simbolo che contiene sé stesso, di una
        // sfumatura, con due riferimenti, con una forma dentro, di un id che
        // manca (S014).
        .child(instance("o00000016", "r00000001").a("x", 10))
        .child(instance("o00000017", "r00000001").a("fill", "#ff0000"))
        .child(instance("o00000018", "r00000005"))
        .child(instance("o00000019", "r00000002"))
        .child(instance("o0000001a", "r00000001").a("xlink:href", "#r00000001"))
        .child(
            instance("o0000001b", "r00000001")
                .child(El::new("rect").a("width", 10).a("height", 10)),
        )
        .child(instance("o0000001c", "r0000000z"))
        // Un simbolo fuori dalle `defs` è estraneo.
        .child(symbol("r0000000b").child(El::new("rect").a("width", 10).a("height", 10)));
    let root = svg(800, 600)
        .a("xmlns:xlink", "http://www.w3.org/1999/xlink")
        .child(El::new("title").text("I simboli"))
        .child(defs)
        .child(paper(800, 600))
        .child(first);
    document(&root, "\n")
}

pub(super) fn repeats() -> String {
    let copy = |id: &str, original: &str, transform: &str| {
        El::new("use")
            .a("id", id)
            .a("transform", transform)
            .a("href", format!("#{original}"))
    };
    let circle = |id: &str, cx: i32, cy: i32, r: i32| {
        El::new("circle")
            .a("id", id)
            .a("cx", cx)
            .a("cy", cy)
            .a("r", r)
            .a("fill", "#000000")
    };
    let square = |id: &str, x: i32, y: i32| {
        El::new("rect")
            .a("id", id)
            .a("x", x)
            .a("y", y)
            .a("width", 20)
            .a("height", 20)
            .a("fill", "#e69f00")
    };
    // Un petalo, nelle coordinate del simbolo, con due punti in fila: una
    // ripetizione dentro un simbolo.
    let defs = El::new("defs").a("id", "fub-defs").child(
        El::new("symbol")
            .a("id", "r00000001")
            .a("overflow", "visible")
            .child(El::new("title").text("Petalo"))
            .child(
                El::new("ellipse")
                    .a("id", "o00000001")
                    .a("cx", 0)
                    .a("cy", -30)
                    .a("rx", 8)
                    .a("ry", 20)
                    .a("fill", "#cc79a7"),
            )
            .child(
                El::new("g")
                    .a("id", "o00000002")
                    .a("fub:repeat", "grid 1 2 0 10")
                    .child(circle("o00000003", 0, -40, 2))
                    .child(copy("o00000004", "o00000003", "translate(0 10)")),
            ),
    );
    let first = layer("l00000001", "Livello 1")
        // Un fiore: l'originale è un'istanza del petalo, e le copie lo
        // ruotano intorno al centro.
        .child(
            El::new("g")
                .a("id", "o00000010")
                .a("fub:repeat", "radial 6 200 200")
                .child(El::new("title").text("Fiore"))
                .child(
                    El::new("use")
                        .a("id", "o00000011")
                        .a("transform", "translate(200 200)")
                        .a("href", "#r00000001"),
                )
                .child(copy(
                    "o00000012",
                    "o00000011",
                    "matrix(0.5 0.866 -0.866 0.5 273.2051 -73.2051)",
                ))
                .child(copy(
                    "o00000013",
                    "o00000011",
                    "matrix(-0.5 0.866 -0.866 -0.5 473.2051 126.7949)",
                ))
                .child(copy("o00000014", "o00000011", "matrix(-1 0 0 -1 400 400)"))
                .child(copy(
                    "o00000015",
                    "o00000011",
                    "matrix(-0.5 -0.866 0.866 -0.5 126.7949 473.2051)",
                ))
                .child(copy(
                    "o00000016",
                    "o00000011",
                    "matrix(0.5 -0.866 0.866 0.5 -73.2051 273.2051)",
                )),
        )
        // Una griglia spostata: le copie stanno nelle coordinate del gruppo,
        // una con `xlink:href` e un titolo.
        .child(
            El::new("g")
                .a("id", "o00000020")
                .a("fub:repeat", "grid 3 2 60 50")
                .a("transform", "translate(450 80)")
                .child(
                    El::new("rect")
                        .a("id", "o00000021")
                        .a("x", 0)
                        .a("y", 0)
                        .a("width", 40)
                        .a("height", 30)
                        .a("fill", "#0072b2"),
                )
                .child(copy("o00000022", "o00000021", "translate(60 0)"))
                .child(
                    El::new("use")
                        .a("id", "o00000023")
                        .a("transform", "translate(120 0)")
                        .a("xlink:href", "#o00000021")
                        .child(El::new("title").text("Terza")),
                )
                .child(copy("o00000024", "o00000021", "translate(0 50)"))
                .child(copy("o00000025", "o00000021", "translate(60 50)"))
                .child(copy("o00000026", "o00000021", "translate(120 50)")),
        )
        // Uno specchio: l'originale è un gruppo con dentro un'altra
        // ripetizione, che le copie di fuori portano con sé.
        .child(
            El::new("g")
                .a("id", "o00000030")
                .a("fub:repeat", "mirror 400 300 400 400")
                .child(
                    El::new("g")
                        .a("id", "o00000031")
                        .child(
                            El::new("path")
                                .a("id", "o00000032")
                                .a("d", "M300 450 L380 420 L380 520 Z")
                                .a("fill", "#009e73"),
                        )
                        .child(
                            El::new("g")
                                .a("id", "o00000033")
                                .a("fub:repeat", "grid 2 1 30 0")
                                .child(circle("o00000034", 320, 470, 6))
                                .child(copy("o00000035", "o00000034", "translate(30 0)")),
                        ),
                )
                .child(copy("o00000036", "o00000031", "matrix(-1 0 0 1 800 0)")),
        )
        // Un testo bianco sopra la copia riflessa: il fondo non si sa.
        .child(line(
            El::new("text")
                .a("id", "o00000040")
                .a("x", 430)
                .a("y", 480)
                .a("font-size", 16)
                .a("fill", "#ffffff"),
            430,
            "Eco",
        ))
        // Non sono ripetizioni, o non sono copie: un `fub:repeat` fuori
        // grammatica, una copia con un'opacità, una verso un cugino.
        .child(
            El::new("g")
                .a("id", "o00000050")
                .a("fub:repeat", "radial 1 0 0")
                .child(square("o00000051", 250, 500))
                .child(copy("o00000052", "o00000051", "translate(30 0)")),
        )
        .child(
            El::new("g")
                .a("id", "o00000053")
                .a("fub:repeat", "grid 2 1 30 0")
                .child(square("o00000054", 250, 540))
                .child(copy("o00000055", "o00000054", "translate(30 0)").a("opacity", "0.5"))
                .child(copy("o00000056", "o00000021", "translate(30 0)")),
        );
    // Un livello non è una ripetizione.
    let second = layer("l00000002", "Sfondo")
        .a("fub:repeat", "grid 2 1 30 0")
        .child(square("o00000060", 300, 560))
        .child(copy("o00000061", "o00000060", "translate(30 0)"));
    let root = svg(800, 600)
        .a("xmlns:xlink", "http://www.w3.org/1999/xlink")
        .child(El::new("title").text("Le ripetizioni"))
        .child(defs)
        .child(paper(800, 600))
        .child(first)
        .child(second);
    document(&root, "\n")
}
