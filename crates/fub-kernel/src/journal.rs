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
//! # Il contenuto di prima non ci sta — **nessuno**
//!
//! È la scelta che decide la forma del formato, ed è una regola senza
//! eccezioni: *un registro dice cosa è successo, non cosa c'era scritto*. Un
//! registro che si porta dietro il testo precedente è il vault scritto una
//! seconda volta accanto a sé stesso, dentro un file **autorevole** che nessuno
//! può buttare e che sopravvive alla nota da cui quel testo viene.
//!
//! Per un pezzo di strada la regola ha avuto un'eccezione, e nessuno l'aveva
//! sommata a questo paragrafo: [`JournalOp::Edited`] portava l'inverso della
//! modifica ([`EditReport::inverse`](fub_abi::edit::EditReport::inverse)), cioè
//! **i byte che l'utente aveva appena sostituito**. La
//! [0103](../../../docs/decisions/0103-un-registro-dice-cosa-e-successo.md) l'ha
//! tolta e al suo posto ha messo l'**impronta** ([`EditFootprint`]): dove la
//! modifica ha toccato e quanti byte c'erano al suo posto, mai quali. Un audit
//! chiede *quando, chi, dove, quanto* e ha ancora tutto; per *cosa* c'era
//! scritto ieri il posto è il versioning, che si spegne e si cancella.
//!
//! # Cosa si torna indietro da qui, e cosa no
//!
//! L'inverso di una mutazione **strutturale** si deduce dalla riga: l'inverso di
//! una rinomina è la rinomina all'incontrario, quello di una cancellazione è un
//! ripristino dal cestino. È la 0045 letta qui: *l'inverso strutturale è un
//! comando, non un vocabolario*, e per quelle quattro varianti il registro basta.
//!
//! Le due che portano testo — [`JournalOp::Written`], il salvataggio
//! dell'editor, e [`JournalOp::Edited`], la modifica chirurgica — da qui non si
//! tornano indietro, e [`JournalOp::is_invertible`] lo dice invece di lasciarlo
//! scoprire. Per la prima è così da sempre; per la seconda è il prezzo della
//! 0103, ed è dichiarato perché **misurato**: l'annullamento vero non è mai
//! passato di qui. Sta in [`crate::undo`], che è una pila in memoria (0045) e
//! tiene i byte finché la sessione è aperta — cioè finché servono davvero.
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
//! # La coda troncata, e perché costa **una riga sola**
//!
//! Un crash a metà aggiunta lascia in coda dei byte incompleti — il supporto non
//! li può evitare ([`VaultStorage::append`]). Il formato li rende riconoscibili:
//! **un record è una riga**, e una riga è finita quando è finita con `\n`.
//! L'ultima riga senza terminatore si scarta, come si scarta qualunque riga che
//! non si parsa; ciò che viene prima si legge tutto. È il principio del §15.7:
//! la verità non si rifiuta di aprire, si apre dicendo cosa non ha letto — e
//! infatti [`Lettura::scartate`] lo dice.
//!
//! Scartare in lettura però non basta, e ciò che manca non è la riga rotta: è
//! **quella dopo**. Se l'aggiunta seguente cominciasse dai byte del suo JSON si
//! attaccherebbe in fondo alla riga rotta, e le due diventerebbero una riga
//! illeggibile sola — un record perso dal crash e un secondo perso da noi. Per
//! questo il delimitatore sta da **tutte e due** le parti del record: si appende
//! `\n{…}\n`, cioè un record **si delimita da sé** e chi lo scrive non deve
//! sapere come è finito chi lo precede. Una riga vuota non è un record e la
//! lettura la salta già, quindi il file di ieri si legge oggi e il file di oggi
//! si legge con il lettore di ieri: non è un formato nuovo, è lo stesso formato
//! che non chiede più a nessuno di essere in buono stato.
//!
//! È il posto dove è finita la riparazione che questo modulo faceva
//! all'apertura — rileggere il file e, se non finiva con `\n`, appendercene uno.
//! Chiudeva la riga rotta, ma decideva su una lettura fatta **fuori dal
//! lucchetto**: fra quella lettura e l'aggiunta che riparava ci stava la riga di
//! un altro processo, che la riparazione si attaccava addosso esattamente come
//! avrebbe fatto la riga dopo (difetti 0162 e 0163). Un delimitatore che ogni
//! record si porta davanti non ha nessuna finestra da chiudere: costa un byte
//! per riga, e all'apertura non costa nessuna lettura.
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
//!
//! # E chi decide **per quanto**
//!
//! Il tetto è una rete strutturale, non una scelta: è una scadenza che dipende
//! da quanto si scrive, non da cosa si vuole tenere. Chi apre il vault due volte
//! l'anno si ritrova dieci anni di path; chi ci lavora tutti i giorni, due mesi.
//! Accanto al tetto c'è quindi una **finestra dichiarata**,
//! [`RETENTION_DAYS`], che è dell'utente: fuori dalla finestra la riga cade,
//! qualunque sia il conto. Zero — il default — vuol dire *per sempre*, cioè il
//! comportamento di prima: un registro autorevole non si accorcia perché è
//! arrivato un aggiornamento.
//!
//! I due criteri non sono due potature: il taglio è **il più avanti dei due**, e
//! da lì scorre una volta sola fino al confine di lotto. Una regola sola nel
//! posto che entrambi attraversano.
//!
//! # Chi lo cancella
//!
//! [`Journal::clear`], dietro il comando `vault.clear-journal`. Perché la
//! [0086](../../../docs/decisions/0086-una-cronologia-e-la-sua-porta.md) ha già
//! la regola per un dato di questa specie — chi lo dichiara non è chi lo può
//! togliere, e l'esecuzione sta dove sta il potere — e sul journal il potere è
//! solo del kernel. Un dato dell'utente che nessun gesto dell'utente raggiunge è
//! un dato che l'utente non possiede, e il patto di Fub dice il contrario.
//!
//! Cancella **tutto**, comprese le righe di una Fub più nuova che la potatura si
//! guarda bene dal toccare — e la differenza è chi ha chiesto: potare è
//! manutenzione e non deve perdere ciò che non capisce, svuotare è un gesto
//! esplicito e irreversibile che vuole esattamente quello.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::{AppliedEdit, Revision};
use fub_abi::event::{BatchId, Origin};
use fub_abi::model::{DocId, Span};
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use serde::{Deserialize, Serialize};

use crate::storage::VaultStorage;
use crate::vault::FUB_DIR;
use fub_abi::schema::SchemaVersion;

/// La versione di schema di **un record** (§15.3). Vedi il § in testa al modulo
/// per il perché non stia in testa al file.
pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Il nome del file dentro [`FUB_DIR`].
const FILE: &str = "journal.jsonl";

/// Quanti record si conservano. Il tetto è dichiarato: chi cade fuori è il più
/// vecchio, e ciò che si perde con lui è la possibilità di annullare e di
/// verificare quell'operazione — non la nota, che sta nel vault.
///
/// Diecimila è largo per un uso normale (un salvataggio è un record) e stretto
/// abbastanza da tenere il file nell'ordine dei megabyte, cioè leggibile in un
/// colpo all'apertura del vault.
pub const CEILING: usize = 10_000;

/// Per quanti giorni si conserva una riga. **Zero = per sempre**, ed è il
/// default: vedi il § «E chi decide *per quanto*» in testa al modulo.
pub const RETENTION_DAYS: &str = "journal.retention.days";

/// Il massimo scrivibile nella finestra, in giorni. Dieci anni: oltre, una
/// finestra è indistinguibile dal «per sempre» che lo zero dice già — e un
/// estremo che non si può scrivere è meglio di un numero che promette una
/// scadenza e non ne ha una.
const RETENTION_MAX: f64 = 3650.0;

/// La chiave della finestra come [`SettingSpec`], dichiarata **qui** e non fra
/// quelle del core per il criterio di §11.1: una chiave sta dove sta chi la
/// legge, e questa la legge il registro.
///
/// Non è `program_writable`, per la ragione di `history.enabled`: un componente
/// che potesse allungare la finestra allungherebbe la conservazione dei path
/// dell'utente da dietro un interruttore che l'utente crede suo. E non è
/// `per_machine`: il registro vive dentro il vault e viaggia con lui, quindi
/// «per quanto lo tengo» è una proprietà dell'archivio — la stessa riga con cui
/// la 0076 ha fatto scendere le impostazioni nel vault.
pub fn journal_settings() -> Vec<SettingSpec> {
    vec![SettingSpec::new(
        RETENTION_DAYS,
        Text::key(J_RETENTION),
        SettingKind::Number {
            default: 0.0,
            min: Some(0.0),
            max: Some(RETENTION_MAX),
        },
    )
    .describing(Text::key(J_RETENTION_DESC))
    // Il gruppo è **quello del core**, non uno nuovo con lo stesso nome: due
    // gruppi «Privacy» scritti da due componenti sarebbero due sezioni identiche
    // nel pannello. Per questo la chiave del gruppo non è tradotta qui sotto —
    // la traduce chi l'ha inventata.
    .grouped(Text::key(GRUPPO_PRIVACY))]
}

const GRUPPO_PRIVACY: &str = "core.group.privacy";
const J_RETENTION: &str = "journal.retention";
const J_RETENTION_DESC: &str = "journal.retention.desc";

/// Le frasi della finestra, nel catalogo di chi le ha scritte (0040).
///
/// La descrizione **nomina il file**, e non è una nota per sviluppatori: fino
/// alla 0103 nessuna riga del prodotto diceva che questo registro esiste, e un
/// dato che l'utente non sa di avere non è un dato che può decidere di tenere.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(J_RETENTION, "Conserva il registro delle modifiche per")
            .with(
                J_RETENTION_DESC,
                "Giorni per cui restano nel registro di questo vault \
                 (`.fub/journal.jsonl`) le righe che dicono quale nota è stata \
                 creata, modificata, cestinata o rinominata, quando e da chi. Le \
                 righe non contengono il testo delle note. Zero = per sempre; le \
                 più vecchie cadono comunque dopo diecimila. Per svuotarlo subito, \
                 il comando «Svuota il registro delle modifiche».",
            ),
        StringCatalog::new("en")
            .with(J_RETENTION, "Keep the change log for")
            .with(
                J_RETENTION_DESC,
                "Days that this vault's log (`.fub/journal.jsonl`) keeps the lines \
                 saying which note was created, edited, trashed or renamed, when \
                 and by whom. The lines do not contain the text of your notes. \
                 Zero = forever; the oldest ones drop out after ten thousand \
                 anyway. To empty it now, use the «Empty the change log» command.",
            ),
    ]
}

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
    /// Una modifica chirurgica
    /// ([0008](../../../docs/decisions/0008-modifica-chirurgica.md)), con la sua
    /// **impronta**: dove ha toccato e quanto ha sostituito, mai con cosa.
    ///
    /// Portava l'inverso, cioè i byte dell'utente; la 0103 li ha tolti. Il campo
    /// si chiama `footprint` e non più `inverse` **apposta**: un nome che
    /// promette di poter tornare indietro è un nome che qualcuno proverà ad
    /// applicare.
    Edited {
        doc: DocId,
        from: Revision,
        to: Revision,
        footprint: Vec<EditFootprint>,
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

/// L'impronta di **un** edit applicato: dove ha toccato il documento nuovo, e
/// quanti byte c'erano al suo posto. Mai quali.
///
/// È ciò che resta di [`AppliedEdit`] quando gli si toglie il testo, e la
/// conversione è a senso unico apposta: da qui non si risale.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditFootprint {
    /// Dove, in byte UTF-8 del sorgente **dopo** la modifica — le stesse
    /// coordinate di [`AppliedEdit::span`], cioè quelle della `to` del record.
    pub span: Span,
    /// Quanti byte c'erano al suo posto. Zero quando l'edit ha solo inserito.
    pub replaced: usize,
}

impl EditFootprint {
    /// L'impronta di ciò che una modifica ha applicato.
    ///
    /// Una per edit e in ordine di documento, come `applied`: non si fondono le
    /// impronte che condividono un punto di partenza — quella fusione serviva a
    /// [`EditReport::inverse`](fub_abi::edit::EditReport::inverse) per produrre
    /// edit disgiunti *applicabili*, e qui non si applica niente. Fonderle
    /// perderebbe il conto di quanti edit erano.
    pub fn of(applied: &[AppliedEdit]) -> Vec<Self> {
        applied
            .iter()
            .map(|a| EditFootprint {
                span: a.span,
                replaced: a.replaced.len(),
            })
            .collect()
    }
}

impl JournalOp {
    /// Questa riga porta con sé abbastanza per tornare indietro?
    ///
    /// Non *come* si torna indietro — quello è di chi lo farà, e sta nel
    /// vocabolario dei comandi ([0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md))
    /// —, ma se l'informazione c'è. Esiste perché la risposta `false` deve
    /// essere leggibile da chi compone un rollback, invece di essere un ramo
    /// dimenticato in fondo a un `match`.
    ///
    /// Sono due le varianti che rispondono `false`, e sono **le due che
    /// porterebbero testo**: la riscrittura integrale da sempre, la modifica
    /// chirurgica dalla 0103. Non è una coincidenza ed è la regola del modulo
    /// vista da qui — ciò che per tornare indietro vuole il contenuto di ieri,
    /// da un registro non torna indietro, perché il contenuto di ieri in un
    /// registro non ci sta.
    pub fn is_invertible(&self) -> bool {
        !matches!(self, JournalOp::Written { .. } | JournalOp::Edited { .. })
    }
}

/// Una riga del registro.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalRecord {
    /// La versione di schema di **questa riga**.
    pub v: SchemaVersion,
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
pub struct JournalRead {
    /// I record, dal più vecchio al più recente.
    pub records: Vec<JournalRecord>,
    /// Quante righe sono state scartate: una coda troncata da un crash, una riga
    /// illeggibile, o una riga di una versione di schema che non si conosce.
    /// Non è un errore ed è per questo che si conta: chi legge deve poter dire
    /// che la sua vista è parziale, invece di crederla intera.
    pub pruned: usize,
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
        // Nessuna riparazione della coda, e non è una dimenticanza: un record
        // porta il proprio delimitatore davanti (vedi [`Journal::append`]),
        // quindi non c'è niente da chiudere prima di appendere — e la lettura
        // che avrebbe deciso di chiuderlo starebbe fuori dal lucchetto.
        // Il tetto e basta: qui la finestra **non si sa ancora**. Lo schema di
        // una chiave arriva alla dichiarazione, che è dopo, e leggerne una non
        // dichiarata darebbe un errore — non un default. La potatura per età la
        // fa [`Workspace`] appena la finestra esiste, e ogni volta che cambia.
        journal.prune(0);
        journal
    }

    /// Svuota il registro: vedi il § «Chi lo cancella» in testa al modulo.
    ///
    /// Scrive un file vuoto invece di toglierlo, perché un file che non c'è e un
    /// file vuoto si distinguono solo per chi guarda il disco, e il secondo dice
    /// che qui un registro c'è ed è stato svuotato.
    /// Le righe si contano **dentro** l'aggiornamento e non prima: fra una
    /// lettura fatta fuori e la scrittura ci sta un'aggiunta, e il numero che si
    /// dà a chi ha svuotato sarebbe di una riga che nel frattempo è stata
    /// buttata senza essere contata.
    pub(crate) fn clear(&self) -> Result<usize, String> {
        let mut count = 0;
        self.storage
            .update(&self.path, &mut |current| {
                count = current.map(|raw| parse(raw).records.len()).unwrap_or(0);
                Ok(Some(Vec::new()))
            })
            .map(|()| count)
            .map_err(|and| format!("cannot empty {}: {and}", self.path))
    }

    /// Legge il registro, scartando ciò che non è una riga intera di questa
    /// versione.
    ///
    /// **Un registro che non si legge non è un registro vuoto.** Le due cose
    /// avevano la stessa risposta, e da lì l'annullamento non aveva niente da
    /// disfare senza che nessuno dicesse perché: un file illeggibile per
    /// permessi o per I/O era indistinguibile da un vault a cui non è ancora
    /// successo niente. Il file assente resta l'unico caso che risponde
    /// [`Lettura::default`]; ogni altro guasto risale con il suo tipo.
    ///
    /// Ciò che sta *dentro* il file e non si capisce continua a contarsi in
    /// [`Lettura::scartate`] invece di fermare la lettura: quella è una vista
    /// parziale dichiarata, non un guasto del supporto.
    pub(crate) fn read(&self) -> std::io::Result<JournalRead> {
        let raw = crate::error::optional(self.storage.read(&self.path))?;
        Ok(raw.as_deref().map(parse).unwrap_or_default())
    }

    /// Dove sta il file, per chi deve dire *su cosa* la lettura è fallita.
    pub(crate) fn path(&self) -> &Utf8Path {
        &self.path
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
        let json = serde_json::to_vec(&record).map_err(|and| and.to_string())?;
        // I **due** delimitatori fanno parte del record, e ognuno ha il suo
        // lavoro. Quello in coda dice che la riga è finita: senza, l'ultima riga
        // di un file scritto per intero sarebbe indistinguibile da una troncata
        // a metà. Quello in testa dice che la riga **comincia qui**: senza, una
        // coda lasciata a metà da un crash si porterebbe via anche questo
        // record, e per evitarlo bisognerebbe prima leggere com'è finito il file
        // — cioè decidere fuori dal lucchetto ciò che si scrive dentro. Costa un
        // byte per riga; la riga vuota che ne esce quando il file era intero non
        // è un record e la lettura la salta (vedi il § in testa al modulo).
        let mut row = Vec::with_capacity(json.len() + 2);
        row.push(b'\n');
        row.extend_from_slice(&json);
        row.push(b'\n');
        self.storage
            .append(&self.path, &row)
            .map_err(|and| format!("cannot write {}: {and}", self.path))
    }

    /// Riscrive il file tenendo le ultime [`TETTO`] righe e quelle dentro la
    /// finestra di `giorni` ([`RETENTION_DAYS`]; zero = per sempre).
    ///
    /// I due criteri non fanno due potature: si prende **il taglio più avanti
    /// dei due** e da lì si scorre una volta sola al confine di lotto. Un
    /// secondo passaggio potrebbe tagliare a metà del lotto che il primo aveva
    /// appena rispettato.
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
    pub(crate) fn prune(&self, days: u64) {
        // Un **aggiornamento** e non una lettura seguita da una scrittura, e la
        // differenza è vera ma più stretta di come si legge: `update` rilegge
        // dentro il lucchetto (0066), quindi due potature dello stesso registro
        // non si sovrascrivono a vicenda, e chi ricomponesse il file da una
        // copia letta fuori riscriverebbe invece una fotografia vecchia.
        //
        // **La finestra però non è chiusa, e chi legge qui non deve credere di
        // sì**: `append` non passa dal lucchetto — su `FsStorage` è `O_APPEND` e
        // non aspetta nessuno, ed è la 0067 a rifiutarglielo apposta, perché un
        // lock per riga si pagherebbe a ogni salvataggio —, quindi una riga
        // appesa fra la rilettura e la `write` che sostituisce il file sparisce
        // lo stesso. Ciò che si perde è il *racconto* di un'operazione riuscita,
        // cioè un annullamento in meno, mai l'operazione: il registro si scrive
        // dopo la mutazione (0067), non al posto suo. Il prezzo è dichiarato,
        // non chiuso. (In memoria non si vede: là `append` e `update` prendono
        // lo stesso mutex, quindi il caso da temere è il disco.)
        //
        // Qui il file si **sostituisce**, ed è l'unico momento in cui il
        // registro passa dalla scrittura atomica del supporto (0065): l'unico in
        // cui perderlo tutto insieme sarebbe possibile.
        let outcome = self.storage.update(&self.path, &mut |current| {
            Ok(current.and_then(|raw| pruned(raw, days)))
        });
        if let Err(and) = outcome {
            tracing::warn!(target: "fub.kernel", "journal: not pruned: {and}");
        }
    }
}

/// Il registro potato, o `None` se non c'è niente da togliere.
///
/// È il corpo di [`Journal::pota`] senza il disco: prende i byte che ci sono
/// adesso e torna quelli che ci devono essere. Sta fuori perché è ciò che gira
/// **dentro** il lucchetto del supporto, e ciò che gira là dentro non deve poter
/// toccare il supporto.
fn pruned(raw: &[u8], days: u64) -> Option<Vec<u8>> {
    // Solo un file che finisce per intero si pota: se in coda c'è una riga
    // lasciata a metà da un crash, non la si riscrive di certo — la prossima
    // aggiunta si delimita da sé e il file torna potabile da lì.
    let all: Vec<&[u8]> = raw.split(|b| *b == b'\n').collect();
    let (Some(last), all) = (all.last(), &all[..all.len().saturating_sub(1)]) else {
        return None;
    };
    if !last.is_empty() {
        return None;
    }
    // Una riga vuota non è un record: è il delimitatore in testa di
    // [`Journal::append`] visto da qui. Contarla farebbe tagliare al tetto
    // sbagliato — a metà dei record, con un delimitatore per riga —, e tenerla
    // nel file riscritto non servirebbe a niente: dopo una riscrittura la coda è
    // integra per costruzione, e il record che verrà si delimita da sé.
    let rows: Vec<&[u8]> = all.iter().copied().filter(|r| !r.is_empty()).collect();
    let mut cut = rows
        .len()
        .saturating_sub(CEILING)
        .max(expired(&rows, days));
    if cut == 0 {
        return None;
    }
    let key = |row: &[u8]| -> Option<(String, BatchId)> {
        let r: JournalRecord = serde_json::from_slice(row).ok()?;
        r.origin.batch.map(|b| (r.writer, b))
    };
    while cut > 0 && cut < rows.len() {
        let here = key(rows[cut]);
        if here.is_none() || here != key(rows[cut - 1]) {
            break;
        }
        cut += 1;
    }
    let mut bytes = Vec::new();
    for row in &rows[cut..] {
        bytes.extend_from_slice(row);
        bytes.push(b'\n');
    }
    Some(bytes)
}

/// Quante righe in testa sono più vecchie della finestra. Zero giorni = per
/// sempre, e allora nemmeno si guarda.
///
/// Legge il **solo** `at` e non il record intero, con un tipo suo: una riga
/// scritta da una Fub più nuova non si sa leggere ma si sa **datare**, e
/// trattarla come non datata la farebbe cadere fuori da una finestra che magari
/// non ha passato. Potare non deve perdere ciò che non capisce (vedi
/// [`Journal::pota`]) — svuotare sì, ma quello lo chiede l'utente.
///
/// Per la stessa ragione una riga che non porta nemmeno `at` **ferma** la
/// scansione invece di cadere: il conto delle scadute è un prefisso, e ciò che
/// non si data non è vecchio, è ignoto.
fn expired(rows: &[&[u8]], days: u64) -> usize {
    if days == 0 {
        return 0;
    }
    #[derive(Deserialize)]
    struct When {
        at: u64,
    }
    let threshold = crate::time::now_unix_millis().saturating_sub(days.saturating_mul(86_400_000));
    rows
        .iter()
        .position(|row| match serde_json::from_slice::<When>(row) {
            Ok(q) => q.at >= threshold,
            Err(_) => true,
        })
        .unwrap_or(rows.len())
}

/// Le righe intere di questa versione, e il conto di ciò che si è scartato.
fn parse(raw: &[u8]) -> JournalRead {
    let mut read = JournalRead::default();
    let mut rest = raw;
    while let Some(end) = rest.iter().position(|b| *b == b'\n') {
        let row = &rest[..end];
        rest = &rest[end + 1..];
        if row.is_empty() {
            continue;
        }
        match serde_json::from_slice::<JournalRecord>(row) {
            // Una versione che non si conosce è **di domani**, non rotta: si
            // salta come si salta una riga illeggibile, e si conta.
            Ok(record) if record.v == SCHEMA_VERSION => read.records.push(record),
            _ => read.pruned += 1,
        }
    }
    // Ciò che resta senza terminatore è la coda troncata da un crash.
    if !rest.is_empty() {
        read.pruned += 1;
    }
    read
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::MemStorage;
    use fub_abi::event::Actor;

    fn bench() -> (Utf8PathBuf, Arc<MemStorage>) {
        (Utf8PathBuf::from("/vault"), Arc::new(MemStorage::new()))
    }

    fn rename(n: u32) -> JournalOp {
        JournalOp::Renamed {
            from: DocId::new(format!("{n}.md")),
            to: DocId::new(format!("{n}-nuovo.md")),
        }
    }

    #[test]
    fn a_row_for_mutation_and_is_reread_in_order() {
        let (root, storage) = bench();
        let journal = Journal::open(&root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        for n in 0..3 {
            journal
                .append(Origin::by(Actor::User), rename(n))
                .expect("appends");
        }
        let read = journal.read().expect("journal readable");
        assert_eq!(read.records.len(), 3);
        assert_eq!(read.pruned, 0);
        assert_eq!(read.records[0].op, rename(0));
        assert_eq!(read.records[2].op, rename(2));
    }

    /// Una riga di una versione che non si conosce non fa rifiutare il file: si
    /// salta e si conta, come la coda troncata. È la regola che permette a
    /// questo file di sopravvivere a un aggiornamento di Fub.
    #[test]
    fn a_row_of_domani_is_skips_and_is_counts() {
        let raw = format!(
            "{}\n{{\"v\":99,\"at\":1,\"origin\":{{\"actor\":{{\"kind\":\"user\"}},\"batch\":null}},\"writer\":\"x\",\"op\":{{\"op\":\"created\",\"doc\":\"b.md\",\"to\":\"r\"}}}}\n",
            serde_json::to_string(&JournalRecord {
                v: SCHEMA_VERSION,
                at: 1,
                origin: Origin::by(Actor::User),
                writer: "x".into(),
                op: rename(0),
            })
            .unwrap()
        );
        let read = parse(raw.as_bytes());
        assert_eq!(read.records.len(), 1, "today's line is read");
        assert_eq!(read.pruned, 1, "and tomorrow's is counted");
    }

    #[test]
    fn the_ceiling_cuts_the_more_old() {
        let (root, storage) = bench();
        let journal = Journal::open(&root, Arc::clone(&storage) as Arc<dyn VaultStorage>);
        for n in 0..(CEILING as u32 + 5) {
            journal
                .append(Origin::by(Actor::User), rename(n))
                .expect("appends");
        }
        assert_eq!(
            journal.read().expect("journal readable").records.len(),
            CEILING + 5,
            "before pruning"
        );

        // Potare avviene all'apertura, non a ogni riga.
        let reopened = Journal::open(&root, storage as Arc<dyn VaultStorage>);
        let read = reopened.read().expect("journal readable");
        assert_eq!(read.records.len(), CEILING);
        assert_eq!(
            read.records[0].op,
            rename(5),
            "the oldest drops out"
        );
    }
}
