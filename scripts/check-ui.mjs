#!/usr/bin/env node

/**
 * scripts/check-ui.mjs
 *
 * Enforces architectural UI rules for the new design system:
 * a) zero "!important" in src/styles/ and src/ui/
 * b) zero global class selectors in *.module.css (only :global for [data-theme])
 * c) globals.css "!important" count must not increase vs main (baseline 4,165)
 * d) no hex colors in src/ui/ — only var(--token)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const BASELINE_GLOBALS_IMPORTANT = 4165;
let hasErrors = false;

function getAllFiles(dir, exts = []) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, exts));
    } else {
      if (exts.length === 0 || exts.some((ext) => fullPath.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

console.log("=== Checking Kestrel UI Rules ===");

// Check a: zero !important in src/styles/ and src/ui/
console.log("\n[Rule A] Check zero '!important' in src/styles/ and src/ui/...");
const stylesFiles = getAllFiles(path.join(rootDir, "src/styles"), [".css"]);
const uiFiles = getAllFiles(path.join(rootDir, "src/ui"), [".css", ".tsx", ".ts"]);
const targetFilesA = [...stylesFiles, ...uiFiles];

let importantViolationsA = 0;
for (const file of targetFilesA) {
  const content = fs.readFileSync(file, "utf8");
  // Clean comments before checking for !important declarations
  const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  const matches = cleanContent.match(/!important/g);
  if (matches) {
    console.error(`  FAIL: ${path.relative(rootDir, file)} contains ${matches.length} '!important'`);
    importantViolationsA += matches.length;
    hasErrors = true;
  }
}
if (importantViolationsA === 0) {
  console.log("  PASS: 0 '!important' found in src/styles/ and src/ui/.");
}

// Check b: zero global class selectors in *.module.css (only :global for [data-theme])
console.log("\n[Rule B] Check zero global class selectors in *.module.css (only :global for [data-theme])...");
const moduleCssFiles = getAllFiles(path.join(rootDir, "src/ui"), [".module.css"]);
let globalViolationsB = 0;

for (const file of moduleCssFiles) {
  const content = fs.readFileSync(file, "utf8");
  // Check any :global usage
  const globalMatches = content.match(/:global(?:\(([^)]*)\))?/g) || [];
  for (const g of globalMatches) {
    if (!g.includes('[data-theme="') && !g.includes("[data-theme='") && !g.includes("[data-theme]")) {
      console.error(`  FAIL: ${path.relative(rootDir, file)} contains invalid :global selector: "${g}" (only :global([data-theme="..."]) permitted)`);
      globalViolationsB++;
      hasErrors = true;
    }
  }
}
if (globalViolationsB === 0) {
  console.log("  PASS: 0 forbidden global selectors in *.module.css.");
}

// Check c: globals.css "!important" count must not increase vs main (4165)
console.log("\n[Rule C] Check globals.css '!important' count vs baseline...");
const globalsCssPath = path.join(rootDir, "src/app/globals.css");
if (fs.existsSync(globalsCssPath)) {
  const globalsContent = fs.readFileSync(globalsCssPath, "utf8");
  const currentImportantCount = (globalsContent.match(/!important/g) || []).length;
  console.log(`  globals.css !important count: ${currentImportantCount} (baseline main: ${BASELINE_GLOBALS_IMPORTANT})`);
  if (currentImportantCount > BASELINE_GLOBALS_IMPORTANT) {
    console.error(`  FAIL: globals.css '!important' increased by ${currentImportantCount - BASELINE_GLOBALS_IMPORTANT}!`);
    hasErrors = true;
  } else {
    console.log("  PASS: globals.css '!important' count did not increase.");
  }
} else {
  console.log("  WARN: src/app/globals.css not found.");
}

// Check d: no hex colors in src/ui/ — only var(--token)
console.log("\n[Rule D] Check no hex colors in src/ui/ (only var(--token))...");
const uiAllFiles = getAllFiles(path.join(rootDir, "src/ui"), [".css", ".tsx", ".ts"]);
let hexViolationsD = 0;

// Hex color regex: # followed by 3, 4, 6, or 8 hex digits, bounded by word/symbol boundaries
const hexRegex = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

for (const file of uiAllFiles) {
  const content = fs.readFileSync(file, "utf8");
  // Ignore comments if any
  const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  const matches = cleanContent.match(hexRegex);
  if (matches) {
    console.error(`  FAIL: ${path.relative(rootDir, file)} contains hardcoded hex colors: ${matches.join(", ")}`);
    hexViolationsD += matches.length;
    hasErrors = true;
  }
}
if (hexViolationsD === 0) {
  console.log("  PASS: 0 hex colors in src/ui/.");
}

console.log("\n==================================");
if (hasErrors) {
  console.error("UI CHECK FAILED.");
  process.exit(1);
} else {
  console.log("ALL UI CHECKS PASSED (4/4).");
  process.exit(0);
}
