const Parser = require('rss-parser');
const RSS = require('rss');
const fs = require('fs');
const { OpenAI } = require('openai');
const { getDecisionId, loadCurationDecisions, loadJsonFeed, saveJsonFeed } = require('../utils/fileUtils');
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

const FEED_FETCH_DEFAULTS = {
  timeoutMs: 20000,
  maxAttempts: 3,
  youtubeMaxAttempts: 5,
  baseRetryDelayMs: 1500,
  youtubeBaseRetryDelayMs: 5000,
  youtubeInterRequestDelayMs: 2000
};

const DIAGNOSTIC_HEADER_NAMES = [
  'content-type',
  'content-length',
  'cache-control',
  'server',
  'cf-ray',
  'cf-cache-status',
  'x-cache',
  'x-frame-options',
  'x-content-type-options',
  'retry-after',
  'location'
];

class FeedService {
  constructor(config) {
    this.parser = new Parser();
    this.config = config;
    this.curationDecisions = loadCurationDecisions(config.curationDecisionsPath || '');
    this.openai = null;
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
  }

  hasOpenAI() {
    return Boolean(this.openaiApiKey);
  }

  getOpenAIClient() {
    if (!this.hasOpenAI()) return null;
    if (!this.openai) {
      this.openai = new OpenAI({
        apiKey: this.openaiApiKey
      });
    }

    return this.openai;
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

  getManualDecisionForUrl(url) {
    return this.curationDecisions.get(getDecisionId(url));
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
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  decodeHtml(text) {
    return this.stripHtml(text);
  }

  resolveFeedSource(feedSource) {
    if (typeof feedSource === 'string') {
      return {
        url: feedSource,
        relevanceMode: 'balanced'
      };
    }

    return {
      url: feedSource.url,
      relevanceMode: feedSource.relevanceMode || 'balanced',
      label: feedSource.label || ''
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isYouTubeFeedUrl(url) {
    try {
      const { hostname, pathname } = new URL(url);
      const host = hostname.toLowerCase();
      return (
        (host === 'youtube.com' || host.endsWith('.youtube.com')) &&
        pathname === '/feeds/videos.xml'
      );
    } catch (err) {
      return false;
    }
  }

  getRetryDelayMs(attempt, isYouTubeFeed, retryAfterHeader) {
    if (retryAfterHeader) {
      const retryAfterSeconds = Number(retryAfterHeader);
      if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return Math.min(retryAfterSeconds * 1000, 60000);
      }

      const retryAfterDate = new Date(retryAfterHeader);
      if (!Number.isNaN(retryAfterDate.getTime())) {
        return Math.min(Math.max(retryAfterDate.getTime() - Date.now(), 0), 60000);
      }
    }

    const baseDelay = isYouTubeFeed
      ? FEED_FETCH_DEFAULTS.youtubeBaseRetryDelayMs
      : FEED_FETCH_DEFAULTS.baseRetryDelayMs;
    const exponentialDelay = baseDelay * (2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * 750);
    return Math.min(exponentialDelay + jitter, 60000);
  }

  shouldRetryFeedFetch(status, isYouTubeFeed, err) {
    if (!status) return Boolean(err?.isFetchError || err?.name === 'AbortError');
    if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;

    // YouTube sometimes returns transient 404s for valid channel feeds.
    return isYouTubeFeed && status === 404;
  }

  extractDiagnosticHeaders(headers) {
    const values = {};
    DIAGNOSTIC_HEADER_NAMES.forEach(name => {
      const value = headers.get(name);
      if (value) {
        values[name] = value;
      }
    });

    return values;
  }

  async buildHttpDiagnostics(response) {
    let bodyPreview = '';

    try {
      const responseText = await response.text();
      bodyPreview = responseText
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 280);
    } catch (error) {
      bodyPreview = '';
    }

    return {
      responseHeaders: this.extractDiagnosticHeaders(response.headers),
      bodyPreview
    };
  }

  async fetchFeedXml(url, isYouTubeFeed) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_FETCH_DEFAULTS.timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          'Cache-Control': isYouTubeFeed ? 'no-cache' : 'max-age=0',
          'User-Agent': 'Mozilla/5.0 (compatible; ArcGISDeveloperFeedBot/1.0; +https://developers.arcgis.com)'
        }
      });

      if (!response.ok) {
        const err = new Error(`HTTP ${response.status} ${response.statusText}`.trim());
        const diagnostics = await this.buildHttpDiagnostics(response);
        err.status = response.status;
        err.retryAfter = response.headers.get('retry-after');
        err.responseHeaders = diagnostics.responseHeaders;
        err.bodyPreview = diagnostics.bodyPreview;
        throw err;
      }

      return await response.text();
    } catch (err) {
      if (!err.status) {
        err.isFetchError = true;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  sanitizeInvalidXmlEntities(xml) {
    return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;');
  }

  async parseFeedString(parser, xml, url) {
    try {
      return {
        feed: await parser.parseString(xml),
        recoveredFromInvalidXml: false
      };
    } catch (err) {
      const sanitizedXml = this.sanitizeInvalidXmlEntities(xml);
      if (sanitizedXml === xml) {
        throw err;
      }

      try {
        const feed = await parser.parseString(sanitizedXml);
        console.warn(`${colors.yellow}Feed ${url} contiene entidades XML inválidas (${err.message}); se recuperó escapando ampersands sueltos.${colors.reset}`);
        return {
          feed,
          recoveredFromInvalidXml: true,
          parseWarning: err.message
        };
      } catch (sanitizedErr) {
        sanitizedErr.message = `${err.message}; fallback XML flexible falló: ${sanitizedErr.message}`;
        throw sanitizedErr;
      }
    }
  }

  async parseFeedWithRetries(parser, url) {
    const isYouTubeFeed = this.isYouTubeFeedUrl(url);
    const maxAttempts = isYouTubeFeed
      ? FEED_FETCH_DEFAULTS.youtubeMaxAttempts
      : FEED_FETCH_DEFAULTS.maxAttempts;
    let lastError;
    let lastStatus = null;

    if (isYouTubeFeed) {
      await this.sleep(FEED_FETCH_DEFAULTS.youtubeInterRequestDelayMs);
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const xml = await this.fetchFeedXml(url, isYouTubeFeed);
        const parseResult = await this.parseFeedString(parser, xml, url);
        return { ...parseResult, attempts: attempt, lastStatus: 200 };
      } catch (err) {
        lastError = err;
        lastStatus = err.status || null;
        const retryable = attempt < maxAttempts && this.shouldRetryFeedFetch(lastStatus, isYouTubeFeed, err);

        if (!retryable) {
          err.attempts = attempt;
          err.lastStatus = lastStatus;
          throw err;
        }

        const delayMs = this.getRetryDelayMs(attempt, isYouTubeFeed, err.retryAfter);
        console.warn(`${colors.yellow}Error leyendo feed ${url} (intento ${attempt}/${maxAttempts}): ${err.message}. Reintentando en ${(delayMs / 1000).toFixed(1)}s${colors.reset}`);
        await this.sleep(delayMs);
      }
    }

    lastError.attempts = maxAttempts;
    lastError.lastStatus = lastStatus;
    throw lastError;
  }

  buildItemText(item) {
    return [
      item.title,
      item.description,
      item.link
    ].map(value => this.decodeHtml(value || '')).join(' ');
  }

  getDeterministicIgnoreReason(item) {
    const url = item.link || '';

    if (this.isSocialMediaUrl(url)) {
      return 'URL de red social';
    }

    if (this.isBannedUrl(url)) {
      return 'URL prohibida';
    }

    if (this.isJobOffer(item.title, item.description)) {
      return 'Oferta de trabajo';
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      const pathname = urlObj.pathname.toLowerCase();
      if (
        (hostname === 'github.com' || hostname.endsWith('.github.com')) &&
        /\/(issues|pull)\/\d+/i.test(pathname)
      ) {
        return 'Issue o pull request de GitHub';
      }

      if (
        hostname.endsWith('.stackoverflow.com') ||
        hostname.endsWith('.stackexchange.com') ||
        hostname === 'reddit.com' ||
        hostname.endsWith('.reddit.com') ||
        (hostname === 'community.esri.com' && /\/td-p\//i.test(pathname))
      ) {
        return 'Pregunta de comunidad o foro';
      }

      const fullUrl = `${hostname}${pathname}`;
      if (
        /\/rest\/services\//i.test(fullUrl) ||
        /\/datasets?\//i.test(fullUrl) ||
        /\b(FeatureServer|MapServer)\b/i.test(url)
      ) {
        return 'Dataset de datos abiertos o REST endpoint';
      }
    } catch (err) {
      // Invalid URLs are handled elsewhere; do not ignore only because parsing failed here.
    }

    const text = this.buildItemText(item);
    if (/\b(Economic and Social Research Institute|Irish economy|Ireland|minimum wage Ireland|ESRI report)\b/i.test(text)) {
      return 'ESRI irlandés (Economic and Social Research Institute)';
    }

    return '';
  }

  hasStrongDeveloperProductSignal(item) {
    const text = this.buildItemText(item);
    const productPatterns = [
      /\bArcGIS\s+Maps\s+SDK\s+for\s+(JavaScript|\.NET|Kotlin|Swift|Flutter|Qt|Java|Android|iOS|Unity|Unreal Engine)\b/i,
      /\bArcGIS\s+Runtime\s+SDK\b/i,
      /\bArcGIS\s+API\s+for\s+Python\b/i,
      /\bArcGIS\s+REST\s+JS\b/i,
      /\bEsri\s+Leaflet\b/i,
      /\bArcGIS\s+Experience\s+Builder\s+Developer\s+Edition\b/i,
      /\bArcGIS\s+Developer(s)?\b/i,
      /\bArcGIS\s+Location\s+(Platform|Services)\b/i,
      /\bCalcite\s+Design\s+System\b/i,
      /\bArcGIS\s+Maps\s+SDK\b/i,
      /\bArcGIS\s+Instant\s+Apps\b/i,
      /\bArcGIS\s+Arcade\b|\bArcade\s+expression/i,
      /\bArcPy\b/i
    ];

    return productPatterns.some(pattern => pattern.test(text));
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
      const openai = this.getOpenAIClient();
      if (!openai) {
        return { ignored: false, reason: '' };
      }

      const cleanDesc = this.stripHtml(item.description).slice(0, 400);
      const cleanTitle = this.stripHtml(item.title);
      const relevanceMode = item.sourceRelevanceMode || 'balanced';
      const strictnessInstructions = {
        trusted: `Modo de fuente: TRUSTED.
La fuente ya está curada hacia Esri/ArcGIS developer content. NO ignores por la regla "contenido no relacionado" salvo que el item contradiga claramente la temática. Sí debes ignorar reglas duras: empleo, foros/preguntas, issues/pulls, datasets/endpoints, ESRI irlandés u obsoleto.`,
        balanced: `Modo de fuente: BALANCED.
Aplica las reglas normalmente. Mantén el item si trata razonablemente sobre Esri, ArcGIS, GIS developer tools, SDKs, APIs, automatización geoespacial o productos relacionados.`,
        strict: `Modo de fuente: STRICT.
La fuente es ruidosa, por ejemplo Google Alerts. Mantén solo si hay una relación clara con Esri Inc., ArcGIS o tecnologías geoespaciales para desarrolladores. Mencionar ArcGIS solo como formato de dataset, endpoint REST, requisito de un empleo o tecnología secundaria no basta.`
      };

      const systemMsg = `Eres un clasificador que decide si un item de un feed RSS sobre tecnologías de Esri/ArcGIS para desarrolladores debe ignorarse.

${strictnessInstructions[relevanceMode] || strictnessInstructions.balanced}

Importante:
- El título, la descripción o la URL pueden traer marcado HTML de Google Alerts, como <b>ArcGIS</b>. Interpreta ese marcado como texto normal.
- Si aparece un producto developer explícito de Esri, como "ArcGIS Maps SDK for JavaScript", "ArcGIS Maps SDK for .NET", "ArcGIS API for Python", "ArcGIS REST JS", "Esri Leaflet", "Calcite Design System" o "Experience Builder Developer Edition", considéralo una señal fuerte de relevancia salvo que encaje en una regla dura de ignorar.

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

      const userMsg = `Modo de relevancia de la fuente: ${relevanceMode}
Título: ${cleanTitle}
URL: ${item.link}
Descripción: ${cleanDesc}`;

      const response = await openai.chat.completions.create({
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

  applyManualDecision(item) {
    const decision = this.curationDecisions.get(getDecisionId(item.link));
    if (!decision) {
      return false;
    }

    item.manualStatus = decision.status;
    item.manualReason = decision.reason || '';
    item.manualNotes = decision.notes || '';
    item.reviewedAt = decision.reviewedAt || item.reviewedAt;

    if (decision.status === 'rejected') {
      item.ignored = true;
      item.ignoreReason = decision.reason || 'manual rejection';
      item.processed = true;
    } else if (decision.status === 'accepted') {
      item.ignored = false;
      item.ignoreReason = '';
      item.processed = true;
    } else if (decision.status === 'needs_rule') {
      item.needsReview = true;
      item.processed = true;
    } else if (decision.status === 'archived') {
      item.processed = true;
    }

    return true;
  }

  async combineFeeds(feedUrls, options) {
    console.log(`${colors.cyan}Iniciando combineFeeds con ${feedUrls.length} URLs${colors.reset}`);
    const { title, description, outputPath, filterLastHours, processWithOpenAI, jsonOutputPath } = options;
    const shouldUseOpenAI = Boolean(processWithOpenAI && this.hasOpenAI());
    const parser = new Parser();
    let allItems = [];
    const seenUrls = new Set();
    const sourceReports = [];
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
    for (const feedSource of feedUrls) {
      const source = this.resolveFeedSource(feedSource);
      const url = source.url;
      const sourceReport = {
        url,
        label: source.label || '',
        feedTitle: '',
        relevanceMode: source.relevanceMode,
        checkedAt: new Date().toISOString(),
        status: 'ok',
        itemCount: 0,
        processedItems: 0,
        itemsWithoutDate: 0,
        latestItemDate: null,
        fetchAttempts: 0,
        lastHttpStatus: null,
        recoveredFromInvalidXml: false,
        parseWarning: '',
        errors: []
      };
      sourceReports.push(sourceReport);

      try {
        console.log(`${colors.blue}[${new Date().toISOString()}] Procesando feed: ${url} (relevance: ${source.relevanceMode})${colors.reset}`);
        const { feed, attempts, lastStatus, recoveredFromInvalidXml, parseWarning } = await this.parseFeedWithRetries(parser, url);
        sourceReport.feedTitle = (feed.title || source.label || '').trim();
        sourceReport.fetchAttempts = attempts;
        sourceReport.lastHttpStatus = lastStatus;
        sourceReport.recoveredFromInvalidXml = Boolean(recoveredFromInvalidXml);
        sourceReport.parseWarning = parseWarning || '';
        
        if (!feed.items || !Array.isArray(feed.items)) {
          console.warn(`${colors.yellow}Feed ${url} no tiene items o no es un array${colors.reset}`);
          sourceReport.status = 'failed';
          sourceReport.errors.push({
            stage: 'read_feed',
            message: 'Feed without a valid items array'
          });
          continue;
        }

        sourceReport.itemCount = feed.items.length;
        console.log(`${colors.green}Feed ${url}: ${feed.items.length} items${colors.reset}`);

        let processedItems = 0;
        for (const item of feed.items) {
          try {
            const dateStr = item.isoDate || item.pubDate;
            if (!dateStr) {
              console.warn(`${colors.yellow}Item sin fecha en feed ${url}: ${item.title || 'Sin título'}${colors.reset}`);
              sourceReport.itemsWithoutDate++;
              continue;
            }

            const date = new Date(dateStr);
            if (!sourceReport.latestItemDate || date > new Date(sourceReport.latestItemDate)) {
              sourceReport.latestItemDate = date.toISOString();
            }
            const cleanUrl = normalizeYouTubeUrl(cleanGoogleRedirectUrl(this.decodeHtml(item.link)));
            
            if (!cleanUrl) {
              console.warn(`${colors.yellow}URL inválida en feed ${url}: ${item.title || 'Sin título'}${colors.reset}`);
              continue;
            }

            const rawDescription = item.content || item.contentSnippet || item.summary || '';
            const manualDecision = this.getManualDecisionForUrl(cleanUrl);
            const isManuallyAccepted = manualDecision?.status === 'accepted';

            // Check if URL is from social media
            if (!isManuallyAccepted && this.isSocialMediaUrl(cleanUrl)) {
              console.log(`${colors.yellow}Ignorando URL de red social: ${cleanUrl}${colors.reset}`);
              this.addIgnoredItem(cleanUrl, 'URL de red social', item.title, date.toISOString());
              continue;
            }

            // Check if URL is banned
            if (!isManuallyAccepted && this.isBannedUrl(cleanUrl)) {
              console.log(`${colors.yellow}Ignorando URL prohibida: ${cleanUrl}${colors.reset}`);
              this.addIgnoredItem(cleanUrl, 'URL prohibida', item.title, date.toISOString());
              continue;
            }

            // Deterministic job-offer detection (no AI tokens)
            if (!isManuallyAccepted && this.isJobOffer(item.title, rawDescription)) {
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
                sourceFeedUrl: url,
                sourceRelevanceMode: source.relevanceMode,
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
            sourceReport.status = 'partial';
            sourceReport.errors.push({
              stage: 'process_item',
              message: itemErr.message,
              itemTitle: item.title || ''
            });
            continue;
          }
        }
        sourceReport.processedItems = processedItems;
        console.log(`${colors.green}Feed ${url} completado. Items procesados: ${processedItems}${colors.reset}`);
      } catch (err) {
        console.error(`${colors.red}Error parsing feed ${url}: ${err.message}${colors.reset}`);
        sourceReport.status = 'failed';
        sourceReport.fetchAttempts = err.attempts || sourceReport.fetchAttempts;
        sourceReport.lastHttpStatus = err.lastStatus || err.status || sourceReport.lastHttpStatus;
        sourceReport.errors.push({
          stage: 'parse_feed',
          message: err.message,
          attempts: sourceReport.fetchAttempts,
          httpStatus: sourceReport.lastHttpStatus,
          responseHeaders: err.responseHeaders || {},
          bodyPreview: err.bodyPreview || ''
        });
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

    let manualDecisionCount = 0;
    combinedItems.forEach(item => {
      if (this.applyManualDecision(item)) {
        manualDecisionCount++;
      }
    });
    if (manualDecisionCount > 0) {
      console.log(`${colors.green}Aplicadas ${manualDecisionCount} decisiones manuales de curación${colors.reset}`);
    }

    // Evaluate ignore_rules with OpenAI if enabled (only unprocessed)
    if (processWithOpenAI && !shouldUseOpenAI) {
      console.warn(`${colors.yellow}OPENAI_API_KEY no configurada. Se omite clasificación AI y solo se aplican reglas deterministas.${colors.reset}`);
    }

    if (shouldUseOpenAI) {
      const pending = combinedItems.filter(item => !item.processed).length;
      console.log(`${colors.cyan}Evaluando ${pending} items con OpenAI (ignore_rules)...${colors.reset}`);
      let idx = 0;
      for (const item of combinedItems) {
        if (!item.processed) {
          idx++;
          const deterministicReason = this.getDeterministicIgnoreReason(item);
          if (deterministicReason) {
            item.ignored = true;
            item.ignoreReason = deterministicReason;
            item.processed = true;
            console.log(`${colors.yellow}[${idx}/${pending}] IGNORE ${item.link} - ${deterministicReason}${colors.reset}`);
            continue;
          }

          if (this.hasStrongDeveloperProductSignal(item)) {
            item.ignored = false;
            item.ignoreReason = '';
            item.processed = true;
            console.log(`${colors.green}[${idx}/${pending}] KEEP ${item.link} - strong Esri developer product signal${colors.reset}`);
            continue;
          }

          if ((item.sourceRelevanceMode || 'balanced') === 'trusted') {
            item.ignored = false;
            item.ignoreReason = '';
            item.processed = true;
            console.log(`${colors.green}[${idx}/${pending}] KEEP ${item.link} - trusted source${colors.reset}`);
            continue;
          }

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

    return { items: combinedItems, ignoredItems: this.ignoredItems, sourceReports };
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
