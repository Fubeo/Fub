//! La famiglia `trasforma` della mappa: il suo stato e i suoi comandi
//! (`docs/architecture/disegno-completo.md`). Giro 1 di T13: la sezione
//! «Allinea» dell'ispettore, con `object.align`, `object.distribute` e
//! `object.distributeSpacing`. T13, giro «disponi»: le voci `addon.arrange.*`
//! di ≡ › Oggetto › Disponi.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::text::TextKind;
use vectorcraft_doc::{Document, Node, NodeId, NodeKind};
use vectorcraft_geom::{Affine, Point};

/// Due decimali, come li scrive la differenza per la geometria (`DECIMALI_GEOMETRIA`): uno scarto
/// più piccolo di così non si vede e non si scrive.
fn arrotonda(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

use super::tracciati::sceglie_inchiostro;

#[path = "trasforma_marionetta.rs"]
mod marionetta;
use marionetta::{MARIONETTA, MARIONETTA_PINS};
use super::{nodi_scelti, selezione_spenta, StatoFamiglia};
use crate::apertura::Copia;

/// Le voci di ≡ › Oggetto › Disponi (`addon.arrange.*`, K6 T13): il motore le fa
/// sulla selezione, e ognuna vuole un numero di oggetti suo.
const DISPONI: [&str; 7] = [
    "addon.arrange.grid",
    "addon.arrange.swap",
    "addon.arrange.replace",
    "addon.arrange.size",
    "addon.arrange.groupOverlapping",
    "addon.arrange.randomizeOpacity",
    "addon.arrange.sort",
];

/// Le voci di ≡ › Oggetto › Sposta, Distorci, Ruota, Scala, Inclina e Rifletti (K6 T13): cambiano la
/// forma o la posizione degli oggetti scelti con un `transform`, e un tratto dell'inchiostro di Fub
/// non si cambia (`unmapped`, come Disponi).
const SPOSTA_E_TRASFORMA: [&str; 6] = [
    "object.nudge",
    "object.distort",
    "object.rotate",
    "object.scale",
    "object.shear",
    "object.reflect",
];

/// Il perché di Distorci sul testo spento: un testo deformato a quadrilatero non è più un testo,
/// quindi si crea prima il contorno (il testo si trasforma per intero con Ruota, Scala e le altre).
const DISTORCI_SUL_TESTO: &str = "Distorci non vale sul testo: crea prima i contorni.";

/// Le trasformazioni che ruotano o inclinano il piano del testo: un testo in area resta orizzontale
/// (`differenza_righe.rs`, RIQUADRO_FUORI), quindi per lui non valgono.
const RUOTANO_IL_TESTO: [&str; 3] = ["object.rotate", "object.shear", "object.reflect"];

/// Il perché di Ruota, Inclina e Rifletti spenti su un testo in area.
const TESTO_IN_AREA_ORIZZONTALE: &str =
    "Il testo in area resta orizzontale: Ruota, Inclina e Rifletti non valgono su di lui.";

/// Quanti oggetti scelti vuole una voce di Disponi, come dice il motore: lo
/// scambio esattamente due, le sostituzioni, il raggruppamento e l'ordine almeno
/// due, le altre uno.
fn quanti_servono(id: &str) -> (usize, Option<usize>) {
    match id {
        "addon.arrange.swap" => (2, Some(2)),
        "addon.arrange.replace" | "addon.arrange.groupOverlapping" | "addon.arrange.sort" => (2, None),
        _ => (1, None),
    }
}

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

    /// Allineare e distribuire vogliono qualcosa di scelto, e la selezione
    /// senza pezzi che il motore non tocca (o bloccati). Quanti oggetti servono
    /// dipende da «allinea a» (un oggetto solo si allinea alla tavola), e lo
    /// decide la sezione del client: qui non si dice `needs_two`. Le voci di
    /// Disponi dicono quanti ne vogliono, col perché.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if id == MARIONETTA {
            return marionetta::spento(copia, selezione);
        }
        if DISPONI.contains(&id) {
            return disponi_spenta(id, copia, selezione);
        }
        if SPOSTA_E_TRASFORMA.contains(&id) && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::FubInk);
        }
        if id == RENDI_PERFETTO && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if id == "object.distort" && contiene_testo(copia, selezione, |_| true) {
            return Some(DrawingDisabledReason::Other {
                text: DISTORCI_SUL_TESTO.into(),
            });
        }
        if RUOTANO_IL_TESTO.contains(&id) && contiene_testo(copia, selezione, in_area) {
            return Some(DrawingDisabledReason::Other {
                text: TESTO_IN_AREA_ORIZZONTALE.into(),
            });
        }
        let allinea = matches!(id, "object.align" | "object.distribute" | "object.distributeSpacing");
        if allinea && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        selezione_spenta(copia, selezione)
    }

    /// «Rendi perfetto al pixel» su oggetti già allineati non cambia niente, anche se il motore scrive di
    /// nuovo la stessa matrice (la matrice si scrive con quattro decimali, e il riquadro che ne esce è
    /// più preciso di così): il passo non si fa. Vale se il riquadro (a due decimali) e la larghezza del
    /// tratto di ognuno sono gli stessi.
    fn rifiuto_dopo(id: &str, copia: &Copia, dopo: &Document, scelti_dopo: &[NodeId]) -> Option<DrawingRefusal> {
        if id != RENDI_PERFETTO || scelti_dopo.is_empty() {
            return None;
        }
        let invariato = scelti_dopo.iter().all(|n| {
            let (Some(prima), Some(dopo)) = (copia.documento.node(*n), dopo.node(*n)) else {
                return false;
            };
            let riquadro = |nodo: &Node| nodo.geometric_bounds().map(|b| [b.x0, b.y0, b.x1, b.y1].map(arrotonda));
            riquadro(prima) == riquadro(dopo) && arrotonda(prima.appearance.stroke_width()) == arrotonda(dopo.appearance.stroke_width())
        });
        invariato.then_some(DrawingRefusal::Empty)
    }

    /// Una voce di Disponi, Sposta leggermente o Distorci su un inchiostro di Fub non gira:
    /// l'inchiostro non è un oggetto del motore, e il comando lo rifiuta come `unmapped`, come il colore.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if id == MARIONETTA {
            return marionetta::rifiuto(copia, selezione);
        }
        if id == RENDI_PERFETTO {
            // L'inchiostro di Fub non è un oggetto del motore (`unmapped`); un oggetto nascosto il
            // motore lo sposterebbe lo stesso, e Fub non lo tocca: niente da fare (`empty`).
            if sceglie_inchiostro(copia, selezione) {
                return Some(DrawingRefusal::Unmapped);
            }
            return scelto_nascosto(copia, selezione).then_some(DrawingRefusal::Empty);
        }
        let inchiostro = DISPONI.contains(&id) || SPOSTA_E_TRASFORMA.contains(&id);
        if inchiostro && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        if id == "object.distort" && contiene_testo(copia, selezione, |_| true) {
            return Some(DrawingRefusal::Unsupported);
        }
        (RUOTANO_IL_TESTO.contains(&id) && contiene_testo(copia, selezione, in_area)).then_some(DrawingRefusal::Unsupported)
    }

    /// Gli angoli di Distorci (TL, TR, BR, BL) devono formare un quadrilatero: due angoli
    /// uguali, cioè un lato di lunghezza zero, o quattro angoli allineati danno una trasformazione
    /// che schiaccia il tracciato (il motore ne scrive un punto solo, in 0 0). Angoli che si
    /// incrociano (un quadrilatero che si rovescia) sono uno specchio, e valgono.
    fn legge(&self, id: &str) -> bool {
        id == MARIONETTA_PINS
    }

    /// Gli spilli della marionetta: il motore li vuole in documento; senza spilli, o con due liste di
    /// lunghezza diversa, è `BadArgs` in italiano (`trasforma_marionetta.rs`).
    fn rifiuto_valore(id: &str, copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
        if id != MARIONETTA {
            return None;
        }
        marionetta::rifiuto_valore(copia, selezione, valore)
    }

    fn argomenti_della_copia(id: &str, copia: &Copia, _selezione: &[String], valore: Value) -> Result<Value, PluginError> {
        if id == MARIONETTA || id == MARIONETTA_PINS {
            return marionetta::argomenti(id, copia, valore);
        }
        if id == "object.distort" {
            let angoli = valore.get("corners").unwrap_or(&Value::Null);
            quadrilatero_valido(angoli).map_err(|perche| PluginError::BadArgs(format!("{id}: {perche}").into()))?;
        }
        Ok(nel_motore(id, copia.radice, valore))
    }
}

/// I punti e le misure che il pannello Trasforma manda, dalla scena al documento del motore: `x`,
/// `y`, `width` e `height` di `object.setBounds`, e il punto `origin` di `object.rotate`,
/// `object.shear`, `object.reflect` e `object.scale` (Ispeziona documento li dà nella scena,
/// `nucleo::riquadro_della_selezione`). La radice è una scala e uno spostamento (il `viewBox`):
/// `x` e `y` passano ognuno da soli. Un valore che non è un numero resta com'è (il motore lo
/// rifiuta).
fn nel_motore(id: &str, radice: Affine, mut valore: Value) -> Value {
    if radice == Affine::IDENTITY {
        return valore;
    }
    let [a, _, _, d, e, f] = radice.as_coeffs();
    let scala = radice.determinant().abs().sqrt();
    let numero = |x: f64| serde_json::Number::from_f64(x).map_or(Value::Null, Value::Number);
    let Some(campi) = valore.as_object_mut() else { return valore };
    let mut cambia = |chiave: &str, come: &dyn Fn(f64) -> f64| {
        if let Some(n) = campi.get(chiave).and_then(Value::as_f64) {
            campi.insert(chiave.into(), numero(come(n)));
        }
    };
    match id {
        "object.setBounds" => {
            cambia("x", &|x| a * x + e);
            cambia("y", &|y| d * y + f);
            cambia("width", &|w| w * scala);
            cambia("height", &|h| h * scala);
        }
        "object.rotate" | "object.shear" | "object.reflect" | "object.scale" => {
            if let Some([x, y]) = campi.get("origin").and_then(Value::as_array).and_then(|o| match o.as_slice() {
                [x, y] => Some([x.as_f64()?, y.as_f64()?]),
                _ => None,
            }) {
                let p = radice * Point::new(x, y);
                campi.insert("origin".into(), Value::Array(vec![numero(p.x), numero(p.y)]));
            }
        }
        _ => {}
    }
    valore
}

/// «Rendi perfetto al pixel» (`object.makePixelPerfect`, K6 T13): sposta e arrotonda gli oggetti scelti
/// col motore (una matrice `transform`, e la larghezza del tratto a un numero intero). Un oggetto scelto
/// nascosto, o dentro un livello nascosto, non si tocca.
const RENDI_PERFETTO: &str = "object.makePixelPerfect";

/// Vero se uno degli oggetti scelti è nascosto, da sé o perché sta in un livello o un gruppo nascosto.
pub(crate) fn scelto_nascosto(copia: &Copia, selezione: &[String]) -> bool {
    selezione.iter().any(|id| {
        let mut i = copia.mappa.dell_id(id);
        while let Some(indice) = i {
            let Some(elemento) = copia.mappa.elemento(indice) else { break };
            if elemento.nascosto {
                return true;
            }
            i = elemento.genitore;
        }
        false
    })
}

/// Una voce di Disponi (K6 T13): una selezione che il motore tocca, col numero di
/// oggetti che la voce vuole. Un bloccato o un oggetto che la mappa non ha la
/// spengono come le altre voci della famiglia; l'inchiostro di Fub è `FubInk`.
fn disponi_spenta(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    if selezione.is_empty() {
        return Some(DrawingDisabledReason::NoSelection);
    }
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    match nodi_scelti(copia, selezione) {
        Ok(_) => {}
        Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
        Err(_) => return Some(DrawingDisabledReason::Unmapped),
    }
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingDisabledReason::FubInk);
    }
    let (minimo, massimo) = quanti_servono(id);
    let scelti = selezione.len();
    (scelti < minimo || massimo.is_some_and(|m| scelti > m)).then_some(DrawingDisabledReason::NeedsTwo)
}

/// Vero se `angoli` sono quattro punti `[x, y]` che formano un quadrilatero: nessun lato di
/// lunghezza zero, e un'area con segno diversa da zero. Il perché, in italiano, se no.
fn quadrilatero_valido(angoli: &Value) -> Result<(), &'static str> {
    let Some(pari) = angoli.as_array() else {
        return Err("gli angoli sono quattro punti [x, y]");
    };
    let mut punti = Vec::with_capacity(4);
    for p in pari {
        match p.as_array().map(Vec::as_slice) {
            Some([x, y]) => match (x.as_f64(), y.as_f64()) {
                (Some(x), Some(y)) if x.is_finite() && y.is_finite() => punti.push((x, y)),
                _ => return Err("le coordinate degli angoli sono numeri"),
            },
            _ => return Err("gli angoli sono quattro punti [x, y]"),
        }
    }
    if punti.len() != 4 {
        return Err("gli angoli sono quattro punti [x, y]");
    }
    for i in 0..4 {
        let (a, b) = (punti[i], punti[(i + 1) % 4]);
        if (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9 {
            return Err("due angoli coincidono: gli angoli devono formare un quadrilatero");
        }
    }
    let area2: f64 = (0..4)
        .map(|i| {
            let (a, b) = (punti[i], punti[(i + 1) % 4]);
            a.0 * b.1 - b.0 * a.1
        })
        .sum();
    if area2.abs() < 1e-9 {
        return Err("gli angoli sono allineati: non formano un quadrilatero");
    }
    Ok(())
}

/// Vero se fra gli oggetti scelti, anche dentro un gruppo, c'è un testo che `vale` (per esempio un
/// testo in area).
fn contiene_testo(copia: &Copia, selezione: &[String], vale: fn(&TextKind) -> bool) -> bool {
    fn cerca(nodo: &Node, vale: fn(&TextKind) -> bool) -> bool {
        match &nodo.kind {
            NodeKind::Text(t) => vale(&t.kind),
            NodeKind::Group { children, .. } => children.iter().any(|c| cerca(c, vale)),
            _ => false,
        }
    }
    let nodi: Vec<NodeId> = nodi_scelti(copia, selezione).unwrap_or_default();
    nodi.iter().any(|n| copia.documento.node(*n).is_some_and(|nodo| cerca(nodo, vale)))
}

/// Il testo è un testo in area.
fn in_area(t: &TextKind) -> bool {
    matches!(t, TextKind::Area { .. })
}
