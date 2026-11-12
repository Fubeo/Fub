//! Ciò che il motore non sa modificare: una parte per elemento della mappa,
//! con il tipo e una frase breve in italiano che l'interfaccia mostra.
//!
//! - **`unmapped`**: il motore non ha un oggetto per l'elemento (una risorsa
//!   dentro `<defs>`, un'istanza `<use>` che il motore scioglie, un elemento
//!   che l'import lascia fuori). Ogni elemento non mappato ha la sua parte, e
//!   nessun'altra parte è `unmapped`.
//! - **`approximated`**: l'oggetto c'è, ma qualcosa dell'elemento non torna
//!   uguale all'export del motore: un filtro, una maschera, un testo su
//!   tracciato. L'elemento si può soltanto spostare, ruotare o ridimensionare
//!   (un `set` della sola `transform`): ogni altro cambio è rifiutato
//!   ([`controlla`]).
//! - **`unsupported`**: il documento intero non si modifica (sola lettura, non
//!   è un disegno di Fub, il motore non lo apre); la parte si chiama `svg`.
//!
//! Gli elementi estranei della scena (quelli che `fub_scene` non classifica:
//! `<style>`, `<foreignObject>`, gli elementi di altre app) non sono nella
//! mappa e non sono parti: nessuno strumento di Fub li modifica, e un gesto
//! su un oggetto del motore che viene da loro non torna nella mappa ed è
//! rifiutato `unmapped` dalla differenza.
//!
//! Una parte resta com'è nel file: nessuna operazione la cambia oltre quanto
//! [`controlla`] lascia passare. L'elenco del corpus e dei modelli sta in
//! `tests/corpus/perdite.tsv`, riscritto da
//! `UPDATE_PERDITE=1 cargo test -p fub-disegno --test corpus`.

use std::collections::{HashMap, HashSet};

use fub_abi::{DrawingLoss, DrawingLossKind, MAX_DRAWING_LOSSES};
use fub_scene::Item;
use serde_json::Value;

use crate::apertura::{attributi, valore, Attributo};
use crate::mappa::Mappa;

/// Le parti raccolte, al più [`MAX_DRAWING_LOSSES`]: oltre si contano soltanto.
#[derive(Clone, Debug, Default)]
pub struct Perdite {
    voci: Vec<DrawingLoss>,
    oltre: usize,
}

impl Perdite {
    /// Nessuna parte.
    pub fn nuove() -> Self {
        Self::default()
    }

    /// Una parte di `kind` sull'elemento `element` (l'id, o il tag e il
    /// percorso per un elemento senza id), con il motivo.
    pub fn aggiungi(
        &mut self,
        element: impl Into<String>,
        kind: DrawingLossKind,
        detail: impl Into<String>,
    ) {
        if self.voci.len() >= MAX_DRAWING_LOSSES {
            self.oltre += 1;
            return;
        }
        let mut element = element.into();
        if element.is_empty() {
            element.push_str("svg");
        }
        self.voci.push(DrawingLoss {
            element,
            kind,
            detail: detail.into(),
        });
    }

    /// Un elemento che non torna nella mappa del motore.
    pub fn non_mappato(&mut self, element: impl Into<String>, detail: impl Into<String>) {
        self.aggiungi(element, DrawingLossKind::Unmapped, detail);
    }

    /// Un elemento che il motore disegna, ma non come il file.
    pub fn approssimato(&mut self, element: impl Into<String>, detail: impl Into<String>) {
        self.aggiungi(element, DrawingLossKind::Approximated, detail);
    }

    /// Le parti raccolte.
    pub fn voci(&self) -> &[DrawingLoss] {
        &self.voci
    }

    /// Quante parti sono rimaste fuori dall'elenco perché era pieno.
    pub fn oltre(&self) -> usize {
        self.oltre
    }

    /// Quante parti in tutto, comprese quelle oltre il tetto.
    pub fn quante(&self) -> usize {
        self.voci.len() + self.oltre
    }

    /// L'elenco da mandare.
    pub fn in_elenco(self) -> Vec<DrawingLoss> {
        self.voci
    }
}

/// Il nome di un elemento in una parte: il suo id, o il tag con il percorso
/// (`rect[2/0]`) se non ne ha.
pub fn nome(id: Option<&str>, tag: &str, percorso: &[usize]) -> String {
    match id {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let passi: Vec<String> = percorso.iter().map(usize::to_string).collect();
            format!("{tag}[{}]", passi.join("/"))
        }
    }
}

// ---------------------------------------------------------------------------
// La classificazione
// ---------------------------------------------------------------------------

/// Classifica gli elementi della mappa dopo l'import: una parte `unmapped`
/// per ogni elemento senza oggetto, una `approximated` per ogni elemento
/// mappato che porta qualcosa che il motore non riscrive uguale. `testo` e
/// `items` sono quelli da cui viene la mappa: gli attributi si leggono dal
/// testo del file, non dalla copia per l'import.
pub(crate) fn classifica(perdite: &mut Perdite, testo: &str, items: &[Item], mappa: &Mappa) {
    let mut span: HashMap<&[usize], [usize; 2]> = HashMap::new();
    for item in items {
        if let Item::Element(e) = item {
            span.insert(e.path.as_slice(), e.span.bytes);
        }
    }
    for e in mappa.elementi() {
        let nome = nome(e.id.as_deref(), e.tag, &e.percorso);
        if e.nodo.is_none() {
            perdite.non_mappato(
                nome,
                e.motivo.unwrap_or("il motore non ne fa un oggetto suo"),
            );
            continue;
        }
        let Some(&[da, a]) = span.get(e.percorso.as_slice()) else {
            continue;
        };
        let attr = attributi(testo, da).map(|(_, a)| a).unwrap_or_default();
        let corpo = testo.get(da..a).unwrap_or_default();
        if let Some(motivo) = approssimazione(e.tag, &attr, corpo) {
            perdite.approssimato(nome, motivo);
        }
    }
}

/// Perché il motore non riscrive uguale l'elemento `tag` con gli attributi
/// `attr` e il testo `corpo` (dal tag di apertura a quello di chiusura);
/// `None` se lo riscrive.
fn approssimazione(tag: &str, attr: &[Attributo], corpo: &str) -> Option<&'static str> {
    let stile = valore(attr, "style").unwrap_or_default();
    let usa =
        |nome: &str| valore(attr, nome).is_some_and(|v| !nessuno(v)) || dichiara(stile, nome);
    if usa("filter") {
        return Some(
            "un filtro: il motore lo rende con un suo effetto, non uguale; si può solo spostare",
        );
    }
    if usa("mask") {
        return Some("una maschera: il motore la approssima; si può solo spostare");
    }
    if tag == "text" && corpo.contains("<textPath") {
        return Some("un testo su tracciato: il motore lo approssima; si può solo spostare");
    }
    None
}

/// Vero per un valore che spegne la proprietà (`none`, vuoto).
fn nessuno(v: &str) -> bool {
    let v = v.trim();
    v.is_empty() || v.eq_ignore_ascii_case("none")
}

/// Vero se lo `style` dichiara la proprietà `nome` con un valore che non è
/// `none`.
fn dichiara(stile: &str, nome: &str) -> bool {
    stile.split(';').any(|d| {
        d.split_once(':').is_some_and(|(p, v)| {
            p.trim().eq_ignore_ascii_case(nome)
                && !nessuno(v.trim().trim_end_matches("!important"))
        })
    })
}

// ---------------------------------------------------------------------------
// Il rifiuto dei gesti
// ---------------------------------------------------------------------------

/// Controlla che le operazioni `ops` di un gesto non cambino una parte
/// `unmapped` o `approximated` di `perdite` se non con un `set` della sola
/// `transform`: un `set` di altri attributi, un `remove`, un `move` della
/// parte o dentro la parte, un `add` dentro la parte sono rifiutati. L'errore
/// è la frase del rifiuto, che la differenza manda come `unmapped`.
///
/// Le operazioni nominano gli elementi con l'id del file, con l'id dato da un
/// `ident` dello stesso gesto o con `{path, tag}`: tutti e tre tornano al nome
/// della parte ([`nome`]).
pub(crate) fn controlla(perdite: &[DrawingLoss], ops: &[Value]) -> Result<(), String> {
    if ops.is_empty() || perdite.is_empty() {
        return Ok(());
    }
    let mut ident: HashMap<String, String> = HashMap::new();
    let mut tocchi: Vec<(String, Tocco)> = Vec::new();
    raccogli(ops, &mut ident, &mut tocchi);
    tocchi.retain(|(_, t)| *t != Tocco::SoloTransform);
    if tocchi.is_empty() {
        return Ok(());
    }
    let nominati: HashSet<&str> = tocchi.iter().map(|(n, _)| n.as_str()).collect();
    // Un passo solo sull'elenco, che può essere lungo: i tocchi sono pochi.
    let delicate: HashMap<&str, &DrawingLoss> = perdite
        .iter()
        .filter(|p| {
            matches!(
                p.kind,
                DrawingLossKind::Unmapped | DrawingLossKind::Approximated
            ) && nominati.contains(p.element.as_str())
        })
        .map(|p| (p.element.as_str(), p))
        .collect();
    for (nome, tocco) in &tocchi {
        let Some(parte) = delicate.get(nome.as_str()) else {
            continue;
        };
        let cosa = match tocco {
            Tocco::SoloTransform => continue,
            Tocco::Attributi => "cambierebbe",
            Tocco::Tolto => "toglierebbe",
            Tocco::Spostato => "sposterebbe nell'ordine",
            Tocco::Contenuto => "cambierebbe il contenuto di",
        };
        return Err(format!(
            "il gesto {cosa} «{nome}», che il motore non sa modificare ({})",
            parte.detail
        ));
    }
    Ok(())
}

/// Come un'operazione tocca un elemento.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tocco {
    /// Un `set` della sola `transform`: l'unico che una parte ammette.
    SoloTransform,
    /// Un `set` di altri attributi.
    Attributi,
    Tolto,
    Spostato,
    /// Un figlio entra nell'elemento.
    Contenuto,
}

/// Gli elementi che `ops` tocca, per nome di parte, e come.
fn raccogli(
    ops: &[Value],
    ident: &mut HashMap<String, String>,
    tocchi: &mut Vec<(String, Tocco)>,
) {
    // Gli `ident` prima, perché gli id nuovi valgano in tutto il gesto.
    for op in ops {
        if op["op"] == "ident" {
            if let (Some(id), Some(tag), Some(percorso)) =
                (op["id"].as_str(), op["tag"].as_str(), percorso(&op["path"]))
            {
                ident.insert(id.to_string(), nome(None, tag, &percorso));
            }
        }
    }
    for op in ops {
        let mut tocca = |v: &Value, t: Tocco| {
            if let Some(n) = bersaglio(ident, v) {
                tocchi.push((n, t));
            }
        };
        match op["op"].as_str() {
            Some("set") => {
                let solo_transform = op["attrs"]
                    .as_object()
                    .is_some_and(|a| a.len() == 1 && a.contains_key("transform"));
                let t = if solo_transform {
                    Tocco::SoloTransform
                } else {
                    Tocco::Attributi
                };
                tocca(&op["id"], t);
            }
            Some("remove") => tocca(&op["target"], Tocco::Tolto),
            Some("move") => {
                tocca(&op["target"], Tocco::Spostato);
                tocca(&op["parent"], Tocco::Contenuto);
            }
            Some("add") => tocca(&op["parent"], Tocco::Contenuto),
            Some("batch") => {
                if let Some(dentro) = op["ops"].as_array() {
                    raccogli(dentro, ident, tocchi);
                }
            }
            _ => {}
        }
    }
}

/// Il nome di parte dell'elemento che un'operazione nomina; `None` per la
/// radice.
fn bersaglio(ident: &HashMap<String, String>, v: &Value) -> Option<String> {
    match v {
        Value::String(id) if id == "#root" => None,
        Value::String(id) => Some(ident.get(id).cloned().unwrap_or_else(|| id.clone())),
        Value::Object(o) => {
            let tag = o.get("tag")?.as_str()?;
            Some(nome(None, tag, &percorso(o.get("path")?)?))
        }
        _ => None,
    }
}

fn percorso(v: &Value) -> Option<Vec<usize>> {
    v.as_array()?
        .iter()
        .map(|p| p.as_u64().and_then(|p| usize::try_from(p).ok()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nome_con_e_senza_id() {
        assert_eq!(nome(Some("oa"), "rect", &[2, 0]), "oa");
        assert_eq!(nome(None, "rect", &[2, 0]), "rect[2/0]");
        assert_eq!(nome(Some(""), "g", &[]), "g[]");
    }

    #[test]
    fn tetto() {
        let mut p = Perdite::nuove();
        for _ in 0..MAX_DRAWING_LOSSES + 3 {
            p.non_mappato("x", "prova");
        }
        assert_eq!(p.voci().len(), MAX_DRAWING_LOSSES);
        assert_eq!(p.oltre(), 3);
        assert_eq!(p.quante(), MAX_DRAWING_LOSSES + 3);
    }

    fn approssima(tag_aperto: &str) -> Option<&'static str> {
        let attr = attributi(tag_aperto, 0).expect("tag").1;
        let tag = tag_aperto[1..]
            .split(|c: char| c.is_whitespace() || c == '>')
            .next()
            .unwrap_or_default();
        approssimazione(tag, &attr, tag_aperto)
    }

    #[test]
    fn che_cosa_si_approssima() {
        assert!(approssima("<rect filter=\"url(#f)\"/>").is_some_and(|m| m.contains("filtro")));
        assert!(approssima("<rect style=\"fill:red; filter : blur(2px)\"/>").is_some());
        assert!(approssima("<g mask=\"url(#m)\">").is_some_and(|m| m.contains("maschera")));
        assert!(approssima("<text x=\"1\"><textPath href=\"#p\">a</textPath></text>")
            .is_some_and(|m| m.contains("tracciato")));
        assert_eq!(approssima("<rect filter=\"none\" mask=\" \"/>"), None);
        assert_eq!(approssima("<rect style=\"filter: none !important\"/>"), None);
        assert_eq!(approssima("<rect style=\"fill:url(#filter)\"/>"), None);
        assert_eq!(approssima("<text>filter</text>"), None);
    }

    fn parti() -> Vec<DrawingLoss> {
        let p = |element: &str, kind| DrawingLoss {
            element: element.into(),
            kind,
            detail: "un filtro".into(),
        };
        vec![
            p("svg", DrawingLossKind::Unsupported),
            p("filtrato", DrawingLossKind::Approximated),
            p("rect[2/0]", DrawingLossKind::Approximated),
            p("risorsa", DrawingLossKind::Unmapped),
        ]
    }

    #[test]
    fn una_parte_si_puo_solo_spostare() {
        let parti = parti();
        let ok = |ops: Value| controlla(&parti, ops.as_array().expect("lista"));
        // La sola `transform`: passa, anche con un id dato da `ident`.
        assert_eq!(
            ok(json!([{ "op": "set", "id": "filtrato", "attrs": { "transform": "matrix(1 0 0 1 5 0)" } }])),
            Ok(())
        );
        assert_eq!(
            ok(json!([{ "op": "batch", "ops": [
                { "op": "ident", "path": [2, 0], "tag": "rect", "id": "onuovo01" },
                { "op": "set", "id": "onuovo01", "attrs": { "transform": "matrix(1 0 0 1 5 0)" } }
            ]}])),
            Ok(())
        );
        // Ogni altro cambio: rifiutato, con il motivo della parte.
        let e = ok(json!([{ "op": "set", "id": "filtrato", "attrs": { "fill": "#ff0000" } }]))
            .expect_err("un fill");
        assert!(e.contains("«filtrato»") && e.contains("un filtro"), "{e}");
        assert!(ok(json!([{ "op": "set", "id": "filtrato", "attrs": { "transform": "matrix(2 0 0 2 0 0)", "fill": "#000000" } }])).is_err());
        assert!(ok(json!([{ "op": "batch", "ops": [
            { "op": "ident", "path": [2, 0], "tag": "rect", "id": "onuovo01" },
            { "op": "set", "id": "onuovo01", "attrs": { "fill": "#000000" } }
        ]}]))
        .is_err());
        assert!(ok(json!([{ "op": "remove", "target": { "path": [2, 0], "tag": "rect" } }])).is_err());
        assert!(ok(json!([{ "op": "remove", "target": "risorsa" }])).is_err());
        assert!(ok(json!([{ "op": "move", "target": "filtrato", "parent": "#root", "pos": { "first": true } }])).is_err());
        assert!(ok(json!([{ "op": "move", "target": "altro", "parent": "filtrato", "pos": { "first": true } }])).is_err());
        assert!(ok(json!([{ "op": "add", "parent": "filtrato", "pos": { "last": true }, "elem": { "tag": "rect", "attrs": {} } }])).is_err());
        // Gli altri elementi, la radice e il documento non sono parti delicate.
        assert_eq!(
            ok(json!([
                { "op": "set", "id": "altro", "attrs": { "fill": "#000000" } },
                { "op": "add", "parent": "#root", "pos": { "after": "filtrato" }, "elem": { "tag": "rect", "attrs": {} } },
                { "op": "set", "id": "svg", "attrs": { "fill": "#000000" } }
            ])),
            Ok(())
        );
        assert_eq!(controlla(&[], &[json!({ "op": "remove", "target": "x" })]), Ok(()));
    }
}
