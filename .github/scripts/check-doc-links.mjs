#!/usr/bin/env node
// Esegue il motore dei link sull'intero repository. Gli ADR storici restano
// esclusi dal motore core: descrivono percorsi validi nel momento della
// decisione, mentre le pagine canoniche devono puntare sempre a HEAD.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const qui = path.dirname(fileURLToPath(import.meta.url));
const radice = path.resolve(qui, "../..");
const core = path.join(qui, "check-doc-links-core.mjs");

const esito = spawnSync(process.execPath, [core, radice], {
  cwd: radice,
  stdio: "inherit",
});

if (esito.error) {
  console.error(esito.error.message);
  process.exit(1);
}

process.exit(esito.status ?? 1);
