const path = require('path');
const fs = require('fs');
const { getDateString } = require('./utils/fileUtils');
const { loadConfig } = require('./services/configService');
const FeedService = require('./services/feedService');
const { getFeedSources, getMonitoredUrls } = require('./feedSources');

function buildFeedStatus(sourceReports, monitoredUrls) {
  const monitoredUrlSet = new Set(monitoredUrls);
  const reportsByUrl = new Map();

  sourceReports.forEach(report => {
    if (!monitoredUrlSet.has(report.url)) return;

    const existing = reportsByUrl.get(report.url);
    if (!existing) {
      reportsByUrl.set(report.url, { ...report, errors: [...(report.errors || [])] });
      return;
    }

    const statusPriority = { failed: 3, partial: 2, ok: 1 };
    if ((statusPriority[report.status] || 0) > (statusPriority[existing.status] || 0)) {
      existing.status = report.status;
    }
    existing.itemCount = Math.max(existing.itemCount || 0, report.itemCount || 0);
    existing.processedItems = Math.max(existing.processedItems || 0, report.processedItems || 0);
    existing.recoveredFromInvalidXml = Boolean(existing.recoveredFromInvalidXml || report.recoveredFromInvalidXml);
    existing.parseWarning = existing.parseWarning || report.parseWarning || '';
    existing.errors.push(...(report.errors || []));
  });

  monitoredUrls.forEach(url => {
    if (!reportsByUrl.has(url)) {
      reportsByUrl.set(url, {
        url,
        status: 'failed',
        itemCount: 0,
        processedItems: 0,
        errors: [{
          stage: 'monitoring',
          message: 'Feed was not checked during this run'
        }]
      });
    }
  });

  const sources = Array.from(reportsByUrl.values());
  const failedSources = sources.filter(source => source.status !== 'ok');

  return {
    lastUpdated: new Date().toISOString(),
    totalSources: sources.length,
    failedSources: failedSources.length,
    ok: failedSources.length === 0,
    sources
  };
}

function writeFeedStatus(status) {
  const statusPath = path.join(__dirname, '../feeds', 'feed_status.json');
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
  console.log(`Estado de feeds generado en ${statusPath}`);
}

async function main() {
  const dateStr = getDateString();

  // Still missing sources:
  // Esri Training Courses: https://www.esri.com/training/catalog/search/
  // Technical Support - Knowledge base (How tos, FAQs, etc) - Dev Products: https://support.esri.com/en-us/search?s=Newest&cardtype=support_technical_articles&product=arcgis+api+for+javascript&product=arcgis+runtime+sdks&product=arcgis+pro+sdk&product=arcgisobjects+sdk&product=arcgis+api+for+python&product=arcgis+configurable+apps&product=arcgis+dashboards&product=arcgis+experience+builder&product=arcgis+maps+sdk+for+javascript&product=arcgis+maps+sdk+for+kotlin&product=arcgis+maps+sdk+for+net&product=arcgis+maps+sdk+for+swift&product=arcgis+maps+sdk+for+qt&product=arcgis+maps+sdk+for+unity&product=arcgis+maps+sdk+for+unreal+engine&product=arcgis+world+geocoder&product=esri+demographics&product=arcgis+location+platform

  // Cargar configuración
  const config = loadConfig();
  const feedService = new FeedService(config);

  // Combinar todos los feeds en un solo archivo
  const allUrls = getFeedSources();
  const { items: allItems, ignoredItems, sourceReports: allSourceReports } = await feedService.combineFeeds(allUrls, {
    title: `Combined ArcGIS Feeds (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, '../feeds', `combined_feeds_${dateStr}.xml`),
    jsonOutputPath: path.join(__dirname, '../feeds', 'combined_feeds.json'),
    filterLastHours: 48
  });

  // Mantener el feed principal de ArcGIS ESRI Dev
  const { items: arcgisDevItems, sourceReports: arcgisDevSourceReports } = await feedService.combineFeeds(allUrls, {
    title: `ArcGIS ESRI Dev Feed (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, '../feeds', 'arcgis_esri_dev_feed.xml'),
    jsonOutputPath: path.join(__dirname, '../feeds', 'arcgis_esri_dev_feed.json'),
    filterLastHours: 48,
    processWithOpenAI: true
  });

  writeFeedStatus(buildFeedStatus([
    ...(allSourceReports || []),
    ...(arcgisDevSourceReports || [])
  ], getMonitoredUrls()));

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
