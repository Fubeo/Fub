//! Il **correttore**: ortografia, suggerimenti e regole grammaticali per la
//! prosa di qualunque editor, dal motore di WordCraft.
//!
//! # Chi fa cosa
//!
//! Il motore è `wordcraft-proof`, copiato senza modifiche in
//! `vendor/wordcraft/` (vedi `UPSTREAM.md` lì): riceve un testo e una lingua e
//! restituisce i problemi con l'intervallo in byte, la specie, il messaggio e i
//! suggerimenti. Non sa niente di Markdown, di CodeMirror o di DOCX.
//!
//! Questo modulo è la porta di Fub verso quel motore: una route privata del
//! canale dati (`IndexQuery::Custom` con `ns = "fub.proof"`), con versione e
//! campi chiusi come la base e il foglio, più le impostazioni e i comandi del
//! dizionario personale. Chi decide **quale** testo è prosa è l'adattatore
//! della superficie, nella shell: il Markdown esclude sintassi, codice e
//! collegamenti, un documento ricco darà i paragrafi. L'adattatore conserva la
//! corrispondenza fra i propri segmenti e il sorgente; qui gli offset sono
//! soltanto quelli del segmento ricevuto.
//!
//! # Il dizionario personale ha un owner solo
//!
//! È l'impostazione [`WORDS_KEY`] di questo componente, del vault. La scrivono
//! [`WORD_ADD`] e [`WORD_REMOVE`], che la validano con la stessa regola del
//! motore ([`wordcraft_proof::custom_word`]); la shell la legge una volta e la
//! manda con ogni richiesta, e la regola «una parola del dizionario è
//! corretta» la applica [`check`]. Il dizionario globale del motore
//! (`wordcraft_proof::add_word`) non si usa: vale per il processo intero, e due
//! vault aperti si mescolerebbero.
//!
//! # I dizionari installati sono della macchina
//!
//! L'inglese ha la lista Moby inclusa nel motore. Le altre lingue con
//! ortografia leggono un dizionario Hunspell installato sul sistema
//! (`it_IT.aff`/`it_IT.dic` e simili), che il motore non include: quello
//! italiano è sotto GPL. Leggerlo è un accesso al disco fuori dal vault, e lo
//! decide chi monta: [`ProofIndex::with_machine_dictionaries`] lo concede,
//! [`ProofIndex::bundled_only`] no. Senza dizionario la lingua conserva le
//! regole grammaticali e la risposta nomina il dizionario che manca.

use std::collections::HashSet;

use fub_abi::command::{
    Args, CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode, ParamKind, ParamSpec,
};
use fub_abi::error::PluginError;
use fub_abi::settings::{SettingKind, SettingSpec, SettingValue};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind,
    QueryRoute,
};
use fub_abi::ui::UiOption;
use fub_abi::{DocId, DocumentModel};
use serde::{Deserialize, Serialize};
use wordcraft_proof::{IssueKind, Options, ProofLang};

/// L'id del componente, e il namespace della sua query.
pub const PROOF_ID: &str = "fub.proof";

/// La lingua della prosa quando il documento non ne dichiara una.
pub const LANGUAGE_KEY: &str = "proof.language";
/// Le regole grammaticali, oltre all'ortografia.
pub const GRAMMAR_KEY: &str = "proof.grammar";
/// Le parole in maiuscolo (`RAI`, `NASA`) contano come corrette.
pub const IGNORE_UPPERCASE_KEY: &str = "proof.ignore-uppercase";
/// Le parole con cifre (`mp3`, `B2B`) contano come corrette.
pub const IGNORE_NUMBERS_KEY: &str = "proof.ignore-numbers";
/// Il dizionario personale.
pub const WORDS_KEY: &str = "proof.words";

/// Aggiunge una parola al dizionario personale.
pub const WORD_ADD: &str = "proof.word.add";
/// Toglie una parola dal dizionario personale.
pub const WORD_REMOVE: &str = "proof.word.remove";

/// Il valore di [`LANGUAGE_KEY`] che segue la lingua dell'interfaccia.
pub const LANGUAGE_AUTO: &str = "auto";

/// Le lingue che il motore sa correggere, nell'ordine dell'impostazione.
const LANGUAGES: &[(&str, ProofLang)] = &[
    ("it", ProofLang::It),
    ("en", ProofLang::En),
    ("pt", ProofLang::Pt),
    ("pl", ProofLang::Pl),
    ("cs", ProofLang::Cs),
    ("hr", ProofLang::Hr),
    ("ru", ProofLang::Ru),
    ("tr", ProofLang::Tr),
];

/// Quanti segmenti per richiesta.
pub const MAX_SEGMENTS: usize = 512;
/// Quanti byte di testo per segmento.
pub const MAX_SEGMENT_BYTES: usize = 64 * 1024;
/// Quanti byte di testo per richiesta, sommando i segmenti.
pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
/// Quante parole di dizionario personale per richiesta.
pub const MAX_WORDS: usize = 10_000;
/// Quanti suggerimenti per parola.
pub const MAX_SUGGESTIONS: usize = 5;
/// Per quante parole sbagliate di una richiesta si calcolano i suggerimenti.
/// Le altre arrivano senza: cercarli in un dizionario grande costa, e una
/// pagina piena di errori non deve bloccare la risposta.
pub const MAX_SUGGESTED_WORDS: usize = 64;

/// Quali dizionari può leggere il motore.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Dictionaries {
    /// Soltanto quelli inclusi nel motore: l'inglese.
    Bundled,
    /// Anche quelli Hunspell installati sulla macchina.
    Machine,
}

/// La route del correttore.
pub struct ProofIndex {
    dictionaries: Dictionaries,
}

impl ProofIndex {
    /// Il correttore con i dizionari Hunspell installati sulla macchina. Lo
    /// costruisce chi monta, che è il solo a poter concedere una lettura fuori
    /// dal vault.
    pub fn with_machine_dictionaries() -> Self {
        ProofIndex {
            dictionaries: Dictionaries::Machine,
        }
    }

    /// Il correttore che non legge niente fuori dal processo: inglese
    /// completo, regole grammaticali per le altre lingue.
    pub fn bundled_only() -> Self {
        ProofIndex {
            dictionaries: Dictionaries::Bundled,
        }
    }
}

/// La domanda, con versione e campi chiusi.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum ProofQuery {
    Languages {
        version: u32,
    },
    Check {
        version: u32,
        language: String,
        #[serde(default)]
        options: CheckOptions,
        #[serde(default)]
        words: Vec<String>,
        segments: Vec<String>,
    },
}

/// Ciò che l'ortografia salta e se si leggono le regole grammaticali.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CheckOptions {
    pub ignore_uppercase: bool,
    pub ignore_numbers: bool,
    pub ignore_internet: bool,
    pub grammar: bool,
}

impl Default for CheckOptions {
    fn default() -> Self {
        CheckOptions {
            ignore_uppercase: true,
            ignore_numbers: true,
            ignore_internet: true,
            grammar: true,
        }
    }
}

/// Una lingua e ciò che il correttore sa farci adesso.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LanguageSupport {
    /// Il sottotag primario (`it`, `en`).
    pub code: &'static str,
    /// Le parole si controllano: c'è un dizionario.
    pub spelling: bool,
    /// Le regole grammaticali si applicano.
    pub grammar: bool,
    /// Il dizionario Hunspell da installare perché ci sia l'ortografia, se
    /// manca.
    pub missing_dictionary: Option<&'static str>,
}

/// Un problema trovato in un segmento.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ProofIssue {
    /// Byte UTF-8 di inizio, nel segmento.
    pub start: usize,
    /// Byte UTF-8 di fine, nel segmento.
    pub end: usize,
    pub kind: ProofIssueKind,
    /// Nella lingua del testo controllato.
    pub message: String,
    /// I migliori prima.
    pub suggestions: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProofIssueKind {
    Spelling,
    Grammar,
}

/// La risposta a una `check`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CheckResult {
    pub language: LanguageSupport,
    /// Un elenco per segmento, nell'ordine della domanda.
    pub segments: Vec<Vec<ProofIssue>>,
}

impl ProofIndex {
    fn support(&self, lang: ProofLang) -> LanguageSupport {
        let code = lang.code();
        let hunspell = |installed: fn() -> bool, name: &'static str| {
            let spelling = self.dictionaries == Dictionaries::Machine && installed();
            (spelling, (!spelling).then_some(name))
        };
        let (spelling, missing_dictionary) = match lang {
            ProofLang::En => (true, None),
            ProofLang::It => hunspell(wordcraft_proof::it::has_dictionary, "it_IT"),
            ProofLang::Pt => hunspell(wordcraft_proof::pt::has_dictionary, "pt_BR"),
            ProofLang::Pl => hunspell(wordcraft_proof::pl::has_dictionary, "pl_PL"),
            ProofLang::Cs => hunspell(wordcraft_proof::cs::has_dictionary, "cs_CZ"),
            ProofLang::Hr => hunspell(wordcraft_proof::hr::has_dictionary, "hr_HR"),
            ProofLang::Ru => hunspell(wordcraft_proof::ru::has_dictionary, "ru_RU"),
            ProofLang::Tr => hunspell(wordcraft_proof::tr::has_dictionary, "tr_TR"),
            ProofLang::Bg | ProofLang::Other => (false, None),
        };
        LanguageSupport {
            code,
            spelling,
            grammar: lang.is_proofed(),
            missing_dictionary,
        }
    }

    /// I problemi di ogni segmento, in `language`.
    ///
    /// Una lingua che il motore non corregge (`fr`, `ja`) non produce segni:
    /// è il comportamento di Word senza gli strumenti di quella lingua, e non
    /// segna come errore inglese ogni parola francese.
    pub fn check(
        &self,
        language: &str,
        options: CheckOptions,
        words: &[String],
        segments: &[String],
    ) -> Result<CheckResult, PluginError> {
        if segments.len() > MAX_SEGMENTS {
            return Err(over(E_SEGMENTS, MAX_SEGMENTS));
        }
        let mut total = 0usize;
        for segment in segments {
            if segment.len() > MAX_SEGMENT_BYTES {
                return Err(over(E_SEGMENT_BYTES, MAX_SEGMENT_BYTES));
            }
            total += segment.len();
        }
        if total > MAX_TEXT_BYTES {
            return Err(over(E_TEXT_BYTES, MAX_TEXT_BYTES));
        }
        if words.len() > MAX_WORDS {
            return Err(over(E_WORDS, MAX_WORDS));
        }
        let personal: HashSet<String> = words
            .iter()
            .filter_map(|w| wordcraft_proof::custom_word(w))
            .collect();

        let lang = language_of(language)?;
        let support = self.support(lang);
        let opts = Options {
            ignore_uppercase: options.ignore_uppercase,
            ignore_numbers: options.ignore_numbers,
            ignore_internet: options.ignore_internet,
        };
        let mut suggested = 0usize;
        let mut out = Vec::with_capacity(segments.len());
        for segment in segments {
            let issues = if !support.grammar {
                Vec::new()
            } else if support.spelling {
                wordcraft_proof::check_text_with(
                    segment,
                    &[(0..segment.len(), lang)],
                    &opts,
                    options.grammar,
                )
            } else if options.grammar {
                // Senza dizionario non si chiama l'ortografia: oltre a non
                // servire, cercherebbe il dizionario sul disco.
                wordcraft_proof::check_grammar_in(segment, lang)
            } else {
                Vec::new()
            };
            let mut kept = Vec::with_capacity(issues.len());
            for issue in issues {
                let Some(text) = segment.get(issue.start..issue.end) else {
                    continue;
                };
                if touches_placeholder(segment, issue.start, text) {
                    continue;
                }
                let kind = match issue.kind {
                    IssueKind::Spelling => ProofIssueKind::Spelling,
                    IssueKind::Grammar => ProofIssueKind::Grammar,
                };
                let mut suggestions = issue.suggestions;
                if kind == ProofIssueKind::Spelling {
                    if personal.contains(&text.to_lowercase()) {
                        continue;
                    }
                    if suggested < MAX_SUGGESTED_WORDS {
                        suggested += 1;
                        suggestions = wordcraft_proof::suggest_in(text, MAX_SUGGESTIONS, lang);
                    }
                }
                suggestions.truncate(MAX_SUGGESTIONS);
                kept.push(ProofIssue {
                    start: issue.start,
                    end: issue.end,
                    kind,
                    message: issue.message,
                    suggestions,
                });
            }
            out.push(kept);
        }
        Ok(CheckResult {
            language: support,
            segments: out,
        })
    }

    /// Le lingue dell'impostazione, con ciò che si può fare in ognuna adesso.
    pub fn languages(&self) -> Vec<LanguageSupport> {
        LANGUAGES
            .iter()
            .map(|(_, lang)| self.support(*lang))
            .collect()
    }
}

/// Una richiesta oltre un limite: il messaggio dice quale.
fn over(key: &str, max: usize) -> PluginError {
    let max = i64::try_from(max).unwrap_or(i64::MAX);
    PluginError::BadArgs(Text::message(key, vec![Arg::int(MAX, max)]))
}

/// Una query che non ha la forma chiusa della route. Il dettaglio resta in
/// inglese come gli errori di serde da cui viene: lo legge chi scrive la
/// shell, non chi scrive il testo.
fn bad_query(detail: &str) -> PluginError {
    PluginError::BadArgs(Text::message(E_QUERY, vec![Arg::text(DETAIL, detail)]))
}

/// La lingua di un tag BCP 47 (`it-IT`, `en`), o un errore se il tag non ha
/// la forma di un tag.
fn language_of(tag: &str) -> Result<ProofLang, PluginError> {
    let normalized = wordcraft_proof::lang::normalize_tag(tag).ok_or_else(|| {
        PluginError::BadArgs(Text::message(E_LANGUAGE, vec![Arg::text(TAG, tag)]))
    })?;
    Ok(ProofLang::from_tag(Some(&normalized)))
}

fn to_value<T: Serialize>(value: &T) -> Result<IndexResult, PluginError> {
    serde_json::to_value(value)
        .map(IndexResult::Custom)
        .map_err(|error| PluginError::Internal(error.to_string().into()))
}

impl IndexProvider for ProofIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(PROOF_ID.into()))]
    }

    fn activate(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_documents_indexed(&mut self, _: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn on_documents_removed(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn reconcile(&mut self, _: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }

    fn flush(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn close(&mut self, _: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }

    fn query(&self, request: IndexQuery) -> Result<IndexResult, PluginError> {
        let IndexQuery::Custom { ns, query } = request else {
            return Err(bad_query("not a custom query"));
        };
        if ns != PROOF_ID {
            return Err(bad_query(&format!("namespace `{ns}`")));
        }
        let query =
            ProofQuery::deserialize(&query).map_err(|error| bad_query(&error.to_string()))?;
        match query {
            ProofQuery::Languages { version: 1 } => to_value(&self.languages()),
            ProofQuery::Check {
                version: 1,
                language,
                options,
                words,
                segments,
            } => to_value(&self.check(&language, options, &words, &segments)?),
            ProofQuery::Languages { .. } | ProofQuery::Check { .. } => {
                Err(bad_query("unsupported version"))
            }
        }
    }
}

/// I comandi del dizionario personale.
pub struct ProofCommands;

impl CommandProvider for ProofCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        [WORD_ADD, WORD_REMOVE]
            .into_iter()
            .map(|id| {
                CommandSpec::new(id, Text::key(format!("{id}.title")))
                    .describing(Text::key(format!("{id}.desc")))
                    .with_param(
                        ParamSpec::new(
                            WORD,
                            Text::key(format!("{id}.word.title")),
                            ParamKind::Text,
                        )
                        .describing(Text::key(format!("{id}.word.desc")))
                        .required(),
                    )
                    .with_scope(CommandScope::writing(CommandReach::Settings))
            })
            .collect()
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let add = match command {
            WORD_ADD => true,
            WORD_REMOVE => false,
            other => return Err(PluginError::UnknownCommand(other.to_string().into())),
        };
        let raw = Args::new(&args).text(WORD).unwrap_or("");
        let word = wordcraft_proof::custom_word(raw).ok_or_else(|| {
            PluginError::BadArgs(Text::message(E_WORD, vec![Arg::text(WORD, raw)]))
        })?;
        let mut words = match host.setting(WORDS_KEY)? {
            SettingValue::List(words) => words,
            _ => {
                return Err(PluginError::Internal(Text::key(E_WORDS_SHAPE)));
            }
        };
        let present = words.iter().any(|w| w.to_lowercase() == word);
        let changed = if add {
            if !present && words.len() >= MAX_WORDS {
                return Err(over(E_WORDS, MAX_WORDS));
            }
            !present
        } else {
            present
        };
        let summary = Text::message(
            match (add, changed) {
                (true, true) => P_ADDED,
                (true, false) => P_ALREADY,
                (false, true) => P_REMOVED,
                (false, false) => P_ABSENT,
            },
            vec![Arg::text(WORD, word.clone())],
        );
        if mode.is_dry_run() || !changed {
            return Ok(CommandOutcome::notify(summary));
        }
        if add {
            words.push(word);
            words.sort();
        } else {
            words.retain(|w| w.to_lowercase() != word);
        }
        host.set_setting(WORDS_KEY, SettingValue::List(words))?;
        Ok(CommandOutcome::notify(summary))
    }
}

const WORD: &str = "word";
const TAG: &str = "tag";
const MAX: &str = "max";
const DETAIL: &str = "detail";
const E_WORD: &str = "proof.word.invalid";
const E_SEGMENTS: &str = "proof.error.segments";
const E_SEGMENT_BYTES: &str = "proof.error.segment-bytes";
const E_TEXT_BYTES: &str = "proof.error.text-bytes";
const E_WORDS: &str = "proof.error.words";
const E_LANGUAGE: &str = "proof.error.language";
const E_QUERY: &str = "proof.error.query";
const E_WORDS_SHAPE: &str = "proof.error.words-shape";
const P_ADDED: &str = "proof.word.added";
const P_ALREADY: &str = "proof.word.already";
const P_REMOVED: &str = "proof.word.removed";
const P_ABSENT: &str = "proof.word.absent";
const S_GROUP: &str = "proof.settings.group";

/// Le impostazioni del correttore.
pub fn settings() -> Vec<SettingSpec> {
    let mut options = vec![UiOption::new(
        LANGUAGE_AUTO,
        Text::key("proof.language.auto"),
    )];
    options.extend(
        LANGUAGES
            .iter()
            .map(|(code, _)| UiOption::new(*code, Text::key(format!("proof.language.{code}")))),
    );
    vec![
        SettingSpec::new(
            LANGUAGE_KEY,
            Text::key("proof.language.title"),
            SettingKind::Choice {
                default: LANGUAGE_AUTO.into(),
                options,
            },
        )
        .describing(Text::key("proof.language.desc"))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::toggle(GRAMMAR_KEY, Text::key("proof.grammar.title"), true)
            .describing(Text::key("proof.grammar.desc"))
            .grouped(Text::key(S_GROUP)),
        SettingSpec::toggle(
            IGNORE_UPPERCASE_KEY,
            Text::key("proof.ignore-uppercase.title"),
            true,
        )
        .describing(Text::key("proof.ignore-uppercase.desc"))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::toggle(
            IGNORE_NUMBERS_KEY,
            Text::key("proof.ignore-numbers.title"),
            true,
        )
        .describing(Text::key("proof.ignore-numbers.desc"))
        .grouped(Text::key(S_GROUP)),
        SettingSpec::new(
            WORDS_KEY,
            Text::key("proof.words.title"),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key("proof.words.desc"))
        .grouped(Text::key(S_GROUP))
        .program_writable(),
    ]
}

/// Le stringhe del componente.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(S_GROUP, "Correttore")
            .with("proof.language.title", "Lingua del testo")
            .with(
                "proof.language.desc",
                "La lingua in cui si controlla la prosa quando il documento non ne \
                 dichiara una (`lang` nel frontmatter). «Come l'interfaccia» segue la \
                 lingua di Fub.",
            )
            .with("proof.language.auto", "Come l'interfaccia")
            .with("proof.language.it", "Italiano")
            .with("proof.language.en", "Inglese")
            .with("proof.language.pt", "Portoghese")
            .with("proof.language.pl", "Polacco")
            .with("proof.language.cs", "Ceco")
            .with("proof.language.hr", "Croato")
            .with("proof.language.ru", "Russo")
            .with("proof.language.tr", "Turco")
            .with("proof.grammar.title", "Regole grammaticali")
            .with(
                "proof.grammar.desc",
                "Oltre all'ortografia segnala parole ripetute, spazi doppi, \
                 punteggiatura e le confusioni più comuni della lingua.",
            )
            .with(
                "proof.ignore-uppercase.title",
                "Ignora le parole in maiuscolo",
            )
            .with(
                "proof.ignore-uppercase.desc",
                "Sigle come RAI o NASA contano come corrette.",
            )
            .with("proof.ignore-numbers.title", "Ignora le parole con cifre")
            .with(
                "proof.ignore-numbers.desc",
                "Parole come mp3 o B2B contano come corrette.",
            )
            .with("proof.words.title", "Dizionario personale")
            .with(
                "proof.words.desc",
                "Le parole che il correttore accetta in ogni lingua di questo vault. \
                 Si aggiungono da «Aggiungi al dizionario» sulla parola segnata.",
            )
            .with("proof.word.add.title", "Aggiungi al dizionario")
            .with(
                "proof.word.add.desc",
                "Aggiunge una parola al dizionario personale del vault.",
            )
            .with("proof.word.add.word.title", "Parola")
            .with("proof.word.add.word.desc", "La parola da accettare.")
            .with("proof.word.remove.title", "Togli dal dizionario")
            .with(
                "proof.word.remove.desc",
                "Toglie una parola dal dizionario personale del vault.",
            )
            .with("proof.word.remove.word.title", "Parola")
            .with(
                "proof.word.remove.word.desc",
                "La parola da non accettare più.",
            )
            .with(
                E_WORD,
                "«{word}» non è una parola sola di al massimo 64 caratteri.",
            )
            .with(P_ADDED, "«{word}» aggiunta al dizionario")
            .with(P_ALREADY, "«{word}» è già nel dizionario")
            .with(P_REMOVED, "«{word}» tolta dal dizionario")
            .with(P_ABSENT, "«{word}» non è nel dizionario")
            .with(E_SEGMENTS, "Il testo da correggere supera {max} segmenti.")
            .with(
                E_SEGMENT_BYTES,
                "Un paragrafo da correggere supera {max} byte.",
            )
            .with(E_TEXT_BYTES, "Il testo da correggere supera {max} byte.")
            .with(E_WORDS, "Il dizionario personale ha già {max} parole.")
            .with(E_LANGUAGE, "«{tag}» non è un codice di lingua.")
            .with(E_QUERY, "Richiesta al correttore non valida: {detail}.")
            .with(
                E_WORDS_SHAPE,
                "Il dizionario personale non è un elenco di parole.",
            ),
        StringCatalog::new("en")
            .with(S_GROUP, "Proofing")
            .with("proof.language.title", "Text language")
            .with(
                "proof.language.desc",
                "The language prose is checked in when the document does not declare \
                 one (`lang` in the frontmatter). \"Like the interface\" follows Fub's \
                 language.",
            )
            .with("proof.language.auto", "Like the interface")
            .with("proof.language.it", "Italian")
            .with("proof.language.en", "English")
            .with("proof.language.pt", "Portuguese")
            .with("proof.language.pl", "Polish")
            .with("proof.language.cs", "Czech")
            .with("proof.language.hr", "Croatian")
            .with("proof.language.ru", "Russian")
            .with("proof.language.tr", "Turkish")
            .with("proof.grammar.title", "Grammar rules")
            .with(
                "proof.grammar.desc",
                "Besides spelling, flags repeated words, double spaces, punctuation and \
                 the language's most common confusions.",
            )
            .with("proof.ignore-uppercase.title", "Ignore words in capitals")
            .with(
                "proof.ignore-uppercase.desc",
                "Acronyms such as NASA count as correct.",
            )
            .with("proof.ignore-numbers.title", "Ignore words with digits")
            .with(
                "proof.ignore-numbers.desc",
                "Words such as mp3 or B2B count as correct.",
            )
            .with("proof.words.title", "Personal dictionary")
            .with(
                "proof.words.desc",
                "Words the checker accepts in every language of this vault. Add them \
                 with \"Add to dictionary\" on a flagged word.",
            )
            .with("proof.word.add.title", "Add to dictionary")
            .with(
                "proof.word.add.desc",
                "Adds a word to the vault's personal dictionary.",
            )
            .with("proof.word.add.word.title", "Word")
            .with("proof.word.add.word.desc", "The word to accept.")
            .with("proof.word.remove.title", "Remove from dictionary")
            .with(
                "proof.word.remove.desc",
                "Removes a word from the vault's personal dictionary.",
            )
            .with("proof.word.remove.word.title", "Word")
            .with("proof.word.remove.word.desc", "The word to stop accepting.")
            .with(
                E_WORD,
                "\"{word}\" is not a single word of at most 64 characters.",
            )
            .with(P_ADDED, "\"{word}\" added to the dictionary")
            .with(P_ALREADY, "\"{word}\" is already in the dictionary")
            .with(P_REMOVED, "\"{word}\" removed from the dictionary")
            .with(P_ABSENT, "\"{word}\" is not in the dictionary")
            .with(E_SEGMENTS, "The text to check exceeds {max} segments.")
            .with(E_SEGMENT_BYTES, "A paragraph to check exceeds {max} bytes.")
            .with(E_TEXT_BYTES, "The text to check exceeds {max} bytes.")
            .with(
                E_WORDS,
                "The personal dictionary already holds {max} words.",
            )
            .with(E_LANGUAGE, "\"{tag}\" is not a language code.")
            .with(E_QUERY, "Invalid proofing request: {detail}.")
            .with(
                E_WORDS_SHAPE,
                "The personal dictionary is not a list of words.",
            ),
    ]
}

/// Il segnaposto con cui la shell sostituisce ciò che non è prosa (un
/// wikilink, un tag, il codice in linea). Il motore non lo conosce e lo legge
/// come spazio: una parola minuscola dopo `[[Nota]]` gli pare un inizio di
/// frase. Un rilievo che contiene il segnaposto, o che lo segue con solo spazi
/// in mezzo, parla di un pezzo che il motore non ha visto, e si scarta.
pub const PLACEHOLDER: char = '\u{FFFC}';

fn touches_placeholder(segment: &str, start: usize, text: &str) -> bool {
    text.contains(PLACEHOLDER)
        || segment
            .get(..start)
            .is_some_and(|before| before.trim_end().ends_with(PLACEHOLDER))
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::traits::SettingsRead as _;
    use fub_sdk::testing::MemoryHost;
    use serde_json::json;

    fn check(index: &ProofIndex, language: &str, segments: &[&str]) -> CheckResult {
        let segments: Vec<String> = segments.iter().map(|s| s.to_string()).collect();
        index
            .check(language, CheckOptions::default(), &[], &segments)
            .unwrap()
    }

    fn spans<'a>(segment: &'a str, issues: &[ProofIssue]) -> Vec<&'a str> {
        issues.iter().map(|i| &segment[i.start..i.end]).collect()
    }

    #[test]
    fn english_misspellings_come_with_byte_ranges_and_suggestions() {
        let index = ProofIndex::bundled_only();
        let segment = "The café: this sentense is wrong.";
        let result = check(&index, "en-US", &[segment]);
        assert!(result.language.spelling);
        let issues = &result.segments[0];
        assert_eq!(spans(segment, issues), ["sentense"]);
        // Gli offset sono byte UTF-8: «é», prima della parola, ne vale due.
        assert_eq!(issues[0].start, "The café: this ".len());
        assert_eq!(issues[0].kind, ProofIssueKind::Spelling);
        assert!(issues[0].suggestions.iter().any(|s| s == "sentence"));
    }

    #[test]
    fn personal_words_are_correct_whatever_their_case() {
        let index = ProofIndex::bundled_only();
        let segments = vec!["Fubvault is here".to_string()];
        let words = vec!["fubvault".to_string()];
        let result = index
            .check("en", CheckOptions::default(), &words, &segments)
            .unwrap();
        assert!(result.segments[0].is_empty(), "{:?}", result.segments[0]);
        let result = check(&index, "en", &["Fubvault is here"]);
        assert_eq!(spans("Fubvault is here", &result.segments[0]), ["Fubvault"]);
    }

    #[test]
    fn italian_without_a_dictionary_keeps_the_grammar_and_names_what_is_missing() {
        let index = ProofIndex::bundled_only();
        let segment = "Ne voglio un pò, qual'è il problema?";
        let result = check(&index, "it-IT", &[segment]);
        assert!(!result.language.spelling);
        assert!(result.language.grammar);
        assert_eq!(result.language.missing_dictionary, Some("it_IT"));
        let issues = &result.segments[0];
        assert!(issues.iter().all(|i| i.kind == ProofIssueKind::Grammar));
        let found = spans(segment, issues);
        assert!(found.iter().any(|s| s.contains("pò")), "{found:?}");
        assert!(found.iter().any(|s| s.contains("qual'è")), "{found:?}");
    }

    #[test]
    fn grammar_can_be_turned_off() {
        let index = ProofIndex::bundled_only();
        let segments = vec!["the the cat".to_string()];
        let options = CheckOptions {
            grammar: false,
            ..CheckOptions::default()
        };
        let result = index.check("en", options, &[], &segments).unwrap();
        assert!(result.segments[0].is_empty());
        let result = check(&index, "en", &["the the cat"]);
        assert_eq!(result.segments[0][0].kind, ProofIssueKind::Grammar);
    }

    #[test]
    fn a_language_without_tools_gets_no_marks() {
        let index = ProofIndex::bundled_only();
        let result = check(&index, "fr-FR", &["Ceci n'est pas une pipe, tres bien"]);
        assert!(!result.language.grammar && !result.language.spelling);
        assert_eq!(result.language.missing_dictionary, None);
        assert!(result.segments[0].is_empty());
    }

    /// La shell mette U+FFFC al posto di ciò che non è prosa (un wikilink, un
    /// tag): non deve diventare una parola, uno spazio doppio o una maiuscola
    /// mancante.
    #[test]
    fn the_object_placeholder_is_not_prose() {
        let index = ProofIndex::bundled_only();
        for (language, segment) in [
            ("en", "See \u{FFFC} for the details."),
            ("en", "Done. \u{FFFC} is next."),
            ("it", "Vedi \u{FFFC} per i dettagli."),
            ("it", "Fatto. \u{FFFC} viene dopo."),
        ] {
            let result = check(&index, language, &[segment]);
            assert!(
                result.segments[0].is_empty(),
                "{segment}: {:?}",
                result.segments[0]
            );
        }
    }

    #[test]
    fn segments_are_answered_in_order() {
        let index = ProofIndex::bundled_only();
        let result = check(&index, "en", &["All good.", "", "A speling"]);
        assert_eq!(result.segments.len(), 3);
        assert!(result.segments[0].is_empty() && result.segments[1].is_empty());
        assert_eq!(spans("A speling", &result.segments[2]), ["speling"]);
    }

    #[test]
    fn suggestions_are_bounded_per_request() {
        let index = ProofIndex::bundled_only();
        // Parole distinte: la stessa ripetuta sarebbe anche un errore di grammatica.
        let text: Vec<String> = (0..MAX_SUGGESTED_WORDS + 5)
            .map(|i| {
                format!(
                    "Qwz{}{}",
                    (b'a' + (i / 26) as u8) as char,
                    (b'a' + (i % 26) as u8) as char
                )
            })
            .collect();
        let text = text.join(" ");
        let result = check(&index, "en", &[&text]);
        let issues = &result.segments[0];
        assert_eq!(issues.len(), MAX_SUGGESTED_WORDS + 5);
        assert!(issues.iter().all(|i| i.kind == ProofIssueKind::Spelling));
        assert!(issues
            .iter()
            .all(|i| i.suggestions.len() <= MAX_SUGGESTIONS));
        assert!(issues[MAX_SUGGESTED_WORDS..]
            .iter()
            .all(|i| i.suggestions.is_empty()));
    }

    #[test]
    fn requests_beyond_the_limits_are_refused_whole() {
        let index = ProofIndex::bundled_only();
        let many = vec![String::new(); MAX_SEGMENTS + 1];
        let big = vec!["a".repeat(MAX_SEGMENT_BYTES + 1)];
        let total = vec!["a".repeat(MAX_SEGMENT_BYTES); MAX_TEXT_BYTES / MAX_SEGMENT_BYTES + 1];
        let words = vec!["x".to_string(); MAX_WORDS + 1];
        let opts = CheckOptions::default();
        for result in [
            index.check("en", opts, &[], &many),
            index.check("en", opts, &[], &big),
            index.check("en", opts, &[], &total),
            index.check("en", opts, &words, &[]),
            index.check("not a tag!", opts, &[], &[]),
        ] {
            assert!(matches!(result, Err(PluginError::BadArgs(_))), "{result:?}");
        }
    }

    fn query(index: &ProofIndex, query: serde_json::Value) -> Result<IndexResult, PluginError> {
        index.query(IndexQuery::Custom {
            ns: PROOF_ID.into(),
            query,
        })
    }

    #[test]
    fn the_route_answers_the_closed_versioned_shape() {
        let index = ProofIndex::bundled_only();
        let Ok(IndexResult::Custom(value)) = query(
            &index,
            json!({"op": "check", "version": 1, "language": "en", "segments": ["A speling"]}),
        ) else {
            panic!("check must answer");
        };
        assert_eq!(value["segments"][0][0]["kind"], "spelling");
        assert_eq!(value["segments"][0][0]["start"], 2);
        assert_eq!(value["language"]["code"], "en");

        let Ok(IndexResult::Custom(value)) =
            query(&index, json!({"op": "languages", "version": 1}))
        else {
            panic!("languages must answer");
        };
        let codes: Vec<&str> = value
            .as_array()
            .unwrap()
            .iter()
            .map(|l| l["code"].as_str().unwrap())
            .collect();
        assert_eq!(codes, ["it", "en", "pt", "pl", "cs", "hr", "ru", "tr"]);

        for bad in [
            json!({"op": "languages", "version": 2}),
            json!({"op": "check", "version": 1, "language": "en", "segments": [], "extra": 1}),
            json!({"op": "check", "version": 1, "language": "en"}),
            json!({"op": "check", "version": 1, "language": "en", "segments": [],
                   "options": {"unknown": true}}),
            json!({"op": "rewrite", "version": 1}),
        ] {
            assert!(
                matches!(query(&index, bad.clone()), Err(PluginError::BadArgs(_))),
                "{bad}"
            );
        }
        assert!(matches!(
            index.query(IndexQuery::Custom {
                ns: "fub.other".into(),
                query: json!({})
            }),
            Err(PluginError::BadArgs(_))
        ));
    }

    fn host() -> MemoryHost {
        let mut host = MemoryHost::new();
        for spec in settings() {
            host = host.with_setting(spec);
        }
        host
    }

    fn words(host: &MemoryHost) -> Vec<String> {
        match host.setting(WORDS_KEY).unwrap() {
            SettingValue::List(words) => words,
            other => panic!("{other:?}"),
        }
    }

    fn invoke(host: &mut MemoryHost, id: &str, word: &str) -> Result<CommandOutcome, PluginError> {
        ProofCommands.invoke(id, json!({ "word": word }), InvokeMode::Apply, host)
    }

    #[test]
    fn the_personal_dictionary_is_one_validated_setting() {
        let mut host = host();
        let added = invoke(&mut host, WORD_ADD, "  Fubvault ").unwrap();
        assert_eq!(
            added.notify,
            Some(Text::message(P_ADDED, vec![Arg::text(WORD, "fubvault")]))
        );
        invoke(&mut host, WORD_ADD, "accento").unwrap();
        assert_eq!(words(&host), ["accento", "fubvault"]);

        let again = invoke(&mut host, WORD_ADD, "FUBVAULT").unwrap();
        assert_eq!(
            again.notify,
            Some(Text::message(P_ALREADY, vec![Arg::text(WORD, "fubvault")]))
        );
        assert_eq!(words(&host), ["accento", "fubvault"]);

        invoke(&mut host, WORD_REMOVE, "Fubvault").unwrap();
        assert_eq!(words(&host), ["accento"]);

        for bad in ["", "due parole", &"x".repeat(65)] {
            assert!(matches!(
                invoke(&mut host, WORD_ADD, bad),
                Err(PluginError::BadArgs(_))
            ));
        }
        assert_eq!(words(&host), ["accento"]);
    }

    #[test]
    fn a_dry_run_writes_nothing() {
        let mut host = host();
        ProofCommands
            .invoke(
                WORD_ADD,
                json!({"word": "parola"}),
                InvokeMode::DryRun,
                &mut host,
            )
            .unwrap();
        assert!(words(&host).is_empty());
    }

    #[test]
    fn every_command_names_its_strings() {
        let catalog = catalog();
        for spec in ProofCommands.commands() {
            for locale in &catalog {
                assert!(
                    locale.entries.contains_key(&format!("{}.title", spec.id)),
                    "{}",
                    spec.id
                );
            }
        }
    }
}
