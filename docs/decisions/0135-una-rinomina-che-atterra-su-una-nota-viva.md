# 0135 — Una rinomina che atterra su una nota viva non è una rinomina

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: la [§25.1](../roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#251-una-rinomina-che-atterra-su-una-nota-viva)
— *«Una rinomina che atterra su una nota viva»*, l'unica P0 della seduta 25 e
l'unica voce aperta di questo piano che fosse una **perdita di dati** invece di
una firma. Nella forma **(a)** che la voce stessa raccomanda: *«(a) subito,
(b) dopo»*. La (b) resta aperta, ed è una casella residua di `todo.md`
**Commit**: *(questo commit)*

---

## La domanda

`mv A.md B.md` in un terminale, con Fub aperto e `B` viva in anagrafe. Chi vince
— l'identità che si muove o quella su cui atterra — e che cosa si fa di ciò che
apparteneva alla seconda?

Il codice una risposta ce l'aveva già, e non l'aveva scelta nessuno: vince chi si
muove, e di ciò che apparteneva alla seconda **non si fa niente**, lo si
sovrascrive. `sync_renamed_path` tornava `Ok(true)`, senza avvisi, senza
`Trouble`, senza una riga di log.

## Che cosa si perdeva, e chi lo perdeva

`migrate_side_data` porta dietro tre cose attaccate all'identità: icona e pin
(`organization.migrate`), lo spazio per-documento di chiunque altro
(`migrate_doc_data`), la bozza non salvata (`drafts.migrate`). Tutti e tre
scrivono **sopra** ciò che sta alla destinazione, e nessuno dei tre si chiede se
la destinazione sia libera:

- `organization.migrate` sostituisce icona e pin;
- `docdata::migrate` fa un `remove_dir_all` sullo spazio della destinazione
  prima di rinominarci dentro quello della sorgente;
- `drafts.migrate` scrive `storage.write(&self.path(to), …)`.

Il terzo è quello che conta. Una bozza è — per dichiarazione del modulo che la
tiene e per la [0048](0048-una-radice-sola.md), che la tiene apposta **fuori** da
`data/` — l'**unica** copia di ciò che l'utente ha scritto. Chi aveva il buffer
di `B` sporco e ha fatto `mv A.md B.md` da un'altra finestra perdeva per sempre
quel testo, e a farglielo perdere era il pezzo di codice che esiste per
impedirlo.

Il banco lo misura: prima della guardia stampava

```
BOZZA-B=Some("il testo non salvato di A")
ICONA-B=Some("🅰️")
DATI-B=Some("i dati di A.lnk")
```

Tre canali su tre, tutti e tre rossi.

## La premessa caduta, e perché sembrava vera

**Il rito sembrava uniforme.** Quattro canali celebrano la stessa collisione, e
uno solo — il quarto, `VersionStore::rename` in `fub-features/src/versioning.rs`
— aveva la politica scritta, e scritta bene:

> *Se il nuovo nome aveva già una storia … le due si uniscono in ordine di tempo:
> buttarne una sarebbe perdere versioni senza dirlo.*

Chi leggeva il codice trovava quella frase, la trovava argomentata, e concludeva
che il rito fosse uno solo. Non lo era: era **una politica scritta in un canale e
tre canali che non la applicavano**, e la ragione per cui nessuno se ne accorgeva
è che i tre non hanno un posto in cui la politica si scriverebbe — la migrazione
la fanno e basta.

C'è di più, ed è la forma che questo repo chiama *un commento che argomenta è una
premessa che sembra vera*. In `docdata.rs`, sopra il `remove_dir_all`, stava
scritto:

> *Il path di destinazione era **libero** — il kernel rifiuta un rename verso un
> documento che esiste — quindi una cartella già lì è di una nota che non c'è
> più.*

Era vero per tre chiamanti su quattro e **falso per il quarto**, che è il
watcher: il kernel rifiuta il rename *che fa lui* (`rename_document` ha davanti
un `AlreadyExists`), non quello che gli riferisce il filesystem. Il commento
prometteva un invariante che il codice non manteneva, e prometterlo lo rendeva
invisibile — chi leggeva `remove_dir_all` non aveva ragione di sospettare.

E la voce stessa era arrivata qui per una strada sbagliata: **tutte e quattro le
sue premesse originali erano false**, e il danno c'era lo stesso, in un'altra
funzione. È il secondo motivo per cui questa scelta valeva un verbale invece di
una riga di commit: ciò che si impara non è dove sta la guardia, è che *quattro
riti identici con una politica sola scritta* è una forma da sospettare.

## La decisione

**Se `to_id` è già in `metas` e non è `from_id`, non è un rename.** In
`Workspace::sync_renamed_path_here`:

```rust
if self.indexes.core.metas.contains_key(&to_id) {
    let partito = self.sync_path_here(from)?;
    return Ok(self.sync_path_here(to)? || partito);
}
```

Due righe, e non sono due righe nuove: sono **la degradazione che stava già
dieci righe sopra**, nel ramo in cui `from` non era un documento indicizzato. Le
due mezze verità si dicono entrambe (§14.1) — da `from` è sparito qualcosa, in
`to` è comparso qualcosa — e si dicono dal corpo interno e non dalla porta, così
che l'esito resti registrato una volta sola (§9.7).

Il risultato per l'utente è quello che l'utente vede e capisce: `B` ha il testo
di `A`, ed è vero; `A` non c'è più, ed è vero; la bozza di `B`, la sua icona e il
suo spazio per-documento sono ancora di `B`.

### Perché (a) adesso e non (b)

La (b) — migrare senza mai schiacciare, cioè estendere agli altri tre canali la
regola che il versioning applica alle storie — **è la forma giusta**, e resta
aperta. Ma vuole **tre politiche di collisione** distinte, una per canale, e non
sono la stessa: due storie di versioni si fondono in ordine di tempo, due bozze
non salvate no (fonderle vorrebbe dire inventare un testo che nessuno ha
scritto), e due icone nemmeno. Ognuna vuole poi un avviso, un presidio e un modo
di dirlo a chi guarda.

Niente di tutto questo è urgente **una volta che la (a) impedisce la perdita**, e
decidere tre politiche di collisione sotto la pressione di una perdita di dati
aperta è il modo di deciderle male. La (a) elimina il 100% della perdita
misurata, costa due righe già scritte altrove, e **non pregiudica la (b)**:
niente tipo pubblico, niente WIT, niente formato su disco.

## Che cosa la (a) lascia scoperto, e va detto

**Paga chi ha rinominato**, e paga due cose:

1. **La storia di `A` si spezza.** Non essendo una migrazione d'identità, non
   parte `Event::DocumentRenamed` ma un `DocumentRemoved`, quindi il versioning
   non fonde le due storie: la storia di `A` prende una **lapide**
   (`VersionStore::tombstone` scrive `deleted_at`) e resta attaccata a un id che
   non è più in anagrafe. Le versioni non si cancellano — `VersionStore`
   sopravvive alla cancellazione per la
   [0044](0044-lo-stato-per-documento.md), e un ripristino le rianima — ma da
   `B` non si vedono.
2. **I dati di `A` restano orfani** fino alla prima raccolta: spazio
   per-documento, bozza, icona. La raccolta li toglierà alla prossima apertura,
   perché `A` non è né indicizzata né nel cestino.

È il prezzo dichiarato dalla voce, ed è asimmetrico di proposito: chi rinomina ha
fatto un gesto e ne vede l'effetto, chi subisce la rinomina non ha fatto niente e
non vedrebbe niente.

## Il secondo chiamante la eredita gratis

È la prova che decide, e qui la risposta è netta: **i tre canali non se la devono
ricordare, la attraversano**.

I chiamanti diretti di `migrate_side_data` sono due — `migrate_identity` e
`rejoin_renamed_while_closed` — e il primo ne ha a sua volta due, quindi contati
per *da dove si entra* i modi di arrivare ai tre canali insieme sono **tre**, e
adesso tutti e tre garantiscono la destinazione libera:

| da dove si entra | chi garantisce che `to` sia libero |
|---|---|
| `rename_document` (il rename che fa il kernel) | l'`AlreadyExists` che rifiuta il rename prima di muovere il file |
| `rejoin_renamed_while_closed` (la rinomina che non ha visto nessuno, [0099](0099-una-rinomina-che-non-ha-visto-nessuno.md)) | accoppia solo id che **ieri non erano in anagrafe** — un `to` con dei dati attaccati non è candidato |
| `sync_renamed_path` (il watcher: Finder, shell, client di sync) | **questa guardia** |

Fuori da questi tre, `migrate_doc_data` — che è **uno** dei tre canali, non i
tre — ha altri due chiamanti, e ognuno si difende da sé perché ognuno sceglie il
proprio path di destinazione: `restore_from_trash`, che quando l'origine è di
nuovo occupata approda su un nome scelto dall'utente, e
`rename_entry_in_batch`, che ha un `AlreadyExists` suo. Non è una politica di
collisione ripetuta tre volte: è che a scegliere la destinazione sono loro, e
`sync_renamed_path` è l'unico a cui la destinazione la detta il filesystem.

La guardia sta **a monte e non dentro i tre canali**, e la ragione è che a valle
la domanda non si può più porre: dentro `drafts.migrate` non c'è modo di dire
«allora non era un rename» — si potrebbe al più rifiutare *quella* scrittura, e
si otterrebbe una migrazione a metà, con l'icona che ha seguito e la bozza no.
La domanda «è occupata la destinazione?» è **la stessa per i tre canali**, quindi
si fa una volta, nel punto che tutti e tre attraversano.

Ciò che la guardia non può fare da sola è **impedire a un quarto canale di
nascere senza di lei**. Per questo il contratto è anche scritto: la
documentazione di `migrate_side_data` adesso dichiara la precondizione e nomina
chi la garantisce per ciascuna delle tre porte, e il commento di `docdata.rs` che
prometteva un invariante falso adesso nomina la guardia che lo rende vero.

## Il presidio, e il rosso

`crates/fub-kernel/tests/rename_and_events.rs` ·
`una_rinomina_esterna_su_una_nota_viva_non_le_schiaccia_i_dati`, accanto agli
altri banchi del rename esterno. La voce dichiarava **zero** banchi sul caso, e
riverificarlo lo conferma: `sovrascriv|overwrit` nei test del kernel dà sette
file, e nessuno parla di un rename esterno su un'identità occupata — sono il
cestino, il sidecar illeggibile, la fusione di due righe di estratto, la
scrittura atomica.

**Un banco solo per tutti e tre i canali**, ed è una scelta e non una pigrizia:
i tre canali non hanno tre guardie, ne hanno una, quindi tre banchi
proverebbero tre volte la stessa riga. Il banco attacca a `B` un dato per
canale — bozza, icona, spazio per-documento — e li verifica tutti e tre dopo
`mv A.lnk B.lnk`; il giorno che qualcuno togliesse la guardia, ne diventano
rossi tre insieme, il che dice anche *quanti* canali passavano di lì. Il caso
che la voce chiama «quello che perde davvero» — la bozza non salvata — è il
primo `assert`.

Rosso prima, verde dopo: le tre righe stampate sopra sono la corsa in rosso.

## Zone cieche dichiarate

- **La (b) non ha nessun presidio**, e non poteva averne: non c'è un
  comportamento da presidiare finché non è deciso quale. Ciò che c'è è la
  casella residua in `todo.md`, che è l'unica forma in cui questo repo tiene
  ferma una cosa non ancora fatta.
- **Il banco non prova il verso degli avvisi.** La (a) non ne emette — degrada in
  silenzio, come degradava già il ramo accanto — e la voce non lo chiedeva: la
  perdita è impedita, non annunciata. Se un giorno la (b) arriva, l'avviso è la
  prima cosa che porta con sé (`doc_data_warnings` e `organization.warn`
  esistono già).
- **La collisione fra un allegato e un documento non è coperta.** La guardia
  guarda `metas`, cioè i documenti; un allegato in anagrafe ma senza modello
  passa dal ramo di `sync_entry_here` e non ha dati attaccati da perdere — ma è
  una zona che nessuno ha misurato, e la dichiaro invece di sottintenderla.
