# 0052 — Ciò che va storto è un evento, e il kernel smette di buttarlo

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §20.2 + §20.3 (seduta 20) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/20-quando-qualcosa-va-storto.md) ·
[la gemella, che dà un esito a chi non l'aveva](0051-l-alimentazione-risponde.md)

---

Due voci in un verbale solo, e non per comodità: la §20.2 chiedeva **dove**
scrivere ciò che va storto, la §20.3 chiedeva che il kernel smettesse di buttare
gli esiti che ha già in mano. La §20.3 lo diceva da sé — *«va deciso con il
§20.2, o si raccoglie in un `Vec` che non ha dove andare»* — ed è vero anche al
contrario: una variante di evento che nessuno emette è una destinazione senza
niente da metterci dentro.

## Le due cose che la §20.2 aspettava, verificate

La voce diceva di aspettare **un cliente** e **un tipo**. Contate contro i
sorgenti:

- **Il cliente c'è**, e sono **ventisette** `eprintln!` nel codice di produzione
  (non venticinque: il numero della voce era vecchio di due giri — vedi *I
  numeri che erano sbagliati*), più i due commenti del kernel che nominavano
  questo canale per nome («M4: notifica») e il doc di `flush_indexes`.
- **Il tipo è arrivato**, e la riga che lo dichiarava mancante era **morta**: la
  §20.2 diceva *«qualunque variante porti "cosa è andato storto" porta un
  `PluginError`, che oggi è prosa italiana composta … §12.2 e questa voce hanno
  lo stesso tipo dentro, e quella è P0 mentre questa no»*. Il §12.2 è chiuso
  dalla [0041](0041-un-errore-e-testo-che-qualcuno-legge.md) da quattro sedute:
  ogni payload di `PluginError` è un `Text`, cioè una chiave e i suoi argomenti,
  traducibile da chi lo mostra. Non c'era più niente da aspettare.

## La decisione

Una variante **in coda** a `Event` — additiva, quindi non tocca la linea di base
— e un kernel che la emette dai punti in cui prima scartava.

```rust
// crates/fub-abi/src/event.rs
Event::Trouble {
    severity: Severity,        // NUOVO
    subject: Option<DocId>,
    error: PluginError,
}

pub enum Severity { Warning, Failure }   // NUOVO
```

## Le decisioni prese, da NON ridiscutere senza motivo

### La severità si compila senza indovinare, perché la decide la classe del dato

Due gradini e non cinque, come i due toni del centro notifiche: una scala che
chi emette non sa dove tagliare finisce con tutto sullo stesso gradino. Ma il
punto vero è il **criterio**, e viene dalla [0048](0048-una-radice-sola.md):

> **La classe del dato perso dice la severità.** Ciò che è *derivato* si
> ricostruisce riaprendo il vault, e la sua perdita è un `Warning`; ciò che era
> *autorevole* non torna, e la sua perdita è un `Failure`.

È lo stesso confine che la 0048 ha reso visibile sul disco (`data_*` contro
`cache_*`), letto qui come gravità. Senza di esso il campo sarebbe stato un
giudizio a occhio di chi emette, cioè un valore che nessuno può verificare —
esattamente ciò che la [0026](0026-due-query-insieme.md) ha rifiutato di mettere
in una firma.

`Failure` è anche ciò che si usa **quando non si sa**: dietro un `EventHandler`
c'è il versioning tanto quanto un contatore, e il kernel non sa cosa *non* è
successo. Sottostimare un guasto è peggio che sovrastimare un avviso.

### Il soggetto è il documento; **chi** ha fallito lo dice l'origine

`subject` è `Option<DocId>` — assente per ciò che riguarda il vault intero (un
flush fallito, il watcher che smette). Non c'è nessun campo `plugin`: quel fatto
lo porta già `origin.actor` dalla [0012](0012-origine-degli-eventi.md), e il
guasto di un handler si emette **a nome suo**. Un campo in più avrebbe duplicato
ciò che il notice porta, con la certezza che prima o poi i due avrebbero detto
cose diverse.

Sul filtro per soggetto vale la regola già scritta per `overflow` e
`vault-closed`: un guasto che **non** nomina un documento passa da ogni maschera
invece che da nessuna. Qui con più forza che altrove — un avviso filtrato via è
precisamente la cosa che questa variante esiste per non far succedere.

### Non è recuperabile, ed è l'unica classificazione possibile

Un guasto non si riscopre guardando il vault: dopo un flush fallito il vault è
**identico** a com'era prima, ed è esattamente questa la ragione per cui quel
fallimento va detto. Il canale si riempie quando le cose vanno male, cioè quando
serve.

### Il guasto della consegna di un guasto non si emette

È l'unico ciclo che questa variante rende possibile — un handler che fallisce
*ricevendo* un `Trouble` ne produrrebbe un secondo, che ripasserebbe da lui — e
si chiude dove nasce, in `deliver_to_handlers`, perché è il kernel a emettere.
Il budget del dispatch lo fermerebbe comunque: ma quello è una rete di
sicurezza, non una semantica, e ciò che troncherebbe sono gli eventi degli
altri.

### Il §20.3 si chiude con la forma della 0030, non con l'attenzione dei chiamanti

La [0030](0030-il-rilevamento-si-puo-chiedere.md) aveva già chiuso una
occorrenza di questa firma senza chiedere a nessuno di stare attento: *un
`Result` che dipende dall'attenzione di chi lo riceve è un `Result` che si
perde, e il posto dove metterlo al sicuro è dentro chi lo produce.* Applicata
qui:

- **`deliver_to_handlers`** raccoglie l'errore di ogni handler e lo emette.
  L'operazione che ha emesso l'evento **non** fallisce — quella metà del vecchio
  commento era giusta ed è rimasta — ma «non far fallire» non vuol dire «non
  dirlo». È il punto in cui il versioning, che è un `EventHandler` e
  nient'altro, smetteva di fare snapshot in un modo indistinguibile dal
  funzionare.
- **`flush_indexes`** racconta da sé i propri errori e **continua a
  restituirli**: il valore di ritorno resta perché un chiamante deve *agire* e
  non solo mostrare — la chiusura del vault
  ([0029](0029-chiudere-un-vault-e-chiuderli-tutti.md)) li risale fino a chi
  spegne l'app, e in quel momento l'event bus sta per smettere di avere
  ascoltatori. Chi si limitava a guardare non deve più fare niente.
- **`safety::notifying` non esiste più.** Al suo posto c'è `reporting`, che
  **restituisce** il panico invece di stamparlo, con un `#[must_use]` che rende
  visibile in review chi lo ignora. Un `Option` che si butta si vede; un
  `eprintln!` no.

### La perdita di un'alimentazione è un `Warning`, e non è un giudizio blando

Un indice è un derivato: ciò che si è perso torna riaprendo il vault. Non vuol
dire «non è grave» — chi cerca, fino ad allora, riceve una risposta incompleta
senza sapere che lo è, ed è esattamente per questo che glielo si dice.

## Il cliente vero, dalle due parti

Il centro notifiche esisteva già ([0035](0035-il-lavoro-lungo-si-racconta.md)) e
aspettava una sorgente: il suo commento diceva *«il giorno che quella variante
arriva le si attacca il router degli eventi invece di venti chiamanti»*. È la
riga `ascoltaIGuasti()` in `ui/notify.ts`, unico ascoltatore di `trouble`. La
traduzione da severità a tono è uno a uno, e non per caso: i due gradini sono
stati scelti guardando quei due toni.

La parte che poteva essere sbagliata senza vedersi — un `subject` assente che
diventa la stringa `"null"`, una severità che finisce tutta sullo stesso tono —
è una funzione pura, `avvisoDiGuasto`, con il suo presidio.

## I numeri che erano sbagliati

Contati oggi, con il criterio dichiarato perché il prossimo possa ricontarli:

| dove | diceva | è |
|---|---|---|
| §20.2, `strozzature.md`, `PIANO.md`, `leva.md` | 25 / 32 / 14 `eprintln!` | **27** — `grep -rn "eprintln!" crates --include="*.rs"`, meno gli esempi, meno quelli dentro `#[cfg(test)]`, meno le quattro citazioni dentro un doc-comment |
| `PIANO.md`, `leva.md` | 12 `console.warn` | **14** — `grep -rn "console\.warn\|console\.error" frontend/src`, meno i `.test.ts` |

Quattro documenti dicevano tre numeri diversi per lo stesso fatto, e nessuno dei
tre era quello di oggi. È il difetto che il §16.7 esiste per presidiare, e
finché non c'è un presidio la sola difesa è ricontare a ogni giro.

## Cosa resta fuori, dichiarato

- **Il §20.4 resta aperto e resta P1.** Il canale è del backend; i quattordici
  `console.warn`/`console.error` della shell nascono di qua dal confine e non
  passano da un evento del kernel. Lo stato di salvataggio, che è l'altra metà
  di quella voce, non è toccato da qui.
- **Una casella residua**, che il §20.2 lascia dietro di sé chiudendosi: i
  ventisette punti che oggi scrivono su `stderr` vanno portati dentro il canale
  uno a uno. Non è una decisione — la forma c'è — ma non è nemmeno gratis:
  alcuni non hanno il workspace fra le mani (la regola sintattica che pania, in
  `kernel/syntax.rs`, sta dentro il parse), e per quelli vuol dire dare un esito
  a `DocumentStore::parse` e ai suoi otto chiamanti.
- **Il §20.5, aperto misurando questa decisione**: `Trouble` è dichiarato non
  recuperabile e i due freni del canale lo rispettano, ma il budget del dispatch
  svuota la coda **senza guardare quella classificazione**. Vedi la voce.
