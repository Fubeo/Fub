# Sicurezza dei servizi remoti

> **Ambito:** chiavi del vault sincronizzato, ruoli, login e quote dei
> servizi di sync e pubblicazione.
> **Fonti autorevoli:** `fub-services` e `fub_host::remote`.

Il resto del modello di sicurezza (capability, confini del vault, runtime
WASM, contenuto non fidato) è in [Permessi e sicurezza](permissions-and-security.md).

- La chiave del vault (VDK, 32 byte casuali) viaggia avvolta da una KEK
  derivata dalla passphrase del vault con PBKDF2-HMAC-SHA256: le buste e le
  password degli account nuove usano `ver=2`, 600.000 iterazioni; quelle di
  `ver=1`, 210.000, si riaprono ancora. Ogni altra coppia di versione e
  iterazioni si rifiuta dentro la derivazione stessa, per ogni chiamante, e
  nessuna derivazione supera 1.000.000 di iterazioni
  (`fub_services::crypto::derive_kek`, `fub_host::remote::derive_vault_kek`).
- Transizione dei parametri: il server accetta, al caricamento della chiave
  e all'invito, ogni coppia che conosce (`ver=1`/210.000 e `ver=2`/600.000),
  così client vecchi e nuovi parlano allo stesso server; una coppia
  sconosciuta è `400 unsupported wrap version`. Un client che riceve quel
  rifiuto, o quelli dei server di prima (`stale wrap version`,
  `bad wrap version`, `bad wrap iterations`), mostra un errore tipizzato
  (`BadArgs` con `host.sync.kdf_unsupported`) che chiede di aggiornare Fub o
  il server; non è un'assenza di rete e non si ritenta.
- Epoca della chiave: la prima chiave di un vault ha epoca 1
  (`fub_services::sync::INITIAL_KEY_EPOCH`, con il mirror
  `fub_host::remote::INITIAL_KEY_EPOCH`); ogni rekey la alza di uno. Il
  server rifiuta una prima chiave con un'altra epoca (`409`) e ogni op
  sigillato con un'epoca diversa da quella corrente. Sul dispositivo, zero
  nel file `key-epoch` vuol dire «nessuna chiave adottata»: il client salva
  l'epoca restituita prima di sigillare. Un dispositivo a zero che trova il
  vault all'epoca 1 la adotta, se la chiave si apre con la sua passphrase, e
  risigilla la coda già scritta con la stessa chiave (stessi `op_id` e
  vettori); una coda che quella chiave non apre resta intatta, con un
  `Conflict` che chiede il recupero. Ogni altra differenza di epoca chiede un
  invito nuovo.
- La chiave accettata con un invito (`accepted-key.json`) è legata alla sua
  epoca e vale solo per quella. Al rekey, e quando il client crea la chiave
  da capo, esce dal passaggio e resta come `prior-accepted-key-<epoca>.json`,
  accanto a `prior-key-<epoca>.json`, per riaprire le versioni storiche.
- Ruoli `Owner > Admin > Writer > Reader`, nel sync e nei siti: chi non è
  Owner concede, toglie o cambia soltanto ruoli sotto il proprio
  (`fub_services::acl::may_grant`, `check_revoke`).
- Pubblicare un sito non cambia il ruolo: il grant `Owner` sul sito va
  soltanto a chi lo crea con il primo commit o ne è già il proprietario. Un
  `Writer` che pubblica resta `Writer` e non amministra il sito (niente
  ritiro, password, dominio o revoche: `403`)
  (`fub_services::publish::finish_commit`).
- Commit di pubblicazione e richieste sync controllano il token prima di
  leggere il corpo o prendere il lock del sito o del vault: senza una
  sessione valida la risposta è sempre `401`. Il controllo del custom JS
  (`422` senza isolamento) arriva soltanto dopo l'autorizzazione a
  pubblicare, con un `site_id` valido: chi non può pubblicare non scopre come
  è configurato un sito (`fub_services::site_isolation::preflight_commit`).
- Login con password (`fub_services::mfa::LoginLimits`): 5 fallimenti in 5
  minuti bloccano quel nome da quell'origine, 20 fallimenti di un'origine su
  nomi qualunque bloccano l'origine, 50 fallimenti di un nome da tutte le
  origini bloccano il nome, ma non dalle origini dove l'account è entrato
  negli ultimi 30 giorni. Chi sbaglia la password da altrove non chiude fuori
  il titolare. L'origine è quella del limite per origine (peer TCP, o client
  dichiarato da un proxy in `trusted_proxies`); i limiti vivono in memoria e
  ripartono a ogni avvio.
- Le quote di `services.json` (`ServiceQuotas`) sono tetti veri: 0 vuol dire
  «niente», mai «senza limite». Con `max_vault_bytes: 0` il vault non tiene
  né push né allegati (`413 vault quota exceeded`), come un sito pubblicato
  con lo stesso tetto.
