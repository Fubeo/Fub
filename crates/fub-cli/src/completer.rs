//! Completamento e history: una sola lista comandi, niente duplicati.

use super::cli::command_names;

pub fn complete(prefix: &str, commands: Vec<String>) -> Vec<String> {
    let mut pool: Vec<String> = command_names().into_iter().map(str::to_string).collect();
    for extra in commands {
        if !pool.contains(&extra) {
            pool.push(extra);
        }
    }
    // Flag globali + specifici più usati: suggerimento, non grammatica.
    let flags = [
        "--vault",
        "--format",
        "--config-dir",
        "--no-watcher",
        "--standalone",
        "--limit",
        "--offset",
        "--dry-run",
        "--yes",
        "--no-input",
        "--quiet",
        "--verbose",
        "--no-color",
        "--color",
        "--revision",
        "--model",
        "--base",
        "--force",
        "--stdin",
        "--text",
        "--file",
        "--template",
        "--title",
        "--args",
        "--kind",
        "--recursive",
        "--phrase",
        "--field",
        "--tag",
        "--folder",
        "--select",
        "--property",
        "--backlinks",
        "--neighbors",
        "--resolve",
        "--list",
        "--plan",
        "--set",
        "--remove",
        "--key",
        "--toggle",
        "--from",
        "--name",
        "--daily",
        "--date",
        "--instance",
        "--params",
        "--action",
        "--payload",
        "--enable",
        "--disable",
        "--light",
        "--startup",
        "--session",
        "--jobs",
        "--health",
        "--status",
        "--json",
        "--text-file",
        "--source-url",
        "--note",
        "--mode",
        "--prop",
        "--execute",
        "--password-file",
        "--code-file",
        "--enroll",
        "--get",
        "--reset",
        "--site",
        "--version",
        "--to-version",
        "--extension-id",
        "--interval",
    ];
    for flag in flags {
        pool.push(flag.to_string());
    }
    let mut out: Vec<String> = pool.into_iter().filter(|c| c.starts_with(prefix)).collect();
    out.sort();
    out.dedup();
    out
}

pub fn completion_script(shell: &str) -> Result<String, super::commands::Failure> {
    let commands = command_names().join(" ");
    let global = "--vault --format --config-dir --no-watcher --standalone --limit --offset --dry-run --yes --no-input --quiet --verbose --no-color --color";
    match shell.trim().to_ascii_lowercase().as_str() {
        "bash" => Ok(format!("# fub-cli bash completion\n_fub_cli() {{\n  local cur\n  COMPREPLY=()\n  cur=\"$COMP_CUR\"\n  COMPREPLY=( $(compgen -W \"{commands} {global}\" -- \"$cur\") )\n}}\ncomplete -F _fub_cli fub-cli\n")),
        "zsh" => Ok(format!("#compdef fub-cli\n_fub_cli() {{\n  local -a cmds\n  cmds=({commands})\n  _describe 'fub-cli' cmds\n}}\ncompdef _fub_cli fub-cli\n")),
        "fish" => Ok(format!("# fub-cli fish completion\nset -l cmds {commands}\ncomplete -c fub-cli -f -a \"$cmds\"\n")),
        other => Err(super::commands::Failure::new(2, "bad_args", format!("shell sconosciuta `{other}` (bash|zsh|fish)"))),
    }
}

pub fn safe_history_line(line: &str) -> bool {
    matches!(
        line.trim(),
        "help"
            | "vault list"
            | "vault current"
            | "vault known"
            | "diagnostics --status"
            | "pair pairs"
    ) || line.trim().starts_with("help ")
        && line.split_whitespace().count() == 2
        && super::cli::command_names().contains(&line.split_whitespace().nth(1).unwrap_or(""))
}

pub fn load_history(path: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .map(|text| {
            text.lines()
                .filter(|l| safe_history_line(l))
                .map(str::to_string)
                .take(1000)
                .collect()
        })
        .unwrap_or_default()
}

pub fn save_history(path: &std::path::Path, history: &[String]) {
    let start = history.len().saturating_sub(1000);
    let text = history[start..].join("\n");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let path = path.to_path_buf();
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
    };
    #[cfg(not(unix))]
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&path);
    if let Ok(mut file) = file {
        use std::io::Write;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
        let _ = writeln!(file, "{text}");
    }
}
