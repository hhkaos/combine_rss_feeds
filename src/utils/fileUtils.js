const fs = require('fs');
const path = require('path');

// Utility to ensure directory exists
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Load existing JSON feed if it exists
function loadJsonFeed(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`Error loading JSON feed: ${err.message}`);
  }
  return { items: [] };
}

// Save JSON feed
function saveJsonFeed(filePath, data) {
  try {
    ensureDirSync(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`JSON feed saved to ${filePath}`);
  } catch (err) {
    console.error(`Error saving JSON feed: ${err.message}`);
  }
}

function getDecisionId(url) {
  return String(url || '').trim().toLowerCase();
}

function loadCurationDecisions(filePath) {
  const decisions = new Map();

  try {
    if (!fs.existsSync(filePath)) {
      return decisions;
    }

    const lines = fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.trim());

    lines.forEach((line, index) => {
      try {
        const decision = JSON.parse(line);
        const id = getDecisionId(decision.url || decision.id);
        if (id) {
          decisions.set(id, decision);
        }
      } catch (err) {
        console.warn(`Invalid curation decision on line ${index + 1}: ${err.message}`);
      }
    });
  } catch (err) {
    console.error(`Error loading curation decisions: ${err.message}`);
  }

  return decisions;
}

// Format current date as DD-MM-YYYY
function getDateString() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

module.exports = {
  ensureDirSync,
  loadJsonFeed,
  loadCurationDecisions,
  getDecisionId,
  saveJsonFeed,
  getDateString
}; 
