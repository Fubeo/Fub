//! **Il banco del corpus.** Ogni file di `tests/corpus/` passa dall'apertura,
//! dalle esportazioni e dalle modifiche standard della shell (E0–E7); l'esito
//! si confronta con `tests/corpus/expected/<file>.json`.
//!
//! I risultati attesi committati sono il comportamento del motore di oggi: in
//! una PR che aggiorna il motore si rigenerano con
//!
//! ```text
//! UPDATE_CORPUS=1 cargo test -p fub-format-rich --test corpus
//! ```
//!
//! e il diff di `expected/` dice che cosa è cambiato, file per file. Chi rivede
//! la PR spiega ogni riga. I risultati restano piccoli e semantici: impronte e
//! riassunti, non byte interi, e niente tempi (quelli stanno nel test
//! `tempi`, con `--ignored`).

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use fub_abi::transfer::{ExportProvider, ExportRequest, ExportSelection, MemorySink, NoteLevel};
use fub_abi::{DocId, DocumentFormat, DocumentSource, FormatProvider, ParseContext};
use fub_format_rich::export::{RichExport, Target};
use fub_format_rich::projection::{
    Anchor, AtomKind, Block, CommentView, Inline, Layout, Look, Para, Projection, Role,
};
use fub_format_rich::{open, save, Codec, RichError, RichProvider, Saved};
use fub_sdk::testing::MemoryHost;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus")
}

/// Una voce del `MANIFEST.toml`.
#[derive(Debug)]
struct Entry {
    path: String,
    fields: BTreeMap<String, String>,
}

/// Il manifesto, in un sottoinsieme di TOML che basta qui: tabelle
/// `[[file]]` con chiavi e stringhe fra virgolette su una riga.
fn manifest() -> Vec<Entry> {
    let text = std::fs::read_to_string(corpus().join("MANIFEST.toml")).unwrap();
    let mut out: Vec<Entry> = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line == "[[file]]" {
            out.push(Entry {
                path: String::new(),
                fields: BTreeMap::new(),
            });
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .unwrap_or_else(|| panic!("MANIFEST.toml:{}: manca `=`", n + 1));
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .unwrap_or_else(|| panic!("MANIFEST.toml:{}: una stringa fra virgolette", n + 1));
        assert!(
            !value.contains('"') && !value.contains('\\'),
            "MANIFEST.toml:{}",
            n + 1
        );
        let entry = out
            .last_mut()
            .unwrap_or_else(|| panic!("MANIFEST.toml:{}: fuori da [[file]]", n + 1));
        let key = key.trim().to_string();
        if key == "path" {
            entry.path = value.to_string();
        }
        entry.fields.insert(key, value.to_string());
    }
    out
}

/// L'esito dell'apertura in una riga, come lo scrive `atteso` nel
/// manifesto: `modificabile`, `solo il corpo` (con `body_only`), seguiti da
/// `, blocchi chiusi: <indici>` se ce ne sono; `sola lettura: <ragione>`;
/// `errore: <specie>`.
fn esito(codec: Codec, bytes: &[u8]) -> String {
    let opened = match open(codec, bytes) {
        Ok(opened) => opened,
        Err(error) => return format!("errore: {}", error_of(&error)["error"].as_str().unwrap()),
    };
    if let Some(reason) = opened.readonly {
        return format!(
            "sola lettura: {}",
            readonly_of(Some(reason)).as_str().unwrap()
        );
    }
    let projection: Value = serde_json::from_str(&opened.projection).unwrap();
    let mut out = match projection["body_only"].as_bool() == Some(true) {
        true => "solo il corpo".to_string(),
        false => "modificabile".to_string(),
    };
    let locked: Vec<String> = projection["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .filter(|(_, block)| block["locked"].as_bool() == Some(true))
        .map(|(at, _)| at.to_string())
        .collect();
    if !locked.is_empty() {
        out.push_str(&format!(", blocchi chiusi: {}", locked.join(" ")));
    }
    out
}

const REQUIRED: [&str; 7] = [
    "path",
    "origine",
    "programma",
    "licenza",
    "esercita",
    "atteso",
    "matrice",
];

fn codec_of(path: &str) -> Codec {
    let ext = path.rsplit('.').next().unwrap();
    Codec::ALL
        .into_iter()
        .find(|codec| {
            RichProvider::new(*codec)
                .descriptor()
                .extensions
                .iter()
                .any(|e| e == ext)
        })
        .unwrap_or_else(|| panic!("nessun codec per {path}"))
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn error_of(error: &RichError) -> Value {
    let kind = match error {
        RichError::Codec(_) => "codec",
        RichError::Encrypted => "encrypted",
        RichError::TooLarge(_) => "too_large",
        RichError::NoWriter(_) => "no_writer",
        RichError::ReadOnly(_) => "readonly",
        RichError::Fidelity => "fidelity",
        RichError::Locked(_) => "locked",
        _ => "other",
    };
    json!({ "error": kind, "message": error.to_string() })
}

fn readonly_of(readonly: Option<fub_format_rich::ReadOnly>) -> Value {
    serde_json::to_value(readonly).unwrap()
}

/// La proiezione senza ciò che una rilettura rinumera o risolve: i dati
/// opachi (`k`, e `sect` per la fine di una sezione) portano i numeri delle parti e gli id che il codec dà agli
/// oggetti nuovi; l'aspetto del carattere (`f`), lo stile di corpo (`s`), la
/// lingua e la galleria degli stili sono suggerimenti di resa che il codec
/// risolve per un paragrafo nuovo. Restano testo, ruoli, enfasi, link,
/// allineamento, disposizione, oggetti, commenti e revisioni.
fn visible(projection: &Projection) -> Value {
    fn strip(value: &mut Value) {
        match value {
            Value::Object(map) => {
                for key in ["k", "sect", "readonly", "f", "s", "lang", "styles"] {
                    map.remove(key);
                }
                map.values_mut().for_each(strip);
            }
            Value::Array(items) => items.iter_mut().for_each(strip),
            _ => {}
        }
    }
    let mut value = serde_json::to_value(projection).unwrap();
    strip(&mut value);
    value
}

/// Il riassunto del modello che vede l'indice.
fn model(codec: Codec, bytes: &[u8]) -> Value {
    let provider = RichProvider::new(codec);
    match provider.parse(
        &DocumentSource::Bytes(bytes.to_vec()),
        &ParseContext::default(),
    ) {
        Ok(model) => json!({
            "outline": model
                .outline
                .iter()
                .map(|h| format!("{} {}", h.level, h.text))
                .collect::<Vec<_>>(),
            "links": model.links.iter().map(|l| format!("{:?}", l.target)).collect::<Vec<_>>(),
            "text": sha256(model.text.as_bytes()),
            "words": model.text.split_whitespace().count(),
        }),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

/// Per ogni esportazione, gli avvisi su ciò che la copia non porta.
fn exports(path: &str, bytes: &[u8]) -> Value {
    let mut host = MemoryHost::new();
    for codec in Codec::ALL {
        let provider = RichProvider::new(codec);
        let descriptor = provider.descriptor();
        for ext in &descriptor.extensions {
            host = host.with_format(
                ext,
                DocumentFormat {
                    descriptor: descriptor.clone(),
                    capabilities: provider.capabilities(),
                },
            );
        }
    }
    let name = path.rsplit('/').next().unwrap();
    let host = host.with_binary_document(name, bytes);
    let mut out = serde_json::Map::new();
    for target in Target::ALL {
        let request = ExportRequest::new(
            target.id(),
            ExportSelection::Documents(vec![DocId::new(name)]),
        );
        let value = match RichExport.export(&request, &host, &mut MemorySink::default()) {
            Ok(report) => Value::from(
                report
                    .log
                    .iter()
                    .filter(|note| note.level == NoteLevel::Warning)
                    .map(|note| note.message.clone())
                    .collect::<Vec<_>>(),
            ),
            Err(error) => json!({ "error": error.to_string() }),
        };
        out.insert(target.key().to_string(), value);
    }
    Value::Object(out)
}

fn text_inline(x: &str) -> Inline {
    Inline::Text {
        x: x.to_string(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
        ins: None,
        del: None,
    }
}

fn marker(id: u32, end: bool) -> Inline {
    Inline::Atom {
        k: None,
        kind: AtomKind::Marker,
        label: String::new(),
        w: None,
        h: None,
        data: None,
        note: None,
        end: false,
        toc: None,
        comment: Some(Anchor { id, end }),
        ins: None,
        del: None,
    }
}

/// Il primo paragrafo del corpo con un testo di almeno due caratteri, e
/// l'indice di quel testo.
/// Il primo tratto di testo di un paragrafo del corpo, aperto (`locked`
/// falso) o chiuso: la shell modifica soltanto i primi.
fn first_text(projection: &mut Projection, locked: bool) -> Option<(usize, usize)> {
    projection.blocks.iter().enumerate().find_map(|(b, block)| {
        let Block::Para(para) = block else {
            return None;
        };
        if para.locked != locked {
            return None;
        }
        para.c
            .iter()
            .position(|inline| match inline {
                Inline::Text { x, del, .. } => del.is_none() && x.trim().chars().count() >= 2,
                Inline::Atom { .. } => false,
            })
            .map(|i| (b, i))
    })
}

fn text_mut(projection: &mut Projection, b: usize, i: usize) -> &mut String {
    let Block::Para(para) = &mut projection.blocks[b] else {
        unreachable!()
    };
    let Inline::Text { x, .. } = &mut para.c[i] else {
        unreachable!()
    };
    x
}

/// Le modifiche standard, come le farebbe la shell. `None` quando il
/// documento non ha ciò che la modifica tocca.
fn edit(name: &str, original: &Projection) -> Option<Projection> {
    let mut p = original.clone();
    match name {
        "E0" => {}
        "E1" => {
            let (b, i) = first_text(&mut p, false)?;
            let x = text_mut(&mut p, b, i);
            let start = x.len() - x.trim_start().len();
            let end = x[start..]
                .find(char::is_whitespace)
                .map_or(x.len(), |e| start + e);
            x.replace_range(start..end, "Cambiato");
        }
        "E2" => {
            let (b, i) = first_text(&mut p, false)?;
            let Block::Para(para) = &p.blocks[b] else {
                unreachable!()
            };
            let mut first = para.clone();
            let mut second = para.clone();
            let Inline::Text { x, .. } = &para.c[i] else {
                unreachable!()
            };
            let mid = x
                .char_indices()
                .nth(x.chars().count() / 2)
                .map(|(at, _)| at)
                .unwrap();
            first.c.truncate(i + 1);
            *match &mut first.c[i] {
                Inline::Text { x, .. } => x,
                Inline::Atom { .. } => unreachable!(),
            } = x[..mid].to_string();
            second.c.drain(..i);
            *match &mut second.c[0] {
                Inline::Text { x, .. } => x,
                Inline::Atom { .. } => unreachable!(),
            } = x[mid..].to_string();
            // La fine di una sezione resta al paragrafo che chiude il testo.
            first.sect = None;
            first.page = None;
            first.header = None;
            first.footer = None;
            p.blocks
                .splice(b..=b, [Block::Para(first), Block::Para(second)]);
        }
        "E3" => p.blocks.push(Block::Para(Para {
            role: Role::Body,
            locked: false,
            align: None,
            k: None,
            sect: None,
            page: None,
            header: None,
            footer: None,
            p: Layout::default(),
            s: None,
            f: Box::default(),
            ins: None,
            del: None,
            c: vec![text_inline("Un paragrafo aggiunto in fondo.")],
        })),
        "E4" => {
            let (b, i) = first_text(&mut p, false)?;
            let id = p.comments.iter().map(|c| c.id).max().map_or(1, |m| m + 1);
            let Block::Para(para) = &mut p.blocks[b] else {
                unreachable!()
            };
            let Inline::Text { x, .. } = &para.c[i] else {
                unreachable!()
            };
            let start = x.len() - x.trim_start().len();
            let end = x[start..]
                .find(char::is_whitespace)
                .map_or(x.len(), |e| start + e);
            let (before, word, after) = (
                x[..start].to_string(),
                x[start..end].to_string(),
                x[end..].to_string(),
            );
            let piece = |text: String| {
                let mut inline = para.c[i].clone();
                if let Inline::Text { x, .. } = &mut inline {
                    *x = text;
                }
                inline
            };
            let mut replaced = Vec::new();
            if !before.is_empty() {
                replaced.push(piece(before));
            }
            replaced.push(marker(id, false));
            replaced.push(piece(word));
            replaced.push(marker(id, true));
            if !after.is_empty() {
                replaced.push(piece(after));
            }
            para.c.splice(i..=i, replaced);
            p.comments.push(CommentView {
                id,
                k: None,
                by: "Banco del corpus".into(),
                at: "2026-10-21T12:00:00Z".into(),
                parent: None,
                done: false,
                text: "Un commento del banco.".into(),
            });
        }
        "E5" => {
            let table = p.blocks.iter_mut().find_map(|block| match block {
                Block::Table(table) if table.rows.len() > 1 => Some(table),
                _ => None,
            })?;
            table.rows.pop();
        }
        // Scrivere nell'ultimo paragrafo del corpo: dopo una tabella finale è
        // il paragrafo vuoto che il modello aggiunge.
        "E7" => {
            let para = p.blocks.iter_mut().rev().find_map(|block| match block {
                Block::Para(para) if !para.locked => Some(para),
                _ => None,
            })?;
            para.c.push(text_inline(" In fondo."));
        }
        // Ciò che la shell non fa: cambiare un blocco chiuso.
        "E6" => {
            let (b, i) = first_text(&mut p, true)?;
            text_mut(&mut p, b, i).push_str(" cambiato");
        }
        _ => unreachable!(),
    }
    Some(p)
}

const EDITS: [&str; 8] = ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"];

/// Salva una modifica, riapre i byte e confronta la proiezione riaperta con
/// quella voluta, a meno dei dati opachi.
fn run_edit(codec: Codec, bytes: &[u8], wanted: &Projection) -> Value {
    let json = wanted.to_json().unwrap();
    match save(codec, bytes, &json) {
        Ok(Saved::Unchanged) => json!("unchanged"),
        Ok(Saved::Bytes(out)) => match open(codec, &out) {
            Ok(reopened) => {
                let reopened = Projection::from_json(&reopened.projection).unwrap();
                let same = visible(&reopened) == visible(wanted);
                json!({
                    "saved": true,
                    "readonly": readonly_of(reopened.readonly),
                    "reopened": if same { "same" } else { "different" },
                })
            }
            Err(error) => json!({ "saved": true, "reopen": error_of(&error) }),
        },
        Err(error) => error_of(&error),
    }
}

fn outcome(entry: &Entry, bytes: &[u8]) -> Value {
    let codec = codec_of(&entry.path);
    let mut out = serde_json::Map::new();
    out.insert("file".into(), json!(entry.path));
    out.insert("sha256".into(), json!(sha256(bytes)));
    match open(codec, bytes) {
        Err(error) => {
            out.insert("open".into(), error_of(&error));
        }
        Ok(opened) => {
            let projection = Projection::from_json(&opened.projection).unwrap();
            out.insert(
                "open".into(),
                json!({
                    "readonly": readonly_of(opened.readonly),
                    "projection": sha256(opened.projection.as_bytes()),
                    "blocks": projection.blocks.len(),
                    "comments": projection.comments.len(),
                }),
            );
            if codec == Codec::Docx {
                let report = fub_format_rich::preservation::report(bytes)
                    .unwrap_or_else(|error| format!("{error}"));
                out.insert(
                    "preservation".into(),
                    Value::from(report.lines().map(str::to_string).collect::<Vec<_>>()),
                );
            }
            out.insert("model".into(), model(codec, bytes));
            out.insert("export".into(), exports(&entry.path, bytes));
            let mut edits = serde_json::Map::new();
            for name in EDITS {
                let value = match (opened.readonly, edit(name, &projection)) {
                    (Some(_), _) => json!("readonly"),
                    (None, None) => json!("n/a"),
                    (None, Some(wanted)) => run_edit(codec, bytes, &wanted),
                };
                edits.insert(name.into(), value);
            }
            out.insert("edits".into(), Value::Object(edits));
        }
    }
    Value::Object(out)
}

fn expected_path(entry: &Entry) -> PathBuf {
    corpus()
        .join("expected")
        .join(format!("{}.json", entry.path))
}

#[test]
fn il_manifesto_descrive_ogni_file_e_nient_altro() {
    let entries = manifest();
    let mut listed: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
    for entry in &entries {
        for key in REQUIRED {
            assert!(
                entry.fields.get(key).is_some_and(|v| !v.is_empty()),
                "{}: manca `{key}`",
                entry.path
            );
        }
        let licence = &entry.fields["licenza"];
        assert!(
            licence == "CC0-1.0" || licence == "MIT OR Apache-2.0",
            "{}: licenza {licence}",
            entry.path
        );
    }
    let mut found = Vec::new();
    for dir in ["docx", "odt", "rtf", "doc"] {
        for file in std::fs::read_dir(corpus().join(dir)).unwrap() {
            let file = file.unwrap();
            let size = file.metadata().unwrap().len();
            let name = format!("{dir}/{}", file.file_name().to_string_lossy());
            assert!(size <= 256 * 1024, "{name}: {size} byte oltre i 256 KB");
            found.push(name);
        }
    }
    listed.sort();
    found.sort();
    assert_eq!(
        listed, found,
        "il manifesto e le cartelle devono coincidere"
    );
    let total: u64 = found
        .iter()
        .map(|name| std::fs::metadata(corpus().join(name)).unwrap().len())
        .sum();
    assert!(total <= 15 * 1024 * 1024, "corpus di {total} byte");
}

/// L'esito che il manifesto dichiara è quello dell'apertura: chi cambia il
/// motore o la misura e cambia un esito lo vede qui, con la ragione
/// (`perché`) da riscrivere. Ogni esito che non è `modificabile` dice perché.
#[test]
fn l_esito_dichiarato_è_quello_dell_apertura() {
    let mut failures = Vec::new();
    for entry in manifest() {
        let bytes = std::fs::read(corpus().join(&entry.path)).unwrap();
        let got = esito(codec_of(&entry.path), &bytes);
        let wanted = &entry.fields["atteso"];
        if &got != wanted {
            failures.push(format!("{}: atteso «{wanted}», aperto «{got}»", entry.path));
        }
        if got != "modificabile" && !entry.fields.contains_key("perché") {
            failures.push(format!("{}: «{got}» senza `perché`", entry.path));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn il_corpus_dà_gli_esiti_attesi() {
    let update = std::env::var_os("UPDATE_CORPUS").is_some();
    let mut failures = Vec::new();
    for entry in manifest() {
        let bytes = std::fs::read(corpus().join(&entry.path)).unwrap();
        let got = outcome(&entry, &bytes);
        let text = serde_json::to_string_pretty(&got).unwrap() + "\n";
        let path = expected_path(&entry);
        if update {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &text).unwrap();
            continue;
        }
        let Ok(wanted) = std::fs::read_to_string(&path) else {
            failures.push(format!("{}: manca {}", entry.path, path.display()));
            continue;
        };
        if wanted != text {
            failures.push(format!(
                "{}: l'esito è cambiato\n{}",
                entry.path,
                diff(&wanted, &text)
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{}\n\nSe il cambiamento è voluto: UPDATE_CORPUS=1 cargo test -p fub-format-rich --test corpus",
        failures.join("\n\n")
    );
}

/// Le righe che cambiano, con il segno: basta per un esito di poche decine
/// di righe.
fn diff(before: &str, after: &str) -> String {
    let (a, b): (Vec<&str>, Vec<&str>) = (before.lines().collect(), after.lines().collect());
    let mut out = String::new();
    let (mut i, mut j) = (0, 0);
    while i < a.len() || j < b.len() {
        if i < a.len() && j < b.len() && a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        // Una riga tolta se ricompare più avanti nell'altro lato, altrimenti
        // una sostituzione.
        if i < a.len() && !b[j..].contains(&a[i]) {
            out.push_str(&format!("- {}\n", a[i]));
            i += 1;
        } else if j < b.len() {
            out.push_str(&format!("+ {}\n", b[j]));
            j += 1;
        } else {
            out.push_str(&format!("- {}\n", a[i]));
            i += 1;
        }
    }
    out
}

/// Un generatore congruenziale con un seme fisso: le mutazioni sono le stesse
/// a ogni esecuzione.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

/// Mutazioni deterministiche di ogni file: troncamenti in punti fissi, byte
/// cambiati e, in un pacchetto, mutazioni dentro l'XML ([`xml_mutants`]).
/// `open` dà un esito o un errore, senza panic, entro un tempo, e un
/// documento che si apre si salva o si rifiuta. `CORPUS_MUTATIONS=<n>` fa `n`
/// giri di ciascuna mutazione invece di 8, per la prova lunga di un
/// aggiornamento del motore.
#[test]
fn le_mutazioni_non_fanno_panic() {
    const LIMIT: Duration = Duration::from_secs(20);
    let rounds: u32 = std::env::var("CORPUS_MUTATIONS")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(8);
    let mut failures = Vec::new();
    let mut xml_opened = 0;
    for entry in manifest() {
        let codec = codec_of(&entry.path);
        let bytes = std::fs::read(corpus().join(&entry.path)).unwrap();
        let mut rng = Lcg(u64::from_str_radix(&sha256(entry.path.as_bytes())[..16], 16).unwrap());
        let mut mutants: Vec<(String, Vec<u8>)> = Vec::new();
        for cut in [1, 2, 3, 5, 8] {
            let at = bytes.len() * cut / 10;
            mutants.push((format!("troncato a {at}"), bytes[..at].to_vec()));
        }
        for n in 0..rounds {
            let mut changed = bytes.clone();
            for _ in 0..=n % 8 {
                let at = rng.next() as usize % changed.len();
                changed[at] ^= (rng.next() as u8) | 1;
            }
            mutants.push((format!("{} byte cambiati, giro {n}", n + 1), changed));
        }
        let xml = xml_mutants(&bytes, &mut rng, rounds);
        let all = mutants
            .into_iter()
            .map(|mutant| (mutant, false))
            .chain(xml.into_iter().map(|mutant| (mutant, true)));
        for ((what, mutant), in_xml) in all {
            let start = Instant::now();
            let result = std::panic::catch_unwind(|| {
                let opened = open(codec, &mutant).ok();
                if let Some(opened) = &opened {
                    // Un documento che si apre si salva anche, o lo rifiuta.
                    let _ = save(codec, &mutant, &opened.projection);
                }
                opened.is_some()
            });
            let took = start.elapsed();
            match result {
                Err(_) => failures.push(format!("{}: panic con {what}", entry.path)),
                Ok(_) if took > LIMIT => {
                    failures.push(format!("{}: {took:?} con {what}", entry.path))
                }
                Ok(opened) => xml_opened += usize::from(opened && in_xml),
            }
        }
    }
    // Le mutazioni dentro l'XML arrivano al modello: qualcuna si apre.
    assert!(xml_opened > 0, "nessuna mutazione dell'XML si apre");
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Le immagini di `blocks`, in profondità: le celle comprese.
fn images(blocks: &mut [Block]) -> Vec<&mut Inline> {
    let mut out = Vec::new();
    for block in blocks {
        match block {
            Block::Para(para) => out.extend(para.c.iter_mut().filter(|inline| {
                matches!(
                    inline,
                    Inline::Atom {
                        kind: AtomKind::Image,
                        k: Some(_),
                        ..
                    }
                )
            })),
            Block::Table(table) => {
                for cell in table.rows.iter_mut().flat_map(|row| &mut row.cells) {
                    out.extend(images(&mut cell.blocks));
                }
            }
        }
    }
    out
}

/// Valori di attributo che un lettore non si aspetta.
const STRANGE: &[&str] = &[
    "",
    "-1",
    "0",
    "4294967296",
    "99999999999999999999999",
    "NaN",
    "1e308",
    "x",
    "auto",
    "💥",
];

/// Mutazioni dentro l'XML di un pacchetto. Un byte cambiato di solito rompe
/// lo ZIP e si ferma lì; queste arrivano al lettore e al modello. Ogni giro
/// cambia una parte XML (la principale un giro su due): un valore di
/// attributo strano, un tag tolto, ripetuto, rinominato o spostato, un
/// elemento sconosciuto.
fn xml_mutants(bytes: &[u8], rng: &mut Lcg, rounds: u32) -> Vec<(String, Vec<u8>)> {
    let Ok(mut archive) = zip::ZipArchive::new(Cursor::new(bytes)) else {
        return Vec::new();
    };
    let mut parts = Vec::new();
    for i in 0..archive.len() {
        let Ok(mut file) = archive.by_index(i) else {
            return Vec::new();
        };
        let Ok(name) = file.name().map(|name| name.to_string()) else {
            return Vec::new();
        };
        let mut data = Vec::new();
        if file.read_to_end(&mut data).is_err() {
            return Vec::new();
        }
        parts.push((name, data));
    }
    let xml: Vec<usize> = (0..parts.len())
        .filter(|&i| {
            let (name, data) = &parts[i];
            (name.ends_with(".xml") || name.ends_with(".rels")) && std::str::from_utf8(data).is_ok()
        })
        .collect();
    let main = xml
        .iter()
        .copied()
        .find(|&i| parts[i].0 == "word/document.xml" || parts[i].0 == "content.xml");
    let mut out = Vec::new();
    for n in 0..rounds {
        let at = match main {
            Some(main) if n % 2 == 0 => main,
            _ if xml.is_empty() => break,
            _ => xml[rng.next() as usize % xml.len()],
        };
        let text = std::str::from_utf8(&parts[at].1).unwrap();
        let tags = tags_of(text);
        if tags.is_empty() {
            continue;
        }
        let pick = |rng: &mut Lcg| tags[rng.next() as usize % tags.len()].clone();
        let tag = pick(rng);
        let (what, changed) = match rng.next() % 6 {
            0 => {
                let quotes: Vec<usize> = text[tag.clone()]
                    .match_indices("=\"")
                    .map(|(i, _)| tag.start + i + 2)
                    .collect();
                let Some(&from) = quotes.get(rng.next() as usize % quotes.len().max(1)) else {
                    continue;
                };
                let to = from + text[from..].find('"').unwrap_or(0);
                let value = STRANGE[rng.next() as usize % STRANGE.len()];
                (
                    "valore strano",
                    format!("{}{value}{}", &text[..from], &text[to..]),
                )
            }
            1 => (
                "tag tolto",
                format!("{}{}", &text[..tag.start], &text[tag.end..]),
            ),
            2 => (
                "tag ripetuto",
                format!(
                    "{}{}{}",
                    &text[..tag.end],
                    &text[tag.clone()],
                    &text[tag.end..]
                ),
            ),
            3 => {
                let start = tag.start + 1 + usize::from(text[tag.start + 1..].starts_with('/'));
                let end = start
                    + text[start..tag.end]
                        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
                        .unwrap_or(0);
                (
                    "tag rinominato",
                    format!("{}z{}", &text[..end], &text[end..]),
                )
            }
            4 => {
                let name = &text[tag.start + 1..];
                let name = name.trim_start_matches('/');
                let prefix = name
                    .split(':')
                    .next()
                    .filter(|p| name.contains(':') && !p.contains(' '));
                let unknown = match prefix {
                    Some(prefix) => format!("<{prefix}:zz {prefix}:val=\"1\"/>"),
                    None => "<zz val=\"1\"/>".to_string(),
                };
                (
                    "elemento sconosciuto",
                    format!("{}{unknown}{}", &text[..tag.end], &text[tag.end..]),
                )
            }
            _ => {
                let to = pick(rng);
                let moved = &text[tag.clone()];
                let without = format!("{}{}", &text[..tag.start], &text[tag.end..]);
                let at = if to.start >= tag.start {
                    to.end - moved.len()
                } else {
                    to.end
                };
                (
                    "tag spostato",
                    format!("{}{moved}{}", &without[..at], &without[at..]),
                )
            }
        };
        let mut mutated = parts.clone();
        mutated[at].1 = changed.into_bytes();
        out.push((
            format!("{what} in {}, giro {n}", parts[at].0),
            rezip(&mutated),
        ));
    }
    out
}

/// Un PNG di un pixel.
const PIXEL: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/// I byte da vedere delle immagini di `blocks`.
fn shown(blocks: &mut [Block]) -> Vec<Option<String>> {
    images(blocks)
        .into_iter()
        .map(|image| match image {
            Inline::Atom { data, .. } => data.clone(),
            _ => unreachable!(),
        })
        .collect()
}

#[test]
fn un_immagine_del_file_si_vede() {
    let bytes = std::fs::read(corpus().join("docx/oggetti.docx")).unwrap();
    let opened = open(Codec::Docx, &bytes).unwrap();
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    let shown = shown(&mut projection.blocks);
    assert!(!shown.is_empty());
    for seen in shown {
        let seen = seen.expect("ogni immagine di oggetti.docx è un PNG piccolo");
        assert!(
            ["iVBORw0KGgo", "/9j/", "R0lGODdh", "R0lGODlh"]
                .iter()
                .any(|magic| seen.starts_with(magic)),
            "i byte da vedere sono PNG, JPEG o GIF"
        );
    }
}

#[test]
fn chi_scrive_ignora_i_byte_da_vedere_di_un_immagine_tenuta() {
    let bytes = std::fs::read(corpus().join("docx/senza-perdite.docx")).unwrap();
    let opened = open(Codec::Docx, &bytes).unwrap();
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    let Some(Block::Para(para)) = projection.blocks.first_mut() else {
        panic!("il primo blocco è un paragrafo")
    };
    para.c.push(Inline::Atom {
        k: None,
        kind: AtomKind::Image,
        label: "Un pixel".into(),
        w: Some(12.0),
        h: Some(12.0),
        data: Some(PIXEL.into()),
        note: None,
        end: false,
        toc: None,
        comment: None,
        ins: None,
        del: None,
    });
    let Ok(Saved::Bytes(with_image)) = save(Codec::Docx, &bytes, &projection.to_json().unwrap())
    else {
        panic!("l'immagine nuova si scrive")
    };
    // Riaperta, l'immagine è tenuta e porta i suoi byte da vedere.
    let reopened = open(Codec::Docx, &with_image).unwrap();
    let mut projection = Projection::from_json(&reopened.projection).unwrap();
    assert_eq!(shown(&mut projection.blocks), vec![Some(PIXEL.to_string())]);
    // Cambiati o tolti, il file tiene l'immagine che aveva.
    for data in [Some("R0lGODlhAQABAAAAACw=".to_string()), None] {
        for image in images(&mut projection.blocks) {
            if let Inline::Atom { data: seen, .. } = image {
                *seen = data.clone();
            }
        }
        let saved = save(Codec::Docx, &with_image, &projection.to_json().unwrap());
        assert!(matches!(saved, Ok(Saved::Unchanged)), "{saved:?}");
    }
}

/// Gli intervalli dei tag di un testo XML, senza dichiarazioni e commenti.
fn tags_of(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(open) = text[from..].find('<').map(|i| from + i) {
        let Some(close) = text[open..].find('>').map(|i| open + i + 1) else {
            break;
        };
        if !matches!(text.as_bytes().get(open + 1), Some(b'?' | b'!')) {
            out.push(open..close);
        }
        from = close;
    }
    out
}

fn rezip(parts: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in parts {
        zip.start_file(name.as_str(), zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(data).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// Il writer è deterministico: lo stesso modello dà gli stessi byte, due volte
/// di fila e dopo un `clone`. Il salvataggio confronta i blocchi non toccati con
/// la prova a vuoto della base, e la prova regge soltanto così.
#[test]
fn il_writer_è_deterministico() {
    for entry in manifest() {
        let codec = codec_of(&entry.path);
        if codec != Codec::Docx {
            continue;
        }
        let bytes = std::fs::read(corpus().join(&entry.path)).unwrap();
        let Ok(document) = codec.read(&bytes) else {
            continue;
        };
        let Ok(first) = codec.write(&document) else {
            continue;
        };
        assert_eq!(
            codec.write(&document).ok().as_ref(),
            Some(&first),
            "{}: due scritture diverse",
            entry.path
        );
        assert_eq!(
            codec.write(&document.clone()).ok().as_ref(),
            Some(&first),
            "{}: la copia scrive diverso",
            entry.path
        );
        // E il modello riletto, se torna uguale, scrive gli stessi byte.
        let reread = codec.read(&first).unwrap();
        if reread == document {
            assert_eq!(codec.write(&reread).unwrap(), first, "{}", entry.path);
        }
    }
}

/// I tempi di apertura e di salvataggio (E3) di ogni file, in un resoconto:
/// non fanno parte dei risultati attesi, che devono restare deterministici.
///
/// ```text
/// cargo test -p fub-format-rich --release --test corpus -- --ignored --nocapture tempi
/// ```
///
/// `FUB_TEMPI_PARAGRAFI` dice quanti paragrafi ha il file grande (tremila).
#[test]
#[ignore]
fn tempi() {
    let mut files: Vec<(String, Vec<u8>)> = manifest()
        .into_iter()
        .map(|entry| {
            let bytes = std::fs::read(corpus().join(&entry.path)).unwrap();
            (entry.path, bytes)
        })
        .collect();
    let paragraphs = std::env::var("FUB_TEMPI_PARAGRAFI")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(3000);
    files.push((
        format!("docx/grande-{paragraphs}-paragrafi.docx"),
        large(paragraphs),
    ));
    for (path, bytes) in files {
        let codec = codec_of(&path);
        let start = Instant::now();
        let opened = open(codec, &bytes);
        let opening = start.elapsed();
        let saving = opened.ok().and_then(|opened| {
            let projection = Projection::from_json(&opened.projection).ok()?;
            let wanted = edit("E3", &projection)?.to_json().ok()?;
            let start = Instant::now();
            let _ = save(codec, &bytes, &wanted);
            Some(start.elapsed())
        });
        // Quanto costa la sola misura dei byte: il resoconto legge, scrive e
        // inventaria due volte; il codec da solo legge e scrive.
        let measure = (codec == Codec::Docx)
            .then(|| {
                let start = Instant::now();
                let document = codec.read(&bytes).ok()?;
                codec.write(&document).ok()?;
                let codec_only = start.elapsed();
                let start = Instant::now();
                fub_format_rich::preservation::report(&bytes).ok()?;
                Some(start.elapsed().saturating_sub(codec_only))
            })
            .flatten();
        println!(
            "{:<40} apertura {:>10.2?}  salvataggio {}  inventari {}",
            path,
            opening,
            saving.map_or("—".to_string(), |t| format!("{t:>10.2?}")),
            measure.map_or("—".to_string(), |t| format!("{t:>10.2?}"))
        );
    }
}

/// Un `.docx` grande: i paragrafi di `segni-di-word.docx` ripetuti fino a
/// `paragraphs`, scritti dal salvataggio.
fn large(paragraphs: usize) -> Vec<u8> {
    let base = std::fs::read(corpus().join("docx/segni-di-word.docx")).unwrap();
    let opened = open(Codec::Docx, &base).unwrap();
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    let body: Vec<Block> = projection
        .blocks
        .iter()
        .filter_map(|block| match block {
            Block::Para(para) if para.role == Role::Body => {
                let mut para = para.clone();
                para.k = None;
                Some(Block::Para(para))
            }
            _ => None,
        })
        .collect();
    while projection.blocks.len() < paragraphs {
        projection.blocks.extend(body.iter().cloned());
    }
    match save(Codec::Docx, &base, &projection.to_json().unwrap()).unwrap() {
        Saved::Bytes(bytes) => bytes,
        Saved::Unchanged => unreachable!(),
    }
}
