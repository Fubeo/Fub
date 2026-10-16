//! Un vault con i disegni dentro, sul montaggio di produzione con la feature
//! `draw` (ADR 0203).
//!
//! Il provider `svg` rivendica ogni `.svg`: i disegni di FubDraw e quelli
//! scritti da altri programmi diventano documenti che la ricerca trova, che
//! portano backlink e archi del grafo, che un embed mostra come segnaposto e
//! che una rinomina riscrive byte per byte. Un `.svgz` resta di specie
//! sconosciuta, e un SVG rotto non ferma gli altri. Il Markdown accanto non
//! cambia. Il formato è nel [formato della
//! scena](../../../docs/reference/scene-format.md), §9.
//!
//! In fondo c'è il micro-bench che confronta l'indicizzazione di 500 disegni
//! con quella di 500 note della stessa dimensione: si esegue a mano, in
//! release, con
//! `cargo test --release -p fub-host --features draw --test svg_vault -- --ignored --nocapture`.

#![cfg(feature = "draw")]

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::{DocId, LinkTarget};
use fub_abi::query::{QueryExpr, QueryPredicate, TextQuery};
use fub_abi::traits::{
    EntryKind, Excerpts, IndexQuery, IndexResult, LinkDirection, Page, PropertySelect,
};
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

/// Un disegno di FubDraw: titolo, descrizione, due testi, un collegamento
/// attorno a un testo, uno attorno a una forma con il frammento, e
/// un'immagine del vault.
const ACQUA: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">
  <title>Ciclo dell'acqua</title>
  <desc>Evaporazione, condensazione e ritorno al mare</desc>
  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>
  <g id="l3f8a0c2d" fub:layer="Livello 1">
    <a id="o1a2b3c4d" href="../note/Pioggia.md">
      <text id="o2b3c4d5e" x="100" y="100" fill="#000000" font-size="32">
        <tspan x="100" dy="0">Precipitazione</tspan>
      </text>
    </a>
    <text id="o3c4d5e6f" x="400" y="100" fill="#000000" font-size="32">
      <tspan x="400" dy="0">Condensazione nei cumulonembi</tspan>
    </text>
    <a id="o4d5e6f7g" href="../note/Nuvole.md#Cumuli">
      <ellipse id="o5e6f7g8h" cx="300" cy="200" rx="120" ry="60" fill="none" stroke="#0072b2" stroke-width="4"/>
    </a>
    <image id="o6f7g8h9i" x="0" y="300" width="200" height="100" href="foto/mare.png"/>
  </g>
</svg>
"##;

/// Un disegno di FubDraw minimo, per le note di cartella.
fn drawing(title: &str) -> String {
    format!(
        concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100" width="100" height="100">"#,
            "\n  <title>{}</title>\n</svg>\n"
        ),
        title
    )
}

/// Ricostruito sul formato di Inkscape, con BOM, CRLF, apici singoli e un
/// `xlink:href` che ripete `href`.
const QUARTIERE: &str = include_str!("../../fub-format-svg/tests/fixtures/foreign-crlf-bom.svg");
/// Un salvataggio «SVG di Inkscape» con livelli, righe `sodipodi:role` e
/// metadati RDF.
const INKSCAPE: &str = include_str!("../../fub-scene/tests/corpus/inkscape.svg");
/// Esportati da Mermaid 11.4.2: il diagramma di sequenza ha le etichette in
/// `text`, quello di flusso in XHTML dentro `foreignObject`.
const SEQUENZA: &str = include_str!("../../fub-scene/tests/corpus/mermaid-sequence.svg");
const FLUSSO: &str = include_str!("../../fub-scene/tests/corpus/mermaid-flowchart.svg");

/// L'intestazione di un PNG: un allegato.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
/// L'intestazione di gzip: un `.svgz` non è testo.
const GZIP: &[u8] = &[0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0];

fn write(root: &Utf8Path, rel: &str, body: impl AsRef<[u8]>) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

/// Il vault della prova.
fn vault() -> (tempfile::TempDir, Utf8PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).unwrap();
    write(
        &root,
        "note/Pioggia.md",
        "# Pioggia\n\nCade dalle nuvole.\n",
    );
    write(
        &root,
        "note/Nuvole.md",
        "# Nuvole\n\n## Cumuli\n\nBianchi e gonfi.\n",
    );
    write(
        &root,
        "note/Indice.md",
        "# Indice\n\n![[acqua.svg]]\n\nVedi [[acqua]] e [la mappa](../mappe/quartiere.svg), poi [[Pioggia]].\n",
    );
    write(&root, "disegni/acqua.svg", ACQUA);
    write(&root, "disegni/foto/mare.png", PNG);
    write(&root, "mappe/quartiere.svg", QUARTIERE);
    write(
        &root,
        "mappe/quartiere/parco.md",
        "# Parco\n\nGiochi e alberi.\n",
    );
    write(&root, "disegni/giardino.svg", INKSCAPE);
    write(&root, "diagrammi/sequenza.svg", SEQUENZA);
    write(&root, "diagrammi/flusso.svg", FLUSSO);
    write(
        &root,
        "rotto.svg",
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><g></svg>\n",
    );
    write(&root, "archivio.svgz", GZIP);
    // Note di cartella: accanto alla cartella, dentro con il nome della
    // cartella, dentro come `index`. Un disegno e una nota per ciascuna.
    write(&root, "disegno.svg", drawing("Disegno accanto"));
    write(&root, "disegno/dettaglio.md", "# Dettaglio\n");
    write(&root, "appunti.md", "# Appunti accanto\n");
    write(&root, "appunti/dettaglio.md", "# Dettaglio\n");
    write(&root, "progetto/progetto.svg", drawing("Progetto"));
    write(&root, "quaderno/quaderno.md", "# Quaderno\n");
    write(&root, "album/index.svg", drawing("Album"));
    write(&root, "raccolta/index.md", "# Raccolta\n");
    (dir, root)
}

fn mount(root: &Utf8Path) -> (fub_host::mount::Mounted, fub_kernel::Opening) {
    let mut mounted = fub_host::mount::mount(
        root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("il vault si monta");
    let opening = mounted.workspace.reindex().expect("il vault si indicizza");
    (mounted, opening)
}

fn id(path: &str) -> DocId {
    DocId::new(path)
}

fn kinds(ws: &fub_kernel::Workspace) -> BTreeMap<String, EntryKind> {
    let Ok(IndexResult::Entries(entries)) = ws.query_index(IndexQuery::Entries {
        of_kind: None,
        within: None,
        page: Some(Page::first(1000)),
    }) else {
        panic!("l'anagrafe risponde")
    };
    entries
        .items
        .into_iter()
        .map(|entry| (entry.id.to_string(), entry.kind))
        .collect()
}

/// I documenti che la ricerca a testo pieno trova per `terms`.
fn search(ws: &fub_kernel::Workspace, terms: &str) -> Vec<String> {
    match ws.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Text(TextQuery::terms(terms))),
        sort: None,
        select: PropertySelect::None,
        page: Some(Page::first(50)),
        excerpts: Excerpts::Attach,
    }) {
        Ok(IndexResult::Documents(hits)) => {
            let mut docs: Vec<_> = hits
                .items
                .into_iter()
                .map(|hit| hit.doc.to_string())
                .collect();
            docs.sort();
            docs
        }
        other => panic!("{other:?}"),
    }
}

/// Quali di questi documenti esistono: la domanda che la shell fa per le note
/// di cartella (`existingDocuments` in `apps/client/src/host/query.ts`).
fn existing(ws: &fub_kernel::Workspace, docs: &[String]) -> Vec<String> {
    match ws.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Docs {
            docs: docs.iter().map(|doc| id(doc)).collect(),
        }),
        sort: None,
        select: PropertySelect::None,
        page: None,
        excerpts: Excerpts::Omit,
    }) {
        Ok(IndexResult::Documents(hits)) => hits
            .items
            .into_iter()
            .map(|hit| hit.doc.to_string())
            .collect(),
        other => panic!("{other:?}"),
    }
}

/// La regola della shell (`folderNoteCandidates` in
/// `apps/client/src/rules/organizer.ts`): `X/X.<ext>`, poi `X/index.<ext>`,
/// per ogni estensione che il backend dichiara.
fn folder_note(ws: &fub_kernel::Workspace, folder: &str) -> Option<String> {
    let name = folder.rsplit('/').next().unwrap();
    let candidates: Vec<String> = [name, "index"]
        .iter()
        .flat_map(|stem| {
            ws.extensions()
                .into_iter()
                .map(move |ext| format!("{folder}/{stem}.{ext}"))
        })
        .collect();
    let found = existing(ws, &candidates);
    candidates
        .into_iter()
        .find(|candidate| found.contains(candidate))
}

fn neighbors(ws: &fub_kernel::Workspace, seed: &str, direction: LinkDirection) -> Vec<String> {
    match ws.query_index(IndexQuery::Neighbors {
        seeds: QueryExpr::of(QueryPredicate::Docs {
            docs: vec![id(seed)],
        }),
        direction,
        depth: 1,
        page: Some(Page::first(50)),
    }) {
        Ok(IndexResult::Neighbors(found)) => {
            let mut docs: Vec<_> = found.items.into_iter().map(|n| n.doc.to_string()).collect();
            docs.sort();
            docs
        }
        other => panic!("{other:?}"),
    }
}

fn backlinks(ws: &fub_kernel::Workspace, target: &str) -> Vec<(String, Option<String>)> {
    let mut found: Vec<_> = ws
        .backlinks(&id(target))
        .into_iter()
        .map(|link| (link.source.to_string(), link.context))
        .collect();
    found.sort();
    found
}

#[test]
fn every_file_has_the_kind_it_should() {
    let (_dir, root) = vault();
    let (mounted, opening) = mount(&root);
    let ws = &mounted.workspace;
    let kinds = kinds(ws);
    for doc in [
        "disegni/acqua.svg",
        "mappe/quartiere.svg",
        "disegni/giardino.svg",
        "diagrammi/sequenza.svg",
        "diagrammi/flusso.svg",
        "disegno.svg",
        "note/Pioggia.md",
    ] {
        assert_eq!(kinds[doc], EntryKind::Document, "{doc}");
        assert!(ws.format_of(&id(doc)).is_some(), "{doc}");
    }
    assert_eq!(
        ws.format_of(&id("disegni/acqua.svg"))
            .unwrap()
            .descriptor
            .id,
        fub_format_svg::FORMAT_ID
    );
    assert_eq!(kinds["disegni/foto/mare.png"], EntryKind::Asset);
    assert_eq!(kinds["archivio.svgz"], EntryKind::Unknown);
    assert_eq!(ws.format_of(&id("archivio.svgz")), None);

    // Un SVG che non si legge è uno scarto dell'apertura, con il byte nel
    // motivo; resta nell'anagrafe e si apre ancora dal sorgente, e gli altri
    // si indicizzano.
    let discarded: Vec<_> = opening.discarded.iter().map(|r| r.id.to_string()).collect();
    assert_eq!(discarded, ["rotto.svg"]);
    assert!(
        opening.discarded[0].why.to_string().contains("byte"),
        "{}",
        opening.discarded[0].why
    );
    assert!(kinds.contains_key("rotto.svg"), "{kinds:?}");
    assert!(ws.read_source(&id("rotto.svg")).unwrap().contains("<g>"));
    assert!(!ws.documents().contains(&id("rotto.svg")));
    assert!(ws.documents().contains(&id("disegni/acqua.svg")));
}

#[test]
fn search_finds_titles_texts_and_foreign_drawings() {
    let (_dir, root) = vault();
    let (mounted, _) = mount(&root);
    let ws = &mounted.workspace;
    // Titolo, descrizione e testi di un disegno di FubDraw.
    for terms in ["Ciclo", "ritorno al mare", "Precipitazione", "cumulonembi"] {
        assert_eq!(search(ws, terms), ["disegni/acqua.svg"], "{terms}");
    }
    // Gli estranei: Inkscape, il file con BOM e CRLF, Mermaid in `text`.
    assert_eq!(search(ws, "Aiuola"), ["disegni/giardino.svg"]);
    assert_eq!(search(ws, "quartiere"), ["mappe/quartiere.svg"]);
    assert_eq!(
        search(ws, "giochi"),
        ["mappe/quartiere.svg", "mappe/quartiere/parco.md"]
    );
    assert_eq!(search(ws, "payload"), ["diagrammi/sequenza.svg"]);
    // Le etichette XHTML di un diagramma di flusso non sono testi della
    // scena (§9): non si trovano.
    assert!(search(ws, "testkit").is_empty());
    // Il Markdown si cerca come sempre.
    assert_eq!(search(ws, "gonfi"), ["note/Nuvole.md"]);

    // L'outline del disegno è il suo titolo.
    let Ok(IndexResult::Outline(outline)) = ws.query_index(IndexQuery::Outline {
        doc: id("disegni/acqua.svg"),
    }) else {
        panic!("l'outline risponde")
    };
    let titles: Vec<_> = outline.iter().map(|h| h.text.as_str()).collect();
    assert_eq!(titles, ["Ciclo dell'acqua"]);
}

#[test]
fn links_in_drawings_are_backlinks_and_edges() {
    let (_dir, root) = vault();
    let (mounted, _) = mount(&root);
    let ws = &mounted.workspace;
    let acqua = "disegni/acqua.svg";

    // Da un disegno: il contesto è l'etichetta del collegamento.
    let pioggia = backlinks(ws, "note/Pioggia.md");
    let sources: Vec<_> = pioggia.iter().map(|(s, _)| s.as_str()).collect();
    assert_eq!(sources, [acqua, "note/Indice.md"]);
    assert_eq!(pioggia[0].1.as_deref(), Some("Precipitazione"));
    // Un collegamento attorno a una forma, con il frammento.
    assert_eq!(backlinks(ws, "note/Nuvole.md"), [(acqua.to_owned(), None)]);
    // Un SVG estraneo con `xlink:href` e `href` uguali: un collegamento solo.
    let parco = backlinks(ws, "mappe/quartiere/parco.md");
    assert_eq!(parco.len(), 1, "{parco:?}");
    assert_eq!(parco[0].0, "mappe/quartiere.svg");
    // Verso un disegno, da una nota: wikilink, embed e link a percorso.
    let to_drawing: Vec<_> = backlinks(ws, acqua).into_iter().map(|(s, _)| s).collect();
    assert!(
        to_drawing.iter().all(|s| s == "note/Indice.md"),
        "{to_drawing:?}"
    );
    assert!(!to_drawing.is_empty());
    assert_eq!(backlinks(ws, "mappe/quartiere.svg")[0].0, "note/Indice.md");

    // Il grafo: gli archi uscenti di un disegno, con l'allegato come foglia,
    // e quelli entranti.
    let mut outgoing: Vec<_> = ws
        .outgoing(&id(acqua))
        .iter()
        .map(|d| d.to_string())
        .collect();
    outgoing.sort();
    assert_eq!(outgoing, ["note/Nuvole.md", "note/Pioggia.md"]);
    assert_eq!(
        neighbors(ws, acqua, LinkDirection::Outbound),
        ["disegni/foto/mare.png", "note/Nuvole.md", "note/Pioggia.md"]
    );
    assert_eq!(
        neighbors(ws, acqua, LinkDirection::Inbound),
        ["note/Indice.md"]
    );
    assert_eq!(
        neighbors(ws, "note/Pioggia.md", LinkDirection::Inbound),
        [acqua, "note/Indice.md"]
    );
}

#[test]
fn an_embedded_drawing_is_a_placeholder() {
    let (_dir, root) = vault();
    let (mounted, _) = mount(&root);
    let ws = &mounted.workspace;
    let placeholder = |doc: &str, caption: &str| {
        format!(
            r#"<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="{doc}"><figcaption>{caption}</figcaption></figure>"#
        )
    };

    let (doc, rendered) = ws.render_embed("acqua.svg", None, None).unwrap();
    assert_eq!(doc, id("disegni/acqua.svg"));
    assert_eq!(
        rendered.html,
        placeholder("disegni/acqua.svg", "Ciclo dell&#39;acqua")
    );
    assert!(rendered.parts.is_empty());
    // Lo stesso dalla domanda della shell, e per nome senza estensione.
    let Ok(IndexResult::RenderEmbed(embed)) = ws.query_index(IndexQuery::RenderEmbed {
        page: "acqua".to_owned(),
        heading: None,
        block: None,
    }) else {
        panic!("l'embed risponde")
    };
    assert_eq!(embed.doc_id, "disegni/acqua.svg");
    assert_eq!(embed.content.html, rendered.html);
    // La sola sezione di un disegno è il titolo, ed è il disegno intero
    // (§9); un altro nome non è una sezione, come in una nota.
    let (_, section) = ws
        .render_embed("acqua.svg", Some("Ciclo dell'acqua"), None)
        .unwrap();
    assert_eq!(section.html, rendered.html);
    assert!(ws
        .render_embed("acqua.svg", Some("Livello 1"), None)
        .is_err());
    assert!(ws
        .render_embed("note/Nuvole.md", Some("Altrove"), None)
        .is_err());
    // Un estraneo senza titolo prende il nome del file; l'anteprima del
    // pannello è lo stesso segnaposto.
    let (_, flusso) = ws.render_embed("diagrammi/flusso.svg", None, None).unwrap();
    assert_eq!(flusso.html, placeholder("diagrammi/flusso.svg", "flusso"));
    let preview = ws.render_preview(&id("disegni/acqua.svg")).unwrap();
    assert_eq!(preview.html, rendered.html);
    for html in [&rendered.html, &flusso.html, &preview.html] {
        assert!(!html.contains("<img") && !html.contains("src="), "{html}");
    }
}

/// Un SVG che prova a fare di tutto: script, gestori d'evento, XHTML in un
/// `foreignObject`, un'immagine remota, e un titolo che sembra markup.
const OSTILE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">
  <title>Ostile &lt;script&gt;alert(2)&lt;/script&gt;</title>
  <script>alert(3)</script>
  <foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(4)"/></div></foreignObject>
  <image href="https://esterno.example/traccia.png" width="10" height="10"/>
  <rect width="10" height="10" onclick="alert(5)"/>
</svg>
"#;

fn resolved(ws: &fub_kernel::Workspace, target: LinkTarget, from: &str) -> Option<String> {
    match ws.query_index(IndexQuery::Resolve {
        target,
        from: Some(id(from)),
    }) {
        Ok(IndexResult::Resolved(found)) => found.map(|found| found.doc.to_string()),
        other => panic!("{other:?}"),
    }
}

fn outline(ws: &fub_kernel::Workspace, doc: &str) -> Vec<(u8, String)> {
    match ws.query_index(IndexQuery::Outline { doc: id(doc) }) {
        Ok(IndexResult::Outline(headings)) => headings
            .into_iter()
            .map(|heading| (heading.level, heading.text))
            .collect(),
        other => panic!("{other:?}"),
    }
}

/// Ciò che la shell chiede per mostrare un disegno dentro una nota
/// (`hydrateVaultMedia` in
/// `apps/client/src/editors/text/profiles/markdown/media.ts`): la
/// risoluzione del riferimento, un lease sul file come immagine, e il nome
/// per l'`alt`.
#[test]
fn a_drawing_in_a_note_is_an_image_named_after_its_title() {
    let (_dir, root) = vault();
    write(&root, "disegni/ostile.svg", OSTILE);
    let (mounted, _) = mount(&root);
    let ws = &mounted.workspace;
    let acqua = "disegni/acqua.svg";
    let note = "note/Indice.md";

    // `![[acqua.svg]]`, `![[acqua]]` e `![](../disegni/acqua.svg)` nominano
    // lo stesso file.
    assert_eq!(
        resolved(ws, LinkTarget::wiki("acqua.svg"), note).as_deref(),
        Some(acqua)
    );
    assert_eq!(
        resolved(ws, LinkTarget::wiki("acqua"), note).as_deref(),
        Some(acqua)
    );
    assert_eq!(
        resolved(ws, LinkTarget::Path("../disegni/acqua.svg".into()), note).as_deref(),
        Some(acqua)
    );

    // Il lease è quello di ogni immagine: come lo apre la sessione
    // (`ResourceHost::resource_open`), con il MIME che il protocollo
    // `fub-asset:` mette nella risposta accanto a `nosniff`. I byte sono il
    // file, intatti: è l'`<img>` a non eseguirne niente.
    for (doc, body) in [(acqua, ACQUA), ("disegni/ostile.svg", OSTILE)] {
        let lease = ws
            .prepare_resource_open(&id(doc))
            .unwrap()
            .invoke()
            .unwrap();
        let mut table = fub_host::resources::ResourceTable::default();
        let mime = fub_host::resources::resource_mime_or_octet(&id(doc)).to_owned();
        let descriptor = table.open(root.to_string(), id(doc), lease, mime).unwrap();
        assert_eq!(descriptor.mime, "image/svg+xml", "{doc}");
        assert_eq!(
            descriptor.kind,
            fub_host::resources::ResourceKind::Image,
            "{doc}"
        );
        let lease = table.lease(descriptor.handle).unwrap();
        let bytes = ws
            .read_resource(&lease, 0, descriptor.len as usize)
            .unwrap();
        assert_eq!(bytes, body.as_bytes(), "{doc}");
    }

    // Il nome: il titolo dall'outline; senza titolo, un documento prende il
    // nome del file; un'immagine che non è un documento non ne ha.
    assert_eq!(outline(ws, acqua), [(1, "Ciclo dell'acqua".to_owned())]);
    assert!(outline(ws, "diagrammi/flusso.svg").is_empty());
    assert!(outline(ws, "disegni/foto/mare.png").is_empty());
    assert!(outline(ws, "rotto.svg").is_empty());
    let asked: Vec<String> = [
        acqua,
        "diagrammi/flusso.svg",
        "disegni/foto/mare.png",
        "rotto.svg",
    ]
    .map(str::to_owned)
    .to_vec();
    let mut found = existing(ws, &asked);
    found.sort();
    assert_eq!(found, ["diagrammi/flusso.svg", acqua]);

    // Il segnaposto di un SVG ostile porta soltanto l'id e il titolo come
    // testo: niente di quello che il file prova a fare arriva alla nota.
    assert_eq!(
        outline(ws, "disegni/ostile.svg"),
        [(1, "Ostile <script>alert(2)</script>".to_owned())]
    );
    let (doc, rendered) = ws.render_embed("ostile", None, None).unwrap();
    assert_eq!(doc, id("disegni/ostile.svg"));
    assert_eq!(
        rendered.html,
        concat!(
            r#"<figure class="fub-scene" data-embed-kind="scene" data-embed-doc="disegni/ostile.svg">"#,
            "<figcaption>Ostile &lt;script&gt;alert(2)&lt;/script&gt;</figcaption></figure>"
        )
    );
    for absent in [
        "<script",
        "alert(1)",
        "alert(3)",
        "alert(4)",
        "alert(5)",
        "foreignObject",
        "esterno",
        "<img",
        "src=",
    ] {
        assert!(
            !rendered.html.contains(absent),
            "{absent}: {}",
            rendered.html
        );
    }
}

/// La nota di cartella è dentro la cartella, `X/X.<ext>` o `X/index.<ext>`,
/// e un disegno lo è come una nota: con lo stesso esito, nei tre casi.
#[test]
fn a_drawing_is_a_folder_note_exactly_like_a_note() {
    let (_dir, root) = vault();
    let (mounted, _) = mount(&root);
    let ws = &mounted.workspace;
    assert!(ws.extensions().iter().any(|ext| ext == "svg"));

    // Accanto alla cartella non è la sua nota, per nessuno dei due.
    assert_eq!(folder_note(ws, "disegno"), None);
    assert_eq!(folder_note(ws, "appunti"), None);
    // Dentro, con il nome della cartella.
    assert_eq!(
        folder_note(ws, "progetto").as_deref(),
        Some("progetto/progetto.svg")
    );
    assert_eq!(
        folder_note(ws, "quaderno").as_deref(),
        Some("quaderno/quaderno.md")
    );
    // Dentro, come `index`.
    assert_eq!(folder_note(ws, "album").as_deref(), Some("album/index.svg"));
    assert_eq!(
        folder_note(ws, "raccolta").as_deref(),
        Some("raccolta/index.md")
    );
}

#[test]
fn renaming_a_note_rewrites_the_drawings_that_link_it() {
    let (_dir, root) = vault();
    let (mut mounted, _) = mount(&root);
    let ws = &mut mounted.workspace;

    ws.rename_document(&id("note/Pioggia.md"), &id("note/Pioggia battente.md"))
        .unwrap();
    let after = ws.read_source(&id("disegni/acqua.svg")).unwrap();
    assert_eq!(
        after,
        ACQUA.replace(
            r#"href="../note/Pioggia.md""#,
            r#"href="../note/Pioggia%20battente.md""#
        )
    );
    assert_eq!(
        backlinks(ws, "note/Pioggia battente.md")
            .into_iter()
            .map(|(s, _)| s)
            .collect::<Vec<_>>(),
        ["disegni/acqua.svg", "note/Indice.md"]
    );
    assert!(ws.backlinks(&id("note/Pioggia.md")).is_empty());

    // Il file estraneo con BOM, CRLF e apici singoli: cambiano solo i due
    // valori che puntano alla nota, `href` e l'`xlink:href` che lo ripete.
    ws.rename_document(
        &id("mappe/quartiere/parco.md"),
        &id("mappe/parchi/parco.md"),
    )
    .unwrap();
    let after = ws.read_source(&id("mappe/quartiere.svg")).unwrap();
    assert_eq!(
        after,
        QUARTIERE.replace("'quartiere/parco.md'", "'parchi/parco.md'")
    );
    assert!(after.starts_with('\u{feff}'));
    assert_eq!(
        backlinks(ws, "mappe/parchi/parco.md")[0].0,
        "mappe/quartiere.svg"
    );
    // Sul disco, gli stessi byte.
    assert_eq!(
        std::fs::read(root.join("mappe/quartiere.svg")).unwrap(),
        after.as_bytes()
    );
}

/// Un disegno che cambia cartella riscrive i propri collegamenti relativi
/// come una nota: quelli verso i documenti seguono, e quelli verso gli
/// allegati restano come sono, nell'uno e nell'altra.
#[test]
fn moving_a_drawing_rebases_its_own_links_like_a_note() {
    let (_dir, root) = vault();
    write(
        &root,
        "disegni/nota.md",
        "# Nota\n\n![mare](foto/mare.png) e [pioggia](../note/Pioggia.md)\n",
    );
    let (mut mounted, _) = mount(&root);
    let ws = &mut mounted.workspace;

    ws.rename_document(&id("disegni/acqua.svg"), &id("archivio/2026/acqua.svg"))
        .unwrap();
    ws.rename_document(&id("disegni/nota.md"), &id("archivio/2026/nota.md"))
        .unwrap();
    let after = ws.read_source(&id("archivio/2026/acqua.svg")).unwrap();
    assert_eq!(
        after,
        ACQUA
            .replace(r#""../note/Pioggia.md""#, r#""../../note/Pioggia.md""#)
            .replace(
                r#""../note/Nuvole.md#Cumuli""#,
                r#""../../note/Nuvole.md#Cumuli""#
            )
    );
    assert_eq!(
        ws.read_source(&id("archivio/2026/nota.md")).unwrap(),
        "# Nota\n\n![mare](foto/mare.png) e [pioggia](../../note/Pioggia.md)\n"
    );
    assert_eq!(
        backlinks(ws, "note/Nuvole.md")[0].0,
        "archivio/2026/acqua.svg"
    );
    // Le note che lo nominano lo seguono.
    let indice = ws.read_source(&id("note/Indice.md")).unwrap();
    assert!(indice.contains("![[acqua.svg]]"), "{indice}");
    assert_eq!(
        backlinks(ws, "archivio/2026/acqua.svg")
            .into_iter()
            .map(|(s, _)| s)
            .collect::<Vec<_>>()
            .first()
            .map(String::as_str),
        Some("note/Indice.md")
    );
}

/// Il Markdown non si accorge dei disegni: lo stesso vault senza gli SVG dà
/// alle note gli stessi backlink, la stessa ricerca e le stesse specie.
#[test]
fn markdown_does_not_notice_the_drawings() {
    let (_dir, root) = vault();
    let (with_drawings, _) = mount(&root);

    let bare = tempfile::tempdir().unwrap();
    let bare_root = Utf8PathBuf::from_path_buf(bare.path().to_path_buf()).unwrap();
    for entry in walk(&root) {
        if !entry.ends_with(".svg") {
            write(
                &bare_root,
                &entry,
                std::fs::read(root.join(&entry)).unwrap(),
            );
        }
    }
    let (without, _) = mount(&bare_root);

    let notes: Vec<_> = walk(&bare_root)
        .into_iter()
        .filter(|path| path.ends_with(".md"))
        .collect();
    assert!(notes.len() >= 8);
    let only_notes = |found: Vec<(String, Option<String>)>| -> Vec<_> {
        found
            .into_iter()
            .filter(|(s, _)| s.ends_with(".md"))
            .collect()
    };
    for note in &notes {
        assert_eq!(
            only_notes(backlinks(&with_drawings.workspace, note)),
            backlinks(&without.workspace, note),
            "{note}"
        );
        let a = with_drawings.workspace.read_model(&id(note)).ok();
        let b = without.workspace.read_model(&id(note)).ok();
        assert_eq!(a, b, "{note}");
    }
    for terms in ["gonfi", "Dettaglio", "Cade"] {
        assert_eq!(
            search(&with_drawings.workspace, terms),
            search(&without.workspace, terms),
            "{terms}"
        );
    }
    let a = kinds(&with_drawings.workspace);
    let b = kinds(&without.workspace);
    for (path, kind) in &b {
        assert_eq!(a.get(path), Some(kind), "{path}");
    }
}

fn walk(root: &Utf8Path) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = Utf8PathBuf::from_path_buf(entry.unwrap().path()).unwrap();
            if path.file_name().is_some_and(|name| name.starts_with('.')) {
                continue;
            }
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path.strip_prefix(root).unwrap().to_string());
            }
        }
    }
    out.sort();
    out
}

// ---------------------------------------------------------------------------
// Il micro-bench del cancello: i disegni non devono costare all'indice più
// del doppio delle note.
// ---------------------------------------------------------------------------

/// Quanti file per insieme, e quante volte si misura ciascuno.
const FILES: usize = 500;
const ROUNDS: usize = 7;

/// Un disegno realistico: titolo, descrizione, cinque testi, tre collegamenti
/// ad altri disegni dell'insieme, un'immagine e otto tratti di penna da 40
/// campioni, che sono il grosso dei byte di un disegno vero.
fn bench_drawing(i: usize) -> String {
    let mut out = format!(
        concat!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 1600 1000" width="1600" height="1000">"#,
            "\n  <title>Disegno {i}</title>\n  <desc>Schema del passaggio {i} fra le fasi del ciclo</desc>\n",
            r##"  <rect id="fub-paper" fub:role="paper" x="0" y="0" width="1600" height="1000" fill="#ffffff"/>"##,
            "\n  <g id=\"l{i:08}\" fub:layer=\"Livello 1\">\n"
        ),
        i = i
    );
    for t in 0..5 {
        out.push_str(&format!(
            "    <text id=\"t{i:04}{t:04}\" x=\"{x}\" y=\"{y}\" fill=\"#000000\" font-size=\"24\">\n      <tspan x=\"{x}\" dy=\"0\">Etichetta {t} del disegno {i} con parole comuni</tspan>\n    </text>\n",
            x = 100 + t * 200,
            y = 100 + t * 50,
        ));
    }
    for l in 1..=3 {
        out.push_str(&format!(
            "    <a id=\"a{i:04}{l:04}\" href=\"disegno-{}.svg\">\n      <text x=\"10\" y=\"{}\" fill=\"#000000\">vai al {}</text>\n    </a>\n",
            (i + l) % FILES,
            800 + l * 30,
            (i + l) % FILES,
        ));
    }
    out.push_str(
        "    <image x=\"1200\" y=\"100\" width=\"200\" height=\"150\" href=\"foto.png\"/>\n",
    );
    for s in 0..8 {
        let mut ink = format!("1 s100 cxypt {},{},128,0", 10_000 + s * 1000, 20_000 + i);
        let mut d = format!("M{}.5 {}.5", 100 + s * 10, 200 + s);
        for k in 0..39 {
            ink.push_str(&format!(" {},{},{},8", 25 + k % 7, k % 5 - 2, k % 3));
            d.push_str(&format!(
                " Q{}.2 {}.4 {}.1 {}.3",
                100 + k,
                200 + k,
                101 + k,
                201 + k
            ));
        }
        out.push_str(&format!(
            "    <path id=\"p{i:04}{s:04}\" fub:tool=\"pen\" fub:brush=\"pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0\" d=\"{d} Z\" fill=\"#0072b2\" fub:ink=\"{ink}\"/>\n"
        ));
    }
    out.push_str("  </g>\n</svg>\n");
    out
}

/// Una nota della stessa dimensione: titolo, gli stessi cinque testi, tre
/// collegamenti ad altre note dell'insieme, un'immagine, e prosa fino ai byte
/// del disegno.
fn bench_note(i: usize, bytes: usize) -> String {
    let mut out = format!("# Nota {i}\n\nSchema del passaggio {i} fra le fasi del ciclo.\n\n");
    for t in 0..5 {
        out.push_str(&format!(
            "Etichetta {t} della nota {i} con parole comuni.\n\n"
        ));
    }
    for l in 1..=3 {
        out.push_str(&format!(
            "- [vai alla {}](nota-{}.md)\n",
            (i + l) % FILES,
            (i + l) % FILES
        ));
    }
    out.push_str("\n![foto](foto.png)\n\n");
    let prose = "Il vapore sale, si raffredda e torna giù come pioggia sui campi e sul mare. ";
    while out.len() + prose.len() < bytes {
        out.push_str(prose);
    }
    out.push('\n');
    out
}

/// Il tempo mediano di `reindex` su un vault appena montato, `ROUNDS` volte.
fn median_reindex(mut mount: impl FnMut() -> Box<dyn FnMut() -> Duration>) -> Duration {
    let mut times: Vec<Duration> = (0..ROUNDS).map(|_| mount()()).collect();
    times.sort();
    times[ROUNDS / 2]
}

#[test]
#[ignore = "micro-bench: si esegue a mano, in release"]
fn indexing_500_drawings_costs_at_most_twice_500_notes() {
    use std::time::Instant;

    let drawings = tempfile::tempdir().unwrap();
    let drawings_root = Utf8PathBuf::from_path_buf(drawings.path().to_path_buf()).unwrap();
    let notes = tempfile::tempdir().unwrap();
    let notes_root = Utf8PathBuf::from_path_buf(notes.path().to_path_buf()).unwrap();
    let (mut svg_bytes, mut md_bytes) = (0, 0);
    for i in 0..FILES {
        let drawing = bench_drawing(i);
        let note = bench_note(i, drawing.len());
        svg_bytes += drawing.len();
        md_bytes += note.len();
        write(&drawings_root, &format!("disegno-{i}.svg"), drawing);
        write(&notes_root, &format!("nota-{i}.md"), note);
    }
    write(&drawings_root, "foto.png", PNG);
    write(&notes_root, "foto.png", PNG);
    let ratio_bytes = svg_bytes as f64 / md_bytes as f64;
    assert!(
        (0.95..=1.05).contains(&ratio_bytes),
        "{svg_bytes} contro {md_bytes} byte"
    );

    // Il montaggio di produzione: parse, grafo, ricerca e bundle ufficiali.
    let production = |root: Utf8PathBuf| {
        move || -> Box<dyn FnMut() -> Duration> {
            let mut mounted = fub_host::mount::mount(
                &root,
                MachineSettings::in_memory(),
                ViewStates::in_memory(),
                Arc::new(SystemLocale::default()),
                &fub_kernel::log::Levels::default(),
            )
            .unwrap();
            Box::new(move || {
                let started = Instant::now();
                let opening = mounted.workspace.reindex().unwrap();
                let took = started.elapsed();
                assert!(opening.whole());
                assert_eq!(mounted.workspace.documents().len(), FILES);
                took
            })
        }
    };
    // Il kernel solo, dal banco: parse e grafo, senza i bundle.
    let kernel = |root: Utf8PathBuf| {
        move || -> Box<dyn FnMut() -> Duration> {
            let mut bench = fub_testkit::Bench::on(&root)
                .with_format(fub_format_markdown::MarkdownProvider::boxed())
                .with_format(fub_format_svg::SvgProvider::boxed())
                .without_scan()
                .mounts();
            Box::new(move || {
                let started = Instant::now();
                let opening = bench.reindex().unwrap();
                let took = started.elapsed();
                assert!(opening.whole());
                assert_eq!(bench.documents().len(), FILES);
                took
            })
        }
    };

    let mut verdicts = Vec::new();
    for (name, svg, md) in [
        (
            "montaggio di produzione",
            median_reindex(production(drawings_root.clone())),
            median_reindex(production(notes_root.clone())),
        ),
        (
            "kernel dal banco",
            median_reindex(kernel(drawings_root.clone())),
            median_reindex(kernel(notes_root.clone())),
        ),
    ] {
        let ratio = svg.as_secs_f64() / md.as_secs_f64();
        println!(
            "{name}: {FILES} disegni {svg:.2?}, {FILES} note {md:.2?}, rapporto {ratio:.2} \
             (mediana di {ROUNDS}; {} contro {} KiB)",
            svg_bytes / 1024,
            md_bytes / 1024
        );
        verdicts.push((name, ratio));
    }
    for (name, ratio) in verdicts {
        assert!(
            ratio <= 2.0,
            "{name}: i disegni costano {ratio:.2} volte le note"
        );
    }
}
