//! **Ogni comando che la shell invoca è registrato e concesso** (STR-09).
//!
//! Tauri esegue un comando soltanto se una permission referenziata da una
//! capability della finestra lo concede: comparire in `generate_handler!` non
//! basta. `read_theme` e `reveal_in_system` erano registrati e invocati, ma
//! mancavano da `allow-shell`, e la shell li vedeva sempre rifiutati senza che
//! niente diventasse rosso. Questa prova confronta tre insiemi ricavati per
//! strade indipendenti:
//!
//! 1. i comandi che il frontend nomina come primo argomento di un `invoke`;
//! 2. i comandi dentro `tauri::generate_handler!` di `src/lib.rs`;
//! 3. i comandi concessi da `allow-shell` (desktop e mobile) e `allow-mobile`
//!    (solo Android e iOS).
//!
//! Invocato ⊆ registrato = concesso, e ogni comando è concesso da una sola
//! permission: un `mobile_*` sta in `allow-mobile`, tutto il resto in
//! `allow-shell`.

use std::collections::BTreeSet;
use std::path::Path;

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// I nomi dentro `tauri::generate_handler![…]`, senza commenti né righe vuote.
fn registered() -> BTreeSet<String> {
    let lib = read(&root().join("src/lib.rs"));
    let start = lib.find("tauri::generate_handler![").expect("generate_handler! in lib.rs");
    let body = &lib[start + "tauri::generate_handler![".len()..];
    let body = &body[..body.find(']').expect("fine di generate_handler!")];
    body.lines()
        .map(|line| line.split("//").next().unwrap_or("").trim().trim_end_matches(','))
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

/// I comandi di una `[[permission]]` del manifest TOML.
fn allowed(manifest: &str, identifier: &str) -> BTreeSet<String> {
    let text = read(&root().join("permissions").join(manifest));
    let marker = format!("identifier = \"{identifier}\"");
    let at = text.find(&marker).unwrap_or_else(|| panic!("{identifier} in {manifest}"));
    let rest = &text[at..];
    let list = &rest[rest.find("commands.allow = [").expect("commands.allow") ..];
    let list = &list[..list.find(']').expect("fine di commands.allow")];
    list.lines()
        .filter_map(|line| line.trim().strip_prefix('"')?.split('"').next())
        .map(str::to_owned)
        .collect()
}

/// I letterali che seguono `invoke…(`, anche con generici e a capo:
/// `invoke<UiNode>(\n "render_view"`, `invoker.invoke<T>("mobile_pick_tree")`.
fn invoked_in(source: &str) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let bytes = source.as_bytes();
    let mut from = 0;
    while let Some(found) = source[from..].find("invoke") {
        let mut i = from + found + "invoke".len();
        from = i;
        // `invoke`, `invoker.invoke`, `mediaInvoke`: niente altro che un
        // identificatore subito dopo (`invokeCommand(` è una funzione della shell).
        if i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
            continue;
        }
        if i < bytes.len() && bytes[i] == b'<' {
            let mut depth = 0;
            while i < bytes.len() {
                match bytes[i] {
                    b'<' => depth += 1,
                    b'>' => {
                        depth -= 1;
                        if depth == 0 {
                            i += 1;
                            break;
                        }
                    }
                    b'(' | b';' => break,
                    _ => {}
                }
                i += 1;
            }
        }
        if i >= bytes.len() || bytes[i] != b'(' {
            continue;
        }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() || bytes[i] != b'"' {
            continue;
        }
        let name: String = source[i + 1..]
            .chars()
            .take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '_')
            .collect();
        if !name.is_empty() && source[i + 1 + name.len()..].starts_with('"') {
            out.insert(name);
        }
    }
    out
}

fn invoked() -> BTreeSet<String> {
    let client = root().join("../../apps/client/src");
    ["host/ipc.ts", "editors/media/transport.ts", "shells/mobile/bridge.ts"]
        .iter()
        .flat_map(|file| invoked_in(&read(&client.join(file))))
        .collect()
}

#[test]
fn every_invoked_command_is_registered_and_granted() {
    let registered = registered();
    let shell = allowed("default.toml", "allow-shell");
    let mobile = allowed("mobile.toml", "allow-mobile");
    let granted: BTreeSet<String> = shell.union(&mobile).cloned().collect();
    let invoked = invoked();

    assert!(invoked.len() > 50, "l'estrattore del frontend vede troppo poco: {invoked:?}");

    let unregistered: Vec<_> = invoked.difference(&registered).collect();
    assert!(unregistered.is_empty(), "invocati ma non registrati: {unregistered:?}");

    let denied: Vec<_> = registered.difference(&granted).collect();
    assert!(denied.is_empty(), "registrati ma negati da ogni capability: {denied:?}");

    let phantom: Vec<_> = granted.difference(&registered).collect();
    assert!(phantom.is_empty(), "concessi ma non registrati: {phantom:?}");

    let both: Vec<_> = shell.intersection(&mobile).collect();
    assert!(both.is_empty(), "concessi da due permission: {both:?}");
    for name in &shell {
        assert!(!name.starts_with("mobile_"), "{name} è mobile ma sta in allow-shell");
    }
    for name in &mobile {
        assert!(name.starts_with("mobile_"), "{name} sta in allow-mobile ma non è mobile");
    }
}

#[test]
fn the_extractor_reads_generics_and_line_breaks() {
    let sample = "invoke<UiNode>(\n  \"render_view\", {});\n\
                  invoker.invoke<Map<string, X>>(\"mobile_pick_tree\");\n\
                  mediaInvoke(\"skip_me\");\n\
                  invokeCommand(\"not_a_command\");\n\
                  invoke<T>(cmd, args);";
    let found = invoked_in(sample);
    assert_eq!(
        found,
        ["mobile_pick_tree", "render_view"].iter().map(|s| s.to_string()).collect(),
    );
}
