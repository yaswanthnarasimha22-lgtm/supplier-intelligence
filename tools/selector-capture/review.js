#!/usr/bin/env node
/*
 * review.js — review captured selectors and emit selector-rules.json.
 *
 * Reads every captures/*.jsonl file, groups captures by
 * (supplier, selector), shows the most frequent ones first, and
 * prompts you with a canonical action name.
 *
 * Enter a canonical from the list below (tab-completion is not
 * provided; you type the exact name).  Press Enter on an empty line
 * to skip and NOT include that selector in the rule file.
 *
 * The output is `selector-rules.json` beside this script, ready to
 * drop into the main project as backend/classification/selector-rules.json.
 */

import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = join(__dirname, "captures");
const OUT_PATH = join(__dirname, "selector-rules.json");

const CANONICAL = [
  "booking.create", "booking.cancel", "booking.confirm", "booking.view",
  "booking.modify", "booking.room_selected", "booking.property_selected",
  "search.submit", "search.checkin_selected", "search.checkout_selected",
  "search.destination_selected", "search.occupancy_selected", "search.filter_changed",
  "auth.signin", "auth.signout",
  "payment.initiate",
  "export.download", "export.print",
  "cart.add", "cart.remove",
  "nav.next", "nav.back", "nav.home", "nav.bookings"
];

function urlToPattern(url) {
  try {
    const u = new URL(url);
    // Turn numeric id segments and query ids into wildcards.
    const path = u.pathname
      .replace(/\/\d+/g, "/\\d+")
      .replace(/\/[0-9a-f-]{8,}/gi, "/[0-9a-f-]+");
    return `^${u.origin}${path}`;
  } catch {
    return ".*";
  }
}

async function readAllCaptures() {
  const files = (await readdir(CAPTURES_DIR)).filter(f => f.endsWith(".jsonl"));
  const all = [];
  for (const f of files) {
    const text = await readFile(join(CAPTURES_DIR, f), "utf-8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { all.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  }
  return all;
}

function groupBySupplierAndSelector(captures) {
  const by = {};
  for (const c of captures) {
    const supplier = c.supplier || "unknown";
    by[supplier] ||= new Map();
    const key = c.selector;
    const existing = by[supplier].get(key);
    if (existing) {
      existing.count++;
      if (!existing.urls.has(c.url)) existing.urls.add(c.url);
    } else {
      by[supplier].set(key, { ...c, count: 1, urls: new Set([c.url]) });
    }
  }
  return by;
}

async function main() {
  const captures = await readAllCaptures();
  if (!captures.length) {
    console.log("No captures found in", CAPTURES_DIR);
    console.log("Run `npm run capture` first.");
    return;
  }

  const grouped = groupBySupplierAndSelector(captures);
  const suppliers = Object.keys(grouped).sort();
  console.log(`\nLoaded ${captures.length} captures across ${suppliers.length} supplier(s).`);
  console.log(`Canonical actions:\n  ${CANONICAL.join(", ")}`);
  console.log(`Enter one of those names to tag a selector, or press Enter to skip it.\n`);

  const rl = readline.createInterface({ input, output });

  const rules = {};
  for (const supplier of suppliers) {
    rules[supplier] = [];
    const entries = Array.from(grouped[supplier].values()).sort((a, b) => b.count - a.count);
    console.log(`\n═══ ${supplier}  (${entries.length} unique selectors)  ═══\n`);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      console.log(`[${i + 1}/${entries.length}]  ${e.stability.toUpperCase()}  ${e.count}× fired`);
      console.log(`  label:    "${e.label}"`);
      console.log(`  selector: ${e.selector}`);
      console.log(`  kind:     ${e.selectorKind}`);
      console.log(`  urls:     ${Array.from(e.urls).slice(0, 2).join("  ")}`);
      console.log(`  html:     ${(e.htmlSnippet || "").replace(/\s+/g, " ").slice(0, 160)}`);

      const canonical = (await rl.question("  canonical (or empty to skip)? ")).trim();
      console.log();

      if (!canonical) continue;
      if (!CANONICAL.includes(canonical)) {
        console.log(`  ! "${canonical}" is not in the canonical list; recorded anyway.`);
      }

      rules[supplier].push({
        when: {
          urlPattern: urlToPattern(e.url),
          selector:   e.selector,
          label:      e.label || undefined
        },
        canonical,
        stability: e.stability,
        notes: `Captured ${e.capturedAt}; label "${e.label}"`
      });
    }
  }

  rl.close();

  await writeFile(OUT_PATH, JSON.stringify(rules, null, 2) + "\n");
  console.log(`\n✓ Wrote ${OUT_PATH}`);
  console.log(`Copy this file into the main project as:`);
  console.log(`  backend/classification/selector-rules.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
