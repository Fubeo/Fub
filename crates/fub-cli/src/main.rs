//! `fub-cli`: automazione locale P13 sopra `Host`, senza Tauri.
//!
//! Riusa `fub_host::automation` per capture e native messaging. Sync e
//! publish eseguono i job montati dall'Host sulla sua root trusted: la CLI
//! non ricrea il coordinatore né proietta HTML per conto proprio.
//!
//! Exit code: 0 ok, 1 errore locale, 2 uso/config, 3 trasporto,
//! 4 auth/protocol/credenziali, 5 conflitto/pausa/coda/busy.

mod capture;
mod cli;
mod commands;
mod completer;
mod local;
mod login;
mod output;
mod remote;

use std::io::IsTerminal;
use std::sync::atomic::{AtomicBool, Ordering};
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn on_sigint(_: i32) {
    INTERRUPTED.store(true, Ordering::SeqCst);
}

fn install_sigint() {
    #[cfg(unix)]
    unsafe {
        unsafe extern "C" {
            fn signal(sig: i32, handler: extern "C" fn(i32)) -> usize;
        }
        signal(2, on_sigint);
    }
}

pub(crate) fn interrupted() -> bool {
    INTERRUPTED.load(Ordering::SeqCst)
}

pub(crate) fn pause_or_interrupt(duration: std::time::Duration) -> Result<(), commands::Failure> {
    let until = std::time::Instant::now() + duration;
    while !interrupted() {
        let remaining = until.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Ok(());
        }
        std::thread::sleep(remaining.min(std::time::Duration::from_millis(100)));
    }
    Err(commands::Failure::new(
        130,
        "cancelled",
        "interrotto da SIGINT",
    ))
}

use cli::{parse_cli, CliCommand, GlobalArgs, SyncAction, SyncArgs};
use commands::Connection;
use output::{envelope_err, envelope_ok, OutputFormat};

fn main() {
    install_sigint();
    let code = run(std::env::args().skip(1).collect());
    std::process::exit(code);
}

fn run(raw: Vec<String>) -> i32 {
    let parsed = parse_cli(&raw);
    let command = match parsed {
        Ok(command) => command,
        Err(message) => {
            let mut format: Option<&str> = None;
            for (index, token) in raw.iter().enumerate() {
                if let Some(value) = token.strip_prefix("--format=") {
                    format = Some(value);
                } else if token == "--format" {
                    format = raw.get(index + 1).map(String::as_str);
                }
            }
            let format = OutputFormat::parse(format);
            eprint_envelope(&GlobalArgs::default(), &format, 2, "bad_args", &message);
            return 2;
        }
    };
    if let CliCommand::Help { global, topic } = &command {
        let format = OutputFormat::parse(global.format.as_deref());
        if let Err(message) = check_global_coherence(global) {
            eprint_envelope(global, &format, 2, "bad_args", &message);
            return 2;
        }
        let text = cli::help_text(topic.as_deref());
        if format.is_human() {
            println!("{text}");
        } else {
            print_value(
                global,
                &format,
                &envelope_ok(serde_json::json!({ "help": text })),
            );
        }
        return 0;
    }
    let global = command.global();
    let format = OutputFormat::parse(global.format.as_deref());
    if let Err(message) = check_global_coherence(&global) {
        eprint_envelope(&global, &format, 2, "bad_args", &message);
        return 2;
    }
    let want_watcher = matches!(
        &command,
        CliCommand::Sync(SyncArgs {
            action: SyncAction::Watch { .. },
            ..
        }) | CliCommand::Publish(cli::PublishArgs {
            action: cli::PublishAction::Watch { .. },
            ..
        }) | CliCommand::Repl { .. }
    );
    let connection = if want_watcher {
        Connection::watch(&global)
    } else if matches!(
        &command,
        CliCommand::Callback { .. }
            | CliCommand::Pair { .. }
            | CliCommand::NativeInstall { .. }
            | CliCommand::Completion { .. }
            | CliCommand::Login(_)
            | CliCommand::Mfa(_)
            | CliCommand::Uri { execute: false, .. }
            | CliCommand::Vault {
                action: cli::VaultAction::List | cli::VaultAction::Known,
                ..
            }
    ) {
        Connection::unmounted(&global)
    } else {
        Connection::open(&global)
    };
    let mut connection = match connection {
        Ok(connection) => connection,
        Err(failure) => {
            eprint_envelope(
                &global,
                &format,
                failure.code,
                failure.kind,
                &failure.message,
            );
            return failure.code;
        }
    };
    let result = dispatch(&mut connection, &global, &format, command);
    if interrupted() {
        eprint_envelope(&global, &format, 130, "cancelled", "interrotto da SIGINT");
        return 130;
    }
    match result {
        Ok(()) => 0,
        Err(failure) => {
            eprint_envelope(
                &global,
                &format,
                failure.code,
                failure.kind,
                &failure.message,
            );
            failure.code
        }
    }
}

fn check_global_coherence(global: &GlobalArgs) -> Result<(), String> {
    if global.format.as_deref().is_some_and(|raw| {
        !matches!(
            raw,
            "json" | "jsonl" | "ndjson" | "tsv" | "csv" | "md" | "markdown" | "text"
        )
    }) {
        return Err("--format vuole json|jsonl|tsv|csv|md|text".to_string());
    }
    if global.no_color && global.color {
        return Err("--no-color e --color non si usano insieme".to_string());
    }
    if global.quiet && global.verbose {
        return Err("--quiet e --verbose non si usano insieme".to_string());
    }
    if global.no_input && global.yes {
        return Err("--no-input e --yes non si usano insieme".to_string());
    }
    Ok(())
}

fn eprint_envelope(
    global: &GlobalArgs,
    format: &OutputFormat,
    code: i32,
    kind: &str,
    message: &str,
) {
    let value = envelope_err(kind, message, code);
    eprint_value(global, format, &value);
}

pub(crate) fn print_value(global: &GlobalArgs, format: &OutputFormat, value: &serde_json::Value) {
    if global.quiet && format.is_human() {
        return;
    }
    let text = output::render(format, value, !global.no_color && color_enabled(global));
    println!("{text}");
}

fn eprint_value(global: &GlobalArgs, format: &OutputFormat, value: &serde_json::Value) {
    if global.quiet && format.is_human() {
        return;
    }
    let text = output::render(format, value, !global.no_color && color_enabled(global));
    eprintln!("{text}");
}

fn color_enabled(global: &GlobalArgs) -> bool {
    if global.color {
        return true;
    }
    if global.no_color {
        return false;
    }
    if std::env::var("NO_COLOR").is_ok_and(|v| !v.is_empty()) {
        return false;
    }
    std::io::stdout().is_terminal()
}

fn dispatch(
    connection: &mut Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    command: CliCommand,
) -> Result<(), commands::Failure> {
    match command {
        CliCommand::Help { .. } => unreachable!("help gestito in run"),
        CliCommand::Repl { .. } => {
            let code = repl_loop(connection, global, format)?;
            if code != 0 {
                return Err(commands::Failure::new(code, "local", "repl fallita"));
            }
            Ok(())
        }
        CliCommand::Completion { shell, .. } => {
            let text = completer::completion_script(&shell)?;
            if format.is_json() {
                print_value(
                    global,
                    format,
                    &envelope_ok(serde_json::json!({ "shell": shell, "script": text })),
                );
            } else {
                println!("{text}");
            }
            Ok(())
        }
        CliCommand::Vault { action, .. } => local::vault(
            connection,
            global,
            format,
            action,
            print_line(global, format),
        ),
        CliCommand::Read(args) => {
            local::read(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Write(args) => {
            local::write(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Create(args) => {
            local::create(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Edit(args) => {
            local::edit(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Files(args) => {
            local::files(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Query(args) => {
            local::query(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Search(args) => {
            local::search(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Command(args) => {
            local::registry_command(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Properties(args) => {
            local::properties(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Tasks(args) => {
            local::tasks(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Templates(args) => {
            local::templates(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Views(args) => {
            local::views(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Plugin(args) => {
            local::plugin(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Theme(args) => {
            local::theme(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Diagnostics(args) => {
            local::diagnostics(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Capture(args) => capture::capture(connection, global, format, args),
        CliCommand::Uri { uri, execute, .. } => {
            capture::uri(connection, global, format, uri, execute)
        }
        CliCommand::Callback { action, .. } => capture::callback_command(global, format, action),
        CliCommand::Login(args) => {
            login::login(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Mfa(args) => login::mfa_cmd(
            global,
            args.code_file,
            args.enroll,
            print_line(global, format),
        ),
        CliCommand::Config(args) => {
            login::config(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Sync(args) => {
            remote::sync_cmd(connection, global, format, args, print_line(global, format))
        }
        CliCommand::Publish(args) => {
            remote::publish_cmd(connection, global, format, args, print_line(global, format))
        }
        CliCommand::NativeInstall { extension_id, .. } => {
            local::native_install(global, format, extension_id, print_line(global, format))
        }
        CliCommand::Pair { action, .. } => {
            local::pairing(global, format, action, print_line(global, format))
        }
    }
}

fn print_line<'a>(
    global: &'a GlobalArgs,
    format: &'a OutputFormat,
) -> impl Fn(&serde_json::Value) + 'a {
    move |value| print_value(global, format, value)
}

/// REPL interattiva: history su file, completamento sui comandi reali,
/// nessuna password mai chiesta qui (il login usa file/stdin).
fn repl_loop(
    connection: &mut Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
) -> Result<i32, commands::Failure> {
    use std::io::{BufRead, Write};
    let history_path = repl_history_path();
    let mut history: Vec<String> = completer::load_history(&history_path);
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    if !global.quiet {
        println!(
            "fub-cli interattiva. `help`, `exit` per uscire. Vault: {}",
            connection.describe()
        );
    }
    loop {
        if interrupted() {
            break;
        }
        print!("fub> ");
        let _ = std::io::stdout().flush();
        let line = match lines.next() {
            None => break,
            Some(Err(_)) => break,
            Some(Ok(line)) => line,
        };
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if matches!(line, "exit" | "quit" | ":q") {
            break;
        }
        if line == "help" || line.starts_with("help ") {
            let topic = line
                .strip_prefix("help ")
                .map(str::trim)
                .filter(|s| !s.is_empty());
            println!("{}", cli::help_text(topic));
            continue;
        }
        if line == "history" {
            for entry in &history {
                println!("{entry}");
            }
            continue;
        }
        if let Some(prefix) = line.strip_prefix("!") {
            let matches: Vec<&String> = history.iter().filter(|h| h.starts_with(prefix)).collect();
            match matches.as_slice() {
                [] => eprintln!("nessun history per `{prefix}`"),
                [one] => {
                    println!("{one}");
                    history.push((*one).clone());
                }
                many => {
                    for entry in many {
                        println!("{entry}");
                    }
                }
            }
            continue;
        }
        // Completamentoabilito: prefisso TAB simulato via `complete <prefisso>`.
        if let Some(prefix) = line.strip_prefix("complete ") {
            for candidate in completer::complete(prefix.trim(), connection.command_names()) {
                println!("{candidate}");
            }
            continue;
        }
        if completer::safe_history_line(line) {
            history.push(line.to_string());
        }
        let argv = match shell_split(line) {
            Ok(argv) => argv,
            Err(message) => {
                eprintln!("repl: {message}");
                continue;
            }
        };
        if argv.is_empty() {
            continue;
        }
        // Il REPL riusa parser+dispatch: una sola grammatica, non due.
        let sub = match parse_cli(&argv) {
            Ok(command) => command,
            Err(message) => {
                eprintln!("repl: {message}");
                continue;
            }
        };
        if sub
            .global()
            .vault
            .as_ref()
            .is_some_and(|v| Some(v) != global.vault.as_ref())
        {
            eprintln!("repl: il vault non cambia per riga");
            continue;
        }
        if matches!(sub, CliCommand::Repl { .. }) {
            eprintln!("repl: repl annidata non permessa");
            continue;
        }
        // Il REPL non cambia formato/vault rispetto all'avvio: coerenza di sessione.
        let merged = merge_repl_global(global, sub);
        let code = match dispatch_repl(connection, global, format, merged) {
            Ok(()) => 0,
            Err(failure) => {
                eprint_envelope(global, format, failure.code, failure.kind, &failure.message);
                failure.code
            }
        };
        let _ = code;
    }
    completer::save_history(&history_path, &history);
    Ok(if interrupted() { 130 } else { 0 })
}

fn dispatch_repl(
    connection: &mut Connection,
    global: &GlobalArgs,
    format: &OutputFormat,
    command: CliCommand,
) -> Result<(), commands::Failure> {
    // Vietati in REPL: repl annidata, formati diversi, vault diversi.
    if matches!(command, CliCommand::Repl { .. }) {
        return Err(commands::Failure::new(2, "bad_args", "repl annidata"));
    }
    if command.global().vault != global.vault {
        return Err(commands::Failure::new(
            2,
            "bad_args",
            "il repl non cambia vault: riavvia con --vault",
        ));
    }
    dispatch(connection, global, format, command)
}

fn merge_repl_global(base: &GlobalArgs, command: CliCommand) -> CliCommand {
    // Il comando del REPL eredita formato/quiet/verbose/colore dall'avvio:
    // una sola sessione, non una per riga.
    let global = base.clone();
    command.with_global(global)
}

fn repl_history_path() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("FUB_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return std::path::PathBuf::from(dir).join("cli-history");
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.trim().is_empty() {
            return std::path::PathBuf::from(home)
                .join(".config")
                .join("fub")
                .join("cli-history");
        }
    }
    std::env::temp_dir().join("fub-cli-history")
}

/// Split minimale con virgolette: il REPL non reinventa una shell.
fn shell_split(line: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut in_word = false;
    for ch in line.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            in_word = true;
            continue;
        }
        if ch == '\\' && quote != Some('\'') {
            escaped = true;
            in_word = true;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                current.push(ch);
            }
            in_word = true;
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            in_word = true;
            continue;
        }
        if ch.is_whitespace() {
            if in_word {
                out.push(std::mem::take(&mut current));
                in_word = false;
            }
            continue;
        }
        current.push(ch);
        in_word = true;
    }
    if escaped {
        return Err("escape finale senza carattere".to_string());
    }
    if quote.is_some() {
        return Err("virgolette non chiuse".to_string());
    }
    if in_word {
        out.push(current);
    }
    Ok(out)
}
