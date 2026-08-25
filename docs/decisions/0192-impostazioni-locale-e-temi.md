# 0192 — Impostazioni, locale e temi hanno proprietari e livelli espliciti

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** frontend
- **Sostituisce:** 0036, 0039–0042, 0076, 0084, 0091, 0107–0110, 0131, 0167, 0174–0178
- **Sostituita da:** —

## Contesto

Preferenze macchina, preferenze del vault, stato di vista e manifest di un
plugin non hanno lo stesso lifecycle. Fondere i livelli rende invisibile quale
valore ha vinto. Testi e temi cablati nella shell impediscono ai provider di
presentarsi senza duplicazione.

## Decisione

Ogni impostazione dichiara id, tipo, default, livello e proprietario. Il valore
effettivo conserva la sorgente. I cataloghi di testo appartengono al componente
che produce il messaggio. Il tema usa manifest, token e artefatti generati; la
shell possiede applicazione e accessibilità. Stato di vista resta locale alla
macchina e non diventa un'impostazione del vault.

## Conseguenze

### Positive

- precedenza e persistenza sono leggibili;
- plugin e feature portano le proprie stringhe;
- tema e stato visuale non contaminano il documento;

### Negative

- serve un registro e una risoluzione dei livelli;
- il contratto dei temi deve evitare congelamenti prematuri;
- alcuni fallback devono essere disponibili prima del mount completo;

## Alternative scartate

### Un singolo settings.json globale

Non distingue macchina, vault e proprietario.

### Stringhe nella shell

Un plugin non può localizzare il proprio comportamento.

### CSS arbitrario come contratto

Non definisce compatibilità, token o fallback.

## Verifica

Test di merge, provenienza, locale mancante, manifest tema e artefatti generati
presidiano la decisione. Le scelte ancora aperte restano nell'issue #13.
