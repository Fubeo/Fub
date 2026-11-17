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
//! 3. i comandi che le permission di `permissions/*.toml` concedono, **seguiti
//!    fino alle capability** di `capabilities/*.json` che le usano.
//!
//! Invocato ⊆ registrato = concesso, nei due versi, e ogni comando è concesso
//! da una sola permission. Il terzo insieme non nomina nessuna permission a
//! mano: legge tutti i manifest e tutte le capability, così una permission
//! nuova, un insieme che non la include più o una capability che la perde si
//! vedono come un comando non concesso (audit del 2026-10-30, M9). Un comando
//! `mobile_*` arriva soltanto da capability di Android e iOS, ogni altro anche
//! dal desktop; una capability con `remote` non concede comandi dell'app. Il
//! manifest si legge con un lettore stretto ([`Manifests::read`]): una forma
//! TOML che non conosce è un errore, non un comando che sparisce.

use std::collections::{BTreeMap, BTreeSet};
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
    let start = lib
        .find("tauri::generate_handler![")
        .expect("generate_handler! in lib.rs");
    let body = &lib[start + "tauri::generate_handler![".len()..];
    let body = &body[..body.find(']').expect("fine di generate_handler!")];
    body.lines()
        .map(|line| {
            line.split("//")
                .next()
                .unwrap_or("")
                .trim()
                .trim_end_matches(',')
        })
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Una `[[permission]]` dell'app: i comandi che concede e quelli che nega.
#[derive(Debug, Default)]
struct Permission {
    file: String,
    allow: Vec<String>,
    deny: Vec<String>,
}

/// I manifest di `permissions/*.toml`: le permission e gli insiemi (`[default]`
/// si chiama `default`, come la chiama una capability).
#[derive(Debug, Default)]
struct Manifests {
    permissions: BTreeMap<String, Permission>,
    sets: BTreeMap<String, Vec<String>>,
}

/// Un valore di una riga `chiave = valore`: una stringa o un elenco di
/// stringhe, le sole forme che i manifest di Tauri usano qui.
#[derive(Debug)]
enum Value {
    Text(String),
    List(Vec<String>),
}

/// Una sezione del manifest: l'intestazione, la riga e le chiavi.
type Section = (String, usize, BTreeMap<String, Value>);

/// La riga senza il commento `#` che sta fuori dalle virgolette.
fn without_comment(line: &str) -> &str {
    let mut quoted = false;
    for (at, c) in line.char_indices() {
        match c {
            '"' => quoted = !quoted,
            '#' if !quoted => return &line[..at],
            _ => {}
        }
    }
    line
}

/// `"a"` → `a`; niente se non è una stringa semplice fra virgolette.
fn text(raw: &str) -> Option<String> {
    let inner = raw.trim().strip_prefix('"')?.strip_suffix('"')?;
    (!inner.contains(['"', '\\'])).then(|| inner.to_owned())
}

/// `[ "a", "b", ]` → `[a, b]`.
fn list(raw: &str) -> Option<Vec<String>> {
    let inner = raw.trim().strip_prefix('[')?.strip_suffix(']')?;
    inner
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(text)
        .collect()
}

impl Manifests {
    /// Aggiunge un manifest. Legge soltanto le sezioni `[default]`,
    /// `[[permission]]` e `[[set]]` e le chiavi che Fub usa: ogni altra forma
    /// (`scope`, `platforms`, una tabella inline) è un errore da insegnare a
    /// questo lettore prima di usarla, perché un comando che il lettore non
    /// vede passerebbe per non concesso o, peggio, per concesso.
    fn read(&mut self, file: &str, source: &str) -> Result<(), String> {
        let mut sections: Vec<Section> = Vec::new();
        let mut lines = source.lines().enumerate();
        while let Some((n, raw)) = lines.next() {
            let line = without_comment(raw).trim();
            if line.is_empty() {
                continue;
            }
            let at = format!("{file}:{}", n + 1);
            if line.starts_with('[') && !line.contains('=') {
                if !matches!(line, "[default]" | "[[permission]]" | "[[set]]") {
                    return Err(format!("{at}: sezione sconosciuta {line}"));
                }
                if line == "[default]" && sections.iter().any(|(h, ..)| h == "[default]") {
                    return Err(format!("{at}: due [default]"));
                }
                sections.push((line.to_owned(), n + 1, BTreeMap::new()));
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                return Err(format!("{at}: riga che non è chiave = valore: {line}"));
            };
            let key = key.trim().to_owned();
            let mut value = value.trim().to_owned();
            // Un elenco su più righe finisce alla prima `]`.
            if value.starts_with('[') && !value.contains(']') {
                for (_, more) in lines.by_ref() {
                    value.push(' ');
                    value.push_str(without_comment(more).trim());
                    if value.contains(']') {
                        break;
                    }
                }
            }
            let parsed = if value.starts_with('[') {
                list(&value).map(Value::List)
            } else {
                text(&value).map(Value::Text)
            }
            .ok_or_else(|| format!("{at}: valore che il test non sa leggere: {key} = {value}"))?;
            let Some((_, _, table)) = sections.last_mut() else {
                return Err(format!("{at}: {key} fuori da ogni sezione"));
            };
            if table.insert(key.clone(), parsed).is_some() {
                return Err(format!("{at}: {key} ripetuta"));
            }
        }
        for (header, line, mut table) in sections {
            let at = format!("{file}:{line}");
            let identifier = take_text(&mut table, &at, "identifier")?;
            take_text(&mut table, &at, "description")?;
            match header.as_str() {
                "[default]" => {
                    let members = take_list(&mut table, &at, "permissions")?;
                    self.add_set(&at, "default".to_owned(), members)?;
                }
                "[[set]]" => {
                    let id = identifier.ok_or_else(|| format!("{at}: [[set]] senza identifier"))?;
                    let members = take_list(&mut table, &at, "permissions")?;
                    self.add_set(&at, id, members)?;
                }
                _ => {
                    let id = identifier
                        .ok_or_else(|| format!("{at}: [[permission]] senza identifier"))?;
                    let permission = Permission {
                        file: file.to_owned(),
                        allow: take_list(&mut table, &at, "commands.allow")?,
                        deny: take_list(&mut table, &at, "commands.deny")?,
                    };
                    if self.sets.contains_key(&id) || self.permissions.contains_key(&id) {
                        return Err(format!("{at}: identifier {id} ripetuto"));
                    }
                    self.permissions.insert(id, permission);
                }
            }
            if let Some(key) = table.keys().next() {
                return Err(format!("{at}: chiave che il test non sa leggere: {key}"));
            }
        }
        Ok(())
    }

    fn add_set(&mut self, at: &str, id: String, members: Vec<String>) -> Result<(), String> {
        if self.sets.contains_key(&id) || self.permissions.contains_key(&id) {
            return Err(format!("{at}: identifier {id} ripetuto"));
        }
        self.sets.insert(id, members);
        Ok(())
    }

    /// Le permission dietro `id`, aprendo gli insiemi (anche annidati); `false`
    /// se `id`, o un nome dentro un suo insieme, non è definito.
    fn expand(&self, id: &str, seen: &mut BTreeSet<String>, out: &mut BTreeSet<String>) -> bool {
        if !seen.insert(id.to_owned()) {
            return true;
        }
        if self.permissions.contains_key(id) {
            out.insert(id.to_owned());
            return true;
        }
        let Some(members) = self.sets.get(id) else {
            return false;
        };
        members.iter().all(|member| self.expand(member, seen, out))
    }
}

/// La chiave `key` della sezione, se c'è, purché sia una stringa.
fn take_text(
    table: &mut BTreeMap<String, Value>,
    at: &str,
    key: &str,
) -> Result<Option<String>, String> {
    match table.remove(key) {
        None => Ok(None),
        Some(Value::Text(t)) => Ok(Some(t)),
        Some(Value::List(_)) => Err(format!("{at}: {key} deve essere una stringa")),
    }
}

/// La chiave `key` della sezione, vuota se manca, purché sia un elenco.
fn take_list(
    table: &mut BTreeMap<String, Value>,
    at: &str,
    key: &str,
) -> Result<Vec<String>, String> {
    match table.remove(key) {
        None => Ok(Vec::new()),
        Some(Value::List(l)) => Ok(l),
        Some(Value::Text(_)) => Err(format!("{at}: {key} deve essere un elenco")),
    }
}

/// Le piattaforme di una capability: `None` vuol dire tutte.
type Platforms = Option<BTreeSet<String>>;

/// Le capability dell'app: per ogni permission, le piattaforme delle
/// capability che la usano. Gli errori di forma vanno in `errors`.
fn reach(
    manifests: &Manifests,
    capabilities: &[(String, String)],
    errors: &mut Vec<String>,
) -> BTreeMap<String, Vec<Platforms>> {
    let mut reached: BTreeMap<String, Vec<Platforms>> = BTreeMap::new();
    for (file, source) in capabilities {
        let capability: serde_json::Value = match serde_json::from_str(source) {
            Ok(value) => value,
            Err(error) => {
                errors.push(format!("{file}: JSON illeggibile: {error}"));
                continue;
            }
        };
        let platforms: Platforms = capability.get("platforms").map(|list| {
            list.as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p.as_str().map(str::to_owned))
                .collect()
        });
        let remote = capability.get("remote").is_some();
        let refs = capability
            .get("permissions")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or_default();
        for entry in refs {
            let Some(id) = entry
                .as_str()
                .or_else(|| entry.get("identifier")?.as_str())
                .map(str::to_owned)
            else {
                errors.push(format!("{file}: permission senza identifier: {entry}"));
                continue;
            };
            // `core:…`, `dialog:…`: permission di Tauri e dei plugin, non
            // comandi dell'app.
            if id.contains(':') {
                continue;
            }
            let mut out = BTreeSet::new();
            if !manifests.expand(&id, &mut BTreeSet::new(), &mut out) {
                errors.push(format!("{file}: usa {id}, che nessun manifest definisce"));
                continue;
            }
            if remote && !out.is_empty() {
                errors.push(format!(
                    "{file}: capability con `remote` che concede comandi dell'app ({id})"
                ));
            }
            for permission in out {
                reached
                    .entry(permission)
                    .or_default()
                    .push(platforms.clone());
            }
        }
    }
    reached
}

/// Solo Android e iOS.
fn mobile_only(platforms: &Platforms) -> bool {
    platforms
        .as_ref()
        .is_some_and(|set| !set.is_empty() && set.iter().all(|p| p == "android" || p == "iOS"))
}

/// Il confronto, su testi già letti: gli errori, vuoti se tutto torna.
fn audit(
    registered: &BTreeSet<String>,
    manifests: &[(String, String)],
    capabilities: &[(String, String)],
) -> Vec<String> {
    let mut errors = Vec::new();
    let mut parsed = Manifests::default();
    for (file, source) in manifests {
        if let Err(error) = parsed.read(file, source) {
            errors.push(error);
        }
    }
    let reached = reach(&parsed, capabilities, &mut errors);

    // Chi concede ogni comando.
    let mut granted_by: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (id, permission) in &parsed.permissions {
        if !reached.contains_key(id) {
            errors.push(format!(
                "{}: la permission {id} non è usata da nessuna capability",
                permission.file
            ));
        }
        for name in permission.allow.iter().chain(&permission.deny) {
            if !registered.contains(name) {
                errors.push(format!(
                    "{}: {id} nomina {name}, che non è in generate_handler!",
                    permission.file
                ));
            }
        }
        for name in &permission.allow {
            granted_by.entry(name).or_default().push(id);
        }
    }
    for name in registered {
        let by = granted_by.get(name.as_str()).cloned().unwrap_or_default();
        let platforms: Vec<&Platforms> = by
            .iter()
            .filter_map(|id| reached.get(*id))
            .flatten()
            .collect();
        if platforms.is_empty() {
            errors.push(format!(
                "{name} è in generate_handler! ma nessuna capability lo concede"
            ));
            continue;
        }
        if by.len() > 1 {
            errors.push(format!("{name} è concesso da più permission: {by:?}"));
        }
        let mobile = name.starts_with("mobile_");
        if mobile && !platforms.iter().all(|p| mobile_only(p)) {
            errors.push(format!("{name} è mobile ma arriva anche al desktop"));
        }
        if !mobile && platforms.iter().all(|p| mobile_only(p)) {
            errors.push(format!(
                "{name} non è mobile ma arriva soltanto al telefono"
            ));
        }
    }
    errors
}

/// I file di una cartella, che devono avere tutti l'estensione `ext`: un file
/// di un'altra forma Tauri lo leggerebbe e questa prova no.
fn files(dir: &str, ext: &str) -> Vec<(String, String)> {
    let path = root().join(dir);
    let mut out: Vec<(String, String)> = std::fs::read_dir(&path)
        .unwrap_or_else(|e| panic!("{dir}: {e}"))
        .map(|entry| {
            let entry = entry.expect("voce della cartella");
            let name = entry.file_name().to_string_lossy().into_owned();
            assert!(
                name.ends_with(ext),
                "{dir}/{name}: questa prova legge soltanto i file {ext}; insegnale la forma nuova"
            );
            (format!("{dir}/{name}"), read(&entry.path()))
        })
        .collect();
    out.sort();
    out
}

fn manifests() -> Vec<(String, String)> {
    files("permissions", ".toml")
}

fn capabilities() -> Vec<(String, String)> {
    files("capabilities", ".json")
}

/// I comandi che la permission `identifier` concede.
fn allowed(identifier: &str) -> BTreeSet<String> {
    let mut parsed = Manifests::default();
    for (file, source) in manifests() {
        parsed
            .read(&file, &source)
            .unwrap_or_else(|e| panic!("{e}"));
    }
    let permission = parsed
        .permissions
        .remove(identifier)
        .unwrap_or_else(|| panic!("{identifier} non è in permissions/"));
    permission.allow.into_iter().collect()
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
    [
        "host/ipc.ts",
        "editors/media/transport.ts",
        "shells/mobile/bridge.ts",
    ]
    .iter()
    .flat_map(|file| invoked_in(&read(&client.join(file))))
    .collect()
}

#[test]
fn every_registered_command_is_granted_and_every_grant_is_registered() {
    let registered = registered();
    assert!(
        registered.len() > 50,
        "l'estrattore di generate_handler! vede troppo poco: {registered:?}"
    );
    let errors = audit(&registered, &manifests(), &capabilities());
    assert!(
        errors.is_empty(),
        "comandi, permission e capability non tornano:\n  {}",
        errors.join("\n  ")
    );
}

#[test]
fn every_invoked_command_is_registered() {
    let registered = registered();
    let invoked = invoked();
    assert!(
        invoked.len() > 50,
        "l'estrattore del frontend vede troppo poco: {invoked:?}"
    );
    let unregistered: Vec<_> = invoked.difference(&registered).collect();
    assert!(
        unregistered.is_empty(),
        "invocati ma non registrati: {unregistered:?}"
    );
}

/// La prova della prova: una forma giusta passa, e ogni guasto dà il suo
/// errore.
#[test]
fn the_audit_catches_each_broken_case() {
    let handlers =
        |names: &[&str]| -> BTreeSet<String> { names.iter().map(|n| n.to_string()).collect() };
    let pair = |file: &str, text: &str| (file.to_owned(), text.to_owned());
    let shell = "# commento\n[default]\npermissions = [\"allow-shell\"]\n\n\
                 [[permission]]\nidentifier = \"allow-shell\"\ndescription = \"x # y\"\n\
                 commands.allow = [\n  \"open_vault\",\n  \"close_vault\", # fine\n]\n";
    let mobile = "[[permission]]\nidentifier = \"allow-mobile\"\n\
                  commands.allow = [\"mobile_pick_tree\"]\n";
    let desktop = r#"{"identifier": "default", "windows": ["main"],
                      "permissions": ["default", "core:default"]}"#;
    let phone = r#"{"identifier": "mobile", "platforms": ["android", "iOS"],
                    "permissions": [{"identifier": "allow-mobile"}]}"#;
    let viewer = r#"{"identifier": "viewer", "permissions": []}"#;
    let good_manifests = [pair("default.toml", shell), pair("mobile.toml", mobile)];
    let with_desktop = |desktop: &str| {
        [
            pair("default.json", desktop),
            pair("mobile.json", phone),
            pair("viewer.json", viewer),
        ]
    };
    let with_mobile = |mobile: &str| [pair("default.toml", shell), pair("mobile.toml", mobile)];
    let all = handlers(&["open_vault", "close_vault", "mobile_pick_tree"]);
    assert_eq!(
        audit(&all, &good_manifests, &with_desktop(desktop)),
        Vec::<String>::new()
    );

    let has = |errors: &[String], needle: &str| {
        assert!(
            errors.iter().any(|e| e.contains(needle)),
            "manca l'errore «{needle}»: {errors:?}"
        );
    };
    let only = |errors: Vec<String>, needle: &str| {
        assert_eq!(errors.len(), 1, "atteso un solo errore: {errors:?}");
        has(&errors, needle);
    };

    // Un handler nuovo senza permission.
    let more = handlers(&["open_vault", "close_vault", "mobile_pick_tree", "nuovo"]);
    only(
        audit(&more, &good_manifests, &with_desktop(desktop)),
        "nuovo è in generate_handler! ma nessuna capability lo concede",
    );
    // Una permission che nomina un comando sparito.
    let fewer = handlers(&["open_vault", "mobile_pick_tree"]);
    only(
        audit(&fewer, &good_manifests, &with_desktop(desktop)),
        "allow-shell nomina close_vault, che non è in generate_handler!",
    );
    // L'insieme `default` che perde la permission: niente arriva più.
    let orphan = shell.replace("permissions = [\"allow-shell\"]", "permissions = []");
    let errors = audit(
        &all,
        &[pair("default.toml", &orphan), pair("mobile.toml", mobile)],
        &with_desktop(desktop),
    );
    has(
        &errors,
        "la permission allow-shell non è usata da nessuna capability",
    );
    has(
        &errors,
        "open_vault è in generate_handler! ma nessuna capability",
    );
    // Una capability che nomina una permission che non c'è.
    let typo = desktop.replace("[\"default\",", "[\"defualt\", \"default\",");
    only(
        audit(&all, &good_manifests, &with_desktop(&typo)),
        "usa defualt, che nessun manifest definisce",
    );
    // Un comando del telefono concesso anche al desktop.
    let leak = desktop.replace("\"core:default\"", "\"allow-mobile\"");
    only(
        audit(&all, &good_manifests, &with_desktop(&leak)),
        "mobile_pick_tree è mobile ma arriva anche al desktop",
    );
    // Lo stesso comando in due permission.
    let twice = mobile.replace(
        "\"mobile_pick_tree\"]",
        "\"mobile_pick_tree\", \"open_vault\"]",
    );
    has(
        &audit(&all, &with_mobile(&twice), &with_desktop(desktop)),
        "open_vault è concesso da più permission",
    );
    // Una capability remota con i comandi dell'app.
    let remote = desktop.replace(
        "\"windows\"",
        "\"remote\": {\"urls\": [\"https://*.example.org\"]}, \"windows\"",
    );
    only(
        audit(&all, &good_manifests, &with_desktop(&remote)),
        "capability con `remote` che concede comandi dell'app",
    );
    // Una forma TOML che il lettore non conosce non passa in silenzio.
    let scoped = format!("{mobile}scope.allow = [\"x\"]\n");
    has(
        &audit(&all, &with_mobile(&scoped), &with_desktop(desktop)),
        "chiave che il test non sa leggere: scope.allow",
    );
    let inline = "[[permission]]\nidentifier = \"allow-mobile\"\ncommands = { allow = [] }\n";
    has(
        &audit(&all, &with_mobile(inline), &with_desktop(desktop)),
        "valore che il test non sa leggere",
    );
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
        ["mobile_pick_tree", "render_view"]
            .iter()
            .map(|s| s.to_string())
            .collect(),
    );
}

/// I comandi Craft che avviano o interrogano programmi della macchina: solo
/// la shell principale del desktop. Sono registrati e concessi da
/// `allow-shell`, non da `allow-mobile` (sul telefono non si avviano app
/// Craft), e il loro corpo comincia da `guard_main_shell`, prima di ogni
/// lavoro: una finestra di documento o il visore ricevono `permission_denied`.
#[test]
fn the_craft_commands_are_for_the_main_shell_only() {
    let registered = registered();
    let shell = allowed("allow-shell");
    let mobile = allowed("allow-mobile");
    let lib = read(&root().join("src/lib.rs"));
    for name in ["external_editors", "open_with", "craft_render"] {
        assert!(registered.contains(name), "{name} non è registrato");
        assert!(shell.contains(name), "{name} non è in allow-shell");
        assert!(!mobile.contains(name), "{name} è concesso sul telefono");
        let head = format!("#[tauri::command]\nasync fn {name}(");
        let at = lib
            .find(&head)
            .unwrap_or_else(|| panic!("{name}: il comando non è in lib.rs"));
        let body = &lib[at..];
        let body = &body[body.find("{\n").expect("il corpo del comando") + 2..];
        let first = body.lines().next().unwrap_or("").trim();
        assert!(
            first.starts_with("guard_main_shell(&window,"),
            "{name} non comincia da guard_main_shell: {first}"
        );
    }
}
