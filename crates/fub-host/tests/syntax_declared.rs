//! **La dichiarazione della sintassi, emessa verso la shell** (§4.4).
//!
//! La §4.4 chiede chi dei due parser sia la verità, e la risposta è **nessuno
//! dei due**: con la [0104](../../../docs/decisions/0104-la-superficie-di-scrittura-si-presta.md)
//! la live preview è *una* superficie di scrittura fra quelle possibili, quindi
//! le sue regex non possono essere la verità nemmeno per lei; e con la
//! [0018](../../../docs/decisions/0018-chi-vede-il-modello-parsato.md) il
//! modello non può esserlo per un buffer sporco. La verità è la
//! **dichiarazione** — [`SyntaxForm`], cioè il vocabolario di
//! [`fub_abi::options::syntax`] più il trigger di chi ne ha uno — e finora
//! nessuno la leggeva: la shell la riscriveva a mano, e il `==` di
//! `livepreview.ts` era la copia scritta due volte di
//! `HighlightRule::spec().trigger`.
//!
//! Questo file la **emette** in `frontend/src/rules/sintassi.generated.ts`, con
//! la stessa forma dei mirror che il repo ha già (0053): un derivato, non un
//! mirror scritto a mano, quindi non c'è il modo di fallimento in cui i due lati
//! divergono restando verdi.
//!
//! # Perché sta in `fub-host` e non dove stanno i tipi
//!
//! Perché la domanda non è «quali regole esistono» ma «quali regole **sono
//! montate**», ed è la stessa ragione per cui `le_view_ufficiali.rs` sta qui:
//! un elenco che descrive il montaggio è falso il giorno in cui qualcuno
//! registra qualcosa senza passare di lì. Qui il montaggio c'è, e una quarta
//! `SyntaxRule` innestata sul markdown entra in questo file **da sola** — cioè
//! rende stantio il generato, cioè rosso.
//!
//! # La zona cieca, misurata costruendo il caso
//!
//! Il generato è **compilato**, quindi conosce le regole del *core*. Una regola
//! di terzi si registra a caldo, in un vault che questo file non monterà mai, e
//! di lei qui non c'è traccia: la sua sintassi arriva al modello e non arriva
//! alla superficie di scrittura. È il residuo esatto della §4.4 — un canale che
//! porti [`Workspace::syntax_forms`] alla shell **a runtime** — e sta scritto
//! nella [0115](../../../docs/decisions/0115-la-verita-e-la-dichiarazione.md)
//! come casella, non come buco: l'accessore che quel canale servirebbe è già
//! questo, e quello che manca è la rotta.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;

use camino::Utf8PathBuf;
use fub_abi::custom::{SyntaxForm, SyntaxTrigger};
use fub_abi::model::DocId;
use fub_kernel::{MachineSettings, SystemLocale, ViewStates};

/// Il documento su cui si chiede la dichiarazione. Non deve esistere:
/// `syntax_forms` è una domanda sull'**estensione**, come `format_of`.
const PROBE: &str = "sonda.md";

const HEADER: &str = "\
// FILE GENERATO — non modificare a mano.
//
// La dichiarazione della sintassi, emessa da un montaggio VERO
// (crates/fub-host/tests/sintassi_dichiarata.rs, decisione 0115). I nomi sono
// il vocabolario di `fub_abi::options::syntax`; il trigger c'è per le sintassi
// che una `SyntaxRule` innesta dichiarandone la forma, e manca per quelle che
// il provider conosce come grammatica — che è il confine oltre il quale chi
// decora un buffer si arrangia.
//
// La forma JSON è quella di serde, cioè quella che attraverserà l'IPC il giorno
// in cui questa dichiarazione arriverà a runtime invece che alla compilazione.
//
// La prosa sta accanto a chi lo interpreta, in `sintassi.ts`: qui non c'è
// niente che qualcuno abbia deciso.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-host --test sintassi_dichiarata
";

fn path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src/rules/sintassi.generated.ts")
}

/// Le forme dichiarate da un montaggio vero, per un `.md`.
fn forms() -> Vec<SyntaxForm> {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
    // Tutto in memoria, come in `le_view_ufficiali.rs` e per la stessa ragione:
    // un `plugins.disabled` dell'utente non deve poter cambiare un file
    // committato.
    let mounted = fub_host::mount::mount(
        &root,
        MachineSettings::in_memory(),
        ViewStates::in_memory(),
        Arc::new(SystemLocale::default()),
        &fub_kernel::log::Levels::default(),
    )
    .expect("mount succeeds");
    mounted.workspace.syntax_forms(&DocId::new(PROBE))
}

fn trigger_ts(t: &SyntaxTrigger) -> String {
    match t {
        SyntaxTrigger::Fence { info } => {
            let entries: Vec<String> = info.iter().map(|the| format!("{the:?}")).collect();
            format!("{{ fence: {{ info: [{}] }} }}", entries.join(", "))
        }
        SyntaxTrigger::Inline { open, close } => {
            format!("{{ inline: {{ open: {open:?}, close: {close:?} }} }}")
        }
    }
}

fn render() -> String {
    let mut out = String::from(HEADER);
    out.push_str("\nexport const SINTASSI_MARKDOWN = [\n");
    for f in forms() {
        let trigger = match &f.trigger {
            Some(t) => trigger_ts(t),
            None => "null".into(),
        };
        out.push_str(&format!(
            "  {{ name: {:?}, trigger: {trigger} }},\n",
            f.name
        ));
    }
    out.push_str("] as const;\n");
    out
}

#[test]
fn emitted_declaration_matches_mount() {
    let emitted = render();
    let path = path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emitted).expect("writes generated declaration");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "generated declaration missing ({}): {and}. Regenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-host --test syntax_declared`.",
            path.display()
        )
    });

    assert_eq!(
        emitted, committed,
        "`frontend/src/rules/sintassi.generated.ts` is stale: the syntax \
         declared by the mount changed without regenerating it.\nRegenerate \
         with `UPDATE_MIRROR=1 cargo test -p fub-host --test syntax_declared`."
    );
}

/// **Ciò che la shell può generare, e ciò che deve riscrivere a mano.**
///
/// È la riga che rende utile il tipo invece dell'elenco di nomi: `trigger`
/// assente non è «nessuna forma», è «la forma sta nella grammatica del
/// provider». Il numero delle prime cresce con le estensioni del 5.2 e il
/// numero delle seconde no — è precisamente il moltiplicatore che la §4.4
/// voleva togliere — quindi vale la pena che una sintassi che *passa* dalla
/// seconda specie alla prima renda rosso qualcosa, invece di limitarsi a
/// funzionare meglio.
#[test]
fn syntax_forms_without_declared_trigger_belong_to_provider() {
    let forms = forms();
    let without: BTreeSet<&str> = forms
        .iter()
        .filter(|f| f.trigger.is_none())
        .map(|f| f.name.as_str())
        .collect();
    assert_eq!(
        without,
        BTreeSet::from([
            "fub:callouts",
            "fub:definition-lists",
            "fub:embeds",
            "fub:footnotes",
            "fub:frontmatter",
            "fub:tags",
            "fub:wikilinks",
        ]),
        "the syntax forms the markdown provider knows as grammar have \
         changed. If one gained a declared trigger, the shell can now \
         GENERATE it instead of rewriting it: remove it from here and \
         remove its regex from `frontend/src/rules/sintassi.ts`. If a new \
         one appeared without a trigger, the shell will have to rewrite it \
         by hand — which is the multiplier from section 4.4, and needs a \
         decision rather than an immediate fix"
    );

    let with_trigger: BTreeSet<&str> = forms
        .iter()
        .filter(|f| f.trigger.is_some())
        .map(|f| f.name.as_str())
        .collect();
    assert_eq!(
        with_trigger,
        BTreeSet::from(["fub:diagrams", "fub:highlight", "fub:math"]),
        "syntax forms with a declared trigger have changed"
    );
}

/// L'emissione dev'essere **stabile**: un file che cambia da sé fra due
/// esecuzioni renderebbe il presidio rumore, e lo si spegnerebbe.
#[test]
fn emission_is_deterministic() {
    assert_eq!(render(), render());
}
