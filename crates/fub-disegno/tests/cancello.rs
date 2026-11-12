//! Il cancello del disegno (piano K5, T20): ogni disegno del corpus si apre
//! nel motore, si modifica con tre gesti e si salva senza perdite visibili.
//!
//! Le prove sono `#[ignore]` e lavorano in una cartella data da
//! `FUB_DISEGNO_CANCELLO`; senza la variabile non fanno niente. Le lancia in
//! fila `node tools/disegno-cancello/cancello.mjs`, che le alterna con
//! `apps/client/src/editors/spatial/motore/cancello.test.ts`: il motore scrive
//! le operazioni, il client le applica col motore della scena, e il motore
//! confronta le immagini. Il giro e le differenze ammesse stanno in
//! `tools/disegno-cancello/README.md`.
//!
//! - [`scrivi`] mette in `elenco.json` i file del corpus e, per ogni file di
//!   cui il client ha già scritto `<file>.prima.svg`, i tre gesti
//!   (`<file>.sposta.json`, `<file>.rettangolo.json`, `<file>.colore.json`);
//!   quando c'è `<file>.sposta.svg`, anche `<file>.ritorno.json`. Ogni passo
//!   fa solo ciò che manca, quindi si ripete finché il giro è chiuso.
//! - [`confronta`] disegna prima e dopo con l'oracolo a pixel
//!   (`fub_testkit::pixel`, con le facce di `crates/fub-features/fonts/`) e
//!   scrive `tabella.tsv`; fallisce se un file non passa.
//! - [`caratteri`] dice da dove vengono le facce di un testo con una
//!   famiglia che Fub non ha.
//! - [`latenze`] misura anteprima, commit e reimport (A8 del piano).

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use fub_abi::{
    DrawingChange, DrawingCommandRequest, DrawingGesture, DrawingOutcome, DrawingRefusal,
    DrawingSync, DRAWING_COMMAND_STROKE_COLOR,
};
use fub_disegno::motore::{Disegni, Disegno};
use fub_motori::{Caratteri, Config, Generiche, Servizi, Tetto};
use fub_scene::{ElementItem, Item, Role, Scene};
use fub_testkit::pixel::{confronta as confronta_pixel, disegna, Immagine, Opzioni};
use serde_json::{json, Value};
use vectorcraft_doc::Scaling;
use vectorcraft_geom::Affine;

/// La variabile con la cartella del cancello.
const AMBIENTE: &str = "FUB_DISEGNO_CANCELLO";

/// Le cartelle del corpus, dalla radice del repository.
const CARTELLE: [&str; 3] = [
    "crates/fub-scene/tests/corpus",
    "crates/fub-features/templates",
    "apps/client/src/__fixtures__/scene",
];

/// Lo spostamento dell'andata, nelle unità del documento del motore.
const SPOSTA: (f64, f64) = (7.0, 5.0);

/// Le coppie di andata e ritorno: lo spostamento del primo elemento mappato,
/// e quello degli elementi di [`ANCHE_SPOSTATI`].
const COPPIE: [(&str, &str); 2] = [("sposta", "ritorno"), ("sposta2", "ritorno2")];

/// Gli elementi che si spostano e si riportano anche se non sono i primi,
/// perché il motore li legge in modo particolare: `(file, id, perché)`. Al
/// più uno per file (il gesto `sposta2`).
const ANCHE_SPOSTATI: [(&str, &str, &str); 1] = [(
    "resources",
    "o00000002",
    "pieno con una gradazione radiale `spreadMethod=\"reflect\"`, che le perdite non dicono approssimata",
)];

/// I due colori del tratto: il secondo se il primo è già quello.
const COLORI: [&str; 2] = ["#0072b2", "#d55e00"];

/// La larghezza delle immagini dell'oracolo, in pixel.
const LARGHEZZA: u32 = 1000;

/// Un pixel è diverso se un canale cambia più di tanto (su 255): toglie il
/// rumore dell'antialiasing, come la soglia di `fub_testkit::pixel`.
const SOGLIA: u8 = 8;

/// I pixel diversi fuori dalla zona toccata, al più: lo 0,2% del banco di
/// fedeltà del client.
const TETTO: f64 = 0.002;

/// Di quanti pixel si allarga la zona toccata, per il bordo sfumato.
const MARGINE: u32 = 3;

// ---------------------------------------------------------------------------
// La cartella, il corpus, il motore
// ---------------------------------------------------------------------------

/// La cartella del cancello, o `None` (e lo si dice) se la variabile manca.
fn cartella() -> Option<PathBuf> {
    match std::env::var_os(AMBIENTE) {
        Some(dir) if !dir.is_empty() => {
            let dir = PathBuf::from(dir);
            std::fs::create_dir_all(&dir).expect("creo la cartella del cancello");
            Some(dir)
        }
        _ => {
            eprintln!("{AMBIENTE} non c'è: il cancello non gira");
            None
        }
    }
}

/// Un file del corpus: il nome nella cartella del cancello e il percorso dalla
/// radice del repository.
struct File {
    nome: String,
    percorso: String,
}

fn corpus() -> Vec<File> {
    let radice = common::radice();
    let mut file = Vec::new();
    for dir in CARTELLE {
        for e in std::fs::read_dir(radice.join(dir)).expect("la cartella c'è") {
            let p = e.expect("voce").path();
            if p.extension().is_some_and(|e| e == "svg") {
                let nome = p.file_stem().expect("nome").to_string_lossy().into_owned();
                let base = p.file_name().expect("nome").to_string_lossy();
                file.push(File {
                    nome,
                    percorso: format!("{dir}/{base}"),
                });
            }
        }
    }
    file.sort_by(|a, b| a.percorso.cmp(&b.percorso));
    let mut nomi: Vec<&str> = file.iter().map(|f| f.nome.as_str()).collect();
    nomi.sort_unstable();
    nomi.dedup();
    assert_eq!(
        nomi.len(),
        file.len(),
        "due file del corpus con lo stesso nome"
    );
    file
}

/// Le facce di Fub, nell'ordine dell'oracolo: la prima è la famiglia delle
/// generiche.
fn facce() -> Vec<&'static [u8]> {
    vec![
        include_bytes!("../../fub-features/fonts/inter-400.ttf"),
        include_bytes!("../../fub-features/fonts/inter-700.ttf"),
        include_bytes!("../../fub-features/fonts/inter-italic-400.ttf"),
        include_bytes!("../../fub-features/fonts/inter-italic-700.ttf"),
        include_bytes!("../../fub-features/fonts/literata-400.ttf"),
        include_bytes!("../../fub-features/fonts/literata-700.ttf"),
        include_bytes!("../../fub-features/fonts/literata-italic-400.ttf"),
        include_bytes!("../../fub-features/fonts/literata-italic-700.ttf"),
        include_bytes!("../../fub-features/fonts/jetbrains-mono-400.ttf"),
        include_bytes!("../../fub-features/fonts/jetbrains-mono-700.ttf"),
        include_bytes!("../../fub-features/fonts/jetbrains-mono-italic-400.ttf"),
        include_bytes!("../../fub-features/fonts/jetbrains-mono-italic-700.ttf"),
    ]
}

/// Un motore del disegno coi caratteri di Fub, come lo costruisce l'host.
fn disegni() -> Arc<Disegni> {
    let servizi = Servizi::nuovi(Config {
        fili: Some(2),
        tetto: Tetto::fisso(512 * 1024 * 1024),
    });
    let generiche = Generiche {
        serif: "Literata".into(),
        sans: "Inter".into(),
        mono: "JetBrains Mono".into(),
    };
    servizi
        .fornisci_caratteri(Caratteri::nuovi(facce(), generiche))
        .unwrap_or_else(|_| panic!("i caratteri si danno una volta sola"));
    Disegni::nuovi(servizi)
}

fn leggi(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok()
}

fn scrivi_json(p: &Path, v: &Value) {
    let testo = serde_json::to_string_pretty(v).expect("JSON") + "\n";
    std::fs::write(p, testo).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
}

/// Il testo come lo tiene il client: a capo LF, senza BOM.
fn lf(testo: &str) -> String {
    testo
        .strip_prefix('\u{feff}')
        .unwrap_or(testo)
        .replace("\r\n", "\n")
}

fn rifiuto(r: DrawingRefusal) -> String {
    serde_json::to_value(r)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

fn elementi(scene: &Scene) -> impl Iterator<Item = &ElementItem> {
    scene.items.iter().filter_map(|i| match i {
        Item::Element(e) => Some(e.as_ref()),
        _ => None,
    })
}

/// Gli elementi che un gesto può prendere, in ordine di documento: non la
/// carta, i livelli, i titoli e le descrizioni; non bloccati né nascosti,
/// loro o un antenato (un livello bloccato), come li sceglie la Selezione.
fn candidati(scene: &Scene) -> Vec<&ElementItem> {
    let fermi: Vec<&[usize]> = elementi(scene)
        .filter(|e| e.locked || e.hidden)
        .map(|e| e.path.as_slice())
        .collect();
    elementi(scene)
        .filter(|e| !matches!(e.role, Role::Title | Role::Desc | Role::Layer | Role::Paper))
        .filter(|e| !fermi.iter().any(|f| e.path.starts_with(f)))
        .collect()
}

/// I rifiuti del motore ammessi, file per file, col perché: `(file, chi,
/// perché)`, dove `chi` è l'id di un elemento che l'andata non sposta o il
/// nome di un gesto rifiutato intero. Un rifiuto che non sta qui fa fallire
/// il cancello; uno ammesso non prova niente, e la tabella lo dice `salta`.
const RIFIUTI_AMMESSI: [(&str, &str, &str); 4] = [
    (
        "foreign",
        "strade",
        "un gruppo `inkscape:groupmode=\"layer\"` figlio della radice è un livello nel motore, e un livello non riceve una `transform`",
    ),
    (
        "inkscape",
        "layer1",
        "un gruppo `inkscape:groupmode=\"layer\"` figlio della radice è un livello nel motore, e un livello non riceve una `transform`",
    ),
    (
        "symbols",
        "rettangolo",
        "la copia del motore è vuota (0 elementi mappati su 19: il file prova apposta simboli che si richiamano in cerchio e `<use>` rotti), quindi il rettangolo non ha un livello dove andare",
    ),
    (
        "inkscape",
        "layer2",
        "un gruppo `inkscape:groupmode=\"layer\"` figlio della radice è un livello nel motore, e un livello non riceve una `transform`",
    ),
];

fn percorso_testo(p: &[usize]) -> String {
    format!(
        "[{}]",
        p.iter().map(usize::to_string).collect::<Vec<_>>().join(",")
    )
}

// ---------------------------------------------------------------------------
// I gesti
// ---------------------------------------------------------------------------

/// Il file di un gesto: l'esito, l'elemento toccato e le operazioni.
fn gesto_json(
    file: &str,
    gesto: &str,
    base: &str,
    elemento: Option<&ElementItem>,
    esito: Result<&DrawingOutcome, String>,
) -> Value {
    let mut v = json!({
        "file": file,
        "gesto": gesto,
        "base": base,
        "elemento": elemento.map(|e| json!({ "path": e.path, "id": e.id, "tag": e.tag })),
    });
    match esito {
        Err(perche) => {
            v["esito"] = json!("saltato");
            v["perche"] = json!(perche);
        }
        Ok(o) => {
            if let Some(r) = o.refused {
                v["esito"] = json!("rifiutato");
                v["perche"] = json!(rifiuto(r));
            } else {
                v["esito"] = json!("ops");
                v["ops"] = common::ops_di(o);
            }
        }
    }
    v
}

/// Sposta di `di` l'elemento in `percorso`, a mano sul documento del motore:
/// la differenza lo scrive come la scrive dopo ogni gesto. `None` se
/// l'elemento non è mappato.
fn sposta(disegno: &mut Disegno, percorso: &[usize], di: (f64, f64)) -> Option<DrawingOutcome> {
    let mut mappato = false;
    let esito = disegno
        .a_mano(|doc, trova| {
            let Some(nodo) = trova(percorso) else { return };
            let Some(n) = doc.node_mut(nodo) else { return };
            n.transform(Affine::translate(di), Scaling::from(true));
            mappato = true;
        })
        .unwrap_or_else(|e| panic!("il motore: {e}"));
    mappato.then_some(esito)
}

/// L'andata: sposta il primo elemento mappato fra i `candidati`; se il motore
/// lo rifiuta, lo scrive fra i `rifiutati` e prova il seguente, così il
/// ritorno si prova lo stesso.
fn andata(disegno: &mut Disegno, file: &str, base: &str, scene: &Scene) -> Value {
    let mut rifiutati = Vec::new();
    for e in candidati(scene) {
        let Some(esito) = sposta(disegno, &e.path, SPOSTA) else {
            continue;
        };
        if let Some(r) = esito.refused {
            rifiutati
                .push(json!({ "path": e.path, "id": e.id, "tag": e.tag, "perche": rifiuto(r) }));
            continue;
        }
        let mut v = gesto_json(file, "sposta", base, Some(e), Ok(&esito));
        v["rifiutati"] = json!(rifiutati);
        return v;
    }
    let perche = if rifiutati.is_empty() {
        "nessun elemento mappato da spostare".to_string()
    } else {
        "il motore rifiuta di spostare ogni elemento mappato".to_string()
    };
    let mut v = gesto_json(file, "sposta", base, None, Err(perche));
    if !rifiutati.is_empty() {
        v["esito"] = json!("rifiutato");
    }
    v["rifiutati"] = json!(rifiutati);
    v
}

/// Il riquadro del disegno nelle coordinate della scena: il `viewBox` della
/// radice, o il riquadro degli elementi, o un ripiego.
fn riquadro(testo: &str, scene: &Scene) -> [f64; 4] {
    let radice = scene.items.iter().find_map(|i| match i {
        Item::Root(r) => Some(&testo[r.span.bytes[0]..r.span.bytes[1]]),
        _ => None,
    });
    let tag = radice.map(|r| &r[..r.find('>').unwrap_or(r.len())]);
    if let Some(vb) = tag.and_then(|t| attributo(t, "viewBox")) {
        let n: Vec<f64> = vb
            .split([' ', ','])
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse().ok())
            .collect();
        if let [x, y, w, h] = n[..] {
            if w > 0.0 && h > 0.0 {
                return [x, y, w, h];
            }
        }
    }
    if let Some(b) = &scene.summary.bbox {
        if b.width > 0.0 && b.height > 0.0 {
            return [b.x, b.y, b.width, b.height];
        }
    }
    [0.0, 0.0, 300.0, 150.0]
}

/// Il valore di `nome` nel tag di apertura `tag`, se c'è.
fn attributo<'a>(tag: &'a str, nome: &str) -> Option<&'a str> {
    let mut resto = tag;
    while let Some(i) = resto.find(nome) {
        let prima = resto[..i].chars().last();
        let dopo = resto[i + nome.len()..].trim_start();
        if prima.is_some_and(char::is_whitespace) {
            if let Some(v) = dopo.strip_prefix('=') {
                let v = v.trim_start();
                let q = v.chars().next()?;
                if q == '"' || q == '\'' {
                    let v = &v[1..];
                    return v.find(q).map(|f| &v[..f]);
                }
            }
        }
        resto = &resto[i + nome.len()..];
    }
    None
}

fn evento(kind: &str, x: f64, y: f64, pressione: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": pressione, "shift": false, "alt": false, "cmd": false })
}

fn richiesta(
    tool: &str,
    revisione: u64,
    fase: &str,
    selezione: &[String],
    eventi: Vec<Value>,
) -> DrawingGesture {
    serde_json::from_value(json!({
        "revision": revisione.to_string(),
        "phase": fase,
        "tool": tool,
        "layer": null,
        "selection": selezione,
        "zoom": 1.0,
        "snap": { "grid": null, "free": false },
        "style": if tool == "select" { Value::Null } else { json!({ "stroke": "#d55e00", "width": 2, "fill": "#f0e442" }) },
        "events": eventi,
    }))
    .expect("il gesto si legge")
}

/// Un rettangolo nuovo al centro del disegno, un decimo del lato corto, con
/// lo strumento Rettangolo del motore.
fn rettangolo(disegno: &mut Disegno, testo: &str, scene: &Scene) -> DrawingOutcome {
    let [x, y, w, h] = riquadro(testo, scene);
    let lato = w.min(h) / 10.0;
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    let (x0, y0, x1, y1) = (
        cx - lato / 2.0,
        cy - lato / 2.0,
        cx + lato / 2.0,
        cy + lato / 2.0,
    );
    let eventi = vec![
        evento("down", x0, y0, 0.5),
        evento("drag", (x0 + x1) / 2.0, (y0 + y1) / 2.0, 0.5),
        evento("drag", x1, y1, 0.5),
        evento("up", x1, y1, 0.0),
    ];
    disegno
        .gesto(richiesta("rect", 0, "commit", &[], eventi))
        .unwrap_or_else(|e| panic!("il rettangolo: {e}"))
}

/// Il colore del tratto del primo elemento con un id che il comando sa
/// colorare.
fn colore(disegno: &mut Disegno, scene: &Scene) -> Result<(ElementItem, DrawingOutcome), String> {
    for e in candidati(scene) {
        let Some(id) = &e.id else { continue };
        let sel = vec![id.clone()];
        let acceso = disegno
            .comandi(&sel)
            .iter()
            .any(|c| c.id == DRAWING_COMMAND_STROKE_COLOR && c.enabled);
        if !acceso {
            continue;
        }
        let mut ultimo = None;
        for c in COLORI {
            let esito = disegno
                .comando(DrawingCommandRequest {
                    revision: 0,
                    id: DRAWING_COMMAND_STROKE_COLOR.into(),
                    selection: sel.clone(),
                    value: json!(c),
                })
                .map_err(|e| format!("il comando: {e}"))?;
            let vuoto = esito.refused == Some(DrawingRefusal::Empty);
            ultimo = Some(esito);
            if !vuoto {
                break;
            }
        }
        return Ok((e.clone(), ultimo.expect("almeno un colore")));
    }
    Err("nessun elemento con un id che il colore del tratto sappia colorare".into())
}

/// Il cancello, primo lato: l'elenco e i gesti che mancano.
#[test]
#[ignore = "il cancello: node tools/disegno-cancello/cancello.mjs"]
fn scrivi() {
    let Some(dir) = cartella() else { return };
    let file = corpus();
    let radice = common::radice().canonicalize().expect("la radice");
    let elenco: Vec<Value> = file
        .iter()
        .map(|f| json!({ "file": f.nome, "percorso": f.percorso, "sorgente": radice.join(&f.percorso) }))
        .collect();
    scrivi_json(&dir.join("elenco.json"), &json!(elenco));
    let disegni = disegni();
    for f in &file {
        let prima_nome = format!("{}.prima.svg", f.nome);
        let Some(prima) = leggi(&dir.join(&prima_nome)) else {
            continue;
        };
        let prima = lf(&prima);
        let scene = fub_scene::read(&prima).unwrap_or_else(|e| panic!("{}: {e}", f.nome));
        let p = |g: &str| dir.join(format!("{}.{g}.json", f.nome));
        if !p("sposta").exists() {
            let (mut disegno, aperto) = Disegno::apri_con(&disegni, &prima)
                .unwrap_or_else(|e| panic!("{}: il disegno non si apre: {e}", f.nome));
            // Ogni file di gesto dice anche che cosa il motore ha mappato.
            let conti = json!({ "mappati": aperto.mapped, "non_mappati": aperto.unmapped, "perdite": aperto.losses.len() });
            let scrivi_gesto = |g: &str, mut v: Value| {
                v["aperto"] = conti.clone();
                scrivi_json(&p(g), &v);
            };
            if !scene.editable() {
                let perche = format!("in sola lettura: {:?}", scene.read_only);
                for g in ["sposta", "rettangolo", "colore"] {
                    scrivi_gesto(
                        g,
                        gesto_json(&f.nome, g, &prima_nome, None, Err(perche.clone())),
                    );
                }
                continue;
            }
            scrivi_gesto("sposta", andata(&mut disegno, &f.nome, &prima_nome, &scene));
            for (_, id, _) in ANCHE_SPOSTATI.iter().filter(|(file, _, _)| *file == f.nome) {
                let e = elementi(&scene)
                    .find(|e| e.id.as_deref() == Some(*id))
                    .unwrap_or_else(|| panic!("{}: non c'è {id}", f.nome));
                let v = match sposta(&mut disegno, &e.path, SPOSTA) {
                    Some(esito) => gesto_json(&f.nome, "sposta2", &prima_nome, Some(e), Ok(&esito)),
                    None => gesto_json(
                        &f.nome,
                        "sposta2",
                        &prima_nome,
                        Some(e),
                        Err(format!("{id} non è mappato")),
                    ),
                };
                scrivi_gesto("sposta2", v);
            }
            let esito = rettangolo(&mut disegno, &prima, &scene);
            scrivi_gesto(
                "rettangolo",
                gesto_json(&f.nome, "rettangolo", &prima_nome, None, Ok(&esito)),
            );
            let v = match colore(&mut disegno, &scene) {
                Ok((e, esito)) => gesto_json(&f.nome, "colore", &prima_nome, Some(&e), Ok(&esito)),
                Err(perche) => gesto_json(&f.nome, "colore", &prima_nome, None, Err(perche)),
            };
            scrivi_gesto("colore", v);
        }
        // I ritorni, quando il client ha applicato le andate.
        for (andata_g, ritorno_g) in COPPIE {
            if p(ritorno_g).exists() {
                continue;
            }
            let andata_nome = format!("{}.{andata_g}.svg", f.nome);
            let Some(andata) = leggi(&dir.join(&andata_nome)) else {
                continue;
            };
            let andata_json = json_di(&p(andata_g)).expect("l'andata");
            let percorso = percorso_di(&andata_json["elemento"]);
            let andata = lf(&andata);
            let scena_andata =
                fub_scene::read(&andata).unwrap_or_else(|e| panic!("{}: {e}", f.nome));
            let (mut disegno, _) = Disegno::apri_con(&disegni, &andata)
                .unwrap_or_else(|e| panic!("{}: l'andata non si apre: {e}", f.nome));
            let e = elementi(&scena_andata).find(|e| e.path == percorso);
            let v = match sposta(&mut disegno, &percorso, (-SPOSTA.0, -SPOSTA.1)) {
                Some(esito) => gesto_json(&f.nome, ritorno_g, &andata_nome, e, Ok(&esito)),
                None => gesto_json(
                    &f.nome,
                    ritorno_g,
                    &andata_nome,
                    e,
                    Err("dopo l'andata l'elemento non è più mappato".into()),
                ),
            };
            scrivi_json(&p(ritorno_g), &v);
        }
    }
}

// ---------------------------------------------------------------------------
// Il confronto
// ---------------------------------------------------------------------------

fn immagine(svg: &str, facce: &[&[u8]]) -> Result<Immagine, String> {
    disegna(
        svg,
        &Opzioni {
            larghezza: LARGHEZZA,
            facce,
        },
    )
}

/// Dove si vede l'elemento `quale` nel testo: i pixel che cambiano se lo si
/// toglie, come `[x, y, larghezza, altezza]`; `None` se non si vede.
fn impronta(
    testo: &str,
    quale: &dyn Fn(&ElementItem) -> bool,
    facce: &[&[u8]],
) -> Option<[u32; 4]> {
    let scene = fub_scene::read(testo).ok()?;
    let e = elementi(&scene).find(|e| quale(e))?;
    let [a, b] = e.span.bytes;
    let senza = format!("{}{}", &testo[..a], &testo[b..]);
    let con = immagine(testo, facce).ok()?;
    let senza = immagine(&senza, facce).ok()?;
    confronta_pixel(&con, &senza, 0, None).ok()?.riquadro
}

/// L'unione di due zone, allargata di [`MARGINE`].
fn zona(a: Option<[u32; 4]>, b: Option<[u32; 4]>) -> Option<[u32; 4]> {
    let estremi = |r: [u32; 4]| [r[0], r[1], r[0] + r[2], r[1] + r[3]];
    let u = match (a.map(estremi), b.map(estremi)) {
        (Some(p), Some(q)) => [
            p[0].min(q[0]),
            p[1].min(q[1]),
            p[2].max(q[2]),
            p[3].max(q[3]),
        ],
        (Some(p), None) | (None, Some(p)) => p,
        (None, None) => return None,
    };
    let x = u[0].saturating_sub(MARGINE);
    let y = u[1].saturating_sub(MARGINE);
    Some([x, y, u[2] + MARGINE - x, u[3] + MARGINE - y])
}

/// I codici di §12 di un testo, contati.
fn codici(testo: &str) -> BTreeMap<String, usize> {
    let mut out = BTreeMap::new();
    if let Ok(scene) = fub_scene::read(testo) {
        for d in &scene.diagnostics {
            *out.entry(format!("{:?}", d.code)).or_default() += 1;
        }
    }
    out
}

/// I codici che dopo sono più di prima, come `S010 1→2`.
fn codici_in_piu(prima: &str, dopo: &str) -> Vec<String> {
    let (a, b) = (codici(prima), codici(dopo));
    b.iter()
        .filter(|(c, n)| **n > a.get(*c).copied().unwrap_or(0))
        .map(|(c, n)| format!("{c} {}→{n}", a.get(c).copied().unwrap_or(0)))
        .collect()
}

/// Come esce un gesto nella tabella.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Esito {
    Passa,
    NonPassa,
    /// Il gesto non si è fatto per una ragione scritta (sola lettura, niente
    /// da spostare o da colorare): non è una prova, e la tabella lo dice.
    Salta,
}

impl Esito {
    fn di(passa: bool) -> Esito {
        if passa {
            Esito::Passa
        } else {
            Esito::NonPassa
        }
    }

    fn testo(self) -> &'static str {
        match self {
            Esito::Passa => "ok",
            Esito::NonPassa => "NO",
            Esito::Salta => "salta",
        }
    }
}

/// L'esito di un gesto per la tabella.
struct Riga {
    gesto: &'static str,
    esito: Esito,
    nota: String,
}

impl Riga {
    fn no(gesto: &'static str, nota: impl Into<String>) -> Riga {
        Riga {
            gesto,
            esito: Esito::NonPassa,
            nota: nota.into(),
        }
    }
}

/// L'id del primo `add` delle operazioni.
fn id_aggiunto(ops: &Value) -> Option<String> {
    fn cerca(v: &Value) -> Option<String> {
        match v {
            Value::Array(a) => a.iter().find_map(cerca),
            Value::Object(o) => {
                if o.get("op").and_then(Value::as_str) == Some("add") {
                    if let Some(id) = o.get("elem").and_then(|e| e["attrs"]["id"].as_str()) {
                        return Some(id.to_string());
                    }
                }
                o.get("ops").and_then(cerca)
            }
            _ => None,
        }
    }
    cerca(ops)
}

fn json_di(p: &Path) -> Option<Value> {
    serde_json::from_str(&leggi(p)?).ok()
}

fn percorso_di(v: &Value) -> Vec<usize> {
    v["path"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|n| n.as_u64().map(|n| n as usize))
                .collect()
        })
        .unwrap_or_default()
}

/// L'elemento di un gesto, per la nota: l'id o il percorso.
fn nome_elemento(v: &Value) -> String {
    v["id"].as_str().map(str::to_string).unwrap_or_else(|| {
        format!(
            "{}{}",
            v["tag"].as_str().unwrap_or(""),
            percorso_testo(&percorso_di(v))
        )
    })
}

/// Il dopo di un gesto: `Ok((gesto, testo))` se il client l'ha scritto,
/// `Err(riga)` se il gesto non è arrivato fin lì.
fn dopo(dir: &Path, nome: &str, gesto: &'static str) -> Result<(Value, String), Riga> {
    let Some(g) = json_di(&dir.join(format!("{nome}.{gesto}.json"))) else {
        return Err(Riga::no(gesto, "manca il file del gesto"));
    };
    match g["esito"].as_str() {
        Some("saltato") => {
            return Err(Riga {
                gesto,
                esito: Esito::Salta,
                nota: g["perche"].as_str().unwrap_or("").to_string(),
            })
        }
        Some("rifiutato") => {
            let perche = g["perche"].as_str().unwrap_or("");
            let ammesso = RIFIUTI_AMMESSI
                .iter()
                .find(|(f, chi, _)| *f == nome && *chi == gesto)
                .map(|(_, _, p)| *p);
            return Err(match ammesso {
                Some(p) => Riga {
                    gesto,
                    esito: Esito::Salta,
                    nota: format!("rifiutato dal motore ({perche}), ammesso: {p}"),
                },
                None => Riga::no(gesto, format!("rifiutato dal motore: {perche}")),
            });
        }
        _ => {}
    }
    if let Some(r) = json_di(&dir.join(format!("{nome}.{gesto}.rifiuto.json"))) {
        return Err(Riga::no(
            gesto,
            format!(
                "il client rifiuta le operazioni: {} ({})",
                r["reason"].as_str().unwrap_or(""),
                r["detail"].as_str().unwrap_or("")
            ),
        ));
    }
    match leggi(&dir.join(format!("{nome}.{gesto}.svg"))) {
        Some(t) => Ok((g, t)),
        None => Err(Riga::no(gesto, "il client non ha scritto il dopo")),
    }
}

/// I rifiuti dell'andata: la nota, e se sono tutti ammessi.
fn rifiuti(nome: &str, g: &Value) -> (String, bool) {
    let mut note = Vec::new();
    let mut ammessi = true;
    for r in g["rifiutati"].as_array().into_iter().flatten() {
        let id = r["id"].as_str().unwrap_or("");
        let perche = RIFIUTI_AMMESSI
            .iter()
            .find(|(f, e, _)| *f == nome && *e == id)
            .map(|(_, _, p)| *p);
        ammessi &= perche.is_some();
        note.push(format!(
            "{} rifiutato ({}){}",
            nome_elemento(r),
            r["perche"].as_str().unwrap_or(""),
            perche.map_or(" e non ammesso".to_string(), |p| format!(", ammesso: {p}"))
        ));
    }
    (note.join("; "), ammessi)
}

/// Le immagini di prima, se l'oracolo le sa fare.
struct Prima<'a> {
    testo: String,
    immagine: Option<Immagine>,
    facce: &'a [&'a [u8]],
}

impl Prima<'_> {
    /// I pixel diversi da prima fuori da `zona`, o perché non si contano.
    fn diversi(
        &self,
        dopo: &str,
        zona: Option<[u32; 4]>,
    ) -> Result<fub_testkit::pixel::Confronto, String> {
        let prima = self
            .immagine
            .as_ref()
            .ok_or("l'oracolo non disegna il file")?;
        immagine(dopo, self.facce).and_then(|d| confronta_pixel(prima, &d, SOGLIA, zona))
    }
}

/// La riga dell'andata e del ritorno: dopo il ritorno niente di diverso.
fn riga_sposta(
    dir: &Path,
    nome: &str,
    prima: &Prima<'_>,
    (andata_g, ritorno_g): (&'static str, &'static str),
) -> Riga {
    let (g, andata) = match dopo(dir, nome, andata_g) {
        Ok(x) => x,
        Err(mut r) => {
            if let Some(g) = json_di(&dir.join(format!("{nome}.{andata_g}.json"))) {
                let (nota, ammessi) = rifiuti(nome, &g);
                if !nota.is_empty() {
                    r.nota = format!("{}; {nota}", r.nota);
                    if !ammessi {
                        r.esito = Esito::NonPassa;
                    } else if g["esito"] == "rifiutato" {
                        // Ogni elemento rifiutato, e ogni rifiuto ammesso.
                        r.esito = Esito::Salta;
                    }
                }
            }
            return r;
        }
    };
    let (nota_rifiuti, ammessi) = rifiuti(nome, &g);
    let elemento = nome_elemento(&g["elemento"]);
    let tornato = match dopo(dir, nome, ritorno_g) {
        Ok((_, t)) => t,
        Err(r) => return Riga::no(andata_g, format!("{elemento}: ritorno: {}", r.nota)),
    };
    let mut in_piu = codici_in_piu(&prima.testo, &andata);
    in_piu.extend(codici_in_piu(&prima.testo, &tornato));
    let mut note = vec![elemento];
    let mut passa = ammessi && in_piu.is_empty();
    match (prima.diversi(&andata, None), prima.diversi(&tornato, None)) {
        (Ok(a), Ok(t)) => {
            note.push(format!(
                "andata {} pixel cambiati, ritorno {} diversi",
                a.diversi, t.diversi
            ));
            passa &= t.diversi == 0;
        }
        (_, Err(e)) | (Err(e), _) => {
            note.push(format!("senza immagini ({e}): andata e ritorno applicati"))
        }
    }
    if !in_piu.is_empty() {
        note.push(format!("codici in più: {}", in_piu.join(", ")));
    }
    if !nota_rifiuti.is_empty() {
        note.push(nota_rifiuti);
    }
    Riga {
        gesto: andata_g,
        esito: Esito::di(passa),
        nota: note.join("; "),
    }
}

/// La riga del rettangolo o del colore: al più lo 0,2% fuori dalla zona
/// toccata, che si trova togliendo l'elemento toccato.
fn riga_tocco(dir: &Path, nome: &str, gesto: &'static str, prima: &Prima<'_>) -> Riga {
    let (g, testo) = match dopo(dir, nome, gesto) {
        Ok(x) => x,
        Err(r) => return r,
    };
    let in_piu = codici_in_piu(&prima.testo, &testo);
    let mut note = Vec::new();
    let mut passa = in_piu.is_empty();
    let zona = if gesto == "rettangolo" {
        let id = id_aggiunto(&g["ops"]);
        note.push(id.clone().unwrap_or_else(|| "nessun add".into()));
        let id = id.unwrap_or_default();
        zona(
            None,
            impronta(
                &testo,
                &|e| e.id.as_deref() == Some(id.as_str()),
                prima.facce,
            ),
        )
    } else {
        let percorso = percorso_di(&g["elemento"]);
        note.push(nome_elemento(&g["elemento"]));
        let quale = |e: &ElementItem| e.path == percorso;
        zona(
            impronta(&prima.testo, &quale, prima.facce),
            impronta(&testo, &quale, prima.facce),
        )
    };
    match prima.diversi(&testo, zona) {
        Ok(c) => {
            let quota = if c.totali == 0 {
                0.0
            } else {
                c.diversi as f64 / c.totali as f64
            };
            passa &= quota <= TETTO && zona.is_some();
            note.push(match zona {
                Some([_, _, w, h]) => {
                    format!("zona {w}×{h} px, {:.3}% diversi fuori", quota * 100.0)
                }
                None => "il gesto non si vede".into(),
            });
        }
        Err(e) => note.push(format!("senza immagini ({e}): applicato")),
    }
    if !in_piu.is_empty() {
        note.push(format!("codici in più: {}", in_piu.join(", ")));
    }
    Riga {
        gesto,
        esito: Esito::di(passa),
        nota: note.join("; "),
    }
}

/// Confronta un file: una riga per gesto.
fn confronta_file(dir: &Path, nome: &str, sorgente: &str, facce: &[&[u8]]) -> Vec<Riga> {
    let mut righe = Vec::new();
    let Some(testo) = leggi(&dir.join(format!("{nome}.prima.svg"))) else {
        righe.push(Riga::no("prima", "il client non ha scritto il prima"));
        return righe;
    };
    let prima = match immagine(&testo, facce) {
        Ok(i) => Prima {
            testo,
            immagine: Some(i),
            facce,
        },
        Err(e) => {
            // Un file che l'oracolo non disegna (un `<use>` che si ripete
            // oltre il tetto di `usvg`): i gesti si provano senza immagini.
            righe.push(Riga {
                gesto: "immagine",
                esito: Esito::Salta,
                nota: format!("l'oracolo non lo disegna: {e}"),
            });
            Prima {
                testo,
                immagine: None,
                facce,
            }
        }
    };
    // L'adozione («Modifica») non cambia ciò che si vede.
    if let Some(origine) = leggi(Path::new(sorgente)) {
        if origine != prima.testo {
            righe.push(match prima.diversi(&origine, None) {
                Ok(c) => Riga {
                    gesto: "adozione",
                    esito: Esito::di(c.diversi == 0),
                    nota: format!("{} pixel diversi", c.diversi),
                },
                Err(e) => Riga {
                    gesto: "adozione",
                    esito: Esito::Salta,
                    nota: e,
                },
            });
        }
    }
    righe.push(riga_sposta(dir, nome, &prima, COPPIE[0]));
    if let Some((_, _, perche)) = ANCHE_SPOSTATI.iter().find(|(f, _, _)| *f == nome) {
        let mut r = riga_sposta(dir, nome, &prima, COPPIE[1]);
        r.nota = format!("{}; {perche}", r.nota);
        righe.push(r);
    }
    righe.push(riga_tocco(dir, nome, "rettangolo", &prima));
    righe.push(riga_tocco(dir, nome, "colore", &prima));
    righe
}

/// Il cancello, secondo lato: le immagini prima e dopo, e la tabella.
#[test]
#[ignore = "il cancello: node tools/disegno-cancello/cancello.mjs"]
fn confronta() {
    let Some(dir) = cartella() else { return };
    let facce = facce();
    let elenco = json_di(&dir.join("elenco.json")).expect("elenco.json: prima `scrivi`");
    let mut tabella = String::from("file\tgesto\tesito\tnota\n");
    let mut falliti = Vec::new();
    for f in elenco.as_array().expect("un elenco") {
        let nome = f["file"].as_str().expect("il nome");
        let sorgente = f["sorgente"].as_str().unwrap_or("");
        for r in confronta_file(&dir, nome, sorgente, &facce) {
            if r.esito == Esito::NonPassa {
                falliti.push(format!("{nome} {}: {}", r.gesto, r.nota));
            }
            tabella.push_str(&format!(
                "{nome}\t{}\t{}\t{}\n",
                r.gesto,
                r.esito.testo(),
                r.nota.replace(['\t', '\n'], " ")
            ));
        }
    }
    std::fs::write(dir.join("tabella.tsv"), &tabella).expect("scrivo la tabella");
    assert!(
        falliti.is_empty(),
        "il cancello non passa:\n{}",
        falliti.join("\n")
    );
}

// ---------------------------------------------------------------------------
// I caratteri
// ---------------------------------------------------------------------------

/// I testi della prova: una famiglia che Fub non ha (quelle dei file di
/// mermaid, di Inkscape e una inventata) o una sua, con caratteri che le
/// facce di Fub hanno e caratteri che non hanno.
const TESTI: [(&str, &str); 7] = [
    ("trebuchet ms", "Ciao"),
    ("Verdana", "Ciao"),
    ("Famiglia che nessuno ha", "Ciao"),
    ("Inter", "Ciao"),
    ("Inter", "Ελληνικά Кириллица"),
    ("Inter", "漢字"),
    ("Inter", "🙂"),
];

/// Da dove vengono le facce che il motore usa per un testo: quelle di Fub,
/// date dai byte, o quelle del sistema, lette da un file. Se dal sistema, il
/// disegno e i colpi sui testi dipendono dalla macchina. Scrive
/// `caratteri.tsv` e non fallisce: è una misura.
#[test]
#[ignore = "il cancello: node tools/disegno-cancello/cancello.mjs"]
fn caratteri() {
    let Some(dir) = cartella() else { return };
    // Il motore nasce coi caratteri di Fub, che entrano nella `FontDb` del
    // processo.
    let (_d, _) = Disegno::apri_con(&disegni(), "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 10 10\"/>\n")
        .expect("si apre");
    let db = vectorcraft_text::FontDb::global();
    let mut testo = String::from("famiglia\ttesto\tfacce (famiglia: da dove)\n");
    for (famiglia, frase) in TESTI {
        let stile = vectorcraft_doc::CharStyle {
            font_family: famiglia.into(),
            size: 16.0,
            ..Default::default()
        };
        let oggetto =
            vectorcraft_doc::TextObject::point(vectorcraft_geom::Point::ZERO, frase, stile);
        let disposto = vectorcraft_text::layout(db, &oggetto);
        let mut facce: Vec<String> = disposto
            .glyphs
            .iter()
            .map(|g| match db.face_by_id(g.font_id) {
                Some(f) => format!(
                    "{}: {}",
                    f.family,
                    f.path()
                        .map_or("Fub".to_string(), |p| format!("sistema {}", p.display()))
                ),
                None => "?".into(),
            })
            .collect();
        facce.sort();
        facce.dedup();
        testo.push_str(&format!("{famiglia}\t{frase}\t{}\n", facce.join(", ")));
    }
    eprintln!("{testo}");
    std::fs::write(dir.join("caratteri.tsv"), testo).expect("scrivo caratteri.tsv");
}

// ---------------------------------------------------------------------------
// Le latenze (A8)
// ---------------------------------------------------------------------------

/// Il percentile `p` (da 0 a 1) di tempi già in ordine, in millisecondi.
fn percentile(ordinati: &[Duration], p: f64) -> f64 {
    if ordinati.is_empty() {
        return f64::NAN;
    }
    let i = ((ordinati.len() as f64 - 1.0) * p).round() as usize;
    ordinati[i].as_secs_f64() * 1000.0
}

fn riassunto(nome: &str, mut tempi: Vec<Duration>) -> Value {
    tempi.sort();
    let v = json!({
        "misura": nome,
        "campioni": tempi.len(),
        "p50_ms": percentile(&tempi, 0.5),
        "p95_ms": percentile(&tempi, 0.95),
        "max_ms": percentile(&tempi, 1.0),
    });
    eprintln!("{v}");
    v
}

/// Un disegno di circa `byte` byte: un livello di gruppi con un rettangolo,
/// un'ellisse e un testo ciascuno.
fn disegno_grande(byte: usize) -> String {
    let mut s = String::from("<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 4000 4000\" width=\"4000\" height=\"4000\">\n  <title>Grande</title>\n  <g id=\"lgrande1\" fub:layer=\"Livello 1\">\n");
    let mut i = 0usize;
    while s.len() < byte {
        let x = (i % 80) as f64 * 50.0;
        let y = (i / 80 % 80) as f64 * 50.0;
        s.push_str(&format!(
            "    <g id=\"g{i:07}\">\n      <rect id=\"r{i:07}\" x=\"{x}\" y=\"{y}\" width=\"40\" height=\"30\" fill=\"#e3f2fb\" stroke=\"#000000\" stroke-width=\"2\"/>\n      <ellipse id=\"e{i:07}\" cx=\"{}\" cy=\"{}\" rx=\"10\" ry=\"6\" fill=\"none\" stroke=\"#0072b2\" stroke-width=\"1\"/>\n      <path id=\"p{i:07}\" d=\"M{x} {} L{} {}\" fill=\"none\" stroke=\"#d55e00\" stroke-width=\"1\"/>\n    </g>\n",
            x + 20.0,
            y + 15.0,
            y + 30.0,
            x + 40.0,
            y + 30.0
        ));
        i += 1;
    }
    s.push_str("  </g>\n</svg>\n");
    s
}

/// Un trascinamento a pezzi: la pressione, `passi` anteprime di un evento
/// ciascuna, il rilascio. Dà i tempi delle anteprime e quello del commit.
fn trascina(
    disegno: &mut Disegno,
    tool: &str,
    revisione: u64,
    da: (f64, f64),
    di: (f64, f64),
    passi: usize,
) -> (Vec<Duration>, Duration, DrawingOutcome) {
    let mut anteprime = Vec::with_capacity(passi);
    let t = Instant::now();
    let esito = disegno
        .gesto(richiesta(
            tool,
            revisione,
            "preview",
            &[],
            vec![evento("down", da.0, da.1, 0.5)],
        ))
        .expect("la pressione");
    anteprime.push(t.elapsed());
    assert_eq!(esito.refused, None, "{tool}: la pressione è rifiutata");
    for k in 1..=passi {
        let f = k as f64 / passi as f64;
        let (x, y) = (da.0 + di.0 * f, da.1 + di.1 * f);
        let t = Instant::now();
        let esito = disegno
            .gesto(richiesta(
                tool,
                revisione,
                "preview",
                &[],
                vec![evento("drag", x, y, 0.5)],
            ))
            .expect("l'anteprima");
        anteprime.push(t.elapsed());
        assert_eq!(esito.refused, None, "{tool}: un'anteprima è rifiutata");
    }
    let (x, y) = (da.0 + di.0, da.1 + di.1);
    let t = Instant::now();
    let esito = disegno
        .gesto(richiesta(
            tool,
            revisione,
            "commit",
            &[],
            vec![evento("up", x, y, 0.0)],
        ))
        .expect("il commit");
    (anteprime, t.elapsed(), esito)
}

/// Le latenze del motore, senza IPC: anteprima e commit di uno spostamento e
/// di un rettangolo su `concept-map`, anteprima e commit di uno spostamento e
/// reimport su un disegno di 1 MiB. Va lanciata con `--release`; scrive
/// `latenze.json`.
#[test]
#[ignore = "le latenze di A8: cargo test --release -p fub-disegno --test cancello -- --ignored latenze"]
fn latenze() {
    let Some(dir) = cartella() else { return };
    let ripetizioni: usize = std::env::var("FUB_DISEGNO_RIPETIZIONI")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(20);
    let disegni = disegni();
    let mappa = lf(&std::fs::read_to_string(
        common::radice().join("crates/fub-features/templates/concept-map.it.svg"),
    )
    .expect("concept-map"));
    let (mut d, _) = Disegno::apri_con(&disegni, &mappa).expect("si apre");
    let mut misure = Vec::new();

    // Spostare l'«Argomento» (il gruppo dell'ellisse piena): 60 anteprime
    // per gesto.
    let (mut ant, mut com) = (Vec::new(), Vec::new());
    for _ in 0..ripetizioni {
        let (a, c, esito) = trascina(&mut d, "select", 0, (700.0, 500.0), (120.0, 80.0), 60);
        assert_eq!(esito.refused, None, "lo spostamento è rifiutato");
        assert!(esito.ops.is_some(), "lo spostamento non scrive");
        ant.extend(a);
        com.push(c);
    }
    misure.push(riassunto("concept-map: anteprima di uno spostamento", ant));
    misure.push(riassunto("concept-map: commit di uno spostamento", com));

    // Un rettangolo nel vuoto in basso a sinistra.
    let (mut ant, mut com) = (Vec::new(), Vec::new());
    for _ in 0..ripetizioni {
        let (a, c, esito) = trascina(&mut d, "rect", 0, (100.0, 700.0), (200.0, 150.0), 60);
        assert_eq!(esito.refused, None, "il rettangolo è rifiutato");
        ant.extend(a);
        com.push(c);
    }
    misure.push(riassunto("concept-map: anteprima di un rettangolo", ant));
    misure.push(riassunto("concept-map: commit di un rettangolo", com));

    // Il disegno di 1 MiB: apertura, spostamento e reimport.
    let grande = disegno_grande(1024 * 1024);
    let byte = grande.len();
    let t = Instant::now();
    let (mut g, aperto) = Disegno::apri_con(&disegni, &grande).expect("il grande si apre");
    let apertura = t.elapsed();
    misure.push(json!({ "misura": "1 MiB: apertura", "byte": byte, "mappati": aperto.mapped, "ms": apertura.as_secs_f64() * 1000.0 }));
    let (mut ant, mut com) = (Vec::new(), Vec::new());
    for _ in 0..ripetizioni.min(10) {
        let (a, c, esito) = trascina(&mut g, "select", 0, (20.0, 15.0), (25.0, 25.0), 30);
        assert_eq!(esito.refused, None, "lo spostamento nel grande è rifiutato");
        ant.extend(a);
        com.push(c);
    }
    misure.push(riassunto("1 MiB: anteprima di uno spostamento", ant));
    misure.push(riassunto("1 MiB: commit di uno spostamento", com));
    let mut reimport = Vec::new();
    for k in 1..=ripetizioni.min(20) as u64 {
        // Un testo nuovo ogni volta: il colore del primo rettangolo cambia.
        let testo = grande.replacen("#e3f2fb", if k % 2 == 1 { "#ffe0b2" } else { "#e3f2fb" }, 1);
        let t = Instant::now();
        g.sincronizza(DrawingSync {
            revision: k,
            change: DrawingChange::Text { text: testo },
        })
        .expect("il sync");
        assert!(
            g.aspetta_il_reimport(Duration::from_secs(60)),
            "il reimport non arriva"
        );
        reimport.push(t.elapsed());
    }
    misure.push(riassunto(
        "1 MiB: reimport (sync col testo intero, fino alla copia pronta)",
        reimport,
    ));
    scrivi_json(
        &dir.join("latenze.json"),
        &json!({ "ripetizioni": ripetizioni, "profilo": if cfg!(debug_assertions) { "debug" } else { "release" }, "misure": misure }),
    );
}
