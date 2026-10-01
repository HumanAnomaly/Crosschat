import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import en from "./locales/en.json" with { type: "json" };

type Dict = Record<string, unknown>;

function localesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "locales");
}

const cache = new Map<string, Dict>([["en", en as Dict]]);

function load(locale: string): Dict {
  const hit = cache.get(locale);
  if (hit) return hit;
  if (locale === "en") return en as Dict;
  const file = path.join(localesDir(), `${locale}.json`);
  if (!fs.existsSync(file)) {
    cache.set(locale, en as Dict);
    return en as Dict;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Dict;
  cache.set(locale, parsed);
  return parsed;
}

function lookup(dict: Dict, key: string): string | null {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Dict)[part];
  }
  return typeof node === "string" ? node : null;
}

export function translate(locale: string, key: string, vars?: Record<string, string | number>): string {
  const text = lookup(load(locale), key) ?? lookup(en as Dict, key) ?? key;
  if (!vars) return text;
  return Object.entries(vars).reduce(
    (out, [name, value]) => out.replaceAll(`{${name}}`, String(value)),
    text,
  );
}
