//! La famiglia `aspetto` della mappa (K6 T15): l'opacità e il metodo di fusione dell'oggetto scelto
//! (`transparency.set`, giro 2) e il suo contorno (`stroke.set`, giro 5). Il resto dell'aspetto (la
//! pila, le maschere di opacità, il gruppo a foratura) aspetta il suo giro
//! (`docs/architecture/disegno-completo.md`).
//!
//! **Le sfumature preimpostate** (giro 6): `gradient.presets.list`, `.save` e `.delete` sono letture
//! del motore (non cambiano il documento); le preimpostate salvate stanno nelle preferenze del motore,
//! che l'host tiene in `draw.motore` (`crate::preferenze`). `gradient.presets.apply` cambia la
//! sfumatura degli oggetti scelti come `paint.editGradient`, in un passo: ne prende le regole dalla
//! famiglia `colore`, che le ha (spento, rifiuto, i testi saltati, ciò che la scena non scrive).
//!
//! **Il contorno.** Del pannello Contorno del motore il file dice lo spessore, gli estremi, gli angoli e
//! il tratteggio semplice (`stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`). Il
//! limite dell'angolo, l'allineamento dentro o fuori, lo spostamento del tratteggio e il tratteggio
//! adattato agli angoli, le frecce del motore e i profili di spessore non hanno un attributo nella
//! scena: chiederli è `unsupported`, e niente cambia. Un testo non ha contorno (come per il Colore): con
//! soli testi scelti il comando è spento, e in una selezione mista il contorno va alle altre forme.
//!
//! **Le voci d'aspetto** (K6 T15, voci d'aspetto): togliere, duplicare e spostare una voce della pila
//! (`appearance.removeItem`, `duplicateItem`, `moveItem`), per il suo numero nella pila di ogni oggetto
//! scelto (o dei suoi contenuti con `target: "contents"`). Togliere l'ultima voce di una forma la lascerebbe
//! senza riempimento né contorno, che il file non riapre: si rifiuta. Il numero che la scelta non ha è
//! `BadArgs` in italiano, prima del motore, e la riga del contenuto, gli `ids` e l'allineamento alle righe di
//! una scelta mista non ci sono: la scelta è quella del disegno.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use serde_json::Value;
use vectorcraft_doc::{Document, NodeId, NodeKind};

use super::colore::SFUMATURE;
use super::tracciati::{inchiostro_toccato, sceglie_inchiostro};
use super::{nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// L'opacità e la fusione.
const TRASPARENZA: &str = "transparency.set";

/// Il contorno: spessore, estremi, angoli, tratteggio.
pub(crate) const CONTORNO: &str = "stroke.set";

/// Crea la maschera di opacità (K6 T15, giro maschere): con due oggetti o più, il più alto fa da
/// maschera degli altri, che vanno in un gruppo con `mask`.
const CREA_MASCHERA: &str = "transparency.makeOpacityMask";

/// Riduci ad aspetto di base (K6 T15, aspetto): lascia un solo riempimento e un solo contorno visibili.
const RIDUCI: &str = "appearance.reduceToBasic";

/// Aggiungi riempimento e Aggiungi contorno (K6 T15, aggiungi aspetto): una copia del riempimento o del
/// contorno in cima allo stack di ogni oggetto scelto, con il colore predefinito se non ce n'è uno.
const AGGIUNGI_RIEMPIMENTO: &str = "appearance.addFill";
const AGGIUNGI_CONTORNO: &str = "appearance.addStroke";

/// Togli, duplica e sposta una voce della pila dell'aspetto (K6 T15, voci d'aspetto): un riempimento o un
/// contorno, per il suo numero (`index`, `indices`, `from`, `to`) nella pila di ogni oggetto scelto.
const TOGLI_VOCE: &str = "appearance.removeItem";
const DUPLICA_VOCE: &str = "appearance.duplicateItem";
const SPOSTA_VOCE: &str = "appearance.moveItem";

/// Il perché di una voce d'aspetto su un oggetto nascosto: il comando non lo tocca, come Riduci.
const NASCOSTO_VOCE: &str = "L'oggetto è nascosto: la sua voce d'aspetto non si cambia. Mostralo per cambiarla.";

/// I valori del pannello Trasparenza per la scelta, e la maschera di opacità della scelta: letture.
const LETTURA_TRASPARENZA: &str = "transparency.info";
const LETTURA_MASCHERA: &str = "transparency.opacityMaskInfo";

/// Il punto scelto della sfumatura del riempimento o del contorno davanti.
const PUNTO_DELLA_SFUMATURA: &str = "gradient.selectStop";

/// Applicare una sfumatura preimpostata: cambia la sfumatura degli oggetti scelti come la cambia
/// `paint.editGradient`, il comando che il motore usa per farlo.
const APPLICA_PRESET: &str = "gradient.presets.apply";

/// Le regole di `paint.editGradient`, nella famiglia `colore`.
type Colore = super::colore::Stato;

/// L'id di cui `gradient.presets.apply` usa le regole: `paint.editGradient`.
fn come_sfumatura(id: &str) -> Option<&'static str> {
    (id == APPLICA_PRESET).then_some(SFUMATURE[0])
}

/// Il limite dell'angolo di SVG (4), quello che il motore legge da un file senza `stroke-miterlimit`:
/// la scena non scrive l'attributo, quindi non se ne chiede un altro.
const LIMITE_DELL_ANGOLO: f64 = 4.0;

/// Lo stato della famiglia: non tiene niente.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        0
    }

    fn libera(&self) -> u64 {
        0
    }

    /// Scegliere un punto della sfumatura cambia solo la sessione del motore (il punto su cui agiscono
    /// i tasti e il pannello): una lettura, `{index}`.
    /// Le letture della Trasparenza (K6 T15, giro maschere): i valori del pannello e la maschera
    /// dell'oggetto scelto. Non cambiano il documento.
    fn legge(&self, id: &str) -> bool {
        id == PUNTO_DELLA_SFUMATURA || matches!(id, LETTURA_TRASPARENZA | LETTURA_MASCHERA)
    }

    /// Lo spessore e le lunghezze del tratteggio sono numeri finiti non negativi; un tratteggio vuoto,
    /// o che non disegna trattini (tutto a zero), è un contorno pieno: `dash: null` per il motore.
    fn adatta(&self, id: &str, argomenti: Value) -> Result<Value, PluginError> {
        if e_voce(id) {
            voci_ben_formate(id, &argomenti)?;
            return Ok(argomenti);
        }
        if id == CREA_MASCHERA {
            let booleano = |chiave: &str| argomenti.get(chiave).is_none_or(Value::is_boolean);
            if !booleano("clip") || !booleano("invert") {
                return Err(PluginError::BadArgs("clip e invert sono vero o falso".into()));
            }
        }
        if id != CONTORNO {
            return Ok(argomenti);
        }
        let Value::Object(mut o) = argomenti else {
            return Err(PluginError::BadArgs("gli argomenti sono un oggetto".into()));
        };
        if let Some(spessore) = o.get("weight") {
            match spessore.as_f64() {
                Some(v) if v.is_finite() && v >= 0.0 => {}
                _ => {
                    return Err(PluginError::BadArgs(
                        "lo spessore è un numero non negativo".into(),
                    ))
                }
            }
        }
        if let Some(trattini) = o.get("dash").filter(|v| !v.is_null()) {
            let lunghezze: Option<Vec<f64>> = trattini
                .as_array()
                .map(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<f64>>>())
                .unwrap_or(None);
            let Some(lunghezze) = lunghezze.filter(|l| l.iter().all(|v| v.is_finite() && *v >= 0.0))
            else {
                return Err(PluginError::BadArgs(
                    "il tratteggio è una lista di lunghezze non negative".into(),
                ));
            };
            if lunghezze.iter().all(|v| *v == 0.0) {
                o.insert("dash".into(), Value::Null);
            }
        }
        Ok(Value::Object(o))
    }

    /// `transparency.set` e `stroke.set` spenti col loro perché, prima di chiedere al motore: senza una
    /// scelta; sul disegno di sola lettura; con una scelta che la mappa non ha, o con un oggetto
    /// bloccato (che non si scrive). Il contorno è spento anche su un tratto dell'Inchiostro di Fub, che
    /// è un riempimento, e su soli testi, che non hanno contorno.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if let Some(sfumatura) = come_sfumatura(id) {
            return Colore::spento(sfumatura, copia, selezione);
        }
        if id == CREA_MASCHERA {
            return spento_maschera(copia, selezione);
        }
        if matches!(id, RIDUCI | AGGIUNGI_RIEMPIMENTO | AGGIUNGI_CONTORNO) || e_voce(id) {
            return spento_di_oggetti(id, copia, selezione);
        }
        if id != TRASPARENZA && id != CONTORNO {
            return None;
        }
        if selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let scelti = match nodi_scelti(copia, selezione) {
            Ok(scelti) => scelti,
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        };
        if id == CONTORNO {
            if sceglie_inchiostro(copia, selezione) {
                return Some(DrawingDisabledReason::FubInk);
            }
            if scelti.iter().all(|n| testo(copia, *n)) {
                return Some(DrawingDisabledReason::NeedsPath);
            }
        }
        None
    }

    /// Il contorno su un tratto dell'Inchiostro è `unmapped` (è un riempimento); su soli testi è
    /// `unsupported`: la scena non scrive il contorno dei caratteri.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if let Some(sfumatura) = come_sfumatura(id) {
            return Colore::rifiuto(sfumatura, copia, selezione);
        }
        if matches!(id, RIDUCI | AGGIUNGI_RIEMPIMENTO | AGGIUNGI_CONTORNO) || e_voce(id) {
            return match spento_di_oggetti(id, copia, selezione)? {
                DrawingDisabledReason::NoSelection => Some(DrawingRefusal::Empty),
                DrawingDisabledReason::ReadOnly => Some(DrawingRefusal::Locked),
                DrawingDisabledReason::Unmapped | DrawingDisabledReason::FubInk => Some(DrawingRefusal::Unmapped),
                _ => Some(DrawingRefusal::Unsupported),
            };
        }
        if id == CREA_MASCHERA {
            return match spento_maschera(copia, selezione)? {
                DrawingDisabledReason::NeedsPath => Some(DrawingRefusal::Unsupported),
                DrawingDisabledReason::ReadOnly => Some(DrawingRefusal::Locked),
                _ => Some(DrawingRefusal::Empty),
            };
        }
        if id != CONTORNO {
            return None;
        }
        if sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        let scelti = nodi_scelti(copia, selezione).ok()?;
        (!scelti.is_empty() && scelti.iter().all(|n| testo(copia, *n)))
            .then_some(DrawingRefusal::Unsupported)
    }

    /// Ciò che il contorno del motore sa fare e la scena non dice: `unsupported` prima del motore.
    fn rifiuto_valore(
        id: &str,
        copia: &Copia,
        selezione: &[String],
        valore: &Value,
    ) -> Option<DrawingRefusal> {
        if let Some(sfumatura) = come_sfumatura(id) {
            return Colore::rifiuto_valore(sfumatura, copia, selezione, valore);
        }
        if e_voce(id) {
            return rifiuto_di_voce(id, copia, selezione, valore);
        }
        // La maschera che non ritaglia, o invertita: non c'è un attributo per dirlo, e il motore la
        // farebbe diversa dal file.
        if id == CREA_MASCHERA {
            let c = |chiave: &str| valore.get(chiave).and_then(Value::as_bool);
            return (c("clip") == Some(false) || c("invert") == Some(true)).then_some(DrawingRefusal::Unsupported);
        }
        (id == CONTORNO && fuori_dalla_scena(valore)).then_some(DrawingRefusal::Unsupported)
    }

    /// Una voce d'aspetto che l'oggetto scelto non ha, o un `to` su più voci: `BadArgs`, col perché in
    /// italiano, prima del motore (la copia e la scelta dicono quali oggetti e quante voci hanno).
    fn argomenti_della_selezione(
        id: &str,
        copia: &Copia,
        selezione: &[String],
        valore: &Value,
    ) -> Result<(), PluginError> {
        if !e_voce(id) {
            return Ok(());
        }
        let contenuti = valore.get("target").and_then(Value::as_str) == Some("contents");
        let bersagli = bersagli_di_voce(copia, selezione, contenuti);
        if bersagli.is_empty() {
            return Err(PluginError::BadArgs(
                "Nella scelta non c'è niente da cambiare: scegli un oggetto con una sua voce d'aspetto.".into(),
            ));
        }
        let quante = |n: &NodeId| copia.documento.node(*n).map_or(0, |nodo| nodo.appearance.items.len());
        if id == SPOSTA_VOCE {
            // Un oggetto che non ha la voce `from` fa fallire lo spostamento per intero nel motore.
            let Some(da) = valore.get("from").and_then(Value::as_u64) else {
                return Ok(());
            };
            if bersagli.iter().any(|n| (quante(n) as u64) <= da) {
                return Err(PluginError::BadArgs(
                    format!("Una delle scelte non ha una voce d'aspetto numero {da}.").into(),
                ));
            }
            return Ok(());
        }
        let indici = indici_di_voce(valore);
        let Some(primo) = indici.first().copied() else {
            return Ok(());
        };
        if !bersagli.iter().any(|n| indici.iter().any(|i| *i < quante(n))) {
            return Err(PluginError::BadArgs(format!("Non c'è una voce d'aspetto numero {primo}.").into()));
        }
        if id == DUPLICA_VOCE && indici.len() > 1 && valore.get("to").is_some_and(|v| !v.is_null()) {
            return Err(PluginError::BadArgs(
                "«to» vale per una voce sola: con più voci la copia va subito sopra ciascuna.".into(),
            ));
        }
        Ok(())
    }

    /// Un tratto dell'Inchiostro cambiato dentro un gruppo scelto: `unmapped`, e niente si scrive.
    fn rifiuto_dopo(
        id: &str,
        copia: &Copia,
        dopo: &Document,
        scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal> {
        if let Some(sfumatura) = come_sfumatura(id) {
            return Colore::rifiuto_dopo(sfumatura, copia, dopo, scelti_dopo);
        }
        if e_voce(id) {
            return rifiuto_voce_dopo(copia, dopo);
        }
        (id == CONTORNO && inchiostro_toccato(copia, dopo)).then_some(DrawingRefusal::Unmapped)
    }

    /// In una selezione con testi e forme il contorno va alle forme, una alla volta nella stessa
    /// copia: un passo solo. Senza testi il comando gira una volta su tutti.
    fn uno_alla_volta(id: &str, copia: &Copia, selezione: &[String]) -> Option<Vec<NodeId>> {
        if let Some(sfumatura) = come_sfumatura(id) {
            return Colore::uno_alla_volta(sfumatura, copia, selezione);
        }
        if id != CONTORNO {
            return None;
        }
        let scelti = nodi_scelti(copia, selezione).ok()?;
        if !scelti.iter().any(|n| testo(copia, *n)) {
            return None;
        }
        Some(scelti.into_iter().filter(|n| !testo(copia, *n)).collect())
    }
}

/// L'oggetto del motore `n` è un testo.
pub(super) fn testo(copia: &Copia, n: NodeId) -> bool {
    copia
        .documento
        .node(n)
        .is_some_and(|nodo| matches!(nodo.kind, NodeKind::Text(_)))
}

/// Gli argomenti di `stroke.set` chiedono qualcosa che la scena non scrive: un limite dell'angolo
/// diverso da quello di SVG, un allineamento dentro o fuori, un tratteggio spostato o adattato agli
/// angoli, una freccia del motore (le punte di Fub sono un'altra cosa, `docs/product/drawing-tips.md`),
/// un profilo di spessore, un tratto dell'aspetto che non è quello in cima.
fn fuori_dalla_scena(valore: &Value) -> bool {
    let c = |chiave: &str| valore.get(chiave).filter(|v| !v.is_null());
    c("miterLimit").is_some_and(|v| v.as_f64() != Some(LIMITE_DELL_ANGOLO))
        || c("align").is_some_and(|v| v.as_str() != Some("center"))
        || c("dashOffset").is_some_and(|v| v.as_f64() != Some(0.0))
        || c("alignDashes").is_some_and(|v| v.as_bool() != Some(false))
        || c("startArrow").is_some()
        || c("endArrow").is_some()
        || c("arrowAlign").is_some()
        || c("profile").is_some_and(|v| v.as_str() != Some("uniform"))
        || c("item").is_some()
        || c("target").is_some_and(|v| v.as_str() != Some("object"))
}

/// Perché Crea maschera di opacità non vale sulle scelte: niente scelto, un oggetto solo (la
/// maschera di un oggetto solo si disegna in modifica, che il disegno non tiene fra due comandi),
/// un oggetto bloccato, o una maschera che non è un tracciato (il file la scrive solo così).
fn spento_maschera(copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    if selezione.is_empty() {
        return Some(DrawingDisabledReason::NoSelection);
    }
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    let scelti = match nodi_scelti(copia, selezione) {
        Ok(scelti) => scelti,
        Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
        Err(_) => return Some(DrawingDisabledReason::Unmapped),
    };
    if scelti.len() < 2 {
        return Some(DrawingDisabledReason::NeedsTwo);
    }
    if scelti.iter().any(|n| copia.documento.node(*n).is_some_and(|nodo| nodo.locked)) {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    let cima = piu_alto(copia, &scelti).and_then(|n| copia.documento.node(n));
    (!cima.is_some_and(tracciato_di_maschera)).then_some(DrawingDisabledReason::NeedsPath)
}

/// Un tracciato che fa da maschera: un tracciato che non è una guida né un ritaglio, o un composto.
fn tracciato_di_maschera(nodo: &vectorcraft_doc::Node) -> bool {
    use vectorcraft_doc::NodeKind;
    matches!(nodo.kind, NodeKind::Path { guide: false, clipping: false, .. } | NodeKind::Compound { .. })
}

/// Il più alto fra `nodi` nell'ordine di pittura del motore (l'ultimo che il giro del documento
/// incontra).
fn piu_alto(copia: &Copia, nodi: &[NodeId]) -> Option<NodeId> {
    let mut cima = None;
    copia.documento.walk(|n| {
        if nodi.contains(&n.id) {
            cima = Some(n.id);
        }
    });
    cima
}

/// Perché Riduci ad aspetto di base, Aggiungi riempimento e Aggiungi contorno non valgono sulle scelte
/// (K6 T15, aspetto): niente scelto, un oggetto bloccato, un tratto dell'Inchiostro, un oggetto nascosto
/// o un testo. Un oggetto con una maschera di opacità si cambia: la ricetta riscritta si riapre con la
/// maschera (`tests/ricette_riapertura.rs`).
fn spento_oggetti(copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    spento_oggetti_con(copia, selezione, "L'oggetto è nascosto: Riduci ad aspetto di base non lo tocca. Mostralo per ridurlo.")
}

/// Perché un comando che cambia l'aspetto degli oggetti scelti è spento, con la frase `nascosto` per un
/// oggetto nascosto (Riduci, o una voce d'aspetto: [`spento_oggetti`]).
fn spento_oggetti_con(copia: &Copia, selezione: &[String], nascosto: &str) -> Option<DrawingDisabledReason> {
    if selezione.is_empty() {
        return Some(DrawingDisabledReason::NoSelection);
    }
    if !copia.modificabile {
        return Some(DrawingDisabledReason::ReadOnly);
    }
    let scelti = match nodi_scelti(copia, selezione) {
        Ok(scelti) => scelti,
        Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
        Err(_) => return Some(DrawingDisabledReason::Unmapped),
    };
    // Un tratto dell'Inchiostro di Fub è un riempimento del file, non un oggetto che il motore riduce.
    if sceglie_inchiostro(copia, selezione) {
        return Some(DrawingDisabledReason::FubInk);
    }
    // Un oggetto nascosto: il motore lo lascia com'è, e Riduci non dice nulla. Si dice perché.
    let nascosto_scelto = |n: &NodeId| copia.documento.node(*n).is_some_and(|nodo| !nodo.visible);
    if scelti.iter().any(nascosto_scelto) {
        return Some(DrawingDisabledReason::Other { text: nascosto.into() });
    }
    // Il colore di un testo sta nei suoi caratteri: il riempimento dell'oggetto, scritto sul `<text>`,
    // lo spegnerebbe per intero. Il testo non si riduce ancora.
    let testo = |n: &NodeId| copia.documento.node(*n).is_some_and(|nodo| matches!(nodo.kind, NodeKind::Text(_)));
    scelti.iter().any(testo).then(|| DrawingDisabledReason::Other {
        text: "Il testo non si cambia ancora nell'aspetto: il suo colore sta nei caratteri.".into(),
    })
}

/// Perché `id`, uno dei comandi che cambiano un oggetto scelto (Riduci, Aggiungi, le voci d'aspetto), è
/// spento: la frase di un oggetto nascosto dipende dal comando.
fn spento_di_oggetti(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
    if e_voce(id) {
        spento_oggetti_con(copia, selezione, NASCOSTO_VOCE)
    } else {
        spento_oggetti(copia, selezione)
    }
}

/// Un comando sulla voce della pila dell'aspetto (K6 T15, voci d'aspetto).
fn e_voce(id: &str) -> bool {
    matches!(id, TOGLI_VOCE | DUPLICA_VOCE | SPOSTA_VOCE)
}

/// Gli argomenti di una voce d'aspetto hanno la forma che il motore vuole: `index` (un numero da zero in su)
/// o `indices` (una lista di numeri) per togliere e duplicare, e per spostare `from` e `to`; `target` è
/// `object` o `contents`. Un argomento che manca o non è così è `BadArgs` col perché, prima del motore, che lo
/// direbbe in inglese. Lo spostamento dal contenuto (`from: "contents"`) passa, e lo rifiuta
/// [`rifiuto_di_voce`].
fn voci_ben_formate(id: &str, argomenti: &Value) -> Result<(), PluginError> {
    let numero = |v: Option<&Value>| v.and_then(Value::as_u64).is_some();
    match argomenti.get("target") {
        None | Some(Value::Null) => {}
        Some(v) if matches!(v.as_str(), Some("object" | "contents")) => {}
        Some(_) => return Err(PluginError::BadArgs("«target» è «object» o «contents».".into())),
    }
    if id == SPOSTA_VOCE {
        if argomenti.get("from").and_then(Value::as_str) == Some("contents") {
            return Ok(());
        }
        if !numero(argomenti.get("from")) {
            return Err(PluginError::BadArgs("Dimmi quale voce spostare: il suo numero, da 0 in su («from»).".into()));
        }
        if !numero(argomenti.get("to")) {
            return Err(PluginError::BadArgs("Dimmi dove spostarla: il numero della posizione, da 0 in su («to»).".into()));
        }
        return Ok(());
    }
    match argomenti.get("indices") {
        Some(Value::Array(lista)) if !lista.is_empty() && lista.iter().all(|v| v.as_u64().is_some()) => {}
        Some(_) => return Err(PluginError::BadArgs("«indices» è una lista di numeri di voce, da 0 in su.".into())),
        None if numero(argomenti.get("index")) => {}
        None => return Err(PluginError::BadArgs("Dimmi quale voce: il suo numero, da 0 in su («index»).".into())),
    }
    if id == DUPLICA_VOCE && argomenti.get("to").is_some_and(|v| !v.is_null()) && !numero(argomenti.get("to")) {
        return Err(PluginError::BadArgs("Dove mettere la copia: il numero della posizione, da 0 in su («to»).".into()));
    }
    Ok(())
}

/// I numeri di voce di togliere e duplicare: `index` o `indices`, senza ripetizioni.
fn indici_di_voce(valore: &Value) -> Vec<usize> {
    let intero = |v: &Value| v.as_u64().and_then(|i| usize::try_from(i).ok());
    let mut v: Vec<usize> = match valore.get("indices").and_then(Value::as_array) {
        Some(lista) => lista.iter().filter_map(intero).collect(),
        None => valore.get("index").and_then(intero).into_iter().collect(),
    };
    v.sort_unstable();
    v.dedup();
    v
}

/// Gli oggetti che una voce d'aspetto cambia: quelli scelti o, con `contenuti`, gli oggetti dipinti dentro i
/// gruppi e i livelli scelti (come `leaf_targets` del motore: il gruppo stesso non ha una sua pila allora).
fn bersagli_di_voce(copia: &Copia, selezione: &[String], contenuti: bool) -> Vec<NodeId> {
    let Ok(scelti) = nodi_scelti(copia, selezione) else {
        return Vec::new();
    };
    if !contenuti {
        return scelti;
    }
    let contenitore = |n: &vectorcraft_doc::Node| {
        matches!(n.kind, NodeKind::Group { .. } | NodeKind::Layer { .. }) && !n.is_compound_shape()
    };
    let mut fuori = Vec::new();
    for id in scelti {
        match copia.documento.node(id) {
            Some(nodo) if contenitore(nodo) => nodo.walk(&mut |c| {
                if !contenitore(c) {
                    fuori.push(c.id);
                }
            }),
            _ => fuori.push(id),
        }
    }
    fuori
}

/// Ciò che una voce d'aspetto del motore non fa sulla scelta, prima di lui: `unsupported` per gli `ids` (la
/// scelta è quella del disegno), per l'allineamento alle righe di una scelta mista e per la riga del
/// contenuto, che il file non dice; `empty` quando lo spostamento lascia la voce dov'è, anche con `to` oltre la
/// cima (il motore la ferma lì) su ogni oggetto: niente cambia e non c'è un passo.
fn rifiuto_di_voce(id: &str, copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
    let presente = |chiave: &str| valore.get(chiave).is_some_and(|v| !v.is_null());
    if presente("ids") || presente("id") || valore.get("aligned").and_then(Value::as_bool) == Some(true) {
        return Some(DrawingRefusal::Unsupported);
    }
    if id != SPOSTA_VOCE {
        return None;
    }
    if valore.get("from").and_then(Value::as_str) == Some("contents") || presente("contents") {
        return Some(DrawingRefusal::Unsupported);
    }
    let (Some(da), Some(a)) = (valore.get("from").and_then(Value::as_u64), valore.get("to").and_then(Value::as_u64)) else {
        return None;
    };
    let da = usize::try_from(da).unwrap_or(usize::MAX);
    let a = usize::try_from(a).unwrap_or(usize::MAX);
    let contenuti = valore.get("target").and_then(Value::as_str) == Some("contents");
    let fermo = bersagli_di_voce(copia, selezione, contenuti).iter().all(|n| {
        copia.documento.node(*n).is_some_and(|nodo| {
            let k = nodo.appearance.items.len();
            k > da && a.min(k - 1) == da
        })
    });
    fermo.then_some(DrawingRefusal::Empty)
}

/// Un comando sulla voce che lascia un testo con l'aspetto cambiato, o una forma senza riempimento né
/// contorno, non si riapre: `unsupported` (K6 T15, voci d'aspetto). Il file scrive il colore di una forma nei
/// suoi attributi e quello di un testo nei suoi caratteri, e una forma vuota non torna come oggetto del motore.
fn rifiuto_voce_dopo(copia: &Copia, dopo: &Document) -> Option<DrawingRefusal> {
    let mut non_si_riapre = false;
    copia.documento.walk(|prima| {
        let Some(poi) = dopo.node(prima.id) else {
            return;
        };
        if prima.appearance == poi.appearance {
            return;
        }
        match &poi.kind {
            NodeKind::Text(_) => non_si_riapre = true,
            NodeKind::Path { .. } | NodeKind::Compound { .. } if poi.appearance.items.is_empty() => {
                non_si_riapre = true
            }
            _ => {}
        }
    });
    non_si_riapre.then_some(DrawingRefusal::Unsupported)
}
