//! Le fixture generate, `dense` e `ink`, da un seme fisso con mulberry32, e
//! i test che le fissano in `generated.json`.

use super::*;

// ---------------------------------------------------------------------------
// Le fixture generate, fissate da `generated.json`.
// ---------------------------------------------------------------------------

/// mulberry32: il passo di `seedRandom` in `graph-fixture.ts`, ripetuto su
/// uno stato che avanza di `0x6d2b79f5` a ogni numero. Il `k`-esimo numero,
/// da zero, è `seedRandom(seed + k · 0x6d2b79f5)` per 2³², in aritmetica a
/// 32 bit.
struct Mulberry32(u32);

impl Mulberry32 {
    fn next(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }

    /// Un intero in `0..n`, col resto: il piccolo sbilanciamento non conta,
    /// conta che TypeScript lo rifaccia uguale.
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }

    /// `below(n)` diviso per `unit`, in doppia precisione.
    fn fraction(&mut self, n: u32, unit: u32) -> f64 {
        f64::from(self.below(n)) / f64::from(unit)
    }
}

/// FNV-1a a 32 bit sui byte, scritto in esadecimale su otto cifre.
fn fnv1a(text: &str) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for &byte in text.as_bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    format!("{hash:08x}")
}

/// La tavolozza Okabe–Ito di FubDraw, nell'ordine: nero, Blu, Vermiglio,
/// Verde, Porpora, Giallo, Arancione, Azzurro.
const PALETTE: [&str; 8] = [
    "#000000", "#0072b2", "#d55e00", "#009e73", "#cc79a7", "#f0e442", "#e69f00", "#56b4e9",
];

const WORDS: [&str; 8] = [
    "mare", "nuvola", "pioggia", "fiume", "vento", "sole", "neve", "lago",
];

/// `count` punti a caso nella pagina, in centesimi, separati da spazi.
fn random_points(rng: &mut Mulberry32, count: u32) -> String {
    (0..count)
        .map(|_| {
            let x = rng.below(160_000);
            let y = rng.below(100_000);
            format!("{} {}", decimal(x.into(), 2), decimal(y.into(), 2))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// `dense`: un disegno FubDraw di esattamente [`MAX_ELEMENTS`] elementi,
/// l'ultimo numero che si modifica ancora.
///
/// Radice, titolo «Denso», carta di 1600 × 1000 e otto livelli `l0000000k`
/// di nome «Livello k». Gli elementi rimasti si dividono in parti uguali fra i
/// livelli, il resto all'ultimo. In ogni livello, finché la sua quota non è
/// finita, si estrae `below(10)` e si scrive, con l'id `o` più il contatore
/// su otto cifre e i numeri in centesimi:
///
/// 0. `rect`: `x below(160000)`, `y below(100000)`, `width` e `height`
///    `1 + below(20000)`, `fill` della tavolozza `below(8)`;
/// 1. `ellipse`: `cx`, `cy`, `rx` e `ry` come sopra, `fill`;
/// 2. `circle`: `cx`, `cy`, `r 1 + below(10000)`, `fill`;
/// 3. `line`: due punti, `stroke` della tavolozza, `stroke-width 2`;
/// 4. `polyline`: `3 + below(4)` punti, `fill none`, `stroke`;
/// 5. `polygon`: `3 + below(4)` punti, `fill`;
/// 6. `path`: `M` più tre segmenti; per ognuno `below(4)` sceglie `L` (un
///    punto), `Q` (due), `C` (tre) o `A`: un arco di cerchio, col raggio
///    `1 + below(20000)` per `rx` e per `ry`, `0`, i due flag `below(2)` e
///    `below(2)` e un punto; poi `fill none`, `stroke`. Archi ellittici a
///    caso, con un raggio molto più piccolo dell'altro, si gonfierebbero di
///    milioni di unità per raggiungere il punto finale;
/// 7. `text`: il numero di righe `1 + below(3)`, estratto subito dopo il
///    tipo; poi `x`, `y`, `fill #000000`, `font-family Inter, sans-serif`,
///    `font-size 16`, e per ogni riga un `tspan` con la `x` del testo, `dy`
///    `0` la prima e `20` le altre, e la parola `below(8)` di [`WORDS`];
/// 8. un gruppo: `g` con `transform translate(dx dy)`, `dx below(1000)` e
///    `dy below(1000)` interi, poi un `rect` e un `circle` come sopra;
/// 9. un `use` con `href` verso l'ultimo oggetto scritto, anche di un
///    livello prima, o verso la carta se non ce n'è: estraneo.
///
/// Un `text` costa uno più le sue righe, un gruppo tre, ogni altro elemento
/// uno; quello che costa più della quota rimasta diventa un `rect`, con le
/// estrazioni del `rect`. Gli id si contano nell'ordine in cui gli elementi
/// si aprono: il gruppo prima del suo `rect` e del suo `circle`.
fn dense(seed: u32) -> String {
    const LAYERS: usize = 8;
    let mut rng = Mulberry32(seed);
    let mut next_id = 0u32;
    let mut id = || {
        next_id += 1;
        format!("o{next_id:08}")
    };
    let budget = MAX_ELEMENTS - 3 - LAYERS;
    let mut root = svg(1600, 1000)
        .child(El::new("title").text("Denso"))
        .child(paper(1600, 1000));
    let mut last = "fub-paper".to_owned();
    for k in 1..=LAYERS {
        let mut quota = budget / LAYERS + if k == LAYERS { budget % LAYERS } else { 0 };
        let mut group = layer(&format!("l{k:08}"), &format!("Livello {k}"));
        while quota > 0 {
            let mut kind = rng.below(10);
            let tspans = if kind == 7 { 1 + rng.below(3) } else { 0 };
            let cost = match kind {
                7 => 1 + tspans as usize,
                8 => 3,
                _ => 1,
            };
            if cost > quota {
                kind = 0;
            }
            let rect = |rng: &mut Mulberry32, id: String| {
                El::new("rect")
                    .a("id", id)
                    .a("x", decimal(rng.below(160_000).into(), 2))
                    .a("y", decimal(rng.below(100_000).into(), 2))
                    .a("width", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("height", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("fill", PALETTE[rng.below(8) as usize])
            };
            let circle = |rng: &mut Mulberry32, id: String| {
                El::new("circle")
                    .a("id", id)
                    .a("cx", decimal(rng.below(160_000).into(), 2))
                    .a("cy", decimal(rng.below(100_000).into(), 2))
                    .a("r", decimal((1 + rng.below(10_000)).into(), 2))
                    .a("fill", PALETTE[rng.below(8) as usize])
            };
            let me = id();
            let element = match kind {
                0 => rect(&mut rng, me.clone()),
                1 => El::new("ellipse")
                    .a("id", &me)
                    .a("cx", decimal(rng.below(160_000).into(), 2))
                    .a("cy", decimal(rng.below(100_000).into(), 2))
                    .a("rx", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("ry", decimal((1 + rng.below(20_000)).into(), 2))
                    .a("fill", PALETTE[rng.below(8) as usize]),
                2 => circle(&mut rng, me.clone()),
                3 => {
                    let points = random_points(&mut rng, 2);
                    let p: Vec<&str> = points.split(' ').collect();
                    El::new("line")
                        .a("id", &me)
                        .a("x1", p[0])
                        .a("y1", p[1])
                        .a("x2", p[2])
                        .a("y2", p[3])
                        .a("stroke", PALETTE[rng.below(8) as usize])
                        .a("stroke-width", 2)
                }
                4 => {
                    let count = 3 + rng.below(4);
                    El::new("polyline")
                        .a("id", &me)
                        .a("points", random_points(&mut rng, count))
                        .a("fill", "none")
                        .a("stroke", PALETTE[rng.below(8) as usize])
                }
                5 => {
                    let count = 3 + rng.below(4);
                    El::new("polygon")
                        .a("id", &me)
                        .a("points", random_points(&mut rng, count))
                        .a("fill", PALETTE[rng.below(8) as usize])
                }
                6 => {
                    let mut d = format!("M{}", random_points(&mut rng, 1));
                    for _ in 0..3 {
                        match rng.below(4) {
                            0 => d.push_str(&format!(" L{}", random_points(&mut rng, 1))),
                            1 => d.push_str(&format!(" Q{}", random_points(&mut rng, 2))),
                            2 => d.push_str(&format!(" C{}", random_points(&mut rng, 3))),
                            _ => {
                                let r = decimal((1 + rng.below(20_000)).into(), 2);
                                let (large, sweep) = (rng.below(2), rng.below(2));
                                let to = random_points(&mut rng, 1);
                                d.push_str(&format!(" A{r} {r} 0 {large} {sweep} {to}"));
                            }
                        }
                    }
                    El::new("path")
                        .a("id", &me)
                        .a("d", d)
                        .a("fill", "none")
                        .a("stroke", PALETTE[rng.below(8) as usize])
                }
                7 => {
                    let x = decimal(rng.below(160_000).into(), 2);
                    let mut text = El::new("text")
                        .a("id", &me)
                        .a("x", &x)
                        .a("y", decimal(rng.below(100_000).into(), 2))
                        .a("fill", "#000000")
                        .a("font-family", "Inter, sans-serif")
                        .a("font-size", 16);
                    for line in 0..tspans {
                        let dy = if line == 0 { 0 } else { 20 };
                        let word = WORDS[rng.below(8) as usize];
                        text = text.child(El::new("tspan").a("x", &x).a("dy", dy).text(word));
                    }
                    text
                }
                8 => {
                    let transform = format!("translate({} {})", rng.below(1000), rng.below(1000));
                    El::new("g")
                        .a("id", &me)
                        .a("transform", transform)
                        .child(rect(&mut rng, id()))
                        .child(circle(&mut rng, id()))
                }
                _ => El::new("use").a("id", &me).a("href", format!("#{last}")),
            };
            last = me;
            quota -= if kind == 0 { 1 } else { cost };
            group = group.child(element);
        }
        root = root.child(group);
    }
    document(&root, "\n")
}

/// `ink`: quaranta tratti generati, campionati e quantizzati da Rust.
///
/// Titolo «Inchiostro», carta di 1600 × 1000, un livello `l00000001`
/// «Livello 1». Per il tratto `i`, nell'ordine:
///
/// 1. i campioni: 1 per `i = 0`, 2 per `i = 1`, [`INK_MAX_SAMPLES`] per
///    `i = 2`, altrimenti `2 + below(1500)`;
/// 2. la pressione se `below(2) = 1`, l'inclinazione se `below(2) = 1`;
/// 3. la scala: `s100` se `below(2) = 1`, altrimenti `s10`. Il tratto
///    `i = 2` ha comunque pressione, inclinazione e `s100`: il più lungo
///    possibile, con tutti i canali;
/// 4. l'evidenziatore se `below(8) = 0`, col Giallo; altrimenti la penna
///    col colore `below(8)` della tavolozza;
/// 5. il pennello `below(3)` di [`BRUSHES`], più `sim=1` senza pressione e
///    `sim=0` con;
/// 6. la pausa prima del tratto, `below(2000)` millisecondi.
///
/// Poi i campioni, ognuno con le estrazioni in quest'ordine: `x` e `y`, per il
/// primo `below(160000) / 100` e `below(100000) / 100`, per gli altri il
/// precedente più `(below(2001) − 1000) / 1000`; con la pressione
/// `p = below(1001) / 1000`; dal secondo campione `t`, il precedente più
/// `below(17001) / 1000`, mentre il primo ha `t = 0` e non estrae niente; con
/// l'inclinazione `a = below(90001) / 1000` e `z = below(360000) / 1000`. I
/// conti sono in doppia precisione, e `Ink::quantize` li arrotonda.
///
/// L'id è `o` più `i + 1` su otto cifre. `fub:at` è le 9:00 UTC del 2 ottobre
/// 2026 più le pause fino a questa compresa e le durate dei tratti precedenti,
/// cioè il loro `t` quantizzato finale. `d` è la spezzata dei campioni
/// quantizzati.
fn ink(seed: u32) -> (String, u64) {
    let mut rng = Mulberry32(seed);
    let mut layer = layer("l00000001", "Livello 1");
    let mut clock: u64 = 0;
    let mut total = 0u64;
    for i in 0..40u32 {
        let count = match i {
            0 => 1,
            1 => 2,
            2 => INK_MAX_SAMPLES as u32,
            _ => 2 + rng.below(1500),
        };
        let pressure = rng.below(2) == 1 || i == 2;
        let tilt = rng.below(2) == 1 || i == 2;
        let scale = if rng.below(2) == 1 || i == 2 {
            Scale::S100
        } else {
            Scale::S10
        };
        let highlighter = rng.below(8) == 0;
        let fill = if highlighter {
            PALETTE[5]
        } else {
            PALETTE[rng.below(8) as usize]
        };
        let brush = format!(
            "{} sim={}",
            BRUSHES[rng.below(3) as usize],
            u8::from(!pressure)
        );
        clock += u64::from(rng.below(2000));
        let mut samples = Vec::with_capacity(count as usize);
        let (mut x, mut y, mut t) = (0.0, 0.0, 0.0);
        for k in 0..count {
            if k == 0 {
                x = rng.fraction(160_000, 100);
                y = rng.fraction(100_000, 100);
            } else {
                x += (f64::from(rng.below(2001)) - 1000.0) / 1000.0;
                y += (f64::from(rng.below(2001)) - 1000.0) / 1000.0;
            }
            let p = pressure.then(|| rng.fraction(1001, 1000));
            if k > 0 {
                t += rng.fraction(17_001, 1000);
            }
            let tilt = tilt.then(|| (rng.fraction(90_001, 1000), rng.fraction(360_000, 1000)));
            samples.push(Sample { x, y, p, t, tilt });
        }
        let quantized = Ink::quantize(&samples, scale).unwrap();
        let (h, m, s, ms) = (
            9 + clock / 3_600_000,
            clock / 60_000 % 60,
            clock / 1000 % 60,
            clock % 1000,
        );
        let at = format!("2026-10-02T{h:02}:{m:02}:{s:02}.{ms:03}Z");
        let tool = if highlighter { "highlighter" } else { "pen" };
        layer = layer.child(drawn(
            &format!("o{:08}", i + 1),
            tool,
            &at,
            &brush,
            &samples,
            scale,
            fill,
        ));
        clock += quantized.duration().unwrap_or(0).max(0) as u64;
        total += quantized.len() as u64;
    }
    let root = svg(1600, 1000)
        .child(El::new("title").text("Inchiostro"))
        .child(paper(1600, 1000))
        .child(layer);
    (document(&root, "\n"), total)
}

const BRUSHES: [&str; 3] = [
    BRUSH,
    "pf1 size=8 thinning=0.6 smoothing=0.5 streamline=0.4 taperStart=12 taperEnd=12 capStart=0 capEnd=0",
    "pf1 size=2.5 thinning=-0.2 smoothing=0.7 streamline=0.6 taperStart=0 taperEnd=0 capStart=1 capEnd=1",
];

const DENSE_SEED: u32 = 0x2026_1002;
const INK_SEED: u32 = 0x2026_1003;

/// Quel che `generated.json` fissa di una fixture generata.
fn facts(seed: u32, source: &str, scene: &Scene) -> serde_json::Value {
    let mut codes: BTreeMap<String, usize> = BTreeMap::new();
    for diagnostic in &scene.diagnostics {
        *codes.entry(format!("{:?}", diagnostic.code)).or_default() += 1;
    }
    json!({
        "seed": seed,
        "bytes": source.len(),
        "fnv1a": fnv1a(source),
        "items": scene.items.len(),
        "diagnostics": codes,
        "summary": scene.summary,
    })
}

#[test]
fn generated_fixtures_are_pinned() {
    let source = dense(DENSE_SEED);
    assert!(source.is_ascii());
    // Senza commenti né istruzioni, ogni `<` che non chiude apre un elemento.
    let elements = source.matches('<').count() - source.matches("</").count();
    assert_eq!(elements, MAX_ELEMENTS);
    let dense_scene = read(&source).unwrap();
    check_lossless(&source, &dense_scene);
    // Esattamente al limite: ancora modificabile.
    assert!(dense_scene.editable(), "{:?}", dense_scene.read_only);
    let roles = |scene: &Scene, wanted: Role| {
        scene
            .items
            .iter()
            .filter(|item| matches!(item, Item::Element(e) if e.role == wanted))
            .count()
    };
    assert!(roles(&dense_scene, Role::Text) > 0 && roles(&dense_scene, Role::Group) > 0);
    let dense_facts = facts(DENSE_SEED, &source, &dense_scene);

    let (source, samples) = ink(INK_SEED);
    assert!(source.is_ascii());
    let ink_scene = read(&source).unwrap();
    check_lossless(&source, &ink_scene);
    assert!(ink_scene.editable());
    assert_eq!(ink_scene.summary.counts.strokes, 40);
    assert_eq!(ink_scene.summary.ink.samples, samples);
    // Ogni tratto si ridisegna: il codec rilegge ciò che ha scritto.
    for item in &ink_scene.items {
        if let Item::Element(element) = item {
            if let Some(stroke) = &element.stroke {
                assert!(stroke.redrawable, "{:?}", element.id);
            }
        }
    }
    let ink_facts = facts(INK_SEED, &source, &ink_scene);

    let pinned = json!({"dense": dense_facts, "ink": ink_facts});
    mirror(
        "generated.json",
        &format!("{}\n", serde_json::to_string_pretty(&pinned).unwrap()),
    );
}

#[test]
fn the_folder_holds_only_what_this_test_writes() {
    if updating() {
        // Gli altri test stanno scrivendo: si guarda al giro dopo.
        return;
    }
    let mut found: Vec<String> = std::fs::read_dir(fixtures())
        .unwrap_or_else(|error| {
            panic!("la cartella delle fixture non si legge ({error}): {REGENERATE}")
        })
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    found.sort();
    let mut expected: Vec<String> = [
        "sparse",
        "foreign",
        "crlf-bom",
        "doctype",
        "resources",
        "swatches",
        "text",
        "boards",
        "legend",
        "connectors",
        "styles",
        "symbols",
        "repeats",
    ]
    .iter()
    .flat_map(|name| [format!("{name}.json"), format!("{name}.svg")])
    .chain(["generated.json".to_owned()])
    .collect();
    expected.sort();
    assert_eq!(found, expected, "file in più o in meno: {REGENERATE}");
}

#[test]
fn the_generator_is_mulberry32() {
    // I primi numeri del seme 0, come li dà `seedRandom` di TypeScript.
    let mut rng = Mulberry32(0);
    let first = [rng.next(), rng.next(), rng.next()];
    assert_eq!(first, [1_144_304_738, 1_416_247, 958_946_056]);
    assert_eq!(fnv1a(""), "811c9dc5");
    assert_eq!(fnv1a("a"), "e40c292c");
    assert_eq!(decimal(12050, 2), "120.5");
    assert_eq!(decimal(-5, 2), "-0.05");
    assert_eq!(decimal(300, 2), "3");
}
