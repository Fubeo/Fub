//! Lo specchio delle penne: `src/pens.rs` contro `apps/client/src/ink/pens.ts`
//! e `palette.ts`, che fanno fede.
//!
//! Il test scrive `apps/client/src/__fixtures__/ink-pens.json` con le penne,
//! la tavolozza e il pennello codificato di ogni penna alle misure 0,25, 1,
//! quella di serie e 200, con e senza pressione. Senza `UPDATE_MIRROR` lo
//! confronta col file committato: una penna cambiata in Rust lo rende vecchio.
//! L'altra metà è `apps/client/src/ink/pens-mirror.test.ts`, che vuole le
//! stesse risposte da `penBrush`, `formatInkBrush` e `INK_PALETTE`: una cifra
//! cambiata in `pens.ts` lo fa rosso di là.
//!
//! Il JSON si scrive a mano, un caso per riga, perché un cambiamento si legga
//! nel diff; i valori sono id, colori, numeri finiti e pennelli, che non hanno
//! caratteri da sfuggire, e un test lo controlla.

use std::path::PathBuf;

use fub_ink_codec::pens::{
    pen_brush, PenRecipe, DEFAULT_PEN, INK_PALETTE, MAX_PEN_SIZE, MIN_PEN_SIZE, PENS,
};

const COMMAND: &str = "UPDATE_MIRROR=1 cargo test -p fub-ink-codec --test pens_mirror";

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/ink-pens.json")
}

/// Le misure dei casi di ogni penna: gli estremi, 1 e quella di serie.
fn sizes(default: f64) -> [f64; 4] {
    [MIN_PEN_SIZE, 1.0, default, MAX_PEN_SIZE]
}

/// Un testo JSON. I valori dello specchio non hanno virgolette, barre né
/// caratteri di controllo: `plain_values` lo controlla.
fn text(value: &str) -> String {
    format!("\"{value}\"")
}

/// Un numero JSON, come lo scrive `JSON.stringify` per i numeri dello specchio.
fn number(value: f64) -> String {
    assert!(value.is_finite(), "un numero dello specchio è finito");
    if value == 0.0 {
        "0".to_owned()
    } else {
        format!("{value}")
    }
}

fn render() -> String {
    let mut lines: Vec<String> = Vec::new();
    lines.push("{".to_owned());
    lines.push(format!(
        "  \"$generato\": \"File generato da crates/fub-ink-codec/tests/pens_mirror.rs, non modificare a mano; rigenera con {COMMAND}\","
    ));
    lines.push(format!("  \"min_size\": {},", number(MIN_PEN_SIZE)));
    lines.push(format!("  \"max_size\": {},", number(MAX_PEN_SIZE)));
    lines.push(format!("  \"default_pen\": {},", text(DEFAULT_PEN)));

    lines.push("  \"pens\": [".to_owned());
    let pens: Vec<String> = PENS
        .iter()
        .map(|pen| {
            let algorithm = match pen.recipe {
                PenRecipe::Pf1 { .. } => "pf1",
                PenRecipe::Nib1 => "nib1",
            };
            format!(
                "    {{\"id\": {}, \"tool\": {}, \"size\": {}, \"opacity\": {}, \"blend\": {}, \"pressure\": {}, \"algorithm\": {}}}",
                text(pen.id),
                text(pen.tool.as_str()),
                number(pen.size),
                number(pen.opacity),
                text(pen.blend.as_str()),
                pen.pressure,
                text(algorithm),
            )
        })
        .collect();
    lines.push(pens.join(",\n"));
    lines.push("  ],".to_owned());

    lines.push("  \"brushes\": [".to_owned());
    let mut brushes: Vec<String> = Vec::new();
    for pen in &PENS {
        for size in sizes(pen.size) {
            for pressure in [true, false] {
                let brush = pen_brush(pen, size, pressure)
                    .encode()
                    .unwrap_or_else(|error| {
                        panic!("{}: il pennello non si scrive: {error}", pen.id)
                    });
                brushes.push(format!(
                    "    {{\"pen\": {}, \"size\": {}, \"pressure\": {pressure}, \"brush\": {}}}",
                    text(pen.id),
                    number(size),
                    text(&brush),
                ));
            }
        }
    }
    lines.push(brushes.join(",\n"));
    lines.push("  ],".to_owned());

    lines.push("  \"palette\": [".to_owned());
    let palette: Vec<String> = INK_PALETTE
        .iter()
        .map(|swatch| {
            format!(
                "    {{\"id\": {}, \"color\": {}}}",
                text(swatch.id),
                text(swatch.color)
            )
        })
        .collect();
    lines.push(palette.join(",\n"));
    lines.push("  ]".to_owned());
    lines.push("}".to_owned());
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

#[test]
fn plain_values() {
    let mut values: Vec<String> = vec![DEFAULT_PEN.to_owned()];
    for pen in &PENS {
        values.push(pen.id.to_owned());
        for size in sizes(pen.size) {
            for pressure in [true, false] {
                values.push(pen_brush(pen, size, pressure).encode().expect("si scrive"));
            }
        }
    }
    for swatch in &INK_PALETTE {
        values.push(swatch.id.to_owned());
        values.push(swatch.color.to_owned());
    }
    for value in values {
        assert!(
            value
                .chars()
                .all(|c| c != '"' && c != '\\' && !c.is_control()),
            "un valore da sfuggire nello specchio: {value:?}"
        );
    }
}

#[test]
fn the_pens_mirror_is_in_sync() {
    let expected = render();
    let path = fixture_path();

    // Rigenerazione esplicita; fuori da quel caso il test non scrive niente.
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &expected).expect("scrive lo specchio delle penne");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "manca lo specchio delle penne ({}): {error}. Rigeneralo con `{COMMAND}`.",
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
                |i| format!("la riga {}", i + 1),
            );
        panic!(
            "lo specchio delle penne è vecchio (differisce {line}): una penna di `pens.rs` è \
             cambiata senza rigenerarlo. Rigeneralo con `{COMMAND}`, poi porta `pens.ts` finché \
             `ink/pens-mirror.test.ts` non torna verde."
        );
    }
}
