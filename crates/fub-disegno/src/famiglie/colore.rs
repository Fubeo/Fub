//! La famiglia `colore` della mappa (`docs/architecture/disegno-completo.md`,
//! `docs/product/drawing-colors.md`): il suo stato e le regole dei comandi del
//! colore che il motore fa già.
//!
//! - **Il colore attivo** (`paint.*`, Design › Colore): riempimento e tratto,
//!   scambia, di serie, nessuno, inverti, complementare, l'ultimo colore.
//!   Cambiano gli oggetti scelti: senza selezione il motore cambierebbe solo
//!   lo stile delle forme nuove, che la sessione rimette com'era, e il comando
//!   è spento (`no_selection`). `paint.toggleActive` porta davanti il
//!   riempimento o il tratto nella sessione del motore (il tasto X, «Nessuno»
//!   col tasto /): non cambia il file e rende `{fillActive}` come lettura.
//! - **Modifica › Modifica colori** (`edit.colors.*`): sugli oggetti scelti,
//!   anche dentro i gruppi. Satura e Regola bilanciamento colore hanno la
//!   finestra scritta (`catalogo::FINESTRE_SCRITTE`); le fusioni vogliono
//!   almeno tre oggetti con un riempimento pieno: con meno il motore non fa
//!   niente, e il comando è `empty`.
//!
//! - **I campioni del documento** (`swatch.*`, Risorse › Campioni): nuovo,
//!   opzioni (nome e colore), elimina, duplica, unisci, ordina per nome,
//!   sposta, «Aggiungi i colori usati» e l'elenco di quelli che nessuno usa.
//!   I gruppi di colori e i campioni predefiniti non ci sono nel formato, e
//!   restano da fare. Nel file un campione si usa sempre per
//!   riferimento, quindi è sempre **globale**: la famiglia lo chiede al motore
//!   anche se gli argomenti dicono altro, così cambiarlo cambia in un passo chi
//!   lo usa ([`crate::campioni`]). Eliminare lascia a chi lo usava il suo
//!   colore. Applicarne uno è `paint.setFill` o `paint.setStroke` con
//!   `swatch`. Non cambiano gli oggetti scelti, e la selezione non li spegne;
//!   un campione usato da un oggetto bloccato non si elimina (`locked`).
//!
//! **Che cosa non si tocca.** Un oggetto bloccato (lui o un antenato) o un
//! disegno in sola lettura spengono i comandi (`read_only`); un tratto
//! dell'Inchiostro di Fub (`fub:ink`) scelto li spegne (`fub_ink`): il suo
//! colore è nel tratto, che è di Fub. Se il comando lo cambia lo stesso (un
//! gruppo scelto che lo contiene), il risultato non si scrive (`unmapped`).
//!
//! - **Il Contagocce** (K6 T14 giro 6): `paint.sampleColor` prende un colore
//!   sul riempimento o sul tratto del lato attivo; senza selezione cambia solo
//!   i valori di Design › Colore, con la selezione cambia anche gli oggetti
//!   scelti. `eyedropper.setOptions` sono le sue opzioni, una preferenza del
//!   motore (`draw.motore`). Lo strumento `eyedropper` (il clic) passa da
//!   [`rifiuto_del_contagocce`]: il clic copia l'aspetto dell'oggetto cliccato
//!   sulla selezione, o, con Alt, quello della selezione sull'oggetto cliccato.
//!   Un'immagine e un oggetto non mappato si rifiutano col motivo.
//!
//! Lo stato: i profili colore caricati, che pesano ma non si svuotano senza
//! rompere i documenti che li nominano.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use vectorcraft_doc::color::Paint;
use serde_json::Value;
use vectorcraft_doc::hit::{hit_test_visible, HitOptions};
use vectorcraft_doc::{Document, Node, NodeId, NodeKind};
use vectorcraft_geom::Point;

use super::aspetto::testo;
use super::tracciati::{inchiostro_toccato, sceglie_inchiostro};
use super::{byte_delle_tabelle, libera_le_tabelle, nodi_scelti, StatoFamiglia};
use crate::apertura::Copia;

/// Le tabelle del motore che la famiglia fa crescere (patch 0008).
pub(crate) const TABELLE: &[&str] = &["user_profiles"];

/// I comandi del colore attivo che cambiano gli oggetti scelti.
pub(crate) const SUL_COLORE_ATTIVO: [&str; 9] = [
    "paint.setFill",
    "paint.setStroke",
    "paint.swap",
    "paint.default",
    "paint.none",
    "paint.invert",
    "paint.complement",
    "paint.lastColor",
    "paint.sampleColor",
];

/// Il campione del Contagocce: senza selezione cambia il colore attivo (il
/// lato di Design › Colore), e non è spento.
pub(crate) const CAMPIONA: &str = "paint.sampleColor";

/// Le sfumature del riempimento o del contorno degli oggetti scelti (K6 T15,
/// giro 5): i punti, il tipo e l'angolo, la geometria, l'ultima usata.
pub(crate) const SFUMATURE: [&str; 3] = ["paint.editGradient", "paint.setGradientGeom", "paint.lastGradient"];

/// Le letture del colore (K6 T14, sfumatura libera e colori recenti): il motore
/// le dà con lo stato della sessione (i colori recenti, riempimento e tratto
/// come li mostrano i proxy) e non cambiano il file. Non portano una scelta.
pub(crate) const LETTURE: [&str; 3] = ["paint.toggleActive", "paint.recent", "paint.proxies"];

/// Gli argomenti delle letture del colore che il motore lascerebbe passare in silenzio (K6 T14,
/// letture): un modello che non c'è dà il RGB, e un colore che non è `#rrggbb` si salta. Il perché
/// è in italiano, prima del motore.
fn argomenti_delle_letture(id: &str, argomenti: &Value) -> Option<&'static str> {
    let assente = |v: Option<&Value>| v.is_none_or(Value::is_null);
    let hex6 = |c: &Value| {
        c.as_str().is_some_and(|s| {
            s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|ch| ch.is_ascii_hexdigit())
        })
    };
    match id {
        "color.convert" => {
            let to = argomenti.get("to");
            (assente(to) || !matches!(to.and_then(Value::as_str), Some("rgb" | "cmyk" | "gray" | "lab")))
                .then_some("«to» è rgb, cmyk, gray o lab.")
        }
        "color.gamutCheck" => {
            let colori = argomenti.get("colors");
            if assente(colori) {
                return None;
            }
            match colori.and_then(Value::as_array) {
                Some(lista) if lista.iter().all(hex6) => None,
                _ => Some("«colors» è una lista di colori #rrggbb."),
            }
        }
        _ => None,
    }
}

/// Il perché di Applica e Trova campione più vicino quando il documento non ha campioni
/// (K6 T14 giro 9): il motore lo direbbe in inglese, e la frase è questa.
pub(crate) const TESTO_SENZA_CAMPIONI: &str =
    "Il disegno non ha campioni: aggiungine uno in Risorse › Campioni, o scegli «Aggiungi i colori usati», prima di cercare il campione più vicino.";

/// Il documento non ha nessun campione con un colore pieno, come lo conta il motore
/// (`library_colors`): i campioni riservati di sistema (Nessuno, Registro) non valgono,
/// e una sfumatura non è un colore.
fn senza_campioni(copia: &Copia) -> bool {
    !copia
        .documento
        .swatches
        .iter()
        .any(|s| !s.is_reserved() && matches!(s.paint, Paint::Solid { .. }))
}

/// Il campione più vicino (T14 giro 9): Applica lo dà ai colori degli oggetti scelti, e
/// Trova li cerca nei loro colori (o in un colore dato): sono sugli oggetti scelti.
pub(crate) const DAGLI_OGGETTI_AGGIUNTI: [&str; 2] = [
    "addon.color.applyNearestSwatch",
    "addon.color.nearestSwatch",
];

/// Ricolora la grafica (T14): la scrittura che la finestra `ui.recolorDialog` manda dopo le
/// anteprime. Vale sugli oggetti scelti; senza scelta il motore chiede la scelta o un gruppo di
/// colori (che Fub non ha ancora, T30), e la voce è spenta.
pub(crate) const RICOLORA: &str = "recolor.apply";

/// Le letture di Ricolora che guardano la scelta (i suoi colori, e le proposte di riduzione e
/// casuali): sono spente come la scrittura quando la scelta non va (niente, bloccata, Inchiostro,
/// non mappata), perché la finestra non si apre su una scelta che non si può ricolorare.
pub(crate) const LETTURE_DELLA_SCELTA: [&str; 3] = ["recolor.colors", "recolor.reduce", "recolor.randomize"];

/// Le voci di Modifica › Modifica colori.
pub(crate) const MODIFICA_COLORI: [&str; 10] = [
    "edit.colors.invert",
    "edit.colors.toCMYK",
    "edit.colors.toGrayscale",
    "edit.colors.toRGB",
    "edit.colors.saturate",
    "edit.colors.adjustBalance",
    "edit.colors.blendFrontToBack",
    "edit.colors.blendHorizontally",
    "edit.colors.blendVertically",
    "edit.colors.overprintBlack",
];

/// I comandi dei campioni del documento che cambiano il file: i campioni nuovi, cambiati o tolti, e
/// l'ordine (`swatch.duplicate` mette la copia dopo l'originale, `swatch.merge` toglie gli uniti,
/// `swatch.sortByName` e `swatch.move` riordinano: [`crate::campioni`]).
pub(crate) const CAMPIONI: [&str; 9] = [
    "swatch.new",
    "swatch.edit",
    "swatch.delete",
    "swatch.addUsedColors",
    "swatch.duplicate",
    "swatch.merge",
    "swatch.sortByName",
    "swatch.move",
    "swatch.library.add",
];

/// La libreria di campioni di base che `swatch.library.add` nomina (per id, o per nome in ogni caso),
/// con i suoi campioni. Le librerie di sfumature non sono campioni del formato.
fn libreria_di_base(nome: &str) -> Result<Arc<vectorcraft_color::libraries::SwatchLibrary>, PluginError> {
    use vectorcraft_color::libraries::{builtin_library, BuiltinLibrary, GRADIENT_LIBRARIES, SWATCH_LIBRARIES};
    let trovata = |b: &&BuiltinLibrary| b.id == nome || b.name.eq_ignore_ascii_case(nome);
    if let Some(b) = SWATCH_LIBRARIES.iter().find(trovata) {
        return builtin_library(b.id).ok_or_else(|| PluginError::BadArgs(format!("Non c'è la libreria di campioni «{nome}».").into()));
    }
    if GRADIENT_LIBRARIES.iter().any(|b| trovata(&b)) {
        return Err(PluginError::BadArgs(
            format!("«{nome}» è una libreria di sfumature: il formato del disegno non ha campioni di sfumatura.").into(),
        ));
    }
    Err(PluginError::BadArgs(format!("Non c'è la libreria di campioni «{nome}».").into()))
}

/// Gli argomenti di `swatch.library.add` che il motore direbbe in inglese: la libreria c'è, i nomi
/// scelti ci sono nella libreria, e il colore da applicare (`apply`) è un altro comando.
fn argomenti_della_libreria(valore: &Value) -> Result<(), PluginError> {
    let nome = valore
        .get("library")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .ok_or_else(|| PluginError::BadArgs("Scegli la libreria di campioni da aggiungere.".into()))?;
    let libreria = libreria_di_base(nome)?;
    if valore.get("apply").is_some_and(|a| !a.is_null()) {
        return Err(PluginError::BadArgs(
            "Il colore da applicare si sceglie dopo: aggiungi i campioni, poi scegli il colore.".into(),
        ));
    }
    let scelti: Vec<&vectorcraft_color::Swatch> = match valore.get("names") {
        None | Some(Value::Null) => libreria.iter().collect(),
        Some(Value::Array(nomi)) => {
            let mut scelti = vec![];
            for n in nomi {
                let n = n.as_str().ok_or_else(|| PluginError::BadArgs("«names» è una lista di nomi di campioni.".into()))?;
                match (libreria.group(n), libreria.swatch(n)) {
                    (Some(gruppo), _) => scelti.extend(gruppo.swatches.iter()),
                    (None, Some(campione)) => scelti.push(campione),
                    (None, None) => {
                        return Err(PluginError::BadArgs(format!("Non c'è il campione «{n}» in «{}».", libreria.name).into()));
                    }
                }
            }
            scelti
        }
        Some(_) => return Err(PluginError::BadArgs("«names» è una lista di nomi di campioni.".into())),
    };
    // Il formato ha solo colori pieni globali: una sfumatura o un tinta della libreria (che il motore
    // copierebbe com'è) si dice qui, non come `unsupported` dopo.
    if let Some(sfumatura) = scelti.iter().find(|s| !matches!(s.paint, vectorcraft_doc::color::Paint::Solid { swatch: None, .. })) {
        return Err(PluginError::BadArgs(
            format!("«{}» non è un colore pieno: il formato del disegno ha solo colori pieni.", sfumatura.name).into(),
        ));
    }
    Ok(())
}

/// Un campione che il comando nomina nei suoi argomenti deve essere un campione del file: i colori
/// dei gruppi e i Nessuno non ci sono.
fn campione_del_file(copia: &Copia, nome: &str) -> Result<(), PluginError> {
    if nome.starts_with('[') || !copia.campioni.elenco.iter().any(|c| c.nome == nome) {
        return Err(PluginError::BadArgs(
            format!("«{nome}» non è un campione del disegno.").into(),
        ));
    }
    Ok(())
}

/// Vero se nessuno dei nomi torna due volte.
fn senza_doppioni(nomi: &[&str]) -> bool {
    let mut visti = nomi.to_vec();
    visti.sort_unstable();
    visti.dedup();
    visti.len() == nomi.len()
}

/// I nomi dei campioni in `names`, se sono tutti testi.
fn nomi_di_campioni(valore: &Value) -> Option<Vec<&str>> {
    valore
        .get("names")?
        .as_array()?
        .iter()
        .map(Value::as_str)
        .collect()
}

/// Le fusioni: almeno tre oggetti con un riempimento pieno.
const FUSIONI: [&str; 3] = [
    "edit.colors.blendFrontToBack",
    "edit.colors.blendHorizontally",
    "edit.colors.blendVertically",
];

/// Quanti riempimenti pieni servono a una fusione.
const RIEMPIMENTI_DELLE_FUSIONI: usize = 3;

/// Il comando cambia i colori degli oggetti scelti.
fn sugli_scelti(id: &str) -> bool {
    SUL_COLORE_ATTIVO.contains(&id)
        || MODIFICA_COLORI.contains(&id)
        || SFUMATURE.contains(&id)
        || DAGLI_OGGETTI_AGGIUNTI.contains(&id)
        || id == RICOLORA
        || LETTURE_DELLA_SCELTA.contains(&id)
}

/// Gli argomenti di una sfumatura chiedono ciò che la scena non scrive: una
/// sfumatura libera, un altro modo di mescolare i colori, la retinatura, un
/// punto medio che non sta a metà o legato a un campione, una sfumatura che
/// segue il tratto, un elemento dell'aspetto che non è quello in cima.
fn sfumatura_fuori_dalla_scena(valore: &Value) -> bool {
    let c = |chiave: &str| valore.get(chiave).filter(|v| !v.is_null());
    let punto_ricco = |p: &Value| {
        p.get("midpoint").filter(|v| !v.is_null()).is_some_and(|v| v.as_f64() != Some(0.5))
            || p.get("swatch").filter(|v| !v.is_null()).is_some()
    };
    c("kind").is_some_and(|v| v.as_str() == Some("freeform"))
        || c("mode").is_some()
        || c("method").is_some_and(|v| v.as_str() != Some("classic"))
        || c("dither").is_some_and(|v| v.as_bool() != Some(false))
        || c("strokeMode").is_some_and(|v| v.as_str() != Some("within"))
        || c("item").is_some()
        || c("index").is_some()
        || c("target").is_some_and(|v| v.as_str() != Some("object"))
        || c("stops").and_then(Value::as_array).is_some_and(|p| p.iter().any(punto_ricco))
}

/// Vero se un oggetto scelto dopo il comando ha una sfumatura che la scena
/// non scrive come risorsa privata ([`crate::sfumature`]): l'ultima
/// sfumatura usata può essere libera.
fn sfumatura_ricca(dopo: &Document, scelti: &[NodeId]) -> bool {
    fn ricca(n: &Node) -> bool {
        let pittura = |p: &Paint| matches!(p, Paint::Gradient(g) if !crate::sfumature::scrivibile(g));
        n.appearance.items.iter().any(|i| match i {
            vectorcraft_doc::AppearanceItem::Fill(f) => pittura(&f.paint),
            vectorcraft_doc::AppearanceItem::Stroke(s) => {
                pittura(&s.paint) || (matches!(s.paint, Paint::Gradient(_)) && !crate::sfumature::del_tratto_scrivibile(s))
            }
        }) || n.children().into_iter().flatten().any(|c| ricca(c))
    }
    scelti.iter().filter_map(|n| dopo.node(*n)).any(ricca)
}

/// Lo stato della famiglia: le sue tabelle nel motore.
pub(crate) struct Stato;

impl StatoFamiglia for Stato {
    fn nasce(_servizi: &Arc<Servizi>) -> Result<Self, ErroreMotore> {
        Ok(Stato)
    }

    fn byte(&self) -> u64 {
        byte_delle_tabelle(TABELLE)
    }

    fn libera(&self) -> u64 {
        libera_le_tabelle(TABELLE)
    }

    fn legge(&self, id: &str) -> bool {
        // Le letture del colore e quelle di Ricolora (i colori della scelta, le proposte di
        // riduzione e casuali) non cambiano il file; `recolor.apply` sì.
        LETTURE.contains(&id) || LETTURE_DELLA_SCELTA.contains(&id)
    }

    /// Un campione nuovo, cambiato o fatto dai colori usati è globale;
    /// eliminarne uno lascia a chi lo usava il suo colore.
    fn adatta(&self, id: &str, argomenti: Value) -> Result<Value, PluginError> {
        if let Some(motivo) = argomenti_delle_letture(id, &argomenti) {
            return Err(PluginError::BadArgs(motivo.into()));
        }
        if !CAMPIONI.contains(&id) {
            return Ok(argomenti);
        }
        let mut argomenti = match argomenti {
            Value::Null => Value::Object(serde_json::Map::new()),
            Value::Object(o) => Value::Object(o),
            _ => return Err(PluginError::BadArgs("gli argomenti sono un oggetto".into())),
        };
        if let Some(o) = argomenti.as_object_mut() {
            if id == "swatch.delete" {
                o.insert("unlink".into(), Value::Bool(true));
            } else if matches!(id, "swatch.new" | "swatch.edit" | "swatch.addUsedColors") {
                o.insert("global".into(), Value::Bool(true));
            }
        }
        Ok(argomenti)
    }

    /// Gli argomenti dei comandi di campioni che il file non può prendere, prima del motore e col
    /// perché in italiano: il campione nominato deve esserci, e la posizione essere un intero.
    fn argomenti_della_copia(id: &str, copia: &Copia, valore: Value) -> Result<Value, PluginError> {
        let senza_nome = || PluginError::BadArgs("Scegli il campione.".into());
        match id {
            "swatch.library.add" => argomenti_della_libreria(&valore)?,
            "swatch.duplicate" => {
                let nome = valore.get("name").and_then(Value::as_str).ok_or_else(senza_nome)?;
                campione_del_file(copia, nome)?;
            }
            "swatch.merge" => {
                let nomi = nomi_di_campioni(&valore).unwrap_or_default();
                if nomi.len() < 2 {
                    return Err(PluginError::BadArgs("Scegli due o più campioni da unire.".into()));
                }
                for nome in &nomi {
                    campione_del_file(copia, nome)?;
                }
                if !senza_doppioni(&nomi) {
                    return Err(PluginError::BadArgs("Un campione si unisce una volta sola: togli il doppione.".into()));
                }
                // Il primo resta; gli altri si tolgono, e chi li usa da un oggetto bloccato non si riscrive.
                if let Some(nome) = crate::campioni::usato_da_un_bloccato(copia, &nomi[1..]) {
                    return Err(PluginError::BadArgs(
                        format!("«{nome}» è usato da un oggetto bloccato: sbloccalo prima di unirlo.").into(),
                    ));
                }
            }
            "swatch.move" => {
                if valore.get("group").is_some_and(|g| !g.is_null()) {
                    return Err(PluginError::BadArgs(
                        "Il formato non ha gruppi di colori: si sposta un campione, non un gruppo.".into(),
                    ));
                }
                let nomi = nomi_di_campioni(&valore).filter(|nomi| !nomi.is_empty()).ok_or_else(senza_nome)?;
                for nome in &nomi {
                    campione_del_file(copia, nome)?;
                }
                if !senza_doppioni(&nomi) {
                    return Err(PluginError::BadArgs("Un campione si sposta una volta sola: togli il doppione.".into()));
                }
                if valore.get("to").is_some_and(|to| !to.is_null() && to.as_u64().is_none()) {
                    return Err(PluginError::BadArgs("La posizione è un numero intero, dal primo campione: 0.".into()));
                }
            }
            _ => {}
        }
        Ok(valore)
    }

    /// Senza selezione, su un disegno in sola lettura, su un oggetto bloccato
    /// o su un tratto dell'Inchiostro di Fub, i comandi che cambiano i colori
    /// sono spenti col perché. `paint.toggleActive` non cambia il file: resta
    /// acceso.
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        // Il controllo gamut legge ciò che è scelto (senza scelta, tutto il disegno): una scelta
        // non mappata lo spegne come gli altri comandi sugli oggetti (K6 T14, letture).
        if id == "color.gamutCheck" {
            return super::selezione_spenta(copia, selezione);
        }
        // Il campione più vicino cerca nei campioni del documento: senza, il motore
        // risponderebbe in inglese. Il perché si dice qui, in italiano (K6 T14 giro 9).
        if DAGLI_OGGETTI_AGGIUNTI.contains(&id) && senza_campioni(copia) {
            return Some(DrawingDisabledReason::Other {
                text: TESTO_SENZA_CAMPIONI.into(),
            });
        }
        if CAMPIONI.contains(&id) {
            return (!copia.modificabile).then_some(DrawingDisabledReason::ReadOnly);
        }
        if !sugli_scelti(id) {
            return None;
        }
        if selezione.is_empty() {
            return (id != CAMPIONA).then_some(DrawingDisabledReason::NoSelection);
        }
        if !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        let scelti = match nodi_scelti(copia, selezione) {
            Ok(scelti) => scelti,
            Err(DrawingRefusal::Locked) => return Some(DrawingDisabledReason::ReadOnly),
            Err(_) => return Some(DrawingDisabledReason::Unmapped),
        };
        if sceglie_inchiostro(copia, selezione) {
            return Some(DrawingDisabledReason::FubInk);
        }
        // La scena non scrive la sfumatura dei caratteri.
        (SFUMATURE.contains(&id) && scelti.iter().all(|n| testo(copia, *n)))
            .then_some(DrawingDisabledReason::NeedsPath)
    }

    /// Un tratto dell'Inchiostro scelto è `unmapped`; una fusione con meno di
    /// tre riempimenti pieni non fa niente: `empty`.
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        // Senza campioni nel documento il comando non fa niente: `empty`, e il perché è
        // quello di `spento`.
        if DAGLI_OGGETTI_AGGIUNTI.contains(&id) && senza_campioni(copia) {
            return Some(DrawingRefusal::Empty);
        }
        if sugli_scelti(id) && sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
        if FUSIONI.contains(&id) {
            let scelti = nodi_scelti(copia, selezione).ok()?;
            if riempimenti_pieni(&copia.documento, &scelti) < RIEMPIMENTI_DELLE_FUSIONI {
                return Some(DrawingRefusal::Empty);
            }
        }
        if SFUMATURE.contains(&id) {
            let scelti = nodi_scelti(copia, selezione).ok()?;
            return (!scelti.is_empty() && scelti.iter().all(|n| testo(copia, *n)))
                .then_some(DrawingRefusal::Unsupported);
        }
        None
    }

    /// Ciò che una sfumatura del motore sa fare e la scena non dice:
    /// `unsupported` prima del motore.
    fn rifiuto_valore(
        id: &str,
        _copia: &Copia,
        _selezione: &[String],
        valore: &Value,
    ) -> Option<DrawingRefusal> {
        (SFUMATURE.contains(&id) && sfumatura_fuori_dalla_scena(valore)).then_some(DrawingRefusal::Unsupported)
    }

    /// In una selezione con testi e forme la sfumatura va alle forme, una
    /// alla volta nella stessa copia: un passo solo.
    fn uno_alla_volta(id: &str, copia: &Copia, selezione: &[String]) -> Option<Vec<NodeId>> {
        if !SFUMATURE.contains(&id) {
            return None;
        }
        let scelti = nodi_scelti(copia, selezione).ok()?;
        if !scelti.iter().any(|n| testo(copia, *n)) {
            return None;
        }
        Some(scelti.into_iter().filter(|n| !testo(copia, *n)).collect())
    }

    /// La copia di una libreria di base nel formato: i campioni diventano globali e senza gruppo
    /// ([`crate::campioni::porta_nel_formato`]), per `swatch.library.add`.
    fn traduci_dopo(id: &str, _copia: &Copia, dopo: &Document) -> Option<Document> {
        (id == "swatch.library.add").then(|| crate::campioni::porta_nel_formato(dopo)).flatten()
    }

    /// Un tratto dell'Inchiostro cambiato, anche se non era scelto (dentro un
    /// gruppo scelto): `unmapped`, e niente si scrive.
    fn rifiuto_dopo(
        id: &str,
        copia: &Copia,
        dopo: &Document,
        scelti_dopo: &[NodeId],
    ) -> Option<DrawingRefusal> {
        if SFUMATURE.contains(&id) && sfumatura_ricca(dopo, scelti_dopo) {
            return Some(DrawingRefusal::Unsupported);
        }
        if CAMPIONI.contains(&id) {
            return crate::campioni::tolto_a_un_bloccato(copia, dopo)
                .then_some(DrawingRefusal::Locked);
        }
        (sugli_scelti(id) && inchiostro_toccato(copia, dopo)).then_some(DrawingRefusal::Unmapped)
    }
}

/// Quante foglie degli oggetti scelti (i gruppi passano ai figli) hanno un
/// riempimento pieno: ciò che le fusioni del motore sfumano (`filled_leaves`
/// di `edit.colors.blend*`, con la stessa lettura del colore).
fn riempimenti_pieni(documento: &Document, scelti: &[NodeId]) -> usize {
    fn pieno(nodo: &Node) -> bool {
        match &nodo.kind {
            NodeKind::Text(testo) => testo.first_style().fill.color().is_some(),
            NodeKind::Mesh(trama) => !trama.points.is_empty(),
            NodeKind::Image(_) => {
                nodo.extras().colorize.as_deref().and_then(Paint::color).is_some()
                    || nodo.appearance.fill_paint().color().is_some()
            }
            _ => nodo.appearance.fill_paint().color().is_some(),
        }
    }
    fn conta(nodo: &Node, quanti: &mut usize) {
        match &nodo.kind {
            NodeKind::Group { children, .. } | NodeKind::Layer { children, .. } => {
                for figlio in children {
                    conta(figlio, quanti);
                }
            }
            _ if pieno(nodo) => *quanti += 1,
            _ => {}
        }
    }
    let mut quanti = 0;
    for nodo in scelti.iter().filter_map(|n| documento.node(*n)) {
        conta(nodo, &mut quanti);
    }
    quanti
}

/// Il Contagocce (`eyedropper`, K6 T14 giro 6), come Ruota e le altre
/// trasformazioni (T13 giro 5): il rifiuto che la finestra del comando
/// darebbe, prima che il motore cominci. `clic` è il punto del primo
/// pulsante giù, nello spazio del disegno, con `true` se è un Alt che scrive
/// l'oggetto cliccato (Maiusc+Alt lo lascia come sorgente).
///
/// Senza Alt la selezione è il bersaglio: un pezzo bloccato o non mappato, o
/// un tratto dell'Inchiostro, la rifiutano. La sorgente è l'oggetto sotto il
/// clic: un'immagine o un oggetto non mappato si rifiutano (`unsupported`,
/// `unmapped`); l'Inchiostro di Fub è una sorgente buona, perché il suo colore
/// si prende senza cambiarlo. Con Alt il bersaglio è l'oggetto cliccato, e
/// vale la stessa regola di scrittura.
pub(crate) fn rifiuto_del_contagocce(
    copia: &Copia,
    selezione: &[String],
    clic: Option<(Point, bool)>,
) -> Option<DrawingRefusal> {
    let scrive_il_clic = clic.is_some_and(|(_, alt)| alt);
    if !scrive_il_clic {
        if let Err(motivo) = nodi_scelti(copia, selezione) {
            return Some(motivo);
        }
        if sceglie_inchiostro(copia, selezione) {
            return Some(DrawingRefusal::Unmapped);
        }
    }
    let (punto, _) = clic?;
    let colpito = hit_test_visible(&copia.documento, punto, HitOptions::default())?;
    // Un'immagine non ha un id di Fub: si dice che è un'immagine, non che non è mappata.
    if matches!(copia.documento.node(colpito.leaf).map(|n| &n.kind), Some(NodeKind::Image(_))) {
        return Some(DrawingRefusal::Unsupported);
    }
    let Some(id) = id_del_nodo(copia, colpito.leaf) else {
        return Some(DrawingRefusal::Unmapped);
    };
    if scrive_il_clic {
        let scelto = [id];
        if let Err(motivo) = nodi_scelti(copia, &scelto) {
            return Some(motivo);
        }
        if sceglie_inchiostro(copia, &scelto) {
            return Some(DrawingRefusal::Unmapped);
        }
    }
    None
}

/// L'id del file dell'oggetto `nodo`, se la mappa lo conosce con un id.
fn id_del_nodo(copia: &Copia, nodo: NodeId) -> Option<String> {
    let i = copia.mappa.del_nodo(nodo)?;
    copia.mappa.elemento(i)?.id.clone()
}
