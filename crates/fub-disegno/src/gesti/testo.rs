//! Lo strumento Testo (D-7) con lo strumento Testo del motore (`type` di
//! `vendor/vectorcraft/crates/tools/src/text.rs`): un clic crea un testo.
//! Il risultato è quello della strada semplice del client, `textElem` di
//! `apps/client/src/editors/spatial/tools/text.ts`, che il vettore scritto a
//! mano `tests/gesti/testo.json` fissa.
//!
//! Chi fa che cosa:
//!
//! - **Un clic su un testo che c'è** non ne crea un altro: lo sceglie, con la
//!   regola della Selezione di Fub ([`super::selezione`], che fa il gesto al
//!   posto del Testo), così la selezione è quella che darebbe la Selezione
//!   (un testo dentro un gruppo sceglie il gruppo, Maiusc aggiunge, un
//!   trascinamento sposta).
//! - **La preparazione** ([`Strumento::prepara`]): senza `text`, o con una
//!   riga che non ha niente da leggere, il gesto è `empty` subito. Il livello,
//!   i rifiuti `hidden` e `locked` e le guide magnetiche spente sono quelli
//!   delle forme ([`super::forme`], che le preferenze della sessione le
//!   condividono); il colore del gesto (`style.stroke`) è il riempimento del
//!   testo nuovo, e il motore non riempie il testo con il suo segnaposto.
//! - **Gli eventi** ([`Strumento::evento`]): la griglia aggancia la pressione
//!   come per le forme (Ctrl/⌘ la scioglie); ogni punto dopo torna lì, perché
//!   un trascinamento farebbe nel motore un testo in un'area, e Maiusc, Alt e
//!   Ctrl/⌘ si tolgono (nel motore sceglierebbero il testo verticale, quello
//!   in un'area o su un tracciato).
//! - **L'elemento** ([`Strumento::elemento`]) è il `<text>` di `textElem`:
//!   l'ancora sulla linea di base nello spazio del livello, a due decimali,
//!   [`TEXT_FAMILY`] e [`TEXT_SIZE`] (lo stile del gesto non ha un corpo).
//! - **Le righe** ([`Strumento::rifinisci`]): il motore ha creato un testo
//!   vuoto (la riga non passa dalla tastiera del motore, e la differenza
//!   scrive gli attributi, non i figli); le righe di `text` come le scrive
//!   `textLines`, una `tspan` ciascuna, e il colore del gesto entrano
//!   nell'`add`. Il testo nuovo è la selezione. Il contenuto poi si cambia
//!   nell'ispettore del client (operazione `text`), non qui.

use fub_abi::{
    DrawingOutcome, DrawingPointer, DrawingPointerKind, DrawingPreview, DrawingRefusal, DrawingTool,
};
use fub_scene::Role;
use serde_json::{json, Map, Value};
use vectorcraft_doc::color::{Color, Paint};
use vectorcraft_doc::hit::{hit_test, HitOptions};
use vectorcraft_doc::{Node, NodeKind, TextKind};
use vectorcraft_engine::Session;
use vectorcraft_geom::{Affine, Point};

use super::{forme, selezione, Contesto, Strumento};
use crate::differenza::numero;

/// Il carattere di un testo nuovo, come lo scrive il file (`TEXT_FAMILY`).
pub const TEXT_FAMILY: &str = "Inter, sans-serif";

/// Il corpo di un testo nuovo (`TEXT_SIZE`, Medio).
pub const TEXT_SIZE: f64 = 32.0;

/// L'interlinea, in volte il corpo (`LINE_SPACING`).
pub const LINE_SPACING: f64 = 1.25;

/// Come si scrive una riga vuota fra due scritte (`BLANK_LINE`).
const BLANK_LINE: &str = "\u{a0}";

/// Lo strumento Testo.
pub(crate) struct Testo;

static TESTO: Testo = Testo;

/// Lo strumento Testo di Fub.
pub(crate) fn strumento() -> &'static dyn Strumento {
    &TESTO
}

/// Vero per ciò che XML 1.0 non ammette in un testo (`NOT_XML`): i
/// caratteri di controllo tranne tabulazione e a capo, U+FFFE e U+FFFF (una
/// `String` non ha surrogati spaiati).
fn non_xml(c: char) -> bool {
    matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{fffe}' | '\u{ffff}')
}

/// Vero se `riga` non ha niente da leggere (`blank`: `trim()` di JavaScript,
/// che toglie anche U+FEFF).
fn vuota(riga: &str) -> bool {
    riga.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .is_empty()
}

/// Le righe di `input` come le scrive il file (`textLines`): senza ciò che
/// XML non ammette, spazi e tabulazioni in fila come uno spazio, niente
/// spazio ai bordi, senza righe vuote in testa e in coda, e una riga vuota
/// fra due scritte come [`BLANK_LINE`]. Vuote se non c'è niente da leggere.
pub(crate) fn righe(input: &str) -> Vec<String> {
    let pulito: String = input.chars().filter(|c| !non_xml(*c)).collect();
    let pulito = pulito.replace("\r\n", "\n");
    let tutte: Vec<String> = pulito
        .split(['\r', '\n', '\u{2028}', '\u{2029}'])
        .map(|riga| {
            let mut fuori = String::with_capacity(riga.len());
            let mut spazio = false;
            for c in riga.chars() {
                if c == ' ' || c == '\t' {
                    spazio = true;
                    continue;
                }
                if spazio {
                    fuori.push(' ');
                    spazio = false;
                }
                fuori.push(c);
            }
            if spazio {
                fuori.push(' ');
            }
            let fuori = fuori.strip_prefix(' ').unwrap_or(&fuori);
            fuori.strip_suffix(' ').unwrap_or(fuori).to_string()
        })
        .collect();
    let primo = tutte.iter().position(|r| !vuota(r));
    let ultimo = tutte.iter().rposition(|r| !vuota(r));
    match (primo, ultimo) {
        (Some(a), Some(b)) => tutte[a..=b]
            .iter()
            .map(|r| {
                if vuota(r) {
                    BLANK_LINE.to_string()
                } else {
                    r.clone()
                }
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// Le righe del testo del gesto; vuote senza `text`.
fn righe_del_gesto(cx: &Contesto<'_>) -> Vec<String> {
    cx.gesto.text.as_deref().map(righe).unwrap_or_default()
}

/// Il colore del testo nuovo: il colore del gesto (`style.stroke`), come lo
/// scrive il motore.
fn colore(cx: &Contesto<'_>) -> Option<Color> {
    cx.gesto
        .style
        .as_ref()
        .and_then(|s| Color::from_hex(&s.stroke))
}

/// Vero se la pressione del gesto cade su un testo che c'è: il gesto lo fa la
/// Selezione. Con le opzioni della Selezione di Fub (la tolleranza di
/// [`selezione::HIT_PX`] pixel); la carta e i livelli non contano.
fn sul_testo(cx: &Contesto<'_>) -> bool {
    let Some(press) = cx.pressione else {
        return false;
    };
    let p = cx.copia.radice * Point::new(press.x, press.y);
    let opzioni = HitOptions {
        tol: selezione::HIT_PX / cx.vista.zoom,
        clip_outlines: true,
        ..HitOptions::default()
    };
    let doc = &cx.copia.documento;
    let Some(colpo) = hit_test(doc, p, opzioni) else {
        return false;
    };
    let testo = doc
        .node(colpo.leaf)
        .is_some_and(|n| matches!(n.kind, NodeKind::Text(_)));
    let mappa = &cx.copia.mappa;
    let oggetto = mappa
        .del_nodo(colpo.top_object(None))
        .and_then(|i| mappa.elemento(i))
        .is_some_and(|e| !matches!(e.ruolo, Role::Paper | Role::Layer));
    testo && oggetto
}

/// Le `tspan` delle righe `righe`, come `textElem` le scrive.
fn tspan(x: &str, righe: &[String]) -> Vec<Value> {
    let interlinea = numero(TEXT_SIZE * LINE_SPACING, 2);
    righe
        .iter()
        .enumerate()
        .map(|(i, riga)| {
            let dy = if i == 0 { "0" } else { interlinea.as_str() };
            json!({ "tag": "tspan", "attrs": { "x": x, "dy": dy }, "text": riga })
        })
        .collect()
}

/// L'`add` del `<text>` nuovo in un elenco di operazioni (anche dentro un
/// `batch`).
fn add_del_testo(ops: &mut Value) -> Option<&mut Value> {
    let specie = match &*ops {
        Value::Array(_) => "array",
        Value::Object(o) => match o.get("op").and_then(Value::as_str) {
            Some("add") if o.get("elem").and_then(|e| e.get("tag")) == Some(&json!("text")) => {
                "add"
            }
            Some("batch") => "batch",
            _ => return None,
        },
        _ => return None,
    };
    match specie {
        "add" => Some(ops),
        "batch" => ops.get_mut("ops").and_then(add_del_testo),
        _ => ops.as_array_mut()?.iter_mut().find_map(add_del_testo),
    }
}

impl Strumento for Testo {
    fn id_motore(&self) -> &'static str {
        "type"
    }

    fn prepara(&self, sessione: &mut Session, cx: &Contesto<'_>) -> Result<(), DrawingRefusal> {
        if sul_testo(cx) {
            sessione
                .select_tool(selezione::strumento().id_motore(), cx.vista)
                .map_err(|_| DrawingRefusal::Unsupported)?;
            return selezione::strumento().prepara(sessione, cx);
        }
        if righe_del_gesto(cx).is_empty() {
            return Err(DrawingRefusal::Empty);
        }
        let colore = colore(cx).ok_or(DrawingRefusal::Unsupported)?;
        // Il livello, i suoi rifiuti e le guide magnetiche spente: quelli
        // delle forme.
        forme::strumento(DrawingTool::Rect).prepara(sessione, cx)?;
        // Il motore riempie il testo nuovo col riempimento corrente (nero se è
        // nessuno o bianco): il colore del gesto lo scrive comunque
        // [`Strumento::rifinisci`].
        sessione.paint.fill = Paint::solid(colore);
        sessione.paint.stroke = Paint::None;
        sessione.prefs.placeholder_text = false;
        Ok(())
    }

    fn evento(
        &self,
        e: DrawingPointer,
        inizio: Option<&DrawingPointer>,
        cx: &Contesto<'_>,
    ) -> DrawingPointer {
        if sul_testo(cx) {
            return selezione::strumento().evento(e, inizio, cx);
        }
        let senza_tasti = |p: DrawingPointer| DrawingPointer {
            shift: false,
            alt: false,
            cmd: false,
            ..p
        };
        match e.kind {
            DrawingPointerKind::Down => {
                // La griglia come per le forme, senza Maiusc: un clic non tira.
                let giu = DrawingPointer { shift: false, ..e };
                senza_tasti(forme::strumento(DrawingTool::Rect).evento(giu, None, cx))
            }
            DrawingPointerKind::Drag | DrawingPointerKind::Up => match inizio {
                Some(i) => DrawingPointer {
                    x: i.x,
                    y: i.y,
                    ..senza_tasti(e)
                },
                None => senza_tasti(e),
            },
            // Un doppio clic non fa niente in più: il testo si cambia
            // nell'ispettore.
            DrawingPointerKind::DoubleClick => DrawingPointer {
                kind: DrawingPointerKind::Move,
                ..senza_tasti(e)
            },
            DrawingPointerKind::Move => senza_tasti(e),
        }
    }

    fn anteprima(&self, sessione: &mut Session, cx: &Contesto<'_>) -> Option<DrawingPreview> {
        if sul_testo(cx) {
            return selezione::strumento().anteprima(sessione, cx);
        }
        None
    }

    fn elemento(&self, nodo: &Node, locale: Affine) -> Option<(String, Map<String, Value>)> {
        let NodeKind::Text(t) = &nodo.kind else {
            return None;
        };
        if t.vertical || !matches!(t.kind, TextKind::Point) {
            return None;
        }
        // L'ancora: l'inizio della linea di base della prima riga.
        let ancora = locale * (t.xf * Point::ZERO);
        let fill = t
            .runs
            .first()
            .and_then(|r| match &r.style.fill {
                Paint::Solid { color, .. } => Some(color.to_hex()),
                _ => None,
            })
            .unwrap_or_else(|| "#000000".into());
        let mut attrs = Map::new();
        attrs.insert("x".into(), json!(numero(ancora.x, 2)));
        attrs.insert("y".into(), json!(numero(ancora.y, 2)));
        attrs.insert("fill".into(), json!(fill));
        attrs.insert("font-family".into(), json!(TEXT_FAMILY));
        attrs.insert("font-size".into(), json!(numero(TEXT_SIZE, 2)));
        Some(("text".into(), attrs))
    }

    fn rifinisci(&self, esito: &mut DrawingOutcome, cx: &Contesto<'_>) {
        if sul_testo(cx) {
            selezione::strumento().rifinisci(esito, cx);
            return;
        }
        if esito.refused.is_some() {
            return;
        }
        let vuoto = |esito: &mut DrawingOutcome| {
            esito.ops = None;
            esito.selection = Vec::new();
            esito.refused = Some(DrawingRefusal::Empty);
        };
        let righe = righe_del_gesto(cx);
        let (Some(testo), Some(colore), false) =
            (esito.ops.as_deref(), colore(cx), righe.is_empty())
        else {
            return vuoto(esito);
        };
        let Ok(mut ops) = serde_json::from_str::<Value>(testo) else {
            return vuoto(esito);
        };
        let Some(add) = add_del_testo(&mut ops) else {
            return vuoto(esito);
        };
        let elem = &mut add["elem"];
        let x = elem["attrs"]["x"].as_str().unwrap_or("0").to_string();
        let id = elem["attrs"]["id"].as_str().map(str::to_string);
        elem["attrs"]["fill"] = json!(colore.to_hex());
        elem["children"] = Value::Array(tspan(&x, &righe));
        match serde_json::to_string(&ops) {
            Ok(testo) => esito.ops = Some(testo),
            Err(_) => return vuoto(esito),
        }
        // Il testo nuovo è la selezione.
        esito.selection = id.into_iter().collect();
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn righe_come_il_client() {
        assert_eq!(righe("Testo"), ["Testo"]);
        assert_eq!(righe("  a \t  b  "), ["a b"]);
        assert!(righe("").is_empty());
        assert!(righe(" \t\u{a0}").is_empty());
        assert_eq!(
            righe("\u{2028}a\u{2029}\u{2028}b\u{2028}"),
            ["a", BLANK_LINE, "b"]
        );
        assert_eq!(righe("a\u{1}b\u{fffe}"), ["ab"]);
        assert_eq!(righe("漢字 🙂"), ["漢字 🙂"]);
    }

    #[test]
    fn tspan_come_textelem() {
        let r = vec!["a".to_string(), "b".to_string()];
        assert_eq!(
            tspan("10", &r),
            vec![
                json!({ "tag": "tspan", "attrs": { "x": "10", "dy": "0" }, "text": "a" }),
                json!({ "tag": "tspan", "attrs": { "x": "10", "dy": "40" }, "text": "b" }),
            ]
        );
    }
}
