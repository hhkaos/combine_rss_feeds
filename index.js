const Parser = require('rss-parser');
const RSS = require('rss');
const fs = require('fs');
const path = require('path');
const { XMLValidator } = require('fast-xml-parser');
const { OpenAI } = require('openai');

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

// Sanitize text to safely include in CDATA sections
function sanitizeCData(text = '') {
  return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

// Clean Google redirect URLs
function cleanGoogleRedirectUrl(url) {
  if (url && url.includes('google.com/url')) {
    try {
      const urlObj = new URL(url);
      const targetUrl = urlObj.searchParams.get('url');
      if (targetUrl) {
        return targetUrl;
      }
    } catch (err) {
      console.error(`Error cleaning Google redirect URL: ${err.message}`);
    }
  }
  return url;
}

// Generic function to combine a list of feeds into one output file
async function combineFeeds(feedUrls, options) {
  console.log('Iniciando combineFeeds con', feedUrls.length, 'URLs');
  const { title, description, outputPath, filterLastHours, processWithOpenAI, jsonOutputPath } = options;
  const parser = new Parser();
  let allItems = [];
  const seenUrls = new Set();
  const ignoredUrls = new Set();
  const ignoredItems = [];

  // Load social media patterns
  console.log('Cargando patrones de redes sociales...');
  const socialMediaConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'social_media_urls.json'), 'utf8'));
  const socialMediaPatterns = socialMediaConfig.social_media_patterns.flatMap(platform => platform.patterns);
  console.log(`Cargados ${socialMediaPatterns.length} patrones de redes sociales`);

  // Function to check if URL is from social media
  function isSocialMediaUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return socialMediaPatterns.some(pattern => {
        // Verificar si el hostname coincide exactamente o es un subdominio
        return hostname === pattern.toLowerCase() || 
               hostname.endsWith('.' + pattern.toLowerCase());
      });
    } catch (err) {
      console.error(`Error parsing URL ${url}:`, err.message);
      return false;
    }
  }

  // Function to add ignored item if not already ignored
  function addIgnoredItem(url, reason, title, date) {
    if (!ignoredUrls.has(url)) {
      // Verificar si el item tiene menos de 48 horas de antigüedad
      const itemDate = new Date(date);
      const now = new Date();
      const hoursDiff = (now - itemDate) / (1000 * 60 * 60);
      
      if (hoursDiff <= 48) {
        ignoredUrls.add(url);
        ignoredItems.push({
          url,
          reason,
          title,
          date
        });
        console.log(`Añadido a ignoredItems: ${url} (${reason}) - Antigüedad: ${hoursDiff.toFixed(1)}h`);
      } else {
        console.log(`Item no añadido a ignoredItems por antigüedad (${hoursDiff.toFixed(1)}h): ${url}`);
      }
    } else {
      console.log(`URL ya ignorada previamente: ${url}`);
    }
  }

  // Load existing JSON feed if jsonOutputPath is provided
  let existingItems = [];
  if (jsonOutputPath) {
    console.log('Cargando feed JSON existente:', jsonOutputPath);
    const jsonFeed = loadJsonFeed(jsonOutputPath);
    existingItems = jsonFeed.items || [];
    existingItems.forEach(item => seenUrls.add(item.link));
    console.log(`Cargados ${existingItems.length} items existentes del JSON`);
  }

  // Load configuration files if OpenAI processing is enabled
  let categories, topicsProduct, authors, ignoreRules;
  if (processWithOpenAI) {
    console.log('Cargando archivos de configuración para OpenAI...');
    try {
      categories = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'categories.json'), 'utf8'));
      topicsProduct = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'topics_product.json'), 'utf8'));
      authors = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'authors.json'), 'utf8'));
      ignoreRules = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'ignore_rules.json'), 'utf8'));
      console.log('Archivos de configuración cargados correctamente');
    } catch (err) {
      console.error('Error loading configuration files:', err.message);
      throw err;
    }
  }

  // Function to determine category based on URL
  function determineCategory(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();

      // Video category
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        return 'Video';
      }

      // Blog category
      if (
        (hostname.includes('esri.com') && pathname.includes('/arcgis-blog')) ||
        (hostname.includes('esri.com') && pathname.includes('/software-engineering/blog')) ||
        hostname.includes('community.esri.com') ||
        hostname.includes('medium.com') ||
        hostname.includes('odoe.net') ||
        hostname.includes('josiahparry.com') ||
        hostname.includes('highearthorbit.com')
      ) {
        return 'Blog';
      }

      // Podcast category
      if (hostname.includes('feed.podbean.com')) {
        return 'Podcast';
      }

      // Source code category
      if (hostname.includes('github.com')) {
        return 'Source code';
      }

      // If no category is determined, return null for OpenAI to decide
      return null;
    } catch (err) {
      console.error(`Error determining category for URL ${url}:`, err.message);
      return null;
    }
  }

  console.log('Iniciando procesamiento de feeds...');
  for (const url of feedUrls) {
    try {
      console.log(`[${new Date().toISOString()}] Procesando feed: ${url}`);
      const feed = await parser.parseURL(url);
      console.log(`Feed ${url}: ${feed.items.length} items`);
      
      if (!feed.items || !Array.isArray(feed.items)) {
        console.warn(`Feed ${url} no tiene items o no es un array`);
        continue;
      }

      let processedItems = 0;
      feed.items.forEach(item => {
        try {
          const dateStr = item.isoDate || item.pubDate;
          if (dateStr) {
            const date = new Date(dateStr);
            const cleanUrl = cleanGoogleRedirectUrl(item.link);
            
            // Check if URL is from social media
            if (isSocialMediaUrl(cleanUrl)) {
              console.log(`Ignorando URL de red social: ${cleanUrl}`);
              addIgnoredItem(cleanUrl, 'URL de red social', item.title, date.toISOString());
              return;
            }

            if (!seenUrls.has(cleanUrl)) {
              seenUrls.add(cleanUrl);
              allItems.push({
                title: item.title,
                description: item.content || item.contentSnippet || item.summary || '',
                link: cleanUrl,
                guid: item.guid || item.id || cleanUrl,
                author: item.creator || item.author || '',
                date: date.toISOString(),
                category: '',
                topicsProduct: '',
                summary: '',
                processed: false
              });
            } else {
              console.log(`Ignorando item duplicado: ${cleanUrl}`);
              addIgnoredItem(cleanUrl, 'Item duplicado', item.title, date.toISOString());
            }
          } else {
            console.warn(`Item sin fecha en feed ${url}: ${item.title || 'Sin título'}`);
          }
          processedItems++;
          if (processedItems % 10 === 0) {
            console.log(`Procesados ${processedItems}/${feed.items.length} items del feed ${url}`);
          }
        } catch (itemErr) {
          console.error(`Error procesando item en feed ${url}:`, itemErr.message);
        }
      });
      console.log(`Feed ${url} completado. Items procesados: ${processedItems}`);
    } catch (err) {
      console.error(`Error parsing feed ${url}:`, err.message);
    }
  }
  console.log(`Procesamiento de feeds completado. Total items: ${allItems.length}`);

  if (filterLastHours) {
    console.log(`Filtrando items de las últimas ${filterLastHours} horas...`);
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - filterLastHours);
    const before = allItems.length;
    allItems = allItems.filter(item => new Date(item.date) >= cutoff);
    console.log(`Filtradas ${before - allItems.length} entradas antiguas, quedan ${allItems.length}`);
  }

  // Combine existing and new items
  console.log('Combinando items existentes con nuevos...');
  const combinedItems = [...existingItems, ...allItems];
  
  // Sort by date (newest first)
  console.log('Ordenando items por fecha...');
  combinedItems.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Process items with OpenAI if enabled
  if (processWithOpenAI) {
    console.log('Iniciando procesamiento con OpenAI...');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let processedCount = 0;
    const totalToProcess = combinedItems.filter(item => !item.processed).length;
    console.log(`Items pendientes de procesar con OpenAI: ${totalToProcess}`);

    for (const item of combinedItems) {
      if (!item.processed) {
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            console.log(`[${new Date().toISOString()}] Procesando item ${processedCount + 1}/${totalToProcess}: ${item.link}`);
            
            // Determine category before OpenAI processing
            const determinedCategory = determineCategory(item.link);
            if (determinedCategory) {
              item.category = determinedCategory;
              console.log(`Categoría determinada automáticamente: ${determinedCategory}`);
            }

            const prompt = `Procesa el siguiente item y genera una respuesta con el siguiente formato:
              - Topics_Product: Elige sobre cual de los productos trata la noticia ${JSON.stringify(topicsProduct.topics_product.map(t => t.value))}
              - Summary: Genera un resumen en inglés de no más de 255 caracteres para la noticia.
              ${!determinedCategory ? `- Category: Elige una categoría de la siguiente lista: ${JSON.stringify(categories.categories.map(c => c.value))}` : ''}
              - URL: ${item.link}

              Si el item debe ser ignorado según las reglas: ${JSON.stringify(ignoreRules.ignore_rules)}, responde con "IGNORE" y la razón.`;

            const response = await openai.chat.completions.create({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 150
            });

            const result = response.choices[0].message.content.trim();

            if (!result.startsWith('IGNORE')) {
              const fields = result.split('\n').map(line => line.trim());
              const topicsProductField = fields.find(f => f.startsWith('- Topics_Product:'));
              const summaryField = fields.find(f => f.startsWith('- Summary:'));
              const categoryField = !determinedCategory ? fields.find(f => f.startsWith('- Category:')) : null;

              item.topicsProduct = topicsProductField ? topicsProductField.replace('- Topics_Product:', '').trim() : '';
              item.summary = summaryField ? summaryField.replace('- Summary:', '').trim() : '';
              if (!determinedCategory && categoryField) {
                item.category = categoryField.replace('- Category:', '').trim();
              }
              item.processed = true;
              break;
            } else {
              console.log(`Item ignorado: ${item.link} - ${result.replace('IGNORE', '').trim()}`);
              item.processed = true;
              item.ignored = true;
              item.ignoreReason = result.replace('IGNORE', '').trim();
              break;
            }
          } catch (err) {
            console.error(`Error procesando item con OpenAI (intento ${retryCount + 1}/${maxRetries}): ${err.message}`);
            retryCount++;
            if (retryCount === maxRetries) {
              console.error(`No se pudo procesar el item después de ${maxRetries} intentos: ${item.link}`);
              item.processed = true;
              item.error = true;
              item.errorMessage = err.message;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }
        processedCount++;
        if (processedCount % 5 === 0) {
          console.log(`Progreso OpenAI: ${processedCount}/${totalToProcess} items procesados`);
        }
      }
    }
    console.log('Procesamiento con OpenAI completado');
  }

  // Save JSON feed if jsonOutputPath is provided
  if (jsonOutputPath) {
    console.log('Guardando feed JSON...');
    const jsonFeed = {
      title,
      description,
      lastUpdated: new Date().toISOString(),
      items: combinedItems
    };
    saveJsonFeed(jsonOutputPath, jsonFeed);
  }

  // Generate XML feed
  console.log(`Construyendo feed XML "${title}" con ${combinedItems.length} entradas`);
  const combinedFeed = new RSS({ title, description, pubDate: new Date() });
  let addedItems = 0;
  combinedItems.forEach(item => {
    if (!item.ignored) {
      try {
        combinedFeed.item({
          title: sanitizeCData(item.title),
          description: sanitizeCData(item.description),
          url: item.link,
          guid: sanitizeCData(item.guid),
          author: sanitizeCData(item.author),
          date: new Date(item.date)
        });
        addedItems++;
      } catch (err) {
        console.error(`Error al añadir item: ${err.message}`);
      }
    }
  });
  console.log(`Total de items recogidos: ${allItems.length}, items añadidos al feed: ${addedItems}`);

  const xml = combinedFeed.xml({ indent: true });
  try {
    console.log('Validando XML...');
    const valid = XMLValidator.validate(xml);
    if (valid === true) {
      console.log('XML es válido');
    } else {
      throw valid;
    }
  } catch (e) {
    console.warn('La validación del XML falló, continuando a escribir el archivo:', e);
  }

  console.log('Guardando archivo XML...');
  ensureDirSync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, xml, 'utf8');
  console.log(`Feed combinado escrito en ${outputPath}`);

  console.log('combineFeeds completado exitosamente');
  return { items: combinedItems, ignoredItems };
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
    'https://community.esri.com/ccqpr47374/rss/board?board.id=geodev-germany-blog',
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
    'https://www.esri.com/arcgis-blog/feed/?post_type=blog&product=developers',
    'https://www.esri.com/en-us/software-engineering/blog/feed?post_type=blog',
    'https://www.esri.com/about/newsroom/category/esri-technology/developer-technology/arcgis-maps-sdk-for-javascript-developer-technology/feed',
    'https://www.esri.com/about/newsroom/category/esri-events/esri-developer-summit/feed'
  ];

  const googleAlertUrls = [
    'https://www.google.com/alerts/feeds/10211086479352302070/8313662974736823766',
    'https://www.google.com/alerts/feeds/10211086479352302070/18422577937220317856',
    'https://www.google.com/alerts/feeds/10211086479352302070/15069651367870606033'
  ];

  // Combinar todos los feeds en un solo archivo
  const allUrls = [...curatedUrls, ...googleAlertUrls];
  const { items: allItems, ignoredItems } = await combineFeeds(allUrls, {
    title: `Combined ArcGIS Feeds (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', `combined_feeds_${dateStr}.xml`),
    jsonOutputPath: path.join(__dirname, 'feeds', 'combined_feeds.json'),
    filterLastHours: 48
  });

  // Mantener el feed principal de ArcGIS ESRI Dev
  const { items: arcgisDevItems } = await combineFeeds(allUrls, {
    title: `ArcGIS ESRI Dev Feed (${dateStr})`,
    description: 'Todos los feeds combinados (últimas 48 horas)',
    outputPath: path.join(__dirname, 'feeds', 'arcgis_esri_dev_feed.xml'),
    jsonOutputPath: path.join(__dirname, 'feeds', 'arcgis_esri_dev_feed.json'),
    filterLastHours: 48,
    processWithOpenAI: true
  });

  // Guardar noticias ignoradas en CSV (solo una vez)
  if (ignoredItems.length > 0) {
    console.log('Guardando items ignorados en CSV...');
    const csvHeader = 'URL,Reason,Title,Date\n';
    const csvContent = ignoredItems.map(item => 
      `"${item.url}","${item.reason}","${item.title}","${item.date}"`
    ).join('\n');
    
    const ignoredItemsPath = path.join(__dirname, 'ignored_items.csv');
    
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
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tableRows = [];

    for (const item of arcgisDevItems) {
      if (item.ignored) {
        // Eliminar este bloque ya que ahora se maneja en addIgnoredItem
        // ignoredItems.push({
        //   url: item.link,
        //   reason: item.ignoreReason || 'No reason provided',
        //   title: item.title,
        //   date: item.date
        // });
      } else {
        const date = new Date(item.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
        const category = item.category || '';
        const featured = '';
        const topicsProduct = item.topicsProduct || '';
        const author = item.author || '';
        const url = item.link;
        const title = item.title || '';
        const summary = item.summary || '';

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
  
