//! La famiglia `livelli` della mappa: le voci di ≡ › Selezione (K6 T15, giro 1; il testo uguale e i
//! punti per specie, giro 6; il testo per carattere e le opzioni della modifica globale, giro 7) e i
//! comandi di livello della scheda Livelli del Completo (giro 3):
//! nuovo livello, elimina, rinomina e colore, occhio, lucchetto, livello corrente e spostamento; e
//! (giro 2) seleziona grafica, unisci e inverti l'ordine, con le loro righe che non valgono ancora.
//! «Maschere di ritaglio» (K6 T12) sceglie le maschere, i `<g clip-path>` del file.
//! Selezionare non cambia il documento: quelle voci non
//! scrivono niente, e il motore dice che cosa seleziona. Un livello si nomina nei suoi argomenti col suo
//! numero del motore, come il motore vuole (`ids`, `id`, `parent`): la scheda lo legge da
//! `document.inspect`. Un livello bloccato si sblocca e si nasconde, ma non si rinomina né si colora.
//! Il formato della scena scrive di un livello il nome, l'occhio e il lucchetto: un nome che non vale
//! è un errore degli argomenti prima del motore, un livello nuovo senza nome prende il primo
//! «Livello N» libero, e le altre opzioni (il colore, il modello, la stampa) sono `Unsupported`.

use std::sync::Arc;

use fub_abi::{DrawingDisabledReason, DrawingRefusal, PluginError};
use fub_motori::{ErroreMotore, Servizi};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::{Document, Node, NodeId, NodeKind};

use super::{nodi_scelti, StatoFamiglia, Tradotto};
use crate::apertura::Copia;
use crate::mappa::nome_di_livello_sbagliato;

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

    /// Le opzioni della modifica globale cambiano la sessione del motore, non il file: rispondono con le
    /// opzioni e con il conteggio di ciò che Avvia prenderebbe, una lettura.
    fn legge(&self, id: &str) -> bool {
        id == "select.globalEditOptions"
    }

    /// Le voci spente col loro perché, prima di chiedere al motore. Il confronto con l'oggetto scelto
    /// (Uguale) e «Tutto sugli stessi livelli» vogliono qualcosa di scelto, e con un oggetto che la mappa
    /// non ha non si usano, come nel nucleo; l'istanza di simbolo vuole un'istanza scelta; il confronto del
    /// testo vuole un testo scelto (o dentro la scelta); «Tutti gli oggetti di testo», i punti isolati e i
    /// tracciati aperti vogliono quella specie nel disegno. I comandi di livello cambiano il documento: sul
    /// disegno di sola lettura non si fanno. Il livello scelto sta negli argomenti (`rifiuto_valore`).
    fn spento(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingDisabledReason> {
        if vuole_selezione(id) && selezione.is_empty() {
            return Some(DrawingDisabledReason::NoSelection);
        }
        if (cambia_il_livello(id) || crea_livello(id) || ALTRI_LIVELLI.contains(&id)) && !copia.modificabile {
            return Some(DrawingDisabledReason::ReadOnly);
        }
        // Con un oggetto che la mappa non ha in selezione, nessun comando che cambia il documento parte.
        if (cambia_il_livello(id) || crea_livello(id) || ALTRI_LIVELLI.contains(&id))
            && matches!(nodi_scelti(copia, selezione), Err(DrawingRefusal::Unmapped))
        {
            return Some(DrawingDisabledReason::Unmapped);
        }
        // `esegui` rifiuta ogni comando con un elemento non mappato in selezione, prima della famiglia: le
        // due voci del giro 7 (il carattere, e le opzioni che contano la scelta) si spengono con lo stesso motivo.
        if matches!(id, "select.font" | "select.globalEditOptions") && matches!(nodi_scelti(copia, selezione), Err(DrawingRefusal::Unmapped)) {
            return Some(DrawingDisabledReason::Unmapped);
        }
        if vuole_selezione(id) {
            match nodi_scelti(copia, selezione) {
                Err(DrawingRefusal::Locked) | Ok(_) => {}
                Err(_) => return Some(DrawingDisabledReason::Unmapped),
            }
        }
        if vuole_testo(id) && !ha_testo(copia, selezione) {
            return Some(DrawingDisabledReason::NeedsText);
        }
        match id {
            "select.same.symbolInstance" => {
                let istanza = |nome: &String| {
                    copia
                        .mappa
                        .dell_id(nome)
                        .and_then(|i| copia.mappa.elemento(i))
                        .is_some_and(|e| e.ruolo == Role::Instance)
                };
                (!selezione.iter().any(istanza)).then(|| DrawingDisabledReason::Other {
                    text: "Non è un'istanza.".into(),
                })
            }
            "select.object.clippingMasks" => {
                (!c_e_una_maschera(copia)).then(|| DrawingDisabledReason::Other {
                    text: "Nel disegno non ci sono maschere di ritaglio.".into(),
                })
            }
            "select.object.textObjects" => {
                let c_e_testo = copia.mappa.elementi().iter().any(|e| e.ruolo == Role::Text);
                (!c_e_testo).then(|| DrawingDisabledReason::Other {
                    text: "Nel disegno non ci sono oggetti di testo.".into(),
                })
            }
            "select.object.strayPoints" => senza_oggetti(copia, e_punto_isolato, "Nel disegno non ci sono punti isolati."),
            "select.object.openPaths" => senza_oggetti(copia, e_tracciato_aperto, "Nel disegno non ci sono tracciati aperti."),
            "select.font" | "select.object.pointText" | "select.object.areaText" => spento_testi(id, copia),
            _ => None,
        }
    }

    fn traduci_dopo(id: &str, copia: &Copia, dopo: &Document) -> Result<Option<Tradotto>, PluginError> {
        Ok(if id == "layer.collectInNew" { nome_della_raccolta(copia, dopo) } else { None })
    }

    /// Il confronto del testo senza un testo fra gli oggetti scelti non parte: `empty`, come un comando
    /// che non tocca niente. Il motore lo direbbe con un errore in inglese («select a text object»).
    fn rifiuto(id: &str, copia: &Copia, selezione: &[String]) -> Option<DrawingRefusal> {
        if matches!(id, "select.object.pointText" | "select.object.areaText") {
            spento_testi(id, copia)?;
            return Some(DrawingRefusal::Empty);
        }
        (vuole_testo(id) && !ha_testo(copia, selezione)).then_some(DrawingRefusal::Empty)
    }

    /// Il nome di un livello, nuovo o rinominato, è quello che il formato tiene
    /// (`nome_di_livello_sbagliato`): se no `BadArgs` col perché, prima del motore. Un livello nuovo
    /// senza nome prende il primo «Livello N» libero, come la scheda nativa.
    fn argomenti_della_copia(id: &str, copia: &Copia, selezione: &[String], mut valore: Value) -> Result<Value, PluginError> {
        if matches!(id, "layer.merge" | "layer.reverse") {
            righe_da_unire_o_invertire(id, copia, &valore)?;
            return Ok(valore);
        }
        if id == "select.font" {
            carattere_da_cercare(copia, &valore)?;
            return Ok(valore);
        }
        if id == "select.globalEditOptions" {
            opzioni_della_modifica_globale(copia, &valore)?;
            return Ok(valore);
        }
        if id == "select.color" {
            colori_da_cercare(&valore)?;
            return Ok(valore);
        }
        if ALTRI_LIVELLI.contains(&id) {
            return Ok(livelli_della_selezione(copia, selezione, valore));
        }
        if !matches!(id, "layer.new" | "layer.newSublayer" | "layer.setProps") {
            return Ok(valore);
        }
        match valore.get("name") {
            Some(Value::String(nome)) => {
                if let Some(perche) = nome_di_livello_sbagliato(nome) {
                    return Err(PluginError::BadArgs(perche.into()));
                }
            }
            Some(Value::Null) | None if id != "layer.setProps" => {
                if !valore.is_object() {
                    valore = Value::Object(serde_json::Map::new());
                }
                if let Some(o) = valore.as_object_mut() {
                    o.insert("name".into(), Value::String(copia.mappa.nome_libero()));
                }
            }
            None => {}
            Some(_) => return Err(PluginError::BadArgs("Il nome del livello dev'essere un testo.".into())),
        }
        Ok(valore)
    }

    /// I livelli negli argomenti: senza nessuno il comando non parte (il motore prenderebbe il livello
    /// corrente, quello da cancellare o da spostare). Un livello bloccato non si cancella, non si sposta
    /// e non si rinomina né si colora; un livello non va dentro se stesso.
    fn rifiuto_valore(id: &str, copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
        match id {
            // Senza maschere nel file il motore sceglierebbe solo ritagli suoi (un `clip-path` scritto
            // su un tracciato), che la selezione di Fub non sa dire: niente da scegliere.
            "select.object.clippingMasks" => (!c_e_una_maschera(copia)).then_some(DrawingRefusal::Empty),
            "layer.setCurrent" => livelli_del_valore(copia, valore).err(),
            // Senza righe negli argomenti i livelli da tenere sono quelli della selezione: senza scelta
            // il motore terrebbe il livello corrente, che la scheda di Fub non mostra. `empty`, come la
            // voce spenta («Scegli qualcosa»).
            "layer.hideOthers" | "layer.lockOthers" => match valore.get("ids").or_else(|| valore.get("id")) {
                None | Some(Value::Null) if selezione.is_empty() => Some(DrawingRefusal::Empty),
                None | Some(Value::Null) => None,
                Some(_) => livelli_del_valore(copia, valore).err(),
            },
            "layer.selectAll" => livelli_del_valore(copia, valore).err(),
            // Unire o invertire cambia l'ordine o il contenuto di un livello bloccato: si rifiuta, con
            // il perché. Le righe senza livello, o poche, le dice `argomenti_della_copia`.
            "layer.merge" | "layer.reverse" => match livelli_del_valore(copia, valore) {
                Ok(livelli) => livelli.iter().any(|&i| bloccato_con_antenati(copia, i)).then_some(DrawingRefusal::Locked),
                Err(motivo) => Some(motivo),
            },
            "layer.delete" => match livelli_del_valore(copia, valore) {
                Ok(livelli) => livelli.iter().any(|&i| bloccato_con_antenati(copia, i)).then_some(DrawingRefusal::Locked),
                Err(motivo) => Some(motivo),
            },
            "layer.setProps" => {
                let livelli = match livelli_del_valore(copia, valore) {
                    Ok(livelli) => livelli,
                    Err(motivo) => return Some(motivo),
                };
                let cambia_nome_o_colore = CHIAVI_DI_UN_LIVELLO_BLOCCATO.iter().any(|chiave| valore.get(*chiave).is_some());
                if cambia_nome_o_colore && livelli.iter().any(|&i| bloccato_con_antenati(copia, i)) {
                    return Some(DrawingRefusal::Locked);
                }
                fuori_dal_formato(valore)
            }
            "layer.new" => fuori_dal_formato(valore),
            "layer.newSublayer" => genitore_del_sottolivello(copia, valore).or_else(|| fuori_dal_formato(valore)),
            // Raccogli in un nuovo livello: le righe date, o senza righe gli oggetti scelti (quelli
            // bloccati li ha già rifiutati `esegui`). Toglierle da un livello bloccato lo cambia.
            "layer.collectInNew" => match valore.get("ids") {
                None | Some(Value::Null) => selezione.is_empty().then_some(DrawingRefusal::Empty),
                Some(_) => match livelli_del_valore(copia, valore) {
                    Ok(righe) => righe.iter().any(|&i| bloccato_con_antenati(copia, i)).then_some(DrawingRefusal::Locked),
                    Err(motivo) => Some(motivo),
                },
            },
            // Duplica livello copia le righe che la scheda Livelli manda (anche un livello bloccato:
            // la copia resta bloccata, come in VectorCraft); senza righe il motore copierebbe il
            // livello corrente del motore, che non è quello del client.
            "layer.duplicate" => livelli_del_valore(copia, valore).err(),
            "layer.move" => righe_da_spostare(copia, valore),
            "layer.flatten" => livello_da_appiattire(copia, valore),
            "layer.clippingMask.toggle" => livello_che_ritaglia(copia, selezione, valore),
            "node.move" => {
                let Some(chi) = valore.get("id").and_then(Value::as_u64) else {
                    return Some(DrawingRefusal::Empty);
                };
                let Some(chi) = copia.mappa.del_nodo(NodeId(chi)) else {
                    return Some(DrawingRefusal::Unmapped);
                };
                if bloccato_con_antenati(copia, chi) {
                    return Some(DrawingRefusal::Locked);
                }
                match valore.get("parent") {
                    None | Some(Value::Null) => None,
                    Some(parent) => {
                        let Some(parent) = parent.as_u64().and_then(|n| copia.mappa.del_nodo(NodeId(n))) else {
                            return Some(DrawingRefusal::Unmapped);
                        };
                        dentro_se_stesso(copia, chi, parent).then_some(DrawingRefusal::Unsupported)
                    }
                }
            }
            _ => None,
        }
    }
}

/// I comandi di ≡ › Selezione che lavorano su ciò che è scelto: il confronto con
/// l'oggetto scelto, e «Tutto sugli stessi livelli». Gli altri lavorano su tutto
/// il disegno.
fn vuole_selezione(id: &str) -> bool {
    id.starts_with("select.same.") || id == "select.object.allOnSameLayers" || ALTRI_LIVELLI.contains(&id)
}

/// Nascondi altri e Blocca altri (≡ › Livelli): tengono i livelli di primo livello di ciò che è scelto
/// e nascondono o bloccano gli altri. Il motore, senza righe negli argomenti, terrebbe il livello
/// corrente; Fub gli dà i livelli della selezione (`livelli_della_selezione`).
const ALTRI_LIVELLI: [&str; 2] = ["layer.hideOthers", "layer.lockOthers"];

/// Gli argomenti di Nascondi altri e Blocca altri con le righe da tenere: quelle date, o, senza, i
/// livelli di primo livello degli oggetti scelti, nell'ordine della selezione e senza doppioni. Gli
/// oggetti che la mappa non ha o che sono bloccati li ha già rifiutati `esegui`.
fn livelli_della_selezione(copia: &Copia, selezione: &[String], mut valore: Value) -> Value {
    if valore.get("ids").or_else(|| valore.get("id")).is_some_and(|v| !v.is_null()) {
        return valore;
    }
    let Ok(nodi) = nodi_scelti(copia, selezione) else {
        return valore;
    };
    let mut livelli: Vec<u64> = Vec::new();
    for livello in nodi.into_iter().filter_map(|n| copia.documento.layer_of(n)) {
        if !livelli.contains(&livello.0) {
            livelli.push(livello.0);
        }
    }
    if livelli.is_empty() {
        return valore;
    }
    if !valore.is_object() {
        valore = Value::Object(serde_json::Map::new());
    }
    if let Some(o) = valore.as_object_mut() {
        o.remove("id");
        o.insert("ids".into(), Value::from(livelli));
    }
    valore
}

/// I comandi che cambiano il documento su un livello: la scheda Livelli li chiama con il suo livello.
fn cambia_il_livello(id: &str) -> bool {
    matches!(
        id,
        "layer.delete" | "layer.setProps" | "layer.merge" | "layer.reverse" | "node.move" | "layer.move" | "layer.flatten" | "layer.clippingMask.toggle"
    )
}

/// Unire e invertire (T15, giro 2): le righe del comando sono almeno due, e unire vuole dei livelli
/// (il motore dice «highlight a layer to merge into» in inglese, qui si dice in italiano); invertire
/// vuole righe che stanno nello stesso livello o gruppo. Un argomento sbagliato è `BadArgs` col perché,
/// prima del motore. Le righe che la mappa non ha sono già passate da `rifiuto_valore`.
fn righe_da_unire_o_invertire(id: &str, copia: &Copia, valore: &Value) -> Result<(), PluginError> {
    let Ok(livelli) = livelli_del_valore(copia, valore) else {
        return Ok(());
    };
    let mut distinte = livelli;
    distinte.sort_unstable();
    distinte.dedup();
    if distinte.len() < 2 {
        let perche = if id == "layer.merge" {
            "Per unire servono almeno due livelli."
        } else {
            "Per invertire l'ordine servono almeno due righe."
        };
        return Err(PluginError::BadArgs(perche.into()));
    }
    if id == "layer.merge" {
        if distinte.iter().any(|&i| copia.mappa.elemento(i).is_none_or(|e| e.ruolo != Role::Layer)) {
            return Err(PluginError::BadArgs("Per unire servono livelli, non oggetti: scegli dei livelli.".into()));
        }
        return Ok(());
    }
    let genitori: Vec<Option<usize>> = distinte.iter().map(|&i| copia.mappa.elemento(i).and_then(|e| e.genitore)).collect();
    if genitori.iter().any(|g| *g != genitori[0]) {
        return Err(PluginError::BadArgs("Per invertire l'ordine le righe devono stare nello stesso livello o gruppo.".into()));
    }
    Ok(())
}

/// Nuovo livello, Nuovo sottolivello, Duplica livello e Raccogli in un nuovo livello non vogliono
/// un oggetto scelto, ma cambiano il documento.
fn crea_livello(id: &str) -> bool {
    matches!(id, "layer.new" | "layer.newSublayer" | "layer.duplicate" | "layer.collectInNew")
}

/// Il genitore di Nuovo sottolivello (`parent`) è un livello della mappa e non è bloccato: senza
/// genitore il motore prenderebbe il suo livello corrente, che non è quello della scheda Livelli
/// (`empty`, come Duplica livello senza righe). Un oggetto o un gruppo non prende un sottolivello.
fn genitore_del_sottolivello(copia: &Copia, valore: &Value) -> Option<DrawingRefusal> {
    let genitore = match valore.get("parent") {
        None | Some(Value::Null) => return Some(DrawingRefusal::Empty),
        Some(v) => match v.as_u64().and_then(|n| copia.mappa.del_nodo(NodeId(n))) {
            Some(g) => g,
            None => return Some(DrawingRefusal::Unmapped),
        },
    };
    if copia.mappa.elemento(genitore).is_none_or(|e| e.ruolo != Role::Layer) {
        return Some(DrawingRefusal::Unsupported);
    }
    bloccato_con_antenati(copia, genitore).then_some(DrawingRefusal::Locked)
}

/// Il livello che ritaglia (`layer.clippingMask.toggle`): la riga `id`, un livello o un gruppo, o
/// senza riga il gruppo scelto da solo. Senza l'una né l'altro il motore prenderebbe il suo livello
/// corrente, che non è quello del client: `empty`. Un livello o un gruppo bloccato non cambia; uno
/// vuoto non ha con che ritagliare (`empty`), e uno con in cima un gruppo, un'immagine o un testo
/// non si fa (`unsupported`).
fn livello_che_ritaglia(copia: &Copia, selezione: &[String], valore: &Value) -> Option<DrawingRefusal> {
    let nodo = match valore.get("id") {
        None | Some(Value::Null) => match nodi_scelti(copia, selezione).as_deref() {
            Ok([scelto]) => *scelto,
            Err(DrawingRefusal::Unmapped) => return Some(DrawingRefusal::Unmapped),
            _ => return Some(DrawingRefusal::Empty),
        },
        Some(v) => match v.as_u64() {
            Some(n) => NodeId(n),
            None => return Some(DrawingRefusal::Unmapped),
        },
    };
    let Some(riga) = copia.mappa.del_nodo(nodo) else {
        return Some(DrawingRefusal::Unmapped);
    };
    let ruolo = copia.mappa.elemento(riga).map(|e| e.ruolo);
    // Senza un id il motore prende un gruppo scelto da solo: un altro oggetto scelto non conta.
    if valore.get("id").is_none_or(Value::is_null) && ruolo != Some(Role::Group) {
        return Some(DrawingRefusal::Empty);
    }
    if !matches!(ruolo, Some(Role::Layer | Role::Group)) {
        return Some(DrawingRefusal::Unsupported);
    }
    if bloccato_con_antenati(copia, riga) {
        return Some(DrawingRefusal::Locked);
    }
    // Fare il ritaglio vuole un oggetto in cima che sia un tracciato (anche composto): un livello
    // vuoto non ha niente con cui ritagliare, e un gruppo o un'immagine in cima non ritagliano. Il
    // testo che ritaglia il file non lo scrive ancora.
    let n = copia.documento.node(nodo)?;
    if n.clips() {
        return None;
    }
    match n.children().and_then(|f| f.last()).map(|c| &c.kind) {
        None => Some(DrawingRefusal::Empty),
        Some(NodeKind::Path { guide: false, .. } | NodeKind::Compound { .. }) => None,
        Some(_) => Some(DrawingRefusal::Unsupported),
    }
}

/// Il livello che Raccogli in un nuovo livello crea prende il primo «Livello N» libero, come Nuovo
/// livello: il motore lo chiamerebbe «Layer N», e non ha un argomento per il nome.
fn nome_della_raccolta(copia: &Copia, dopo: &Document) -> Option<Tradotto> {
    let mut nuovi = Vec::new();
    dopo.walk(|n| {
        if n.is_layer() && copia.documento.node(n.id).is_none() {
            nuovi.push(n.id);
        }
    });
    let [nuovo] = nuovi[..] else { return None };
    let mut documento = dopo.clone();
    documento.node_mut(nuovo)?.name = Some(copia.mappa.nome_libero());
    Some(Tradotto { documento, perdite: Vec::new() })
}

/// Le voci di Uguale che confrontano il testo scelto: vogliono un testo fra gli oggetti scelti.
fn vuole_testo(id: &str) -> bool {
    matches!(
        id,
        "select.same.fontFamily"
            | "select.same.fontFamilyStyle"
            | "select.same.fontFamilyStyleSize"
            | "select.same.fontSize"
            | "select.same.textFillColor"
            | "select.same.textStrokeColor"
    )
}

/// C'è un testo fra gli oggetti scelti, o dentro uno di loro (un gruppo): il motore confronta con il primo
/// testo che trova nella scelta. Un id che la mappa non ha non è un testo.
fn ha_testo(copia: &Copia, selezione: &[String]) -> bool {
    selezione.iter().any(|id| {
        let nodo = copia
            .mappa
            .dell_id(id)
            .and_then(|i| copia.mappa.elemento(i))
            .and_then(|e| e.nodo)
            .and_then(|n| copia.documento.node(n));
        let mut testo = false;
        if let Some(nodo) = nodo {
            nodo.walk(&mut |c| testo |= matches!(c.kind, NodeKind::Text(_)));
        }
        testo
    })
}

/// Il perché di una voce di ≡ › Selezione › Oggetto quando il disegno non ha la specie che cerca. Il motore
/// sceglie per specie (`by_kind`) e la specie si legge dal suo documento, che la copia tiene. Il controllo
/// guarda tutto il documento, anche gli oggetti nascosti o bloccati, come «Tutti gli oggetti di testo»: la
/// voce resta accesa anche se il motore non ne sceglie nessuno.
fn senza_oggetti(copia: &Copia, specie: fn(&Node) -> bool, perche: &str) -> Option<DrawingDisabledReason> {
    let mut c_e = false;
    copia.documento.walk(|n| c_e |= specie(n));
    (!c_e).then(|| DrawingDisabledReason::Other { text: perche.into() })
}

fn spento_testi(id: &str, copia: &Copia) -> Option<DrawingDisabledReason> {
    let (specie, assenti, nascosti): (fn(&Node) -> bool, &str, &str) = match id {
        "select.object.pointText" => (
            e_testo_di_punto,
            "Nel disegno non ci sono testi di punto.",
            "I testi di punto sono nascosti o bloccati: il motore non li sceglie.",
        ),
        "select.object.areaText" => (
            e_testo_in_area,
            "Nel disegno non ci sono testi in area.",
            "I testi in area sono nascosti o bloccati: il motore non li sceglie.",
        ),
        "select.font" => (
            e_testo,
            "Nel disegno non ci sono testi.",
            "I testi sono nascosti o bloccati: il motore non li sceglie.",
        ),
        _ => return None,
    };
    if let Some(perche) = senza_oggetti(copia, specie, assenti) {
        return Some(perche);
    }
    // Un testo è scelto se è visibile e sbloccato, lui e i suoi livelli e gruppi (il motore non prende
    // gli altri: un testo su un livello bloccato o nascosto resta fuori).
    let c_e_scelto = copia.mappa.elementi().iter().enumerate().any(|(i, e)| {
        e.ruolo == Role::Text
            && !bloccato_con_antenati(copia, i)
            && !nascosto_con_antenati(copia, i)
            && e.nodo.and_then(|n| copia.documento.node(n)).is_some_and(specie)
    });
    (!c_e_scelto).then(|| DrawingDisabledReason::Other { text: nascosti.into() })
}

/// L'elemento `i` o un suo antenato è nascosto nella mappa.
fn nascosto_con_antenati(copia: &Copia, mut i: usize) -> bool {
    loop {
        let Some(e) = copia.mappa.elemento(i) else {
            return false;
        };
        if e.nascosto {
            return true;
        }
        match e.genitore {
            Some(genitore) => i = genitore,
            None => return false,
        }
    }
}

/// Un testo di punto, come «Oggetti testo per punti»: il motore lo dice `TextKind::Point`.
fn e_testo_di_punto(n: &Node) -> bool {
    matches!(&n.kind, NodeKind::Text(t) if matches!(t.kind, vectorcraft_doc::TextKind::Point))
}

/// Un testo in area, come «Oggetti testo in area»: il testo con `fub:wrap` che il motore apre in area.
fn e_testo_in_area(n: &Node) -> bool {
    matches!(&n.kind, NodeKind::Text(t) if matches!(t.kind, vectorcraft_doc::TextKind::Area { .. }))
}

/// Un punto isolato: un tracciato con un solo punto, come «Punti isolati».
fn e_punto_isolato(n: &Node) -> bool {
    n.path_data().is_some_and(|p| p.anchor_count() == 1)
}

/// Un tracciato aperto, come «Tracciati aperti»: un tracciato che non è chiuso (`!is_closed`).
fn e_tracciato_aperto(n: &Node) -> bool {
    n.path_data().is_some_and(|p| !p.is_closed())
}

/// Un testo di qualunque specie: il perché di «Seleziona testo per font» quando il disegno non ne ha.
fn e_testo(n: &Node) -> bool {
    matches!(n.kind, NodeKind::Text(_))
}

/// Il carattere di «Seleziona testo per font» (K6 T15, giro 7). Il motore sceglie i testi che hanno
/// `family` (e `style`, se c'è) in una delle loro parti, fra quelli che si possono toccare: la scelta
/// della selezione non conta, il carattere è l'argomento. Senza un carattere, o con uno stile che non è
/// un testo non vuoto, è `BadArgs`. Un carattere che nel disegno non c'è, o c'è solo su testi nascosti o
/// bloccati, dice perché in italiano, prima del motore: il motore non sceglie niente e non lo dice.
fn carattere_da_cercare(copia: &Copia, valore: &Value) -> Result<(), PluginError> {
    let famiglia = match valore.get("family") {
        Some(Value::String(f)) if !f.is_empty() => f.as_str(),
        _ => return Err(PluginError::BadArgs("Scegli il carattere da cercare.".into())),
    };
    let stile = match valore.get("style") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if !s.is_empty() => Some(s.as_str()),
        Some(_) => return Err(PluginError::BadArgs("Lo stile del carattere dev'essere un testo, non vuoto.".into())),
    };
    let modificabile = copia.documento.editable();
    let (mut c_e, mut scelto) = (false, false);
    copia.documento.walk(|n| {
        if testo_in_carattere(n, famiglia, stile) {
            c_e = true;
            scelto |= modificabile(n.id);
        }
    });
    let nome = nome_del_carattere(famiglia, stile);
    if !c_e {
        return Err(PluginError::BadArgs(format!("Nel disegno non ci sono testi con il carattere {nome}.").into()));
    }
    if !scelto {
        return Err(PluginError::BadArgs(
            format!("I testi con il carattere {nome} sono nascosti o bloccati: il motore non li sceglie.").into(),
        ));
    }
    Ok(())
}

/// Un testo che ha il carattere, e lo stile se c'è, in una delle sue parti. Il confronto è senza
/// maiuscole, come quello del motore (`select.font`).
fn testo_in_carattere(n: &Node, famiglia: &str, stile: Option<&str>) -> bool {
    matches!(&n.kind, NodeKind::Text(t) if t.runs.iter().any(|r| {
        r.style.font_family.eq_ignore_ascii_case(famiglia)
            && stile.is_none_or(|s| r.style.font_style.eq_ignore_ascii_case(s))
    }))
}

/// Il carattere come lo dice un messaggio: «Georgia», o «Georgia» nello stile «Italic».
fn nome_del_carattere(famiglia: &str, stile: Option<&str>) -> String {
    match stile {
        None => format!("«{famiglia}»"),
        Some(s) => format!("«{famiglia}» nello stile «{s}»"),
    }
}

/// Le opzioni di «Opzioni modifica globale» (K6 T15, giro 7): `appearance`, `size` e `includeCanvas` sono
/// vero o falso, e `artboards` è `all` o un intervallo di tavole del disegno, come `1, 3-5`. Un valore che
/// non è questo è `BadArgs` col perché, prima del motore (che lo direbbe in inglese).
fn opzioni_della_modifica_globale(copia: &Copia, valore: &Value) -> Result<(), PluginError> {
    for chiave in ["appearance", "size", "includeCanvas"] {
        if !matches!(valore.get(chiave), None | Some(Value::Null) | Some(Value::Bool(_))) {
            return Err(PluginError::BadArgs(format!("«{chiave}» dev'essere vero o falso.").into()));
        }
    }
    let intervallo = match valore.get("artboards") {
        None | Some(Value::Null) => return Ok(()),
        Some(Value::String(s)) if s.trim().is_empty() || s.trim().eq_ignore_ascii_case("all") => return Ok(()),
        Some(Value::String(s)) => s,
        Some(_) => return Err(PluginError::BadArgs(TAVOLE_SBAGLIATE.into())),
    };
    vectorcraft_doc::range::parse_range(intervallo, copia.documento.artboards.len())
        .map(|_| ())
        .map_err(|_| PluginError::BadArgs(TAVOLE_SBAGLIATE.into()))
}

/// Il perché di `artboards` che non va, in italiano.
const TAVOLE_SBAGLIATE: &str = "Le tavole vanno indicate con «all» o con un intervallo, per esempio 1, 3-5.";

/// Le chiavi di `layer.setProps` che un livello bloccato non prende.
const CHIAVI_DI_UN_LIVELLO_BLOCCATO: [&str; 6] = ["name", "color", "template", "printable", "preview", "dimImages"];

/// Le opzioni di un livello che il formato della scena non ha (§3: un livello ha nome, blocco e
/// visibilità): il colore, il modello, la stampa, l'anteprima e le immagini sbiadite. Chiederle è
/// `unsupported`, prima del motore, e niente cambia.
const OPZIONI_FUORI_DAL_FORMATO: [&str; 5] = ["color", "template", "printable", "preview", "dimImages"];

/// `unsupported` se gli argomenti chiedono un'opzione di [`OPZIONI_FUORI_DAL_FORMATO`].
fn fuori_dal_formato(valore: &Value) -> Option<DrawingRefusal> {
    OPZIONI_FUORI_DAL_FORMATO
        .iter()
        .any(|chiave| valore.get(*chiave).is_some())
        .then_some(DrawingRefusal::Unsupported)
}

/// I livelli che il comando nomina nei suoi argomenti, con `ids` o con `id`, come elementi della mappa.
/// Nessuno è `empty`; un numero che la mappa non ha, o che non è un numero, è `unmapped`.
fn livelli_del_valore(copia: &Copia, valore: &Value) -> Result<Vec<usize>, DrawingRefusal> {
    let mut nomi: Vec<&Value> = valore.get("ids").and_then(Value::as_array).map(|lista| lista.iter().collect()).unwrap_or_default();
    nomi.extend(valore.get("id"));
    if nomi.is_empty() {
        return Err(DrawingRefusal::Empty);
    }
    nomi.into_iter()
        .map(|nome| {
            let n = nome.as_u64().ok_or(DrawingRefusal::Unmapped)?;
            copia.mappa.del_nodo(NodeId(n)).ok_or(DrawingRefusal::Unmapped)
        })
        .collect()
}

/// Vero se il file ha una maschera di ritaglio, un `<g clip-path>` della mappa. Il motore sceglie i
/// tracciati che ritagliano, e nel file ciascuno vale per la sua maschera (`selezione_di_fub`).
fn c_e_una_maschera(copia: &Copia) -> bool {
    copia.mappa.elementi().iter().any(|e| {
        e.nodo
            .and_then(|n| copia.documento.node(n))
            .is_some_and(|n| matches!(n.kind, vectorcraft_doc::NodeKind::Group { clip: true, .. }))
    })
}

/// Sposta righe (`layer.move`, il trascinamento nella scheda Livelli): le righe e il bersaglio sono
/// nella mappa; senza righe o senza bersaglio non parte (`empty`). Come in VectorCraft un livello o un
/// gruppo bloccato non prende niente, e una riga non va dentro se stessa; in più, come gli altri
/// comandi delle righe di Fub, una riga bloccata non si sposta (la sua copia, con `copy`, sì).
fn righe_da_spostare(copia: &Copia, valore: &Value) -> Option<DrawingRefusal> {
    let righe = match livelli_del_valore(copia, valore) {
        Ok(righe) => righe,
        Err(motivo) => return Some(motivo),
    };
    let bersaglio = match valore.get("target") {
        None | Some(Value::Null) => return Some(DrawingRefusal::Empty),
        Some(t) => match t.as_u64().and_then(|n| copia.mappa.del_nodo(NodeId(n))) {
            Some(b) => b,
            None => return Some(DrawingRefusal::Unmapped),
        },
    };
    if righe.iter().any(|&r| dentro_se_stesso(copia, r, bersaglio)) {
        return Some(DrawingRefusal::Unsupported);
    }
    let copia_soltanto = valore.get("copy").and_then(Value::as_bool).unwrap_or(false);
    if !copia_soltanto && righe.iter().any(|&r| bloccato_con_antenati(copia, r)) {
        return Some(DrawingRefusal::Locked);
    }
    let dentro = matches!(valore.get("place").and_then(Value::as_str), None | Some("inside" | "into"));
    let genitore = if dentro { Some(bersaglio) } else { copia.mappa.elemento(bersaglio).and_then(|e| e.genitore) };
    genitore.is_some_and(|g| bloccato_con_antenati(copia, g)).then_some(DrawingRefusal::Locked)
}

/// Appiattisci (`layer.flatten`): tutto finisce nel livello della riga data, i livelli nascosti si
/// scartano. Senza riga non parte (`empty`: il motore prenderebbe il suo livello corrente, che non è
/// quello del client); un livello nascosto non prende niente (`hidden`, come in VectorCraft); e poiché
/// ogni livello cambia, uno bloccato lo ferma (`locked`).
fn livello_da_appiattire(copia: &Copia, valore: &Value) -> Option<DrawingRefusal> {
    let riga = match valore.get("id") {
        None | Some(Value::Null) => return Some(DrawingRefusal::Empty),
        Some(v) => match v.as_u64().and_then(|n| copia.mappa.del_nodo(NodeId(n))) {
            Some(r) => r,
            None => return Some(DrawingRefusal::Unmapped),
        },
    };
    let mut livello = riga;
    while let Some(g) = copia.mappa.elemento(livello).and_then(|e| e.genitore) {
        livello = g;
    }
    if nascosto_con_antenati(copia, livello) {
        return Some(DrawingRefusal::Hidden);
    }
    copia
        .mappa
        .elementi()
        .iter()
        .any(|e| e.ruolo == Role::Layer && e.bloccato)
        .then_some(DrawingRefusal::Locked)
}

/// Seleziona per colore (`select.color`): almeno uno fra `fill` e `stroke`, e ciascuno un colore che
/// il motore legge; se no `BadArgs` in italiano, prima del motore (che lo direbbe in inglese).
fn colori_da_cercare(valore: &Value) -> Result<(), PluginError> {
    let mut uno = false;
    for (chiave, nome) in [("fill", "riempimento"), ("stroke", "contorno")] {
        match valore.get(chiave) {
            None | Some(Value::Null) => {}
            Some(v) => {
                if vectorcraft_engine::cmd::color_value(v).is_none() {
                    return Err(PluginError::BadArgs(format!("Il colore del {nome} non si legge: scrivilo come #rrggbb.").into()));
                }
                uno = true;
            }
        }
    }
    if uno {
        Ok(())
    } else {
        Err(PluginError::BadArgs("Scegli un colore di riempimento, di contorno o tutti e due.".into()))
    }
}

/// Il livello `i`, o un suo antenato, è bloccato nella mappa.
fn bloccato_con_antenati(copia: &Copia, mut i: usize) -> bool {
    loop {
        let Some(e) = copia.mappa.elemento(i) else {
            return false;
        };
        if e.bloccato {
            return true;
        }
        match e.genitore {
            Some(genitore) => i = genitore,
            None => return false,
        }
    }
}

/// Il livello `chi` sta dentro `parent`, o dentro un suo discendente: dentro se stesso.
fn dentro_se_stesso(copia: &Copia, chi: usize, parent: usize) -> bool {
    let mut j = Some(parent);
    while let Some(i) = j {
        if i == chi {
            return true;
        }
        j = copia.mappa.elemento(i).and_then(|e| e.genitore);
    }
    false
}
