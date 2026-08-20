//! **Il veleno del kernel ha due porte, e nessuna terza risposta improvvisata.**
//!
//! Il difetto che questo banco presidia non era un panico — nessuno dei sei
//! `.expect("campanello avvelenato")` di `dispatcher.rs` né dei due
//! `.expect("file di log")` di `log.rs` era raggiungibile, e questo va detto
//! perché è metà della diagnosi. Il difetto era che **la ragione stava in una
//! frase**: una frase ripetuta otto volte sembra una decisione presa, e non lo
//! è; e soprattutto **il nono `expect` non eredita niente**. La riparazione è
//! una porta ([`fub_kernel::poison`]), e una porta rende inesprimibile la forma
//! vecchia solo per chi ci passa: niente impedirebbe di scrivere accanto un
//! secondo `Mutex` con la sua politica improvvisata, e il compilatore direbbe di
//! sì perché non c'è niente di illegale da dire. È la zona cieca misurata
//! addosso alla [0120](../../../docs/decisions/0120-un-lucchetto-avvelenato-si-dice-una-volta.md),
//! dove quattordici siti erano rimasti col codice vecchio a crate verde.
//!
//! Quindi due conti, che guardano due cose diverse.
//!
//! 1. **Nei due file riparati un lucchetto nudo non c'è più.** Chi vuole un
//!    lucchetto in `dispatcher.rs` o in `log.rs` passa da `Shelter`/`Condition`.
//! 2. **La politica del veleno, in tutto il kernel, sta in due file soli.** Le
//!    parole con cui si risponde a un `PoisonError` — `clear_poison`,
//!    `into_inner`, `PoisonError` — compaiono in `bus.rs` (la porta della
//!    [0126](../../../docs/decisions/0126-un-bus-che-tace-non-lo-scopre-nessuno.md))
//!    e in `poison.rs`, e in nessun altro posto. Una terza risposta scritta a
//!    mano in un terzo file è rossa **per nome**, ed è il verso giusto in cui
//!    sbagliare: costringe a dichiararla invece di lasciarla passare.
//!
//! # Cosa questo banco **non** vede, dichiarato
//!
//! **Gli altri file del kernel tengono ancora i loro lucchetti nudi.** Sono
//! **sette** [conta: lucchetti-nudi-del-kernel], e restano fuori dal primo conto
//! **apposta**: è lo stesso buco che la 0120 aveva dichiarato («il conto vede
//! `fub-host` e `fub-app`, non gli altri crate») e che la 0126 aveva rifiutato
//! di chiudere, perché estenderlo vorrebbe dire un'allowlist lunga come
//! l'elenco che dovrebbe restringere. Ciò che è cambiato è che adesso la porta
//! **c'è**: convertirne uno costa una riga, e la domanda «con quale delle due
//! politiche?» ha già le sue due risposte scritte.
//!
//! Il numero sta fra parentesi quadre e non fra i trattini perché **prima era
//! una frase, e la frase era falsa**. Diceva «sono nove» e li nominava:
//! `journal.rs`, `drafts.rs` e `ignore.rs` erano nell'elenco e non hanno mai
//! avuto un lucchetto, mentre `vault.rs` ne ha uno — di banco, quindi fuori dal
//! taglio di [`code`] e giustamente fuori dal conto — e nell'elenco non
//! c'era. Nessuno se n'era accorto per la ragione che rende questa specie
//! peggiore delle altre: **il motivo per cui si scrive un elenco è smettere di
//! doverlo rifare**. Un elenco a mano dentro una zona dichiarata cieca non ha
//! nessun attore che lo guardi — non il compilatore, che non legge i commenti,
//! e non un banco, perché il banco è qui sotto e guarda altre due cose.
//! Adesso l'attore c'è, è `check-prosa`, e la stessa zona vista sui tre crate
//! che il conto della 0120 non attraversa
//! vale **nove** file [conta: lucchetti-outside-dal-conto].
//!
//! Il secondo conto invece li attraversa tutti, perché la domanda è diversa: non
//! «hai un lucchetto?» ma «ne hai improvvisato la politica?».

use std::collections::BTreeSet;

/// I due file che il primo conto giudica. `include_str!` e non `std::fs`: così
/// il legame è una dipendenza di compilazione e non un path da tenere
/// aggiornato a mano — se un file si sposta, questo banco non compila.
const REPAIRED: &[(&str, &str)] = &[
    ("dispatcher.rs", include_str!("../src/dispatcher.rs")),
    ("log.rs", include_str!("../src/log.rs")),
];

/// I due file in cui la politica del veleno può stare, e sono porte.
const THE_GATES: &[&str] = &["bus.rs", "poison.rs"];

/// Le righe di **codice** di un sorgente: la prosa si salta sempre.
///
/// Che un commento non sia codice è la trappola misurata da `lean_ipc.rs` — in
/// un repo in cui i file spiegano sé stessi, un `grep` ingenuo conta le
/// spiegazioni, e questo file ne è pieno: la testa di `JobBell` *nomina* i sei
/// `expect` che non ci sono più.
///
/// Il modulo di test si taglia via: un lucchetto costruito a mano in un banco è
/// roba del banco, e i due banchi qui riparati **devono** poter prendere il
/// prestito per avvelenarlo. Il taglio presuppone che il `#[cfg(test)]` stia in
/// fondo al file; se un giorno non lo fosse, il conto guarderebbe di meno e non
/// di più.
fn code(source: &str) -> Vec<(usize, &str)> {
    let end = source.find("\n#[cfg(test)]\n").unwrap_or(source.len());
    source[..end]
        .lines()
        .enumerate()
        .map(|(n, line)| (n + 1, line.trim()))
        .filter(|(_, line)| !line.starts_with("//"))
        .collect()
}

/// Le parole che, in un file riparato, vogliono dire «qui c'è un lucchetto senza
/// politica». `Condvar` è nell'elenco perché è la ragione per cui `Condition`
/// esiste: una condizione scritta a mano si porta dietro il suo `Mutex` nudo.
const BARE: &[&str] = &["Mutex<", "RwLock<", "Condvar", ".lock()", "PoisonError"];

/// L'unica `.lock()` che non è un lucchetto avvelenabile: `StderrLock` non ha un
/// veleno da avere, e `StderrSink` è il posto dove si scrive quando non c'è un
/// posto dove scrivere. Sta qui e non nell'elenco generale perché un'eccezione
/// va **nominata**: se domani `stderr()` sparisse da `log.rs` questa riga
/// resterebbe a indicare qualcosa che non c'è, e [`the_files_the_counts_name_actually_exist`]
/// non la vedrebbe — quindi la si controlla qui, dove si usa.
const NOT_A_LOCK: &str = "std::io::stderr().lock()";

#[test]
fn no_bare_lock_remains_in_the_repaired_files() {
    let mut faults = Vec::new();
    for (name, source) in REPAIRED {
        let mut exception_seen = false;
        for (n, line) in code(source) {
            if line.contains(NOT_A_LOCK) {
                exception_seen = true;
                continue;
            }
            for word in BARE {
                if line.contains(word) {
                    faults.push(format!("{name}:{n} `{word}` — {line}"));
                }
            }
        }
        assert!(
            exception_seen || *name != "log.rs",
            "`{NOT_A_LOCK}` is no longer in `log.rs`: the exception is a \
             memory, and must be removed instead of staying to cover a future line"
        );
    }
    assert!(
        faults.is_empty(),
        "a lock without a policy returned to the repaired files. The gate is \
         `fub_kernel::poison`: `Shelter` for data, `Condition` for data with a \
         `Condvar` on top.\n{}",
        faults.join("\n")
    );
}

/// Il gemello del caso qui sopra, e serve perché il primo non basta: la porta
/// toglie il lucchetto nudo, non l'`expect` con una frase. Un `expect` che
/// *nomina* il veleno è la forma precisa che questo giro ha chiuso, e riscriverla
/// altrove nel kernel sarebbe riaprire la domanda in un posto nuovo.
#[test]
fn nobody_rewrites_a_reason_instead_of_a_policy() {
    let mut faults = Vec::new();
    for (name, source) in sources() {
        if THE_GATES.contains(&name.as_str()) {
            continue;
        }
        for (n, line) in code(&source) {
            let declares = line.contains("expect(") || line.contains("unwrap_or_else(");
            if declares && (line.contains("poison") || line.contains("avvelenat")) {
                faults.push(format!("{name}:{n} — {line}"));
            }
        }
    }
    assert!(
        faults.is_empty(),
        "a poison reason written as a sentence instead of through a gate:\n{}",
        faults.join("\n")
    );
}

#[test]
fn the_poison_policy_lives_in_two_files_only() {
    let mut outside = Vec::new();
    for (name, source) in sources() {
        if THE_GATES.contains(&name.as_str()) {
            continue;
        }
        for (n, line) in code(&source) {
            for word in ["clear_poison", "PoisonError", "into_inner()"] {
                if line.contains(word) {
                    outside.push(format!("{name}:{n} `{word}` — {line}"));
                }
            }
        }
    }
    assert!(
        outside.is_empty(),
        "the answer to a poisoned lock is hand-written outside the two gates \
         ({}). The kernel's two policies are decided (0126, and 0120 for the \
         host): a third place improvising a third is the defect the two \
         decisions exist to prevent.\n{}",
        THE_GATES.join(", "),
        outside.join("\n")
    );
}

/// **L'elenco dei file riparati è una fotografia, e va confrontata con la
/// cartella vera.**
///
/// Un presidio che legge un elenco sa quell'elenco: senza questo caso, un file
/// tolto da `REPAIRED` renderebbe verde il conto invece che rosso — che è il
/// modo in cui un'allowlist smette di essere una fotografia e diventa un
/// ricordo.
#[test]
fn the_files_the_counts_name_actually_exist() {
    let on_disk: BTreeSet<String> = sources().into_iter().map(|(name, _)| name).collect();
    for name in REPAIRED
        .iter()
        .map(|(n, _)| *n)
        .chain(THE_GATES.iter().copied())
    {
        assert!(
            on_disk.contains(name),
            "`{name}` is named by this bench and is no longer in `src/`: \
             the list is a memory, not a snapshot"
        );
    }
}

/// Tutti i sorgenti di `crates/fub-kernel/src`, letti dal disco: `(name, testo)`.
///
/// È l'unico posto di questo file che usa `std::fs` invece di `include_str!`, e
/// la ragione è il contrario di quella che vale per [`REPAIRED`]: `include_str!`
/// lega il banco a un file **che qualcuno ha nominato**, e ciò che serve al
/// secondo conto è vedere i file che nessuno ha nominato.
fn sources() -> Vec<(String, String)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    walk(&root, &mut out);
    out.sort();
    out
}

fn walk(dir: &std::path::Path, into: &mut Vec<(String, String)>) {
    for entry in std::fs::read_dir(dir).expect("the sources folder") {
        let path = entry.expect("a folder entry").path();
        if path.is_dir() {
            walk(&path, into);
        } else if path.extension().is_some_and(|and| and == "rs") {
            let name = path
                .file_name()
                .expect("a file has a name")
                .to_string_lossy()
                .into_owned();
            into.push((name, std::fs::read_to_string(&path).expect("a source")));
        }
    }
}
