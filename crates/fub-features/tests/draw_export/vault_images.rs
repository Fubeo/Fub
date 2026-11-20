//! Le immagini del vault: arrivano in entrambi i formati, si leggono una
//! volta e si fermano al budget.

use super::*;

// ---------------------------------------------------------------------------
// Le immagini del vault
// ---------------------------------------------------------------------------

/// Un disegno di 160 × 100 con le immagini `images`, ognuna `(href, x,
/// larghezza)` a tutta altezza, i pixel senza sfumature.
pub(super) fn with_images(images: &[(&str, u32, u32)]) -> String {
    let images: String = images
        .iter()
        .map(|(href, x, width)| {
            format!(
                r#"<image x="{x}" y="0" width="{width}" height="100" preserveAspectRatio="none" image-rendering="optimizeSpeed" href="{href}"/>"#
            )
        })
        .collect();
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" width="160" height="100">{images}</svg>"#
    )
}

#[test]
fn vault_images_reach_both_formats() {
    // Un percorso relativo al disegno, come lo scrive `format_link`, e uno
    // dalla radice del vault.
    let svg = with_images(&[("foto/rosso.png", 0, 80), ("/Allegati/rosso.png", 80, 80)]);
    let host = host()
        .with_document("disegni/acqua.svg", &svg)
        .with_binary_document("disegni/foto/rosso.png", &red_png())
        .with_binary_document("Allegati/rosso.png", &red_png());

    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegni/acqua.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let image = decode(&only_artifact(&report).1);
    assert_eq!(red_pixels(&image), (image.width * image.height) as usize);

    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["disegni/acqua.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let pdf = only_artifact(&report).1;
    assert!(String::from_utf8_lossy(&pdf).contains("/Subtype /Image"));
}

#[test]
fn a_vault_image_is_read_once_per_drawing() {
    // Quattro modi di scrivere lo stesso file: due percorsi uguali dopo la
    // pulizia dell'URL, due diversi che portano allo stesso file.
    let svg = with_images(&[
        ("rosso.png", 0, 40),
        (" rosso.png ", 40, 40),
        ("./rosso.png", 80, 40),
        ("/rosso.png", 120, 40),
    ]);
    let red = red_png();
    let host = host()
        .with_document("disegno.svg", &svg)
        .with_binary_document("rosso.png", &red);

    let image = decode(&png_of(&host, "disegno.svg"));
    assert_eq!(red_pixels(&image), (image.width * image.height) as usize);
    assert_eq!(host.reads_on("rosso.png"), (1, red.len()));
}

#[test]
fn vault_images_stop_at_the_budget_and_the_rest_still_come_in() {
    // Il tetto è di 64 MiB per disegno, in ordine di testo: la prima immagine
    // ne consuma un poco, e la seconda, che da sola ci starebbe, non ci sta più.
    // Non si legge nemmeno, e la terza entra lo stesso.
    let red = red_png();
    let mut large = b"\x89PNG\r\n\x1a\n".to_vec();
    large.resize(64 * 1024 * 1024 - red.len() + 1, 0);
    let svg = with_images(&[
        ("prima.png", 0, 40),
        ("grande.png", 40, 80),
        ("terza.png", 120, 40),
    ]);
    let host = host()
        .with_document("disegno.svg", &svg)
        .with_binary_document("prima.png", &red)
        .with_binary_document("grande.png", &large)
        .with_binary_document("terza.png", &red);

    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegno.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert_eq!(
        messages(&report),
        ["1 vault image did not fit in the 64 MiB of images of a drawing and was not exported: grande.png"]
    );
    assert_eq!(host.reads_on("grande.png"), (0, 0));
    assert_eq!(host.reads_on("terza.png"), (1, red.len()));
    // Le due immagini che ci stanno, metà del disegno, e in mezzo lo sfondo
    // trasparente.
    let image = decode(&only_artifact(&report).1);
    assert_eq!(
        red_pixels(&image),
        (image.width * image.height / 2) as usize
    );
}
