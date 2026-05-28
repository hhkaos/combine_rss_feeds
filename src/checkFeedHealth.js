const fs = require('fs');
const path = require('path');
const { getMonitoredUrls } = require('./feedSources');

const DEFAULTS = {
  timeoutMs: Number(process.env.FEED_HEALTH_TIMEOUT_MS || 20000),
  maxAttempts: Number(process.env.FEED_HEALTH_MAX_ATTEMPTS || 3),
  retryDelayMs: Number(process.env.FEED_HEALTH_RETRY_DELAY_MS || 10000),
  concurrency: Number(process.env.FEED_HEALTH_CONCURRENCY || 4)
};

function parseArgs(argv) {
  const args = {
    all: false,
    failedFrom: '',
    output: path.join(__dirname, '../feeds/feed_health_check.json')
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--all') {
      args.all = true;
    } else if (arg === '--failed-from') {
      args.failedFrom = argv[++index] || '';
    } else if (arg === '--output') {
      args.output = argv[++index] || args.output;
    }
  }

  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadFailedUrls(statusPath) {
  if (!statusPath || !fs.existsSync(statusPath)) return null;

  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  return (status.sources || [])
    .filter(source => source.status !== 'ok')
    .map(source => source.url)
    .filter(Boolean);
}

async function fetchStatus(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULTS.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (compatible; ArcGISDeveloperFeedHealthCheck/1.0; +https://developers.arcgis.com)'
      }
    });

    await response.arrayBuffer();
    return {
      ok: response.status === 200,
      status: response.status,
      statusText: response.statusText
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(url) {
  let lastResult = null;

  for (let attempt = 1; attempt <= DEFAULTS.maxAttempts; attempt++) {
    try {
      const result = await fetchStatus(url);
      lastResult = { ...result, attempt };

      if (result.ok) {
        console.log(`OK ${result.status} ${url}`);
        return {
          url,
          ok: true,
          status: result.status,
          attempts: attempt,
          checkedAt: new Date().toISOString()
        };
      }

      console.warn(`WAIT ${result.status} ${url} (attempt ${attempt}/${DEFAULTS.maxAttempts})`);
    } catch (err) {
      lastResult = {
        ok: false,
        status: null,
        statusText: err.name === 'AbortError' ? 'Timeout' : err.message,
        attempt
      };
      console.warn(`WAIT ${lastResult.statusText} ${url} (attempt ${attempt}/${DEFAULTS.maxAttempts})`);
    }

    if (attempt < DEFAULTS.maxAttempts) {
      await sleep(DEFAULTS.retryDelayMs);
    }
  }

  return {
    url,
    ok: false,
    status: lastResult?.status || null,
    error: lastResult?.statusText || 'Unknown error',
    attempts: DEFAULTS.maxAttempts,
    checkedAt: new Date().toISOString()
  };
}

async function runWithConcurrency(items, worker, concurrency) {
  const results = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const failedUrls = args.failedFrom ? loadFailedUrls(args.failedFrom) : [];
  const urls = args.all
    ? getMonitoredUrls()
    : (failedUrls || getMonitoredUrls());
  const uniqueUrls = Array.from(new Set(urls));

  if (!uniqueUrls.length) {
    console.log('No feeds need a health check.');
    return;
  }

  console.log(`Checking ${uniqueUrls.length} feed(s) for HTTP 200...`);
  const checks = await runWithConcurrency(uniqueUrls, checkUrl, DEFAULTS.concurrency);

  const failed = checks.filter(check => !check.ok);
  const report = {
    lastUpdated: new Date().toISOString(),
    ok: failed.length === 0,
    totalFeeds: checks.length,
    failedFeeds: failed.length,
    checks
  };

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(report, null, 2), 'utf8');
  console.log(`Feed health report written to ${args.output}`);

  if (failed.length > 0) {
    console.error(`${failed.length} feed(s) are not returning HTTP 200 yet.`);
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(`Feed health check failed: ${err.message}`);
  process.exitCode = 1;
});
