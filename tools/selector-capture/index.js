#!/usr/bin/env node
/*
 * index.js — capture mode CLI.
 *
 * Usage:
 *   node index.js [targets.json]
 *
 * Opens a Chromium window for each supplier listed in targets.json.
 * You log in and click through the supplier portal as if you were an
 * agent (sign-in → search → book → cancel → view booking → …).  Every
 * click/change/submit is recorded with its best stable CSS selector
 * and appended to captures/<supplier>-<timestamp>.jsonl.
 *
 * Press Enter in this terminal to save and move on to the next
 * supplier; Ctrl+C aborts the whole run (what's captured so far is
 * still saved).
 */

import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = join(__dirname, "captures");

async function main() {
  const targetsArg = process.argv[2] || "targets.json";
  const targetsPath = resolve(process.cwd(), targetsArg);
  const targets = JSON.parse(await readFile(targetsPath, "utf-8"));

  const captureScript = await readFile(join(__dirname, "capture.js"), "utf-8");
  await mkdir(CAPTURES_DIR, { recursive: true });

  console.log(`\nSupplier Intelligence — selector capture`);
  console.log(`Loaded ${targets.length} target(s) from ${targetsPath}\n`);

  const rl = readline.createInterface({ input, output });

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    console.log(`\n═══ (${i + 1}/${targets.length}) ${target.supplier} ═══`);
    console.log(`URL: ${target.url}`);
    console.log(`Browser window is opening — log in and do the agent flow.`);
    console.log(`When finished with this supplier, come back here and press Enter.\n`);

    const browser = await chromium.launch({
      headless: false,
      args: ["--start-maximized"]
    });
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    const captures = [];
    let n = 0;
    await context.exposeFunction("__silRecordCapture", (c) => {
      n++;
      captures.push({
        ...c,
        supplier: target.supplier,
        capturedAt: new Date().toISOString()
      });
      process.stdout.write(`  [${String(n).padStart(3, " ")}] ${c.event.padEnd(6)} ${c.selectorKind.padEnd(16)} "${c.label}"\n`);
    });

    await context.addInitScript(captureScript);

    try {
      await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (err) {
      console.warn(`  warn: navigation to ${target.url} failed — ${err.message}`);
      console.warn(`  the browser is still open; navigate manually if needed.`);
    }

    await rl.question("");

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = join(CAPTURES_DIR, `${target.supplier}-${stamp}.jsonl`);
    await writeFile(outPath, captures.map(c => JSON.stringify(c)).join("\n") + (captures.length ? "\n" : ""));
    console.log(`  Saved ${captures.length} captures → ${outPath}`);

    await browser.close().catch(() => {});
  }

  rl.close();
  console.log(`\n✓ All suppliers captured.`);
  console.log(`Next: node review.js  →  produces selector-rules.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
