//! Il **registro di ciò che è successo**: `.fub/journal.jsonl`, una riga per
//! mutazione, in coda (§15.2).
//!
//! # Cosa ci sta dentro, e cosa no
//!
//! Ci sta ciò che il **kernel ha fatto** al vault: una nota creata, riscritta,
//! modificata chirurgicamente, cestinata, ripristinata, rinominata. Ogni riga
//! dice *quando*, *chi ha chiesto* ([`Origin`], decisione 0012), *dentro quale
//! lotto* ([0011](../../../docs/decisions/0011-il-lotto.md)) e *cosa*.
//!
//! Non ci sta ciò che il vault ha **subìto** da fuori: un file cambiato da
//! un'altra app arriva dal rilevatore e non è una nostra mutazione — registrarlo
//! qui vorrebbe dire promettere di poterlo annullare, e l'inverso di una
//! scrittura che non abbiamo fatto non ce l'ha nessuno. E non ci sta il buffer
//! sporco dell'editor: quella è l'altra pila della
//! [0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md), e la riga che
//! separa le due pile — *un comando entra da qui, una battuta di tastiera no* —
//! è la stessa che separa questo file dal buffer di crash.
//!
//! # Il contenuto di prima non ci sta, e l'inverso sì
//!
//! È la scelta che decide la forma del formato. Un registro che si porta dietro
//! il testo precedente di ogni salvataggio è il vault scritto una seconda volta
//! accanto a sé stesso, dentro un file **autorevole** che nessuno può buttare.
//! Ciò che serve per tornare indietro è l'**inverso**, e il contratto ce l'ha
//! già: [`EditReport::inverse`](fub_abi::edit::EditReport::inverse) per una
//! modifica chirurgica — che porta i soli byte sostituiti, non il documento —, e
//! per tutto il resto un inverso che si **deduce** dalla riga (l'inverso di una
//! rinomina è la rinomina all'incontrario, quello di una cancellazione è un
//! ripristino dal cestino). È la 0045 letta qui: *l'inverso strutturale è un
//! comando, non un vocabolario*.
//!
//! Resta una variante senza inverso, ed è dichiarata invece che nascosta:
//! [`JournalOp::Written`], la riscrittura integrale di un documento che c'era
//! già — cioè il salvataggio dell'editor. Per riportarlo indietro servirebbe il
//! testo di prima, e quello è esattamente ciò che questo file non tiene. Non è
//! una lacuna nuova: è la riga che la 0045 aveva già rifiutato di mettere in
//! pila, vista dal disco.
//!
//! # Perché non bastano gli snapshot del versioning
//!
//! Perché non sono dello stesso genere di cosa, e ognuna delle tre ragioni
//! basterebbe da sola. Il versioning è un **componente**, spegnibile da
//! un'impostazione; è alimentato dagli **eventi**, che hanno un budget e possono
//! troncare — il suo stesso modulo scrive che perdere uno snapshot intermedio
//! per un campionatore va bene, e per una base di rollback no —; e vive nello
//! **spazio dati privato di un plugin**
//! ([0021](../../../docs/decisions/0021-il-confine.md)), che il kernel non ha
//! titolo di leggere. Un registro delle mutazioni che dipendesse da loro sarebbe
//! vero finché qualcuno non spegne un interruttore. Il che non vuol dire che
//! vada duplicato: gli snapshot restano l'unico posto in cui il **contenuto**
//! di ieri è conservato, e questo file non ne tiene nemmeno una copia.
//!
//! # La classe, e perché non sta sotto `data/`
//!
//! Sta **direttamente in `.fub/`**, che per la
//! [0048](../../../docs/decisions/0048-una-radice-sola.md) vuol dire
//! **autorevole**: la profondità dichiara la classe, e un registro di ciò che è
//! successo non si rifà da niente — ricostruirlo vorrebbe dire sapere cosa è
//! successo, che è ciò per cui esiste.
//!
//! # La versione di schema sta su **ogni riga**
//!
//! E non in testa al file come nell'anagrafe (§15.3, [`crate::entries`]), per
//! una ragione che segue dalla classe. Un derivato di una versione ignota si
//! butta e si rifà, quindi un numero in testa basta; questo file non si può
//! buttare, quindi **sopravvive agli aggiornamenti di Fub** e la versione dopo
//! ci appenderà le proprie righe sotto le nostre. Un numero in testa diventerebbe
//! una bugia al primo aggiornamento. Con la versione per riga, un lettore salta
//! ciò che non conosce e legge il resto — che è la stessa regola della coda
//! troncata, qui sotto, applicata a una riga che non è rotta ma è di domani.
//!
//! # La coda troncata
//!
//! Un crash a metà aggiunta lascia in coda dei byte incompleti — il supporto non
//! li può evitare ([`VaultStorage::append`]). Il formato li rende riconoscibili:
//! **un record è una riga**, e una riga è finita quando è finita con `\n`.
//! L'ultima riga senza terminatore si scarta, come si scarta qualunque riga che
//! non si parsa; ciò che viene prima si legge tutto. È il principio del §15.7:
//! la verità non si rifiuta di aprire, si apre dicendo cosa non ha letto — e
//! infatti [`Lettura::scartate`] lo dice.
//!
//! # Quanto cresce, e chi lo pota
//!
//! Un file in coda che nessuno tronca sarebbe l'unico posto del progetto che
//! cresce e non cala mai — la frase è di [`crate::viewstate`], che il problema lo
//! aveva e l'ha risolto. Il tetto è [`TETTO`] record e la politica è
//! **dichiarata, non silenziosa**, come il tetto dei venti recenti del registro
//! dei vault: si pota **all'apertura del vault**, cade fuori il più vecchio, e
//! ciò che si perde è la possibilità di annullare e di verificare le operazioni
//! di allora. Il vault non perde niente: è sul disco dov'era.
//!
//! Si pota all'apertura e non a ogni aggiunta perché potare vuol dire riscrivere
//! il file intero, e l'apertura è il momento in cui quel costo è già in conto.
//! E il taglio **rispetta il confine di un lotto**: tagliare in mezzo a una
//! rinomina con duecento sorgenti lascerebbe un'operazione che si annulla per un
//! pezzo, che è peggio di una che non si annulla affatto.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::{EditRequest, Revision};
use fub_abi::event::{BatchId, Origin};
use fub_abi::model::DocId;
use serde::{Deserialize, Serialize};

use crate::storage::VaultStorage;
use crate::vault::FUB_DIR;

/// La versione di schema di **un record** (§15.3). Vedi il § in testa al modulo
/// per il perché non stia in testa al file.
pub const SCHEMA_VERSION: u32 = 1;

/// Il nome del file dentro [`FUB_DIR`].
const FILE: &str = "journal.jsonl";

/// Quanti record si conservano. Il tetto è dichiarato: chi cade fuori è il più
/// vecchio, e ciò che si perde con lui è la possibilità di annullare e di
/// verificare quell'operazione — non la nota, che sta nel vault.
///
/// Diecimila è largo per un uso normale (un salvataggio è un record) e stretto
/// abbastanza da tenere il file nell'ordine dei megabyte, cioè leggibile in un
/// colpo all'apertura del vault.
pub const TETTO: usize = 10_000;

/// Cosa è successo a un documento.
///
/// Le varianti sono sei e non una sola con dentro un verbo, per la ragione per
/// cui [`Actor`](fub_abi::event::Actor) è un `enum` chiuso: ciò che ogni
/// mutazione porta con sé è **diverso**, e un record libero avrebbe lasciato a
/// ogni punto di mutazione la propria convenzione su come scriverlo.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum JournalOp {
    /// Un documento che non c'era. L'inverso è cestinarlo.
    Created { doc: DocId, to: Revision },
    /// Un documento riscritto per intero: il salvataggio dell'editor.
    ///
    /// **È la sola variante senza inverso**, e `from` è ciò che si può dire
    /// senza rileggere il file — l'impronta che l'anagrafe teneva, oppure
    /// `None` se non la si sapeva. Con l'impronta chi legge sa *se* il
    /// documento è ancora quello che questa riga ha prodotto; per riportarlo
    /// indietro servirebbe il testo, e il testo qui non c'è (vedi il modulo).
    Written {
        doc: DocId,
        from: Option<Revision>,
        to: Revision,
    },
    /// Una modifica chirurgica, con **l'inverso già calcolato**
    /// ([0008](../../../docs/decisions/0008-modifica-chirurgica.md)): porta i
    /// byte sostituiti e non il documento, e la sua `base` è la revisione che
    /// questa modifica ha prodotto — quindi applicarlo dopo che qualcun altro ha
    /// scritto fallisce invece di cancellargli il lavoro.
    Edited {
        doc: DocId,
        from: Revision,
        to: Revision,
        inverse: EditRequest,
    },
    /// Cestinato: `trash` è il nome che ha assunto nel cestino. L'inverso è un
    /// ripristino verso `doc`.
    Trashed { doc: DocId, trash: DocId },
    /// Ripristinato dal cestino. L'inverso è cestinare di nuovo.
    Restored { trash: DocId, doc: DocId },
    /// Rinominato o spostato — vale per un documento come per un allegato
    /// ([0046](../../../docs/decisions/0046-l-anagrafe-del-vault.md)).
    /// L'inverso è la rinomina all'incontrario.
    Renamed { from: DocId, to: DocId },
}

impl JournalOp {
    /// Questa riga porta con sé abbastanza per tornare indietro?
    ///
    /// Non *come* si torna indietro — quello è di chi lo farà, e sta nel
    /// vocabolario dei comandi ([0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md))
    /// —, ma se l'informazione c'è. Esiste perché la risposta `false` deve
    /// essere leggibile da chi compone un rollback, invece di essere un ramo
    /// dimenticato in fondo a un `match`.
    pub fn is_invertible(&self) -> bool {
        !matches!(self, JournalOp::Written { .. })
    }
}

/// Una riga del registro.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalRecord {
    /// La versione di schema di **questa riga**.
    pub v: u32,
    /// Millisecondi UNIX.
    pub at: u64,
    /// Chi ha chiesto, e dentro quale lotto (decisioni 0011 e 0012).
    ///
    /// Il record intero e non i suoi due campi sparsi qui dentro, per la ragione
    /// per cui [`Notice`](fub_abi::event::Notice) fa lo stesso: l'origine è
    /// ortogonale a *cosa* è successo.
    pub origin: Origin,
    /// Chi ha scritto la riga: un'identità per **apertura del vault**.
    ///
    /// Serve a una cosa sola, e senza non funzionerebbe: il contatore dei lotti
    /// riparte da zero a ogni avvio, e sullo stesso file scrivono anche due
    /// installazioni di Fub sulla stessa cartella. Un lotto è quindi la
    /// **coppia** (`writer`, `batch`), non il solo `batch` — vedi
    /// [`JournalRecord::batch_key`].
    pub writer: String,
    pub op: JournalOp,
}

impl JournalRecord {
    /// La chiave con cui due righe stanno nello **stesso** lotto. `None` per una
    /// mutazione che sta da sola.
    pub fn batch_key(&self) -> Option<(&str, BatchId)> {
        self.origin.batch.map(|b| (self.writer.as_str(), b))
    }
}

/// Ciò che una lettura del registro ha trovato, **e ciò che non ha letto**.
#[derive(Debug, Default)]
pub struct Lettura {
    /// I record, dal più vecchio al più recente.
    pub records: Vec<JournalRecord>,
    /// Quante righe sono state scartate: una coda troncata da un crash, una riga
    /// illeggibile, o una riga di una versione di schema che non si conosce.
    /// Non è un errore ed è per questo che si conta: chi legge deve poter dire
    /// che la sua vista è parziale, invece di crederla intera.
    pub scartate: usize,
}

/// Il registro append-only di un vault.
pub(crate) struct Journal {
    path: Utf8PathBuf,
    storage: Arc<dyn VaultStorage>,
    /// L'identità di questa apertura (vedi [`JournalRecord::writer`]).
    writer: String,
}

/// Il path del registro dentro un vault.
pub fn journal_path(root: &Utf8Path) -> Utf8PathBuf {
    root.join(FUB_DIR).join(FILE)
}

impl Journal {
    /// Apre il registro di un vault e lo **pota** se ha passato il tetto.
    ///
    /// Non fallisce: un registro che non si legge non si sovrascrive (è
    /// autorevole) e non impedisce di appendere sotto — che è il degrado giusto,
    /// perché rifiutarsi di registrare le mutazioni nuove per via di una riga
    /// vecchia rotta perderebbe anche quelle.
    pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {
        let journal = Journal {
            path: journal_path(root),
            storage,
            // Sedici cifre esadecimali dal caso del kernel: serve che due
            // aperture non collidano, non che nessuno le indovini. Otto byte
            // sono due ordini di grandezza sotto il tetto, quindi il rifiuto è
            // irraggiungibile e l'`expect` dice quale invariante lo esclude —
            // non «speriamo».
            writer: crate::random::random_bytes(8)
                .expect("otto byte stanno sotto ogni tetto")
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        };
        journal.ripara_la_coda();
        journal.pota();
        journal
    }

    /// Se il file non finisce con un terminatore, ne aggiunge uno.
    ///
    /// È la riparazione minima della coda troncata, e serve a **limitare il
    /// danno a ciò che il crash ha già fatto**: senza, la prima aggiunta dopo la
    /// riapertura si attaccherebbe in fondo alla riga rotta e le due diventerebbero
    /// una riga illeggibile sola — cioè un record perso dal crash e un secondo
    /// perso da noi. Non si toglie niente e non si riscrive niente: la riga rotta
    /// resta, illeggibile, e la lettura la conta.
    fn ripara_la_coda(&self) {
        let Ok(raw) = self.storage.read(&self.path) else {
            return;
        };
        if raw.last() == Some(&b'\n') || raw.is_empty() {
            return;
        }
        if let Err(e) = self.storage.append(&self.path, b"\n") {
            tracing::warn!(target: "fub.kernel", "registro: coda non chiusa: {e}");
        }
    }

    /// Legge il registro, scartando ciò che non è una riga intera di questa
    /// versione.
    pub(crate) fn read(&self) -> Lettura {
        let Ok(raw) = self.storage.read(&self.path) else {
            // Il file non c'è: un vault a cui non è ancora successo niente.
            return Lettura::default();
        };
        parse(&raw)
    }

    /// Appende una riga. L'esito non risale: vedi [`Journal::pota`].
    pub(crate) fn append(&self, origin: Origin, op: JournalOp) -> Result<(), String> {
        let record = JournalRecord {
            v: SCHEMA_VERSION,
            at: crate::time::now_unix_millis(),
            origin,
            writer: self.writer.clone(),
            op,
        };
        let mut riga = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
        // Il terminatore fa parte del record: senza, l'ultima riga di un file
        // scritto per intero sarebbe indistinguibile da una troncata a metà.
        riga.push(b'\n');
        self.storage
            .append(&self.path, &riga)
            .map_err(|e| format!("non riesco a scrivere {}: {e}", self.path))
    }

    /// Riscrive il file tenendo le ultime [`TETTO`] righe, se sono di più.
    ///
    /// Le righe si tengono **testuali** e non riserializzate, ed è la riga che
    /// rende la potatura sicura: qui dentro può esserci una riga di una versione
    /// che questa Fub non conosce — scritta da una Fub più nuova sullo stesso
    /// vault — e riscrivere il file dai soli record letti la cancellerebbe. Un
    /// registro autorevole non si butta e nemmeno si riassume.
    ///
    /// Il taglio si sposta in avanti fino al **primo record di un lotto**: una
    /// coda che comincia a metà di una rinomina con duecento sorgenti sarebbe
    /// un'operazione annullabile per un pezzo, che è peggio di una non
    /// annullabile.
    ///
    /// Un fallimento non risale e non blocca niente: un vault si apre anche se
    /// il suo registro non si è potuto potare, e la riga successiva ci si
    /// appende sopra lo stesso.
    fn pota(&self) {
        let Ok(raw) = self.storage.read(&self.path) else {
            return;
        };
        // Solo le righe **intere**: ciò che resta senza terminatore lo ha già
        // chiuso `ripara_la_coda`, quindi qui o è tutto terminato o il file non
        // si è potuto riparare — e in quel caso non lo si riscrive di certo.
        let righe: Vec<&[u8]> = raw.split(|b| *b == b'\n').collect();
        let (Some(ultima), righe) = (righe.last(), &righe[..righe.len().saturating_sub(1)]) else {
            return;
        };
        if !ultima.is_empty() || righe.len() <= TETTO {
            return;
        }
        let chiave = |riga: &[u8]| -> Option<(String, BatchId)> {
            let r: JournalRecord = serde_json::from_slice(riga).ok()?;
            r.origin.batch.map(|b| (r.writer, b))
        };
        let mut taglio = righe.len() - TETTO;
        while taglio > 0 && taglio < righe.len() {
            let qui = chiave(righe[taglio]);
            if qui.is_none() || qui != chiave(righe[taglio - 1]) {
                break;
            }
            taglio += 1;
        }
        let mut bytes = Vec::new();
        for riga in &righe[taglio..] {
            bytes.extend_from_slice(riga);
            bytes.push(b'\n');
        }
        // Una `write` e non una `append`: qui il file si **sostituisce**, ed è
        // l'unico momento in cui il registro passa dalla scrittura atomica del
        // supporto (0065) — cioè l'unico in cui perderlo tutto insieme sarebbe
        // possibile, se non fosse atomica.
        if let Err(e) = self.storage.write(&self.path, &bytes) {
            tracing::warn!(target: "fub.kernel", "registro: non potato: {e}");
        }
    }
}

/// Le righe intere di questa versione, e il conto di ciò che si è scartato.
fn parse(raw: &[u8]) -> Lettura {
    let mut lettura = Lettura::default();
    let mut resto = raw;
    while let Some(fine) = resto.iter().position(|b| *b == b'\n') {
        let riga = &resto[..fine];
        resto = &resto[fine + 1..];
        if riga.is_empty() {
            continue;
        }
        match serde_json::from_slice::<JournalRecord>(riga) {
            // Una versione che non si conosce è **di domani**, non rotta: si
            // salta come si salta una riga illeggibile, e si conta.
            Ok(record) if record.v == SCHEMA_VERSION => lettura.records.push(record),
            _ => lettura.scartate += 1,
        }
    }
    // Ciò che resta senza terminatore è la coda troncata da un crash.
    if !resto.is_empty() {
        lettura.scartate += 1;
    }
    lettura
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MemStorage;
    use fub_abi::event::Actor;

    fn banco() -> (Utf8PathBuf, Arc<MemStorage>) {
        (Utf8PathBuf::from("/vault"), Arc::new(MemStorage::new()))
    }

    fn rinomina(n: u32) -> JournalOp {
        JournalOp::Renamed {
            from: DocId::new(format!("{n}.md")),
            to: DocId::new(format!("{n}-nuovo.md")),
        }
    }

    #[test]
    fn una_riga_per_mutazione_e_si_rileggono_in_ordine() {
        let (root, storage) = banco();
        let journal = Journal::open(&root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        for n in 0..3 {
            journal
                .append(Origin::by(Actor::User), rinomina(n))
                .expect("appende");
        }
        let lettura = journal.read();
        assert_eq!(lettura.records.len(), 3);
        assert_eq!(lettura.scartate, 0);
        assert_eq!(lettura.records[0].op, rinomina(0));
        assert_eq!(lettura.records[2].op, rinomina(2));
    }

    /// Una riga di una versione che non si conosce non fa rifiutare il file: si
    /// salta e si conta, come la coda troncata. È la regola che permette a
    /// questo file di sopravvivere a un aggiornamento di Fub.
    #[test]
    fn una_riga_di_domani_si_salta_e_si_conta() {
        let raw = format!(
            "{}\n{{\"v\":99,\"at\":1,\"origin\":{{\"actor\":{{\"kind\":\"user\"}},\"batch\":null}},\"writer\":\"x\",\"op\":{{\"op\":\"created\",\"doc\":\"b.md\",\"to\":\"r\"}}}}\n",
            serde_json::to_string(&JournalRecord {
                v: SCHEMA_VERSION,
                at: 1,
                origin: Origin::by(Actor::User),
                writer: "x".into(),
                op: rinomina(0),
            })
            .unwrap()
        );
        let lettura = parse(raw.as_bytes());
        assert_eq!(lettura.records.len(), 1, "la riga di oggi si legge");
        assert_eq!(lettura.scartate, 1, "e quella di domani si conta");
    }

    #[test]
    fn il_tetto_taglia_il_piu_vecchio() {
        let (root, storage) = banco();
        let journal = Journal::open(&root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        for n in 0..(TETTO as u32 + 5) {
            journal
                .append(Origin::by(Actor::User), rinomina(n))
                .expect("appende");
        }
        assert_eq!(journal.read().records.len(), TETTO + 5, "prima di potare");

        // Potare avviene all'apertura, non a ogni riga.
        let riaperto = Journal::open(&root, storage as Arc<dyn VaultStorage>);
        let lettura = riaperto.read();
        assert_eq!(lettura.records.len(), TETTO);
        assert_eq!(
            lettura.records[0].op,
            rinomina(5),
            "cade fuori il più vecchio"
        );
    }
}
