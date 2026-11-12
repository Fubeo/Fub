//! I comandi del disegno (`fub_abi::DRAWING_COMMANDS`) fatti con i comandi del
//! motore, sulla selezione data.
//!
//! - `disegno.colore-tratto` → `paint.setStroke` del motore, col colore
//!   `#rrggbb` (o `#rgb`), o `none`;
//! - `disegno.colore-riempimento` → `paint.setFill`, col colore, o `null` (o
//!   `none`) per nessun riempimento;
//! - `disegno.spessore` → `stroke.set` con `weight`, un numero finito, zero o
//!   più, nelle unità dell'elemento (come `stroke-width` lo scrive il client).
//!
//! **Chi si colora** è ciò che colora oggi il pannello del client
//! (`partsFrom` in `apps/client/src/editors/spatial/tools/look/read.ts` e
//! `lookOps` in `look/write.ts`): un gruppo o un link scelto passa ai suoi
//! discendenti, salvo quelli bloccati; il colore del tratto va nel `stroke`
//! delle forme che hanno un contorno e nel `fill` dei tratti a penna e delle
//! linee a spessore variabile, che sono tutti riempimento; il riempimento va
//! alle forme che ne hanno uno e ai testi; lo spessore ai contorni che si
//! vedono. Gli altri elementi (un'immagine, la carta, un livello) restano
//! come sono. Il motore riceve sempre gli oggetti uno per uno (`ids`), mai la
//! sua selezione.
//!
//! **Che cosa si rifiuta.** Un id della selezione che non è nella mappa, o
//! che il motore non sa modificare, è `unmapped`, e niente cambia; lo è
//! anche un discendente da colorare che il motore non ha. Un elemento scelto
//! bloccato (lui o un antenato) è `locked`. Lo spessore di una freccia, di
//! una linea a spessore variabile o di un contorno tratteggiato è
//! `unsupported`: il client riscrive anche la punta, il profilo o il
//! tratteggio, che `stroke.set` lascia com'erano. Il colore del tratto o del
//! riempimento di un oggetto che nel motore non ha quel tratto o quel
//! riempimento (`fill="none"`, nessun `stroke`) è `unsupported`: la
//! differenza non sa scrivere un aspetto nuovo. Una selezione in cui
//! niente si colora, o un comando che non cambia niente, è `empty`. Un
//! valore che non è un colore o uno spessore è `BadArgs`.
//!
//! **L'esito** è la differenza fra la copia e il documento del motore dopo i
//! comandi ([`crate::differenza`]); la sessione torna poi alla copia. Lo
//! stato vero è il file, che le operazioni cambiano.
//!
//! [`controlla_registro`] dice se il registro dei comandi del motore ha
//! ancora gli id e i parametri che si usano qui: un aggiornamento del motore
//! che li cambia fa fallire la sua prova.

use std::collections::{HashMap, HashSet};

use fub_abi::{
    DrawingCommandInfo, DrawingCommandRequest, DrawingOutcome, DrawingRefusal, PluginError,
    DRAWING_COMMANDS, DRAWING_COMMAND_FILL_COLOR, DRAWING_COMMAND_STROKE_COLOR,
    DRAWING_COMMAND_WIDTH,
};
use fub_scene::Role;
use serde_json::{json, Value};
use vectorcraft_doc::color::Color;
use vectorcraft_doc::NodeId;

use crate::apertura::Copia;
use crate::differenza;
use crate::gesti::{esito_vuoto, Banco};

/// Il comando del motore che colora il tratto.
pub const MOTORE_TRATTO: &str = "paint.setStroke";
/// Il comando del motore che colora il riempimento.
pub const MOTORE_RIEMPIMENTO: &str = "paint.setFill";
/// Il comando del motore che cambia lo spessore.
pub const MOTORE_SPESSORE: &str = "stroke.set";

/// I comandi di Fub e il comando del motore che li fa. Il colore del tratto
/// dei tratti a penna passa anche da [`MOTORE_RIEMPIMENTO`].
pub const COMANDI: [(&str, &str); 3] = [
    (DRAWING_COMMAND_STROKE_COLOR, MOTORE_TRATTO),
    (DRAWING_COMMAND_FILL_COLOR, MOTORE_RIEMPIMENTO),
    (DRAWING_COMMAND_WIDTH, MOTORE_SPESSORE),
];

/// Ciò che un comando di Fub chiede, letto dal suo `value`.
#[derive(Clone, Debug, PartialEq)]
pub enum Azione {
    /// Il colore del tratto: `#rrggbb`, o `None` per nessuno.
    Tratto(Option<String>),
    /// Il colore del riempimento: `#rrggbb`, o `None` per nessuno.
    Riempimento(Option<String>),
    /// Lo spessore, nelle unità dell'elemento.
    Spessore(f64),
}

impl Azione {
    /// L'azione di `richiesta`, già passata da `validate()`: `Ok(None)` se il
    /// motore non serve il suo id, `BadArgs` se il valore non è un colore o
    /// uno spessore.
    pub fn di(richiesta: &DrawingCommandRequest) -> Result<Option<Azione>, PluginError> {
        let leggi = |nullo: bool| -> Result<Option<String>, PluginError> {
            match &richiesta.value {
                Value::Null if nullo => Ok(None),
                Value::String(s) => colore(s),
                _ => Err(PluginError::BadArgs(
                    "`value` must be a color".to_string().into(),
                )),
            }
        };
        Ok(Some(match richiesta.id.as_str() {
            DRAWING_COMMAND_STROKE_COLOR => Azione::Tratto(leggi(false)?),
            DRAWING_COMMAND_FILL_COLOR => Azione::Riempimento(leggi(true)?),
            DRAWING_COMMAND_WIDTH => match richiesta.value.as_f64() {
                Some(w) if w.is_finite() && w >= 0.0 => Azione::Spessore(w),
                _ => {
                    return Err(PluginError::BadArgs(
                        "`value` must be a finite number, 0 or more"
                            .to_string()
                            .into(),
                    ))
                }
            },
            _ => return Ok(None),
        }))
    }

    fn specie(&self) -> Specie {
        match self {
            Azione::Tratto(_) => Specie::Tratto,
            Azione::Riempimento(_) => Specie::Riempimento,
            Azione::Spessore(_) => Specie::Spessore,
        }
    }
}

/// `none` (in qualunque maiuscola) è nessun colore; poi `#rgb` o `#rrggbb`,
/// scritto `#rrggbb`. Il resto (un nome CSS, `rgb(…)`, l'alfa) è `BadArgs`:
/// il motore lo leggerebbe a modo suo, o perderebbe l'alfa.
fn colore(s: &str) -> Result<Option<String>, PluginError> {
    let t = s.trim();
    if t.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    let cifre = t.strip_prefix('#').unwrap_or("");
    if matches!(cifre.len(), 3 | 6) && cifre.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Some(c) = Color::from_hex(t) {
            return Ok(Some(c.to_hex()));
        }
    }
    Err(PluginError::BadArgs(
        format!("`value` must be #rgb, #rrggbb or none, not {s:?}").into(),
    ))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Specie {
    Tratto,
    Riempimento,
    Spessore,
}

/// Un oggetto del motore da cambiare.
#[derive(Clone, Copy, Debug)]
struct Bersaglio {
    elemento: usize,
    nodo: NodeId,
    /// Il colore del tratto va nel riempimento (un tratto a penna).
    nel_riempimento: bool,
}

/// I ruoli che passano tutto ai figli (`CONTAINERS` del client).
fn contenitore(r: Role) -> bool {
    matches!(r, Role::Group | Role::Link)
}

/// I ruoli con un riempimento (`FILLED` del client).
fn riempito(r: Role) -> bool {
    matches!(
        r,
        Role::Ngon
            | Role::Star
            | Role::Path
            | Role::Rect
            | Role::Ellipse
            | Role::Circle
            | Role::Polyline
            | Role::Polygon
            | Role::Text
    )
}

/// I ruoli con un contorno (`OUTLINED` del client).
fn contornato(r: Role) -> bool {
    matches!(
        r,
        Role::Arrow
            | Role::Connector
            | Role::Ngon
            | Role::Star
            | Role::Path
            | Role::Rect
            | Role::Ellipse
            | Role::Circle
            | Role::Line
            | Role::Polyline
            | Role::Polygon
    )
}

/// I ruoli tutti riempimento che si vedono come una linea (`INKED` del
/// client): il loro colore del tratto è il riempimento.
fn inchiostro(r: Role) -> bool {
    matches!(r, Role::Stroke | Role::Width)
}

/// Vero se l'elemento `i` o un suo antenato è bloccato.
fn bloccato(copia: &Copia, mut i: usize) -> bool {
    while let Some(e) = copia.mappa.elemento(i) {
        if e.bloccato {
            return true;
        }
        match e.genitore {
            Some(g) => i = g,
            None => return false,
        }
    }
    false
}

/// Gli oggetti del motore che il comando cambia, o perché no.
fn bersagli(
    copia: &Copia,
    selezione: &[String],
    specie: Specie,
) -> Result<Vec<Bersaglio>, DrawingRefusal> {
    if !copia.modificabile {
        return Err(DrawingRefusal::Unsupported);
    }
    if selezione.is_empty() {
        return Err(DrawingRefusal::Empty);
    }
    let mappa = &copia.mappa;
    let mut scelti = Vec::with_capacity(selezione.len());
    for id in selezione {
        let i = mappa.dell_id(id).ok_or(DrawingRefusal::Unmapped)?;
        let e = mappa.elemento(i).ok_or(DrawingRefusal::Unmapped)?;
        if e.nodo.is_none() {
            return Err(DrawingRefusal::Unmapped);
        }
        if bloccato(copia, i) {
            return Err(DrawingRefusal::Locked);
        }
        scelti.push(i);
    }
    // I figli di ogni elemento, solo se un contenitore è scelto.
    let figli: Option<HashMap<usize, Vec<usize>>> = scelti
        .iter()
        .any(|&i| mappa.elemento(i).is_some_and(|e| contenitore(e.ruolo)))
        .then(|| {
            let mut figli: HashMap<usize, Vec<usize>> = HashMap::new();
            for (i, e) in mappa.elementi().iter().enumerate() {
                if let Some(g) = e.genitore {
                    figli.entry(g).or_default().push(i);
                }
            }
            figli
        });
    let mut fuori = Vec::new();
    let mut visti = HashSet::new();
    let mut pila: Vec<(usize, bool)> = scelti.iter().rev().map(|&i| (i, true)).collect();
    while let Some((i, scelto)) = pila.pop() {
        let Some(e) = mappa.elemento(i) else { continue };
        // Ciò che è bloccato dentro un gruppo scelto resta com'è.
        if !scelto && e.bloccato {
            continue;
        }
        if contenitore(e.ruolo) {
            if let Some(dentro) = figli.as_ref().and_then(|f| f.get(&i)) {
                pila.extend(dentro.iter().rev().map(|&c| (c, false)));
            }
            continue;
        }
        let nel_riempimento = match specie {
            Specie::Tratto if inchiostro(e.ruolo) => true,
            Specie::Tratto if contornato(e.ruolo) => false,
            Specie::Riempimento if riempito(e.ruolo) => true,
            Specie::Spessore if inchiostro(e.ruolo) || e.ruolo == Role::Arrow => {
                // Il client riscrive il profilo o la punta con lo spessore.
                return Err(DrawingRefusal::Unsupported);
            }
            Specie::Spessore if contornato(e.ruolo) => false,
            _ => continue,
        };
        let nodo = e.nodo.ok_or(DrawingRefusal::Unmapped)?;
        let aspetto = &copia
            .documento
            .node(nodo)
            .ok_or(DrawingRefusal::Unmapped)?
            .appearance;
        if specie == Specie::Spessore {
            // Solo i contorni che si vedono; il client riscrive anche il
            // tratteggio, che `stroke.set` lascerebbe com'era.
            let Some(tratto) = aspetto.stroke() else {
                continue;
            };
            if tratto.paint.is_none() {
                continue;
            }
            if tratto.dash.is_some() {
                return Err(DrawingRefusal::Unsupported);
            }
        } else if (nel_riempimento && aspetto.fill().is_none())
            || (!nel_riempimento && aspetto.stroke().is_none())
        {
            // Il motore aggiungerebbe un riempimento o un tratto che
            // l'oggetto non ha, e la differenza non sa scrivere un aspetto
            // nuovo: `unsupported`, invece di colorare solo una parte.
            return Err(DrawingRefusal::Unsupported);
        }
        if visti.insert(i) {
            fuori.push(Bersaglio {
                elemento: i,
                nodo,
                nel_riempimento,
            });
        }
    }
    if fuori.is_empty() {
        return Err(DrawingRefusal::Empty);
    }
    Ok(fuori)
}

/// I comandi del disegno sulla selezione: acceso quello che, sulla copia di
/// adesso, ha qualcosa da cambiare e niente che il motore non sappia fare.
pub(crate) fn elenco(copia: &Copia, selezione: &[String]) -> Vec<DrawingCommandInfo> {
    DRAWING_COMMANDS
        .iter()
        .map(|id| {
            let specie = match *id {
                DRAWING_COMMAND_STROKE_COLOR => Some(Specie::Tratto),
                DRAWING_COMMAND_FILL_COLOR => Some(Specie::Riempimento),
                DRAWING_COMMAND_WIDTH => Some(Specie::Spessore),
                _ => None,
            };
            DrawingCommandInfo {
                id: (*id).to_string(),
                enabled: specie.is_some_and(|s| bersagli(copia, selezione, s).is_ok()),
            }
        })
        .collect()
}

/// I parametri di [`MOTORE_TRATTO`] e [`MOTORE_RIEMPIMENTO`]. `focus: false`
/// lascia la sessione com'era (il riquadro attivo del motore).
fn parametri_colore(colore: Option<&str>, ids: &[u64]) -> Value {
    match colore {
        Some(c) => json!({ "color": c, "ids": ids, "focus": false }),
        None => json!({ "none": true, "ids": ids, "focus": false }),
    }
}

/// I parametri di [`MOTORE_SPESSORE`]: lo spessore nel documento del motore.
fn parametri_spessore(peso: f64, ids: &[u64]) -> Value {
    json!({ "weight": peso, "ids": ids })
}

/// I comandi del motore che fanno `azione` sui `bersagli`.
fn chiamate(
    copia: &Copia,
    azione: &Azione,
    bersagli: &[Bersaglio],
) -> Result<Vec<(&'static str, Value)>, DrawingRefusal> {
    let ids = |filtro: &dyn Fn(&Bersaglio) -> bool| -> Vec<u64> {
        bersagli
            .iter()
            .filter(|b| filtro(b))
            .map(|b| b.nodo.0)
            .collect()
    };
    let mut fuori = Vec::new();
    match azione {
        Azione::Tratto(c) => {
            let tratti = ids(&|b| !b.nel_riempimento);
            let penne = ids(&|b| b.nel_riempimento);
            if !tratti.is_empty() {
                fuori.push((MOTORE_TRATTO, parametri_colore(c.as_deref(), &tratti)));
            }
            if !penne.is_empty() {
                fuori.push((MOTORE_RIEMPIMENTO, parametri_colore(c.as_deref(), &penne)));
            }
        }
        Azione::Riempimento(c) => {
            fuori.push((
                MOTORE_RIEMPIMENTO,
                parametri_colore(c.as_deref(), &ids(&|_| true)),
            ));
        }
        Azione::Spessore(w) => {
            // Lo spessore del motore è nel suo documento: quello dell'elemento
            // per la sua scala, come la differenza lo riscrive. Una chiamata
            // per scala.
            let mut per_scala: Vec<(f64, Vec<u64>)> = Vec::new();
            for b in bersagli {
                let scala = copia
                    .mappa
                    .elemento(b.elemento)
                    .and_then(|e| e.ctm())
                    .map(|m| m.determinant().abs().sqrt())
                    .filter(|s| s.is_finite() && *s > 0.0)
                    .ok_or(DrawingRefusal::Unsupported)?;
                match per_scala.iter_mut().find(|(s, _)| *s == scala) {
                    Some((_, lista)) => lista.push(b.nodo.0),
                    None => per_scala.push((scala, vec![b.nodo.0])),
                }
            }
            for (scala, lista) in per_scala {
                fuori.push((MOTORE_SPESSORE, parametri_spessore(w * scala, &lista)));
            }
        }
    }
    Ok(fuori)
}

/// Fa `azione` sulla selezione di `richiesta`, sulla copia: l'esito con le
/// operazioni, o il rifiuto. La sessione torna alla copia.
pub(crate) fn esegui(
    banco: &mut Banco,
    copia: &Copia,
    richiesta: &DrawingCommandRequest,
    azione: &Azione,
) -> DrawingOutcome {
    let mut esito = esito_vuoto(richiesta.revision);
    let rifiuta = |mut esito: DrawingOutcome, r: DrawingRefusal| {
        esito.refused = Some(r);
        esito
    };
    let lista = match bersagli(copia, &richiesta.selection, azione.specie())
        .and_then(|b| chiamate(copia, azione, &b))
    {
        Ok(l) => l,
        Err(r) => return rifiuta(esito, r),
    };
    // Un gesto lasciato a metà non entra nel comando.
    if banco.in_corso.is_some() {
        banco.ripristina(copia);
    }
    let sessione = &mut banco.sessione;
    let fatto = vectorcraft_engine::guard::catch_panic(|| {
        // I comandi del motore cambiano anche lo stile delle forme nuove:
        // quello della sessione resta com'era.
        let stile = sessione.paint.clone();
        let mut fatto = Ok(());
        for (id, parametri) in &lista {
            if let Err(e) = sessione.execute(id, parametri) {
                fatto = Err(e);
                break;
            }
        }
        sessione.paint = stile;
        fatto
    });
    if !matches!(fatto, Ok(Ok(()))) {
        banco.ripristina(copia);
        return rifiuta(esito, DrawingRefusal::Unsupported);
    }
    let Some(dopo) = banco.documento() else {
        banco.ripristina(copia);
        return rifiuta(esito, DrawingRefusal::Unsupported);
    };
    let differenza =
        vectorcraft_engine::guard::catch_panic(|| differenza::differenza(copia, &dopo, None));
    banco.ripristina(copia);
    let mut differenza = match differenza {
        Ok(Ok(d)) => d,
        Ok(Err(r)) => return rifiuta(esito, r.rifiuto()),
        Err(_) => return rifiuta(esito, DrawingRefusal::Unsupported),
    };
    if !matches!(azione, Azione::Spessore(_)) {
        senza_spessore(&mut differenza.ops);
    }
    match differenza.testo() {
        Ok(Some(ops)) => esito.ops = Some(ops),
        Ok(None) => return rifiuta(esito, DrawingRefusal::Empty),
        Err(r) => return rifiuta(esito, r.rifiuto()),
    }
    // Un comando non cambia la selezione.
    esito.selection = richiesta.selection.clone();
    esito
}

/// Toglie `stroke-width` dai `set` di un comando di colore. Il motore, che
/// tiene lo spessore nel tratto, lo porta a 0 togliendo il tratto e a 1
/// dandolo a chi non l'aveva; il client cambia solo il colore, e il file
/// tiene lo spessore che aveva. Un `set` rimasto senza attributi se ne va.
fn senza_spessore(ops: &mut Vec<Value>) {
    for op in ops.iter_mut() {
        if op["op"] == "set" {
            if let Some(attrs) = op.get_mut("attrs").and_then(Value::as_object_mut) {
                attrs.remove("stroke-width");
            }
        }
    }
    ops.retain(|op| op["op"] != "set" || op["attrs"].as_object().is_some_and(|a| !a.is_empty()));
    // Un `ident` che nessun'altra operazione nomina più non serve.
    let nominati: HashSet<String> = ops
        .iter()
        .filter(|op| op["op"] != "ident")
        .filter_map(|op| op["id"].as_str().map(str::to_string))
        .collect();
    ops.retain(|op| {
        op["op"] != "ident" || op["id"].as_str().is_some_and(|id| nominati.contains(id))
    });
}

/// I comandi del motore con i parametri come li manda questo modulo, uno
/// per forma: ciò che [`controlla_registro`] verifica.
pub fn chiamate_di_prova() -> Vec<(&'static str, Value)> {
    vec![
        (MOTORE_TRATTO, parametri_colore(Some("#ff0000"), &[1])),
        (MOTORE_TRATTO, parametri_colore(None, &[1])),
        (MOTORE_RIEMPIMENTO, parametri_colore(Some("#ff0000"), &[1])),
        (MOTORE_RIEMPIMENTO, parametri_colore(None, &[1])),
        (MOTORE_SPESSORE, parametri_spessore(2.0, &[1])),
    ]
}

/// `Ok` se il registro dei comandi del motore ha `id` e la sua descrizione
/// nomina ogni chiave di `parametri` (`chiave?` o `chiave:`, anche nella
/// descrizione dei comandi che nomina con «as …»); altrimenti il perché.
///
/// Il controllo delle chiavi del motore (`check_params`) salta proprio questi
/// comandi (la lista `UNCHECKED` di `cmd/params.rs`): per questo si legge qui
/// la descrizione, e si chiama anche `check_params` per quando il motore li
/// controllerà.
pub fn controlla_registro(id: &str, parametri: &Value) -> Result<(), String> {
    let spec = vectorcraft_engine::find_command(id)
        .ok_or_else(|| format!("il motore non ha più il comando `{id}`"))?;
    // La descrizione, e quella dei comandi a cui rimanda («…as paint.setFill»).
    let mut descrizioni = vec![spec.params];
    for pezzo in spec.params.split("as ").skip(1) {
        let nome: String = pezzo
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '.')
            .collect();
        if let Some(altro) = vectorcraft_engine::find_command(nome.trim_end_matches('.')) {
            descrizioni.push(altro.params);
        }
    }
    let nomina = |chiave: &str| {
        descrizioni.iter().any(|d| {
            d.match_indices(chiave).any(|(i, _)| {
                let prima = d[..i].chars().next_back();
                let dopo = d[i + chiave.len()..].chars().next();
                !prima.is_some_and(|c| c.is_ascii_alphanumeric()) && matches!(dopo, Some('?' | ':'))
            })
        })
    };
    if let Some(chiavi) = parametri.as_object() {
        if let Some(chiave) = chiavi.keys().find(|k| !nomina(k)) {
            return Err(format!(
                "il comando `{id}` del motore non nomina più il parametro `{chiave}`"
            ));
        }
    }
    vectorcraft_engine::check_params(id, parametri)
        .map_err(|e| format!("il comando `{id}` del motore non accetta {parametri}: {e}"))
}
