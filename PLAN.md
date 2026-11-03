# Piano: Fub, la base su cui l'AI costruisce (A1)

Branch: piano/a1-base-per-ai
Obiettivo: chi usa Fub chiede a parole un'azione nuova («archivia questa nota
con la data di oggi»), un'AI la scrive come **ricetta**: una nota che Fub legge,
controlla, prova sulla nota aperta e spiega in parole semplici. La persona la
accende con un clic, la usa dalla palette o dal menu «/» e la annulla come ogni
altra azione. Accanto, Fub diventa una base su cui un'AI costruisce bene: un
censimento delle porte tenuto vero da un test, le prove di conformità dei
comandi, una guida per agenti e gli strumenti MCP per controllare e simulare.
Perché: l'utente vuole che Fub diventi «quasi quello che vuole», con la scelta
più solida e più sicura. Oggi per aggiungere un'azione bisogna scrivere e
compilare un componente WASM. Molte richieste però sono dati e non programmi, e
il contratto dei comandi le prevede già: `run_command` compone, l'undo di una
macro esiste, il permesso `fub:run-command` nomina già «una macro che compone
comandi altrui». Manca il pezzo che le rende una cosa che si scrive, si
controlla e si accende.
Fuori scope: il laboratorio dentro l'app (verifica e reinstallazione dei
componenti WASM), i blocchi tipizzati nuovi per le viste, i pacchetti condivisi,
l'assistente AI dentro Fub, le automazioni con gli inneschi e un linguaggio di
programmazione dentro Fub: sono le fasi F2-F6 qui sotto, con il loro cancello e
senza task. Fuori scope anche le condizioni e i cicli nelle ricette, i passi
che non si annullano o che cambiano le impostazioni, le ricette come comandi di
manutenzione, qualunque cambio a `fub-abi` (tranne un commento di
documentazione), al WIT e a `wit/frozen/`.
Assunzioni: le risposte consigliate alle domande D1-D10 qui sotto, finché
l'utente non risponde; K2 (`piano/k2-pagina-componenti`) in main prima di T4,
K2 e K3 (che tocca `session.rs`) in main prima di T9; i piani N3, N4, N6 e N7
in main o ribasati prima di T4 e di T9 (toccano `inventory.rs`,
`componenti.rs`, `registry.rs`, `mcp/tools.rs`).
Ondate: T1 T2 | T3 T4 | T5 T6 | T7 T8 | T9 | T10 T11 | T12 | T13
Prototipo: `PLAN-ui/ricette.html`, approvato dall'utente il 2026-11-03 (CSS
già passato dal sanitizer, vedi «Dal prototipo»); il piano per chi non è
tecnico è `PLAN-ui/a1-piano.html`.

## Modifiche

nessuna

## Domande per l'utente

Risposte: il 2026-11-03 l'utente ha confermato tutte le risposte consigliate,
(a) per D1-D10; i quattro cancelli (D4, D1, D9, D2) sono aperti.

Il piano va avanti con la risposta consigliata (la prima) come assunzione.
Quattro risposte vanno date prima del task che le fissa in un modo difficile
da disfare, e sono il suo cancello: D4 prima di T2 (la regola del permesso vale
anche per i componenti WASM), D1 e D9 prima di T4 (dove nascono le ricette), D2
prima di T8 (il consenso su disco). Se un'altra risposta non è la consigliata,
cambiano questi task: D3 → T5 e T7, D5 → T11, D8 → T4 e T12, D10 → T6; D6 e D7
toccano soltanto le fasi dopo. T1 e T3 non dipendono da nessuna risposta.

- **D1 · Dove vive una ricetta.**
  (a, consigliata) Una nota Markdown nella cartella delle ricette del vault,
  con un blocco `fub-recipe` dentro. Si legge, si copia e si manda a un amico
  come ogni nota, e un'AI la scrive con gli strumenti che ha già.
  (b) Un file nascosto in `.fub/`. (c) Soltanto nelle impostazioni.
  In pratica: con (a) le ricette si vedono fra le note e si possono cambiare a
  mano; dopo ogni cambio Fub chiede di nuovo se usarla.
- **D2 · Chi accende una ricetta.**
  (a, consigliata) Soltanto la persona, dentro l'app, da una finestra che dice
  che cosa fa. Vale per quel computer e per quel testo esatto: se la ricetta
  cambia, anche di una virgola, torna una proposta.
  (b) Anche un agente via MCP, con un permesso. (c) Da sola, se l'ha scritta la
  persona nell'app.
  In pratica: un clic in più, e niente di ciò che un'AI scrive parte da solo.
  Un vault sincronizzato su un altro computer arriva con le ricette spente.
- **D3 · Che cosa può fare una ricetta nella prima versione.**
  (a, consigliata) Solo comandi che si annullano e che non cambiano le
  impostazioni. (b) Tutto, con un avviso. (c) Solo comandi su una nota.
  In pratica: con (a) una ricetta non può svuotare il cestino né cambiare il
  tipo di una proprietà per tutto il vault; tutto ciò che fa si annulla con un
  solo «Annulla».
- **D4 · La forma del permesso.**
  (a, consigliata) Il permesso «usare i comandi» (`fub:run-command`) porta
  l'elenco dei comandi permessi, come il permesso di rete porta l'elenco dei
  siti. Senza elenco valgono tutti, come oggi; un elenco scritto male non ne
  permette nessuno. Vale anche per i componenti WASM.
  (b) Un permesso nuovo, solo per le ricette. (c) Nessun elenco: bastano i
  controlli della ricetta.
  In pratica: con (a) ogni ricetta, e ogni componente che lo dichiara, può
  usare soltanto i comandi che ha detto, e lo controlla lo stesso recinto che
  controlla già tutto il resto.
- **D5 · Dove gira l'AI.**
  (a, consigliata) Fuori da Fub, l'agente che la persona sceglie, collegato
  via MCP come oggi. Fub non manda niente a nessuno: dà all'agente una guida,
  il controllo e la prova delle ricette. (b) Un assistente dentro Fub, come
  componente a parte con un fornitore scelto dalla persona e spento di serie
  (fase F5). (c) Un modello locale dentro Fub.
  In pratica: con (a) serve un programma AI collegato a Fub, per esempio Claude
  Desktop o Claude Code. Nell'app le ricette arrivano come proposte da guardare.
- **D6 · Un linguaggio di programmazione dentro Fub.**
  (a, consigliata) Non ora. Dopo la prima versione delle ricette, con i casi
  veri in mano, se ne riparla come componente WASM che interpreta i copioni,
  dentro lo stesso recinto. (b) Sì, subito (per esempio JavaScript in WASM).
  (c) Mai.
  In pratica: con (a) le ricette non hanno «se» né «ripeti»; i programmi veri
  restano componenti WASM, costruiti fuori dall'app.
- **D7 · I mattoncini nuovi per l'aspetto delle aggiunte.**
  (a, consigliata) Dopo il congelamento del contratto (#289), come interfacce
  nuove e mai facendo crescere quelle pubblicate (la regola di K1), nell'ordine
  che dice il censimento. (b) Prima del congelamento, allargando `UiNode`.
  In pratica: per ora le viste delle aggiunte restano con i pezzi di oggi.
- **D8 · Il nome nell'interfaccia.**
  (a, consigliata) «Ricette». (b) «Azioni». (c) «Macro».
  In pratica: è la parola della sezione nelle impostazioni, del pulsante «Nuova
  ricetta» e della finestra. Nel codice «ricetta» c'è già per il tema e per i
  pennelli, mai davanti alla persona; i tipi nuovi si chiamano `Recipe…` in un
  modulo a sé, senza confondersi.
- **D9 · La cartella di serie.**
  (a, consigliata) `Recipes`, come `Templates` e `Daily` che Fub usa già.
  (b) `Ricette`. Si cambia in ogni vault dall'impostazione `recipes.folder`.
- **D10 · La palette propone la nota aperta.**
  (a, consigliata) Quando un comando chiede una nota, la palette propone quella
  aperta, e la persona la può cambiare: è ciò che il menu «/» fa già.
  (b) Solo per le ricette.
  In pratica: con (a) cambia un poco anche «Rinomina nota» e gli altri comandi
  con una nota fra i parametri: il campo arriva già pieno.

## Che cosa vuol dire «quasi quello che vuoi»

Un'app diventa «quello che vuoi» a strati. Per ognuno: che cosa c'è (verificato
nel codice), che cosa manca e che cosa fa questo piano.

| Strato | Che cosa c'è | Che cosa manca | Qui |
|---|---|---|---|
| Aspetto | temi e skin `theme-2` passati da `sanitizeThemeCss` (`apps/client/src/ui/sanitize-css.ts`), contratto per gli autori in `apps/client/theme/author/` | i mattoncini tipizzati per le viste delle aggiunte | censimento (T1), poi F3 |
| Tasti | le scorciatoie che un vault propone e la persona adotta (`Host::pending_keybindings`, `crates/fub-host/src/session.rs`) | niente di urgente | è il modello del consenso delle ricette |
| Dati e viste | `.base`, query salvate, template: file che un'AI scrive già via MCP | un modo di provarli prima di salvarli | la guida per agenti (T11) |
| Azioni | i comandi del registro, la palette, il menu «/», l'annullamento | comporre comandi senza compilare | **le ricette (T4-T12)** |
| Automazioni | `crates/fub-host/src/automation.rs` (P13: URI `fub://`, cattura) | gli inneschi (#89) | F6 |
| Funzioni nuove | componenti WASM in un recinto, catalogo firmato | provarli e reinstallarli senza toolchain dentro l'app | F2 |
| Il cuore | dati, salvataggi, permessi, indici, un solo `Guard` | niente: resta chiuso di proposito | resta chiuso |

## La risposta a «forse esagero?»

No, la direzione è giusta, e lo scheletro c'è già per gran parte: le porte
comuni, il recinto WASM, il `Guard` unico, il server MCP, la mappa dei
componenti. Il contratto prevede perfino le macro senza averle: la
documentazione di `HostCommands::run_command` (`crates/fub-abi/src/traits.rs`),
quella di `permission::RUN_COMMAND` (`crates/fub-abi/src/options.rs`) e
l'annullamento di una macro, che torna indietro dall'ultimo passo.

I limiti veri sono tre, e sono voluti:

1. **Il cuore non è un'aggiunta.** Dati, salvataggi, permessi e indici restano
   piccoli e rigidi. È proprio ciò che rende sicuro tutto il resto.
2. **Gli editor non si rifanno da fuori tasto per tasto, e le aggiunte non
   disegnano DOM libero.** Le viste sono alberi dichiarativi (`UiNode`), per
   sicurezza e per qualità. Si allarga il vocabolario (F3), non la porta.
3. **Un programma vero va compilato e provato.** Nella prima fase Fub
   controlla e simula, ma non compila. Un compilatore dentro l'app costa più di
   quanto vale; un linguaggio di programmazione dentro Fub è una domanda (D6).

Dove il costo supera il valore, ora: un motore di copioni generale, un
compilatore nell'app, un modello AI acceso di serie, il DOM libero per chi
scrive aggiunte.

## Le strade valutate

| Scelta | Strade | Consigliata, e perché |
|---|---|---|
| Come si aggiunge un'azione | ricette dichiarative; copioni interpretati; componenti WASM scritti dall'AI | **ricette** subito: si scrivono al primo colpo, si controllano tutte prima di girare, si annullano, girano anche sul telefono perché le interpreta l'host. I copioni dopo (D6), il WASM resta per i casi grandi |
| Il laboratorio | dentro l'app ora; più avanti con `fub componenti verifica`; mai | **più avanti (F2)**: prima serve che l'host sappia verificare un componente da solo (conformità, permessi, limiti) |
| Dove gira l'AI | fuori via MCP; dentro come componente; modello locale | **fuori (D5)** ora: niente esce dalla macchina passando da Fub. Dentro, come processo a parte e spento di serie, in F5 |
| La compilazione | fuori, con la toolchain della persona o con una CI; un servizio in rete; un compilatore dentro Fub | **fuori**, e Fub verifica (F2). Un servizio in rete manda codice e dati fuori; un compilatore dentro pesa centinaia di MB |
| L'aspetto | DOM libero; blocchi tipizzati nuovi; i blocchi di oggi | **blocchi tipizzati** (F3), in interfacce nuove, nell'ordine del censimento |
| Il consenso | per vault; per macchina; per macchina e per contenuto | **per macchina e per contenuto (D2)**: l'impronta del testo letto sta nel registro dei vault della macchina |
| Il permesso | elenco in `fub:run-command`; permesso nuovo; nessuno | **elenco (D4)**: stessa regola dell'elenco della rete, un solo `Guard`, vale anche per il WASM |

Perché una ricetta è un bundle a sé (`recipe.<id>`) e non un comando dentro un
provider solo: così ogni ricetta ha il suo manifest, il suo elenco di comandi e
il suo consenso, e il `Guard` le controlla una per una. Un provider unico
dovrebbe rifare dentro di sé la politica, cioè duplicare il `Guard`, che
`CLAUDE.md` vieta.

## Le ricette, prima versione: il contratto

Questa sezione è il riferimento di T4, T5, T7, T9, T10, T11 e T12. Il testo
canonico va in `docs/reference/ricette.md` (T4 lo crea, T5 e T7 lo completano).

**Dove.** Una ricetta è una nota Markdown sotto la cartella dell'impostazione
`recipes.folder` (di serie `Recipes`, D9), sottocartelle comprese, con
**esattamente un** blocco di codice con il linguaggio `fub-recipe`. Il resto
della nota è testo libero per chi la legge. Al massimo 200 ricette per vault,
le prime in ordine di percorso: oltre, Fub non legge le altre e la sezione lo
dice con una riga (il codice `troppe`, uno per vault e non per nota); restano
note come le altre e non si accendono. Una nota della cartella senza nessun
blocco `fub-recipe` non è una ricetta (un `LEGGIMI.md` lì dentro è normale):
non compare nell'elenco e non conta per il limite.

**Il blocco**, in YAML (letto con `serde_yaml_ng` dentro il budget di
`fub_abi::rules::yaml::within_budget`):

```yaml
fub-recipe: 1
id: archivia
title: Archivia la nota
description: Segna la data e sposta la nota in Archivio.
keybinding: Mod-Alt-a          # facoltativo, nella forma dei CommandSpec
surfaces: [slash]              # facoltativo: slash, slash_selection, toolbar
params:                        # facoltativo
  - name: cartella
    title: Cartella
    kind: text                 # text | number | bool | document | choice
    required: false
    options: []                # solo per choice
steps:
  - run: note.property.set
    args: { doc: "{{doc}}", key: archiviata, value: "{{date}}" }
  - run: note.rename
    args: { doc: "{{doc}}", to: "Archivio/{{title}}.md" }
```

- Campi sconosciuti: un problema (la lettura va avanti per trovare anche gli
  altri, ma la ricetta non si monta). `fub-recipe` più grande di 1: il problema
  `versione-futura`, e la ricetta resta spenta.
- `id`: `[a-z0-9-]`, da 1 a 48 caratteri, stabile. Non è il nome del file: la
  nota si può rinominare o spostare senza perdere il consenso. Due note con lo
  stesso `id`: il problema `id-ripetuto` su tutte e due, e nessuna si monta.
- `steps`: da 1 a 20. Niente condizioni, cicli, uscite di un passo usate da un
  altro.

**I segnaposto.** Lo stesso vocabolario dei template (`crates/fub-features/src/template.rs`,
`context_at` e compagni), che T5 sposta in un modulo condiviso:
`{{title}}` (il nome del file della nota su cui si usa, senza estensione),
`{{date}}`, `{{time}}`, `{{datetime}}`, `{{year}}`, `{{month}}`, `{{day}}`,
`{{hour}}`, `{{minute}}`. In più: `{{doc}}` (il percorso della nota),
`{{folder}}` (la sua cartella, vuota alla radice), `{{selection}}` (il testo
selezionato) e `{{param.<nome>}}`. `{{random}}` no: la prova deve mostrare ciò
che succederà. Un segnaposto sconosciuto è un problema (più severo dei
template, perché qui non c'è un testo da lasciare com'era). Una stringa che è
**esattamente** un segnaposto prende il valore col suo tipo (un numero resta
numero); altrimenti si interpola come testo.

**I controlli** (tutti prima di montare, ognuno con un codice stabile, il
percorso del campo e la riga nella nota, presa dallo span del blocco):

- forma: i campi, i limiti, i segnaposto, i parametri (nomi unici, `choice` con
  opzioni);
- contro il registro vivo (`check_against(&[CommandSpec])`): ogni `run` esiste e
  non è un'altra ricetta (`recipe.*`); la sua spec è `reversible` e la sua
  portata non è `Settings` (D3); gli `args`, con valori d'esempio del tipo
  giusto al posto dei segnaposto, passano `CommandSpec::validate_args`.

**I codici dei problemi**, stabili come gli id dei comandi (li legge la
persona, e li legge l'AI che corregge la ricetta): `blocco-assente` (lo
restituisce `parse`; l'elenco di T9 salta la nota, vedi sopra),
`blocchi-doppi`, `yaml` (il blocco non si legge o supera il budget),
`campo-sconosciuto`, `campo-mancante`, `valore-non-valido` (un tipo o un limite
sbagliato: l'`id` fuori da `[a-z0-9-]{1,48}`, zero o più di 20 passi, un `kind`
sconosciuto, un `choice` senza opzioni, due parametri con lo stesso nome, una
scorciatoia o una superficie che non esistono), `versione-futura`,
`segnaposto-sconosciuto` (anche `{{param.x}}` senza il parametro `x`, e
`{{random}}`), `comando-sconosciuto`, `comando-ricetta` (un passo che lancia
un'altra ricetta), `non-si-annulla`, `impostazioni` (portata `Settings`),
`argomenti` (`validate_args` li rifiuta), `id-ripetuto`, `id-occupato` (T9) e
`troppe`. Un codice nuovo si aggiunge; uno vecchio non cambia significato.

**L'impronta**: SHA-256 del JSON canonico della ricetta letta (non del testo
della nota: un commento cambiato fuori dal blocco non la tocca).

**La spec che nasce**: id `recipe.<id>:run`, titolo e descrizione letterali,
scorciatoia e superfici dal blocco, `writes` se un passo scrive, portata la più
larga dei passi, `reversible: true`. Parametri: prima `selection` (testo,
obbligatorio, e la superficie `slash_selection`) se si usa `{{selection}}`, poi
`doc` (documento, obbligatorio) se si usa `{{doc}}`, `{{title}}` o
`{{folder}}`, poi quelli dichiarati.

**L'esecuzione** (Apply): i passi in ordine, ognuno con `host.run_command`.
Se fallisce il primo passo: l'errore e basta. Se ne fallisce uno dopo:
`Ok` con `Partial::of(passi, riusciti, [Failure])`, un avviso che nomina il
passo, e l'annullamento dei passi riusciti. L'annullamento è composto qui,
perché il kernel lo spinge soltanto al livello più esterno: le `steps` di ogni
passo, concatenate dall'ultimo passo al primo, con il titolo della ricetta. Se
un passo torna senza annullamento, la ricetta torna senza, e l'avviso lo dice.
L'effetto è quello dell'ultimo passo.

**La prova** (DryRun): ogni passo in DryRun, e i piani si fondono (sommari
uniti, documenti senza doppioni, modifiche in fila). È approssimata quando un
passo dipende da un altro (dopo una rinomina il percorso cambia): lo dice la
pagina, e lo dice la finestra con una riga.

**Il consenso**: il manifest del bundle `recipe.<id>` dichiara
`fub:run-command: [i comandi dei passi]` e niente altro (nessun
`write-vault`: scrivono i comandi che invoca, ognuno col suo recinto). L'host
monta una ricetta soltanto se è adottata con quella impronta in
`VaultEntry.recipes_adopted` (il registro dei vault di **questa** macchina), se
passa i controlli e se il suo `id` è unico. Adottare scrive l'impronta, monta,
poi accende il permesso con `Host::set_setting_for_user`. Scartare toglie
l'impronta e smonta. Ciò che gira è sempre la ricetta letta e adottata, mai il
testo cambiato dopo: un cambio la rimette fra le proposte alla riconciliazione
successiva. Adottare e scartare esistono soltanto nell'app, mai come comando
del registro né via MCP.

## Che cosa ho verificato nel codice

- `HostCommands::run_command` (`crates/fub-abi/src/traits.rs`): una chiamata
  annidata non ha modo suo, l'attore resta quello di chi chiama e la ricorsione
  dà `BadArgs`. `invoke_command_nested` e `user_gesture_gate`
  (`crates/fub-kernel/src/workspace.rs`): l'annullamento si spinge solo al
  livello più esterno; i comandi di manutenzione segnati `user_gesture_only`
  sono rifiutati da chi non è l'utente.
- `Undo`, `UndoStep`, `CommandOutcome::partially`, `Partial::of`, `CommandPlan`,
  `CommandScope`, `CommandReach`, `CommandSurface`, `ParamKind`
  (`crates/fub-abi/src/command.rs`): bastano tutti, nessun tipo nuovo in ABI.
- `note.rename` crea la cartella che manca (`create_parent_synced` in
  `crates/fub-kernel/src/storage/rooted.rs`): «sposta in Archivio» funziona
  anche se `Archivio/` non c'è.
- `Granted` e l'elenco di `fub:network` (`crates/fub-kernel/src/host/guard.rs`):
  le tre letture (nessun elenco, elenco, elenco malformato che chiude) sono il
  modello di T2; `Policy::denies_host` è il modello di `denies_command`.
- Il consenso: chiave `<plugin>:permissions.<nome>` per macchina,
  `initialize_external_permissions` (`crates/fub-host/src/registry.rs`) la
  spegne per ogni bundle non `Core`, `reapply_permissions` la applica subito,
  `Host::set_setting_for_user` è la porta della persona.
- `BundleKind` sta in `crates/fub-host/src/registry.rs` (non in `fub-abi`), e il
  client filtra `bundle.kind === "component"` (`apps/client/src/panels/settings.ts`):
  un tipo `recipe` resta fuori dall'elenco dei componenti senza altro codice. La
  pagina dei componenti di K2 nasce dalla mappa, non dai bundle.
- `VaultEntry` (`crates/fub-host/src/vaults.rs`) ha già campi
  `#[serde(default)]`, come `keys_seen`: un Fub vecchio che riscrive il file
  perde l'impronta, e la ricetta torna una proposta (il verso sicuro).
- `Host::mount_bundle` passa da `set_plugin_enabled`, che **riscrive**
  `plugins.disabled` nelle impostazioni del vault. T9 non deve scrivere le
  impostazioni a ogni apertura (vedi T9).
- Il server MCP passa da `Connection` e, se l'app tiene il vault, dal canale di
  controllo (`crates/fub-host/src/control.rs`), che espone solo porte generiche.
  Controllare e provare una ricetta da fuori si fa con quelle (`Commands`,
  `ReadModel`, `InvokeCommand` in DryRun): nessuna chiamata nuova nel canale.
- La palette non riempie `doc` (`startCommand` in `apps/client/src/ui/palette.ts`);
  il menu «/» sì (`slashArgs` in `apps/client/src/state/slash.ts`).
- `apps/client/src/ui/permissions.ts` non mostra gli elenchi di cartelle che il
  `Guard` applica, e il suo commento dice il contrario del codice.

Non verificato:

- se `set_setting` con lo stesso valore riscrive il file delle impostazioni (T9
  lo misura prima di scegliere come montare);
- WASM su iOS (le ricette non ne hanno bisogno: le interpreta l'host);
- se il registro dei vault esiste uguale sul telefono (T9 lo legge in
  `crates/fub-host/src/vaults.rs` e lo scrive nella pagina);
- come le shell trattano i `Custom` di terzi con i namespace `fub:graph`,
  `fub:base` e `fub:diagram` (vedi «Da segnalare»).

Da segnalare, fuori da questo piano:

- `validate_untrusted` lascia ai terzi i namespace `Custom` `fub:graph`,
  `fub:base` e `fub:diagram` senza tipi: da aprire come issue;
- `refresh_specs` chiama il provider dentro la custodia: un rischio latente con
  la regola «niente lock attraverso il codice di altri»;
- `on-disk-layout.md` è a 549 righe su 550: T8 cambia una riga e non ne
  aggiunge.

## Le pagine di `docs/` che cambiano

- nuove: `docs/reference/censimento-delle-porte.md` (T1),
  `docs/reference/ricette.md` (T4, T5, T7), `docs/development/costruire-con-ai.md`
  (T11);
- aggiornate: `docs/README.md` (T1, T4, T11), `docs/map/dove-sta-x.md` (T1, T9),
  `docs/reference/permissions-and-security.md` (T2),
  `docs/development/plugin-authoring.md` (T3), `docs/reference/on-disk-layout.md`
  (T8, una riga cambiata sul posto), `docs/reference/ipc-contract.md` (T8, T10),
  `docs/reference/mcp-server.md` (T11), `docs/product/plugins-and-extensions.md`
  (T12);
- non tocca `docs/architecture/plugin-runtime.md` (449 righe su 450).

## Da dire agli altri piani

Dopo T1, ogni componente nuovo nella mappa vuole una riga nel censimento: il
test `crates/fub-features/tests/censimento.rs` lo pretende. Dopo T2,
`fub:run-command` con un elenco restringe davvero.

## Le fasi dopo questo piano

Ognuna è un piano a sé, con `/pianifica`, quando il suo cancello è aperto.

- **F2 · Il laboratorio.** `fub componenti verifica <file.wasm>`: conformità,
  permessi, limiti, prova su un vault finto, in parole semplici; reinstallare
  in sviluppo tenendo il consenso; fiducia «in sviluppo» (#85). Nell'app: una
  pagina che mostra l'esito e accende il componente. Cancello: ricette in main,
  T3 in main, risposta a D6.
- **F3 · I mattoncini.** I blocchi tipizzati nuovi per le viste, scelti dal
  censimento (le righe «solo nativa» e «solo host» dicono che cosa manca), come
  interfacce nuove (regola K1). Cancello: #289 congelato, risposta a D7.
- **F4 · Condividere e aggiornare.** Un pacchetto con ricette, viste e template;
  l'aggiornamento mostra a parole che cosa cambia e chiede di nuovo il consenso;
  il catalogo firmato che c'è già. Cancello: F2.
- **F5 · L'assistente dentro Fub.** Un processo a parte, un fornitore scelto
  dalla persona, spento di serie, una frase che dice che cosa esce dalla
  macchina. Cancello: risposta a D5 e una decisione di prodotto.
- **F6 · Le automazioni.** Inneschi (all'apertura, a un orario, alla creazione
  di una nota) che lanciano una ricetta adottata (#89). Cancello: ricette in
  main con almeno un ciclo di uso vero.

Su telefono: le ricette girano come sul desktop, perché le interpreta l'host;
il consenso è per macchina anche lì. Il WASM su iOS non è verificato e il
server MCP non esiste: un'AI le scrive da un altro computer, e il vault
sincronizzato le porta sul telefono come proposte.

## Dal prototipo

| Pezzo | Destinazione | Task |
|---|---|---|
| il blocco `/* → skin/settings.css */`: la sezione «Ricette» (righe, stato, problemi, vuoto, limite) **e** la finestra (passi, portata, prova, «cambiata») | `apps/client/src/theme/scrittoio/skin/settings.css`, in fondo, così com'è | T12 |
| la pelle rigenerata | `apps/client/src/theme/scrittoio/skin.css`, soltanto con `npm run theme:generate`, mai a mano | T12 |
| avviso «ricette da guardare»: niente CSS nuovo, il `.toast` di `skin/centres.css` e il `.settings-banner` di `skin/settings.css` | `apps/client/src/state/vault-session.ts`, `apps/client/src/panels/recipes.ts` | T12 |
| le 28 classi nuove `recipe-*`, elencate in fondo al prototipo | `apps/client/src/theme/scrittoio/anatomia/settings.ts` | T12 |
| struttura della sezione | `apps/client/src/panels/recipes.ts` (nuovo), agganciata in `apps/client/src/panels/settings.ts` | T12 |
| struttura della finestra | `apps/client/src/panels/recipe-dialog.ts` (nuovo) | T12 |
| testi `recipes.*` | `apps/client/src/i18n/strings.ts` | T12 |
| stati vuoto, pieno, problemi, carica, errore, finestra | `apps/client/bench/scene.mjs` | T13 |
| i blocchi «da foundation.css», «solo prototipo» e «già in skin» | da nessuna parte: sono i token, la cornice e le regole che ci sono già | — |

Tutto il CSS nuovo sta in `skin/settings.css`, anche quello della finestra,
per una ragione del codice: `anatomia.test.ts` vuole che le classi di ogni
`skin/<pezzo>.css` siano le classi di `anatomia/<pezzo>.ts`, senza doppioni fra
i pezzi. Le classi `recipe-*` stanno nell'anatomia delle impostazioni, quindi
la loro pelle sta lì; `kit.css` non cambia, e nessuna regola nuova nomina
`.kit-dialog` o un'altra classe del kit. `.recipe-dialog` allarga la finestra
da sola, perché `settings` viene dopo `kit` nell'ordine della pelle. Gli
attributi vestiti `data-status` (sulla riga) e `data-reach` (sulla portata)
li scrivono `recipes.ts` e `recipe-dialog.ts`, come il test vuole.

**La prova del prototipo** (2026-11-03, usa e getta, cancellata): il blocco
`→ skin/settings.css` passato dal vero `themeCssViolations` di
`src/ui/sanitize-css.ts` con la politica della pelle (`kind: "skin"`, gli hook
del profilo più le 28 classi nuove): 0 violazioni. Un controllo al contrario
(`backdrop-filter`, `counter()`, `@font-face`) ne ha date 6, quindi la prova
morde. Niente contatori CSS: il numero di ogni passo è un elemento
(`recipe-step-n`). Viste in Chromium senza testa: tutti gli stati della
barra, chiara e scura, a 1280, 700 e 400 px, senza scorrimento orizzontale né
errori; Invio e Spazio su «Guarda» aprono la finestra una volta e il fuoco va
su «Non ora». La prova non dice se la persona capisce la finestra: lo dice
soltanto l'utente guardandola.

## T1 · Il censimento delle porte

Perché: «ogni funzione ufficiale si può rifare da fuori?» diventa una tabella
che un test tiene vera, e dice a chi costruisce quali porte ci sono e quali
mancano.
Tocca: `docs/reference/censimento-delle-porte.md` (nuovo), `docs/README.md`
(un link), `docs/map/dove-sta-x.md` (una riga), `crates/fub-features/tests/censimento.rs`
(nuovo), `crates/fub-wasm-host/src/component.rs` (soltanto il modulo `tests`).
Non toccare: `crates/fub-features/src/inventory.rs`,
`crates/fub-features/src/componenti.rs`, la costante `EXPORTS_UNSERVED`,
`crates/fub-features/tests/cargo_features.rs`.
Dipende da: nessuno
Cosa fare:
- La pagina, in italiano, nella forma di `docs/development/documentation-style.md`.
  Tabella 1 «Le funzioni ufficiali», fra i commenti
  `<!-- censimento:funzioni:inizio -->` e `<!-- censimento:funzioni:fine -->`:
  `| id | cargo feature | porte | da fuori |`, una riga per ogni riga di
  `fub_features::componenti::righe()` con tutte le feature accese (`draw`
  compresa). `porte` è l'elenco, separato da virgole e nell'ordine dei campi di
  `OfficialFeature`, dei campi pieni della riga d'inventario: `vista`,
  `comandi`, `indice`, `sintassi`, `renderer`, `export`, `impostazioni`, e
  `collegamento:<variante di HostWiring in kebab-case>`; `—` per le righe senza
  riga d'inventario. `da fuori` è uno di: `sì` (tutto ciò che registra ha un
  export WIT servito), `solo nativa` (usa sintassi, renderer o export, che il
  WIT ha ma l'host non serve), `solo host` (ha un `HostWiring`), `nucleo` (in
  `componenti::NUCLEO`), `client` (riga senza bundle che vive nel client).
- Tabella 2 «Gli export WIT che l'host non serve», fra
  `<!-- censimento:export:inizio -->` e `<!-- censimento:export:fine -->`:
  `| interfaccia | chi la userebbe |`, una riga per voce di `EXPORTS_UNSERVED`.
- Tabella 3 «Che cosa si cambia dell'interfaccia», senza test: temi e skin,
  scorciatoie, pannelli e viste, barra di formattazione, menu «/», disposizione
  dello Scrittoio. Per ognuna dove sta nel codice (percorso verificato) e se
  un'aggiunta la può cambiare. Ciò che non verifichi lo scrivi come tale.
- `censimento.rs`: `include_str!("../../../docs/reference/censimento-delle-porte.md")`
  (il precedente è `crates/fub-app/tests/schemas_on_disk.rs`). Legge la tabella
  1 e controlla: ogni id di `righe()` ha una riga sola; ogni riga ha un id di
  `righe()` oppure una cargo feature dichiarata in `[features]` di
  `crates/fub-features/Cargo.toml` (letta come fa `declared()` in
  `cargo_features.rs`: copia il lettore, i test non si importano); per ogni riga
  di `every_official_feature()` la colonna `porte` coincide con i campi pieni;
  `da fuori` è nel vocabolario; un `HostWiring` diverso da `None` vuol dire
  `solo host`; `sintassi`, `renderer` o `export` senza collegamento vogliono
  dire `solo nativa`; gli id di `NUCLEO` dicono `nucleo`. Ogni errore nomina la
  riga e che cosa scrivere.
- Nel modulo `tests` di `component.rs`, un test `il_censimento_conosce_gli_export_non_serviti`:
  legge la tabella 2 con `include_str!("../../../docs/reference/censimento-delle-porte.md")`
  e confronta l'insieme con `EXPORTS_UNSERVED`.
- Link in `docs/README.md` (resta sotto 150 righe) e una riga in
  `docs/map/dove-sta-x.md`.
Casi limite: una riga senza bundle (Lavagna; PDF se K2 è già in main), una
feature fuori dal default (`draw`), una riga d'inventario che non registra
niente (la rifiuta già `mount.rs`), una riga aggiunta da un altro piano mentre
lavori (il test deve fallire con un messaggio che dice di aggiungerla), tabelle
con spazi o allineamenti diversi.
Fatto quando: `cargo test -p fub-features --test censimento` e
`cargo test -p fub-wasm-host --lib il_censimento_conosce_gli_export_non_serviti`
sono verdi; togliendo una riga dalla tabella 1, o cambiando una cella `porte`,
il primo fallisce con un messaggio che nomina la riga (provalo e rimetti a
posto); `node .github/scripts/check-doc-links.mjs`, `check-doc-orphans.mjs` e
`check-doc-size.mjs` sono verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · L'elenco dei comandi di `fub:run-command`

Perché: una ricetta, e ogni componente che lo dichiara, invoca soltanto i
comandi che ha nominato, e lo controlla il `Guard` unico (D4).
Tocca: `crates/fub-kernel/src/host/guard.rs` (`Policy`, `Granted`,
`impl Policy for Granted`, `Guard::run_command`, `Guard::undo_last`, modulo
`tests`), `crates/fub-abi/src/options.rs` (soltanto il commento di
`RUN_COMMAND`),
`docs/reference/permissions-and-security.md`.
Non toccare: le letture di `fub:network` e degli elenchi di cartelle, le chiavi
dei permessi, il WIT, `crates/fub-host/src/registry.rs`, la UI dei permessi
(è T6).
Dipende da: nessuno; cancello: risposta a D4.
Cosa fare:
- In `Policy`, `fn denies_command(&self, _command: &str) -> Option<String>`
  con il default `None`, come `denies_host`.
- In `Granted`, un campo `commands: Option<Arc<[Box<str>]>>` letto una volta in
  `Granted::new` dal valore **grezzo** di `permission::RUN_COMMAND`, con le tre
  letture di `network`: assente, `Bool`, `Null` o elenco vuoto → `None` (tutti
  i comandi); elenco di sole stringhe → `Some(elenco)`; qualunque altra cosa
  (stringa, numero, oggetto, elenco con una non-stringa) → `Some([])`, nessun
  comando. Confronto esatto, senza prefissi e senza `*`.
- `impl Policy for Granted`: `denies_command` dice «`<plugin>` non nomina
  `<comando>` in `fub:run-command`».
- `Guard::run_command`: dopo il `check` di oggi, `denies_command` →
  `PluginError::PermissionDenied`.
- `Guard::undo_last`: con un elenco (`Some`), rifiuta. Un annullamento rigioca
  comandi che l'elenco non nomina, e il `Guard` non sa quali: fallisce chiuso,
  come fa già con le cartelle.
- Il commento di `RUN_COMMAND` in `options.rs` dice il parametro e le tre
  letture; `permissions-and-security.md` lo stesso, con un esempio.
Casi limite: un elenco con un id ripetuto, un id con spazi intorno (non si
toglie niente: non combacia), `ReadOnly` (resta com'è), un comando che
l'elenco nomina ma che non esiste (`UnknownCommand`, come oggi), un plugin
`Core` senza parametro (tutto come oggi).
Fatto quando: nel modulo `tests` di `guard.rs`, con `Guard::new(host, Granted::new(…))`
e un host finto come `Undoes` e `CountsUndoes` che ci sono già, i test provano:
elenco → solo quei comandi passano; senza parametro → tutti; `"note.trash"`
come stringa → nessuno; elenco → `undo_last` rifiutato; senza elenco →
`undo_last` come oggi. `cargo test -p fub-kernel` verde.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T3 · La conformità dei comandi in `fub-sdk`

Perché: un'AI che scrive un provider di comandi deve poter chiedere «è giusto?»
a una prova sola, come succede già per indici, viste e formati.
Tocca: `crates/fub-sdk/src/testing/conformance.rs`,
`crates/fub-features/tests/command_conformance.rs` (nuovo),
`docs/development/plugin-authoring.md`.
Non toccare: i provider di `fub-features` (se uno non passa, lo segnali nel
report invece di cambiarlo), `MemoryHost`, il WIT.
Dipende da: nessuno
Cosa fare:
- In `conformance.rs`, `pub fn a_command_provider_respects_the_contract<C: CommandProvider + ?Sized>(provider: &mut C, host: &mut MemoryHost, owner: fub_abi::rules::ids::Owner<'_>)`
  e le funzioni che chiama, una per regola, nello stile delle altre:
  `command_ids_are_distinct_and_namespaced` (con `fub_abi::rules::ids::check(id, owner)`:
  `Owner::Core` per le feature ufficiali, `Owner::Plugin("recipe.archivia")`
  per una ricetta),
  `params_are_unique_and_choices_have_options`, `keybindings_parse`
  (con il lettore che usa già il registro), `an_unknown_command_is_unknown`
  (`PluginError::UnknownCommand`), `a_dry_run_does_not_write` (ogni comando
  senza parametri obbligatori, in DryRun, lascia `MemoryHost` uguale),
  `a_read_only_command_does_not_write` (stessa cosa per `writes == false` in
  Apply).
- Aggiorna «ventotto funzioni» in testa al file al numero nuovo, tenendo il
  marcatore `[conta: conformance-functions]`.
- `command_conformance.rs`: la prova su ogni provider di comandi di
  `every_official_feature()`, con `Owner::Core`.
- `plugin-authoring.md`: una riga per la prova nuova, accanto alle altre.
Casi limite: un provider senza comandi (passa), un comando che in DryRun
chiede un documento che non c'è (non conta come scrittura), un comando che
legge l'orologio, un provider che vuole un servizio di un altro bundle
(`MemoryHost` non lo ha: salta il comando e lo scrive nel messaggio).
Fatto quando: `cargo test -p fub-features --test command_conformance` e
`cargo test -p fub-sdk` verdi; un provider finto con due comandi dallo stesso id
fa fallire `command_ids_are_distinct_and_namespaced` (test negativo in
`fub-sdk`).
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T4 · Il componente «Ricette» e `recipes.new`

Perché: le ricette sono un componente come gli altri, che si spegne e si vede
nella mappa; e la persona ha un punto di partenza anche senza AI.
Tocca: `crates/fub-features/Cargo.toml`, `crates/fub-features/src/lib.rs`,
`crates/fub-features/src/recipes.rs` (nuovo),
`crates/fub-features/src/inventory.rs`, `crates/fub-features/src/componenti.rs`,
`crates/fub-host/Cargo.toml`, `docs/reference/censimento-delle-porte.md` (la
riga nuova), `docs/reference/ricette.md` (nuovo), `docs/README.md` (un link).
Non toccare: `crates/fub-features/src/template.rs` (è T5), i comandi di
`commands.rs`, `crates/fub-host/src/registry.rs`.
Dipende da: T1; cancello: risposte a D1 e D9, K2 in main, N3, N4, N6 e N7 in
main o ribasati.
Cosa fare:
- Cargo: `recipes = ["commands", "dep:serde_yaml_ng", "dep:sha2", "dep:jiff"]`
  nel `default` di `fub-features`, con un commento come quello di
  `trash = ["commands"]`: è una dipendenza di funzionamento (l'annullamento di
  `recipes.new` è `note.trash`, e la riga d'inventario nomina `COMMANDS_ID`,
  che esiste solo con `commands`). In `crates/fub-host/Cargo.toml`, `"recipes"`
  nell'elenco `official-features` e `recipes = ["fub-features/recipes"]` accanto
  alle altre.
- `recipes.rs`: `pub const RECIPES_ID: &str = "fub.recipes"`, il catalogo
  (it, en), l'impostazione `recipes.folder` (testo, di serie `Recipes`, D9)
  dichiarata come `daily.folder` in `template.rs`, e `RecipesCommands` con un
  comando solo, `recipes.new`: parametro `title` (testo, facoltativo, di serie
  «Nuova ricetta»); crea `<cartella>/<title>.md` con una ricetta d'esempio
  (quella della sezione «Il contratto»), un nome libero come fa `note.create`
  se c'è già, l'effetto `Navigate`, l'annullamento
  `Undo::by_command("note.trash", …)` col letterale (i moduli non si nominano:
  `tests/independent_modules.rs`).
- La riga d'inventario `fub.recipes` (`commands`, `settings`,
  `requires: &[COMMANDS_ID]`) e la riga della mappa
  `Riga::servizio("fub.recipes", "component.recipes.name").group("scrivere").requires(&["fub.markdown", "fub.commands"]).cargo_feature("recipes")`,
  con nome e descrizione nel catalogo (`NOMI` e `DESCRIZIONI` di K2), nella
  lingua di D8.
- La riga nel censimento. La pagina `ricette.md`: dove vive una ricetta, il
  blocco, i campi, i limiti; T5 e T7 la completano.
Casi limite: la cartella non c'è (si crea), il titolo con `/` o `..` (rifiuto
con `BadArgs`, come `note.create`), il vault con la feature spenta
(`--no-default-features`: niente riga, niente comando), `recipes` accesa da
sola (`cargo check -p fub-features --no-default-features --features recipes`,
che `scripts/check.sh` fa per ogni feature).
Fatto quando: `cargo test -p fub-features --test cargo_features --test componenti --test censimento --test catalogs`
verdi; un test e2e in `recipes.rs` (con `fub_kernel::Workspace` e
`MarkdownProvider`, come `tests/template_e2e.rs`) prova che `recipes.new` crea
la nota e che l'annullamento la toglie; `cargo check -p fub-features --no-default-features --all-targets`
verde.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T5 · Il formato e i controlli delle ricette

Perché: una ricetta si legge, si controlla e si spiega prima di girare; ogni
errore ha un codice, un campo e una riga, così un'AI si corregge da sola.
Tocca: `crates/fub-features/src/recipes.rs`, `crates/fub-features/src/vocabulary.rs`
(nuovo), `crates/fub-features/src/template.rs`, `crates/fub-features/src/lib.rs`,
`crates/fub-features/tests/independent_modules.rs` (soltanto `SHARED`),
`crates/fub-features/tests/recipes_format.rs` (nuovo), `docs/reference/ricette.md`.
Non toccare: il comportamento dei template (i loro test restano verdi senza
cambiarli), `crates/fub-host/`, `fub-abi`.
Dipende da: T4
Cosa fare:
- `vocabulary.rs`: sposta da `template.rs` `Ctx`, `context`, `context_at`,
  `civil_parts`, `format_time` e l'espansione dei segnaposto della data, senza
  cambiarne il comportamento; `template.rs` li usa da lì. Aggiungi
  `"vocabulary"` a `SHARED` con il perché in un commento. Il modulo compila con
  `template` o con `recipes` (`#[cfg(any(...))]`).
- In `recipes.rs`: i tipi (`Recipe`, `RecipeParam`, `RecipeStep`), `parse(model: &DocumentModel) -> Result<Recipe, Vec<Problem>>`
  (il blocco `fub-recipe` dal `Block::CodeBlock`, la riga dallo span),
  `Problem { code, field, line, message }` con i codici della pagina,
  `check_against(&Recipe, &[CommandSpec]) -> Vec<Problem>`, `fingerprint(&Recipe) -> String`
  (SHA-256 del JSON canonico, in esadecimale), `spec(&Recipe) -> CommandSpec` e
  `expand(&Recipe, args: &Value, ctx: &Ctx) -> Result<Vec<(String, Value)>, Problem>`,
  tutte come descritte nella sezione «Il contratto».
- `recipes_format.rs`: la ricetta d'esempio di T4 passa; un caso per codice di
  problema; il segnaposto esatto che tiene il tipo; l'impronta che non cambia
  con un commento fuori dal blocco e cambia con un passo diverso; `check_against`
  con le spec vere di `every_official_feature()`.
- La pagina `ricette.md`: i segnaposto, i controlli e i codici.
Casi limite: nessun blocco o due blocchi, YAML oltre il budget, un `id`
lunghissimo o con maiuscole, 21 passi, un passo `recipe.altra:run`, un comando
`property.type.set` (portata `Settings`), uno irreversibile, `fub-recipe: 2`,
`{{param.x}}` senza il parametro `x`, `{{random}}`, una nota vuota.
Fatto quando: `cargo test -p fub-features --test recipes_format --test template_e2e --test independent_modules`
verdi, con i test dei template invariati.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T6 · La palette propone la nota aperta, e i permessi dicono gli elenchi

Perché: una ricetta (e «Rinomina nota») dalla palette deve sapere su che nota
lavora (D10); e la persona deve vedere gli elenchi che il `Guard` applica,
cartelle e comandi.
Tocca: `apps/client/src/ui/palette.ts`, `apps/client/src/ui/palette.test.ts`,
`apps/client/src/ui/permissions.ts`, `apps/client/src/ui/permissions.test.ts`,
`apps/client/src/i18n/strings.ts`.
Non toccare: `apps/client/src/state/slash.ts` (il menu «/» fa già la sua
parte), `crates/`, la forma IPC dei permessi.
Dipende da: T2
Cosa fare:
- In `startCommand`, se il chiamante non ha già dato `doc` e la spec ha un
  parametro `doc` di tipo `document`, il prefill prende il documento attivo
  dalla stessa fonte di `slashContextDoc()`; il campo resta modificabile.
- In `permissions.ts`, `detailOf`: corregge il commento che dice il contrario
  del codice e mostra l'elenco dei parametri quando c'è (cartelle per
  lettura e scrittura, comandi per `fub:run-command`); per un elenco malformato
  dice «nessuno».
- Testi nuovi in `strings.ts`, italiano e inglese.
Casi limite: nessun documento aperto (campo vuoto, come oggi), un documento
non Markdown aperto (lo propone lo stesso: decide la spec), un elenco di 50
comandi (si accorcia con «e altri N»), un nome di cartella lunghissimo.
Fatto quando: in `palette.test.ts` un comando con `doc` si apre col campo
pieno e uno senza resta com'è; in `permissions.test.ts` un permesso con elenco
mostra l'elenco e uno malformato dice «nessuno»; `npm run typecheck` e
`npm test` verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T7 · L'esecuzione, l'annullamento e la prova di una ricetta

Perché: una ricetta adottata fa i suoi passi, si annulla tutta con un
«Annulla», e prima di adottarla si vede che cosa farebbe.
Tocca: `crates/fub-features/src/recipes.rs`,
`crates/fub-features/tests/recipes_e2e.rs` (nuovo),
`crates/fub-features/tests/command_conformance.rs` (la ricetta d'esempio),
`docs/reference/ricette.md`.
Non toccare: `crates/fub-kernel/` (l'annullamento si compone nella ricetta, non
nel kernel), `crates/fub-host/`, `fub-abi`.
Dipende da: T2, T3, T5
Cosa fare:
- `RecipeCommand { recipe: Recipe }`, un `CommandProvider` con la spec di
  `spec()`; `invoke` espande con `vocabulary::context(host)` e fa i passi con
  `host.run_command`, come dice «Il contratto» (Apply, errore al primo passo,
  `Partial`, annullamento composto dall'ultimo passo al primo, effetto
  dell'ultimo passo).
- `plan(recipe, args, ctx, run: impl FnMut(&str, Value) -> Result<CommandOutcome, PluginError>) -> Result<CommandPlan, PluginError>`:
  la prova, generica su chi esegue i passi in DryRun, perché la usano il
  provider, l'host (T9) e la CLI (T11). Il provider in DryRun la chiama con
  `host.run_command`.
- `recipes_e2e.rs`, con `fub_kernel::Workspace` e `MarkdownProvider` veri e un
  bundle con `fub:run-command` ristretto: la ricetta «archivia» segna la data e
  sposta la nota in `Archivio/` che non c'era; un `undo_last` la riporta com'era
  (testo e percorso); un secondo passo che fallisce lascia il primo fatto, un
  `Partial` e un annullamento che lo toglie; un passo fuori dall'elenco viene
  rifiutato dal `Guard`; il DryRun non scrive niente e torna un piano con i
  due documenti.
Casi limite: un passo che torna senza annullamento, un passo che sparisce dal
registro fra la lettura e l'uso (`UnknownCommand`: si ferma con `Partial`), la
nota che si sposta al primo passo e il secondo che la cerca dov'era (fallisce
con `Partial`: lo dice la pagina), un parametro `number` passato come testo.
Fatto quando: `cargo test -p fub-features --test recipes_e2e --test command_conformance`
verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T8 · Le forme condivise: il tipo `recipe` e il registro delle ricette adottate

Perché: due forme che attraversano i confini (il tipo di bundle che va al
client, il campo nel file `vaults.json`) nascono da sole, prima di chi le usa.
Tocca: `crates/fub-host/src/registry.rs` (soltanto `BundleKind`),
`crates/fub-host/src/vaults.rs` (`VaultEntry` e il suo aggiornamento),
`crates/fub-app/tests/ts_mirror_app.rs`, `apps/client/src/__fixtures__/mirror-samples-app.json`
(rigenerato), `apps/client/src/host/contract.ts`, `apps/client/src/host/fake.ts`,
`apps/client/src/host/mirror.test.ts` se serve un caso,
`docs/reference/on-disk-layout.md` (la riga di `vaults.json`, cambiata sul
posto), `docs/reference/ipc-contract.md`.
Non toccare: `apps/client/src/panels/settings.ts` (il filtro sui componenti
regge già), `fub-abi`, il WIT, la versione dello schema di `vaults.json`.
Dipende da: nessuno; cancello: risposte a D1, D2 e D9.
Cosa fare:
- `BundleKind::Recipe` (`recipe` in JSON).
- `VaultEntry.recipes_adopted: BTreeMap<String, String>` con
  `#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]`, id della
  ricetta → impronta, e due funzioni del registro accanto a quella di
  `keys_seen`: `adopt_recipe(root, id, impronta)` e `forget_recipe(root, id)`,
  scritte come le altre (atomiche, tengono il valore di prima se falliscono).
- Il campione di `ts_mirror_app.rs` con un bundle `recipe`, la fixture
  rigenerata con `UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app`,
  `kind: "component" | "theme" | "recipe"` in `contract.ts`.
- La riga di `vaults.json` in `on-disk-layout.md` dice anche «ricette
  adottate su questa macchina», senza aggiungere righe (la pagina è a 549 su
  550).
Casi limite: un file scritto da un Fub vecchio (manca il campo: vuoto); un Fub
vecchio che riscrive il file (perde il campo: le ricette tornano proposte, il
verso sicuro, e la pagina lo dice); un id lunghissimo; 200 ricette adottate.
Fatto quando: un test in `vaults.rs` scrive e rilegge l'impronta, e un file
senza il campo si legge; `cargo test -p fub-app --test ts_mirror_app` verde con
la fixture rigenerata; `npm run typecheck` verde.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T9 · L'host trova, adotta, scarta e prova le ricette

Perché: l'host è chi custodisce il vault: è lui che sa quali ricette ci sono,
quali sono adottate su questa macchina, e che monta soltanto quelle.
Tocca: `crates/fub-host/src/recipes.rs` (nuovo), `crates/fub-host/src/lib.rs`,
`crates/fub-host/src/session.rs` (i metodi di `Host` e la riconciliazione
all'apertura), `crates/fub-host/tests/recipes.rs` (nuovo),
`docs/reference/ricette.md`, `docs/map/dove-sta-x.md`.
Non toccare: `fub-abi`, il WIT, `crates/fub-kernel/`, `set_plugin_enabled` e il
significato di `plugins.disabled`, il canale `control.rs`.
Dipende da: T7, T8; cancello: K2 e K3 in main.
Cosa fare:
- `RecipeBundle`: plugin `recipe.<id>`, fiducia `Community`,
  `BundleKind::Recipe`, manifest con `fub:run-command: [i comandi dei passi]`
  e niente altro, il `RecipeCommand` di T7 con la ricetta letta.
- `Host::recipes(vault) -> Vec<RecipeInfo>`: legge le note sotto
  `recipes.folder`, `parse` e `check_against(ws.commands())`, e torna per
  ognuna `id`, `title`, `description`, `doc`, `status`
  (`proposta` | `adottata` | `cambiata` | `problemi`), `problems`, i passi con
  il titolo del comando, la portata e se si annulla. È anche la
  riconciliazione: monta le adottate valide con l'impronta giusta e smonta le
  altre.
- `Host::adopt_recipe(vault, id, impronta)`: rifiuta se l'impronta non è quella
  che legge ora (la persona ha visto un'altra versione); scrive l'impronta (T8),
  monta, accende il permesso con `set_setting_for_user`. `Host::discard_recipe`:
  toglie l'impronta e smonta. `Host::simulate_recipe(vault, id, args)`: `plan`
  di T7 con i passi in DryRun dell'utente, anche per una ricetta non adottata.
- Montare senza scrivere le impostazioni del vault: prima misura se
  `mount_bundle` riscrive `plugins.disabled` quando non cambia (un test); se
  sì, monta con `remember_unclaimed_bundle` e il registro, senza
  `set_plugin_enabled`.
- La riconciliazione gira all'apertura del vault e a ogni `recipes`.
- Il modulo compila con la feature `recipes` di `fub-host` (T4). Senza, i
  metodi di `Host` esistono lo stesso: `recipes` torna un elenco vuoto, gli
  altri `PluginError::NotFound`, così `fub-app` e `fub-cli` compilano in tutte
  e due le forme.
- `tests/recipes.rs`: proposta → adottata → la nota cambia → `cambiata` e
  smontata; l'impronta vista non è quella di ora → rifiuto; due note con lo
  stesso id → nessuna montata; un'altra macchina (un registro dei vault vuoto)
  → proposta; scartare smonta; la prova non scrive; aprire un vault con ricette
  adottate non riscrive le impostazioni.
Casi limite: la cartella non c'è, 201 note, una nota che non si legge, una
ricetta adottata il cui comando sparisce (un componente spento: `problemi`, resta
adottata, non si monta), il permesso spento a mano dalla persona (montata, ma
il `Guard` rifiuta: `RecipeInfo` lo dice), un vault di sola lettura, un bundle
installato che si chiama già `recipe.<id>` (il problema `id-occupato`, la
ricetta non si monta e il bundle resta com'è).
Fatto quando: `cargo test -p fub-host --test recipes` verde;
`cargo build -p fub-host --no-default-features --features outline,notify-watcher`
(le ricette spente) e
`cargo test -p fub-host --no-default-features --features notify-watcher,http-client,official-features,rich`
(il passo «host senza draw» di `scripts/check.sh`) verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T10 · Le porte IPC delle ricette

Perché: l'app mostra le ricette e la finestra di adozione con le porte
dell'host, sottili, senza logica doppia.
Tocca: `crates/fub-app/src/lib.rs`, `crates/fub-app/permissions/default.toml`,
`crates/fub-app/tests/lean_ipc.rs`, `crates/fub-app/tests/ts_mirror_app.rs`,
`apps/client/src/__fixtures__/mirror-samples-app.json` (rigenerato),
`apps/client/src/host/contract.ts`, `apps/client/src/host/ipc.ts`,
`apps/client/src/host/fake.ts`, `apps/client/src/host/mirror.test.ts` (legge
i campioni), `docs/reference/ipc-contract.md`.
Non toccare: `crates/fub-host/` (le porte ci sono da T9), le porte
`invoke_command` e `list_commands`, il canale `control.rs`.
Dipende da: T9
Cosa fare:
- `recipes_list`, `recipe_adopt(id, fingerprint)`, `recipe_discard(id)`,
  `recipe_simulate(id, args)`, ognuno una riga che delega all'host, con
  `Why::AppSurface` in `lean_ipc.rs` e il permesso in `default.toml`
  (`ipc_permissions.rs` lo controlla).
- Le forme in `contract.ts` (`RecipeInfo`, `RecipeProblem`, `RecipeStepInfo`,
  il piano della prova come `CommandPlan`), i campioni in `ts_mirror_app.rs`, la
  fixture rigenerata, `ipc.ts` e il finto host in `fake.ts`, che tiene le
  ricette in memoria per i test della shell.
- Gli errori restano tipizzati (`PluginError`), mai una stringa da leggere.
Casi limite: nessun vault aperto, un id che non c'è, l'impronta vecchia
(errore tipizzato che la finestra mostra come «la ricetta è cambiata
mentre la guardavi»).
Fatto quando: `cargo test -p fub-app --test lean_ipc --test ipc_permissions --test ts_mirror_app`
verdi; `npm run typecheck` e `npx vitest run src/host/mirror.test.ts` verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T11 · La CLI, l'MCP e la guida per chi costruisce con l'AI

Perché: un agente esterno scrive una ricetta, la controlla e la prova da solo
prima di proporla; e trova scritto come si costruisce su Fub.
Tocca: `crates/fub-cli/src/recipes.rs` (nuovo), `crates/fub-cli/src/cli.rs`,
`crates/fub-cli/src/main.rs`, `crates/fub-cli/src/mcp.rs` (`INSTRUCTIONS`),
`crates/fub-cli/src/mcp/tools.rs`, `crates/fub-cli/tests/recipes.rs` (nuovo),
`crates/fub-host/src/lib.rs` (soltanto `pub use` del formato),
`docs/reference/mcp-server.md`, `docs/development/costruire-con-ai.md`
(nuovo), `docs/README.md` (un link), `esempi/ricette/` (nuovo: tre note).
Non toccare: `crates/fub-host/src/control.rs` (bastano le porte generiche),
`crates/fub-app/`, le radici dell'MCP, gli strumenti che scrivono.
Dipende da: T9
Cosa fare:
- `fub ricette controlla <nota>`: legge la nota con `Connection` (`ReadModel`),
  `parse` e `check_against` con le spec di `Commands`, stampa i problemi con
  codice, campo e riga; esce con 1 se ce n'è. `fub ricette prova <nota> --doc <nota>`:
  `plan` di T7 con `InvokeCommand` in DryRun come chi esegue i passi.
  Funzionano con l'app aperta o chiusa, perché passano da `Connection`.
- Due strumenti MCP di sola lettura, `fub_recipe_check` e `fub_recipe_try`,
  con le stesse funzioni; una riga in `INSTRUCTIONS`: «una ricetta si scrive
  in una nota della cartella delle ricette; controllala e provala prima di
  dirlo alla persona; la accende soltanto lei, nell'app».
- `costruire-con-ai.md`: le porte (dal censimento), quando una ricetta e quando
  un componente WASM, il ciclo «scrivi, controlla, prova, proponi», i comandi
  e gli strumenti, gli esempi.
- `esempi/ricette/`: «Archivia», «Riunione di oggi» (crea una nota dal
  template), «Segna come letta» (una proprietà); ognuna passa `controlla`.
Casi limite: la nota non è nelle radici di lettura (errore dell'accesso, come
gli altri strumenti), l'app tiene il vault (passa dal canale), un vault senza la
feature `recipes`, una ricetta con 20 passi.
Fatto quando: `cargo test -p fub-cli --test recipes` prova `controlla` su una
ricetta buona (0) e su una con un passo sconosciuto (1, con il codice) e
`fub_recipe_try` senza scritture; le tre ricette di `esempi/ricette/` passano
`controlla` in un test; i guardiani dei documenti verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T12 · La sezione «Ricette», l'avviso e la finestra di adozione

Perché: la persona vede le ricette, capisce in parole semplici che cosa fa
ognuna prima di accenderla, e la accende o la scarta.
Tocca: `apps/client/src/panels/recipes.ts` (nuovo), `apps/client/src/panels/recipes.test.ts`
(nuovo), `apps/client/src/panels/recipe-dialog.ts` (nuovo),
`apps/client/src/panels/recipe-dialog.test.ts` (nuovo),
`apps/client/src/panels/settings.ts` (soltanto l'aggancio della sezione),
`apps/client/src/state/vault-session.ts` (soltanto l'avviso all'apertura),
`apps/client/src/theme/scrittoio/skin/settings.css`,
`apps/client/src/theme/scrittoio/skin.css` (rigenerato con
`npm run theme:generate`, mai a mano),
`apps/client/src/theme/scrittoio/anatomia/settings.ts`,
`apps/client/src/i18n/strings.ts`, `docs/product/plugins-and-extensions.md`.
Non toccare: `apps/client/src/host/` (è T10), la pagina dei componenti di K2,
`palette.ts` e `permissions.ts` (T6), i temi generati (`sheet-*.css`),
`apps/client/src/state/kernel.ts` (si usa com'è), `skin/centres.css` (il toast
non cambia), `skin/kit.css` e `kit/dialog.ts` (la finestra è un `openDialog`
con `className: "recipe-dialog"`).
Dipende da: T10, T6; cancello: prototipo approvato.
Dal prototipo: tutta la pagina `PLAN-ui/ricette.html`, con la tabella «Dal
prototipo» qui sopra: la sezione con i suoi stati, l'avviso, la finestra; il
blocco `→ skin/settings.css` così com'è, le 28 classi `recipe-*` nell'anatomia
delle impostazioni, i testi con le loro chiavi `data-i18n`.
Cosa fare:
- La sezione «Ricette» nelle impostazioni: una riga per ricetta (titolo,
  nota, stato, problemi), il pulsante «Nuova ricetta» (`recipes.new`, poi
  apre la nota), «Guarda» che apre la finestra, «Spegni» per le adottate.
  Stati: vuota (con due righe che spiegano che cosa è una ricetta e come farla
  scrivere a un'AI), piena, con problemi, in caricamento, in errore.
- L'avviso, sul modello delle scorciatoie che un vault propone
  (`warnIfVaultProvidesKeys` in `vault-session.ts` e `drawSuggestedKeys` in
  `settings.ts`): all'apertura del vault, se ci sono ricette `proposta` o
  `cambiata`, un `ports.notify` che le **nomina** («Il vault propone 2 ricette
  da guardare: Archivia la nota, Segna come letta») con una sola azione, «Guarda»,
  che apre le impostazioni sulla sezione. Nessun pulsante per accendere
  dall'avviso: si decide guardando. In cima alla sezione, un `.settings-banner`
  con le stesse ricette e «Guarda» per ognuna. Con l'app aperta, una nota
  creata o cambiata sotto la cartella delle ricette (gli eventi del kernel che
  `apps/client/src/state/kernel.ts` riceve già: `onAnyEvent`, che torna il
  disposer) fa lo stesso avviso, al massimo uno per ricetta e per sessione, con
  l'ascoltatore tolto alla chiusura del vault.
- La finestra (`openDialog` di `kit/dialog.ts`, `className: "recipe-dialog"`).
  Titolo e descrizione sono le parole di chi ha scritto la ricetta, e la riga
  d'origine lo dice («Dalla nota Recipes/Archivia.md. Il titolo e la
  descrizione li ha scritti chi ha fatto la ricetta; i passi qui sotto li legge
  Fub»). Poi, scritti da Fub: «Che cosa fa, in ordine», **tutti** i passi
  sempre visibili, mai piegati (con 20 passi scorre la finestra intera, come
  fa già il kit); per ognuno il titolo vero del comando (`CommandSpec.title`) e
  gli argomenti in parole, con i valori fissi in chiaro (una nota nominata per
  nome è «la nota «Diario/segreto»», non «la nota su cui la usi»). Le righe
  dei fatti: «Tocca» («solo la nota su cui la usi»; una nota fissa la nomina,
  con `data-reach="altre"`), «Può usare» (i comandi del permesso, «nessun
  altro comando»), «Si annulla» («tutta insieme, con un solo Annulla»), «La
  trovi» (palette, menu «/», scorciatoia), «Vale» («su questo computer; se la
  nota della ricetta cambia, si spegne finché non la riguardi»).
- La prova sulla nota aperta (`recipe_simulate`) parte da sola all'apertura
  se c'è una nota aperta, e non è obbligatoria per accendere. Stati:
  caricamento, risultato (con la riga «approssimata» se i passi sono più di
  uno), errore con «Riprova», nessuna nota aperta («Apri una nota per vedere
  che cosa le farebbe»). La zona della prova è `aria-live="polite"`.
- Le azioni: «Non ora» e «Accendi la ricetta» (primaria). Il fuoco parte da
  «Non ora» (`autofocus`), così un Invio distratto non accende niente.
  «Accendi» manda l'impronta che la finestra ha mostrato. Se la nota della
  ricetta cambia mentre la finestra è aperta (l'evento del kernel, o l'errore
  tipizzato dell'impronta vecchia da T10), compare `.recipe-stale` con
  «Rileggi», e «Accendi» resta disabilitato finché la persona non rilegge.
- Ogni ascoltatore ha un padrone e un disposer (`check-listeners`).
Casi limite: un titolo lunghissimo, 0 e 500 ricette (la riga `.recipe-limit`),
una ricetta con 20 passi, nessuna nota aperta (la prova chiede di aprirne una),
l'impronta cambiata mentre la finestra è aperta, il permesso spento a mano,
Invio e Spazio sui pulsanti, Escape che chiude come «Non ora», la larghezza di
700 px.
Fatto quando: i test Vitest di `recipes.ts` e `recipe-dialog.ts` provano gli
stati, il fuoco iniziale su «Non ora», «Accendi» disabilitato con la ricetta
cambiata e l'impronta inviata; `npx vitest run src/theme/scrittoio/anatomia.test.ts`
verde; `npm run theme:generate && npm run theme:verify` senza differenze; la
foto del banco (T13), chiara e scura, combacia col prototipo;
`npm run typecheck`, `npm test` e `npm run build` verdi.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T13 · Le scene del banco delle ricette

Perché: ciò che si vede si controlla guardandolo, in tutte e due le luci e
stretto, e il banco a11y prova Invio e Spazio.
Tocca: `apps/client/bench/scene.mjs`, le scene nuove del banco delle
impostazioni accanto a quelle che ci sono (`apps/client/bench/`), l'elenco del
banco a11y se le scene vi si registrano.
Non toccare: `apps/client/bench/baseline/` (le immagini arrivano dal runner,
mai da qui), il codice della shell.
Dipende da: T12
Cosa fare:
- Le scene, quelle della barra del prototipo: sezione vuota, piena, con
  problemi, in caricamento, in errore, con 500 ricette (la riga del limite);
  l'avviso; la finestra con la prova, con la prova in errore, senza nota
  aperta, con 20 passi e una nota fissa, con la ricetta cambiata; in tutte e
  due le luci e a 700 px. Il finto host di T10 dà i dati.
- Il banco a11y sulle scene nuove.
- Segui la skill `banco` (`.claude/skills/banco/SKILL.md`).
Casi limite: la skin rifiutata che spoglia tutto (il banco lo dice: guarda il
primo errore), le foto che differiscono solo per i caratteri (lo dice
`CLAUDE_DEVICE.md`).
Fatto quando: `npm run bench:a11y` verde sulle scene nuove; le foto locali,
chiara e scura, combaciano col prototipo a occhio e sono nel report; le
baseline si prendono dal runner dopo la CI, come dice `CLAUDE.md`.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare
