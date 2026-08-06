# 0131 — Tre stati, e la firma che ne diceva due: `enabled` diventa una proiezione

**Stato**: accolta
**Data**: 2026-08-06
**Chiude**: la [§24.2](../roadmap/24-tre-firme-che-il-freeze-rende-definitive.md)
— *«`enabled()` risponde con un booleano a una domanda che ha tre risposte»*.
Gli stati sono davvero tre, ma **non sono i due che la voce nominava**, e la
firma non scade col freeze
**Commit**: *(questo commit)*

---

## La domanda, com'era posta

La [0017](0017-chi-disegna-cio-che-il-core-non-conosce.md) ha sostituito gli
elenchi di booleani con `OptionMap` e ne ha scritto la regola: *presente =
acceso, il valore è il dettaglio, un `false` esplicito spegne*. Tre stati. La
firma che li legge — `OptionMap::enabled(&self, key: &str) -> bool` — ne dice
due, e torna `false` sia per la chiave assente sia per la chiave messa a `false`.

## Le premesse della voce, misurate

**«È una firma, quindi scade col freeze»: falso.** È la seconda volta di fila
sulla stessa seduta, e per un motivo diverso dalla §24.1. Al confine WIT non
esiste nessun `enabled`: c'è `type option-map = list<option-entry>`, e i tre
stati un `option-entry` li porta già tutti e tre per conto suo — assente, con
`value: false`, con un valore qualunque. `enabled` è un **metodo Rust di
comodo** su un tipo di `fub-abi`, e aggiungergli accanto `status` è additivo
oggi e additivo il giorno dopo il freeze. **La §24.2 era una P0 per la ragione
sbagliata**, e come la §24.1 è valsa comunque il giro — perché la cosa che ha
trovato non era nella voce.

**«I due `false` sono *il provider non la conosce* e *è spenta in questo
`ParseContext`*»: falso, e sembrava vero perché le due frasi sono davvero due
stati — solo che stanno in **due mappe diverse**.** *Cosa so fare* è
`FormatCapabilities.syntax`; *cosa devo accendere* è `ParseContext.options`. Chi
vuole distinguere «non la conosco» da «qui è spenta» non ha bisogno di un terzo
valore: ha bisogno di **guardare la seconda mappa**, e la risposta gliela porta
già `DocumentFormat`, che dei due campi ce li ha entrambi apposta. La voce
attribuiva a una firma un difetto che era una confusione fra due tipi.

Il terzo stato dentro **una** mappa esiste lo stesso, ed è un altro: *nessuno ha
nominato questa voce* contro *qualcuno l'ha nominata per spegnerla*. È la
differenza fra «non si è deciso» e «si è deciso di no», e ha un cliente vero —
`overlay`, che sovrappone vault → cartella → nota **per chiave** proprio perché
quella differenza viaggi.

**«Uno solo, e torna `bool`»: sì, ma con tre facciate.** Il simbolo
`OptionMap::enabled` è uno, e torna davvero `bool`. Sopra ci stanno tre
*wrapper* che sono la stessa domanda con tre nomi — `FormatCapabilities::supports`,
`ParseContext::enabled`, `RenderOptions::enabled`, più `PluginPermissions::has`
— quindi riparare la base ripara tutti e quattro senza toccarne nessuno, che è
il verso giusto. La **quinta** copia della regola è in TypeScript
(`frontend/src/ui/permessi.ts`, `v !== false && v !== null`), e non è un
doppione che possa marcire: la mappa attraversa l'IPC come JSON grezzo, la shell
la regola la deve applicare per conto suo, e ce l'ha un presidio suo
(`permessi.test.ts`, *«un permesso spento con `false` non è dichiarato»*).

## Il verso opposto, che è ciò che ha deciso la forma

La voce suggeriva di guardare **prima** la strada in cui `enabled` **sparisce**,
«perché una funzione che risponde male è peggio di una che non c'è». Provata
leggendo i chiamanti, quella strada è la sbagliata, e i chiamanti sono la prova:

| chi chiede | cosa fa col `false` | cosa farebbe sapendo *quale* `false` |
| --- | --- | --- |
| `fub-format-markdown/parse.rs` (wikilink, tag, embed) | non parsa | **niente di diverso** |
| `fub-format-markdown/render.rs` (data-attribute) | non emette | **niente di diverso** |
| `fub-kernel/syntax.rs` (`SyntaxRules::apply`) | salta la regola | **niente di diverso** |
| `Granted::new` (il cancello dei permessi) | nega la famiglia | **niente di diverso** |
| `Workspace::permission_specs` | non disegna l'interruttore | niente di diverso *qui* |
| `overlay`, e chi **mostra** | — | tutto: la mappa la conserva già |

Cinque chiamanti su cinque **fanno la stessa cosa nei due casi**, ed è giusto
che la facciano: chi parsa non deve chiedersi *perché* una sintassi è spenta, e
un cancello che si aprisse diversamente a seconda di *come* gli è stato detto no
sarebbe un cancello peggiore. Togliere `enabled` avrebbe costretto sei punti a
scrivere un `match` a tre rami di cui due identici, cioè avrebbe pagato rumore
in tutti i posti dove il booleano è **la risposta giusta**, per servire i posti
che oggi non chiedono ancora niente.

Notare `Granted::new`, che è il chiamante più istruttivo di tutti: per
l'allowlist di `fub:network` è già **sceso sotto** `enabled`, leggendo il `Value`
grezzo, e il commento dice perché — *«`as_strings` appiattisce su un elenco vuoto
tre cose diverse: assente, vuoto, malformato, e qui la terza deve fallire chiusa
invece di confondersi con la prima»*. Cioè: quando la distinzione è servita, chi
ne aveva bisogno se l'è presa a mano. Il difetto non è che `enabled` menta — è
che **non c'era il nome** con cui chiedere la risposta intera.

## La decisione

Delle due forme che la voce nominava, ha vinto la prima, e **non** perché fosse
la più comoda:

- **`enabled` sparisce in favore di `status`** — scartata dalla tabella qui
  sopra: sposta il costo su sei chiamanti per cui il booleano è corretto.
- **`status` si aggiunge, `enabled` resta** — presa, con una condizione che è la
  parte che decide: `enabled` **non è una seconda funzione**, è
  `self.status(key).is_on()`. Finché aveva il proprio `match`, la tabella dei
  casi era in due copie e allargarla in una sola era una cosa che si poteva fare
  compilando.

```rust
pub enum OptionStatus<'a> { Unset, Off, On(&'a serde_json::Value) }
```

`On` porta il **parametro**, e non è un dettaglio: un `Option<bool>` avrebbe
distinto i tre stati buttando via l'allowlist, il livello, l'elenco di varianti —
cioè avrebbe riprodotto il difetto un gradino più su, che è esattamente la mossa
che la [0094](0094-un-tetto-che-si-fa-sentire.md) evitò su `random-bytes` dando
al risultato la forma che il dominio aveva già. Il tipo **non attraversa il
confine** e non ha una `Serialize`: al confine c'è la mappa, e i tre stati la
mappa li porta da sola. Alla radice del crate si vede, perché la
[0130](0130-ogni-tipo-del-contratto-si-vede-dalla-radice.md) di ieri lo pretende.

## Il difetto fuori dalla voce, che vale più della voce

Ventiduesimo giro di fila, e sta di nuovo un centimetro più in là.

`DocumentStore::format_of` e `DocumentStore::syntax_forms` leggono la **stessa**
`OptionMap` — le capacità del provider — e la leggevano in due modi: la prima con
`enabled` (via `supports`), la seconda con `iter()`, che porta tutte le voci
**comprese le spente**. Sono i due accessori con cui la
[0115](0115-la-verita-e-la-dichiarazione.md) risponde alla §4.4: *che sintassi
capirebbe* e *a cosa somigliano*. Su un provider che scrive `.with(nome, false)`
— l'unico modo che ha di dire «questa la conosco e qui non la faccio», visto che
toglierla direbbe «non so cosa sia» — le due divergevano: la sintassi **non**
compariva fra le capacità e **sì** fra le forme. Tradotto in ciò che vede una
persona: la superficie di scrittura le decora una sintassi che il parse non
legge.

Nessun provider di questo repo lo fa, ed è la ragione per cui poteva restare lì
per sempre: `FormatCapabilities::of` costruisce solo con `.on()`, quindi la
mappa vera non ha mai avuto un `false` dentro. Una divergenza che si vede solo
costruendo il caso — e costruire il caso è precisamente ciò che uno strumento
nuovo permette di fare.

La riparazione è al posto che tutti attraversano, non al chiamante:
`OptionMap::active()`, cioè `iter()` meno le spente, e `syntax_forms` chiede
quella. Le due funzioni ora fanno **la stessa domanda**, e il presidio le
confronta l'una con l'altra invece che contro un elenco scritto a mano — un
terzo elenco sarebbe stato il difetto un gradino più su.

## I presidi, e il rosso

Tre banchi, tutti verificati rossi **togliendo** qualcosa e non aggiungendola:

1. `options.rs::gli_stati_di_una_voce_sono_tre_e_non_due` — le cinque forme che
   un valore JSON può avere, i tre stati che ne escono, e che `enabled` è la
   proiezione. Rosso togliendo `Value::Null` dalla tabella: *«left: `On(Null)`,
   right: `Off`»*.
2. `options.rs::active_e_iter_meno_le_spente` — rosso dalla stessa mutilazione:
   `fub:math` ricompare fra le accese.
3. `crates/fub-kernel/tests/le_capacita_effettive.rs` — due prove sul kernel
   vero, con un provider che dichiara e spegne. Rosse rimettendo `.iter()` al
   posto di `.active()`: *«left: `["fub:callouts", "fub:tags", "fub:wikilinks"]`,
   right: `["fub:callouts", "fub:tags"]`»*.

E il presidio di ieri ha morso da solo: `OptionStatus` senza il suo `pub use`
rende rosso `superficie_della_radice`, per nome. Non è stato aggirato.

L'attore è **il test** e non il compilatore, ed è una scelta misurata: se
`enabled` fosse sparito, il compilatore avrebbe preso ogni chiamante — ma la
tabella qui sopra dice che sei chiamanti su sei non avevano niente da cambiare,
quindi il compilatore avrebbe preso sei falsi positivi e zero difetti. Il difetto
vero — due funzioni che rispondono diverso sulla stessa mappa — un `match` non lo
vede: è comportamento, e lo prende un test.

## Zone cieche dichiarate

- **Le altre `OptionMap` non hanno un cliente che chieda i tre stati, oggi.** Il
  pannello dei permessi (`permessi.ts`) mostra i dichiarati e nasconde gli
  spenti, che è la scelta giusta finché un permesso spento nel manifest è un
  permesso non chiesto. Il giorno in cui qualcuno vorrà dire *«questo componente
  ha rinunciato esplicitamente a X»*, `status` è la firma che glielo permette
  senza cambiare niente.
- **`in_ns`, `keys` e `iter` continuano a portare le spente**, ed è voluto: sono
  le tre firme con cui si guarda la mappa *com'è scritta*, non *cosa ne segue*.
  Chi vuole la seconda ha `active`.
- **La copia TypeScript della regola resta.** Non si può togliere — la mappa
  attraversa come JSON — e ha il suo presidio; il giorno in cui divergesse, a
  dirlo sarebbe `permessi.test.ts` e non il compilatore.

Nessuna firma WIT cambiata, nessuna fixture rigenerata (il tipo nuovo ha un
payload, quindi non entra nel mirror degli enum; nessun provider reale scrive una
sintassi spenta, quindi `sintassi.generated.ts` non si muove — verificato, non
sperato). Un binario di test in più: da centoventi a centoventuno righe
`test result: ok`.
