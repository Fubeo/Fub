// @vitest-environment happy-dom
// Il campo delle azioni `fub://` consentite: una casella per azione, e i nomi
// che questa shell non conosce restano in coda come erano.
import { expect, it } from "vitest";
import type { SettingEntry } from "../host/contract";
import { t } from "../i18n/strings";
import { describeUriAllowed, uriAllowedField } from "./uri-allowed-field";

const entry = (value: string[]) => ({ spec: { key: "uri.allowed" }, value }) as unknown as SettingEntry;

it("una casella per azione, e lo scritto tiene i nomi sconosciuti", () => {
  const writes: Array<[string[], string, boolean]> = [];
  const field = uriAllowedField(entry(["capture", "futura"]), "f", (value, part, checked) => writes.push([value, part, checked]));
  const boxes = [...field.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  expect(boxes.map((box) => [box.id, box.checked])).toEqual([
    ["f-new", false],
    ["f-daily", false],
    ["f-unique", false],
    ["f-capture", true],
  ]);
  boxes[0]!.checked = true;
  boxes[0]!.dispatchEvent(new Event("change"));
  expect(writes).toEqual([[["new", "capture", "futura"], t("incoming.allow.new"), true]]);
  expect(describeUriAllowed(["daily", "futura"])).toBe(`${t("incoming.allow.daily")}, futura`);
});
