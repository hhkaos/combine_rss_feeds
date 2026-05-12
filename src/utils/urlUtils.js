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

// Normalize YouTube URLs to canonical https://www.youtube.com/watch?v=ID form.
// Handles youtu.be/ID, youtube.com/shorts/ID, m.youtube.com, embed/ID, extra query params.
function normalizeYouTubeUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!host.endsWith('youtube.com') && host !== 'youtu.be') return url;

    let videoId = null;
    if (host === 'youtu.be') {
      videoId = u.pathname.slice(1).split('/')[0];
    } else if (u.pathname === '/watch') {
      videoId = u.searchParams.get('v');
    } else {
      const m = u.pathname.match(/^\/(shorts|embed|v|live)\/([^/?#]+)/);
      if (m) videoId = m[2];
    }

    if (!videoId) return url;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch (err) {
    return url;
  }
}

module.exports = {
  sanitizeCData,
  cleanGoogleRedirectUrl,
  normalizeYouTubeUrl
}; 