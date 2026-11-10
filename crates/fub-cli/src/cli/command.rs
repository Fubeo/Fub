//! `parse_command`: un comando e i suoi argomenti, dopo le opzioni globali.
//! È una sola `match` sul nome del comando.

use super::*;

pub(super) fn parse_command(
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
        "mcp" => {
            let mut args = McpArgs {
                global,
                read_roots: Vec::new(),
                write_roots: Vec::new(),
            };
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                let roots = match name {
                    "automation-read-root" => &mut args.read_roots,
                    "automation-write-root" => &mut args.write_roots,
                    _ => break,
                };
                let value = match inline {
                    Some(value) => value.to_string(),
                    None => {
                        parser.next();
                        parser.expect_value(&format!("--{name}"))?
                    }
                };
                if inline.is_some() {
                    parser.next();
                }
                if value.trim().is_empty() {
                    return Err(format!("--{name} vuota"));
                }
                roots.push(value);
            }
            Ok(CliCommand::Mcp(args))
        }
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
        "daily" => {
            let mut args = DailyArgs {
                global,
                date: None,
                action: DailyAction::Path,
            };
            let mut actions = 0;
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "path" | "read" => {
                        if inline.is_some() {
                            return Err(format!("--{name} non prende valori"));
                        }
                        args.action = if name == "path" {
                            DailyAction::Path
                        } else {
                            DailyAction::Read
                        };
                        actions += 1;
                        parser.next();
                    }
                    "append" | "prepend" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.trim().is_empty() {
                            return Err(format!("--{name} vuole un testo"));
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.action = if name == "append" {
                            DailyAction::Append(v)
                        } else {
                            DailyAction::Prepend(v)
                        };
                        actions += 1;
                    }
                    "date" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err("--date vuole AAAA-MM-GG".to_string());
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        args.date = Some(v);
                    }
                    _ => break,
                }
            }
            if actions > 1 {
                return Err(
                    "daily: un'azione sola fra --path, --read, --append e --prepend".to_string(),
                );
            }
            Ok(CliCommand::Daily(args))
        }
        "outline" | "wordcount" => {
            let doc = parser
                .next()
                .ok_or_else(|| format!("{head} vuole un documento"))?
                .to_string();
            let args = DocArgs { global, doc };
            Ok(if head == "outline" {
                CliCommand::Outline(args)
            } else {
                CliCommand::Wordcount(args)
            })
        }
        "random" => {
            if parser.peek().is_some_and(|arg| split_flag(arg).is_none()) {
                return Err("random non prende argomenti".to_string());
            }
            Ok(CliCommand::Random { global })
        }
        "bookmarks" => {
            if parser.peek().is_some_and(|arg| split_flag(arg).is_none()) {
                return Err("bookmarks non prende argomenti".to_string());
            }
            Ok(CliCommand::Bookmarks { global })
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
        "componenti" => parse_componenti(parser, global),
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
            let mut browsers = Vec::new();
            let mut uninstall = false;
            while let Some(arg) = parser.peek() {
                let Some((name, inline)) = split_flag(arg) else {
                    break;
                };
                match name {
                    "extension-id" | "browser" => {
                        let v = inline.map(str::to_string).unwrap_or_else(|| {
                            parser.next();
                            parser.next().unwrap_or("").to_string()
                        });
                        if v.is_empty() {
                            return Err(format!("--{name} vuole un valore"));
                        }
                        if inline.is_some() {
                            parser.next();
                        }
                        if name == "browser" {
                            browsers.push(v);
                        } else {
                            extension_id = Some(v);
                        }
                    }
                    "uninstall" => {
                        parser.next();
                        uninstall = true;
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
                browsers,
                uninstall,
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
