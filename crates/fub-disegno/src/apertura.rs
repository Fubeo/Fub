//! Aprire un disegno nel motore: dal testo del file alla copia che i gesti
//! modificano.
//!
//! 1. `fub_scene::read` legge la scena: gli elementi di Fub con il loro
//!    percorso, il ruolo e lo span, e se il documento si può modificare.
//! 2. Una **copia del testo per l'import**, mai scritta nel file: ogni
//!    elemento candidato senza id riceve `id="fubtmp-<n>"`, così il motore
//!    gli dà un nome; ai candidati si tolgono le etichette che il motore
//!    preferirebbe all'id come nome (`data-name`, `aria-label`,
//!    `inkscape:label`, `serif:id`); i livelli di Fub ricevono
//!    `data-vc-layer`, così nel motore sono livelli e non gruppi.
//! 3. `vectorcraft-svg` importa la copia; [`crate::mappa`] lega ogni oggetto
//!    del motore all'elemento di Fub dello stesso nome. Ciò che non torna è
//!    una parte non mappata ([`crate::perdite`]).
//!
//! L'import cuoce nella geometria del motore tutte le `transform`: per
//! scrivere una `transform` nuova la differenza ha bisogno della matrice da
//! ogni elemento al documento del motore, che si calcola qui dagli attributi
//! (`transform` di ogni antenato, `viewBox`, `width`, `height` e
//! `preserveAspectRatio` della radice, con le unità come le legge il motore).

use std::collections::HashSet;
use std::sync::Arc;

use fub_abi::{DrawingLoss, DrawingLossKind};
use fub_scene::{Item, ReadOnly, Role};
use vectorcraft_doc::{Document, LayerColor, Node};
use vectorcraft_geom::Affine;

use crate::mappa::{Elemento, Mappa};
use crate::perdite::{self, Perdite};

/// Il prefisso degli id sintetici della copia per l'import.
pub const PREFISSO_SINTETICO: &str = "fubtmp-";

/// La copia del disegno nel motore a una revisione del testo.
pub(crate) struct Copia {
    /// La revisione del testo da cui viene.
    pub revisione: u64,
    /// Il documento si può modificare (`fub_scene` lo dice): altrimenti ogni
    /// gesto è `unsupported`.
    pub modificabile: bool,
    /// Il documento del motore com'era all'import: dopo ogni gesto la
    /// sessione torna qui, perché lo stato vero è il file.
    pub documento: Arc<Document>,
    /// Oggetti del motore ↔ elementi di Fub.
    pub mappa: Mappa,
    /// Le parti che il motore non sa modificare.
    pub perdite: Vec<DrawingLoss>,
    /// Dallo spazio della radice (le coordinate della scena) al documento
    /// del motore.
    pub radice: Affine,
}

impl Copia {
    /// Quanti elementi il motore sa modificare.
    pub fn mappati(&self) -> u32 {
        u32::try_from(self.mappa.mappati()).unwrap_or(u32::MAX)
    }

    /// Quanti elementi non tornano nella mappa.
    pub fn non_mappati(&self) -> u32 {
        u32::try_from(self.mappa.non_mappati()).unwrap_or(u32::MAX)
    }
}

/// Perché un testo non diventa una copia.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ErroreApertura {
    /// Il testo non è un SVG che `fub_scene` sa leggere.
    Scena(String),
    /// Il motore è andato in panico durante l'import.
    Panico(String),
}

impl std::fmt::Display for ErroreApertura {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ErroreApertura::Scena(m) => write!(f, "il disegno non si legge: {m}"),
            ErroreApertura::Panico(m) => {
                write!(f, "il motore si è fermato aprendo il disegno: {m}")
            }
        }
    }
}

/// La copia del testo `testo` alla revisione `revisione`.
///
/// Un errore di `fub_scene` (XML rotto, radice che non è `svg`) è un errore;
/// un import che il motore rifiuta no: la copia si apre vuota, ogni elemento
/// è non mappato e nessun gesto passa.
pub(crate) fn importa(testo: &str, revisione: u64) -> Result<Copia, ErroreApertura> {
    let scena = fub_scene::read(testo).map_err(|e| ErroreApertura::Scena(e.to_string()))?;
    let mut perdite = Perdite::nuove();
    let modificabile = scena.editable();
    if !scena.read_only.is_empty() {
        let motivi: Vec<&str> = scena
            .read_only
            .iter()
            .map(|r| motivo_sola_lettura(*r))
            .collect();
        perdite.aggiungi(
            "svg",
            DrawingLossKind::Unsupported,
            format!("sola lettura: {}", motivi.join("; ")),
        );
    } else if !modificabile {
        perdite.aggiungi(
            "svg",
            DrawingLossKind::Unsupported,
            "non è un disegno di Fub: si guarda soltanto",
        );
    }

    let radice = scena.items.iter().find_map(|i| match i {
        Item::Root(r) => Some(r.span.bytes[0]),
        _ => None,
    });
    let base = radice
        .and_then(|at| attributi(testo, at))
        .map_or(Affine::IDENTITY, |(_, a)| matrice_della_radice(&a));
    let mut elementi = elementi(testo, &scena.items, base);
    let (copia_testo, _) = copia_per_l_import(testo, &mut elementi, &scena.items);

    let documento = if elementi.is_empty() && scena.items.len() <= 1 {
        // Niente da importare: una scena troncata o vuota.
        Document::new(0.0, 0.0)
    } else {
        match vectorcraft_engine::guard::catch_panic(|| {
            vectorcraft_svg::import_with_report(&copia_testo)
        }) {
            Ok(Ok((doc, _avvisi))) => doc,
            Ok(Err(errore)) => {
                for e in elementi.iter_mut().filter(|e| e.motivo.is_none()) {
                    e.motivo = Some("il motore non apre il file");
                }
                perdite.aggiungi(
                    "svg",
                    DrawingLossKind::Unsupported,
                    format!("il motore non apre il file: {errore}"),
                );
                Document::new(0.0, 0.0)
            }
            Err(panico) => return Err(ErroreApertura::Panico(panico)),
        }
    };
    let mut documento = documento;
    livelli_vuoti(&elementi, &mut documento);
    let mappa = Mappa::nuova(elementi, &mut documento);
    perdite::classifica(&mut perdite, testo, &scena.items, &mappa);
    Ok(Copia {
        revisione,
        modificabile,
        documento: Arc::new(documento),
        mappa,
        perdite: perdite.in_elenco(),
        radice: base,
    })
}

/// I livelli di Fub che l'import non porta nel motore diventano livelli
/// vuoti del motore con il loro nome, perché ci si possa disegnare: il
/// lettore SVG del motore toglie i gruppi senza figli, e un disegno nuovo
/// comincia proprio con un livello vuoto. Solo i livelli sotto la radice;
/// ognuno va sotto il livello del motore del primo livello di Fub che lo
/// segue, se c'è, altrimenti in cima. Uno nascosto resta nascosto; quelli
/// bloccati li blocca [`Mappa::nuova`].
fn livelli_vuoti(elementi: &[Elemento], doc: &mut Document) {
    let mut livelli: Vec<&Elemento> = elementi
        .iter()
        .filter(|e| e.ruolo == Role::Layer && e.genitore.is_none() && e.motivo.is_none())
        .collect();
    livelli.sort_by(|a, b| a.percorso.cmp(&b.percorso));
    let mut nomi: HashSet<String> = HashSet::new();
    doc.walk(|n| {
        if let Some(nome) = &n.name {
            nomi.insert(nome.clone());
        }
    });
    for (i, e) in livelli.iter().enumerate() {
        if nomi.contains(&e.nome) {
            continue;
        }
        let sopra = livelli[i + 1..].iter().find_map(|s| {
            doc.layers
                .iter()
                .position(|l| l.name.as_deref() == Some(s.nome.as_str()))
        });
        let mut livello = Node::layer(doc.alloc_id(), &e.nome, LayerColor::Preset(0));
        livello.visible = !e.nascosto;
        let livello = Arc::new(livello);
        match sopra {
            Some(j) => doc.layers.insert(j, livello),
            None => doc.layers.push(livello),
        }
        nomi.insert(e.nome.clone());
    }
}

fn motivo_sola_lettura(r: ReadOnly) -> &'static str {
    match r {
        ReadOnly::Doctype => "c'è un DOCTYPE",
        ReadOnly::Encoding => "la codifica dichiarata non è UTF-8",
        ReadOnly::InvalidVersion => "fub:version non è un intero positivo",
        ReadOnly::FutureVersion => "fub:version è di una versione più nuova",
        ReadOnly::DuplicateId => "due elementi hanno lo stesso id",
        ReadOnly::TooLarge => "il file è troppo grande",
        ReadOnly::TooManyElements => "il file ha troppi elementi",
    }
}

/// Gli elementi della scena che il motore potrebbe modificare, con le
/// matrici dal loro spazio al documento del motore. `title` e `desc` non
/// sono disegno e non si contano.
fn elementi(testo: &str, items: &[Item], base: Affine) -> Vec<Elemento> {
    use std::collections::HashMap;
    let mut fuori: Vec<Elemento> = Vec::new();
    // Le matrici e le marche di ogni elemento della scena, anche di quelli
    // che non sono candidati, perché i figli le ereditano.
    struct Visto {
        ctm: Option<Affine>,
        in_risorsa: bool,
        indice: Option<usize>,
    }
    let mut visti: HashMap<Vec<usize>, Visto> = HashMap::new();
    for item in items {
        let Item::Element(e) = item else { continue };
        let genitore = e
            .path
            .split_last()
            .map(|(_, g)| g.to_vec())
            .unwrap_or_default();
        let (ctm_genitore, risorsa_genitore, indice_genitore) = match visti.get(&genitore) {
            Some(v) => (v.ctm, v.in_risorsa, v.indice),
            None => (Some(base), false, None),
        };
        let attr = attributi(testo, e.span.bytes[0])
            .map(|(_, a)| a)
            .unwrap_or_default();
        let propria = match valore(&attr, "transform") {
            Some(t) => leggi_trasformazione(t),
            None => Some(Affine::IDENTITY),
        };
        let stile_con_transform = valore(&attr, "style").is_some_and(|s| s.contains("transform"));
        let propria = if stile_con_transform { None } else { propria };
        let ctm = match (ctm_genitore, propria) {
            (Some(g), Some(p)) => Some(g * p),
            _ => None,
        };
        let in_risorsa =
            risorsa_genitore || matches!(e.role, Role::Defs | Role::Resource | Role::Symbol);
        let candidato = !matches!(e.role, Role::Title | Role::Desc);
        let mut indice = None;
        if candidato {
            let motivo = if in_risorsa {
                Some("dentro <defs>: una risorsa, non un oggetto del disegno")
            } else if matches!(e.role, Role::Instance | Role::Copy) {
                Some("un'istanza (<use>): il motore la scioglie")
            } else {
                None
            };
            indice = Some(fuori.len());
            fuori.push(Elemento {
                percorso: e.path.clone(),
                tag: e.tag,
                ruolo: e.role,
                id: e.id.clone(),
                nome: e.id.clone().unwrap_or_default(),
                genitore: indice_genitore,
                propria,
                ctm_genitore,
                bloccato: e.locked,
                nascosto: e.hidden,
                nodo: None,
                motivo,
            });
        }
        visti.insert(
            e.path.clone(),
            Visto {
                ctm,
                in_risorsa,
                indice: indice.or(indice_genitore),
            },
        );
    }
    fuori
}

/// La copia per l'import: id sintetici, etichette tolte, livelli marcati.
/// Restituisce anche gli id sintetici dati.
fn copia_per_l_import(
    testo: &str,
    elementi: &mut [Elemento],
    items: &[Item],
) -> (String, Vec<String>) {
    let mut ids: HashSet<String> = HashSet::new();
    for item in items {
        if let Item::Element(e) = item {
            if let Some(id) = &e.id {
                ids.insert(id.clone());
            }
        }
    }
    // Gli span di ogni elemento, per percorso.
    let mut span = std::collections::HashMap::new();
    for item in items {
        if let Item::Element(e) = item {
            span.insert(e.path.clone(), e.span.bytes[0]);
        }
    }
    let mut modifiche: Vec<(usize, usize, String)> = Vec::new();
    let mut n = 0usize;
    let mut sintetici = Vec::new();
    for e in elementi.iter_mut() {
        let Some(&inizio) = span.get(&e.percorso) else {
            continue;
        };
        let Some((dopo_il_nome, attr)) = attributi(testo, inizio) else {
            continue;
        };
        if e.id.is_none() {
            let nome = loop {
                n += 1;
                let nome = format!("{PREFISSO_SINTETICO}{n}");
                if !ids.contains(&nome) {
                    break nome;
                }
            };
            match attr.iter().find(|a| a.nome == "id") {
                Some(a) => modifiche.push((a.valore_da, a.valore_a, nome.clone())),
                None => modifiche.push((dopo_il_nome, dopo_il_nome, format!(" id=\"{nome}\""))),
            }
            e.nome = nome.clone();
            sintetici.push(nome);
        }
        for a in attr.iter().filter(|a| etichetta(&a.nome)) {
            modifiche.push((a.da, a.a, String::new()));
        }
        if e.ruolo == Role::Layer && !attr.iter().any(|a| a.nome == "data-vc-layer") {
            modifiche.push((
                dopo_il_nome,
                dopo_il_nome,
                " data-vc-layer=\"\"".to_string(),
            ));
        }
    }
    modifiche.sort_by_key(|m| (m.0, m.1));
    let mut out = String::with_capacity(testo.len() + modifiche.len() * 24);
    let mut at = 0;
    for (da, a, con) in modifiche {
        if da < at {
            continue;
        }
        out.push_str(&testo[at..da]);
        out.push_str(&con);
        at = a;
    }
    out.push_str(&testo[at..]);
    (out, sintetici)
}

/// Le etichette che il motore userebbe come nome al posto dell'id.
fn etichetta(nome: &str) -> bool {
    if nome == "data-name" || nome == "aria-label" {
        return true;
    }
    match nome.split_once(':') {
        Some((prefisso, locale)) => {
            prefisso != "xml" && prefisso != "xmlns" && (locale == "label" || locale == "id")
        }
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Il tag di apertura
// ---------------------------------------------------------------------------

/// Un attributo di un tag di apertura.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Attributo {
    /// Il nome com'è scritto, con il prefisso.
    pub nome: String,
    /// Il valore con le entità sciolte.
    pub valore: String,
    /// I byte dell'attributo intero, con lo spazio che lo precede.
    pub da: usize,
    pub a: usize,
    /// I byte del valore fra le virgolette.
    pub valore_da: usize,
    pub valore_a: usize,
}

/// Gli attributi del tag di apertura che comincia a `inizio` (il `<`), con
/// il byte subito dopo il nome del tag. `None` se lì non c'è un tag.
pub(crate) fn attributi(testo: &str, inizio: usize) -> Option<(usize, Vec<Attributo>)> {
    let b = testo.as_bytes();
    if b.get(inizio) != Some(&b'<') {
        return None;
    }
    let mut i = inizio + 1;
    while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'>' && b[i] != b'/' {
        i += 1;
    }
    let dopo_il_nome = i;
    let mut fuori = Vec::new();
    loop {
        let da = i;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= b.len() || b[i] == b'>' || b[i] == b'/' {
            return Some((dopo_il_nome, fuori));
        }
        let nome_da = i;
        while i < b.len()
            && !b[i].is_ascii_whitespace()
            && b[i] != b'='
            && b[i] != b'>'
            && b[i] != b'/'
        {
            i += 1;
        }
        let nome = testo.get(nome_da..i)?.to_string();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        if b.get(i) != Some(&b'=') {
            return None;
        }
        i += 1;
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let virgolette = *b.get(i)?;
        if virgolette != b'"' && virgolette != b'\'' {
            return None;
        }
        i += 1;
        let valore_da = i;
        while i < b.len() && b[i] != virgolette {
            i += 1;
        }
        if i >= b.len() {
            return None;
        }
        let valore_a = i;
        i += 1;
        fuori.push(Attributo {
            nome,
            valore: sciogli(testo.get(valore_da..valore_a)?),
            da,
            a: i,
            valore_da,
            valore_a,
        });
    }
}

/// Il valore dell'attributo `nome`, se c'è.
pub(crate) fn valore<'a>(attr: &'a [Attributo], nome: &str) -> Option<&'a str> {
    attr.iter()
        .find(|a| a.nome == nome)
        .map(|a| a.valore.as_str())
}

/// Le entità XML sciolte (le cinque predefinite e i riferimenti numerici).
fn sciogli(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(fine) = rest.find(';') else { break };
        let ent = &rest[1..fine];
        let c = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => ent
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| ent.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = &rest[fine + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------
// Le matrici
// ---------------------------------------------------------------------------

/// Pixel CSS per pollice: le unità fisiche si leggono così.
const PX_PER_POLLICE: f64 = 96.0;

/// Il passo dalla radice al documento del motore: la scala delle unità (un
/// file in unità fisiche si legge in punti, 0,75 per pixel) per la
/// trasformazione del `viewBox`.
pub(crate) fn matrice_della_radice(attr: &[Attributo]) -> Affine {
    let lunghezza = |nome: &str| valore(attr, nome).and_then(leggi_lunghezza);
    let (w, h) = (lunghezza("width"), lunghezza("height"));
    let fisica = |l: Option<Lunghezza>| matches!(l, Some(Lunghezza::Fisica(_)));
    let k = if fisica(w) || fisica(h) { 0.75 } else { 1.0 };
    let Some(vb) = valore(attr, "viewBox").and_then(leggi_view_box) else {
        return Affine::scale(k);
    };
    let px = |l: Option<Lunghezza>, dal_vb: f64| match l {
        Some(Lunghezza::Px(v) | Lunghezza::Fisica(v)) if v > 0.0 => v,
        _ => dal_vb,
    };
    let (pw, ph) = (px(w, vb[2]), px(h, vb[3]));
    Affine::scale(k)
        * view_box(
            vb,
            pw,
            ph,
            valore(attr, "preserveAspectRatio").unwrap_or(""),
        )
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Lunghezza {
    /// Pixel, o un numero senza unità.
    Px(f64),
    /// Un'unità fisica, già in pixel.
    Fisica(f64),
    /// Una percentuale o un'unità che dipende da altro.
    Relativa,
}

fn leggi_lunghezza(s: &str) -> Option<Lunghezza> {
    let s = s.trim();
    let fine = s
        .find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E')))
        .unwrap_or(s.len());
    // `e` di `em` non è un esponente.
    let (num, unita) = if s[..fine].ends_with(['e', 'E']) && s[fine..].starts_with(['m', 'x']) {
        (&s[..fine - 1], &s[fine - 1..])
    } else {
        (&s[..fine], &s[fine..])
    };
    let v: f64 = num.parse().ok()?;
    if !v.is_finite() {
        return None;
    }
    Some(match unita.trim() {
        "" | "px" => Lunghezza::Px(v),
        "in" => Lunghezza::Fisica(v * PX_PER_POLLICE),
        "cm" => Lunghezza::Fisica(v * PX_PER_POLLICE / 2.54),
        "mm" => Lunghezza::Fisica(v * PX_PER_POLLICE / 25.4),
        "pt" => Lunghezza::Fisica(v * PX_PER_POLLICE / 72.0),
        "pc" => Lunghezza::Fisica(v * PX_PER_POLLICE / 6.0),
        _ => Lunghezza::Relativa,
    })
}

fn numeri(s: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b',') {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        let da = i;
        if b[i] == b'-' || b[i] == b'+' {
            i += 1;
        }
        let mut punto = false;
        while i < b.len() && (b[i].is_ascii_digit() || (b[i] == b'.' && !punto)) {
            punto |= b[i] == b'.';
            i += 1;
        }
        if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
            let j = i;
            i += 1;
            if i < b.len() && (b[i] == b'-' || b[i] == b'+') {
                i += 1;
            }
            if i < b.len() && b[i].is_ascii_digit() {
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
            } else {
                i = j;
            }
        }
        match s[da..i].parse::<f64>() {
            Ok(v) if v.is_finite() => out.push(v),
            _ => return Vec::new(),
        }
    }
    out
}

fn leggi_view_box(s: &str) -> Option<[f64; 4]> {
    match numeri(s)[..] {
        [x, y, w, h] if w > 0.0 && h > 0.0 => Some([x, y, w, h]),
        _ => None,
    }
}

/// La trasformazione del `viewBox` `vb` in un riquadro di `w`×`h` pixel,
/// secondo `preserveAspectRatio` (SVG 1.1, §7.8).
fn view_box(vb: [f64; 4], w: f64, h: f64, par: &str) -> Affine {
    let mut parti = par.split_whitespace();
    let align = parti.next().unwrap_or("xMidYMid");
    let slice = parti.next() == Some("slice");
    let (mut sx, mut sy) = (w / vb[2], h / vb[3]);
    if align == "none" {
        return Affine::new([sx, 0.0, 0.0, sy, -vb[0] * sx, -vb[1] * sy]);
    }
    let s = if slice { sx.max(sy) } else { sx.min(sy) };
    sx = s;
    sy = s;
    let (mut tx, mut ty) = (-vb[0] * sx, -vb[1] * sy);
    let (lw, lh) = (vb[2] * sx, vb[3] * sy);
    if align.contains("xMid") {
        tx += (w - lw) / 2.0;
    } else if align.contains("xMax") {
        tx += w - lw;
    }
    if align.contains("YMid") {
        ty += (h - lh) / 2.0;
    } else if align.contains("YMax") {
        ty += h - lh;
    }
    Affine::new([sx, 0.0, 0.0, sy, tx, ty])
}

/// Una lista di trasformazioni SVG (`matrix`, `translate`, `scale`, `rotate`,
/// `skewX`, `skewY`) come una matrice. `None` se non si legge.
pub(crate) fn leggi_trasformazione(s: &str) -> Option<Affine> {
    let mut m = Affine::IDENTITY;
    let mut rest = s.trim();
    while !rest.is_empty() {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',');
        if rest.is_empty() {
            break;
        }
        let aperta = rest.find('(')?;
        let nome = rest[..aperta].trim();
        let chiusa = rest.find(')')?;
        let args = numeri(&rest[aperta + 1..chiusa]);
        if args.is_empty() && !rest[aperta + 1..chiusa].trim().is_empty() {
            return None;
        }
        let t = match (nome, &args[..]) {
            ("matrix", [a, b, c, d, e, f]) => Affine::new([*a, *b, *c, *d, *e, *f]),
            ("translate", [x]) => Affine::translate((*x, 0.0)),
            ("translate", [x, y]) => Affine::translate((*x, *y)),
            ("scale", [s]) => Affine::scale(*s),
            ("scale", [x, y]) => Affine::scale_non_uniform(*x, *y),
            ("rotate", [a]) => Affine::rotate(a.to_radians()),
            ("rotate", [a, x, y]) => {
                Affine::translate((*x, *y))
                    * Affine::rotate(a.to_radians())
                    * Affine::translate((-*x, -*y))
            }
            ("skewX", [a]) => Affine::new([1.0, 0.0, a.to_radians().tan(), 1.0, 0.0, 0.0]),
            ("skewY", [a]) => Affine::new([1.0, a.to_radians().tan(), 0.0, 1.0, 0.0, 0.0]),
            _ => return None,
        };
        m *= t;
        rest = &rest[chiusa + 1..];
    }
    m.is_finite().then_some(m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vicine(a: Affine, b: Affine) -> bool {
        a.as_coeffs()
            .iter()
            .zip(b.as_coeffs())
            .all(|(x, y)| (x - y).abs() < 1e-9)
    }

    #[test]
    fn trasformazioni() {
        assert_eq!(
            leggi_trasformazione("translate(10 5)"),
            Some(Affine::translate((10.0, 5.0)))
        );
        assert_eq!(
            leggi_trasformazione("matrix(1,0,0,1,20,5)"),
            Some(Affine::translate((20.0, 5.0)))
        );
        let r = leggi_trasformazione("rotate(90 10 10)").expect("rotate");
        assert!(
            vicine(r, Affine::new([0.0, 1.0, -1.0, 0.0, 20.0, 0.0])),
            "{r:?}"
        );
        assert!(vicine(
            leggi_trasformazione("translate(1) scale(2)").expect("due"),
            Affine::new([2.0, 0.0, 0.0, 2.0, 1.0, 0.0])
        ));
        assert_eq!(leggi_trasformazione("translate(a)"), None);
        assert_eq!(leggi_trasformazione("wobble(1)"), None);
        assert_eq!(leggi_trasformazione(""), Some(Affine::IDENTITY));
        assert_eq!(numeri("1e2-3.5.5"), vec![100.0, -3.5, 0.5]);
    }

    #[test]
    fn radice() {
        let a = |s: &str| attributi(s, 0).expect("tag").1;
        assert!(vicine(
            matrice_della_radice(&a(
                "<svg viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">"
            )),
            Affine::IDENTITY
        ));
        assert!(vicine(
            matrice_della_radice(&a(
                "<svg viewBox=\"0 0 400 300\" width=\"800\" height=\"600\">"
            )),
            Affine::scale(2.0)
        ));
        assert!(vicine(
            matrice_della_radice(&a(
                "<svg viewBox=\"10 0 100 100\" width=\"100mm\" height=\"100mm\">"
            )),
            Affine::new([
                0.75 * 3.7795275590551185,
                0.0,
                0.0,
                0.75 * 3.7795275590551185,
                -10.0 * 0.75 * 3.7795275590551185,
                0.0
            ])
        ));
        assert!(vicine(
            matrice_della_radice(&a(
                "<svg viewBox=\"0 0 100 50\" width=\"100\" height=\"100\">"
            )),
            Affine::new([1.0, 0.0, 0.0, 1.0, 0.0, 25.0])
        ));
    }

    #[test]
    fn attributi_e_entita() {
        let s = "<rect  id='a&amp;b' x=\"1\"\n fill = \"#000\"/>";
        let (dopo, a) = attributi(s, 0).expect("tag");
        assert_eq!(dopo, 5);
        assert_eq!(a.len(), 3);
        assert_eq!(a[0].valore, "a&b");
        assert_eq!(&s[a[1].da..a[1].a], " x=\"1\"");
        assert_eq!(a[2].nome, "fill");
        assert!(attributi("<rect x=1>", 0).is_none());
    }

    #[test]
    fn copia_con_id_sintetici() {
        let testo = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 10 10\">\n<g id=\"l1\" fub:layer=\"L\"><rect x=\"1\" y=\"1\" width=\"2\" height=\"2\"/></g>\n</svg>\n";
        let scena = fub_scene::read(testo).expect("scena");
        let mut el = elementi(testo, &scena.items, Affine::IDENTITY);
        let (copia, sintetici) = copia_per_l_import(testo, &mut el, &scena.items);
        assert_eq!(sintetici, vec!["fubtmp-1".to_string()]);
        assert!(
            copia.contains("<g data-vc-layer=\"\" id=\"l1\" fub:layer=\"L\">"),
            "{copia}"
        );
        assert!(copia.contains("<rect id=\"fubtmp-1\" x=\"1\""), "{copia}");
        assert!(!testo.contains("fubtmp"));
    }

    #[test]
    fn etichette() {
        for e in ["data-name", "aria-label", "inkscape:label", "serif:id"] {
            assert!(etichetta(e), "{e}");
        }
        for e in ["id", "xml:id", "label", "fub:layer", "xmlns:serif"] {
            assert!(!etichetta(e), "{e}");
        }
    }
}
