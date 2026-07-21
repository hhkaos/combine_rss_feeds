const curatedUrls = [
  // Youtube channels
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCgCXcfk5uEraWkpE9wlRwgw', // Esri Developers
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCo7tc3KZgH4GMUcqcSFBLOQ', // Rene Rubalcava
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCd4T7CHv1QlErDtO4PdugMA', // Andrew's GIS & Technology Lessons (Andrew Chapkowski)
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCZZe1tS_wmHYXNoivPeptYw', // Courtney Yatteau
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCVZorTG1_ePfR2Y0ThjMZ2w', // GeoAI Smith (Rami Alouta)
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCX78SUhrloA6Cn3aW_e8C_A', // Josiah Parry
  'https://www.youtube.com/feeds/videos.xml?channel_id=UCOpTBxNvPEe5mHLrdDWdhkQ', // Sean Stone
  'https://www.youtube.com/feeds/videos.xml?channel_id=UC6xUXj3o1YO-5p_9_6adZWQ', // Final Draft Mapping

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

  // Some Esri repositories (releases)
  'https://github.com/Esri/esri-leaflet/releases.atom',
  'https://github.com/Esri/arcgis-rest-js/releases.atom',
  'https://github.com/Esri/maplibre-arcgis/releases.atom',

  // Blogs at Esri Community: see manualCheckSources below.

  // RSS Monitoring changes on some "Release notes" and "What's new pages"
  'https://rss.rauljimenez.info/arcgis-whats-new-changes.xml',
  'https://rss.rauljimenez.info/arcgis-whats-new-monitor-health.xml', // Checking possible errors in the monitor

  // Employee blogs and podcasts
  'https://feed.podbean.com/theboundingbox/feed.xml',
  'https://odoe.net/rss.xml',
  //'https://josiahparry.com/index.xml', // Migrated to https://josiah.rs/ (not RSS feed yet)
  'https://highearthorbit.com/feed/',
  'https://christophermoravec.com/rss/',
  'https://adventuresinmapping.com/feed/',

  // Dev.to
  'https://dev.to/feed/gisfromscratch', // Jan Tschada
  'https://dev.to/feed/hhkaos', // Raul
  'https://dev.to/feed/odoenet', // Rene
  'https://dev.to/feed/jf990', // John Foster
  'https://dev.to/feed/c_yatteau', // Courtney
  'https://dev.to/feed/gavinr', // Gavin
  'https://dev.to/feed/vivek_shukla_4b01a254d1ac', // Vivek

  // Local-only (preserved during merge 2026-05-12)
  'https://feeds.feedburner.com/Codethemap',
  'https://learn.finaldraftmapping.com/feed/'
];

// Blogs at Esri Community.
// Desactivados como feed 2026-07-10: Esri esta migrando community.esri.com y
// Cloudflare responde 403 a las URLs RSS, tanto al pipeline como al navegador.
// Mientras dure la migracion se publican en feed_sources.json con estado
// "manual": no se descargan, solo aparecen en la interfaz con enlace al board
// para revisarlos a mano. Al terminar la migracion, devolverlos a curatedUrls.
const manualCheckSources = [
  ['arcgis-runtime-sdks-blog', 'ArcGIS Maps SDKs Native Blog', 'bg-p', 'arcgis-maps-sdks-native-blog'],
  ['arcgis-pro-sdk-blog', 'ArcGIS Pro SDK Blog', 'bg-p', 'arcgis-pro-sdk-blog'],
  ['arcgis-api-for-javascript-blog', 'ArcGIS JavaScript Maps SDK Blog', 'bg-p', 'arcgis-javascript-maps-sdk-blog'],
  ['arcgis-experience-builder-blog', 'ArcGIS Experience Builder Blog', 'bg-p', 'arcgis-experience-builder-blog'],
  ['arcgis-appstudio-blog', 'ArcGIS AppStudio Blog', 'bg-p', 'arcgis-appstudio-blog'],
  ['geodev-germany-blog', 'GeoDev Germany Blog', 'bg-p', 'geodev-germany-blog'],
  ['python-blog', 'Python Blog', 'bg-p', 'python-blog'],
  ['arcgis-rest-js-blog', 'ArcGIS REST JS Blog', 'bg-p', 'arcgis-rest-js-blog'],
  ['certification-exams', 'Esri Technical Certification Exams', 'bg-p', 'esri-technical-certification-exams', 'boardmessages'],
  ['eb-custom-widgetstkb-board', 'Experience Builder Custom Widgets (knowledge base)', 'tkb-p', 'experience-builder-custom-widgets'],
  ['eb-custom-widgetsblog-board', 'Experience Builder Custom Widgets (blog)', 'bg-p', 'experience-builder-custom-widgets'],
  ['learn-arcgis-blog', 'Esri Tutorials Blog', 'bg-p', 'esri-tutorials-blog'],
  ['arcgis-location-platform-blog', 'ArcGIS Location Platform Blog', 'bg-p', 'arcgis-location-platform-blog']
].map(([boardId, title, boardType, slug, rssPath = 'board']) => ({
  name: `${title} | Esri Community`,
  url: `https://community.esri.com/ccqpr47374/rss/${rssPath}?board.id=${boardId}`,
  siteUrl: `https://community.esri.com/t5/${slug}/${boardType}/${boardId}`,
  relevanceMode: 'trusted'
}));

const googleAlertUrls = [
  'https://www.google.com/alerts/feeds/10211086479352302070/8313662974736823766',
  'https://www.google.com/alerts/feeds/10211086479352302070/18422577937220317856',
  'https://www.google.com/alerts/feeds/10211086479352302070/15069651367870606033',
  'https://www.google.com/alerts/feeds/10211086479352302070/3847747534966869067'
];

const sourceRelevanceOverrides = new Map([
  // Curated personal feeds: useful, but not every item is necessarily Esri/ArcGIS developer content.
  ['https://www.youtube.com/feeds/videos.xml?channel_id=UCZZe1tS_wmHYXNoivPeptYw', 'balanced'], // Courtney Yatteau
  ['https://www.youtube.com/feeds/videos.xml?channel_id=UCX78SUhrloA6Cn3aW_e8C_A', 'balanced'], // Josiah Parry
  ['https://josiahparry.com/index.xml', 'balanced']
]);

function withRelevanceMode(urls, relevanceMode, overrides = new Map()) {
  return urls.map(url => ({
    url,
    relevanceMode: overrides.get(url) || relevanceMode
  }));
}

function getFeedSources() {
  return [
    ...withRelevanceMode(curatedUrls, 'trusted', sourceRelevanceOverrides),
    ...withRelevanceMode(googleAlertUrls, 'strict')
  ];
}

function getMonitoredUrls() {
  return curatedUrls;
}

// Fuentes que no se descargan: solo se listan en la interfaz para revisarlas
// a mano. Fuera de getFeedSources y getMonitoredUrls a proposito.
function getManualCheckSources() {
  return manualCheckSources.map(source => ({ ...source }));
}

module.exports = {
  curatedUrls,
  googleAlertUrls,
  manualCheckSources,
  sourceRelevanceOverrides,
  getFeedSources,
  getManualCheckSources,
  getMonitoredUrls,
  withRelevanceMode
};
