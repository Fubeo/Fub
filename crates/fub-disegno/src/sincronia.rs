//! La sincronia fra la copia nel motore e il testo del file.
//!
//! Il disegno tiene il testo com'è sul client (a capo LF) e la sua
//! revisione. Un `sync` porta le modifiche del testo (`edits` in unità
//! UTF-16, o il testo intero): si controllano le lunghezze e il testo
//! cancellato, la revisione avanza e la copia si reimporta in sottofondo
//! (`Servizi::lavori().in_sottofondo`), perché un import grande non tenga
//! ferma la risposta.
//!
//! Un gesto alla revisione del testo, se il reimport non è ancora finito, lo
//! aspetta; a un'altra revisione è `stale`. Un reimport che fallisce (XML
//! rotto a metà di una modifica) lascia la copia alla revisione vecchia: i
//! gesti sono `stale` finché non arriva un testo buono. Il risultato di un
//! reimport superato da un testo più nuovo si butta.

use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use fub_abi::{
    DrawingChange, DrawingEdit, DrawingRefusal, DrawingSync, DrawingSynced, PluginError,
    MAX_DRAWING_TEXT_BYTES,
};
use fub_motori::Lavori;

use crate::apertura::{importa, Copia, ErroreApertura};

/// Quanto un gesto aspetta il reimport prima di rispondere `not_ready`.
pub const ATTESA_MASSIMA: Duration = Duration::from_secs(30);

/// Il reimport in corso e il suo esito.
#[derive(Default)]
struct Stato {
    /// L'ultima revisione chiesta.
    chiesta: u64,
    /// L'esito del reimport dell'ultima revisione chiesta, quando c'è.
    pronta: Option<(u64, Result<Copia, ErroreApertura>)>,
}

#[derive(Default)]
struct Attesa {
    stato: Mutex<Stato>,
    finito: Condvar,
}

/// Il testo tenuto, la sua revisione e la copia importata.
pub(crate) struct Sincronia {
    testo: String,
    revisione: u64,
    attesa: Arc<Attesa>,
}

/// Che cosa sa un gesto prima di partire.
pub(crate) enum Pronta {
    /// La copia è alla revisione del testo.
    Gia,
    /// Il reimport è appena finito: ecco la copia nuova da installare.
    Nuova(Box<Copia>),
}

impl Sincronia {
    /// Il testo aperto alla revisione 0.
    pub fn nuova(testo: String) -> Self {
        Self {
            testo,
            revisione: 0,
            attesa: Arc::new(Attesa::default()),
        }
    }

    /// La revisione del testo tenuto.
    pub fn revisione(&self) -> u64 {
        self.revisione
    }

    /// Il testo tenuto.
    pub fn testo(&self) -> &str {
        &self.testo
    }

    /// Applica `sync` al testo tenuto e avvia il reimport.
    ///
    /// Le modifiche valgono solo su una revisione più nuova di quella tenuta
    /// e solo se le lunghezze e il testo cancellato tornano (`bad_args`
    /// altrimenti: il client manda allora il testo intero). Il testo intero
    /// vale sempre, a qualunque revisione: è il modo in cui il client
    /// rimette in pari una copia rimasta indietro.
    pub fn applica(
        &mut self,
        sync: &DrawingSync,
        lavori: &Lavori,
    ) -> Result<DrawingSynced, PluginError> {
        sync.validate()?;
        let testo = match &sync.change {
            DrawingChange::Text { text } => text.clone(),
            DrawingChange::Edits {
                edits,
                length_before,
                length_after,
            } => {
                if sync.revision <= self.revisione {
                    return Err(PluginError::BadArgs(
                        format!(
                            "la revisione {} non è più nuova di quella tenuta, {}",
                            sync.revision, self.revisione
                        )
                        .into(),
                    ));
                }
                applica_modifiche(&self.testo, edits, *length_before, *length_after)?
            }
        };
        if testo.len() > MAX_DRAWING_TEXT_BYTES {
            return Err(PluginError::BadArgs(
                format!(
                    "il testo ha {} byte, al più {MAX_DRAWING_TEXT_BYTES}",
                    testo.len()
                )
                .into(),
            ));
        }
        self.testo = testo;
        self.revisione = sync.revision;
        self.reimporta(lavori);
        Ok(DrawingSynced {
            revision: self.revisione,
        })
    }

    fn reimporta(&self, lavori: &Lavori) {
        let revisione = self.revisione;
        {
            let mut stato = self
                .attesa
                .stato
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            stato.chiesta = revisione;
            stato.pronta = None;
        }
        let testo = self.testo.clone();
        let attesa = Arc::clone(&self.attesa);
        lavori.in_sottofondo(move || {
            // Prima di leggere: un testo già superato non si importa.
            if attesa
                .stato
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .chiesta
                != revisione
            {
                return;
            }
            let esito = match vectorcraft_engine::guard::catch_panic(|| importa(&testo, revisione))
            {
                Ok(esito) => esito,
                Err(panico) => Err(ErroreApertura::Panico(panico)),
            };
            let mut stato = attesa.stato.lock().unwrap_or_else(PoisonError::into_inner);
            // Un risultato vecchio non copre lo stato nuovo.
            if stato.chiesta == revisione {
                stato.pronta = Some((revisione, esito));
                attesa.finito.notify_all();
            }
        });
    }

    /// Prima di un gesto alla revisione `revisione` su una copia importata
    /// alla revisione `importata`: aspetta il reimport se serve.
    pub fn pronta(
        &self,
        revisione: u64,
        importata: u64,
        massimo: Duration,
    ) -> Result<Pronta, DrawingRefusal> {
        if revisione != self.revisione {
            return Err(DrawingRefusal::Stale);
        }
        if importata == self.revisione {
            return Ok(Pronta::Gia);
        }
        let fine = Instant::now() + massimo;
        let mut stato = self
            .attesa
            .stato
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        loop {
            match &stato.pronta {
                Some((r, Ok(_))) if *r == self.revisione => {
                    let Some((_, Ok(copia))) = stato.pronta.take() else {
                        return Err(DrawingRefusal::NotReady);
                    };
                    return Ok(Pronta::Nuova(Box::new(copia)));
                }
                // Il reimport è fallito: la copia resta vecchia.
                Some((r, Err(_))) if *r == self.revisione => return Err(DrawingRefusal::Stale),
                _ => {}
            }
            let adesso = Instant::now();
            if adesso >= fine {
                return Err(DrawingRefusal::NotReady);
            }
            stato = self
                .attesa
                .finito
                .wait_timeout(stato, fine - adesso)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

/// `testo` con le modifiche `edits` (offset UTF-16 sul testo a LF).
fn applica_modifiche(
    testo: &str,
    edits: &[DrawingEdit],
    prima: u32,
    dopo: u32,
) -> Result<String, PluginError> {
    let unita = testo.encode_utf16().count();
    if unita != prima as usize {
        return Err(PluginError::BadArgs(
            format!("il testo tenuto ha {unita} unità, la modifica ne aspetta {prima}").into(),
        ));
    }
    let mut out = String::with_capacity(testo.len());
    let mut byte = 0usize;
    let mut u16_at = 0usize;
    let mut chars = testo.char_indices().peekable();
    // Il byte che corrisponde all'unità UTF-16 `target`, da dove si è.
    let mut avanza = |target: usize| -> Result<usize, PluginError> {
        while u16_at < target {
            let Some((_, c)) = chars.next() else { break };
            u16_at += c.len_utf16();
            byte += c.len_utf8();
        }
        if u16_at != target {
            return Err(PluginError::BadArgs(
                "una modifica taglia un carattere a metà".into(),
            ));
        }
        Ok(byte)
    };
    let mut copiato = 0usize;
    for (i, e) in edits.iter().enumerate() {
        let da = avanza(e.from as usize)?;
        let a = avanza(e.to as usize)?;
        if testo.get(da..a) != Some(e.deleted.as_str()) {
            return Err(PluginError::BadArgs(
                format!("`change.edits[{i}].deleted` non è il testo tenuto").into(),
            ));
        }
        out.push_str(&testo[copiato..da]);
        out.push_str(&e.inserted);
        copiato = a;
    }
    out.push_str(&testo[copiato..]);
    if out.encode_utf16().count() != dopo as usize {
        return Err(PluginError::BadArgs(
            "la lunghezza dopo le modifiche non torna".into(),
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(from: u32, to: u32, deleted: &str, inserted: &str) -> DrawingEdit {
        DrawingEdit {
            from,
            to,
            deleted: deleted.into(),
            inserted: inserted.into(),
        }
    }

    #[test]
    fn modifiche_utf16() {
        let t = "aé😀b";
        // a=0, é=1, 😀=2..4, b=4
        assert_eq!(
            applica_modifiche(t, &[edit(4, 5, "b", "c")], 5, 5).expect("ok"),
            "aé😀c"
        );
        assert_eq!(
            applica_modifiche(t, &[edit(0, 1, "a", ""), edit(2, 4, "😀", "x")], 5, 3).expect("ok"),
            "éxb"
        );
        assert!(
            applica_modifiche(t, &[edit(3, 4, "?", "")], 5, 4).is_err(),
            "mezzo carattere"
        );
        assert!(
            applica_modifiche(t, &[edit(0, 1, "z", "")], 5, 4).is_err(),
            "testo cancellato diverso"
        );
        assert!(
            applica_modifiche(t, &[edit(0, 1, "a", "")], 6, 5).is_err(),
            "lunghezza prima"
        );
    }
}
