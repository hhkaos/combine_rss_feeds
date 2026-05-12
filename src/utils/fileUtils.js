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
  saveJsonFeed,
  getDateString
}; 