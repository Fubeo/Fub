# 0136 — Una regola di identità di un nome si dichiara

**Stato**: accolta
**Data**: 2026-08-09
**Chiude**: la [§25.2](../roadmap/25-sette-scelte-che-il-codice-ha-preso-senza-dirlo.md#252-quante-regole-di-identità-di-un-nome-vuole-fub)
— *«Quante regole di identità di un nome vuole Fub»* — nella forma **(a)** che
la voce stessa raccomanda: *«(a), e non (b) adesso»*. Con lei i difetti misurati
**0018**, **0070**, **0093** (tutti e tre **falsi**, e il verbale dice perché
sembravano veri) e **0142** (vero, e riparato qui).
**Commit**: *(questo commit)*

---

## La domanda

Una regola nuova di «quando due nomi sono lo stesso nome» si **dichiara**, o
nasce in silenzio? E se si dichiara, dove — nel contratto, in un conto, o in una
porta?

## La premessa che è caduta, e perché sembrava vera

La voce era nata dal censimento di **quarantaquattro funzioni-regola** in
produzione, e quarantaquattro risposte alla stessa domanda *sembrano* una
duplicazione da unificare. Non lo sono, e a dirlo non è un'opinione: sono
**quattro verbali**.

- La [0020](0020-le-regole-in-un-posto-solo.md): «*Non sono due copie della
  stessa regola: sono due requisiti che **devono** divergere, e una fixture che
  li legasse nascerebbe rossa e resterebbe rossa.*»
- La [0107](0107-il-caso-di-una-lettera.md): «*la domanda non era una: erano
  tre, e adesso hanno tre risposte diverse.*» E la riga «unifichiamo» che quel
  verbale ha ripudiato da `path_policy.rs` è la tesi stessa di questa premessa:
  «*È il tipo di riga peggiore che un modulo possa contenere: dichiara
  **coperto** ciò che non lo è.*»
- La [0058](0058-un-nome-che-nasce.md): «*Un nome che c'è e un nome che nasce
  non si giudicano con la stessa regola*», e fra le cose scartate «*una politica
  sola per leggere e per creare. È la voce letta a metà.*»
- La [0115](0115-la-verita-e-la-dichiarazione.md): «*le tre specie di regola che
  ci convivono sono dichiarate … L'ultima categoria non è un residuo da
  rimpicciolire a tutti i costi.*»

La duplicazione vera non era nelle regole: era nella **dichiarazione mancante**.
Quarantaquattro regole con quarantaquattro ragioni scritte sono un sistema che
ha deciso quarantaquattro volte; quarantaquattro regole con zero ragioni
raccolte in un posto sono un sistema in cui la quarantacinquesima nasce senza
che nessuno lo sappia — ed è ciò che si osserva. La 0115 lo aveva già scritto,
come zona cieca dichiarata: «*il generato, la fixture e il corpus prendono chi
**cambia** una regola, non chi ne **aggiunge** una accanto.*» E la
[0110](0110-la-struttura-non-e-una-preferenza.md) è la prova del danno, col
proprio caso: `IgnorePolicy` confrontava i nomi per uguaglianza di byte **tre
commit dopo** che la 0107 aveva deciso quando due path sono lo stesso path.

## Perché la (a) e non la (b)

La **(b)** era una porta: ogni regola di identità di nome dentro
`fub_abi::rules`, irraggiungibile altrove. È la risposta a una domanda che il
repo ha già chiuso quattro volte con un no, e sarebbe stata la quinta stesura
della riga che la 0107 ha ripudiato. Ha inoltre un costo che non si riprende:
`fub_abi::rules` è **WIT-adiacente**, e ciò che ci sale ci resta — mentre le
regole che dovrebbero salirci sono per metà *volutamente* diverse
(`prefix_len_ci`, la corsia ASCII di `tags.rs`), cioè arriverebbero nel
contratto portandosi dietro le proprie eccezioni.

La prova che decide è la seconda: *il secondo chiamante la eredita gratis?* Ciò
che nessuno eredita non è la porta — è **la dichiarazione**. Chi scrive oggi la
quarantunesima regola non trova niente che gli chieda a quale famiglia
appartenga; con un conto lo trova, e lo trova **senza sapere che questo verbale
esiste**, perché il conto è già rosso quando lui esegue `cargo test`.

## La forma: un banco che cammina, non uno script

Il presidio è `crates/fub-abi/tests/una_regola_di_nome_si_dichiara.rs`, ed è un
banco Rust e non l'undicesimo script di `.github/scripts/`. La ragione è chi lo
vede: chi aggiunge una regola sta scrivendo Rust, e l'attore che gli risponde
nello stesso minuto è `cargo test`; uno script di CI glielo direbbe dopo il
push, cioè dopo che la regola è nata.

Dei due precedenti di forma ha preso quello giusto dei due. Da
`un_lucchetto_solo.rs` viene la **struttura**: un'allowlist con una ragione per
riga, controllata **nei due versi** — chi compare e non è in tabella è rosso,
una riga che non corrisponde più a niente è rossa anche lei, perché
«un'allowlist che resta lunga mentre il codice si accorcia è un ricordo, non una
fotografia». Da `una_sola_tabella_di_escape.rs` viene il **cammino**: ogni `.rs`
sotto una cartella `src/`, ovunque nel repo, senza un elenco di crate scritto a
mano. Qui il cammino conta più che per i lucchetti, e la misura lo dice: le
regole stanno in **sei** crate e ventisei file, dove i lucchetti stavano in due
crate. Un elenco di `include_str!` lungo ventisei righe sarebbe stato la stessa
dimenticanza che il conto cerca, un piano più in su.

## La tassonomia non è inventata: è estratta

La frase della voce che questa decisione ha dovuto rispettare alla lettera è
*«il conto non deve inventare la tassonomia: deve pretenderla»*. Le famiglie non
sono cinque categorie scelte a tavolino: sono i **meccanismi incompatibili** che
il censimento della voce ha già misurato, e il criterio per stare nell'uno o
nell'altro è scritto in due posti che questa decisione non ha aggiunto.

- `crates/fub-kernel/src/occurrences.rs`, sopra `prefix_len_ci`: «*gli offset
  sono il prodotto di questa funzione: `to_lowercase` può cambiare la lunghezza
  in byte di ciò che tocca … e uno span misurato su un testo diverso da quello
  che l'editor ha aperto porterebbe il cursore altrove*» — è il criterio della
  famiglia `CasoPerCarattere`.
- `crates/fub-features/src/tags.rs`, sopra `contiene_a_meno_del_caso`: «*la
  corsia veloce vale solo dove è dimostrabilmente la stessa risposta*» — è il
  criterio della famiglia `CasoAscii`.

Le cinque sono `CasoContestuale` (`str::to_lowercase`, sensibile al contesto: è
la piegatura di `resolution_key`, cioè quella da cui le altre divergono),
`CasoPerCarattere`, `CasoAscii`, `SoloNfc` (normalizza e **non** piega, che è
`exact_key`: «*`resolution_key` dice chi è candidato, `exact_key` dice chi ha
ragione fra i candidati*») e `ConfineDiCartella`.

La colonna *famiglia* non è una decorazione, e a impedirlo c'è un secondo conto:
`la_famiglia_dichiarata_e_quella_che_si_legge` verifica che il **gesto** letto
nel sorgente sia compatibile con la famiglia scritta in tabella. Senza, si
sarebbe potuto scrivere `SoloNfc` accanto a una funzione che piega il caso in
ASCII, e la tabella avrebbe detto il contrario del sorgente restando verde.

Il numero onesto è **quaranta** e non quarantaquattro: il censimento della voce
contava per nome di simbolo comprendendo funzioni che il gesto non lo scrivono
(lo delegano, come `query::in_folder`), e due delle quarantaquattro sono sparite
in questo stesso commit riparando il difetto 0142.

## Il difetto riparato, e il conto che lo tiene fermo

Il **0142** era la duplicazione più letterale del censimento:
`let case_only = from.as_str().to_lowercase() == to.as_str().to_lowercase()`
scritto identico a mano in `rename_document_in_batch` e `rename_entry_in_batch`.
Chiede se due identità differiscono solo per come sono scritte, per sapere se
`vault.exists(to)` sta vedendo un file diverso o **lo stesso** file — e la
risposta a quella domanda è `resolution_key`, non un `to_lowercase()` nudo. Il
`to_lowercase()` rispondeva sì a `nota.md`/`Nota.md` e **no** a `Café.md` in NFC
contro lo stesso nome in NFD, che su APFS sono un file solo: contraddiceva la
regola di risoluzione proprio sul rename che quella regola deve proteggere.
Adesso è `solo_il_caso(from, to)`, una funzione sola che chiama
`resolution_key`, e il presidio non ha più niente da dichiarare lì perché non
c'è più niente da dichiarare.

## I tre difetti falsi, e perché sembravano veri

- **0070** — «`prefix_len_ci` confronta i minuscoli code point per code point e
  sbaglia sulle espansioni (`İ`)». **Falso**: `İ` e `ẞ` sono le risposte
  *giuste* e deliberate. La ragione sta scritta sopra la funzione (gli offset
  sono il suo prodotto), e `same_needle` la ripete al rovescio: «*`İ` e `i̇`
  sono uguali per `to_lowercase` e diversi per `prefix_len_ci`, che è chi decide
  davvero cosa si trova*». Il banco che tiene ferma la metà falsa esisteva già —
  `occurrences.rs::non_si_fonde_ciò_che_chi_cerca_distingue` asserisce
  `due("İ", "i\u{307}")` — ed è la ragione per cui `fub-features/src/tags.rs`
  **cita questo difetto per numero** come motivo di **non** riusare quella
  regola nel filtro dei tag. Sembrava vero perché la divergenza da
  `str::to_lowercase` c'è ed è misurabile: quello che non c'era è che fosse un
  errore.
- **0093** — «`heading_slug` non normalizza in NFC: `# Café` scritto da macOS e
  lo stesso link digitato altrove danno due slug diversi». La premessa è vera —
  ed è il difetto **0140**, che resta aperto e riguarda quattro regole e non
  una. **La conseguenza è falsa**: `heading_matches` è una **disgiunzione**,
  `heading_slug(query) == heading.slug` **oppure**
  `resolution_key(query) == resolution_key(heading.text)`, e il secondo ramo la
  NFC la fa. La risoluzione tiene nei due versi; ciò che si rompe è l'`id=`
  HTML, che di rami ne ha uno solo. Sembrava vero perché la metà misurata era
  giusta e nessuno aveva letto il ramo accanto. Qui il banco che tiene ferma la
  metà falsa **non esisteva** ed è stato scritto:
  `nfd_e_nfc_si_incontrano_sul_testo_e_non_sullo_slug`, che asserisce anche il
  verso vero — su NFD lo slug non diverge soltanto, **cancella** l'accento
  (`Café` → `cafe`), perché `U+0301` è una `Mn` e non è alfanumerica.
- **0018** — «risoluzione dei link rotti: scansione lineare con `resolution_key`
  per voce, per ogni riferimento». **Punta al posto sbagliato**, e il posto
  giusto ha già un numero. Nel ramo `Path` di `resolve_entry_in` la scansione è
  un ripiego che si paga «*solo quando il confronto esatto ha già detto di no —
  cioè su un riferimento che sta per essere dichiarato rotto*», e il commento
  che lo dice sta accanto alla riga. Nel ramo `Wiki`, invece, `resolve_entry_in`
  ritorna `named_entry_in` **incondizionatamente**, cioè paga la scansione
  sempre — ed è il difetto **0115**, che resta aperto e misurato (27,8 ms su 20
  000 voci). Sembrava vero perché la scansione c'è davvero: solo che la riga
  descriveva il ramo che non costa e taceva quello che costa.

## Che cosa la (a) lascia scoperto — dichiarato, non sperato

1. **Non ripara nessuna divergenza.** Il presidio pretende che una regola sia
   dichiarata, non che sia giusta. I difetti **0140** (quattro regole senza NFC)
   e **0141** (tre risposte incompatibili a «sta dentro questa cartella?»)
   restano **aperti**, e le loro righe di allowlist li nominano per numero
   invece di travestirli da ragione — una divergenza dichiarata è più visibile
   di una taciuta, e resta una divergenza. La voce lo diceva: «*i difetti 0115,
   0140, 0141 e 0142 si riparano comunque; ciò che non si ripara è che il quinto
   arriva*».
2. **La shell TypeScript resta fuori.** `frontend/` ha le sue regole di nome e
   nessun attore le lega a queste. È la zona cieca che la 0115 aveva già
   nominata, e questa decisione non l'ha attraversata.
3. **Una regola scritta senza uno dei gesti che il conto legge passa.**
   `MemoryHost::data_list` decide il contenimento con
   `starts_with(prefix + "/")` e non con un trim. La maglia intercetta il gesto
   **comodo**, che è l'unico che qualcuno farà avendo fretta; chi scrive la
   variante lunga sta già pensando. Il caso è costruito e scritto nel banco come
   zona cieca, non scoperto dopo.

## La prova rossa

Il conto è stato acceso due volte, e in tutte e due il verso è quello che
importa. Una **quarantunesima regola finta** in `rules/path.rs`
(`chiave_di_prova`, `s.trim().to_lowercase()`, scritta come la scriverebbe chi
ha fretta) ha stampato:

```
1 regole di identità di un nome sono nate senza che nessuno le dichiarasse:
  crates/fub-abi/src/rules/path.rs::chiave_di_prova  (riga 68, {Caso})
```

E una **famiglia mentita** — `exact_key` dichiarata `CasoAscii` invece di
`SoloNfc` — ha stampato:

```
crates/fub-abi/src/rules/path.rs::exact_key: dichiara CasoAscii (gesto CasoAscii)
ma nel sorgente si legge {Nfc}
```

Il presidio è nato **verde** sul repo com'è: quaranta regole, quaranta righe, e
nessuna riga scaduta.
