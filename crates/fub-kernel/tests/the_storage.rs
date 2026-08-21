//! Il supporto su cui vive un vault (§15.1): che le due implementazioni dicano
//! la stessa cosa, e che il [`Vault`] non tocchi nient'altro.
//!
//! Sono due presidi diversi e nessuno dei due basta da solo.
//!
//! Il primo — `the_two_implementations_answer_alike` — esiste perché
//! **un'astrazione con un cliente solo non è un'astrazione**: finché il
//! `FsStorage` è l'unico, il trait può accumulare in silenzio le abitudini di
//! `std::fs` (una `remove` che vale anche per le cartelle, una `list` che torna
//! nell'ordine del filesystem) e il giorno in cui arriva il supporto che cifra,
//! o quello su OPFS, il contratto che deve rispettare non sta scritto da
//! nessuna parte. Sta qui: è questo file.
//!
//! Il secondo — `a_full_vault_on_a_storage_that_is_not_the_disk` — presidia
//! l'altra metà della voce, che il primo non tocca: che il `Vault` ci passi
//! **davvero** sopra. Un `std::fs::write` rimasto dentro un metodo del vault
//! non fa fallire nessun test di conformità del trait; fa fallire questo,
//! perché il disco lì sotto non c'è.
//!
//! Cosa **non** c'è qui, di proposito: i test di durabilità. Il §15.2 è
//! temp+rename+fsync sulla directory, cioè una proprietà che esiste solo su un
//! filesystem vero, e un supporto in memoria per costruzione non la modella.
//! Presidiarla qui vorrebbe dire renderla verde su un supporto che non ce l'ha.
//! Stanno in `la_durabilita.rs`, su `FsStorage` soltanto — e il fatto che questa
//! riga sia rimasta identica il giorno in cui la durabilità è arrivata
//! ([0065](../../../docs/decisions/0065-una-scrittura-o-c-e-o-non-c-e.md)) è il
//! punto: la ragione per cui non stanno qui non è cambiata insieme a loro.
//!
//! Il terzo — `the_filesystem_gap_has_only_declared_callers` —
//! presidia l'eccezione dichiarata della
//! [0064](../../../docs/decisions/0064-il-supporto-sta-sotto.md):
//! `plugin_data_dir` consegna a un provider nativo una cartella vera del
//! filesystem, e la cifratura si ferma lì. Il banco elenca chi la riceve, e un
//! chiamante nuovo è un varco nuovo che si dichiara prima di esistere.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::DocId;
use fub_kernel::storage::{FsStorage, MemStorage, VaultStorage};
use fub_kernel::Vault;

/// Un supporto da provare: come si chiama nei messaggi, cosa è, dove sta la sua
/// radice, e la `TempDir` che va tenuta viva finché dura il giro — che è la
/// ragione per cui viaggia insieme al supporto invece di essere una variabile
/// locale di chi lo costruisce.
type Bench = (
    &'static str,
    Arc<dyn VaultStorage>,
    Utf8PathBuf,
    Option<tempfile::TempDir>,
);

/// I due supporti, ognuno sulla propria radice.
fn storages() -> Vec<Bench> {
    let tmp = tempfile::tempdir().expect("temp directory");
    let root = Utf8Path::from_path(tmp.path())
        .expect("path UTF-8")
        .to_owned();
    vec![
        ("fs", Arc::new(FsStorage), root, Some(tmp)),
        ("mem", Arc::new(MemStorage::new()), "/vault".into(), None),
    ]
}

#[test]
fn the_two_implementations_answer_alike() {
    for (name, storage, root, _tmp) in storages() {
        let tag = |what: &str| format!("[{name}] {what}");

        // Scrivere crea le cartelle che mancano: è la riga che stava ripetuta a
        // ogni chiamante, e che ora sta in una firma sola.
        let a = root.join("notes/ideas/a.md");
        storage
            .write(&a, b"hi")
            .unwrap_or_else(|and| panic!("{} — {and}", tag("write")));
        assert_eq!(storage.read(&a).unwrap(), b"hi", "{}", tag("re-read"));
        assert!(storage.exists(&a), "{}", tag("exists after write"));
        assert!(
            storage.stat(&root.join("notes/ideas")).unwrap().is_dir(),
            "{}",
            tag("the parent was born with the write")
        );

        // Lo `stat` di un file dice la dimensione vera.
        let stat = storage.stat(&a).unwrap();
        assert!(stat.is_file(), "{}", tag("kind"));
        assert_eq!(stat.size, 2, "{}", tag("size"));

        // Riscrivere cambia la data: è la sola cosa che chi salta un file
        // chiede al supporto (§14.2), ed è la sola che un contatore e un
        // orologio devono avere in comune.
        let before = storage.stat(&a).unwrap().mtime;
        storage
            .write(&a, b"hi hi")
            .unwrap_or_else(|and| panic!("{} — {and}", tag("rewrite")));
        assert!(
            storage.stat(&a).unwrap().mtime >= before,
            "{}",
            tag("the date does not go backwards")
        );

        // `list` è di **un** livello, in ordine di path, e porta i metadati con
        // sé — file e cartelle insieme, perché chi cammina deve poter decidere
        // se scendere senza chiedere una seconda volta.
        storage.write(&root.join("notes/b.md"), b"b").unwrap();
        let entries = storage
            .list(&root.join("notes"))
            .unwrap_or_else(|and| panic!("{} — {and}", tag("list")));
        let names: Vec<&str> = entries.iter().filter_map(|v| v.path.file_name()).collect();
        assert_eq!(names, vec!["b.md", "ideas"], "{}", tag("order and level"));
        assert!(
            entries[0].stat.is_file() && entries[1].stat.is_dir(),
            "{}",
            tag("kind")
        );
        assert_eq!(entries[0].stat.size, 1, "{}", tag("metadata in the list"));

        // Una cartella che non c'è è un errore, non un elenco vuoto: chi
        // preferisce il vuoto lo dice lui (`collect_data_files` lo fa), e
        // sceglierlo qui toglierebbe a tutti gli altri il modo di accorgersene.
        assert!(
            storage.list(&root.join("never-existed")).is_err(),
            "{}",
            tag("listing what is not there")
        );

        // `rename` funziona per un file e per una cartella, e crea la
        // destinazione che manca.
        storage
            .rename(&a, &root.join("archive/2026/a.md"))
            .unwrap_or_else(|and| panic!("{} — {and}", tag("file rename")));
        assert!(!storage.exists(&a), "{}", tag("the origin disappears"));
        assert_eq!(
            storage.read(&root.join("archive/2026/a.md")).unwrap(),
            b"hi hi",
            "{}",
            tag("bytes follow the rename")
        );
        storage
            .rename(&root.join("archive"), &root.join("old"))
            .unwrap_or_else(|and| panic!("{} — {and}", tag("directory rename")));
        assert!(
            storage.exists(&root.join("old/2026/a.md")),
            "{}",
            tag("a directory moves with everything inside")
        );

        // `append` aggiunge in coda **e crea ciò che non c'è**: chi appende su
        // un file che non esiste ancora non deve prima scriverlo vuoto, o quella
        // riga la dimenticherebbe qualcuno. È l'ottava operazione (§15.2), e sta
        // qui perché il registro delle mutazioni deve poter vivere su un
        // supporto che non è il disco tanto quanto ci vive il vault.
        // supporto che non è il disco tanto quanto ci vive il vault.
        let reg = root.join("journal/lines.jsonl");
        storage
            .append(&reg, b"one\n")
            .unwrap_or_else(|and| panic!("{} — {and}", tag("append on nothing")));
        storage
            .append(&reg, b"two\n")
            .unwrap_or_else(|and| panic!("{} — {and}", tag("append")));
        assert_eq!(
            storage.read(&reg).unwrap(),
            b"one\ntwo\n",
            "{}",
            tag("what was there stays where it is")
        );
        // E `write` sullo stesso path **sostituisce**: le due promesse sono
        // diverse, e un supporto che le confondesse renderebbe verde un registro
        // che perde tutto a ogni riga.
        storage.write(&reg, b"three\n").unwrap();
        assert_eq!(
            storage.read(&reg).unwrap(),
            b"three\n",
            "{}",
            tag("write is not append")
        );
        storage.remove(&reg).unwrap();
        storage.remove_dir_all(&root.join("journal")).unwrap();

        // `remove` è dei file soltanto: per una cartella c'è `remove_dir_all`,
        // e la distinzione è ciò che impedisce a un `data_remove` di un plugin
        // di portarsi via un albero intero con un path che finisce bene.
        // di portarsi via un albero intero con un path che finisce bene.
        assert!(
            storage.remove(&root.join("old")).is_err(),
            "{}",
            tag("remove does not touch directories")
        );
        storage
            .remove(&root.join("old/2026/a.md"))
            .unwrap_or_else(|and| panic!("{} — {and}", tag("file remove")));
        assert!(
            storage.remove(&root.join("old/2026/a.md")).is_err(),
            "{}",
            tag("not twice")
        );

        // `remove_dir_all` scende, e il default composto dalle sette deve dare
        // lo stesso esito dell'implementazione nativa del filesystem.
        storage
            .write(&root.join("old/2026/c.md"), b"c")
            .unwrap();
        storage
            .remove_dir_all(&root.join("old"))
            .unwrap_or_else(|and| panic!("{} — {and}", tag("remove_dir_all")));
        assert!(
            !storage.exists(&root.join("old")),
            "{}",
            tag("it is gone")
        );
        assert!(
            !storage.exists(&root.join("old/2026/c.md")),
            "{}",
            tag("and what was inside is gone too")
        );

        // --- il doppio sbaglia dove sbaglia il disco -------------------------
        //
        // Le righe che seguono non provano cosa il supporto sa fare, ma **cosa
        // si rifiuta di fare**, ed è la metà che un doppio si dimentica: un
        // `Ok` di troppo qui non rompe niente in memoria, rende verde di qua un
        // banco che di là sarebbe rosso, e chi lo scrive non lo saprà mai.
        // Nessuna asserzione sulla specie dell'errore: cosa dica il sistema
        // operativo cambia fra Linux, macOS e Windows, e il contratto è che sia
        // un errore.
        storage.write(&root.join("written/one.md"), b"1").unwrap();
        assert!(
            storage.write(&root.join("written"), b"x").is_err(),
            "{}",
            tag("writing on a directory")
        );
        assert!(
            storage
                .update(&root.join("written"), &mut |_| Ok(Some(b"x".to_vec())))
                .is_err(),
            "{}",
            tag("updating a directory")
        );
        assert!(
            storage.append(&root.join("written"), b"x").is_err(),
            "{}",
            tag("appending to a directory")
        );
        // E un file non è una cartella nemmeno da genitore: `create_dir_all` di
        // là si ferma, e un path che fosse insieme file e cartella è uno stato
        // che il filesystem non sa rappresentare.
        assert!(
            storage
                .write(&root.join("written/one.md/sub.md"), b"x")
                .is_err(),
            "{}",
            tag("writing under a file")
        );

        // Una cartella ha una data, e non è zero — che nel contratto di `Stat`
        // vuol dire «non lo so». Un doppio che rispondesse sempre zero direbbe
        // «non è cambiata» dove il disco dice «è cambiata». Che poi la data
        // **avanzi** lo prova il banco unitario del contatore in `storage.rs`:
        // qui un orologio vero e un contatore possono promettere solo che una
        // data c'è e che non torna indietro.
        let dir = root.join("written");
        let when = storage.stat(&dir).unwrap().mtime;
        assert_ne!(when, 0, "{}", tag("a directory has a date"));
        let entries = storage.list(&root).unwrap();
        let listed = entries.iter().find(|v| v.path == dir).expect("in the list");
        assert_ne!(
            listed.stat.mtime,
            0,
            "{}",
            tag("and it has it in the list too")
        );
        storage.write(&dir.join("two.md"), b"2").unwrap();
        assert!(
            storage.stat(&dir).unwrap().mtime >= when,
            "{}",
            tag("a directory date does not go backwards")
        );

        // «Vuota» vuol dire vuota: togliere una cartella che ha dentro qualcosa
        // è un errore, e non un `Ok` che lascia orfano ciò che c'era.
        assert!(
            storage.remove_empty_dir(&dir).is_err(),
            "{}",
            tag("a full directory is not removed")
        );
        assert!(
            storage.exists(&dir.join("two.md")),
            "{}",
            tag("and what was inside is still there")
        );
        storage.remove_dir_all(&dir).unwrap();

        // Un `fondi` che va in panico non porta via il supporto con sé: di là
        // il lucchetto del file si rilascia e si continua a leggere, di qua il
        // `Mutex` resterebbe avvelenato e ogni accesso successivo morirebbe.
        // `Mutex` resterebbe avvelenato e ogni accesso successivo morirebbe.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = storage.update(&root.join("merge.md"), &mut |_| {
                panic!("the merge explodes")
            });
        }));
        assert!(result.is_err(), "{}", tag("the panic propagates"));
        assert!(
            !storage.exists(&root.join("merge.md")),
            "{}",
            tag("and it did not write anything")
        );
        storage
            .write(&root.join("after.md"), b"a")
            .unwrap_or_else(|and| panic!("{} — {and}", tag("the storage survives the panic")));
        assert_eq!(storage.read(&root.join("after.md")).unwrap(), b"a");

        // Leggere ciò che non c'è è un `NotFound`, e non un altro errore: sopra
        // di qui `data_read` ci distingue «lo store è vuoto» da «il disco è
        // rotto», e sbagliare specie di errore trasformerebbe un guasto in un
        // silenzio.
        let err = storage.read(&root.join("ghost.md")).unwrap_err();
        assert_eq!(
            err.kind(),
            std::io::ErrorKind::NotFound,
            "{}",
            tag("error kind")
        );
    }
}

/// Un symlink si presenta come `Other`, e non come la cosa a cui punta.
///
/// È il presidio della sola riga di comportamento che scrivere questo trait
/// avrebbe cambiato in silenzio: la specie di una voce di elenco chiesta con
/// `metadata()` invece che con `file_type()` segue il link, e una scansione che
/// segue i link non torna da un anello. Vale su Unix, che è dove si sanno
/// creare senza privilegi.
#[cfg(unix)]
#[test]
fn a_symlink_is_not_the_thing_it_points_to() {
    let tmp = tempfile::tempdir().unwrap();
    let root = Utf8Path::from_path(tmp.path()).unwrap().to_owned();
    let storage = FsStorage;

    storage.write(&root.join("real/note.md"), b"x").unwrap();
    std::os::unix::fs::symlink(root.join("real"), root.join("fake")).unwrap();
    std::os::unix::fs::symlink(root.join("never-existed"), root.join("broken")).unwrap();

    let entries = storage.list(&root).unwrap();
    let kinds: Vec<_> = entries
        .iter()
        .map(|v| (v.path.file_name().unwrap(), v.stat.kind))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("broken", fub_kernel::storage::EntryKind::Other),
            ("fake", fub_kernel::storage::EntryKind::Other),
            ("real", fub_kernel::storage::EntryKind::Dir),
        ],
        "the kind of a list entry does not follow the link — and a broken link \
         does not make the entire list fail"
    );

    // Uno `stat`, invece, lo segue: si chiede su un path e non su una voce, ed
    // è ciò che ha sempre fatto (`std::fs::metadata`).
    assert!(storage.stat(&root.join("fake")).unwrap().is_dir());

    // E la scansione del vault lo salta, come faceva prima di questo trait.
    let vault = Vault::on(&root, Arc::new(FsStorage)).expect("the vault opens");
    let scan = vault.scan().unwrap();
    assert_eq!(scan.folders, vec!["real".to_string()]);
    assert_eq!(
        scan.files.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["real/note.md"]
    );
}

#[test]
fn a_full_vault_on_a_storage_that_is_not_the_disk() {
    let storage = Arc::new(MemStorage::new());
    let vault = Vault::on("/vault", Arc::clone(&storage) as Arc<dyn VaultStorage>)
        .expect("the vault opens");

    let notes = DocId::new("projects/Idea.md");
    vault.write(&notes, "# Idea\n").unwrap();
    assert!(vault.exists(&notes));
    assert_eq!(vault.read(&notes).unwrap(), "# Idea\n");

    // La scansione vede il file **e** la cartella, e non vede `.fub/`.
    vault
        .write(&DocId::new(".fub/data/something.json"), "{}")
        .unwrap();
    let scan = vault.scan().unwrap();
    assert_eq!(
        scan.files.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        vec!["projects/Idea.md"]
    );
    assert_eq!(scan.folders, vec!["projects".to_string()]);

    // Il rename porta i byte e libera l'origine.
    let renamed = DocId::new("archive/Idea.md");
    vault.rename(&notes, &renamed).unwrap();
    assert!(!vault.exists(&notes));
    assert_eq!(vault.read(&renamed).unwrap(), "# Idea\n");

    // Il cestino: la voce ci finisce, il sidecar si ricorda da dove veniva, e
    // l'elenco lo dice. È il giro in cui il vault scrive **tre** posti diversi
    // (il cestino, il sidecar sotto `.fub/data/`, e il file d'origine), quindi
    // è quello che si accorge se uno solo dei tre è rimasto su `std::fs`.
    // Svuotare toglie le voci **e** i sidecar.
    let (trashed, trouble) = vault.trash(&renamed).unwrap();
    assert!(trouble.is_none(), "the sidecar was written: {trouble:?}");
    assert!(trashed.as_str().starts_with(".trash/"));
    let entries = vault.list_trash().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].original, renamed, "the sidecar knows where it came from");

    // Svuotare toglie le voci **e** i sidecar.
    assert_eq!(vault.empty_trash().unwrap(), 1);
    assert!(vault.list_trash().unwrap().is_empty());
    assert!(
        !storage.exists(Utf8Path::new("/vault/.fub/data/trash")),
        "the sidecars leave with the trash"
    );
}

// ---------------------------------------------------------------------------
// Il varco del filesystem (0064): chi riceve una cartella vera dal kernel
// ---------------------------------------------------------------------------

/// **`plugin_data_dir` ha solo i chiamanti dichiarati qui.**
///
/// La [0064](../../../docs/decisions/0064-il-supporto-sta-sotto.md) ha
/// dichiarato il buco: `plugin_data_dir` consegna a un provider nativo una
/// vera cartella del filesystem, fuori da `VaultStorage` — lì la cifratura si
/// ferma. È il varco che tantivy esige (mmappa i segmenti e li rilegge quando
/// gli pare, anche dai thread di merge), e a M5 l'equivalente per un componente
/// sarà un preopen WASI sulla stessa radice: un plugin WASM non riceverà mai
/// una cartella dal kernel.
///
/// Un varco dichiarato in un doc non diventa rosso. Questo conto è la metà che
/// lo diventa: elenca **chi** chiama `plugin_data_dir` in tutto il repo e
/// pretende che ogni chiamante sia in questa lista, con la sua ragione. Un
/// chiamante nuovo — un provider che vuole una cartella, un pezzo di kernel
/// che la consegna — trova un banco che nomina la decisione che sta scavalcando,
/// e se la decisione è cambiata questo è il file da cambiare per primo.
///
/// La lista è per (file, argomento): l'argomento è l'id del provider, cioè chi
/// riceve la cartella. `SEARCH_ID` è la ricerca — l'unico provider nativo che
/// mmappa, oggi. `"prova.uno"` è la spia del banco del ciclo di vita
/// (`deactivation.rs`), che verifica che `close` scriva davvero nello spazio
/// dati. `PLUGIN` in `slow_rename.rs` è il banco 0198/0168: non mmappa,
/// chiede la cartella per posare un byte e vedere se la rinomina spezzata
/// lo porta dietro. Tutti e tre sono chiamanti legittimi, e per questo
/// dichiarati — non allargati in silenzio.
///
/// Il conto non salta i commenti: una prosa che scrivesse la chiamata per
/// esteso diventerebbe rossa, ed è il verso innocuo — la si scrive senza
/// parentesi, come in questo doc.
const CALLERS: &[(&str, &str, &str)] = &[
    (
        "crates/fub-host/src/mount.rs",
        "SEARCH_ID",
        "the search mount: the only native provider that mmaps (today)",
    ),
    (
        "crates/fub-features/tests/data_channel_e2e.rs",
        "SEARCH_ID",
        "the search e2e bench",
    ),
    (
        "crates/fub-features/tests/search_e2e.rs",
        "SEARCH_ID",
        "the search e2e bench",
    ),
    (
        "crates/fub-features/examples/search.rs",
        "SEARCH_ID",
        "the search session",
    ),
    (
        "crates/fub-kernel/tests/deactivation.rs",
        "\"test.one\"",
        "the lifecycle bench: `close` writes into the data space, and the bench verifies it",
    ),
    (
        "crates/fub-kernel/tests/slow_rename.rs",
        "PLUGIN",
        "the bench 0198/0168: attaches and reads the per-document space of a broken rename",
    ),
];

/// Le cartelle in cui non si entra.
const SKIPPED: &[&str] = &["target", "node_modules", ".git", ".fub"];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Ogni `.rs` del repo, per percorso relativo alla radice.
fn sources() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    walk(&root(), "", &mut out);
    out
}

fn walk(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let entries =
        std::fs::read_dir(dir).unwrap_or_else(|and| panic!("`{}` is not readable: {and}", dir.display()));
    for entry in entries {
        let entry = entry.unwrap_or_else(|and| panic!("inside `{}`: {and}", dir.display()));
        let name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|n| panic!("file name not UTF-8: {n:?}"));
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let kind = entry
            .file_type()
            .unwrap_or_else(|and| panic!("`{path}`: {and}"));
        if kind.is_dir() {
            if !SKIPPED.contains(&name.as_str()) {
                walk(&entry.path(), &path, out);
            }
        } else if name.ends_with(".rs") {
            let src = std::fs::read_to_string(entry.path())
                .unwrap_or_else(|and| panic!("`{path}` is not readable: {and}"));
            out.insert(path, src);
        }
    }
}

/// Chi chiama `plugin_data_dir`, e con quale argomento: `(file, argomento)`.
fn callers() -> Vec<(String, String)> {
    // Il pattern è costruito a pezzi, non scritto per esteso: questo file è
    // nella camminata, e una costante letterale qui dentro sarebbe contata.
    let needle = [".plugin_data", "_dir("].concat();
    let mut out = Vec::new();
    for (file, source) in sources() {
        for (n, line) in source.lines().enumerate() {
            let mut from = 0;
            while let Some(rel) = line[from..].find(&needle) {
                let start = from + rel + needle.len();
                let rest = &line[start..];
                let end = rest.find(')').unwrap_or_else(|| {
                    panic!(
                        "`{file}:{}` calls `plugin_data_dir` across lines: the guard does not catch it",
                        n + 1
                    )
                });
                let arg = rest[..end].trim().to_string();
                out.push((file.clone(), arg));
                from = start + end + 1;
            }
        }
    }
    out
}

#[test]
fn the_filesystem_gap_has_only_declared_callers() {
    let found = callers();
    let declared: Vec<(String, String)> = CALLERS
        .iter()
        .map(|(f, a, _)| (f.to_string(), a.to_string()))
        .collect();
    let undeclared: Vec<_> = found.iter().filter(|t| !declared.contains(t)).collect();
    assert!(
        undeclared.is_empty(),
        "{} undeclared caller(s) of `plugin_data_dir`:\n  {}\n\n\
         `plugin_data_dir` is the ONLY filesystem gap outside `VaultStorage` \
         (decision 0064): encryption stops there, and whoever opens it must be a \
         native provider that mmaps — today only the search. A new caller declares \
         itself here, with its reason, and is not added silently.",
        undeclared.len(),
        undeclared
            .iter()
            .map(|(f, a)| format!("{f}  ({a})"))
            .collect::<Vec<_>>()
            .join("\n  "),
    );
}

/// Il test del test: `the_filesystem_gap_has_only_declared_callers`
/// è verde anche se il cammino non trova niente. Questo banco aggancia: se un
/// dichiarato sparisse, o se il cammino diventasse cieco, è questo che diventa
/// rosso — perché un presidio che non aggancia è un presidio che non presidia.
#[test]
fn the_guard_hooks_the_declared_callers() {
    let found = callers();
    for (file, arg, reason) in CALLERS {
        assert!(
            found.contains(&(file.to_string(), arg.to_string())),
            "the guard does not find `{file}` with argument `{arg}` ({reason}): either \
             the caller vanished, or the walk does not see it"
        );
    }
}
