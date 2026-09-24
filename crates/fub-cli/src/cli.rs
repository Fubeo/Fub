//! Grammatica CLI: un solo parser per argv, REPL e smoke.
//!
//! Niente derive clap: il workspace non ha quella dipendenza nei crate
//! spediti e Main vieta nuove dipendenze non concordate. La grammatica resta
//! dichiarata qui in un posto solo: `COMMANDS` alimenta help, completamento
//! e REPL senza duplicati.

#[derive(Clone, Debug, Default)]
pub struct GlobalArgs {
    pub vault: Option<String>,
    pub format: Option<String>,
    pub config_dir: Option<String>,
    pub standalone: bool,
    pub no_watcher: bool,
    pub quiet: bool,
    pub verbose: bool,
    pub no_color: bool,
    pub color: bool,
    pub yes: bool,
    pub no_input: bool,
    pub dry_run: bool,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Clone, Debug)]
pub enum CliCommand {
    Help {
        global: GlobalArgs,
        topic: Option<String>,
    },
    Repl {
        global: GlobalArgs,
    },
    Completion {
        global: GlobalArgs,
        shell: String,
    },
    Vault {
        global: GlobalArgs,
        action: VaultAction,
    },
    Read(ReadArgs),
    Write(WriteArgs),
    Create(CreateArgs),
    Edit(EditArgs),
    Files(FilesArgs),
    Query(QueryArgs),
    Search(SearchArgs),
    Command(CommandArgs),
    Properties(PropertiesArgs),
    Tasks(TasksArgs),
    Templates(TemplatesArgs),
    Views(ViewsArgs),
    Plugin(PluginArgs),
    Theme(ThemeArgs),
    Diagnostics(DiagnosticsArgs),
    Capture(CaptureArgs),
    Uri {
        global: GlobalArgs,
        uri: String,
        execute: bool,
    },
    Callback {
        global: GlobalArgs,
        action: CallbackAction,
    },
    Login(LoginArgs),
    Mfa(MfaArgs),
    Config(ConfigArgs),
    Sync(SyncArgs),
    Publish(PublishArgs),
    NativeInstall {
        global: GlobalArgs,
        extension_id: String,
    },
    Pair {
        global: GlobalArgs,
        action: PairAction,
    },
}

#[derive(Clone, Debug)]
pub enum CallbackAction {
    List,
    Allow(String),
    Revoke(String),
}

#[derive(Clone, Debug)]
pub enum VaultAction {
    Open { path: Option<String> },
    List,
    Current,
    Use { path: String },
    Close { path: String },
    Known,
}

#[derive(Clone, Debug)]
pub struct ReadArgs {
    pub global: GlobalArgs,
    pub doc: String,
    pub revision: bool,
    pub model: bool,
}

#[derive(Clone, Debug)]
pub struct WriteArgs {
    pub global: GlobalArgs,
    pub doc: String,
    pub base: Option<String>,
    pub force: bool,
    pub stdin: bool,
    pub text: Option<String>,
    pub file: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CreateArgs {
    pub global: GlobalArgs,
    pub name: Option<String>,
    pub stdin: bool,
    pub text: Option<String>,
    pub file: Option<String>,
    pub template: Option<String>,
    pub title: Option<String>,
}

#[derive(Clone, Debug)]
pub struct EditArgs {
    pub global: GlobalArgs,
    pub command: String,
    pub args_json: String,
}

#[derive(Clone, Debug)]
pub struct FilesArgs {
    pub global: GlobalArgs,
    pub folder: Option<String>,
    pub kind: Option<String>,
    pub recursive: bool,
}

#[derive(Clone, Debug)]
pub struct QueryArgs {
    pub global: GlobalArgs,
    pub query_json: Option<String>,
    pub text: Option<String>,
    pub tag: Option<String>,
    pub folder: Option<String>,
    pub property: Vec<String>,
    pub backlinks: Option<String>,
    pub neighbors: Option<String>,
    pub resolve: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SearchArgs {
    pub global: GlobalArgs,
    pub query: String,
    pub field: Vec<String>,
    pub phrase: bool,
    pub tag: Option<String>,
    pub folder: Option<String>,
    pub select: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct CommandArgs {
    pub global: GlobalArgs,
    pub list: bool,
    pub name: Option<String>,
    pub args_json: Option<String>,
    pub show_plan: bool,
}

#[derive(Clone, Debug)]
pub struct PropertiesArgs {
    pub global: GlobalArgs,
    pub doc: Option<String>,
    pub list: bool,
    pub set: Vec<String>,
    pub remove: Vec<String>,
    pub key: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TasksArgs {
    pub global: GlobalArgs,
    pub doc: String,
    pub list: bool,
    pub toggle_at: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct TemplatesArgs {
    pub global: GlobalArgs,
    pub list: bool,
    pub from: Option<String>,
    pub name: Option<String>,
    pub daily: bool,
    pub date: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ViewsArgs {
    pub global: GlobalArgs,
    pub list: bool,
    pub render: Option<String>,
    pub instance: Option<String>,
    pub params_json: Option<String>,
    pub action: Option<String>,
    pub payload_json: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PluginArgs {
    pub global: GlobalArgs,
    pub list: bool,
    pub enable: Option<String>,
    pub disable: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ThemeArgs {
    pub global: GlobalArgs,
    pub list: bool,
    pub show: Option<String>,
    pub light: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DiagnosticsArgs {
    pub global: GlobalArgs,
    pub startup: bool,
    pub session: bool,
    pub jobs: bool,
    pub health: Option<String>,
    pub status: bool,
}

#[derive(Clone, Debug)]
pub struct CaptureArgs {
    pub global: GlobalArgs,
    pub file: Option<String>,
    pub payload_json: Option<String>,
    pub title: Option<String>,
    pub text: Option<String>,
    pub text_file: Option<String>,
    pub source_url: Option<String>,
    pub folder: Option<String>,
    pub note: Option<String>,
    pub mode: Option<String>,
    pub vault: Option<String>,
    pub prop: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct LoginArgs {
    pub global: GlobalArgs,
    pub user: Option<String>,
    pub password_file: Option<String>,
    pub code_file: Option<String>,
    pub enroll: bool,
}
#[derive(Clone, Debug)]
pub struct MfaArgs {
    pub global: GlobalArgs,
    pub code_file: Option<String>,
    pub enroll: bool,
}
#[derive(Clone, Debug)]
pub struct ConfigArgs {
    pub global: GlobalArgs,
    pub list: bool,
    pub get: Option<String>,
    pub set: Vec<String>,
    pub reset: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SyncArgs {
    pub global: GlobalArgs,
    pub action: SyncAction,
}

#[derive(Clone, Debug)]
pub enum SyncAction {
    Status,
    Once,
    Watch { interval_secs: u64 },
}

#[derive(Clone, Debug)]
pub struct PublishArgs {
    pub global: GlobalArgs,
    pub action: PublishAction,
}

#[derive(Clone, Debug)]
pub enum PublishAction {
    Status {
        site: String,
    },
    DryRun {
        site: String,
    },
    Commit {
        site: String,
        version: Option<u64>,
    },
    Watch {
        site: String,
        interval_secs: u64,
    },
    Unpublish {
        site: String,
    },
    Rollback {
        site: String,
        to_version: Option<u64>,
    },
}

#[derive(Clone, Debug)]
pub enum PairAction {
    Add {
        extension_id: String,
        vault: Option<String>,
        folder: Option<String>,
    },
    List,
    Remove {
        extension_id: String,
    },
}

impl CliCommand {
    pub fn global(&self) -> GlobalArgs {
        match self {
            CliCommand::Help { global, .. }
            | CliCommand::Repl { global }
            | CliCommand::Completion { global, .. }
            | CliCommand::Vault { global, .. }
            | CliCommand::Uri { global, .. }
            | CliCommand::Callback { global, .. }
            | CliCommand::NativeInstall { global, .. }
            | CliCommand::Pair { global, .. } => global.clone(),
            CliCommand::Read(a) => a.global.clone(),
            CliCommand::Write(a) => a.global.clone(),
            CliCommand::Create(a) => a.global.clone(),
            CliCommand::Edit(a) => a.global.clone(),
            CliCommand::Files(a) => a.global.clone(),
            CliCommand::Query(a) => a.global.clone(),
            CliCommand::Search(a) => a.global.clone(),
            CliCommand::Command(a) => a.global.clone(),
            CliCommand::Properties(a) => a.global.clone(),
            CliCommand::Tasks(a) => a.global.clone(),
            CliCommand::Templates(a) => a.global.clone(),
            CliCommand::Views(a) => a.global.clone(),
            CliCommand::Plugin(a) => a.global.clone(),
            CliCommand::Theme(a) => a.global.clone(),
            CliCommand::Diagnostics(a) => a.global.clone(),
            CliCommand::Capture(a) => a.global.clone(),
            CliCommand::Login(a) => a.global.clone(),
            CliCommand::Mfa(a) => a.global.clone(),
            CliCommand::Config(a) => a.global.clone(),
            CliCommand::Sync(a) => a.global.clone(),
            CliCommand::Publish(a) => a.global.clone(),
        }
    }
    pub fn with_global(self, global: GlobalArgs) -> CliCommand {
        match self {
            CliCommand::Repl { .. } => CliCommand::Repl { global },
            CliCommand::Completion { shell, .. } => CliCommand::Completion { shell, global },
            CliCommand::Help { topic, .. } => CliCommand::Help { topic, global },
            CliCommand::Vault { action, .. } => CliCommand::Vault { action, global },
            CliCommand::Uri { uri, execute, .. } => CliCommand::Uri {
                uri,
                execute,
                global,
            },
            CliCommand::NativeInstall { extension_id, .. } => CliCommand::NativeInstall {
                extension_id,
                global,
            },
            CliCommand::Callback { action, .. } => CliCommand::Callback { action, global },
            CliCommand::Pair { action, .. } => CliCommand::Pair { action, global },
            CliCommand::Read(mut a) => {
                a.global = global;
                CliCommand::Read(a)
            }
            CliCommand::Write(mut a) => {
                a.global = global;
                CliCommand::Write(a)
            }
            CliCommand::Create(mut a) => {
                a.global = global;
                CliCommand::Create(a)
            }
            CliCommand::Edit(mut a) => {
                a.global = global;
                CliCommand::Edit(a)
            }
            CliCommand::Files(mut a) => {
                a.global = global;
                CliCommand::Files(a)
            }
            CliCommand::Query(mut a) => {
                a.global = global;
                CliCommand::Query(a)
            }
            CliCommand::Search(mut a) => {
                a.global = global;
                CliCommand::Search(a)
            }
            CliCommand::Command(mut a) => {
                a.global = global;
                CliCommand::Command(a)
            }
            CliCommand::Properties(mut a) => {
                a.global = global;
                CliCommand::Properties(a)
            }
            CliCommand::Tasks(mut a) => {
                a.global = global;
                CliCommand::Tasks(a)
            }
            CliCommand::Templates(mut a) => {
                a.global = global;
                CliCommand::Templates(a)
            }
            CliCommand::Views(mut a) => {
                a.global = global;
                CliCommand::Views(a)
            }
            CliCommand::Plugin(mut a) => {
                a.global = global;
                CliCommand::Plugin(a)
            }
            CliCommand::Theme(mut a) => {
                a.global = global;
                CliCommand::Theme(a)
            }
            CliCommand::Diagnostics(mut a) => {
                a.global = global;
                CliCommand::Diagnostics(a)
            }
            CliCommand::Login(mut a) => {
                a.global = global;
                CliCommand::Login(a)
            }
            CliCommand::Mfa(mut a) => {
                a.global = global;
                CliCommand::Mfa(a)
            }
            CliCommand::Config(mut a) => {
                a.global = global;
                CliCommand::Config(a)
            }
            CliCommand::Sync(mut a) => {
                a.global = global;
                CliCommand::Sync(a)
            }
            CliCommand::Publish(mut a) => {
                a.global = global;
                CliCommand::Publish(a)
            }
            other => other,
        }
    }
}

struct Parser<'a> {
    argv: &'a [String],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(argv: &'a [String]) -> Self {
        Parser { argv, pos: 0 }
    }
    fn peek(&self) -> Option<&'a str> {
        self.argv.get(self.pos).map(|s| s.as_str())
    }
    fn next(&mut self) -> Option<&'a str> {
        let value = self.argv.get(self.pos).map(|s| s.as_str());
        if value.is_some() {
            self.pos += 1;
        }
        value
    }
    fn expect_value(&mut self, flag: &str) -> Result<String, String> {
        self.next()
            .map(str::to_string)
            .ok_or_else(|| format!("{flag} vuole un valore"))
    }
}

fn split_flag(arg: &str) -> Option<(&str, Option<&str>)> {
    if !arg.starts_with('-') || arg == "-" || arg == "--" {
        return None;
    }
    if let Some(body) = arg.strip_prefix("--") {
        if let Some((k, v)) = body.split_once('=') {
            return Some((k, Some(v)));
        }
        return Some((body, None));
    }
    // Short: `-f json` o `-f=json`; i cluster non si espandono.
    let body = arg.strip_prefix('-').unwrap_or("");
    if let Some((k, v)) = body.split_once('=') {
        return Some((k, Some(v)));
    }
    Some((body, None))
}

fn parse_global(parser: &mut Parser, global: &mut GlobalArgs) -> Result<(), String> {
    while let Some(arg) = parser.peek() {
        let Some((name, inline)) = split_flag(arg) else {
            break;
        };
        let value_of =
            |parser: &mut Parser, flag: &str, inline: Option<&str>| -> Result<String, String> {
                if let Some(v) = inline {
                    return Ok(v.to_string());
                }
                parser.next();
                parser.expect_value(flag)
            };
        match name {
            "vault" | "v" => {
                let v = value_of(parser, "--vault", inline)?;
                if v.trim().is_empty() {
                    return Err("--vault vuoto".to_string());
                }
                global.vault = Some(v);
                if inline.is_some() {
                    parser.next();
                }
            }
            "format" | "f" => {
                let v = value_of(parser, "--format", inline)?;
                global.format = Some(v);
                if inline.is_some() {
                    parser.next();
                }
            }
            "config-dir" => {
                let v = value_of(parser, "--config-dir", inline)?;
                global.config_dir = Some(v);
                if inline.is_some() {
                    parser.next();
                }
            }
            "no-watcher" => {
                if inline.is_some() {
                    return Err("--no-watcher non prende valori".to_string());
                }
                global.no_watcher = true;
                parser.next();
            }
            "standalone" => {
                if inline.is_some() {
                    return Err("--standalone non prende valori".to_string());
                }
                global.standalone = true;
                parser.next();
            }
            "quiet" | "q" => {
                if inline.is_some() {
                    return Err("--quiet non prende valori".to_string());
                }
                global.quiet = true;
                parser.next();
            }
            "verbose" => {
                if inline.is_some() {
                    return Err("--verbose non prende valori".to_string());
                }
                global.verbose = true;
                parser.next();
            }
            "no-color" => {
                if inline.is_some() {
                    return Err("--no-color non prende valori".to_string());
                }
                global.no_color = true;
                parser.next();
            }
            "color" => {
                if inline.is_some() {
                    return Err("--color non prende valori".to_string());
                }
                global.color = true;
                parser.next();
            }
            "yes" | "y" => {
                if inline.is_some() {
                    return Err("--yes non prende valori".to_string());
                }
                global.yes = true;
                parser.next();
            }
            "no-input" => {
                if inline.is_some() {
                    return Err("--no-input non prende valori".to_string());
                }
                global.no_input = true;
                parser.next();
            }
            "dry-run" | "n" => {
                if inline.is_some() {
                    return Err("--dry-run non prende valori".to_string());
                }
                global.dry_run = true;
                parser.next();
            }
            "limit" => {
                let v = value_of(parser, "--limit", inline)?;
                global.limit = Some(
                    v.parse()
                        .map_err(|_| "--limit vuole un intero >= 0".to_string())?,
                );
                if inline.is_some() {
                    parser.next();
                }
            }
            "offset" => {
                let v = value_of(parser, "--offset", inline)?;
                global.offset = Some(
                    v.parse()
                        .map_err(|_| "--offset vuole un intero >= 0".to_string())?,
                );
                if inline.is_some() {
                    parser.next();
                }
            }
            "help" | "h" => break,
            _ => break,
        }
    }
    Ok(())
}

/// Il solo punto che trasforma argv in comandi. La REPL chiama questa con lo
/// split della riga: una grammatica, non due.
pub fn parse_cli(argv: &[String]) -> Result<CliCommand, String> {
    let mut parser = Parser::new(argv);
    let mut global = GlobalArgs::default();
    parse_global(&mut parser, &mut global)?;
    let head = parser.next().ok_or_else(|| "comando assente".to_string())?;
    if head == "help" || head == "--help" || head == "-h" {
        let topic = parser.next().map(str::to_string);
        if parser.peek().is_some() {
            return Err("help prende al più un argomento".to_string());
        }
        return Ok(CliCommand::Help { global, topic });
    }
    // Flag globali anche dopo il comando: `fub-cli read x --vault v`.
    let tail_command = parse_command(head, &mut parser, global.clone())?;
    let mut merged_global = tail_command.global().clone();
    parse_global(&mut parser, &mut merged_global)?;
    if parser.peek().is_some() {
        return Err(format!(
            "argomento non atteso `{}`",
            parser.peek().unwrap_or("?")
        ));
    }
    Ok(tail_command.with_global(merged_global))
}

fn parse_command(
    head: &str,
    parser: &mut Parser,
    global: GlobalArgs,
) -> Result<CliCommand, String> {
    match head {
        "repl" | "interactive" | "shell" => {
            if parser.peek().is_some() {
                return Err("repl non prende argomenti".to_string());
            }
            Ok(CliCommand::Repl { global })
        }
        "completion" => {
            let shell = parser
                .next()
                .ok_or_else(|| "completion vuole una shell (bash|zsh|fish)".to_string())?;
            if parser.peek().is_some() {
                return Err("completion prende una sola shell".to_string());
            }
            Ok(CliCommand::Completion {
                shell: shell.to_string(),
                global,
            })
        }
        "vault" => parse_vault(parser, global),
        "read" => {
            let doc = parser
                .next()
                .ok_or_else(|| "read vuole un documento".to_string())?
                .to_string();
            let mut args = ReadArgs {
                global,
                doc,
                revision: false,
                model: false,
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "revision" => {
                        if inline.is_some() {
                            return Err("--revision non prende valori".to_string());
                        }
                        args.revision = true;
                        parser.next();
                    }
                    "model" => {
                        if inline.is_some() {
                            return Err("--model non prende valori".to_string());
                        }
                        args.model = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Read(args))
        }
        "write" => {
            let doc = parser
                .next()
                .ok_or_else(|| "write vuole un documento".to_string())?
                .to_string();
            let mut args = WriteArgs {
                global,
                doc,
                base: None,
                force: false,
                stdin: false,
                text: None,
                file: None,
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "base" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--base vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.base = Some(v);
                    }
                    "force" => {
                        if inline.is_some() {
                            return Err("--force non prende valori".to_string());
                        }
                        args.force = true;
                        parser.next();
                    }
                    "stdin" => {
                        if inline.is_some() {
                            return Err("--stdin non prende valori".to_string());
                        }
                        args.stdin = true;
                        parser.next();
                    }
                    "text" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.text = Some(v);
                    }
                    "file" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--file vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.file = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Write(args))
        }
        "create" => {
            let mut args = CreateArgs {
                global,
                name: None,
                stdin: false,
                text: None,
                file: None,
                template: None,
                title: None,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.name.is_some() {
                        break;
                    }
                    args.name = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "stdin" => {
                        if inline.is_some() {
                            return Err("--stdin non prende valori".to_string());
                        }
                        args.stdin = true;
                        parser.next();
                    }
                    "text" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.text = Some(v);
                    }
                    "file" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--file vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.file = Some(v);
                    }
                    "template" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--template vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.template = Some(v);
                    }
                    "title" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.title = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Create(args))
        }
        "exec" | "edit" | "invoke" => {
            let command = parser
                .next()
                .ok_or_else(|| "edit vuole un comando del registro".to_string())?
                .to_string();
            let mut args_json = String::from("{}");
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "args" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--args vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args_json = v;
                    }
                    _ => break,
                }
            }
            if let Some(rest) = parser.peek() {
                if !rest.starts_with('-') {
                    // Argomento posizionale JSON senza flag: `exec note.create '{"name":"x"}'`.
                    args_json = parser.next().unwrap_or("{}").to_string();
                }
            }
            Ok(CliCommand::Edit(EditArgs {
                global,
                command,
                args_json,
            }))
        }
        "files" | "ls" => {
            let mut args = FilesArgs {
                global,
                folder: None,
                kind: None,
                recursive: false,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.folder.is_some() {
                        break;
                    }
                    args.folder = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "kind" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.kind = Some(v);
                    }
                    "recursive" | "r" => {
                        if inline.is_some() {
                            return Err("--recursive non prende valori".to_string());
                        }
                        args.recursive = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Files(args))
        }
        "query" => {
            let mut args = QueryArgs {
                global,
                query_json: None,
                text: None,
                tag: None,
                folder: None,
                property: Vec::new(),
                backlinks: None,
                neighbors: None,
                resolve: None,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.query_json.is_some() {
                        break;
                    }
                    args.query_json = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                macro_rules! valued {
                    ($field:ident, $flag:literal) => {{
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err(concat!($flag, " vuole un valore").to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.$field = Some(v);
                    }};
                }
                match name {
                    "text" => valued!(text, "--text"),
                    "tag" => valued!(tag, "--tag"),
                    "folder" => valued!(folder, "--folder"),
                    "backlinks" => valued!(backlinks, "--backlinks"),
                    "neighbors" => valued!(neighbors, "--neighbors"),
                    "resolve" => valued!(resolve, "--resolve"),
                    "property" | "prop" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--property vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.property.push(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Query(args))
        }
        "search" => {
            let query = parser
                .next()
                .ok_or_else(|| "search vuole una query".to_string())?
                .to_string();
            let mut args = SearchArgs {
                global,
                query,
                field: Vec::new(),
                phrase: false,
                tag: None,
                folder: None,
                select: Vec::new(),
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "field" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.field.push(v);
                    }
                    "phrase" => {
                        if inline.is_some() {
                            return Err("--phrase non prende valori".to_string());
                        }
                        args.phrase = true;
                        parser.next();
                    }
                    "tag" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.tag = Some(v);
                    }
                    "folder" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.folder = Some(v);
                    }
                    "select" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.select.push(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Search(args))
        }
        "command" | "cmd" => {
            let mut args = CommandArgs {
                global,
                list: false,
                name: None,
                args_json: None,
                show_plan: false,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.name.is_some() {
                        break;
                    }
                    args.name = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "args" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.args_json = Some(v);
                    }
                    "plan" => {
                        if inline.is_some() {
                            return Err("--plan non prende valori".to_string());
                        }
                        args.show_plan = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Command(args))
        }
        "properties" | "prop" => {
            let mut args = PropertiesArgs {
                global,
                doc: None,
                list: false,
                set: Vec::new(),
                remove: Vec::new(),
                key: None,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.doc.is_some() {
                        break;
                    }
                    args.doc = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "set" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--set vuole chiave=valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.set.push(v);
                    }
                    "remove" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--remove vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.remove.push(v);
                    }
                    "key" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.key = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Properties(args))
        }
        "tasks" | "task" => {
            let doc = parser
                .next()
                .ok_or_else(|| "tasks vuole un documento".to_string())?
                .to_string();
            let mut args = TasksArgs {
                global,
                doc,
                list: false,
                toggle_at: Vec::new(),
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "toggle" | "at" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--toggle vuole offset".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        for part in v.split(',') {
                            args.toggle_at.push(
                                part.trim()
                                    .parse()
                                    .map_err(|_| "--toggle vuole interi".to_string())?,
                            );
                        }
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Tasks(args))
        }
        "templates" | "template" => {
            let mut args = TemplatesArgs {
                global,
                list: false,
                from: None,
                name: None,
                daily: false,
                date: None,
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "from" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--from vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.from = Some(v);
                    }
                    "name" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.name = Some(v);
                    }
                    "daily" => {
                        if inline.is_some() {
                            return Err("--daily non prende valori".to_string());
                        }
                        args.daily = true;
                        parser.next();
                    }
                    "date" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.date = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Templates(args))
        }
        "views" | "view" => {
            let mut args = ViewsArgs {
                global,
                list: false,
                render: None,
                instance: None,
                params_json: None,
                action: None,
                payload_json: None,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.render.is_some() {
                        break;
                    }
                    args.render = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "instance" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.instance = Some(v);
                    }
                    "params" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.params_json = Some(v);
                    }
                    "action" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--action vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.action = Some(v);
                    }
                    "payload" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.payload_json = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Views(args))
        }
        "plugin" => {
            let mut args = PluginArgs {
                global,
                list: false,
                enable: None,
                disable: None,
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "enable" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--enable vuole un id".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.enable = Some(v);
                    }
                    "disable" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--disable vuole un id".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.disable = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Plugin(args))
        }
        "theme" => {
            let mut args = ThemeArgs {
                global,
                list: false,
                show: None,
                light: None,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.show.is_some() {
                        break;
                    }
                    args.show = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "light" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.light = Some(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Theme(args))
        }
        "diagnostics" | "diag" | "doctor" => {
            let mut args = DiagnosticsArgs {
                global,
                startup: false,
                session: false,
                jobs: false,
                health: None,
                status: false,
            };
            // Senza flag = tutto il locale disponibile.
            let mut any = false;
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "startup" => {
                        if inline.is_some() {
                            return Err("--startup non prende valori".to_string());
                        }
                        args.startup = true;
                        any = true;
                        parser.next();
                    }
                    "session" => {
                        if inline.is_some() {
                            return Err("--session non prende valori".to_string());
                        }
                        args.session = true;
                        any = true;
                        parser.next();
                    }
                    "jobs" => {
                        if inline.is_some() {
                            return Err("--jobs non prende valori".to_string());
                        }
                        args.jobs = true;
                        any = true;
                        parser.next();
                    }
                    "health" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--health vuole un controllo".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.health = Some(v);
                        any = true;
                    }
                    "status" => {
                        if inline.is_some() {
                            return Err("--status non prende valori".to_string());
                        }
                        args.status = true;
                        any = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            if !any {
                args.startup = true;
                args.session = true;
                args.jobs = true;
                args.status = true;
            }
            Ok(CliCommand::Diagnostics(args))
        }
        "capture" => {
            let mut args = CaptureArgs {
                global,
                file: None,
                payload_json: None,
                title: None,
                text: None,
                text_file: None,
                source_url: None,
                folder: None,
                note: None,
                mode: None,
                vault: None,
                prop: Vec::new(),
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                macro_rules! valued_opt {
                    ($field:ident, $flag:literal) => {{
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err(concat!($flag, " vuole un valore").to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.$field = Some(v);
                    }};
                }
                match name {
                    "file" => valued_opt!(file, "--file"),
                    "json" | "payload" => valued_opt!(payload_json, "--json"),
                    "title" => valued_opt!(title, "--title"),
                    "text" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if inline.is_some() {
                            parser.next();
                        }
                        args.text = Some(v);
                    }
                    "text-file" => valued_opt!(text_file, "--text-file"),
                    "source-url" | "url" => valued_opt!(source_url, "--source-url"),
                    "folder" => valued_opt!(folder, "--folder"),
                    "note" => valued_opt!(note, "--note"),
                    "mode" => valued_opt!(mode, "--mode"),
                    "vault" => valued_opt!(vault, "--vault"),
                    "prop" | "property" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--prop vuole chiave=valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.prop.push(v);
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Capture(args))
        }
        "uri" => {
            let uri = parser
                .next()
                .ok_or_else(|| "uri vuole un fub://…".to_string())?
                .to_string();
            let mut execute = false;
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "execute" | "apply" => {
                        if inline.is_some() {
                            return Err("--execute non prende valori".to_string());
                        }
                        execute = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Uri {
                global,
                uri,
                execute,
            })
        }
        "callback" => {
            let verb = parser.next().unwrap_or("list");
            let action = match verb {
                "list" => CallbackAction::List,
                "allow" => CallbackAction::Allow(
                    parser
                        .next()
                        .ok_or_else(|| "callback allow vuole uno schema".to_string())?
                        .to_string(),
                ),
                "revoke" => CallbackAction::Revoke(
                    parser
                        .next()
                        .ok_or_else(|| "callback revoke vuole uno schema".to_string())?
                        .to_string(),
                ),
                _ => return Err("callback vuole list|allow|revoke".to_string()),
            };
            Ok(CliCommand::Callback { global, action })
        }
        "login" => {
            let mut args = LoginArgs {
                global,
                user: None,
                password_file: None,
                code_file: None,
                enroll: false,
            };
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if args.user.is_some() {
                        break;
                    }
                    args.user = Some(parser.next().unwrap_or("").to_string());
                    continue;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "password-file" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--password-file vuole un path".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.password_file = Some(v);
                    }
                    "code-file" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--code-file vuole un path".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.code_file = Some(v);
                    }
                    "enroll" => {
                        if inline.is_some() {
                            return Err("--enroll non prende valori".to_string());
                        }
                        args.enroll = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Login(args))
        }
        "config" => {
            let mut args = ConfigArgs {
                global,
                list: false,
                get: None,
                set: Vec::new(),
                reset: None,
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "list" => {
                        if inline.is_some() {
                            return Err("--list non prende valori".to_string());
                        }
                        args.list = true;
                        parser.next();
                    }
                    "get" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--get vuole una chiave".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.get = Some(v);
                    }
                    "set" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--set vuole chiave=valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.set.push(v);
                    }
                    "reset" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--reset vuole una chiave".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.reset = Some(v);
                    }
                    _ => break,
                }
            }
            if !args.list && args.get.is_none() && args.set.is_empty() && args.reset.is_none() {
                args.list = true;
            }
            Ok(CliCommand::Config(args))
        }
        "sync" => {
            let verb = parser
                .next()
                .ok_or_else(|| "sync vuole status|once|watch".to_string())?;
            let action = match verb {
                "status" => SyncAction::Status,
                "once" => SyncAction::Once,
                "watch" => {
                    let mut interval: u64 = 30;
                    while let Some(arg) = parser.peek() {
                        let Some((name, inline)) = split_flag(arg) else {
                            break;
                        };
                        match name {
                            "interval" => {
                                let v = inline.map(str::to_string).unwrap_or_else(|| {
                                    parser.next();
                                    parser.next().unwrap_or("").to_string()
                                });
                                if v.is_empty() {
                                    return Err("--interval vuole secondi".to_string());
                                }
                                if inline.is_some() {
                                    parser.next();
                                }
                                interval =
                                    v.parse::<u64>().ok().filter(|n| *n > 0).ok_or_else(|| {
                                        "--interval vuole secondi > 0".to_string()
                                    })?;
                            }
                            _ => break,
                        }
                    }
                    SyncAction::Watch {
                        interval_secs: interval,
                    }
                }
                other => return Err(format!("sync: verbo sconosciuto `{other}`")),
            };
            Ok(CliCommand::Sync(SyncArgs { global, action }))
        }
        "publish" => {
            let verb = parser.next().ok_or_else(|| {
                "publish vuole status|dry-run|commit|watch|unpublish|rollback".to_string()
            })?;
            let mut site: Option<String> = None;
            let mut version: Option<u64> = None;
            let mut to_version: Option<u64> = None;
            let mut interval: u64 = 30;
            while let Some(arg) = parser.peek() {
                if !arg.starts_with('-') {
                    if site.is_none() {
                        site = Some(parser.next().unwrap_or("").to_string());
                        continue;
                    }
                    break;
                }
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "interval" if verb == "watch" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        interval = v
                            .parse::<u64>()
                            .ok()
                            .filter(|n| *n > 0)
                            .ok_or_else(|| "--interval vuole secondi > 0".to_string())?;
                        if inline.is_some() {
                            parser.next();
                        }
                    }
                    "site" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--site vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        site = Some(v);
                    }
                    "version" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--version vuole un numero".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        version = Some(
                            v.parse()
                                .map_err(|_| "--version vuole un numero".to_string())?,
                        );
                    }
                    "to-version" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--to-version vuole un numero".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        to_version = Some(
                            v.parse()
                                .map_err(|_| "--to-version vuole un numero".to_string())?,
                        );
                    }
                    _ => break,
                }
            }
            let site = site
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "publish vuole un site (posizionale o --site)".to_string())?;
            let action = match verb {
                "status" => PublishAction::Status { site },
                "dry-run" => PublishAction::DryRun { site },
                "commit" => PublishAction::Commit { site, version },
                "watch" => PublishAction::Watch {
                    site,
                    interval_secs: interval,
                },
                "unpublish" => PublishAction::Unpublish { site },
                "rollback" => PublishAction::Rollback { site, to_version },
                other => return Err(format!("publish: verbo sconosciuto `{other}`")),
            };
            Ok(CliCommand::Publish(PublishArgs { global, action }))
        }
        "native-install" => {
            let mut extension_id: Option<String> = None;
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "extension-id" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--extension-id vuole un valore".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        extension_id = Some(v);
                    }
                    _ => break,
                }
            }
            let Some(extension_id) = extension_id else {
                return Err("native-install vuole --extension-id".to_string());
            };
            Ok(CliCommand::NativeInstall {
                global,
                extension_id,
            })
        }
        "pair" => {
            let verb = parser
                .next()
                .ok_or_else(|| "pair vuole pair|pairs|unpair".to_string())?;
            match verb {
                "pair" => {
                    let mut extension_id: Option<String> = None;
                    let mut vault: Option<String> = None;
                    let mut folder: Option<String> = None;
                    while let Some(arg) = parser.peek() {
                        let Some((name, inline)) = split_flag(arg) else {
                            break;
                        };
                        macro_rules! valued_pair {
                            ($field:ident, $flag:literal) => {{
                                let v = inline.map(str::to_string).unwrap_or_else(|| {
                                    parser.next();
                                    parser.next().unwrap_or("").to_string()
                                });
                                if v.is_empty() {
                                    return Err(concat!($flag, " vuole un valore").to_string());
                                }
                                if inline.is_some() {
                                    parser.next();
                                }
                                $field = Some(v);
                            }};
                        }
                        match name {
                            "extension-id" => valued_pair!(extension_id, "--extension-id"),
                            "vault" => valued_pair!(vault, "--vault"),
                            "folder" => valued_pair!(folder, "--folder"),
                            _ => break,
                        }
                    }
                    let Some(extension_id) = extension_id else {
                        return Err("pair vuole --extension-id".to_string());
                    };
                    Ok(CliCommand::Pair {
                        global,
                        action: PairAction::Add {
                            extension_id,
                            vault,
                            folder,
                        },
                    })
                }
                "pairs" => Ok(CliCommand::Pair {
                    global,
                    action: PairAction::List,
                }),
                "unpair" => {
                    let mut extension_id: Option<String> = None;
                    while let Some(arg) = parser.peek() {
                        let Some((name, inline)) = split_flag(arg) else {
                            break;
                        };
                        match name {
                            "extension-id" => {
                                let v = inline.map(str::to_string).unwrap_or_else(|| {
                                    parser.next();
                                    parser.next().unwrap_or("").to_string()
                                });
                                if v.is_empty() {
                                    return Err("--extension-id vuole un valore".to_string());
                                }
                                if inline.is_some() {
                                    parser.next();
                                }
                                extension_id = Some(v);
                            }
                            _ => break,
                        }
                    }
                    let Some(extension_id) = extension_id else {
                        return Err("unpair vuole --extension-id".to_string());
                    };
                    Ok(CliCommand::Pair {
                        global,
                        action: PairAction::Remove { extension_id },
                    })
                }
                other => Err(format!("pair: verbo sconosciuto `{other}`")),
            }
        }
        "mfa" => {
            let mut args = MfaArgs {
                global,
                code_file: None,
                enroll: false,
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "code-file" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--code-file vuole un path".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.code_file = Some(v);
                    }
                    "enroll" => {
                        if inline.is_some() {
                            return Err("--enroll non prende valori".to_string());
                        }
                        args.enroll = true;
                        parser.next();
                    }
                    _ => break,
                }
            }
            Ok(CliCommand::Mfa(args))
        }
        other => Err(format!("comando sconosciuto `{other}`")),
    }
}

fn parse_vault(parser: &mut Parser, global: GlobalArgs) -> Result<CliCommand, String> {
    let verb = parser.next().unwrap_or("list").to_string();
    match verb.as_str() {
        "open" => {
            let path = match parser.peek() {
                Some(arg) if !arg.starts_with('-') => Some(parser.next().unwrap_or("").to_string()),
                _ => None,
            };
            Ok(CliCommand::Vault {
                global,
                action: VaultAction::Open { path },
            })
        }
        "list" => Ok(CliCommand::Vault {
            global,
            action: VaultAction::List,
        }),
        "current" => Ok(CliCommand::Vault {
            global,
            action: VaultAction::Current,
        }),
        "use" => {
            let path = parser
                .next()
                .ok_or_else(|| "vault use vuole un path".to_string())?
                .to_string();
            Ok(CliCommand::Vault {
                global,
                action: VaultAction::Use { path },
            })
        }
        "close" => {
            let path = parser
                .next()
                .ok_or_else(|| "vault close vuole un path".to_string())?
                .to_string();
            Ok(CliCommand::Vault {
                global,
                action: VaultAction::Close { path },
            })
        }
        "known" => Ok(CliCommand::Vault {
            global,
            action: VaultAction::Known,
        }),
        other => Err(format!("vault: verbo sconosciuto `{other}`")),
    }
}

/// Nomi per completamento/history: la stessa lista dell'help, mai due elenchi.
pub fn command_names() -> Vec<&'static str> {
    vec![
        "vault",
        "read",
        "write",
        "create",
        "exec",
        "files",
        "query",
        "search",
        "command",
        "properties",
        "tasks",
        "templates",
        "views",
        "plugin",
        "theme",
        "diagnostics",
        "capture",
        "uri",
        "callback",
        "login",
        "mfa",
        "config",
        "sync",
        "publish",
        "native-install",
        "pair",
        "repl",
        "completion",
        "help",
    ]
}
pub fn usage() -> &'static str {
    "uso: fub-cli [--vault PATH] [--format json|jsonl|tsv|csv|md|text] [--config-dir DIR] [--no-watcher] [--standalone] <comando> [args]\ncomandi: vault read write create exec files query search command properties tasks templates views plugin theme diagnostics capture uri callback login mfa config sync publish native-install pair repl completion help"
}

pub fn help_text(topic: Option<&str>) -> String {
    match topic {
        None => format!("fub-cli — automazione locale sopra Host.\n\n{}\n\nflag globali: --vault PATH --format F --config-dir DIR --no-watcher --standalone --limit N --offset N --dry-run --yes --no-input --quiet --verbose --no-color --color\nUsa `help <comando>` per la sintassi. --standalone non elude il writer lock; vault occupato = busy.", usage()),
        Some(name) => match name {
            "read" => "read <doc> [--revision] [--model]\nLegge sorgente+revisione via Host::read_document. --model aggiunge il modello parsato. Vault da --vault/FUB_VAULT/corrente.".to_string(),
            "write" => "write <doc> [--base REV|--force] [--stdin|--text T|--file F]\nScrive con guardia CAS: --base la revisione letta, --force detta esplicita. Sorgente da --text/--file/stdin. Exit 5 su conflitto.".to_string(),
            "create" => "create [name] [--text T|--file F|--stdin] [--template T] [--title T]\nCrea senza sovrascrivere (AlreadyExists se occupato). --template espande note.from_template, --daily via templates.".to_string(),
            "query" => "query [JSON] [--text T] [--tag T] [--folder F] [--property k=op:v] [--backlinks D] [--neighbors D] [--resolve R]\nInterroga Host::query_index. --property: chiave=valore, chiave~=sottostringa, chiave!=valore, chiave?=exists, chiave!=exists. Operatori multipli in AND nella stessa query. --text usa la sintassi della barra (vedi `help search`); i flag si aggiungono a ogni alternativa.".to_string(),
            "search" => "search <q> [--field …] [--phrase] [--tag T] [--folder F] [--select k]\nRicerca full-text con faccette tag/cartella e select proprietà. Senza --field/--phrase la riga usa la sintassi della barra della shell: tag:, path:, folder:, file:, content:, heading:, ext:, task:todo|done, match-case:, \"frase\", -x, OR, ( ), /regex/, [prop], [prop:v], [prop:>v].".to_string(),
            "command" => "command [--list|<nome> --args JSON --plan]\nElenca/invoca il registro comandi come la palette. --plan = dry-run esplicito oltre --dry-run globale.".to_string(),
            "capture" => "capture (--file F|--json J|--title T --text T) [--mode …] [--folder F] [--note N] [--source-url U] [--prop k=v]\nIngresso non autenticato: valida con gli stessi limiti NM e scrive con conferma (--yes) o rifiuto (--no-input). Modo daily senza nota = giornaliera.".to_string(),
            "uri" => "uri <fub://…> [--execute]\nDescrive senza scrivere. --execute applica open/new/daily/unique/search/capture; capture richiede consenso e callback autorizzata richiede consenso separato.".to_string(),
            "callback" => "callback list|allow SCHEME|revoke SCHEME\nDeny-all di default; aggiunta richiede consenso (--yes), policy file 0600. Ogni apertura richiede conferma e audit senza URL.".to_string(),
            "login" => "login <user> --password-file F [--code-file F] [--enroll]\nToken e segreto MFA salvati in file 0600; il percorso è restituito nel risultato. Nessun segreto in argv/history/log.".to_string(),
            "mfa" => "mfa [--enroll|--code-file F]\nCodice da file 0600 o FUB_SERVICES_MFA_CODE_FILE; enrollment salva segreto in file 0600.".to_string(),
            "publish" => "publish status|dry-run|commit|watch|unpublish|rollback SITE [--interval SEC per watch] [--to-version N per rollback]\nWatch ripete su documenti mutati e conferma la versione remota prima del successo.".to_string(),
            "vault" => "vault open|list|current|use|close|known [PATH]".to_string(),
            "exec" => "exec <command> [--args JSON] [--plan]".to_string(),
            "files" => "files [--folder PATH] [--kind doc|asset|unknown] [--recursive]".to_string(),
            "properties" => "properties <doc> [--list|--set k=v|--remove k]".to_string(),
            "tasks" => "tasks <doc> [--list|--toggle N]".to_string(),
            "templates" => "templates [--list|--from DOC --name N|--daily]".to_string(),
            "views" => "views [--list|--render ID|--action ID --payload JSON]".to_string(),
            "plugin" => "plugin [--list|--enable ID|--disable ID]".to_string(),
            "theme" => "theme [--list|--show ID|--light ID]".to_string(),
            "diagnostics" => "diagnostics [--startup|--session|--jobs|--health CHECK|--status]".to_string(),
            "config" => "config [--list|--get KEY|--set KEY=VALUE|--reset KEY]".to_string(),
            "sync" => "sync status|once|watch [--interval SEC]".to_string(),
            "pair" => "pair pair --extension-id ID [--vault PATH] [--folder PATH] | pairs | unpair --extension-id ID".to_string(),
            "native-install" => "native-install --extension-id ID".to_string(),
            "repl" => "repl: sessione interattiva; history solo comandi non sensibili".to_string(),
            "completion" => "completion bash|zsh|fish".to_string(),
            "help" => "help [comando]".to_string(),
            other => format!("nessun help per `{other}`"),
        },
    }
}
