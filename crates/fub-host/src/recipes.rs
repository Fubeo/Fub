//! **Le ricette del vault, viste dall'host**: quali ci sono, quali sono
//! adottate su questa macchina, e il montaggio delle sole adottate.
//!
//! Una ricetta è una nota della cartella `recipes.folder` con un blocco
//! `fub-recipe` (il contratto è in `docs/reference/ricette.md`). Leggerla,
//! controllarla, eseguirla e provarla è di `fub_features::recipes`; qui sta ciò
//! che sa soltanto chi custodisce il vault:
//!
//! - **il consenso**: una ricetta si monta soltanto se è adottata con
//!   l'impronta del testo letto adesso (`VaultEntry::recipes_adopted`, il
//!   registro dei vault di **questa** macchina), se passa i controlli e se il
//!   suo `id` è unico. Ciò che gira è sempre la ricetta letta e adottata: un
//!   cambio della nota la smonta, e torna fra le proposte (`cambiata`);
//! - **la riconciliazione**: a ogni elenco e all'apertura del vault l'host
//!   rilegge la cartella, monta le adottate valide e smonta le altre;
//! - **il montaggio senza impostazioni**: il bundle `recipe.<id>` è una voce
//!   di una sorgente runtime (un [`BundleClaim`] della sessione), quindi
//!   montarlo e smontarlo non scrive `plugins.disabled` né altro nel vault, e
//!   la pagina dei componenti non lo può accendere o spegnere: lo fanno
//!   soltanto adottare e scartare.
//!
//! Adottare e scartare esistono soltanto come metodi di [`Host`], mai come
//! comandi del registro: un programma non si dà il consenso da solo.
//!
//! Senza la cargo feature `recipes` i tipi restano e i metodi di [`Host`]
//! esistono lo stesso: l'elenco è vuoto, e adottare, scartare e provare
//! rispondono `NotFound`.

use std::collections::BTreeMap;
use std::sync::Mutex;

use fub_abi::command::{CommandReach, CommandSurface};
use fub_abi::model::DocId;
use fub_abi::text::Text;
use serde::Serialize;

use crate::registry::BundleClaim;

/// A che punto è una ricetta su questa macchina.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum RecipeStatus {
    /// Nella cartella, mai adottata su questa macchina: non gira.
    #[serde(rename = "proposta")]
    Proposed,
    /// Adottata con l'impronta del testo di adesso, senza problemi: montata.
    #[serde(rename = "adottata")]
    Adopted,
    /// Adottata, ma la nota è cambiata dopo: smontata finché la persona non la
    /// riguarda.
    #[serde(rename = "cambiata")]
    Changed,
    /// Non si legge, o non passa i controlli: non si monta, adottata o no.
    #[serde(rename = "problemi")]
    Problems,
}

/// Un problema di una ricetta, o del vault (`troppe`), nella lingua di chi
/// guarda.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecipeProblem {
    /// Il codice stabile del contratto: `comando-sconosciuto`, `id-ripetuto`…
    pub code: String,
    /// Il campo del blocco (`steps[1].run`), vuoto per il blocco intero.
    pub field: String,
    /// La riga della nota, da 1; `None` quando non c'è un blocco.
    pub line: Option<u32>,
    /// La frase per chi legge.
    pub message: Text,
}

/// Un passo di una ricetta, con ciò che il registro vivo dice del comando.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecipeStepInfo {
    /// L'id del comando del passo.
    pub run: String,
    /// Il titolo del comando nella lingua di chi guarda; `None` se il registro
    /// non lo conosce (e allora la ricetta ha il problema
    /// `comando-sconosciuto`).
    pub title: Option<Text>,
    /// Gli argomenti com'erano scritti, segnaposto compresi.
    pub args: serde_json::Map<String, serde_json::Value>,
    /// Se il comando scrive.
    pub writes: bool,
    /// Fin dove arriva il comando; `None` se il registro non lo conosce.
    pub reach: Option<CommandReach>,
    /// Se il comando si annulla.
    pub reversible: bool,
}

/// Una nota della cartella delle ricette che è una ricetta (ha un blocco
/// `fub-recipe`), con il suo stato su questa macchina.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RecipeInfo {
    /// L'`id` del blocco; `None` se il blocco non si legge.
    pub id: Option<String>,
    /// Il titolo scritto da chi ha fatto la ricetta; il nome della nota se il
    /// blocco non si legge.
    pub title: String,
    /// La descrizione scritta da chi ha fatto la ricetta.
    pub description: String,
    /// La nota della ricetta.
    pub doc: DocId,
    pub status: RecipeStatus,
    /// L'impronta del testo letto adesso: è ciò che la persona adotta, e ciò
    /// che [`Host::adopt_recipe`] vuole indietro. `None` se il blocco non si
    /// legge.
    pub fingerprint: Option<String>,
    pub problems: Vec<RecipeProblem>,
    pub steps: Vec<RecipeStepInfo>,
    /// Il comando che la ricetta diventa: `recipe.<id>:run`.
    pub command: Option<String>,
    pub keybinding: Option<String>,
    pub surfaces: Vec<CommandSurface>,
    /// Se il suo bundle `recipe.<id>` è montato adesso.
    pub mounted: bool,
    /// Se il permesso `fub:run-command` del bundle è acceso. Una ricetta
    /// montata col permesso spento a mano dalla persona c'è, ma il `Guard`
    /// rifiuta i suoi passi: questa riga lo dice.
    pub allowed: bool,
}

/// L'elenco delle ricette del vault, e i problemi del vault intero (oggi
/// soltanto `troppe`, uno per vault e non per nota).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct RecipeList {
    pub recipes: Vec<RecipeInfo>,
    pub problems: Vec<RecipeProblem>,
}

/// Lo stato delle ricette di una sessione: chi è montato con quale impronta, e
/// l'identità della sorgente runtime che possiede i bundle `recipe.<id>`.
///
/// Vive quanto la sessione, come il registro dei bundle: un vault riaperto
/// riparte senza ricette montate, e la riconciliazione dell'apertura le
/// rimonta. Il `Mutex` è anche il **turno**: due riconciliazioni dello stesso
/// vault non si accavallano. Non si tiene mai il lock del workspace mentre lo
/// si tiene: ogni lettura e ogni montaggio prendono il proprio prestito.
#[derive(Default)]
#[cfg_attr(not(feature = "recipes"), allow(dead_code))]
pub struct SessionRecipes {
    /// id della ricetta → impronta della ricetta montata.
    mounted: Mutex<BTreeMap<String, String>>,
    claim: BundleClaim,
}

#[cfg(feature = "recipes")]
pub(crate) use live::{adopt, discard, list, reconcile_at_open, simulate};

#[cfg(not(feature = "recipes"))]
pub(crate) use off::{adopt, discard, list, reconcile_at_open, simulate};

/// Senza la feature: i metodi ci sono, le ricette no.
#[cfg(not(feature = "recipes"))]
mod off {
    use camino::Utf8Path;
    use fub_abi::command::CommandPlan;
    use fub_abi::error::PluginError;

    use super::RecipeList;
    use crate::Host;

    fn absent() -> PluginError {
        PluginError::NotFound("Questo Fub è compilato senza le ricette.".into())
    }

    pub(crate) fn list(host: &Host, vault: Option<&str>) -> Result<RecipeList, PluginError> {
        host.session_root(vault)?;
        Ok(RecipeList::default())
    }

    pub(crate) fn adopt(
        _host: &Host,
        _vault: Option<&str>,
        _id: &str,
        _fingerprint: &str,
    ) -> Result<(), PluginError> {
        Err(absent())
    }

    pub(crate) fn discard(
        _host: &Host,
        _vault: Option<&str>,
        _id: &str,
    ) -> Result<(), PluginError> {
        Err(absent())
    }

    pub(crate) fn simulate(
        _host: &Host,
        _vault: Option<&str>,
        _id: &str,
        _args: serde_json::Value,
    ) -> Result<CommandPlan, PluginError> {
        Err(absent())
    }

    pub(crate) fn reconcile_at_open(_host: &Host, _root: &Utf8Path) {}
}

#[cfg(feature = "recipes")]
mod live {
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::Arc;

    use camino::Utf8Path;
    use fub_abi::command::{CommandPlan, CommandSpec, InvokeMode};
    use fub_abi::error::PluginError;
    use fub_abi::model::DocId;
    use fub_abi::options::permission::RUN_COMMAND;
    use fub_abi::settings::{permission_key, SettingValue};
    use fub_abi::traits::{
        EntryKind, FolderScope, IndexQuery, IndexResult, Plugin, PluginManifest, PluginPermissions,
    };
    use fub_features::recipes::{
        check_against, check_unique, fingerprint, parse, plan, recipes_folder, spec, Problem,
        ProblemCode, Recipe, RecipeCommand, RECIPES_ID, RECIPES_MAX, RECIPE_NS,
    };
    use fub_kernel::Trust;

    use super::{
        RecipeInfo, RecipeList, RecipeProblem, RecipeStatus, RecipeStepInfo, SessionRecipes,
    };
    use crate::registry::{Bundle, BundleKind, Registrar};
    use crate::{Host, OnlyProviders};

    /// Il bundle di una ricetta adottata: `recipe.<id>`, di fiducia
    /// `Community`, che dichiara `fub:run-command` con i comandi dei suoi passi
    /// e niente altro (scrivono i comandi che invoca, ognuno col suo recinto),
    /// e porta il [`RecipeCommand`] della ricetta letta.
    struct RecipeBundle {
        recipe: Recipe,
        /// Le spec del registro vivo quando la ricetta è stata controllata:
        /// la portata della spec del comando nasce da loro.
        registry: Vec<CommandSpec>,
    }

    fn bundle_id(id: &str) -> String {
        format!("{RECIPE_NS}{id}")
    }

    /// I comandi dei passi, ognuno una volta, nell'ordine in cui compaiono.
    fn step_commands(recipe: &Recipe) -> Vec<String> {
        let mut seen = BTreeSet::new();
        recipe
            .steps
            .iter()
            .filter(|step| seen.insert(step.run.clone()))
            .map(|step| step.run.clone())
            .collect()
    }

    impl Bundle for RecipeBundle {
        fn manifest(&self) -> PluginManifest {
            let id = bundle_id(&self.recipe.id);
            let mut permissions = PluginPermissions::of(&[RUN_COMMAND]);
            permissions
                .granted
                .set(RUN_COMMAND, serde_json::json!(step_commands(&self.recipe)));
            PluginManifest::new(id, self.recipe.title.as_str())
                .granting(permissions)
                // Il catalogo delle ricette: gli avvisi, l'annullamento e gli
                // errori del comando sono sue chiavi.
                .speaking("it", fub_features::recipes::catalog())
        }

        fn kind(&self) -> BundleKind {
            BundleKind::Recipe
        }

        fn trust(&self) -> Trust {
            Trust::Community
        }

        fn plugin(&self) -> Box<dyn Plugin> {
            OnlyProviders::boxed(self.manifest())
        }

        fn register(&self, registrar: &mut Registrar<'_>) -> Vec<String> {
            let command = RecipeCommand::new(self.recipe.clone(), &self.registry);
            match registrar.register_command_provider(Box::new(command)) {
                Ok(()) => Vec::new(),
                Err(error) => vec![format!("recipe command NOT registered: {error}")],
            }
        }
    }

    /// Una nota della cartella che ha un blocco, con la ricetta o i problemi
    /// della sua lettura.
    type Note = (DocId, Result<Recipe, Vec<Problem>>);

    /// Una nota letta dalla riconciliazione: ciò che si mostra, e la ricetta
    /// se il blocco si legge.
    struct Read {
        info: RecipeInfo,
        recipe: Option<Recipe>,
    }

    /// Ciò che serve alla riconciliazione, letto in un prestito solo.
    struct Snapshot {
        folder: String,
        docs: Vec<DocId>,
        commands: Vec<CommandSpec>,
    }

    fn problem_of(problem: Problem) -> RecipeProblem {
        RecipeProblem {
            code: problem.code.as_str().to_string(),
            field: problem.field,
            line: problem.line,
            message: problem.message,
        }
    }

    fn stem(doc: &DocId) -> String {
        let name = doc.as_str().rsplit('/').next().unwrap_or(doc.as_str());
        match name.rsplit_once('.') {
            Some((stem, _)) if !stem.is_empty() => stem.to_string(),
            _ => name.to_string(),
        }
    }

    fn state(host: &Host, vault: Option<&str>) -> Result<Arc<SessionRecipes>, PluginError> {
        host.in_session(vault, |session| Ok(Arc::clone(session.recipes())))
    }

    /// Il componente «Ricette» è acceso in questo vault? Spento, le ricette
    /// non si leggono e non girano: è il suo interruttore.
    fn component_on(host: &Host, vault: Option<&str>) -> Result<bool, PluginError> {
        Ok(host
            .bundles(vault)?
            .iter()
            .any(|bundle| bundle.id == RECIPES_ID && bundle.mounted))
    }

    fn snapshot(host: &Host, vault: Option<&str>) -> Result<Snapshot, PluginError> {
        host.recipes_read(vault, |ws| {
            let folder = ws.with_read_host(RECIPES_ID, |read| recipes_folder(read));
            // L'anagrafe, non l'indice: è intera già alla fine della scansione,
            // quindi la riconciliazione dell'apertura non aspetta che
            // l'indicizzazione abbia letto le note.
            let docs = match ws.query_index(IndexQuery::Entries {
                of_kind: Some(EntryKind::Document),
                within: Some(FolderScope {
                    path: folder.clone(),
                    descendants: true,
                }),
                page: None,
            })? {
                IndexResult::Entries(page) => {
                    page.items.into_iter().map(|entry| entry.id).collect()
                }
                other => {
                    return Err(PluginError::Internal(
                        format!("l'anagrafe ha risposto fuori tema: {other:?}").into(),
                    ))
                }
            };
            Ok(Snapshot {
                folder,
                docs,
                commands: ws.commands(),
            })
        })
    }

    /// Le impronte adottate su questa macchina per il vault di `root`.
    fn adopted(host: &Host, root: &Utf8Path) -> BTreeMap<String, String> {
        host.vault_registry()
            .list()
            .into_iter()
            .find(|entry| entry.root == root.as_str())
            .map(|entry| entry.recipes_adopted)
            .unwrap_or_default()
    }

    /// Legge le note della cartella, in ordine di percorso, fino a
    /// [`RECIPES_MAX`] ricette. Una nota senza blocco non è una ricetta e non
    /// conta; una nota che non si legge si salta, col suo avviso nel log.
    fn read_folder(
        host: &Host,
        vault: Option<&str>,
        docs: &[DocId],
    ) -> (Vec<Note>, bool) {
        let mut out = Vec::new();
        for doc in docs {
            let read = host
                .read_document(vault, doc)
                .and_then(|(source, _)| host.read_model(vault, doc).map(|model| (source, model)));
            let (source, model) = match read {
                Ok(read) => read,
                Err(error) => {
                    tracing::warn!(target: "fub.host", doc = %doc, "recipe note unreadable: {error}");
                    continue;
                }
            };
            let parsed = parse(&model, &source);
            if let Err(problems) = &parsed {
                if problems
                    .iter()
                    .all(|problem| problem.code == ProblemCode::BloccoAssente)
                {
                    continue;
                }
            }
            if out.len() == RECIPES_MAX {
                return (out, true);
            }
            out.push((doc.clone(), parsed));
        }
        (out, false)
    }

    /// **La riconciliazione**: rilegge la cartella, decide lo stato di ogni
    /// ricetta, monta le adottate valide con l'impronta giusta e smonta le
    /// altre. Gira col turno della sessione preso (`mounted`).
    fn reconcile(
        host: &Host,
        vault: Option<&str>,
        recipes: &SessionRecipes,
        mounted: &mut BTreeMap<String, String>,
    ) -> Result<(Vec<Read>, Vec<RecipeProblem>), PluginError> {
        let root = host.session_root(vault)?;
        if !component_on(host, vault)? {
            for id in mounted.keys().cloned().collect::<Vec<_>>() {
                unmount(host, vault, recipes, &id);
                mounted.remove(&id);
            }
            return Ok((Vec::new(), Vec::new()));
        }
        let snapshot = snapshot(host, vault)?;
        let adopted = adopted(host, &root);
        let (notes, too_many) = read_folder(host, vault, &snapshot.docs);
        let bundles = host.bundles(vault)?;

        let parsed: Vec<&Recipe> = notes
            .iter()
            .filter_map(|(_, parsed)| parsed.as_ref().ok())
            .collect();
        let mut repeated = check_unique(&parsed).into_iter();

        let mut reads = Vec::new();
        for (doc, parsed) in notes {
            let read = match parsed {
                Err(problems) => Read {
                    info: RecipeInfo {
                        id: None,
                        title: stem(&doc),
                        description: String::new(),
                        doc,
                        status: RecipeStatus::Problems,
                        fingerprint: None,
                        problems: problems.into_iter().map(problem_of).collect(),
                        steps: Vec::new(),
                        command: None,
                        keybinding: None,
                        surfaces: Vec::new(),
                        mounted: false,
                        allowed: false,
                    },
                    recipe: None,
                },
                Ok(recipe) => {
                    let mut problems: Vec<Problem> =
                        repeated.next().flatten().into_iter().collect();
                    let bundle = bundle_id(&recipe.id);
                    let occupied = bundles.iter().any(|known| known.id == bundle)
                        && !host.bundle_is_owned(vault, &bundle, &recipes.claim)?;
                    if occupied {
                        problems.push(Problem::occupied_id(&recipe));
                    }
                    problems.extend(check_against(&recipe, &snapshot.commands));
                    let print = fingerprint(&recipe);
                    let status = if !problems.is_empty() {
                        RecipeStatus::Problems
                    } else {
                        match adopted.get(&recipe.id) {
                            Some(seen) if *seen == print => RecipeStatus::Adopted,
                            Some(_) => RecipeStatus::Changed,
                            None => RecipeStatus::Proposed,
                        }
                    };
                    Read {
                        info: RecipeInfo {
                            id: Some(recipe.id.clone()),
                            title: recipe.title.clone(),
                            description: recipe.description.clone(),
                            doc,
                            status,
                            fingerprint: Some(print),
                            problems: problems.into_iter().map(problem_of).collect(),
                            steps: steps_of(&recipe, &snapshot.commands),
                            command: Some(recipe.command_id()),
                            keybinding: recipe.keybinding.clone(),
                            surfaces: recipe.surfaces.clone(),
                            mounted: false,
                            allowed: false,
                        },
                        recipe: Some(recipe),
                    }
                }
            };
            reads.push(read);
        }

        // Ciò che deve girare: le adottate con l'impronta di adesso e senza
        // problemi. Tutto il resto, se è montato, si smonta, compresa una
        // ricetta montata con un'impronta che non è più quella della nota.
        let wanted: BTreeMap<String, (&str, &Recipe)> = reads
            .iter()
            .filter(|read| read.info.status == RecipeStatus::Adopted)
            .filter_map(|read| {
                let recipe = read.recipe.as_ref()?;
                let print = read.info.fingerprint.as_deref()?;
                Some((recipe.id.clone(), (print, recipe)))
            })
            .collect();
        for (id, print) in mounted.clone() {
            let keep = wanted.get(&id).is_some_and(|(want, _)| *want == print)
                && host.is_bundle_active(vault, &bundle_id(&id), &recipes.claim)?;
            if !keep {
                unmount(host, vault, recipes, &id);
                mounted.remove(&id);
            }
        }
        for (id, (print, recipe)) in &wanted {
            if mounted.contains_key(id) {
                continue;
            }
            match mount(host, vault, recipes, recipe, &snapshot.commands) {
                Ok(()) => {
                    mounted.insert(id.clone(), print.to_string());
                }
                Err(error) => {
                    tracing::error!(target: "fub.host", recipe = %id, "recipe not mounted: {error}");
                }
            }
        }

        // Montata e permesso: lette dopo il montaggio, dal registro e dalle
        // impostazioni vive; i messaggi nella lingua di chi guarda.
        let mut vault_problems: Vec<RecipeProblem> = Vec::new();
        if too_many {
            vault_problems.push(problem_of(Problem::too_many()));
        }
        host.recipes_read(vault, |ws| {
            for read in &mut reads {
                if let Some(id) = read.info.id.clone() {
                    read.info.mounted = mounted.contains_key(&id);
                    read.info.allowed = read.info.mounted
                        && matches!(
                            ws.setting(&permission_key(&bundle_id(&id), RUN_COMMAND)),
                            Ok(SettingValue::Toggle(true))
                        );
                }
                for problem in &mut read.info.problems {
                    ws.localize_as(RECIPES_ID, &mut problem.message);
                }
            }
            for problem in &mut vault_problems {
                ws.localize_as(RECIPES_ID, &mut problem.message);
            }
            Ok(())
        })?;
        tracing::debug!(
            target: "fub.host",
            folder = %snapshot.folder,
            recipes = reads.len(),
            mounted = mounted.len(),
            "recipes reconciled"
        );
        Ok((reads, vault_problems))
    }

    fn steps_of(recipe: &Recipe, commands: &[CommandSpec]) -> Vec<RecipeStepInfo> {
        recipe
            .steps
            .iter()
            .map(|step| {
                let spec = commands.iter().find(|spec| spec.id == step.run);
                RecipeStepInfo {
                    run: step.run.clone(),
                    title: spec.map(|spec| spec.title.clone()),
                    args: step.args.clone(),
                    writes: spec.is_some_and(|spec| spec.scope.writes),
                    reach: spec.map(|spec| spec.scope.reach),
                    reversible: spec.is_some_and(|spec| spec.scope.reversible),
                }
            })
            .collect()
    }

    /// Monta il bundle della ricetta come voce della sorgente runtime della
    /// sessione: niente `plugins.disabled`, niente impostazioni del vault. Se
    /// l'accensione fallisce la voce si dimentica.
    fn mount(
        host: &Host,
        vault: Option<&str>,
        recipes: &SessionRecipes,
        recipe: &Recipe,
        registry: &[CommandSpec],
    ) -> Result<(), PluginError> {
        let id = bundle_id(&recipe.id);
        let bundle = Arc::new(RecipeBundle {
            recipe: recipe.clone(),
            registry: registry.to_vec(),
        });
        host.remember_claimed_bundle(vault, bundle, &recipes.claim)?;
        if let Err(error) = host.set_bundle_active(vault, &id, &recipes.claim, true) {
            if let Err(forget) = host.forget_bundle(vault, &id, &recipes.claim) {
                tracing::error!(target: "fub.host", recipe = %id, "recipe not forgotten: {forget}");
            }
            return Err(error);
        }
        Ok(())
    }

    /// Smonta e dimentica il bundle della ricetta, se è della sessione. Gli
    /// errori vanno nel log: smontare non si annulla.
    fn unmount(host: &Host, vault: Option<&str>, recipes: &SessionRecipes, id: &str) {
        let bundle = bundle_id(id);
        match host.set_bundle_active(vault, &bundle, &recipes.claim, false) {
            Ok(errors) => {
                for error in errors {
                    tracing::error!(target: "fub.host", recipe = %bundle, "recipe unmount: {error}");
                }
            }
            Err(error) => {
                tracing::error!(target: "fub.host", recipe = %bundle, "recipe not unmounted: {error}");
                return;
            }
        }
        if host
            .bundle_is_owned(vault, &bundle, &recipes.claim)
            .unwrap_or(false)
        {
            if let Err(error) = host.forget_bundle(vault, &bundle, &recipes.claim) {
                tracing::error!(target: "fub.host", recipe = %bundle, "recipe not forgotten: {error}");
            }
        }
    }

    fn turn(
        recipes: &SessionRecipes,
    ) -> Result<std::sync::MutexGuard<'_, BTreeMap<String, String>>, PluginError> {
        recipes
            .mounted
            .lock()
            .map_err(|_| PluginError::Internal("il turno delle ricette è avvelenato".into()))
    }

    pub(crate) fn list(host: &Host, vault: Option<&str>) -> Result<RecipeList, PluginError> {
        let recipes = state(host, vault)?;
        let mut mounted = turn(&recipes)?;
        let (reads, problems) = reconcile(host, vault, &recipes, &mut mounted)?;
        Ok(RecipeList {
            recipes: reads.into_iter().map(|read| read.info).collect(),
            problems,
        })
    }

    pub(crate) fn reconcile_at_open(host: &Host, root: &Utf8Path) {
        if let Err(error) = list(host, Some(root.as_str())) {
            tracing::error!(target: "fub.host", "recipes not reconciled at open: {error}");
        }
    }

    fn not_found(id: &str) -> PluginError {
        PluginError::NotFound(format!("Nessuna ricetta con id `{id}` in questo vault.").into())
    }

    /// La sola ricetta del vault con questo `id`, se c'è.
    fn the_one<'r>(reads: &'r [Read], id: &str) -> Result<&'r Read, PluginError> {
        let mut found = reads
            .iter()
            .filter(|read| read.info.id.as_deref() == Some(id));
        let first = found.next().ok_or_else(|| not_found(id))?;
        Ok(first)
    }

    /// Una ricetta con problemi non si adotta e non si prova: l'errore è il
    /// suo primo problema.
    fn refuse_problems(read: &Read) -> Result<(), PluginError> {
        match read.info.problems.first() {
            None => Ok(()),
            Some(problem) => Err(PluginError::BadArgs(problem.message.clone())),
        }
    }

    pub(crate) fn adopt(
        host: &Host,
        vault: Option<&str>,
        id: &str,
        seen: &str,
    ) -> Result<(), PluginError> {
        let root = host.session_root(vault)?;
        let recipes = state(host, vault)?;
        let mut mounted = turn(&recipes)?;
        let (reads, _) = reconcile(host, vault, &recipes, &mut mounted)?;
        if !component_on(host, vault)? {
            return Err(not_found(id));
        }
        let read = the_one(&reads, id)?;
        refuse_problems(read)?;
        if read.info.fingerprint.as_deref() != Some(seen) {
            return Err(PluginError::Conflict(
                format!(
                    "La ricetta `{id}` è cambiata dopo che l'hai guardata: rileggila prima di accenderla."
                )
                .into(),
            ));
        }
        let before = adopted(host, &root).get(id).cloned();
        let registry = host.vault_registry();
        registry.adopt_recipe(&root, id, seen)?;
        let undo = |host: &Host, mounted: &mut BTreeMap<String, String>| {
            let restored = match &before {
                Some(print) => registry.adopt_recipe(&root, id, print),
                None => registry.forget_recipe(&root, id),
            };
            if let Err(error) = restored {
                tracing::error!(target: "fub.host", recipe = %id, "adoption not rolled back: {error}");
            }
            if let Err(error) = reconcile(host, vault, &recipes, mounted) {
                tracing::error!(target: "fub.host", recipe = %id, "recipes not reconciled: {error}");
            }
        };
        if let Err(error) = reconcile(host, vault, &recipes, &mut mounted) {
            undo(host, &mut mounted);
            return Err(error);
        }
        if !mounted.contains_key(id) {
            undo(host, &mut mounted);
            return Err(PluginError::Internal(
                format!("La ricetta `{id}` non si è montata: i dettagli sono nel log.").into(),
            ));
        }
        // Adottare è il consenso: il permesso del bundle si accende dalla
        // porta della persona, come lo accenderebbe lei nella pagina dei
        // permessi.
        if let Err(error) = host.set_setting_for_user(
            vault,
            &permission_key(&bundle_id(id), RUN_COMMAND),
            SettingValue::Toggle(true),
        ) {
            undo(host, &mut mounted);
            return Err(error);
        }
        Ok(())
    }

    pub(crate) fn discard(host: &Host, vault: Option<&str>, id: &str) -> Result<(), PluginError> {
        let root = host.session_root(vault)?;
        let recipes = state(host, vault)?;
        let mut mounted = turn(&recipes)?;
        let was_adopted = adopted(host, &root).contains_key(id);
        if !was_adopted && !mounted.contains_key(id) {
            return Err(not_found(id));
        }
        if was_adopted {
            host.vault_registry().forget_recipe(&root, id)?;
        }
        if mounted.contains_key(id) {
            unmount(host, vault, &recipes, id);
            mounted.remove(id);
        }
        reconcile(host, vault, &recipes, &mut mounted).map(drop)
    }

    pub(crate) fn simulate(
        host: &Host,
        vault: Option<&str>,
        id: &str,
        args: serde_json::Value,
    ) -> Result<CommandPlan, PluginError> {
        let (recipe, commands) = {
            let recipes = state(host, vault)?;
            let mut mounted = turn(&recipes)?;
            let (reads, _) = reconcile(host, vault, &recipes, &mut mounted)?;
            if !component_on(host, vault)? {
                return Err(not_found(id));
            }
            let read = the_one(&reads, id)?;
            refuse_problems(read)?;
            let recipe = read.recipe.clone().ok_or_else(|| not_found(id))?;
            (recipe, host.recipes_read(vault, |ws| Ok(ws.commands()))?)
        };
        // Gli argomenti come li controllerebbe il registro davanti al comando
        // della ricetta: la prova non accetta ciò che l'esecuzione rifiuta.
        let localized = |mut error: PluginError| {
            let _ = host.recipes_read(vault, |ws| {
                ws.localize_as(RECIPES_ID, &mut error);
                Ok(())
            });
            error
        };
        spec(&recipe, &commands)
            .validate_args(&args)
            .map_err(localized)?;
        let ctx = host.recipes_read(vault, |ws| {
            fub_features::vocabulary::context_at(ws.now_unix_millis(), &ws.locale())
        })?;
        // I passi come li farebbe la persona, in simulazione: ognuno col suo
        // prestito, nessun lock tenuto fra un passo e l'altro.
        let mut plan = plan(&recipe, &args, &ctx, |command, step_args| {
            host.invoke_user_command(vault, command, step_args, InvokeMode::DryRun)
        })
        .map_err(localized)?;
        host.recipes_read(vault, |ws| {
            ws.localize_as(RECIPES_ID, &mut plan);
            Ok(())
        })?;
        Ok(plan)
    }
}
