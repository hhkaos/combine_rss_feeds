const Parser = require('rss-parser');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');
const { XMLValidator } = require('fast-xml-parser');
const { OpenAI } = require('openai');

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
  const { title, description, outputPath, filterLastHours, processWithOpenAI } = options;
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
    console.log(`Filtradas ${before - allItems.length} entradas antiguas, quedan ${allItems.length}`);
  } else {
    console.log(`Recogidas ${allItems.length} entradas`);
  }

  allItems.sort((a, b) => b.date - a.date);
  console.log(`Construyendo feed "${title}" con ${allItems.length} entradas`);

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

  return allItems;
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
    'https://www.esri.com/arcgis-blog/products/developers/feed',
    'https://community.esri.com/ccqpr47374/rss/board?board.id=python-blog',
    'https://www.esri.com/arcgis-blog/feed/?post_type=blog&product=developers'
  ];

  const googleAlertUrls = [
    'https://www.google.com/alerts/feeds/10211086479352302070/8313662974736823766',
    'https://www.google.com/alerts/feeds/10211086479352302070/18422577937220317856',
    'https://www.google.com/alerts/feeds/10211086479352302070/15069651367870606033'
  ];

  // Combinar todos los feeds en un solo archivo
  const allUrls = [...curatedUrls, ...googleAlertUrls];
  const allItems = await combineFeeds(allUrls, {
    title: `Combined ArcGIS Feeds (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', `combined_feeds_${dateStr}.xml`),
    filterLastHours: 48
  });

  // Mantener el feed principal de ArcGIS ESRI Dev
  const arcgisDevItems = await combineFeeds(allUrls, {
    title: `ArcGIS ESRI Dev Feed (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', 'arcgis_esri_dev_feed.xml'),
    filterLastHours: 48,
    processWithOpenAI: true
  });

  if (arcgisDevItems && arcgisDevItems.length > 0) {
    // Procesar items con ChatGPT y generar tabla HTML
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const categories = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'categories.json'), 'utf8'));
    const topicsProduct = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'topics_product.json'), 'utf8'));
    const authors = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'authors.json'), 'utf8'));
    const ignoreRules = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'ignore_rules.json'), 'utf8'));

    const ignoredItems = [];
    const tableRows = [];

    for (const item of arcgisDevItems) {
      const prompt = `Procesa el siguiente item y genera una respuesta con el siguiente formato:
        - Topics_Product: Elige sobre cual de los productos trata la noticia ${JSON.stringify(topicsProduct.topics_product.map(t => t.value))}
        - Summary: Genera un resumen en inglés de no más de 255 caracteres para la noticia.
        - URL: ${item.link}

        Si el item debe ser ignorado según las reglas: ${JSON.stringify(ignoreRules.ignore_rules)}, responde con "IGNORE" y la razón.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150
      });

      const result = response.choices[0].message.content.trim();

      if (result.startsWith('IGNORE')) {
        ignoredItems.push({ url: item.link, reason: result.replace('IGNORE', '').trim() });
      } else {
        // Procesar la respuesta para generar la fila de la tabla
        console.log(result);
        const fields = result.split('\n').map(line => line.trim());

        const topicsProductField = fields.find(f => f.startsWith('- Topics_Product:'));
        const summaryField = fields.find(f => f.startsWith('- Summary:'));

        const date = item.date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const category = '';
        const featured = '';
        const topicsProduct = topicsProductField ? topicsProductField.replace('- Topics_Product:', '').trim() : '';
        const author = '';
        const url = item.link;
        const title = item.title || '';
        const summary = summaryField ? summaryField.replace('- Summary:', '').trim() : '';

        tableRows.push(`<tr>
          <td>${date}</td>
          <td>${category}</td>
          <td>${featured}</td>
          <td>${topicsProduct}</td>
          <td>${title}</td>
          <td>${author}</td>
          <td><a href="${url}">${url}</a></td>
          <td>${summary}</td>
        </tr>`);
      }
    }

    // Generar el archivo HTML
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>News Table</title>
  <style>
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <h1>News Table</h1>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Category</th>
        <th>Featured</th>
        <th>Topics_Product</th>
        <th>Title</th>
        <th>Author</th>
        <th>URL</th>
        <th>Summary</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows.join('\n')}
    </tbody>
  </table>
</body>
</html>`;

    const newsFilePath = path.join(__dirname, 'news', `news_${dateStr}.html`);
    ensureDirSync(path.dirname(newsFilePath));
    fs.writeFileSync(newsFilePath, htmlContent, 'utf8');
    console.log(`Tabla de noticias generada en ${newsFilePath}`);

    // Guardar noticias ignoradas en CSV
    const csvContent = ignoredItems.map(item => `${item.url},${item.reason}`).join('\n');
    fs.writeFileSync(path.join(__dirname, 'ignored_items.csv'), csvContent, 'utf8');
    console.log(`Noticias ignoradas guardadas en ignored_items.csv`);

    // Generar index.html con listado de archivos HTML
    const newsDir = path.join(__dirname, 'news');
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
    console.log(`Index file generated at ${indexFilePath}`);
  }
})();
  
