# Esri Dev content

Este repositorio monitoriza contenido publicado en Internet sobre tecnologias de desarrollo de Esri y ArcGIS. El script combina varios feeds RSS/Atom, normaliza URLs, elimina duplicados, aplica reglas de filtrado, usa OpenAI para clasificar los casos dudosos y publica los resultados como RSS, JSON y paginas HTML.

Resultados publicados:

- Monitor/revision: https://www.rauljimenez.info/combine_rss_feeds/
- Noticias generadas por dia: https://www.rauljimenez.info/combine_rss_feeds/news/
- Feed RSS principal: https://raw.githubusercontent.com/hhkaos/combine_rss_feeds/refs/heads/main/feeds/arcgis_esri_dev_feed.xml
- Feed JSON principal: `feeds/arcgis_esri_dev_feed.json`
- Items ignorados automaticamente: https://github.com/hhkaos/combine_rss_feeds/blob/main/ignored_items.csv

## Estado actual

El proyecto funciona como un pipeline de curacion semi-automatico:

1. Lee fuentes curadas de Esri, blogs personales, canales de YouTube, repositorios de GitHub, Esri Community, podcasts y Google Alerts desde `src/feedSources.js`.
2. Combina los items de las ultimas 48 horas y conserva el historico ya existente desde los JSON de salida.
3. Limpia redirecciones de Google Alerts, normaliza URLs de YouTube y deduplica por URL.
4. Aplica decisiones manuales guardadas en `data/curation_decisions.jsonl`.
5. Filtra de forma determinista redes sociales, fuentes prohibidas, ofertas de empleo, foros, issues/pulls, datasets, endpoints REST y menciones al ESRI irlandes.
6. Mantiene automaticamente items con senales fuertes de producto developer de Esri.
7. Usa OpenAI solo para los items pendientes que necesitan clasificacion.
8. Genera RSS/XML, JSON, una pagina diaria en `news/` y el indice `news/index.html`.

## Requisitos

- Node.js.
- Dependencias instaladas con `npm install`.
- Variable de entorno `OPENAI_API_KEY` para clasificar items pendientes con OpenAI.

El modelo configurado actualmente para la clasificacion es `gpt-4o-mini`, en `src/services/feedService.js`.

## Instalacion

```bash
npm install
```

Para ejecutar el pipeline:

```bash
OPENAI_API_KEY="tu_api_key" npm start
```

Si la variable `OPENAI_API_KEY` ya esta exportada en la shell:

```bash
npm start
```

Para comprobar si los feeds que fallaron en la ultima ejecucion vuelven a devolver HTTP 200:

```bash
npm run check:feeds
```

Para comprobar todas las fuentes curadas:

```bash
npm run check:feeds:all
```

## Salidas generadas

Cada ejecucion actualiza o crea estos archivos:

- `feeds/combined_feeds_<DD-MM-YYYY>.xml`: feed combinado del dia, sin clasificacion OpenAI.
- `feeds/combined_feeds.json`: version JSON acumulada del feed combinado.
- `feeds/arcgis_esri_dev_feed.xml`: feed RSS principal curado.
- `feeds/arcgis_esri_dev_feed.json`: feed JSON principal usado por la pagina de revision.
- `news/news_<DD-MM-YYYY>.html`: tabla HTML diaria con los items no ignorados.
- `news/index.html`: indice de paginas diarias.
- `ignored_items.csv`: items descartados antes de entrar al feed principal, por ejemplo duplicados, redes sociales, URLs prohibidas u ofertas de empleo.

## Pagina de revision

`index.html` es una aplicacion estatica que carga:

- `feeds/arcgis_esri_dev_feed.json`
- `ignored_items.csv`
- `data/curation_decisions.jsonl`

Como usa `fetch`, conviene abrirla desde un servidor local y no directamente como archivo:

```bash
python3 -m http.server 8000
```

Despues abre:

```text
http://localhost:8000/
```

La pagina permite revisar items pendientes, aceptados, ignorados, bloqueados y archivados. Las decisiones se guardan primero en el navegador y se pueden exportar como JSONL. Para que el pipeline las use en ejecuciones futuras, coloca el JSONL exportado en:

```text
data/curation_decisions.jsonl
```

Formatos de decision soportados:

- `accepted`: fuerza mantener el item.
- `rejected`: fuerza ignorarlo.
- `needs_rule`: marca el item como candidato para crear o mejorar reglas automaticas.
- `archived`: oculta historicos ya revisados sin contarlos como aceptados.

En la siguiente ejecucion, `npm start` aplica esas decisiones antes de llamar a OpenAI.

## Configuracion

Los archivos de configuracion estan en `config/`:

- `social_media_urls.json`: dominios de redes sociales que se ignoran.
- `banned_urls.json`: dominios o patrones de URL prohibidos, como portales de empleo, fuentes excluidas, portales open data y endpoints REST.
- `ignore_rules.json`: reglas descriptivas usadas como referencia de clasificacion.
- `github_discovery.json`: parametros del descubrimiento de repos GitHub (topics, ventanas, umbral de estrellas). Ver seccion "Descubrimiento de repositorios GitHub".

Las fuentes RSS/Atom se editan en `src/feedSources.js`:

- `curatedUrls`: fuentes curadas y generalmente relevantes.
- `googleAlertUrls`: feeds de Google Alerts, mas ruidosos.
- `sourceRelevanceOverrides`: excepciones para fuentes curadas que necesitan una clasificacion mas estricta.

## Modos de relevancia

Las fuentes pueden pasarse como strings simples o como objetos con `relevanceMode`:

```js
{ url: 'https://www.google.com/alerts/feeds/...', relevanceMode: 'strict' }
```

En `src/feedSources.js`, la mayoria de fuentes curadas usan `trusted`, Google Alerts usa `strict`, y fuentes concretas pueden moverse a `balanced` con `sourceRelevanceOverrides`:

```js
const sourceRelevanceOverrides = new Map([
  ['https://josiahparry.com/index.xml', 'balanced']
]);
```

Modos soportados:

- `trusted`: para fuentes curadas de Esri o claramente developer. Se mantienen por defecto salvo que disparen una regla dura: empleo, foros, GitHub issues/pulls, datasets/endpoints, URLs prohibidas, redes sociales o ESRI irlandes.
- `balanced`: comportamiento intermedio para fuentes mixtas pero generalmente relevantes.
- `strict`: para fuentes ruidosas como Google Alerts. Solo mantiene items con relacion clara con Esri Inc., ArcGIS o tecnologias geoespaciales para desarrolladores.

Antes de llamar a OpenAI, el script mantiene items con senales fuertes de producto developer como `ArcGIS Maps SDK for JavaScript`, `ArcGIS Maps SDK for .NET`, `ArcGIS API for Python`, `ArcGIS REST JS`, `Esri Leaflet`, `Calcite Design System`, `ArcGIS Arcade`, `ArcPy` o `Experience Builder Developer Edition`, incluso si llegan con marcado HTML de Google Alerts.

## Descubrimiento de repositorios GitHub

Ademas de los feeds fijos, el pipeline descubre automaticamente repositorios nuevos de GitHub utiles para desarrolladores ArcGIS/Esri y los mete en el feed principal para revision humana. No monitoriza commits: solo repos nuevos, repos con traccion y, una vez aprobados, sus releases.

Se ejecuta al principio de `npm start` (o de forma aislada con `npm run discover`). Si falla, el pipeline continua sin bloquearse.

### Dos ejes de descubrimiento

- **`created`**: repos recien publicados (`created:>fecha`). Sin umbral de estrellas, porque los repos nuevos nacen con 0.
- **`pushed`**: repos con actividad reciente y traccion (`pushed:>fecha stars:>N`). El umbral de estrellas recorta el ruido.

Ambos ejes se guian por *topics* de GitHub (`topic:arcgis`, `topic:experience-builder`, etc.) mas algunas queries de palabra clave. Los topics son la senal limpia: gente que etiqueta su repo suele ser desarrollador consciente.

### Clasificacion devtool vs consumer

Cada repo nuevo pasa por:

1. **Prefiltro determinista** (sin tokens): descarta forks, archivados y repos sin descripcion ni topics.
2. **Clasificacion OpenAI** con `gpt-4o-mini`, que devuelve JSON `{relevant, category, reason, summary}`:
   - `category: "devtool"`: pensado para que otros desarrolladores lo reutilicen (libreria, widget, SDK, plugin, template, herramienta).
   - `category: "consumer"`: app o demo orientada a usuario final, portfolio o proyecto puntual.
   - `relevant: false`: se marca como ignorado y no aparece para revision.

Los items relevantes entran al feed principal con `categories: ["repo", "repo:devtool"|"repo:consumer"]`, visibles como `<category>` en el RSS y como campo `categories` en el JSON. La fecha del item es `created_at` o `pushed_at` del repo, y no les afecta el filtro de 48 horas.

### El modelo aprende tu criterio (few-shot)

La clasificacion inyecta como ejemplos few-shot tus decisiones previas sobre repos de GitHub tomadas desde `data/curation_decisions.jsonl` (aceptados -> KEEP, rechazados -> IGNORE). Cuantas mas decisiones acumules revisando repos, mejor calca el modelo tu criterio, sin reentrenar nada. El numero de ejemplos se controla con `maxFewShotExamples`.

### Releases de repos aprobados

Cuando apruebas (`accepted`) un repo desde la pagina de revision, en la siguiente ejecucion su `releases.atom` se monitoriza automaticamente como fuente `trusted`. Asi las nuevas releases fluyen sin curacion adicional. Se desactiva con `monitorAcceptedReleases: false`.

### Estado y configuracion

- `data/github_repos_seen.json`: registro de repos ya vistos (dedup + estado). Se versiona en git para que el estado persista entre ejecuciones de CI. No lo borres o se reprocesaran todos.
- `config/github_discovery.json`: topics, palabras clave, ventanas (`sinceDaysCreated`, `sinceDaysPushed`), umbral `minStarsPushed`, `maxReposPerQuery` y `requestDelayMs`. Ajusta aqui el criterio sin tocar codigo. Pon `enabled: false` para desactivar el descubrimiento.

### Variables de entorno

- `OPENAI_API_KEY`: sin ella, los repos no se clasifican (entran como `unknown` para revision manual).
- `GITHUB_TOKEN` (o `GH_TOKEN`), opcional: sube el rate limit de la Search API de GitHub de 10 a 30 req/min. Sin token funciona igual, solo mas lento.

### Volumen esperado

Con los topics por defecto, el volumen humano de revision ronda 2-4 repos/dia las primeras semanas y baja a ~1-2/dia cuando el registro ya conoce lo existente. Ajustable subiendo/bajando topics y `minStarsPushed`.

## Flujo recomendado

1. Actualiza fuentes o reglas si hace falta.
2. Ejecuta `npm start`.
3. Revisa `feeds/arcgis_esri_dev_feed.json`, `feeds/arcgis_esri_dev_feed.xml` y la pagina diaria generada en `news/`.
4. Abre el monitor local o publicado para revisar pendientes.
5. Exporta las decisiones manuales desde la pagina.
6. Sustituye o actualiza `data/curation_decisions.jsonl`.
7. Ejecuta de nuevo `npm start` para aplicar la curacion manual.

## Reintentos desde GitHub Actions

El workflow `Update Feeds` se puede ejecutar manualmente desde la pestaña Actions. En ejecuciones manuales, la opcion `preflight_feed_health` esta activada por defecto: primero comprueba que los feeds fallidos en `feeds/feed_status.json` devuelven HTTP 200 y solo despues ejecuta el pipeline.

Si quieres forzar una comprobacion completa antes de actualizar, cambia `feed_health_scope` de `failed` a `all`. El preflight hace varios intentos espaciados para dar margen a los 404 intermitentes de YouTube.

La interfaz estatica no puede comprobar los feeds directamente de forma fiable porque el navegador depende de CORS. Para probarlos sin ejecutar todo el pipeline, usa el workflow manual `Check Feed Health`; actualiza `feeds/feed_health_check.json`, que la interfaz muestra junto al aviso de feeds fallidos.

## Estructura principal

```text
src/index.js                  Orquestacion del pipeline.
src/feedSources.js            Lista compartida de fuentes y modos de relevancia.
src/checkFeedHealth.js        Preflight HTTP 200 para feeds fallidos o todas las fuentes.
src/services/feedService.js   Combinacion, deduplicado, reglas, OpenAI y escritura de feeds.
src/services/githubDiscoveryService.js  Descubrimiento y clasificacion de repos GitHub.
src/services/configService.js Carga de configuracion.
src/utils/fileUtils.js        Utilidades de JSON, decisiones y fechas.
src/utils/urlUtils.js         Limpieza de redirecciones y normalizacion de URLs.
config/                       Reglas y patrones editables.
data/                         Decisiones manuales de curacion y registro de repos GitHub vistos.
feeds/                        Feeds XML/JSON generados.
news/                         Paginas HTML diarias e indice.
index.html                    Monitor web de revision.
```
