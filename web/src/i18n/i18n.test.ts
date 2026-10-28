import { describe, expect, it } from "vitest";
import en from "./en";
import ko from "./ko";

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const vars = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();

describe("translations", () => {
  const e = flatten(en as unknown as Tree);
  const k = flatten(ko as unknown as Tree);

  it("have the same keys in English and Korean", () => {
    expect(Object.keys(k).sort()).toEqual(Object.keys(e).sort());
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(e)) {
      expect(vars(k[key]), key).toEqual(vars(e[key]));
    }
  });

  it("are not left empty", () => {
    for (const [key, value] of Object.entries(k)) expect(value.trim(), key).not.toBe("");
  });
});
