const Parser = require('rss-parser');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');
const { XMLValidator } = require('fast-xml-parser');

// Utility to ensure directory exists\ n
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Sanitize text to safely include in CDATA sections
function sanitizeCData(text = '') {
  return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

// Generic function to combine a list of feeds into one output file
async function combineFeeds(feedUrls, options) {
  const { title, description, outputPath, filterLastHours } = options;
  const parser = new Parser();
  let allItems = [];

  for (const url of feedUrls) {
    try {
      const feed = await parser.parseURL(url);
      console.log(`Feed ${url}: ${feed.items.length} items`);
      feed.items.forEach(item => {
        const dateStr = item.isoDate || item.pubDate;
        if (dateStr) {
          const date = new Date(dateStr);
          allItems.push({ ...item, date });
        } else {
          console.error(`Error: Item sin fecha en feed ${url}`);
        }
      });
    } catch (err) {
      console.error(`Error parsing feed ${url}:`, err.message);
    }
  }

  if (filterLastHours) {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - filterLastHours);
    const before = allItems.length;
    allItems = allItems.filter(item => item.date >= cutoff);
    console.log(`Filtered ${before - allItems.length} old items, remaining ${allItems.length}`);
  } else {
    console.log(`Collected ${allItems.length} items`);
  }

  allItems.sort((a, b) => b.date - a.date);
  console.log(`Building feed "${title}" with ${allItems.length} items`);

  const combinedFeed = new RSS({ title, description, pubDate: new Date() });
  let addedItems = 0;
  allItems.forEach(item => {
    try {
      combinedFeed.item({
        title: sanitizeCData(item.title),
        description: sanitizeCData(item.content || item.contentSnippet || item.summary || ''),
        url: item.link,
        guid: sanitizeCData(item.guid || item.id || item.link),
        author: sanitizeCData(item.creator || item.author || ''),
        date: item.date
      });
      addedItems++;
    } catch (err) {
      console.error(`Error al añadir item: ${err.message}`);
    }
  });
  console.log(`Total de items recogidos: ${allItems.length}, items añadidos al feed: ${addedItems}`);

  const xml = combinedFeed.xml({ indent: true });
  try {
    const valid = XMLValidator.validate(xml);
    if (valid === true) {
      console.log('XML es válido');
    } else {
      throw valid;
    }
  } catch (e) {
    console.warn('La validación del XML falló, continuando a escribir el archivo:', e);
  }

  ensureDirSync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, xml, 'utf8');
  console.log(`Feed combinado escrito en ${outputPath}`);
}

// Format current date as DD-MM-YYYY
function getDateString() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

(async () => {
  const dateStr = getDateString();

  const curatedUrls = [
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCo7tc3KZgH4GMUcqcSFBLOQ',
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCd4T7CHv1QlErDtO4PdugMA',
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCZZe1tS_wmHYXNoivPeptYw',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-runtime-sdks-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=esri-leaflet-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-pro-sdk-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-api-for-javascript-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-experience-builder-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-appstudio-blog',
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCgCXcfk5uEraWkpE9wlRwgw',
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCX78SUhrloA6Cn3aW_e8C_A',
    'https://medium.com/feed/geoai',
    'https://feed.podbean.com/theboundingbox/feed.xml',
    'https://community.esri.com/ccqpr47374/rss/boardmessages?board.id=certification-exams',
    'https://odoe.net/rss.xml',
    'https://josiahparry.com/index.xml',
    'https://highearthorbit.com/feed/',
    'https://github.com/esri/developer-support/commits/master.atom',
    'https://www.esri.com/arcgis-blog/products/developers/feed'
  ];
  await combineFeeds(curatedUrls, {
    title: `Combined Curated Feeds (${dateStr})`,
    description: 'Una combinación curada de múltiples feeds RSS (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', `combined_curated_feeds_${dateStr}.xml`),
    filterLastHours: 48
  });

  const googleAlertUrls = [
    'https://www.google.com/alerts/feeds/10211086479352302070/8313662974736823766',
    'https://www.google.com/alerts/feeds/10211086479352302070/18422577937220317856',
    'https://www.google.com/alerts/feeds/10211086479352302070/15069651367870606033'
  ];
  await combineFeeds(googleAlertUrls, {
    title: `Google Alerts: ArcGIS (${dateStr})`,
    description: 'Alertas de Google relacionadas con ArcGIS (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', `google_alerts_arcgis_${dateStr}.xml`),
    filterLastHours: 48
  });

  // Nuevo feed que combina todos los feeds en las últimas 48 horas
  const allUrls = [...curatedUrls, ...googleAlertUrls];
  await combineFeeds(allUrls, {
    title: `ArcGIS ESRI Dev Feed (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', 'arcgis_esri_dev_feed.xml'),
    filterLastHours: 48
  });
})();
  