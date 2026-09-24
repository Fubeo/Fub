use fub_abi::format::{DocumentSource, LinkRewrite, ParseContext};
use fub_abi::model::{DocId, LinkTarget, Span};
use fub_abi::{FormatError, FormatProvider};
use fub_format_canvas::{parse_canvas, CanvasProvider};

fn parse(source: &str) -> fub_abi::model::DocumentModel {
    CanvasProvider::new()
        .parse(
            &DocumentSource::Text(source.to_string()),
            &ParseContext::obsidian("board.canvas"),
        )
        .unwrap()
}

fn rewrite(source: &str, rewrites: &[LinkRewrite]) -> Result<Vec<fub_abi::TextEdit>, FormatError> {
    CanvasProvider::new()
        .rewrite_links(
            &DocumentSource::Text(source.to_string()),
            &ParseContext::obsidian("board.canvas"),
            rewrites,
        )
        .map(|opt| opt.unwrap())
}

fn apply(source: &str, edit: &fub_abi::TextEdit) -> String {
    let mut out = source.to_string();
    out.replace_range(edit.span.start..edit.span.end, &edit.text);
    out
}

#[test]
fn unknown_fields_survive_parse_serialize_round_trip() {
    let source = r#"{"nodes":[{"id":"n1","type":"text","x":0,"y":0,"width":200,"height":120,"text":"ciao","futureField":{"nested":[1,2]},"xVendor":true}],"edges":[],"xRoot":{"a":1}}"#;
    let canvas = parse_canvas(source).unwrap();
    assert_eq!(
        canvas.nodes[0].extra["futureField"]["nested"][1],
        serde_json::json!(2)
    );
    assert_eq!(canvas.extra["xRoot"]["a"], serde_json::json!(1));
    // Il modello comune non porta gli extra, ma la sorgente resta l'autorità:
    // riparsare la stessa sorgente ridà gli stessi extra.
    let again = parse_canvas(source).unwrap();
    assert_eq!(canvas, again);
}

#[test]
fn text_card_links_tags_and_file_targets() {
    let source = r#"{"nodes":[
      {"id":"t","type":"text","x":0,"y":0,"width":200,"height":100,"text":"vedi [[Altra Nota#Sez]] e #lavoro"},
      {"id":"f","type":"file","x":300,"y":0,"width":200,"height":100,"file":"allegati/foto.png"},
      {"id":"w","type":"link","x":600,"y":0,"width":200,"height":100,"url":"https://example.com/x"}
    ],"edges":[{"id":"e1","fromNode":"t","toNode":"f","toEnd":"arrow","label":"usa"}]}"#;
    let model = parse(source);
    assert_eq!(model.id, DocId::new("board.canvas"));
    // t: wikilink; f: path vault-relative; w: url mai arco ma presente.
    let kinds: Vec<&str> = model
        .links
        .iter()
        .map(|l| match &l.target {
            LinkTarget::Wiki { .. } => "wiki",
            LinkTarget::Path(_) => "path",
            LinkTarget::Url(_) => "url",
        })
        .collect();
    assert_eq!(kinds, vec!["wiki", "path", "url"]);
    assert!(matches!(&model.links[1].target, LinkTarget::Path(p) if p == "/allegati/foto.png"));
    assert!(
        model.links[1].embed,
        "le immagini sono embed come nel markdown"
    );
    assert_eq!(model.tags.len(), 1);
    assert_eq!(model.tags[0].name, "lavoro");
    assert!(!model.body.is_empty());
}

#[test]
fn corrupt_and_conflicting_sources_are_reported_not_guessed() {
    let provider = CanvasProvider::new();
    let ctx = ParseContext::obsidian("board.canvas");
    let bad_json = provider.parse(&DocumentSource::Text("{".into()), &ctx);
    assert!(matches!(bad_json, Err(FormatError::Parse(_))));
    let dup = r#"{"nodes":[
      {"id":"n","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a"},
      {"id":"n","type":"text","x":0,"y":0,"width":10,"height":10,"text":"b"}
    ],"edges":[]}"#;
    assert!(matches!(
        provider.parse(&DocumentSource::Text(dup.into()), &ctx),
        Err(FormatError::Parse(_))
    ));
    let dangling = r#"{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":10,"height":10,"text":"a"}],"edges":[{"id":"e","fromNode":"n","toNode":"missing"}]}"#;
    assert!(matches!(
        provider.parse(&DocumentSource::Text(dangling.into()), &ctx),
        Err(FormatError::Parse(_))
    ));
    let bytes = provider.parse(&DocumentSource::Bytes(vec![0xff]), &ctx);
    assert!(
        matches!(bytes, Err(FormatError::Unsupported { .. })),
        "un provider testuale non indovina l'encoding"
    );
}

#[test]
fn rename_file_reference_keeps_valid_json_and_unknown_fields() {
    let source = "{\"nodes\":[{\"id\":\"f\",\"type\":\"file\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"file\":\"vecchia/nota.png\",\"future\": [1, {\"k\": \"v\\\"q\"}]},{\"id\":\"t\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"text\":\"[[vecchia/nota]]\"}],\"edges\":[],\"xRoot\":true}";
    let model = parse(source);
    let file_link = model
        .links
        .iter()
        .find(|l| matches!(&l.target, LinkTarget::Path(_)))
        .unwrap();
    let edits = rewrite(
        source,
        &[LinkRewrite {
            span: file_link.span,
            target: file_link.target.clone(),
            replacement: "nuova/nota \"special\".png".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(edits.len(), 1);
    // L'edit copre il contenuto del literale; fuori di lui niente è cambiato.
    let before_literal: String = source[edits[0].span.start..edits[0].span.end].to_string();
    assert_eq!(before_literal, "vecchia/nota.png");
    let after = apply(source, &edits[0]);
    // JSON ancora valido, extra intatti, valore nuovo decodificato giusto.
    let canvas = parse_canvas(&after).unwrap();
    assert_eq!(
        canvas.nodes[0].file.as_deref(),
        Some("nuova/nota \"special\".png")
    );
    assert_eq!(
        canvas.nodes[0].extra["future"][1]["k"],
        serde_json::json!("v\"q")
    );
    assert_eq!(canvas.extra["xRoot"], serde_json::json!(true));
    // Il testo dell'altra card non è stato normalizzato: byte-identico fuori edit.
    assert!(after.contains("[[vecchia/nota]]"));
}

#[test]
fn rename_wiki_inside_text_card_preserves_alias_and_escapes() {
    let source = "{\"nodes\":[{\"id\":\"t\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"text\":\"vai a [[Vecchia#Sez|leggi]] poi\"}],\"edges\":[]}";
    let model = parse(source);
    let wiki = model
        .links
        .iter()
        .find(|l| matches!(&l.target, LinkTarget::Wiki { .. }))
        .unwrap();
    let edits = rewrite(
        source,
        &[LinkRewrite {
            span: wiki.span,
            target: wiki.target.clone(),
            replacement: "Nuova".to_string(),
        }],
    )
    .unwrap();
    let after = apply(source, &edits[0]);
    let canvas = parse_canvas(&after).unwrap();
    assert_eq!(
        canvas.nodes[0].text.as_deref(),
        Some("vai a [[Nuova#Sez|leggi]] poi"),
        "heading e alias invariati, solo la pagina riscritta"
    );
}

#[test]
fn rewrite_never_silently_skips_a_stale_target() {
    let source = "{\"nodes\":[{\"id\":\"f\",\"type\":\"file\",\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"file\":\"a.png\"}],\"edges\":[]}";
    let err = rewrite(
        source,
        &[LinkRewrite {
            span: Span::new(9999, 10005),
            target: LinkTarget::Path("a.png".to_string()),
            replacement: "b.png".to_string(),
        }],
    )
    .unwrap_err();
    assert!(matches!(err, FormatError::Parse(_)));
}

#[test]
fn identical_links_rewrite_only_the_spanned_occurrence() {
    let source = "{\"nodes\":[{\"id\":\"t\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"text\":\"[[Dup]] e [[Dup]]\"}],\"edges\":[]}";
    let model = parse(source);
    let dups: Vec<_> = model
        .links
        .iter()
        .filter(|l| matches!(&l.target, LinkTarget::Wiki { .. }))
        .collect();
    assert_eq!(dups.len(), 2, "due link identici = due span distinti");
    assert_ne!(dups[0].span, dups[1].span);
    let edits = rewrite(
        source,
        &[LinkRewrite {
            span: dups[1].span,
            target: dups[1].target.clone(),
            replacement: "Nuova".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(edits.len(), 1);
    // Solo i byte del secondo link: il primo resta identico.
    assert_eq!(&source[edits[0].span.start..edits[0].span.end], "Dup");
    let after = apply(source, &edits[0]);
    let canvas = parse_canvas(&after).unwrap();
    assert_eq!(canvas.nodes[0].text.as_deref(), Some("[[Dup]] e [[Nuova]]"));
}

#[test]
fn escape_and_unicode_before_and_inside_target_rewrite_exact_bytes() {
    // `\\n` (escape) prima del link e `\\u00e9` (6 byte grezzi = 2 decodificati)
    // dentro il nome: gli span devono mappare in byte grezzi esatti.
    let source = "{\"nodes\":[{\"id\":\"t\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"text\":\"riga\\n[[Caff\\u00e9]]\"}],\"edges\":[]}";
    let model = parse(source);
    let wiki = model
        .links
        .iter()
        .find(|l| matches!(&l.target, LinkTarget::Wiki { .. }))
        .expect("il markdown vede il link dopo escape e unicode");
    let edits = rewrite(
        source,
        &[LinkRewrite {
            span: wiki.span,
            target: wiki.target.clone(),
            replacement: "Nuova".to_string(),
        }],
    )
    .unwrap();
    let after = apply(source, &edits[0]);
    let canvas = parse_canvas(&after).unwrap();
    assert_eq!(
        canvas.nodes[0].text.as_deref(),
        Some("riga\n[[Nuova]]"),
        "solo l'interno riscritto, escape \\\\n preservato come byte"
    );
    assert!(
        after.contains("\\n[[Nuova]]"),
        "il resto del literale è byte-identico"
    );
}

#[test]
fn code_spans_never_become_links() {
    let source = "{\"nodes\":[{\"id\":\"t\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":200,\"height\":100,\"text\":\"`[[NonLink]]` e\\n\\n```\\n[[Nemmeno]]\\n```\\n\\nma [[Si]]\"}],\"edges\":[]}";
    let model = parse(source);
    let pages: Vec<String> = model
        .links
        .iter()
        .filter_map(|l| match &l.target {
            LinkTarget::Wiki { page, .. } => Some(page.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(
        pages,
        vec!["Si"],
        "codice fenced/inline non produce link: grammatica markdown reale"
    );
}

#[test]
fn portable_fixture_unicode_escape_maps_exact_spans() {
    let source = include_str!("fixtures/unicode_escape_unknown.canvas");
    let model = parse(source);
    let file = model
        .links
        .iter()
        .find(|l| matches!(&l.target, LinkTarget::Path(_)))
        .expect("file card con \\u0055 emette un Path");
    let raw: String = source[file.span.start..file.span.end].to_string();
    assert_eq!(
        raw, "allegati/\\u0055nicodé.png",
        "lo span punta ai byte con escape, non al decodificato"
    );
    let wiki = model
        .links
        .iter()
        .find(|l| matches!(&l.target, LinkTarget::Wiki { .. }))
        .expect("text card con escape emette un Wiki con grammatica markdown reale");
    let edits = rewrite(
        source,
        &[LinkRewrite {
            span: wiki.span,
            target: wiki.target.clone(),
            replacement: "Nuova".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(edits.len(), 1);
    let after = apply(source, &edits[0]);
    let canvas = parse_canvas(&after).unwrap();
    assert_eq!(canvas.nodes[0].extra["unknown"]["keep"], "value");
    assert_eq!(canvas.extra["unrecognizedRoot"][1]["preserve"], true);
    assert_eq!(
        after,
        source.replacen("Caff\\u00e9#Sezione|alias", "Nuova#Sezione|alias", 1),
        "tutti i byte fuori dal wikilink, inclusi unknown, Unicode ed escape, restano identici"
    );
    assert_eq!(
        canvas.nodes[1].text.as_deref(),
        Some("Riga uno\n[[Nuova#Sezione|alias]]")
    );
}

#[test]
fn extra_text_before_node_never_steals_its_literal() {
    // `extra.text` identico precede `nodes[0].text`: l'associazione è per
    // percorso, mai per primo contenuto uguale.
    let source = "{\"extra\":{\"text\":\"[[X]]\"},\"nodes\":[{\"id\":\"a\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"text\":\"[[X]]\"}],\"edges\":[]}";
    let model = parse(source);
    assert_eq!(model.links.len(), 1, "solo la card indicizza, mai l'extra");
    let wiki = &model.links[0];
    let extra_at: usize = source.find("\"extra\"").unwrap();
    assert!(
        wiki.span.start > extra_at,
        "lo span sta dentro nodes[0].text, non dentro extra"
    );
    let edits = rewrite(
        source,
        &[LinkRewrite {
            span: wiki.span,
            target: wiki.target.clone(),
            replacement: "Y".to_string(),
        }],
    )
    .unwrap();
    let after = apply(source, &edits[0]);
    assert!(
        after.contains("\"extra\":{\"text\":\"[[X]]\"}"),
        "l'extra resta byte-identico"
    );
    assert!(
        after.contains("\"text\":\"[[Y]]\""),
        "solo la card è riscritta"
    );
}

#[test]
fn edges_before_nodes_order_still_binds_paths() {
    // Ordine radice invertito: `edges` prima di `nodes`. Le label degli archi
    // si legano comunque per percorso edges[j].label.
    let source = "{\"edges\":[{\"id\":\"e\",\"fromNode\":\"a\",\"toNode\":\"a\",\"label\":\"#tagli\"}],\"nodes\":[{\"id\":\"a\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"text\":\"ok\"}]}";
    let model = parse(source);
    assert!(
        model.tags.iter().any(|t| t.name == "tagli"),
        "la label dell'arco indicizza anche con edges prima di nodes"
    );
}

#[test]
fn span_inside_extra_is_rejected_not_rewritten() {
    let source = "{\"extra\":{\"text\":\"[[X]]\"},\"nodes\":[{\"id\":\"a\",\"type\":\"text\",\"x\":0,\"y\":0,\"width\":10,\"height\":10,\"text\":\"ok\"}],\"edges\":[]}";
    let extra_start: usize = source.find("[[X]]").unwrap();
    let err = rewrite(
        source,
        &[LinkRewrite {
            span: Span::new(extra_start, extra_start + 5),
            target: LinkTarget::Wiki {
                page: "X".to_string(),
                heading: None,
                block: None,
            },
            replacement: "Y".to_string(),
        }],
    )
    .unwrap_err();
    assert!(
        matches!(err, FormatError::Parse(_)),
        "span in extra: errore, mai rewrite"
    );
}
