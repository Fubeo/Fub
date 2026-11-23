//! Il ponte verso gli strumenti del motore ([`DrawingTool::Engine`]).
//!
//! Gli strumenti di K5 ([`super::Strumento`]) sono gesti di Fub tradotti per
//! il motore; questi sono gli strumenti del motore come sono, presi dal suo
//! catalogo (`TOOL_GROUPS`). La sessione del motore tiene lo strumento attivo
//! e gli dà il suo `ToolContext` (il documento, la selezione, lo zoom del
//! client): i puntatori vanno a `Tool::pointer`, i tasti a `Tool::key`, il
//! testo a `Tool::text_input` e l'IME a `Tool::ime_preedit`, e le `Action` che
//! rendono le esegue la sessione sulla copia.
//!
//! Un gesto con uno strumento del motore dura finché il client non lo chiude
//! con `commit` o `cancel`: una richiesta con `phase: preview` lo continua, e
//! lo continua anche quando comincia con una pressione, perché la penna fa un
//! tracciato con più clic. Così un tracciato intero è **un** passo della
//! cronologia di Fub (A8). Lo ricomincia uno strumento diverso o una revisione
//! diversa (il testo è cambiato sotto il gesto): il gesto vecchio si annulla
//! prima. `commit` dà la differenza fra la copia e il documento della
//! sessione ([`crate::differenza`]); `cancel` ferma l'interazione del motore
//! e riporta la sessione alla copia, senza operazioni.
//!
//! Le sovrapposizioni del motore (`Overlay`) diventano [`DrawingOverlay`] in
//! coordinate di scena, con un ruolo al posto del colore ([`ruolo`]); il
//! client le colora con i suoi token.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use fub_abi::{
    DrawingAnchor, DrawingGesture, DrawingInput, DrawingOutcome, DrawingOverlay,
    DrawingOverlayRole, DrawingPhase, DrawingPoint, DrawingPointer, DrawingPreview, DrawingRefusal,
    DrawingToolState, MAX_DRAWING_ANCHORS, MAX_DRAWING_OVERLAYS, MAX_DRAWING_OVERLAY_PATH_BYTES,
    MAX_DRAWING_OVERLAY_TEXT_BYTES,
};
use serde_json::{json, Map, Value};
use vectorcraft_doc::color::Paint;
use vectorcraft_doc::{CharStyle, Document, Node, NodeId, NodeKind, Selection, TextKind};
use vectorcraft_engine::tools::{Cursor, Mods, Overlay, ToolKey};
use vectorcraft_engine::{EngineError, Session, ViewInfo};
use vectorcraft_geom::{Affine, BezPath, PathEl, Point};

use super::testo::{TEXT_FAMILY, TEXT_FONT, TEXT_SIZE};
use super::{esito_vuoto, evento, forme, selezione_di_fub, Banco, Contesto, InCorso};
use crate::apertura::Copia;
use crate::differenza::{self, numero};
use crate::mappa::Posti;

/// Lo strumento `id` c'è nel catalogo del motore.
pub(crate) fn conosciuto(id: &str) -> bool {
    vectorcraft_engine::tools::tool_info(id).is_some()
}

/// Ciò che il ponte ricorda del gesto in corso, fra una richiesta e l'altra.
#[derive(Default)]
pub(crate) struct Ponte {
    /// Il documento della sessione quando il gesto è cominciato: se è
    /// ancora lui, il gesto non ha cambiato niente.
    inizio: Option<Arc<Document>>,
    /// L'ultimo punto del puntatore, nel documento del motore: il cursore
    /// si chiede lì.
    punto: Option<Point>,
    /// I modificatori dell'ultimo puntatore, con lo spazio tenuto.
    mods: Mods,
    /// Il corpo di un testo nuovo nel documento del motore: [`TEXT_SIZE`]
    /// nello spazio del livello, portato nel motore come lo stile delle
    /// forme ([`forme::destinazione`]).
    corpo: f64,
    /// I testi nuovi del gesto che hanno già preso il carattere di Fub
    /// ([`col_carattere_di_fub`]): uno cambiato dopo resta com'è.
    ritoccati: Vec<NodeId>,
    /// Il gesto con cui la sessione si è preparata, senza eventi né fase
    /// ([`chiave`]): un passaggio del mouse o una pressione con una selezione,
    /// dei punti, uno zoom o uno stile diversi la preparano di nuovo.
    chiave: Option<DrawingGesture>,
}

/// Ciò che decide come la sessione si prepara per il gesto `gesto`: tutto
/// tranne gli eventi, i tasti e la fase.
fn chiave(gesto: &DrawingGesture) -> DrawingGesture {
    DrawingGesture {
        phase: DrawingPhase::Preview,
        events: Vec::new(),
        inputs: Vec::new(),
        ..gesto.clone()
    }
}

/// Il rifiuto del Pennello tondo per il livello del gesto, come `forme::destinazione`: un livello scelto
/// che non c'è, nascosto o bloccato si rifiuta; senza livello scelto va il più alto né nascosto né bloccato,
/// e se non c'è né uno né l'altro si rifiuta come bloccato. `None` se il colpo può andare.
fn livello_del_pennello(copia: &Copia, layer: Option<&str>) -> Option<DrawingRefusal> {
    let livelli: Vec<_> = copia
        .mappa
        .elementi()
        .iter()
        .filter(|e| e.ruolo == fub_scene::Role::Layer)
        .collect();
    match layer {
        Some(id) => match livelli.iter().find(|e| e.id.as_deref() == Some(id)) {
            None => Some(DrawingRefusal::Locked),
            Some(e) if e.nascosto => Some(DrawingRefusal::Hidden),
            Some(e) if e.bloccato => Some(DrawingRefusal::Locked),
            Some(_) => None,
        },
        None if livelli.is_empty() => None,
        None if livelli.iter().rev().any(|e| !e.nascosto && !e.bloccato) => None,
        None => Some(DrawingRefusal::Locked),
    }
}

/// Esegue un pezzo del gesto `gesto` con lo strumento del motore `id`.
pub(crate) fn gesto(
    banco: &mut Banco,
    copia: &Copia,
    gesto: &DrawingGesture,
    id: &str,
) -> DrawingOutcome {
    let mut esito = esito_vuoto(gesto.revision);
    let rifiuta = |banco: &mut Banco, mut esito: DrawingOutcome, r: DrawingRefusal| {
        if banco.in_corso.is_some() {
            banco.ripristina(copia);
        }
        esito.refused = Some(r);
        esito
    };
    if !copia.modificabile {
        return rifiuta(banco, esito, DrawingRefusal::Unsupported);
    }
    if !conosciuto(id) {
        return rifiuta(banco, esito, DrawingRefusal::UnknownTool);
    }
    // Il Pennello tondo dipinge sul livello del gesto: un livello che non c'è, bloccato o nascosto si
    // rifiuta prima del motore, con la stessa parola della forma (`forme::destinazione`).
    if id == "blobBrush" {
        if let Some(motivo) = livello_del_pennello(copia, gesto.layer.as_deref()) {
            return rifiuta(banco, esito, motivo);
        }
    }
    let qui = InCorso {
        tool: gesto.tool.clone(),
        revisione: gesto.revision,
    };
    // Lo strumento resta vivo fra un passaggio del mouse e l'altro, e fra il
    // passaggio e la pressione (come in VectorCraft, dove l'hover va allo
    // strumento): si prepara di nuovo solo se il disegno è un altro, o se un
    // passaggio o una pressione arrivano con un gesto diverso mentre lo
    // strumento non ha niente in corso (un tracciato aperto della Penna resta).
    let chiave_qui = chiave(gesto);
    let comincia = gesto.events.first().is_some_and(|e| {
        matches!(
            e.kind,
            fub_abi::DrawingPointerKind::Move | fub_abi::DrawingPointerKind::Down
        )
    });
    let ricomincia = banco.in_corso.as_ref() != Some(&qui)
        || (comincia
            && banco.ponte.chiave.as_ref() != Some(&chiave_qui)
            && !vectorcraft_engine::guard::catch_panic(|| banco.sessione.tool_busy())
                .unwrap_or(false));
    let cx = Contesto::nuovo(gesto, copia, None, false);
    // Uno strumento che trasforma la selezione non tocca un oggetto bloccato: il rifiuto
    // è quello della finestra del comando (T13 giro 5), e vale anche per l'anteprima. Il
    // Contagocce guarda l'oggetto sotto il primo clic, col punto preso come il motore lo
    // prende (con la griglia).
    let clic = gesto
        .events
        .iter()
        .find(|e| e.kind == fub_abi::DrawingPointerKind::Down)
        .map(|e| {
            let e = sulla_griglia(*e, &cx);
            (copia.radice * Point::new(e.x, e.y), e.alt && !e.shift)
        });
    if let Some(motivo) =
        crate::famiglie::rifiuto_dello_strumento(id, copia, &gesto.selection, clic)
    {
        return rifiuta(banco, esito, motivo);
    }
    if ricomincia {
        if banco.in_corso.is_some() {
            banco.ripristina(copia);
        }
        let (sessione, prefs) = (&mut banco.sessione, &banco.prefs);
        match vectorcraft_engine::guard::catch_panic(|| prepara(sessione, prefs, id, &cx)) {
            Ok(Ok(())) => {}
            Ok(Err(r)) => return rifiuta(banco, esito, r),
            Err(_) => {
                banco.ripristina(copia);
                return rifiuta(banco, esito, DrawingRefusal::Unsupported);
            }
        }
        let al_motore = forme::destinazione(&cx)
            .map(|d| d.al_motore)
            .unwrap_or(copia.radice);
        banco.ponte = Ponte {
            inizio: banco.documento(),
            corpo: TEXT_SIZE * forme::scala(al_motore),
            chiave: Some(chiave_qui),
            ..Ponte::default()
        };
    }
    banco.in_corso = Some(qui);
    let (sessione, ponte) = (&mut banco.sessione, &mut banco.ponte);
    let fatto = vectorcraft_engine::guard::catch_panic(|| {
        for e in &gesto.events {
            let e = sulla_griglia(*e, &cx);
            let mut ev = evento(&e, copia.radice);
            ev.mods.space = ponte.mods.space;
            ponte.mods = ev.mods;
            ponte.punto = Some(ev.pos);
            sessione.pointer(&ev, cx.vista)?;
            col_carattere_di_fub(sessione, ponte, copia)?;
        }
        for i in &gesto.inputs {
            ingresso(sessione, ponte, i, cx.vista)?;
        }
        Ok::<(), EngineError>(())
    });
    match fatto {
        Ok(Ok(())) => {}
        Ok(Err(_)) | Err(_) => return rifiuta(banco, esito, DrawingRefusal::Unsupported),
    }
    if gesto.phase == DrawingPhase::Preview {
        let (sessione, ponte) = (&mut banco.sessione, &banco.ponte);
        let fatto = vectorcraft_engine::guard::catch_panic(|| {
            let mut overlays = segni_nuovi(sessione, ponte, copia);
            for o in sessione.overlays(cx.vista) {
                if overlays.len() >= MAX_DRAWING_OVERLAYS {
                    break;
                }
                overlays.extend(segno(o, copia.radice, sessione));
            }
            // Il testo che si sta scrivendo, che il file non ha ancora.
            let forma = if sessione.tool_wants_text() {
                testo_in_scrittura(sessione, copia)
            } else {
                None
            };
            (overlays, forma, stato(sessione, ponte, copia, cx.vista))
        });
        return match fatto {
            Ok((overlays, shape, stato)) => {
                esito.preview = Some(DrawingPreview {
                    overlays,
                    shape,
                    ..DrawingPreview::default()
                });
                esito.state = Some(stato);
                esito
            }
            Err(_) => rifiuta(banco, esito, DrawingRefusal::Unsupported),
        };
    }
    // Il commit: la differenza, e la sessione torna alla copia.
    let Some(dopo) = banco.documento() else {
        return rifiuta(banco, esito, DrawingRefusal::Unsupported);
    };
    // Uno strumento dei tracciati (forbici, coltello, gomma, penna…), o un altro che ne
    // sposta i punti come Rimodella, non cambia un tratto della penna di Fub: `unmapped`, e
    // niente cambia.
    let dei_tracciati = id == "reshape"
        || crate::famiglie::riga(crate::famiglie::Fonte::Strumento, id).and_then(|r| r.famiglia)
            == Some(crate::famiglie::Famiglia::Tracciati);
    if dei_tracciati && crate::famiglie::inchiostro_toccato(copia, &dopo) {
        let _ = vectorcraft_engine::guard::catch_panic(|| banco.sessione.cancel_interaction());
        return rifiuta(banco, esito, DrawingRefusal::Unmapped);
    }
    let selezione: Vec<NodeId> = banco
        .sessione
        .doc()
        .map(|d| d.selection.objects.clone())
        .unwrap_or_default();
    let differenza = vectorcraft_engine::guard::catch_panic(|| {
        differenza::differenza(
            copia,
            &dopo,
            Some(&scrivi_testo),
            None,
            // Gli strumenti dei tracciati e quelli che spostano i punti (la
            // Selezione diretta): una matrice spiega un oggetto solo se lo
            // sposta.
            dei_tracciati || vectorcraft_tools::catalog::edits_anchors(id),
        )
    });
    // Lo stato si legge prima che la sessione torni alla copia (che rimette
    // lo strumento a capo); il gesto è chiuso, quindi non è più `busy` per
    // il documento cambiato.
    let (sessione, ponte) = (&mut banco.sessione, &banco.ponte);
    let dopo_commit = vectorcraft_engine::guard::catch_panic(|| {
        let mut s = stato(sessione, ponte, copia, cx.vista);
        s.busy = sessione.tool_busy();
        s
    });
    banco.ripristina(copia);
    let differenza = match differenza {
        Ok(Ok(d)) => d,
        Ok(Err(r)) => return rifiuta(banco, esito, r.rifiuto()),
        Err(_) => return rifiuta(banco, esito, DrawingRefusal::Unsupported),
    };
    match differenza.testo() {
        Ok(Some(ops)) => match con_le_righe(&ops, &differenza, &dopo) {
            Ok(ops) => esito.ops = Some(ops),
            Err(r) => return rifiuta(banco, esito, r),
        },
        Ok(None) => esito.refused = Some(DrawingRefusal::Empty),
        Err(r) => return rifiuta(banco, esito, r.rifiuto()),
    }
    esito.selection = selezione_di_fub(copia, &differenza, &selezione);
    esito.state = dopo_commit.ok();
    esito
}

/// Un testo che uno strumento del motore ha appena creato prende il carattere
/// e il corpo di Fub, quelli del Testo del Semplice ([`TEXT_FONT`],
/// [`TEXT_SIZE`]): il motore li farebbe col suo carattere di serie
/// (`CharStyle::default()`), che Fub non ha fra i suoi. Conta solo un testo
/// che il documento di prima non aveva e che ha ancora lo stile di serie in
/// ogni pezzo, una volta per gesto; un testo che c'era resta com'è. Il cambio
/// passa da `text.setStyle`, come il pannello, quindi segue la transform del
/// testo; la differenza lo scrive nel `<text>` nuovo.
fn col_carattere_di_fub(
    sessione: &mut Session,
    ponte: &mut Ponte,
    copia: &Copia,
) -> Result<(), EngineError> {
    if !(ponte.corpo.is_finite() && ponte.corpo > 0.0) {
        return Ok(());
    }
    let Ok(stato) = sessione.doc() else {
        return Ok(());
    };
    let serie = CharStyle::default();
    let prima = Posti::di(&copia.documento);
    let ora = Posti::di(&stato.doc);
    let nuovi: Vec<NodeId> = stato
        .selection
        .objects
        .iter()
        .copied()
        .filter(|id| !prima.nodi.contains_key(id) && !ponte.ritoccati.contains(id))
        .filter(|id| {
            ora.nodi.get(id).is_some_and(|p| match &p.nodo.kind {
                NodeKind::Text(t) => t.runs.iter().all(|r| {
                    r.style.font_family == serie.font_family && r.style.size == serie.size
                }),
                _ => false,
            })
        })
        .collect();
    if nuovi.is_empty() {
        return Ok(());
    }
    let ids: Vec<u64> = nuovi.iter().map(|id| id.0).collect();
    sessione.execute(
        "text.setStyle",
        &json!({ "ids": ids, "font": TEXT_FONT, "size": ponte.corpo }),
    )?;
    ponte.ritoccati.extend(nuovi);
    Ok(())
}

/// Il `<text>` di un testo a punto orizzontale fatto da uno strumento del
/// motore: l'ancora (l'inizio della linea di base della prima riga), il
/// colore, il carattere e la misura del primo pezzo. Le righe le aggiunge
/// [`con_le_righe`]; un altro testo (in un'area, su un tracciato,
/// verticale) resta alla differenza, che non lo sa scrivere.
fn scrivi_testo(nodo: &Node, locale: Affine) -> Option<(String, Map<String, Value>)> {
    let NodeKind::Text(t) = &nodo.kind else {
        return None;
    };
    if t.vertical || !matches!(t.kind, TextKind::Point | TextKind::Area { .. }) {
        return None;
    }
    let primo = t.runs.first()?;
    let m = locale * t.xf;
    let ancora = m * Point::ZERO;
    // Un testo in area (lo strumento trascinato): `x` e `y` della sua prima
    // riga e la larghezza del riquadro, `fub:wrap` (K6 T16).
    let in_area = match t.kind {
        TextKind::Area { .. } => Some(differenza::righe_scritte(t, m, None).ok()?),
        _ => None,
    };
    let fill = match &primo.style.fill {
        Paint::Solid { color, .. } => color.to_hex(),
        _ => "#000000".into(),
    };
    let mut attrs = Map::new();
    match &in_area {
        Some(r) => {
            if let Some(w) = &r.wrap {
                attrs.insert("fub:wrap".into(), json!(w));
            }
            attrs.insert("x".into(), json!(r.x));
            attrs.insert("y".into(), json!(r.y));
        }
        None => {
            attrs.insert("x".into(), json!(numero(ancora.x, 2)));
            attrs.insert("y".into(), json!(numero(ancora.y, 2)));
        }
    }
    attrs.insert("fill".into(), json!(fill));
    // Il carattere di Fub si scrive come lo scrive il Testo del Semplice,
    // con il ripiego generico (`TEXT_FAMILY`).
    let famiglia = if primo.style.font_family == TEXT_FONT {
        TEXT_FAMILY
    } else {
        primo.style.font_family.as_str()
    };
    attrs.insert("font-family".into(), json!(famiglia));
    let corpo = primo.style.size * forme::scala(m);
    attrs.insert("font-size".into(), json!(numero(corpo, 2)));
    // Il peso, il corsivo, la spaziatura e l'allineamento, quando non sono
    // quelli di serie (K6 T16), come li scrive il pannello.
    let (peso, corsivo) = differenza::peso_e_corsivo(&primo.style.font_style);
    match peso {
        400 => {}
        700 => {
            attrs.insert("font-weight".into(), json!("bold"));
        }
        p => {
            attrs.insert("font-weight".into(), json!(p.to_string()));
        }
    }
    if corsivo {
        attrs.insert("font-style".into(), json!("italic"));
    }
    let spaziatura = primo.style.tracking / 1000.0 * corpo;
    if spaziatura.abs() >= 0.005 {
        attrs.insert("letter-spacing".into(), json!(numero(spaziatura, 2)));
    }
    match t.para.justify {
        vectorcraft_doc::text::Justify::Center => {
            attrs.insert("text-anchor".into(), json!("middle"));
        }
        vectorcraft_doc::text::Justify::Right => {
            attrs.insert("text-anchor".into(), json!("end"));
        }
        _ => {}
    }
    Some(("text".into(), attrs))
}

/// Le righe di un testo del motore come `tspan`, dall'ascissa `x` del
/// `<text>`, giù di un'interlinea del primo pezzo nello spazio di `m`.
fn righe_del_testo(t: &vectorcraft_doc::text::TextObject, x: &str, m: Affine) -> Vec<Value> {
    let interlinea = t
        .runs
        .first()
        .map(|r| r.style.effective_leading())
        .unwrap_or(0.0);
    let dy = numero(interlinea * forme::scala(m), 2);
    t.plain_text()
        .replace("\r\n", "\n")
        .split(['\n', '\r', '\u{2028}', '\u{2029}', '\u{3}'])
        .enumerate()
        .map(|(i, riga)| {
            let dy = if i == 0 { "0" } else { dy.as_str() };
            json!({ "tag": "tspan", "attrs": { "x": x, "dy": dy }, "text": riga })
        })
        .collect()
}

/// L'anteprima del testo che lo strumento sta scrivendo: il `<text>` nuovo
/// o cambiato nella sessione, in coordinate di scena, con le sue righe; per
/// un testo che c'era già, l'`id` di Fub, perché il client nasconda quello
/// del file mentre si scrive. `None` se nessun testo è cambiato o se il
/// testo non è di punto orizzontale.
fn testo_in_scrittura(sessione: &Session, copia: &Copia) -> Option<Value> {
    let stato = sessione.doc().ok()?;
    let dopo = stato.doc.clone();
    let prima = Posti::di(&copia.documento);
    let ora = Posti::di(&dopo);
    let mut cambiati: Vec<_> = ora
        .nodi
        .values()
        .filter(|p| {
            matches!(p.nodo.kind, NodeKind::Text(_))
                && prima
                    .nodi
                    .get(&p.nodo.id)
                    .is_none_or(|q| !Arc::ptr_eq(q.nodo, p.nodo) && q.nodo != p.nodo)
        })
        .collect();
    cambiati.sort_by_key(|p| p.nodo.id);
    let nodo = cambiati.first()?.nodo;
    let NodeKind::Text(t) = &nodo.kind else {
        return None;
    };
    let indietro = copia.radice.inverse();
    let (tag, mut attrs) = scrivi_testo(nodo, indietro)?;
    if let Some(id) = copia
        .mappa
        .del_nodo(nodo.id)
        .and_then(|i| copia.mappa.elemento(i))
        .and_then(|e| e.id_del_file().map(str::to_string))
    {
        attrs.insert("id".into(), json!(id));
    }
    let x = attrs["x"].as_str().unwrap_or("0").to_string();
    let figli = righe_del_testo(t, &x, indietro * t.xf);
    let forma = json!({ "tag": tag, "attrs": attrs, "children": figli });
    (serde_json::to_string(&forma).ok()?.len() <= fub_abi::MAX_DRAWING_OPS_BYTES).then_some(forma)
}

/// Le righe dei `<text>` nuovi in `ops` (anche dentro un `batch`), come
/// `tspan` col testo del motore: `scrivi_testo` dà solo l'elemento.
fn con_le_righe(
    ops: &str,
    differenza: &differenza::Differenza,
    dopo: &Document,
) -> Result<String, DrawingRefusal> {
    let mut lista: Value = serde_json::from_str(ops).map_err(|_| DrawingRefusal::Unsupported)?;
    let per_id: std::collections::HashMap<&str, NodeId> = differenza
        .ids
        .iter()
        .map(|(n, id)| (id.as_str(), *n))
        .collect();
    let mut cambiato = false;
    let mut righe = |op: &mut Value| {
        if op.get("op") != Some(&json!("add")) || op["elem"]["tag"] != json!("text") {
            return;
        }
        let elem = &mut op["elem"];
        let Some(nodo) = elem["attrs"]["id"]
            .as_str()
            .and_then(|id| per_id.get(id))
            .and_then(|n| dopo.node(*n))
        else {
            return;
        };
        let NodeKind::Text(t) = &nodo.kind else {
            return;
        };
        let x = elem["attrs"]["x"].as_str().unwrap_or("0").to_string();
        elem["children"] = match t.kind {
            TextKind::Area { .. } => match differenza::righe_scritte(t, t.xf, None) {
                Ok(r) => Value::Array(r.righe),
                Err(_) => return,
            },
            _ => Value::Array(righe_del_testo(t, &x, t.xf)),
        };
        cambiato = true;
    };
    match &mut lista {
        Value::Array(v) => v.iter_mut().for_each(|op| {
            if let Some(dentro) = op.get_mut("ops").and_then(Value::as_array_mut) {
                dentro.iter_mut().for_each(&mut righe);
            } else {
                righe(op);
            }
        }),
        op => righe(op),
    }
    if !cambiato {
        return Ok(ops.to_string());
    }
    let fuori = serde_json::to_string(&lista).map_err(|_| DrawingRefusal::Unsupported)?;
    if fuori.len() > fub_abi::MAX_DRAWING_OPS_BYTES {
        return Err(DrawingRefusal::TooLarge);
    }
    Ok(fuori)
}

/// Annulla il gesto in corso: l'interazione del motore si ferma (lo
/// strumento butta ciò che teneva a metà) e la sessione torna alla copia.
pub(crate) fn annulla(banco: &mut Banco, copia: &Copia) {
    let sessione = &mut banco.sessione;
    let _ = vectorcraft_engine::guard::catch_panic(|| sessione.cancel_interaction());
    banco.ripristina(copia);
}

/// `disegno.strumento.opzione`: l'opzione `chiave` dello strumento
/// `strumento` vale `valore`. Lo strumento diventa quello attivo (un gesto di
/// un altro strumento si annulla prima); l'opzione resta per i gesti dopo,
/// come la tiene il motore. L'esito porta lo stato con le opzioni di adesso.
pub(crate) fn opzione(
    banco: &mut Banco,
    copia: &Copia,
    revisione: u64,
    strumento: &str,
    chiave: &str,
    valore: &Value,
) -> DrawingOutcome {
    scegli(banco, copia, revisione, strumento, Some((chiave, valore)))
}

/// `disegno.strumento.stato`: lo stato dello strumento `strumento`, senza
/// cambiare niente. Lo strumento diventa quello attivo, come per
/// [`opzione`]; il documento, la selezione e la cronologia restano come
/// sono. Il client lo chiede quando la famiglia dello strumento è pronta,
/// così la fila delle opzioni c'è prima del primo gesto.
pub(crate) fn stato_dello_strumento(
    banco: &mut Banco,
    copia: &Copia,
    revisione: u64,
    strumento: &str,
) -> DrawingOutcome {
    scegli(banco, copia, revisione, strumento, None)
}

/// Sceglie lo strumento `strumento` (un gesto di un altro strumento si
/// annulla prima), gli dà l'opzione se c'è, e rende il suo stato.
fn scegli(
    banco: &mut Banco,
    copia: &Copia,
    revisione: u64,
    strumento: &str,
    opzione: Option<(&str, &Value)>,
) -> DrawingOutcome {
    let mut esito = esito_vuoto(revisione);
    if !conosciuto(strumento) {
        esito.refused = Some(DrawingRefusal::UnknownTool);
        return esito;
    }
    let stesso = matches!(
        banco.in_corso.as_ref().map(|c| &c.tool),
        Some(fub_abi::DrawingTool::Engine { id }) if id == strumento
    );
    if banco.in_corso.is_some() && !stesso {
        annulla(banco, copia);
    }
    let vista = ViewInfo::default();
    let (sessione, ponte) = (&mut banco.sessione, &banco.ponte);
    let fatto = vectorcraft_engine::guard::catch_panic(|| {
        if sessione.tool_id() != strumento {
            sessione.select_tool(strumento, vista)?;
        }
        if let Some((chiave, valore)) = opzione {
            sessione.set_tool_option(chiave, valore);
        }
        Ok::<_, EngineError>(stato(sessione, ponte, copia, vista))
    });
    match fatto {
        Ok(Ok(s)) => esito.state = Some(s),
        Ok(Err(_)) | Err(_) => {
            banco.ripristina(copia);
            esito.refused = Some(DrawingRefusal::Unsupported);
        }
    }
    esito
}

/// Prima del primo evento: le preferenze del motore come all'apertura (gli
/// strumenti di K5 ne cambiano alcune), lo strumento, lo stile, il livello e
/// la selezione di Fub.
fn prepara(
    sessione: &mut Session,
    prefs: &vectorcraft_engine::Prefs,
    id: &str,
    cx: &Contesto<'_>,
) -> Result<(), DrawingRefusal> {
    // Le opzioni tenute degli strumenti restano: sono del motore, non del
    // gesto.
    let tenute = std::mem::take(&mut sessione.prefs.tool_settings);
    let raggio = sessione.prefs.corner_radius;
    sessione.prefs = prefs.clone();
    sessione.prefs.tool_settings = tenute;
    sessione.prefs.corner_radius = raggio;
    // Un testo nuovo nasce vuoto: il segnaposto del motore è in inglese, e
    // un clic seguito da Esc lascerebbe nel disegno parole non scritte
    // (K6 T16, come il Testo di K5).
    sessione.prefs.placeholder_text = false;
    sessione
        .select_tool(id, cx.vista)
        .map_err(|_| DrawingRefusal::Unsupported)?;
    // Il livello scelto nel menu, anche se bloccato o nascosto: lì decide
    // il motore, come nell'editor; senza, quello delle forme di Fub.
    let livello = match cx.gesto.layer.as_deref() {
        Some(l) => cx
            .copia
            .mappa
            .dell_id(l)
            .and_then(|i| cx.copia.mappa.elemento(i))
            .and_then(|e| e.nodo),
        None => forme::destinazione(cx).ok().and_then(|d| d.livello),
    };
    if let Some(stile) = &cx.gesto.style {
        let al_motore = forme::destinazione(cx)
            .map(|d| d.al_motore)
            .unwrap_or(cx.copia.radice);
        sessione.paint = forme::pittura(stile, al_motore)?;
    }
    let scelti: Vec<NodeId> = cx
        .gesto
        .selection
        .iter()
        .filter_map(|id| cx.copia.mappa.dell_id(id))
        .filter_map(|i| cx.copia.mappa.elemento(i)?.nodo)
        .collect();
    let punti = punti_del_gesto(cx);
    let stato = sessione
        .doc_mut()
        .map_err(|_| DrawingRefusal::Unsupported)?;
    stato.active_layer = livello;
    stato.isolation = None;
    stato.selection = Selection::default();
    // Un tracciato scelto senza punti è scelto intero, come in VectorCraft:
    // la Selezione diretta lo trascina intero da un suo punto, e un clic
    // sceglie quel punto da solo.
    scelti.iter().for_each(|n| stato.selection.add(*n));
    for (n, set) in punti {
        stato.selection.add(n);
        stato.selection.anchors.entry(n).or_default().extend(set);
    }
    Ok(())
}

/// Quanto lontano, in unità della scena, un punto scelto si riconosce ancora.
const TOLLERANZA_DEI_PUNTI: f64 = 1e-3;

/// I punti scelti che il gesto porta (`DrawingGesture::anchors`, gli ultimi
/// che lo stato dello strumento ha detto), per oggetto del motore. Uno su un
/// elemento che il motore non conosce, o che non sta più dove il client l'ha
/// visto (il disegno è cambiato sotto), si lascia: il gesto vale sugli altri.
fn punti_del_gesto(cx: &Contesto<'_>) -> BTreeMap<NodeId, BTreeSet<(usize, usize)>> {
    let mut fuori: BTreeMap<NodeId, BTreeSet<(usize, usize)>> = BTreeMap::new();
    let indietro = cx.copia.radice.inverse();
    for punto in &cx.gesto.anchors {
        let Some(nodo) = cx
            .copia
            .mappa
            .dell_id(&punto.element)
            .and_then(|i| cx.copia.mappa.elemento(i))
            .and_then(|e| e.nodo)
        else {
            continue;
        };
        let (si, ai) = (punto.subpath as usize, punto.anchor as usize);
        let qui = cx
            .copia
            .documento
            .node(nodo)
            .and_then(|n| n.path_data())
            .and_then(|pd| pd.subpaths.get(si))
            .and_then(|sp| sp.anchors.get(ai))
            .map(|a| in_scena(a.p, indietro));
        let Some(qui) = qui else { continue };
        if (qui[0] - punto.at[0]).abs() > TOLLERANZA_DEI_PUNTI
            || (qui[1] - punto.at[1]).abs() > TOLLERANZA_DEI_PUNTI
        {
            continue;
        }
        fuori.entry(nodo).or_default().insert((si, ai));
    }
    fuori
}

/// La griglia di Fub, come per le forme: senza Ctrl/⌘ e con la griglia
/// accesa, il punto va sul passo.
fn sulla_griglia(mut e: DrawingPointer, cx: &Contesto<'_>) -> DrawingPointer {
    let snap = cx.gesto.snap;
    if let Some(passo) = snap.grid.filter(|_| !snap.free && !e.cmd) {
        e.x = forme::sulla_griglia(e.x, passo);
        e.y = forme::sulla_griglia(e.y, passo);
    }
    e
}

/// Un ingresso da tastiera allo strumento.
fn ingresso(
    sessione: &mut Session,
    ponte: &mut Ponte,
    i: &DrawingInput,
    vista: ViewInfo,
) -> Result<(), EngineError> {
    match i {
        DrawingInput::Key {
            key,
            code,
            mods,
            pressed,
        } => {
            if key == " " || code == "Space" {
                // Lo spazio tenuto è un modificatore (la penna sposta il
                // punto che sta mettendo).
                ponte.mods.space = *pressed;
                return Ok(());
            }
            if !pressed {
                return Ok(());
            }
            let Some(tasto) = tasto(key, code) else {
                return Ok(());
            };
            let m = Mods {
                shift: mods.shift,
                alt: mods.alt,
                cmd: mods.cmd,
                ctrl: mods.ctrl,
                space: ponte.mods.space,
            };
            sessione.tool_key(tasto, m, vista).map(drop)
        }
        DrawingInput::Text { text } => sessione.tool_text(text, vista).map(drop),
        DrawingInput::Ime { preedit, active } => {
            let parte = active.map(|[da, a]| da as usize..a as usize);
            sessione.tool_preedit(preedit, parte, vista).map(drop)
        }
    }
}

/// Il tasto del motore per `key` e `code` di `KeyboardEvent`; `None` per un
/// tasto che gli strumenti non guardano. Una lettera o una cifra si legge
/// da `key` (la disposizione della tastiera), e da `code` se `key` non è
/// latino.
pub(crate) fn tasto(key: &str, code: &str) -> Option<ToolKey> {
    let nominato = match key {
        "Enter" => Some(ToolKey::Enter),
        "Escape" => Some(ToolKey::Escape),
        "Backspace" => Some(ToolKey::Backspace),
        "Delete" => Some(ToolKey::Delete),
        "ArrowUp" => Some(ToolKey::Up),
        "ArrowDown" => Some(ToolKey::Down),
        "ArrowLeft" => Some(ToolKey::Left),
        "ArrowRight" => Some(ToolKey::Right),
        "Tab" => Some(ToolKey::Tab),
        "Home" => Some(ToolKey::Home),
        "End" => Some(ToolKey::End),
        "[" => Some(ToolKey::BracketLeft),
        "]" => Some(ToolKey::BracketRight),
        _ => None,
    };
    if nominato.is_some() {
        return nominato;
    }
    let mut c = key.chars();
    if let (Some(ch), None) = (c.next(), c.next()) {
        if let Some(d) = ch.to_digit(10) {
            return Some(ToolKey::Digit(d as u8));
        }
        if ch.is_ascii_alphabetic() {
            return Some(ToolKey::Letter(ch.to_ascii_lowercase()));
        }
    }
    match code {
        "BracketLeft" => Some(ToolKey::BracketLeft),
        "BracketRight" => Some(ToolKey::BracketRight),
        _ => {
            let cifra = code
                .strip_prefix("Digit")
                .or_else(|| code.strip_prefix("Numpad"));
            if let Some(d) = cifra.and_then(|d| d.parse::<u8>().ok()).filter(|d| *d < 10) {
                return Some(ToolKey::Digit(d));
            }
            let lettera = code.strip_prefix("Key").filter(|l| l.len() == 1)?;
            let ch = lettera.chars().next()?;
            ch.is_ascii_alphabetic()
                .then(|| ToolKey::Letter(ch.to_ascii_lowercase()))
        }
    }
}

/// Lo stato dello strumento adesso. `busy` vale anche quando il gesto ha
/// cambiato il documento e non è ancora chiuso (la penna fra un clic e
/// l'altro, che il motore non conta come interazione in corso): il client
/// deve ancora mandare `commit` o `cancel`.
fn stato(
    sessione: &mut Session,
    ponte: &Ponte,
    copia: &Copia,
    vista: ViewInfo,
) -> DrawingToolState {
    let cambiato = match (&ponte.inizio, sessione.doc()) {
        (Some(prima), Ok(d)) => !Arc::ptr_eq(prima, &d.doc),
        _ => false,
    };
    let punto = ponte.punto.unwrap_or(copia.radice * Point::ORIGIN);
    let anchors = punti_scelti(sessione, copia);
    DrawingToolState {
        busy: sessione.tool_busy() || cambiato,
        transforming: sessione.tool_transforming(),
        wants_text: sessione.tool_wants_text(),
        composing: sessione.tool_composing(),
        cursor: cursore(sessione.cursor(punto, ponte.mods, vista)),
        options: sessione.tool_options(),
        anchors,
    }
}

/// I punti di ancoraggio scelti nella sessione, sugli elementi della copia
/// che hanno un id (quelli di un oggetto appena nato non si possono ancora
/// nominare): dove stanno in scena, e se sono l'estremo di un sottotracciato
/// aperto. Al più [`MAX_DRAWING_ANCHORS`], i primi.
fn punti_scelti(sessione: &Session, copia: &Copia) -> Vec<DrawingAnchor> {
    let Ok(stato) = sessione.doc() else {
        return Vec::new();
    };
    let indietro = copia.radice.inverse();
    let mut fuori = Vec::new();
    for (nodo, set) in &stato.selection.anchors {
        let Some(element) = copia
            .mappa
            .del_nodo(*nodo)
            .and_then(|i| copia.mappa.elemento(i))
            .and_then(|e| e.id.clone())
        else {
            continue;
        };
        let Some(pd) = stato.doc.node(*nodo).and_then(|n| n.path_data()) else {
            continue;
        };
        for &(si, ai) in set {
            let Some(sp) = pd.subpaths.get(si) else {
                continue;
            };
            let Some(a) = sp.anchors.get(ai) else {
                continue;
            };
            let (Ok(subpath), Ok(anchor)) = (u32::try_from(si), u32::try_from(ai)) else {
                continue;
            };
            if fuori.len() >= MAX_DRAWING_ANCHORS {
                return fuori;
            }
            fuori.push(DrawingAnchor {
                element: element.clone(),
                subpath,
                anchor,
                at: in_scena(a.p, indietro),
                end: !sp.closed && (ai == 0 || ai + 1 == sp.anchors.len()),
            });
        }
    }
    fuori
}

/// Il nome di un cursore del motore in `snake_case`: `PenClose` è
/// `pen_close`, `RotateToward(3)` è `rotate_toward_3`.
pub(crate) fn cursore(c: Cursor) -> String {
    let (nome, numero) = match serde_json::to_value(c) {
        Ok(Value::String(s)) => (s, None),
        Ok(Value::Object(o)) => match o.into_iter().next() {
            Some((k, v)) => (k, v.as_u64()),
            None => return "arrow".into(),
        },
        _ => return "arrow".into(),
    };
    let mut fuori = String::new();
    for (i, ch) in nome.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if i > 0 {
                fuori.push('_');
            }
            fuori.push(ch.to_ascii_lowercase());
        } else {
            fuori.push(ch);
        }
    }
    if let Some(n) = numero {
        fuori.push('_');
        fuori.push_str(&n.to_string());
    }
    fuori
}

/// Il ruolo di un colore che il motore dà a un segno: la tabella dei colori
/// che gli strumenti usano. Un colore che qui non c'è (il colore di un
/// livello, gli avvisi) è ciò che il gesto disegna: `preview`.
pub(crate) fn ruolo(c: [u8; 3], guide: [u8; 3]) -> DrawingOverlayRole {
    use DrawingOverlayRole::*;
    if c == guide {
        return Guide;
    }
    match c {
        // La selezione e i ritorni degli strumenti (`FEEDBACK`, `BLUE`,
        // `HIGHLIGHT`, `CYAN`), il testo scelto.
        [0x4f, 0x9d, 0xff]
        | [0x4a, 0x7c, 0xff]
        | [0x00, 0xa8, 0xff]
        | [0x00, 0x00, 0xff]
        | [20, 20, 230]
        | [60, 120, 255] => Selection,
        // Le guide magnetiche (`guides::MAGENTA`) e quelle del righello.
        [0xff, 0x3d, 0xfc] | [0x4a, 0xff, 0xff] => Guide,
        // I tre piani e la linea dell'orizzonte della prospettiva.
        [0x33, 0x66, 0xff] | [0xff, 0x8c, 0x1a] | [0x2e, 0xb8, 0x4a] | [0x99, 0x99, 0x99] => {
            Perspective
        }
        // Le misure (lo strumento Misura, il grigio delle linee di prova).
        [0xff, 0x8a, 0x00] | [0x80, 0x80, 0x80] => Measure,
        _ => Preview,
    }
}

/// Un punto del documento del motore in coordinate di scena.
fn in_scena(p: Point, indietro: Affine) -> DrawingPoint {
    let q = indietro * p;
    [q.x, q.y]
}

/// `d` di SVG per un tracciato già in coordinate di scena, a tre decimali.
fn d_di(path: &BezPath) -> String {
    let n = |v: f64| numero(v, 3);
    let mut d = String::new();
    for el in path.elements() {
        if !d.is_empty() {
            d.push(' ');
        }
        match el {
            PathEl::MoveTo(p) => d.push_str(&format!("M{} {}", n(p.x), n(p.y))),
            PathEl::LineTo(p) => d.push_str(&format!("L{} {}", n(p.x), n(p.y))),
            PathEl::QuadTo(a, p) => {
                d.push_str(&format!("Q{} {} {} {}", n(a.x), n(a.y), n(p.x), n(p.y)))
            }
            PathEl::CurveTo(a, b, p) => d.push_str(&format!(
                "C{} {} {} {} {} {}",
                n(a.x),
                n(a.y),
                n(b.x),
                n(b.y),
                n(p.x),
                n(p.y)
            )),
            PathEl::ClosePath => d.push('Z'),
        }
        if d.len() > MAX_DRAWING_OVERLAY_PATH_BYTES {
            break;
        }
    }
    d
}

/// Un testo del motore entro il tetto, tagliato su un confine di carattere.
fn testo(t: String) -> String {
    if t.len() <= MAX_DRAWING_OVERLAY_TEXT_BYTES {
        return t;
    }
    let mut fine = MAX_DRAWING_OVERLAY_TEXT_BYTES;
    while !t.is_char_boundary(fine) {
        fine -= 1;
    }
    t[..fine].to_string()
}

/// Un segno del motore come lo vede il client; `None` per un segno che non
/// si può dire (un tracciato oltre il tetto, un numero non finito). Il
/// `match` è esaustivo: un tipo nuovo del motore non compila senza la sua
/// forma.
fn segno(o: Overlay, radice: Affine, sessione: &Session) -> Option<DrawingOverlay> {
    let indietro = radice.inverse();
    let guide = rgb_guide(sessione);
    let r = |c: [u8; 3]| ruolo(c, guide);
    let p = |q: Point| in_scena(q, indietro);
    let segno = match o {
        Overlay::Marquee(rect) => {
            let b = indietro.transform_rect_bbox(rect);
            DrawingOverlay::Marquee {
                rect: [b.x0, b.y0, b.width(), b.height()],
            }
        }
        Overlay::Path {
            path,
            color,
            width,
            dashed,
        } => {
            let d = d_di(&(indietro * path));
            if d.len() > MAX_DRAWING_OVERLAY_PATH_BYTES {
                return None;
            }
            DrawingOverlay::Path {
                d,
                role: r(color),
                width: f64::from(width),
                dashed,
            }
        }
        Overlay::Line {
            a,
            b,
            color,
            dashed,
        } => DrawingOverlay::Line {
            a: p(a),
            b: p(b),
            role: r(color),
            dashed,
        },
        Overlay::Anchor {
            p: q,
            color,
            filled,
            size,
        } => DrawingOverlay::Anchor {
            at: p(q),
            role: r(color),
            filled,
            size: f64::from(size),
        },
        Overlay::CurvePoint {
            p: q,
            color,
            filled,
            size,
        } => DrawingOverlay::CurvePoint {
            at: p(q),
            role: r(color),
            filled,
            size: f64::from(size),
        },
        Overlay::Handle { p: q, color } => DrawingOverlay::Handle {
            at: p(q),
            role: r(color),
        },
        Overlay::Label { p: q, text, color } => DrawingOverlay::Label {
            at: p(q),
            text: testo(text),
            role: r(color),
        },
        Overlay::Measure { p: q, text } => DrawingOverlay::Measure {
            at: p(q),
            text: testo(text),
        },
        Overlay::Distance { a, b, text, color } => DrawingOverlay::Distance {
            a: p(a),
            b: p(b),
            text: testo(text),
            role: r(color),
        },
        Overlay::Highlight { quad, color } => DrawingOverlay::Highlight {
            quad: quad.map(p),
            role: r([color[0], color[1], color[2]]),
        },
        Overlay::Swatch {
            p: q,
            color,
            selected,
        } => DrawingOverlay::Swatch {
            at: p(q),
            color: format!(
                "#{:02x}{:02x}{:02x}{:02x}",
                color[0], color[1], color[2], color[3]
            ),
            selected,
        },
        Overlay::GridLine { a, b, .. } => DrawingOverlay::GridLine {
            a: p(a),
            b: p(b),
            role: DrawingOverlayRole::Perspective,
        },
    };
    segno.validate().is_ok().then_some(segno)
}

/// Il colore delle guide magnetiche nelle preferenze della sessione.
fn rgb_guide(sessione: &Session) -> [u8; 3] {
    let hex = sessione.prefs.smart_guide_color.trim_start_matches('#');
    let byte = |i: usize| {
        hex.get(i..i + 2)
            .and_then(|h| u8::from_str_radix(h, 16).ok())
    };
    match (byte(0), byte(2), byte(4)) {
        (Some(r), Some(g), Some(b)) if hex.len() == 6 => [r, g, b],
        _ => vectorcraft_engine::tools::guides::MAGENTA,
    }
}

/// I contorni dei tracciati che un comando ha fatto o cambiato in `dopo`
/// rispetto alla copia, in coordinate di scena: l'anteprima di un comando con
/// finestra (K6 T12). Solo i contorni, che stanno nei limiti del contratto:
/// un contorno troppo lungo per un segno si salta, e i segni si fermano a
/// [`MAX_DRAWING_OVERLAYS`].
pub(crate) fn contorni_cambiati(copia: &Copia, dopo: &Document) -> Vec<DrawingOverlay> {
    let indietro = copia.radice.inverse();
    let prima = Posti::di(&copia.documento);
    let ora = Posti::di(dopo);
    let mut cambiati: Vec<_> = ora
        .nodi
        .values()
        .filter(|p| {
            p.nodo.path_data().is_some()
                && prima
                    .nodi
                    .get(&p.nodo.id)
                    .is_none_or(|q| !Arc::ptr_eq(q.nodo, p.nodo))
        })
        .collect();
    cambiati.sort_by_key(|p| p.nodo.id);
    cambiati
        .into_iter()
        .filter_map(|p| {
            let d = d_di(&(indietro * p.nodo.path_data()?.to_bezpath()));
            (d.len() <= MAX_DRAWING_OVERLAY_PATH_BYTES).then_some(DrawingOverlay::Path {
                d,
                role: DrawingOverlayRole::Preview,
                width: 1.0,
                dashed: false,
            })
        })
        .take(MAX_DRAWING_OVERLAYS)
        .collect()
}

/// I contorni e i punti dei tracciati che il gesto ha fatto o cambiato e
/// che il client non ha ancora: la penna fra un clic e l'altro tiene il
/// tracciato nella sessione, e l'editor del motore lo mostra scelto: per il
/// client è un segno della selezione.
fn segni_nuovi(sessione: &Session, ponte: &Ponte, copia: &Copia) -> Vec<DrawingOverlay> {
    let Ok(stato) = sessione.doc() else {
        return Vec::new();
    };
    let dopo = stato.doc.clone();
    if ponte.inizio.as_ref().is_some_and(|d| Arc::ptr_eq(d, &dopo)) {
        return Vec::new();
    }
    let indietro = copia.radice.inverse();
    let prima = Posti::di(&copia.documento);
    let ora = Posti::di(&dopo);
    let mut nuovi: Vec<_> = ora
        .nodi
        .values()
        .filter(|p| {
            p.nodo.path_data().is_some()
                && prima
                    .nodi
                    .get(&p.nodo.id)
                    .is_none_or(|q| !Arc::ptr_eq(q.nodo, p.nodo))
        })
        .collect();
    nuovi.sort_by_key(|p| p.nodo.id);
    let mut fuori = Vec::new();
    for p in nuovi {
        let Some(pd) = p.nodo.path_data() else {
            continue;
        };
        let d = d_di(&(indietro * pd.to_bezpath()));
        if d.len() <= MAX_DRAWING_OVERLAY_PATH_BYTES {
            fuori.push(DrawingOverlay::Path {
                d,
                role: DrawingOverlayRole::Selection,
                width: 1.0,
                dashed: false,
            });
        }
        for sp in &pd.subpaths {
            for a in &sp.anchors {
                fuori.push(DrawingOverlay::Anchor {
                    at: in_scena(a.p, indietro),
                    role: DrawingOverlayRole::Selection,
                    filled: false,
                    size: f64::from(sessione.prefs.anchor_size.max(1)) * 2.0 + 1.0,
                });
            }
        }
        if fuori.len() >= MAX_DRAWING_OVERLAYS / 2 {
            break;
        }
    }
    fuori
}
