//! **`serialize` non è la strada per riscrivere un documento che esiste.**
//!
//! Il doc di [`FormatProvider::serialize`](fub_abi::FormatProvider::serialize)
//! lo dice alla lettera — *«il kernel non riscrive mai un file esistente passando
//! da qui»* — e fino a questo file era **solo una frase**. È la sesta specie del
//! [§16.8](../../../docs/project/roadmap.md): la *garanzia
//! dichiarata*, quella che batte tutte le altre perché il motivo per cui si
//! scrive una garanzia è smettere di doverci pensare — un conteggio qualcuno
//! prima o poi lo ricontrolla, una rete che si crede tesa non la guarda nessuno.
//!
//! # Il danno, e chi lo causerà
//!
//! Il modello è **lossy per costruzione**: non conserva i commenti dello YAML,
//! l'ordine delle chiavi del frontmatter, lo stile delle virgolette, la
//! spaziatura dei blocchi, lo stile dell'enfasi. Sono, una per una, le voci del
//! secondo gruppo della §2.4 di [FEATURES.md](../../../docs/product/overview.md) — *cosa
//! si preserva quando invece si scrive*.
//!
//! `edit.rs` elenca fra i clienti di `apply_edit` «scrivere una proprietà (8.2)»,
//! «spuntare un task (10.1)», «correggere un link rotto (7.2)». Nessuno dei tre è
//! implementato, e il giorno che qualcuno li implementa la strada comoda è
//! `read_model` → muta il `frontmatter` → `serialize` → `write_document`: quattro
//! chiamate che esistono tutte e che **compilano**. Il risultato è che ogni nota
//! toccata perde tutto quell'elenco, e non c'è niente di rosso da nessuna parte.
//! Chi se ne accorge è chi tiene il vault sotto git.
//!
//! La strada giusta è la [decisione
//! 0008](../../../docs/decisions/README.md): una patch
//! chirurgica sulla sorgente, guidata dagli `Span`, con la revisione su cui è
//! stata calcolata — [`EditRequest`](fub_abi::edit::EditRequest).
//!
//! # La forma: un elenco chiuso dei punti di chiamata
//!
//! È la **seconda rete** di `dependency_invariant.rs` — l'allowlist delle
//! dipendenze dirette —
//! applicata a una funzione invece che a una dipendenza, e per la stessa ragione:
//! *intercetta il gesto*. Aggiungere una chiamata a `serialize` diventa una
//! modifica a questo file, cioè una decisione presa e non un gesto distratto.
//!
//! Non è la maglia più fine possibile — quella sarebbe una barriera di tipo, e
//! costa una firma diversa nel contratto, che è additivo e vicino al freeze. È la
//! maglia che il repo sa già tessere, e che nasce **verde**: oggi nessun codice
//! di produzione chiama `FormatProvider::serialize` fuori dal provider che lo
//! implementa, ed è il momento giusto per tenderla.
//!
//! # Cosa guarda, e cosa non guarda
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo — non un elenco
//! di crate scritto a mano, che sarebbe il difetto della §16.7 dentro al presidio
//! che lo cura. Non guarda i `tests/`: un test che chiama `serialize` per
//! verificare cosa `serialize` genera è esattamente ciò che deve fare, e la
//! garanzia riguarda ciò che viene spedito. Non guarda i moduli `#[cfg(test)]`
//! dentro i `src/`, per la stessa ragione.
//!
//! **Le maglie che lasciano passare, dette qui e non altrove.** Questo test legge
//! i sorgenti come *testo*, quindi lo aggirano: un `use … as` con un alias, una
//! macro che compone la chiamata, un puntatore a funzione preso senza nominare il
//! metodo. Restano fuori portata anche i moduli di prova qui sopra. Ciò che
//! **non** lo aggira è il gesto vero — `provider.serialize(&model)` scritto nel
//! kernel, in `fub-host`, in `fub-app` o in una feature ufficiale — perché
//! quella è la strada comoda, ed è comoda proprio perché non ci si mette
//! ingegno. Una rete a maglie larghe messa dove il pesce passa vale più di una
//! rete stretta messa altrove; dichiararlo serve a non credere che copra il
//! resto (§16.7, il *limite dichiarato*: se una copertura ha un limite, il limite
//! va scritto accanto alla copertura).
//!
//! # Il test è più stretto della frase che presidia
//!
//! La frase vieta di riscrivere un file **esistente**; questo test vieta al
//! kernel di *nominare* `serialize`, punto. La differenza è deliberata: «questo
//! sorgente finisce in un file che non c'era» non è una proprietà che si legga in
//! un `.rs`. Il giorno in cui il kernel genererà davvero un documento nuovo — un
//! template, «crea nota» — quella riga sarà rossa, e la risposta giusta sarà
//! aggiungerla all'allowlist con una ragione nuova nell'enum [`Perche`]. Cioè una
//! decisione, che è il punto.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Il contratto, letto per una ragione sola: questo file presidia **una frase**,
/// e una frase che sparisce lascerebbe in piedi un test che difende una regola
/// che nessuno dichiara più.
///
/// `include_str!` e non `std::fs`: così il legame è una dipendenza di
/// compilazione: se `format.rs` si sposta, questo test non compila.
const CONTRACT: &str = include_str!("../src/format.rs");

/// La frase, alla lettera.
const THE_GUARANTEE: &str = "Il kernel non riscrive mai un file esistente passando da qui";

/// La prosa di un sorgente Rust, tolti i marcatori di commento e appiattita su
/// una riga sola.
///
/// Serve perché una frase di doc-comment sta su più righe, e dove vada a capo
/// dipende da `rustfmt` e dalla larghezza della colonna: cercarla come sta
/// scritta vorrebbe dire un presidio che diventa rosso quando qualcuno aggiunge
/// una parola tre righe più su. Ciò che si presidia è la **frase**, non
fn prose_normalized(source: &str) -> String {
    let mut out = String::new();
    for line in source.lines() {
        let t = line.trim_start();
        let Some(text) = t
            .strip_prefix("///")
            .or_else(|| t.strip_prefix("//!"))
            .or_else(|| t.strip_prefix("//"))
        else {
            continue;
        };
        for word in text.split_whitespace() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(word);
        }
    }
    out
}

// l'impaginazione.
// ---------------------------------------------------------------------------
// Le ragioni

// ---------------------------------------------------------------------------
/// **Perché quel punto di codice può nominare `serialize`.**
///
/// Sono due, e nessuna delle due è «sto modificando un documento». Se la ragione
/// che ti serve non è qui dentro, la risposta quasi sempre non è aggiungerne una
/// terza: è che quella modifica va fatta con
#[derive(Debug)]
enum Reason {
    /// [`HostApi::apply_edit`](fub_abi::traits::HostApi::apply_edit).
    /// **Non è questo `serialize`.** È l'altro — quello di `serde::Serializer`,
    /// che ha lo stesso nome e nessun rapporto con i documenti: qui sono i
    /// `u64_string::serialize` con cui un id numerico attraversa l'IPC come
    /// stringa (JavaScript non ha i 64 bit interi).
    ///
    /// Sta nell'allowlist e non in un'esclusione dell'estrattore perché
    /// distinguerli a occhio è ciò che il presidio deve costringere a fare: un
    /// filtro che togliesse «i serialize di serde» dovrebbe indovinare quale sia
    AnotherSerialize,
    /// quale, e indovinerebbe in silenzio.
    /// **Il formato che lo implementa.** È il *corpo* del metodo del trait, che
    /// delega alla funzione libera del proprio modulo: non una chiamata a
    /// `FormatProvider::serialize`, ma ciò che quel metodo fa. E da lì un file
    /// non si riscrive comunque — un provider non ha un `HostApi` fra le mani.
    TheFormatThatImplementsIt,
}

// ---------------------------------------------------------------------------
// L'allowlist
// ---------------------------------------------------------------------------

/// **Chi può nominare `serialize` nel codice di produzione, tutti e soli.**
///
/// Ogni riga è `(file, forma, quante volte, perché)`. Il conteggio c'è perché la
/// coppia file+forma da sola lascerebbe passare una *seconda* chiamata identica
/// nello stesso file — e una riga in più senza pensarci è precisamente il gesto
/// che questo elenco esiste per rendere costoso.
///
/// Fotografia, non ricordo: una riga qui senza una chiamata vera è rossa quanto
/// una chiamata vera senza la sua riga.
const ALLOWLIST: &[(&str, &str, usize, Reason)] = &[
    (
        "crates/fub-abi/src/event.rs",
        "u64_string::serialize",
        1,
        Reason::AnotherSerialize,
    ),
    (
        "crates/fub-abi/src/traits.rs",
        "u64_string::serialize",
        1,
        Reason::AnotherSerialize,
    ),
    (
        // Due, non uno: `SourceHandle` e `ArtifactHandle` (decisione 0102).
        // Stessa ragione degli altri due — sono chiavi opache che al confine
        // JSON viaggiano come stringhe.
        "crates/fub-abi/src/transfer.rs",
        "u64_string::serialize",
        2,
        Reason::AnotherSerialize,
    ),
    (
        "crates/fub-format-markdown/src/lib.rs",
        "serialize::serialize",
        1,
        Reason::TheFormatThatImplementsIt,
    ),
    (
        // La riga del journal dell'anagrafe, non un documento: `serialize`
        // compone i record `Record { v, mutation }` del formato di storage
        // del kernel, uno per riga, e la scrittura è l'append della coda o
        // lo snapshot della compattazione — serde, come gli altri tre.
        "crates/fub-kernel/src/entries.rs",
        "serialize",
        1,
        Reason::AnotherSerialize,
    ),
];

/// L'allowlist per chiave, col rifiuto dei doppioni: due righe per lo stesso
/// punto vorrebbero dire due ragioni per la stessa cosa, e la seconda non la
/// leggerebbe mai nessuno.
fn allowlist() -> BTreeMap<(&'static str, &'static str), (usize, &'static Reason)> {
    let mut out = BTreeMap::new();
    for (file, form, count, why) in ALLOWLIST {
        assert!(
            out.insert((*file, *form), (*count, why)).is_none(),
            "`{file}` + `{form}` appears twice in the allowlist: sum the counts\n\
             in a single line, or the second reason is dead letter."
        );
    }
    out
}

// ---------------------------------------------------------------------------
// I sorgenti di produzione
// ---------------------------------------------------------------------------

/// Le cartelle in cui non si entra: non contengono sorgenti del progetto, e una
/// di esse (`target`) ne contiene di generati che direbbero il falso.
const EXCLUDED: &[&str] = &["target", "node_modules", ".git", ".fub"];

/// La radice del repo, dedotta dal manifest di questo crate.
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Ogni `.rs` che sta sotto una cartella `src/`, per percorso relativo alla
/// radice del repo e con i separatori sempre `/`.
///
/// Non c'è un elenco di crate: un crate nuovo enter nel presidio perché esiste,
/// non perché qualcuno si è ricordato di scriverlo qui. Che il cammino funzioni
/// davvero non è dato per buono — lo verifica
/// [`the_walk_finds_the_contract`], e prima ancora lo verifica il confronto
/// nei due versi: se questa funzione tornasse a vuoto, le tre righe
fn production_sources() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    walk(&root(), "", &mut out);
    out
}

fn walk(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let entries = std::fs::read_dir(dir)
        .unwrap_or_else(|and| panic!("`{}` is unreadable: {and}", dir.display()));
    for entry in entries {
        let entry = entry.unwrap_or_else(|and| panic!("inside `{}`: {and}", dir.display()));
        let name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|n| panic!("non-UTF-8 file name: {n:?}"));
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let kind = entry
            .file_type()
            .unwrap_or_else(|and| panic!("`{path}`: {and}"));

        if kind.is_dir() {
            if !EXCLUDED.contains(&name.as_str()) {
                walk(&entry.path(), &path, out);
            }
        } else if name.ends_with(".rs") && path.contains("/src/") {
            let src = std::fs::read_to_string(entry.path())
                .unwrap_or_else(|and| panic!("`{path}` is unreadable: {and}"));
            out.insert(path, src);
        }
    }
}

// dell'allowlist risulterebbero tutte sparite.
// ---------------------------------------------------------------------------
// L'estrattore

// ---------------------------------------------------------------------------
/// `true` se la riga è **prosa**: un commento di riga, di documentazione o di
/// modulo.
///
/// Non è un dettaglio: metà delle occorrenze di `serialize` nel repo stanno in
/// doc-comment che spiegano *questa stessa regola* — `serialize.rs` scrive
/// `FormatProvider::serialize` nel proprio doc di modulo. Un estrattore che
/// contasse la prosa nascerebbe con dei falsi positivi nell'allowlist, cioè con
/// delle righe che dichiarano legittimo qualcosa che non esiste.
///
/// Vale solo per i commenti di riga. Un `/* … */` che nominasse `serialize`
/// produrrebbe un **falso positivo** — il verso innocuo: qualcuno guarda e
fn is_prose(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// toglie la riga, invece di non accorgersi di niente.
/// Dove finisce un `#[cfg(test)] mod … { … }` scritto a colonna zero, se è di
/// quella forma.
///
/// La regola è volutamente minuscola: l'attributo a colonna zero, un `mod … {` a
/// colonna zero subito sotto, e la prima riga uguale a `}`. Tiene perché
/// `cargo fmt --all --check` è verde — dentro un blocco indentato non c'è
/// nessun'altra `}` in prima colonna. `None` quando la forma è un'altra
/// (`#[cfg(test)]` su una funzione: succede due volte nel repo), e allora non si
fn test_module_end(lines: &[&str], attribute: usize) -> Option<usize> {
    let opening = lines.get(attribute + 1)?;
    if !(opening.starts_with("mod ") && opening.ends_with('{')) {
        return None;
    }
    let end = lines
        .iter()
        .enumerate()
        .skip(attribute + 2)
        .find(|(_, r)| **r == "}")
        .map(|(n, _)| n);
    Some(end.unwrap_or_else(|| {
        panic!(
            "the test `mod` opened at line {} does not close with a `}}` in the first\n\
             column: the extractor does not know where it ends.",
            attribute + 2
        )
    }))
}

/// salta niente: contare di più è il verso innocuo.
/// Le **forme** con cui una riga nomina `serialize` come funzione.
///
/// Conta un'occorrenza quando `serialize` è un identificatore intero e:
///
/// - è preceduto da `::` → forma `qualcuno::serialize` (chiamata per percorso,
///   `use`, o metodo preso in UFCS);
/// - è preceduto da `.` → forma `.serialize` — **il gesto pericoloso**, la
///   chiamata di metodo su un provider;
/// - è seguito da `(` → forma `serialize` (chiamata libera, dopo un `use`).
///
/// Non la conta quando è una **definizione** (`fn serialize`) o una
/// **dichiarazione di modulo** (`mod serialize`): quelle sono ciò che rende il
/// metodo esistente, non chi lo usa — e un provider deve poterlo implementare.
///
/// Ciò che non rientra in nessuno di questi casi non è una chiamata: la parola
/// dentro una stringa (`"serialize fallito"`), o il nome di un modulo dentro un
fn forms(line: &str) -> Vec<String> {
    const NEEDLE: &str = "serialize";
    let mut out = Vec::new();
    let mut from = 0;

    while let Some(offset) = line[from..].find(NEEDLE) {
        let the = from + offset;
        from = the + NEEDLE.len();

        let before = &line[..the];
        let after = &line[the + NEEDLE.len()..];
        // percorso più lungo.
        // Confini di identificatore: `deserialize` e `serialize_with` non sono
        if before.chars().next_back().is_some_and(is_ident)
            || after.chars().next().is_some_and(is_ident)
        {
            continue;
        }
        if before.ends_with("fn ") || before.ends_with("mod ") {
            continue;
        }

        if let Some(path) = before.strip_suffix("::") {
            let qualifier: String = path
                .chars()
                .rev()
                .take_while(|c| is_ident(*c))
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            out.push(format!("{qualifier}::{NEEDLE}"));
        } else if before.ends_with('.') {
            out.push(format!(".{NEEDLE}"));
        } else if after.starts_with('(') {
            out.push(NEEDLE.to_string());
        }
    }
    out
}

/// Le forme di un intero sorgente, con quante volte ciascuna compare.
fn citations(source: &str) -> BTreeMap<String, usize> {
    let lines: Vec<&str> = source.lines().collect();
    let mut out: BTreeMap<String, usize> = BTreeMap::new();
    let mut n = 0;

    while n < lines.len() {
        let line = lines[n];
        if is_prose(line) {
            n += 1;
            continue;
        }
        if line == "#[cfg(test)]" {
            if let Some(end) = test_module_end(&lines, n) {
                n = end + 1;
                continue;
            }
        }
        for form in forms(line) {
            *out.entry(form).or_default() += 1;
        }
        n += 1;
    }
    out
}

fn production_citations() -> BTreeMap<(String, String), usize> {
    let mut out = BTreeMap::new();
    for (file, source) in production_sources() {
        for (form, count) in citations(&source) {
            out.insert((file.clone(), form), count);
        }
    }
    out
}

fn list(points: &BTreeSet<(String, String)>) -> String {
    points
        .iter()
        .map(|(f, form)| format!("  {f} — `{form}`"))
        .collect::<Vec<_>>()
        .join("\n")
}

// Tutte le citazioni del codice di produzione, per `(file, forma)`.
// ---------------------------------------------------------------------------
// La rete

// ---------------------------------------------------------------------------
/// **Il cuore**: chi nomina `serialize` è l'allowlist, nei due versi e col
#[test]
fn serialize_is_not_the_way_to_rewrite_an_existing_document() {
    let found = production_citations();
    let declared = allowlist();

    let seen: BTreeSet<(String, String)> = found.keys().cloned().collect();
    let expected: BTreeSet<(String, String)> = declared
        .keys()
        .map(|(f, form)| (f.to_string(), form.to_string()))
        .collect();

    let new: BTreeSet<(String, String)> = seen.difference(&expected).cloned().collect();
    assert!(
        new.is_empty(),
        "these production code sites name `serialize`, and the allowlist\n\
         does not know them:\n\
         {}\n\
         \n\
         If you are **editing an existing document**, this is the wrong\n\
         path, and there is no line to add here: the model is lossy by\n\
         construction — it loses YAML comments, key order, quote style,\n\
         spacing, emphasis style — so `read_model` → `serialize` →\n\
         `write_document` rewrites an entire file that the user will see\n\
         changed everywhere. The path is `apply_edit` with an `EditRequest`:\n\
         the model's `Span`s say where to intervene, and the `Revision`\n\
         says on which text (decision 0008).\n\
         \n\
         If you are **generating a new document** (a template, \"create\"\n\
         notes) or if it is a `serialize` unrelated to documents (serde),\n\
         then the line should be added here — with its reason in the\n\
         `Reason` enum, which today has two and neither covers generation.\n\
         Adding a third is the decision to make, and it is why this file\n\
         exists.",
        list(&new)
    );

    let vanished: BTreeSet<(String, String)> = expected.difference(&seen).cloned().collect();
    assert!(
        vanished.is_empty(),
        "the allowlist declares call sites that no longer exist in code:\n\
         {}\n\
         Remove them: the list is a snapshot, not a memory. (If they all\n\
         vanished at once, first check the source walk: that is how this\n\
         guard could stop watching something.)",
        list(&vanished)
    );

    for (key, count) in &found {
        let Some((expected, why)) = declared.get(&(key.0.as_str(), key.1.as_str())) else {
            continue;
        };
        assert_eq!(
            count, expected,
            "in `{}` the form `{}` appears {count} times and the allowlist declares\n\
             {expected} ({why:?}). If the extra call is legitimate, update the\n\
             count: it is the line that forces you to look at it.",
            key.0, key.1
        );
    }
}

/// conteggio.
/// **La frase presidiata esiste ancora, ed è là dove il contratto la fa.**
///
/// Senza questa, il giorno in cui qualcuno riscrivesse il doc di `serialize`
/// resterebbe in piedi un test che difende una regola che nessun documento
/// dichiara più — e chi lo trovasse rosso non saprebbe da dove viene. È la sesta
/// specie presa dal verso in cui si presidia, come in `lean_ipc.rs`: una
#[test]
fn the_guarantee_is_still_written_in_the_contract() {
    assert!(
        prose_normalized(CONTRACT).contains(THE_GUARANTEE),
        "in `crates/fub-abi/src/format.rs` the sentence\n  \"{THE_GUARANTEE}\"\n\
         is no longer there, which this test makes mechanical. Either it was\n\
         rewritten — and then it must be rewritten here too — or the rule has\n\
         changed, and then the contract must be changed first and this guard\n\
         removed with a record."
    );
}

// garanzia meccanica deve rimandare a una frase che una macchina sa cercare.
// ---------------------------------------------------------------------------
// I test del test

// ---------------------------------------------------------------------------
/// Il cammino guarda davvero i sorgenti: se sbagliasse radice tornerebbe a
/// vuoto, e un insieme vuoto non contraddice nessuna allowlist dal verso che si
#[test]
fn the_walk_finds_the_contract() {
    let sources = production_sources();
    assert!(
        sources.contains_key("crates/fub-abi/src/format.rs"),
        "the source walk did not find `crates/fub-abi/src/format.rs`, which is\n\
         the file where `serialize` is declared. It is looking in the wrong\n\
         place: it found {}.",
        sources.len()
    );
    assert!(
        !sources.keys().any(|f| f.contains("/tests/")),
        "the walk collected files under `tests/`: there `serialize` is called, and\n\
         it is right that it is called."
    );
}

/// guarda per primo.
/// **La rete deve sapersi chiudere**: l'estrattore vede la strada sbagliata.
///
/// È la prova che si è fatta a mano una volta — mettendo la funzione nel kernel e
/// guardando il presidio diventare rosso — resa permanente. Un presidio che non
#[test]
fn the_extractor_sees_the_wrong_path() {
    let fake = "\
impl Workspace {\n\
    pub fn write_a_property(&mut self, id: &DocId, key: &str) -> Result<()> {\n\
        let mut model = self.read_model(id)?;\n\
        model.frontmatter.0.insert(key.to_string(), Value::Bool(true));\n\
        let source = self.docs.provider_for(id)?.serialize(&model)?;\n\
        self.write_document(id, &source, WriteBase::Dictated)\n\
    }\n\
}\n";
    assert_eq!(
        citations(fake),
        BTreeMap::from([(".serialize".to_string(), 1)]),
        "the method call is the gesture this guard exists to catch"
    );
}

/// può diventare rosso è la sesta specie con un nome nuovo.
/// E deve distinguere ciò che nomina `serialize` da ciò che lo **è**, senza
#[test]
fn the_extractor_distinguishes_definition_from_call() {
    let fake = "\
/// contare la prosa che ne parla.
mod serialize;\n\
use fub_abi::traits::serialize;\n\
\n\
impl FormatProvider for Fake {\n\
//! Un modulo che parla di `FormatProvider::serialize` e di `provider.serialize(&m)`.\n\
    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {\n\
        Ok(serialize::serialize(model))\n\
    }\n\
}\n\
\n\
fn other(x: &X) -> String {\n\
    let a = crate::ipc::u64_string::serialize(&x.0, s);\n\
    let b = serialize(&x.1);\n\
    let c = FormatProvider::serialize;\n\
    format!(\"serialize failed: {a}{b}{c:?}\")\n\
}\n\
\n\
#[cfg(test)]\n\
mod tests {\n\
    #[test]\n\
    fn the_serializer_test() {\n\
        assert!(MarkdownProvider::new().serialize(&doc).is_ok());\n\
    }\n\
}\n";

    assert_eq!(
        citations(fake),
        BTreeMap::from([
            // Il doc, che cita `.serialize(` per spiegarsi.\n\
            // Il `use`: passa dal `::`, ed è il modo in cui una chiamata libera
            ("traits::serialize".to_string(), 1),
            // arriva senza nominare nessuno.
            ("serialize::serialize".to_string(), 1),
            // La delega del provider al proprio modulo.
            ("u64_string::serialize".to_string(), 1),
            // L'altro `serialize`, quello di serde.
            // La chiamata libera, e il metodo preso senza parentesi (UFCS): due
            ("serialize".to_string(), 1),
            ("FormatProvider::serialize".to_string(), 1),
        ]),
        "five citations expected: `mod serialize;`, the two `fn serialize`, prose\n\
         and the entire `#[cfg(test)]` module are not counted"
    );
}

// forme che un estrattore ingenuo lascerebbe passare.
/// Un `#[cfg(test)]` che non apre un modulo non fa saltare niente: succede due
#[test]
fn a_cfg_test_on_a_function_does_not_open_a_module() {
    let fake = "\
#[cfg(test)]\n\
fn helper(p: &dyn FormatProvider, m: &DocumentModel) -> String {\n\
    p.serialize(m).unwrap()\n\
}\n";
    assert_eq!(citations(fake), BTreeMap::from([(".serialize".into(), 1)]));
}
