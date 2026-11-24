//! Il profilo dello spessore fra il motore e il file.
//!
//! Nel motore una linea a spessore variabile è un tracciato con un contorno e un
//! [`WidthProfile`]: punti `(t, sinistra, destra)` con i fattori della mezza larghezza, lineari fra
//! un punto e l'altro (`WidthProfile::at`). Nel file è un `path` con `fub:shape="width"`
//! (`docs/reference/scene-format-width.md`): larghezze assolute, morbide fra un punto e l'altro
//! (l'interpolazione monotona di Fritsch e Carlson).
//!
//! - All'apertura ([`dal_file`]) i punti del file diventano fattori del peso (la larghezza più
//!   grande); se sono un profilo del menu scritto da qui, tornano quel profilo.
//! - Alla scrittura ([`nel_file`]) un tracciato col solo contorno a profilo diventa la linea del
//!   formato. Perché la curva morbida disegni la retta di VectorCraft, accanto a ogni spigolo del
//!   profilo si aggiunge un punto sulla retta, a un centesimo della lunghezza ([`denso`]): fra due
//!   punti sulla stessa retta la curva è quella retta.
//!
//! Un tracciato con altro (un riempimento, un tratteggio, le frecce, un pennello, un contorno non
//! pieno o non centrato, più sottotracciati) non è una linea del formato: va con la sua ricetta.

use vectorcraft_doc::color::{BlendMode, Paint};
use vectorcraft_doc::{
    AppearanceItem, LineCap, LineJoin, Node, NodeKind, StrokeAlign, StrokeLayer, WidthProfile,
};
use vectorcraft_geom::{Affine, PathData};

use fub_scene::varwidth::{VarWidth, WidthCap, WidthJoin, MAX_POINTS};

use super::{attributi, curve::leggi_d, spessore, Scritto};
use crate::ricetta::{self, Costrutto};

/// Quanto prima e dopo uno spigolo del profilo sta il punto sulla retta.
const ACCANTO: f64 = 0.01;

/// Quanto due larghezze lette dal file possono scostarsi da quelle di un profilo del menu (il file
/// le scrive con due decimali).
const TOLLERANZA: f64 = 0.0051;

/// Il contorno di `n` se `n` è una linea a spessore variabile che il formato sa dire: un tracciato
/// semplice, un sottotracciato solo, col solo contorno, pieno, centrato, a profilo.
pub(crate) fn variabile(n: &Node) -> Option<&StrokeLayer> {
    let NodeKind::Path {
        path,
        live: None,
        clipping: false,
        guide: false,
        ..
    } = &n.kind
    else {
        return None;
    };
    if path.subpaths.len() != 1 || !n.appearance.effects.is_empty() {
        return None;
    }
    let mut contorno = None;
    for item in &n.appearance.items {
        match item {
            AppearanceItem::Fill(f) if !f.visible || f.paint.is_none() => {}
            AppearanceItem::Stroke(s) if contorno.is_none() => contorno = Some(s),
            _ => return None,
        }
    }
    let s = contorno?;
    let semplice = s.profile.is_some()
        && s.visible
        && matches!(s.paint, Paint::Solid { .. })
        && s.width > 0.0
        && s.dash.is_none()
        && s.start_arrow.is_none()
        && s.end_arrow.is_none()
        && s.brush.is_none()
        && s.align == StrokeAlign::Center
        && !s.overprint
        && s.pressure.is_none()
        && s.gradient_mode == Default::default()
        && s.effects.is_empty()
        && s.opacity == 1.0
        && s.blend == BlendMode::default();
    let solo_questo = ricetta::costrutti(n)
        .iter()
        .all(|c| matches!(c, Costrutto::Tracciato | Costrutto::SpessoreVariabile));
    (semplice && solo_questo).then_some(s)
}

fn cap(c: LineCap) -> WidthCap {
    match c {
        LineCap::Butt => WidthCap::Butt,
        LineCap::Round => WidthCap::Round,
        LineCap::Square => WidthCap::Square,
    }
}

fn join(j: LineJoin) -> WidthJoin {
    match j {
        LineJoin::Miter => WidthJoin::Miter,
        LineJoin::Round => WidthJoin::Round,
        LineJoin::Bevel => WidthJoin::Bevel,
    }
}

/// Il valore di `stroke-linecap` e `stroke-linejoin` per il motore, all'apertura.
pub(crate) fn parole(v: &VarWidth) -> (&'static str, &'static str) {
    let c = match v.cap {
        WidthCap::Butt => "butt",
        WidthCap::Round => "round",
        WidthCap::Square => "square",
    };
    let j = match v.join {
        WidthJoin::Miter => "miter",
        WidthJoin::Round => "round",
        WidthJoin::Bevel => "bevel",
    };
    (c, j)
}

/// `p` portato da `m`.
fn trasformato(p: &PathData, m: Affine) -> PathData {
    let mut c = p.clone();
    c.transform(m);
    c
}

/// `fub:geom` e `d` della linea `n` ([`variabile`]) nello spazio dove `locale` la porta, e il
/// colore del suo contorno; `None` se non è una linea del formato o il contorno non riesce.
pub(crate) fn nel_file(n: &Node, locale: Affine) -> Option<(Scritto, &Paint)> {
    let s = variabile(n)?;
    let profilo = s.profile.as_ref()?;
    let NodeKind::Path { path, .. } = &n.kind else {
        return None;
    };
    let scala = locale.determinant().abs().sqrt();
    let peso = s.width * scala;
    if !(peso > 0.0 && peso.is_finite()) {
        return None;
    }
    let punti: Vec<[f64; 3]> = denso(&profilo.points)
        .into_iter()
        .map(|(t, l, r)| [t, l * peso / 2.0, r * peso / 2.0])
        .collect();
    if punti.len() > MAX_POINTS {
        return None;
    }
    let linea = leggi_d(&crate::differenza::scrivi_d(&trasformato(path, locale)))?;
    let scritto = attributi(cap(s.cap), join(s.join), &punti, &linea)?;
    Some((scritto, &s.paint))
}

/// Il peso (la larghezza più grande) e il profilo del motore della linea `v` del file.
pub(crate) fn dal_file(v: &VarWidth) -> Option<(f64, WidthProfile)> {
    let peso = spessore(&v.profile);
    if !(peso > 0.0 && peso.is_finite()) {
        return None;
    }
    let mezzo = peso / 2.0;
    let fattori: Vec<(f64, f64, f64)> = v
        .profile
        .iter()
        .map(|&[t, s, d]| (t, s / mezzo, d / mezzo))
        .collect();
    let del_menu = WidthProfile::PRESETS.iter().find(|p| {
        let atteso = denso(p.points);
        atteso.len() == fattori.len()
            && atteso.iter().zip(&fattori).all(|(a, b)| {
                (a.0 - b.0).abs() <= 1e-4
                    && ((a.1 - b.1) * mezzo).abs() <= TOLLERANZA
                    && ((a.2 - b.2) * mezzo).abs() <= TOLLERANZA
            })
    });
    let points = del_menu.map_or(fattori, |p| p.points.to_vec());
    Some((peso, WidthProfile { points }))
}

/// I punti `p` con, accanto a ogni spigolo che non sta ai capi, un punto sulla retta da ogni parte
/// dove il profilo va avanti.
pub(crate) fn denso(p: &[(f64, f64, f64)]) -> Vec<(f64, f64, f64)> {
    let n = p.len();
    let mut out = Vec::with_capacity(n * 3);
    let su = |a: (f64, f64, f64), b: (f64, f64, f64), t: f64| {
        let u = (t - a.0) / (b.0 - a.0);
        (t, a.1 + (b.1 - a.1) * u, a.2 + (b.2 - a.2) * u)
    };
    for k in 0..n {
        let q = p[k];
        let prima = (k > 0 && p[k - 1].0 < q.0).then(|| p[k - 1]);
        let dopo = (k + 1 < n && p[k + 1].0 > q.0).then(|| p[k + 1]);
        let spigolo = k > 0 && k + 1 < n && !dritto(prima, q, dopo);
        if let (true, Some(a)) = (spigolo, prima) {
            let d = ACCANTO.min((q.0 - a.0) / 3.0);
            out.push(su(a, q, q.0 - d));
        }
        out.push(q);
        if let (true, Some(b)) = (spigolo, dopo) {
            let d = ACCANTO.min((b.0 - q.0) / 3.0);
            out.push(su(q, b, q.0 + d));
        }
    }
    out
}

/// Vero se `q` sta sulla retta fra `a` e `b`, per i due lati.
fn dritto(a: Option<(f64, f64, f64)>, q: (f64, f64, f64), b: Option<(f64, f64, f64)>) -> bool {
    let (Some(a), Some(b)) = (a, b) else {
        return false;
    };
    let pendenza = |x: f64, y: f64, h: f64| (y - x) / h;
    let (h0, h1) = (q.0 - a.0, b.0 - q.0);
    (pendenza(a.1, q.1, h0) - pendenza(q.1, b.1, h1)).abs() < 1e-9
        && (pendenza(a.2, q.2, h0) - pendenza(q.2, b.2, h1)).abs() < 1e-9
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn la_lente_ha_un_punto_sulla_retta_accanto_alla_punta() {
        let lente = WidthProfile::preset("lens").expect("c'è");
        let d = denso(&lente.points);
        assert_eq!(d.len(), 5, "{d:?}");
        assert!(
            (d[1].0 - 0.49).abs() < 1e-12 && (d[1].1 - 0.98).abs() < 1e-12,
            "{d:?}"
        );
        assert!(
            (d[3].0 - 0.51).abs() < 1e-12 && (d[3].2 - 0.98).abs() < 1e-12,
            "{d:?}"
        );
    }

    #[test]
    fn un_profilo_dritto_non_cambia() {
        for id in ["uniform", "taperStart", "taperEnd"] {
            let p = WidthProfile::preset(id).expect("c'è");
            assert_eq!(denso(&p.points), p.points, "{id}");
        }
    }

    #[test]
    fn uno_scalino_ha_i_punti_solo_dalla_parte_dove_si_va_avanti() {
        let p = [
            (0.0, 1.0, 1.0),
            (0.5, 1.0, 1.0),
            (0.5, 0.2, 0.2),
            (1.0, 0.2, 0.2),
        ];
        let d = denso(&p);
        let t: Vec<f64> = d.iter().map(|q| q.0).collect();
        assert_eq!(t, vec![0.0, 0.49, 0.5, 0.5, 0.51, 1.0]);
    }

    #[test]
    fn ogni_profilo_del_menu_torna_dal_file() {
        for preset in WidthProfile::PRESETS {
            let peso = 6.0;
            let profile: Vec<[f64; 3]> = denso(preset.points)
                .into_iter()
                .map(|(t, l, r)| {
                    let due = |x: f64| (x * peso / 2.0 * 100.0).round() / 100.0;
                    [(t * 1e4).round() / 1e4, due(l), due(r)]
                })
                .collect();
            let v = VarWidth {
                cap: WidthCap::Round,
                join: WidthJoin::Round,
                profile,
                spine: "M0 0 L100 0".into(),
            };
            let (p, w) = dal_file(&v).expect("si legge");
            assert!(
                (p - peso).abs() < 1e-9 || preset.id == "pinch" || preset.id == "wave",
                "{}",
                preset.id
            );
            assert_eq!(w.points, preset.points.to_vec(), "{}", preset.id);
        }
    }
}
