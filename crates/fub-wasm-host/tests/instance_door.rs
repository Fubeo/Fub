//! **L'istanza di un componente si prende da una porta sola** (FUB-019).
//!
//! Il grafo delle attese fra turno di scrittura e istanza vede soltanto ciò che
//! passa da `LockInstance::lock_instance`: un `.lock()` nudo su un
//! `Mutex<Instance>` è un'attesa invisibile, e un salvataggio che lo incontra
//! mentre un job tiene l'istanza e chiede il turno si ferma per sempre senza che
//! nessuno possa cedere.
//!
//! Il comportamento lo prova `the_instance_and_the_turn.rs`, con un componente
//! vero e per ciascuno dei quattro ingressi (parser, hook, indice, eventi). Qui
//! si guarda il solo punto che quel banco non può vedere: un **quinto** ingresso
//! scritto domani. Si cerca perciò in `src/` ogni `.lock()`/`.try_lock()`, e
//! l'unico file che può farlo, oltre alla porta, è `managed.rs`, i cui mutex
//! proteggono lo stato del gestore e non toccano istanze.

use std::fs;
use std::path::Path;

/// I file che possono chiamare `.lock()`, e perché.
const ALLOWED: &[(&str, &str)] = &[
    ("instance_lock.rs", "è la porta"),
    (
        "managed.rs",
        "i suoi mutex proteggono lo stato del gestore, non un'istanza",
    ),
];

#[test]
fn nobody_takes_an_instance_without_the_door() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut offenders = Vec::new();
    for entry in fs::read_dir(&src).expect("src/ esiste") {
        let path = entry.expect("voce di src/").path();
        if path.extension().is_none_or(|ext| ext != "rs") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("nome utf8");
        if ALLOWED.iter().any(|(allowed, _)| *allowed == name) {
            continue;
        }
        let text = fs::read_to_string(&path).expect("file leggibile");
        // I commenti non sono codice: la porta si cita dai doc.
        for (number, line) in text.lines().enumerate() {
            let code = line.split("//").next().unwrap_or("");
            if code.contains(".lock()") || code.contains(".try_lock()") {
                offenders.push(format!("{name}:{}: {}", number + 1, line.trim()));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "un'istanza si prende con `lock_instance()`, che dice al grafo delle attese chi la \
         tiene e chi la aspetta; questi punti no:\n{}",
        offenders.join("\n")
    );
}
