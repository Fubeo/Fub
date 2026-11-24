//! Le misure della scena nel documento del motore, e indietro.
//!
//! Le finestre e i pannelli del client scrivono punti, spostamenti e lunghezze nella scena (le unità
//! del `viewBox`); il motore lavora nel suo documento, che con la radice scalata (un file in
//! millimetri, un `viewBox` diverso da `width`/`height`) non coincide. La radice è una scala e uno
//! spostamento: un punto la prende intera, uno spostamento solo la scala del suo asse, una lunghezza
//! senza asse (uno spessore, una distanza) la scala media.
//!
//! - [`nel_motore`]: i campi di [`NELLA_SCENA`] di un comando, prima del motore. Un comando che non è
//!   nella tabella, o un campo che non è un numero (o una lista di numeri), resta com'è: il motore lo
//!   rifiuta come senza la radice.
//! - [`tratto_nella_scena`]: lo spessore e il tratteggio che `document.node` legge, per il pannello
//!   Contorno.
//!
//! Le misure che hanno già il loro passaggio stanno nella loro famiglia: il riquadro e i punti di
//! riferimento del pannello Trasforma (`trasforma.rs`), le tavole e le guide (`tavole.rs`), le forme
//! vive (`forme.rs`), i punti del testo (`testo.rs`), gli strumenti dei tracciati.

use serde_json::{Number, Value};
use vectorcraft_geom::Affine;

/// Che misura è un campo, e quale parte della radice prende.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Misura {
    /// La x di un punto: scala e spostamento orizzontali.
    X,
    /// La y di un punto: scala e spostamento verticali.
    Y,
    /// Uno spostamento o una larghezza: solo la scala orizzontale.
    Dx,
    /// Uno spostamento o un'altezza: solo la scala verticale.
    Dy,
    /// Una lunghezza senza asse: la scala media.
    Lunghezza,
    /// Una lista di lunghezze (un tratteggio).
    Lunghezze,
}

use Misura::{Dx, Dy, Lunghezza, Lunghezze, X, Y};

/// I comandi con campi nella scena, e i campi.
const NELLA_SCENA: &[(&str, &[(&str, Misura)])] = &[
    // Sposta… (Maiusc+Ctrl+M).
    ("object.move", &[("dx", Dx), ("dy", Dy)]),
    // Trasforma singolarmente: gli spostamenti (le scale sono in %, l'angolo in gradi).
    ("object.transformEach", &[("moveH", Dx), ("moveV", Dy)]),
    // Disponi › La misura di ciascuno.
    ("addon.arrange.size", &[("width", Dx), ("height", Dy)]),
    // Il pannello Contorno: il limite dell'angolo è un rapporto, non una lunghezza.
    (
        "stroke.set",
        &[
            ("weight", Lunghezza),
            ("dash", Lunghezze),
            ("dashOffset", Lunghezza),
        ],
    ),
    // Sposta tracciato.
    ("object.path.offsetPath", &[("offset", Lunghezza)]),
    // Dividi in trattini.
    (
        "addon.pathtools.divideDashes",
        &[("dash", Lunghezza), ("gap", Lunghezza)],
    ),
    // Dividi in griglia.
    ("object.path.splitIntoGrid", &[("gutter", Lunghezza)]),
    // Opzioni fusione: la distanza fra i passi.
    ("object.blend.options", &[("distance", Lunghezza)]),
    // Il clic di uno strumento Grafico: il punto e la misura.
    (
        "graph.create",
        &[("x", X), ("y", Y), ("width", Dx), ("height", Dy)],
    ),
];

/// La scala media della radice: la radice quadrata del determinante.
fn scala_media(radice: Affine) -> f64 {
    radice.determinant().abs().sqrt()
}

fn numero(x: f64) -> Value {
    Number::from_f64(x).map_or(Value::Null, Value::Number)
}

/// I campi di [`NELLA_SCENA`] del comando `id`, dalla scena al documento del motore.
pub(super) fn nel_motore(id: &str, radice: Affine, valore: &mut Value) {
    if radice == Affine::IDENTITY {
        return;
    }
    let Some((_, campi)) = NELLA_SCENA.iter().find(|(comando, _)| *comando == id) else {
        return;
    };
    let Some(o) = valore.as_object_mut() else {
        return;
    };
    let [a, _, _, d, e, f] = radice.as_coeffs();
    let media = scala_media(radice);
    for (chiave, misura) in *campi {
        let Some(v) = o.get_mut(*chiave) else {
            continue;
        };
        let porta = |x: f64| match misura {
            X => a * x + e,
            Y => d * x + f,
            Dx => a * x,
            Dy => d * x,
            Lunghezza | Lunghezze => x * media,
        };
        match (misura, v) {
            (Lunghezze, Value::Array(lista)) => {
                for elemento in lista.iter_mut() {
                    if let Some(x) = elemento.as_f64() {
                        *elemento = numero(porta(x));
                    }
                }
            }
            (_, v) => {
                if let Some(x) = v.as_f64() {
                    *v = numero(porta(x));
                }
            }
        }
    }
}

/// Lo spessore (`strokeWidth`) e il tratteggio (`strokeOptions.dash`, `dashOffset`) che
/// `document.node` legge, dal documento del motore alla scena.
pub(super) fn tratto_nella_scena(radice: Affine, lettura: &mut Value) {
    let media = scala_media(radice);
    if radice == Affine::IDENTITY || !(media.is_finite() && media > 0.0) {
        return;
    }
    let indietro = |v: &mut Value| {
        if let Some(x) = v.as_f64() {
            *v = numero(x / media);
        }
    };
    if let Some(v) = lettura.get_mut("strokeWidth") {
        indietro(v);
    }
    if let Some(opzioni) = lettura
        .get_mut("strokeOptions")
        .and_then(Value::as_object_mut)
    {
        if let Some(Value::Array(lista)) = opzioni.get_mut("dash") {
            lista.iter_mut().for_each(indietro);
        }
        if let Some(v) = opzioni.get_mut("dashOffset") {
            indietro(v);
        }
    }
}

#[cfg(test)]
mod prove {
    use super::*;
    use serde_json::json;

    /// La radice di un file in millimetri a metà: scala 2, spostata di (10, 20).
    fn radice() -> Affine {
        Affine::new([2.0, 0.0, 0.0, 2.0, 10.0, 20.0])
    }

    #[test]
    fn ogni_misura_prende_la_sua_parte_della_radice() {
        let mut v = json!({"x": 5, "y": 5, "width": 30, "height": 10, "type": "column"});
        nel_motore("graph.create", radice(), &mut v);
        assert_eq!(
            v,
            json!({"x": 20.0, "y": 30.0, "width": 60.0, "height": 20.0, "type": "column"})
        );
        let mut v = json!({"dx": 5, "dy": -5});
        nel_motore("object.move", radice(), &mut v);
        assert_eq!(v, json!({"dx": 10.0, "dy": -10.0}));
        let mut v = json!({"weight": 3, "dash": [6, 3], "miterLimit": 4});
        nel_motore("stroke.set", radice(), &mut v);
        assert_eq!(
            v,
            json!({"weight": 6.0, "dash": [12.0, 6.0], "miterLimit": 4})
        );
        let mut v = json!({"distance": 7, "spacing": "distance"});
        nel_motore("object.blend.options", radice(), &mut v);
        assert_eq!(v, json!({"distance": 14.0, "spacing": "distance"}));
    }

    #[test]
    fn senza_radice_o_fuori_tabella_niente_cambia() {
        let prima = json!({"dx": 5, "dy": "tanto"});
        let mut v = prima.clone();
        nel_motore("object.move", Affine::IDENTITY, &mut v);
        assert_eq!(v, prima);
        nel_motore("object.rotate", radice(), &mut v);
        assert_eq!(v, prima);
        // Un valore che non è un numero resta: il motore lo rifiuta come sempre.
        nel_motore("object.move", radice(), &mut v);
        assert_eq!(v, json!({"dx": 10.0, "dy": "tanto"}));
        // Un tratteggio nullo (contorno pieno) resta nullo.
        let mut v = json!({"dash": null});
        nel_motore("stroke.set", radice(), &mut v);
        assert_eq!(v, json!({"dash": null}));
    }

    #[test]
    fn il_tratto_letto_torna_nella_scena() {
        let mut lettura = json!({"strokeWidth": 8, "strokeOptions": {"dash": [12, 6], "dashOffset": 4, "miterLimit": 10}});
        tratto_nella_scena(radice(), &mut lettura);
        assert_eq!(
            lettura,
            json!({"strokeWidth": 4.0, "strokeOptions": {"dash": [6.0, 3.0], "dashOffset": 2.0, "miterLimit": 10}})
        );
    }
}
