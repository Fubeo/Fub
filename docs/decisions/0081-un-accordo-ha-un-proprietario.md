# 0081 — Un accordo ha un proprietario, e i due registri si guardano insieme

|  |  |
|---|---|
| **Decisa** | 2026-08-03 |
| **Origine** | Nessuna voce: un **difetto** trovato leggendo, e il presidio che avrebbe dovuto trovarlo. Lascia aperta la §18.2 ([seduta 18](../roadmap/18-editor-e-tastiera.md)), a cui consegna la metà mancante — la scorciatoia di un comando di shell non è ancora riconfigurabile |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[una scorciatoia è una chiave, 0077](0077-una-scorciatoia-e-una-chiave.md) ·
[registro dei comandi, 0009](0009-registro-dei-comandi.md) ·
[le regole in un posto solo, 0020](0020-le-regole-in-un-posto-solo.md) ·
[una porta per chi cerca, 0082](0082-una-porta-per-chi-cerca.md)

---

Due comandi dichiaravano `Mod-Shift-f`. Uno è `search.open` «Search the vault»,
del kernel (`fub-features/src/commands.rs`); l'altro è `shell.panel.search`
«Mostra la ricerca», della shell (`panels/sidebar.ts`). Non era rumore: la
tastiera prende **il primo** che risponde all'accordo (`findByChord`), e
`allCommands()` mette le spec del kernel prima di quelle della shell — quindi il
tasto vinceva `search.open`, che ha un parametro `query` **obbligatorio**.
Premere `Ctrl+Shift+F` apriva un modulo da compilare invece della ricerca.

Il difetto è vecchio di mesi e si vedeva a ogni avvio. Vale la pena partire da
lì, perché è la parte generalizzabile: non è sfuggito per distrazione, è
sfuggito perché **nessuno poteva vederlo**.

## Perché un presidio verde non lo ha mai detto

Il banco della shell la domanda giusta ce l'aveva, scritta bene:

```ts
expect(conflitti(allCommands())).toHaveLength(0);
```

In un test `allCommands()` restituisce **solo** il registro della shell. Le spec
del kernel arrivano da `list_commands` a runtime e finiscono in
`state.commandSpecs`, che in un banco è vuoto. Quel presidio guardava metà dei
dati e non lo diceva: era verde perché la metà che avrebbe litigato non c'era.

È la forma di errore che questo repo ha già incontrato due volte — un presidio
che non può fallire è peggio di nessun presidio — e la cosa che la rende
insidiosa qui è che la funzione sotto esame (`conflitti`) era **giusta**. Non
c'era niente da correggere nel codice provato: era sbagliato l'universo su cui
gli si faceva la domanda.

Un conflitto di scorciatoie, del resto, non è una proprietà di un comando: è una
proprietà della **coppia**. Nessuno dei due registri lo può vedere da solo, per
costruzione, e i due si incontravano solo dentro l'app in esecuzione — dove
l'unico osservatore era l'utente che premeva il tasto.

## Chi tiene l'accordo: la shell

La prima decisione è di prodotto, ed è stata presa esplicitamente perché è una
scelta sui default e non un dettaglio di implementazione.

`Mod-Shift-f` resta a `shell.panel.search`; `search.open` **perde la
keybinding** e resta raggiungibile dalla palette. Le ragioni, in ordine di peso:

- **Parità con ciò che le dita sanno già.** In Obsidian `Ctrl+Shift+F` apre il
  pannello di ricerca. Un utente che arriva da lì non deve reimparare la
  scorciatoia più usata dell'app.
- **Un comando con un parametro obbligatorio non è un buon cliente di una
  scorciatoia.** Il gesto della scorciatoia è *premo e sono dove volevo*; il
  gesto di `search.open` è *premo, compilo un modulo, confermo*. La palette quel
  modulo lo sa chiedere ed è il posto naturale per farlo: la
  [0010](0010-comando-descritto-a-una-macchina.md) e la
  [0009](0009-registro-dei-comandi.md) hanno reso i parametri una cosa che si
  compila lì, e questo è il caso per cui serve.
- **Nessuna funzione si perde.** `search.open` è ancora nel registro, ancora
  invocabile da CLI, palette, automazioni e da un `CommandEffect`. Perde un
  tasto, non una capacità.

La terza uscita — rendere `query` opzionale così che `search.open` apra la
ricerca vuota e tenga l'accordo — è stata scartata, ed è la scelta che merita di
essere motivata perché sembrava la più economica. Avrebbe cambiato la **firma**
di un comando ufficiale per risolvere un conflitto di tastiera nella shell: un
parametro obbligatorio dice cosa un comando fa, e renderlo opzionale per far
stare comodo un tasto è il genere di deformazione che si paga dove nessuno sta
guardando (una CLI che invoca `search.open` senza argomenti adesso non
sbaglierebbe più — farebbe qualcosa).

## Il presidio: una fixture, come per le regole

La domanda va posta ai **due registri insieme**, senza accendere l'app. Il
precedente è il §6.2: le regole scritte in due lingue si presidiano con una
fixture generata da Rust e letta da vitest
([0020](0020-le-regole-in-un-posto-solo.md)).

Qui è la stessa forma applicata agli accordi:

- `crates/fub-features/tests/command_keys.rs` genera
  `frontend/src/__fixtures__/command-keys.json` — ogni comando ufficiale con
  l'accordo che dichiara, `null` se non ne vuole. Stesso giro delle altre tre
  fixture: il test confronta il committato, e `UPDATE_MIRROR=1` rigenera.
- `frontend/src/ui/keybindings.test.ts` legge quella fixture **insieme** alla
  tabella degli accordi della shell, e fa la domanda che prima si faceva su metà
  dei dati.

Due dettagli non ovvi, e sono i due che rendono il presidio non svuotabile:

**Nella fixture ci sono anche i `null`.** Un elenco dei soli comandi *con*
scorciatoia potrebbe ridursi a zero restando verde. Con tutti gli id dentro, la
fixture cambia ogni volta che cambia il registro — cioè esattamente quando
qualcuno deve riguardare la domanda.

**La tabella della shell è tipizzata, quindi non si può dimenticare.**
`ShellCommand.id` è `ShellCommandId`, che è `keyof typeof SHELL_KEYS`: un
comando di shell che non compaia in `ui/shell-keys.ts` **non compila**. È la
stessa mossa con cui `data_root()` ha reso non compilabili i path composti a
mano ([0048](0048-una-radice-sola.md)): la disciplina è nel tipo, non in una
cosa da ricordarsi.

### Perché gli accordi della shell stanno in una tabella, e i comandi no

Questa è l'unica cosa che la decisione toglie alla regola del §18.2 — *chi ha
interesse dichiara, e nessuno tiene la lista di tutti* — e vale dire cosa toglie
esattamente. I **comandi** continuano a dichiararli i pannelli al montaggio: id,
titolo, descrizione, `run`. Si sposta solo l'**accordo**, che è la sola cosa che
riguarda tutti gli altri.

La ragione è che un banco non può fare ciò che fa l'app: i comandi di shell li
dichiarano i pannelli, e importare un pannello in un test tira dentro un
`document` globale e mezza shell. Una tabella di accordi non importa niente e la
legge chiunque — ed è anche il posto in cui la §18.2 troverà la chiave da
riconfigurare, il giorno in cui gli accordi della shell diventeranno chiavi di
impostazione come quelli del kernel
([0077](0077-una-scorciatoia-e-una-chiave.md)).

## Cosa il presidio non copre, e perché va bene

**I comandi dei plugin.** Un plugin dichiara le proprie spec a runtime, e i suoi
accordi in una fixture di compilazione non ci possono stare. Quel conflitto lo
trova `frasedeiConflitti` nella shell, che lo **dice all'utente** invece di
romperlo a chi scrive il codice — ed è il trattamento giusto: fra un plugin di
terzi e un comando nostro non c'è un colpevole, c'è una convivenza da segnalare
e da risolvere nelle impostazioni. Qui stanno i comandi che spediamo noi, per i
quali un conflitto è un difetto.

**La keymap dell'editor.** `editor-commands.ts` monta quattordici accordi di
CodeMirror (`Mod-b`, `Mod-i`, `Mod-k`, …) che sono un **terzo** registro, e non
passano né dal kernel né da `SHELL_KEYS`. Sono di un'altra specie — vivono solo
dentro l'editor a fuoco, e alcuni *devono* vincere sulla shell — ma la domanda
«questo tasto è già di qualcuno?» oggi lì non si può fare a macchina, e chi
aggiunge una scorciatoia deve ricordarsi di guardare due file invece di uno. Sta
scritto qui perché è la cosa che il prossimo conflitto userà per nascere; è
materia della §18.2, che è aperta.

## L'esito, in breve

Il kernel dichiara un solo accordo (`vault.undo` su `Mod-Alt-z`), la shell
dodici, e nessuno dei tredici è dichiarato due volte — provato a ogni
`cargo test` e a ogni `npm test`, invece che dal primo utente che preme il
tasto.
