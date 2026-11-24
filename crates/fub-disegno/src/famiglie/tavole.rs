//! La famiglia `tavole` della mappa: le tavole (lo strumento `artboard` e i
//! comandi `artboard.*`, che il ponte `crate::tavole` scrive nel file) e la
//! Quota di VectorCraft (`dimension.*`,
//! `vendor/vectorcraft/crates/engine/src/cmd/dimension.rs`). Lo stato non
//! tiene niente; la famiglia traduce le quote (`ids`, `id`) e gli oggetti
//! misurati (`source`) dall'id del file al nodo del motore.
//!
//! I comandi delle tavole ricevono le misure nelle coordinate del file (il
//! `viewBox` delle tavole): la famiglia le porta nel documento del motore con
//! la matrice della radice. Il colore, il blocco e i segni di una tavola
//! (`color`, `locked`, `showCenterMark`, `showCrossHairs`,
//! `showVideoSafeAreas`, `videoRulerPixelAspectRatio`) il file non li tiene
//! ancora (`docs/reference/scene-format-boards.md`, §8): un valore diverso da
//! quello di serie è un argomento rifiutato, invece di un cambio che sparisce
//! al salvataggio.
//!
//! Il legame di una quota con l'oggetto che misura vive solo nel gesto: la
//! ricetta lo toglie quando punta fuori dalla quota (`ricetta::codifica`),
//! perché gli id del motore si rinumerano a ogni lettura del file.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::NodeId;
use vectorcraft_geom::Affine;

use super::{nodi_scelti, selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        0
    }

    fn libera(&self) -> u64 {
        0
    }

    /// Come in VectorCraft: Aggiorna vuole solo quote fra gli oggetti scelti,
    /// Applica a tutti una quota scelta. Un oggetto scelto che il motore non
    /// ha, o bloccato, spegne ogni comando; una copia di sola lettura spegne
    /// quelli che cambiano il disegno.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if e_delle_guide(id) {
            // Crea guide prende i tracciati scelti: un pezzo che il motore
            // non ha, o bloccato, lo spegne come gli altri comandi.
            if id == "view.guides.make" {
                if let Some(r) = selezione_spenta(copia, selezione) {
                    return Some(r);
                }
            }
            return guida_spenta(id, copia);
        }
        if id.starts_with("artboard.") {
            return tavola_spenta(id, copia, selezione);
        }
        if !id.starts_with("dimension.") {
            return None;
        }
        let sulle_quote = id == "dimension.update" || id == "dimension.applyToAll";
        if sulle_quote && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if let Some(r) = selezione_spenta(copia, selezione) {
            return Some(r);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let nodi = nodi_scelti(copia, selezione).unwrap_or_default();
        let senza = match id {
            "dimension.update" => !nodi.iter().all(|n| e_quota(copia, *n)),
            "dimension.applyToAll" => !nodi.iter().any(|n| e_quota(copia, *n)),
            _ => false,
        };
        senza.then(|| DrawingDisabledReason::Other {
            text: "Seleziona una quota.".into(),
        })
    }

    /// Le guide si leggono con gli id del file: la posizione nelle coordinate
    /// del file, la tavola (`board`) e il livello (`layer`) coi loro id, e il
    /// blocco della guida nel file (`locked`).
    fn lettura(&self, id: &str, copia: &Copia, mut risultato: Value) -> Value {
        if id == "guide.list" {
            if let Some(righe) = risultato.as_array_mut() {
                for (i, riga) in righe.iter_mut().enumerate() {
                    guida_letta(copia, i, riga);
                }
            }
        }
        risultato
    }

    /// Una guida bloccata nel file non si sposta, non cambia livello, non si
    /// toglie e non diventa un tracciato da sola: il comando che la nomina
    /// (`index`, `indexes` o fra le scelte `guides`) si rifiuta.
    fn rifiuto_valore(
        id: &str,
        copia: &Copia,
        _selezione: &[String],
        valore: &Value,
    ) -> Option<DrawingRefusal> {
        if !matches!(
            id,
            "guide.move" | "guide.remove" | "guide.setLayer" | "view.guides.release"
        ) {
            return None;
        }
        let indici = ["index"]
            .into_iter()
            .filter_map(|k| valore.get(k))
            .chain(
                ["indexes", "guides"]
                    .into_iter()
                    .filter_map(|k| valore.get(k).and_then(Value::as_array))
                    .flatten(),
            )
            .filter_map(Value::as_u64)
            .filter_map(|i| usize::try_from(i).ok());
        indici
            .into_iter()
            .any(|i| copia.guide.bloccata(i))
            .then_some(DrawingRefusal::Locked)
    }

    /// Gli `ids` di Aggiorna, l'`id` di Applica a tutti e i nodi della
    /// sorgente di Crea (`source`: `edge`, `first`, `second`, `a`, `b`,
    /// `vertex` coi loro `node`, o `node` per un cerchio), come id del file,
    /// diventano nodi del motore.
    fn argomenti_della_copia(
        id: &str,
        copia: &Copia,
        selezione: &[String],
        mut valore: Value,
    ) -> Result<Value, PluginError> {
        match id {
            "dimension.update" => {
                if let Some(ids) = valore.get_mut("ids").and_then(Value::as_array_mut) {
                    for id in ids {
                        if let Some(file) = id.as_str() {
                            *id = Value::from(nodo_del_file(copia, file)?.0);
                        }
                    }
                }
            }
            "dimension.applyToAll" => {
                if let Some(file) = valore.get("id").and_then(Value::as_str).map(str::to_string) {
                    valore["id"] = Value::from(nodo_del_file(copia, &file)?.0);
                }
            }
            "dimension.create" => {
                if let Some(sorgente) = valore.get_mut("source").and_then(Value::as_object_mut) {
                    for chiave in ["edge", "first", "second", "a", "b", "vertex"] {
                        if let Some(r) = sorgente.get_mut(chiave) {
                            nodo_nel_riferimento(copia, r)?;
                        }
                    }
                    if let Some(file) = sorgente.get("node").and_then(Value::as_str).map(str::to_string) {
                        sorgente.insert("node".into(), Value::from(nodo_del_file(copia, &file)?.0));
                    }
                }
            }
            // Dal menu Oggetto › Tavole arrivano senza tavola: VectorCraft passa
            // la tavola attiva, Fub quella che ha il centro degli oggetti scelti,
            // o la prima.
            "artboard.fitToArt" | "artboard.fitToSelection"
                if valore.get("index").is_none() && valore.get("indices").is_none() =>
            {
                let attiva = tavola_della_selezione(copia, selezione).unwrap_or(0);
                if let Some(o) = valore.as_object_mut() {
                    o.insert("index".into(), Value::from(attiva));
                } else if valore.is_null() {
                    valore = serde_json::json!({ "index": attiva });
                }
            }
            "artboard.new" | "artboard.setProps" | "artboard.move" | "artboard.rearrange" => {
                misure_nel_motore(&mut valore, copia.radice)?;
                if let Some(tavole) = valore.get_mut("artboards").and_then(Value::as_array_mut) {
                    for t in tavole {
                        misure_nel_motore(t, copia.radice)?;
                    }
                }
            }
            "guide.add" | "guide.move" | "guide.setLayer" => {
                guida_nel_motore(copia, &mut valore)?;
            }
            "view.guides.release" => {
                if let Some(ids) = valore.get_mut("ids").and_then(Value::as_array_mut) {
                    for id in ids {
                        if let Some(file) = id.as_str() {
                            *id = Value::from(nodo_del_file(copia, file)?.0);
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(valore)
    }
}

/// Vero per un comando delle guide del righello.
fn e_delle_guide(id: &str) -> bool {
    id.starts_with("guide.") || id.starts_with("view.guides.")
}

/// Perché un comando delle guide è spento: la lista e il blocco della
/// sessione non cambiano il file; gli altri vogliono una copia modificabile e
/// guide che il file lascia cambiare (`crate::guide`).
fn guida_spenta(id: &str, copia: &Copia) -> Option<DrawingDisabledReason> {
    if matches!(id, "guide.list" | "view.guides.lock") {
        return None;
    }
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    copia.guide.ferme.map(|motivo| DrawingDisabledReason::Other {
        text: format!("{}{}.", motivo[..1].to_uppercase(), &motivo[1..]),
    })
}

/// Gli indici delle guide scelte (`guides`), tolti dal valore: il motore li
/// vuole nella sua selezione, che fra due comandi non resta. Un indice che
/// non è una guida è un argomento rifiutato.
pub(crate) fn guide_scelte(copia: &Copia, valore: &mut Value) -> Result<Vec<usize>, PluginError> {
    let Some(lista) = valore.as_object_mut().and_then(|o| o.remove("guides")) else {
        return Ok(Vec::new());
    };
    let quante = copia.documento.guides.len();
    let Some(lista) = lista.as_array() else {
        return Err(PluginError::BadArgs("«guides» è un elenco di indici.".into()));
    };
    let mut scelte = Vec::with_capacity(lista.len());
    for v in lista.iter().take(10_000) {
        match v.as_u64().and_then(|i| usize::try_from(i).ok()) {
            Some(i) if i < quante => {
                if !scelte.contains(&i) {
                    scelte.push(i);
                }
            }
            _ => {
                return Err(PluginError::BadArgs(
                    format!("«guides»: {v} non è una guida del disegno.").into(),
                ))
            }
        }
    }
    Ok(scelte)
}

/// La posizione (`pos`) e gli spostamenti (`dx`, `dy`) di una guida dal file
/// al motore, e il livello (`layer`) dall'id del file al nodo.
fn guida_nel_motore(copia: &Copia, valore: &mut Value) -> Result<(), PluginError> {
    let Some(o) = valore.as_object_mut() else {
        return Ok(());
    };
    let [a, _, _, d, _, _] = copia.radice.as_coeffs();
    if let Some(pos) = o.get("pos").and_then(Value::as_f64) {
        // `guide.move` con l'indice: l'asse è quello della guida.
        let verticale = match o.get("index").and_then(Value::as_u64) {
            Some(i) => usize::try_from(i)
                .ok()
                .and_then(|i| copia.documento.guides.get(i))
                .is_some_and(|g| g.vertical),
            None => o.get("vertical").and_then(Value::as_bool).unwrap_or(false),
        };
        o.insert(
            "pos".into(),
            Value::from(crate::guide::nel_motore(copia.radice, verticale, pos)),
        );
    }
    for (chiave, scala) in [("dx", a), ("dy", d)] {
        if let Some(v) = o.get(chiave).and_then(Value::as_f64) {
            o.insert(chiave.into(), Value::from(v * scala));
        }
    }
    if let Some(file) = o.get("layer").and_then(Value::as_str).map(str::to_string) {
        let nodo = crate::guide::livello_del_file(&copia.mappa, &copia.documento, &file)
            .ok_or_else(|| PluginError::BadArgs(format!("«{file}» non è un livello del disegno.").into()))?;
        o.insert("layer".into(), Value::from(nodo.0));
    }
    Ok(())
}

/// Una riga di `guide.list` con gli id del file.
fn guida_letta(copia: &Copia, i: usize, riga: &mut Value) {
    let Some(o) = riga.as_object_mut() else {
        return;
    };
    let verticale = o.get("vertical").and_then(Value::as_bool).unwrap_or(false);
    if let Some(pos) = o.get("pos").and_then(Value::as_f64) {
        let nel_file = crate::guide::nel_file(copia.radice, verticale, pos);
        o.insert("pos".into(), Value::from(nel_file));
    }
    let tavola = copia.documento.guides.get(i).and_then(|g| g.artboard).and_then(|t| {
        copia
            .tavole
            .del_file
            .iter()
            .find(|d| d.motore == t)
            .map(|d| d.id.clone())
    });
    if let Some(t) = tavola {
        o.insert("board".into(), Value::from(t));
    }
    let livello = o
        .get("layer")
        .and_then(Value::as_u64)
        .and_then(|n| copia.mappa.del_nodo(NodeId(n)))
        .and_then(|e| copia.mappa.elemento(e))
        .and_then(|e| e.id_del_file().map(str::to_string));
    match livello {
        Some(l) => {
            o.insert("layer".into(), Value::from(l));
        }
        None => {
            o.remove("layer");
        }
    }
    o.insert("locked".into(), Value::from(copia.guide.bloccata(i)));
}

/// La tavola che ha il centro del riquadro degli oggetti scelti.
fn tavola_della_selezione(copia: &Copia, selezione: &[String]) -> Option<usize> {
    let nodi = nodi_scelti(copia, selezione).ok()?;
    let riquadro = copia.documento.bounds_of(&nodi, false)?;
    copia.documento.artboard_at(riquadro.center())
}

/// Dice se un valore è quello di serie.
type DiSerie = fn(&Value) -> bool;

/// Le chiavi di una tavola che il file non tiene ancora, col loro valore di
/// serie.
const NON_NEL_FILE: [(&str, DiSerie); 6] = [
    ("color", Value::is_null),
    ("locked", |v| v == &Value::Bool(false)),
    ("showCenterMark", |v| v == &Value::Bool(false)),
    ("showCrossHairs", |v| v == &Value::Bool(false)),
    ("showVideoSafeAreas", |v| v == &Value::Bool(false)),
    ("videoRulerPixelAspectRatio", |v| v.as_f64() == Some(1.0)),
];

/// Le misure di una tavola (`x`, `y`, `width`, `height`, `dx`, `dy`) dal
/// file al documento del motore; una chiave che il file non tiene, con un
/// valore che non è quello di serie, è un argomento rifiutato.
fn misure_nel_motore(valore: &mut Value, radice: Affine) -> Result<(), PluginError> {
    let Some(o) = valore.as_object_mut() else {
        return Ok(());
    };
    for (chiave, di_serie) in NON_NEL_FILE {
        if o.get(chiave).is_some_and(|v| !di_serie(v)) {
            return Err(PluginError::BadArgs(
                format!(
                    "«{chiave}»: il colore, il blocco e i segni di una tavola non si salvano ancora nel file."
                )
                .into(),
            ));
        }
    }
    let [a, b, c, d, e, f] = radice.as_coeffs();
    if b.abs() > 1e-12 || c.abs() > 1e-12 {
        return Err(PluginError::BadArgs(
            "Il disegno è ruotato: le misure di una tavola non si portano nel motore.".into(),
        ));
    }
    let mut porta = |chiave: &str, scala: f64, spostamento: f64| {
        if let Some(v) = o.get(chiave).and_then(Value::as_f64) {
            o.insert(chiave.into(), Value::from(v * scala + spostamento));
        }
    };
    porta("x", a, e);
    porta("y", d, f);
    porta("width", a.abs(), 0.0);
    porta("height", d.abs(), 0.0);
    porta("dx", a, 0.0);
    porta("dy", d, 0.0);
    porta("spacing", a.abs(), 0.0);
    Ok(())
}

/// Perché un comando delle tavole è spento: una copia di sola lettura spegne
/// quelli che cambiano il disegno (copiare no); un file con le carte fuori
/// regola tutti quelli che cambiano le tavole; Elimina, con una sola tavola,
/// come in VectorCraft; Adatta alla selezione e Converti in tavole senza
/// oggetti scelti.
fn tavola_spenta(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    let sugli_oggetti = matches!(id, "artboard.fitToSelection" | "artboard.convertToArtboards");
    if sugli_oggetti {
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if let Some(r) = selezione_spenta(copia, selezione) {
            return Some(r);
        }
    }
    if id == "artboard.copy" {
        return None;
    }
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    if copia.tavole.fuori_regola {
        return Some(DrawingDisabledReason::Other {
            text: "Le carte del file non vanno con le loro tavole.".into(),
        });
    }
    let una_sola = copia.documento.artboards.len() <= 1;
    (una_sola && matches!(id, "artboard.delete" | "artboard.cut")).then(|| {
        DrawingDisabledReason::Other {
            text: "Una tavola resta sempre.".into(),
        }
    })
}

/// Il `node` di un riferimento a un lato o a un punto, come id del file,
/// diventa il nodo del motore.
fn nodo_nel_riferimento(copia: &Copia, r: &mut Value) -> Result<(), PluginError> {
    if let Some(file) = r.get("node").and_then(Value::as_str).map(str::to_string) {
        r["node"] = Value::from(nodo_del_file(copia, &file)?.0);
    }
    Ok(())
}

/// L'id del file `file` come nodo del motore, o l'argomento che non lo è.
fn nodo_del_file(copia: &Copia, file: &str) -> Result<NodeId, PluginError> {
    nodi_scelti(copia, &[file.to_string()])
        .ok()
        .and_then(|n| n.first().copied())
        .ok_or_else(|| PluginError::BadArgs(format!("«{file}» non è nel disegno.").into()))
}

/// Vero se il nodo `n` è una quota.
fn e_quota(copia: &Copia, n: NodeId) -> bool {
    copia
        .documento
        .node(n)
        .is_some_and(|n| n.extras().dimension.is_some())
}
