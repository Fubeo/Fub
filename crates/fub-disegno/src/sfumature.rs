//! Le sfumature del motore come le scrive la scena (K6 T15, giro 5;
//! [formato della scena, risorse](../../../docs/reference/scene-format-resources.md)).
//!
//! - **Ogni oggetto ha la sua.** Una sfumatura lineare o radiale che il
//!   motore dà a un riempimento o a un contorno si scrive come una
//!   `linearGradient` o una `radialGradient` privata (`fub:role="private"`)
//!   nella `fub-defs`, nelle coordinate dell'elemento che la usa
//!   (`userSpaceOnUse`), e chi la usa scrive `url(#id) #ripiego`. La vecchia,
//!   se era privata e nessun altro la usa, la toglie la scena con il suo
//!   ultimo riferimento; una condivisa resta agli altri.
//! - **Ciò che si vede resta.** La geometria del motore (i capi della linea,
//!   il centro, il raggio, il rapporto e il fuoco di una radiale) si porta
//!   nelle coordinate dell'elemento come la porta l'esportazione SVG del
//!   motore: una lineare tiene le righe di uguale colore di traverso, una
//!   radiale schiacciata scrive l'ellisse con una `gradientTransform`, e solo
//!   allora.
//! - **Il ripiego** è la media dei colori lungo la sfumatura, pesata
//!   sull'opacità, come la calcola il client (`averageColor` in
//!   `tools/gradients.ts`).
//! - **Ciò che la scena non dice resta del motore**: una sfumatura libera,
//!   un punto medio che non sta a metà, un altro modo di mescolare i colori,
//!   la retinatura, il legame con un campione di sfumatura, una sfumatura
//!   che segue il tratto. [`scrivibile`] dice di no, e l'oggetto si riscrive
//!   intero con la sua ricetta.

use serde_json::{json, Map, Value};
use vectorcraft_doc::color::{GradientKind, GradientPaint, GradientStop};
use vectorcraft_doc::{StrokeGradientMode, StrokeLayer};
use vectorcraft_geom::{Affine, Rect};

use crate::differenza::{numero, scrivi_matrice};

/// Le cifre dopo la virgola delle coordinate, come il resto della scena.
const DECIMALI_GEOMETRIA: usize = 2;
/// Le cifre di una posizione o di un'opacità, come le scrive il client.
const DECIMALI_QUOTA: usize = 4;
/// Quanto un fuoco sta dentro il cerchio, al più, in raggi (`FOCUS_LIMIT`
/// nel client).
const LIMITE_DEL_FUOCO: f64 = 0.99;

/// Vero se la sfumatura `p` si scrive come una risorsa della scena: lineare
/// o radiale, coi punti medi a metà, mescolata come SVG, senza retinatura e
/// senza un campione di sfumatura.
pub(crate) fn scrivibile(p: &GradientPaint) -> bool {
    matches!(p.gradient.kind, GradientKind::Linear | GradientKind::Radial)
        && p.freeform.is_none()
        && p.swatch.is_none()
        && !p.gradient.dither
        && p.gradient.method.is_classic()
        && !p.gradient.stops.is_empty()
        && p.gradient.stops.iter().all(|s| {
            (s.midpoint - 0.5).abs() < 1e-6
                && s.swatch.is_none()
                && s.offset.is_finite()
                && s.opacity.is_finite()
        })
}

/// Vero se la sfumatura del contorno `s` si vede attraverso il tratto, come
/// in SVG; lungo o di traverso al tracciato la scena non la dice.
pub(crate) fn del_tratto_scrivibile(s: &StrokeLayer) -> bool {
    s.gradient_mode == StrokeGradientMode::Within
}

/// Una sfumatura pronta da scrivere, senza id.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Scritta {
    tag: &'static str,
    /// Gli attributi della geometria, in ordine, `gradientUnits` per primo.
    attrs: Vec<(&'static str, String)>,
    /// Gli attributi di ogni punto, in ordine.
    punti: Vec<Vec<(&'static str, String)>>,
    /// Il colore di chi la usa dove la sfumatura non si trova.
    pub ripiego: String,
}

impl Scritta {
    /// L'elemento della sfumatura privata con l'id `id`, per un `add`.
    pub(crate) fn elem(&self, id: &str) -> Value {
        let mut attrs = Map::new();
        attrs.insert("id".into(), json!(id));
        attrs.insert("fub:role".into(), json!("private"));
        for (nome, valore) in &self.attrs {
            attrs.insert((*nome).into(), json!(valore));
        }
        let figli: Vec<Value> = self
            .punti
            .iter()
            .map(|p| {
                let a: Map<String, Value> = p
                    .iter()
                    .map(|(n, v)| ((*n).to_string(), json!(v)))
                    .collect();
                json!({ "tag": "stop", "attrs": a })
            })
            .collect();
        json!({ "tag": self.tag, "attrs": attrs, "children": figli })
    }
}

/// Vero se `v` sta oltre `soglia`; falso anche per un `NaN`.
fn oltre(v: f64, soglia: f64) -> bool {
    v > soglia
}

/// La sfumatura `p` di un oggetto il cui riquadro (della geometria, o del
/// tratto per un contorno) nel documento del motore è `limiti`, scritta
/// nelle coordinate dell'elemento (`locale` porta dal documento del motore
/// lì); `None` se non ha misura, o se `locale` schiaccia il piano.
pub(crate) fn scritta(p: &GradientPaint, limiti: Rect, locale: Affine) -> Option<Scritta> {
    if !scrivibile(p) || !oltre(locale.determinant().abs(), 1e-12) {
        return None;
    }
    let kind = p.gradient.kind;
    let mut geom = p.resolve(limiti);
    geom.transform(locale, kind);
    let (s, e) = (geom.start, geom.end);
    let finito = |v: f64| v.is_finite();
    if ![s.x, s.y, e.x, e.y, geom.aspect].into_iter().all(finito) {
        return None;
    }
    let g2 = |v: f64| numero(v, DECIMALI_GEOMETRIA);
    let mut attrs: Vec<(&'static str, String)> = vec![("gradientUnits", "userSpaceOnUse".into())];
    let tag = match kind {
        GradientKind::Radial => {
            let r = (e - s).hypot();
            if g2(r) == "0" || !oltre(geom.aspect, 1e-9) {
                return None;
            }
            attrs.push(("cx", g2(s.x)));
            attrs.push(("cy", g2(s.y)));
            attrs.push(("r", g2(r)));
            let tondo = (geom.aspect - 1.0).abs() < 1e-9;
            // Il cerchio portato sull'ellisse del motore: il raggio
            // orizzontale lungo `e - s`, quello verticale di traverso,
            // `aspect` volte tanto.
            let forma = if tondo {
                Affine::IDENTITY
            } else {
                let v = e - s;
                Affine::translate(s.to_vec2())
                    * Affine::rotate(v.y.atan2(v.x))
                    * Affine::scale_non_uniform(1.0, geom.aspect)
                    * Affine::translate(-s.to_vec2())
            };
            if let Some(f) = geom.focal {
                // Il fuoco nel cerchio, dentro il bordo anche dopo
                // l'arrotondamento: al più nel centro.
                let f = forma.inverse() * f;
                let d = f - s;
                let lontano = d.hypot();
                for passo in 0..99 {
                    let limite = (LIMITE_DEL_FUOCO - passo as f64 / 100.0) * r;
                    let k = if lontano > limite {
                        limite / lontano
                    } else {
                        1.0
                    };
                    let (fx, fy) = (g2(s.x + d.x * k), g2(s.y + d.y * k));
                    let (nx, ny) = (
                        fx.parse::<f64>().unwrap_or(s.x),
                        fy.parse::<f64>().unwrap_or(s.y),
                    );
                    if (nx - s.x).hypot(ny - s.y) >= r {
                        continue;
                    }
                    if fx != g2(s.x) || fy != g2(s.y) {
                        attrs.push(("fx", fx));
                        attrs.push(("fy", fy));
                    }
                    break;
                }
            }
            if !tondo {
                attrs.push(("gradientTransform", scrivi_matrice(forma)));
            }
            "radialGradient"
        }
        GradientKind::Linear | GradientKind::Freeform => {
            let (x1, y1, x2, y2) = (g2(s.x), g2(s.y), g2(e.x), g2(e.y));
            if x1 == x2 && y1 == y2 {
                return None;
            }
            attrs.extend([("x1", x1), ("y1", y1), ("x2", x2), ("y2", y2)]);
            "linearGradient"
        }
    };
    let punti = p
        .gradient
        .stops
        .iter()
        .map(|st| {
            let mut a: Vec<(&'static str, String)> = vec![
                (
                    "offset",
                    numero(f64::from(st.offset.clamp(0.0, 1.0)), DECIMALI_QUOTA),
                ),
                ("stop-color", st.color.to_hex()),
            ];
            let opacita = numero(f64::from(st.opacity.clamp(0.0, 1.0)), DECIMALI_QUOTA);
            if opacita != "1" {
                a.push(("stop-opacity", opacita));
            }
            a
        })
        .collect();
    Some(Scritta {
        tag,
        attrs,
        punti,
        ripiego: media(&p.gradient.stops),
    })
}

/// I tre canali di un colore, da 0 a 255.
fn canali(s: &GradientStop) -> [f64; 3] {
    let [r, g, b, _] = s.color.to_rgba8(1.0);
    [f64::from(r), f64::from(g), f64::from(b)]
}

/// La media dei colori di `punti` lungo la sfumatura, pesata sull'opacità,
/// `#rrggbb`: il ripiego di chi la usa (`averageColor` del client).
pub(crate) fn media(punti: &[GradientStop]) -> String {
    let (Some(primo), Some(ultimo)) = (punti.first(), punti.last()) else {
        return "#000000".into();
    };
    let quota = |s: &GradientStop| f64::from(s.offset.clamp(0.0, 1.0));
    let opacita = |s: &GradientStop| f64::from(s.opacity.clamp(0.0, 1.0));
    // Il colore e l'opacità in ogni tratto, coi capi pieni del primo e
    // dell'ultimo punto.
    let mut tratti: Vec<(&GradientStop, &GradientStop, f64)> = Vec::new();
    if quota(primo) > 0.0 {
        tratti.push((primo, primo, quota(primo)));
    }
    for w in punti.windows(2) {
        tratti.push((&w[0], &w[1], quota(&w[1]) - quota(&w[0])));
    }
    if quota(ultimo) < 1.0 {
        tratti.push((ultimo, ultimo, 1.0 - quota(ultimo)));
    }
    let (mut somma, mut semplice) = ([0.0; 3], [0.0; 3]);
    let (mut peso, mut totale) = (0.0, 0.0);
    for (da, a, largo) in tratti {
        if !oltre(largo, 0.0) {
            continue;
        }
        let (p, q) = (canali(da), canali(a));
        let (a0, a1) = (opacita(da), opacita(a));
        for c in 0..3 {
            let (x, y) = (p[c], q[c]);
            // ∫ (x(1−s) + ys)(a0(1−s) + a1 s) ds, e ∫ x(1−s) + ys ds.
            somma[c] += largo * ((x * a0) / 3.0 + (x * a1 + y * a0) / 6.0 + (y * a1) / 3.0);
            semplice[c] += largo * (x + y) / 2.0;
        }
        peso += largo * (a0 + a1) / 2.0;
        totale += largo;
    }
    if totale == 0.0 {
        return primo.color.to_hex();
    }
    let valori = if peso > 1e-9 {
        somma.map(|v| v / peso)
    } else {
        semplice.map(|v| v / totale)
    };
    let [r, g, b] = valori.map(|v| v.round().clamp(0.0, 255.0) as u8);
    format!("#{r:02x}{g:02x}{b:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use vectorcraft_doc::color::{Color, Gradient};
    use vectorcraft_geom::Point;

    fn punto(offset: f32, color: Color, opacity: f32) -> GradientStop {
        let mut s = GradientStop::new(offset, color);
        s.opacity = opacity;
        s
    }

    fn lineare(punti: Vec<GradientStop>) -> GradientPaint {
        GradientPaint::new(Gradient::new(GradientKind::Linear, punti))
    }

    #[test]
    fn la_media_pesa_l_opacita() {
        let rosso = Color::rgb(1.0, 0.0, 0.0);
        // Pieno e trasparente: la media resta il colore.
        assert_eq!(
            media(&[punto(0.0, rosso, 1.0), punto(1.0, rosso, 0.0)]),
            "#ff0000"
        );
        // Dal bianco al nero, pieni: il grigio a metà.
        assert_eq!(
            media(&[punto(0.0, Color::WHITE, 1.0), punto(1.0, Color::BLACK, 1.0)]),
            "#808080"
        );
        // Tutti trasparenti: la media semplice.
        assert_eq!(
            media(&[punto(0.0, Color::WHITE, 0.0), punto(1.0, Color::BLACK, 0.0)]),
            "#808080"
        );
        assert_eq!(media(&[]), "#000000");
    }

    #[test]
    fn una_lineare_si_scrive_nelle_coordinate_dell_elemento() {
        let p = lineare(vec![
            punto(0.0, Color::WHITE, 1.0),
            punto(1.0, Color::BLACK, 0.5),
        ]);
        let limiti = Rect::new(100.0, 100.0, 200.0, 150.0);
        // L'elemento è spostato di (100, 0): le coordinate si leggono lì.
        let s = scritta(&p, limiti, Affine::translate((-100.0, 0.0))).expect("si scrive");
        let e = s.elem("rabcdefgh");
        assert_eq!(e["tag"], "linearGradient");
        assert_eq!(e["attrs"]["fub:role"], "private");
        assert_eq!(e["attrs"]["x1"], "0");
        assert_eq!(e["attrs"]["y1"], "125");
        assert_eq!(e["attrs"]["x2"], "100");
        assert_eq!(e["children"][1]["attrs"]["stop-opacity"], "0.5");
        assert!(e["attrs"].get("gradientTransform").is_none());
    }

    #[test]
    fn una_radiale_schiacciata_scrive_l_ellisse() {
        let mut p = GradientPaint::new(Gradient::new(
            GradientKind::Radial,
            vec![punto(0.0, Color::WHITE, 1.0), punto(1.0, Color::BLACK, 1.0)],
        ));
        p.geom = Some(vectorcraft_doc::color::GradientGeom {
            start: Point::new(150.0, 125.0),
            end: Point::new(200.0, 125.0),
            aspect: 0.5,
            focal: None,
        });
        let s = scritta(&p, Rect::new(100.0, 100.0, 200.0, 150.0), Affine::IDENTITY)
            .expect("si scrive");
        let e = s.elem("rabcdefgh");
        assert_eq!(e["attrs"]["r"], "50");
        assert_eq!(e["attrs"]["gradientTransform"], "matrix(1 0 0 0.5 0 62.5)");
    }

    #[test]
    fn cio_che_la_scena_non_dice_non_si_scrive() {
        let mut p = lineare(vec![
            punto(0.0, Color::WHITE, 1.0),
            punto(1.0, Color::BLACK, 1.0),
        ]);
        assert!(scrivibile(&p));
        p.gradient.stops[0].midpoint = 0.3;
        assert!(!scrivibile(&p));
        let mut q = lineare(vec![
            punto(0.0, Color::WHITE, 1.0),
            punto(1.0, Color::BLACK, 1.0),
        ]);
        q.gradient.dither = true;
        assert!(!scrivibile(&q));
        // Un piano schiacciato.
        let r = lineare(vec![
            punto(0.0, Color::WHITE, 1.0),
            punto(1.0, Color::BLACK, 1.0),
        ]);
        assert!(scritta(
            &r,
            Rect::new(0.0, 0.0, 10.0, 10.0),
            Affine::scale_non_uniform(1.0, 0.0)
        )
        .is_none());
    }
}
