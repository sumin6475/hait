import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import type { ZodTypeAny, z } from "zod";

// Per CLAUDE.md §4.1, §14.4. YAML I/O always goes through Zod for parse
// and write. Strict-mode schemas reject unknown keys.

export function readYaml<S extends ZodTypeAny>(
  relativeOrAbsPath: string,
  schema: S,
): z.infer<S> {
  const path = resolve(process.cwd(), relativeOrAbsPath);
  const raw = readFileSync(path, "utf8");
  const parsed = yaml.load(raw);
  return schema.parse(parsed);
}

export function writeYaml(
  relativeOrAbsPath: string,
  data: unknown,
  header?: string,
): void {
  const path = resolve(process.cwd(), relativeOrAbsPath);
  mkdirSync(dirname(path), { recursive: true });
  const body = yaml.dump(data, { lineWidth: 100, noRefs: true, sortKeys: false });
  const content = header ? `${header}\n${body}` : body;
  writeFileSync(path, content, "utf8");
}
