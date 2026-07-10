#!/usr/bin/env node
/**
 * Normaliza el campo `reason` de data/curation_decisions.jsonl a los códigos
 * canónicos definidos en config/review_reasons.json.
 *
 * Usa el mapa `aliases` de cada razón (etiqueta antigua / texto libre -> código).
 * Las razones que no aparezcan como alias ni como código canónico se dejan
 * intactas (p. ej. razones de aceptación como `activity_sheet_match`).
 *
 * Uso:
 *   node scripts/normalizeReasons.js            # aplica cambios
 *   node scripts/normalizeReasons.js --dry-run  # solo muestra qué cambiaría
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REASONS_PATH = path.join(ROOT, 'config', 'review_reasons.json');
const DECISIONS_PATH = path.join(ROOT, 'data', 'curation_decisions.jsonl');
const DRY_RUN = process.argv.includes('--dry-run');

function buildAliasMap(reasonsConfig) {
  const map = new Map();
  for (const group of reasonsConfig.groups) {
    for (const reason of group.reasons) {
      map.set(reason.code, reason.code); // el código canónico se mapea a sí mismo
      for (const alias of reason.aliases || []) {
        map.set(alias, reason.code);
        map.set(alias.toLowerCase(), reason.code);
      }
    }
  }
  return map;
}

function main() {
  const reasonsConfig = JSON.parse(fs.readFileSync(REASONS_PATH, 'utf8'));
  const aliasMap = buildAliasMap(reasonsConfig);

  const lines = fs.readFileSync(DECISIONS_PATH, 'utf8').split('\n');
  const changes = new Map();
  let untouched = 0;

  const outLines = lines.map(line => {
    if (!line.trim()) return line;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return line; // no tocar líneas no-JSON
    }
    const original = obj.reason;
    if (typeof original !== 'string' || !original) return line;

    const canonical = aliasMap.get(original) || aliasMap.get(original.toLowerCase());
    if (canonical && canonical !== original) {
      changes.set(`${original} -> ${canonical}`, (changes.get(`${original} -> ${canonical}`) || 0) + 1);
      obj.reason = canonical;
      return JSON.stringify(obj);
    }
    untouched++;
    return line;
  });

  const totalChanged = [...changes.values()].reduce((a, b) => a + b, 0);
  console.log(`Líneas revisadas: ${lines.filter(l => l.trim()).length}`);
  console.log(`Normalizadas: ${totalChanged} | sin cambios: ${untouched}`);
  if (changes.size) {
    console.log('\nMapeos aplicados:');
    for (const [k, v] of [...changes.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v.toString().padStart(4)}  ${k}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] no se escribió nada.');
    return;
  }
  if (totalChanged > 0) {
    fs.writeFileSync(DECISIONS_PATH, outLines.join('\n'));
    console.log(`\nEscrito ${DECISIONS_PATH}`);
  } else {
    console.log('\nNada que escribir.');
  }
}

main();
