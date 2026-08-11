# 0145 — Gli eseguibili restano; a calare è quanto pesa un link

**Stato**: accolta **Data**: 2026-08-11 **Chiude**: §28.1 **Commit**: *(questo
commit)*

---

## La domanda

La [§28.1](../roadmap/28-centoventuno-eseguibili-per-provare-una-riga.md)
chiedeva: **quanti eseguibili vogliamo davvero, e quali test hanno bisogno di un
processo tutto loro?** La misura che l'ha aperta aveva cronometrato quattro
minuti e dieci fra una riga cambiata nel kernel e il primo test che parte, e
aveva attribuito quel tempo al **numero** dei file in `tests/` — uno per
eseguibile, e ognuno linka l'intero albero.

## La decisione

**Gli eseguibili restano uno per file di prova. A calare è quanto pesa un
link.** Il manifest di workspace dichiara

```toml
[profile.dev]
opt-level = 0
split-debuginfo = "unpacked"
```

e la seconda riga è la decisione: l'informazione di debug resta nei `.o` invece
di essere ricopiata dentro ogni eseguibile. **Non se ne perde un byte** — i `.o`
stanno accanto ai binari in `target/` e un backtrace continua a stampare file e
riga — e nessuno paga niente per averla.

Il presidio è `.github/scripts/check-profilo-dev.mjs`, in CI accanto alle due
righe di manifest della stessa famiglia (`check-crate-type.mjs`, il difetto
`0229`; `check-cargo-feature-default.mjs`, la
[0129](0129-una-feature-spenta-per-difetto-non-e-provata.md)). Sorveglia `[profile.dev]`
chiave per chiave: una chiave in meno è una decisione disfatta in silenzio, una
chiave in più è una decisione presa senza che nessuno l'abbia scritta. Verificato
rosso in tutti e due i versi.

## La premessa caduta, e perché sembrava vera

**Il costo non era il numero degli eseguibili: era il peso di ognuno**, e il peso
non l'aveva scelto nessuno.

Sembrava vera per un motivo onesto: il numero è l'unica delle due grandezze che
si vede. Sono centoventotto file oggi (`fub-kernel` 54, `fub-features` 28,
`fub-host` 19, `fub-format-markdown` 12, `fub-abi` 11, `fub-app` 3, `fub-sdk` 1),
la mediana di un binario era 61 MB, e mentre si aspetta cargo stampa una riga per
eseguibile: il totale e il conteggio salgono insieme sotto gli occhi. Il terzo
fattore — quanto costa **un** link — non compare da nessuna parte, e nessuno
l'aveva misurato: era il default di cargo, cioè copiare tutto il DWARF dentro
l'eseguibile.

Misurato oggi, sulla stessa macchina a quattro core e con lo stesso protocollo
(build piena, poi `touch crates/fub-kernel/src/lib.rs`, poi
`cargo test --no-run --workspace`):

| | mediana di un eseguibile | i centotrentasette insieme | il giro dopo un `touch` |
|---|---|---|---|
| com'era | 62,4 MB | 13,8 GB | 189,8 s |
| con `unpacked` | **25,6 MB** | **4,94 GB** | **119,0 s** |

I secondi sono il numero meno affidabile dei tre, e per la ragione della
[0113](0113-il-banco-conta-le-operazioni.md): il tempo su una macchina condivisa
non è un segnale. Le due colonne che decidono sono le altre, perché sono un
conto: **il linker scrive quasi nove gigabyte in meno a ogni passata completa**,
e li scrive in meno per ognuno dei centotrentasette eseguibili — cioè per ogni
file di prova che il resto della roadmap aggiungerà, senza che nessuno debba
ricordarsene.

## Cosa si è scartato, e chi paga

**(a) Un eseguibile per crate, i file di oggi come moduli.** Il guadagno ha un
tetto misurabile, ed è la parte più utile di questa misura. Con `--timings`, dopo
un `touch` del kernel, cargo ricostruisce 130 unità: **123 sono bersagli di prova
e valgono 212,2 s di CPU**, tutto il resto — librerie, binario, esempi — sono 7
unità per 20,8 s. Ma la distribuzione dei 212 s dice il resto: **mediana 0,77 s**,
massimo 14,53 s, e **tredici bersagli su centoventitré portano metà della CPU**.
Il costo fisso per eseguibile — quello che la consolidazione toglierebbe — è
grosso modo la mediana: centoventitré meno sei, per meno di un secondo l'uno.
L'altra metà è codegen del codice di prova, che consolidare non toglie: lo
sposta.

Contro quel tetto, il prezzo. I sei passi `cargo test -p … --test <nome>` di
`ci.yml` — `wit_conformance`, `wit_additivity`, `dependency_invariant`,
`ts_enums`, `le_cargo_feature`, `i_moduli_non_si_parlano` — diventerebbero filtri
per nome di test, e un filtro sbagliato passa in silenzio dove un `--test`
sbagliato è un errore. Ma il prezzo vero è un altro, e lo paga chi scriverà i
test: **nasce una regola nuova, permanente, sul gesto più frequente del repo.**
Oggi un file di prova nuovo si crea e basta, e il suo processo tutto suo se lo
prende senza chiederlo. Dopo, ogni file nuovo va aggiunto a un elenco di `mod` —
e **un `mod` dimenticato è un file che compila e non gira mai**, cioè un presidio
verde perché non aggancia, che è il modo in cui questo repo perde le cose — e va
prima esaminato per stato globale al processo, perché in un binario solo i test
girano su thread dello stesso processo.

Quest'ultimo esame è più largo di come la voce lo descriveva. La voce nominava
**un** file, `crates/fub-kernel/tests/la_radice_non_si_muove.rs`, per il suo
`set_current_dir`. Cercando la specie invece del simbolo, i file con stato
globale al processo oggi sono **cinque**: quello, e i quattro che installano un
`panic::set_hook` — `crates/fub-kernel/tests/il_panico.rs`,
`crates/fub-kernel/tests/batch_and_origin.rs`,
`crates/fub-host/tests/un_lucchetto_solo.rs`,
`crates/fub-features/tests/annullare.rs`. Nessuno dei quattro si trova col
`grep` che la voce propone, e il quinto che nascerà non si troverà con nessun
`grep` scritto oggi.

È qui che (a) cade sulla seconda prova della barra — *il secondo chiamante la
eredita gratis?* No: la eredita come un obbligo, uno per file, per sempre. La
riga di profilo invece la eredita davvero gratis, e la eredita anche il
centoventinovesimo file di prova senza che nessuno gliela dica.

**(b) Consolidare solo `fub-kernel` e `fub-features`.** Metà del tetto di (a), lo
stesso obbligo permanente sui due crate dove i file di prova nascono più spesso,
e in più due convenzioni da spiegare. Paga chi legge il repo, e paga di nuovo chi
scrive i test.

**(c) Com'è oggi.** È stato scartato: `[profile.dev]` non era «com'è oggi», era
un default che nessuno aveva guardato.

**(d) Cambiare linker.** Valutata e non presa, perché è già presa da sé e non da
noi: `rustc --print link-args` su questa macchina (1.97.1) dice `-fuse-ld=lld`, e
`readelf -p .comment` sul binario conferma `Linker: LLD`. I 189,8 s del prima
erano quindi **già** col linker veloce, il che restringe ancora il tetto di (a).
La CI monta la toolchain 1.89, dove lld non è ancora il predefinito: è una
differenza fra le due macchine, non una decisione di questo verbale.

## Cosa resta scoperto

**Nessuna casella**: la decisione è attuata per intero in questo commit — la
riga, il presidio, il passo di CI.

Due cose restano scritte apposta perché nessuno le riapra come se fossero lavoro.

* **Il prezzo, dichiarato: l'informazione di debug segue `target/`.** Un eseguibile
  copiato fuori da lì resta senza. Per dei binari di prova e per l'app in
  sviluppo non lo paga nessuno, e per il profilo `release` non vale — `release`
  questa riga non ce l'ha, e non la avrà per la stessa ragione.
* **Dove guardare se un giorno l'attesa torna a farsi sentire**, e non è una
  domanda strutturale: **tredici bersagli su centoventitré portano metà della
  CPU** (`i_moduli_non_si_parlano` e `la_foglia_senza_contesto_costa_di_piu` 14,5
  s l'uno, `le_sveglie` 12,8, `la_radice_non_si_muove` 12,7, l'esempio
  `una_ricerca` 10,0, `search_e2e` 9,7, `i_cataloghi` 7,8). È una misura mirata su
  tredici file, non una riorganizzazione di centoventotto.

La divisione dei banchi per **soggetto** — la
[0054](0054-il-banco-del-lato-provider.md) e la
[0055](0055-il-banco-del-lato-host.md) — non è stata toccata e non era in
discussione: questo verbale non tocca né un test, né un'asserzione, né un nome di
test, né un `--test` di `ci.yml`.
