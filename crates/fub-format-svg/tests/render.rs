//! L'anteprima di un disegno è un segnaposto: la figura che la shell riempie,
//! con il titolo come didascalia, e nessun riferimento a una risorsa.

use fub_abi::format::{DocumentSource, ParseContext, RenderOptions, RenderTarget};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::FormatProvider;
use fub_format_svg::SvgProvider;

const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 10 10">"#;

fn model(id: &str, body: &str) -> DocumentModel {
    SvgProvider
        .parse(
            &DocumentSource::Text(format!("{SVG}{body}</svg>")),
            &ParseContext::obsidian(id),
        )
        .unwrap()
}

fn render(model: &DocumentModel) -> String {
    SvgProvider
        .render_html(model, &RenderOptions::preview())
        .unwrap()
}

#[test]
fn the_preview_is_the_placeholder_with_the_title() {
    let model = model(
        "disegni/acqua.svg",
        r#"<title>Ciclo dell'acqua</title><image href="foto/mare.png" width="1" height="1"/>"#,
    );
    assert_eq!(
        render(&model),
        concat!(
            r#"<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="disegni/acqua.svg">"#,
            "<figcaption>Ciclo dell&#39;acqua</figcaption></figure>",
        )
    );
}

#[test]
fn no_resource_is_ever_named() {
    let model = model(
        "a.svg",
        concat!(
            "<title>Con immagini</title>",
            r#"<image href="foto/mare.png" width="1" height="1"/>"#,
            r#"<image href="data:image/png;base64,AAAA" width="1" height="1"/>"#,
            r#"<a href="https://example.org"><text>fuori</text></a>"#,
        ),
    );
    for target in [
        RenderTarget::Screen,
        RenderTarget::Print,
        RenderTarget::Pdf,
        RenderTarget::StaticSite,
    ] {
        let opts = RenderOptions {
            target,
            ..RenderOptions::preview()
        };
        let html = SvgProvider.render_html(&model, &opts).unwrap();
        assert_eq!(html, render(&model), "{target:?}");
        for forbidden in [
            "<img",
            "src=",
            "href=",
            "url(",
            "foto/mare.png",
            "data:",
            "<svg",
        ] {
            assert!(!html.contains(forbidden), "{forbidden} in {html}");
        }
    }
}

#[test]
fn title_and_id_are_escaped() {
    let model = model(
        r#"disegni/"x" & <y>.svg"#,
        "<title>A &amp; &lt;b&gt; \"c\"</title>",
    );
    assert_eq!(
        render(&model),
        concat!(
            r#"<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="disegni/&quot;x&quot; &amp; &lt;y&gt;.svg">"#,
            "<figcaption>A &amp; &lt;b&gt; &quot;c&quot;</figcaption></figure>",
        )
    );
}

/// Senza titolo la didascalia è il nome del file: è il nome accessibile della
/// figura, e una figura muta non direbbe che cosa c'è.
#[test]
fn a_drawing_without_a_title_is_named_after_its_file() {
    for body in ["", "<title>   </title>", "<desc>solo descrizione</desc>"] {
        assert_eq!(
            render(&model("schizzi/Ponte sul fiume.svg", body)),
            concat!(
                r#"<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="schizzi/Ponte sul fiume.svg">"#,
                "<figcaption>Ponte sul fiume</figcaption></figure>",
            ),
            "{body}"
        );
    }
}

/// Con dei renderer registrati il kernel passa un frammento che ha solo i
/// blocchi: niente outline, niente collegamenti. Il segnaposto è lo stesso.
#[test]
fn a_fragment_renders_like_the_whole_model() {
    let whole = model("acqua.svg", "<title>Acqua</title><text>mare</text>");
    let mut fragment = DocumentModel::empty(DocId::new("acqua.svg"));
    fragment.body = whole.body.clone();
    assert_eq!(render(&fragment), render(&whole));
    // E un frammento vuoto, come quello della sezione `#Titolo` di un
    // disegno, prende il nome del file.
    assert!(render(&DocumentModel::empty(DocId::new("acqua.svg")))
        .contains("<figcaption>acqua</figcaption>"));
}
