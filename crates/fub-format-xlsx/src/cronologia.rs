//! La cronologia di una cartella: annulla e ripeti del documento, per celle e
//! comandi insieme, anche dopo un salvataggio.
//!
//! Ogni sessione tiene una **linea**: i punti per cui il documento è passato,
//! nell'ordine, e il cursore sul punto di adesso. Un punto sa il giornale che
//! lo dà sui byte della sessione (finché la sessione è quella), lo stato
//! della cartella quando è a comandi, e il passo che lo ha portato dal punto
//! prima: le celle cambiate, con l'input di prima e di dopo, o un comando.
//!
//! Annullare va al punto prima, ripetere a quello dopo, sempre con un giornale
//! nuovo nella sessione del documento: il giornale del punto, se lo si sa; se
//! no le celle del passo riscritte all'indietro (o in avanti); se no, per un
//! comando, [`RESTORE`]: il primo comando del giornale, che porta la cartella
//! allo stato del punto tenuto in memoria. Il salvataggio seguente scrive quel
//! giornale sul disco come ogni altro.
//!
//! Il salvataggio apre un'altra sessione sui byte, e la griglia poi si riapre
//! sui byte salvati: il provider tiene le linee pubblicate nell'[`Archivio`],
//! e la sessione nuova prende quella che il salvataggio ha scritto. Riaprendo
//! il programma la cronologia ricomincia: un giornale con [`RESTORE`] di un
//! altro processo non si applica, e lo dice.

use std::collections::hash_map::RandomState;
use std::collections::VecDeque;
use std::hash::BuildHasher;
use std::sync::Arc;

use fub_abi::{GridCellKey, GridCommand, PluginError, Revision};
use gridcraft_model::{CellStore, Workbook};
use serde_json::{json, Value as Json};

use crate::commands::Snapshot;

/// Il comando che porta la cartella allo stato `state` tenuto in memoria. Vale
/// soltanto come primo comando del giornale, e non è nel catalogo: lo scrive
/// il provider quando annulla o ripete oltre un salvataggio.
pub(crate) const RESTORE: &str = "fub.restore";
/// I passi che una linea tiene: oltre, il più vecchio non si annulla più.
pub(crate) const MAX_STEPS: usize = 100;
/// La memoria che gli stati di una linea tengono in più della cartella di
/// adesso: oltre, i passi più vecchi escono (l'ultimo resta comunque).
pub(crate) const MAX_RETAINED_BYTES: usize = 128 * 1024 * 1024;
/// Le linee pubblicate che l'archivio tiene.
const MAX_LINES: usize = 32;
/// I salvataggi che l'archivio ricorda.
const MAX_SAVED: usize = 64;

/// Lo stato della cartella in un punto, con il nome con cui un giornale lo
/// chiama.
pub(crate) struct Stato {
    pub id: String,
    pub snapshot: Snapshot,
}

impl Stato {
    pub fn new(snapshot: Snapshot) -> Arc<Stato> {
        Arc::new(Stato {
            id: new_id(),
            snapshot,
        })
    }

    /// [`RESTORE`] verso questo stato, sulla selezione che aveva.
    pub fn command(&self) -> GridCommand {
        let workbook = &self.snapshot.workbook;
        let sheet = workbook
            .sheets
            .get(workbook.active_sheet)
            .or_else(|| workbook.sheets.first())
            .map_or(1, |sheet| sheet.file_id.max(1));
        let active = self.snapshot.selection.active.a1();
        GridCommand {
            id: RESTORE.to_owned(),
            params: json!({ "state": self.id }).to_string(),
            sheet: format!("s{sheet}"),
            selection: active.clone(),
            active,
        }
    }
}

/// Un nome che un altro processo non ridà: 128 bit dalle chiavi casuali della
/// libreria standard.
fn new_id() -> String {
    let high = RandomState::new().hash_one(0u8);
    let low = RandomState::new().hash_one(1u8);
    format!("{high:016x}{low:016x}")
}

/// Lo stato che [`RESTORE`] chiama, se il comando ha la forma giusta.
pub(crate) fn restore_target(command: &GridCommand) -> Option<String> {
    if command.id != RESTORE {
        return None;
    }
    let params: Json = serde_json::from_str(&command.params).ok()?;
    let object = params.as_object()?;
    if object.len() != 1 {
        return None;
    }
    let id = object.get("state")?.as_str()?;
    (id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
    .then(|| id.to_owned())
}

/// Una cella cambiata da un passo, con l'input mostrato prima e dopo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Cambio {
    pub cell: GridCellKey,
    pub before: String,
    pub after: String,
}

/// Come si arriva a un punto da quello prima.
#[derive(Clone)]
pub(crate) enum Passo {
    /// L'input di alcune celle: si rifà e si disfa riscrivendole.
    Celle(Arc<[Cambio]>),
    /// Un comando della barra: si rifà e si disfa con lo stato del punto.
    Comandi,
}

/// Un punto della linea.
#[derive(Clone)]
pub(crate) struct Punto {
    /// Il giornale che dà il punto sui byte della sessione, se lo si sa.
    pub journal: Option<Arc<str>>,
    /// Lo stato della cartella, per i punti a comandi e per quelli prima di
    /// un comando.
    pub stato: Option<Arc<Stato>>,
    /// Il passo dal punto prima; `None` per il primo.
    pub passo: Option<Passo>,
    /// La memoria che lo stato tiene in più di quello del punto dopo.
    retained: usize,
}

impl Punto {
    pub fn new(journal: String, stato: Option<Arc<Stato>>, passo: Option<Passo>) -> Punto {
        Punto {
            journal: Some(journal.into()),
            stato,
            passo,
            retained: 0,
        }
    }
}

/// I punti per cui il documento è passato, e dove è adesso.
#[derive(Clone)]
pub(crate) struct Linea {
    punti: Vec<Punto>,
    cursore: usize,
}

impl Linea {
    /// La linea di una sessione che non ha storia: un punto solo.
    pub fn new(journal: String) -> Linea {
        Linea {
            punti: vec![Punto::new(journal, None, None)],
            cursore: 0,
        }
    }

    pub fn cursor(&self) -> usize {
        self.cursore
    }

    pub fn len(&self) -> usize {
        self.punti.len()
    }

    pub fn point(&self, index: usize) -> &Punto {
        &self.punti[index]
    }

    pub fn current_mut(&mut self) -> &mut Punto {
        &mut self.punti[self.cursore]
    }

    /// Il passo fra il punto di adesso e il punto `to` accanto.
    pub fn crossing(&self, to: usize) -> Option<&Passo> {
        let later = to.max(self.cursore);
        self.punti[later].passo.as_ref()
    }

    /// La stessa linea sui byte salvati da un'altra sessione: il punto di
    /// adesso è il giornale vuoto, gli altri non hanno più un giornale.
    pub fn rebased(&self) -> Linea {
        let mut linea = self.clone();
        for (index, punto) in linea.punti.iter_mut().enumerate() {
            punto.journal = (index == linea.cursore).then(|| Arc::from(""));
        }
        linea
    }

    /// Un passo nuovo dopo il punto di adesso: il futuro da ripetere esce, e
    /// i passi più vecchi escono oltre i limiti.
    pub fn push(&mut self, mut punto: Punto) {
        self.punti.truncate(self.cursore + 1);
        if let (Some(last), Some(next)) = (self.punti.last_mut(), punto.stato.as_ref()) {
            last.retained = last.stato.as_ref().map_or(0, |stato| {
                retained(&stato.snapshot.workbook, &next.snapshot.workbook)
            });
        }
        punto.retained = 0;
        self.punti.push(punto);
        self.cursore = self.punti.len() - 1;
        let weight = |punto: &Punto| {
            let cells = match &punto.passo {
                Some(Passo::Celle(changes)) => changes
                    .iter()
                    .map(|change| change.before.len() + change.after.len() + 64)
                    .sum(),
                _ => 0,
            };
            punto.retained + cells + punto.journal.as_ref().map_or(0, |text| text.len())
        };
        let mut total: usize = self.punti.iter().map(weight).sum();
        while self.punti.len() > 2
            && (self.punti.len() > MAX_STEPS + 1 || total > MAX_RETAINED_BYTES)
        {
            total = total.saturating_sub(weight(&self.punti.remove(0)));
            self.punti[0].passo = None;
            self.cursore -= 1;
        }
    }

    /// Il cursore va sul punto `to`, che adesso ha il giornale `journal` e,
    /// se non lo aveva, lo stato `stato`.
    pub fn moved(&mut self, to: usize, journal: String, stato: Option<Arc<Stato>>) {
        self.cursore = to;
        let punto = &mut self.punti[to];
        punto.journal = Some(journal.into());
        if punto.stato.is_none() {
            punto.stato = stato;
        }
    }

    /// Lo stato chiamato `id`, se un punto lo tiene.
    pub fn find(&self, id: &str) -> Option<Arc<Stato>> {
        self.punti
            .iter()
            .filter_map(|punto| punto.stato.as_ref())
            .find(|stato| stato.id == id)
            .cloned()
    }
}

/// La memoria che `older` tiene oltre a `newer`: i fogli che non condividono,
/// e dei fogli cambiati le fasce di celle diverse. È la misura della
/// cronologia di GridCraft.
fn retained(older: &Workbook, newer: &Workbook) -> usize {
    let mut bytes = std::mem::size_of::<Workbook>();
    for (index, sheet) in older.sheets.iter().enumerate() {
        if newer.sheets.iter().any(|next| Arc::ptr_eq(sheet, next)) {
            continue;
        }
        bytes = bytes.saturating_add(std::mem::size_of::<gridcraft_model::Sheet>());
        let empty = CellStore::new();
        let next = newer.sheets.get(index).map_or(&empty, |next| &next.cells);
        bytes = bytes.saturating_add(sheet.cells.retained_bytes_against(next));
    }
    bytes
}

/// Le linee pubblicate dalle sessioni, perché la sessione che si apre sui
/// byte salvati (o sullo stesso giornale) le ritrovi.
#[derive(Default)]
pub(crate) struct Archivio {
    /// Per revisione della sessione, la più recente in fondo.
    linee: VecDeque<(Revision, Linea)>,
    /// La revisione dei byte scritti da un salvataggio, e quella della
    /// sessione che li ha scritti.
    salvati: VecDeque<(Revision, Revision)>,
}

impl Archivio {
    /// La linea della sessione alla revisione `revision`.
    pub fn publish(&mut self, revision: Revision, linea: Linea) {
        self.linee.retain(|(known, _)| *known != revision);
        self.linee.push_back((revision, linea));
        while self.linee.len() > MAX_LINES {
            self.linee.pop_front();
        }
    }

    /// I byte `bytes` vengono dalla sessione alla revisione `revision`.
    pub fn saved(&mut self, bytes: Revision, revision: Revision) {
        self.salvati.retain(|(known, _)| *known != bytes);
        self.salvati.push_back((bytes, revision));
        while self.salvati.len() > MAX_SAVED {
            self.salvati.pop_front();
        }
    }

    /// La linea di una sessione che si apre alla revisione `revision`, sui
    /// byte `source` e con il giornale vuoto se `empty`.
    pub fn line_for(&self, revision: &Revision, source: &Revision, empty: bool) -> Option<Linea> {
        let line = |revision: &Revision| {
            self.linee
                .iter()
                .rev()
                .find(|(known, _)| known == revision)
                .map(|(_, linea)| linea)
        };
        if let Some(linea) = line(revision) {
            return Some(linea.clone());
        }
        if !empty {
            return None;
        }
        let (_, writer) = self
            .salvati
            .iter()
            .rev()
            .find(|(bytes, _)| bytes == source)?;
        line(writer).map(Linea::rebased)
    }

    /// Lo stato chiamato `id`, se una linea lo tiene.
    pub fn find(&self, id: &str) -> Option<Arc<Stato>> {
        self.linee
            .iter()
            .rev()
            .find_map(|(_, linea)| linea.find(id))
    }
}

/// Il rifiuto di un [`RESTORE`] che non si applica.
pub(crate) fn lost_state() -> PluginError {
    PluginError::Conflict(
        format!("grid journal command `{RESTORE}` no longer applies: the state is not in memory")
            .into(),
    )
}
