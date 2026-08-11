# 0059 — La generazione non è un round-trip, e la frase che lo diceva adesso è una rete

|  |  |
|---|---|
| **Decisa** | 2026-07-30 |
| **Origine** | il doc di `FormatProvider::serialize` — la **sesta specie** della [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md), non una voce di [todo.md](../todo.md) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) ·
[la primitiva giusta, 0008](0008-modifica-chirurgica.md) ·
[la sorgente di uno `Span`, 0058](0058-un-nome-che-nasce.md) ·
[la tassonomia, 0056](0056-un-elenco-che-e-la-sorgente.md)

---

Il doc di `FormatProvider::serialize` dice, alla lettera:

> **Il kernel non riscrive mai un file esistente passando da qui**: serve a
> generare documenti nuovi (template, "crea nota") e frammenti. Le modifiche
> programmatiche a un documento esistente si fanno come patch chirurgiche sulla
> sorgente, guidate dagli `Span`.

Quella frase è una promessa sul **comportamento dell'host**, e nessun test la
teneva. È la sesta specie del
[§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md) — la *garanzia dichiarata* —
e la ragione per cui è la peggiore è scritta lì: «il motivo per cui si scrive
una garanzia è smettere di doverci pensare; un conteggio qualcuno prima o poi lo
ricontrolla, una rete che si crede tesa non la guarda nessuno».

## Il danno, e chi lo avrebbe causato

[`edit.rs`](../../crates/fub-abi/src/edit.rs) elenca fra i clienti di
`apply_edit` «scrivere una proprietà (8.2)», «spuntare un task (10.1)»,
«correggere un link rotto (7.2)». Nessuno dei tre è implementato. Il giorno che
qualcuno li implementa, la strada comoda è `read_model` → muta il `frontmatter`
→ `serialize` → `write_document`: quattro chiamate che esistono tutte e che
**compilano**. Il risultato è che ogni nota toccata perde i commenti dello YAML,
l'ordine delle chiavi, lo stile delle virgolette, la spaziatura dei blocchi e lo
stile dell'enfasi — cioè, una per una, le voci del secondo gruppo della §2.4 di
[FEATURES.md](../FEATURES.md), *cosa si preserva quando invece si scrive*. E non
c'è niente di rosso da nessuna parte: chi se ne accorge è chi tiene il vault
sotto git.

Non è un'ipotesi: quella funzione è stata scritta davvero, e sta qui sotto.

## Fatto

- [x] **Il presidio**:
      [`crates/fub-abi/tests/serialize_non_riscrive.rs`](../../crates/fub-abi/tests/serialize_non_riscrive.rs).
      Un'**allowlist chiusa dei punti di chiamata** — `(file, forma, quante
      volte, perché)` — confrontata nei due versi con ciò che l'estrattore trova
      nei sorgenti di produzione. Tre righe, due ragioni, e nessuna delle due è
      «sto modificando un documento».
- [x] **Nasce verde**, che è il momento giusto per tenderla: l'unico punto di
  produzione che nomina `serialize` come chiamata di metodo è il provider che lo
  implementa (`fub-format-markdown/src/lib.rs`, che delega alla funzione libera
  del proprio modulo), più i due `u64_string::serialize` di serde, che con i
  documenti non c'entrano.
- [x] **La frase presidiata è ancorata al contratto.** `format.rs` arriva per
  `include_str!` — se il file si sposta il test non compila — e
  `la_garanzia_e_ancora_scritta_nel_contratto` pretende che la frase ci sia
  ancora. Senza, il giorno in cui qualcuno riscrivesse quel doc resterebbe in
  piedi un test che difende una regola che nessun documento dichiara più.
- [x] **La rete sa chiudersi**, e i suoi tre versi sono stati provati uno per
  uno. Sotto.

## La prova che diventa rossa quando deve

*Un presidio che non può diventare rosso è la sesta specie con un nome nuovo*,
quindi la violazione è stata scritta prima del test e non dopo. In
`kernel/src/workspace.rs`, la strada comoda per intero:

```rust
pub fn scrivi_una_proprieta(&mut self, id: &DocId, chiave: &str) -> Result<()> {
    let mut model = self.read_model(id)?;
    model.frontmatter.0.insert(chiave.to_string(), serde_json::Value::Bool(true));
    let source = self.docs.provider_for(id)?.serialize(&model)?;
    self.write_document(id, &source)
}
```

`cargo build -p fub-kernel`: **compila al primo colpo**, in un secondo e mezzo,
senza una firma nuova e senza toccare niente. È la misura del problema, non un
dettaglio del metodo.

Col presidio addosso:

```
questi punti del codice di produzione nominano `serialize`, e l'allowlist
non li conosce:
  crates/fub-kernel/src/workspace.rs — `.serialize`
```

Poi la funzione è stata tolta (`git diff` vuoto su `workspace.rs`) e il test è
tornato verde. Gli altri due versi sono stati provati allo stesso modo, perché
un'asserzione che non si è mai vista fallire è un'asserzione di cui non si sa
niente:

| verso | come | cosa ha detto |
|---|---|---|
| ne compare uno | la funzione qui sopra | `crates/fub-kernel/src/workspace.rs — .serialize` |
| ne sparisce uno | una riga finta nell'allowlist | `l'allowlist dichiara punti di chiamata che nel codice non ci sono più` |
| il conteggio | `1` → `2` su una riga vera | `la forma serialize::serialize compare 1 volte e l'allowlist ne dichiara 2` |

E uno l'ha trovato la prova stessa: la frase da cercare in `format.rs` **non si
trovava**, perché nel doc-comment va a capo dopo «Il». Cercarla come sta scritta
avrebbe legato il presidio all'impaginazione di `rustfmt`, cioè lo avrebbe reso
rosso il giorno in cui qualcuno aggiunge una parola tre righe più su. Adesso il
confronto è su prosa **normalizzata** — marcatori di commento tolti, spazi
collassati — perché ciò che si presidia è la frase, non dove va a capo.

## Le decisioni

*L'allowlist, e non la barriera di tipo.* La barriera — rendere `serialize`
irraggiungibile da dove si scrive un documento che esiste — è più forte: non si
aggira per distrazione. Costa però una firma diversa nel contratto, che è
**additivo** e vicino al freeze di M4, e la comprerebbe per un guadagno che qui
è quasi tutto già preso: il gesto che questo presidio esiste per fermare è
distratto **per definizione** — quattro chiamate comode scritte da chi non sta
pensando a questa regola — e contro il distratto una riga rossa e un elenco da
modificare bastano. Contro chi vuole davvero aggirarla non basterebbe nemmeno la
barriera, perché chi vuole aggirarla cambia la firma.

*Non in `fub_sdk::testing::conformita`.* Era la terza forma possibile, ed è il
posto sbagliato per una ragione di **soggetto**, non di comodità: quel modulo —
nato con la [0054](0054-il-banco-del-lato-provider.md) — presidia ciò che fa un
*provider*, e questa garanzia riguarda ciò che fa l'*host*. Un provider può
implementare `serialize` in modo perfettamente conforme, e la garanzia essere
violata lo stesso: a violarla è chi lo **chiama**. Metterla là avrebbe voluto
dire chiedere a chi scrive un provider di verificare una promessa che non è sua
e che non può tenere.

*La chiave è `(file, forma, conteggio)`.* Il solo file sarebbe troppo largo — un
crate che già nomina `serialize` per serde potrebbe aggiungerci una chiamata
vera restando verde. La sola forma sarebbe troppo larga nell'altro verso:
`.serialize` è legittimo nel provider e mai altrove, e senza il file le due cose
sono indistinguibili. Il conteggio chiude l'ultimo spiraglio, cioè una *seconda*
chiamata identica nello stesso file — e costa una riga da toccare, che è
esattamente ciò che serve perché qualcuno la guardi.

*Il `serialize` di serde sta nell'allowlist, non in un filtro dell'estrattore.*
Sarebbe stato comodo togliere «i serialize di serde» prima del confronto, e
sarebbe stato il difetto in miniatura: un filtro deve **indovinare** quale sia
quale, e indovina in silenzio. Nell'allowlist invece la distinzione è scritta a
mano una volta, con la sua ragione (`Perche::UnAltroSerialize`), e un serde
nuovo costringe qualcuno a guardare e dire «sì, è l'altro».

*Il cammino dei sorgenti non ha un elenco di crate.* Guarda ogni `.rs` sotto una
cartella `src/`, ovunque nel repo. Un elenco di crate da cui iterare sarebbe
stato il difetto del §16.7 dentro al presidio che lo cura: un crate nuovo
entrerebbe muto. Che il cammino funzioni davvero non è dato per buono — lo dice
`il_cammino_trova_il_contratto`, e prima ancora lo dice il verso «ne è sparito
uno», perché un cammino che tornasse a vuoto farebbe risultare sparite tutte e
tre le righe.

*I `tests/` e i moduli `#[cfg(test)]` non si guardano.* Un test che chiama
`serialize` per verificare cosa `serialize` genera fa esattamente ciò che deve
fare, e la garanzia riguarda ciò che viene spedito. Il salto dei moduli di prova
è una regola minuscola e dichiarata — attributo a colonna zero, `mod … {` subito
sotto, prima riga uguale a `}` — che tiene perché `cargo fmt --all --check` è
verde; quando la forma è un'altra (`#[cfg(test)]` su una funzione, succede due
volte nel repo) non si salta niente, perché contare di più è il verso innocuo.

*Il test è più stretto della frase che presidia, e va detto.* La frase vieta di
riscrivere un file **esistente**; il test vieta al kernel di *nominare*
`serialize`, punto. «Questo sorgente finisce in un file che non c'era» non è una
proprietà che si legga in un `.rs`. Il giorno in cui il kernel genererà davvero
un documento nuovo — un template, «crea nota», che il doc di `serialize` elenca
fra gli usi legittimi — quella riga sarà rossa, e la risposta giusta sarà
aggiungerla all'allowlist con una ragione nuova nell'enum `Perche`, che oggi ne
ha due e nessuna delle due copre la generazione. Cioè una decisione, che è il
punto.

## Le maglie che lasciano passare

Questo presidio legge i sorgenti come **testo**, e va scritto qui invece che
scoperto dopo — se una copertura ha un limite, il limite va detto accanto alla
copertura, o si crederà che copra ([0056](0056-un-elenco-che-e-la-sorgente.md)).
Lo aggirano:

- un `use … as` con un **alias**: `gen(&model)` non nomina `serialize` da
  nessuna parte;
- una **macro** che compone la chiamata;
- una chiamata dentro un modulo `#[cfg(test)]` o dentro un file `tests/`, che
  però non finisce in ciò che viene spedito.

Non lo aggirano il metodo preso in UFCS (`FormatProvider::serialize` senza
parentesi) né la chiamata libera dopo un `use`, che sono le due forme che un
estrattore ingenuo lascia passare: l'occorrenza conta se è preceduta da `::` o
da `.`, oppure se è seguita da `(`.

Preferirla lo stesso a una maglia più stretta non è una svista, è la
sottovalutazione del §16.7 presa dal verso opposto: **una rete a maglie larghe
messa dove il pesce passa vale più di una rete stretta messa altrove.** Il gesto
vero — `provider.serialize(&model)` scritto nel kernel, in `fub-host`, in
`fub-app` o in una feature ufficiale — non passa, e quel gesto è comodo proprio
perché non ci si mette ingegno. Chi si mette a comporre un alias per aggirare un
test ha già letto il test, e a quel punto il presidio ha fatto il suo lavoro:
non impedire, ma **rendere visibile in review**, che è la stessa logica con cui
`wit_additivity` non impedisce di ritagliare la linea di base.

## Perché non è una voce di `todo.md`

Il criterio di quel file è scritto nel suo cappello: *FEATURES.md è possibile
solo se la stragrande maggioranza di quelle voci è un provider*. Le sue voci sono
pezzi di infrastruttura che mancano perché una feature possa essere un provider —
non «ogni test che vale la pena scrivere». Qui non manca un pezzo: manca una
rete sotto una cosa che c'è già ed è già giusta. Il precedente esatto è
[`dependency_invariant.rs`](../../crates/fub-abi/tests/dependency_invariant.rs),
che esiste per un verbale e non per una voce; e un verbale che non viene da un
`§` ha il suo, la [0025](0025-la-ricerca-predefinita.md).

E **non chiude la [§16.8](../roadmap/16-crate-sdk-banchi-di-prova.md)**, che
chiede una cosa diversa e più grande: un'*annotazione* con cui un numero scritto
in italiano dentro un documento si lega a come lo si ricava. Questa è una
garanzia sola, presidiata a mano, della stessa famiglia — la seconda dopo la
[0058](0058-un-nome-che-nasce.md), che ne ha trovata una mezza per strada
(`KernelError::BadName`, dichiarato e mai costruito).

## Cosa si è scartato

- **La barriera di tipo** e **la proprietà di conformità nell'SDK**: sopra, con
  le loro ragioni.
- **Un filtro che escluda serde dall'estrattore.** Deve indovinare, e indovina
  in silenzio.
- **Un elenco di crate da scandire.** È il difetto del §16.7 dentro al presidio
  che lo cura.
- **Cercare la frase del contratto come sta scritta.** Lega il presidio
  all'impaginazione di `rustfmt`.
- **Una riga nella tabella delle invarianti di
  [CONTRIBUTING.md](../CONTRIBUTING.md).** Ci starebbe, ed è il documento che il
  destinatario di questo presidio legge prima di scrivere. Non è stata scritta
  perché quella tabella dichiara «**cinque** invarianti» e la prosa sotto parla
  della «sesta regola» e dell'«unica delle cinque»: aggiungerne una è rinumerare
  tre frasi di un documento, cioè un lavoro sulla prosa e non sul presidio. Sta
  qui annotato, dove chi vorrà prenderlo lo trova.
- **Un puntatore al presidio in
  [data-model.md](../architecture/data-model.md)**, che ripete la stessa
  garanzia al §«Fonte di verità e `serialize`». Stessa categoria, stessa scelta:
  la frase là dentro adesso è vera *e* presidiata, e non è falsa senza il
  puntatore.

## Cosa resta fuori, dichiarato

- **La strada giusta non è stata costruita.** Questo lavoro rende impossibile
  quella sbagliata: scrivere una proprietà (8.2), spuntare un task (10.1) e
  correggere un link rotto (7.2) restano da fare, e con essi il `PropertyType`
  che [strozzature.md](../roadmap/strozzature.md) descrive come mancante.
- **Le altre copie della frase.** `serialize.rs`, [PIANO.md](../PIANO.md),
  [traits.md](../architecture/traits.md) e
  [data-model.md](../architecture/data-model.md) dicono la stessa cosa; il test
  ne àncora **una**, quella del contratto. Le altre non sono false, e legarle
  tutte vorrebbe dire quattro asserzioni che falliscono insieme per lo stesso
  motivo.
- **Il presidio non gira nel job `invarianti` della CI**, che chiama quattro
  test per nome. Gira in `build + test` con tutto il resto. Metterlo fra i
  veloci è una decisione sull'identità di quel job — oggi si chiama «abi↔WIT,
  additività, dipendenze» — e non un gesto.

## Verifica

`cargo fmt --all --check`: pulito.
`cargo clippy --workspace --all-targets -- -D warnings`: pulito.
`cargo test --workspace`: **926 test verdi in 89 binari, 0 falliti** — erano 920
in 88 alla [0058](0058-un-nome-che-nasce.md), e i sei nuovi sono tutti in questo
file: la rete, l'àncora alla frase, il cammino, e tre test del test
(l'estrattore vede la strada sbagliata; distingue la definizione dalla chiamata
senza contare la prosa né il modulo di prova; un `#[cfg(test)]` su una funzione
non fa saltare niente).

`wit_additivity` resta verde e non poteva non restarlo: non si è toccato il
contratto, né in Rust né nel WIT. Nessun file di produzione è cambiato — il diff
è un test nuovo e due documenti.
