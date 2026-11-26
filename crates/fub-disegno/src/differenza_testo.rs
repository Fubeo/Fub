//! Le parole, il carattere e l'allineamento di un testo di punto (K6 T16).
//!
//! Lo strumento Testo del motore e le sezioni Carattere e Paragrafo del
//! Completo cambiano un `TextObject`: qui il cambio diventa gli attributi
//! del `<text>` (`font-family`, `font-size`, `font-weight`, `font-style`,
//! `letter-spacing`, `text-decoration`, `text-anchor`) e l'operazione `text` per le righe, come
//! li scrive il pannello del Semplice (`tools/look/write.ts`). Ciò che la
//! scena non dice con un attributo del `<text>` si rifiuta con il perché:
//! l'interlinea di una riga è il `dy` del suo `<tspan>`, la crenatura e i
//! rientri la scena non li ha, e il giustificato vale per un testo in area.

use serde_json::{json, Map, Value};
use vectorcraft_doc::text::{CharStyle, Justify, ParaStyle, TextKind, TextObject, TextRun};
use vectorcraft_doc::{Node, NodeKind};

use super::righe::{dividi, righe_scritte, GIUSTIFICATO_IN_AREA};
use super::{matrici_vicine, no, numero, proprieta_uguali, vicini, Rifiuto, DECIMALI_GEOMETRIA};
use crate::mappa::Elemento;

/// Il perché di un'interlinea cambiata.
pub(crate) const INTERLINEA: &str =
    "l'interlinea di un testo è il passo di ogni sua riga nel file: si cambia dal campo Interlinea del pannello";
/// Il perché di una crenatura cambiata.
pub(crate) const CRENATURA: &str =
    "la crenatura non si scrive nel file: la scena non ha un attributo per lei";
/// Il perché di un rientro cambiato.
pub(crate) const RIENTRI: &str =
    "i rientri e gli spazi fra i paragrafi non si scrivono in un testo di punto: la scena non li ha";
/// Il perché del giustificato.
pub(crate) const GIUSTIFICATO: &str =
    "il giustificato vale per un testo in area: un testo di punto si allinea a sinistra, al centro o a destra";

/// Il perché di un testo scalato che scrive il carattere in `style`.
const STILE_IN_LINEA: &str =
    "il testo scrive il suo carattere nell'attributo style: la sua grandezza non si riscrive";

/// Il perché di un testo su tracciato cambiato in altro che il tracciato e il punto d'inizio.
pub(crate) const SUL_TRACCIATO: &str =
    "di un testo su tracciato il file scrive il tracciato e il punto d'inizio: l'effetto, il verso, l'allineamento al tracciato e la spaziatura no";

/// Il perché di un testo su tracciato con una fine prima della fine del tracciato.
pub(crate) const FINE_SUL_TRACCIATO: &str =
    "il file scrive il punto d'inizio di un testo su tracciato, non la sua fine: il testo arriva in fondo al tracciato";

/// Il `textPath` di un testo su tracciato che segue il tracciato privato `href` (formato del
/// testo, §5): `d` è il tracciato nello spazio del `<text>`, e lo `startOffset` la distanza
/// `start` (una frazione della lunghezza), che all'inizio del tracciato non si scrive. Le righe
/// del testo diventano una sola: un tracciato ha una riga.
pub(crate) fn figlio_sul_tracciato(
    t: &TextObject,
    d: &vectorcraft_geom::PathData,
    start: f64,
    href: &str,
) -> Value {
    let lunghezza = vectorcraft_geom::Shape::perimeter(&d.to_bezpath(), 1e-3);
    let mut attrs = Map::new();
    let da = start * lunghezza;
    if da.abs() >= 0.005 {
        attrs.insert("startOffset".into(), json!(numero(da, 2)));
    }
    attrs.insert("href".into(), json!(format!("#{href}")));
    let testo = t
        .plain_text()
        .replace(['\n', '\r', '\u{2028}', '\u{2029}'], " ");
    json!({ "tag": "textPath", "attrs": attrs, "text": testo })
}

/// Il tracciato privato di un testo su tracciato e il suo `d` nuovo.
pub(super) type TracciatoNuovo = (String, Value);

/// Un testo su tracciato del file di cui cambiano solo il tracciato o il punto d'inizio (Opzioni
/// testo su tracciato, la Selezione diretta sul suo tracciato): il `<text>` riscritto col
/// `textPath` nuovo e il `d` nuovo del tracciato privato, se cambia. `None` se non è un testo su
/// tracciato prima e dopo, e il resto del confronto decide; un altro cambio si rifiuta.
pub(super) fn sul_tracciato_cambiato(
    e: &Elemento,
    b: &Node,
    a: &Node,
) -> Result<Option<(TestoRiscritto, Option<TracciatoNuovo>)>, Rifiuto> {
    let (NodeKind::Text(tb), NodeKind::Text(ta)) = (&b.kind, &a.kind) else {
        return Ok(None);
    };
    let (
        TextKind::OnPath {
            path: pb,
            start: sb,
            end: None,
        },
        TextKind::OnPath {
            path: pa,
            start,
            end,
        },
    ) = (&tb.kind, &ta.kind)
    else {
        return Ok(None);
    };
    if end.is_some() {
        // Anche il verso girato di un testo che non parte dall'inizio: la sua fine si sposta.
        return Err(no(FINE_SUL_TRACCIATO));
    }
    let Some(href) = e.testo.as_ref().and_then(|i| i.tracciato.as_deref()) else {
        return Ok(None);
    };
    if tb == ta || (pb == pa && sb == start && end.is_none()) {
        // Tracciato e inizio uguali: il resto (transform, aspetto) va per la strada di sempre.
        return Ok(None);
    }
    let mut stesso = a.clone();
    if let NodeKind::Text(t) = &mut stesso.kind {
        t.kind = tb.kind.clone();
        t.cached_bounds = tb.cached_bounds;
        t.cached_baselines = tb.cached_baselines.clone();
    }
    if !proprieta_uguali(b, &stesso) || stesso.kind != b.kind {
        return Err(no(SUL_TRACCIATO));
    }
    let info = e
        .testo
        .as_ref()
        .ok_or_else(|| no("un testo del motore che non viene da un <text>"))?;
    let ctm = e
        .ctm()
        .ok_or_else(|| no("la transform del testo non si legge"))?;
    let locale = ctm.inverse() * ta.xf;
    if !locale.is_finite() {
        return Err(no("il testo ha una transform che non si inverte"));
    }
    let d = pa.transformed(locale);
    let mut attrs = Map::new();
    for (nome, valore) in &info.attributi {
        if nome != "id" {
            attrs.insert(nome.clone(), json!(valore));
        }
    }
    let figlio = figlio_sul_tracciato(ta, &d, *start, href);
    let tracciato = (pb != pa).then(|| (href.to_string(), json!(super::scrivi_d(&d))));
    Ok(Some((
        TestoRiscritto {
            attrs,
            righe: vec![figlio],
        },
        tracciato,
    )))
}

/// Il cambio di un testo di punto.
pub(super) struct CambioDelTesto {
    /// Il testo di prima con le parole, il carattere e l'allineamento di
    /// dopo, il colore di prima: il resto del confronto (spostamento,
    /// colore) va avanti su questo.
    pub prima: Node,
    /// Gli attributi del `<text>`; `null` toglie quello che torna al valore
    /// di serie.
    pub attrs: Map<String, Value>,
    /// Le righe dell'operazione `text`, se le parole cambiano.
    pub righe: Option<Vec<String>>,
}

/// Il cambio di parole, carattere o allineamento fra il testo `b` e il testo
/// `a`, se è solo questo; `None` se non cambiano (o se non sono testi), e il
/// resto del confronto decide.
pub(super) fn testo_cambiato(
    e: &Elemento,
    b: &Node,
    a: &Node,
) -> Result<Option<CambioDelTesto>, Rifiuto> {
    let (NodeKind::Text(tb), NodeKind::Text(ta)) = (&b.kind, &a.kind) else {
        return Ok(None);
    };
    if stessi_pezzi(&tb.runs, &ta.runs) && tb.para == ta.para && tb.paras == ta.paras {
        return Ok(None);
    }
    let info = e
        .testo
        .as_ref()
        .ok_or_else(|| no("un testo del motore che non viene da un <text>"))?;
    if !info.di_punto
        || tb.kind != TextKind::Point
        || ta.kind != TextKind::Point
        || tb.vertical
        || ta.vertical
    {
        return Err(no(
            "dal motore si cambiano le parole e il carattere di un testo di punto orizzontale",
        ));
    }
    if !matrici_vicine(tb.xf, ta.xf) {
        return Err(no(
            "il testo si sposta e cambia insieme: un gesto alla volta",
        ));
    }
    let mut attrs = Map::new();
    paragrafo(tb, ta, &mut attrs)?;
    carattere(e, tb, ta, &mut attrs)?;
    for nome in attrs.keys() {
        if info.attributi_delle_righe.contains(nome) || info.attributi_delle_righe.contains("style")
        {
            return Err(no(format!(
                "una riga del testo scrive il suo {nome}: il {nome} del <text> non ci arriva"
            )));
        }
    }
    let (testo_b, testo_a) = (testo_dei_pezzi(&tb.runs), testo_dei_pezzi(&ta.runs));
    let righe = if testo_b == testo_a {
        None
    } else {
        if info.pezzi {
            return Err(no(
                "le parole di un testo con pezzi di aspetto diverso non si cambiano ancora dal motore",
            ));
        }
        Some(righe_nuove(&info.righe, &testo_b, &testo_a)?)
    };
    // Il testo di prima coi pezzi di dopo, ma col colore di prima: il
    // confronto del colore lo trova cambiato, se lo è.
    let colore = tb.runs.first().map(|r| r.style.fill.clone());
    let mut prima = b.clone();
    if let NodeKind::Text(t) = &mut prima.kind {
        t.runs = ta.runs.clone();
        if let Some(colore) = colore.filter(|c| tb.runs.iter().all(|r| r.style.fill == *c)) {
            for r in &mut t.runs {
                r.style.fill = colore.clone();
            }
        }
        t.para = ta.para.clone();
        t.paras = ta.paras.clone();
    }
    Ok(Some(CambioDelTesto {
        prima,
        attrs,
        righe,
    }))
}

/// Un `<text>` che si riscrive intero: tolto e rimesso con lo stesso id, gli
/// attributi di prima (nell'ordine del file) con quelli cambiati, e un
/// `<tspan>` per riga.
#[derive(Debug, Clone)]
pub(super) struct TestoRiscritto {
    pub attrs: Map<String, Value>,
    pub righe: Vec<Value>,
}

/// Vero se il cambio fra il testo `b` e il testo `a` si scrive solo
/// riscrivendo il `<text>` intero: un testo in area o verticale, prima o
/// dopo, o un testo di punto con un'altra interlinea (il `dy` di ogni riga).
pub(super) fn da_riscrivere(b: &Node, a: &Node) -> bool {
    let (NodeKind::Text(tb), NodeKind::Text(ta)) = (&b.kind, &a.kind) else {
        return false;
    };
    if tb == ta {
        return false;
    }
    // Le colonne di un testo verticale hanno la posizione che il motore dà
    // loro (formato del testo, §10): ogni cambio le riscrive, e così il
    // cambio di verso.
    let area = |t: &TextObject| matches!(t.kind, TextKind::Area { .. });
    if area(tb) || area(ta) || tb.vertical || ta.vertical {
        return true;
    }
    // Un'interlinea che nessun pezzo di prima aveva (scrivere o cancellare
    // unisce e divide i pezzi senza cambiarla).
    let interlinea = |r: &TextRun| r.style.leading.map(f64::to_bits);
    let prima: Vec<Option<u64>> = tb.runs.iter().map(interlinea).collect();
    ta.runs.iter().any(|r| !prima.contains(&interlinea(r)))
}

/// Il `<text>` `e` riscritto col testo `a` del motore, che era `b` (K6
/// T16): la conversione fra testo di punto e testo in area, le parole e il
/// carattere di un testo in area, l'interlinea. Si riscrive soltanto un
/// testo di sole righe (niente pezzi, niente attributi sui `<tspan>` oltre a
/// `x`, `dy` e `fub:join`), con lo stesso colore e le stesse proprietà di
/// prima; il resto si rifiuta con il perché.
pub(super) fn riscrittura(e: &Elemento, b: &Node, a: &Node) -> Result<TestoRiscritto, Rifiuto> {
    let (NodeKind::Text(tb), NodeKind::Text(ta)) = (&b.kind, &a.kind) else {
        return Err(no("un testo del motore che non è più un testo"));
    };
    let info = e
        .testo
        .as_ref()
        .ok_or_else(|| no("un testo del motore che non viene da un <text>"))?;
    if !info.di_punto && info.wrap.is_none() {
        return Err(no(
            "un testo su un tracciato o l'etichetta di un connettore non si riscrive dal motore",
        ));
    }
    if info.pezzi || !info.attributi_delle_righe.is_empty() {
        return Err(no(
            "una riga del testo ha attributi o pezzi suoi: il testo non si riscrive intero",
        ));
    }
    let mut stesse = a.clone();
    stesse.kind = b.kind.clone();
    if !proprieta_uguali(b, &stesse) {
        return Err(no("il testo cambia anche in altro: un gesto alla volta"));
    }
    let colore = unico(&tb.runs, |s| s.fill.clone())
        .ok_or_else(|| no("le parti del testo hanno colori diversi"))?;
    if ta.runs.iter().any(|r| r.style.fill != colore) {
        return Err(no(
            "il colore e le righe del testo cambiano insieme: un gesto alla volta",
        ));
    }
    // Il carattere e l'allineamento come attributi del `<text>`: l'interlinea
    // la scrivono i `dy` delle righe, lo spessore del contorno delle lettere
    // `scala_il_carattere` (il motore lo tiene nello spazio del testo, che
    // Scala cambia).
    let senza_interlinea = |t: &TextObject| {
        let mut t = t.clone();
        for r in &mut t.runs {
            r.style.leading = None;
            r.style.stroke_width = 0.0;
        }
        t
    };
    let (sb, sa) = (senza_interlinea(tb), senza_interlinea(ta));
    let mut cambiati = Map::new();
    allineamento(tb, ta, &mut cambiati)?;
    carattere(e, &sb, &sa, &mut cambiati)?;
    let (testo_b, testo_a) = (testo_dei_pezzi(&tb.runs), testo_dei_pezzi(&ta.runs));
    let righe_di_punto = match (&tb.kind, &ta.kind) {
        (TextKind::Point, TextKind::Point) if info.di_punto => {
            Some(righe_nuove(&info.righe, &testo_b, &testo_a)?)
        }
        _ => None,
    };
    if let Some(c) = testo_a.chars().find(|c| !carattere_xml(*c)) {
        return Err(no(format!(
            "il carattere U+{:04X} non si scrive in un file SVG",
            c as u32
        )));
    }
    let ctm = e
        .ctm()
        .ok_or_else(|| no("la transform del testo non si legge"))?;
    let m = ctm.inverse() * ta.xf;
    let scritte = righe_scritte(ta, m, righe_di_punto).map_err(no)?;
    scala_il_carattere(info, tb, ta, ctm.inverse() * tb.xf, m, &mut cambiati)?;
    let mut attrs = Map::new();
    for (nome, valore) in &info.attributi {
        if nome != "id" {
            attrs.insert(nome.clone(), json!(valore));
        }
    }
    for (nome, valore) in cambiati {
        if valore.is_null() {
            attrs.remove(&nome);
        } else {
            attrs.insert(nome, valore);
        }
    }
    attrs.insert("x".into(), json!(scritte.x));
    attrs.insert("y".into(), json!(scritte.y));
    // Il verso (formato del testo, §10): Orientamento del testo lo cambia.
    if ta.vertical {
        attrs.insert("writing-mode".into(), json!("vertical-rl"));
    } else {
        attrs.remove("writing-mode");
    }
    match scritte.wrap {
        Some(w) => {
            attrs.insert("fub:wrap".into(), json!(w));
        }
        None => {
            attrs.remove("fub:wrap");
        }
    }
    Ok(TestoRiscritto {
        attrs,
        righe: scritte.righe,
    })
}

/// Il carattere di un testo riscritto che il motore ha scalato (Scala su un
/// testo in area): `righe_scritte` porta già nel file la posizione, la
/// larghezza e il passo delle righe, e il carattere va con loro, come il
/// motore lo mostra (`TextObject::effective_char_style`, che moltiplica il
/// corpo, l'interlinea e lo spostamento dalla linea di base per la scala, e
/// disegna il contorno delle lettere nello spazio del testo). Senza, il file
/// avrebbe le righe a metà passo con il corpo di prima: un altro disegno, e
/// alla riapertura un testo di punto. `prima` e `dopo` portano il testo
/// nello spazio del `<text>` (già controllate uniformi da `righe_scritte`).
fn scala_il_carattere(
    info: &crate::mappa::InfoTesto,
    tb: &TextObject,
    ta: &TextObject,
    prima: vectorcraft_geom::Affine,
    dopo: vectorcraft_geom::Affine,
    cambiati: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let scala = |m: vectorcraft_geom::Affine| m.determinant().abs().sqrt();
    let (sb, sa) = (scala(prima), scala(dopo));
    if !(sb.is_finite() && sb > 1e-9 && sa.is_finite() && sa > 1e-9) {
        return Err(no("il testo sta in uno spazio schiacciato"));
    }
    // Il contorno delle lettere, come si vede: il motore lo disegna nello
    // spazio del testo, quindi Scala lo fa crescere e calare con lui, se non
    // lo compensa.
    let spessore = |t: &TextObject, scala: f64| {
        unico(&t.runs, |s| s.stroke_width.to_bits()).map(|w| f64::from_bits(w) * scala)
    };
    let contorno = |t: &TextObject| {
        t.runs
            .iter()
            .any(|r| r.style.stroke != Default::default() && r.style.stroke_width > 0.0)
    };
    if contorno(tb) || contorno(ta) {
        let diversi = || no("le parti del testo hanno contorni diversi: il file ne scrive uno");
        let (wb, wa) = (
            spessore(tb, sb).ok_or_else(diversi)?,
            spessore(ta, sa).ok_or_else(diversi)?,
        );
        if !vicini(wa, wb) {
            if ta.runs.iter().any(|r| r.style.stroke_dash.is_some()) {
                return Err(no(
                    "il contorno tratteggiato delle lettere non si riscala nel file",
                ));
            }
            if info.attributi.iter().any(|(nome, _)| nome == "style") {
                return Err(no(STILE_IN_LINEA));
            }
            cambiati.insert("stroke-width".into(), json!(numero(wa, DECIMALI_GEOMETRIA)));
        }
    }
    if vicini(sa / sb, 1.0) {
        return Ok(());
    }
    if ["font-size", "letter-spacing"]
        .iter()
        .any(|nome| cambiati.contains_key(*nome))
    {
        return Err(no(
            "il testo cambia carattere e grandezza insieme: un gesto alla volta",
        ));
    }
    if info.attributi.iter().any(|(nome, _)| nome == "style") {
        return Err(no(STILE_IN_LINEA));
    }
    let diversi = || no("le parti del testo hanno corpi diversi: Scala non le riscrive");
    let corpo = unico(&ta.runs, |s| s.size.to_bits()).ok_or_else(diversi)?;
    let corpo = f64::from_bits(corpo);
    if !(corpo.is_finite() && corpo > 0.0) {
        return Err(diversi());
    }
    if ta.runs.iter().any(|r| r.style.baseline_shift.abs() > 1e-9) {
        return Err(no(
            "il testo ha lettere spostate dalla linea di base: il file non lo scrive",
        ));
    }
    cambiati.insert(
        "font-size".into(),
        json!(numero(corpo * sa, DECIMALI_GEOMETRIA)),
    );
    let em = unico(&ta.runs, |s| (s.tracking / 1000.0 * s.size).to_bits())
        .map(f64::from_bits)
        .ok_or_else(diversi)?;
    let spaziatura = em * sa;
    let scritta = info.attributi.iter().any(|(n, _)| n == "letter-spacing");
    if spaziatura.abs() >= 0.005 {
        cambiati.insert(
            "letter-spacing".into(),
            json!(numero(spaziatura, DECIMALI_GEOMETRIA)),
        );
    } else if scritta {
        cambiati.insert("letter-spacing".into(), Value::Null);
    }
    Ok(())
}

/// L'allineamento di un testo riscritto: `text-anchor` per sinistra, centro
/// e destra, uguale in tutti i paragrafi; il resto dei paragrafi non cambia
/// (Converti in testo di punto fa un paragrafo per riga, con lo stile del
/// suo).
fn allineamento(
    tb: &TextObject,
    ta: &TextObject,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let senza_allineamento = |p: &ParaStyle| {
        let mut p = p.clone();
        p.justify = Justify::Left;
        p
    };
    let primo = tb.para_at(0);
    let tutti = |t: &TextObject| {
        (0..t.paras.len().max(1))
            .map(|i| t.para_at(i).clone())
            .collect::<Vec<_>>()
    };
    let (pb, pa) = (tutti(tb), tutti(ta));
    if pb
        .iter()
        .chain(&pa)
        .any(|p| senza_allineamento(p) != senza_allineamento(primo))
    {
        return Err(no(RIENTRI));
    }
    let giusto = ta.para_at(0).justify;
    if pa.iter().any(|p| p.justify != giusto) {
        return Err(no(
            "i paragrafi del testo hanno allineamenti diversi: il file ne scrive uno",
        ));
    }
    if giusto == primo.justify {
        return Ok(());
    }
    let ancora = match giusto {
        Justify::Left | Justify::Auto => Value::Null,
        Justify::Center => json!("middle"),
        Justify::Right => json!("end"),
        _ if matches!(ta.kind, TextKind::Area { .. }) => return Err(no(GIUSTIFICATO_IN_AREA)),
        _ => return Err(no(GIUSTIFICATO)),
    };
    attrs.insert("text-anchor".into(), ancora);
    Ok(())
}

/// Vero se i pezzi dicono le stesse parole con lo stesso carattere (il
/// colore a parte: lo scrive il confronto del colore).
fn stessi_pezzi(b: &[TextRun], a: &[TextRun]) -> bool {
    b.len() == a.len()
        && b.iter().zip(a).all(|(x, y)| {
            let (mut sx, sy) = (x.style.clone(), y.style.clone());
            sx.fill = sy.fill.clone();
            x.text == y.text && sx == sy
        })
}

fn testo_dei_pezzi(pezzi: &[TextRun]) -> String {
    pezzi.iter().map(|r| r.text.as_str()).collect()
}

/// L'allineamento: `text-anchor` per sinistra, centro e destra; il resto del
/// paragrafo non cambia.
fn paragrafo(
    tb: &TextObject,
    ta: &TextObject,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let senza_allineamento = |p: &ParaStyle| {
        let mut p = p.clone();
        p.justify = Justify::Left;
        p
    };
    let rientri = |p: &ParaStyle, q: &ParaStyle| {
        !vicini(p.left_indent, q.left_indent)
            || !vicini(p.right_indent, q.right_indent)
            || !vicini(p.first_line_indent, q.first_line_indent)
            || !vicini(p.space_before, q.space_before)
            || !vicini(p.space_after, q.space_after)
    };
    if rientri(&tb.para, &ta.para)
        || tb.paras.len() != ta.paras.len()
        || tb.paras.iter().zip(&ta.paras).any(|(p, q)| rientri(p, q))
    {
        return Err(no(RIENTRI));
    }
    if senza_allineamento(&tb.para) != senza_allineamento(&ta.para) || tb.paras != ta.paras {
        return Err(no("il paragrafo cambia in un modo che il file non dice"));
    }
    if tb.para.justify == ta.para.justify {
        return Ok(());
    }
    let ancora = match ta.para.justify {
        Justify::Left | Justify::Auto => Value::Null,
        Justify::Center => json!("middle"),
        Justify::Right => json!("end"),
        Justify::JustifyLeft
        | Justify::JustifyCenter
        | Justify::JustifyRight
        | Justify::JustifyAll => return Err(no(GIUSTIFICATO)),
    };
    attrs.insert("text-anchor".into(), ancora);
    Ok(())
}

/// Il valore che tutti i pezzi hanno, se è uno.
fn unico<T: Clone + PartialEq>(pezzi: &[TextRun], f: impl Fn(&CharStyle) -> T) -> Option<T> {
    let primo = f(&pezzi.first()?.style);
    pezzi.iter().all(|r| f(&r.style) == primo).then_some(primo)
}

/// Il peso e il corsivo dal nome dello stile di una faccia («Bold Italic»,
/// «SemiBold», «Regular»).
pub(crate) fn peso_e_corsivo(stile: &str) -> (u16, bool) {
    let parole: String = stile.to_ascii_lowercase().replace(['-', '_', ' '], "");
    let corsivo = parole.contains("italic") || parole.contains("oblique");
    let peso = [
        ("thin", 100),
        ("hairline", 100),
        ("extralight", 200),
        ("ultralight", 200),
        ("semibold", 600),
        ("demibold", 600),
        ("extrabold", 800),
        ("ultrabold", 800),
        ("light", 300),
        ("medium", 500),
        ("bold", 700),
        ("black", 900),
        ("heavy", 900),
    ]
    .iter()
    .find(|(nome, _)| parole.contains(nome))
    .map_or(400, |(_, p)| *p);
    (peso, corsivo)
}

/// Il peso come lo scrive il pannello (`weightText` di `tools/look/write.ts`).
fn testo_del_peso(peso: u16) -> Value {
    match peso {
        400 => Value::Null,
        700 => json!("bold"),
        p => json!(p.to_string()),
    }
}

/// Il carattere uguale in tutti i pezzi: famiglia, stile, corpo e spaziatura
/// diventano attributi del `<text>`; l'interlinea, la crenatura e il resto
/// non cambiano.
fn carattere(
    e: &Elemento,
    tb: &TextObject,
    ta: &TextObject,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    // L'interlinea e la crenatura di dopo sono già in qualche pezzo di prima
    // (scrivere o cancellare unisce e divide i pezzi senza cambiarle).
    let interlinee: Vec<Option<f64>> = tb.runs.iter().map(|r| r.style.leading).collect();
    let stessa = |x: &Option<f64>, y: &Option<f64>| match (x, y) {
        (None, None) => true,
        (Some(x), Some(y)) => vicini(*x, *y),
        _ => false,
    };
    if ta
        .runs
        .iter()
        .any(|r| !interlinee.iter().any(|l| stessa(l, &r.style.leading)))
    {
        return Err(no(INTERLINEA));
    }
    let crenatura = |s: &CharStyle| (s.kerning.map(f64::to_bits), s.optical_kerning);
    if ta.runs.iter().any(|r| {
        !tb.runs
            .iter()
            .any(|q| crenatura(&q.style) == crenatura(&r.style))
    }) {
        return Err(no(CRENATURA));
    }
    // Ciò che resta, senza ciò che si scrive: uguale a quello di un pezzo di
    // prima.
    let resto = |s: &CharStyle| {
        let mut s = s.clone();
        s.font_family.clear();
        s.font_style.clear();
        s.size = 0.0;
        s.tracking = 0.0;
        s.leading = None;
        s.fill = Default::default();
        s.underline = false;
        s.strikethrough = false;
        s
    };
    let resti: Vec<CharStyle> = tb.runs.iter().map(|r| resto(&r.style)).collect();
    if ta.runs.iter().any(|r| !resti.contains(&resto(&r.style))) {
        return Err(no(
            "il carattere cambia in un modo che gli attributi del testo non dicono",
        ));
    }
    let diverso = || {
        no("una parte del testo avrebbe un carattere diverso: dal Completo si cambia tutto il testo")
    };
    let uguali_ai_pezzi = |f: &dyn Fn(&CharStyle) -> String| {
        tb.runs.len() == ta.runs.len()
            && tb
                .runs
                .iter()
                .zip(&ta.runs)
                .all(|(x, y)| f(&x.style) == f(&y.style))
    };
    // La famiglia e lo stile.
    let famiglia = |s: &CharStyle| s.font_family.clone();
    match (unico(&tb.runs, famiglia), unico(&ta.runs, famiglia)) {
        (Some(x), Some(y)) if x == y => {}
        (_, Some(y)) if !y.is_empty() => {
            attrs.insert("font-family".into(), json!(y));
        }
        _ if uguali_ai_pezzi(&famiglia) => {}
        _ => return Err(diverso()),
    }
    let stile = |s: &CharStyle| s.font_style.clone();
    match (unico(&tb.runs, stile), unico(&ta.runs, stile)) {
        (Some(x), Some(y)) if x == y => {}
        (x, Some(y)) => {
            let (pb, cb) = x.as_deref().map_or((400, false), peso_e_corsivo);
            let (pa, ca) = peso_e_corsivo(&y);
            if pb != pa || x.is_none() {
                attrs.insert("font-weight".into(), testo_del_peso(pa));
            }
            if cb != ca || x.is_none() {
                attrs.insert(
                    "font-style".into(),
                    if ca { json!("italic") } else { Value::Null },
                );
            }
        }
        _ if uguali_ai_pezzi(&stile) => {}
        _ => return Err(diverso()),
    }
    // Il sottolineato e il barrato: `text-decoration` del `<text>`, che
    // tiene il sopralineato di prima (il motore non lo ha).
    let decorazione = |s: &CharStyle| (s.underline, s.strikethrough);
    match (unico(&tb.runs, decorazione), unico(&ta.runs, decorazione)) {
        (Some(x), Some(y)) if x == y => {}
        (_, Some((sotto, barrato))) => {
            let sopra = e.testo.as_ref().is_some_and(|info| {
                info.attributi.iter().any(|(nome, valore)| {
                    nome == "text-decoration" && valore.split_whitespace().any(|p| p == "overline")
                })
            });
            let parole: Vec<&str> = [
                (sotto, "underline"),
                (sopra, "overline"),
                (barrato, "line-through"),
            ]
            .into_iter()
            .filter_map(|(si, parola)| si.then_some(parola))
            .collect();
            attrs.insert(
                "text-decoration".into(),
                if parole.is_empty() {
                    Value::Null
                } else {
                    json!(parole.join(" "))
                },
            );
        }
        _ if uguali_ai_pezzi(&|s: &CharStyle| format!("{:?}", decorazione(s))) => {}
        _ => return Err(diverso()),
    }
    // Il corpo e la spaziatura, nello spazio del `<text>`: il corpo del
    // motore è nello spazio del suo oggetto, che `xf` porta al documento.
    let scala = |m: vectorcraft_geom::Affine| m.determinant().abs().sqrt();
    let ctm = e
        .ctm()
        .ok_or_else(|| no("la transform del testo non si legge"))?;
    let fattore = scala(tb.xf) / scala(ctm);
    if !fattore.is_finite() || fattore <= 0.0 {
        return Err(no("il testo sta in uno spazio schiacciato"));
    }
    let corpo = |s: &CharStyle| s.size.to_bits().to_string();
    let spaziatura = |s: &CharStyle| (s.tracking / 1000.0 * s.size).to_bits().to_string();
    match (unico(&tb.runs, |s| s.size), unico(&ta.runs, |s| s.size)) {
        (Some(x), Some(y)) if vicini(x, y) => {}
        (_, Some(y)) if y > 0.0 && y.is_finite() => {
            attrs.insert(
                "font-size".into(),
                json!(numero(y * fattore, DECIMALI_GEOMETRIA)),
            );
        }
        _ if uguali_ai_pezzi(&corpo) => {}
        _ => return Err(diverso()),
    }
    let em = |s: &CharStyle| s.tracking / 1000.0 * s.size;
    match (unico(&tb.runs, em), unico(&ta.runs, em)) {
        (Some(x), Some(y)) if vicini(x, y) => {}
        (_, Some(y)) if y.is_finite() => {
            let valore = y * fattore;
            attrs.insert(
                "letter-spacing".into(),
                if valore.abs() < 0.005 {
                    Value::Null
                } else {
                    json!(numero(valore, DECIMALI_GEOMETRIA))
                },
            );
        }
        _ if uguali_ai_pezzi(&spaziatura) => {}
        _ => return Err(diverso()),
    }
    Ok(())
}

/// Le righe di un testo: si va a capo con LF, CRLF, CR e i separatori di
/// riga e di paragrafo del motore.
fn righe_di(testo: &str) -> Vec<&str> {
    dividi(testo)
}

/// Vero se `c` si scrive in un testo XML.
fn carattere_xml(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r')
        || matches!(c as u32, 0x20..=0xD7FF | 0xE000..=0xFFFD | 0x10000..=0x10FFFF)
}

/// Le righe dell'operazione `text`: quelle che non cambiano restano come le
/// scrive il file (il motore legge lo spazio XML fra due `<tspan>` come uno
/// spazio in fondo alla riga), quelle nuove sono le righe del motore senza
/// quello spazio.
fn righe_nuove(file: &[String], prima: &str, dopo: &str) -> Result<Vec<String>, Rifiuto> {
    let (rb, ra) = (righe_di(prima), righe_di(dopo));
    if rb.len() != file.len() {
        return Err(no(
            "le righe del testo nel motore non tornano con quelle del file",
        ));
    }
    if let Some(c) = dopo.chars().find(|c| !carattere_xml(*c)) {
        return Err(no(format!(
            "il carattere U+{:04X} non si scrive in un file SVG",
            c as u32
        )));
    }
    let comuni_in_testa = rb.iter().zip(&ra).take_while(|(x, y)| x == y).count();
    let massimo_in_coda = rb.len().min(ra.len()) - comuni_in_testa;
    let comuni_in_coda = rb
        .iter()
        .rev()
        .zip(ra.iter().rev())
        .take(massimo_in_coda)
        .take_while(|(x, y)| x == y)
        .count();
    let ultima = ra.len() - 1;
    let mut fuori = Vec::with_capacity(ra.len());
    for (i, riga) in ra.iter().enumerate() {
        let dalla_coda = ra.len() - i;
        let vecchia = if i < comuni_in_testa {
            Some(i)
        } else if dalla_coda <= comuni_in_coda {
            Some(rb.len() - dalla_coda)
        } else {
            None
        };
        fuori.push(match vecchia {
            Some(k) => file[k].clone(),
            None if i < ultima => riga.strip_suffix(' ').unwrap_or(riga).to_string(),
            None => riga.to_string(),
        });
    }
    Ok(fuori)
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn le_righe_si_dividono_a_ogni_fine_riga() {
        assert_eq!(righe_di("a\r\nb\rc\nd\u{2029}e"), ["a", "b", "c", "d", "e"]);
        assert_eq!(righe_di(""), [""]);
        assert_eq!(righe_di("a\n"), ["a", ""]);
    }

    #[test]
    fn le_righe_che_restano_tengono_il_testo_del_file() {
        let file = ["Pioggia".to_string(), "sul mare".to_string()];
        let nuove = righe_nuove(&file, "Pioggia \nsul mare", "Pioggia \nsul mare!").unwrap();
        assert_eq!(nuove, ["Pioggia", "sul mare!"]);
        let nuove = righe_nuove(&file, "Pioggia \nsul mare", "Piog\ngia \nsul mare").unwrap();
        assert_eq!(nuove, ["Piog", "gia", "sul mare"]);
        let nuove = righe_nuove(&file, "Pioggia \nsul mare", "Pioggia è 🌧 \nsul mare").unwrap();
        assert_eq!(nuove, ["Pioggia è 🌧", "sul mare"]);
    }

    #[test]
    fn un_carattere_di_controllo_si_rifiuta() {
        let file = ["a".to_string()];
        assert!(righe_nuove(&file, "a", "a\u{1}").is_err());
    }

    #[test]
    fn peso_e_corsivo_dal_nome_dello_stile() {
        assert_eq!(peso_e_corsivo("Regular"), (400, false));
        assert_eq!(peso_e_corsivo("Bold Italic"), (700, true));
        assert_eq!(peso_e_corsivo("SemiBold"), (600, false));
        assert_eq!(peso_e_corsivo("Extra Light"), (200, false));
        assert_eq!(peso_e_corsivo("Black"), (900, false));
    }
}
