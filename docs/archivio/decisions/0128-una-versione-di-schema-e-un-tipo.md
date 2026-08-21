# 0128 — Una versione di schema è un tipo, e un nome non lo fa rispettare nessuno

**Stato**: accolta **Data**: 2026-08-06 **Chiude**: la zona cieca che la
[0106](0106-un-formato-si-presenta.md) aveva lasciata scritta — *«resta fuori
ciò che una versione la dichiara senza dirlo nel nome (`const E_SCHEMA_REV`): la
porta è che una versione di schema si chiama `VERSION`»* **Commit**: *(questo
commit)*

---

## La domanda

Undici formati su disco, undici numeri di schema, e tre presidi che li tengono
in fila: un conto che li trova nei sorgenti (`schemi-su-disco`), un conto che
conta le righe della tabella di [versionamento.md](../versionamento.md)
(`schemi-in-tabella`), e `crates/fub-app/tests/schemi_su_disco.rs` che confronta
le due liste nei due versi.

Il primo dei tre cercava la parola `VERSION` dentro il nome della costante. La
0106 se n'era accorta scrivendolo, e aveva lasciato la domanda aperta in una
riga: **il nome è una regola, o una consuetudine?** Se è una regola, chi la fa
rispettare?

## La misura, prima di decidere

**Undici, e tutte si chiamano `VERSION`.** Dieci `SCHEMA_VERSION` e una
`DIAGNOSTICS_VERSION`. Nessuna violazione in casa: il buco è interamente
prospettico, e questo è ciò che lo rende difficile — un presidio che oggi non
sbaglia mai è indistinguibile da un presidio che funziona.

**E la 0106 aveva già scritto perché la regola-nome non regge**, due paragrafi
sopra la riga che la propone. `DIAGNOSTICS_VERSION` era sfuggita per un anno a
un conto che guardava il nome, e il verbale lo commenta così: *chi l'aveva
chiamata così non aveva sbagliato niente — un conto che guarda un nome si elude
senza volerlo.* Cioè: l'unica volta che il repo ha misurato questa regola sul
campo, l'ha vista violata in buona fede da qualcuno che stava applicando la
§15.3 **meglio della media** — la sua costante era nata con il campo e col
commento «§15.3» già scritto accanto.

Una regola che si viola in buona fede non è una regola: è una consuetudine con
una sanzione. E la sanzione, qui, non cade su chi sbaglia — cade sul presidio,
che smette di vedere un formato e resta verde.

## La decisione

**Il nome non diventa una regola. Diventa una regola il tipo.**

`SchemaVersion`
([`crates/fub-abi/src/schema.rs`](../../crates/fub-abi/src/schema.rs)) è un
`u32` con un nome, `#[serde(transparent)]` — su disco non è cambiato un byte, e
non poteva: quei file sono sui dischi delle persone. Le undici costanti lo
dichiarano, e **gli undici campi dei record lo pretendono**: `v: 1` non compila
più.

Chi la fa rispettare è quindi il **compilatore**, e il conto passa dal nome al
tipo:

    const [A-Z_0-9]+: SchemaVersion =

Da cui due proprietà che il nome non dava:

- **una rinomina non rompe niente e non nasconde niente.**
  `const E_SCHEMA_REV: SchemaVersion` è contata come le altre — è il caso esatto
  che la 0106 aveva dichiarato scoperto, e adesso è coperto senza chiedere
  niente a chi scrive;
- **un intero che si chiama `VERSION` e non è una versione di schema non entra
  più.** La forma vecchia contava per omonimia, e in un codebase che cresce
  l'omonimia arriva.

### Perché un tipo e non un trait

Un trait con una costante associata (`trait Persisted { const VERSION: … }`) è
la forma che viene in mente per prima, ed è **una porta che non aggancia**: la
implementerebbe chi già si dichiara, e chi non si dichiara — che è il caso da
prendere — non la implementa. Il tipo aggancia perché non è opzionale: sta nella
firma del campo che il record deve avere per serializzarsi.

E che abbia agganciato non è un'opinione: se un sito fosse rimasto indietro col
`u32`, `schemi-su-disco` conterebbe dieci e `schemi-in-tabella` undici, e i due
numeri stanno nella stessa frase. **La quarta trappola di questa famiglia — una
porta strutturale che non aggancia e il verde che non lo dice — la chiude il
conto, non l'occhio.** Misurato: rimettendo `u32` su `kernel/vault.rs` il conto
scende a dieci e diventa rosso.

### Perché undici era il numero giusto

Con tre formati un tipo sarebbe stato più cerimonia che regola, e un conto
sarebbe bastato. Con quaranta, la migrazione non l'avrebbe fatta nessuno e la
porta sarebbe rimasta lì mezza attraversata — cioè peggio di prima, perché un
presidio parziale si legge come un presidio. Undici siti si attraversano in un
commit e si verificano contandoli.

## La verifica del rosso

Tre prove, tutte togliendo o cambiando qualcosa di vero:

1. **una versione rinominata** (`DIAGNOSTICS_VERSION` → `E_SCHEMA_REV`): il
   conto resta **undici** e la suite verde. È il buco della 0106, ed è chiuso —
   la prova che conta, perché è l'unica in cui il presidio *non* diventa rosso e
   deve non diventarlo;
2. **uno schema nuovo che nessuno documenta** (`const PROVA_REV: SchemaVersion`
   dentro `drafts.rs`): `schemi-su-disco` conta dodici contro l'«undici» della
   prosa, **e** `ogni_costante_di_versione_ha_la_sua_riga_in_tabella` lo nomina
   per file e riga;
3. **un sito rimasto col `u32`**: il conto scende a dieci e diverge dalla
   tabella.

## Le zone cieche che restano, dichiarate

**La prima è la 0106 e non si muove**: un formato che nasce senza costante *e*
senza riga in tabella non lo prende nessuno dei tre presidi. A prenderlo
servirebbe un tipo che ogni scrittura durevole attraversi, e non c'è perché
**dalla stessa porta passano i file di Fub e i file dell'utente** — il markdown
di una nota un numero di schema non deve averlo.

**La seconda è un buco dichiarato nuovo, e nasce con questa forma**: una
versione scritta al volo dentro il record — `v: SchemaVersion::new(1)`, senza
una costante che la nomini — è di tipo giusto e non la conta nessuno. Il tipo
rende impossibile scrivere `v: 1`; non rende impossibile non dare un nome all'1.
Si prenderebbe con un conto sulle `SchemaVersion::new(` fuori da una `const`, e
non si è scritto perché sarebbe un quarto presidio su una superficie che ne ha
già tre e nessun caso misurato.

## Una premessa caduta, scrivendo

`SchemaVersion` doveva stare in `fub-kernel`: un numero di schema è dei file di
Fub, non del contratto che i plugin vedono, e mettere un concetto interno dentro
`fub-abi` sembrava allargare il contratto per comodità. Non compila:
**`fub-features` non dipende da `fub-kernel`** — è un'invariante scritta nel suo
`Cargo.toml` e presidiata da `crates/fub-abi/tests/dependency_invariant.rs` — e
due degli undici formati (l'indice di ricerca e il versioning) stanno lì. Il
solo crate comune è `fub-abi`, e a guardarla dopo la casa è giusta per una
ragione migliore di quella per cui ci è finita: `fub-abi` è già dove sta
`rules/path_policy.rs`, cioè dove stanno le regole su ciò che finisce su disco.
Il contratto WIT non cambia di una riga — questo tipo non lo attraversa nessun
plugin.
