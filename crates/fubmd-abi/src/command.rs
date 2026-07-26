//! I **comandi**: le azioni del vault dette in una forma che chi non ha letto il
//! codice può scegliere, compilare e invocare.
//!
//! # Il registro (decisione 0009)
//!
//! Oggi ogni azione dell'app è un comando Tauri scritto a mano: creare una nota,
//! aprire la ricerca, cestinare. Nessuna di esse è raggiungibile da un plugin,
//! da una scorciatoia configurabile, da una macro (16.2), da una CLI (27.1) o da
//! un'API locale (27.2) — e ognuna nuova aggiunge una superficie privilegiata in
//! più. Il registro dei comandi è l'unico posto in cui un'azione si dichiara una
//! volta e la chiedono tutti: la palette, la tastiera, l'automazione, il
//! chiamante remoto.
//!
//! # Il chiamante che non si può correggere leggendo il codice (decisione 0010)
//!
//! `{ id, title, keybinding }` basta a una **palette**, dove a scegliere è un
//! umano che legge il titolo e a compilare gli argomenti è lui. Non basta a
//! nessun altro: una CLI che non sa quali argomenti esistono può solo elencarli
//! a mano, un'automazione li indovina, e un modello (22.4) sceglie il comando
//! sbagliato perché di *cosa fa* non gli è stato detto niente. Da qui i tre
//! campi che questo modulo aggiunge, e che sono tutti **dichiarazioni**, non
//! meccanismi:
//!
//! - [`CommandSpec::description`] — la prosa di cosa fa. È l'unico ingrediente
//!   su cui un chiamante non umano sceglie, ed è inutile alla palette (che ha il
//!   titolo): esiste per l'altro lettore.
//! - [`CommandSpec::params`] — quali argomenti, di che specie, quali
//!   obbligatori. Un comando che dichiara i propri parametri si sa invocare
//!   senza averlo mai visto, e la palette può **chiedere prima**, invece di
//!   invocare e ricevere un errore.
//! - [`CommandSpec::scope`] — il raggio: legge o scrive, tocca un documento, N
//!   documenti, il vault o la configurazione, ed è reversibile o no. È il dato
//!   su cui si fonda la conferma rafforzata (22.4) e, a valle, il §7.3.
//!
//! # La simulazione è un modo di invocare, non una cortesia
//!
//! [`InvokeMode::DryRun`] chiede a un comando cosa *farebbe*: risponde con un
//! [`CommandPlan`] — i documenti impattati e, per ognuno, la
//! [`EditRequest`](crate::edit::EditRequest) della decisione 0008 — **senza scrivere**. La
//! parte che conta non è la variante: è che il non-scrivere lo garantisce
//! l'**host**, prestando al comando un `HostApi` in sola lettura. Un dry-run
//! affidato alla buona volontà di chi implementa sarebbe una convenzione, cioè
//! esattamente ciò che un comando di terzi non onora.
//!
//! Per la stessa ragione [`CommandScope::writes`] non è una decorazione: un
//! comando che si dichiara di sola lettura riceve lo stesso host in sola
//! lettura, e se prova a scrivere fallisce. La dichiarazione è vincolante nel
//! senso letterale.
//!
//! # Il consenso, e perché non è una capacità
//!
//! «L'utente approva *questa* esecuzione, su *queste* 40 note?» non è una
//! domanda che un comando fa all'host: è il giro
//! **[`DryRun`](InvokeMode::DryRun) → piano → approvazione →
//! [`Apply`](InvokeMode::Apply)**, e sta in mano a chi invoca (la shell, la
//! CLI, il centro di comando). Non è una capacità `HostApi` per due ragioni,
//! nessuna delle due estetica:
//!
//! 1. **Un host non può fermarsi a chiedere.** Il kernel è chiamato *dalla*
//!    shell e ne tiene il lock: una conferma sincrona dovrebbe risalire nella
//!    webview che sta aspettando la risposta. Una capacità che questo host non
//!    può implementare è peggio che assente — sarebbe una firma che ogni host
//!    dovrà onorare e nessuno onora.
//! 2. **Il piano si legge, la domanda no.** Una conferma nel mezzo mostra ciò
//!    che il comando *sceglie* di dire; un piano mostra i documenti e gli edit,
//!    e li mostra prima. È la differenza fra «sei sicuro?» e il diff.
//!
//! Chi invoca decide *quando* chiedere, e lo decide dal [`CommandScope`]
//! dichiarato: è per questo che il raggio sta nella spec e non in un commento.
//!
//! # Cosa resta deliberatamente fuori
//!
//! - **L'attribuzione** (chi ha chiesto l'operazione: utente, comando, modello):
//!   è l'origine degli eventi (decisione 0012) applicata al lotto (decisione 0011), e nessuna
//!   delle due esiste. Un campo `origin` qui sopra sarebbe scritto da chi
//!   invoca e letto da nessuno.
//! - **Le impostazioni scrivibili da un programma** (§11.1): il vocabolario c'è
//!   ([`CommandReach::Settings`]), lo schema che dice *quali chiavi* no, perché
//!   non ci sono ancora impostazioni.
//! - **Il form** che raccoglie i parametri: qui si dichiara *cosa* serve, non
//!   *come* si chiede. I nodi di input sono il §2.1, e quando arriveranno
//!   saranno la resa di questi [`ParamSpec`], non un secondo modo di dirli.
//! - **Il dialogo a più passi** (una domanda che dipende dalla risposta
//!   precedente): un comando dichiara i suoi parametri *tutti insieme*, perché
//!   è la sola forma che un chiamante non interattivo sa compilare.
//! - **Chi possiede un id** (§7.4): due provider che dichiarano lo stesso
//!   comando sono oggi risolti dall'ordine di registrazione, come per le view.

use serde::{Deserialize, Serialize};

use crate::edit::EditRequest;
use crate::error::PluginError;
use crate::model::{DocId, Span};

// ---------------------------------------------------------------------------
// La dichiarazione di un comando
// ---------------------------------------------------------------------------

/// Un comando offerto da un provider: come si chiama, cosa fa, cosa vuole e
/// cosa tocca.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommandSpec {
    /// Identità stabile, con cui si invoca (`vault.replace`). Non è un titolo:
    /// cambiarla rompe scorciatoie, macro e automazioni che la nominano.
    pub id: String,
    /// Come si chiama per un umano, nella palette.
    pub title: String,
    /// Cosa fa, in prosa. Vuota è lecito e sconsigliato: è l'unica cosa che un
    /// chiamante non umano legge per scegliere fra due comandi simili.
    pub description: String,
    /// Suggerimento di scorciatoia, es. `"Mod-p"` (non vincolante: chi assegna
    /// davvero i tasti è la shell, e l'utente li può cambiare).
    pub keybinding: Option<String>,
    /// Gli argomenti, nell'ordine in cui ha senso chiederli.
    pub params: Vec<ParamSpec>,
    /// Il raggio dichiarato: cosa questo comando si permette.
    pub scope: CommandScope,
}

impl CommandSpec {
    /// Un comando di sola lettura, senza parametri: la forma minima, da cui si
    /// costruisce il resto.
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        CommandSpec {
            id: id.into(),
            title: title.into(),
            description: String::new(),
            keybinding: None,
            params: Vec::new(),
            scope: CommandScope::read_only(),
        }
    }

    pub fn describing(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn with_keybinding(mut self, keybinding: impl Into<String>) -> Self {
        self.keybinding = Some(keybinding.into());
        self
    }

    pub fn with_param(mut self, param: ParamSpec) -> Self {
        self.params.push(param);
        self
    }

    pub fn with_scope(mut self, scope: CommandScope) -> Self {
        self.scope = scope;
        self
    }

    /// Il parametro di nome `name`, se dichiarato.
    pub fn param(&self, name: &str) -> Option<&ParamSpec> {
        self.params.iter().find(|p| p.name == name)
    }

    /// Gli argomenti sono compilabili da questa spec?
    ///
    /// Sta qui e non in ogni host per la ragione di sempre: uno schema che a
    /// farlo rispettare è chi lo pubblica non è uno schema, è un commento. Un
    /// host lo applica **prima** di chiamare il provider, così un comando non
    /// deve difendersi da solo da un chiamante distratto — e un chiamante che
    /// non può leggere il codice riceve un errore che dice cosa manca.
    ///
    /// Tre regole, e la terza è la meno ovvia:
    ///
    /// - un argomento **obbligatorio** assente è un errore (`null` vale
    ///   assente: è ciò che manda un chiamante JSON che non ha niente da dire);
    /// - un argomento di specie sbagliata è un errore, e il messaggio dice
    ///   quale specie era attesa;
    /// - un argomento **non dichiarato** è un errore, non un argomento
    ///   ignorato. Ignorarlo in silenzio è il modo peggiore di sbagliare
    ///   proprio per il chiamante che questa firma esiste per servire: chiede
    ///   una cosa, ne ottiene un'altra, e non ha modo di accorgersene.
    pub fn validate_args(&self, args: &serde_json::Value) -> Result<(), PluginError> {
        validate_params(&self.id, &self.params, args)
    }
}

/// Le tre regole di [`CommandSpec::validate_args`], applicate a un elenco di
/// [`ParamSpec`] qualunque.
///
/// Sta fuori dal metodo perché i comandi non sono più gli unici a dichiarare dei
/// parametri: dal §2.3 li dichiara anche una [`ViewSpec`](crate::traits::ViewSpec),
/// e due convalide della stessa grammatica sarebbero due modi di essere severi —
/// cioè un chiamante che passa da un comando e uno che apre una view a mano
/// ricevono due risposte diverse sullo stesso argomento sbagliato.
pub fn validate_params(
    subject: &str,
    params: &[ParamSpec],
    args: &serde_json::Value,
) -> Result<(), PluginError> {
    let bad = |msg: String| Err(PluginError::BadArgs(format!("`{subject}`: {msg}")));
    let empty = serde_json::Map::new();
    let object = match args {
        serde_json::Value::Object(map) => map,
        // Nessun argomento si dice con `null` o con `{}`: sono la stessa
        // cosa, e un comando senza parametri non deve costringere chi lo
        // invoca a mandare un oggetto vuoto.
        serde_json::Value::Null => &empty,
        _ => return bad("gli argomenti sono un oggetto JSON".to_string()),
    };
    for param in params {
        match object.get(&param.name) {
            None | Some(serde_json::Value::Null) if param.required => {
                return bad(format!("manca l'argomento obbligatorio `{}`", param.name));
            }
            None | Some(serde_json::Value::Null) => {}
            Some(value) if !param.kind.accepts(value) => {
                return bad(format!(
                    "l'argomento `{}` vuole {}",
                    param.name,
                    param.kind.expected()
                ));
            }
            Some(_) => {}
        }
    }
    for key in object.keys() {
        if !params.iter().any(|p| p.name == *key) {
            return bad(format!(
                "argomento `{key}` non dichiarato (dichiarati: {})",
                if params.is_empty() {
                    "nessuno".to_string()
                } else {
                    params
                        .iter()
                        .map(|p| p.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            ));
        }
    }
    Ok(())
}

/// Un argomento di un comando: come si chiama, cosa vuole, se è obbligatorio.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParamSpec {
    /// La chiave con cui l'argomento viaggia negli `args` (snake_case).
    pub name: String,
    /// L'etichetta per un umano che lo compila.
    pub title: String,
    /// Cosa significa questo argomento. Come [`CommandSpec::description`]: la
    /// palette può farne a meno, un chiamante programmatico no.
    pub description: String,
    pub kind: ParamKind,
    /// Senza di esso il comando non si può invocare. Un parametro non
    /// obbligatorio assente **non** ha un valore di default nel contratto: a
    /// decidere cosa fare quando manca è il comando, che è l'unico a saperlo —
    /// un default qui sarebbe una seconda verità accanto alla sua.
    pub required: bool,
}

impl ParamSpec {
    pub fn new(name: impl Into<String>, title: impl Into<String>, kind: ParamKind) -> Self {
        ParamSpec {
            name: name.into(),
            title: title.into(),
            description: String::new(),
            kind,
            required: false,
        }
    }

    pub fn describing(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn required(mut self) -> Self {
        self.required = true;
        self
    }
}

/// La specie di un argomento.
///
/// È un vocabolario **chiuso** e volutamente piccolo: sono le specie che un
/// chiamante qualunque sa produrre senza conoscere il comando. Ciò che non è
/// esprimibile qui viaggia come testo e lo interpreta il comando — con il costo
/// dichiarato di non essere più verificabile dall'host.
///
/// Non sono i nodi di input del §2.1: quelli diranno *come si chiede* un valore
/// (un campo, un menu, uno slider), questi dicono *cosa* è. Quando arriveranno,
/// la resa di un [`ParamSpec`] sarà uno di quei nodi; il contrario — dichiarare
/// i parametri con i nodi della UI — legherebbe la descrizione di un comando
/// all'evoluzione di un protocollo di disegno, e la CLI non disegna niente.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
// Tag adiacente, come `PropertyValue`: una variante che porta una **sequenza**
// col tag interno non è serializzabile da `serde_json` (non c'è una mappa in
// cui infilare il tag). Vale per `choice`, e la forma dev'essere una sola per
// tutto l'enum.
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum ParamKind {
    /// Testo libero.
    Text,
    /// Un numero (intero o no: la distinzione la fa il comando, e un chiamante
    /// JSON non la porta comunque).
    Number,
    /// Vero o falso: un interruttore, non una stringa `"true"`.
    Bool,
    /// L'id di un documento del vault. Distinto da [`Text`](ParamKind::Text)
    /// perché chi compila un form può offrire il vault invece di un campo
    /// vuoto, e chi valida sa che una stringa qualunque non va bene.
    Document,
    /// Più documenti: è la forma con cui si chiede un'operazione su *queste*
    /// note (22.4). Vuoto ≠ assente — dipende dal comando, che lo dichiara
    /// nella propria descrizione.
    Documents,
    /// Uno fra valori dichiarati. Le scelte stanno **nella spec** e non in una
    /// convalida del comando: chi non ha letto il codice deve poterle vedere.
    Choice(Vec<Choice>),
}

impl ParamKind {
    /// Questo valore JSON è di questa specie?
    pub fn accepts(&self, value: &serde_json::Value) -> bool {
        match self {
            ParamKind::Text => value.is_string(),
            ParamKind::Number => value.is_number(),
            ParamKind::Bool => value.is_boolean(),
            // Un id vuoto non nomina niente: è la stessa regola con cui il
            // kernel rifiuta un `DocId` costruito dal nulla.
            ParamKind::Document => value.as_str().is_some_and(|s| !s.trim().is_empty()),
            ParamKind::Documents => value
                .as_array()
                .is_some_and(|v| v.iter().all(|d| d.as_str().is_some_and(|s| !s.is_empty()))),
            ParamKind::Choice(choices) => value
                .as_str()
                .is_some_and(|s| choices.iter().any(|c| c.value == s)),
        }
    }

    /// Cosa si aspettava, detto a chi ha sbagliato.
    pub fn expected(&self) -> String {
        match self {
            ParamKind::Text => "del testo".to_string(),
            ParamKind::Number => "un numero".to_string(),
            ParamKind::Bool => "vero o falso".to_string(),
            ParamKind::Document => "l'id di un documento".to_string(),
            ParamKind::Documents => "un elenco di id di documenti".to_string(),
            ParamKind::Choice(choices) => format!(
                "uno fra {}",
                choices
                    .iter()
                    .map(|c| format!("`{}`", c.value))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}

/// Una scelta di un [`ParamKind::Choice`]: il valore che viaggia e l'etichetta
/// che si legge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Choice {
    pub value: String,
    pub title: String,
}

impl Choice {
    pub fn new(value: impl Into<String>, title: impl Into<String>) -> Self {
        Choice {
            value: value.into(),
            title: title.into(),
        }
    }
}

// ---------------------------------------------------------------------------
// Il raggio
// ---------------------------------------------------------------------------

/// Quanto lontano arriva un comando: la dichiarazione su cui chi invoca decide
/// se chiedere conferma, e su cui il §7.3 deciderà i permessi.
///
/// [`writes`](CommandScope::writes) è l'unico campo che l'host **fa
/// rispettare** (chi si dichiara di sola lettura riceve un host che rifiuta le
/// scritture). Gli altri due restano dichiarazioni: quanti documenti un comando
/// tocchi si sa solo eseguendolo, e "reversibile" è una promessa sul mondo, non
/// sul confine. Dichiararli male è una bugia visibile — il piano del dry-run
/// dice quali documenti sarebbero toccati davvero.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandScope {
    /// Scrive, o si limita a leggere e a chiedere qualcosa alla shell?
    pub writes: bool,
    /// Fin dove arriva.
    pub reach: CommandReach,
    /// L'utente può tornare indietro (cestino, versioning, un edit inverso)?
    /// Falso è la dichiarazione che merita la conferma rafforzata.
    pub reversible: bool,
}

impl CommandScope {
    /// Legge e basta: nessuna scrittura, raggio la sola sessione.
    pub fn read_only() -> Self {
        CommandScope {
            writes: false,
            reach: CommandReach::Session,
            reversible: true,
        }
    }

    /// Scrive, fin dove dice `reach`. Reversibile finché non si dichiara il
    /// contrario: è il caso normale in un vault con cestino e versioning.
    pub fn writing(reach: CommandReach) -> Self {
        CommandScope {
            writes: true,
            reach,
            reversible: true,
        }
    }

    /// Da qui non si torna indietro.
    pub fn irreversible(mut self) -> Self {
        self.reversible = false;
        self
    }
}

impl Default for CommandScope {
    fn default() -> Self {
        CommandScope::read_only()
    }
}

/// Fin dove arriva un comando. In ordine di raggio crescente: l'ordine non è
/// decorativo — chi decide se chiedere conferma confronta.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandReach {
    /// Non tocca il vault: apre un pannello, cerca, sposta il focus.
    #[default]
    Session,
    /// Un documento solo — quello che gli argomenti (o il contesto) nominano.
    Document,
    /// Più documenti insieme: è il raggio delle operazioni in blocco (22.4).
    Documents,
    /// Il vault come insieme: crea, cestina, rinomina, riorganizza.
    Vault,
    /// La configurazione. Il vocabolario c'è prima delle impostazioni (§11.1)
    /// perché un caso in più a un enum costa una riga oggi e una minor dopo il
    /// freeze.
    Settings,
}

// ---------------------------------------------------------------------------
// L'invocazione e il suo esito
// ---------------------------------------------------------------------------

/// Come si sta invocando un comando.
///
/// Non ha un default: chi invoca deve dire cosa vuole. Un `Apply` implicito è
/// esattamente l'errore che questo enum esiste per rendere impossibile.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InvokeMode {
    /// Fallo.
    Apply,
    /// Dimmi cosa faresti. L'host presta un `HostApi` in **sola lettura**: non
    /// è una richiesta di buona condotta, è una garanzia.
    DryRun,
}

impl InvokeMode {
    pub fn is_dry_run(self) -> bool {
        matches!(self, InvokeMode::DryRun)
    }
}

/// L'esito di un comando: cosa dire all'utente e cosa deve fare la shell.
///
/// Un record e non un enum perché le due cose sono indipendenti — «fatto,
/// 12 note aggiornate» *e* «adesso apri questa nota» capitano insieme, e un
/// enum costringerebbe a sceglierne una.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CommandOutcome {
    /// Messaggio per l'utente, **testo semplice**: come
    /// [`SearchHit::snippet`](crate::traits::SearchHit::snippet), chi lo mostra
    /// lo inserisce come testo e mai come markup — un comando di terzi non ha un
    /// varco verso la webview privilegiata.
    pub notify: Option<String>,
    /// Cosa deve fare la shell dopo.
    pub effect: CommandEffect,
}

impl CommandOutcome {
    /// Fatto, niente da dire e niente da fare.
    pub fn done() -> Self {
        CommandOutcome {
            notify: None,
            effect: CommandEffect::Done,
        }
    }

    /// Fatto, con un messaggio per l'utente.
    pub fn notify(message: impl Into<String>) -> Self {
        CommandOutcome {
            notify: Some(message.into()),
            effect: CommandEffect::Done,
        }
    }

    pub fn with_effect(mut self, effect: CommandEffect) -> Self {
        self.effect = effect;
        self
    }
}

/// Ciò che la shell deve fare dopo un comando.
///
/// È parente di [`ViewUpdate`](crate::ui::ViewUpdate) e non lo stesso tipo: da
/// una view l'esito naturale è *ridisegnare la view*, da un comando non esiste
/// una view da ridisegnare. Le intenzioni che le due condividono (navigare,
/// rivelare, cercare) sono le stesse perché sono intenzioni della **shell**, non
/// del chiamante.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandEffect {
    /// Niente: il comando ha fatto ciò che doveva.
    Done,
    /// Apri questo documento.
    Navigate { doc: DocId },
    /// Aprilo e porta la vista su questo intervallo (in byte UTF-8, come ogni
    /// [`Span`] del modello): è dove il comando ha lasciato il lavoro fatto.
    Reveal { doc: DocId, span: Span },
    /// Cerca questo, e mostra i risultati.
    RunSearch { query: String },
    /// Ecco cosa farei. È l'esito di [`InvokeMode::DryRun`].
    Plan(CommandPlan),
    /// Varco di estensione con namespace: un intento che il protocollo non
    /// prevede. La shell che non riconosce `ns` **non fa nulla** — stesso
    /// degrado garbato di [`ViewUpdate::Custom`](crate::ui::ViewUpdate::Custom).
    Custom {
        ns: String,
        payload: serde_json::Value,
    },
    /// Apri **un'istanza** di una view, con questi parametri (§2.3).
    ///
    /// È l'altra metà delle istanze: [`ViewSpec::params`](crate::traits::ViewSpec::params)
    /// dice cosa una view accetta, questo è il modo in cui qualcuno gliene apre
    /// una. Che passi da un comando e non da una capacità dell'`HostApi` è la
    /// regola della decisione 0013 applicata: chi apre una view non ha bisogno
    /// della risposta per proseguire, e il comando è il canale che la shell già
    /// esegue — con la sua palette, la sua scorciatoia e la sua descrizione per
    /// un umano, gratis.
    ///
    /// `params` è convalidato contro i `ParamSpec` della view **prima** di
    /// arrivare al provider, come gli argomenti di un comando: chi apre può
    /// sbagliare, chi disegna no.
    OpenView {
        view: String,
        params: serde_json::Value,
    },
}

/// Cosa succederebbe: i documenti impattati e, per quelli che la decisione 0008 sa
/// esprimere, la modifica esatta.
///
/// I due elenchi non sono ridondanti. [`docs`](CommandPlan::docs) è la verità
/// completa — ci sta dentro anche ciò che una [`EditRequest`] non esprime
/// (creare, cestinare, rinominare: sono capacità **strutturali** dell'`HostApi`
/// — decisione 0013 — e non modifiche a un testo)
/// — mentre [`edits`](CommandPlan::edits) è il dettaglio di ciò che si può
/// mostrare come diff. Chi approva legge il primo; chi vuole vedere *cosa*
/// cambia legge il secondo.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct CommandPlan {
    /// Il piano in una riga, per l'utente («12 note, 34 sostituzioni»).
    pub summary: String,
    /// **Tutti** i documenti che verrebbero toccati, in ordine e senza
    /// ripetizioni. L'host lo completa con i documenti degli `edits`: chi
    /// approva deve vedere l'insieme vero, non quello che chi ha scritto il
    /// piano si è ricordato di elencare.
    pub docs: Vec<DocId>,
    /// Le modifiche proposte, una richiesta per documento. Le
    /// [`base`](EditRequest::base) sono le revisioni **di adesso**: se il
    /// documento cambia fra il piano e l'approvazione, applicarle fallisce con
    /// [`PluginError::Conflict`] invece di sovrascrivere.
    pub edits: Vec<PlannedEdit>,
}

impl CommandPlan {
    /// Un piano fatto solo di modifiche: i documenti impattati sono i loro.
    pub fn of_edits(summary: impl Into<String>, edits: Vec<PlannedEdit>) -> Self {
        let mut plan = CommandPlan {
            summary: summary.into(),
            docs: Vec::new(),
            edits,
        };
        plan.complete();
        plan
    }

    /// Aggiunge un documento impattato che nessun edit nomina (una nota che
    /// verrebbe creata, cestinata, rinominata).
    pub fn with_doc(mut self, doc: DocId) -> Self {
        if !self.docs.contains(&doc) {
            self.docs.push(doc);
        }
        self
    }

    /// Rimette l'insieme impattato in accordo con gli edit: ogni documento che
    /// una modifica nomina compare fra i `docs`, senza ripetizioni.
    ///
    /// La chiama l'host su ogni piano che attraversa il confine. Non è
    /// gentilezza verso chi lo ha scritto: è che quell'elenco è ciò che
    /// l'utente approva, e un piano che tocca una nota senza nominarla è un
    /// consenso strappato.
    pub fn complete(&mut self) {
        for planned in &self.edits {
            if !self.docs.contains(&planned.doc) {
                self.docs.push(planned.doc.clone());
            }
        }
    }

    /// Quante modifiche in tutto (la somma degli edit di ogni documento).
    pub fn edit_count(&self) -> usize {
        self.edits.iter().map(|p| p.edit.edits.len()).sum()
    }

    /// Un piano che non tocca niente.
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty() && self.edits.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Leggere gli argomenti
// ---------------------------------------------------------------------------

/// Gli argomenti di un'invocazione, letti secondo la specie dichiarata.
///
/// Sta nel contratto e non in ogni provider perché è l'altra metà di
/// [`CommandSpec::validate_args`]: chi dichiara un parametro `bool` deve poterlo
/// leggere come `bool` senza scrivere ogni volta la stessa discesa dentro un
/// `serde_json::Value` — e senza inventarsi una conversione diversa da quella
/// che l'host ha appena convalidato (accettare `"true"` in lettura, dopo che la
/// convalida lo ha rifiutato, è come non aver convalidato).
///
/// Un valore assente è `None`: la validazione dell'host è già passata, quindi
/// assente significa "non obbligatorio e non dato", e cosa farne lo decide il
/// comando.
#[derive(Clone, Copy, Debug)]
pub struct Args<'a>(&'a serde_json::Value);

impl<'a> Args<'a> {
    pub fn new(args: &'a serde_json::Value) -> Self {
        Args(args)
    }

    fn get(&self, name: &str) -> Option<&'a serde_json::Value> {
        self.0.get(name).filter(|v| !v.is_null())
    }

    pub fn text(&self, name: &str) -> Option<&'a str> {
        self.get(name)?.as_str()
    }

    pub fn number(&self, name: &str) -> Option<f64> {
        self.get(name)?.as_f64()
    }

    /// Un interruttore, col valore che vale quando l'argomento non c'è.
    pub fn flag(&self, name: &str, default: bool) -> bool {
        self.get(name).and_then(|v| v.as_bool()).unwrap_or(default)
    }

    pub fn document(&self, name: &str) -> Option<DocId> {
        self.text(name).map(DocId::new)
    }

    /// Un elenco di documenti. Assente e vuoto restano distinguibili
    /// (`None` vs `Some(vec![])`): per un comando che opera "su queste note,
    /// altrimenti su tutte" sono due cose diverse.
    pub fn documents(&self, name: &str) -> Option<Vec<DocId>> {
        Some(
            self.get(name)?
                .as_array()?
                .iter()
                .filter_map(|v| v.as_str())
                .map(DocId::new)
                .collect(),
        )
    }
}

/// La modifica che un comando propone per **un** documento.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlannedEdit {
    pub doc: DocId,
    pub edit: EditRequest,
}

impl PlannedEdit {
    pub fn new(doc: DocId, edit: EditRequest) -> Self {
        PlannedEdit { doc, edit }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec() -> CommandSpec {
        CommandSpec::new("vault.replace", "Sostituisci nel vault")
            .describing("Sostituisce un testo in tutte le note del vault.")
            .with_param(ParamSpec::new("find", "Cerca", ParamKind::Text).required())
            .with_param(ParamSpec::new("replace", "Sostituisci con", ParamKind::Text).required())
            .with_param(ParamSpec::new(
                "whole_word",
                "Parole intere",
                ParamKind::Bool,
            ))
            .with_param(ParamSpec::new("docs", "Solo in", ParamKind::Documents))
            .with_scope(CommandScope::writing(CommandReach::Documents))
    }

    #[test]
    fn a_missing_required_argument_is_named() {
        let err = spec()
            .validate_args(&json!({ "replace": "b" }))
            .unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("un argomento che manca è BadArgs")
        };
        assert!(
            msg.contains("find"),
            "il messaggio nomina cosa manca: {msg}"
        );
    }

    #[test]
    fn null_counts_as_absent_in_both_directions() {
        // È ciò che manda un chiamante JSON che non ha niente da dire.
        assert!(spec()
            .validate_args(&json!({ "find": "a", "replace": "b", "whole_word": null }))
            .is_ok());
        assert!(
            spec()
                .validate_args(&json!({ "find": null, "replace": "b" }))
                .is_err(),
            "per un obbligatorio, `null` è assente — quindi è un errore"
        );
    }

    #[test]
    fn the_kind_of_an_argument_is_checked() {
        assert!(
            spec()
                .validate_args(&json!({ "find": "a", "replace": "b", "whole_word": "sì" }))
                .is_err(),
            "una stringa non è un booleano: `\"false\"` sarebbe vero"
        );
        assert!(
            spec()
                .validate_args(&json!({ "find": "a", "replace": "b", "docs": ["x.md", 3] }))
                .is_err(),
            "un elenco di documenti sono stringhe, tutte"
        );
        assert!(spec()
            .validate_args(&json!({ "find": "a", "replace": "b", "docs": [] }))
            .is_ok());
    }

    #[test]
    fn an_undeclared_argument_is_refused_not_ignored() {
        let err = spec()
            .validate_args(&json!({ "find": "a", "replace": "b", "regex": true }))
            .unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("BadArgs")
        };
        assert!(
            msg.contains("regex") && msg.contains("find"),
            "il messaggio dice cosa è di troppo e cosa era dichiarato: {msg}"
        );
    }

    #[test]
    fn no_arguments_is_null_or_empty_object() {
        let semplice = CommandSpec::new("search.open", "Cerca");
        assert!(semplice.validate_args(&serde_json::Value::Null).is_ok());
        assert!(semplice.validate_args(&json!({})).is_ok());
        assert!(
            semplice.validate_args(&json!("cerca")).is_err(),
            "gli argomenti sono un oggetto, non un valore nudo"
        );
    }

    #[test]
    fn a_choice_only_accepts_declared_values() {
        let spec = CommandSpec::new("note.export", "Esporta").with_param(
            ParamSpec::new(
                "format",
                "Formato",
                ParamKind::Choice(vec![Choice::new("html", "HTML"), Choice::new("pdf", "PDF")]),
            )
            .required(),
        );
        assert!(spec.validate_args(&json!({ "format": "html" })).is_ok());
        let err = spec
            .validate_args(&json!({ "format": "docx" }))
            .unwrap_err();
        let PluginError::BadArgs(msg) = err else {
            panic!("BadArgs")
        };
        assert!(
            msg.contains("html") && msg.contains("pdf"),
            "chi sbaglia una scelta deve leggere quali erano: {msg}"
        );
    }

    #[test]
    fn a_plan_names_every_document_it_would_touch() {
        let edit = EditRequest::new(crate::edit::Revision::of("ciao"), Vec::new());
        let mut plan = CommandPlan {
            summary: "due note".into(),
            // Chi ha scritto il piano si è dimenticato di `b.md`.
            docs: vec![DocId::new("a.md")],
            edits: vec![
                PlannedEdit::new(DocId::new("a.md"), edit.clone()),
                PlannedEdit::new(DocId::new("b.md"), edit),
            ],
        };
        plan.complete();
        assert_eq!(
            plan.docs,
            vec![DocId::new("a.md"), DocId::new("b.md")],
            "l'insieme impattato è ciò che l'utente approva: l'host lo completa"
        );
    }

    #[test]
    fn the_reach_of_a_command_is_ordered() {
        assert!(CommandReach::Documents > CommandReach::Document);
        assert!(CommandReach::Vault > CommandReach::Documents);
        assert!(
            CommandScope::read_only().reach == CommandReach::Session,
            "chi non dichiara niente non tocca il vault"
        );
        assert!(!CommandScope::read_only().writes);
        assert!(
            !CommandScope::writing(CommandReach::Vault)
                .irreversible()
                .reversible
        );
    }
}
