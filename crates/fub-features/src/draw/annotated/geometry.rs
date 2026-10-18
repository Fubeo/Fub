//! La pagina come la mostra pdf.js, e la strada di ritorno.
//!
//! Le coordinate di un `.fubann` sono quelle della pagina **come si mostra**
//! nell'editor: pdf.js a scala 1, con la rotazione della pagina già applicata,
//! l'origine in alto a sinistra e l'asse y verso il basso (formato delle
//! annotazioni, §2 e §3). Per disegnarle dentro il PDF serve la trasformazione
//! inversa, dallo spazio delle annotazioni allo spazio utente della pagina,
//! con l'origine in basso.
//!
//! Qui si rifà, con gli stessi casi limite, il conto di pdf.js 6.3: la vista
//! è l'intersezione di `CropBox` e `MediaBox` se non è vuota, altrimenti la
//! `MediaBox`, e la `MediaBox` di una pagina che non ne ha una valida è il
//! formato Letter; la rotazione si eredita, vale solo se è un multiplo di 90 e
//! si riporta fra 0 e 270; `UserUnit` è della pagina sola, e moltiplica la
//! scala. Un'altra regola, anche più fedele alla norma, sposterebbe le
//! annotazioni rispetto a dove chi le ha disegnate le ha viste.

use std::collections::BTreeSet;

use lopdf::{Dictionary, Document, Object, ObjectId};

/// La `MediaBox` di una pagina che non ne ha una valida: Letter, come pdf.js.
const LETTER: [f64; 4] = [0.0, 0.0, 612.0, 792.0];

/// Una trasformazione affine del PDF, `[a b c d e f]`: il punto `(x, y)` va in
/// `(a·x + c·y + e, b·x + d·y + f)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Matrix(pub [f64; 6]);

impl Matrix {
    pub(crate) const IDENTITY: Matrix = Matrix([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);

    /// Prima `self`, poi `next`: il prodotto `self × next` della convenzione
    /// del PDF, dove i punti sono vettori riga.
    pub(crate) fn then(self, next: Matrix) -> Matrix {
        let [a, b, c, d, e, f] = self.0;
        let [na, nb, nc, nd, ne, nf] = next.0;
        Matrix([
            a * na + b * nc,
            a * nb + b * nd,
            c * na + d * nc,
            c * nb + d * nd,
            e * na + f * nc + ne,
            e * nb + f * nd + nf,
        ])
    }

    /// L'inversa, se la trasformazione non schiaccia il piano.
    pub(crate) fn invert(self) -> Option<Matrix> {
        let [a, b, c, d, e, f] = self.0;
        let det = a * d - b * c;
        if det == 0.0 || !det.is_finite() {
            return None;
        }
        Some(Matrix([
            d / det,
            -b / det,
            -c / det,
            a / det,
            (c * f - d * e) / det,
            (b * e - a * f) / det,
        ]))
    }

    pub(crate) fn apply(self, x: f64, y: f64) -> (f64, f64) {
        let [a, b, c, d, e, f] = self.0;
        (a * x + c * y + e, b * x + d * y + f)
    }

    /// Il rettangolo che contiene l'immagine di `rect` (`[x0 y0 x1 y1]`).
    pub(crate) fn bounds(self, rect: [f64; 4]) -> [f64; 4] {
        let corners = [
            self.apply(rect[0], rect[1]),
            self.apply(rect[2], rect[1]),
            self.apply(rect[2], rect[3]),
            self.apply(rect[0], rect[3]),
        ];
        let mut out = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for (x, y) in corners {
            out[0] = out[0].min(x);
            out[1] = out[1].min(y);
            out[2] = out[2].max(x);
            out[3] = out[3].max(y);
        }
        out
    }
}

/// Ciò che decide dove si vede una pagina.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Geometry {
    /// La vista in spazio utente, `[x0 y0 x1 y1]` normalizzato: l'intersezione
    /// di `CropBox` e `MediaBox`, o la `MediaBox`.
    pub(crate) view: [f64; 4],
    /// 0, 90, 180 o 270, in senso orario.
    pub(crate) rotate: u16,
    /// La misura dell'unità dello spazio utente, in 1/72 di pollice.
    pub(crate) user_unit: f64,
}

impl Geometry {
    /// La geometria della pagina `page` di `doc`, con le regole di pdf.js.
    pub(crate) fn of(doc: &Document, page: ObjectId) -> Geometry {
        let Ok(dict) = doc.get_dictionary(page) else {
            return Geometry {
                view: LETTER,
                rotate: 0,
                user_unit: 1.0,
            };
        };
        let media = inherited(doc, page, b"MediaBox")
            .and_then(|value| rect(doc, value))
            .unwrap_or(LETTER);
        let crop = inherited(doc, page, b"CropBox").and_then(|value| rect(doc, value));
        let view = match crop {
            Some(crop) if crop != media => intersect(crop, media).unwrap_or(media),
            _ => media,
        };
        let rotate = inherited(doc, page, b"Rotate")
            .and_then(|value| number(doc, value))
            .map_or(0, rotation);
        let user_unit = dict
            .get(b"UserUnit")
            .ok()
            .and_then(|value| number(doc, value))
            .filter(|unit| *unit > 0.0 && unit.is_finite())
            .unwrap_or(1.0);
        Geometry {
            view,
            rotate,
            user_unit,
        }
    }

    /// Vero se la pagina si mostra coricata: larghezza e altezza si scambiano.
    fn sideways(&self) -> bool {
        self.rotate == 90 || self.rotate == 270
    }

    /// La misura della pagina come si mostra, nelle unità delle annotazioni:
    /// la vista ruotata, per `UserUnit`.
    pub(crate) fn size(&self) -> (f64, f64) {
        let [x0, y0, x1, y1] = self.view;
        let (w, h) = ((x1 - x0) * self.user_unit, (y1 - y0) * self.user_unit);
        if self.sideways() {
            (h, w)
        } else {
            (w, h)
        }
    }

    /// La trasformazione del `PageViewport` di pdf.js a scala 1: dallo spazio
    /// utente della pagina a quello delle annotazioni.
    pub(crate) fn viewport(&self) -> Matrix {
        let [x0, y0, x1, y1] = self.view;
        let scale = self.user_unit;
        let (cx, cy) = ((x1 + x0) / 2.0, (y1 + y0) / 2.0);
        let (a, b, c, d): (f64, f64, f64, f64) = match self.rotate {
            90 => (0.0, 1.0, 1.0, 0.0),
            180 => (-1.0, 0.0, 0.0, 1.0),
            270 => (0.0, -1.0, -1.0, 0.0),
            _ => (1.0, 0.0, 0.0, -1.0),
        };
        let (ox, oy) = if a == 0.0 {
            ((cy - y0).abs() * scale, (cx - x0).abs() * scale)
        } else {
            ((cx - x0).abs() * scale, (cy - y0).abs() * scale)
        };
        Matrix([
            a * scale,
            b * scale,
            c * scale,
            d * scale,
            ox - a * scale * cx - c * scale * cy,
            oy - b * scale * cx - d * scale * cy,
        ])
    }

    /// Dalle annotazioni allo spazio utente della pagina. La vista ha area
    /// positiva e la scala è positiva, quindi l'inversa c'è sempre.
    pub(crate) fn page_space(&self) -> Matrix {
        self.viewport()
            .invert()
            .expect("una vista con area positiva si inverte")
    }
}

/// Il valore più vicino di un attributo ereditabile: della pagina, o del primo
/// antenato che lo scrive. Come in pdf.js, un valore scritto ma non valido non
/// lascia il posto a quello di un antenato.
pub(crate) fn inherited<'a>(doc: &'a Document, page: ObjectId, key: &[u8]) -> Option<&'a Object> {
    ancestry(doc, page).find_map(|dict| dict.get(key).ok())
}

/// Il dizionario della pagina e quelli dei suoi antenati, dal più vicino.
///
/// Come in pdf.js la risalita non ha un limite di profondità: finisce al primo
/// `Parent` che manca o non è un dizionario, e a un genitore già visto, così un
/// ciclo non la tiene ferma. Un `Parent` scritto come dizionario diretto vale
/// come uno indiretto.
pub(crate) fn ancestry(doc: &Document, page: ObjectId) -> impl Iterator<Item = &Dictionary> {
    let mut seen = BTreeSet::from([page]);
    let mut next = doc.get_dictionary(page).ok();
    std::iter::from_fn(move || {
        let dict = next.take()?;
        next = match dict.get(b"Parent") {
            Ok(Object::Reference(id)) if seen.insert(*id) => doc.get_dictionary(*id).ok(),
            Ok(Object::Dictionary(parent)) => Some(parent),
            _ => None,
        };
        Some(dict)
    })
}

/// Un numero, anche dietro un riferimento.
pub(crate) fn number(doc: &Document, value: &Object) -> Option<f64> {
    match doc.dereference(value).ok()?.1 {
        Object::Integer(n) => Some(*n as f64),
        Object::Real(n) => Some(f64::from(*n)),
        _ => None,
    }
}

/// Un rettangolo di quattro numeri, normalizzato e con area positiva.
pub(crate) fn rect(doc: &Document, value: &Object) -> Option<[f64; 4]> {
    let items = doc.dereference(value).ok()?.1.as_array().ok()?;
    if items.len() != 4 {
        return None;
    }
    let mut n = [0.0; 4];
    for (slot, item) in n.iter_mut().zip(items) {
        *slot = number(doc, item).filter(|v| v.is_finite())?;
    }
    let r = [
        n[0].min(n[2]),
        n[1].min(n[3]),
        n[0].max(n[2]),
        n[1].max(n[3]),
    ];
    (r[2] - r[0] > 0.0 && r[3] - r[1] > 0.0).then_some(r)
}

/// L'intersezione di due rettangoli, se ha area positiva.
fn intersect(a: [f64; 4], b: [f64; 4]) -> Option<[f64; 4]> {
    let r = [
        a[0].max(b[0]),
        a[1].max(b[1]),
        a[2].min(b[2]),
        a[3].min(b[3]),
    ];
    (r[2] - r[0] > 0.0 && r[3] - r[1] > 0.0).then_some(r)
}

/// La rotazione come la legge pdf.js: un multiplo di 90 riportato fra 0 e
/// 270, e 0 per ogni altro valore.
fn rotation(value: f64) -> u16 {
    if !value.is_finite() || value % 90.0 != 0.0 {
        return 0;
    }
    (value.rem_euclid(360.0)) as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::dictionary;

    /// Una pagina con gli attributi dati, figlia di un nodo `Pages` con i suoi.
    fn page(own: Dictionary, parent: Dictionary) -> (Document, ObjectId) {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let mut own = own;
        own.set("Type", "Page");
        own.set("Parent", pages);
        let id = doc.add_object(own);
        let mut parent = parent;
        parent.set("Type", "Pages");
        parent.set("Kids", vec![id.into()]);
        parent.set("Count", 1);
        doc.objects.insert(pages, Object::Dictionary(parent));
        (doc, id)
    }

    fn close(a: (f64, f64), b: (f64, f64)) -> bool {
        (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9
    }

    #[test]
    fn the_view_follows_pdf_js() {
        // Senza MediaBox valida: Letter.
        let (doc, id) = page(dictionary! {}, dictionary! {});
        assert_eq!(Geometry::of(&doc, id).view, LETTER);
        let (doc, id) = page(
            dictionary! { "MediaBox" => vec![0.into(), 0.into(), 0.into(), 10.into()] },
            dictionary! { "MediaBox" => vec![0.into(), 0.into(), 300.into(), 400.into()] },
        );
        assert_eq!(
            Geometry::of(&doc, id).view,
            LETTER,
            "il valore vicino vince anche se non vale"
        );
        // Ereditata, rovesciata e normalizzata.
        let (doc, id) = page(
            dictionary! {},
            dictionary! { "MediaBox" => vec![300.into(), 400.into(), 0.into(), 0.into()] },
        );
        assert_eq!(Geometry::of(&doc, id).view, [0.0, 0.0, 300.0, 400.0]);
        // CropBox dentro la MediaBox, e una che ne esce del tutto.
        let (doc, id) = page(
            dictionary! {
                "MediaBox" => vec![0.into(), 0.into(), 600.into(), 800.into()],
                "CropBox" => vec![50.into(), 60.into(), 650.into(), 700.into()],
            },
            dictionary! {},
        );
        assert_eq!(Geometry::of(&doc, id).view, [50.0, 60.0, 600.0, 700.0]);
        let (doc, id) = page(
            dictionary! {
                "MediaBox" => vec![0.into(), 0.into(), 600.into(), 800.into()],
                "CropBox" => vec![700.into(), 0.into(), 900.into(), 800.into()],
            },
            dictionary! {},
        );
        assert_eq!(Geometry::of(&doc, id).view, [0.0, 0.0, 600.0, 800.0]);
    }

    #[test]
    fn the_rotation_is_a_multiple_of_ninety_and_is_inherited() {
        for (written, read) in [
            (Object::Integer(90), 90),
            (Object::Integer(-90), 270),
            (Object::Integer(450), 90),
            (Object::Integer(-540), 180),
            (Object::Real(180.0), 180),
            (Object::Integer(45), 0),
            (Object::Real(90.5), 0),
            (Object::Name(b"Ninety".to_vec()), 0),
        ] {
            let (doc, id) = page(dictionary! {}, dictionary! { "Rotate" => written.clone() });
            assert_eq!(Geometry::of(&doc, id).rotate, read, "{written:?}");
        }
        let (doc, id) = page(
            dictionary! { "Rotate" => 0 },
            dictionary! { "Rotate" => 90 },
        );
        assert_eq!(
            Geometry::of(&doc, id).rotate,
            0,
            "la pagina vince sul genitore"
        );
    }

    #[test]
    fn the_ancestry_follows_direct_parents_and_stops_at_a_cycle() {
        // Un genitore scritto come dizionario diretto vale come uno indiretto.
        let mut doc = Document::with_version("1.7");
        let id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => dictionary! { "Type" => "Pages", "Rotate" => 270 },
        });
        assert_eq!(Geometry::of(&doc, id).rotate, 270);
        // La pagina che è genitore di sé stessa, e due nodi che si nominano a
        // vicenda: la risalita finisce, e ogni dizionario si vede una volta.
        let mut doc = Document::with_version("1.7");
        let id = doc.new_object_id();
        doc.objects.insert(
            id,
            Object::Dictionary(dictionary! { "Type" => "Page", "Parent" => id }),
        );
        assert_eq!(ancestry(&doc, id).count(), 1);
        assert_eq!(Geometry::of(&doc, id).view, LETTER);
        let mut doc = Document::with_version("1.7");
        let (a, b) = (doc.new_object_id(), doc.new_object_id());
        doc.objects
            .insert(a, Object::Dictionary(dictionary! { "Parent" => b }));
        doc.objects.insert(
            b,
            Object::Dictionary(dictionary! { "Parent" => a, "Rotate" => 90 }),
        );
        let page = doc.add_object(dictionary! { "Type" => "Page", "Parent" => a });
        assert_eq!(ancestry(&doc, page).count(), 3);
        assert_eq!(Geometry::of(&doc, page).rotate, 90);
    }

    #[test]
    fn the_user_unit_is_the_pages_own() {
        let (doc, id) = page(dictionary! {}, dictionary! { "UserUnit" => 2 });
        assert_eq!(Geometry::of(&doc, id).user_unit, 1.0);
        let (doc, id) = page(dictionary! { "UserUnit" => 2.5 }, dictionary! {});
        assert_eq!(Geometry::of(&doc, id).user_unit, 2.5);
        let (doc, id) = page(dictionary! { "UserUnit" => -1 }, dictionary! {});
        assert_eq!(Geometry::of(&doc, id).user_unit, 1.0);
    }

    /// Le quattro rotazioni con una vista spostata dall'origine: la matrice è
    /// quella che si ricava a mano, e i quattro angoli della pagina come si
    /// mostra vanno nei quattro angoli giusti della vista.
    #[test]
    fn the_way_back_puts_each_corner_where_pdf_js_showed_it() {
        let view = [10.0, 20.0, 310.0, 420.0];
        let (x0, y0, x1, y1) = (view[0], view[1], view[2], view[3]);
        for (rotate, size, corners) in [
            // In alto a sinistra, in alto a destra, in basso a sinistra.
            (0, (300.0, 400.0), [(x0, y1), (x1, y1), (x0, y0)]),
            (90, (400.0, 300.0), [(x0, y0), (x0, y1), (x1, y0)]),
            (180, (300.0, 400.0), [(x1, y0), (x0, y0), (x1, y1)]),
            (270, (400.0, 300.0), [(x1, y1), (x1, y0), (x0, y1)]),
        ] {
            let geometry = Geometry {
                view,
                rotate,
                user_unit: 1.0,
            };
            assert_eq!(geometry.size(), size, "{rotate}");
            let back = geometry.page_space();
            let (w, h) = size;
            assert!(
                close(back.apply(0.0, 0.0), corners[0]),
                "{rotate}: {:?}",
                back.apply(0.0, 0.0)
            );
            assert!(
                close(back.apply(w, 0.0), corners[1]),
                "{rotate}: {:?}",
                back.apply(w, 0.0)
            );
            assert!(
                close(back.apply(0.0, h), corners[2]),
                "{rotate}: {:?}",
                back.apply(0.0, h)
            );
            let there = geometry.viewport().apply(corners[0].0, corners[0].1);
            assert!(close(there, (0.0, 0.0)), "{rotate}");
        }
    }

    #[test]
    fn the_user_unit_scales_the_annotations() {
        let geometry = Geometry {
            view: [0.0, 0.0, 100.0, 50.0],
            rotate: 0,
            user_unit: 3.0,
        };
        assert_eq!(geometry.size(), (300.0, 150.0));
        assert!(close(
            geometry.page_space().apply(300.0, 150.0),
            (100.0, 0.0)
        ));
    }

    #[test]
    fn a_matrix_composes_and_inverts() {
        let m = Matrix([2.0, 0.5, -1.0, 3.0, 7.0, -4.0]);
        let n = Matrix([0.0, 1.0, -1.0, 0.0, 2.0, 2.0]);
        let (x, y) = m.then(n).apply(1.5, -2.0);
        let (mx, my) = m.apply(1.5, -2.0);
        assert!(close((x, y), n.apply(mx, my)));
        let back = m.then(m.invert().unwrap());
        assert!(close(back.apply(3.0, 4.0), (3.0, 4.0)));
        assert_eq!(Matrix([1.0, 2.0, 2.0, 4.0, 0.0, 0.0]).invert(), None);
    }
}
