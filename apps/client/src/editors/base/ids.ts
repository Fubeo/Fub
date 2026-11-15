// I nomi della Base che servono a chi la registra prima di caricarla: il
// proprietario, il profilo e il formato della superficie, lo spazio della
// query e quello della resa incorporata. Stanno da soli perché la shell li
// importa all'avvio, mentre la superficie, la barra e i dati arrivano col
// primo `.base` aperto (`registration` in `editors/core/bootstrap.ts`,
// `renderer.ts`).

export const BASE_OWNER = "fub.shell.base";
export const BASE_PROFILE = "base";
export const BASE_FORMAT = "base";
export const BASE_FAMILY = "structured" as const;
export const BASE_QUERY_NS = "fub.base";
export const BASE_RENDERER_NS = "fub:base";
