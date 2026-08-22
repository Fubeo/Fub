#!/usr/bin/env node
// Orchestratore del controllo dei link della documentazione.
//
// Il motore storico resta in `check-doc-links-core.mjs`: qui si decide **quali
// parti del corpus sono documentazione viva** e quindi devono diventare rosse
// quando un rimando marcisce. I verbali in `docs/decisions/` restano fuori:
// sono fotografie datate. `todo.md`, `roadmap/` e `milestones/` invece
// descrivono lo stato corrente e non possono avere una zona cieca.
// I tre passaggi sono indipendenti e girano sempre tutti: un rosso in `todo.md`
// non deve nascondere un secondo link rotto nella roadmap o nelle milestone.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));
const radice = path.resolve(qui, "../..");
const core = path.join(qui, "check-doc-links-core.mjs");
const docs = path.join(radice, "docs");

function esegui(radiceDaControllare, env = process.env) {
  const esito = spawnSync(process.execPath, [core, radiceDaControllare], {
    cwd: radice,
    env,
    stdio: "inherit",
  });
  if (esito.error) {
    console.error(esito.error.message);
    return 1;
  }
  return esito.status ?? 1;
}

let rosso = 0;

// `todo.md` è escluso per nome nel motore storico. Lo rendiamo visibile senza
// toccare l'indice git reale: una copia temporanea entra in un indice usa-e-getta
// tramite intent-to-add, così `git ls-files` del core la considera tracciata e i
// suoi link mantengono esattamente la stessa base relativa (`docs/`).
const aliasTodo = path.join(docs, "todo.__link-check__.md");
const indice = path.join(os.tmpdir(), `fub-doc-links-${process.pid}.index`);
const envIndice = { ...process.env, GIT_INDEX_FILE: indice };

try {
  fs.copyFileSync(path.join(docs, "todo.md"), aliasTodo);

  const prepara = spawnSync("git", ["read-tree", "HEAD"], {
    cwd: radice,
    env: envIndice,
    stdio: "inherit",
  });
  if (prepara.status !== 0) {
    console.error("impossibile preparare l'indice temporaneo per controllare docs/todo.md");
    rosso = 1;
  } else {
    const aggiungi = spawnSync("git", ["add", "-N", "--", "docs/todo.__link-check__.md"], {
      cwd: radice,
      env: envIndice,
      stdio: "inherit",
    });
    if (aggiungi.status !== 0) {
      console.error("impossibile includere docs/todo.md nel controllo dei link");
      rosso = 1;
    } else if (esegui(radice, envIndice) !== 0) {
      rosso = 1;
    }
  }
} finally {
  try {
    fs.unlinkSync(aliasTodo);
  } catch {
    // Se la copia non è nata, non c'è niente da ripulire.
  }
  try {
    fs.unlinkSync(indice);
  } catch {
    // L'indice temporaneo può non essere stato creato.
  }
}

// Queste cartelle sono escluse quando il core parte dalla radice, perché un
// tempo erano trattate tutte come registri storici. Oggi roadmap e milestone
// sono invece documentazione viva: eseguirle come radice le porta dentro senza
// cambiare la semantica del motore e senza trascinare con loro `decisions/`.
if (esegui(path.join(docs, "roadmap")) !== 0) rosso = 1;
if (esegui(path.join(docs, "milestones")) !== 0) rosso = 1;

process.exit(rosso ? 1 : 0);
