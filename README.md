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

1. Lee fuentes curadas de Esri, blogs personales, canales de YouTube, repositorios de GitHub, Esri Community, podcasts y Google Alerts desde `src/index.js`.
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

Las fuentes RSS/Atom se editan en `src/index.js`:

- `curatedUrls`: fuentes curadas y generalmente relevantes.
- `googleAlertUrls`: feeds de Google Alerts, mas ruidosos.
- `sourceRelevanceOverrides`: excepciones para fuentes curadas que necesitan una clasificacion mas estricta.

## Modos de relevancia

Las fuentes pueden pasarse como strings simples o como objetos con `relevanceMode`:

```js
{ url: 'https://www.google.com/alerts/feeds/...', relevanceMode: 'strict' }
```

En `src/index.js`, la mayoria de fuentes curadas usan `trusted`, Google Alerts usa `strict`, y fuentes concretas pueden moverse a `balanced` con `sourceRelevanceOverrides`:

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

## Flujo recomendado

1. Actualiza fuentes o reglas si hace falta.
2. Ejecuta `npm start`.
3. Revisa `feeds/arcgis_esri_dev_feed.json`, `feeds/arcgis_esri_dev_feed.xml` y la pagina diaria generada en `news/`.
4. Abre el monitor local o publicado para revisar pendientes.
5. Exporta las decisiones manuales desde la pagina.
6. Sustituye o actualiza `data/curation_decisions.jsonl`.
7. Ejecuta de nuevo `npm start` para aplicar la curacion manual.

## Estructura principal

```text
src/index.js                  Orquestacion del pipeline y lista de fuentes.
src/services/feedService.js   Combinacion, deduplicado, reglas, OpenAI y escritura de feeds.
src/services/configService.js Carga de configuracion.
src/utils/fileUtils.js        Utilidades de JSON, decisiones y fechas.
src/utils/urlUtils.js         Limpieza de redirecciones y normalizacion de URLs.
config/                       Reglas y patrones editables.
data/                         Decisiones manuales de curacion.
feeds/                        Feeds XML/JSON generados.
news/                         Paginas HTML diarias e indice.
index.html                    Monitor web de revision.
```
