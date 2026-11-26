//! I campioni predefiniti del motore nel formato del disegno (`swatch.resetDefaults`, K6 T14;
//! `docs/reference/scene-format-resources.md` §2, `docs/product/drawing-colors.md`).
//!
//! Il motore rimette i suoi campioni e gruppi di serie (`default_swatches`): colori pieni non
//! globali coi nomi inglesi, due gruppi (grigi e colori brillanti) e quattro sfumature. Il file ha
//! solo colori pieni globali, quindi qui:
//!
//! - **i nomi** passano in italiano, con la tabella [`NOMI`]: Fub non ha ancora una via per dare al
//!   motore la lingua dell'app, e le altre parole che `fub-disegno` dice al posto del motore sono in
//!   italiano. Un nome italiano che il disegno ha già vuol dire che quel campione c'è: non torna una
//!   seconda volta. Un gruppo che c'è già prende i membri che gli mancano;
//! - **le sfumature** non entrano: sono una perdita dichiarata nell'esito (`unsupported`), una per
//!   sfumatura;
//! - **i colori CMYK o Lab** (un documento in CMYK) si scrivono `#rrggbb`: una perdita dichiarata
//!   (`approximated`). Un grigio si scrive uguale in RGB, e non lo è;
//! - **ogni campione** diventa globale, come gli altri campioni del file.
//!
//! Chi usava un campione che il ripristino toglie (`replace: true`) resta col suo colore: il motore
//! lo scioglie dal campione, e la differenza lo scrive senza riferimento.

use std::collections::HashSet;

use fub_abi::{DrawingLoss, DrawingLossKind};
use vectorcraft_doc::color::{Color, Paint, Swatch, SwatchGroup};
use vectorcraft_doc::Document;

/// I nomi dei campioni e dei gruppi di serie del motore (`vectorcraft_color::swatch`), in italiano.
/// I grigi (`K=90`…) hanno un nome che non si traduce.
pub(crate) const NOMI: &[(&str, &str)] = &[
    ("White", "Bianco"),
    ("Black", "Nero"),
    ("Red", "Rosso"),
    ("Orange Red", "Rosso arancio"),
    ("Orange", "Arancio"),
    ("Amber", "Ambra"),
    ("Yellow", "Giallo"),
    ("Yellow Green", "Giallo verde"),
    ("Lime", "Lime"),
    ("Green", "Verde"),
    ("Emerald", "Smeraldo"),
    ("Teal", "Verde petrolio"),
    ("Aqua", "Acquamarina"),
    ("Cyan Green", "Verde ciano"),
    ("Cyan", "Ciano"),
    ("Azure", "Azzurro"),
    ("Blue", "Blu"),
    ("Indigo", "Indaco"),
    ("Violet", "Viola"),
    ("Purple", "Porpora"),
    ("Magenta", "Magenta"),
    ("Rose", "Rosa"),
    ("Pink", "Rosa acceso"),
    ("Brown", "Nocciola"),
    ("Tan", "Cuoio"),
    ("Coffee", "Caffè"),
    ("Chocolate", "Cioccolato"),
    ("Sand", "Sabbia"),
    ("Copper", "Rame"),
    ("Rust", "Ruggine"),
    ("Walnut", "Noce"),
    ("Espresso", "Espresso"),
    ("White, Black", "Bianco, nero"),
    ("Radial White, Black", "Radiale bianco, nero"),
    ("Sunset", "Tramonto"),
    ("Ocean", "Oceano"),
    ("Grays", "Grigi"),
    ("Brights", "Brillanti"),
    ("Bright Red", "Rosso brillante"),
    ("Bright Yellow", "Giallo brillante"),
    ("Bright Green", "Verde brillante"),
    ("Bright Blue", "Blu brillante"),
    ("Bright Violet", "Viola brillante"),
];

/// Il nome italiano di un campione o di un gruppo di serie; gli altri restano come sono.
pub(crate) fn in_italiano(nome: &str) -> &str {
    NOMI.iter()
        .find(|(en, _)| *en == nome)
        .map_or(nome, |(_, it)| it)
}

/// Il nome dell'elemento delle perdite che non sono di un campione solo.
const CAMPIONI_PREDEFINITI: &str = "Campioni predefiniti";

/// Il documento di dopo `swatch.resetDefaults` nel formato, e le perdite da dire. `prima` è il
/// documento della copia, prima del comando: un nome che c'era e c'è ancora è del disegno, e resta
/// com'è; gli altri sono quelli che il motore ha rimesso.
pub(crate) fn porta_i_predefiniti(
    prima: &Document,
    dopo: &Document,
) -> (Document, Vec<DrawingLoss>) {
    let di_prima: HashSet<&str> = prima
        .swatches_iter()
        .map(|s| s.name.as_str())
        .chain(prima.swatch_groups.iter().map(|g| g.name.as_str()))
        .collect();
    let del_disegno = |nome: &str| di_prima.contains(nome);
    // I nomi presi nel documento che si scrive: quelli del disegno rimasti dopo il comando.
    let mut presi: HashSet<String> = dopo
        .swatches_iter()
        .map(|s| s.name.clone())
        .chain(dopo.swatch_groups.iter().map(|g| g.name.clone()))
        .filter(|n| del_disegno(n))
        .collect();
    let mut perdite = Vec::new();
    let mut approssimati = false;
    let mut porta = |s: &Swatch, presi: &mut HashSet<String>| -> Option<Swatch> {
        if s.is_reserved() || del_disegno(&s.name) {
            return Some(s.clone());
        }
        let nome = in_italiano(&s.name).to_string();
        let Paint::Solid { color, .. } = &s.paint else {
            perdite.push(DrawingLoss {
                element: nome.clone(),
                kind: DrawingLossKind::Unsupported,
                detail: format!(
                    "«{nome}» è una sfumatura: il formato del disegno ha solo colori pieni, e il campione non entra."
                ),
            });
            return None;
        };
        if !presi.insert(nome.clone()) {
            return None;
        }
        approssimati |= !matches!(color, Color::Rgb { .. } | Color::Gray { .. });
        Some(Swatch {
            name: nome,
            paint: Paint::solid(*color),
            global: true,
            spot: false,
        })
    };
    let mut nuovo = dopo.clone();
    let senza: Vec<Swatch> = dopo
        .swatches
        .iter()
        .filter_map(|s| porta(s, &mut presi))
        .collect();
    let mut gruppi: Vec<SwatchGroup> = Vec::new();
    for g in dopo.swatch_groups.iter() {
        let del_file = del_disegno(&g.name);
        let mut nome = if del_file {
            g.name.clone()
        } else {
            in_italiano(&g.name).to_string()
        };
        let membri: Vec<Swatch> = g
            .swatches
            .iter()
            .filter_map(|s| porta(s, &mut presi))
            .collect();
        // Un gruppo rimesso col nome di un gruppo che c'è già gli porta i membri che mancano.
        if let Some(c_e) = gruppi.iter_mut().find(|x| x.name == nome) {
            c_e.swatches.extend(membri);
            continue;
        }
        if !del_file {
            if membri.is_empty() {
                continue;
            }
            let di_un_gruppo = dopo
                .swatch_groups
                .iter()
                .any(|x| x.name == nome && del_disegno(&x.name));
            if presi.contains(&nome) && !di_un_gruppo {
                // Il nome è di un campione del disegno: il gruppo prende un numero.
                nome = (2..)
                    .map(|i| format!("{nome} {i}"))
                    .find(|n| !presi.contains(n))
                    .unwrap_or(nome);
            }
            presi.insert(nome.clone());
        }
        gruppi.push(SwatchGroup {
            name: nome,
            swatches: membri,
        });
    }
    *nuovo.swatches = senza;
    *nuovo.swatch_groups = gruppi;
    if approssimati {
        perdite.push(DrawingLoss {
            element: CAMPIONI_PREDEFINITI.into(),
            kind: DrawingLossKind::Approximated,
            detail: "I colori CMYK o Lab dei campioni predefiniti si scrivono in RGB (#rrggbb): il formato del disegno non tiene il loro modello.".into(),
        });
    }
    (nuovo, perdite)
}

#[cfg(test)]
mod tests {
    use super::*;
    use vectorcraft_doc::color::cms::Model;

    #[test]
    fn ogni_nome_di_serie_ha_il_suo_italiano() {
        let (campioni, gruppi) = vectorcraft_doc::color::default_swatches(Model::Rgb);
        let nomi = campioni
            .iter()
            .chain(gruppi.iter().flat_map(|g| g.swatches.iter()))
            .filter(|s| !s.is_reserved() && !s.name.starts_with("K="))
            .map(|s| s.name.as_str())
            .chain(gruppi.iter().map(|g| g.name.as_str()));
        for nome in nomi {
            // «Lime» è anche la parola italiana: conta che sia nella tabella.
            assert!(
                NOMI.iter().any(|(inglese, _)| *inglese == nome),
                "«{nome}» non ha un nome italiano"
            );
        }
        let italiani: HashSet<&str> = NOMI.iter().map(|(_, it)| *it).collect();
        assert_eq!(
            italiani.len(),
            NOMI.len(),
            "due nomi inglesi con lo stesso italiano"
        );
    }
}
