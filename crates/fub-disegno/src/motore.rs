//! Il motore del disegno sullo strato dei motori (`docs/architecture/motori.md`,
//! `docs/architecture/disegno.md`), come quello dei fogli in
//! `crates/fub-format-xlsx/src/motore.rs`.
//!
//! - [`MotoreDisegno`] è ciò che la prima apertura prepara: i caratteri del
//!   processo (`Servizi::caratteri`, dati dall'host) e il catalogo dei
//!   comandi del motore. Sta dietro un [`Pigro`]: iscriversi non lo
//!   costruisce, la prima apertura sì.
//! - [`Disegni`] è il motore come lo vede il processo: il `Pigro`, i servizi
//!   e il conto delle istanze aperte. Quello del processo
//!   ([`Disegni::processo`]) si iscrive in [`Motori::processo`] con lo spazio
//!   [`SPAZIO`] e l'estensione `svg`, una volta sola.
//! - [`Disegno`] è un'istanza: il testo tenuto, la copia nel motore, la
//!   sessione che fa i gesti. Tiene una [`Presa`]: quando cade l'ultima, le
//!   cache si svuotano e la memoria torna al sistema.
//!
//! Il motore del disegno non ha oggi cache raggiungibili da fuori che valga
//! contare: [`MotoreDisegno::byte`] è zero e svuotare rende la memoria al
//! sistema.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use fub_abi::{
    DrawingCommandInfo, DrawingCommandRequest, DrawingGesture, DrawingOpen, DrawingOutcome,
    DrawingRefusal, DrawingSync, DrawingSynced, PluginError, DRAWING_COMMANDS,
    MAX_DRAWING_TEXT_BYTES,
};
use fub_motori::{rilascia_al_sistema, Caratteri, ErroreMotore, Motori, Pigro, Servizi, Voce};
use vectorcraft_doc::{Document, NodeId};

use crate::apertura::{importa, Copia, ErroreApertura};
use crate::differenza::{Differenza, Rifiuto};
use crate::gesti::{esito_vuoto, Banco};
use crate::sincronia::{Pronta, Sincronia, ATTESA_MASSIMA};

/// Lo spazio del disegno nel registro dei motori.
pub const SPAZIO: &str = "disegno";

/// Le estensioni dei file che il motore del disegno apre.
pub const ESTENSIONI: [&str; 1] = ["svg"];

/// Il motore del disegno: ciò che la prima apertura prepara.
pub struct MotoreDisegno {
    caratteri: Arc<Caratteri>,
}

impl MotoreDisegno {
    /// Prende i caratteri del processo e prepara il catalogo dei comandi del
    /// motore. Senza caratteri il motore non si costruisce: l'host li dà
    /// con `Servizi::fornisci_caratteri` prima della prima apertura.
    fn crea(servizi: &Arc<Servizi>) -> Result<MotoreDisegno, ErroreMotore> {
        let caratteri = servizi.caratteri().ok_or_else(|| {
            ErroreMotore::creazione("il motore del disegno non ha i caratteri: l'host li dà con Servizi::fornisci_caratteri")
        })?;
        vectorcraft_engine::guard::catch_panic(vectorcraft_engine::command_specs).map_err(
            |panico| {
                ErroreMotore::creazione(format!("il catalogo dei comandi del disegno: {panico}"))
            },
        )?;
        Ok(MotoreDisegno { caratteri })
    }

    /// I caratteri con cui il motore è nato.
    pub fn caratteri(&self) -> &Arc<Caratteri> {
        &self.caratteri
    }

    /// I byte delle cache del motore: nessuna si vede da fuori.
    pub fn byte(&self) -> u64 {
        0
    }

    /// Svuota le cache e dice quanti byte se ne sono andati.
    pub fn svuota(&self) -> u64 {
        0
    }
}

/// Il motore del disegno come lo vede il processo.
pub struct Disegni {
    pigro: Arc<Pigro<MotoreDisegno>>,
    servizi: Arc<Servizi>,
    aperte: AtomicUsize,
}

impl Disegni {
    /// Il motore del disegno del processo, sui servizi del processo e
    /// iscritto nel suo registro. La prima chiamata iscrive; nessuna
    /// costruisce il motore.
    pub fn processo() -> Arc<Disegni> {
        static PROCESSO: OnceLock<Arc<Disegni>> = OnceLock::new();
        Arc::clone(PROCESSO.get_or_init(|| {
            let disegni = Disegni::nuovi(Servizi::processo());
            // Fallisce solo se lo spazio o l'estensione sono già di un altro:
            // il motore funziona lo stesso, il registro non lo vede.
            let _ = disegni.iscrivi(&Motori::processo());
            disegni
        }))
    }

    /// Un motore del disegno separato da quello del processo, sui servizi
    /// dati (per le prove). Non lo iscrive e non lo costruisce.
    #[doc(hidden)]
    pub fn nuovi(servizi: Arc<Servizi>) -> Arc<Disegni> {
        Arc::new(Disegni {
            pigro: Arc::new(Pigro::nuovo(MotoreDisegno::crea)),
            servizi,
            aperte: AtomicUsize::new(0),
        })
    }

    /// Iscrive il motore in `motori` con lo spazio [`SPAZIO`] e le
    /// [`ESTENSIONI`].
    pub fn iscrivi(self: &Arc<Self>, motori: &Motori) -> Result<(), ErroreMotore> {
        motori.registra(SPAZIO, &ESTENSIONI, Arc::clone(self) as Arc<dyn Voce>)
    }

    /// I servizi su cui il motore nasce.
    pub fn servizi(&self) -> &Arc<Servizi> {
        &self.servizi
    }

    /// Il motore, costruito adesso se non c'è.
    pub fn motore(&self) -> Result<Arc<MotoreDisegno>, ErroreMotore> {
        self.pigro.prendi(&self.servizi)
    }

    /// Il motore se c'è già, senza costruirlo.
    pub fn se_acceso(&self) -> Option<Arc<MotoreDisegno>> {
        self.pigro.se_acceso()
    }

    /// Quante istanze sono aperte sul motore.
    pub fn aperte(&self) -> usize {
        self.aperte.load(Ordering::SeqCst)
    }

    fn prendi(self: &Arc<Self>, motore: Arc<MotoreDisegno>) -> Presa {
        self.aperte.fetch_add(1, Ordering::SeqCst);
        Presa {
            disegni: Arc::clone(self),
            motore,
        }
    }

    /// L'ultima istanza si è chiusa: le cache si svuotano e la memoria torna
    /// al sistema. Il motore resta, finché il budget non lo libera.
    fn chiusa_l_ultima(&self, motore: &MotoreDisegno) {
        motore.svuota();
        self.servizi.memoria().rispetta();
        rilascia_al_sistema();
    }
}

impl Voce for Disegni {
    fn acceso(&self) -> bool {
        self.pigro.acceso()
    }

    /// Accende il motore in sottofondo con i **suoi** servizi.
    fn scalda(&self, _servizi: &Arc<Servizi>) {
        self.pigro.scalda(Arc::clone(&self.servizi));
    }

    fn svuota(&self) -> u64 {
        let reso = self.se_acceso().map_or(0, |motore| motore.svuota());
        rilascia_al_sistema();
        reso
    }

    /// Spegne il motore. Le istanze aperte tengono il loro: se ne va con
    /// l'ultima.
    fn libera(&self) -> bool {
        if let Some(motore) = self.se_acceso() {
            motore.svuota();
        }
        self.pigro.libera()
    }

    fn byte(&self) -> u64 {
        self.se_acceso().map_or(0, |motore| motore.byte())
    }
}

/// La presa di un'istanza aperta sul motore: tiene vivo il motore e conta
/// l'istanza.
pub(crate) struct Presa {
    disegni: Arc<Disegni>,
    motore: Arc<MotoreDisegno>,
}

impl Drop for Presa {
    fn drop(&mut self) {
        if self.disegni.aperte.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.disegni.chiusa_l_ultima(&self.motore);
        }
    }
}

/// Il numero dell'ultima istanza aperta nel processo.
static ISTANZE: AtomicU64 = AtomicU64::new(0);

/// Un disegno aperto nel motore.
pub struct Disegno {
    istanza: String,
    sincronia: Sincronia,
    copia: Copia,
    banco: Banco,
    servizi: Arc<Servizi>,
    // Ultima: cade dopo la sessione, e con l'ultima istanza svuota le cache.
    _presa: Presa,
}

fn errore_di_apertura(e: ErroreApertura) -> PluginError {
    match e {
        ErroreApertura::Scena(_) => PluginError::BadArgs(e.to_string().into()),
        ErroreApertura::Panico(_) => PluginError::Internal(e.to_string().into()),
    }
}

impl Disegno {
    /// Apre `testo` (a capo LF, come lo tiene il client) nel motore del
    /// processo, alla revisione 0.
    pub fn apri(testo: &str) -> Result<(Disegno, DrawingOpen), PluginError> {
        Self::apri_con(&Disegni::processo(), testo)
    }

    /// [`Disegno::apri`] su un motore dato.
    pub fn apri_con(
        disegni: &Arc<Disegni>,
        testo: &str,
    ) -> Result<(Disegno, DrawingOpen), PluginError> {
        if testo.len() > MAX_DRAWING_TEXT_BYTES {
            return Err(PluginError::BadArgs(
                format!(
                    "il disegno ha {} byte, al più {MAX_DRAWING_TEXT_BYTES}",
                    testo.len()
                )
                .into(),
            ));
        }
        let motore = disegni
            .motore()
            .map_err(|e| PluginError::Internal(e.to_string().into()))?;
        let presa = disegni.prendi(motore);
        let servizi = Arc::clone(disegni.servizi());
        let mut copia = servizi
            .lavori()
            .installa(|| importa(testo, 0))
            .map_err(errore_di_apertura)?;
        let banco = Banco::nuovo(&mut copia).map_err(|panico| {
            PluginError::Internal(format!("il motore si è fermato: {panico}").into())
        })?;
        let istanza = format!("disegno-{}", ISTANZE.fetch_add(1, Ordering::Relaxed) + 1);
        let aperto = DrawingOpen {
            instance: istanza.clone(),
            revision: 0,
            mapped: copia.mappati(),
            unmapped: copia.non_mappati(),
            losses: copia.perdite.clone(),
        };
        aperto.validate()?;
        Ok((
            Disegno {
                istanza,
                sincronia: Sincronia::nuova(testo.to_string()),
                copia,
                banco,
                servizi,
                _presa: presa,
            },
            aperto,
        ))
    }

    /// L'istanza, come la nomina il contratto.
    pub fn istanza(&self) -> &str {
        &self.istanza
    }

    /// La revisione del testo tenuto.
    pub fn revisione(&self) -> u64 {
        self.sincronia.revisione()
    }

    /// La revisione da cui viene la copia nel motore.
    pub fn revisione_importata(&self) -> u64 {
        self.copia.revisione
    }

    /// Il testo tenuto.
    pub fn testo(&self) -> &str {
        self.sincronia.testo()
    }

    /// Quanti elementi il motore sa modificare e quanti no, nella copia.
    pub fn conti(&self) -> (u32, u32) {
        (self.copia.mappati(), self.copia.non_mappati())
    }

    /// Applica un `sync` al testo tenuto; la copia si reimporta in
    /// sottofondo.
    pub fn sincronizza(&mut self, sync: DrawingSync) -> Result<DrawingSynced, PluginError> {
        self.sincronia.applica(&sync, self.servizi.lavori())
    }

    /// Aspetta che la copia sia alla revisione del testo, fino a `massimo`;
    /// `Err` con il rifiuto per un gesto a `revisione`.
    fn pronta(
        &mut self,
        revisione: u64,
        massimo: std::time::Duration,
    ) -> Result<(), DrawingRefusal> {
        match self
            .sincronia
            .pronta(revisione, self.copia.revisione, massimo)?
        {
            Pronta::Gia => Ok(()),
            Pronta::Nuova(mut copia) => {
                self.banco
                    .installa(&mut copia)
                    .map_err(|_| DrawingRefusal::Unsupported)?;
                self.copia = *copia;
                Ok(())
            }
        }
    }

    /// Aspetta il reimport della revisione tenuta (per le prove e per chi
    /// vuole i conti nuovi): vero se la copia è alla revisione del testo.
    pub fn aspetta_il_reimport(&mut self, massimo: std::time::Duration) -> bool {
        let revisione = self.sincronia.revisione();
        self.pronta(revisione, massimo).is_ok()
    }

    /// Un pezzo di gesto. Un gesto a una revisione diversa da quella del
    /// testo è `stale`; se il reimport non è finito lo aspetta.
    pub fn gesto(&mut self, gesto: DrawingGesture) -> Result<DrawingOutcome, PluginError> {
        gesto.validate()?;
        if let Err(rifiuto) = self.pronta(gesto.revision, ATTESA_MASSIMA) {
            if gesto.phase != fub_abi::DrawingPhase::Cancel || rifiuto != DrawingRefusal::Stale {
                return Ok(rifiutato(gesto.revision, rifiuto));
            }
        }
        let esito = self.banco.gesto(&self.copia, &gesto);
        esito.validate()?;
        Ok(esito)
    }

    /// I comandi del disegno sulla selezione: oggi tutti spenti, finché il
    /// task dei comandi non li accende.
    pub fn comandi(&self, _selezione: &[String]) -> Vec<DrawingCommandInfo> {
        DRAWING_COMMANDS
            .iter()
            .map(|id| DrawingCommandInfo {
                id: (*id).to_string(),
                enabled: false,
            })
            .collect()
    }

    /// Un comando sulla selezione: oggi `unsupported`.
    pub fn comando(
        &mut self,
        richiesta: DrawingCommandRequest,
    ) -> Result<DrawingOutcome, PluginError> {
        richiesta.validate()?;
        if let Err(rifiuto) = self.pronta(richiesta.revision, ATTESA_MASSIMA) {
            return Ok(rifiutato(richiesta.revision, rifiuto));
        }
        Ok(rifiutato(richiesta.revision, DrawingRefusal::Unsupported))
    }

    /// La differenza fra la copia e il documento del motore cambiato a mano
    /// da `f`, che riceve il documento e l'oggetto del motore di ogni
    /// percorso di Fub. Per le prove della differenza senza uno strumento.
    #[doc(hidden)]
    pub fn a_mano(
        &mut self,
        f: impl FnOnce(&mut Document, &dyn Fn(&[usize]) -> Option<NodeId>),
    ) -> Result<DrawingOutcome, PluginError> {
        let revisione = self.sincronia.revisione();
        if let Err(rifiuto) = self.pronta(revisione, ATTESA_MASSIMA) {
            return Ok(rifiutato(revisione, rifiuto));
        }
        let mappa = &self.copia.mappa;
        let trova = |percorso: &[usize]| {
            mappa
                .elementi()
                .iter()
                .find(|e| e.percorso == percorso)
                .and_then(|e| e.nodo)
        };
        let esito: Result<Differenza, Rifiuto> =
            self.banco.a_mano(&self.copia, |doc| f(doc, &trova));
        let mut fuori = esito_vuoto(revisione);
        match esito.and_then(|d| d.testo()) {
            Ok(ops) => fuori.ops = ops,
            Err(r) => fuori.refused = Some(r.rifiuto()),
        }
        Ok(fuori)
    }
}

fn rifiutato(revisione: u64, rifiuto: DrawingRefusal) -> DrawingOutcome {
    DrawingOutcome {
        refused: Some(rifiuto),
        ..esito_vuoto(revisione)
    }
}

#[allow(dead_code)]
fn _disegno_si_sposta_fra_thread() {
    fn manda<T: Send>() {}
    manda::<Disegno>();
}
