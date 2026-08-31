from pathlib import Path

p = Path('crates/fub-kernel/tests/rejoin.rs')
s = p.read_text()

old_intro = '''//! 1. **Si riconosce dal contenuto.** Un documento sparito e uno comparso con la
//!    stessa impronta sono la stessa nota con un nome nuovo, e ciò che le stava
//!    attaccato la segue.
//! 2. **Uno a uno, o niente.** Una copia non è una rinomina, e con N spariti e N
//!    comparsi l'accoppiamento non è unico.
//! 3. **Nel dubbio non si accoppia e non si raccoglie.** Delle due mosse, quella
//!    irreversibile si sospende.
'''
new_intro = '''//! 1. **Identità filesystem + contenuto.** Un documento sparito e uno comparso
//!    si ricongiungono soltanto quando l'identità del file è la stessa e anche
//!    SHA-256 coincide: né inode/file-index né contenuto bastano da soli.
//! 2. **Una copia non è una rinomina.** Copy+delete produce un file nuovo anche
//!    con gli stessi byte e non eredita bozza o side-data.
//! 3. **Identità prima dell'ambiguità di contenuto.** Più file con testo uguale
//!    possono essere rinominati insieme: device/inode o volume/file-index rende
//!    l'accoppiamento univoco senza indovinare dal digest.
'''
if old_intro in s:
    s = s.replace(old_intro, new_intro, 1)

def replace_test(source: str, name: str, replacement: str) -> str:
    marker = f'#[test]\nfn {name}() {{'
    start = source.find(marker)
    if start < 0:
        raise SystemExit(f'test {name} non trovato')
    next_test = source.find('\n#[test]\n', start + len(marker))
    if next_test < 0:
        next_test = len(source)
    return source[:start] + replacement.rstrip() + '\n' + source[next_test:]

s = replace_test(
    s,
    'n_disappeared_and_n_appeared_not_is_pair_and_not_is_collecting',
    r'''#[test]
fn equal_contents_do_not_make_two_real_renames_ambiguous() {
    let f = Fixture::new();
    f.write("a.txt", "due note con lo stesso identico testo");
    f.write("b.txt", "due note con lo stesso identico testo");
    let mut ws = f.open();
    ws.save_draft(&DocId::new("a.txt"), "la bozza di a", None)
        .expect("bozza");
    f.attach_data("a.txt");
    f.attach_data("b.txt");
    drop(ws);

    // Il digest è uguale, ma i due file hanno identità filesystem diverse e
    // ciascun rename conserva la propria: non serve indovinare dal contenuto.
    f.rename("a.txt", "c.txt");
    f.rename("b.txt", "d.txt");

    let ws = f.open();
    assert_eq!(
        draft_of(&ws, "c.txt").as_deref(),
        Some("la bozza di a"),
        "la bozza segue l'identità di a, non una scelta fra due digest uguali"
    );
    assert!(draft_of(&ws, "a.txt").is_none(), "il vecchio nome non resta vivo");
    assert_eq!(f.data_of("c.txt").as_deref(), Some("i dati di a.txt"));
    assert_eq!(f.data_of("d.txt").as_deref(), Some("i dati di b.txt"));
    assert!(f.data_of("a.txt").is_none() && f.data_of("b.txt").is_none());
}'''
)

s = replace_test(
    s,
    'the_doubt_sospende_also_the_collection_a_command',
    r'''#[test]
fn repair_keeps_side_data_after_two_equal_content_files_are_renamed() {
    let f = Fixture::new();
    f.write("a.txt", "stesso testo");
    f.write("b.txt", "stesso testo");
    drop(f.open());
    f.attach_data("a.txt");
    f.rename("a.txt", "c.txt");
    f.rename("b.txt", "d.txt");

    let mut ws = f.mounted();
    ws.register_plugin(
        fub_abi::traits::PluginManifest::core(
            fub_kernel::maintenance::MAINTENANCE_ID,
            "Manutenzione",
        )
        .speaking("it", fub_kernel::maintenance::catalog()),
        fub_kernel::Trust::Core,
    )
    .expect("dichiarato");
    ws.register_command_provider(
        fub_kernel::maintenance::MAINTENANCE_ID,
        Box::new(fub_kernel::maintenance::Maintenance),
    )
    .expect("registrato");
    ws.reindex().expect("reindex");
    assert_eq!(
        f.data_of("c.txt").as_deref(),
        Some("i dati di a.txt"),
        "il rejoin forte ha già spostato i dati sulla vera destinazione"
    );
    ws.invoke_command(
        "vault.repair",
        serde_json::Value::Null,
        fub_abi::command::InvokeMode::Apply,
        fub_abi::Actor::User,
    )
    .expect("riparazione");
    assert_eq!(
        f.data_of("c.txt").as_deref(),
        Some("i dati di a.txt"),
        "la manutenzione non raccoglie dati ormai associati a una nota viva"
    );
}'''
)

# Clippy: il test generato da .audit-data-integrity.py deve usare la query
# booleana diretta sulla mappa invece di get(...).is_none().
s = s.replace(
    'ws.organization().icons.get("b.txt").is_none()',
    '!ws.organization().icons.contains_key("b.txt")',
)

p.write_text(s)
