# 0149 — La grammatica di un accordo è salita, e il tipo dice dove trovarla

**Stato**: accolta **Data**: 2026-08-12 **Chiude**: §26.3 **Commit**: *(questo
commit)*

---

## La domanda

La [§26.3](../roadmap/26-otto-gesti-che-nessuno-puo-dichiarare.md#263-la-grammatica-di-un-accordo-non-sta-nel-contratto)
chiede dove debba vivere la regola che dice se «`Mod-k Shift-d`» è un accordo
valido. La misura era che la sapevano **due funzioni, in due linguaggi, e non
era la stessa**: quarantacinque righe di TypeScript in `frontend/src/ui/commands.ts`,
e una copia dentro un banco (`crates/fub-features/tests/command_keys.rs`) che si
annunciava «come lo normalizza la shell» e non lo era, perché spezzava solo sul
`-` e dello spazio non sapeva niente.

## La premessa, rimisurata

Rimisurata a `106f1b6`, con i comandi che la voce stessa lascia — e **non
regge, perché è stata superata**: la forma (a) c'è già.

- `crates/fub-abi/src/rules/` non ha dodici moduli: ne ha **sedici**, e uno si
  chiama `tasti.rs`. È arrivato il 12 agosto 2026 col commit `53b5647`, che
  riparava il difetto 0148 — *«la forma di una scorciatoia è una regola del
  contratto»* — cioè esattamente la riga che questa voce aveva depositato fra i
  difetti misurati.
- `pub fn canonica(binding: &str) -> Option<String>` dice tutte e quattro le
  cose che nessun documento del contratto scriveva: i modificatori sono tre e
  `Ctrl-k` si **rifiuta**, non se ne ripete uno, il primo accordo ne porta uno,
  lo spazio separa gli accordi di una sequenza. Accanto c'è `oscura`, che la
  voce non aveva chiesto e che risponde alla domanda vicina — la corta che non
  fa mai arrivare alla lunga.
- La seconda copia **non esiste più**: `command_keys.rs` importa `canonica` e
  `oscura` invece di portarsi dietro il proprio `normalizza`, quindi il banco
  che poteva mentire non può più.
- Il legame fra i due lati c'è ed è quello di sempre: `accordo_canonico_cases()`
  (`crates/fub-abi/tests/rules_mirror.rs:579`, quattordici casi fra cui
  `"Mod-k d"`, `"Ctrl-k"`, `"d"`, `"Mod-"`) e la gemella in
  `frontend/src/rules/rules-mirror.test.ts:59`.

Quindi la raccomandazione «(b) adesso, (a) al secondo lettore» è stata sorpassata
dai fatti, e nel verso buono: il secondo lettore non è mai comparso, ma la (b) da
sola avrebbe lasciato due copie che possono ancora divergere, mentre alzare la
regola le ha tolte tutte e due con lo stesso gesto — e a un prezzo che nessuno
ha dovuto stanziare, perché il difetto lo pagava già.

C'è una differenza fra la (a) come era scritta e la (a) che è stata fatta, e va
detta perché è la parte migliore: la voce chiedeva «la gemella in `mirrored.ts`»,
cioè una **terza** copia TypeScript. Non è stata scritta. La fixture lega la
copia che la shell preme davvero a ogni tasto (`normalizza` in `ui/commands.ts`),
e una gemella in più sarebbe stata una copia che nessuno preme, tenuta uguale a
una copia che nessuno preme.

## La decisione

**§26.3 si chiude nella forma (a)**, che è già in albero, **più la (c)**, che è
il solo residuo vero e costa un paragrafo.

La (c) non è ridondante rispetto alla (a) per una ragione che la voce stessa
misura al punto 5: nessuno dei moduli di `rules/` compare in `abi.wit`, perché
sono codice Rust che i due lati compilano e non una firma esposta. Ma chi scrive
un plugin per il mondo wasm legge il **WIT**, e lì `keybinding` era un
`option<string>` nudo con accanto un esempio. Una regola che esiste e non si
trova, per quel lettore, non esiste. Quindi:

- il doc di `CommandSpec::keybinding` (`crates/fub-abi/src/command.rs`) e quello
  del `record command-spec` (`crates/fub-abi/wit/fub/abi.wit`) dicono la
  grammatica in due righe e **nominano `fub_abi::rules::tasti`**, così chi legge
  il tipo trova la regola invece di scoprirla dall'app;
- il testo della scheda «scorciatoie» (`settings.shortcuts_hint`, nelle due
  lingue) guadagna le due clausole che gli mancavano — che i modificatori sono
  tre e che `Ctrl-k` non viene onorato, e che uno spazio vuol dire «due tasti
  premuti uno dopo l'altro». È la metà (d) della voce, quella che pagava
  **l'utente**, che l'accordo lo scrive a mano in un campo di testo: il rifiuto
  gli arriva già (`accordiRifiutati`), ed è il trattamento giusto che arriva
  tardi; adesso la regola sta scritta dove lui scrive.

Il prezzo del WIT è additivo e verificato: `wit_conformance` e `wit_additivity`
restano verdi, cioè il contratto è cresciuto per sola aggiunta di prosa.

## Le forme scartate

- **(b) solo il difetto** — riscrivere la copia nel banco: sarebbe stata la
  scelta se la (a) fosse stata da stanziare, ma non lo era più. E per la prova
  del secondo chiamante è la forma perdente: quattro righe che curano un
  chiamante solo, mentre `tasti.rs` l'hanno già ereditato `command_keys.rs`,
  `shell_keys_mirror.rs` e `una_regola_di_nome_si_dichiara.rs` senza che nessuno
  se ne dovesse ricordare.
- **(d) com'è oggi** — cade da sé: era il costo del non decidere, e chi lo
  pagava erano l'utente e il terzo, che sono esattamente i due a cui questo
  verbale scrive una riga.
- **Una gemella in `mirrored.ts`** — la lettera della (a). Una terza copia
  TypeScript non ha un chiamante: la shell ha già la sua, ed è quella che deve
  restare uguale al contratto.

## Cosa resta scoperto

Zero caselle. Due cose dichiarate, e nessuna delle due è un lavoro nascosto.

- **Il terzo lettore non è arrivato.** I lettori sono ancora due; il secondo
  host di M5, una CLI e l'API locale restano nominati in
  [plugin-boundary](../architecture/plugin-boundary.md) come chiamanti dello
  stesso registro. La differenza è che il giorno che compaiono trovano la regola
  scritta, invece di questa voce.
- **La prosa non ha un presidio.** La regola sì — la fixture del mirror è rossa
  nei due versi — ma i tre punti in cui la grammatica è ora *raccontata* (il doc
  Rust, il doc WIT, il testo delle impostazioni nelle due lingue) non sono legati
  a `MODIFICATORI` da niente: se un giorno i modificatori diventassero quattro,
  quelle righe direbbero il falso e nessun banco lo direbbe. È il prezzo scelto
  con gli occhi aperti — l'alternativa sarebbe generare prosa da un elenco, che
  costa più di quanto valga per una lista di tre elementi che cambia solo per
  decisione.
