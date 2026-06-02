import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// Per CLAUDE.md §3.4, §14: Hangul codepoints are forbidden in any committed
// artifact outside docs/_kor_reference/ (which is gitignored).

const ROOT = resolve(import.meta.dirname, "..");
// Constructed from escape codes so this test file itself does not contain Hangul.
const HANGUL_RANGE = new RegExp("[\\uAC00-\\uD7A3]");

// Directories we own and lint. Anything else (node_modules, cache, etc.)
// is out of scope or has its own provenance.
const SCAN_DIRS = ["config", "core_prompts", "knowledge_base", "src", "scripts", "tests"];
const SCAN_FILE_EXTS = new Set([".ts", ".js", ".yaml", ".yml", ".json", ".md"]);
const SCAN_ROOT_FILES = ["CLAUDE.md", "README.md"];

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

function collectScanTargets(): string[] {
  const files: string[] = [];
  for (const d of SCAN_DIRS) {
    for (const f of walk(join(ROOT, d))) {
      const ext = f.slice(f.lastIndexOf("."));
      if (SCAN_FILE_EXTS.has(ext)) files.push(f);
    }
  }
  for (const f of SCAN_ROOT_FILES) {
    try {
      statSync(join(ROOT, f));
      files.push(join(ROOT, f));
    } catch {
      // optional
    }
  }
  return files;
}

describe("Hangul lint", () => {
  // CLAUDE.md itself is allowed to contain Hangul (it does not), so we still
  // scan it. If a future edit introduces Hangul there, that is also a bug.
  it("no committed artifact contains Hangul codepoints (U+AC00 – U+D7A3)", () => {
    const offenders: { file: string; line: number; snippet: string }[] = [];
    for (const f of collectScanTargets()) {
      const text = readFileSync(f, "utf8");
      if (!HANGUL_RANGE.test(text)) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (HANGUL_RANGE.test(line)) {
          offenders.push({
            file: relative(ROOT, f),
            line: i + 1,
            snippet: line.trim().slice(0, 120),
          });
        }
      }
    }
    expect(offenders, "Hangul found in committed artifacts").toEqual([]);
  });
});
