//! Il **buffer di crash**: `.fub/drafts/`, ciò che l'utente ha scritto e non ha
//! ancora salvato (§15.2).
//!
//! # Di chi è questo dato, e perché non è del kernel
//!
//! Il buffer sporco è della **shell**: il kernel non sa cosa l'utente sta
//! battendo, e non deve saperlo — l'editor sta di là apposta, e far attraversare
//! il confine a ogni tasto premuto sarebbe il disegno che
//! [`crate::journal`] rifiuta all'altro capo (*un comando entra da qui, una
//! battuta di tastiera no*). Ciò che il kernel possiede è il **posto**: dove
//! quei byte finiscono, con quale classe, con quale disciplina di scrittura, e
//! chi li ritrova alla riapertura.
//!
//! La riga è quindi netta e vale la pena scriverla, perché è la tensione che
//! questa voce portava con sé (la roadmap la dichiarava *kernel*, e metà del
//! lavoro è di shell): **la shell decide quando una bozza esiste, il kernel
//! decide cosa vuol dire tenerla**.
//!
//! # Perché non basta il journal
//!
//! Perché sono le **due pile** della
//! [0045](../../../docs/decisions/0045-l-undo-ha-due-pile.md), e il journal lo
//! dice già di sé: là dentro ci sta ciò che il kernel *ha fatto* al vault, cioè
//! mutazioni concluse, con il loro inverso. Una bozza è l'opposto in tutti e tre
//! i modi: non è successo niente al vault, non c'è nessun inverso da conservare,
//! e ciò che va tenuto è esattamente la cosa che il journal ha deciso di **non**
//! tenere — il testo. Un registro delle mutazioni che si portasse dietro i
//! buffer sarebbe il vault scritto una seconda volta accanto a sé.
//!
//! E non basta nemmeno il versioning, per la ragione per cui non basta al
//! journal: è un componente spegnibile, alimentato dagli eventi, e fotografa ciò
//! che è stato **salvato** — cioè tutto tranne il caso che questo modulo esiste
//! per coprire.
//!
//! # La classe, e perché sta in `.fub/` e non in `.fub/data/`
//!
//! Una bozza è **lavoro dell'utente che non esiste da nessun'altra parte**: se
//! la si butta, quel testo non c'è più e non si ricostruisce da niente. Per la
//! [0048](../../../docs/decisions/0048-una-radice-sola.md) la profondità
//! dichiara la classe, e questa è la classe autorevole — la stessa del
//! registro, un livello sopra i derivati. Metterla sotto `data/` avrebbe voluto
//! dire dichiarare buttabile ciò che è precisamente l'unica copia.
//!
//! Per la stessa ragione **non** sta nello stato di vista
//! ([0037](../../../docs/decisions/0037-lo-stato-di-vista.md)): quello è il
//! *dove eri rimasto* — scroll, tab attiva, sezioni collassate —, sta nella
//! cartella di configurazione della macchina e si può cancellare senza perdere
//! niente. Una bozza che vivesse là dentro sarebbe testo dell'utente in un
//! contenitore dichiaratamente buttabile, e — peggio — non viaggerebbe col
//! vault: chi apre l'archivio dall'altro computer non ritroverebbe ciò che aveva
//! scritto. La riga di [0086](0086-una-cronologia-e-la-sua-porta.md) letta
//! all'incontrario: *lì* la proprietà che decideva era che il dato **non**
//! viaggia, qui è che deve viaggiare.
//!
//! # Un file per bozza, e non un file solo
//!
//! Perché ogni scrittura è di **una** bozza, e un file unico avrebbe fatto della
//! salvataggio automatico di una nota un aggiornamento di un documento
//! condiviso — cioè l'errore che la
//! [0066](../../../docs/decisions/0066-un-aggiornamento-non-e-una-scrittura.md)
//! ha appena finito di togliere, riportato dentro dalla porta di servizio. Con
//! un file per bozza ogni salvataggio è una **scrittura**, e
//! [`VaultStorage::write`] la fa atomica per costruzione: chi rilegge dopo un
//! crash trova la bozza di prima o quella nuova, mai mezza. È anche ciò che
//! rende il costo proporzionale: si riscrive la nota che si sta battendo, non
//! tutte quelle aperte.
//!
//! Il nome del file è il documento **codificato**, con la stessa funzione dello
//! spazio per-documento ([`fub_abi::rules::doc_data::encode`]), e per la stessa
//! ragione: la codifica è **reversibile**, quindi di ogni file si sa quale nota
//! nomina. Con un'impronta al suo posto la lettura alla riapertura sarebbe
//! impossibile — nessuno saprebbe più a quale documento offrire il recupero.
//!
//! # Cosa NON fa questo modulo
//!
//! **Non decide se recuperare.** Legge le bozze e dice, per ognuna, se il file
//! sotto è ancora quello su cui la bozza era nata ([`Draft::base`]): il
//! confronto lo fa chi la mostra, perché *tenere il mio testo o quello sul
//! disco* è una domanda che si fa a una persona, non un ramo di un `if` nel
//! kernel. È lo stesso principio del §15.7 — la verità non si rifiuta di
//! aprire, si apre dicendo cosa ha trovato.
//!
//! **Non raccoglie.** Lo spazio per-documento ([`crate::docdata`]) si potava da
//! sé perché quei dati non hanno senso senza il documento; una bozza ce l'ha
//! eccome anche quando il documento non c'è più — anzi è il caso in cui vale di
//! più, perché è rimasta l'unica copia. Una nota cancellata mentre una bozza era
//! aperta lascia una bozza **orfana**, che si mostra e si butta con un gesto,
//! non con uno sweep silenzioso: il criterio della
//! [seduta 20](../../../docs/roadmap/20-quando-qualcosa-va-storto.md) è che un
//! dato autorevole non si perde in silenzio, e qui il dato autorevole è il
//! testo.

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::Revision;
use fub_abi::model::DocId;
use fub_abi::rules::doc_data::{decode, encode};
use serde::{Deserialize, Serialize};

use crate::storage::VaultStorage;
use crate::vault::FUB_DIR;
use fub_abi::schema::SchemaVersion;

/// La versione di schema di **una bozza** (§15.3).
///
/// In testa al record e non in testa a un file di indice, perché ogni bozza è un
/// file suo: la versione dopo che non riconoscesse questo formato salta *quella*
/// bozza e legge le altre, invece di perdere l'elenco intero.
pub const SCHEMA_VERSION: SchemaVersion = SchemaVersion::new(1);

/// Il nome della cartella dentro [`FUB_DIR`].
const DIR: &str = "drafts";

/// L'estensione dei file di bozza. C'è perché quella cartella la guarderà anche
/// un umano con un file manager aperto, e un file senza estensione in mezzo a un
/// recupero dati è la cosa che non si apre per paura.
const EXT: &str = "json";

/// La cartella delle bozze di un vault.
pub fn drafts_dir(root: &Utf8Path) -> Utf8PathBuf {
    root.join(FUB_DIR).join(DIR)
}

/// Il testo che l'utente ha scritto e non ha salvato.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    /// La versione di schema di **questa** bozza.
    pub v: SchemaVersion,
    /// Di quale documento è la bozza. Per una nota che non è mai stata salvata è
    /// il nome che avrebbe: un documento che non esiste ancora sul disco.
    ///
    /// **Quale file, lo dice il nome del file; questo campo può solo
    /// precisarlo** (difetto 0169). I due erano due sorgenti per lo stesso
    /// fatto, e due sorgenti che si possono contraddire non sono un secondo
    /// parere: sono una copia che può restare indietro, ed è ciò che restava
    /// dopo una migrazione interrotta — un record che rivendica una nota che
    /// non esiste più. Il nome è la codifica reversibile dell'id
    /// ([`encode`]), quindi la risposta ce l'ha già; ciò che il nome **non**
    /// ha è il caso, là dove il supporto non lo distingue (0165), ed è
    /// esattamente ciò che questo campo aggiunge. [`Drafts::read`] tiene il
    /// campo quando nomina lo **stesso file** in cui la bozza sta, e il nome
    /// quando ne nomina un altro: precisare sì, contraddire no.
    pub doc: DocId,
    /// Millisecondi UNIX dell'ultima volta che questa bozza è stata scritta.
    pub at: u64,
    /// La revisione del **file** nel momento in cui questo buffer ha cominciato
    /// a discostarsene, cioè la base su cui l'utente stava scrivendo.
    ///
    /// `None` vuol dire *non lo so*, non *non c'era nessun file*: chi tiene un
    /// buffer non sempre ha in mano l'impronta da cui è partito. È la
    /// distinzione che decide cosa si può offrire al recupero — con una base si
    /// può dire *il file è cambiato sotto*, senza si possono solo mostrare i due
    /// testi e lasciar scegliere.
    pub base: Option<Revision>,
    /// Il testo del buffer.
    pub text: String,
}

/// Ciò che una lettura delle bozze ha trovato, **e ciò che non ha letto**.
///
/// La stessa forma di [`JournalRead`](crate::journal::JournalRead) e per la stessa
/// ragione: chi legge deve poter dire che la sua vista è parziale invece di
/// crederla intera. Qui pesa di più che altrove — una bozza che non si legge è
/// testo dell'utente perduto, e mostrarne tre quando ce n'erano quattro sarebbe
/// la perdita silenziosa che la seduta 20 vieta.
#[derive(Debug, Default)]
pub struct DraftRead {
    /// Le bozze, dalla più recente alla più vecchia.
    pub drafts: Vec<Draft>,
    /// Quanti file non si sono letti: illeggibili, non parsabili, o di una
    /// versione di schema che non si conosce.
    pub pruned: usize,
}

/// Le bozze di un vault.
pub(crate) struct Drafts {
    dir: Utf8PathBuf,
    storage: Arc<dyn VaultStorage>,
}

impl Drafts {
    pub(crate) fn open(root: &Utf8Path, storage: Arc<dyn VaultStorage>) -> Self {
        Drafts {
            dir: drafts_dir(root),
            storage,
        }
    }

    /// Dove stanno, per chi deve dire *su cosa* la lettura è fallita.
    pub(crate) fn dir(&self) -> &Utf8Path {
        &self.dir
    }

    /// Il file di una bozza.
    fn path(&self, doc: &DocId) -> Utf8PathBuf {
        self.dir.join(format!("{}.{EXT}", encode(doc.as_str())))
    }

    /// Scrive (o riscrive) la bozza di un documento.
    ///
    /// Passa da [`VaultStorage::write`], quindi è atomica: è la ragione per cui
    /// questo modulo non ha una riga di `std::fs` dentro. Un buffer di crash che
    /// si scrivesse da sé sarebbe un **secondo modo di essere durevoli** accanto
    /// a quello che il §15.2 ha appena finito di rendere unico — e il primo
    /// posto in cui si scoprirebbe che è meno durevole è un crash.
    pub(crate) fn save(
        &self,
        doc: &DocId,
        text: &str,
        base: Option<Revision>,
        at: u64,
    ) -> std::io::Result<()> {
        let draft = Draft {
            v: SCHEMA_VERSION,
            doc: doc.clone(),
            at,
            base,
            text: text.to_string(),
        };
        let bytes = serde_json::to_vec(&draft).map_err(std::io::Error::other)?;
        self.storage.write(&self.path(doc), &bytes).map(|_| ())
    }

    /// Butta la bozza di un documento. Non c'era: non è un errore — chi salva
    /// una nota che non era sporca chiede di buttare una bozza che non esiste, e
    /// pretendere che il chiamante lo sappia prima vorrebbe dire una lettura per
    /// ogni salvataggio.
    pub(crate) fn discard(&self, doc: &DocId) -> std::io::Result<()> {
        let path = self.path(doc);
        if !self.storage.exists(&path) {
            return Ok(());
        }
        self.storage.remove(&path)
    }

    /// Tutte le bozze, dalla più recente.
    ///
    /// La cartella che **non c'è** è il caso normale — nessuno ha mai avuto un
    /// buffer sporco — e un file rotto in mezzo si conta in
    /// [`Bozze::pruned`] invece di fermare la lettura degli altri.
    ///
    /// **Una cartella che non si legge non è una cartella senza bozze**, e
    /// prima lo era: un `list` fallito per permessi o per I/O faceva sparire in
    /// silenzio dalla vista il lavoro non salvato dell'utente, e il salvataggio
    /// successivo ci scriveva sopra convinto che non ci fosse niente. Qui il
    /// posto in cui questo testo vive è l'unica copia al mondo, quindi il
    /// guasto risale e chi ha chiesto lo vede.
    pub(crate) fn read(&self) -> std::io::Result<DraftRead> {
        let mut drafts = DraftRead::default();
        let Some(entries) = crate::error::optional(self.storage.list(&self.dir))? else {
            return Ok(drafts);
        };
        for entry in entries {
            if !entry.stat.is_file() {
                continue;
            }
            // Il nome dice già di quale documento è: se non lo dice, il file non
            // è nostro e non lo si conta fra le bozze perdute.
            let Some(whose) = entry.path.file_name().and_then(document_from_name) else {
                continue;
            };
            let parsed = self
                .storage
                .read(&entry.path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Draft>(&bytes).ok())
                .filter(|d| d.v == SCHEMA_VERSION)
                // Il record **precisa** il nome, non lo contraddice (vedi
                // [`Draft::doc`]): se dice un id che è lo stesso file, vale lui
                // — è il caso della maiuscola su un supporto che non la
                // distingue —, se ne dice un altro vale dove la bozza sta.
                .map(|d| {
                    if self.storage.same_file(&self.path(&d.doc), &entry.path) {
                        d
                    } else {
                        Draft { doc: whose, ..d }
                    }
                });
            match parsed {
                Some(draft) => drafts.drafts.push(draft),
                None => drafts.pruned += 1,
            }
        }
        // Dalla più recente: è l'ordine in cui si offre un recupero, perché la
        // bozza di dieci secondi fa è quella su cui l'utente era.
        drafts.drafts.sort_by_key(|d| std::cmp::Reverse(d.at));
        Ok(drafts)
    }

    /// La bozza di un documento, se c'è — e un errore se non si è potuto
    /// guardare.
    ///
    /// La stessa regola di [`Drafts::read`], al singolare: il file assente è
    /// `None`, un file che non si legge è un guasto. Chi la chiama è
    /// [`Drafts::migrate`], che su un `None` sposta soltanto il file: leggere un
    /// permesso negato come «non c'era nessuna bozza» le farebbe portare a
    /// destinazione un record che dice ancora il nome vecchio.
    pub(crate) fn get(&self, doc: &DocId) -> std::io::Result<Option<Draft>> {
        let bytes = crate::error::optional(self.storage.read(&self.path(doc)))?;
        Ok(bytes.and_then(|bytes| {
            serde_json::from_slice::<Draft>(&bytes)
                .ok()
                .filter(|d| d.v == SCHEMA_VERSION)
        }))
    }

    /// Segue una rinomina: la bozza di `from` diventa la bozza di `to`.
    ///
    /// Esiste per la ragione per cui esiste [`crate::docdata`]: senza, una nota
    /// rinominata mentre il suo buffer era sporco lascerebbe una bozza sotto un
    /// nome che nessuno visita più — cioè testo dell'utente perso in silenzio,
    /// che è precisamente ciò che questo modulo esiste per impedire.
    /// **La destinazione non si sovrascrive**, e questa è l'unica delle tre
    /// migrazioni che se lo deve dire da sé. Le altre due si affidano alla
    /// garanzia di `migrate_side_data` — «il `to` è libero, perché il rename
    /// rifiuta un documento che esiste» — ma quella garanzia parla di
    /// **documenti**, e una bozza può esserci senza che il documento ci sia: è
    /// il caso di una nota mai salvata, cioè esattamente quella la cui bozza è
    /// l'unica copia al mondo. Rinominare `appunti.md` in `idee.md` mentre
    /// `idee.md` è una nota mai salvata e ancora sporca passava il controllo
    /// dell'anagrafe — il documento non c'è — e cancellava il testo.
    ///
    /// Trovandola occupata la bozza di `to` non si tocca — è il testo non
    /// salvato di un'identità diversa — e quella di `from` non resta sotto
    /// l'id morto, dove nessun recupero la cercherebbe: prende un **nome di
    /// recupero** libero ([`Drafts::recovery_name`]), che decodifica in un
    /// documento che non esiste, e [`Drafts::read`] la elenca fra le bozze
    /// **orfane** — l'unica forma che un recupero ritrova. Due bozze vive in
    /// due posti sono un disordine; una sola, sotto una chiave che nessuno
    /// visita, non si ripara e non si vede.
    ///
    /// # «Occupata» è una domanda sul file, non sul nome
    ///
    /// Perché la rinomina che corregge una maiuscola — `nota.md` → `Nota.md` —
    /// dove il supporto non distingue il caso porta le due bozze **allo stesso
    /// file**: la destinazione occupata *è* la sorgente, e chiedere solo
    /// `exists` faceva fallire ogni correzione di maiuscola lasciando la bozza
    /// orfana sotto la chiave vecchia mentre il documento si era mosso (0165).
    /// La domanda giusta la fa [`VaultStorage::same_file`], e chi la risponde è
    /// il supporto.
    ///
    /// # Due file: una mossa sola
    ///
    /// È la riga di `restore_from_trash`, e per la stessa ragione: *non è un
    /// `write` seguito da un `remove`, quella forma ha un istante in cui la
    /// nota sta in due posti, e un guasto lì dentro ce la lascia*. Qui la
    /// migrazione aggiornava anche il campo `doc` del record, quindi erano due
    /// mutazioni in fila e una `remove` fallita lasciava **due bozze per un
    /// documento solo** — che nessuno riconcilia, perché questo modulo
    /// dichiara di non raccogliere apposta (difetto 0169). La seconda
    /// mutazione non serviva: di quale file è la bozza lo dice il nome del
    /// file, e chi legge lo ricava da lì ([`Draft::doc`]). Resta una mossa
    /// sola — `rename_no_replace`, che o è avvenuta o non è avvenuta, e non
    /// sovrascrive mai una destinazione comparsa nel frattempo.
    ///
    /// # Lo stesso file: prima il record, poi il nome
    ///
    /// Il ramo della maiuscola non può ridursi a una mossa, e per una ragione
    /// che è la stessa di sopra letta al contrario: lì il nome sul disco **non
    /// cambia** — il supporto non distingue il caso — quindi il caso nuovo può
    /// dirlo solo il record, ed è per questo che quel campo esiste ancora. Ciò
    /// che si può scegliere è l'ordine, e l'ordine giusto è scrivere il record
    /// dentro il file che c'è e spostare il nome dopo: una `write` fallita non
    /// ha mosso niente, e una `rename` fallita lascia il record già giusto sul
    /// file che c'è. Prima era il verso opposto, e in mezzo c'era il secondo
    /// stato a metà della voce — la bozza al nome nuovo con dentro scritto
    /// quello vecchio.
    pub(crate) fn migrate(&self, from: &DocId, to: &DocId) -> std::io::Result<()> {
        let old = self.path(from);
        let new = self.path(to);
        if !self.storage.exists(&old) {
            return Ok(());
        }
        if !self.storage.same_file(&old, &new) {
            // La destinazione non si sovrascrive, mai: se ha già una bozza sua
            // — o un concorrente gliene posa una fra qui e la mossa — quella
            // di `from` prende un nome di recupero libero
            // ([`Drafts::recovery_name`]), e la lettura la elenca come
            // bozza orfana. La verifica e la mossa sono una sola operazione:
            // `rename_no_replace`, e non `exists` seguito da `rename` — fra i
            // due non c'è un concorrente che possa farsi sovrascrivere.
            return match self.storage.rename_no_replace(&old, &new) {
                Ok(()) => Ok(()),
                Err(and) if and.kind() == std::io::ErrorKind::AlreadyExists => {
                    self.recovery_name(from, &old)?;
                    Ok(())
                }
                Err(and) => Err(and),
            };
        }
        let Some(mut draft) = self.get(from)? else {
            return self.storage.rename(&old, &new);
        };
        draft.doc = to.clone();
        let bytes = serde_json::to_vec(&draft).map_err(std::io::Error::other)?;
        self.storage.write(&old, &bytes)?;
        self.storage.rename(&old, &new)
    }

    /// Sposta il file di bozza sotto un **nome di recupero** libero, e torna
    /// il percorso del nome nuovo.
    ///
    /// La destinazione ha già una bozza sua — o un concorrente gliene ha posata
    /// una nel frattempo — e nessuna delle due si sovrascrive: il testo che non
    /// può atterrare prende `{stelo}~recupero`, e se preso
    /// `{stelo}~recupero-2`, e così via. Il nome decodifica in un documento che
    /// non esiste, quindi [`Drafts::read`] lo elenca come bozza **orfana**,
    /// l'unica forma che un recupero ritrova. Ogni candidato si prova con
    /// [`VaultStorage::rename_no_replace`] — la creazione e il rifiuto sono una
    /// sola operazione: non c'è un `exists` che guarda e una `rename` che
    /// arriva dopo, e fra le due un concorrente non può occupare il nome.
    ///
    /// **L'estensione del documento si conserva**: `prima.md` diventa
    /// `prima~recupero.md`, non `prima.md~recupero`. Il nome di recupero è un
    /// documento che un domani si può salvare — e un documento senza
    /// estensione riconosciuta il registro dei formati non sa né salvarlo né
    /// renderlo — quindi l'estensione è la sua, l'ultima, e senza estensione
    /// resta `prima~recupero`. Estensione e forma restano quelle di ogni
    /// bozza: un nome che [`document_from_name`] non riconoscesse sarebbe
    /// testo che nessuno sa leggere.
    fn recovery_name(&self, from: &DocId, old: &Utf8Path) -> std::io::Result<Utf8PathBuf> {
        let folder = old.parent().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "il file di bozza non sta in una cartella",
            )
        })?;
        // Lo stelo resta com'è, `~recupero` si attacca davanti all'estensione.
        // Un nome senza doti — o con il punto in testa o in coda — non ha
        // estensione da conservare, e il suffisso va in fondo al nome.
        let (stem, extension) = match from.as_str().rsplit_once('.') {
            Some((s, and)) if !s.is_empty() && !and.is_empty() => (s, Some(and)),
            _ => (from.as_str(), None),
        };
        for n in 1u64.. {
            let candidate = match extension {
                Some(ext) if n == 1 => format!("{stem}~recovery.{ext}"),
                Some(ext) => format!("{stem}~recovery-{n}.{ext}"),
                None if n == 1 => format!("{stem}~recovery"),
                None => format!("{stem}~recovery-{n}"),
            };
            let path = folder.join(format!("{}.{EXT}", encode(candidate.as_str())));
            match self.storage.rename_no_replace(old, &path) {
                Ok(()) => return Ok(path),
                Err(and) if and.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(and) => return Err(and),
            }
        }
        unreachable!("i nomi di recupero non finiscono: a ogni giro l'encode è diverso")
    }
}

/// Di quale documento è la bozza che si chiama così — e `None` se quel nome non
/// è il nome di una bozza.
///
/// Le due domande sono una sola perché hanno una sola risposta: il nome è la
/// codifica del documento ([`encode`]), quindi «è una bozza» vuol dire
/// esattamente «da qui esce un documento». Tenerle separate voleva dire
/// decodificare due volte, e dare a chi legge la possibilità di fare la prima
/// senza la seconda — che è come il campo dentro il record poteva restare
/// indietro rispetto al nome del file (difetto 0169).
fn document_from_name(name: &str) -> Option<DocId> {
    let stem = name.strip_suffix(&format!(".{EXT}"))?;
    if stem.is_empty() {
        return None;
    }
    let doc = decode(stem);
    (!doc.is_empty()).then(|| DocId::new(doc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{DirEntry, Merge, MemStorage, Stat};
    use std::io;

    /// Un supporto che non lascia togliere niente: è il modo di fermare una
    /// migrazione **fra** le sue mutazioni, se ne ha più di una.
    struct NoDelete(MemStorage);

    impl VaultStorage for NoDelete {
        fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
            self.0.read(path)
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
            self.0.write(path, bytes)
        }
        fn update(&self, path: &Utf8Path, merge_entries: Merge<'_>) -> io::Result<()> {
            self.0.update(path, merge_entries)
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
            self.0.append(path, bytes)
        }
        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.0.rename(from, to)
        }
        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.0.rename_no_replace(from, to)
        }
        fn remove(&self, _path: &Utf8Path) -> io::Result<()> {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "il supporto non fa cancellare",
            ))
        }
        fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
            self.0.list(dir)
        }
        fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
            self.0.stat(path)
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
            self.0.remove_empty_dir(dir)
        }
    }

    /// 0169 — **una migrazione a metà lasciava due bozze per un documento
    /// solo**, e nessuno le riconciliava: questo modulo dichiara di non
    /// raccogliere, apposta.
    ///
    /// Il supporto rifiuta la `remove`, cioè ferma la migrazione dopo che il
    /// record nuovo è già stato scritto — che è tutto ciò che serve quando le
    /// mutazioni sono due. Con una sola non c'è un «dopo» in cui fermarsi.
    #[test]
    fn a_draft_that_follows_the_rename_not_is_duplicates_if_the_support_stumbles() {
        let d = Drafts::open(
            Utf8Path::new("/vault"),
            Arc::new(NoDelete(MemStorage::new())) as Arc<dyn VaultStorage>,
        );
        d.save(&doc("a.md"), "il mio testo", None, 10).unwrap();

        let _ = d.migrate(&doc("a.md"), &doc("b.md"));

        let drafts = d.read().unwrap();
        assert_eq!(
            drafts.drafts.len(),
            1,
            "a note has one draft only, and two copies of the same text under \
             two names are a recovery that asks the user which of the two \
             is theirs: {:?}",
            drafts.drafts.iter().map(|d| &d.doc).collect::<Vec<_>>()
        );
        assert_eq!(drafts.drafts[0].doc, doc("b.md"), "and it is at the new name");
        assert_eq!(drafts.drafts[0].text, "il mio testo");
    }

    /// 0169, l'altra metà — **di chi è una bozza lo dice dove sta**, non cosa
    /// c'è scritto dentro il record.
    ///
    /// È la configurazione che restava dall'altro verso della migrazione
    /// interrotta: il file al nome nuovo, il campo fermo a quello vecchio, cioè
    /// una bozza che dice di appartenere a una nota che non esiste più.
    #[test]
    fn of_who_and_a_draft_the_says_where_is() {
        let storage = Arc::new(MemStorage::new()) as Arc<dyn VaultStorage>;
        let d = Drafts::open(Utf8Path::new("/vault"), storage.clone());
        d.save(&doc("a.md"), "il mio testo", None, 10).unwrap();

        let dir = drafts_dir(Utf8Path::new("/vault"));
        storage
            .rename(
                &dir.join(format!("{}.{EXT}", encode("a.md"))),
                &dir.join(format!("{}.{EXT}", encode("b.md"))),
            )
            .unwrap();

        let drafts = d.read().unwrap();
        assert_eq!(
            drafts.drafts[0].doc,
            doc("b.md"),
            "the record would say `a.md`, which is a note that is not there: \
             whoever offers recovery would offer it for the wrong document"
        );
    }

    fn drafts() -> Drafts {
        Drafts::open(
            Utf8Path::new("/vault"),
            Arc::new(MemStorage::new()) as Arc<dyn VaultStorage>,
        )
    }

    fn doc(s: &str) -> DocId {
        DocId::new(s)
    }

    #[test]
    fn a_draft_is_writes_and_is_rereads() {
        let d = drafts();
        d.save(&doc("note/a.md"), "ciao", None, 10).unwrap();
        let drafts = d.read().unwrap();
        assert_eq!(drafts.pruned, 0);
        assert_eq!(drafts.drafts.len(), 1);
        assert_eq!(drafts.drafts[0].text, "ciao");
        assert_eq!(drafts.drafts[0].doc, doc("note/a.md"));
    }

    #[test]
    fn the_document_survives_to_the_encoding_of_the_name() {
        // La proprietà che rende possibile il recupero: di ogni file si sa quale
        // nota nomina, anche quando il nome porta `/` e caratteri ostili.
        let d = drafts();
        let id = doc("cartella/sotto cartella/nota con spazi.md");
        d.save(&id, "x", None, 1).unwrap();
        assert_eq!(d.read().unwrap().drafts[0].doc, id);
        assert_eq!(d.get(&id).unwrap().unwrap().text, "x");
    }

    #[test]
    fn the_more_recent_becomes_first() {
        let d = drafts();
        d.save(&doc("a.md"), "vecchia", None, 1).unwrap();
        d.save(&doc("b.md"), "nuova", None, 99).unwrap();
        let drafts = d.read().unwrap().drafts;
        assert_eq!(drafts[0].doc, doc("b.md"));
    }

    #[test]
    fn rewrite_not_accumulates() {
        let d = drafts();
        d.save(&doc("a.md"), "uno", None, 1).unwrap();
        d.save(&doc("a.md"), "due", None, 2).unwrap();
        let drafts = d.read().unwrap();
        assert_eq!(drafts.drafts.len(), 1);
        assert_eq!(drafts.drafts[0].text, "due");
    }

    #[test]
    fn discard_a_draft_that_not_c_and_not_and_a_error() {
        let d = drafts();
        assert!(d.discard(&doc("mai-esistita.md")).is_ok());
    }

    #[test]
    fn the_base_distinguishes_a_new_note_from_an_old_one() {
        let d = drafts();
        d.save(&doc("nuova.md"), "x", None, 1).unwrap();
        d.save(&doc("vecchia.md"), "y", Some(Revision::of("prima")), 2)
            .unwrap();
        let drafts = d.read().unwrap();
        let new = drafts.drafts.iter().find(|b| b.doc == doc("nuova.md"));
        let old = drafts.drafts.iter().find(|b| b.doc == doc("vecchia.md"));
        assert!(new.unwrap().base.is_none());
        assert_eq!(old.unwrap().base, Some(Revision::of("prima")));
    }

    #[test]
    fn a_draft_follows_the_rename() {
        let d = drafts();
        d.save(&doc("prima.md"), "testo", None, 1).unwrap();
        d.migrate(&doc("prima.md"), &doc("dopo.md")).unwrap();
        let drafts = d.read().unwrap();
        assert_eq!(drafts.drafts.len(), 1);
        // Non basta che il file si sia spostato: il record deve dire il nome
        // nuovo, o la bozza rivendicherebbe una nota che non è la sua.
        assert_eq!(drafts.drafts[0].doc, doc("dopo.md"));
        assert_eq!(drafts.drafts[0].text, "testo");
    }

    #[test]
    fn a_rename_not_buries_the_draft_that_finds() {
        // Il caso che la garanzia dell'anagrafe non copre: `dopo.md` non è un
        // documento — non lo è mai stato — quindi il rename passa, e la bozza
        // che sta lì sotto è l'unica copia di ciò che qualcuno ha scritto.
        let d = drafts();
        d.save(&doc("prima.md"), "il testo che si sposta", None, 1)
            .unwrap();
        d.save(&doc("dopo.md"), "il testo che non esiste altrove", None, 2)
            .unwrap();

        d.migrate(&doc("prima.md"), &doc("dopo.md")).unwrap();
        let drafts = d.read().unwrap();
        assert_eq!(
            drafts.drafts.len(),
            2,
            "neither of them was lost, and no text exists twice: \
             {:?}",
            drafts.drafts.iter().map(|b| &b.doc).collect::<Vec<_>>()
        );
        let text = |id: &str| {
            drafts
                .drafts
                .iter()
                .find(|b| b.doc == doc(id))
                .map(|b| b.text.as_str())
        };
        assert_eq!(text("dopo.md"), Some("il testo che non esiste altrove"));
        assert_eq!(
            text("prima~recupero.md"),
            Some("il testo che si sposta"),
            "and the one that could not land on the destination takes a \
             recovery name — the document extension preserved — which decodes \
             to a document that does not exist: the draft is read back as \
             orphan, and a recovery finds it"
        );
        assert!(
            text("prima.md").is_none(),
            "under the dead id nothing remains"
        );
    }

    #[test]
    fn a_recovery_name_already_taken_does_not_stop_the_migration() {
        // Il primo nome di recupero può essere già occupato — da un'altra
        // rinomina in collisione, o da una bozza orfana che c'era prima — e il
        // giro dopo deve trovarne un altro, non fallire.
        let d = drafts();
        d.save(&doc("prima.md"), "il testo che si sposta", None, 1)
            .unwrap();
        d.save(
            &doc("dopo.md"),
            "la destinazione che ha già una bozza",
            None,
            2,
        )
        .unwrap();
        d.save(
            &doc("prima~recupero.md"),
            "un recupero che c'era già",
            None,
            3,
        )
        .unwrap();

        d.migrate(&doc("prima.md"), &doc("dopo.md")).unwrap();
        let drafts = d.read().unwrap();
        assert_eq!(
            drafts.drafts.len(),
            3,
            "no text is lost and none is duplicated"
        );
        let text = |id: &str| {
            drafts
                .drafts
                .iter()
                .find(|b| b.doc == doc(id))
                .map(|b| b.text.as_str())
        };
        assert_eq!(
            text("dopo.md"),
            Some("la destinazione che ha già una bozza")
        );
        assert_eq!(
            text("prima~recupero.md"),
            Some("un recupero che c'era già")
        );
        assert_eq!(
            text("prima~recupero-2.md"),
            Some("il testo che si sposta"),
            "the free recovery name is the second in the family"
        );
    }

    #[test]
    fn a_version_of_schema_unknown_is_counts_instead_of_disappear() {
        let d = drafts();
        let storage = Arc::clone(&d.storage);
        storage
            .write(
                &d.dir.join(format!("{}.{EXT}", encode("futura.md"))),
                br#"{"v":9999,"doc":"futura.md","at":1,"base":null,"text":"x"}"#,
            )
            .unwrap();
        let drafts = d.read().unwrap();
        assert!(drafts.drafts.is_empty());
        assert_eq!(drafts.pruned, 1, "the reader must know it did not read");
    }

    #[test]
    fn a_file_broken_not_stops_the_other() {
        let d = drafts();
        d.save(&doc("buona.md"), "ok", None, 5).unwrap();
        Arc::clone(&d.storage)
            .write(
                &d.dir.join(format!("{}.{EXT}", encode("rotta.md"))),
                b"{ nz",
            )
            .unwrap();
        let drafts = d.read().unwrap();
        assert_eq!(drafts.drafts.len(), 1);
        assert_eq!(drafts.pruned, 1);
    }
}
