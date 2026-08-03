// **I conteggi che la prosa afferma sui sorgenti** (§16.8).
//
// Ogni voce qui è un numero che qualche documento — o qualche commento dentro
// il codice — scrive in italiano, insieme al comando che lo ricava dai
// sorgenti. `check-prosa.mjs` rifà il conto e lo confronta con **ogni** posto
// che lo cita, in tutte e due le direzioni: un numero che cambia nel codice
// diventa rosso, e una voce che nessuno cita più diventa rossa anche lei —
// stessa disciplina dell'allowlist di `crates/fub-app/tests/dieta_ipc.rs`.
//
// La ragione per cui questo file è un modulo JS e non un JSON: **ogni riga
// porta la sua ragione**, e un formato senza commenti costringerebbe a
// scriverla da un'altra parte, cioè in un posto che invecchia.
//
// Come si aggiunge una voce:
//
//   1. si sceglie un `nome`, che è ciò che si scriverà nella prosa fra
//      `[conta: …]`;
//   2. `comando` deve stampare **un numero solo**, e girare da qualunque
//      cartella (si esegue dalla radice del repo);
//   3. `ragione` dice cosa quel numero afferma, non come lo si conta — il come
//      è il comando, e sta già lì.
//
// Cosa NON va qui: un numero che descrive lo stato di allora dentro un verbale.
// Un verbale è datato, e un conteggio dentro un verbale non promette di essere
// vero oggi — promette di essere stato vero quel giorno. Quelli si scrivono al
// passato («allora ne contava otto»), e questo presidio non li guarda.

export const CONTEGGI = [
  {
    nome: "hostapi-metodi",
    ragione:
      "Le funzioni che un plugin può chiamare sull'host: la superficie dell'`HostApi` " +
      "come la vede chi sta dall'altra parte del confine. È il numero della " +
      "decisione 0013 — l'elenco è chiuso alla sottrazione, non alla crescita — e " +
      "prima di questo presidio lo stesso documento ne dichiarava due diversi.",
    comando:
      "awk '/^[[:space:]]*interface host-/{i=1} i&&/^}/{i=0} i&&/:[[:space:]]*func/{n++} END{print n+0}'" +
      " crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "wit-interfacce-host",
    ragione:
      "Le interfacce `host-*` del contratto, cioè in quante famiglie è divisa " +
      "quella superficie. Cresce solo quando nasce una famiglia di capacità, " +
      "quindi va di pari passo con `guard-famiglie`: se i due divergono, una " +
      "delle due liste ha smesso di essere l'altra.",
    comando: "grep -cE '^[[:space:]]*interface host-' crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "guard-famiglie",
    ragione:
      "Le famiglie di capacità su cui una politica risponde sì o no: i casi di " +
      "`Capability` in `guard.rs`. Il numero è scritto tre volte in quel file, e " +
      "tutte e tre le volte era `dieci` quando le famiglie erano quattordici.",
    comando:
      "sed -n '/^pub enum Capability {/,/^}/p' crates/fub-kernel/src/host/guard.rs" +
      " | grep -cE '^    [A-Z]'",
  },
  {
    nome: "capacita-strutturali",
    ragione:
      "I metodi di `VaultStructure`, cioè quante sono le operazioni strutturali " +
      "che il varco della decisione 0010 copre. Due documenti dicevano «tutte e " +
      "sei» e poi ne elencavano cinque.",
    comando:
      "sed -n '/^pub trait VaultStructure/,/^}/p' crates/fub-abi/src/traits.rs" +
      " | grep -cE '^[[:space:]]+fn '",
  },
  {
    nome: "schemi-su-disco",
    ragione:
      "Gli `SCHEMA_VERSION` indipendenti: quanti formati su disco Fub versiona " +
      "separatamente. È il numero il cui errore non si annulla, perché la " +
      "promessa è fatta ai file dell'utente e non a chi compila.",
    comando: "grep -rn 'const SCHEMA_VERSION' crates/*/src | wc -l",
  },
  {
    nome: "crate-del-workspace",
    ragione: "I crate che ereditano la versione dal `Cargo.toml` della radice.",
    comando: "ls -d crates/*/ | wc -l",
  },
  {
    nome: "wit-righe",
    ragione:
      "Quanto è lungo il contratto in WIT. Serve alla misura che la decisione " +
      "0053 fa — quanta parte del contratto è prosa — e da solo non direbbe niente.",
    comando: "wc -l < crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "wit-commenti",
    ragione:
      "E quanta di quella lunghezza è commento: è l'altra metà della misura di " +
      "sopra, ed è la ragione per cui il contratto si legge.",
    comando: "grep -cE '^[[:space:]]*//' crates/fub-abi/wit/fub/abi.wit",
  },
  {
    nome: "conformita-funzioni",
    ragione:
      "Le funzioni del banco di conformità che `fub-sdk` offre a chi scrive un " +
      "provider. Il numero della decisione 0054 («un terzo crate per otto " +
      "funzioni») era falso **nel commit che lo scriveva**: ne contava già " +
      "quattordici. Non un numero invecchiato — un numero mai ricavato dalla " +
      "sua sorgente, che è la specie che questo file esiste per rendere impossibile.",
    comando: "grep -c '^pub fn ' crates/fub-sdk/src/testing/conformita.rs",
  },
  {
    nome: "diagnostica-shell",
    ragione:
      "I `console.warn`/`console.error` rimasti nella shell: ciò che va storto e " +
      "che la decisione 0052 vuole far diventare un evento invece che una riga " +
      "nella console di qualcuno. È un numero che deve **scendere**, e il " +
      "presidio è ciò che lo fa notare quando risale.",
    comando: "grep -rEc 'console\\.(warn|error)' frontend/src | awk -F: '{n+=$2} END{print n+0}'",
  },
  {
    nome: "verbali",
    ragione:
      "I verbali delle decisioni chiuse. È il conteggio che `todo.md` scriveva " +
      "già col suo comando accanto — l'unico che avesse una sorgente prima di " +
      "questo registro, e diceva «cinquantasette» quando erano cinquantanove.",
    comando: "ls docs/decisions/0*.md | wc -l",
  },
  {
    nome: "voci-aperte",
    ragione:
      "Le voci ancora aperte del piano infrastrutturale: le righe della tabella " +
      "di `todo.md`. Il piano dichiara che «se una voce è in questa tabella è " +
      "aperta» e che una voce chiusa **sparisce** — quindi il numero non è una " +
      "cosa da ricordare, è una cosa da contare, e finora nessuno lo faceva.",
    comando: "grep -c '^| \\*\\*§' docs/todo.md",
  },
];
