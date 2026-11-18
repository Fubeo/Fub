//! L'esecuzione, l'annullamento e la prova di una ricetta: il comando
//! `recipe.<id>:run` che una ricetta letta e controllata diventa.
//!
//! Una ricetta non scrive niente da sé: fa i suoi passi in fila, ognuno con
//! [`run_command`](fub_abi::traits::HostCommands::run_command), e ogni passo
//! scrive col recinto del comando che lancia. Ciò che resta qui sono le tre
//! regole che il kernel non può sapere, perché sono della ricetta:
//!
//! - **l'annullamento si compone qui**: il kernel mette in pila soltanto
//!   l'esito più esterno, quindi la ricetta concatena le `steps` di ogni passo
//!   dall'ultimo al primo, e un solo «Annulla» la toglie tutta;
//! - **un passo che cade dopo il primo non butta il lavoro fatto**: l'esito è
//!   riuscito a metà ([`Partial`]), dice quale passo è caduto, e l'annullamento
//!   toglie i passi riusciti;
//! - **la prova** fa ogni passo in simulazione e fonde i piani, ed è generica su
//!   chi esegue i passi: la usano il comando, l'host prima di adottare e la CLI.
//!
//! Il contratto è in `docs/reference/ricette.md`, «L'esecuzione e
//! l'annullamento» e «La prova».

use std::collections::BTreeSet;

use fub_abi::command::{
    CommandEffect, CommandOutcome, CommandPlan, CommandSpec, Failure, InvokeMode, Partial, Undo,
};
use fub_abi::error::PluginError;
use fub_abi::locale::Locale;
use fub_abi::model::DocId;
use fub_abi::text::{Arg, Strings, Text};
use fub_abi::traits::{CommandProvider, HostApi};
use serde_json::Value;

use super::format::{expand, spec, Problem, Recipe};
use crate::vocabulary::Ctx;

/// Fatto, ogni passo, e si annulla (o non c'era niente da annullare).
const N_DONE: &str = "recipes.run.done";
/// Fatto, ma un passo che scrive è tornato senza annullamento.
const N_NO_UNDO: &str = "recipes.run.no-undo";
/// Un passo dopo il primo è caduto; i passi prima si annullano.
const N_PARTIAL: &str = "recipes.run.partial";
/// Un passo dopo il primo è caduto, e i passi prima non si annullano.
const N_PARTIAL_NO_UNDO: &str = "recipes.run.partial-no-undo";
/// La voce del menu che annulla la ricetta.
const U_RUN: &str = "recipes.run.undo";
/// Il riassunto della prova: il titolo e i riassunti dei passi.
const P_RUN: &str = "recipes.plan.summary";
/// Il riassunto della prova quando un passo dopo il primo non si prova.
const P_STOPPED: &str = "recipes.plan.stopped";
/// Fra i riassunti dei passi nella prova.
const JOIN: &str = "; ";

/// Il comando di una ricetta: `recipe.<id>:run`, montato nel bundle
/// `recipe.<id>`.
///
/// Tiene la spec e l'insieme dei passi di sola lettura **del momento in cui è
/// nato**: sono le stesse letture del registro su cui la ricetta ha passato
/// [`check_against`](super::check_against), e la spec non cambia sotto i piedi
/// di chi l'ha adottata. Un comando di un passo che sparisce dopo dà
/// `UnknownCommand` al suo passo, che è ciò che deve succedere.
pub struct RecipeCommand {
    recipe: Recipe,
    spec: CommandSpec,
    /// I comandi dei passi che si dichiarano di sola lettura: tornare senza
    /// annullamento, per loro, vuol dire che non c'era niente da annullare.
    read_only: BTreeSet<String>,
}

impl RecipeCommand {
    /// Il comando della ricetta `recipe`, con le spec del registro vivo
    /// (`registry`): la portata della spec è quella dei passi, e un passo che
    /// il registro non conosce conta come una scrittura sul vault.
    pub fn new(recipe: Recipe, registry: &[CommandSpec]) -> Self {
        let spec = spec(&recipe, registry);
        let read_only = recipe
            .steps
            .iter()
            .filter(|step| {
                registry
                    .iter()
                    .any(|spec| spec.id == step.run && !spec.scope.writes)
            })
            .map(|step| step.run.clone())
            .collect();
        RecipeCommand {
            recipe,
            spec,
            read_only,
        }
    }

    /// La ricetta che questo comando fa.
    pub fn recipe(&self) -> &Recipe {
        &self.recipe
    }

    /// La spec del comando, la stessa che [`CommandProvider::commands`] rende.
    pub fn spec(&self) -> &CommandSpec {
        &self.spec
    }
}

impl CommandProvider for RecipeCommand {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![self.spec.clone()]
    }

    fn invoke(
        &self,
        command: &str,
        args: Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command != self.spec.id {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let ctx = crate::vocabulary::context(host)?;
        // Il modo non si passa ai passi: lo porta l'host (`run_command` in una
        // simulazione simula), quindi gli stessi `run_command` fanno la prova
        // in `DryRun` e il lavoro in `Apply`.
        if mode.is_dry_run() {
            let plan = plan(&self.recipe, &args, &ctx, |id, args| {
                host.run_command(id, args)
            })?;
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        apply(&self.recipe, &args, &ctx, &self.read_only, |id, args| {
            host.run_command(id, args)
        })
    }
}

/// Un problema degli argomenti, detto a chi ha invocato: `BadArgs` con la
/// frase del problema.
fn refused(problem: Problem) -> PluginError {
    PluginError::BadArgs(problem.message)
}

/// Il testo leggibile di un `Text` che arriva da un passo. Gli esiti annidati
/// arrivano già risolti dal kernel (col catalogo di chi li ha scritti); una
/// chiave nuda resta la chiave, brutta ma cercabile.
fn plain(text: &Text) -> String {
    let locale = Locale::default();
    Strings::none(&locale).render(text)
}

/// La nota su cui un passo lavorava, se i suoi argomenti ne nominano una: per
/// il link del guasto.
fn subject_of(args: &Value) -> Option<DocId> {
    args.get("doc").and_then(Value::as_str).map(DocId::new)
}

/// **La prova**: ogni passo in simulazione, con `run`, e i piani fusi.
///
/// `run` esegue un passo e deve farlo in `DryRun`: il comando passa
/// `host.run_command` di un host che simula, l'host e la CLI il loro modo di
/// invocare in simulazione. La prova non controlla il modo di `run`, perché
/// non lo vede: chi le passa un esecutore che scrive ha scritto.
///
/// I piani si fondono così: i riassunti dei passi in fila nel riassunto della
/// ricetta, i documenti senza doppioni nell'ordine in cui compaiono, le
/// modifiche in fila. Un passo che in simulazione non dà un piano (un comando
/// di sola lettura che apre una nota) non aggiunge niente.
///
/// Se il primo passo non si prova è l'errore, come per l'esecuzione: niente
/// succederebbe. Se non si prova un passo dopo, il piano è quello dei passi
/// prima e il riassunto dice quale passo si è fermato e perché: spesso è un
/// passo che dipende da un altro (una nota che il passo prima avrebbe
/// spostato), e la prova resta utile per i passi che ha visto.
///
/// La prova è **approssimata** quando un passo dipende da un altro: in
/// simulazione niente si sposta, quindi un passo dopo una rinomina vede la
/// nota dov'era.
pub fn plan(
    recipe: &Recipe,
    args: &Value,
    ctx: &Ctx,
    mut run: impl FnMut(&str, Value) -> Result<CommandOutcome, PluginError>,
) -> Result<CommandPlan, PluginError> {
    let steps = expand(recipe, args, ctx).map_err(refused)?;
    let mut summaries: Vec<String> = Vec::new();
    let mut docs: Vec<DocId> = Vec::new();
    let mut edits = Vec::new();
    let mut stopped: Option<(usize, String, PluginError)> = None;
    for (at, (id, step_args)) in steps.into_iter().enumerate() {
        match run(&id, step_args) {
            Ok(outcome) => {
                if let CommandEffect::Plan(step_plan) = outcome.effect {
                    if !step_plan.summary.is_empty() {
                        summaries.push(plain(&step_plan.summary));
                    }
                    for doc in step_plan.docs {
                        if !docs.contains(&doc) {
                            docs.push(doc);
                        }
                    }
                    edits.extend(step_plan.edits);
                }
            }
            Err(error) if at == 0 => return Err(error),
            Err(error) => {
                stopped = Some((at, id, error));
                break;
            }
        }
    }
    let title = Arg::text("title", recipe.title.as_str());
    let steps_said = Arg::text("steps", summaries.join(JOIN));
    let summary = match stopped {
        None => Text::message(P_RUN, vec![title, steps_said]),
        Some((at, id, error)) => Text::message(
            P_STOPPED,
            vec![
                title,
                steps_said,
                Arg::int("step", at as i64 + 1),
                Arg::text("command", id),
                Arg::text("error", plain(error.message())),
            ],
        ),
    };
    // `of_edits` mette fra i documenti quelli degli edit; `with_doc` aggiunge
    // gli altri (una nota rinominata, una creata) senza doppioni.
    Ok(docs
        .into_iter()
        .fold(CommandPlan::of_edits(summary, edits), CommandPlan::with_doc))
}

/// **L'esecuzione**: i passi in fila con `run`, e l'annullamento composto.
///
/// - Il primo passo cade: il suo errore, e niente è cambiato.
/// - Un passo dopo cade: `Ok`, con [`Partial`] (quanti passi, quanti riusciti,
///   il guasto), un avviso che nomina il passo, e l'annullamento dei passi
///   riusciti.
/// - L'annullamento sono le `steps` dell'annullamento di ogni passo riuscito,
///   dall'ultimo passo al primo, sotto il titolo della ricetta. Un passo che
///   scrive e torna senza annullamento lascia la ricetta senza (togliere metà
///   dei passi e lasciare l'altra sarebbe un annullamento che mente), e
///   l'avviso lo dice; uno di sola lettura (`read_only`) non aveva niente da
///   annullare.
/// - L'effetto è quello dell'ultimo passo riuscito.
fn apply(
    recipe: &Recipe,
    args: &Value,
    ctx: &Ctx,
    read_only: &BTreeSet<String>,
    mut run: impl FnMut(&str, Value) -> Result<CommandOutcome, PluginError>,
) -> Result<CommandOutcome, PluginError> {
    let steps = expand(recipe, args, ctx).map_err(refused)?;
    let attempted = steps.len();
    let mut done: Vec<(String, CommandOutcome)> = Vec::new();
    let mut failed: Option<(usize, String, Failure)> = None;
    for (at, (id, step_args)) in steps.into_iter().enumerate() {
        let subject = subject_of(&step_args);
        match run(&id, step_args) {
            Ok(outcome) => done.push((id, outcome)),
            Err(error) if at == 0 => return Err(error),
            Err(error) => {
                failed = Some((at, id, Failure { subject, error }));
                break;
            }
        }
    }

    let mut undo_steps = Vec::new();
    let mut whole = true;
    for (id, outcome) in done.iter().rev() {
        match &outcome.undo {
            Some(undo) => undo_steps.extend(undo.steps.iter().cloned()),
            None if read_only.contains(id) => {}
            None => whole = false,
        }
    }
    let undo = (whole && !undo_steps.is_empty()).then(|| Undo {
        label: Text::message(U_RUN, vec![Arg::text("title", recipe.title.as_str())]),
        steps: undo_steps,
    });
    let effect = done
        .last()
        .map_or(CommandEffect::Done, |(_, outcome)| outcome.effect.clone());

    let title = Arg::text("title", recipe.title.as_str());
    let (notify, partial) = match failed {
        None => {
            let key = if whole { N_DONE } else { N_NO_UNDO };
            (Text::message(key, vec![title]), None)
        }
        Some((at, id, failure)) => {
            let key = if whole { N_PARTIAL } else { N_PARTIAL_NO_UNDO };
            let notify = Text::message(
                key,
                vec![
                    title,
                    Arg::int("step", at as i64 + 1),
                    Arg::text("command", id),
                    Arg::text("error", plain(failure.error.message())),
                    Arg::int("done", done.len() as i64),
                ],
            );
            (notify, Partial::of(attempted, done.len(), vec![failure]))
        }
    };
    let mut outcome = CommandOutcome::notify(notify)
        .with_effect(effect)
        .partially(partial);
    outcome.undo = undo;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    //! Le regole della composizione con un esecutore finto: l'ordine
    //! dell'annullamento, il passo senza annullamento, il guasto a metà,
    //! l'effetto e la fusione dei piani. Il percorso col kernel vero, il
    //! `Guard` e il disco sta in `tests/recipes_e2e.rs`.

    use super::*;
    use fub_abi::command::{CommandReach, CommandScope, PlannedEdit, UndoStep};
    use fub_abi::edit::{EditRequest, Revision};
    use fub_abi::model::DocumentModel;

    const SOURCE: &str = "```fub-recipe
fub-recipe: 1
id: prova
title: Prova
description: Tre passi.
steps:
  - run: a.uno
    args: { doc: \"{{doc}}\" }
  - run: a.due
    args: { doc: \"{{doc}}\", n: 2 }
  - run: a.tre
";

    fn recipe() -> Recipe {
        use fub_abi::format::{DocumentSource, ParseContext};
        use fub_abi::FormatProvider;
        let source = format!("{SOURCE}```\n");
        let model: DocumentModel = fub_format_markdown::MarkdownProvider::new()
            .parse(
                &DocumentSource::Text(source.clone()),
                &ParseContext::obsidian("Recipes/Prova.md"),
            )
            .expect("il Markdown si legge");
        super::super::parse(&model, &source).expect("la ricetta si legge")
    }

    fn ctx() -> Ctx {
        crate::vocabulary::context_at(1_790_000_000_000, &Locale::default()).unwrap()
    }

    fn args() -> Value {
        serde_json::json!({ "doc": "Cartella/Nota.md" })
    }

    fn by(command: &str) -> Undo {
        Undo::by_command(Text::from(command), command, Value::Null)
    }

    fn edit(doc: &str) -> PlannedEdit {
        PlannedEdit::new(
            DocId::new(doc),
            EditRequest::new(Revision("r".into()), Vec::new()),
        )
    }

    fn undone_commands(undo: &Undo) -> Vec<&str> {
        undo.steps
            .iter()
            .map(|step| match step {
                UndoStep::Command { command, .. } => command.as_str(),
                UndoStep::Edit(_) => "edit",
            })
            .collect()
    }

    #[test]
    fn i_passi_girano_in_fila_e_l_annullamento_torna_dall_ultimo() {
        let mut ran = Vec::new();
        let outcome = apply(&recipe(), &args(), &ctx(), &BTreeSet::new(), |id, args| {
            ran.push((id.to_string(), args));
            let mut undo = by(&format!("undo.{id}"));
            undo.steps.push(UndoStep::Edit(edit("x.md")));
            Ok(CommandOutcome::done()
                .undoable(undo)
                .with_effect(CommandEffect::Navigate {
                    doc: DocId::new(format!("{id}.md")),
                }))
        })
        .expect("riesce");
        assert_eq!(
            ran,
            vec![
                (
                    "a.uno".to_string(),
                    serde_json::json!({ "doc": "Cartella/Nota.md" })
                ),
                (
                    "a.due".to_string(),
                    serde_json::json!({ "doc": "Cartella/Nota.md", "n": 2 })
                ),
                ("a.tre".to_string(), serde_json::json!({})),
            ]
        );
        let undo = outcome.undo.expect("si annulla");
        // L'ordine dentro un passo resta il suo; i passi tornano dall'ultimo.
        assert_eq!(
            undone_commands(&undo),
            [
                "undo.a.tre",
                "edit",
                "undo.a.due",
                "edit",
                "undo.a.uno",
                "edit"
            ]
        );
        assert_eq!(
            undo.label,
            Text::message(U_RUN, vec![Arg::text("title", "Prova")])
        );
        assert_eq!(
            outcome.effect,
            CommandEffect::Navigate {
                doc: DocId::new("a.tre.md")
            },
            "l'effetto è dell'ultimo passo"
        );
        assert_eq!(outcome.partial, None);
        assert_eq!(
            outcome.notify,
            Some(Text::message(N_DONE, vec![Arg::text("title", "Prova")]))
        );
    }

    #[test]
    fn il_primo_passo_che_cade_e_l_errore_e_basta() {
        let mut ran = 0;
        let error = apply(&recipe(), &args(), &ctx(), &BTreeSet::new(), |_, _| {
            ran += 1;
            Err(PluginError::NotFound(Text::from("Cartella/Nota.md")))
        })
        .expect_err("niente è successo");
        assert!(matches!(error, PluginError::NotFound(_)), "{error:?}");
        assert_eq!(ran, 1, "i passi dopo non girano");
    }

    #[test]
    fn un_passo_dopo_che_cade_lascia_i_primi_un_partial_e_il_loro_annullamento() {
        let mut ran = Vec::new();
        let outcome = apply(&recipe(), &args(), &ctx(), &BTreeSet::new(), |id, _| {
            ran.push(id.to_string());
            match id {
                "a.uno" => Ok(CommandOutcome::done().undoable(by("undo.a.uno"))),
                _ => Err(PluginError::UnknownCommand(Text::from(id))),
            }
        })
        .expect("a metà è un esito, non un errore");
        assert_eq!(ran, ["a.uno", "a.due"], "il terzo non si prova");
        let partial = outcome.partial.expect("a metà");
        assert_eq!((partial.attempted, partial.done), (3, 1));
        assert_eq!(partial.failures.len(), 1);
        assert_eq!(
            partial.failures[0].subject,
            Some(DocId::new("Cartella/Nota.md"))
        );
        assert!(matches!(
            partial.failures[0].error,
            PluginError::UnknownCommand(_)
        ));
        let undo = outcome.undo.expect("i passi riusciti si annullano");
        assert_eq!(undone_commands(&undo), ["undo.a.uno"]);
        let notify = outcome.notify.expect("l'avviso");
        let message = notify.as_message().expect("una frase del catalogo");
        assert_eq!(message.key, N_PARTIAL);
        assert_eq!(
            message.arg("command"),
            Some(&fub_abi::text::ArgValue::Text("a.due".into()))
        );
        assert_eq!(message.arg("step"), Some(&fub_abi::text::ArgValue::Int(2)));
    }

    #[test]
    fn un_passo_che_scrive_senza_annullamento_lascia_la_ricetta_senza() {
        let outcome = apply(&recipe(), &args(), &ctx(), &BTreeSet::new(), |id, _| {
            Ok(match id {
                "a.due" => CommandOutcome::done(),
                other => CommandOutcome::done().undoable(by(other)),
            })
        })
        .expect("riesce");
        assert_eq!(outcome.undo, None, "un annullamento a metà mentirebbe");
        let notify = outcome.notify.expect("l'avviso");
        assert_eq!(notify.as_message().expect("frase").key, N_NO_UNDO);

        // Lo stesso passo, se è di sola lettura, non aveva niente da annullare.
        let quiet: BTreeSet<String> = ["a.due".to_string()].into();
        let outcome = apply(&recipe(), &args(), &ctx(), &quiet, |id, _| {
            Ok(match id {
                "a.due" => CommandOutcome::done(),
                other => CommandOutcome::done().undoable(by(other)),
            })
        })
        .expect("riesce");
        assert_eq!(
            undone_commands(&outcome.undo.expect("si annulla")),
            ["a.tre", "a.uno"]
        );
    }

    #[test]
    fn senza_niente_da_annullare_non_c_e_una_voce_vuota() {
        let quiet: BTreeSet<String> = ["a.uno", "a.due", "a.tre"]
            .into_iter()
            .map(String::from)
            .collect();
        let outcome = apply(&recipe(), &args(), &ctx(), &quiet, |_, _| {
            Ok(CommandOutcome::done())
        })
        .expect("riesce");
        assert_eq!(outcome.undo, None);
        assert_eq!(outcome.notify.unwrap().as_message().unwrap().key, N_DONE);
    }

    #[test]
    fn gli_argomenti_sbagliati_sono_bad_args_prima_di_ogni_passo() {
        let mut ran = 0;
        let error = apply(
            &recipe(),
            &serde_json::json!({}),
            &ctx(),
            &BTreeSet::new(),
            |_, _| {
                ran += 1;
                Ok(CommandOutcome::done())
            },
        )
        .expect_err("manca la nota");
        assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
        assert_eq!(ran, 0);
    }

    fn planning(id: &str, docs: &[&str], edits: &[&str]) -> CommandOutcome {
        let plan = CommandPlan::of_edits(
            Text::from(format!("piano di {id}")),
            edits.iter().map(|doc| edit(doc)).collect(),
        );
        let plan = docs
            .iter()
            .fold(plan, |plan, doc| plan.with_doc(DocId::new(*doc)));
        CommandOutcome::done().with_effect(CommandEffect::Plan(plan))
    }

    #[test]
    fn la_prova_fonde_i_piani_dei_passi() {
        let plan = plan(&recipe(), &args(), &ctx(), |id, _| {
            Ok(match id {
                "a.uno" => planning(id, &["A.md"], &["A.md"]),
                "a.due" => planning(id, &["A.md", "B.md"], &["B.md"]),
                // Un passo che in simulazione non dà un piano non aggiunge
                // niente.
                _ => CommandOutcome::done(),
            })
        })
        .expect("la prova riesce");
        assert_eq!(plan.docs, vec![DocId::new("A.md"), DocId::new("B.md")]);
        assert_eq!(plan.edits.len(), 2, "le modifiche in fila");
        assert_eq!(
            plan.summary,
            Text::message(
                P_RUN,
                vec![
                    Arg::text("title", "Prova"),
                    Arg::text("steps", "piano di a.uno; piano di a.due"),
                ]
            )
        );
    }

    #[test]
    fn la_prova_che_si_ferma_dopo_il_primo_passo_lo_dice() {
        let plan = plan(&recipe(), &args(), &ctx(), |id, _| match id {
            "a.uno" => Ok(planning(id, &["A.md"], &[])),
            _ => Err(PluginError::NotFound(Text::from("Cartella/Nota.md"))),
        })
        .expect("i passi prima si vedono");
        assert_eq!(plan.docs, vec![DocId::new("A.md")]);
        let message = plan.summary.as_message().expect("frase");
        assert_eq!(message.key, P_STOPPED);
        assert_eq!(message.arg("step"), Some(&fub_abi::text::ArgValue::Int(2)));
        assert_eq!(
            message.arg("error"),
            Some(&fub_abi::text::ArgValue::Text("Cartella/Nota.md".into()))
        );

        let error = plan_first_fails();
        assert!(matches!(error, PluginError::PermissionDenied(_)));
    }

    fn plan_first_fails() -> PluginError {
        plan(&recipe(), &args(), &ctx(), |_, _| {
            Err(PluginError::PermissionDenied(Text::from("no")))
        })
        .expect_err("il primo passo che non si prova è l'errore")
    }

    #[test]
    fn la_spec_e_quella_della_ricetta_e_i_passi_quieti_vengono_dal_registro() {
        let registry = [
            CommandSpec::new("a.uno", Text::from("uno")).with_scope(CommandScope::read_only()),
            CommandSpec::new("a.due", Text::from("due"))
                .with_scope(CommandScope::writing(CommandReach::Document)),
        ];
        let command = RecipeCommand::new(recipe(), &registry);
        assert_eq!(command.spec().id, "recipe.prova:run");
        assert_eq!(command.commands(), vec![command.spec().clone()]);
        assert_eq!(
            command.read_only,
            ["a.uno".to_string()].into(),
            "a.tre non c'è: conta come scrittura"
        );
    }
}
