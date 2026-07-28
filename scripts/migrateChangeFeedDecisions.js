#!/usr/bin/env node
/**
 * Migración puntual: limpia el estado de curación heredado en los items del
 * feed de cambios monitorizados.
 *
 * Las decisiones manuales se resolvían por `link`, y ese feed repite la misma
 * URL en cada evento, así que un `accepted` de mayo se aplicaba solo por haber
 * aceptado una vez esa página. Ahora la clave incluye el guid.
 *
 * La migración hace dos cosas:
 * 1. Re-clava cada decisión antigua al evento que estaba visible cuando se tomó
 *    (el más reciente de ese link con fecha <= reviewedAt), añadiendo una línea
 *    nueva al jsonl con `id` = `<feed>#<guid>`.
 * 2. Borra las marcas heredadas del resto de eventos para que vuelvan a
 *    aparecer como pendientes de revisión.
 *
 * Uso: node scripts/migrateChangeFeedDecisions.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { loadJsonFeed, saveJsonFeed, loadCurationDecisions, getDecisionId } = require('../src/utils/fileUtils');

const ROOT = path.join(__dirname, '..');
const FEED_PATH = path.join(ROOT, 'feeds', 'arcgis_esri_dev_feed.json');
const DECISIONS_PATH = path.join(ROOT, 'data', 'curation_decisions.jsonl');
const MONITORED_CHANGE_FEED = 'https://rss.rauljimenez.info/arcgis-whats-new-changes.xml';

const dryRun = process.argv.includes('--dry-run');

const decisions = loadCurationDecisions(DECISIONS_PATH);
const feed = loadJsonFeed(FEED_PATH);
const items = feed.items || [];

const changeItems = items.filter(item => (
  item.sourceFeedUrl === MONITORED_CHANGE_FEED && item.guid
));

// Para cada link con decisión antigua, el evento que el usuario tenía delante al
// revisar: el más reciente cuya fecha no supere reviewedAt.
const rekeyed = [];
const rekeyedGuids = new Set();
const linksWithDecision = new Set(changeItems.map(item => getDecisionId(item.link)));

linksWithDecision.forEach(linkId => {
  const decision = decisions.get(linkId);
  if (!decision || !decision.reviewedAt) return;

  const candidate = changeItems
    .filter(item => getDecisionId(item.link) === linkId && item.date <= decision.reviewedAt)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!candidate) return;

  const id = getDecisionId(`${candidate.sourceFeedUrl}#${candidate.guid}`);
  if (decisions.has(id)) return;

  rekeyed.push({
    ...decision,
    id,
    url: candidate.link,
    guid: candidate.guid,
    sourceFeedUrl: candidate.sourceFeedUrl,
    title: candidate.title || decision.title || '',
    notes: [decision.notes, 'Re-keyed from link-based decision.'].filter(Boolean).join(' ')
  });
  rekeyedGuids.add(id);
});

let cleaned = 0;
let kept = 0;

items.forEach(item => {
  if (item.sourceFeedUrl !== MONITORED_CHANGE_FEED || !item.guid) return;
  if (!item.manualStatus) return;

  const key = getDecisionId(`${item.sourceFeedUrl}#${item.guid}`);
  if (decisions.has(key) || rekeyedGuids.has(key)) {
    kept++;
    return;
  }

  console.log(`Limpiando ${item.date} ${item.guid} (${item.manualStatus}) - ${item.title}`);
  item.manualStatus = '';
  item.manualReason = '';
  item.manualNotes = '';
  item.reviewedAt = '';
  cleaned++;
});

console.log(`\nDecisiones re-clavadas a un guid concreto: ${rekeyed.length}`);
console.log(`Items del feed de cambios con decisión heredada limpiada: ${cleaned}`);
console.log(`Items con decisión propia (por guid) conservada: ${kept}`);

if (dryRun) {
  console.log('--dry-run: no se ha escrito nada.');
} else {
  if (rekeyed.length > 0) {
    const jsonl = rekeyed.map(decision => JSON.stringify(decision)).join('\n');
    fs.appendFileSync(DECISIONS_PATH, `${jsonl}\n`, 'utf8');
    console.log(`Añadidas ${rekeyed.length} decisiones a ${DECISIONS_PATH}`);
  }
  if (cleaned > 0) {
    saveJsonFeed(FEED_PATH, feed);
  }
}
