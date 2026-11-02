//! Il motore dei documenti nello strato dei motori (ADR 0236,
//! `docs/architecture/motori.md`).
//!
//! WordCraft in Fub è fatto di codec senza stato: ciò che resta in memoria fra
//! un'apertura e l'altra sono le prove a vuoto accettate
//! ([`crate::preservation`]), che per un documento grande pesano centinaia di
//! megabyte. Il motore dei documenti è quella memoria: nasce alla prima prova
//! da ricordare, la sua cache sta nel budget comune dei motori, e il budget la
//! toglie dalla meno usata di recente quando supera il tetto. Una prova tolta
//! non perde niente: il salvataggio che non la trova la rifà dagli stessi
//! byte, più lento.
//!
//! Il motore si iscrive nel registro dei motori del processo con lo spazio
//! [`SPAZIO`] e le estensioni di ogni [`Codec`], la prima volta che un
//! [`crate::RichProvider`] si crea o che una prova si ricorda; iscriversi non
//! lo costruisce.

use std::sync::{Arc, OnceLock};

use fub_motori::{Cache, ErroreMotore, Motori, Pigro, Servizi, Voce};

use crate::preservation::{Baseline, Baselines};
use crate::Codec;

/// Lo spazio del motore dei documenti nel registro dei motori.
pub const SPAZIO: &str = "documenti";

/// Le estensioni che il motore apre: quelle di ogni [`Codec`], senza punto.
pub fn estensioni() -> Vec<&'static str> {
    Codec::ALL
        .into_iter()
        .flat_map(|codec| codec.extensions().iter().copied())
        .collect()
}

/// Ciò che il motore tiene quando è acceso: la cache delle prove a vuoto,
/// iscritta nel budget dei servizi con cui è nato.
struct Acceso {
    prove: Arc<Baselines>,
}

fn crea(servizi: &Arc<Servizi>) -> Result<Acceso, ErroreMotore> {
    let prove = Arc::new(Baselines::new());
    let cache: Arc<dyn Cache> = prove.clone();
    servizi.memoria().registra(&cache);
    Ok(Acceso { prove })
}

/// Il motore dei documenti: le prove a vuoto ricordate dietro un [`Pigro`],
/// con i servizi dei motori in cui stanno.
///
/// Spento non tiene niente. Acceso tiene la cache delle prove, iscritta nel
/// budget dei suoi servizi; spegnerlo ([`Voce::libera`]) la lascia cadere, e
/// il budget la dimentica da solo.
pub struct MotoreDocumenti {
    servizi: Arc<Servizi>,
    acceso: Arc<Pigro<Acceso>>,
}

static PROCESSO: OnceLock<Arc<MotoreDocumenti>> = OnceLock::new();

impl MotoreDocumenti {
    /// Il motore dei documenti del processo, con i [`Servizi::processo`],
    /// iscritto in [`Motori::processo`] alla prima chiamata. Non lo
    /// costruisce: nasce alla prima prova da ricordare.
    pub fn processo() -> Arc<MotoreDocumenti> {
        Arc::clone(PROCESSO.get_or_init(|| {
            let motore = MotoreDocumenti::nuovo(Servizi::processo());
            if let Err(errore) = motore.iscrivi_in(&Motori::processo()) {
                // Lo spazio o un'estensione sono già di un altro motore: un
                // errore di chi ha scritto gli adattatori. I documenti
                // funzionano lo stesso; il registro non li elenca.
                tracing::error!(%errore, "fub-format-rich: il motore dei documenti non si è iscritto");
            }
            motore
        }))
    }

    /// Un motore separato da quello del processo, con questi servizi: per le
    /// prove, o per chi vuole un budget suo. Non è iscritto in nessun
    /// registro ([`MotoreDocumenti::iscrivi_in`]).
    pub fn nuovo(servizi: Arc<Servizi>) -> Arc<MotoreDocumenti> {
        Arc::new(MotoreDocumenti {
            servizi,
            acceso: Arc::new(Pigro::nuovo(crea)),
        })
    }

    /// Iscrive il motore in questo registro con lo spazio [`SPAZIO`] e le
    /// [`estensioni`]. Uno spazio si iscrive una volta sola.
    pub fn iscrivi_in(self: &Arc<Self>, motori: &Motori) -> Result<(), ErroreMotore> {
        let voce: Arc<dyn Voce> = Arc::clone(self) as Arc<dyn Voce>;
        motori.registra(SPAZIO, &estensioni(), voce)
    }

    /// I servizi in cui il motore sta.
    pub fn servizi(&self) -> &Arc<Servizi> {
        &self.servizi
    }

    /// La cache delle prove a vuoto, come la vede il budget, se il motore è
    /// acceso.
    pub fn cache(&self) -> Option<Arc<dyn Cache>> {
        self.acceso
            .se_acceso()
            .map(|acceso| Arc::clone(&acceso.prove) as Arc<dyn Cache>)
    }

    /// Quante prove a vuoto ricorda adesso.
    pub fn prove_ricordate(&self) -> usize {
        self.acceso
            .se_acceso()
            .map_or(0, |acceso| acceso.prove.len())
    }

    /// La prova a vuoto accettata per questa chiave, se si ricorda. Un motore
    /// spento non si accende per dire che non la ricorda.
    pub(crate) fn remembered(&self, key: &str) -> Option<Arc<Baseline>> {
        self.acceso.se_acceso()?.prove.find(key)
    }

    /// Ricorda la prova a vuoto accettata per questa chiave, accendendo il
    /// motore se serve, poi chiede al budget di stare sotto il tetto: una
    /// prova grande può togliere le altre, o da sola anche sé stessa.
    pub(crate) fn remember(&self, key: String, baseline: Arc<Baseline>) {
        let acceso = match self.acceso.prendi(&self.servizi) {
            Ok(acceso) => acceso,
            Err(errore) => {
                // Non ricordarla non perde niente: il salvataggio la rifà.
                tracing::warn!(%errore, "fub-format-rich: la prova a vuoto non si ricorda");
                return;
            }
        };
        acceso.prove.remember(key, baseline);
        drop(acceso);
        self.servizi.memoria().rispetta();
    }
}

impl Voce for MotoreDocumenti {
    fn acceso(&self) -> bool {
        self.acceso.acceso()
    }

    /// Accende il motore in sottofondo con i **suoi** servizi, quelli del cui
    /// budget la cache fa parte; i servizi del registro sono gli stessi per il
    /// motore del processo.
    fn scalda(&self, _servizi: &Arc<Servizi>) {
        self.acceso.scalda(Arc::clone(&self.servizi));
    }

    fn svuota(&self) -> u64 {
        let Some(acceso) = self.acceso.se_acceso() else {
            return 0;
        };
        let prima = acceso.prove.byte();
        acceso.prove.libera(u64::MAX);
        prima.saturating_sub(acceso.prove.byte())
    }

    fn libera(&self) -> bool {
        self.acceso.libera()
    }

    fn byte(&self) -> u64 {
        self.acceso
            .se_acceso()
            .map_or(0, |acceso| acceso.prove.byte())
    }
}

impl std::fmt::Debug for MotoreDocumenti {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MotoreDocumenti")
            .field("acceso", &self.acceso.acceso())
            .field("prove", &self.prove_ricordate())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_motori::{Config, Tetto};

    /// La prova a vuoto accettata di un documento del corpus.
    fn prova() -> Arc<Baseline> {
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/corpus/docx/libreoffice.docx"
        ))
        .unwrap();
        let document = Codec::Docx.read(&bytes).unwrap();
        let dry = Codec::Docx.write(&document).unwrap();
        let baseline = crate::preservation::check_open(&bytes, &dry, document.body.len())
            .expect("la prova si accetta");
        Arc::new(baseline)
    }

    fn motore(tetto: u64) -> Arc<MotoreDocumenti> {
        MotoreDocumenti::nuovo(Servizi::nuovi(Config {
            fili: Some(1),
            tetto: Tetto::fisso(tetto),
        }))
    }

    /// Una prova che da sola supera il tetto si toglie appena ricordata: il
    /// salvataggio la rifarà, e la memoria resta sotto il tetto.
    #[test]
    fn una_prova_sola_sopra_il_tetto_non_resta() {
        let motore = motore(1_000);
        motore.remember("a".into(), prova());
        assert!(motore.acceso());
        assert_eq!(motore.prove_ricordate(), 0);
        assert_eq!(motore.byte(), 0);
        assert!(motore.remembered("a").is_none());
    }

    /// Il budget toglie dalla più vecchia: con posto per una prova sola resta
    /// l'ultima ricordata.
    #[test]
    fn il_budget_toglie_dalla_prova_più_vecchia() {
        let una = {
            let motore = motore(u64::MAX);
            motore.remember("misura".into(), prova());
            motore.byte()
        };
        let motore = motore(una + una / 2);
        let prova = prova();
        motore.remember("a".into(), Arc::clone(&prova));
        motore.remember("b".into(), Arc::clone(&prova));
        assert_eq!(motore.prove_ricordate(), 1);
        assert!(motore.remembered("a").is_none());
        assert!(motore.remembered("b").is_some());
        assert_eq!(motore.servizi().memoria().usati(), una);
    }

    /// Spento, il motore non si accende per cercare una prova.
    #[test]
    fn cercare_non_accende_il_motore() {
        let motore = motore(u64::MAX);
        assert!(motore.remembered("a").is_none());
        assert!(!motore.acceso());
    }
}
