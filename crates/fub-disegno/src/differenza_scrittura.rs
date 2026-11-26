//! La scrittura della differenza: colori, tratti, numeri, matrici, tracciati ed elementi SVG.

use super::*;

/// [`senza_colori`] di due aspetti, prima e dopo, senza il riempimento o il
/// tratto in cima che c'è da una parte sola: un riempimento o un tratto dato
/// a chi non l'aveva si scrive con `fill`, `stroke` e `stroke-width`, come lo
/// scrive il pannello del client (il resto del tratto nuovo, estremi e
/// angoli, il file lo prende da SVG).
pub(super) fn senza_colori_nuovi(
    prima: &Appearance,
    dopo: &Appearance,
) -> (Appearance, Appearance) {
    let (mut p, mut d) = (senza_colori(prima), senza_colori(dopo));
    let in_cima = |a: &Appearance, riempimento: bool| {
        a.items.iter().rposition(|i| i.is_fill() == riempimento)
    };
    for riempimento in [true, false] {
        match (in_cima(&p, riempimento), in_cima(&d, riempimento)) {
            (Some(i), None) => {
                p.items.remove(i);
            }
            (None, Some(i)) => {
                d.items.remove(i);
            }
            _ => {}
        }
    }
    (p, d)
}

/// Il testo `b` ricolorato come `a` e il colore, se `a` è `b` coi pezzi
/// (`TextRun`) di un riempimento nuovo: il comando del riempimento del
/// motore colora i pezzi, il client scrive il `fill` del `<text>`. Si
/// scrive così solo se prima e dopo tutti i pezzi hanno lo stesso colore;
/// pezzi di colori diversi (un `tspan` col suo `fill`) non si dicono con un
/// attributo solo.
pub(super) fn riempimento_dei_pezzi(
    b: &Node,
    a: &Node,
) -> Result<Option<(Node, Paint, Paint)>, Rifiuto> {
    let (NodeKind::Text(tb), NodeKind::Text(ta)) = (&b.kind, &a.kind) else {
        return Ok(None);
    };
    if tb.runs.len() != ta.runs.len()
        || tb
            .runs
            .iter()
            .zip(&ta.runs)
            .all(|(x, y)| x.style.fill == y.style.fill)
    {
        return Ok(None);
    }
    let unico = |pezzi: &[vectorcraft_doc::TextRun]| {
        let primo = &pezzi.first()?.style.fill;
        pezzi
            .iter()
            .all(|r| r.style.fill == *primo)
            .then(|| primo.clone())
    };
    let (Some(prima), Some(colore)) = (unico(&tb.runs), unico(&ta.runs)) else {
        return Err(no("i pezzi del testo hanno colori diversi"));
    };
    let mut ricolorato = b.clone();
    if let NodeKind::Text(t) = &mut ricolorato.kind {
        for r in &mut t.runs {
            r.style.fill = colore.clone();
        }
    }
    Ok(Some((ricolorato, prima, colore)))
}

/// L'aspetto senza il colore del riempimento, quello del tratto, lo
/// spessore, gli estremi, gli angoli, il loro limite e il tratteggio
/// semplice: ciò che `fill`, `stroke`, `stroke-width`, `stroke-linecap`,
/// `stroke-linejoin`, `stroke-miterlimit`, `stroke-dasharray` e
/// `stroke-dashoffset` dicono. Un tratteggio adattato agli angoli resta: la
/// scena non ha un attributo per dirlo.
pub(super) fn senza_colori(a: &Appearance) -> Appearance {
    let mut a = a.clone();
    if let Some(f) = a.fill_mut() {
        f.paint = Paint::None;
    }
    if let Some(s) = a.stroke_mut() {
        s.paint = Paint::None;
        s.width = 0.0;
        s.cap = LineCap::default();
        s.join = LineJoin::default();
        s.miter_limit = LIMITE_DELL_ANGOLO_SVG;
        if s.dash.as_ref().is_none_or(tratteggio_semplice) {
            s.dash = None;
        }
    }
    a
}

/// I costrutti di `n` e del suo albero che gli attributi di una foglia non
/// dicono: tutti tranne il tratteggio semplice (`stroke-dasharray` e
/// `stroke-dashoffset`) e la
/// sfumatura lineare o radiale che la scena scrive come risorsa privata
/// ([`crate::sfumature`]). Un tratteggio adattato agli angoli, e
/// una sfumatura libera o che segue il tratto, restano costrutti della
/// ricetta.
pub(super) fn costrutti_non_detti(n: &Node) -> Vec<ricetta::Costrutto> {
    fn tratteggio_ricco(n: &Node) -> bool {
        n.appearance.items.iter().any(|item| match item {
            vectorcraft_doc::AppearanceItem::Stroke(s) => {
                s.dash.as_ref().is_some_and(|d| !tratteggio_semplice(d))
            }
            _ => false,
        }) || n
            .children()
            .into_iter()
            .flatten()
            .any(|c| tratteggio_ricco(c))
    }
    fn sfumatura_ricca(n: &Node) -> bool {
        let ricca = |p: &Paint| matches!(p, Paint::Gradient(g) if !sfumature::scrivibile(g));
        n.appearance.items.iter().any(|item| match item {
            vectorcraft_doc::AppearanceItem::Fill(f) => ricca(&f.paint),
            vectorcraft_doc::AppearanceItem::Stroke(s) => {
                ricca(&s.paint) || !sfumature::del_tratto_scrivibile(s)
            }
        }) || n
            .children()
            .into_iter()
            .flatten()
            .any(|c| sfumatura_ricca(c))
    }
    let mut c = ricetta::costrutti_albero(n);
    if !tratteggio_ricco(n) {
        c.retain(|c| *c != ricetta::Costrutto::Tratteggio);
    }
    if !sfumatura_ricca(n) {
        c.retain(|c| *c != ricetta::Costrutto::Sfumatura);
    }
    c
}

/// Un tratteggio che `stroke-dasharray` e `stroke-dashoffset` dicono: con
/// le lunghezze esatte, non adattate agli angoli.
pub(super) fn tratteggio_semplice(d: &vectorcraft_doc::Dash) -> bool {
    !d.align_corners
}

/// Il limite dell'angolo di SVG senza `stroke-miterlimit`.
pub(super) const LIMITE_DELL_ANGOLO_SVG: f64 = 4.0;

/// Il `stroke-miterlimit` del tratto `s`, come lo scrive l'esportazione di
/// VectorCraft: solo con gli angoli vivi e un limite diverso da quello di SVG.
pub(super) fn limite_dell_angolo(s: Option<&vectorcraft_doc::StrokeLayer>) -> Option<f64> {
    s.filter(|s| s.join == LineJoin::Miter && !vicini(s.miter_limit, LIMITE_DELL_ANGOLO_SVG))
        .map(|s| s.miter_limit)
}

/// Gli estremi, gli angoli, il limite dell'angolo e il tratteggio del tratto
/// in cima, prima e dopo, come attributi della scena: solo quelli cambiati, e
/// `null` per tornare al valore di SVG (`butt`, `miter`, 4, nessun
/// tratteggio, nessuno spostamento). Le lunghezze del tratteggio e il suo
/// spostamento stanno nel documento del motore e tornano nello spazio
/// dell'elemento con la sua `scala`, come lo spessore; il limite dell'angolo
/// è un rapporto, e non cambia.
pub(super) fn scrivi_stile_del_tratto(
    prima: Option<&vectorcraft_doc::StrokeLayer>,
    dopo: Option<&vectorcraft_doc::StrokeLayer>,
    scala: f64,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let cap = |s: Option<&vectorcraft_doc::StrokeLayer>| s.map_or(LineCap::default(), |s| s.cap);
    let join = |s: Option<&vectorcraft_doc::StrokeLayer>| s.map_or(LineJoin::default(), |s| s.join);
    if cap(prima) != cap(dopo) {
        let valore = match cap(dopo) {
            LineCap::Butt => Value::Null,
            LineCap::Round => json!("round"),
            LineCap::Square => json!("square"),
        };
        attrs.insert("stroke-linecap".into(), valore);
    }
    if join(prima) != join(dopo) {
        let valore = match join(dopo) {
            LineJoin::Miter => Value::Null,
            LineJoin::Round => json!("round"),
            LineJoin::Bevel => json!("bevel"),
        };
        attrs.insert("stroke-linejoin".into(), valore);
    }
    // Un tratteggio che non disegna trattini (vuoto, tutto a zero) è un
    // tratto pieno, come per SVG.
    let trattini = |s: Option<&vectorcraft_doc::StrokeLayer>| -> Option<Vec<f64>> {
        s.and_then(|s| s.dash.as_ref())
            .filter(|d| d.is_dashed())
            .map(|d| d.pattern.clone())
    };
    let (tb, ta) = (trattini(prima), trattini(dopo));
    let uguali = match (&tb, &ta) {
        (None, None) => true,
        (Some(b), Some(a)) => b.len() == a.len() && b.iter().zip(a).all(|(x, y)| vicini(*x, *y)),
        _ => false,
    };
    if !uguali {
        let valore = match ta {
            None => Value::Null,
            Some(lunghezze) => {
                if scala <= 0.0 || !scala.is_finite() {
                    return Err(no("il tratteggio non si scrive in uno spazio schiacciato"));
                }
                let parole: Vec<String> = lunghezze
                    .iter()
                    .map(|l| numero(l / scala, DECIMALI_GEOMETRIA))
                    .collect();
                json!(parole.join(" "))
            }
        };
        attrs.insert("stroke-dasharray".into(), valore);
    }
    let (lb, la) = (limite_dell_angolo(prima), limite_dell_angolo(dopo));
    let uguali = match (lb, la) {
        (None, None) => true,
        (Some(b), Some(a)) => vicini(b, a),
        _ => false,
    };
    if !uguali {
        attrs.insert(
            "stroke-miterlimit".into(),
            la.map_or(Value::Null, |l| json!(numero(l, DECIMALI_GEOMETRIA))),
        );
    }
    let spostamento = |s: Option<&vectorcraft_doc::StrokeLayer>| {
        s.and_then(|s| s.dash.as_ref())
            .filter(|d| d.is_dashed() && d.offset != 0.0)
            .map(|d| d.offset)
    };
    let (ob, oa) = (spostamento(prima), spostamento(dopo));
    let uguali = match (ob, oa) {
        (None, None) => true,
        (Some(b), Some(a)) => vicini(b, a),
        _ => false,
    };
    if !uguali {
        let valore = match oa {
            None => Value::Null,
            Some(o) => {
                if scala <= 0.0 || !scala.is_finite() {
                    return Err(no("il tratteggio non si scrive in uno spazio schiacciato"));
                }
                json!(numero(o / scala, DECIMALI_GEOMETRIA))
            }
        };
        attrs.insert("stroke-dashoffset".into(), valore);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// La scrittura
// ---------------------------------------------------------------------------

/// Un numero con al più `decimali` decimali, come `formatNumber` del client
/// (`apps/client/src/ink/number.ts`): `floor(v × 10ⁿ + 0,5)`, niente zeri in
/// fondo, niente esponente, mai `-0`.
pub fn numero(v: f64, decimali: usize) -> String {
    const POTENZE: [f64; 5] = [1.0, 10.0, 100.0, 1_000.0, 10_000.0];
    let fattore = POTENZE[decimali.min(4)];
    let unita = fub_scene::ink::round_half_up(v, fattore);
    if unita == 0.0 || !unita.is_finite() {
        return "0".into();
    }
    let negativo = unita < 0.0;
    let mut cifre = format!("{:.0}", unita.abs());
    if decimali > 0 {
        while cifre.len() < decimali + 1 {
            cifre.insert(0, '0');
        }
        let taglio = cifre.len() - decimali;
        let fine = cifre.trim_end_matches('0').len().max(taglio);
        cifre = if fine > taglio {
            format!("{}.{}", &cifre[..taglio], &cifre[taglio..fine])
        } else {
            cifre[..taglio].to_string()
        };
    }
    if negativo {
        format!("-{cifre}")
    } else {
        cifre
    }
}

/// `matrix(a b c d e f)` con quattro decimali, come `formatTransform`.
pub fn scrivi_matrice(m: Affine) -> String {
    let c: Vec<String> = m
        .as_coeffs()
        .iter()
        .map(|v| numero(*v, DECIMALI_MATRICE))
        .collect();
    format!("matrix({})", c.join(" "))
}

pub(super) fn g2(v: f64) -> String {
    numero(v, DECIMALI_GEOMETRIA)
}

/// Il `d` di un tracciato del motore: `M`, `L`, `C`, `Z`, due decimali.
pub(crate) fn scrivi_d(p: &vectorcraft_geom::PathData) -> String {
    let mut parti: Vec<String> = Vec::new();
    for s in &p.subpaths {
        let Some(primo) = s.anchors.first() else {
            continue;
        };
        parti.push(format!("M{} {}", g2(primo.p.x), g2(primo.p.y)));
        let n = s.anchors.len();
        let segmenti = if s.closed { n } else { n.saturating_sub(1) };
        for i in 0..segmenti {
            let (a, b) = (&s.anchors[i], &s.anchors[(i + 1) % n]);
            let dritto = punti_uguali(a.h_out, a.p) && punti_uguali(b.h_in, b.p);
            if dritto {
                if s.closed && i + 1 == n {
                    break;
                }
                parti.push(format!("L{} {}", g2(b.p.x), g2(b.p.y)));
            } else {
                parti.push(format!(
                    "C{} {} {} {} {} {}",
                    g2(a.h_out.x),
                    g2(a.h_out.y),
                    g2(b.h_in.x),
                    g2(b.h_in.y),
                    g2(b.p.x),
                    g2(b.p.y)
                ));
            }
        }
        if s.closed {
            parti.push("Z".into());
        }
    }
    parti.join(" ")
}

/// `p` portato da `m`.
pub(super) fn trasformato(p: &vectorcraft_geom::PathData, m: Affine) -> vectorcraft_geom::PathData {
    let mut c = p.clone();
    c.transform(m);
    c
}

pub(super) fn punti_uguali(a: Point, b: Point) -> bool {
    (a.x - b.x).abs() <= 1e-9 && (a.y - b.y).abs() <= 1e-9
}

/// Vero se un discendente di `n` c'era già prima del gesto: allora `n` non
/// si scrive come grafica nuova, i suoi pezzi sono elementi del file.
pub(super) fn ha_pezzi_di_prima(n: &Node, prima: &Posti<'_>) -> bool {
    n.children().is_some_and(|figli| {
        figli
            .iter()
            .any(|c| prima.nodi.contains_key(&c.id) || ha_pezzi_di_prima(c, prima))
    })
}

/// Vero se `genitore` è un gruppo del Sagomatore, o sta dentro uno (le
/// sorgenti stanno nel gruppo «Shaper Sources» del gruppo), salendo solo per i
/// gruppi che `vale` accetta: il file tiene il gruppo come un solo elemento con
/// la ricetta, e le sorgenti non sono elementi suoi.
pub(super) fn in_un_sagomatore(
    mut genitore: Option<NodeId>,
    posti: &Posti<'_>,
    vale: impl Fn(NodeId) -> bool,
) -> bool {
    while let Some(g) = genitore.filter(|g| vale(*g)) {
        let Some(p) = posti.nodi.get(&g) else {
            return false;
        };
        if p.nodo.extras().shaper.is_some() || vectorcraft_tools::builder::is_live_paint(p.nodo) {
            return true;
        }
        genitore = p.genitore;
    }
    false
}

/// Vero se `genitore` è il gruppo delle sorgenti di un gruppo della Pittura
/// dinamica: un elemento che ci finisce (Unisci) non è più un elemento del
/// file, ma una sorgente nella ricetta del gruppo.
pub(super) fn fra_le_sorgenti_vive(genitore: Option<NodeId>, posti: &Posti<'_>) -> bool {
    use vectorcraft_tools::builder::{is_live_paint, SOURCES_NAME};
    genitore
        .and_then(|g| posti.nodi.get(&g))
        .filter(|p| p.nodo.name.as_deref() == Some(SOURCES_NAME))
        .and_then(|p| p.genitore)
        .and_then(|g| posti.nodi.get(&g))
        .is_some_and(|p| is_live_paint(p.nodo))
}

/// Come [`ha_pezzi_di_prima`], senza i pezzi assorbiti in un composto nuovo
/// (e ciò che hanno dentro): quelli si tolgono dal file, e il composto li
/// porta nella sua ricetta.
pub(super) fn ha_pezzi_rimasti(n: &Node, prima: &Posti<'_>, assorbiti: &HashSet<NodeId>) -> bool {
    n.children().is_some_and(|figli| {
        figli
            .iter()
            .filter(|c| !assorbiti.contains(&c.id))
            .any(|c| prima.nodi.contains_key(&c.id) || ha_pezzi_rimasti(c, prima, assorbiti))
    })
}

/// Il valore di `fill` o `stroke`: un colore, `none`, o un campione del file
/// col suo ripiego ([`Riferimenti::scrivi`]).
pub(super) fn scrivi_colore(r: &Riferimenti, p: Option<&Paint>) -> Result<String, Rifiuto> {
    r.scrivi(p)
        .ok_or_else(|| no("un colore che non è pieno (sfumatura, motivo)"))
}

/// L'`Elem` comune di un oggetto nuovo, nello spazio del genitore (`locale`
/// porta dal documento del motore lì): `rect`, `ellipse` e `line` quando la
/// forma lo è ancora dopo il passaggio, altrimenti `path`.
pub(super) fn elem(
    n: &Node,
    locale: Affine,
    r: &Riferimenti,
    evenodd_genitore: bool,
) -> Result<(String, Map<String, Value>), Rifiuto> {
    // Un tracciato composto fatto di tracciati: un solo `<path>` con tutti i
    // sottotracciati, come lo legge la scena.
    if let Some((path, regola)) = tracciato_composto(n) {
        let mut attrs = Map::new();
        attrs.insert("d".into(), json!(scrivi_d(&trasformato(&path, locale))));
        scrivi_aspetto(n, locale, "path", r, &mut attrs)?;
        let valore = scrivi_regola(regola, evenodd_genitore);
        if !valore.is_null() {
            attrs.insert("fill-rule".into(), valore);
        }
        return Ok(("path".to_string(), attrs));
    }
    let NodeKind::Path { path, live, .. } = &n.kind else {
        return Err(no("un oggetto nuovo che non è un tracciato"));
    };
    let p = trasformato(path, locale);
    let mut attrs = Map::new();
    let tag = match (live.as_deref(), &p.subpaths[..]) {
        (Some(LiveShape::Rectangle { radii, .. }), [s])
            if radii.iter().all(|r| *r == 0.0) && s.closed =>
        {
            match rettangolo(&p) {
                Some([x, y, w, h]) => {
                    attrs.insert("x".into(), json!(g2(x)));
                    attrs.insert("y".into(), json!(g2(y)));
                    attrs.insert("width".into(), json!(g2(w)));
                    attrs.insert("height".into(), json!(g2(h)));
                    "rect"
                }
                None => "path",
            }
        }
        (Some(LiveShape::Ellipse { pie, .. }), [s])
            if s.closed && (((pie.1 - pie.0).abs() - 360.0).abs() < 1e-9 || pie.0 == pie.1) =>
        {
            match ellisse(&p) {
                Some([cx, cy, rx, ry]) => {
                    attrs.insert("cx".into(), json!(g2(cx)));
                    attrs.insert("cy".into(), json!(g2(cy)));
                    attrs.insert("rx".into(), json!(g2(rx)));
                    attrs.insert("ry".into(), json!(g2(ry)));
                    "ellipse"
                }
                None => "path",
            }
        }
        (_, [s])
            if !s.closed
                && s.anchors.len() == 2
                && s.anchors
                    .iter()
                    .all(|a| punti_uguali(a.h_in, a.p) && punti_uguali(a.h_out, a.p)) =>
        {
            let (a, b) = (s.anchors[0].p, s.anchors[1].p);
            attrs.insert("x1".into(), json!(g2(a.x)));
            attrs.insert("y1".into(), json!(g2(a.y)));
            attrs.insert("x2".into(), json!(g2(b.x)));
            attrs.insert("y2".into(), json!(g2(b.y)));
            "line"
        }
        _ => "path",
    };
    if tag == "path" {
        attrs.insert("d".into(), json!(scrivi_d(&p)));
    }
    scrivi_aspetto(n, locale, tag, r, &mut attrs)?;
    if let NodeKind::Path { rule, .. } = &n.kind {
        let valore = scrivi_regola(*rule, evenodd_genitore);
        if !valore.is_null() {
            attrs.insert("fill-rule".into(), valore);
        }
    }
    Ok((tag.to_string(), attrs))
}

/// La regola di riempimento di un tracciato o di un tracciato composto del
/// motore; `None` per gli altri oggetti.
pub(super) fn regola(n: &Node) -> Option<FillRule> {
    match &n.kind {
        NodeKind::Path { rule, .. } | NodeKind::Compound { rule, .. } => Some(*rule),
        _ => None,
    }
}

/// `n` con la regola di riempimento `r`.
pub(super) fn con_la_regola(n: &Node, r: FillRule) -> Node {
    let mut c = n.clone();
    if let NodeKind::Path { rule, .. } | NodeKind::Compound { rule, .. } = &mut c.kind {
        *rule = r;
    }
    c
}

/// Il valore di `fill-rule` per la regola `r` in un genitore che dà ai figli
/// `evenodd` o no: `null` se è già quella ereditata, come la esporta
/// VectorCraft (solo `evenodd`, ma qui anche `nonzero` dentro un `evenodd`).
pub(super) fn scrivi_regola(r: FillRule, evenodd_genitore: bool) -> Value {
    match (r, evenodd_genitore) {
        (FillRule::EvenOdd, false) => json!("evenodd"),
        (FillRule::NonZero, true) => json!("nonzero"),
        _ => Value::Null,
    }
}

/// Il riempimento e il tratto di un oggetto nuovo, come li scrive il client.
pub(super) fn scrivi_aspetto(
    n: &Node,
    locale: Affine,
    tag: &str,
    r: &Riferimenti,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let fill = n.appearance.fill().map(|f| &f.paint);
    if tag != "line" || !matches!(fill, None | Some(Paint::None)) {
        attrs.insert("fill".into(), json!(scrivi_colore(r, fill)?));
    }
    if let Some(s) = n
        .appearance
        .stroke()
        .filter(|s| !matches!(s.paint, Paint::None))
    {
        attrs.insert("stroke".into(), json!(scrivi_colore(r, Some(&s.paint))?));
        let scala = locale.determinant().abs().sqrt();
        attrs.insert("stroke-width".into(), json!(g2(s.width * scala)));
        match s.cap {
            LineCap::Butt => {}
            LineCap::Round => {
                attrs.insert("stroke-linecap".into(), json!("round"));
            }
            LineCap::Square => {
                attrs.insert("stroke-linecap".into(), json!("square"));
            }
        }
        match s.join {
            LineJoin::Miter => {}
            LineJoin::Round => {
                attrs.insert("stroke-linejoin".into(), json!("round"));
            }
            LineJoin::Bevel => {
                attrs.insert("stroke-linejoin".into(), json!("bevel"));
            }
        }
        if let Some(l) = limite_dell_angolo(Some(s)) {
            attrs.insert(
                "stroke-miterlimit".into(),
                json!(numero(l, DECIMALI_GEOMETRIA)),
            );
        }
    }
    Ok(())
}

/// I sottotracciati di un tracciato composto fatto solo di tracciati semplici
/// (non forme vive, non tracciati di ritaglio o guide), nell'ordine dei
/// figli, e la sua regola di riempimento: ciò che un `<path>` dice con `d` e
/// `fill-rule`. `None` per ogni altro oggetto.
pub(super) fn tracciato_composto(n: &Node) -> Option<(PathData, FillRule)> {
    let NodeKind::Compound { children, rule } = &n.kind else {
        return None;
    };
    let mut tutto = PathData::default();
    for c in children {
        let NodeKind::Path {
            path,
            live: None,
            clipping: false,
            guide: false,
            ..
        } = &c.kind
        else {
            return None;
        };
        tutto.subpaths.extend(path.subpaths.iter().cloned());
    }
    Some((tutto, *rule))
}

/// `[x, y, larghezza, altezza]` di un tracciato che è un rettangolo dritto.
pub(super) fn rettangolo(p: &vectorcraft_geom::PathData) -> Option<[f64; 4]> {
    let s = p.subpaths.first()?;
    if s.anchors.len() != 4
        || s.anchors
            .iter()
            .any(|a| !punti_uguali(a.h_in, a.p) || !punti_uguali(a.h_out, a.p))
    {
        return None;
    }
    let xs: Vec<f64> = s.anchors.iter().map(|a| a.p.x).collect();
    let ys: Vec<f64> = s.anchors.iter().map(|a| a.p.y).collect();
    let (x0, x1) = (
        xs.iter().copied().fold(f64::INFINITY, f64::min),
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (y0, y1) = (
        ys.iter().copied().fold(f64::INFINITY, f64::min),
        ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let agli_angoli = s.anchors.iter().all(|a| {
        (vicini(a.p.x, x0) || vicini(a.p.x, x1)) && (vicini(a.p.y, y0) || vicini(a.p.y, y1))
    });
    agli_angoli.then_some([x0, y0, x1 - x0, y1 - y0])
}

/// `[cx, cy, rx, ry]` di un tracciato che è un'ellisse dritta (quattro
/// ancore sui suoi estremi).
pub(super) fn ellisse(p: &vectorcraft_geom::PathData) -> Option<[f64; 4]> {
    let s = p.subpaths.first()?;
    if s.anchors.len() != 4 {
        return None;
    }
    let xs: Vec<f64> = s.anchors.iter().map(|a| a.p.x).collect();
    let ys: Vec<f64> = s.anchors.iter().map(|a| a.p.y).collect();
    let (x0, x1) = (
        xs.iter().copied().fold(f64::INFINITY, f64::min),
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (y0, y1) = (
        ys.iter().copied().fold(f64::INFINITY, f64::min),
        ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let sugli_estremi = s.anchors.iter().all(|a| {
        ((vicini(a.p.x, x0) || vicini(a.p.x, x1)) && vicini(a.p.y, cy))
            || ((vicini(a.p.y, y0) || vicini(a.p.y, y1)) && vicini(a.p.x, cx))
    });
    sugli_estremi.then_some([cx, cy, (x1 - x0) / 2.0, (y1 - y0) / 2.0])
}

/// Gli attributi della geometria di una forma semplice che, deformata,
/// diventa un tracciato: rettangolo, cerchio, ellisse, poligono e
/// polilinea, come le scrive Fub (il ruolo è il tag: niente stelle o poligoni
/// di Fub). `None` per tutto il resto, anche per `line`, che non si riempie.
pub(super) fn geometria_della_forma(e: &Elemento) -> Option<&'static [&'static str]> {
    use fub_scene::Role;
    Some(match (e.tag, e.ruolo) {
        ("rect", Role::Rect) => &["x", "y", "width", "height", "rx", "ry"],
        ("circle", Role::Circle) => &["cx", "cy", "r"],
        ("ellipse", Role::Ellipse) => &["cx", "cy", "rx", "ry"],
        ("polygon", Role::Polygon) | ("polyline", Role::Polyline) => &["points"],
        _ => return None,
    })
}
