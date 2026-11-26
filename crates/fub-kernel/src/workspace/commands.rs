//! I comandi dei provider, le loro letture e l'annulla del vault.

use super::*;

/// Il rifiuto di un comando che invoca sé stesso, con la catena che lo mostra.
///
/// Una frase sola per i quattro posti che lo controllano: la pila condivisa
/// (sincrona, staccata, rebuild) e la catena di una lettura col suo frame.
/// Il rifiuto di una lettura fermata: dal suo inizio, se chi smonta il
/// proprietario l'ha sbarrata, o dalla sua fine, se il vault si è chiuso o il
/// suo plugin si è spento mentre leggeva.
pub(super) fn read_stopped(command: &str) -> PluginError {
    PluginError::Cancelled(
        format!("il comando `{command}` è stato fermato: il vault si è chiuso o il suo plugin si sta spegnendo")
            .into(),
    )
}

pub(super) fn self_invocation(stack: &[String], command: &str) -> PluginError {
    let mut round = stack.to_vec();
    round.push(command.to_string());
    PluginError::BadArgs(
        format!(
            "un comando non può invocare sé stesso: {}",
            round.join(" → ")
        )
        .into(),
    )
}

/// Esegue il codice di un provider preparato, una volta sola: la porta comune
/// di [`PreparedCommand::invoke`] e [`PreparedReadOnlyCommand::invoke`].
pub(super) fn invoke_prepared(
    owner: &str,
    command: &str,
    args: &mut Option<serde_json::Value>,
    mode: InvokeMode,
    provider: &dyn CommandProvider,
    host: &mut dyn HostApi,
) -> std::result::Result<CommandOutcome, PluginError> {
    let args = args.take().ok_or_else(|| {
        PluginError::Internal("una chiamata preparata è stata invocata due volte".into())
    })?;
    crate::safety::calling(owner, Gate::Command, command, || {
        provider.invoke(command, args, mode, host)
    })
}

/// Una chiamata a `CommandProvider` preparata sotto lock e invocabile fuori.
///
/// Contiene anche il frame da ripristinare al rientro: attore, batch, pila e
/// flag di provider restano una singola transazione logica anche se il `RwLock`
/// non attraversa codice esterno.
pub struct PreparedCommand {
    pub(super) owner: String,
    pub(super) command: String,
    pub(super) args: Option<serde_json::Value>,
    pub(super) mode: InvokeMode,
    pub(super) provider: Arc<dyn CommandProvider>,
    pub(super) read_only_reason: Option<&'static str>,
    pub(super) previous_actor: Option<Actor>,
    pub(super) owns_batch: bool,
    pub(super) previous_provider_call: bool,
}

impl PreparedCommand {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    /// Modalità che il proxy deve usare per le capacità annidate.
    pub fn host_mode(&self) -> InvokeMode {
        if self.read_only_reason.is_some() {
            InvokeMode::DryRun
        } else {
            self.mode
        }
    }

    /// Il recinto addizionale da mettere davanti al proxy, se serve.
    pub fn read_only_reason(&self) -> Option<&'static str> {
        self.read_only_reason
    }

    /// Esegue **soltanto** il codice del provider. Nessun `Workspace` è
    /// necessario qui: chi chiama deve aver già rilasciato la sua guardia.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        invoke_prepared(
            &self.owner,
            &self.command,
            &mut self.args,
            self.mode,
            self.provider.as_ref(),
            host,
        )
    }
}

/// Una chiamata a un comando **di sola lettura**, preparata con un frame tutto
/// suo ([`Workspace::prepare_read_only_provider_command`]).
///
/// A differenza di [`PreparedCommand`] non lascia niente nello stato condiviso
/// del workspace: nessun attore scambiato, nessun batch aperto, nessuna voce
/// sulla pila dei comandi, `in_provider_call` mai alzato. Per questo l'host la
/// può eseguire **senza il turno di scrittura**, e due letture possono girare
/// insieme fra loro e accanto a chi scrive. La pila della ricorsione viaggia
/// dentro il token ([`chain`](Self::chain)): chi presta l'host al provider la
/// porta avanti alle invocazioni annidate.
pub struct PreparedReadOnlyCommand {
    pub(super) owner: String,
    pub(super) command: String,
    pub(super) args: Option<serde_json::Value>,
    pub(super) mode: InvokeMode,
    pub(super) provider: Arc<dyn CommandProvider>,
    pub(super) why: &'static str,
    /// I comandi della catena fino a questo, compreso.
    pub(super) chain: Vec<String>,
    /// Il workspace in cui è stata preparata: la fine non si applica a un
    /// altro, né a questo se nel frattempo si è chiuso.
    pub(super) workspace_id: u64,
    /// Il vault si stava già chiudendo alla preparazione? Allora è una
    /// lettura della chiusura stessa (un `deactivate` o un handler di
    /// `VaultClosed` che invoca un comando), e la chiusura non la invalida.
    pub(super) closed_at_prepare: bool,
    /// La bandiera **propria** della lettura: alzata da uno smontaggio o dalla
    /// chiusura, l'esito non si applica.
    pub(super) cancel: Arc<AtomicBool>,
    /// L'iscrizione fra le letture in volo, che cade col token. `None` per una
    /// lettura della chiusura stessa: la chiusura che l'ha lanciata non la
    /// deve aspettare.
    pub(super) _in_flight: Option<ReadInFlight>,
}

impl PreparedReadOnlyCommand {
    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn command(&self) -> &str {
        &self.command
    }

    /// Modalità per le capacità annidate: sempre una simulazione, come per il
    /// recinto di sola lettura del percorso condiviso.
    pub fn host_mode(&self) -> InvokeMode {
        InvokeMode::DryRun
    }

    /// Il motivo da dare a [`ReadOnly`](crate::ReadOnly), il recinto che l'host
    /// mette **sempre** davanti al proxy di questa chiamata.
    pub fn read_only_reason(&self) -> &'static str {
        self.why
    }

    /// La catena dei comandi fino a questo, compreso: è ciò che l'host passa a
    /// [`Workspace::prepare_read_only_provider_command`] per le invocazioni
    /// annidate, perché un comando che invoca sé stesso resti rifiutato.
    pub fn chain(&self) -> &[String] {
        &self.chain
    }

    /// Esegue **soltanto** il codice del provider, senza guardie del workspace.
    pub fn invoke(
        &mut self,
        host: &mut dyn HostApi,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        invoke_prepared(
            &self.owner,
            &self.command,
            &mut self.args,
            self.mode,
            self.provider.as_ref(),
            host,
        )
    }
}

/// Frame del solo rebuild di manutenzione che l'host porta avanti senza una
/// guardia del workspace. Attore, batch, pila e rinvio degli eventi restano
/// aperti fino alla riconciliazione finale.
pub struct PreparedMaintenanceRebuild {
    pub(super) owner: String,
    pub(super) command: String,
    pub(super) mode: InvokeMode,
    pub(super) previous_actor: Option<Actor>,
    pub(super) owns_batch: bool,
    pub(super) previous_dispatch_deferral: bool,
}

impl PreparedMaintenanceRebuild {
    pub fn mode(&self) -> InvokeMode {
        self.mode
    }
}

/// La chiave del rifiuto di un annullamento quando **un** file è cambiato
/// dopo l'operazione (argomento `doc`). Il testo sta nel catalogo dei comandi
/// del core, accanto a `vault.undo`.
pub const UNDO_STALE_ONE: &str = "vault.undo.stale_one";

/// Come [`UNDO_STALE_ONE`], per più file (argomento `docs`, separati da virgole).
pub const UNDO_STALE_MANY: &str = "vault.undo.stale_many";

/// Stato owned di un annullamento fra un passo e il successivo.
///
/// Il token tiene aperti replay e batch senza prestare il [`Workspace`], così
/// un host può eseguire provider, parser e indici dopo avere rilasciato il
/// proprio guard. Va sempre riconsegnato a
/// [`Workspace::finish_undo_replay_deferred`].
pub struct UndoReplay {
    pub(super) entry: crate::undo::Entry,
    pub(super) next: usize,
    pub(super) done: usize,
    pub(super) failure: Option<Failure>,
    /// Com'era la bandiera prima: un annullamento annidato non spegne quello di
    /// fuori uscendo.
    pub(super) before_replay: bool,
    pub(super) owns_batch: bool,
}

/// Epilogo di undo da completare soltanto dopo il drain degli eventi.
pub struct DeferredUndo {
    pub(super) entry: crate::undo::Entry,
    pub(super) done: usize,
    pub(super) failure: Option<Failure>,
    pub(super) before_replay: bool,
}

impl UndoReplay {
    /// Il prossimo passo, owned perché deve poter attraversare il confine del
    /// guard del workspace.
    pub fn next_step(&self) -> Option<UndoStep> {
        if self.failure.is_some() {
            return None;
        }
        self.entry.undo.steps.get(self.next).cloned()
    }

    /// Riconsegna l'esito del passo appena estratto.
    pub fn finish_step(&mut self, outcome: std::result::Result<(), Failure>) {
        debug_assert!(
            self.failure.is_none() && self.next < self.entry.undo.steps.len(),
            "un esito di undo deve seguire un passo preparato"
        );
        match outcome {
            Ok(()) => {
                self.done += 1;
                self.next += 1;
            }
            Err(failure) => self.failure = Some(failure),
        }
    }

    /// Registra nel token che il passo in corso è uscito per unwind.
    ///
    /// Il payload resta al driver, che lo riprenderà dopo l'epilogo. Qui serve
    /// soltanto distinguere l'interruzione da un replay completo: se nessun
    /// passo era riuscito, la normale chiusura rimette la voce in pila.
    pub fn finish_unwind(&mut self) {
        if self.failure.is_none() {
            self.failure = Some(Failure::other(PluginError::Internal(
                "undo interrotto da un panic".into(),
            )));
        }
    }
}

impl Workspace {
    // --- comandi -----------------------------------------------------------
    //
    // Il registro della decisione 0009: un'azione si dichiara una volta e la chiedono tutti
    // — la palette, la tastiera, una macro, la CLI, il centro di comando. Il
    // kernel non sa cosa faccia un comando; sa scegliere chi lo possiede,
    // convalidare ciò che gli si passa e decidere **quali capacità** prestargli.

    /// Registra un [`CommandProvider`] sotto un id, con la stessa disciplina
    /// degli altri provider: l'id è lo spazio dati che l'[`HostApi`] gli
    /// concede, e l'ordine di registrazione è l'ordine in cui i comandi
    /// compaiono e in cui si risolve un id conteso.
    pub fn register_command_provider(
        &mut self,
        plugin: impl Into<String>,
        provider: Box<dyn CommandProvider>,
    ) -> std::result::Result<(), RegistryError> {
        let plugin = plugin.into();
        let mut prepared =
            PreparedRegistration::commands(provider).map_err(RegistryError::External)?;
        let permit = self.registration_permit(&plugin)?;
        self.commit_registration(&permit, &mut prepared)
    }

    /// Le impostazioni `keys.<id>` di un elenco di comandi (§18.2).
    ///
    /// Tre scelte, e ognuna ha la sua ragione:
    ///
    /// - **Il default è il suggerimento dichiarato** (`CommandSpec.keybinding`,
    ///   o la stringa vuota). Ne segue la proprietà che rende superflua ogni
    ///   regola di fusione a valle: il valore *efficace* della chiave **è** la
    ///   scorciatoia, sempre — e `SettingSource` dice da sé se l'utente l'ha
    ///   cambiata, che è ciò da cui il pannello decide se mostrare «azzera».
    /// - **L'etichetta e la descrizione sono quelle del comando**, riusate
    ///   com'erano. Sono già dei `Text` del catalogo del suo proprietario, e
    ///   inventare qui due chiavi nuove avrebbe voluto dire chiedere a ogni
    ///   componente di tradurre una seconda volta il nome che ha già tradotto.
    /// - **Nessun gruppo.** Un'intestazione si raggruppa per *testo risolto*
    ///   (vedi [`SettingSpec::group`]), quindi una chiave di gruppo del core non
    ///   si tradurrebbe nel catalogo di un plugin: dire «Scorciatoie» a nome di
    ///   qualcun altro è ciò che qui non si può fare. A metterle insieme è la
    ///   shell, che sa comporre la chiave e quindi sa riconoscerle.
    ///
    /// Non è `program_writable`: quali tasti fanno cosa è dell'utente, ed è lo
    /// stesso argomento delle chiavi `locale.*`.
    pub(super) fn keybinding_specs(&self, specs: &[CommandSpec]) -> Vec<SettingSpec> {
        specs
            .iter()
            .map(|spec| {
                SettingSpec::new(
                    fub_abi::settings::keybinding_key(&spec.id),
                    spec.title.clone(),
                    SettingKind::Text {
                        default: spec.keybinding.clone().unwrap_or_default(),
                    },
                )
                .describing(spec.description.clone())
            })
            .collect()
    }

    /// Le impostazioni `<id>:permissions.<nome>` di un plugin dichiarato
    /// (§23.17): una per ogni permesso **che il suo manifest dichiara e che
    /// questo host conosce**.
    ///
    /// Quattro scelte, e ognuna ha la sua ragione.
    ///
    /// - **Solo i permessi dichiarati.** Un componente che non chiede la rete
    ///   non ha un interruttore della rete: un elenco di tredici righe quasi
    ///   tutte spente direbbe *cosa esiste* dove chi guarda vuole sapere *cosa
    ///   è stato chiesto*.
    /// - **Solo quelli che l'host conosce**
    ///   ([`permission::ALL`](fub_abi::options::permission::ALL)). Un permesso
    ///   fuori da quell'elenco non governa nessuna famiglia, quindi negarlo non
    ///   negherebbe niente — e un interruttore che non fa niente insegna a non
    ///   fidarsi degli interruttori (è la stessa riga con cui il pannello
    ///   nasconde «azzera» dove non c'è nulla da azzerare). Che quel permesso
    ///   *esista* nel manifest resta visibile: lo porta `PluginInfo`, e chi
    ///   disegna lo dice per quello che è.
    /// - **Il default è `true`.** Ciò che il manifest dichiara è concesso
    ///   finché qualcuno non dice di no. È l'unica forma che non cambia il
    ///   comportamento di ieri: un permesso che nessuno ha mai potuto vedere non
    ///   deve cominciare a mancare il giorno in cui acquista un interruttore.
    /// - **L'etichetta è la chiave del permesso, non una frase.** È deliberato,
    ///   ed è la riga di sicurezza di questa voce: la frase che l'utente legge
    ///   accettando *«può connettersi a qualunque host»* non deve poterla
    ///   scrivere chi il permesso lo sta chiedendo. Un `Text` di catalogo qui si
    ///   risolverebbe nel catalogo del **proprietario della chiave** (§12.1),
    ///   cioè del plugin; e un catalogo del core non si tradurrebbe a nome suo,
    ///   che è lo stesso ostacolo che le scorciatoie incontrano sul gruppo. La
    ///   frase la scrive quindi chi mostra — la shell, dal proprio catalogo, su
    ///   un elenco di nomi chiuso — e ciò che attraversa di qui è un
    ///   **identificatore**.
    ///
    /// Non è `program_writable`, e qui è più che una convenzione: un componente
    /// che potesse riscrivere questa chiave si riconcederebbe da sé ciò che
    /// l'utente gli ha tolto. È lo stesso argomento di `plugins.disabled`, un
    /// grado più in là — là avrebbe potuto spegnere chi lo controlla, qui
    /// potrebbe non farsi spegnere affatto.
    pub(super) fn permission_specs(&self, plugin: &str) -> Vec<SettingSpec> {
        let Some(entry) = self.providers.plugins.get(plugin) else {
            return Vec::new();
        };
        fub_abi::options::permission::ALL
            .iter()
            .filter(|key| entry.manifest.permissions.has(key))
            .map(|key| {
                SettingSpec::toggle(
                    fub_abi::settings::permission_key(plugin, key),
                    Text::Literal((*key).to_string()),
                    true,
                )
            })
            .collect()
    }

    /// Rifà il recinto di un plugin da ciò che l'utente ha negato **adesso**
    /// (§23.17).
    ///
    /// Si chiama alla dichiarazione e a ogni scrittura di una di quelle chiavi,
    /// e la seconda è quella che conta: una revoca deve valere alla prossima
    /// chiamata, non alla riapertura del vault. È il precedente che la
    /// [0097](../../../docs/decisions/0185-capability-un-solo-guard.md)
    /// ha scritto per la rete — `JobHost::fetch` rilegge il permesso a ogni
    /// chiamata invece di catturarlo all'avvio del job — onorato dalla parte
    /// opposta: là si rilegge perché la politica può essere cambiata, qui si
    /// riscrive la politica **nel momento** in cui cambia.
    ///
    /// Il conto sta da questa parte per la ragione che tiene [`Granted`]
    /// piccola: la politica si clona a ogni prestito, e un prestito accade a
    /// ogni evento consegnato a ogni handler. Rileggere lì dentro tredici
    /// chiavi di configurazione sarebbe una lettura dello store per evento; qui
    /// è un conto solo, e lo si fa quando una persona muove un interruttore.
    pub(super) fn reapply_permissions(&mut self, plugin: &str) {
        let Some(entry) = self.providers.plugins.get(plugin) else {
            return;
        };
        let declared: Vec<&'static str> = fub_abi::options::permission::ALL
            .iter()
            .copied()
            .filter(|key| entry.manifest.permissions.has(key))
            .collect();
        let store = self.settings.read().expect("store di configurazione");
        let denied: Vec<String> = declared
            .into_iter()
            .filter(|key| {
                // Una chiave che non si legge — perché nessuno l'ha dichiarata,
                // o perché il file porta un valore che non regge lo schema — è
                // un **non ho detto di no**: il default è la concessione, e
                // trattare l'illeggibile come un rifiuto spegnerebbe un
                // componente per un file scritto male.
                matches!(
                    store.effective(&fub_abi::settings::permission_key(plugin, key)),
                    Ok((SettingValue::Toggle(false), _))
                )
            })
            .map(String::from)
            .collect();
        drop(store);
        self.providers.plugins.restrict(plugin, &denied);
    }

    /// I comandi offerti dai provider registrati, in ordine di registrazione.
    ///
    /// È la metà "discovery" del registro, ed è la ragione per cui una
    /// [`CommandSpec`] porta descrizione, parametri e raggio: chi legge questo
    /// elenco può essere una palette, ma anche una CLI o un modello, e nessuno
    /// dei due ha letto il codice del comando.
    pub fn commands(&self) -> Vec<CommandSpec> {
        self.providers
            .command_specs_by_owner()
            .into_iter()
            .map(|(owner, mut spec)| {
                self.localize(&owner, &mut spec);
                spec
            })
            .collect()
    }

    /// Esegue — o **simula** — un comando.
    ///
    /// Due cose accadono qui e non dentro i comandi, e sono le due che rendono
    /// il registro utilizzabile da chi non lo conosce:
    ///
    /// 1. **Gli argomenti sono convalidati contro la spec**
    ///    ([`CommandSpec::validate_args`]) prima di chiamare chiunque. Un
    ///    comando non deve difendersi da un chiamante distratto, e chi sbaglia
    ///    riceve un [`PluginError::BadArgs`] che dice cosa manca — non un
    ///    comportamento a sorpresa.
    /// 2. **Le capacità dipendono da ciò che il comando ha dichiarato.** Scrive
    ///    solo un [`InvokeMode::Apply`] di un comando che si è dichiarato
    ///    `writes`; in ogni altro caso l'host prestato è in sola lettura e ogni
    ///    scrittura risponde [`PluginError::PermissionDenied`]. Il dry-run
    ///    quindi non è una promessa di chi implementa (che un comando di terzi
    ///    non manterrebbe), ed è per la stessa ragione che `writes: false` non è
    ///    una decorazione: dichiararsi innocuo è vincolante.
    ///
    /// 3. **L'invocazione è un lotto, intestato a chi l'ha chiesta** (decisione 0011 +
    ///    decisione 0012). Un `Apply` è, per definizione, *una* cosa che qualcuno ha
    ///    chiesto: `vault.replace` su 40 note emette un `batch-ended` solo, e
    ///    ogni evento che ne nasce porta `by` come attore. Che `by` sia un
    ///    parametro e non un default è la stessa scelta di [`InvokeMode`]:
    ///    attribuire all'utente ciò che ha chiesto un'automazione è l'errore che
    ///    16.2 esiste per non fare — l'automazione non riconoscerebbe più le
    ///    proprie scritture, e si richiamerebbe da sola.
    ///
    /// L'attore è **chi ha chiesto**, non il provider che esegue: un comando
    /// invocato da un plugin scrive con l'origine di quel plugin. Per la stessa
    /// ragione `by` non arriva fino a
    /// [`CommandProvider::invoke`]:
    /// l'origine è ciò che l'host **appone**, non ciò che il comando legge, e un
    /// comando che si comportasse diversamente a seconda di chi lo chiama
    /// sarebbe una policy (§7.3) nascosta dentro un'implementazione. Il giorno
    /// che servirà leggerla, è un metodo additivo sull'`HostApi`.
    ///
    /// Il resto è la disciplina di sempre: il provider esce dal workspace per la
    /// durata della chiamata, `in_provider_call` rimanda il dispatch, e ciò che
    /// il comando ha emesso arriva agli handler **dopo** che `invoke` è tornata.
    pub fn invoke_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.user_gesture_gate(command, Some(&by))?;
        self.as_actor(by, |ws| {
            ws.batch(|ws| ws.invoke_command_here(command, args, mode))
        })
    }

    /// Rifiuta i comandi di manutenzione che soltanto un gesto dell'utente
    /// raggiunge ([`crate::maintenance::user_gesture_only`]) quando non entrano
    /// dall'utente: `by` è `None` per ogni invocazione annidata, cioè per
    /// `run_command` sia sincrono sia da un job. Vale in ogni modo: una
    /// simulazione che promettesse un piano che l'applicazione poi rifiuta
    /// mentirebbe a chi la approva.
    pub(super) fn user_gesture_gate(
        &self,
        command: &str,
        by: Option<&Actor>,
    ) -> std::result::Result<(), PluginError> {
        if matches!(by, Some(Actor::User)) || !crate::maintenance::user_gesture_only(command) {
            return Ok(());
        }
        let at = self.command_owner(command)?;
        if self.providers.commands[at].id != crate::maintenance::MAINTENANCE_ID {
            return Ok(());
        }
        Err(PluginError::PermissionDenied(
            format!("`{command}` è riservato a un gesto dell'utente").into(),
        ))
    }

    /// Prepara il ramo **esterno** di un comando provider. `None` significa che
    /// il comando è manutenzione del kernel e va eseguito dal percorso interno.
    ///
    /// Dopo `Some`, il chiamante deve invocare [`PreparedCommand::invoke`] senza
    /// una guardia del workspace e riconsegnare sempre l'esito a
    /// [`finish_provider_command`](Self::finish_provider_command).
    pub fn prepare_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Actor,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        self.prepare_provider_command_here(command, args, mode, Some(by))
    }

    /// Versione per [`HostCommands::run_command`](fub_abi::traits::HostCommands::run_command):
    /// apre un batch se non ce n'è già uno, ma **non cambia attore**. Il
    /// chiamante resta chi è entrato nel kernel; annidare non è un nuovo ingresso.
    pub fn prepare_nested_provider_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        self.prepare_provider_command_here(command, args, mode, None)
    }

    /// Prepara un comando che si è dichiarato **di sola lettura**
    /// (`!spec.scope.writes`) con un frame tutto suo, che l'host può eseguire
    /// senza il turno di scrittura.
    ///
    /// Prende `&self`: non tocca lo stato condiviso. Niente `swap_actor`,
    /// niente batch, niente voce sulla pila dei comandi, `in_provider_call`
    /// resta basso. Gli eventi che altri producono mentre il comando legge
    /// arrivano subito, e la sua fine non spinge undo, non chiude batch e non
    /// accoda eventi ([`finish_read_only_provider_command`]).
    ///
    /// `outer` è la catena dei comandi che stanno invocando questo (vuota per
    /// un ingresso dall'utente): il rifiuto della ricorsione si calcola su di
    /// lei e non sulla pila condivisa, che appartiene a chi tiene il turno.
    ///
    /// La lettura si iscrive fra quelle in volo ([`reads_in_flight`]) finché
    /// il token vive, con `cancel`: la bandiera **sua**, che l'host che la
    /// serve guarda insieme a quelle di chi la contiene (`outer_stops`, la
    /// bandiera del job e delle letture fuori). Lo smontaggio del proprietario
    /// alza solo `cancel`: il job che l'ha chiamata riceve un `Cancelled` da
    /// `invoke_command` e decide lui. La chiusura del vault alza anche
    /// `outer_stops`, perché lì si ferma tutto. Finché la lettura è in volo,
    /// lo smontaggio del suo proprietario risponde `Busy`; mentre chi smonta
    /// il proprietario ne tiene la sbarra ([`ReadsInFlight::bar`]), una nuova
    /// lettura è rifiutata con `Cancelled`.
    ///
    /// [`reads_in_flight`]: Self::reads_in_flight
    ///
    /// `None` vuol dire «non è per questa porta»: il comando scrive, oppure è
    /// manutenzione del kernel. Il chiamante passa allora dal percorso di
    /// sempre ([`prepare_provider_command`], col turno). Vale anche per un
    /// comando che scrive invocato in `DryRun`: è l'anteprima di una
    /// scrittura, e la sua semantica resta quella del frame condiviso.
    ///
    /// [`finish_read_only_provider_command`]: Self::finish_read_only_provider_command
    /// [`prepare_provider_command`]: Self::prepare_provider_command
    pub fn prepare_read_only_provider_command(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        outer: &[String],
        cancel: &Arc<AtomicBool>,
        outer_stops: &[Arc<AtomicBool>],
    ) -> std::result::Result<Option<PreparedReadOnlyCommand>, PluginError> {
        let at = self.command_owner(command)?;
        let entry = &self.providers.commands[at];
        if entry.id == crate::maintenance::MAINTENANCE_ID {
            return Ok(None);
        }
        let spec = entry
            .specs
            .iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando");
        if spec.scope.writes {
            return Ok(None);
        }
        spec.validate_args(&args)?;

        if outer.iter().any(|c| c == command) {
            return Err(self_invocation(outer, command));
        }
        // Alla chiusura la lettura non si iscrive: chi si spegne può ancora
        // invocare i comandi di chi resta, e la chiusura non aspetta le
        // letture lanciate da sé. Altrimenti l'iscrizione è rifiutata se chi
        // smonta il proprietario ne ha sbarrato le nuove letture.
        let in_flight = if self.closed {
            None
        } else {
            let entered =
                self.reads_in_flight
                    .enter(&entry.id, Arc::clone(cancel), outer_stops.to_vec());
            Some(entered.ok_or_else(|| read_stopped(command))?)
        };
        let why = if mode.is_dry_run() {
            "una simulazione non scrive"
        } else {
            "il comando si è dichiarato di sola lettura"
        };
        let mut chain = outer.to_vec();
        chain.push(command.to_string());
        Ok(Some(PreparedReadOnlyCommand {
            owner: entry.id.clone(),
            command: command.to_string(),
            args: Some(args),
            mode,
            provider: Arc::clone(&entry.provider),
            why,
            chain,
            workspace_id: self.workspace_id,
            closed_at_prepare: self.closed,
            cancel: Arc::clone(cancel),
            _in_flight: in_flight,
        }))
    }

    /// Chiude una [`PreparedReadOnlyCommand`]: il recinto degli intenti,
    /// il completamento del piano e la localizzazione. Nient'altro: niente
    /// undo (una lettura non ha niente da annullare, anche se il provider ne
    /// dichiara uno), niente batch, niente eventi.
    ///
    /// Se il vault si è chiuso dopo la preparazione, o la lettura è stata
    /// fermata (la sua bandiera, alzata da uno smontaggio), l'esito non si
    /// applica: la chiamata risponde con [`PluginError::Cancelled`], anche se
    /// il provider ha ingoiato il rifiuto dell'host. Una lettura preparata
    /// quando la chiusura era già cominciata (chi si spegne può ancora
    /// invocare comandi, come sul percorso condiviso) finisce normalmente.
    pub fn finish_read_only_provider_command(
        &self,
        prepared: PreparedReadOnlyCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let closed_meanwhile = self.closed && !prepared.closed_at_prepare;
        let stopped = prepared.cancel.load(Ordering::Relaxed);
        if prepared.workspace_id != self.workspace_id || closed_meanwhile || stopped {
            return Err(read_stopped(&prepared.command));
        }
        let outcome = outcome.and_then(|outcome| {
            self.guard_command_intent(&prepared.owner, &outcome)
                .map(|()| outcome)
        });
        match outcome {
            Err(and) => Err(self.localized(&prepared.owner, and)),
            Ok(mut outcome) => {
                if let CommandEffect::Plan(plan) = &mut outcome.effect {
                    plan.complete();
                }
                self.localize(&prepared.owner, &mut outcome);
                Ok(outcome)
            }
        }
    }

    /// Il registro delle letture in volo, da tenere **fuori** dal lucchetto:
    /// chi chiude il vault lo usa per fermarle e aspettarle.
    pub fn reads_in_flight(&self) -> ReadsInFlight {
        self.reads_in_flight.clone()
    }

    pub(super) fn prepare_provider_command_here(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Option<Actor>,
    ) -> std::result::Result<Option<PreparedCommand>, PluginError> {
        let at = self.command_owner(command)?;
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando")
            .clone();
        spec.validate_args(&args)?;

        if self.providers.command_stack.iter().any(|c| c == command) {
            return Err(self_invocation(&self.providers.command_stack, command));
        }

        if self.providers.commands[at].id == crate::maintenance::MAINTENANCE_ID {
            return Ok(None);
        }

        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        let read_only_reason = if spec.scope.writes && mode == InvokeMode::Apply {
            None
        } else if mode.is_dry_run() {
            Some("una simulazione non scrive")
        } else {
            Some("il comando si è dichiarato di sola lettura")
        };

        let previous_actor = by.map(|by| self.dispatch.swap_actor(by));
        let owns_batch = self.dispatch.open_batch();
        self.providers.command_stack.push(command.to_string());
        let previous_provider_call = self.dispatch.enter_provider_call();

        Ok(Some(PreparedCommand {
            owner,
            command: command.to_string(),
            args: Some(args),
            mode,
            provider,
            read_only_reason,
            previous_actor,
            owns_batch,
            previous_provider_call,
        }))
    }

    /// Apre il frame staccato esclusivamente per `vault.rebuild-index`.
    ///
    /// Gli altri comandi di manutenzione restano sul percorso sincrono: questa
    /// porta non è un esecutore generico del potere interno del kernel.
    pub fn prepare_maintenance_rebuild(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        by: Option<Actor>,
    ) -> std::result::Result<Option<PreparedMaintenanceRebuild>, PluginError> {
        if command != crate::maintenance::VAULT_REBUILD_INDEX {
            return Ok(None);
        }

        let at = self.command_owner(command)?;
        if self.providers.commands[at].id != crate::maintenance::MAINTENANCE_ID {
            return Ok(None);
        }
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|spec| spec.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando");
        spec.validate_args(&args)?;

        if self.providers.command_stack.iter().any(|id| id == command) {
            return Err(self_invocation(&self.providers.command_stack, command));
        }

        let owner = self.providers.commands[at].id.clone();
        let previous_actor = by.map(|actor| self.dispatch.swap_actor(actor));
        let owns_batch = self.dispatch.open_batch();
        self.providers.command_stack.push(command.to_string());
        let previous_dispatch_deferral = self.dispatch.defer_dispatch();

        Ok(Some(PreparedMaintenanceRebuild {
            owner,
            command: command.to_string(),
            mode,
            previous_actor,
            owns_batch,
            previous_dispatch_deferral,
        }))
    }

    /// Chiude il frame del rebuild dopo che l'host ha completato tutte le fasi
    /// esterne. `None` è il dry-run, che conserva il piano del percorso comune.
    pub fn finish_maintenance_rebuild(
        &mut self,
        prepared: PreparedMaintenanceRebuild,
        opening: Option<std::result::Result<Opening, PluginError>>,
    ) -> DeferredEvents<std::result::Result<CommandOutcome, PluginError>> {
        let outcome = match opening {
            Some(Ok(opening)) => Ok(self.rebuild_index_outcome(opening)),
            Some(Err(error)) => Err(error),
            None => self.run_maintenance(&prepared.command, prepared.mode),
        };

        let popped = self.providers.command_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.command.as_str()));
        let result = match outcome {
            Err(error) => Err(self.localized(&prepared.owner, error)),
            Ok(mut outcome) => {
                if let CommandEffect::Plan(plan) = &mut outcome.effect {
                    plan.complete();
                }
                self.localize(&prepared.owner, &mut outcome);
                if prepared.mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
                    if let Some(undo) = outcome.undo.clone() {
                        self.undo.push(undo, outcome.partial.clone());
                    }
                }
                Ok(outcome)
            }
        };

        if prepared.owns_batch {
            self.dispatch.close_batch();
        }
        self.dispatch
            .restore_dispatch(prepared.previous_dispatch_deferral);
        DeferredEvents {
            outcome: result,
            previous_actor: prepared.previous_actor,
            journal: None,
        }
    }

    /// Chiude il frame del comando senza consegnare eventi. L'attore precedente
    /// resta nel token: storicamente veniva ripristinato soltanto *dopo* il
    /// dispatch e il percorso staccato conserva lo stesso ordine.
    pub fn finish_provider_command_deferred(
        &mut self,
        prepared: PreparedCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> DeferredEvents<std::result::Result<CommandOutcome, PluginError>> {
        self.dispatch
            .restore_provider_call(prepared.previous_provider_call);
        let popped = self.providers.command_stack.pop();
        debug_assert_eq!(popped.as_deref(), Some(prepared.command.as_str()));

        let outcome = outcome.and_then(|outcome| {
            self.guard_command_intent(&prepared.owner, &outcome)
                .map(|()| outcome)
        });
        let result = match outcome {
            Err(and) => Err(self.localized(&prepared.owner, and)),
            Ok(mut outcome) => {
                if let CommandEffect::Plan(plan) = &mut outcome.effect {
                    plan.complete();
                }
                self.localize(&prepared.owner, &mut outcome);
                if prepared.mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
                    if let Some(undo) = outcome.undo.clone() {
                        self.undo.push(undo, outcome.partial.clone());
                    }
                }
                Ok(outcome)
            }
        };

        if prepared.owns_batch {
            self.dispatch.close_batch();
        }
        DeferredEvents {
            outcome: result,
            previous_actor: prepared.previous_actor,
            journal: None,
        }
    }

    /// Il grado di chi ha scritto il comando decide se il suo intento
    /// `Custom` può arrivare alla shell ([`guard_intent`]). Vale per il
    /// percorso sincrono e per quello staccato, che finiscono entrambi qui.
    pub(super) fn guard_command_intent(
        &self,
        owner: &str,
        outcome: &CommandOutcome,
    ) -> std::result::Result<(), PluginError> {
        match &outcome.effect {
            CommandEffect::Custom { ns, .. } => {
                guard_intent(self.trust_of(owner).unwrap_or_default(), ns)
            }
            _ => Ok(()),
        }
    }

    /// Rientra dopo una [`PreparedCommand`] e riproduce l'epilogo del percorso
    /// sincrono: ripristino del flag, pila, localizzazione, undo, batch, dispatch
    /// e infine attore. Il provider non gira in questa funzione.
    pub fn finish_provider_command(
        &mut self,
        prepared: PreparedCommand,
        outcome: std::result::Result<CommandOutcome, PluginError>,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let deferred = self.finish_provider_command_deferred(prepared, outcome);
        self.dispatch_pending();
        self.finish_deferred_events(deferred)
    }

    /// Porta stretta dell'host per il solo ramo di manutenzione del kernel.
    ///
    /// Un `PreparedCommand` restituisce `None` soltanto per questo proprietario:
    /// tenere questa porta distinta impedisce a `fub-host` di acquisire una
    /// scorciatoia pubblica con cui eseguire provider arbitrari sotto lock.
    pub fn invoke_nested_maintenance_command(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let at = self.command_owner(command)?;
        if self.providers.commands[at].id != crate::maintenance::MAINTENANCE_ID {
            return Err(PluginError::PermissionDenied(
                format!("`{command}` non è un comando di manutenzione del kernel").into(),
            ));
        }
        self.invoke_command_nested(command, args, mode)
    }

    /// L'invocazione **annidata**: quella di
    /// [`HostCommands::run_command`](fub_abi::traits::HostCommands::run_command).
    ///
    /// Differisce da [`invoke_command`](Workspace::invoke_command) per le due
    /// cose che non fa, ed è lì che sta la semantica della decisione 0013:
    ///
    /// - **non cambia attore**: chi ha chiesto è chi è entrato nel kernel, e
    ///   invocare non è entrare. Un comando che si intestasse le scritture
    ///   fatte per conto dell'utente direbbe all'automazione che le ha chieste
    ///   lei, e un'automazione che non riconosce chi ha chiesto si richiama da
    ///   sola (è il caso che la decisione 0012 esiste per evitare, letto dall'altro
    ///   verso).
    /// - **non apre un lotto**: si unisce a quello aperto (se non ce n'è uno —
    ///   un handler che invoca un comando — lo apre, perché anche lì è *una*
    ///   cosa). Una macro di tre comandi è un `batch-ended` solo.
    ///
    /// Il **modo** invece non è un parametro di questa funzione per caso: lo
    /// passa l'host, che è l'unico a sapere in che modo sta girando chi
    /// invoca. Vedi `KernelHost::mode` e la politica `ReadOnly`.
    pub(crate) fn invoke_command_nested(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        self.user_gesture_gate(command, None)?;
        self.batch(|ws| ws.invoke_command_here(command, args, mode))
    }

    pub(super) fn invoke_command_here(
        &mut self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> std::result::Result<CommandOutcome, PluginError> {
        let at = self.command_owner(command)?;
        let spec = self.providers.commands[at]
            .specs
            .iter()
            .find(|s| s.id == command)
            .expect("il proprietario è stato trovato dichiarando questo comando")
            .clone();
        spec.validate_args(&args)?;

        // Il giro (decisione 0013). Un comando che rientra su sé stesso non è una
        // profondità da limitare con un numero: è un errore di chi lo ha
        // scritto, e l'unica risposta utile lo nomina.
        if self.providers.command_stack.iter().any(|c| c == command) {
            return Err(self_invocation(&self.providers.command_stack, command));
        }

        // **La manutenzione la esegue il kernel** (§15.2). L'id è passato dalla
        // porta di tutti — è stato ammesso, ha una spec, i suoi argomenti sono
        // stati convalidati, ha la sua chiave di scorciatoia — e qui si separa,
        // perché ciò che fa non sta sull'`HostApi` e non deve starci: rifare
        // l'indice non è una capacità da prestare a ogni plugin montato. È la
        // 0086 generalizzata — *la dichiarazione sta nel registro, l'esecuzione
        // sta dove sta il potere* — e sta **prima** del prestito di proposito:
        // ciò che viene dopo costruisce un host che a questi comandi non
        // servirebbe.
        // Il provider **resta** nel registro: si condivide il puntatore (vedi
        // il campo `commands`). È ciò che permette a `run_command` di trovare
        // gli altri comandi — e anche gli altri comandi dello stesso provider —
        // mentre questo è in corso.
        let owner = self.providers.commands[at].id.clone();
        let provider = Arc::clone(&self.providers.commands[at].provider);
        self.providers.command_stack.push(command.to_string());
        // **La manutenzione la esegue il kernel** (§15.2). L'id è passato dalla
        // porta di tutti — ammesso, con una spec, con gli argomenti convalidati,
        // con la sua chiave di scorciatoia — e si separa **solo** su chi lo
        // esegue, perché ciò che fa non sta sull'`HostApi` e non deve starci:
        // rifare l'indice non è una capacità da prestare a ogni plugin montato.
        // È la 0086 generalizzata — *la dichiarazione sta nel registro,
        // l'esecuzione sta dove sta il potere*.
        //
        // Che il ramo sia **qui dentro** e non un ritorno anticipato più su non
        // è cosmesi, ed è un difetto che un test ha trovato prima di questa
        // riga: ciò che viene dopo — la localizzazione dell'esito col catalogo
        // di chi l'ha scritto (0040), il completamento del piano, il drenaggio
        // della coda — vale per **ogni** comando, e un comando che salta quella
        // coda consegna una chiave di catalogo a chi si aspetta una frase.
        let outcome = if self.providers.commands[at].id == crate::maintenance::MAINTENANCE_ID {
            self.run_maintenance(command, mode)
        } else if spec.scope.writes && mode == InvokeMode::Apply {
            self.with_provider_call(|ws| {
                let mut host = ws.host_for(&owner, mode);
                crate::safety::calling(&owner, Gate::Command, command, || {
                    provider.invoke(command, args, mode, &mut host)
                })
            })
        } else {
            let why = if mode.is_dry_run() {
                "una simulazione non scrive"
            } else {
                "il comando si è dichiarato di sola lettura"
            };
            // Il rifiuto è un wrapper (§7.1): la politica dice quali famiglie
            // servire, e l'host sottostante gira in simulazione — così una
            // macro simulata compone i piani dei suoi passi invece di
            // rispondere `permission-denied` a ogni riga.
            // Due politiche insieme: quella del plugin e quella del divieto.
            // È la combinatoria del §7.3 senza un tipo per combinazione.
            let granted = self.providers.plugins.granted(&owner);
            let mut host = Guard::new(
                KernelHost {
                    ws: self,
                    plugin: &owner,
                    mode: InvokeMode::DryRun,
                    instance: None,
                },
                (ReadOnly { why }, granted),
            );
            crate::safety::calling(&owner, Gate::Command, command, || {
                provider.invoke(command, args, mode, &mut host)
            })
        };
        // Il `pop` è **fuori** dalla rete e prima del `?`: un comando che pania
        // non deve restare per sempre "in giro" nella pila, o la prossima
        // invocazione si rifiuterebbe da sé dicendo che sta chiamando sé stesso.
        self.providers.command_stack.pop();

        let mut outcome = outcome.map_err(|and| self.localized(&owner, and))?;
        self.guard_command_intent(&owner, &outcome)?;
        if let CommandEffect::Plan(plan) = &mut outcome.effect {
            // L'insieme impattato è ciò che l'utente approva: lo completa
            // l'host, invece di fidarsi che chi ha scritto il piano si sia
            // ricordato di elencare ogni documento che i suoi edit nominano.
            plan.complete();
        }
        // I testi dell'esito — la notifica, il riassunto di un piano — col
        // catalogo di chi ha eseguito. `run_command` annidato passa da qui come
        // l'invocazione dall'esterno: chi rientra riceve l'esito dell'altro già
        // risolto, che è giusto, perché il catalogo giusto è quello di chi ha
        // scritto la frase e non quello di chi la inoltra.
        self.localize(&owner, &mut outcome);
        // La pila dell'annullamento si riempie **a profondità zero** (§13.3):
        // una macro di tre rinomine è *una* cosa che qualcuno ha chiesto,
        // quindi una voce sola — la stessa regola per cui è un `batch-ended`
        // solo (decisione 0011). Chi compone comandi compone anche il loro
        // inverso, e `Undo::steps` esiste per permetterglielo.
        //
        // Solo `Apply`: una simulazione non ha fatto niente, e mettere in pila
        // l'inverso di ciò che non è successo sarebbe la scala per uscire dalla
        // simulazione — annullare qualcosa che non è mai stato fatto.
        //
        // Col conto dell'esito **appaiato** alla voce (§23.14): i due pezzi
        // arrivano da qui insieme e si separano una riga dopo — l'esito torna a
        // chi ha invocato, la voce resta in pila — quindi o si appaiano adesso o
        // mesi dopo, davanti al menu che disfa, nessuno sa più che quella
        // archiviazione era di undici note su dodici. La copia sta qui e non nei
        // comandi per la ragione della decisione 0098: una regola che vale per
        // tutti i chiamanti si scrive nel posto che tutti attraversano, e il
        // comando che qualcuno scriverà domani la eredita senza saperlo.
        if mode == InvokeMode::Apply && self.providers.command_stack.is_empty() {
            if let Some(undo) = outcome.undo.clone() {
                self.undo.push(undo, outcome.partial.clone());
            }
        }
        self.dispatch_pending();
        Ok(outcome)
    }

    /// Annulla l'ultima operazione annullabile, e dice quale era (§13.3).
    ///
    /// `Ok(None)` = non c'era niente, e non è un errore: è la risposta normale a
    /// un vault appena aperto.
    ///
    /// I passi girano nell'ordine in cui l'operazione li ha elencati, che è già
    /// quello in cui vanno eseguiti: chi esegue non riordina, perché riordinare
    /// vorrebbe dire capire cosa dipende da cosa, e lo sa meglio chi ha scritto
    /// l'operazione.
    ///
    /// # Ci si ferma al passo caduto, e lo si dice (§23.14)
    ///
    /// Una voce non è **un** passo: è una lista, e il passo che fallisce sta in
    /// mezzo agli altri. Prima il `?` di questo ciclo faceva due cose in
    /// silenzio — lasciava applicati i passi già fatti e **non provava** quelli
    /// dopo — e restituiva un errore nudo, mentre la voce era già uscita dalla
    /// pila. Chi annullava un'archiviazione di dodici note poteva ritrovarne
    /// quattro tornate indietro, otto no, e sullo schermo il perché di una sola.
    ///
    /// Ci si ferma ancora, e **non** si tira dritto: i passi non sono
    /// indipendenti. L'inverso di «crea `A`, poi rinominala in `B`» è
    /// `[rinomina B→A, cestina A]`, e proseguire dopo che la prima è fallita
    /// vorrebbe dire cestinare una nota `A` che non è quella — cioè fare un
    /// danno per rimediare a un danno. È l'opposto della regola di
    /// `vault.replace`, dove le N note *sono* indipendenti, e la differenza è
    /// tutta lì.
    ///
    /// Ciò che cambia è che il conto esce: quanti passi c'erano, quanti sono
    /// andati, e il perché di quello che ha fermato il giro. Se non ne è andato
    /// **nessuno** resta un errore — niente è cambiato, e la parola giusta per
    /// niente è ancora «fallito», che è la promessa che
    /// [`HostCommands::undo_last`](fub_abi::traits::HostCommands::undo_last)
    /// faceva già.
    ///
    /// # Prima di toccare un file si guardano tutti (A-10)
    ///
    /// Le [`UndoStep::Edit`] in testa alla voce — quelle prima del primo passo
    /// [`Command`](UndoStep::Command), una per documento — portano la
    /// revisione che l'operazione ha lasciato, e si controllano **tutte prima
    /// del primo passo**. Se un documento è cambiato dopo l'operazione,
    /// l'annullamento non tocca niente: torna un [`PluginError::Conflict`] che
    /// nomina i file cambiati, e la voce resta in pila. È ciò che rende un
    /// piano su più documenti ([`fub_abi::command::WritePlan`]) annullabile in
    /// un passo: [`AppliedPlan::undo`](fub_abi::command::AppliedPlan::undo)
    /// mette davanti, per ogni file, l'inverso della modifica o una richiesta
    /// vuota che fa solo da guardia. Dopo il primo comando la regola si ferma:
    /// che cosa un comando tocca lo sa lui, e la base di un passo dopo di lui
    /// può essere quella che lui stesso produrrà.
    pub fn prepare_undo_replay(&mut self) -> Option<UndoReplay> {
        let entry = self.undo.pop()?;
        let failure = self.stale_undo_guards(&entry.undo.steps);
        Some(UndoReplay {
            entry,
            next: 0,
            done: 0,
            failure,
            before_replay: self.undo.begin_replay(),
            // Tutto dentro un lotto solo: annullare una rinomina che aveva
            // riscritto quaranta sorgenti è un gesto, quindi un `batch-ended` e
            // un ridisegno.
            owns_batch: self.dispatch.open_batch(),
        })
    }

    /// Le guardie in testa a una voce di annullamento che non tengono più: il
    /// perché per [`prepare_undo_replay`](Self::prepare_undo_replay), o `None`
    /// se tutte reggono.
    ///
    /// Un documento che non si legge più (cancellato, un permesso, un disco)
    /// conta come cambiato: l'annullamento non sa più su cosa andrebbe a
    /// scrivere, e non scrivere niente è la risposta che non perde niente.
    pub(super) fn stale_undo_guards(&self, steps: &[UndoStep]) -> Option<Failure> {
        let mut seen: Vec<&DocId> = Vec::new();
        let mut stale: Vec<DocId> = Vec::new();
        for step in steps {
            let UndoStep::Edit(planned) = step else {
                break;
            };
            if seen.contains(&&planned.doc) {
                continue;
            }
            seen.push(&planned.doc);
            let base = &planned.edit.base;
            let holds = match self.document_revision(&planned.doc) {
                Ok(current) if current == *base => true,
                // Una base della forma vecchia non si confronta per
                // uguaglianza: si ricalcola sui byte.
                Ok(_) if !base.is_current_form() => self
                    .read_source_bytes(&planned.doc)
                    .is_ok_and(|bytes| base.matches_bytes(&bytes)),
                Ok(_) | Err(_) => false,
            };
            if !holds {
                stale.push(planned.doc.clone());
            }
        }
        let first = stale.first()?.clone();
        // La frase è una chiave del catalogo di chi annulla: la scrive
        // `vault.undo` (fub-features), che è il comando da cui passa l'utente.
        // Due chiavi e non una, perché il catalogo non sceglie il plurale.
        let text = match stale.as_slice() {
            [one] => Text::message(UNDO_STALE_ONE, vec![Arg::text("doc", one.as_str())]),
            many => Text::message(
                UNDO_STALE_MANY,
                vec![Arg::text(
                    "docs",
                    many.iter()
                        .map(DocId::as_str)
                        .collect::<Vec<_>>()
                        .join(", "),
                )],
            ),
        };
        Some(Failure::of(first, PluginError::Conflict(text)))
    }

    /// Chiude il batch senza chiamare handler. Replay resta attivo nel token:
    /// come nella via sincrona, verrà ripristinato soltanto dopo che gli eventi
    /// del batch sono stati consegnati.
    pub fn finish_undo_replay_deferred(&mut self, replay: UndoReplay) -> DeferredUndo {
        let UndoReplay {
            entry,
            done,
            failure,
            before_replay,
            owns_batch,
            ..
        } = replay;
        if owns_batch {
            self.dispatch.close_batch();
        }
        DeferredUndo {
            entry,
            done,
            failure,
            before_replay,
        }
    }

    /// Ripristina replay e produce lo stesso esito per il driver diretto e per
    /// quello staccato. Va chiamato dopo il drain degli eventi.
    pub fn finish_undo_replay(
        &mut self,
        deferred: DeferredUndo,
    ) -> std::result::Result<Option<Undone>, PluginError> {
        let DeferredUndo {
            entry,
            done,
            failure,
            before_replay,
        } = deferred;
        let count = entry.undo.steps.len();
        self.undo.end_replay(before_replay);

        match failure {
            None => Ok(Some(Undone {
                label: entry.undo.label,
                operation: entry.partial,
                replay: None,
            })),
            Some(failure) if done == 0 => {
                // Niente è cambiato: resta un errore, ma la voce torna in pila.
                // Il conflitto può essere transitorio e chi riprova deve
                // ritrovare lo stesso annullamento invece di una pila vuota.
                // `end_replay` è già passato qui sopra, quindi
                // `UndoStack::push` non scarta la voce come riproduzione
                // ricorsiva.
                let error = failure.error;
                self.undo.push(entry.undo, entry.partial);
                Err(error)
            }
            Some(failure) => Ok(Some(Undone {
                label: entry.undo.label,
                operation: entry.partial,
                replay: Partial::of(count, done, vec![failure]),
            })),
        }
    }

    /// Via sincrona del kernel: guida lo stesso token usato dagli host che
    /// devono rilasciare il workspace fra un passo e l'altro.
    pub(crate) fn undo_last(&mut self) -> std::result::Result<Option<Undone>, PluginError> {
        let Some(mut replay) = self.prepare_undo_replay() else {
            return Ok(None);
        };
        let replayed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            while let Some(step) = replay.next_step() {
                let outcome = match step {
                    UndoStep::Edit(planned) => self
                        .apply_edit(&planned.doc, planned.edit)
                        .map(|_| ())
                        .map_err(|and| Failure::of(planned.doc, and.into())),
                    UndoStep::Command { command, args } => self
                        .invoke_command_here(&command, args, InvokeMode::Apply)
                        .map(|_| ())
                        .map_err(Failure::other),
                };
                replay.finish_step(outcome);
            }
        }));
        if replayed.is_err() {
            replay.finish_unwind();
        }

        let deferred = self.finish_undo_replay_deferred(replay);
        let dispatched = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.dispatch_pending();
        }));
        let outcome = self.finish_undo_replay(deferred);

        if let Err(payload) = replayed {
            std::panic::resume_unwind(payload);
        }
        if let Err(payload) = dispatched {
            std::panic::resume_unwind(payload);
        }
        outcome
    }

    /// Chi possiede un comando, per posizione. `UnknownCommand` se nessuno.
    pub(super) fn command_owner(&self, command: &str) -> std::result::Result<usize, PluginError> {
        self.providers.command_owner(command)
    }
}
