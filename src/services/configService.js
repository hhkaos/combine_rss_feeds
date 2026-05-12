const fs = require('fs');
const path = require('path');

function loadConfig() {
  console.log('Cargando archivos de configuración...');
  try {
    const socialMediaConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config', 'social_media_urls.json'), 'utf8'));
    const ignoreRules = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config', 'ignore_rules.json'), 'utf8'));
    const bannedConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config', 'banned_urls.json'), 'utf8'));

    console.log('Archivos de configuración cargados correctamente');
    return {
      socialMediaConfig,
      ignoreRules,
      bannedConfig,
      curationDecisionsPath: path.join(__dirname, '../../data', 'curation_decisions.jsonl')
    };
  } catch (err) {
    console.error('Error loading configuration files:', err.message);
    throw err;
  }
}

module.exports = {
  loadConfig
}; 
