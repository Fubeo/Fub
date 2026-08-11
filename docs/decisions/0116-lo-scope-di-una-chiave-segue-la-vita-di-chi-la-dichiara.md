# 0116 — Lo scope di una chiave segue la vita di chi la dichiara

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: [§16.3](../roadmap/16-crate-sdk-banchi-di-prova.md#163-un-crate-per-bundle-di-feature)
**Commit**: *(questo commit)*

---

## La domanda

La §16.3 è in due tempi, e il primo è chiuso dalla
[0071](0071-una-feature-si-spegne-dove-si-dichiara.md): una cargo feature per
bundle, con tantivy dietro la sua, e il grafo di `fub-features` sceso da 120
crate a 26 compilando la sola `outline`. Restavano due caselle: lo **split in
crate**, e un cliente arrivato dalla
[0090](0090-una-sequenza-e-una-modalita-che-scade.md) — *la scorciatoia di un
comando di shell non si riconfigura*, che la §18.2 aveva trasferito qui perché è
«la stessa domanda vista da fuori: la shell diventa un componente come gli
altri».

## Cosa la misura ha cambiato, prima di progettare

**La voce non chiedeva lo split.** È la premessa che si legge al contrario di
come sembra: la casella dello split non è lavoro in attesa di essere fatto, è
lavoro **tenuto fuori con una condizione** — «il primo import fra due moduli di
feature che non sia un link di documentazione» — e dalla
[0073](0073-una-condizione-che-nessuno-valuta.md) quella condizione la valuta un
banco (`i_moduli_non_si_parlano.rs`), che quando diventa rosso non accusa
nessuno: dice che la voce si è sbloccata. Verificato oggi: verde, i moduli di
feature sono dieci e non si nominano fra loro. Farlo adesso vorrebbe dire pagare
dieci `Cargo.toml` per dieci moduli che non si parlano, cioè comprare un confine
contro un accoppiamento che non c'è.

Ne segue la forma della chiusura, che vale la pena scrivere perché è la prima di
questa specie: **la voce si chiude lasciando quella casella dov'è**. Il criterio
del [§«Ma una voce chiusa può lasciare una casella»](../todo.md) lo copre
esattamente — *una voce aperta è lavoro che qualcuno deve ancora **decidere**,
una casella residua è lavoro già deciso che qualcuno deve ancora **fare*** — e
qui non c'è più niente da decidere: la decisione è presa, la condizione è
scritta, e il guardiano che la valuta esiste. Tenere la voce aperta per una
casella presidiata sarebbe tenere aperta una riga di roadmap perché qualcuno la
riguardi, quando l'unica cosa che la riguarderà è la CI.

**Le tre premesse della seconda casella erano tutte vere**, ed è la prima volta
in molti giri: la 0090 aveva misurato la strada del `CommandProvider` di
prossimità e ne aveva scritto i cinque ostacoli perché chi eseguisse la §16.3
non li rimisurasse. Rimisurati uno per uno, reggono tutti e cinque. Ciò che la
misura ha cambiato è **la conclusione che se ne trae**, e sta in una riga: *quei
cinque ostacoli non sono cinque, sono uno che si vede da cinque lati* — nascono
tutti dall'aver chiesto un **comando** quando ciò che serviva era una
**chiave**.

- I primi tre (`invoke` obbligatorio; nessun `PluginError` che dica «dichiarato
  qui, eseguito altrove»; `allCommands()` che concatena senza deduplicare)
  esistono solo se il comando di shell entra nel registro del kernel. Non ci
  deve entrare: un comando che il kernel elenca e non sa invocare è la bugia
  dentro il registro che la [0077](0077-una-scorciatoia-e-una-chiave.md)
  rifiuta, e la shell un registro suo ce l'ha già.
- Il quarto (la fixture `command-keys.json` nasce dal solo
  `CoreCommands::specs()`, quindi un provider nuovo resterebbe invisibile) non
  si chiude aggiungendo un confronto: si chiude **spostando la sorgente**.
- Il quinto — i provider si registrano per vault e `keys.*` è di scope `Vault`,
  ma `shell.vault.open` esiste *prima* di ogni vault — la 0090 lo chiama una
  contraddizione, ed è la cosa più utile che abbia scritto: non è una
  contraddizione della strada, è **la regola mancante**.

**E il difetto peggiore stava fuori dalla voce, per il diciassettesimo giro di
fila.** Cercando dove le chiavi della shell potessero vivere si è misurato che
`SettingScope::Machine` **manteneva la sua promessa a metà**. Il suo doc-comment
dice, del log: «deve valere anche **quando un vault non si apre**, che è
precisamente il caso in cui serve; una chiave che vive dentro il vault, in quel
caso, non si può nemmeno leggere». Il *valore* stava davvero nel file della
macchina — un `Arc<MachineSettings>` dell'host, condiviso da ogni vault aperto —
ma lo **schema** stava dentro il `SettingsStore` di un vault, cioè nell'unico
posto che sparisce esattamente in quel caso. `log.level` era leggibile e
scrivibile **solo con un vault aperto**: `set_setting` e `reset_setting` passano
da `Host::with_session`, che senza sessione risponde «Nessun vault aperto», e la
lettura passa da `IndexQuery::Settings`, che vuole un `Workspace`. Chi apriva
Fub su una finestra vuota per capire perché un vault non si apriva non poteva
alzare il livello del log — che è, alla lettera, il caso per cui quello scope
esiste.

## La decisione

**Lo scope di una chiave segue la vita di ciò che la dichiara.**

Un comando del kernel esiste finché un vault è montato: lo dichiara un
`CommandProvider`, che si registra per vault. La sua chiave sta nel vault,
viaggia con lui, e un vault può proporne una
([§23.13](0100-i-tasti-che-arrivano-da-fuori.md)). Un comando della shell esiste
finché l'app è aperta, e `shell.vault.open` è la prova per assurdo: una sua
chiave di vault nascerebbe solo dopo che un vault è aperto — cioè quando serve
meno — e vivrebbe dentro il vault che serve ad aprire. Quindi le chiavi
`keys.shell.*` sono **di macchina**, e non come eccezione: come conseguenza.

Da cui, in ordine:

1. **Il livello macchina ha uno schema.** `MachineSettings` teneva solo dei
   valori; adesso tiene anche le `SettingSpec` di scope `Machine` che il core
   dichiara, e sa rispondere da solo — `entries`, `effective`, `set`, `reset`.
   Una spec di scope `Vault` viene **rifiutata**: un livello che accettasse in
   silenzio risponderebbe col default per una chiave il cui valore vero sta nel
   vault. Chi dichiara è il **core** e nessun altro, per la stessa regola: un
   plugin si registra per vault, quindi le sue chiavi di macchina continuano a
   esistere quanto il vault che lo ha acceso.
2. **Senza vault, il canale dati serve le impostazioni della macchina.** Resta
   su quella porta e non ne prende una sua, perché un elenco è dati e i dati
   hanno un canale solo ([0019](0019-il-canale-dati.md)); e la regola sta in
   `Host::query_index` e non nel comando IPC, perché il livello macchina è
   dell'host e una regola che un banco non può interrogare non è presidiabile.
   Le altre domande continuano a volere un vault, e lo dicono con la frase che
   dice cosa fare.
3. **Scrivere si dice lo stesso.** Con un vault aperto l'evento
   `setting_changed` lo emette il `Workspace`; senza, il `Workspace` non c'è, e
   l'host lo emette al posto suo con `Actor::User` — di lì passa la persona
   davanti allo schermo. Senza questa riga una scorciatoia rimappata nella
   finestra vuota resterebbe scritta, riletta e mostrata giusta mentre la
   tastiera continua a rispondere a quella vecchia: è lo stesso difetto che la
   0090 aveva già trovato una volta per l'altra metà della famiglia.
4. **La tabella degli accordi della shell passa in Rust**, in
   `crates/fub-host/src/shell.rs`, e di là arriva **generata**
   (`frontend/src/ui/shell-keys.generated.ts`). È il criterio della
   [0056](0056-un-elenco-che-e-la-sorgente.md) letto dove ancora non era stato
   applicato: quando la produzione può *leggere* l'elenco, l'elenco smette di
   essere una copia da confrontare e diventa la sorgente. Il quarto ostacolo
   della 0090 sparisce con lo spostamento, e in più i due registri si possono
   finalmente guardare insieme **anche di qua**, dove il registro del kernel è
   in casa: `nessun_accordo_e_dichiarato_dai_due_registri` è il gemello Rust di
   `keybindings.test.ts`, e i due servono a due persone diverse — chi tocca la
   shell e chi tocca il registro dei comandi.
5. **Il pannello disegna le righe di shell come tutte le altre**, con la stessa
   `disegnaRiga`: campo di testo, provenienza, «azzera». Ciò che ci mette il
   pannello è il **nome**, che di là non c'è.

### L'etichetta di una chiave di shell è il suo id

`i_cataloghi.rs` ha detto di no, ed è la parte del giro che valeva più tempo:
*«un'etichetta cablata dentro uno schema è prosa che nessun catalogo
raggiunge»*. Ha ragione, e la ragione non copre questo caso. La chiave
`keys.shell.*` la dichiara il bundle di core, ma la frase che la nomina — «Apri
il pannello dei file» — l'ha scritta la shell, e una frase la localizza chi l'ha
scritta ([0040](0040-chi-localizza.md)). Le due strade erano: portare trentadue
stringhe nel catalogo del core, cioè lo stesso titolo tradotto due volte in due
posti che nessuno confronta — che è precisamente la famiglia di difetto per cui
esiste la [0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) — oppure
dire che l'etichetta è un **dato**: l'id, che `Text::Literal` documenta come
tale («il nome di un tag, un path»). Si è presa la seconda, e il presidio si è
**circoscritto** invece di indebolirsi, che è la mossa che la 0071 ha chiamato
per nome: l'esenzione si **calcola** da `shell_keybinding_specs()` invece di
essere un prefisso scritto a mano, e si pretende **esatta** — un'etichetta
cablata altrove resta rossa, e una chiave di shell che sparisce dalla tabella
lasciando l'esenzione più larga pure. Provate rosse tutte e due.

## Cosa NON si è fatto, e perché

- **Lo split in crate.** Resta la casella, con la sua condizione e il suo
  guardiano: vedi sopra.
- **Un `CommandProvider` di prossimità.** I cinque ostacoli della 0090 reggono,
  e la risposta è che di quel provider serviva solo la chiave.
- **Portare tutte le chiavi `keys.*` sulla macchina.** Sarebbe la
  semplificazione ovvia — una famiglia, un livello — e sarebbe sbagliata: un
  comando del kernel può non esistere in un altro vault (una feature spenta, un
  plugin diverso), e una scorciatoia che viaggia col vault è ciò che la 0077 ha
  deciso e ciò su cui la §23.13 ha costruito la sua domanda. La regola nuova
  spiega perché le due famiglie divergono invece di chiedere che convergano.
- **Un livello macchina scrivibile dai plugin.** Un plugin può dichiarare
  `.per_machine()`, e quelle chiavi continuano a vivere nello store del vault
  che lo ha acceso. È coerente con la regola: chi dichiara vive quanto ciò che
  dichiara.

## La verifica del rosso

Dieci rami tolti uno per volta, e tutti e dieci hanno reso rosso qualcosa:

1. `.per_machine()` via dalle spec di shell → **cinque** banchi rossi, e il
   montaggio panica in `con_lo_schema` perché il livello macchina rifiuta una
   chiave di vault: la regola è presa dal test *e* dal costruttore.
2. il ramo di scrittura senza vault →
   `senza_vault_una_scorciatoia_di_shell_si_riconfigura_e_resta`.
3. il ramo del canale dati senza vault →
   `il_canale_dati_serve_le_impostazioni_anche_senza_vault`.
4. l'emissione di `setting_changed` senza vault →
   `una_scrittura_senza_vault_si_dice_lo_stesso`.
5. `allCommands()` che torna a ignorare gli override per la shell → **cinque**
   banchi della shell, tre unitari e due e2e.
6. le righe di shell di nuovo in sola lettura nel pannello → l'ottavo gesto.
7. il generato lasciato stantio → il mirror.
8. un accordo di shell messo su `Mod-Alt-z`, che è di `vault.undo` → il banco
   Rust dei due registri **e** il gemello di là. (Con `Mod-n`, che nessun
   comando del kernel dichiara, non succede niente: i comandi ufficiali con un
   accordo sono **uno**, ed è una cosa che questa misura ha scoperto.)
9. un'etichetta cablata fuori dalla famiglia esentata → `i_cataloghi`.
10. una chiave di shell tolta dal montaggio con l'esenzione ferma →
    `i_cataloghi`, dal lato dell'esattezza.

E l'ordine dell'avvio: togliendo `loadKeyOverrides()` dal boot di `main.ts`, il
nono gesto diventa rosso.

### Le due zone cieche, dichiarate perché nessuno le deduca

**Un id in tabella che nessun pannello registra resta verde da tutte e due le
parti.** Il verso stretto lo prende il compilatore — `ShellCommandId` è una
chiave del generato, quindi un `registerShellCommand` fuori tabella non compila
— ma il verso largo no: sarebbe una riga di impostazioni per un comando che non
c'è. Chi lo vede è la palette, che quel comando non lo mostra.

**Il banco e2e della shell non smonta ciò che monta**, e questa voce è la prima
che ci inciampa. `document` è uno solo per tutto il file e nessuno toglie i suoi
ascoltatori di tastiera: ogni `avvia()` ne lascia uno addosso, ciascuno chiuso
sul proprio registro dei comandi. Misurato costruendo il caso: un tasto premuto
nel nono gesto rispondeva con la tastiera dell'ottavo, e il presidio passava
verde **anche togliendo la riga che doveva difendere**. Le due asserzioni che ne
dipendevano sono state riscritte sul **registro** invece che sul tasto, e il
fatto sta scritto nel file accanto a loro. È lavoro di un'altra voce — un
`mountKeyboard` che renda come si smonta — e vale per chiunque scriva un gesto
nuovo che prema una scorciatoia globale.

## I precedenti

**Una promessa che vive in un enum non è una promessa.** `SettingScope::Machine`
era documentato con la sua ragione — «deve valere quando un vault non si apre» —
e nessuno aveva verificato che la superficie per usarla esistesse in quel caso.
Non è la sesta specie della
[0072](0072-un-numero-si-scrive-accanto-a-come-si-ricava.md) (la garanzia mai
esistita), ed è peggio di un numero invecchiato: è una distinzione
**implementata a metà**, che si comporta bene in ogni caso tranne l'unico per
cui è stata scritta. Il modo di trovarla è stato dover collocare una famiglia
nuova e chiedersi *dove vive questa chiave quando la finestra è vuota*.

**Un ostacolo misurato bene si può rileggere.** La 0090 aveva fatto la cosa
giusta scrivendo i cinque punti invece di rimandarli, e la cosa più utile che
abbia lasciato è quella che chiamava una contraddizione: rileggerla ha dato la
regola, non un'eccezione. Un ostacolo che si può *nominare* è un ostacolo che
qualcuno può girare; uno rimandato con un «si vedrà» si rimisura da capo.
