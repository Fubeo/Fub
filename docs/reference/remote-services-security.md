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
- Ruoli `Owner > Admin > Writer > Reader`, nel sync e nei siti: chi non è
  Owner concede, toglie o cambia soltanto ruoli sotto il proprio
  (`fub_services::acl::may_grant`, `check_revoke`).
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
