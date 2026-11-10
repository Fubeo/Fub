//! `VaultStorage` per `FsStorage`: il supporto sul disco vero.

use super::*;

impl VaultStorage for FsStorage {
    fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
        std::fs::read(path)
    }

    fn read_pieces(&self, path: &Utf8Path, piece: &mut dyn FnMut(&[u8])) -> io::Result<()> {
        read_in_pieces(std::fs::File::open(path)?, piece)
    }

    /// Seek + `take(len)`: apre, salta a `offset`, legge al massimo `len`
    /// byte. `len == 0` non apre il file ma verifica che esista (stat);
    /// oltre la fine torna vuoto.
    fn read_at(&self, path: &Utf8Path, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        if len == 0 {
            std::fs::metadata(path)?;
            return Ok(Vec::new());
        }
        let file = std::fs::File::open(path)?;
        let size = file.metadata()?.len();
        read_bounded(file, size, offset, len)
    }

    /// Temporaneo accanto, `fsync`, rename, `fsync` della cartella — **salvo**
    /// quando il file che sostituirebbe è condiviso.
    ///
    /// Le tre righe che rendono la promessa vera e non solo dichiarata:
    ///
    /// - il temporaneo ha un nome **unico e nascosto** (vedi [`tmp_path`]);
    /// - il temporaneo si **sincronizza prima della rename**. Temp+rename dà
    ///   atomicità *rispetto a chi legge*, non durabilità rispetto a un crash:
    ///   senza `sync_all` il nome nuovo può atterrare con dietro un contenuto
    ///   che non è ancora sceso, cioè esattamente il file troncato che questa
    ///   funzione esiste per non produrre;
    ///   e la **cartella** si sincronizza dopo, perché è lei a portare il nome:
    ///   a farlo si prova soltanto, che su Windows una cartella non si apre come
    ///   file e la rename ha un'altra semantica.
    /// - il temporaneo **eredita i permessi** del file che sostituisce. Un file
    ///   nuovo nasce con la umask di chi scrive, e un salvataggio che
    ///   trasformasse un `600` in un `644` avrebbe reso leggibile a tutti una
    ///   nota che l'utente aveva chiuso — una modifica ai permessi senza che
    ///   nessuno l'abbia chiesta.
    ///
    /// # I tre casi in cui **non** si sostituisce il file
    ///
    /// Una rename cambia l'inode, e ci sono tre situazioni in cui quell'inode
    /// non è solo nostro — o non si sa se lo sia:
    ///
    /// - il path **è un symlink**: la rename sostituirebbe il collegamento, e da
    ///   quel momento il file vero non riceverebbe più niente. È il modo in cui
    ///   una nota tenuta altrove e collegata dentro il vault smette in silenzio
    ///   di essere la stessa nota;
    /// - il file ha **più di un nome** (hardlink): la rename ne staccherebbe uno
    ///   solo, e l'altro resterebbe fermo al contenuto di prima;
    /// - **non si sa quanti nomi abbia** ([`NomiDelFile::Ignoto`]). Il terzo caso
    ///   è nato con la §23.16: prima era il secondo detto male, perché su Windows
    ///   il conteggio rispondeva `false` sempre, cioè «un nome solo» a un file
    ///   che poteva averne dieci.
    ///
    /// In tutti si scrive **sul posto** — `create` + `sync_all` — che
    /// conserva l'inode e perde l'atomicità: un crash a metà lascia il file
    /// troncato, come prima di questa voce. È il verso giusto della scelta,
    /// perché i due danni non sono uguali: il troncamento richiede un crash
    /// *durante* la scrittura ed è visibile, la sostituzione di un collegamento
    /// avviene a ogni salvataggio e non la vede nessuno.
    ///
    /// Il costo è una `symlink_metadata` per scrittura, cioè la stessa syscall
    /// che `std::fs::write` fa comunque aprendo il file.
    ///
    /// Il corpo sta in [`FsStorage::write_con`], che prende il rilevatore invece
    /// di nominarlo: qui si passa quello vero.
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_with(path, bytes, true, what_c_and, file_names)
            .map(|(_, stat)| stat)
    }

    /// La stessa strada di [`write`](VaultStorage::write) — temp+rename,
    /// permessi ereditati, temporaneo tolto — **senza il prezzo della
    /// durabilità**: niente `sync_all` del file e niente `fsync` delle cartelle
    /// dopo la rename. Un crash può lasciare il derivato illeggibile o
    /// assente, e chi lo rilegge lo butta e lo ricostruisce: è la definizione
    /// di dato derivato, e la 0065 non la conosceva — la sua promessa «o c'è o
    /// non c'è» vale per i documenti, e per loro questa via non esiste.
    fn write_derived(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
        self.write_with(path, bytes, false, what_c_and, file_names)
            .map(|(_, stat)| stat)
    }

    /// Il lucchetto di [`exclusive_lock`] tenuto per il tempo della rilettura e
    /// della scrittura, che è la sola cosa che questo supporto aggiunge al giro
    /// `read` → `fondi` → `write`. È **best-effort** di proposito: dove il lock
    /// non c'è — una share di rete che non lo implementa — la rilettura vale lo
    /// stesso, e rifiutarsi di salvare sarebbe un danno certo al posto di uno
    /// improbabile.
    ///
    /// Il lucchetto si prende **solo se la cartella c'è già**, perché
    /// [`exclusive_lock`] la creerebbe per posarci accanto il proprio file: un
    /// aggiornamento che non trova niente da aggiornare non deve lasciare
    /// dietro di sé la cartella di un vault che nessuno ha ancora aperto — è la
    /// differenza fra una radice che non si legge, e che quindi non si apre, e
    /// una radice che l'apertura stessa ha fatto esistere vuota.
    ///
    /// # Quando la cartella non c'è, e si scrive lo stesso
    ///
    /// «Senza cartella non c'è nemmeno il file, quindi non c'è niente che un
    /// altro processo possa perdere» è vero **nell'istante in cui si guarda**, e
    /// la scrittura viene dopo (difetto 0171). È la prima scrittura in un vault
    /// nuovo, cioè il momento in cui due installazioni che aprono la stessa
    /// cartella partono davvero insieme: fra il `read` che risponde «non c'è» e
    /// la `write` che crea l'albero ci sta l'intero giro dell'altra, e chi
    /// arriva secondo posa il file che ha composto dal nulla sopra quello che il
    /// primo aveva appena scritto — la *lost update* che la
    /// [0066](../../../docs/decisions/0195-versioni-indipendenti.md)
    /// ha tolto a ogni altra scrittura, lasciata dove il file è più povero e
    /// quindi meno sospetta: si perde una configurazione di due righe, non un
    /// vault di note.
    ///
    /// La riparazione non è prendere il lucchetto comunque, che rimetterebbe la
    /// cartella dove non la si voleva. È **rimandarlo al momento in cui si sa
    /// che serve**: il giro senza lucchetto vale come prima, e se `fondi`
    /// risponde «non scrivo» finisce lì, senza aver toccato niente; se invece
    /// risponde con dei byte, allora la cartella nascerà comunque — la crea la
    /// `write` — e a quel punto crearla per il compagno di lock non aggiunge
    /// nessun danno, mentre rifare il giro sotto lucchetto toglie la finestra.
    /// La seconda rilettura è quella che conta: legge ciò che l'altro ha
    /// scritto nel frattempo, e `fondi` fonde con quello invece di ignorarlo.
    ///
    /// Chiamare `fondi` due volte è dentro il patto — è una `FnMut` proprio
    /// perché «un supporto che riprova quando qualcun altro gli ha cambiato il
    /// file sotto» è un supporto lecito —, e si paga una volta sola nella vita
    /// di un vault.
    fn update(&self, path: &Utf8Path, merge_entries: Merge<'_>) -> io::Result<()> {
        self.update_with(path, merge_entries, false)
    }

    /// L'aggiornamento di un derivato: la fusione sotto lucchetto resta — la
    /// *lost update* è un danno anche per una cache — e a non pagarsi è solo
    /// il `fsync` finale, che per un file ricostruibile non compra niente.
    fn update_derived(&self, path: &Utf8Path, merge_entries: Merge<'_>) -> io::Result<()> {
        self.update_with(path, merge_entries, true)
    }

    /// `O_APPEND` e **nessun `fsync`**: la scelta è a verbale
    /// ([0067](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)),
    /// e sta tutta nell'ordine in cui le due scritture avvengono. Chi appende lo
    /// fa **dopo** che la mutazione è riuscita, quindi un crash può far perdere
    /// la coda del registro — le ultime operazioni non si potranno annullare — e
    /// mai il contrario, una riga che racconta qualcosa che non è successo. Un
    /// `fsync` per riga metterebbe un secondo giro sul disco dentro il percorso
    /// del salvataggio, che la
    /// [0065](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md) ha
    /// appena fatto pagare una volta, per proteggere un dato il cui smarrimento
    /// costa un annullamento e non una nota.
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        file.write_all(bytes)
    }

    /// La mossa, e poi il `fsync` delle cartelle che hanno cambiato voce: senza,
    /// un rename può sparire dopo aver risposto `Ok`
    /// ([`folders_to_sync`]). Si sincronizza **dopo il `?`**, cioè
    /// solo se la mossa è riuscita: non c'è niente da far scendere di una mossa
    /// che non è avvenuta, e chiederlo lo stesso trasformerebbe un errore in un
    /// errore più lento.
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(from, to)?;
        for dir in folders_to_sync(from, Some(to)) {
            sync_folder(&dir);
        }
        Ok(())
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }

        #[cfg(unix)]
        {
            let native = rename_no_replace_paths(from.as_std_path(), to.as_std_path());
            match native {
                Ok(true) => {
                    for dir in folders_to_sync(from, Some(to)) {
                        sync_folder(&dir);
                    }
                    Ok(())
                }
                Ok(false) => self.rename_no_replace_with_lock(from, to),
                Err(error)
                    if error.kind() == io::ErrorKind::AlreadyExists
                        && same_parent_resolution_name(from, to)
                        && self.same_file(from, to) =>
                {
                    self.rename(from, to)
                }
                Err(error) => Err(error),
            }
        }

        #[cfg(windows)]
        {
            // Serializzare la sorgente prima che MoveFileExW la apra evita
            // due successi, anche quando le destinazioni sono differenti.
            let _lock = exclusive_lock_required(from)?;
            match rename_no_replace_move_file(from, to) {
                Ok(()) => {
                    for dir in folders_to_sync(from, Some(to)) {
                        sync_folder(&dir);
                    }
                    Ok(())
                }
                Err(error)
                    if error.kind() == io::ErrorKind::AlreadyExists
                        && same_parent_resolution_name(from, to)
                        && self.same_file(from, to) =>
                {
                    self.rename(from, to)
                }
                Err(error) => Err(error),
            }
        }

        #[cfg(not(any(unix, windows)))]
        self.rename_no_replace_with_lock(from, to)
    }

    /// Togliere è una mossa come le altre: la voce che sparisce sta in una
    /// cartella, e finché quella non è scesa il file può tornare.
    fn remove(&self, path: &Utf8Path) -> io::Result<()> {
        std::fs::remove_file(path)?;
        for dir in folders_to_sync(path, None) {
            sync_folder(&dir);
        }
        Ok(())
    }

    fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
        let mut raw_entries = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let Some(path) = utf8_entry_path(dir, &entry.file_name()) else {
                continue;
            };
            let file_type = entry.file_type()?;
            let kind = if file_type.is_dir() {
                EntryKind::Dir
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            raw_entries.push((entry, path, kind));
        }

        let n = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .clamp(1, 8);

        let mut out: Vec<DirEntry> = if n > 1 && raw_entries.len() > 256 {
            let chunk_size = raw_entries.len().div_ceil(n);
            std::thread::scope(|s| {
                let handles: Vec<_> = raw_entries
                    .chunks(chunk_size)
                    .map(|chunk| {
                        s.spawn(move || -> io::Result<Vec<DirEntry>> {
                            let mut chunk_out = Vec::with_capacity(chunk.len());
                            for (entry, path, kind) in chunk {
                                let stat = match kind {
                                    EntryKind::Other => Stat {
                                        kind: *kind,
                                        size: 0,
                                        mtime: 0,
                                    },
                                    _ => stat_with(*kind, &entry.metadata()?),
                                };
                                chunk_out.push(DirEntry {
                                    path: path.clone(),
                                    stat,
                                });
                            }
                            Ok(chunk_out)
                        })
                    })
                    .collect();

                let mut combined = Vec::with_capacity(raw_entries.len());
                for handle in handles {
                    combined.extend(handle.join().unwrap()?);
                }
                Ok::<Vec<DirEntry>, io::Error>(combined)
            })?
        } else {
            let mut sequential_out = Vec::with_capacity(raw_entries.len());
            for (entry, path, kind) in raw_entries {
                let stat = match kind {
                    EntryKind::Other => Stat {
                        kind,
                        size: 0,
                        mtime: 0,
                    },
                    _ => stat_with(kind, &entry.metadata()?),
                };
                sequential_out.push(DirEntry { path, stat });
            }
            sequential_out
        };

        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
        std::fs::metadata(path).map(|metadata| stat_of(&metadata))
    }
    fn stat_no_follow(&self, path: &Utf8Path) -> io::Result<Stat> {
        let metadata = std::fs::symlink_metadata(path)?;
        let file_type = metadata.file_type();
        #[cfg(windows)]
        let reparse = {
            use std::os::windows::fs::MetadataExt;
            metadata.file_attributes() & 0x400 != 0
        };
        #[cfg(not(windows))]
        let reparse = false;
        let kind = if file_type.is_symlink() || reparse {
            EntryKind::Other
        } else if metadata.is_dir() {
            EntryKind::Dir
        } else if metadata.is_file() {
            EntryKind::File
        } else {
            EntryKind::Other
        };
        Ok(stat_with(kind, &metadata))
    }
    /// È `canonicalize` di `std`: su Windows la forma è quella estesa
    /// (`\\?\C:\…`), la stessa con cui l'host nomina la radice del vault.
    fn real_path(&self, path: &Utf8Path) -> io::Result<Utf8PathBuf> {
        let real = std::fs::canonicalize(path)?;
        Utf8PathBuf::from_path_buf(real).map_err(|path| not_utf8(&path))
    }

    fn exists(&self, path: &Utf8Path) -> bool {
        path.exists()
    }

    fn file_identity(&self, path: &Utf8Path) -> io::Result<Option<FileIdentity>> {
        Ok(identity_of_the_file(path).map(|identity| FileIdentity {
            volume: identity.volume,
            file: identity.file,
        }))
    }

    fn change_stamp(&self, path: &Utf8Path) -> io::Result<Option<u64>> {
        change_stamp_of_file(path)
    }

    /// **Qui il default non basta**, ed è l'unico supporto per cui non basta:
    /// il filesystem è l'unico che decide da sé se due nomi siano un posto o
    /// due, e lo dice con [`identita_del_file`]. Due path uguali sono lo stesso
    /// file senza chiedere niente — anche se non c'è niente là — e per gli altri
    /// si va a guardare l'inode.
    fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
        if a == b {
            return true;
        }
        match (identity_of_the_file(a), identity_of_the_file(b)) {
            (Some(a), Some(b)) => a == b,
            // Un file che non c'è, o un'identità che la piattaforma non sa
            // dare: vedi il doc di `identita_del_file`, due «non lo so» non
            // sono lo stesso file.
            _ => false,
        }
    }

    /// **Qui il default non basta**: sul disco una radice mancante non è un
    /// vault che sta per nascere, è un errore di chi ha scelto — e va detto
    /// all'ingresso, non alla prima operazione che tocca il disco (0160).
    ///
    /// La `stat` segue i link, come sempre nel kernel: una radice che è un
    /// collegamento a una cartella è una cartella, e una radice che non c'è
    /// fallisce già qui con `NotFound`.
    fn root_validates(&self, root: &Utf8Path) -> io::Result<()> {
        let s = self.stat(root)?;
        if s.kind != EntryKind::Dir {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                format!("la radice {root} non è una cartella"),
            ));
        }
        // «Scrivibile» non si legge dai permessi del file: si chiede al
        // sistema se chi gira può scriverci, e la domanda non crea nulla —
        // un file di prova sarebbe visibile a chiunque cammini la radice
        // mentre l'apertura è in corso, cioè un fantasma di pochi
        // microsecondi, la specie di rumore che la verifica all'ingresso
        // esiste per togliere (0160).
        writable_folder(root).map_err(|and| {
            if and.kind() == io::ErrorKind::PermissionDenied {
                io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    format!("non si ha permesso di scrivere su {root}"),
                )
            } else {
                and
            }
        })
    }

    /// Le voci di dentro se ne vanno con la cartella che le conteneva, quindi
    /// ciò che resta da far scendere è la voce **della cartella**, che sta in
    /// quella sopra.
    fn remove_dir_all(&self, dir: &Utf8Path) -> io::Result<()> {
        std::fs::remove_dir_all(dir)?;
        for above in folders_to_sync(dir, None) {
            sync_folder(&above);
        }
        Ok(())
    }

    /// Anche una cartella vuota, che non porta via dati e non per questo può
    /// risorgere: chi la toglie lo fa per un motivo — un ramo rimasto vuoto dopo
    /// uno spostamento — e ritrovarla al riavvio è la stessa incoerenza fra ciò
    /// che il registro dice e ciò che c'è.
    fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        std::fs::remove_dir(dir)?;
        for above in folders_to_sync(dir, None) {
            sync_folder(&above);
        }
        Ok(())
    }

    fn create_dir(&self, dir: &Utf8Path) -> io::Result<()> {
        if let Some(parent) = dir.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::create_dir(dir)?;
        for above in folders_to_sync(dir, None) {
            sync_folder(&above);
        }
        Ok(())
    }
}
