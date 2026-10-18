//! I connettori, le linee che uniscono due oggetti e li seguono (formato
//! della scena, connettori): un `path` con `fub:shape="connector"` e
//! `fub:geom`, che porta il tipo della linea e i punti del suo percorso.
//! `fub:from` e `fub:to` dicono a che cosa sono agganciati i due capi, con l'id
//! dell'oggetto e il punto d'aggancio; un capo senza è libero. L'etichetta di
//! un connettore è un `text` con `fub:along`: l'id del connettore, dove sta
//! lungo la linea e a che distanza.
//!
//! È la lettura di `connectors.ts` della superficie, regola per regola: i casi
//! scritti a mano in `apps/client/src/__fixtures__/scene-connectors/cases.json`
//! valgono per tutte e due. Il `d` lo calcola la superficie, come per la
//! freccia; qui basta sapere se la geometria si legge. Un `fub:geom` fuori
//! dalla grammatica lascia un tracciato qualunque, che si legge da `d`; un
//! aggancio o un'etichetta fuori dalla grammatica non si usano, e restano nel
//! file come sono.

use serde::Serialize;

use crate::values::{is_wsp, number, number_list};

/// I vertici di un gomito, al più: un percorso senza ostacoli ne ha sei.
pub const MAX_ELBOW_POINTS: usize = 64;

/// Come va la linea: dritta, a gomito, coi tratti orizzontali e verticali, o
/// curva, una curva di Bézier cubica.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectorKind {
    Straight,
    Elbow,
    Curved,
}

impl ConnectorKind {
    /// Il tipo scritto, se è uno dei tre, scritto così.
    pub fn parse(value: &str) -> Option<ConnectorKind> {
        match value {
            "straight" => Some(ConnectorKind::Straight),
            "elbow" => Some(ConnectorKind::Elbow),
            "curved" => Some(ConnectorKind::Curved),
            _ => None,
        }
    }

    /// Quanti numeri vuole il percorso: al meno e al più.
    fn counts(self) -> (usize, usize) {
        match self {
            ConnectorKind::Straight => (4, 4),
            ConnectorKind::Curved => (8, 8),
            ConnectorKind::Elbow => (4, MAX_ELBOW_POINTS * 2),
        }
    }
}

/// Il percorso di un connettore, come lo porta `fub:geom`: dritto, due punti;
/// a gomito, i vertici dal primo all'ultimo; curvo, l'inizio, i due punti di
/// controllo e la fine.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ConnectorGeom {
    pub kind: ConnectorKind,
    pub points: Vec<[f64; 2]>,
}

/// Dove un capo si aggancia all'oggetto: scelto da FubDraw, verso il centro,
/// o al centro di uno dei quattro lati.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Anchor {
    Auto,
    Center,
    Top,
    Right,
    Bottom,
    Left,
}

impl Anchor {
    /// L'aggancio scritto, se è uno dei sei, scritto così.
    pub fn parse(value: &str) -> Option<Anchor> {
        match value {
            "auto" => Some(Anchor::Auto),
            "center" => Some(Anchor::Center),
            "top" => Some(Anchor::Top),
            "right" => Some(Anchor::Right),
            "bottom" => Some(Anchor::Bottom),
            "left" => Some(Anchor::Left),
            _ => None,
        }
    }
}

/// Un capo agganciato: l'id dell'oggetto e il punto d'aggancio.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ConnectorEnd {
    pub id: String,
    pub anchor: Anchor,
}

/// Dove sta l'etichetta di un connettore: `t` è la frazione della lunghezza
/// della linea dal suo inizio, da 0 a 1; `offset` la distanza fra la linea e
/// il bordo più vicino dell'etichetta, positiva dalla parte che guarda in
/// alto a destra: sopra una linea orizzontale, a destra di una verticale, e
/// di una obliqua dove la perpendicolare va più verso l'alto a destra; di
/// una parallela a (1, -1), dove le due sono alla pari, quella in alto a
/// sinistra. Negativa dall'altra parte, qualunque sia il verso della linea.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LabelPlace {
    pub id: String,
    pub t: f64,
    pub offset: f64,
}

/// Vero per gli spazi di SVG, quelli che separano le parole di un aggancio e
/// di un'etichetta.
fn is_space(c: char) -> bool {
    c.is_ascii() && is_wsp(c as u8)
}

/// Le parole di `value`, separate da spazi.
fn words(value: &str) -> impl Iterator<Item = &str> {
    value.split(is_space).filter(|word| !word.is_empty())
}

/// Il percorso di `fub:geom`; `None` se `geom` è fuori dalla grammatica: la
/// parola del tipo scritta esatta, minuscola, un tipo che non è uno dei tre,
/// una lista di numeri che non si legge, di un numero di valori diverso da
/// quello del tipo o dispari.
pub fn read_connector_geom(geom: &str) -> Option<ConnectorGeom> {
    let text = geom.trim_start_matches(is_space);
    let end = text.find(is_space)?;
    let kind = ConnectorKind::parse(&text[..end])?;
    let numbers = number_list(&text[end..])?;
    if !numbers.iter().all(|value| value.is_finite()) {
        return None;
    }
    let (least, most) = kind.counts();
    if numbers.len() < least || numbers.len() > most || numbers.len() % 2 != 0 {
        return None;
    }
    let points = numbers.chunks(2).map(|pair| [pair[0], pair[1]]).collect();
    Some(ConnectorGeom { kind, points })
}

/// Il capo di `fub:from` o `fub:to`: l'id e il punto d'aggancio, due parole;
/// `None` fuori dalla grammatica.
pub fn read_connector_end(value: &str) -> Option<ConnectorEnd> {
    let mut words = words(value);
    let (id, anchor) = (words.next()?, words.next()?);
    if words.next().is_some() {
        return None;
    }
    Some(ConnectorEnd {
        id: id.to_owned(),
        anchor: Anchor::parse(anchor)?,
    })
}

/// Il posto di `fub:along`: l'id del connettore, `t` fra 0 e 1 e la
/// distanza; `None` fuori dalla grammatica.
pub fn read_label_place(value: &str) -> Option<LabelPlace> {
    let mut words = words(value);
    let (id, at, away) = (words.next()?, words.next()?, words.next()?);
    if words.next().is_some() {
        return None;
    }
    let (t, offset) = (number(at)?, number(away)?);
    (offset.is_finite() && (0.0..=1.0).contains(&t)).then(|| LabelPlace {
        id: id.to_owned(),
        t,
        offset,
    })
}
