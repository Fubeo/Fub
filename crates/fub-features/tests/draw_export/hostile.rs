//! Che cosa non si tocca: un disegno ostile non apre niente e si esporta
//! come il suo gemello pulito.

use super::*;

// ---------------------------------------------------------------------------
// Che cosa non si tocca
// ---------------------------------------------------------------------------

/// Un PNG rosso 4 × 4: il colore di ogni risorsa che non deve comparire.
pub(super) fn red_png() -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 4, 4);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(&[255, 0, 0].repeat(16)).unwrap();
    writer.finish().unwrap();
    bytes
}

pub(super) fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Una scena con `extra` dentro: il gemello pulito e quello ostile differiscono
/// solo lì.
fn scene(extra: &str) -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 160 100" width="160" height="100">
  <rect x="0" y="0" width="160" height="100" fill="#ffffff"/>
  <rect x="10" y="10" width="40" height="30" fill="#0072b2"/>
  {extra}
</svg>
"##
    )
}

/// Tutto ciò che un disegno ostile può nominare, puntato verso risorse rosse.
struct Hostile {
    listener: TcpListener,
    _dir: tempfile::TempDir,
    svg: String,
    clean: String,
}

fn hostile() -> Hostile {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let net = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());

    let dir = tempfile::tempdir().unwrap();
    let red = dir.path().join("rosso.png");
    fs::write(&red, red_png()).unwrap();
    let other = dir.path().join("altro.svg");
    fs::write(
        &other,
        r##"<svg xmlns="http://www.w3.org/2000/svg"><rect id="forma" width="160" height="100" fill="#ff0000"/></svg>"##,
    )
    .unwrap();
    let css = dir.path().join("stile.css");
    fs::write(&css, "rect { fill: #ff0000 !important; }").unwrap();
    let file = |path: &Path| {
        let path = path.to_string_lossy().replace('\\', "/");
        let path = path.trim_start_matches('/');
        format!("file:///{path}")
    };
    let absolute = red.to_string_lossy().into_owned();
    let red_svg = base64(
        br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>"##,
    );

    let hostile = format!(
        r##"<style>
    @import url("{net}/stile.css");
    @import url("{css}");
    @font-face {{ font-family: "Remoto"; src: url("{net}/carattere.ttf"); }}
  </style>
  <image x="60" y="10" width="20" height="20" href="{net}/rosso.png"/>
  <image x="60" y="10" width="20" height="20" xlink:href="{net}/rosso.png"/>
  <image x="80" y="10" width="20" height="20" href="{red_file}"/>
  <image x="80" y="10" width="20" height="20" href="{absolute}"/>
  <image x="100" y="10" width="20" height="20" href="../rosso.png"/>
  <image x="100" y="10" width="20" height="20" href="Allegati/rosso.svg"/>
  <image x="120" y="10" width="20" height="20" href="data:image/svg+xml;base64,{red_svg}"/>
  <filter id="remoto"><feImage href="{net}/filtro.png"/></filter>
  <rect x="0" y="50" width="160" height="50" fill="#ff0000" filter="url(#remoto)"/>
  <use href="{net}/altro.svg#forma"/>
  <use xlink:href="{other_file}#forma"/>
  <foreignObject x="0" y="0" width="160" height="100"><img xmlns="http://www.w3.org/1999/xhtml" src="{net}/rosso.png"/></foreignObject>
  <text x="10" y="80" font-family="DejaVu Sans" font-size="16" fill="#000000">Pioggia</text>"##,
        css = file(&css),
        red_file = file(&red),
        other_file = file(&other),
    );
    // Il gemello: lo stesso testo nel carattere che il ripiego deve scegliere
    // (Literata, la famiglia con grazie, come per un `font-family` che il
    // database non conosce). Se il disegno ostile arrivasse a DejaVu Sans di
    // sistema, il testo cambierebbe forma e i due PNG non coinciderebbero.
    // Il filtro resta, senza sorgente: un `feImage` che non si carica e uno
    // che non nomina niente danno la stessa immagine trasparente.
    let clean = r##"<filter id="remoto"><feImage/></filter>
  <rect x="0" y="50" width="160" height="50" fill="#ff0000" filter="url(#remoto)"/>
  <text x="10" y="80" font-family="serif" font-size="16" fill="#000000">Pioggia</text>"##;
    Hostile {
        listener,
        _dir: dir,
        svg: scene(&hostile),
        clean: scene(clean),
    }
}

#[test]
fn a_hostile_drawing_opens_nothing_and_exports_like_its_clean_twin() {
    let hostile = hostile();
    // Lo stesso nome nei due vault: il titolo dei file viene da lì, e così i
    // due export si possono confrontare byte per byte.
    // Rossi anche nel vault: il PNG dove un `..` di troppo porterebbe se la
    // radice non fosse un confine, e un SVG, che non è un raster.
    let host = host()
        .with_document("disegno.svg", &hostile.svg)
        .with_binary_document("rosso.png", &red_png())
        .with_document(
            "Allegati/rosso.svg",
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>"##,
        );
    let twin = self::host().with_document("disegno.svg", &hostile.clean);

    let png = png_of(&host, "disegno.svg");
    let pdf = pdf_of(&host, "disegno.svg");
    let jpeg = jpeg_of(&host, "disegno.svg", serde_json::Value::Null);
    // L'SVG ripete i riferimenti, che sono il testo del disegno, ma non li
    // segue.
    svg_of(&host, "disegno.svg", serde_json::Value::Null);

    // Niente rete: nessuna connessione aspetta nel backlog del server.
    match hostile.listener.accept() {
        Err(error) if error.kind() == ErrorKind::WouldBlock => {}
        other => panic!("the export reached the network: {other:?}"),
    }
    assert!(host.network_requests().is_empty());
    // Niente vault oltre al disegno: le due immagini rosse non sono state
    // lette, e le sole letture sono quelle del disegno, una per formato.
    assert_eq!(host.reads_on("rosso.png"), (0, 0));
    assert_eq!(host.reads_on("Allegati/rosso.svg"), (0, 0));
    let drawing = hostile.svg.len();
    assert_eq!(host.reads_on("disegno.svg"), (4, 4 * drawing));
    assert_eq!(host.read_totals(), (4, 4 * drawing));

    // Niente file locali, niente SVG incorporati, niente carattere di sistema:
    // non c'è un pixel rosso, e i due file sono quelli del gemello pulito.
    assert_eq!(red_pixels(&decode(&png)), 0);
    assert!(
        png == png_of(&twin, "disegno.svg"),
        "the PNG differs from its twin"
    );
    let clean = pdf_of(&twin, "disegno.svg");
    if pdf != clean {
        let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
        fs::write(out.join("ostile.pdf"), &pdf).unwrap();
        fs::write(out.join("pulito.pdf"), &clean).unwrap();
        panic!(
            "the PDF differs from its twin: both are in {}",
            out.display()
        );
    }
    assert!(
        jpeg == jpeg_of(&twin, "disegno.svg", serde_json::Value::Null),
        "the JPEG differs from its twin"
    );
    // E due export dello stesso disegno ostile sono identici.
    assert!(png == png_of(&host, "disegno.svg"));
    assert!(pdf == pdf_of(&host, "disegno.svg"));
}

#[test]
fn the_log_names_what_was_left_out() {
    let broken_png = base64(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
    let red_svg = base64(
        br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>"##,
    );
    let svg = with_images(&[
        ("https://example.org/a.png", 0, 10),
        ("file:///etc/b.png", 0, 10),
        ("//example.org/c.png", 0, 10),
        ("#d", 0, 10),
        ("mancante.png", 0, 10),
        ("../fuori.png", 0, 10),
        ("nota.md", 0, 10),
        ("rotta.png", 0, 10),
        (&format!("data:image/png;base64,{broken_png}"), 0, 10),
        (&format!("data:image/svg+xml;base64,{red_svg}"), 0, 10),
    ]);
    let host = host()
        .with_document("ostile.svg", &svg)
        .with_document("nota.md", "# Nota\n")
        .with_binary_document("rotta.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["ostile.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert_eq!(
        messages(&report),
        [
            "4 image references point outside the vault and were not exported: #d, //example.org/c.png, file:///etc/b.png and 1 more",
            "2 images are not in the vault and were not exported: ../fuori.png, mancante.png",
            "2 vault images are not readable PNG, JPEG, GIF or WebP images and were not exported: nota.md, rotta.png",
            "2 embedded images are not readable PNG, JPEG, GIF or WebP images and were not exported",
        ]
    );
    assert!(report
        .log
        .iter()
        .all(|note| note.entry.as_deref() == Some("ostile.svg")));
    // Una nota non è un'immagine: non si legge nemmeno.
    assert_eq!(host.reads_on("nota.md"), (0, 0));
}

/// La prova più stretta, dove il sistema la permette: le risorse locali sono
/// FIFO, e aprire una FIFO in lettura si blocca finché qualcuno non ci scrive.
/// Un export che ne aprisse una non finirebbe; uno che finisce non ne ha
/// aperta nessuna, nemmeno per scartarne i byte.
#[cfg(unix)]
#[test]
fn a_hostile_drawing_does_not_even_open_local_files() {
    let dir = tempfile::tempdir().unwrap();
    let fifo = |name: &str| {
        let path = dir.path().join(name);
        let made = std::process::Command::new("mkfifo")
            .arg(&path)
            .status()
            .expect("mkfifo");
        assert!(made.success());
        path.to_string_lossy().into_owned()
    };
    let (png, svg, css, font, entity) = (
        fifo("rosso.png"),
        fifo("altro.svg"),
        fifo("stile.css"),
        fifo("carattere.ttf"),
        fifo("entita.txt"),
    );
    let references = scene(&format!(
        r##"<style>
    @import url("file://{css}");
    @import url("{css}");
    @font-face {{ font-family: "Locale"; src: url("file://{font}"); }}
  </style>
  <image width="20" height="20" href="file://{png}"/>
  <image width="20" height="20" href="{png}"/>
  <use href="file://{svg}#forma"/>
  <use xlink:href="{svg}#forma"/>
  <filter id="locale"><feImage href="file://{png}"/></filter>
  <rect width="10" height="10" filter="url(#locale)"/>
  <text x="10" y="80" font-family="Locale" font-size="16">Pioggia</text>"##
    ));
    let entities = format!(
        r##"<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY segreto SYSTEM "file://{entity}">]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="10" y="30">&segreto;</text></svg>"##
    );
    let host = host()
        .with_document("riferimenti.svg", &references)
        .with_document("entita.svg", &entities);

    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for doc in ["riferimenti.svg", "entita.svg"] {
            for (provider, target) in [
                (&PngExport as &dyn ExportProvider, DRAW_PNG),
                (&JpegExport, DRAW_JPEG),
                (&SvgExport, DRAW_SVG),
                (&PdfExport, DRAW_PDF),
            ] {
                let _ = export(provider, &host, target, &[doc], serde_json::Value::Null);
            }
        }
        done.send(()).unwrap();
    });
    // Se un export si blocca, il suo filo resta lì: il test fallisce lo
    // stesso, e il processo dei test lo chiude uscendo.
    finished
        .recv_timeout(std::time::Duration::from_secs(60))
        .expect("the export opened a local file and is waiting on it");
}

#[test]
fn an_external_entity_is_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let secret = dir.path().join("segreto.txt");
    fs::write(&secret, "SEGRETO").unwrap();
    let svg = format!(
        r##"<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY segreto SYSTEM "file://{}">]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="10" y="30" font-size="20">&segreto;</text></svg>"##,
        secret.to_string_lossy().replace('\\', "/")
    );
    let host = host().with_document("entita.svg", &svg);
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&PdfExport, DRAW_PDF),
    ] {
        match export(
            provider,
            &host,
            target,
            &["entita.svg"],
            serde_json::Value::Null,
        ) {
            // Se il parser rifiuta l'entità, il disegno non si esporta.
            Err(PluginError::BadArgs(_)) => {}
            // Se la ignora, il testo non c'è: nessun glifo, quindi nessun
            // carattere incorporato nel PDF e nessun pixel scuro nel PNG.
            Ok(report) => {
                let bytes = only_artifact(&report).1;
                if target == DRAW_PDF {
                    assert!(!String::from_utf8_lossy(&bytes).contains("/FontFile2"));
                } else {
                    let image = decode(&bytes);
                    assert!(image.rgba.chunks(4).all(|px| px[3] == 0));
                }
            }
            Err(other) => panic!("{other:?}"),
        }
    }
}
