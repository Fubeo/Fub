//! La scrittura dei file della macchina per chi un supporto non ce l'ha
//! (`write_atomic`, `update_atomic`), i lock fra processi e `Durable`.

use super::*;

/// La scrittura del supporto **per chi un supporto non ce l'ha**: i tre file
/// della macchina.
///
/// `settings.json`, `vaults.json` e `view-state.json` stanno nella cartella di
/// configurazione dell'utente, cioè **fuori da ogni vault**: non c'è un
/// [`VaultStorage`] a cui chiederlo, perché non sono roba di un vault — e il
/// giorno in cui un vault vive su OPFS o dentro una share cifrata, la
/// configurazione della macchina resta dov'è. Passano quindi da qui, che è
/// [`FsStorage::write`] con l'errore vestito da stringa per i chiamanti che
/// portano avvisi e non `io::Error`.
///
/// Fino alla [0064](../../../docs/decisions/0185-capability-un-solo-guard.md) era
/// il contrario: questa funzione era l'unica scrittura atomica del kernel, e i
/// file *del vault* venivano qui a prendersela scavalcando il supporto. Adesso
/// l'implementazione è **una**, e sta sotto il trait dove ogni supporto la
/// eredita o la sostituisce.
pub fn write_atomic(path: &Utf8Path, bytes: &[u8]) -> Result<(), String> {
    FsStorage
        .write(path, bytes)
        .map(|_| ())
        .map_err(|and| format!("non riesco a scrivere {path}: {and}"))
}

/// L'**aggiornamento** di un file della macchina: rileggi sotto lock, fondi,
/// scrivi.
///
/// [`write_atomic`] è l'atomicità di *un file* e non di un *aggiornamento*: chi
/// la chiama ricompone il contenuto intero dalla propria copia in memoria,
/// quindi la seconda installazione che salva atterra un file integro **senza**
/// le chiavi che la prima aveva scritto dopo che lei aveva letto. Nessuna
/// quantità di `fsync` la risolve, perché non è un file a metà: è un file
/// intero e vecchio.
///
/// Le due metà di questa funzione non fanno la stessa cosa, e conviene tenerle
/// distinte:
///
/// - **`rileggi` è ciò che toglie la perdita.** La copia in memoria del
///   chiamante è vecchia per definizione — l'ha letta all'apertura — e ciò che
///   si scrive va composto su quella che c'è sul disco *adesso*, non su quella.
///   Per questo `fondi` riceve lo stato **riletto** e non quello del chiamante,
///   e per questo la funzione restituisce lo stato fuso: chi la chiama deve
///   adottarlo, o la sua copia resterebbe l'unica a non sapere;
/// - **il lock stringe la finestra.** Fra la rilettura e la scrittura resta un
///   istante in cui un altro processo può infilarsi, e il lock del file lo
///   toglie. È **best-effort** di proposito: dove il lock non c'è — una share
///   di rete che non lo implementa — la rilettura vale lo stesso, e rifiutarsi
///   di salvare sarebbe un danno certo al posto di uno improbabile.
///
/// Non ci sono un `write_atomic` e un `update_atomic` fra cui il chiamante
/// sceglie per i file che si aggiornano: chi prende il lock e poi ricompone
/// dalla copia vecchia non ha risolto niente, e la forma giusta si ripeterebbe
/// tre volte. È la ragione della
/// [0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md) sul
/// perché la scrittura del supporto è una sola.
///
/// `fondi` serializza ciò che ha appena mutato, invece di lasciarlo fare a chi
/// chiama: fra la mutazione e i byte non deve poterci stare una riga.
pub fn update_atomic<T>(
    path: &Utf8Path,
    rileggi: impl FnOnce() -> Result<T, String>,
    merge_entries: impl FnOnce(&mut T) -> Result<Vec<u8>, String>,
) -> Result<T, String> {
    let _lock = exclusive_lock(path);
    let mut state = rileggi()?;
    let bytes = merge_entries(&mut state)?;
    write_atomic(path, &bytes)?;
    Ok(state)
}

/// Il rifiuto di sovrascrivere un file che **adesso** non si rilegge.
///
/// È la seconda metà della regola della
/// [0036](../../../docs/decisions/0192-impostazioni-locale-e-temi.md),
/// e senza di essa la prima non vale niente: leggere un file malformato e
/// tenersi un livello vuoto salva ciò che l'utente aveva scritto per il tempo di
/// **una** scrittura, perché la prima che arriva ricompone il file dalla mappa
/// vuota.
///
/// Sta qui, accanto a [`update_atomic`], perché il momento in cui la domanda ha
/// una risposta vera è **la rilettura sotto lucchetto** — la prima mossa di
/// questa forma, e della fusione gemella che i sidecar fanno passare dal
/// supporto. Prima stava in quattro copie *davanti* a quella rilettura, e la
/// bandiera che interrogavano l'avevano letta **all'apertura**: chi correggeva a
/// mano il file si sentiva rispondere di no finché non riapriva l'app, e chi lo
/// rompeva dopo l'apertura passava il cancello per farsi fermare un istante
/// dopo, dalla rilettura, cioè dall'unico che lo sapeva davvero. Un cancello che
/// non ferma ciò che deve e ferma ciò che non deve non è un cancello: è una
/// copia vecchia della risposta (difetto 0170).
///
/// `why` è la frase di chi ha provato a rileggere, e ci va davanti: dice
/// **cosa** non si è capito del file, che è ciò che serve per correggerlo.
pub fn do_not_overwrite(why: &str, loss: &str) -> String {
    format!("{why}. Fub non lo sovrascrive, o {loss}. Correggilo o spostalo, e riprova.")
}

/// Il lock esclusivo che accompagna un [`update_atomic`], finché il valore vive.
///
/// Sta su un file **accanto** e non sul file stesso, e non è una preferenza:
/// [`write_atomic`] sostituisce l'inode, quindi un lock preso sul file che si
/// sta per rimpiazzare è un lock su un inode che fra un istante non è più a quel
/// nome — e il processo che arriva dopo la rename ne aprirebbe un altro,
/// prendendoselo senza aspettare nessuno. Il compagno di lock non si rinomina
/// mai, quindi è lo stesso oggetto per tutti.
///
/// Il nome comincia per punto per la ragione del temporaneo di
/// [`tmp_path`]: è un file di servizio, e chi guarda la cartella non lo deve
/// vedere.
///
/// `Err` non si propaga — vedi [`update_atomic`] — quindi qui il tipo di ritorno
/// è un `Option`: o si ha il lock, o si procede senza.
///
/// **Il compagno non si toglie all'uscita, ed è voluto** (difetto 0151).
/// Cancellarlo è la riparazione che sembra ovvia e che rompe il lock: fra
/// l'`unlink` di chi esce e la `open` di chi arriva ci sta un terzo che crea un
/// file *nuovo* a quel nome e se lo prende, mentre il secondo tiene ancora il
/// lock sull'inode scollegato — due che scrivono, ciascuno convinto di essere
/// solo, che è esattamente ciò che il lock esisteva per impedire. E non c'è
/// niente da guadagnare: il compagno è **uno per file protetto**, e i file
/// protetti sono un insieme fisso e piccolo — non cresce con le note, non
/// cresce con l'uso, non cresce affatto. Ciò che va tolto è il fatto che si
/// **veda**, e a toglierlo è [`is_write_lock`].
/// Quanto si aspetta il compagno prima di scrivere **senza** (difetto 0152).
///
/// Un `update_atomic` onesto tiene il lock per una lettura e una scrittura, cioè
/// per millisecondi: due secondi sono mille volte tanto, e chi arriva mentre un
/// altro sta davvero salvando lo aspetta senza accorgersene. Chi ci arriva
/// contro è invece un lock che **non si libererà**: un processo morto male che
/// il sistema non ha ripulito, una share di rete che tiene il lock di un client
/// che non c'è più, un'altra installazione appesa dentro il proprio `update`.
pub(super) const LOCK_RETRY_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

/// Ogni quanto si riprova. Non è una misura di niente: è il passo con cui
/// l'attesa si controlla, corto abbastanza da non aggiungere ritardo a un lock
/// che si libera subito e lungo abbastanza da non essere un giro a vuoto.
pub(super) const RETRY_LOCK: std::time::Duration = std::time::Duration::from_millis(10);

pub(super) fn exclusive_lock(path: &Utf8Path) -> Option<std::fs::File> {
    exclusive_lock_entro(path, LOCK_RETRY_INTERVAL)
}

/// Il corpo di [`exclusive_lock`] con l'attesa **detta**, perché è il solo modo
/// di presidiare la rinuncia senza far durare un banco quanto dura la pazienza
/// di un utente.
///
/// Il difetto che questa attesa toglie non è la lentezza: è che
/// [`exclusive_lock`] dichiarava **due** esiti — «o si ha il lock, o si procede
/// senza» — e ne aveva un terzo che non aveva nome. `File::lock` è bloccante e
/// non ha scadenza, quindi chi salvava un'impostazione dietro un lock che
/// nessuno rilascia non riceveva né il lock né il permesso di procedere: restava
/// lì, senza errore, senza messaggio e senza niente che dicesse **che cosa**
/// stesse aspettando. E rinunciare è la risposta giusta per la ragione già
/// scritta in [`update_atomic`]: il lock stringe una finestra, non la toglie —
/// a togliere la perdita è la rilettura, che vale lo stesso — e rifiutarsi di
/// salvare sarebbe un danno certo al posto di uno improbabile. Restare fermi
/// per sempre è il danno certo scritto peggio: nemmeno l'utente sa che c'è.
///
/// La rinuncia **si dice**, e si dice col nome del file: un salvataggio andato
/// a buon fine senza il lock è ciò che si voleva, ma il giorno che quella riga
/// compare a ogni scrittura vuol dire che su quella macchina c'è un lock morto,
/// e chi legge il log deve poterlo trovare.
pub(super) fn exclusive_lock_entro(
    path: &Utf8Path,
    wait_for: std::time::Duration,
) -> Option<std::fs::File> {
    let dir = path.parent().unwrap_or(Utf8Path::new(""));
    let lock_path = lock_path(path);
    std::fs::create_dir_all(dir).ok()?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .ok()?;
    // Il lock si rilascia alla chiusura del file, cioè quando il chiamante
    // lascia cadere ciò che questa funzione ha restituito.
    let expiration = std::time::Instant::now() + wait_for;
    loop {
        match file.try_lock() {
            Ok(()) => return Some(file),
            // Non è un guasto: è qualcun altro che sta salvando, ed è il caso
            // per cui il lock esiste.
            Err(std::fs::TryLockError::WouldBlock) => {}
            // Un supporto che il lock non lo sa fare — una share di rete — è il
            // caso «best-effort» di sempre: si procede senza, subito.
            Err(std::fs::TryLockError::Error(_)) => return None,
        }
        if std::time::Instant::now() >= expiration {
            tracing::warn!(
                target: "fub.kernel",
                "{lock_path} è tenuto da qualcun altro da più di {wait_for:?}: \
                 si scrive senza il lock"
            );
            return None;
        }
        std::thread::sleep(RETRY_LOCK);
    }
}

// --- la copia in memoria di un file ----------------------------------------

/// **Ciò che si tiene in memoria di un file, e che si cambia solo scrivendo.**
///
/// # Il difetto che questo tipo toglie
///
/// «Su disco prima, in memoria dopo» era scritto in **cinque** posti — le
/// impostazioni di vault, quelle di macchina, l'organizzazione, il registro dei
/// vault, lo stato di vista — ognuno con la sua frase, e in nessuno dei cinque
/// c'era qualcosa che lo tenesse fermo. Il sesto posto
/// ([`EntryStore`](crate::entries)) ha scritto le due righe nell'ordine opposto
/// e nessuno se n'è accorto per un anno: la regola era una **convenzione**, e
/// una convenzione non si eredita — si ricopia, finché qualcuno non la ricopia
/// male.
///
/// Qui l'ordine non è più una scelta di chi scrive la funzione: è l'unico
/// ordine che il tipo sa esprimere. Il valore sta dentro, non se ne consegna
/// mai un `&mut`, e l'unico modo di sostituirlo è [`Durable::write`], che
/// sostituisce **dopo** che la scrittura è tornata `Ok`. Un guasto a metà
/// lascia memoria e disco d'accordo su ciò che c'era prima, che è l'unico stato
/// che chi ha ricevuto l'errore può presumere.
///
/// # Perché il verso è questo e non l'altro
///
/// Perché delle due mosse **solo una può fallire**. Assegnare un campo non
/// fallisce; scrivere un file sì. Mettere per ultima quella che non fallisce
/// vuol dire che non esiste un istante in cui una è avvenuta e l'altra no, ed è
/// la stessa ragione per cui un ripristino dal cestino è un `rename` e non un
/// «scrivi e poi cancella».
///
/// # L'altra forma della stessa regola
///
/// [`update_atomic`] è questo tipo per i file che si **fondono** invece di
/// ricomporsi: là il valore nuovo non ce l'ha il chiamante — lo produce la
/// fusione con ciò che sul disco c'è adesso — quindi la scrittura *restituisce*
/// la memoria da adottare invece di riceverla. Le due sono la stessa promessa
/// («la memoria è ciò che il disco ha accettato») per i due modi di comporre un
/// file, e chi ne apre un settimo sceglie fra queste due e non fra due ordini.
pub struct Durable<T>(T);

impl<T> Durable<T> {
    /// Ciò che si è appena letto dal file — o il vuoto, per un file che non
    /// c'era.
    pub fn new(initial: T) -> Self {
        Durable(initial)
    }

    /// Scrive `new` e **solo se il disco lo ha accettato** lo adotta.
    ///
    /// `on_disk` riceve un prestito di ciò che sta per diventare la memoria, e
    /// non una copia: è il valore stesso che va a finire nel file, quindi le due
    /// idee di «cosa si sa» non possono divergere nemmeno per il tempo di una
    /// serializzazione.
    pub fn write<E>(&mut self, new: T, on_disk: impl FnOnce(&T) -> Result<(), E>) -> Result<(), E> {
        on_disk(&new)?;
        self.0 = new;
        Ok(())
    }

    /// **Aggiorna**: adotta ciò che la scrittura ha prodotto, invece di dettarlo.
    ///
    /// È la gemella di [`write`](Durable::write) per i file che si fondono
    /// invece di sostituirsi ([`VaultStorage::update`]): là il chiamante sa già
    /// cosa andrà nel file, qui no — il valore nuovo nasce mettendo il proprio
    /// cambiamento sopra ciò che sul disco c'è *adesso*, e chi lo compone è la
    /// scrittura. Adottare la propria copia mutata al posto di quella fusa
    /// vorrebbe dire tenere in memoria l'unico stato che non è di nessuno.
    ///
    /// L'ordine resta quello del tipo: se `on_disk` fallisce la memoria non si
    /// muove.
    pub fn update<E>(&mut self, on_disk: impl FnOnce() -> Result<T, E>) -> Result<(), E> {
        self.0 = on_disk()?;
        Ok(())
    }
}

impl<T> std::ops::Deref for Durable<T> {
    type Target = T;

    /// Si legge come il valore che porta. **Non** c'è il `DerefMut`, ed è tutto
    /// il punto: un `&mut` consegnato qui rimetterebbe in circolazione
    /// esattamente la mossa che questo tipo esiste per non far più scrivere.
    fn deref(&self) -> &T {
        &self.0
    }
}

impl<T: std::fmt::Debug> std::fmt::Debug for Durable<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}
