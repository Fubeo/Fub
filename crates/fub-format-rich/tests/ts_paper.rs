//! Le dimensioni della carta che la striscia dei documenti offre, emesse da
//! quelle di WordCraft (`wordcraft_geom::PAPER_SIZES`) in
//! `apps/client/src/editors/rich/paper.generated.ts`. I lati sono già
//! arrotondati al ventesimo di punto, come un `.docx` li conserva: una carta
//! scelta e riletta resta la stessa.
//!
//! ```sh
//! UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_paper
//! ```

use std::path::PathBuf;

const HEADER: &str = "\
// FILE GENERATO — non modificare a mano.
//
// Le dimensioni della carta di WordCraft (`wordcraft_geom::PAPER_SIZES`), in
// punti e in verticale, arrotondate al ventesimo di punto come le conserva un
// `.docx` (crates/fub-format-rich/tests/ts_paper.rs).
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_paper
";

fn twips(points: f32) -> f64 {
    (f64::from(points) * 20.0).round() / 20.0
}

fn render() -> String {
    let mut out = String::from(HEADER);
    out.push_str("\nexport const PAPER_SIZES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [\n");
    for (name, w, h) in wordcraft_geom::PAPER_SIZES {
        out.push_str(&format!(
            "  {{ name: {name:?}, w: {}, h: {} }},\n",
            twips(*w),
            twips(*h)
        ));
    }
    out.push_str("];\n");
    out
}

#[test]
fn le_carte_della_shell_sono_quelle_di_wordcraft() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/editors/rich/paper.generated.ts");
    let emitted = render();
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emitted).expect("scrive le carte");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == emitted,
        "`paper.generated.ts` è stantio. Rigenera con \
         `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_paper`."
    );
}
