const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { loadCurationDecisions, getDecisionId } = require('../utils/fileUtils');

const GITHUB_SEARCH_URL = 'https://api.github.com/search/repositories';
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../../config', 'github_discovery.json');
const DEFAULT_REGISTRY_PATH = path.join(__dirname, '../../data', 'github_repos_seen.json');
const DEFAULT_CURATION_PATH = path.join(__dirname, '../../data', 'curation_decisions.jsonl');

const colors = {
  reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', red: '\x1b[31m'
};

// Matches a repo root URL like https://github.com/owner/name (no /issues, /tree, etc.)
const REPO_ROOT_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/i;

class GithubDiscoveryService {
  constructor(options = {}) {
    this.configPath = options.configPath || DEFAULT_CONFIG_PATH;
    this.registryPath = options.registryPath || DEFAULT_REGISTRY_PATH;
    this.curationPath = options.curationPath || DEFAULT_CURATION_PATH;
    this.config = this.loadConfig();
    this.githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.openai = null;
  }

  loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch (err) {
      console.warn(`${colors.yellow}No se pudo leer github_discovery.json (${err.message}); descubrimiento desactivado.${colors.reset}`);
      return { enabled: false };
    }
  }

  hasOpenAI() {
    return Boolean(this.openaiApiKey);
  }

  getOpenAIClient() {
    if (!this.hasOpenAI()) return null;
    if (!this.openai) this.openai = new OpenAI({ apiKey: this.openaiApiKey });
    return this.openai;
  }

  loadRegistry() {
    try {
      if (fs.existsSync(this.registryPath)) {
        const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
        if (data && typeof data.repos === 'object') return data;
      }
    } catch (err) {
      console.warn(`${colors.yellow}Registro de repos ilegible (${err.message}); se recrea.${colors.reset}`);
    }
    return { lastRun: null, repos: {} };
  }

  saveRegistry(registry) {
    registry.lastRun = new Date().toISOString();
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf8');
  }

  sinceDate(days) {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, Number(days) || 1));
    return d.toISOString().slice(0, 10);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  buildQueries() {
    const cfg = this.config;
    const sinceCreated = this.sinceDate(cfg.sinceDaysCreated);
    const sincePushed = this.sinceDate(cfg.sinceDaysPushed);
    const minStars = Number(cfg.minStarsPushed) || 0;
    const topics = Array.isArray(cfg.topics) ? cfg.topics : [];
    const kwCreated = Array.isArray(cfg.keywordQueriesCreated) ? cfg.keywordQueriesCreated : [];
    const kwPushed = Array.isArray(cfg.keywordQueriesPushed) ? cfg.keywordQueriesPushed : [];
    const queries = [];

    // created axis: no star threshold (new repos are born with 0 stars).
    topics.forEach(t => queries.push({ axis: 'created', q: `topic:${t} created:>${sinceCreated}` }));
    kwCreated.forEach(k => queries.push({ axis: 'created', q: `${k} created:>${sinceCreated}` }));

    // pushed axis (traction): require a star floor to cut noise.
    const starClause = minStars > 0 ? ` stars:>${minStars}` : '';
    topics.forEach(t => queries.push({ axis: 'pushed', q: `topic:${t} pushed:>${sincePushed}${starClause}` }));
    kwPushed.forEach(k => queries.push({ axis: 'pushed', q: `${k} pushed:>${sincePushed}${starClause}` }));

    return queries;
  }

  async searchRepos(q) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ArcGISDeveloperFeedBot/1.0 (+https://developers.arcgis.com)',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (this.githubToken) headers['Authorization'] = `Bearer ${this.githubToken}`;

    const perPage = Math.min(100, Math.max(1, Number(this.config.maxReposPerQuery) || 30));
    const url = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${perPage}`;

    const res = await fetch(url, { headers });
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const err = new Error(`GitHub rate limit (status ${res.status}, remaining ${remaining})`);
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GitHub search HTTP ${res.status}`);
    }
    const body = await res.json();
    return Array.isArray(body.items) ? body.items : [];
  }

  // Deterministic prefilter: drop obvious noise before spending OpenAI tokens.
  passesPrefilter(repo) {
    if (repo.fork) return false;
    if (repo.archived) return false;
    if (repo.disabled) return false;
    const desc = (repo.description || '').trim();
    const topics = Array.isArray(repo.topics) ? repo.topics : [];
    // Require some signal: a description or topics. Bare repos are usually throwaways.
    if (!desc && topics.length === 0) return false;
    return true;
  }

  // Few-shot examples from the human's own past decisions on GitHub repos.
  // This is how the classifier learns the curator's criteria over time.
  buildFewShot(curationDecisions) {
    const max = Number(this.config.maxFewShotExamples) || 20;
    const examples = [];
    for (const decision of curationDecisions.values()) {
      if (examples.length >= max) break;
      const url = decision.url || decision.id || '';
      const m = REPO_ROOT_RE.exec(String(url));
      if (!m) continue;
      if (decision.status !== 'accepted' && decision.status !== 'rejected') continue;
      examples.push({
        repo: `${m[1]}/${m[2]}`,
        title: decision.title || '',
        verdict: decision.status === 'accepted' ? 'KEEP' : 'IGNORE',
        note: decision.notes || decision.reason || ''
      });
    }
    return examples;
  }

  async classifyRepo(repo, fewShot) {
    const openai = this.getOpenAIClient();
    if (!openai) {
      // No AI: keep for human review, category unknown.
      return { relevant: true, category: 'unknown', reason: '', summary: repo.description || '' };
    }

    const topics = Array.isArray(repo.topics) ? repo.topics.join(', ') : '';
    const fewShotText = fewShot.length
      ? '\n\nDecisiones previas del curador (imita su criterio):\n' +
        fewShot.map(e => `- ${e.repo} -> ${e.verdict}${e.note ? ` (${e.note})` : ''}`).join('\n')
      : '';

    const systemMsg = `Clasificas repositorios de GitHub para un feed dirigido a DESARROLLADORES de ArcGIS/Esri.

Devuelve SOLO un objeto JSON valido, sin markdown, con esta forma exacta:
{"relevant": true|false, "category": "devtool"|"consumer", "reason": "breve", "summary": "1 frase"}

- relevant=true si el repo es util para desarrolladores ArcGIS/Esri: librerias, SDKs, widgets, plugins, componentes, herramientas CLI, plantillas/samples de codigo, integraciones. IGNORA (relevant=false): proyectos de practica/curso, forks triviales, datasets, apps sin relacion con Esri, o menciones tangenciales a ArcGIS.
- category="devtool": pensado para que OTROS desarrolladores lo reutilicen (libreria, widget, SDK, plugin, template, componente, herramienta).
- category="consumer": app o demo orientada a usuario final, portfolio, visor puntual, proyecto one-off aunque use ArcGIS.${fewShotText}`;

    const userMsg = `Repo: ${repo.full_name}
Descripcion: ${repo.description || '(sin descripcion)'}
Topics: ${topics || '(ninguno)'}
Lenguaje: ${repo.language || '(desconocido)'}
Estrellas: ${repo.stargazers_count || 0}
URL: ${repo.html_url}`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg }
        ],
        max_tokens: 120,
        temperature: 0,
        response_format: { type: 'json_object' }
      });
      const raw = (response.choices[0].message.content || '').trim();
      const parsed = JSON.parse(raw);
      const category = parsed.category === 'consumer' ? 'consumer' : 'devtool';
      return {
        relevant: parsed.relevant !== false,
        category,
        reason: String(parsed.reason || '').slice(0, 200),
        summary: String(parsed.summary || repo.description || '').slice(0, 300)
      };
    } catch (err) {
      console.warn(`${colors.yellow}Error clasificando ${repo.full_name}: ${err.message}; se deja para revision humana.${colors.reset}`);
      return { relevant: true, category: 'unknown', reason: '', summary: repo.description || '' };
    }
  }

  buildFeedItem(repo, axis, classification) {
    const topics = Array.isArray(repo.topics) ? repo.topics : [];
    const date = axis === 'created' ? repo.created_at : (repo.pushed_at || repo.created_at);
    const descLines = [
      repo.description || '',
      '',
      classification.summary && classification.summary !== repo.description ? classification.summary : '',
      `Topics: ${topics.join(', ') || '—'} · ⭐ ${repo.stargazers_count || 0} · ${repo.language || '—'}`,
      `GitHub repo descubierto (${axis} · ${classification.category})`
    ].filter(Boolean);

    return {
      title: `${repo.full_name}${repo.description ? `: ${repo.description}` : ''}`,
      description: descLines.join('\n'),
      link: repo.html_url,
      guid: repo.html_url,
      author: repo.owner ? repo.owner.login : '',
      date: new Date(date || Date.now()).toISOString(),
      sourceFeedUrl: `github-discovery:${axis}`,
      sourceRelevanceMode: 'balanced',
      processed: true,
      ignored: !classification.relevant,
      ignoreReason: classification.relevant ? '' : (classification.reason || 'No relevante para desarrolladores ArcGIS'),
      categories: ['repo', `repo:${classification.category}`],
      repoCategory: classification.category,
      discoverySummary: classification.summary
    };
  }

  // releases.atom feeds for repos the human has accepted, so new releases flow
  // automatically without further curation.
  buildReleaseFeedUrls(registry, curationDecisions) {
    if (this.config.monitorAcceptedReleases === false) return [];
    const urls = [];
    Object.values(registry.repos).forEach(entry => {
      const decision = curationDecisions.get(getDecisionId(entry.htmlUrl));
      if (decision && decision.status === 'accepted' && entry.htmlUrl) {
        urls.push(`${entry.htmlUrl.replace(/\/$/, '')}/releases.atom`);
      }
    });
    return Array.from(new Set(urls));
  }

  async run() {
    if (!this.config.enabled) {
      console.log(`${colors.yellow}Descubrimiento GitHub desactivado (config.enabled=false).${colors.reset}`);
      return { items: [], releaseFeedUrls: [], stats: { discovered: 0, classified: 0, kept: 0 } };
    }

    console.log(`${colors.cyan}== Descubrimiento de repos GitHub ==${colors.reset}`);
    const registry = this.loadRegistry();
    const curationDecisions = loadCurationDecisions(this.curationPath);
    const fewShot = this.buildFewShot(curationDecisions);
    console.log(`${colors.blue}Few-shot desde decisiones previas: ${fewShot.length} ejemplos${colors.reset}`);

    const queries = this.buildQueries();
    const delayMs = Number(this.config.requestDelayMs) || 2500;
    const newByFullName = new Map(); // dedup within this run; prefer 'created' axis label

    let rateLimited = false;
    for (const { axis, q } of queries) {
      if (rateLimited) break;
      try {
        const repos = await this.searchRepos(q);
        console.log(`${colors.blue}[${axis}] "${q}" -> ${repos.length} repos${colors.reset}`);
        repos.forEach(repo => {
          const key = (repo.full_name || '').toLowerCase();
          if (!key) return;
          if (registry.repos[repo.full_name]) return;      // already seen in a past run
          if (newByFullName.has(key)) return;              // already picked this run
          if (!this.passesPrefilter(repo)) return;
          newByFullName.set(key, { repo, axis });
        });
      } catch (err) {
        if (err.rateLimited) {
          console.warn(`${colors.yellow}${err.message}. Corto el descubrimiento; continuara en la proxima ejecucion.${colors.reset}`);
          rateLimited = true;
        } else {
          console.warn(`${colors.yellow}Query fallida "${q}": ${err.message}${colors.reset}`);
        }
      }
      await this.sleep(delayMs);
    }

    console.log(`${colors.cyan}Repos nuevos tras prefiltro: ${newByFullName.size}${colors.reset}`);

    const items = [];
    let kept = 0;
    for (const { repo, axis } of newByFullName.values()) {
      const classification = await this.classifyRepo(repo, fewShot);
      const item = this.buildFeedItem(repo, axis, classification);
      items.push(item);
      if (!item.ignored) kept++;

      registry.repos[repo.full_name] = {
        htmlUrl: repo.html_url,
        firstSeen: new Date().toISOString(),
        createdAt: repo.created_at,
        axis,
        stars: repo.stargazers_count || 0,
        classifiedCategory: classification.category,
        relevant: classification.relevant
      };
      const verdict = item.ignored ? `${colors.yellow}IGNORE` : `${colors.green}KEEP (${classification.category})`;
      console.log(`  ${verdict}${colors.reset} ${repo.full_name}`);
    }

    this.saveRegistry(registry);
    const releaseFeedUrls = this.buildReleaseFeedUrls(registry, curationDecisions);
    console.log(`${colors.green}Descubrimiento: ${items.length} items nuevos (${kept} relevantes), ${releaseFeedUrls.length} feeds de releases monitorizados${colors.reset}`);

    return {
      items,
      releaseFeedUrls,
      stats: { discovered: newByFullName.size, classified: items.length, kept }
    };
  }
}

module.exports = { GithubDiscoveryService };

// Standalone run for testing: node src/services/githubDiscoveryService.js [--dry]
if (require.main === module) {
  const dry = process.argv.includes('--dry');
  const service = new GithubDiscoveryService();
  service.run()
    .then(res => {
      console.log(`\nItems (${res.items.length}):`);
      res.items.forEach(it => console.log(`- [${it.ignored ? 'IGNORE' : it.repoCategory}] ${it.link}`));
      console.log(`\nRelease feeds (${res.releaseFeedUrls.length}):`);
      res.releaseFeedUrls.forEach(u => console.log(`- ${u}`));
      if (dry) console.log('\n(dry: el registro igualmente se guardo)');
    })
    .catch(err => {
      console.error('Discovery error:', err.message);
      process.exit(1);
    });
}
