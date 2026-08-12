# 0148 — Un prestito lungo non si vieta: si dice

**Stato**: accolta **Data**: 2026-08-12 **Chiude**: §27.3 **Commit**: *(questo
commit)*

---

## La domanda

La [§27.3](../roadmap/27-tre-scommesse-che-nessuno-ha-provato.md#273-la-grana-del-lucchetto-è-il-vault-e-chi-muterà-non-sarà-di-casa)
chiede se il prestito esclusivo **sull'intero vault** regga anche quando chi
muta non è codice di casa. Regge oggi perché chi muta finisce in fretta; la
scommessa è che continui a reggere con un plugin di terzi che non abbiamo
scritto noi. E la P1 stava in una scadenza: la forma grossa — spostare il
lucchetto sui cinque proprietari — «va fatta **prima** che esistano plugin,
perché dopo cambia l'ordine di acquisizione visibile a terzi».

## La premessa, rimisurata

Censimento rifatto a `ae369de`, con i comandi che la voce stessa lascia.

- La `Custodia` (`crates/fub-host/src/custodia.rs:122`) ha quattro porte e
  nient'altro: regge.
- I due prestiti si equivalgono ancora per numero di siti — **55** `write()`
  contro **55** `read()` fra `fub-host` e `fub-app`, dove la voce contava 54 e
  53: regge, ed è cresciuto di un sito per parte.
- `workspace.rs` non è più 6685 righe: è **7141**. «La divisione ha estratto la
  proprietà e non la lunghezza» è più vero di quando è stato scritto.
- I metodi che il contratto dichiara `&mut self` sono **25**, come la voce
  diceva. Ed è qui che il numero, contato una volta sola, dice una cosa che non
  è: **quei venticinque non sono venticinque porte di terzi**. Divisi per chi
  li implementa sono
  - **quattordici** capacità dell'`HostApi`, che le implementa *l'host* e le
    chiama il plugin (`apply_edit`, `create_document`, `rename_document`,
    `trash_document`, `restore_document`, `empty_trash`, `data_write`,
    `data_remove`, `set_setting`, `reset_setting`, `emit`, `spawn_job`,
    `report_progress`, `undo_last`): la loro durata è il lavoro del kernel, e un
    terzo non ha nessun modo di allungarla;
  - **nove** metodi che implementa il *plugin* e chiama l'host — `Plugin`
    (`activate`, `deactivate`), `IndexProvider` (`activate`,
    `on_documents_indexed`, `on_documents_removed`, `reconcile`, `flush`,
    `close`) e `EventHandler::handle` (`traits.rs:3712`): questi sì girano
    **dentro** il prestito, e sono l'unica porta da cui un terzo entra tenendo
    in mano il vault intero;
  - **due** che non sono metodi di confine (`Text::visit_texts`,
    `DocumentMatch::absorb`) e non c'entrano con nessun lucchetto.

E i tre candidati che la voce nomina — un LLM, un sync, un database — hanno già
la casa in cui girano, e non è quella: è un **job**. `JobHost`
(`crates/fub-host/src/jobs.rs:87`) prende e rilascia il prestito **per
capacità**, col costo dichiarato nel suo stesso doc — «su un job che cammina il
vault sono migliaia di prese, ed è il prezzo dichiarato». Un job lento non tiene
niente mentre è lento.

Quindi la premessa regge, ma la finestra è più stretta di com'era descritta: non
«ogni chiamata mutante di un provider», che per quattordici delle venticinque è
lavoro di casa e per un job è già a grana di capacità, ma **le nove reazioni**
che l'host chiama tenendo il vault.

## La scadenza, rimisurata

La P1 non regge, e cade per una ragione verificabile invece che per stanchezza:
**la grana del lucchetto non è superficie del contratto.** In
`crates/fub-abi/wit/fub/abi.wit` e nel `frozen/0.1.0.wit` la parola non compare:
il `plugin-world` non dichiara né lucchetti né ordini di acquisizione, e nessuna
firma cambia se domani il `Workspace` sta dietro cinque lucchetti invece di uno.
La 0023 lo aveva già detto dall'altro capo — il lucchetto è di chi monta, e il
kernel non sa di essere condiviso.

Quel che resta vero della scadenza è più debole: cambiare la grana **dopo** è
più difficile, perché con più lucchetti nasce un ordine di acquisizione, e un
ordine sbagliato è un blocco a due. Ma è una difficoltà di chi lo farà, non una
major imposta a chi ha scritto un plugin — che è la differenza fra una P1 e una
voce che può aspettare il primo caso misurato.

## La decisione

**La forma (a), e senza il pezzo di contratto che la voce le attribuiva.**

La voce prezzava la (a) come «un errore in più e una riga di disciplina» nel
contratto. L'errore non serve, e sarebbe una firma che nessuno può costruire: un
prestito esclusivo lungo **non si interrompe**. Chi lo tiene ha `&mut` su ciò che
sta dentro, e strapparglielo vorrebbe dire esattamente lo stato a metà che la
[0120](0120-un-lucchetto-avvelenato-si-dice-una-volta.md) chiama irrecuperabile.
Un tetto dichiarato senza il modo di farlo rispettare è una frase, e questo repo
ne ha già rifiutata una uguale.

Ciò che resta della (a) è la metà che vale: **accorgersene e dirlo**, invece di
restare fermi in silenzio. La `Presa` che `Custodia::write` restituisce guarda
l'orologio e, se il prestito ha superato la soglia, scrive una riga che dice
quanto è durato, che cosa era fermo nel frattempo e dove va spostato chi lo
teneva. Il conto — `Custodia::lente()` — si può chiedere, come si può chiedere
`denunce()`, per la stessa ragione: una proprietà che nessuno può interrogare è
una promessa.

Tre cose che la forma di questa riparazione decide, e che vanno lette come parte
della decisione:

1. **Sta nella porta, non nei chiamanti.** È la seconda prova della barra e qui
   è netta: i cinquantacinque siti che prendono il prestito esclusivo la
   ereditano senza saperlo, e il cinquantaseiesimo pure. Fuori dalla porta
   sarebbe una disciplina, cioè la cosa che il doc di quel modulo dice di non
   fare — «una risposta che va ripetuta a ogni `.lock()` futuro è la risposta
   sbagliata».
2. **Solo l'esclusivo.** Un prestito condiviso non mette in fila gli altri
   condivisi, e l'unico lungo che questo repo ha per scelta — la raccolta degli
   spazi per-documento in fondo a un'apertura — è lungo *perché* è condiviso: è
   la riparazione, non il difetto.
3. **La riga una volta, il conto sempre.** È la regola del veleno applicata a
   un fatto di specie diversa: un veleno è uno *stato* e si dice una volta, una
   lentezza è un *evento* e ne può capitare un altro. La riga ripetuta a ogni
   giro coprirebbe la prima; il conto no.

La soglia è un quarto di secondo. Non separa il corretto dallo scorretto —
niente si rompe a 249 ms — ma il momento in cui chi guarda lo schermo smette di
leggere un'attesa come una risposta che arriva. Dall'altra parte il repo ha un
numero misurato: 0,12 ms per un salvataggio sotto contesa
([0024](0024-chi-legge-non-aspetta-chi-legge.md)). Fra i due c'è un fattore
duemila, e nessuna mutazione di casa ci arriva vicino per caso.

## Le forme scartate

**(b) — la grana diventa il proprietario.** Non si fa adesso, e la ragione non è
il costo: è che **non cura la malattia che la voce nomina**. La finestra vera
sono le nove reazioni che l'host chiama tenendo il vault, e un `EventHandler`
che impiega tre secondi impiega tre secondi anche dietro cinque lucchetti — chi
aspetta quel componente aspetta lo stesso. Quel che la (b) comprerebbe è che due
mutazioni che non si toccano smettano di mettersi in fila, che è un guadagno
reale e un altro problema: è il seguito dello `0113`, non della paura di un
plugin lento. Per un provider lento la risposta del repo è già scritta e
funziona — si sposta in un job, dove il prestito è per capacità.

E la prova del secondo chiamante la (b) oggi non la passa: il primo chiamante è
un plugin di terzi che non esiste, il secondo non esiste nemmeno, e il costo va
pagato subito e per intero. Non è escluso per sempre — è escluso *finché non c'è
un caso misurato*, e adesso c'è il modo di misurarlo.

**(c) — com'è oggi.** Era la forma che paga chi usa l'app il giorno in cui monta
il primo plugin lento: l'interfaccia si ferma e niente gli dice perché. È
precisamente ciò che questa decisione toglie, per il prezzo di due letture
d'orologio per prestito esclusivo.

## Cosa resta scoperto

**Zero caselle.** La (b) non diventa un lavoro programmato: diventa una
decisione da riprendere quando un caso misurato la chiede, e chi la riprenderà
troverà il conto delle prese lente al posto della paura.

Il difetto [`0113`](../todo.md#i-difetti-misurati) **resta aperto** e non lo
chiude questa decisione: cinque fasi in fila sotto lo stesso prestito, tre delle
quali toccano il disco, restano cinque fasi in fila. Ma cambia di posto — da
«l'unico caso misurato» a «il primo caso che la porta dirà da sola»: una
`finish_index` che passa il quarto di secondo adesso scrive la propria riga, e
nessuno deve andare a cercarla.

E la riga va su `tracing::warn`, che è dove vanno gli
avvisi che nessuno ha ancora una superficie per mostrare. Non è un buco nuovo: è quello del
sidecar del cestino e dell'anagrafe che non si scrive, che ha già il suo posto —
il [§20.2](../roadmap/20-quando-qualcosa-va-storto.md), che a quegli avvisi darà
una destinazione vera. Finché non ce l'ha, la proprietà la vede chi guarda il
log e chi chiede `lente()`.
