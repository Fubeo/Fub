//! Le forme della grammatica: `CliCommand`, gli argomenti globali e quelli
//! di ogni comando, con ciò che un comando sa di sé.

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
    Mcp(McpArgs),
    Create(CreateArgs),
    Edit(EditArgs),
    Files(FilesArgs),
    Query(QueryArgs),
    Search(SearchArgs),
    Command(CommandArgs),
    Properties(PropertiesArgs),
    Tasks(TasksArgs),
    Templates(TemplatesArgs),
    Daily(DailyArgs),
    Outline(DocArgs),
    Wordcount(DocArgs),
    Random {
        global: GlobalArgs,
    },
    Bookmarks {
        global: GlobalArgs,
    },
    Views(ViewsArgs),
    Plugin(PluginArgs),
    Componenti(ComponentiArgs),
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
        /// `--browser`, ripetibile: senza, ogni browser trovato.
        browsers: Vec<String>,
        uninstall: bool,
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

/// `daily`: la giornaliera di un giorno, oggi senza `--date`.
#[derive(Clone, Debug)]
pub struct DailyArgs {
    pub global: GlobalArgs,
    pub date: Option<String>,
    pub action: DailyAction,
}

/// Che cosa fa `daily` della giornaliera: dirne il nome (senza flag), leggerla,
/// o scriverci una riga in fondo o in testa al corpo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DailyAction {
    Path,
    Read,
    Append(String),
    Prepend(String),
}

/// Un comando che prende soltanto un documento: `outline`, `wordcount`.
#[derive(Clone, Debug)]
pub struct DocArgs {
    pub global: GlobalArgs,
    pub doc: String,
}

/// `mcp`: il server MCP su stdio, con le radici dell'automazione.
#[derive(Clone, Debug)]
pub struct McpArgs {
    pub global: GlobalArgs,
    pub read_roots: Vec<String>,
    pub write_roots: Vec<String>,
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

/// `componenti`: l'elenco, `perche ID`, `accendi ID`, `spegni ID`.
#[derive(Clone, Debug)]
pub struct ComponentiArgs {
    pub global: GlobalArgs,
    pub action: ComponentiAction,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ComponentiAction {
    Elenco,
    Perche(String),
    Accendi(String),
    Spegni {
        id: String,
        anche_questi: bool,
        togli: bool,
        tieni: bool,
    },
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
            | CliCommand::Random { global }
            | CliCommand::Bookmarks { global }
            | CliCommand::Completion { global, .. }
            | CliCommand::Vault { global, .. }
            | CliCommand::Uri { global, .. }
            | CliCommand::Callback { global, .. }
            | CliCommand::NativeInstall { global, .. }
            | CliCommand::Pair { global, .. } => global.clone(),
            CliCommand::Read(a) => a.global.clone(),
            CliCommand::Mcp(a) => a.global.clone(),
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
            CliCommand::Daily(a) => a.global.clone(),
            CliCommand::Outline(a) | CliCommand::Wordcount(a) => a.global.clone(),
            CliCommand::Views(a) => a.global.clone(),
            CliCommand::Plugin(a) => a.global.clone(),
            CliCommand::Componenti(a) => a.global.clone(),
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
            CliCommand::Random { .. } => CliCommand::Random { global },
            CliCommand::Bookmarks { .. } => CliCommand::Bookmarks { global },
            CliCommand::Completion { shell, .. } => CliCommand::Completion { shell, global },
            CliCommand::Help { topic, .. } => CliCommand::Help { topic, global },
            CliCommand::Vault { action, .. } => CliCommand::Vault { action, global },
            CliCommand::Uri { uri, execute, .. } => CliCommand::Uri {
                uri,
                execute,
                global,
            },
            CliCommand::NativeInstall {
                extension_id,
                browsers,
                uninstall,
                ..
            } => CliCommand::NativeInstall {
                extension_id,
                browsers,
                uninstall,
                global,
            },
            CliCommand::Callback { action, .. } => CliCommand::Callback { action, global },
            CliCommand::Pair { action, .. } => CliCommand::Pair { action, global },
            CliCommand::Read(mut a) => {
                a.global = global;
                CliCommand::Read(a)
            }
            CliCommand::Mcp(mut a) => {
                a.global = global;
                CliCommand::Mcp(a)
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
            CliCommand::Daily(mut a) => {
                a.global = global;
                CliCommand::Daily(a)
            }
            CliCommand::Outline(mut a) => {
                a.global = global;
                CliCommand::Outline(a)
            }
            CliCommand::Wordcount(mut a) => {
                a.global = global;
                CliCommand::Wordcount(a)
            }
            CliCommand::Views(mut a) => {
                a.global = global;
                CliCommand::Views(a)
            }
            CliCommand::Plugin(mut a) => {
                a.global = global;
                CliCommand::Plugin(a)
            }
            CliCommand::Componenti(mut a) => {
                a.global = global;
                CliCommand::Componenti(a)
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
