//! Grammatica CLI: un solo parser per argv, REPL e smoke.
//!
//! Niente derive clap: il workspace non ha quella dipendenza nei crate
//! spediti e Main vieta nuove dipendenze non concordate. La grammatica resta
//! dichiarata qui in un posto solo: `COMMANDS` alimenta help, completamento
//! e REPL senza duplicati.

mod args;
mod command;

pub use args::{
    CallbackAction, CaptureArgs, CliCommand, CommandArgs, ComponentiAction, ComponentiArgs,
    ConfigArgs, CreateArgs, DailyAction, DailyArgs, DiagnosticsArgs, DocArgs, EditArgs, FilesArgs,
    GlobalArgs, LoginArgs, McpArgs, MfaArgs, PairAction, PluginArgs, PropertiesArgs, PublishAction,
    PublishArgs, QueryArgs, ReadArgs, SearchArgs, SyncAction, SyncArgs, TasksArgs, TemplatesArgs,
    ThemeArgs, VaultAction, ViewsArgs, WriteArgs,
};
use command::parse_command;

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

/// `componenti [perche ID | accendi ID | spegni ID [--anche-questi] [--togli|--tieni]]`.
/// I flag globali possono stare in mezzo: `spegni x --yes --togli`.
fn parse_componenti(parser: &mut Parser, mut global: GlobalArgs) -> Result<CliCommand, String> {
    parse_global(parser, &mut global)?;
    let verbo = match parser.peek() {
        Some(v) if split_flag(v).is_none() => {
            parser.next();
            Some(v)
        }
        _ => None,
    };
    let mut id = None;
    let (mut anche_questi, mut togli, mut tieni) = (false, false, false);
    loop {
        parse_global(parser, &mut global)?;
        let Some(arg) = parser.peek() else { break };
        match split_flag(arg) {
            None if verbo.is_some() && id.is_none() => {
                id = Some(arg.to_string());
                parser.next();
            }
            Some((name, inline)) if verbo == Some("spegni") => {
                if inline.is_some() {
                    return Err(format!("--{name} non prende valori"));
                }
                match name {
                    "anche-questi" => anche_questi = true,
                    "togli" => togli = true,
                    "tieni" => tieni = true,
                    _ => break,
                }
                parser.next();
            }
            _ => break,
        }
    }
    if togli && tieni {
        return Err("--togli e --tieni insieme: scegline uno".to_string());
    }
    let id_di = |verbo: &str| {
        id.clone()
            .ok_or_else(|| format!("componenti {verbo} vuole un id"))
    };
    let action = match verbo {
        None => ComponentiAction::Elenco,
        Some("perche") => ComponentiAction::Perche(id_di("perche")?),
        Some("accendi") => ComponentiAction::Accendi(id_di("accendi")?),
        Some("spegni") => ComponentiAction::Spegni {
            id: id_di("spegni")?,
            anche_questi,
            togli,
            tieni,
        },
        Some(altro) => {
            return Err(format!(
                "componenti: `{altro}` non è un'azione (perche, accendi, spegni)"
            ))
        }
    };
    Ok(CliCommand::Componenti(ComponentiArgs { global, action }))
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
        "mcp",
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
        "daily",
        "outline",
        "wordcount",
        "random",
        "bookmarks",
        "views",
        "plugin",
        "componenti",
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
    "uso: fub-cli [--vault PATH] [--format json|jsonl|tsv|csv|md|text] [--config-dir DIR] [--no-watcher] [--standalone] <comando> [args]\ncomandi: vault mcp read write create exec files query search command properties tasks templates daily outline wordcount random bookmarks views plugin componenti theme diagnostics capture uri callback login mfa config sync publish native-install pair repl completion help"
}

pub fn help_text(topic: Option<&str>) -> String {
    match topic {
        None => format!("fub-cli — automazione locale sopra Host.\n\n{}\n\nflag globali: --vault PATH --format F --config-dir DIR --no-watcher --standalone --limit N --offset N --dry-run --yes --no-input --quiet --verbose --no-color --color\nUsa `help <comando>` per la sintassi. Con il vault aperto nell'app, i comandi passano dall'app (canale di controllo locale); --standalone non passa dall'app e non elude il writer lock: vault occupato = busy.", usage()),
        Some(name) => match name {
            "mcp" => "mcp [--automation-read-root DIR]… [--automation-write-root DIR]…\nServer MCP su stdio (JSON-RPC 2.0, un messaggio per riga) per gli agenti: fub_search, fub_query, fub_read, fub_read_model, fub_preview, fub_write, fub_create, fub_canvas_create, fub_canvas_apply, fub_commands, fub_invoke, fub_components*, fub_external_editors, fub_open_with, e le note come risorse. Senza --automation-write-root è in sola lettura; senza --automation-read-root legge tutto il vault. fub_write e fub_canvas_apply vogliono la revisione letta; fub_invoke e fub_canvas_apply senza apply mostrano il piano; fub_preview non avvia mai un'app, fub_open_with la avvia solo con apply e col file sotto le radici di scrittura. Vault da --vault/FUB_VAULT/corrente.".to_string(),
            "read" => "read <doc> [--revision] [--model]\nLegge sorgente+revisione via Host::read_document. --model aggiunge il modello parsato. Vault da --vault/FUB_VAULT/corrente.".to_string(),
            "write" => "write <doc> [--base REV|--force] [--stdin|--text T|--file F]\nScrive con guardia CAS: --base la revisione letta, --force detta esplicita. Sorgente da --text/--file/stdin. Exit 5 su conflitto.".to_string(),
            "create" => "create [name] [--text T|--file F|--stdin] [--template T] [--title T]\nCrea senza sovrascrivere (AlreadyExists se occupato). --template espande note.from_template, --daily via templates.".to_string(),
            "query" => "query [JSON] [--text T] [--tag T] [--folder F] [--property k=op:v] [--backlinks D] [--neighbors D] [--resolve R]\nInterroga Host::query_index. --property: chiave=valore, chiave~=sottostringa, chiave!=valore, chiave?=exists, chiave!=exists. Operatori multipli in AND nella stessa query. --text usa la sintassi della barra (vedi `help search`); i flag si aggiungono a ogni alternativa.".to_string(),
            "search" => "search <q> [--field …] [--phrase] [--tag T] [--folder F] [--select k]\nRicerca full-text con faccette tag/cartella e select proprietà. Senza --field/--phrase la riga usa la sintassi della barra della shell: tag:, path:, folder:, file:, content:, heading:, ext:, task:todo|done, due:AAAA-MM-GG|<D|<=D|>D|>=D, match-case:, ignore-case:, line:(…), block:(…), section:(…), \"frase\", -x, OR, ( ), /regex/, [prop], [prop:v], [prop:>v].".to_string(),
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
            "daily" => "daily [--date AAAA-MM-GG] [--path|--read|--append T|--prepend T]\nLa giornaliera del giorno (oggi senza --date), col nome che decide note.daily. Senza flag ne dice il nome e se c'è; --read la legge; --append scrive una riga in fondo, --prepend in testa al corpo, dopo il frontmatter, e la crea se manca (con il suo template).".to_string(),
            "outline" => "outline <doc>\nGli heading del documento in ordine: livello, testo, slug e span, dal modello parsato.".to_string(),
            "wordcount" => "wordcount <doc>\nParole e caratteri del documento, contati come il pannello statistiche (view stats.document): la prosa sul sorgente, un formato strutturato sul suo testo.".to_string(),
            "bookmarks" => "bookmarks\nLe note appuntate in cima alla sidebar, nell'ordine scelto (l'organizzazione del vault).".to_string(),
            "random" => "random\nUna nota a caso fra quelle in prosa del vault, scelta da note.random. Non scrive.".to_string(),
            "views" => "views [--list|--render ID|--action ID --payload JSON]".to_string(),
            "plugin" => "plugin [--list|--enable ID|--disable ID]".to_string(),
            "componenti" => "componenti [perche ID | accendi ID | spegni ID [--anche-questi] [--togli|--tieni]]\nI componenti con le regole dell'app: chi è acceso, perché, chi richiede chi. Senza azione l'elenco (acceso/spento, scelto/serve, id, nome, ← chi lo richiede). accendi accende anche ciò che serve; spegni rifiuta se altri lo richiedono (--anche-questi spegne anche loro) e chiede che fare di ciò che non serve più (--togli lo spegne, --tieni lo lascia). Lo stato è plugins.disabled; --dry-run mostra l'effetto senza cambiare niente, le scritture vogliono --yes fuori da un terminale.".to_string(),
            "theme" => "theme [--list|--show ID|--light ID]".to_string(),
            "diagnostics" => "diagnostics [--startup|--session|--jobs|--health CHECK|--status]".to_string(),
            "config" => "config [--list|--get KEY|--set KEY=VALUE|--reset KEY]".to_string(),
            "sync" => "sync status|once|watch [--interval SEC]".to_string(),
            "pair" => "pair pair --extension-id ID [--vault PATH] [--folder PATH] | pairs | unpair --extension-id ID".to_string(),
            "native-install" => "native-install --extension-id ID [--browser chrome|chromium|edge|brave|vivaldi|firefox]… [--uninstall]\nSenza --yes dice dove scriverebbe il manifest dell'host nativo e lo mostra; con --yes lo scrive per l'utente in ogni browser trovato (Windows: anche la chiave HKCU). L'id decide la famiglia: 32 lettere a–p = Chromium, altrimenti Firefox. Un file d'altri non si tocca. Dopo: `pair pair --extension-id ID`.".to_string(),
            "repl" => "repl: sessione interattiva; history solo comandi non sensibili".to_string(),
            "completion" => "completion bash|zsh|fish".to_string(),
            "help" => "help [comando]".to_string(),
            other => format!("nessun help per `{other}`"),
        },
    }
}
