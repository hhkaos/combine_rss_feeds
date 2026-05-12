const Parser = require('rss-parser');
const RSS = require('rss');
const fs = require('fs');
const { OpenAI } = require('openai');
const { loadJsonFeed, saveJsonFeed } = require('../utils/fileUtils');
const { cleanGoogleRedirectUrl, normalizeYouTubeUrl } = require('../utils/urlUtils');

// Colores para la consola
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

class FeedService {
  constructor(config) {
    this.parser = new Parser();
    this.config = config;
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  isSocialMediaUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      return this.config.socialMediaConfig.social_media_patterns.flatMap(platform => platform.patterns)
        .some(pattern => hostname === pattern.toLowerCase() || hostname.endsWith('.' + pattern.toLowerCase()));
    } catch (err) {
      console.error(`Error parsing URL ${url}:`, err.message);
      return false;
    }
  }

  isBannedUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();
      const fullUrl = `${hostname}${pathname}`;

      return this.config.bannedConfig.banned_patterns.flatMap(group => group.patterns)
        .some(pattern => fullUrl.includes(pattern.toLowerCase()));
    } catch (err) {
      console.error(`Error parsing URL ${url}:`, err.message);
      return false;
    }
  }

  stripHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Deterministic job-offer detection (no AI tokens).
  // Avoids matching news like "job losses", "job market", "job creation".
  isJobOffer(title, description) {
    const t = this.stripHtml(title || '');
    const d = this.stripHtml(description || '').slice(0, 600);
    const text = `${t} ${d}`;

    const newsExclusion = /\bjob\s+(losses|loss|market|markets|cuts|report|reports|creation|growth|seekers|seeker|numbers|figures|data|gains|openings\s+report)\b/i;
    if (newsExclusion.test(text) && !/\b(apply|hiring|vacancy|vacante|empleo|salary|recruit|now hiring|we['']?re hiring)\b/i.test(text)) {
      return false;
    }

    const patterns = [
      /\bnow hiring\b/i,
      /\bwe['']?re hiring\b/i,
      /\bapply\s+(now|here|today|online|to)\b/i,
      /\bjob\s+(board|listing|details|opening|posting|opportunit(y|ies)|description|portal|alert)s?\b/i,
      /\bjob\s+in\s+[A-Z]/,
      /\bjob\s+at\s+[A-Z]/,
      /\bvacanc(y|ies)\b/i,
      /\bvacante[s]?\b/i,
      /\bempleo\b/i,
      /\boferta\s+de\s+(trabajo|empleo)\b/i,
      /\brecruit(ing|ment|er|ers)\b/i,
      /\b(full|part)[- ]?time\s+(role|position|job)\b/i,
      /\bfreelance\s+job\b/i,
      /\bcontract\s+job\b/i,
      /\b(developer|engineer|analyst|specialist|architect|consultant|administrator)\s+job\b/i,
      /\b(developer|engineer|specialist|analyst)\s+(role|position)\b/i,
      /\b(remote|hybrid|onsite|on-site)\s+(job|jobs|position|role)\b/i,
      /\bremote\s+esri\s+jobs?\b/i,
      /\bsalary\s+(range|of|\$|EUR|USD|GBP)/i,
      /\bcareer\s+hub\b/i,
      /\b(senior|junior|lead|principal|staff)\b[^.]{0,60}\b(engineer|developer|specialist|analyst|architect)\b[^.]{0,40}\s+(at|@)\s+[A-Z]/,
      /\bhiring\s+(geospatial|gis|arcgis|esri|developer|engineer|analyst|manager|specialist)\b/i
    ];
    return patterns.some(p => p.test(text));
  }

  async evaluateIgnoreRules(item) {
    try {
      const cleanDesc = this.stripHtml(item.description).slice(0, 400);
      const cleanTitle = this.stripHtml(item.title);

      const systemMsg = `Eres un clasificador que decide si un item de un feed RSS sobre tecnologías de Esri/ArcGIS para desarrolladores debe ignorarse.

Reglas para IGNORAR:
1. Contenido NO relacionado con ArcGIS, Esri, GIS, o sus tecnologías (SDKs, APIs, etc.).
2. Ofertas de empleo, vacantes, anuncios de "hiring", "now hiring", "apply now", listados de jobs, careers.
3. Preguntas de comunidad/foros (community.esri.com, stackoverflow, stackexchange, reddit, GIS StackExchange).
4. Issues o pull requests de GitHub (URLs tipo github.com/.../issues/ o /pull/).
5. Datasets de portales de datos abiertos o endpoints de ArcGIS REST API (services.arcgis.com, *.arcgis.com/rest/services, hub.arcgis.com/datasets).
6. Contenido del "Economic and Social Research Institute" irlandés (NO Esri Inc.); típicamente desde rte.ie, esri.ie.
7. Contenido obsoleto (>5 años) o claramente desactualizado.

Ejemplos:
- "ArcGIS Developer Job - Harrisburg" → IGNORE: oferta de empleo
- "How to use the ArcGIS Maps SDK for Kotlin" → KEEP
- "Senior GIS Engineer @ Esri | AnitaB.org Job Board" → IGNORE: oferta de empleo
- "AI use in Irish firms likely to lead to job losses - ESRI - RTE" → IGNORE: ESRI irlandés, no Esri Inc.
- "How to fix this error in ArcGIS Pro? - community.esri.com" → IGNORE: pregunta de comunidad
- "Releasing ArcGIS Maps SDK 200.6" → KEEP
- "Open data: Madrid neighborhoods (FeatureServer)" → IGNORE: dataset/REST endpoint

Responde EXACTAMENTE con una sola palabra en mayúsculas: "IGNORE" o "KEEP", seguida opcionalmente de ": <razón breve>". Nada más.`;

      const userMsg = `Título: ${cleanTitle}
URL: ${item.link}
Descripción: ${cleanDesc}`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg }
        ],
        max_tokens: 40,
        temperature: 0
      });

      const raw = (response.choices[0].message.content || '').trim();
      const upper = raw.toUpperCase();
      if (upper.includes('IGNORE') && !upper.startsWith('KEEP')) {
        const reason = raw.replace(/^[^a-zA-Z]*IGNORE[:\s-]*/i, '').trim();
        return { ignored: true, reason: reason || 'matched ignore rule' };
      }
      return { ignored: false, reason: '' };
    } catch (err) {
      console.error(`${colors.red}Error evaluando ignore_rules: ${err.message}${colors.reset}`);
      return { ignored: false, reason: '' };
    }
  }

  async combineFeeds(feedUrls, options) {
    console.log(`${colors.cyan}Iniciando combineFeeds con ${feedUrls.length} URLs${colors.reset}`);
    const { title, description, outputPath, filterLastHours, processWithOpenAI, jsonOutputPath } = options;
    const parser = new Parser();
    let allItems = [];
    const seenUrls = new Set();
    this.ignoredUrls = new Set();
    this.ignoredItems = [];

    // Load existing JSON feed if jsonOutputPath is provided
    let existingItems = [];
    if (jsonOutputPath) {
      console.log(`${colors.blue}Cargando feed JSON existente: ${jsonOutputPath}${colors.reset}`);
      const jsonFeed = loadJsonFeed(jsonOutputPath);
      existingItems = jsonFeed.items || [];
      existingItems.forEach(item => seenUrls.add(item.link));
      console.log(`${colors.green}Cargados ${existingItems.length} items existentes del JSON${colors.reset}`);
    }

    console.log(`${colors.cyan}Iniciando procesamiento de feeds...${colors.reset}`);
    for (const url of feedUrls) {
      try {
        console.log(`${colors.blue}[${new Date().toISOString()}] Procesando feed: ${url}${colors.reset}`);
        const feed = await parser.parseURL(url);
        console.log(`${colors.green}Feed ${url}: ${feed.items.length} items${colors.reset}`);
        
        if (!feed.items || !Array.isArray(feed.items)) {
          console.warn(`${colors.yellow}Feed ${url} no tiene items o no es un array${colors.reset}`);
          continue;
        }

        let processedItems = 0;
        for (const item of feed.items) {
          try {
            const dateStr = item.isoDate || item.pubDate;
            if (!dateStr) {
              console.warn(`${colors.yellow}Item sin fecha en feed ${url}: ${item.title || 'Sin título'}${colors.reset}`);
              continue;
            }

            const date = new Date(dateStr);
            const cleanUrl = normalizeYouTubeUrl(cleanGoogleRedirectUrl(item.link));
            
            if (!cleanUrl) {
              console.warn(`${colors.yellow}URL inválida en feed ${url}: ${item.title || 'Sin título'}${colors.reset}`);
              continue;
            }

            // Check if URL is from social media
            if (this.isSocialMediaUrl(cleanUrl)) {
              console.log(`${colors.yellow}Ignorando URL de red social: ${cleanUrl}${colors.reset}`);
              this.addIgnoredItem(cleanUrl, 'URL de red social', item.title, date.toISOString());
              continue;
            }

            // Check if URL is banned
            if (this.isBannedUrl(cleanUrl)) {
              console.log(`${colors.yellow}Ignorando URL prohibida: ${cleanUrl}${colors.reset}`);
              this.addIgnoredItem(cleanUrl, 'URL prohibida', item.title, date.toISOString());
              continue;
            }

            const rawDescription = item.content || item.contentSnippet || item.summary || '';

            // Deterministic job-offer detection (no AI tokens)
            if (this.isJobOffer(item.title, rawDescription)) {
              console.log(`${colors.yellow}Ignorando oferta de trabajo: ${cleanUrl}${colors.reset}`);
              this.addIgnoredItem(cleanUrl, 'Oferta de trabajo', item.title, date.toISOString());
              continue;
            }

            if (!seenUrls.has(cleanUrl)) {
              seenUrls.add(cleanUrl);
              allItems.push({
                title: item.title,
                description: rawDescription,
                link: cleanUrl,
                guid: item.guid || item.id || cleanUrl,
                author: item.creator || item.author || '',
                date: date.toISOString(),
                processed: false
              });
            } else {
              console.log(`${colors.yellow}Ignorando item duplicado: ${cleanUrl}${colors.reset}`);
              this.addIgnoredItem(cleanUrl, 'Item duplicado', item.title, date.toISOString());
            }

            processedItems++;
            if (processedItems % 10 === 0) {
              console.log(`${colors.blue}Procesados ${processedItems}/${feed.items.length} items del feed ${url}${colors.reset}`);
            }
          } catch (itemErr) {
            console.error(`${colors.red}Error procesando item en feed ${url}: ${itemErr.message}${colors.reset}`);
            continue;
          }
        }
        console.log(`${colors.green}Feed ${url} completado. Items procesados: ${processedItems}${colors.reset}`);
      } catch (err) {
        console.error(`${colors.red}Error parsing feed ${url}: ${err.message}${colors.reset}`);
        continue;
      }
    }

    if (filterLastHours) {
      console.log(`Filtrando items de las últimas ${filterLastHours} horas...`);
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - filterLastHours);
      const before = allItems.length;
      allItems = allItems.filter(item => new Date(item.date) >= cutoff);
      console.log(`Filtradas ${before - allItems.length} entradas antiguas, quedan ${allItems.length}`);
    }

    // Combine with existing items and sort newest first
    const combinedItems = [...existingItems, ...allItems];
    combinedItems.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Evaluate ignore_rules with OpenAI if enabled (only unprocessed)
    if (processWithOpenAI) {
      const pending = combinedItems.filter(item => !item.processed).length;
      console.log(`${colors.cyan}Evaluando ${pending} items con OpenAI (ignore_rules)...${colors.reset}`);
      let idx = 0;
      for (const item of combinedItems) {
        if (!item.processed) {
          idx++;
          const result = await this.evaluateIgnoreRules(item);
          item.ignored = result.ignored;
          item.ignoreReason = result.reason;
          item.processed = true;
          if (result.ignored) {
            console.log(`${colors.yellow}[${idx}/${pending}] IGNORE ${item.link} - ${result.reason}${colors.reset}`);
          }
        }
      }
    }

    // Save JSON feed if jsonOutputPath is provided
    if (jsonOutputPath) {
      saveJsonFeed(jsonOutputPath, {
        title,
        description,
        lastUpdated: new Date().toISOString(),
        items: combinedItems
      });
    }

    // Generate RSS feed
    const feed = new RSS({
      title,
      description,
      feed_url: outputPath,
      site_url: 'https://developers.arcgis.com',
      language: 'en',
      pubDate: new Date(),
      custom_namespaces: {
        'content': 'http://purl.org/rss/1.0/modules/content/'
      }
    });

    combinedItems.forEach(item => {
      feed.item({
        title: item.title,
        description: item.description,
        url: item.link,
        guid: item.guid,
        author: item.author,
        date: item.date
      });
    });

    const xml = feed.xml({ indent: true });
    fs.writeFileSync(outputPath, xml, 'utf8');
    console.log(`Feed combinado escrito en ${outputPath}`);

    return { items: combinedItems, ignoredItems: this.ignoredItems };
  }

  addIgnoredItem(url, reason, title, date) {
    if (!this.ignoredUrls.has(url)) {
      const itemDate = new Date(date);
      const now = new Date();
      const hoursDiff = (now - itemDate) / (1000 * 60 * 60);
      
      if (hoursDiff <= 48) {
        this.ignoredUrls.add(url);
        this.ignoredItems.push({
          url,
          reason,
          title,
          date
        });
        console.log(`${colors.yellow}Añadido a ignoredItems: ${url} (${reason}) - Antigüedad: ${hoursDiff.toFixed(1)}h${colors.reset}`);
      } else {
        console.log(`Item no añadido a ignoredItems por antigüedad (${hoursDiff.toFixed(1)}h): ${url}`);
      }
    } else {
      console.log(`URL ya ignorada previamente: ${url}`);
    }
  }
}

module.exports = FeedService; 