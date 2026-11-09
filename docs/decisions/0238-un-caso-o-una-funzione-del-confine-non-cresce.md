# 0238 — Un caso o una funzione del confine non cresce

- **Stato:** accolta
- **Data:** 2026-11-08
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

Estende l'[ADR 0235](0235-un-record-pubblicato-non-cresce.md) dai record agli
`enum`, ai `variant`, ai `flags` e alle funzioni delle interfacce esportate.
L'[ADR 0180](0180-compatibilita-wit-additiva.md) resta in vigore.

## Contesto

L'ADR 0180 contava fra le aggiunte compatibili un caso nuovo in fondo a un
`variant` o a un `enum`, e una funzione nuova in un'interfaccia. L'ADR 0235 ha
provato che un campo in coda a un record non lo è, e ha lasciato i casi e le
funzioni esportate «come un campo nuovo finché un test non prova il
contrario».

La prova con componenti veri dice che non sono compatibili. Quando istanzia
un plugin, wasmtime controlla per intero il tipo di ogni funzione che il
plugin importa ed esporta:

- un `enum` o un `variant` cresciuto nell'host, in un'interfaccia esportata
  dal plugin, non lascia istanziare il plugin compilato prima («expected enum
  of 4 names, found 3 names»);
- lo stesso vale in un'interfaccia **importata**: un caso in più in un tipo che
  il plugin riceve dall'host è un tipo diverso da quello compilato, e il
  plugin non si istanzia, anche se l'host non manderebbe mai il caso nuovo;
- una funzione in più in un'interfaccia esportata è una funzione che il plugin
  vecchio non fornisce, e l'host non lo istanzia;
- una funzione in più in un'interfaccia importata, invece, il plugin non la
  chiede, e nessuno la controlla: il plugin vecchio gira come prima.

Un `flags` è controllato come un `enum`, confrontando l'elenco dei nomi
(`typecheck_flags` in wasmtime): un bit in più è un tipo diverso.

## Decisione

1. **Da `0.2.0` un `enum`, un `variant` o un `flags` che attraversa il confine
   non prende casi nuovi**, né in coda né altrove, e non perde né sposta i
   casi che ha. «Attraversa il confine» vuol dire raggiunto da una firma di
   un `world`, import o export, con la stessa visita dei record dell'ADR 0235.
2. **Da `0.2.0` un'interfaccia esportata dal plugin non prende funzioni
   nuove**, e non perde né cambia quelle che ha. Le due obbligazioni nate
   prima di `0.2.0` (`index::up-to-date`, `view::interests`) restano note
   solo contro le `0.1.x`.
3. **Una funzione nuova in un'interfaccia che il plugin importa resta
   compatibile.** Cambiare o togliere una funzione esistente no.
4. **Le novità passano da interfacce nuove**, come per i record: l'host cerca
   gli export una interfaccia alla volta, e un plugin che non ha
   l'interfaccia nuova prende il default.
5. Contro `0.1.0` e `0.1.1` restano le regole con cui sono state congelate: il
   caso in coda passa.

## Conseguenze

### Positive

- la promessa dell'ADR 0180 regge davanti a un plugin compilato davvero
  anche per i casi e per le funzioni, non solo per i record;
- la guardia sui testi WIT dice la stessa cosa del caricatore, e la dice
  prima del rilascio.

### Negative

- un caso nuovo in un tipo del confine (un tipo di componente, una superficie
  di UI, una domanda all'indice) costa un'interfaccia nuova con il suo tipo e
  il default nell'host;
- un tipo usato sia da superfici vecchie sia da superfici nuove non si può
  allargare in un punto solo: la superficie nuova porta il tipo nuovo.

## Alternative scartate

### Il caso in coda con un caso di riserva nel guest

Un `variant` con un caso `other(string)` o un `enum` con `unknown` lascerebbe
al guest un posto dove mettere ciò che non conosce. Non risolve il punto:
wasmtime rifiuta il plugin al caricamento, prima che un valore passi, perché
il tipo non è lo stesso. E un caso di riserva sposta il controllo a valle,
in ogni guest.

### La guardia stretta solo sugli export

Era la forma dell'ADR 0235 e della prima prova. La prova degli import dice
che anche un tipo che il plugin riceve rompe il caricamento: una regola solo
sugli export lascerebbe passare proprio quella rottura.

## Verifica

`crates/fub-wasm-host/tests/new_case_and_function.rs` carica plugin compilati
contro la WIT di prima: `esempi/plugin-prima-del-caso` e
`esempi/plugin-prima-della-funzione` sul contratto vero, `esempi/servizio-prima`
per un export alla volta, `esempi/cliente-prima` per gli import.
`crates/fub-abi/tests/wit_additivity.rs` applica la regola per snapshot contro
`wit/frozen/`, con un caso finto per ogni regola.
