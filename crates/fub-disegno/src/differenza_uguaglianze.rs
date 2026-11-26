//! Le uguaglianze della differenza: gruppi, trasformazioni, vicinanza di numeri, geometrie e aspetti.

use super::*;

/// Vero se `n` è un gruppo nuovo semplice (nessuna proprietà sua: niente
/// opacità, maschera, nome, aspetto) fatto solo di oggetti che c'erano già e
/// non si riscrivono: Raggruppa.
pub(super) fn gruppo_di_prima(n: &Node, prima: &Posti<'_>, riscritti: &HashSet<NodeId>) -> bool {
    let NodeKind::Group {
        children,
        clip: false,
    } = &n.kind
    else {
        return false;
    };
    !children.is_empty()
        && children
            .iter()
            .all(|c| prima.nodi.contains_key(&c.id) && !riscritti.contains(&c.id))
        && proprieta_uguali(
            n,
            &Node::new(
                n.id,
                NodeKind::Group {
                    children: Vec::new(),
                    clip: false,
                },
            ),
        )
}

/// Vero per un gruppo semplice (senza ritaglio, senza proprietà sue) che
/// tiene solo oggetti nuovi, nessuno dei quali c'era prima: si scrive come
/// un `g` vuoto e i suoi pezzi dentro.
///
/// Il nome che il motore copia da un oggetto della copia (Crea profili dà al
/// gruppo dei contorni il nome del testo, che è il suo id nel file) non è una
/// proprietà del gruppo: il gruppo prende un id nuovo. Un altro nome (il
/// «Symbol Set» dello Spruzzatore di simboli) è il `title` del gruppo.
///
/// `Some` col nome da scrivere, se ce n'è uno.
pub(super) fn gruppo_tutto_nuovo<'n>(
    n: &'n Node,
    prima: &Posti<'_>,
    mappa: &Mappa,
) -> Option<Option<&'n str>> {
    let nome = n
        .name
        .as_deref()
        .filter(|nome| mappa.dell_id(nome).is_none() && !nome.trim().is_empty());
    let mut senza_nome = n.clone();
    senza_nome.name = None;
    let n = &senza_nome;
    let NodeKind::Group {
        children,
        clip: false,
    } = &n.kind
    else {
        return None;
    };
    let si = !children.is_empty()
        && children
            .iter()
            .all(|c| !prima.nodi.contains_key(&c.id) && !ha_pezzi_di_prima(c, prima))
        && proprieta_uguali(
            n,
            &Node::new(
                n.id,
                NodeKind::Group {
                    children: Vec::new(),
                    clip: false,
                },
            ),
        );
    si.then_some(nome)
}

/// `transform = G⁻¹·M·G·T`.
pub(super) fn nuova_trasformazione(e: &Elemento, m: Affine) -> Result<Affine, Rifiuto> {
    let g = e
        .ctm_genitore
        .ok_or_else(|| no("una transform di un antenato non si legge"))?;
    let t = e
        .propria
        .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
    let gi = g.inverse();
    let nuova = gi * m * g * t;
    if !nuova.is_finite() {
        return Err(no("la transform nuova non è finita"));
    }
    Ok(nuova)
}

/// Gli indici di una sottosequenza crescente più lunga fra le chiavi presenti.
pub(crate) fn sottosequenza_crescente(chiavi: &[Option<usize>]) -> HashSet<usize> {
    let presenti: Vec<(usize, usize)> = chiavi
        .iter()
        .enumerate()
        .filter_map(|(i, k)| k.map(|k| (i, k)))
        .collect();
    // Patience sorting con i predecessori.
    let mut code: Vec<usize> = Vec::new();
    let mut prec: Vec<Option<usize>> = vec![None; presenti.len()];
    for (j, &(_, k)) in presenti.iter().enumerate() {
        let at = code.partition_point(|&q| presenti[q].1 < k);
        if at > 0 {
            prec[j] = Some(code[at - 1]);
        }
        if at == code.len() {
            code.push(j);
        } else {
            code[at] = j;
        }
    }
    let mut fuori = HashSet::new();
    let mut cur = code.last().copied();
    while let Some(j) = cur {
        fuori.insert(presenti[j].0);
        cur = prec[j];
    }
    fuori
}

// ---------------------------------------------------------------------------
// La matrice di un cambio
// ---------------------------------------------------------------------------

/// I punti che dicono dove sta un oggetto, in ordine.
pub(super) fn punti(n: &Node, out: &mut Vec<Point>) {
    let tre = |xf: &Affine, out: &mut Vec<Point>| {
        out.push(*xf * Point::new(0.0, 0.0));
        out.push(*xf * Point::new(1.0, 0.0));
        out.push(*xf * Point::new(0.0, 1.0));
    };
    match &n.kind {
        NodeKind::Path { path, live, .. } => {
            for s in &path.subpaths {
                for a in &s.anchors {
                    out.extend([a.p, a.h_in, a.h_out]);
                }
            }
            match live.as_deref() {
                Some(
                    LiveShape::Rectangle { xf, .. }
                    | LiveShape::Ellipse { xf, .. }
                    | LiveShape::Polygon { xf, .. },
                ) => tre(xf, out),
                Some(LiveShape::Line { a, b }) => out.extend([*a, *b]),
                _ => {}
            }
        }
        NodeKind::Text(t) => tre(&t.xf, out),
        NodeKind::Image(i) => tre(&i.xf, out),
        NodeKind::SymbolInstance { xf, .. } => tre(xf, out),
        _ => {}
    }
    if let Some(figli) = n.children() {
        for c in figli {
            punti(c, out);
        }
    }
}

/// La matrice che porta i punti di `b` su quelli di `a`, ai minimi quadrati;
/// `None` se i punti non sono gli stessi o non bastano a fissarla.
pub(super) fn adatta(b: &Node, a: &Node) -> Option<Affine> {
    let (mut p, mut q) = (Vec::new(), Vec::new());
    punti(b, &mut p);
    punti(a, &mut q);
    if p.len() != q.len() || p.is_empty() {
        return None;
    }
    let d0 = q[0] - p[0];
    if p.iter()
        .zip(&q)
        .all(|(p, q)| vicini(q.x - p.x, d0.x) && vicini(q.y - p.y, d0.y))
    {
        return Some(Affine::translate(d0));
    }
    // Le equazioni normali, centrate per la stabilità.
    let n = p.len() as f64;
    let (cx, cy) = (
        p.iter().map(|p| p.x).sum::<f64>() / n,
        p.iter().map(|p| p.y).sum::<f64>() / n,
    );
    let (dx, dy) = (
        q.iter().map(|q| q.x).sum::<f64>() / n,
        q.iter().map(|q| q.y).sum::<f64>() / n,
    );
    let (mut sxx, mut sxy, mut syy) = (0.0, 0.0, 0.0);
    let (mut ux, mut uy, mut vx, mut vy) = (0.0, 0.0, 0.0, 0.0);
    for (p, q) in p.iter().zip(&q) {
        let (x, y) = (p.x - cx, p.y - cy);
        let (u, v) = (q.x - dx, q.y - dy);
        sxx += x * x;
        sxy += x * y;
        syy += y * y;
        ux += u * x;
        uy += u * y;
        vx += v * x;
        vy += v * y;
    }
    let det = sxx * syy - sxy * sxy;
    if det.abs() <= 1e-12 * (sxx * syy).max(1e-300) || !det.is_finite() {
        return None;
    }
    let a_ = (ux * syy - uy * sxy) / det;
    let c_ = (uy * sxx - ux * sxy) / det;
    let b_ = (vx * syy - vy * sxy) / det;
    let d_ = (vy * sxx - vx * sxy) / det;
    let e_ = dx - a_ * cx - c_ * cy;
    let f_ = dy - b_ * cx - d_ * cy;
    let m = Affine::new([a_, b_, c_, d_, e_, f_]);
    m.is_finite().then_some(m)
}

/// `n` mosso da `m` come lo muovono gli strumenti; `None` se il motore va in
/// panico.
pub(super) fn mosso_da(n: &Node, m: Affine, tratti: bool) -> Option<Node> {
    vectorcraft_engine::guard::catch_panic(|| {
        let mut c = n.clone();
        if !vicina_all_identita(m) {
            c.transform(m, Scaling::from(tratti));
        }
        c
    })
    .ok()
}

/// `m` sposta soltanto: la parte lineare è l'identità.
pub(super) fn traslazione(m: Affine) -> bool {
    let [a, b, c, d, _, _] = m.as_coeffs();
    vicini(a, 1.0) && vicini(b, 0.0) && vicini(c, 0.0) && vicini(d, 1.0)
}

pub(super) fn vicina_all_identita(m: Affine) -> bool {
    matrici_vicine(m, Affine::IDENTITY)
}

pub(super) fn matrici_vicine(a: Affine, b: Affine) -> bool {
    a.as_coeffs()
        .iter()
        .zip(b.as_coeffs())
        .all(|(x, y)| vicini(*x, y))
}

pub(super) fn vicini(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOLLERANZA * 1f64.max(a.abs()).max(b.abs())
}

pub(super) fn json_vicini(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => vicini(x, y),
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| json_vicini(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            // Un campo che vale il suo predefinito non si scrive: uno zero
            // vicino a zero da una parte sola conta come assente.
            let chiavi: HashSet<&String> = x.keys().chain(y.keys()).collect();
            chiavi.into_iter().all(|k| match (x.get(k), y.get(k)) {
                (Some(x), Some(y)) => json_vicini(x, y),
                (Some(v), None) | (None, Some(v)) => v.as_f64().is_some_and(|v| vicini(v, 0.0)),
                (None, None) => true,
            })
        }
        _ => a == b,
    }
}

pub(super) fn in_json(n: &Node) -> Value {
    serde_json::to_value(n).unwrap_or(Value::Null)
}

pub(super) fn aspetto_in_json(a: &Appearance) -> Value {
    serde_json::to_value(a).unwrap_or(Value::Null)
}

/// Due oggetti uguali a meno dell'arrotondamento.
pub(super) fn nodi_vicini(a: &Node, b: &Node) -> bool {
    json_vicini(&in_json(a), &in_json(b))
}

/// Due oggetti con la stessa geometria e le stesse proprietà, l'aspetto a
/// parte.
/// Un tracciato-guida del motore (Crea guide).
pub(super) fn e_guida(n: &Node) -> bool {
    matches!(n.kind, NodeKind::Path { guide: true, .. })
}

pub(super) fn geometrie_vicine(a: &Node, b: &Node) -> bool {
    let senza = |n: &Node| {
        let mut v = in_json(n);
        if let Some(o) = v.as_object_mut() {
            o.remove("appearance");
        }
        v
    };
    json_vicini(&senza(a), &senza(b))
}

/// Due oggetti uguali, con i sottoalberi condivisi presi per uguali senza
/// guardarli: dopo un gesto il documento del motore condivide con la copia
/// tutti i rami che il gesto non ha toccato, e confrontarli uno per uno
/// costerebbe quanto il disegno.
pub(super) fn uguali(b: &Arc<Node>, a: &Arc<Node>) -> bool {
    if Arc::ptr_eq(b, a) {
        return true;
    }
    match (b.children(), a.children()) {
        (Some(fb), Some(fa)) => {
            fb.len() == fa.len()
                && senza_figli(b) == senza_figli(a)
                && fb.iter().zip(fa).all(|(x, y)| uguali(x, y))
        }
        _ => **b == **a,
    }
}

/// Il nodo con la lista dei figli vuota: le sue proprietà, senza copiare né
/// scrivere il sottoalbero.
pub(super) fn senza_figli(n: &Node) -> Node {
    let mut solo = n.clone();
    if let Some(figli) = solo.children_mut() {
        figli.clear();
    }
    solo
}

/// Le proprietà di un contenitore, i figli a parte. Il JSON si scrive dal
/// nodo senza figli ([`senza_figli`]): su un livello, scriverli vorrebbe
/// dire scrivere tutto il disegno per poi buttarlo.
pub(super) fn proprieta_uguali(a: &Node, b: &Node) -> bool {
    let senza = |n: &Node| {
        let mut v = match n.children() {
            Some(_) => in_json(&senza_figli(n)),
            None => in_json(n),
        };
        if let Some(o) = v.as_object_mut() {
            if let Some(k) = o.get_mut("kind").and_then(Value::as_object_mut) {
                k.remove("children");
                k.remove("content");
                k.remove("source");
            }
            o.remove("bbox_angle");
        }
        v
    };
    json_vicini(&senza(a), &senza(b))
}

pub(super) fn aspetti_vicini(a: &Appearance, b: &Appearance) -> bool {
    json_vicini(&aspetto_in_json(a), &aspetto_in_json(b))
}
