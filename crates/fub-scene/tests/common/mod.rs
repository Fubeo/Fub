//! Gli strumenti dei test d'integrazione: documenti di prova e il controllo
//! che una scena copre la sorgente senza perdere un byte.

// Ogni file di test usa una parte di questi strumenti.
#![allow(dead_code)]

use std::collections::HashMap;

use fub_scene::{
    read, Code, Diagnostic, ElementItem, ForeignItem, Item, ReadOnly, Role, Scene, Span, Tags,
};

/// La radice di un documento FubDraw di prova, con i tre namespace.
pub const HEAD: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" xmlns:xlink="http://www.w3.org/1999/xlink" fub:version="1" viewBox="0 0 100 100">"#;

/// I casi scritti a mano di poligoni e stelle, che valgono anche per la
/// superficie: `apps/client/src/__fixtures__/scene-shapes/cases.json`.
pub fn shape_cases() -> serde_json::Value {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/scene-shapes/cases.json");
    let text = std::fs::read_to_string(&path).expect("i casi di poligoni e stelle");
    serde_json::from_str(&text).expect("JSON dei casi")
}

/// `value` coi numeri tutti in virgola mobile: `4` e `4.0` del JSON si
/// confrontano uguali.
pub fn as_floats(value: serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Number(n) => n
            .as_f64()
            .and_then(serde_json::Number::from_f64)
            .map_or(Value::Number(n), Value::Number),
        Value::Array(items) => Value::Array(items.into_iter().map(as_floats).collect()),
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(k, v)| (k, as_floats(v))).collect())
        }
        other => other,
    }
}

/// Un documento FubDraw con `body` dentro la radice.
pub fn doc(body: &str) -> String {
    format!("{HEAD}{body}</svg>")
}

/// Legge `source`, che deve essere una scena, e verifica che le voci la
/// coprano senza perdite.
pub fn load(source: &str) -> Scene {
    let scene = read(source).unwrap_or_else(|e| panic!("{e}\n{source}"));
    check_lossless(source, &scene);
    scene
}

/// La diagnostica tranne S001: i documenti di prova non hanno un titolo, se
/// il test non riguarda proprio il titolo.
pub fn findings(scene: &Scene) -> Vec<&Diagnostic> {
    scene
        .diagnostics
        .iter()
        .filter(|d| d.code != Code::S001)
        .collect()
}

/// Le voci modificabili.
pub fn elements(scene: &Scene) -> Vec<&ElementItem> {
    scene
        .items
        .iter()
        .filter_map(|item| match item {
            Item::Element(element) => Some(element.as_ref()),
            _ => None,
        })
        .collect()
}

/// I blocchi estranei.
pub fn foreign(scene: &Scene) -> Vec<&ForeignItem> {
    scene
        .items
        .iter()
        .filter_map(|item| match item {
            Item::Foreign(block) => Some(block),
            _ => None,
        })
        .collect()
}

/// La voce modificabile al percorso `path`.
pub fn at<'s>(scene: &'s Scene, path: &[usize]) -> Option<&'s ElementItem> {
    elements(scene).into_iter().find(|e| e.path == path)
}

/// Il ruolo dell'elemento al percorso `path`, o `None` se è estraneo. Fallisce
/// se a quel percorso non c'è niente.
pub fn role(scene: &Scene, path: &[usize]) -> Option<Role> {
    if let Some(element) = at(scene, path) {
        return Some(element.role);
    }
    let (index, parent) = path.split_last().expect("un percorso non vuoto");
    let covered = foreign(scene).iter().any(|block| {
        block.parent_path.as_deref() == Some(parent)
            && (block.elements[0]..block.elements[1]).contains(index)
    });
    assert!(covered, "nessun elemento al percorso {path:?}");
    None
}

/// Il ruolo del primo figlio della radice di `doc(body)`.
pub fn first(body: &str) -> Option<Role> {
    role(&load(&doc(body)), &[0])
}

/// Il testo di uno span.
pub fn text<'a>(source: &'a str, span: &Span) -> &'a str {
    &source[span.bytes[0]..span.bytes[1]]
}

/// Che cosa una voce occupa fra i figli elemento del suo contenitore.
enum Indices {
    One(usize),
    Range([usize; 2]),
}

/// Verifica che ogni contenitore, il documento compreso, sia coperto dalle
/// voci dei suoi figli e da spazi soltanto; che gli indici degli elementi
/// siano contigui e contino davvero gli elementi della sorgente; che gli span
/// UTF-16 siano quelli del testo normalizzato a LF.
pub fn check_lossless(source: &str, scene: &Scene) {
    if scene.truncated || scene.read_only.contains(&ReadOnly::TooManyElements) {
        assert!(scene.items.is_empty());
        return;
    }
    let utf16 = utf16_prefix(source);
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(source.match_indices(['\n', '\r']).map(|(i, _)| i + 1))
        .collect();
    let check_span = |span: &Span| {
        assert!(span.bytes[0] <= span.bytes[1], "{span:?}");
        assert_eq!(
            span.utf16,
            [utf16[span.bytes[0]], utf16[span.bytes[1]]],
            "UTF-16 di {:?}",
            text(source, span)
        );
    };
    let bom = if source.starts_with('\u{feff}') { 3 } else { 0 };
    let mut containers: HashMap<Option<Vec<usize>>, (usize, usize)> = HashMap::new();
    let mut children: HashMap<Option<Vec<usize>>, Vec<(Span, Indices)>> = HashMap::new();
    containers.insert(None, (bom, source.len()));
    let mut content = |path: Vec<usize>, tags: &Tags, span: &Span| {
        check_span(&tags.open);
        assert_eq!(tags.open.bytes[0], span.bytes[0]);
        match tags.close {
            Some(close) => {
                check_span(&close);
                assert!(text(source, &tags.open).ends_with('>'));
                assert!(text(source, &close).starts_with("</"));
                assert_eq!(close.bytes[1], span.bytes[1]);
                containers.insert(Some(path), (tags.open.bytes[1], close.bytes[0]));
            }
            None => {
                assert_eq!(tags.open, *span);
                assert!(text(source, span).ends_with("/>"));
            }
        }
    };
    for item in &scene.items {
        match item {
            Item::Root(root) => {
                check_span(&root.span);
                content(Vec::new(), &root.tags, &root.span);
                children
                    .entry(None)
                    .or_default()
                    .push((root.span, Indices::One(0)));
            }
            Item::Element(element) => {
                check_span(&element.span);
                let item_text = text(source, &element.span);
                assert!(
                    item_text.starts_with('<') && item_text.ends_with('>'),
                    "{item_text}"
                );
                let start = element.span.bytes[0];
                let line =
                    &source[line_starts[line_starts.partition_point(|&s| s <= start) - 1]..start];
                assert!(line
                    .trim_start_matches('\u{feff}')
                    .starts_with(&element.indent));
                if let Some(tags) = &element.tags {
                    content(element.path.clone(), tags, &element.span);
                }
                let (index, parent) = element.path.split_last().expect("un percorso");
                children
                    .entry(Some(parent.to_vec()))
                    .or_default()
                    .push((element.span, Indices::One(*index)));
            }
            Item::Foreign(block) => {
                check_span(&block.span);
                let block_text = text(source, &block.span);
                assert!(!block_text.trim_matches(is_space).is_empty());
                assert_eq!(
                    block_text.trim_matches(is_space),
                    block_text,
                    "{block_text}"
                );
                children
                    .entry(block.parent_path.clone())
                    .or_default()
                    .push((block.span, Indices::Range(block.elements)));
            }
        }
    }
    for parent in children.keys() {
        assert!(
            containers.contains_key(parent),
            "{parent:?} non è un contenitore"
        );
    }
    for (parent, (start, end)) in &containers {
        let mut cursor = *start;
        let mut next = 0;
        for (span, indices) in children.get(parent).map(Vec::as_slice).unwrap_or_default() {
            assert!(span.bytes[0] >= cursor, "voci sovrapposte in {parent:?}");
            let gap = &source[cursor..span.bytes[0]];
            assert!(
                gap.chars().all(is_space),
                "byte di nessuno in {parent:?}: {gap:?}"
            );
            cursor = span.bytes[1];
            match indices {
                Indices::One(index) => {
                    assert_eq!(*index, next, "indici in {parent:?}");
                    next += 1;
                }
                Indices::Range([from, to]) => {
                    assert_eq!(*from, next, "indici in {parent:?}");
                    assert_eq!(to - from, count_elements(text(source, span)));
                    next = *to;
                }
            }
        }
        assert!(cursor <= *end);
        let gap = &source[cursor..*end];
        assert!(
            gap.chars().all(is_space),
            "byte di nessuno in {parent:?}: {gap:?}"
        );
        assert_eq!(
            next,
            count_elements(&source[*start..*end]),
            "elementi di {parent:?}"
        );
    }

    // Gli span dell'indice e della diagnostica, nelle due coordinate.
    let index = &scene.index;
    let excerpts = index.title.iter().chain(&index.desc).chain(&index.texts);
    for excerpt in excerpts {
        check_span(&excerpt.span);
        assert!(text(source, &excerpt.span).starts_with('<'));
    }
    for reference in index.links.iter().chain(&index.embeds) {
        check_span(&reference.span);
        check_span(&reference.href);
        let element = reference.span.bytes;
        assert!(element[0] < reference.href.bytes[0] && reference.href.bytes[1] < element[1]);
    }
    for diagnostic in &scene.diagnostics {
        if let Some(span) = &diagnostic.span {
            check_span(span);
        }
    }
}

/// Gli spazi di XML.
pub fn is_space(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\r' | '\n')
}

/// L'offset UTF-16 di ogni byte di `source` nel testo normalizzato a LF: il
/// BOM conta, un `\r` prima di `\n` no.
pub fn utf16_prefix(source: &str) -> Vec<usize> {
    let mut out = vec![usize::MAX; source.len() + 1];
    let mut units = 0;
    for (i, c) in source.char_indices() {
        out[i] = units;
        if !(c == '\r' && source[i + 1..].starts_with('\n')) {
            units += c.len_utf16();
        }
    }
    out[source.len()] = units;
    out
}

/// Quanti elementi stanno al primo livello di un frammento ben formato:
/// un contatore indipendente dal parser del crate.
pub fn count_elements(fragment: &str) -> usize {
    let bytes = fragment.as_bytes();
    let (mut i, mut depth, mut count) = (0, 0usize, 0);
    let skip = |i: usize, end: &str| i + fragment[i..].find(end).expect("chiuso") + end.len();
    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &fragment[i..];
        if rest.starts_with("<!--") {
            i = skip(i, "-->");
        } else if rest.starts_with("<![CDATA[") {
            i = skip(i, "]]>");
        } else if rest.starts_with("<?") {
            i = skip(i, "?>");
        } else if rest.starts_with("<!") {
            i = skip_markup(bytes, i);
        } else if rest.starts_with("</") {
            depth -= 1;
            i = skip(i, ">");
        } else {
            let end = skip_markup(bytes, i);
            if depth == 0 {
                count += 1;
            }
            if bytes[end - 2] != b'/' {
                depth += 1;
            }
            i = end;
        }
    }
    count
}

/// Il byte dopo il `>` che chiude il markup che comincia a `start`, saltando
/// i valori fra virgolette e le parentesi quadre di un `DOCTYPE`.
fn skip_markup(bytes: &[u8], start: usize) -> usize {
    let (mut quote, mut brackets) = (None, 0);
    for (i, &b) in bytes.iter().enumerate().skip(start + 1) {
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None => match b {
                b'"' | b'\'' => quote = Some(b),
                b'[' => brackets += 1,
                b']' => brackets -= 1,
                b'>' if brackets == 0 => return i + 1,
                _ => {}
            },
        }
    }
    panic!("markup non chiuso al byte {start}")
}
