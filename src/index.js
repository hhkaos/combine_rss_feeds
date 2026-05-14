const path = require('path');
const fs = require('fs');
const { getDateString } = require('./utils/fileUtils');
const { loadConfig } = require('./services/configService');
const FeedService = require('./services/feedService');

async function main() {
  const dateStr = getDateString();

  const curatedUrls = [
    // Youtube channels
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCgCXcfk5uEraWkpE9wlRwgw', // Esri Developers
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCo7tc3KZgH4GMUcqcSFBLOQ', // Rene Rubalcava
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCd4T7CHv1QlErDtO4PdugMA', // Andrew's GIS & Technology Lessons (Andrew Chapkowski)
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCZZe1tS_wmHYXNoivPeptYw', // Courtney Yatteau
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCVZorTG1_ePfR2Y0ThjMZ2w', // GeoAI Smith (Rami Alouta)
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCX78SUhrloA6Cn3aW_e8C_A', // Josiah Parry
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCOpTBxNvPEe5mHLrdDWdhkQ', // Sean Stone

    // ArcGIS Blog
    'https://www.esri.com/arcgis-blog/products/developers/feed',
    'https://www.esri.com/arcgis-blog/products/experience-builder/feed',
    'https://www.esri.com/arcgis-blog/products/api-python/feed',
    'https://www.esri.com/arcgis-blog/products/arcgis-pro-net/feed',
    'https://www.esri.com/arcgis-blog/products/sdk-net/feed',
    'https://www.esri.com/arcgis-blog/products/sdk-flutter/feed',
    'https://www.esri.com/arcgis-blog/products/sdk-kotlin/feed',
    'https://www.esri.com/arcgis-blog/products/sdk-swift/feed',
    'https://www.esri.com/arcgis-blog/products/unity/feed',
    'https://www.esri.com/arcgis-blog/products/unreal-engine/feed',
    'https://www.esri.com/arcgis-blog/category/developers/feed',
    'https://www.esri.com/arcgis-blog/category/arcade/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-location-services/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-data/feed',
    'https://www.esri.com/arcgis-blog/tag/batch-geocoding/feed',
    'https://www.esri.com/arcgis-blog/tag/elevation-service/feed',
    'https://www.esri.com/arcgis-blog/tag/geoenrichment-service/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-vector-tile-style-editor/feed',
    'https://www.esri.com/arcgis-blog/tag/living-atlas-of-the-world/feed',
    'https://www.esri.com/arcgis-blog/tag/basemap-styles/feed',
    'https://www.esri.com/arcgis-blog/tag/basemap-styles-service/feed',
    'https://www.esri.com/arcgis-blog/tag/vector-basemaps/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-geocoding-service/feed',
    'https://www.esri.com/arcgis-blog/tag/geocoding/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-places-service/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-geoenrichment-service/feed',
    'https://www.esri.com/arcgis-blog/tag/arcgis-places/feed',
    'https://www.esri.com/arcgis-blog/products/api-rest/feed',
    'https://www.esri.com/arcgis-blog/tag/calcite-design-system/feed',
    'https://www.esri.com/arcgis-blog/tag/api-for-python/feed',
    'https://www.esri.com/arcgis-blog/tag/python-scripts/feed',
    'https://www.esri.com/arcgis-blog/tag/devsummit/feed',
    'https://www.esri.com/arcgis-blog/tag/developer-summit/feed',
    'https://www.esri.com/arcgis-blog/tag/web-development/feed',
    'https://www.esri.com/arcgis-blog/tag/arcpy/feed',
    'https://www.esri.com/arcgis-blog/feed/?post_type=blog&product=developers',

    // Other Esri Blogs
    'https://www.esri.com/en-us/software-engineering/blog/feed?post_type=blog',
    'https://www.esri.com/about/newsroom/category/esri-technology/developer-technology/arcgis-maps-sdk-for-javascript-developer-technology/feed',
    'https://www.esri.com/about/newsroom/category/esri-events/esri-developer-summit/feed',
    'https://medium.com/feed/geoai',

    // Some Esri repositories (coomits)
    'https://github.com/esri/developer-support/commits/master.atom',
    'https://github.com/Esri/jsapi-resources/commits.atom',
    'https://github.com/EsriJapan/arcgis-dev-resources/commits.atom',
    'https://github.com/Esri/arcpy/commits.atom',
    'https://github.com/esrips/gen-ai-toolkit/commits.atom',

    // Some Esri repositories (releases)
    'https://github.com/Esri/esri-leaflet/releases.atom',
    'https://github.com/Esri/arcgis-rest-js/releases.atom',
    'https://github.com/Esri/maplibre-arcgis/releases.atom',

    // Blogs at Esri Community
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-runtime-sdks-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=esri-leaflet-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-pro-sdk-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-api-for-javascript-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-experience-builder-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-appstudio-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=geodev-germany-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=python-blog',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=arcgis-rest-js-blog',
    'https://community.esri.com/ccqpr47374/rss/boardmessages?board.id=certification-exams',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=eb-custom-widgetstkb-board',

    // RSS Monitoring changes on some "Release notes" and "What's new pages"
    'https://rss.rauljimenez.info/arcgis-whats-new-changes.xml',
    'https://rss.rauljimenez.info/arcgis-whats-new-monitor-health.xml', // Checking possible errors in the monitor

    // Employee blogs and podcasts
    'https://feed.podbean.com/theboundingbox/feed.xml',
    'https://odoe.net/rss.xml',
    'https://josiahparry.com/index.xml',
    'https://highearthorbit.com/feed/',
    'https://christophermoravec.com/rss/',
    'https://adventuresinmapping.com/feed/',

    // Local-only (preserved during merge 2026-05-12)
    'https://feeds.feedburner.com/Codethemap',
    'https://learn.finaldraftmapping.com/feed/'
  ];

  const googleAlertUrls = [
    'https://www.google.com/alerts/feeds/10211086479352302070/8313662974736823766',
    'https://www.google.com/alerts/feeds/10211086479352302070/18422577937220317856',
    'https://www.google.com/alerts/feeds/10211086479352302070/15069651367870606033'
  ];

  const sourceRelevanceOverrides = new Map([
    // Curated personal feeds: useful, but not every item is necessarily Esri/ArcGIS developer content.
    ['https://www.youtube.com/feeds/videos.xml?channel_id=UCZZe1tS_wmHYXNoivPeptYw', 'balanced'], // Courtney Yatteau
    ['https://www.youtube.com/feeds/videos.xml?channel_id=UCX78SUhrloA6Cn3aW_e8C_A', 'balanced'], // Josiah Parry
    ['https://josiahparry.com/index.xml', 'balanced']
  ]);

  const withRelevanceMode = (urls, relevanceMode, overrides = new Map()) => urls.map(url => ({
    url,
    relevanceMode: overrides.get(url) || relevanceMode
  }));

  // Cargar configuración
  const config = loadConfig();
  const feedService = new FeedService(config);

  // Combinar todos los feeds en un solo archivo
  const allUrls = [
    ...withRelevanceMode(curatedUrls, 'trusted', sourceRelevanceOverrides),
    ...withRelevanceMode(googleAlertUrls, 'strict')
  ];
  const { items: allItems, ignoredItems } = await feedService.combineFeeds(allUrls, {
    title: `Combined ArcGIS Feeds (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, '../feeds', `combined_feeds_${dateStr}.xml`),
    jsonOutputPath: path.join(__dirname, '../feeds', 'combined_feeds.json'),
    filterLastHours: 48
  });

  // Mantener el feed principal de ArcGIS ESRI Dev
  const { items: arcgisDevItems } = await feedService.combineFeeds(allUrls, {
    title: `ArcGIS ESRI Dev Feed (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, '../feeds', 'arcgis_esri_dev_feed.xml'),
    jsonOutputPath: path.join(__dirname, '../feeds', 'arcgis_esri_dev_feed.json'),
    filterLastHours: 48,
    processWithOpenAI: true
  });

  // Guardar noticias ignoradas en CSV
  if (ignoredItems.length > 0) {
    console.log('Guardando items ignorados en CSV...');
    const csvHeader = 'URL,Reason,Title,Date\n';
    const csvContent = ignoredItems.map(item => 
      `"${item.url}","${item.reason}","${item.title}","${item.date}"`
    ).join('\n');
    
    const ignoredItemsPath = path.join(__dirname, '../ignored_items.csv');
    
    try {
      if (!fs.existsSync(ignoredItemsPath)) {
        fs.writeFileSync(ignoredItemsPath, csvHeader, 'utf8');
      }
      
      fs.appendFileSync(ignoredItemsPath, csvContent + '\n', 'utf8');
      console.log(`Noticias ignoradas añadidas a ${ignoredItemsPath} (${ignoredItems.length} items nuevos)`);
    } catch (err) {
      console.error('Error guardando items ignorados:', err.message);
    }
  }

  if (arcgisDevItems && arcgisDevItems.length > 0) {
    // Procesar items con ChatGPT y generar tabla HTML
    const tableRows = [];

    for (const item of arcgisDevItems) {
      if (!item.ignored) {
        const date = new Date(item.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const url = item.link;
        const title = item.title || '';

        tableRows.push(`<tr>
          <td class="date">${date}</td>
          <td class="title"><a href="${url}">${title}</a></td>
        </tr>`);
      }
    }

    // Generar el archivo HTML
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ArcGIS ESRI Dev News</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            text-align: center;
            margin-bottom: 30px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: bold;
            color: #2c3e50;
        }
        tr:hover {
            background-color: #f8f9fa;
        }
        .date {
            white-space: nowrap;
            color: #666;
        }
        .title {
            font-weight: bold;
            color: #2c3e50;
        }
        .author {
            color: #666;
        }
        .topics {
            color: #666;
            font-size: 0.9em;
        }
        .category {
            font-weight: bold;
            color: #2c3e50;
        }
        a {
            color: #3498db;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>ArcGIS ESRI Dev News</h1>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Title</th>
                </tr>
            </thead>
            <tbody>
                ${tableRows.join('')}
            </tbody>
        </table>
    </div>
</body>
</html>`;

    const newsFilePath = path.join(__dirname, '../news', `news_${dateStr}.html`);
    fs.mkdirSync(path.dirname(newsFilePath), { recursive: true });
    fs.writeFileSync(newsFilePath, htmlContent, 'utf8');
    console.log(`Tabla de noticias generada en ${newsFilePath}`);

    // Generar index.html con listado de archivos HTML
    const newsDir = path.join(__dirname, '../news');
    const files = fs.readdirSync(newsDir).filter(file => file.endsWith('.html') && file !== 'index.html');
    files.sort((a, b) => {
      const dateA = a.replace('news_', '').replace('.html', '');
      const dateB = b.replace('news_', '').replace('.html', '');
      return dateB.localeCompare(dateA);
    });

    const indexContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>News Files</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #333; }
    ul { list-style-type: none; padding: 0; }
    li { margin: 10px 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>News Files</h1>
  <ul>
    ${files.map(file => `<li><a href="${file}">${file}</a></li>`).join('\n')}
  </ul>
</body>
</html>`;

    const indexFilePath = path.join(newsDir, 'index.html');
    fs.writeFileSync(indexFilePath, indexContent, 'utf8');
    console.log(`Índice de noticias generado en ${indexFilePath}`);
  }
}

main().catch(console.error); 
