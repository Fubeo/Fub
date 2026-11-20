//! **La memoria d'esportazione di una nota**: ciò che vale solo per il PDF di
//! quella nota e non sta nel suo file.
//!
//! Due cose: lo stile dato a un diagramma solo per l'esportazione e i blocchi
//! lasciati fuori dal PDF. Non stanno nel profilo, che vale per ogni nota, e
//! non stanno nella nota, che resta byte per byte com'era (la sola eccezione
//! è `<!-- pagina -->`, D17, che è nella nota apposta).
//!
//! # Dove sta
//!
//! Nello spazio per-documento dello spazio dati dell'esportazione
//! ([`fub_abi::rules::doc_data`]):
//!
//! ```text
//! .fub/plugins/fub.draw/doc/<nota codificata>/esportazione-pdf.json
//! ```
//!
//! È lo spazio che il kernel porta dietro alla nota: la rinomina lo sposta
//! sotto il nome nuovo (anche quella fatta da un altro programma), il cestino
//! lo parcheggia e il ripristino lo riporta, e quando la nota non c'è più né
//! nel vault né nel cestino la raccolta lo toglie. La memoria non ascolta
//! nessun evento per seguire la sua nota.
//!
//! # Come si riconosce un blocco
//!
//! Dalla sezione (i titoli sopra di lui, dal più alto) e dal contenuto
//! (un'impronta SHA-256 del suo testo): [`RiferimentoBlocco`]. Un blocco che
//! cambia non è più lo stesso blocco, e la memoria lo dice
//! ([`Riconoscimento::NonVale`]) invece di applicare l'esclusione o lo stile
//! a un blocco che la persona non ha scelto. Lo stesso blocco ripetuto due
//! volte nella stessa sezione si distingue con l'occorrenza.

use std::fmt;

use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::rules::doc_data;
use fub_abi::traits::{DataRead, DataWrite};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::profile::{Altro, StileDiagramma};

/// La versione del formato della memoria che questa versione di Fub scrive.
pub const VERSIONE_MEMORIA: u32 = 1;

/// Il nome del blob nello spazio della nota.
pub const NOME_MEMORIA: &str = "esportazione-pdf.json";

/// La memoria più grande che si legge.
pub const MAX_MEMORIA_BYTE: usize = 1024 * 1024;

/// Quante voci al più, fra blocchi lasciati fuori e stili dei diagrammi.
pub const MAX_VOCI: usize = 10_000;

/// Quanti caratteri del blocco tiene l'anteprima.
pub const MAX_ANTEPRIMA: usize = 80;

/// Un blocco della nota come lo vede chi impagina: i titoli della sezione in
/// cui sta, dal più alto, e il suo testo sorgente.
#[derive(Clone, Copy, Debug)]
pub struct BloccoNota<'a> {
    pub sezione: &'a [String],
    pub contenuto: &'a str,
}

/// L'impronta del contenuto di un blocco: SHA-256 del testo con i capo riga
/// in `\n`, senza spazi in fondo alle righe e senza righe vuote ai lati.
/// Così un blocco riscritto da un editor che cambia solo i capo riga resta
/// lo stesso blocco.
pub fn impronta(contenuto: &str) -> String {
    let normale = contenuto.replace("\r\n", "\n").replace('\r', "\n");
    let righe: Vec<&str> = normale.lines().map(str::trim_end).collect();
    let inizio = righe
        .iter()
        .position(|r| !r.is_empty())
        .unwrap_or(righe.len());
    let fine = righe
        .iter()
        .rposition(|r| !r.is_empty())
        .map_or(inizio, |i| i + 1);
    let testo = righe[inizio..fine].join("\n");
    let digest = Sha256::digest(testo.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// L'anteprima di un blocco: la prima riga con qualcosa, accorciata.
fn anteprima(contenuto: &str) -> String {
    let riga = contenuto
        .lines()
        .map(str::trim)
        .find(|r| !r.is_empty())
        .unwrap_or_default();
    let mut corta: String = riga.chars().take(MAX_ANTEPRIMA).collect();
    if riga.chars().count() > MAX_ANTEPRIMA {
        corta.push('…');
    }
    corta
}

/// Come la memoria riconosce un blocco.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RiferimentoBlocco {
    /// I titoli della sezione, dal più alto; vuoto, prima del primo titolo.
    #[serde(default)]
    pub sezione: Vec<String>,
    /// [`impronta`] del contenuto.
    pub impronta: String,
    /// Quale, fra i blocchi uguali nella stessa sezione, contando da 0.
    #[serde(default)]
    pub occorrenza: u32,
    /// L'inizio del blocco, per dire quale esclusione non vale più.
    #[serde(default)]
    pub anteprima: String,
    #[serde(flatten)]
    pub altro: Altro,
}

impl RiferimentoBlocco {
    /// Il riferimento del blocco `indice` di `blocchi`; `None` se l'indice è
    /// fuori.
    pub fn di(blocchi: &[BloccoNota<'_>], indice: usize) -> Option<Self> {
        let blocco = blocchi.get(indice)?;
        let impronta = impronta(blocco.contenuto);
        let occorrenza = blocchi[..indice]
            .iter()
            .filter(|b| b.sezione == blocco.sezione && self::impronta(b.contenuto) == impronta)
            .count() as u32;
        Some(Self {
            sezione: blocco.sezione.to_vec(),
            impronta,
            occorrenza,
            anteprima: anteprima(blocco.contenuto),
            altro: Altro::new(),
        })
    }

    /// Se indica lo stesso blocco di `altro` (l'anteprima e le chiavi
    /// sconosciute non contano).
    pub fn stesso_blocco(&self, altro: &Self) -> bool {
        self.sezione == altro.sezione
            && self.impronta == altro.impronta
            && self.occorrenza == altro.occorrenza
    }

    /// Dove sta adesso il blocco nella nota.
    pub fn riconosci(&self, blocchi: &[BloccoNota<'_>]) -> Riconoscimento {
        let mut visti = 0u32;
        for (indice, blocco) in blocchi.iter().enumerate() {
            if blocco.sezione == self.sezione.as_slice()
                && impronta(blocco.contenuto) == self.impronta
            {
                if visti == self.occorrenza {
                    return Riconoscimento::Vale { blocco: indice };
                }
                visti += 1;
            }
        }
        Riconoscimento::NonVale
    }
}

/// Il blocco che una voce della memoria nomina, nella nota com'è adesso.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "stato", rename_all = "snake_case")]
pub enum Riconoscimento {
    /// Il blocco c'è ancora, uguale, a questo indice.
    Vale { blocco: usize },
    /// Il blocco è cambiato, o non c'è più: la voce non vale più, e il
    /// pannello lo dice.
    NonVale,
}

/// Lo stile di un diagramma solo per l'esportazione.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StileDiUnDiagramma {
    pub blocco: RiferimentoBlocco,
    pub stile: StileDiagramma,
    #[serde(flatten)]
    pub altro: Altro,
}

/// La memoria d'esportazione di una nota.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoriaNota {
    pub versione: u32,
    /// I blocchi lasciati fuori dal PDF.
    #[serde(default)]
    pub fuori: Vec<RiferimentoBlocco>,
    /// Gli stili dei diagrammi dati solo per l'esportazione.
    #[serde(default)]
    pub diagrammi: Vec<StileDiUnDiagramma>,
    #[serde(flatten)]
    pub altro: Altro,
}

impl Default for MemoriaNota {
    fn default() -> Self {
        Self {
            versione: VERSIONE_MEMORIA,
            fuori: Vec::new(),
            diagrammi: Vec::new(),
            altro: Altro::new(),
        }
    }
}

/// Una voce della memoria con il suo blocco nella nota com'è adesso.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Voce<'m, T> {
    pub voce: &'m T,
    pub riconoscimento: Riconoscimento,
}

impl MemoriaNota {
    /// Se non c'è niente da ricordare.
    pub fn vuota(&self) -> bool {
        self.fuori.is_empty() && self.diagrammi.is_empty() && self.altro.is_empty()
    }

    /// Se il file viene da una versione più nuova di Fub.
    pub fn futura(&self) -> bool {
        self.versione > VERSIONE_MEMORIA
    }

    /// Lascia fuori dal PDF il blocco `indice`. Lasciarlo fuori due volte non
    /// lo ripete.
    pub fn lascia_fuori(&mut self, blocchi: &[BloccoNota<'_>], indice: usize) -> bool {
        let Some(riferimento) = RiferimentoBlocco::di(blocchi, indice) else {
            return false;
        };
        if !self.fuori.iter().any(|r| r.stesso_blocco(&riferimento)) {
            self.fuori.push(riferimento);
        }
        true
    }

    /// Rimette nel PDF un blocco lasciato fuori, anche se non vale più.
    pub fn rimetti(&mut self, riferimento: &RiferimentoBlocco) {
        self.fuori.retain(|r| !r.stesso_blocco(riferimento));
    }

    /// Se il blocco `indice` è lasciato fuori, e l'esclusione vale ancora.
    pub fn e_fuori(&self, blocchi: &[BloccoNota<'_>], indice: usize) -> bool {
        self.fuori
            .iter()
            .any(|r| r.riconosci(blocchi) == Riconoscimento::Vale { blocco: indice })
    }

    /// I blocchi lasciati fuori, ognuno con dove sta adesso: quelli che non
    /// valgono più il pannello li mostra con la loro anteprima.
    pub fn esclusioni<'m>(
        &'m self,
        blocchi: &[BloccoNota<'_>],
    ) -> Vec<Voce<'m, RiferimentoBlocco>> {
        self.fuori
            .iter()
            .map(|voce| Voce {
                voce,
                riconoscimento: voce.riconosci(blocchi),
            })
            .collect()
    }

    /// Dà al diagramma `indice` uno stile solo per l'esportazione.
    pub fn imposta_stile(
        &mut self,
        blocchi: &[BloccoNota<'_>],
        indice: usize,
        stile: StileDiagramma,
    ) -> bool {
        let Some(blocco) = RiferimentoBlocco::di(blocchi, indice) else {
            return false;
        };
        match self
            .diagrammi
            .iter_mut()
            .find(|voce| voce.blocco.stesso_blocco(&blocco))
        {
            Some(voce) => voce.stile = stile,
            None => self.diagrammi.push(StileDiUnDiagramma {
                blocco,
                stile,
                altro: Altro::new(),
            }),
        }
        true
    }

    /// Lo stile del diagramma `indice`, se ne ha uno e vale ancora.
    pub fn stile(&self, blocchi: &[BloccoNota<'_>], indice: usize) -> Option<&StileDiagramma> {
        self.diagrammi
            .iter()
            .find(|voce| voce.blocco.riconosci(blocchi) == Riconoscimento::Vale { blocco: indice })
            .map(|voce| &voce.stile)
    }

    /// Toglie lo stile proprio di un diagramma: torna quello del profilo.
    pub fn togli_stile(&mut self, blocco: &RiferimentoBlocco) {
        self.diagrammi
            .retain(|voce| !voce.blocco.stesso_blocco(blocco));
    }

    /// Gli stili dei diagrammi, ognuno con dove sta adesso.
    pub fn stili<'m>(&'m self, blocchi: &[BloccoNota<'_>]) -> Vec<Voce<'m, StileDiUnDiagramma>> {
        self.diagrammi
            .iter()
            .map(|voce| Voce {
                voce,
                riconoscimento: voce.blocco.riconosci(blocchi),
            })
            .collect()
    }

    /// Dimentica le voci che non valgono più: è la scelta della persona
    /// («Dimentica»), mai un effetto della lettura.
    pub fn dimentica_non_valide(&mut self, blocchi: &[BloccoNota<'_>]) {
        self.fuori
            .retain(|r| r.riconosci(blocchi) != Riconoscimento::NonVale);
        self.diagrammi
            .retain(|voce| voce.blocco.riconosci(blocchi) != Riconoscimento::NonVale);
    }
}

/// Perché la memoria di una nota non si legge o non si scrive.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "errore", rename_all = "snake_case")]
pub enum ErroreMemoria {
    /// Il file non è una memoria d'esportazione. Resta com'è: si sostituisce
    /// solo con [`ricomincia`].
    Illeggibile { motivo: String },
    /// Il file è più grande di [`MAX_MEMORIA_BYTE`].
    TroppoGrande { byte: usize },
    /// Più di [`MAX_VOCI`] voci.
    TroppeVoci { voci: usize },
    /// La memoria viene da una versione più nuova: si legge, ma non si
    /// riscrive.
    Futura { versione: u32 },
    /// Lo spazio dati ha detto di no: la memoria di prima resta.
    Archivio { causa: PluginError },
}

impl fmt::Display for ErroreMemoria {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Illeggibile { motivo } => {
                write!(f, "the export memory of the note cannot be read: {motivo}")
            }
            Self::TroppoGrande { byte } => write!(
                f,
                "the export memory of the note is {byte} bytes, more than {MAX_MEMORIA_BYTE}"
            ),
            Self::TroppeVoci { voci } => write!(
                f,
                "the export memory of the note has {voci} entries, more than {MAX_VOCI}"
            ),
            Self::Futura { versione } => write!(
                f,
                "the export memory of the note has version {versione}, newer than \
                 {VERSIONE_MEMORIA}: it is read but not rewritten"
            ),
            Self::Archivio { causa } => write!(f, "export memory storage: {causa}"),
        }
    }
}

impl std::error::Error for ErroreMemoria {}

impl From<PluginError> for ErroreMemoria {
    fn from(causa: PluginError) -> Self {
        Self::Archivio { causa }
    }
}

/// Il path del blob della memoria di `nota` nello spazio dati.
pub fn percorso(nota: &DocId) -> String {
    doc_data::path(nota, NOME_MEMORIA)
}

fn da_byte(byte: &[u8]) -> Result<MemoriaNota, ErroreMemoria> {
    if byte.len() > MAX_MEMORIA_BYTE {
        return Err(ErroreMemoria::TroppoGrande { byte: byte.len() });
    }
    let memoria: MemoriaNota =
        serde_json::from_slice(byte).map_err(|errore| ErroreMemoria::Illeggibile {
            motivo: errore.to_string(),
        })?;
    let voci = memoria.fuori.len() + memoria.diagrammi.len();
    if voci > MAX_VOCI {
        return Err(ErroreMemoria::TroppeVoci { voci });
    }
    Ok(memoria)
}

/// La memoria di una nota. Una nota senza memoria ne ha una vuota.
pub fn leggi(host: &dyn DataRead, nota: &DocId) -> Result<MemoriaNota, ErroreMemoria> {
    match host.data_read(&percorso(nota))? {
        Some(byte) => da_byte(&byte),
        None => Ok(MemoriaNota::default()),
    }
}

/// Salva la memoria di una nota; una memoria vuota toglie il file.
///
/// Non scrive una memoria futura e non sostituisce un file illeggibile o
/// futuro: lo dice con l'errore e lascia il file com'è. Una scrittura che non
/// riesce lascia la memoria di prima.
pub fn salva(
    host: &mut dyn DataWrite,
    nota: &DocId,
    memoria: &MemoriaNota,
) -> Result<(), ErroreMemoria> {
    if memoria.futura() {
        return Err(ErroreMemoria::Futura {
            versione: memoria.versione,
        });
    }
    let voci = memoria.fuori.len() + memoria.diagrammi.len();
    if voci > MAX_VOCI {
        return Err(ErroreMemoria::TroppeVoci { voci });
    }
    let attuale = leggi(host, nota)?;
    if attuale.futura() {
        return Err(ErroreMemoria::Futura {
            versione: attuale.versione,
        });
    }
    let percorso = percorso(nota);
    if memoria.vuota() {
        host.data_remove(&percorso)?;
        return Ok(());
    }
    let mut byte = serde_json::to_vec_pretty(memoria)
        .expect("una memoria è fatta solo di mappe a chiavi di testo");
    byte.push(b'\n');
    if byte.len() > MAX_MEMORIA_BYTE {
        return Err(ErroreMemoria::TroppoGrande { byte: byte.len() });
    }
    host.data_write(&percorso, &byte)?;
    Ok(())
}

/// Toglie la memoria di una nota, anche illeggibile o futura: è la scelta
/// della persona («Ricomincia»), dopo che il pannello le ha detto che la
/// memoria non si legge.
pub fn ricomincia(host: &mut dyn DataWrite, nota: &DocId) -> Result<(), ErroreMemoria> {
    host.data_remove(&percorso(nota))?;
    Ok(())
}

#[cfg(test)]
#[path = "memory_tests.rs"]
mod tests;
