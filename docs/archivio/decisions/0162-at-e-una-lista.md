# 0162 — `at` è una lista

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: la casella residua della
[§23.4](../roadmap/23-cosa-costano-le-decisioni-chiuse.md) — *«`note.task.toggle`
su N cursori vuole un `at` che sia una lista, cioè una decisione di firma sua»*
**Commit**: *(questo commit)*

---

## La domanda

La [0093](0093-le-selezioni-sono-n-e-il-buffer-e-uno.md) aveva chiuso la
§23.4 lasciando una casella nominata: *«`note.task.toggle` su N cursori vuole
un `at` che sia una lista, cioè una decisione di firma sua»*. Il comando
spunta un task per posizione, e la domanda è la forma del parametro: uno
scalare, come era nato, o una lista — e che cosa significa non darlo.

## La premessa, rimisurata

- **`at` era un `ParamKind::Number` scalare.** La spec di `note.task.toggle`
  dichiarava `at` come numero singolo (`commands.rs:1059-1060`), e il comando
  leggeva una posizione sola.
- **`ParamKind::Numbers` è in fondo all'enum** (`command.rs:314-337`): *«Più
  numeri: la forma con cui si chiede un'operazione su *queste* posizioni
  (23.4). In fondo all'enum come ogni variante nuova: l'ordine dei casi è il
  discriminante dell'ABI»*. La variante esisteva già — la forma era pronta, e
  la spec non la usava.
- **La spec usa `Numbers`.** `commands.rs:1060` dichiara
  `.with_param(parametro(NOTE_TASK_TOGGLE, "at", ParamKind::Numbers))`, e la
  convalida di `ParamKind::Numbers` accetta solo un array di numeri
  (`command.rs:355-357`): uno scalare è rifiutato **al confine**, prima che il
  comando lo veda.
- **Se `at` è dato: tutti gli offset, dedup, ordine stabile.**
  `commands.rs:1875-1883`: gli offset si mappano in posizioni, poi
  `sort_unstable()` e `dedup()` — l'ordine di spunta è quello crescente, e le
  posizioni ripetute non spuntano due volte.
- **Se `at` è assente: tutte le `placed()` del contesto, non solo la
  primaria.** `commands.rs:1884-1902`: si leggono le selezioni del contesto e
  si prendono **tutte** le ancorate (`placed().all()`), non la primaria — il
  gesto per cui il multi-cursore esiste (FEATURES 4.2, §23.4). Le due strade
  non si mescolano: un `doc` detto e un `at` no sarebbe spuntare in una nota i
  task che stanno sotto i cursori di un'altra.
- **I test lo dicono per nome.** `two_cursors_toggle_two_tasks_without_naming_at`
  e `one_cursor_toggles_one_task_without_naming_at` in `commands_e2e.rs:768,
  808`: due cursori senza `at` spuntano due task, un cursore ne spunta uno —
  *«Un cursore solo produce una lista di lunghezza uno — una `at` di uno»*.
  E lo scalare è rifiutato al confine: `a_position_outside_every_task_is_refused_by_the_command_not_guessed`
  passa `"at": [2]` — una lista — e il rifiuto è `BadArgs` perché la posizione
  non sta in nessun task.

## La decisione

**Ritaglio pre-freeze: `at` è una lista.** Un cursore è una lista di uno; N
cursori sono N. La variante `ParamKind::Numbers` esisteva già in fondo
all'enum — la forma era additiva e non scadeva col freeze — e la spec adesso
la usa. Il significato di assenza è dichiarato: senza `at` si spuntano tutte
le selezioni placed del contesto, che è il gesto per cui il multi-cursore
esiste; con `at` si spuntano esattamente quelle posizioni, in ordine
crescente e senza duplicati. Lo scalare non è accettato: la convalida di
`ParamKind::Numbers` lo rifiuta al confine, e un chiamante che passa un numero
dove la spec dichiara una lista riceve `BadArgs` — non un indovinello.

Il lavoro portato è il fatto scritto dove ci si inciampa: il commento accanto
alla lettura di `at` (`commands.rs:1870-1874`) dice che è una lista, che lo
scalare è rifiutato al confine e che l'assenza spunta tutte le placed; il doc
di `ParamKind::Numbers` dice che è la forma per le operazioni su *queste*
posizioni (23.4); e i due test e2e nominano il gesto per cui la lista esiste.

**Presidio: i due e2e.** `two_cursors_toggle_two_tasks_without_naming_at` e
`one_cursor_toggles_one_task_without_naming_at` provano il caso normale — il
contesto — da entrambi i lati: N cursori, N toggle; un cursore, un toggle.
La convalida al confine è presidiata dal `ParamKind::accepts` che la spec
eredita.

## Le forme scartate

- **Un secondo parametro `ats`** — scartata: due firme per la stessa domanda
  sono la trappola che la
  [0007](0007-contesto-di-sessione.md) descrive per `active_document` — due
  modi di dire la stessa cosa, da tenere allineati per sempre. La 0093 aveva
  già applicato il criterio una volta: *«`selections: list<selection>` accanto
  a `selection` sarebbero due firme per la stessa domanda»*. `at` è la lista,
  e non c'è un `ats`.
- **Lo scalare con la lista in più** — scartata: è la stessa trappola
  dall'altro lato. La convalida di `Numbers` rifiuta lo scalare, e un
  chiamante che passa un numero sbaglia la forma — il confine lo dice, e il
  comando non deve indovinare.

## Cosa resta scoperto

- **La palette che chiede N numeri a mano non esiste.** Il caso normale è il
  contesto: chi ha i cursori non nomina `at`, e chi lo nomina è
  un'automazione o una CLI, che passano una lista. Una UI che chiedesse «quante
  posizioni?» una per una sarebbe un form per un caso che il contesto già
  copre — e resta UI, non contratto.
- **L'ordine di spunta è crescente per costruzione** (`sort_unstable` +
  `dedup`): chi passa `[17, 6]` spunta 6 e poi 17. È una scelta del comando,
  non una promessa del contratto — la spec dichiara una lista, non un ordine.
