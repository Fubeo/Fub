//! Lo specchio a caso del nucleo della lavagna, Rust ↔ TypeScript, legato da
//! una fixture generata.
//!
//! La lavagna è scritta due volte: qui, il nucleo che fa fede, e in
//! TypeScript (`apps/client/src/editors/canvas/{model,operation,source-edit}.ts`),
//! la copia che la tela usa finché non carica il nucleo. I vettori scritti a
//! mano (`apps/client/src/__fixtures__/canvas-patches/`) coprono i casi
//! pensati; questo specchio, come quello dell'inchiostro
//! (`crates/fub-ink/tests/ts_mirror.rs`), cerca quelli che nessuno ha
//! pensato. Un generatore congruenziale con un seme fisso fa sorgenti (rientri,
//! CRLF, BOM, campi sconosciuti annidati, numeri ai bordi, Unicode a 4 byte,
//! chiavi che sembrano indici, `null`, chiavi doppie) e toppe sul loro
//! modello; il nucleo dà l'esito. La fixture
//! `apps/client/src/__fixtures__/canvas-mirror.json` porta caso per caso la
//! risposta **di Rust**, e il gemello Vitest
//! (`apps/client/src/editors/canvas/mirror.test.ts`) pretende la stessa da
//! `parseCanvas`, `canvasCommitOutcome` e `commitCanvasPatches`, byte per
//! byte.
//!
//! Cambiare una regola da un lato solo è rosso: se cambia Rust la fixture è
//! vecchia (questo test), e rigenerandola (`UPDATE_MIRROR=1 cargo test -p
//! fub-canvas-core --test ts_mirror`) il rosso si sposta di là.
//!
//! Una riga della fixture è un sorgente:
//!
//! - `{"source", "open": false}`: il sorgente non si apre;
//! - `{"source", "runs"}`: si apre, e `runs` sono le prove indipendenti fatte
//!   su di lui (anche nessuna, quando il sorgente serve solo a leggere).
//!
//! Una prova è
//!
//! - `{"patches", "outcome": "applied", "text", "undo"}`: le toppe si
//!   applicano; `text` è il testo di dopo e `undo` quello dopo le toppe
//!   inverse applicate al testo di dopo, o la ragione per cui l'annulla è
//!   rifiutato;
//! - `{"patches", "outcome": "rejected", "reason"}`: le toppe sono rifiutate
//!   con `CommitError::reason`.
//!
//! I casi sono i sorgenti (si apre o no) più le prove.
//!
//! Per stare sotto i 512 KB un testo si scrive come differenza da quello di
//! prima: `[p, "mezzo", s]` vuol dire i primi `p` e gli ultimi `s` caratteri
//! del testo di prima, contati in unità UTF-16 come `String.length`, con
//! `mezzo` in mezzo. Il confronto resta byte per byte.

use fub_canvas_core::commit::Core;
use fub_canvas_core::patch::{draft, CanvasPatch};
use fub_canvas_core::source::{edge_value, node_value};
use fub_canvas_core::Canvas;
use serde_json::{json, Map, Value};

/// Il seme: cambiarlo cambia tutti i casi.
const SEED: u64 = 0x5e_edca_57a5_2026;
/// Quanti casi: il piano ne vuole almeno 2000.
const CASES: usize = 2050;
const MIN_CASES: usize = 2000;
/// Il tetto della fixture.
const MAX_BYTES: usize = 512 * 1024;

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../apps/client/src/__fixtures__/canvas-mirror.json"
    ))
}

// ---------------------------------------------------------------------------
// Il generatore

/// Un generatore congruenziale lineare (le costanti di Knuth per MMIX): niente
/// `rand`, e lo stesso seme dà gli stessi casi su ogni macchina.
struct Lcg(u64);

impl Lcg {
    /// 31 bit: quelli alti, i bassi di un congruenziale sono poco casuali.
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn bits64(&mut self) -> u64 {
        (self.next() << 42) ^ (self.next() << 21) ^ self.next()
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }

    fn pick<T: Copy>(&mut self, items: &[T]) -> T {
        items[self.below(items.len())]
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            items.swap(i, self.below(i + 1));
        }
    }
}

/// Un albero JSON come si scrive nel sorgente: le foglie e le chiavi sono già
/// testo (con il loro escape e la loro forma dei numeri), e un oggetto può
/// avere chiavi doppie.
#[derive(Clone)]
enum J {
    Tok(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

/// Come si stende il sorgente.
struct Style {
    indent: &'static str,
    /// Fin dove gli oggetti e gli array vanno a capo: 0 tutto su una riga, 2
    /// come Obsidian (una scheda per riga).
    pretty_depth: usize,
    newline: &'static str,
    colon: &'static str,
}

fn write_j(j: &J, depth: usize, style: &Style, out: &mut String) {
    let pretty = depth < style.pretty_depth;
    let open_line = |out: &mut String, level: usize| {
        out.push_str(style.newline);
        for _ in 0..level {
            out.push_str(style.indent);
        }
    };
    match j {
        J::Tok(token) => out.push_str(token),
        J::Arr(items) if items.is_empty() => out.push_str("[]"),
        J::Obj(fields) if fields.is_empty() => out.push_str("{}"),
        J::Arr(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                if pretty {
                    open_line(out, depth + 1);
                }
                write_j(item, depth + 1, style, out);
            }
            if pretty {
                open_line(out, depth);
            }
            out.push(']');
        }
        J::Obj(fields) => {
            out.push('{');
            for (index, (key, value)) in fields.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                if pretty {
                    open_line(out, depth + 1);
                }
                out.push_str(key);
                out.push_str(if pretty { style.colon } else { ":" });
                write_j(value, depth + 1, style, out);
            }
            if pretty {
                open_line(out, depth);
            }
            out.push('}');
        }
    }
}

/// Una stringa JSON di `text`, con un escape scelto a caso dove JSON ne
/// permette più d'uno.
fn str_tok(rng: &mut Lcg, text: &str) -> String {
    let mut out = String::from('"');
    for c in text.chars() {
        let escape = rng.chance(2);
        match c {
            '"' if escape => out.push_str("\\u0022"),
            '"' => out.push_str("\\\""),
            '\\' if escape => out.push_str("\\u005C"),
            '\\' => out.push_str("\\\\"),
            '/' if rng.chance(30) => out.push_str("\\/"),
            '\n' if !escape => out.push_str("\\n"),
            '\t' if !escape => out.push_str("\\t"),
            '\r' if !escape => out.push_str("\\r"),
            c if u32::from(c) < 0x20 => out.push_str(&format!("\\u{:04x}", u32::from(c))),
            c if escape => {
                let mut units = [0_u16; 2];
                for unit in c.encode_utf16(&mut units) {
                    if rng.chance(50) {
                        out.push_str(&format!("\\u{unit:04X}"));
                    } else {
                        out.push_str(&format!("\\u{unit:04x}"));
                    }
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Un intero di un campo noto scritto in una delle forme che R2 accetta.
fn int_tok(rng: &mut Lcg, value: i64) -> String {
    if value == 0 && rng.chance(30) {
        return rng.pick(&["-0", "0.0", "-0.0", "0e0", "0E+3"]).to_string();
    }
    match rng.below(10) {
        0 => format!("{value}.0"),
        1 => format!("{value}e0"),
        2 => format!("{value}E+0"),
        3 if value != 0 && value % 100 == 0 => format!("{}e2", value / 100),
        4 if value.unsigned_abs() >= 10 => {
            // La forma scientifica: 1234 → 1.234e3.
            let digits = value.unsigned_abs().to_string();
            let sign = if value < 0 { "-" } else { "" };
            let rest = digits[1..].trim_end_matches('0');
            let rest = if rest.is_empty() {
                String::new()
            } else {
                format!(".{rest}")
            };
            format!("{sign}{}{rest}e{}", &digits[..1], digits.len() - 1)
        }
        _ => value.to_string(),
    }
}

/// Le coordinate: piccole, negative, grandi, ai bordi di R2.
fn coordinate(rng: &mut Lcg) -> i64 {
    const MAX: i64 = (1 << 53) - 1;
    match rng.below(12) {
        0 => 0,
        1 => MAX,
        2 => -MAX,
        3 => 1_000_000_000_000_000,
        4 => -(rng.below(5000) as i64),
        _ => rng.below(300) as i64 * 10,
    }
}

fn size(rng: &mut Lcg) -> i64 {
    match rng.below(8) {
        0 => 1,
        1 => (1 << 53) - 1,
        _ => (rng.below(40) as i64 + 1) * 10,
    }
}

/// I numeri dei campi sconosciuti scritti come in un file: ai bordi di un
/// `f64`, interi oltre 2^53, i pareggi della prova 4, forme strane.
const NUMBERS: &[&str] = &[
    "0",
    "-0",
    "1",
    "-1",
    "0.1",
    "0.30000000000000004",
    "1e21",
    "1e+21",
    "1E-7",
    "1e-7",
    "5e-324",
    "2.2250738585072014e-308",
    "1.7976931348623157e308",
    "9007199254740991",
    "9007199254740992",
    "9007199254740993",
    "-9007199254740993",
    "18446744073709551616",
    "123456789012345678901234567890",
    "1.5",
    "2.5",
    "0.5",
    "100",
    "1.0",
    "1e2",
    "-0.0",
    "12.569839477539062",
    "0.7534866333007812",
    "196181128186770.12",
    "17.767898559570312",
    "4.35",
    "0.000001",
    "1e-6",
    "1.23e-20",
    "4294967295",
    "1e300",
    "123e-2",
    "0.1e1",
];

/// Un numero a caso come lo scriverebbe un altro programma: un pareggio (k +
/// ½)·2^e o dei bit qualunque, in forma esponenziale.
fn random_number(rng: &mut Lcg) -> f64 {
    if rng.chance(50) {
        let k = rng.below(1 << 20) as f64 + 0.5;
        let e = rng.below(140) as i32 - 70;
        k * 2_f64.powi(e)
    } else {
        loop {
            let x = f64::from_bits(rng.bits64());
            if x.is_finite() {
                return x;
            }
        }
    }
}

fn number_tok(rng: &mut Lcg) -> String {
    if rng.chance(25) {
        let x = random_number(rng);
        if rng.chance(50) {
            format!("{x:e}")
        } else {
            format!("{x:E}")
        }
    } else {
        rng.pick(NUMBERS).to_string()
    }
}

/// I testi delle schede: escape, a capo, Unicode a 4 byte, separatori.
const TEXTS: &[&str] = &[
    "",
    "uno",
    "a \"b\" c",
    "back\\slash",
    "riga\nnuova",
    "tab\tqui",
    "😀",
    "é è",
    "ß𝄞z",
    "/path/x",
    "a\u{2028}b",
    "\u{7f}",
    "c\u{1}d",
    "日本",
    "[[Nota]] #tag",
    "\u{feff}bom",
    "\r\n",
];

/// Le chiavi sconosciute: chiavi che sembrano indici (e no), `__proto__`,
/// Unicode, il campo dell'inchiostro.
const KEYS: &[&str] = &[
    "fub:ink",
    "z",
    "10",
    "2",
    "0",
    "01",
    "-1",
    "4294967294",
    "4294967295",
    "__proto__",
    "é",
    "😀",
    "a b",
    "styleAttributes",
    "toString",
];

const IDS: &[&str] = &["a", "b", "c", "d", "e", "n1", "é", "😀", "0", "x y"];

fn key_tok(rng: &mut Lcg, key: &str) -> String {
    str_tok(rng, key)
}

/// Un valore sconosciuto, annidato fino a `depth`.
fn unknown_value(rng: &mut Lcg, depth: usize) -> J {
    let choice = if depth == 0 {
        rng.below(5)
    } else {
        rng.below(7)
    };
    match choice {
        0 | 1 => J::Tok(number_tok(rng)),
        2 => {
            let text = rng.pick(TEXTS);
            J::Tok(str_tok(rng, text))
        }
        3 => J::Tok(rng.pick(&["true", "false", "null"]).to_string()),
        4 => J::Tok(number_tok(rng)),
        5 => J::Arr(
            (0..rng.below(3))
                .map(|_| unknown_value(rng, depth - 1))
                .collect(),
        ),
        _ => J::Obj(unknown_fields(rng, depth - 1, 3)),
    }
}

/// Fino a `max` campi sconosciuti, senza chiavi doppie.
fn unknown_fields(rng: &mut Lcg, depth: usize, max: usize) -> Vec<(String, J)> {
    let mut keys: Vec<&str> = Vec::new();
    for _ in 0..rng.below(max + 1) {
        let key = rng.pick(KEYS);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys.into_iter()
        .map(|key| (key_tok(rng, key), unknown_value(rng, depth)))
        .collect()
}

fn field(rng: &mut Lcg, key: &str, value: J) -> (String, J) {
    (key_tok(rng, key), value)
}

fn string_field(rng: &mut Lcg, key: &str, text: &str) -> (String, J) {
    let value = J::Tok(str_tok(rng, text));
    field(rng, key, value)
}

fn color(rng: &mut Lcg) -> &'static str {
    rng.pick(&[
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "#abc",
        "#A1B2C3",
        "#a1b2c3d4",
        "#0f0f",
    ])
}

/// Una scheda valida, con i campi in un ordine plausibile o mescolati.
fn node(rng: &mut Lcg, id: &str) -> J {
    let kind = rng.pick(&["text", "text", "file", "link", "group"]);
    let mut fields = vec![string_field(rng, "id", id), string_field(rng, "type", kind)];
    match kind {
        "text" => {
            let text = rng.pick(TEXTS);
            fields.push(string_field(rng, "text", text));
        }
        "file" => {
            let file = rng.pick(&["nota.md", "cartella/é.md", "foto.png", "😀.md"]);
            fields.push(string_field(rng, "file", file));
            if rng.chance(30) {
                let subpath = rng.pick(&["#Titolo", "#^blocco", "#"]);
                fields.push(string_field(rng, "subpath", subpath));
            }
        }
        "link" => {
            let url = rng.pick(&["https://example.org/ä?q=1", "https://x.y/", "http://a/b/c"]);
            fields.push(string_field(rng, "url", url));
        }
        _ => {
            if rng.chance(60) {
                let label = rng.pick(TEXTS);
                fields.push(string_field(rng, "label", label));
            }
            if rng.chance(30) {
                fields.push(string_field(rng, "background", "sfondo.png"));
            }
            if rng.chance(30) {
                let style = rng.pick(&["cover", "ratio", "repeat", "tiled"]);
                fields.push(string_field(rng, "backgroundStyle", style));
            }
        }
    }
    for key in ["x", "y"] {
        let value = coordinate(rng);
        let token = J::Tok(int_tok(rng, value));
        fields.push(field(rng, key, token));
    }
    for key in ["width", "height"] {
        let value = size(rng);
        let token = J::Tok(int_tok(rng, value));
        fields.push(field(rng, key, token));
    }
    if rng.chance(30) {
        let color = color(rng);
        fields.push(string_field(rng, "color", color));
    }
    // R7: un campo noto facoltativo a `null` vale come assente.
    if rng.chance(10) {
        let key = rng.pick(&["color", "label", "background", "backgroundStyle"]);
        if !fields.iter().any(|(k, _)| k == &format!("\"{key}\"")) {
            fields.push(field(rng, key, J::Tok("null".into())));
        }
    }
    if rng.chance(15) {
        fields.extend(unknown_fields(rng, 1, 2));
    }
    if rng.chance(20) {
        rng.shuffle(&mut fields);
    }
    J::Obj(fields)
}

fn edge(rng: &mut Lcg, id: &str, from: &str, to: &str) -> J {
    let mut fields = vec![
        string_field(rng, "id", id),
        string_field(rng, "fromNode", from),
    ];
    if rng.chance(50) {
        let side = rng.pick(&["top", "right", "bottom", "left"]);
        fields.push(string_field(rng, "fromSide", side));
    }
    fields.push(string_field(rng, "toNode", to));
    if rng.chance(50) {
        let side = rng.pick(&["top", "right", "bottom", "left"]);
        fields.push(string_field(rng, "toSide", side));
    }
    if rng.chance(30) {
        let end = rng.pick(&["none", "arrow"]);
        fields.push(string_field(rng, "toEnd", end));
    }
    if rng.chance(20) {
        let label = rng.pick(TEXTS);
        fields.push(string_field(rng, "label", label));
    }
    if rng.chance(15) {
        let color = color(rng);
        fields.push(string_field(rng, "color", color));
    }
    if rng.chance(15) {
        fields.extend(unknown_fields(rng, 0, 1));
    }
    if rng.chance(20) {
        rng.shuffle(&mut fields);
    }
    J::Obj(fields)
}

/// Una lavagna valida: le schede, gli archi fra loro e i campi sconosciuti
/// della radice, fino a `most` schede. `nodes` ed `edges` possono mancare o
/// essere `null` (R7).
fn canvas(rng: &mut Lcg, most: usize) -> J {
    let mut ids: Vec<&str> = Vec::new();
    for _ in 0..rng.below(most + 1) {
        let id = rng.pick(IDS);
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let nodes: Vec<J> = ids.iter().map(|id| node(rng, id)).collect();
    let mut edges = Vec::new();
    if !ids.is_empty() {
        for index in 0..rng.below(2) {
            let from = rng.pick(&ids);
            let to = rng.pick(&ids);
            let id = format!("e{index}");
            edges.push(edge(rng, &id, from, to));
        }
    }
    let mut root = Vec::new();
    if !nodes.is_empty() || rng.chance(70) {
        root.push(field(rng, "nodes", J::Arr(nodes)));
    } else if rng.chance(50) {
        root.push(field(rng, "nodes", J::Tok("null".into())));
    }
    if !edges.is_empty() || rng.chance(70) {
        root.push(field(rng, "edges", J::Arr(edges)));
    } else if rng.chance(50) {
        root.push(field(rng, "edges", J::Tok("null".into())));
    }
    if rng.chance(20) {
        root.extend(unknown_fields(rng, 2, 2));
    }
    if rng.chance(15) {
        rng.shuffle(&mut root);
    }
    J::Obj(root)
}

/// Gli oggetti di `j` in cui si può mettere una chiave: (profondità, percorso
/// di indici fino all'oggetto).
fn objects(j: &J, path: &mut Vec<usize>, found: &mut Vec<Vec<usize>>) {
    match j {
        J::Tok(_) => {}
        J::Arr(items) => {
            for (index, item) in items.iter().enumerate() {
                path.push(index);
                objects(item, path, found);
                path.pop();
            }
        }
        J::Obj(fields) => {
            found.push(path.clone());
            for (index, (_, value)) in fields.iter().enumerate() {
                path.push(index);
                objects(value, path, found);
                path.pop();
            }
        }
    }
}

fn at_path<'a>(j: &'a mut J, path: &[usize]) -> &'a mut J {
    let mut current = j;
    for &index in path {
        current = match current {
            J::Arr(items) => &mut items[index],
            J::Obj(fields) => &mut fields[index].1,
            J::Tok(_) => unreachable!("il percorso porta a un oggetto"),
        };
    }
    current
}

/// Le schede di una radice generata, se ci sono.
fn nodes_of(root: &mut J) -> Option<&mut Vec<J>> {
    let J::Obj(fields) = root else { return None };
    fields.iter_mut().find_map(|(key, value)| match value {
        J::Arr(items) if key == "\"nodes\"" => Some(items),
        _ => None,
    })
}

fn push_field(j: &mut J, key: &str, value: &str) {
    if let J::Obj(fields) = j {
        fields.push((format!("\"{key}\""), J::Tok(value.into())));
    }
}

fn set_field(j: &mut J, key: &str, value: &str) {
    if let J::Obj(fields) = j {
        let raw = format!("\"{key}\"");
        match fields.iter_mut().find(|(k, _)| *k == raw) {
            Some((_, slot)) => *slot = J::Tok(value.into()),
            None => fields.push((raw, J::Tok(value.into()))),
        }
    }
}

fn remove_field(j: &mut J, key: &str) {
    if let J::Obj(fields) = j {
        let raw = format!("\"{key}\"");
        fields.retain(|(k, _)| *k != raw);
    }
}

/// Rompe la lavagna in uno dei modi che R1–R8 e la validazione rifiutano (o
/// quasi: è il nucleo a dire se si apre).
fn break_it(rng: &mut Lcg, root: &mut J) {
    let choice = rng.below(16);
    if let Some(nodes) = nodes_of(root).filter(|nodes| !nodes.is_empty()) {
        let index = rng.below(nodes.len());
        let node = &mut nodes[index];
        match choice {
            0 => push_field(node, "x", "1"),
            1 => push_field(node, "id", "\"zz\""),
            2 => set_field(node, "text", "\"\\ud800\""),
            3 => set_field(node, "x", rng.pick(&["0.5", "1.5e0", "1e-1", "-2.25"])),
            4 => set_field(
                node,
                "y",
                rng.pick(&["9007199254740992", "-9007199254740992", "1e16", "1e400"]),
            ),
            5 => set_field(node, "width", rng.pick(&["0", "-0", "-5", "0.0"])),
            6 => set_field(node, "type", "\"card\""),
            7 => set_field(
                node,
                "color",
                rng.pick(&["\"#12\"", "\"7\"", "\"red\"", "1"]),
            ),
            8 => {
                remove_field(node, "text");
                remove_field(node, "url");
                remove_field(node, "file");
                set_field(
                    node,
                    "type",
                    rng.pick(&["\"text\"", "\"link\"", "\"file\""]),
                );
            }
            9 => set_field(node, "id", rng.pick(&["\"a\\u0001\"", "\"\"", "1"])),
            10 => push_field(node, "\\udc00k", "1"),
            11 => push_field(node, "z", rng.pick(&["1e400", "-1e400", "1E309"])),
            12 => {
                let copy = node.clone();
                nodes.push(copy);
            }
            13 => set_field(node, "x", "\"0\""),
            14 => set_field(node, "text", "\"a\\udc00\\ud800b\""),
            _ => set_field(node, "subpath", "\"senza-cancelletto\""),
        }
        return;
    }
    match choice % 6 {
        0 => push_field(root, "nodes", "[]"),
        1 => push_field(root, "edges", "[]"),
        2 => set_field(root, "nodes", "{}"),
        3 => set_field(
            root,
            "edges",
            "[{\"id\":\"e\",\"fromNode\":\"q\",\"toNode\":\"q\"}]",
        ),
        4 => push_field(root, "\\ud83d", "0"),
        _ => set_field(root, "fub:ink", "[1e400]"),
    }
}

/// Mette una chiave sconosciuta doppia in un oggetto a caso: la lavagna si
/// apre (vince l'ultima), il ritocco la rifiuta (R3).
fn duplicate_unknown(rng: &mut Lcg, root: &mut J) {
    let mut found = Vec::new();
    objects(root, &mut Vec::new(), &mut found);
    let path = found[rng.below(found.len())].clone();
    let target = at_path(root, &path);
    let key = format!("\"{}\"", rng.pick(&["dup", "10", "__proto__"]));
    let first = unknown_value(rng, 1);
    let second = unknown_value(rng, 1);
    if let J::Obj(fields) = target {
        let at = rng.below(fields.len() + 1);
        fields.insert(at, (key.clone(), first));
        fields.push((key, second));
    }
}

/// I sorgenti vuoti o quasi (R1).
const BLANKS: &[&str] = &[
    "",
    "\u{feff}",
    "  \n",
    "\u{feff}\r\n",
    "\t \r\n",
    "\u{85}",
    "\u{a0}",
    "\u{feff}\u{feff}",
    "\u{2028}",
    "{}",
    "\u{feff}{}\r\n",
];

/// Un sorgente. Se serve solo a vedere se si apre (`reading`) è piccolo e
/// spesso rotto; se ci si fanno sopra delle toppe ha fino a due schede.
fn source(rng: &mut Lcg, reading: bool) -> String {
    if rng.chance(7) {
        return rng.pick(BLANKS).to_string();
    }
    let mut root = canvas(rng, if reading { 1 } else { 2 });
    let (broken, duplicated) = if reading { (40, 55) } else { (8, 14) };
    match rng.below(100) {
        n if n < broken => break_it(rng, &mut root),
        n if n < duplicated => duplicate_unknown(rng, &mut root),
        _ => {}
    }
    let style = Style {
        indent: rng.pick(&["", " ", "\t", "  "]),
        pretty_depth: rng.pick(&[0, 0, 0, 0, 1, 2, 99]),
        newline: if rng.chance(25) { "\r\n" } else { "\n" },
        colon: rng.pick(&[": ", ":", " : "]),
    };
    let mut out = String::new();
    if rng.chance(15) {
        out.push('\u{feff}');
    }
    write_j(&root, 0, &style, &mut out);
    match rng.below(4) {
        0 => {}
        1 => out.push_str(style.newline),
        2 => {
            out.push_str(style.newline);
            out.push_str(style.newline);
        }
        _ => out.push_str(" \t"),
    }
    out
}

// ---------------------------------------------------------------------------
// Le toppe

/// Un oggetto con le chiavi mescolate: l'immagine di prima si confronta per
/// valore (R9).
fn shuffled(rng: &mut Lcg, value: Value) -> Value {
    let Value::Object(map) = value else {
        return value;
    };
    let mut entries: Vec<(String, Value)> = map.into_iter().collect();
    rng.shuffle(&mut entries);
    Value::Object(entries.into_iter().collect())
}

fn before_image(rng: &mut Lcg, value: Value) -> Value {
    if rng.chance(25) {
        shuffled(rng, value)
    } else {
        value
    }
}

fn json_number(rng: &mut Lcg) -> Value {
    let token = number_tok(rng);
    serde_json::from_str(&token).expect("i numeri della lista si leggono")
}

/// Un valore sconosciuto per una toppa: i numeri del file e quelli a caso,
/// chiavi che sembrano indici, oggetti annidati.
fn unknown_json(rng: &mut Lcg, depth: usize) -> Value {
    match if depth == 0 {
        rng.below(4)
    } else {
        rng.below(6)
    } {
        0 | 1 => json_number(rng),
        2 => Value::String(rng.pick(TEXTS).to_string()),
        3 => [Value::Bool(true), Value::Null][rng.below(2)].clone(),
        4 => Value::Array(
            (0..rng.below(3))
                .map(|_| unknown_json(rng, depth - 1))
                .collect(),
        ),
        _ => {
            let mut map = Map::new();
            for _ in 0..rng.below(4) {
                let key = rng.pick(KEYS).to_string();
                map.insert(key, unknown_json(rng, depth - 1));
            }
            Value::Object(map)
        }
    }
}

fn fresh_id(rng: &mut Lcg, canvas: &Canvas) -> String {
    loop {
        let id = if rng.chance(10) {
            format!("{:06x}", rng.bits64() >> 40)
        } else {
            rng.pick(&["n", "m", "k9", "ü", "𝄞", "10", "z"]).to_string()
        };
        let taken = canvas.nodes.iter().any(|node| node.id == id)
            || canvas.edges.iter().any(|edge| edge.id == id);
        if !taken {
            return id;
        }
    }
}

/// Una scheda nuova come la farebbe la tela o un agente, a volte con campi
/// sconosciuti.
fn new_node(rng: &mut Lcg, id: String) -> Value {
    let mut map = Map::new();
    map.insert("id".into(), Value::String(id));
    let kind = rng.pick(&["text", "file", "link", "group"]);
    map.insert("type".into(), json!(kind));
    map.insert("x".into(), json!(coordinate(rng)));
    map.insert("y".into(), json!(coordinate(rng)));
    map.insert("width".into(), json!(size(rng)));
    map.insert("height".into(), json!(size(rng)));
    match kind {
        "text" => map.insert("text".into(), json!(rng.pick(TEXTS))),
        "file" => map.insert("file".into(), json!("😀.md")),
        "link" => map.insert("url".into(), json!("https://example.org/")),
        _ => map.insert("label".into(), json!(rng.pick(TEXTS))),
    };
    if rng.chance(30) {
        map.insert("color".into(), json!(color(rng)));
    }
    if rng.chance(25) {
        for _ in 0..=rng.below(2) {
            let key = rng.pick(KEYS).to_string();
            map.insert(key, unknown_json(rng, 1));
        }
    }
    if rng.chance(30) {
        return shuffled(rng, Value::Object(map));
    }
    Value::Object(map)
}

/// Cambia la scheda `node` come la tela o un agente: sposta, ridimensiona,
/// cambia il testo o il colore, aggiunge o toglie un campo sconosciuto.
fn edit_node(rng: &mut Lcg, mut node: Map<String, Value>) -> Map<String, Value> {
    for _ in 0..=rng.below(2) {
        match rng.below(9) {
            0 | 1 => {
                node.insert("x".into(), json!(coordinate(rng)));
                node.insert("y".into(), json!(coordinate(rng)));
            }
            2 => {
                node.insert("width".into(), json!(size(rng)));
            }
            3 => {
                let key = match node.get("type").and_then(Value::as_str) {
                    Some("text") => "text",
                    Some("group") => "label",
                    _ => "color",
                };
                let value = if key == "color" {
                    json!(color(rng))
                } else {
                    json!(rng.pick(TEXTS))
                };
                node.insert(key.into(), value);
            }
            4 => {
                if node.remove("color").is_none() {
                    node.insert("color".into(), json!(color(rng)));
                }
            }
            5 | 6 => {
                let key = rng.pick(KEYS).to_string();
                node.insert(key, unknown_json(rng, 2));
            }
            7 => {
                let known = [
                    "id", "type", "x", "y", "width", "height", "text", "file", "url",
                ];
                let unknown: Vec<String> = node
                    .keys()
                    .filter(|key| !known.contains(&key.as_str()))
                    .cloned()
                    .collect();
                if let Some(key) = unknown.get(rng.below(unknown.len().max(1))) {
                    node.shift_remove(key);
                }
            }
            _ => {
                // Un campo noto a `null` nella toppa: vale come assente (R7).
                let key = rng.pick(&["color", "background", "backgroundStyle"]);
                node.insert(key.into(), Value::Null);
            }
        }
    }
    node
}

/// Una scheda di dopo che la validazione rifiuta.
fn invalid_node(rng: &mut Lcg, mut node: Map<String, Value>) -> Map<String, Value> {
    match rng.below(5) {
        0 => {
            node.insert("width".into(), json!(0));
        }
        1 => {
            node.insert("color".into(), json!("#12"));
        }
        2 => {
            node.insert("type".into(), json!("link"));
            node.remove("url");
        }
        3 => {
            node.insert("id".into(), json!("a\u{1}"));
        }
        _ => {
            node.insert("type".into(), json!("file"));
            node.insert("file".into(), json!("x.md"));
            node.insert("subpath".into(), json!("senza"));
        }
    }
    node
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => unreachable!("una scheda o un arco sono oggetti"),
    }
}

/// Una toppa sul modello `canvas`, quasi sempre giusta; a volte vecchia o
/// con una scheda di dopo non valida.
fn patch(rng: &mut Lcg, canvas: &Canvas) -> Value {
    let node_count = canvas.nodes.len();
    let edge_count = canvas.edges.len();
    loop {
        match rng.below(20) {
            // Cambia una scheda.
            0..=5 if node_count > 0 => {
                let node = &canvas.nodes[rng.below(node_count)];
                let before = node_value(node).expect("la scheda si scrive");
                let after = edit_node(rng, object(before.clone()));
                let before = before_image(rng, before);
                return json!({"kind": "upsert-node", "before": before, "after": after});
            }
            // Aggiunge una scheda, in fondo o in `at`.
            6..=8 => {
                let id = fresh_id(rng, canvas);
                let after = new_node(rng, id);
                let mut patch = json!({"kind": "upsert-node", "before": null, "after": after});
                if rng.chance(50) {
                    // A volte una posizione oltre la fine: vecchia per tutti e due.
                    patch["at"] = json!(rng.below(node_count + 2));
                }
                return patch;
            }
            // Toglie una scheda (con i suoi archi, se ne ha: a volte no, ed è vecchia).
            9 | 10 if node_count > 0 => {
                let index = rng.below(node_count);
                let node = &canvas.nodes[index];
                let before = before_image(rng, node_value(node).expect("la scheda si scrive"));
                let mut patch = json!({"kind": "remove-node", "before": before, "after": null});
                if rng.chance(70) {
                    patch["at"] = json!(index);
                }
                return patch;
            }
            // Aggiunge un arco, a volte verso una scheda che non c'è.
            11 | 12 if node_count > 0 => {
                let from = canvas.nodes[rng.below(node_count)].id.clone();
                let to = if rng.chance(10) {
                    "manca".to_owned()
                } else {
                    canvas.nodes[rng.below(node_count)].id.clone()
                };
                let mut after = Map::new();
                after.insert("id".into(), json!(fresh_id(rng, canvas)));
                after.insert("fromNode".into(), json!(from));
                after.insert("toNode".into(), json!(to));
                if rng.chance(50) {
                    after.insert("toEnd".into(), json!("arrow"));
                }
                if rng.chance(30) {
                    after.insert("label".into(), json!(rng.pick(TEXTS)));
                }
                if rng.chance(30) {
                    after.insert(rng.pick(KEYS).to_string(), unknown_json(rng, 1));
                }
                return json!({"kind": "upsert-edge", "before": null, "after": after});
            }
            // Cambia un arco.
            13 if edge_count > 0 => {
                let edge = &canvas.edges[rng.below(edge_count)];
                let before = edge_value(edge).expect("l'arco si scrive");
                let mut after = object(before.clone());
                match rng.below(3) {
                    0 => after.insert("label".into(), json!(rng.pick(TEXTS))),
                    1 => after.insert(
                        "fromSide".into(),
                        json!(rng.pick(&["top", "right", "bottom", "left"])),
                    ),
                    _ => after.insert(rng.pick(KEYS).to_string(), unknown_json(rng, 1)),
                };
                let before = before_image(rng, before);
                return json!({"kind": "upsert-edge", "before": before, "after": after});
            }
            // Toglie un arco.
            14 if edge_count > 0 => {
                let edge = &canvas.edges[rng.below(edge_count)];
                let before = before_image(rng, edge_value(edge).expect("l'arco si scrive"));
                return json!({"kind": "remove-edge", "before": before, "after": null});
            }
            // Cambia l'ordine, a volte con un ordine che non è una permutazione.
            15 if node_count > 0 => {
                let before: Vec<String> = canvas.nodes.iter().map(|n| n.id.clone()).collect();
                let mut after = before.clone();
                rng.shuffle(&mut after);
                if rng.chance(10) {
                    after.pop();
                    after.push("manca".into());
                }
                return json!({"kind": "reorder", "before": before, "after": after});
            }
            // Un'immagine di prima che non è il modello.
            16 if node_count > 0 => {
                let node = &canvas.nodes[rng.below(node_count)];
                let mut before = object(node_value(node).expect("la scheda si scrive"));
                let after = edit_node(rng, before.clone());
                let x = before["x"].as_i64().unwrap_or(0);
                before.insert("x".into(), json!(if x > 0 { x - 1 } else { x + 1 }));
                return json!({"kind": "upsert-node", "before": before, "after": after});
            }
            // Una scheda di dopo non valida.
            17 if node_count > 0 => {
                let node = &canvas.nodes[rng.below(node_count)];
                let before = node_value(node).expect("la scheda si scrive");
                let after = invalid_node(rng, object(before.clone()));
                return json!({"kind": "upsert-node", "before": before, "after": after});
            }
            18 | 19 => {
                let id = fresh_id(rng, canvas);
                let fresh = new_node(rng, id);
                let after = invalid_node(rng, object(fresh));
                return json!({"kind": "upsert-node", "before": null, "after": after});
            }
            _ => {}
        }
    }
}

/// Toglie una scheda con tutti i suoi archi, prima gli archi.
fn remove_with_edges(rng: &mut Lcg, canvas: &Canvas) -> Option<Vec<Value>> {
    let index = rng.below(canvas.nodes.len().max(1));
    let node = canvas.nodes.get(index)?;
    let mut patches: Vec<Value> = canvas
        .edges
        .iter()
        .filter(|edge| edge.from_node == node.id || edge.to_node == node.id)
        .map(|edge| {
            let before = edge_value(edge).expect("l'arco si scrive");
            json!({"kind": "remove-edge", "before": before, "after": null})
        })
        .collect();
    if patches.is_empty() {
        return None;
    }
    let before = node_value(node).expect("la scheda si scrive");
    patches.push(json!({"kind": "remove-node", "before": before, "after": null, "at": index}));
    Some(patches)
}

/// Da una a tre toppe; ognuna è fatta sul modello lasciato dalle precedenti.
fn patches(rng: &mut Lcg, canvas: &Canvas) -> Vec<Value> {
    if rng.chance(8) {
        if let Some(patches) = remove_with_edges(rng, canvas) {
            return patches;
        }
    }
    let mut current = canvas.clone();
    let mut out = Vec::new();
    let count = if rng.chance(15) { 2 + rng.below(2) } else { 1 };
    for _ in 0..count {
        let value = patch(rng, &current);
        let parsed: CanvasPatch =
            serde_json::from_value(value.clone()).expect("la toppa generata si legge");
        out.push(value);
        match draft(&current, std::slice::from_ref(&parsed)) {
            Ok(next) => current = next,
            Err(_) => break,
        }
    }
    out
}

// ---------------------------------------------------------------------------
// I casi

/// `after` come differenza da `before`: `[p, mezzo, s]`, con `p` e `s` in
/// unità UTF-16 e il taglio ai confini di carattere.
fn delta(before: &str, after: &str) -> Value {
    let b: Vec<char> = before.chars().collect();
    let a: Vec<char> = after.chars().collect();
    let mut prefix = 0;
    while prefix < b.len() && prefix < a.len() && b[prefix] == a[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < b.len() - prefix
        && suffix < a.len() - prefix
        && b[b.len() - 1 - suffix] == a[a.len() - 1 - suffix]
    {
        suffix += 1;
    }
    let units = |chars: &[char]| chars.iter().map(|c| c.len_utf16()).sum::<usize>();
    let middle: String = a[prefix..a.len() - suffix].iter().collect();
    json!([units(&b[..prefix]), middle, units(&b[b.len() - suffix..])])
}

/// Il contrario di [`delta`], come lo fa il gemello TypeScript.
fn undelta(before: &str, delta: &Value) -> String {
    let units: Vec<u16> = before.encode_utf16().collect();
    let prefix = delta[0].as_u64().expect("p") as usize;
    let suffix = delta[2].as_u64().expect("s") as usize;
    let mut out = String::from_utf16(&units[..prefix]).expect("il taglio è a un confine");
    out.push_str(delta[1].as_str().expect("mezzo"));
    out.push_str(
        &String::from_utf16(&units[units.len() - suffix..]).expect("il taglio è a un confine"),
    );
    out
}

/// Una toppa (o qualche toppa) sul sorgente `source` e ciò che ne fa il nucleo.
fn one_run(rng: &mut Lcg, source: &str, mut core: Core) -> Value {
    let patches = patches(rng, core.canvas());
    let parsed: Vec<CanvasPatch> =
        serde_json::from_value(Value::Array(patches.clone())).expect("le toppe si leggono");
    match core.commit(&parsed) {
        Ok(committed) => {
            let text = delta(source, &committed.source);
            assert_eq!(undelta(source, &text), committed.source);
            // L'annulla può essere rifiutato anche lui: l'inversa di una
            // `remove-node` senza `at` rimette la scheda in fondo, e una
            // posizione presa prima può non esserci più (come in TypeScript).
            let undo = match core.commit(&committed.inverse) {
                Ok(undone) => {
                    let undo = delta(&committed.source, &undone.source);
                    assert_eq!(undelta(&committed.source, &undo), undone.source);
                    undo
                }
                Err(error) => Value::String(error.reason().to_owned()),
            };
            json!({"patches": patches, "outcome": "applied", "text": text, "undo": undo})
        }
        Err(error) => json!({"patches": patches, "outcome": "rejected", "reason": error.reason()}),
    }
}

/// Un sorgente e, se si apre e non serve solo a leggere, da una a tre prove
/// indipendenti su di lui: il sorgente si scrive una volta sola, e la fixture
/// sta nel suo tetto.
fn one_group(rng: &mut Lcg) -> Value {
    let reading = rng.chance(70);
    let source = source(rng, reading);
    if Core::open(source.clone()).is_err() {
        return json!({"source": source, "open": false});
    }
    let runs = if reading { 0 } else { 1 + rng.below(3) };
    let runs: Vec<Value> = (0..runs)
        .map(|_| {
            let core = Core::open(source.clone()).expect("si è appena aperto");
            one_run(rng, &source, core)
        })
        .collect();
    json!({"source": source, "runs": runs})
}

/// I gruppi della fixture, finché i casi non sono almeno [`CASES`]: ogni
/// sorgente è un caso (si apre o no, come in Rust) e ogni prova un altro.
fn groups() -> Vec<Value> {
    let mut rng = Lcg(SEED);
    let mut groups = Vec::new();
    let mut count = 0;
    while count < CASES {
        let group = one_group(&mut rng);
        count += 1 + group["runs"].as_array().map_or(0, Vec::len);
        groups.push(group);
    }
    groups
}

/// I casi, la forma che leggono i controlli: per ogni sorgente il suo «si
/// apre» e poi ogni prova con il suo sorgente.
fn cases_of(groups: &[Value]) -> Vec<Value> {
    let mut cases = Vec::new();
    for group in groups {
        let runs = group["runs"].as_array();
        cases.push(json!({"source": group["source"], "open": runs.is_some()}));
        for run in runs.into_iter().flatten() {
            let mut case = run.clone();
            case["source"] = group["source"].clone();
            cases.push(case);
        }
    }
    cases
}

/// La fixture: un sorgente per riga, perché un cambiamento si legga nel diff.
fn render(groups: &[Value]) -> String {
    let lines: Vec<String> = groups
        .iter()
        .map(|case| serde_json::to_string(case).expect("un caso si scrive"))
        .collect();
    format!("[\n{}\n]\n", lines.join(",\n"))
}

#[test]
fn canvas_mirror_is_in_sync_with_the_rust_core() {
    let expected = render(&groups());
    let path = fixture_path();

    // Rigenerazione esplicita: `UPDATE_MIRROR=1 cargo test -p fub-canvas-core
    // --test ts_mirror`. Fuori da quel caso il test non scrive mai nulla.
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &expected).expect("scrive la fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "manca la fixture dello specchio ({}): {error}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fub-canvas-core --test ts_mirror`.",
            path.display()
        )
    });
    if committed != expected {
        let line = committed
            .lines()
            .zip(expected.lines())
            .position(|(a, b)| a != b)
            .map_or_else(
                || "la lunghezza".to_owned(),
                |index| format!("la riga {}", index + 1),
            );
        panic!(
            "la fixture dello specchio è vecchia (differisce {line}): una regola del nucleo è \
             cambiata senza rigenerarla. Rigenerala con `UPDATE_MIRROR=1 cargo test -p \
             fub-canvas-core --test ts_mirror`, poi porta il TypeScript finché \
             `editors/canvas/mirror.test.ts` non torna verde."
        );
    }
}

#[test]
fn the_mirror_has_enough_cases_in_little_space() {
    let groups = groups();
    let cases = cases_of(&groups).len();
    assert!(cases >= MIN_CASES, "{cases} casi");
    let bytes = render(&groups).len();
    assert!(
        bytes < MAX_BYTES,
        "la fixture pesa {bytes} byte, il tetto è {MAX_BYTES}"
    );
}

/// Il test del test: uno specchio che non esercita un esito o una forma non
/// lo presidia.
#[test]
fn the_mirror_covers_every_outcome_and_every_form() {
    let cases = cases_of(&groups());
    let count = |what: &dyn Fn(&Value) -> bool| cases.iter().filter(|case| what(case)).count();
    let source = |case: &Value| case["source"].as_str().unwrap_or_default().to_owned();
    let written = |case: &Value| case["text"][1].as_str().unwrap_or_default().to_owned();
    let checks: [(&str, usize); 14] = [
        ("non si apre", count(&|c| c["open"] == false)),
        ("applicato", count(&|c| c["outcome"] == "applied")),
        ("rifiutato stale", count(&|c| c["reason"] == "stale")),
        ("rifiutato invalid", count(&|c| c["reason"] == "invalid")),
        ("rifiutato rejected", count(&|c| c["reason"] == "rejected")),
        ("con il BOM", count(&|c| source(c).starts_with('\u{feff}'))),
        ("CRLF", count(&|c| source(c).contains("\r\n"))),
        (
            "vuoto",
            count(&|c| fub_canvas_core::read::is_blank(&source(c))),
        ),
        (
            "Unicode a 4 byte",
            count(&|c| source(c).chars().any(|ch| ch.len_utf8() == 4)),
        ),
        ("un null", count(&|c| source(c).contains("null"))),
        (
            "chiave indice scritta",
            count(&|c| {
                ["\"0\":", "\"2\":", "\"10\":", "\"4294967294\":"]
                    .iter()
                    .any(|key| written(c).contains(key))
            }),
        ),
        (
            "__proto__ scritto",
            count(&|c| written(c).contains("__proto__")),
        ),
        (
            "numero esponenziale scritto",
            count(&|c| written(c).contains("e-")),
        ),
        (
            "più toppe",
            count(&|c| c["patches"].as_array().is_some_and(|p| p.len() > 1)),
        ),
    ];
    for (what, found) in checks {
        assert!(found >= 10, "solo {found} casi «{what}»");
    }
}
