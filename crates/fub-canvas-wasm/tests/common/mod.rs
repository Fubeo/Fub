//! I controlli comuni a `tests/api.rs` (il livello sicuro) e `tests/abi.rs`
//! (le funzioni `extern "C"` chiamate in nativo): gli stessi casi, le due
//! vie. Una via è un [`Via`]; un errore è l'oggetto `error` della risposta
//! (`{"code", "message", …}`).

#![allow(dead_code, reason = "ogni file di test usa una parte dei controlli")]

use std::path::PathBuf;

use fub_canvas_core::model::MAX_SOURCE_BYTES;
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::parse;
use fub_canvas_core::patch::same_value;
use fub_canvas_core::source::canvas_value;
use serde_json::{json, Value};

/// Una via fino al nucleo: le funzioni della facciata, più il modello e i
/// livelli d'inchiostro.
pub trait Via {
    fn open(&mut self, source: &[u8]) -> Result<(u32, Value), Value>;
    fn reset(&mut self, handle: u32, source: &[u8]) -> Result<Value, Value>;
    fn commit(&mut self, handle: u32, request: &[u8]) -> Result<Value, Value>;
    fn preview(&mut self, handle: u32, request: &[u8]) -> Result<Vec<u8>, Value>;
    fn compile(&mut self, handle: u32, request: &[u8]) -> Result<Value, Value>;
    fn model(&mut self, handle: u32) -> Result<Value, Value>;
    fn node_at(&mut self, handle: u32, byte: u32) -> Result<Option<usize>, Value>;
    fn ink_layers(&mut self, handle: u32) -> Result<Value, Value>;
    fn close(&mut self, handle: u32) -> Result<(), Value>;
}

/// Il codice di un errore.
pub fn code(error: &Value) -> &str {
    error["code"].as_str().unwrap_or("<nessun codice>")
}

#[track_caller]
pub fn expect_code<T: std::fmt::Debug>(outcome: Result<T, Value>, expected: &str) {
    match outcome {
        Ok(value) => panic!("atteso l'errore {expected}, dato {value:?}"),
        Err(error) => {
            assert_eq!(code(&error), expected, "{error}");
            assert!(
                error["message"].as_str().is_some_and(|m| !m.is_empty()),
                "l'errore non ha un messaggio: {error}"
            );
        }
    }
}

/// Il tratto UTF-16 `{start, end, text}` applicato a `before` come stringa
/// UTF-16, come fa JavaScript.
pub fn apply_utf16(before: &str, edit: &Value) -> String {
    let start = edit["start"].as_u64().expect("start") as usize;
    let end = edit["end"].as_u64().expect("end") as usize;
    let text = edit["text"].as_str().expect("text");
    let mut units: Vec<u16> = before.encode_utf16().collect();
    assert!(
        start <= end && end <= units.len(),
        "tratto {edit} fuori da {} unità",
        units.len()
    );
    units.splice(start..end, text.encode_utf16());
    String::from_utf16(&units).expect("il tratto taglia una coppia di surrogati")
}

fn fixtures(folder: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__")
        .join(folder)
}

/// I vettori di una cartella, in ordine di nome: `(file, json)`.
pub fn read_vectors(folder: &str) -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(fixtures(folder))
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort();
    let vectors: Vec<(String, Value)> = files
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .expect("un nome di file")
                .to_string_lossy()
                .into_owned();
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let json = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, json)
        })
        .collect();
    assert!(
        vectors.len() >= 20,
        "{folder}: solo {} vettori",
        vectors.len()
    );
    vectors
}

fn bytes(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).expect("un valore JSON si scrive")
}

fn utf8(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).expect("la facciata risponde UTF-8")
}

/// Un vettore delle toppe sul testo: il testo di `preview`, il tratto di
/// `commit` applicato al vecchio sorgente e il testo dell'annulla, o la
/// ragione del rifiuto, per tutte e due le funzioni.
pub fn run_patch_vector(via: &mut impl Via, name: &str, vector: &Value) {
    let before = vector["before"].as_str().expect("before");
    let request = bytes(&vector["patches"]);
    let (handle, opened) = via
        .open(before.as_bytes())
        .unwrap_or_else(|e| panic!("{name}: before non si apre: {e}"));
    match vector["expect"]["outcome"].as_str() {
        Some("applied") => {
            let expected = vector["expect"]["text"].as_str().expect("expect.text");
            let preview = utf8(
                via.preview(handle, &request)
                    .unwrap_or_else(|e| panic!("{name}: preview rifiuta: {e}")),
            );
            assert_eq!(preview, expected, "{name}: il testo di preview");
            // `preview` non cambia la lavagna: la stessa richiesta ridà lo
            // stesso testo, e il commit parte dal testo di prima.
            let again = utf8(via.preview(handle, &request).expect("preview di nuovo"));
            assert_eq!(again, expected, "{name}: preview ha cambiato la lavagna");
            let committed = via
                .commit(handle, &request)
                .unwrap_or_else(|e| panic!("{name}: commit rifiuta: {e}"));
            assert_eq!(
                apply_utf16(before, &committed["edit"]),
                expected,
                "{name}: il tratto {} non dà il testo di dopo",
                committed["edit"]
            );
            let undo = vector["expect"]["undo"].as_str().unwrap_or(before);
            let inverse = bytes(&committed["inverse"]);
            let undo_preview = utf8(via.preview(handle, &inverse).expect("preview dell'annulla"));
            assert_eq!(undo_preview, undo, "{name}: preview dell'annulla");
            let undone = via
                .commit(handle, &inverse)
                .unwrap_or_else(|e| panic!("{name}: l'annulla è rifiutato: {e}"));
            assert_eq!(
                apply_utf16(expected, &undone["edit"]),
                undo,
                "{name}: l'annulla"
            );
        }
        Some("rejected") => {
            let reason = vector["expect"]["reason"].as_str().expect("expect.reason");
            let preview = via.preview(handle, &request).map(utf8);
            expect_code(preview, reason);
            expect_code(via.commit(handle, &request), reason);
            let model = via.model(handle).expect("model");
            assert_eq!(
                model["canvas"], opened["canvas"],
                "{name}: il rifiuto ha cambiato la lavagna"
            );
        }
        other => panic!("{name}: esito {other:?}"),
    }
    via.close(handle).expect("close");
}

/// Un vettore delle operazioni d'intento: `compile` dà le toppe e gli id
/// del nucleo nativo, o lo stesso errore; le toppe, applicate, danno il
/// modello atteso.
pub fn run_op_vector(via: &mut impl Via, name: &str, vector: &Value) {
    let before_text = serde_json::to_string(&vector["before"]).expect("before si scrive");
    let (handle, opened) = via
        .open(before_text.as_bytes())
        .unwrap_or_else(|e| panic!("{name}: before non si apre: {e}"));
    let mut request = json!({ "ops": vector["ops"] });
    if !vector["seed"].is_null() {
        request["seed"] = vector["seed"].clone();
    }
    let outcome = via.compile(handle, &bytes(&request));
    let expect = &vector["expect"];
    match expect["outcome"].as_str() {
        Some("malformed") => expect_code(outcome, "request"),
        Some("rejected") => {
            let error = outcome.expect_err(name);
            assert_eq!(code(&error), "op", "{name}: {error}");
            for (key, value) in expect["error"].as_object().expect("expect.error") {
                assert_eq!(&error[key], value, "{name}: error.{key} in {error}");
            }
        }
        Some("applied") => {
            let compiled = outcome.unwrap_or_else(|e| panic!("{name}: non si compila: {e}"));
            // La stessa compilazione del nucleo nativo, campo per campo.
            let canvas = parse(&before_text).expect("before");
            let ops: Vec<CanvasOp> = serde_json::from_value(vector["ops"].clone()).expect("ops");
            let seed = vector["seed"].as_u64().unwrap_or(0);
            let native = compile(&canvas, &ops, seed).expect("compile nativo");
            assert_eq!(
                compiled,
                serde_json::to_value(&native).expect("si scrive"),
                "{name}: compile"
            );
            if let Some(created) = expect.get("created") {
                assert_eq!(&compiled["created"], created, "{name}: gli id creati");
            }
            let patches = bytes(&compiled["patches"]);
            let after_text = utf8(via.preview(handle, &patches).expect("preview"));
            let committed = via
                .commit(handle, &patches)
                .unwrap_or_else(|e| panic!("{name}: commit rifiuta: {e}"));
            assert_eq!(
                apply_utf16(&before_text, &committed["edit"]),
                after_text,
                "{name}"
            );
            // Il modello di dopo, letto dal testo di dopo e da `model`, è
            // quello atteso (come valore JSON, R9).
            let expected = canvas_value(
                &parse(&serde_json::to_string(&expect["after"]).expect("after"))
                    .expect("expect.after"),
            )
            .expect("si scrive");
            let model = via.model(handle).expect("model");
            assert!(
                same_value(&model["canvas"], &expected),
                "{name}: il modello di dopo\n{}\nnon è\n{expected}",
                model["canvas"]
            );
            let (other, reopened) = via.open(after_text.as_bytes()).expect("dopo si apre");
            assert!(
                same_value(&reopened["canvas"], &expected),
                "{name}: riaperto"
            );
            via.close(other).expect("close");
            // L'annulla torna al modello di prima.
            via.commit(handle, &bytes(&committed["inverse"]))
                .unwrap_or_else(|e| panic!("{name}: l'annulla è rifiutato: {e}"));
            let back = via.model(handle).expect("model");
            assert!(
                same_value(&back["canvas"]["nodes"], &opened["canvas"]["nodes"]),
                "{name}: l'annulla non ridà le schede di prima"
            );
        }
        other => panic!("{name}: esito {other:?}"),
    }
    via.close(handle).expect("close");
}

/// Tutti i vettori delle due cartelle, per una via.
pub fn every_vector(via: &mut impl Via) {
    for (name, vector) in read_vectors("canvas-patches") {
        run_patch_vector(via, &name, &vector);
    }
    for (name, vector) in read_vectors("canvas-ops") {
        run_op_vector(via, &name, &vector);
    }
}

/// Quanti vettori dell'inchiostro: gli stessi 28 di
/// `crates/fub-canvas-core/tests/ink_vectors.rs` e di
/// `apps/client/src/editors/canvas/wasm/ink-vectors.test.ts`.
pub const INK_VECTORS: usize = 28;

/// Ogni vettore di `canvas-ink/`: `ink_layers` dà i livelli attesi (quelli
/// che legge il nucleo nativo), la stessa risposta finché il testo non
/// cambia, e i livelli del testo nuovo dopo un `reset`. Su un handle chiuso
/// è `handle`.
pub fn every_ink_vector(via: &mut impl Via) {
    let vectors = read_vectors("canvas-ink");
    assert_eq!(vectors.len(), INK_VECTORS, "canvas-ink: i vettori");
    for (name, vector) in &vectors {
        let source = vector["source"].as_str().expect("source");
        let (handle, _) = via
            .open(source.as_bytes())
            .unwrap_or_else(|e| panic!("{name}: non si apre: {e}"));
        let given = via
            .ink_layers(handle)
            .unwrap_or_else(|e| panic!("{name}: ink_layers rifiuta: {e}"));
        assert_eq!(given, vector["expect"], "{name}: i livelli");
        assert_eq!(
            via.ink_layers(handle).expect("di nuovo"),
            given,
            "{name}: il testo non è cambiato"
        );
        // Una lavagna vuota non ha livelli; il testo di prima li ridà.
        via.reset(handle, b"").expect("reset");
        assert_eq!(
            via.ink_layers(handle).expect("vuota"),
            json!({ "layers": [] }),
            "{name}: dopo reset"
        );
        via.reset(handle, source.as_bytes()).expect("reset");
        assert_eq!(via.ink_layers(handle).expect("riaperta"), given, "{name}");
        via.close(handle).expect("close");
        expect_code(via.ink_layers(handle), "handle");
    }
}

/// Un tratto di penna libero, valido, con questo id.
pub fn free_stroke(id: &str) -> Value {
    json!({
        "id": id,
        "tool": "pen",
        "brush": "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
        "color": "#0072b2",
        "anchor": { "kind": "free" },
        "ink": "1 s100 cxy 4000,2500 120,40 95,-10",
    })
}

/// La toppa che aggiunge [`free_stroke`] in cima al livello della radice.
pub fn add_free_stroke(id: &str) -> Vec<u8> {
    bytes(&json!([{
        "kind": "ink", "layer": "board", "at": 0, "before": null, "after": free_stroke(id),
    }]))
}

/// Un `commit` d'inchiostro cambia la risposta di `ink_layers`, e l'annulla
/// la rimette.
pub fn ink_layers_follow_commits(via: &mut impl Via) {
    let (handle, _) = via.open(br#"{"nodes":[],"edges":[]}"#).expect("si apre");
    let empty = json!({ "layers": [] });
    assert_eq!(via.ink_layers(handle).expect("vuota"), empty);
    let committed = via.commit(handle, &add_free_stroke("s-1")).expect("commit");
    assert_eq!(
        via.ink_layers(handle).expect("dopo"),
        json!({ "layers": [{ "layer": "board", "state": "ok", "strokes": [{ "id": "s-1", "drawn": true }] }] })
    );
    via.commit(handle, &bytes(&committed["inverse"]))
        .expect("annulla");
    assert_eq!(via.ink_layers(handle).expect("annullata"), empty);
    via.close(handle).expect("close");
}

/// Una lavagna di una scheda di testo, con o senza BOM e CRLF.
pub fn one_card(text: &str, bom: bool, crlf: bool) -> String {
    let node =
        json!({"id": "a", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "text": text});
    let mut source =
        serde_json::to_string_pretty(&json!({ "nodes": [node], "edges": [] })).expect("si scrive");
    if crlf {
        source = source.replace('\n', "\r\n");
    }
    if bom {
        source.insert(0, '\u{feff}');
    }
    source
}

/// Il tratto UTF-16 di ogni commit, applicato al vecchio sorgente come
/// stringa UTF-16, dà il testo di `preview`: caratteri di uno, due, tre e
/// quattro byte, prima e dopo il punto cambiato, con BOM e CRLF; e
/// l'annulla torna indietro allo stesso modo.
pub fn utf16_round_trip(via: &mut impl Via) {
    let texts = [
        ("abc", "abd"),
        ("é", "éè"),
        ("€ uno", "€ due €"),
        ("a😀b", "a😀c"),
        ("😀", "😀😀"),
        ("😀x😀", "x"),
        ("ñ€😀", "😀€ñ"),
        ("", "𝄞 chiave"),
        ("riga\r\naltra", "riga\naltra 😀"),
    ];
    for bom in [false, true] {
        for crlf in [false, true] {
            for (old, new) in texts {
                let source = one_card(old, bom, crlf);
                let (handle, opened) = via.open(source.as_bytes()).expect("si apre");
                let node = opened["canvas"]["nodes"][0].clone();
                let mut after = node.clone();
                after["text"] = Value::String(new.into());
                after["x"] = json!(7);
                let request =
                    bytes(&json!([{ "kind": "upsert-node", "before": node, "after": after }]));
                let preview = utf8(via.preview(handle, &request).expect("preview"));
                let committed = via.commit(handle, &request).expect("commit");
                assert_eq!(
                    apply_utf16(&source, &committed["edit"]),
                    preview,
                    "{old:?} → {new:?}, BOM {bom}, CRLF {crlf}"
                );
                assert!(preview.contains(&serde_json::to_string(new).expect("si scrive")[1..]));
                let undo = via
                    .commit(handle, &bytes(&committed["inverse"]))
                    .expect("annulla");
                assert_eq!(
                    apply_utf16(&preview, &undo["edit"]),
                    source,
                    "l'annulla di {old:?}"
                );
                via.close(handle).expect("close");
            }
        }
    }
}

/// Ogni ingresso sbagliato risponde con un errore, e la lavagna resta com'era.
pub fn bad_input(via: &mut impl Via) {
    // Byte che non sono UTF-8: 0xFF, una sequenza di quattro byte tronca, un
    // surrogato codificato.
    let not_utf8: [&[u8]; 3] = [&[0xFF], &[0xF0, 0x9F, 0x98], &[0xED, 0xA0, 0x80]];
    for bad in not_utf8 {
        expect_code(via.open(bad), "utf8");
    }
    let source = one_card("testo", false, false);
    let (handle, _) = via.open(source.as_bytes()).expect("si apre");
    for bad in not_utf8 {
        expect_code(via.reset(handle, bad), "utf8");
        expect_code(via.commit(handle, bad), "utf8");
        expect_code(via.preview(handle, bad), "utf8");
        expect_code(via.compile(handle, bad), "utf8");
        // Anche dentro una stringa JSON.
        let mut wrapped = b"[\"".to_vec();
        wrapped.extend_from_slice(bad);
        wrapped.extend_from_slice(b"\"]");
        expect_code(via.commit(handle, &wrapped), "utf8");
    }
    // Un sorgente che non è una lavagna.
    expect_code(via.open(b"{"), "source");
    expect_code(via.open(b"[]"), "source");
    expect_code(via.open(br#"{"nodes": 3}"#), "source");
    expect_code(via.reset(handle, b"{"), "source");
    // JSON non valido, o valido ma della forma sbagliata.
    for bad in [
        &b"{"[..],
        b"[",
        b"",
        b"null",
        b"{}",
        b"[{}]",
        b"[1]",
        b"\"x\"",
    ] {
        expect_code(via.commit(handle, bad), "request");
        expect_code(via.preview(handle, bad), "request");
    }
    for bad in [
        &b"{"[..],
        b"",
        b"[]",
        br#"{"ops": {}}"#,
        br#"{"seed": 1}"#,
        br#"{"ops": [], "seed": -1}"#,
        br#"{"ops": [], "seed": 1.5}"#,
        br#"{"ops": [], "seed": "18446744073709551616"}"#,
        br#"{"ops": [], "seed": "1x"}"#,
        br#"{"ops": [], "other": 1}"#,
        br#"{"ops": [{"op": "fly"}]}"#,
    ] {
        expect_code(via.compile(handle, bad), "request");
    }
    // Il seme come numero o come stringa di cifre è lo stesso seme.
    let op = json!([{"op": "add_card", "node": {"type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": ""}}]);
    let as_number = via
        .compile(
            handle,
            &bytes(&json!({"ops": op, "seed": 18446744073709551615u64})),
        )
        .expect("seme numero");
    let as_text = via
        .compile(
            handle,
            &bytes(&json!({"ops": op, "seed": "18446744073709551615"})),
        )
        .expect("seme testo");
    assert_eq!(as_number, as_text);
    // Niente di tutto questo ha cambiato la lavagna.
    let preview = utf8(via.preview(handle, b"[]").expect("preview"));
    assert_eq!(preview, source);
    via.close(handle).expect("close");
}

/// Gli handle: 0, `u32::MAX`, mai aperto, chiuso; due lavagne insieme, una
/// chiusa mentre l'altra lavora; un handle non si riusa.
pub fn handles(via: &mut impl Via) {
    let (first, _) = via
        .open(one_card("uno", false, false).as_bytes())
        .expect("uno");
    let (second, _) = via
        .open(one_card("due", true, true).as_bytes())
        .expect("due");
    assert!(first != 0 && second != 0 && first != second);
    via.close(first).expect("chiude il primo");
    let never = second.saturating_add(1000);
    for handle in [0, u32::MAX, never, first] {
        expect_code(via.reset(handle, b""), "handle");
        expect_code(via.commit(handle, b"[]"), "handle");
        expect_code(via.preview(handle, b"[]"), "handle");
        expect_code(via.compile(handle, br#"{"ops": []}"#), "handle");
        expect_code(via.model(handle), "handle");
        expect_code(via.node_at(handle, 0), "handle");
        expect_code(via.close(handle), "handle");
    }
    // Il secondo lavora ancora, con il suo testo.
    let model = via.model(second).expect("il secondo");
    assert_eq!(model["canvas"]["nodes"][0]["text"], "due");
    let node = model["canvas"]["nodes"][0].clone();
    let mut after = node.clone();
    after["x"] = json!(5);
    via.commit(
        second,
        &bytes(&json!([{ "kind": "upsert-node", "before": node, "after": after }])),
    )
    .expect("commit sul secondo");
    // Un handle nuovo non è quello chiuso.
    let (third, _) = via.open(b"").expect("vuota");
    assert!(third != first && third != second);
    expect_code(via.model(first), "handle");
    // `node_at` sul secondo: dentro la scheda, fuori, oltre la fine.
    let text = utf8(via.preview(second, b"[]").expect("testo"));
    let inside = text.find("\"due\"").expect("la scheda") as u32;
    assert_eq!(via.node_at(second, inside).expect("dentro"), Some(0));
    assert_eq!(via.node_at(second, 0).expect("fuori"), None);
    assert_eq!(via.node_at(second, u32::MAX).expect("oltre"), None);
    via.close(second).expect("close");
    via.close(third).expect("close");
}

/// Una lavagna valida di una scheda, allungata con spazi fino a `len` byte.
/// Ha già `edges`, che il ritocco altrimenti aggiunge (e il testo crescerebbe).
pub fn padded(len: usize) -> String {
    let mut source = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":10,"height":10,"text":"x"}],"edges":[]}"#
        .to_owned();
    source.extend(std::iter::repeat_n(' ', len - source.len()));
    source
}

/// Un sorgente di `MAX_SOURCE_BYTES` si apre e si cambia; uno di un byte in
/// più è `limit`.
pub fn sizes(via: &mut impl Via) {
    let source = padded(MAX_SOURCE_BYTES);
    let (handle, opened) = via.open(source.as_bytes()).expect("16 MiB si aprono");
    let node = opened["canvas"]["nodes"][0].clone();
    let mut after = node.clone();
    after["x"] = json!(9);
    let request = bytes(&json!([{ "kind": "upsert-node", "before": node, "after": after }]));
    let preview = via.preview(handle, &request).expect("preview a 16 MiB");
    assert_eq!(preview.len(), MAX_SOURCE_BYTES);
    let committed = via.commit(handle, &request).expect("commit a 16 MiB");
    assert_eq!(committed["edit"]["text"], "9");
    via.close(handle).expect("close");

    let over = padded(MAX_SOURCE_BYTES + 1);
    expect_code(via.open(over.as_bytes()), "limit");
    let (handle, _) = via.open(b"").expect("vuota");
    expect_code(via.reset(handle, over.as_bytes()), "limit");
    via.close(handle).expect("close");
}

/// Un risultato vuoto e uno più grande di una pagina di memoria (64 KiB).
/// Il vuoto è quello di `close` e di `node_at` (la via di `abi.rs` controlla
/// che `result_len` sia 0); un sorgente vuoto è una lavagna vuota, e il suo
/// `preview` è il testo nuovo intero che `commit` scriverebbe.
pub fn results(via: &mut impl Via) {
    let (handle, opened) = via.open(b"").expect("vuota");
    assert_eq!(opened["canvas"], json!({"nodes": [], "edges": []}));
    assert_eq!(via.node_at(handle, 0).expect("node_at"), None);
    let written = utf8(via.preview(handle, b"[]").expect("preview"));
    assert_eq!(written, "{\n  \"nodes\": [],\n  \"edges\": []\n}\n");
    via.close(handle).expect("close");

    let long = "ü".repeat(100_000);
    let source = one_card(&long, true, true);
    let (handle, opened) = via.open(source.as_bytes()).expect("si apre");
    assert_eq!(opened["canvas"]["nodes"][0]["text"], long.as_str());
    let preview = via.preview(handle, b"[]").expect("preview");
    assert!(preview.len() > 65_536);
    assert_eq!(preview, source.as_bytes());
    via.close(handle).expect("close");
}
