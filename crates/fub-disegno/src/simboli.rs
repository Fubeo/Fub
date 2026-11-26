//! I simboli del disegno nel motore (K6, il pannello Simboli e gli
//! strumenti della Simbolizzazione; `docs/reference/scene-format-symbols.md`).
//!
//! All'apertura i simboli del file (`<symbol>` con `fub:role` di Fub nelle
//! `defs`) diventano i simboli del motore, col nome del loro `<title>`, e le
//! istanze (`<use>` di Fub) le sue istanze, legate per l'id come ogni altro
//! oggetto. L'import del motore fa un simbolo solo da un `<symbol>` che un
//! `<use>` ripete: per ogni simbolo che nessuno usa la copia per l'import
//! aggiunge un `<use>` provvisorio ([`PREFISSO_USO`]), che il motore importa
//! e che qui si toglie subito.
//!
//! Il motore chiama un simbolo con l'id del suo `<symbol>`; qui prende il
//! nome del `<title>` (unico fra i simboli: un nome ripetuto riceve « 2»),
//! o resta l'id se non ne ha. Un simbolo che l'arte di un altro simbolo
//! ripete resta col suo id: le istanze annidate non si rinominano.
//!
//! Dopo un gesto i simboli del motore tornano operazioni sul file
//! ([`crate::differenza`]): un'istanza nuova è un `<use>`, un simbolo nuovo
//! un `<symbol>` nella `fub-defs`, uno tolto si toglie, uno rinominato cambia
//! il suo `<title>`, uno con l'arte cambiata si riscrive con lo stesso id.

use std::collections::{HashMap, HashSet};

use std::sync::Arc;

use fub_scene::{Item, Role};
use serde_json::{json, Value};
use vectorcraft_color::BlendMode;
use vectorcraft_doc::{Document, Node, NodeKind, Symbol, SYMBOL_HALF, SYMBOL_SIZES};
use vectorcraft_geom::Affine;

use crate::id::Specie;

/// Il prefisso degli id dei `<use>` provvisori della copia per l'import.
pub(crate) const PREFISSO_USO: &str = "fubsimbolo-";

/// Un simbolo del file.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SimboloDelFile {
    /// L'id del `<symbol>`.
    pub id: String,
    /// Il nome che il motore gli dà.
    pub nome: String,
    /// Il testo del suo `<title>`, se ne ha uno.
    pub titolo: Option<String>,
    /// Il bersaglio del suo primo `<title>`, se ne ha uno.
    pub bersaglio_titolo: Option<Value>,
    /// I bersagli del suo contenuto (i figli che non sono `title` o `desc`),
    /// nell'ordine del file.
    pub contenuto: Vec<Value>,
}

/// I simboli del file legati a quelli del motore.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Simboli {
    pub elenco: Vec<SimboloDelFile>,
}

impl Simboli {
    /// Il simbolo del file che il motore chiama `nome`.
    pub(crate) fn del_nome(&self, nome: &str) -> Option<&SimboloDelFile> {
        self.elenco.iter().find(|s| s.nome == nome)
    }

    /// Il simbolo del file con l'id `id`.
    pub(crate) fn del_id(&self, id: &str) -> Option<&SimboloDelFile> {
        self.elenco.iter().find(|s| s.id == id)
    }
}

/// I simboli di Fub del file: quelli che `fub_scene` riconosce, con un id.
fn simboli_di_fub(items: &[Item]) -> Vec<(&str, Option<&str>, &[usize])> {
    items
        .iter()
        .filter_map(|i| match i {
            Item::Element(e) if e.role == Role::Symbol => {
                Some((e.id.as_deref()?, e.title.as_deref(), e.path.as_slice()))
            }
            _ => None,
        })
        .collect()
}

/// Il bersaglio di un elemento: il suo id, o il percorso e il tag.
fn bersaglio(e: &fub_scene::ElementItem) -> Value {
    match &e.id {
        Some(id) => json!(id),
        None => json!({ "path": e.path, "tag": e.tag }),
    }
}

/// Il primo `title` e il contenuto del simbolo al percorso `percorso`.
fn figli_del_simbolo(items: &[Item], percorso: &[usize]) -> (Option<Value>, Vec<Value>) {
    let mut titolo = None;
    let mut contenuto = Vec::new();
    for item in items {
        let Item::Element(e) = item else { continue };
        if e.path.len() != percorso.len() + 1 || !e.path.starts_with(percorso) {
            continue;
        }
        match e.role {
            Role::Title => {
                if titolo.is_none() {
                    titolo = Some(bersaglio(e));
                }
            }
            Role::Desc => {}
            _ => contenuto.push(bersaglio(e)),
        }
    }
    (titolo, contenuto)
}

/// I `<use>` provvisori della copia per l'import, uno per ogni simbolo di
/// Fub che nessuna istanza usa: il byte dove va e il testo. Vanno in fondo
/// all'ultimo livello di Fub, o in fondo alla radice se non ce n'è uno.
pub(crate) fn usi_provvisori(testo: &str, items: &[Item]) -> Vec<(usize, String)> {
    let usati: HashSet<&str> = items
        .iter()
        .filter_map(|i| match i {
            Item::Element(e) if e.role == Role::Instance => e.symbol.as_deref(),
            _ => None,
        })
        .collect();
    let senza: Vec<&str> = simboli_di_fub(items)
        .into_iter()
        .map(|(id, _, _)| id)
        .filter(|id| !usati.contains(id))
        .collect();
    if senza.is_empty() {
        return Vec::new();
    }
    let fine_di = |span: [usize; 2]| -> Option<usize> {
        let dentro = testo.get(span[0]..span[1])?;
        if dentro.ends_with("/>") {
            return None;
        }
        dentro.rfind("</").map(|k| span[0] + k)
    };
    let livello = items.iter().rev().find_map(|i| match i {
        Item::Element(e) if e.role == Role::Layer && e.path.len() == 1 => fine_di(e.span.bytes),
        _ => None,
    });
    let radice = || {
        items.iter().find_map(|i| match i {
            Item::Root(r) => fine_di(r.span.bytes),
            _ => None,
        })
    };
    let Some(dove) = livello.or_else(radice) else {
        return Vec::new();
    };
    senza
        .into_iter()
        .map(|id| {
            (
                dove,
                format!("<use id=\"{PREFISSO_USO}{id}\" href=\"#{id}\"/>"),
            )
        })
        .collect()
}

/// Lega i simboli del motore a quelli del file: toglie le istanze
/// provvisorie, dà a ogni simbolo il nome del suo `<title>` e ne tiene
/// l'elenco.
pub(crate) fn leggi(items: &[Item], doc: &mut Document) -> Simboli {
    // Le istanze provvisorie si tolgono: il simbolo resta.
    let mut provvisorie = Vec::new();
    doc.walk(|n| {
        if n.name
            .as_deref()
            .is_some_and(|nome| nome.starts_with(PREFISSO_USO))
        {
            provvisorie.push(n.id);
        }
    });
    for id in provvisorie {
        let _ = doc.remove(id);
    }
    // I simboli che l'arte di un altro ripete restano col loro id.
    let mut annidati: HashSet<String> = HashSet::new();
    for s in &doc.symbols {
        vectorcraft_doc::swatches::walk_with_masks(&s.art, &mut |m| {
            if let NodeKind::SymbolInstance { symbol, .. } = &m.kind {
                annidati.insert(symbol.clone());
            }
        });
    }
    let mut elenco = Vec::new();
    let mut presi: HashSet<String> = doc.symbols.iter().map(|s| s.name.clone()).collect();
    let mut rinomina: HashMap<String, String> = HashMap::new();
    for (id, titolo, percorso) in simboli_di_fub(items) {
        if !doc.symbols.iter().any(|s| s.name == id) {
            continue;
        }
        let titolo = titolo.map(str::trim).filter(|t| !t.is_empty());
        let nome = match titolo {
            Some(t) if !annidati.contains(id) => {
                presi.remove(id);
                let nome = unico(t, &presi);
                presi.insert(nome.clone());
                if nome != id {
                    rinomina.insert(id.to_string(), nome.clone());
                }
                nome
            }
            _ => id.to_string(),
        };
        let (bersaglio_titolo, contenuto) = figli_del_simbolo(items, percorso);
        elenco.push(SimboloDelFile {
            id: id.to_string(),
            nome,
            titolo: titolo.map(str::to_string),
            bersaglio_titolo,
            contenuto,
        });
    }
    if !rinomina.is_empty() {
        for s in doc.symbols.iter_mut() {
            if let Some(n) = rinomina.get(&s.name) {
                s.name = n.clone();
            }
        }
        let mut istanze = Vec::new();
        doc.walk(|n| {
            if let NodeKind::SymbolInstance { symbol, .. } = &n.kind {
                if rinomina.contains_key(symbol) {
                    istanze.push(n.id);
                }
            }
        });
        for id in istanze {
            if let Some(NodeKind::SymbolInstance { symbol, .. }) =
                doc.node_mut(id).map(|n| &mut n.kind)
            {
                if let Some(n) = rinomina.get(symbol) {
                    *symbol = n.clone();
                }
            }
        }
    }
    Simboli { elenco }
}

/// `nome`, o `nome 2`, `nome 3`… se è già preso.
fn unico(nome: &str, presi: &HashSet<String>) -> String {
    if !presi.contains(nome) {
        return nome.to_string();
    }
    (2..)
        .map(|k| format!("{nome} {k}"))
        .find(|n| !presi.contains(n))
        .unwrap_or_default()
}

/// Le istanze di Fub (`<use>` di un simbolo legato) che il motore ha come
/// sue istanze: il percorso dell'elemento. Le altre restano fuori.
pub(crate) fn istanze_legate(
    items: &[Item],
    simboli: &Simboli,
    doc: &Document,
) -> HashSet<Vec<usize>> {
    let mut per_nome: HashMap<&str, Vec<&NodeKind>> = HashMap::new();
    doc.walk(|n| {
        if let Some(nome) = n.name.as_deref() {
            per_nome.entry(nome).or_default().push(&n.kind);
        }
    });
    items
        .iter()
        .filter_map(|i| match i {
            Item::Element(e) if e.role == Role::Instance => {
                let id = e.id.as_deref()?;
                let simbolo = simboli.del_id(e.symbol.as_deref()?)?;
                match per_nome.get(id).map(Vec::as_slice) {
                    Some([NodeKind::SymbolInstance { symbol, .. }]) if *symbol == simbolo.nome => {
                        Some(e.path.clone())
                    }
                    _ => None,
                }
            }
            _ => None,
        })
        .collect()
}

/// Le operazioni dei simboli di un gesto.
#[derive(Debug, Default)]
pub(crate) struct ScritturaDeiSimboli {
    /// I `<symbol>` nuovi, come testo, da aggiungere in fondo alla
    /// `fub-defs` prima delle istanze.
    pub nuovi: Vec<String>,
    /// I cambi dei simboli che c'erano (nome, contenuto): prima delle
    /// istanze, dopo i nuovi.
    pub cambi: Vec<Value>,
    /// I simboli tolti: per ultimi, quando nessuna istanza li usa più.
    pub tolti: Vec<Value>,
    /// L'id nel file di ogni simbolo del motore dopo il gesto.
    pub ids: std::collections::HashMap<String, String>,
    /// La matrice che il contenuto scritto ha in più rispetto all'arte del
    /// motore, per i simboli nuovi con una misura naturale: un'istanza si
    /// scrive col suo `xf` per l'inversa.
    pub scale: std::collections::HashMap<String, Affine>,
    /// Per ogni simbolo del motore dopo il gesto, le transform sotto cui
    /// il suo `<symbol>` disegna l'arte come il motore ([`Riuso`]).
    pub riusi: std::collections::HashMap<String, Riuso>,
}

impl ScritturaDeiSimboli {
    /// Un'istanza di `nome` con la transform `t` (quella del `use`, nello
    /// spazio del contenuto scritto) si scrive come `use`? Se no, come in
    /// VectorCraft, si scrive con la sua copia dell'arte.
    pub fn si_riusa(&self, nome: &str, t: Affine) -> bool {
        self.riusi.get(nome).is_some_and(|r| r.permette(t))
    }
}

/// Sotto quali transform il `<symbol>` di un'arte disegna come il motore,
/// che trasforma solo la geometria dell'arte: gli spessori dei contorni,
/// gli effetti, i motivi e le maschere non legate restano dove sono. La
/// stessa regola di VectorCraft (`Reuse` in `svg/src/export/nodes.rs`):
/// l'esportazione scrive un `use` solo dove vale, e l'import riconosce
/// un'istanza solo dove vale.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Riuso {
    /// Gli spostamenti (niente motivi né maschere non legate).
    sposta: bool,
    /// Rotazioni e riflessioni (né effetti né pennelli).
    gira: bool,
    /// Ogni altra transform (né contorni né oggetti vivi).
    scala: bool,
}

/// Quanto i simboli si annidano l'uno nell'altro, come in VectorCraft.
const ANNIDAMENTO_MASSIMO: u32 = 8;

impl Riuso {
    const NIENTE: Self = Self {
        sposta: false,
        gira: false,
        scala: false,
    };

    /// Ciò che permette un `<symbol>` dell'arte `arte`.
    pub(crate) fn di(doc: &Document, arte: &Node) -> Self {
        let mut r = Self {
            sposta: true,
            gira: true,
            scala: true,
        };
        r.guarda(doc, arte, 0);
        r
    }

    fn guarda(&mut self, doc: &Document, n: &Node, livello: u32) {
        use vectorcraft_doc::{color::Paint, AppearanceItem};
        let motivo = |p: &Paint| matches!(p, Paint::Pattern { .. });
        let testo_a_motivi = matches!(&n.kind, NodeKind::Text(t)
            if t.runs.iter().any(|r| motivo(&r.style.fill) || motivo(&r.style.stroke)));
        let maschera_sciolta = n.extras().mask.as_ref().is_some_and(|m| !m.linked);
        if livello > ANNIDAMENTO_MASSIMO
            || testo_a_motivi
            || maschera_sciolta
            || vectorcraft_doc::pattern::uses_pattern(n, None)
        {
            *self = Self::NIENTE;
            return;
        }
        let effetti = |fx: &[vectorcraft_doc::Effect]| fx.iter().any(|e| e.visible);
        if effetti(&n.appearance.effects) || n.appearance.items.iter().any(|i| effetti(i.effects()))
        {
            (self.gira, self.scala) = (false, false);
        }
        for i in &n.appearance.items {
            if let AppearanceItem::Stroke(s) = i {
                if s.visible && !s.paint.is_none() && s.width > 0.0 {
                    self.scala = false;
                    self.gira &= s.brush.is_none();
                }
            }
        }
        match &n.kind {
            NodeKind::Blend { .. }
            | NodeKind::Envelope { .. }
            | NodeKind::Mesh(_)
            | NodeKind::Repeat(_)
            | NodeKind::PlacedDocument(_)
            | NodeKind::Intertwine { .. } => (self.gira, self.scala) = (false, false),
            NodeKind::SymbolInstance { symbol, .. } => {
                if let Some(s) = doc.symbols.iter().find(|s| s.name == *symbol) {
                    self.guarda(doc, &s.art, livello + 1);
                }
            }
            _ => {}
        }
        if let Some(m) = &n.extras().mask {
            self.guarda(doc, &m.art, livello);
        }
        for c in n.children().into_iter().flatten() {
            self.guarda(doc, c, livello);
        }
    }

    /// Il `<symbol>` sta per un'istanza con la transform `t`?
    pub(crate) fn permette(self, t: Affine) -> bool {
        const EPS: f64 = 1e-9;
        let [a, b, c, d, _, _] = t.as_coeffs();
        if (a - 1.0).abs() < EPS && b.abs() < EPS && c.abs() < EPS && (d - 1.0).abs() < EPS {
            return self.sposta;
        }
        let rigida = (a * a + b * b - 1.0).abs() < EPS
            && (c * c + d * d - 1.0).abs() < EPS
            && (a * c + b * d).abs() < EPS;
        if rigida {
            self.gira
        } else {
            self.scala
        }
    }
}

/// La misura naturale del simbolo `nome` come matrice: l'arte del motore,
/// normalizzata in un quadrato di lato `2·SYMBOL_HALF`, portata alla sua
/// misura. L'identità per un simbolo senza misura naturale (quelli del
/// file).
fn scala_naturale(doc: &Document, nome: &str) -> Affine {
    let misura = doc
        .unknown
        .get(SYMBOL_SIZES)
        .and_then(|m| m.get(nome))
        .and_then(|v| Some((v.get(0)?.as_f64()?, v.get(1)?.as_f64()?)));
    match misura {
        Some((w, h)) if w > 0.0 && h > 0.0 => {
            Affine::scale_non_uniform(w / (2.0 * SYMBOL_HALF), h / (2.0 * SYMBOL_HALF))
        }
        _ => Affine::IDENTITY,
    }
}

/// Le opzioni di un simbolo che il formato non ha, o `None`.
fn opzioni_fuori_formato(doc: &Document, s: &Symbol) -> Option<&'static str> {
    if s.dynamic {
        return Some("un simbolo dinamico");
    }
    if doc.symbol_registration(&s.name) != Default::default() {
        return Some("il punto di registrazione del simbolo");
    }
    if !doc.symbol_export_type(&s.name).is_default() {
        return Some("il tipo di esportazione del simbolo");
    }
    if doc.symbol_nine_slice(&s.name).is_some() {
        return Some("la scala a 9 sezioni del simbolo");
    }
    None
}

/// Un'arte che si scrive figlio per figlio: un gruppo senza niente di suo.
fn gruppo_semplice(n: &Node) -> bool {
    matches!(n.kind, NodeKind::Group { clip: false, .. })
        && n.opacity >= 1.0
        && n.blend == BlendMode::Normal
        && n.appearance.items.is_empty()
        && n.extras().mask.is_none()
        && n.visible
}

/// Ha un'istanza dentro: il contenuto di un simbolo nuovo non la scrive.
fn ha_istanze(n: &Node) -> bool {
    let mut si = false;
    vectorcraft_doc::swatches::walk_with_masks(n, &mut |m| {
        si |= matches!(m.kind, NodeKind::SymbolInstance { .. });
    });
    si
}

/// I figli scritti del contenuto di un simbolo: l'arte portata da `scala`.
fn contenuto_scritto(
    arte: &Node,
    scala: Affine,
    stampo: &mut crate::espansa::Stampo,
    nuovo_id: &mut dyn FnMut(Specie) -> Result<String, String>,
) -> Result<Vec<String>, String> {
    if ha_istanze(arte) {
        return Err(
            "un simbolo che contiene istanze di altri simboli non si scrive ancora nel file".into(),
        );
    }
    let pezzi: Vec<&Node> = match (gruppo_semplice(arte), arte.children()) {
        (true, Some(figli)) => figli.iter().map(Arc::as_ref).collect(),
        _ => vec![arte],
    };
    let mut fuori = Vec::new();
    for pezzo in pezzi {
        let id = nuovo_id(Specie::Oggetto)?;
        if let Some(raw) = stampo.corpo(pezzo, scala, &id, nuovo_id)? {
            fuori.push(raw);
        }
    }
    if fuori.is_empty() {
        return Err("il simbolo non disegna niente".into());
    }
    Ok(fuori)
}

/// Le operazioni sui simboli del file fra `prima` e `dopo`. I simboli del
/// motore si legano a quelli del file per nome; uno che cambia nome tiene
/// la sua arte (lo stesso `Arc`).
pub(crate) fn operazioni(
    file: &Simboli,
    prima: &Document,
    dopo: &Document,
    stampo: &mut Option<crate::espansa::Stampo>,
    nuovo_id: &mut dyn FnMut(Specie) -> Result<String, String>,
) -> Result<ScritturaDeiSimboli, String> {
    let mut fuori = ScritturaDeiSimboli::default();
    let di_prima = |nome: &str| prima.symbols.iter().find(|s| s.name == nome);
    let mut legati: HashSet<&str> = HashSet::new();
    for s in &file.elenco {
        let Some(vecchio) = di_prima(&s.nome) else {
            continue;
        };
        let nuovo = dopo.symbols.iter().find(|x| x.name == s.nome).or_else(|| {
            dopo.symbols
                .iter()
                .find(|x| Arc::ptr_eq(&x.art, &vecchio.art) && di_prima(&x.name).is_none())
        });
        let Some(nuovo) = nuovo else {
            fuori.tolti.push(json!({ "op": "remove", "target": s.id }));
            continue;
        };
        legati.insert(nuovo.name.as_str());
        fuori.ids.insert(nuovo.name.clone(), s.id.clone());
        if let Some(motivo) = opzioni_fuori_formato(dopo, nuovo) {
            if opzioni_fuori_formato(prima, vecchio) != Some(motivo) {
                return Err(format!("{motivo} non si scrive nel file"));
            }
        }
        if nuovo.name != s.nome {
            if let Some(t) = &s.bersaglio_titolo {
                fuori.cambi.push(json!({ "op": "remove", "target": t }));
            }
            fuori.cambi.push(json!({
                "op": "add", "parent": s.id, "pos": { "first": true },
                "elem": { "tag": "title", "attrs": {}, "text": nuovo.name },
            }));
        }
        if !Arc::ptr_eq(&nuovo.art, &vecchio.art) && nuovo.art != vecchio.art {
            let stampo = stampo.get_or_insert_with(|| crate::espansa::Stampo::di(dopo));
            // L'arte ridefinita è normalizzata con la sua misura: il file la
            // tiene alla misura vera, e ogni istanza si riscrive con
            // l'inversa.
            let scala = scala_naturale(dopo, &nuovo.name);
            let raw = contenuto_scritto(&nuovo.art, scala, stampo, nuovo_id)?;
            if scala != Affine::IDENTITY {
                fuori.scale.insert(nuovo.name.clone(), scala);
            }
            for t in s.contenuto.iter().rev() {
                fuori.cambi.push(json!({ "op": "remove", "target": t }));
            }
            for r in raw {
                fuori.cambi.push(
                    json!({ "op": "add", "parent": s.id, "pos": { "last": true }, "raw": r }),
                );
            }
        }
    }
    for s in &dopo.symbols {
        if legati.contains(s.name.as_str()) || di_prima(&s.name).is_some() {
            continue;
        }
        if let Some(motivo) = opzioni_fuori_formato(dopo, s) {
            return Err(format!("{motivo} non si scrive nel file"));
        }
        let stampo = stampo.get_or_insert_with(|| crate::espansa::Stampo::di(dopo));
        let scala = scala_naturale(dopo, &s.name);
        let contenuto = contenuto_scritto(&s.art, scala, stampo, nuovo_id)?;
        let id = nuovo_id(Specie::Risorsa)?;
        // Il simbolo sta nella `fub-defs`, figlia della radice: il suo
        // contenuto va a capo, rientrato di due spazi come quello di un
        // gruppo (`docs/reference/scene-format-symbols.md`, §7).
        let mut righe = vec![format!("<title>{}</title>", fub_abi::html::escape(&s.name))];
        righe.extend(contenuto);
        fuori.nuovi.push(format!(
            "<symbol id=\"{id}\" overflow=\"visible\">\n      {}\n    </symbol>",
            righe.join("\n      ")
        ));
        if scala != Affine::IDENTITY {
            fuori.scale.insert(s.name.clone(), scala);
        }
        fuori.ids.insert(s.name.clone(), id);
    }
    for simbolo in &dopo.symbols {
        fuori
            .riusi
            .insert(simbolo.name.clone(), Riuso::di(dopo, &simbolo.art));
    }
    Ok(fuori)
}
