# Esri Dev content

This repo contains a script that aims to monitor content generated on the Internet about Esri's developer technologies by processing multiple RSS feeds, curating them, categorizing them, and exposing them.

Results can be explored in:
* All retrieved items: https://www.rauljimenez.info/combine_rss_feeds/
* Items generated daily: https://www.rauljimenez.info/combine_rss_feeds/news/
* Ignored items are published into: https://github.com/hhkaos/combine_rss_feeds/blob/main/ignored_items.csv
* And a feed RSS with the items from the last two days is published here: https://raw.githubusercontent.com/hhkaos/combine_rss_feeds/refs/heads/main/feeds/arcgis_esri_dev_feed.xml

## Requirements

It uses and OpenAI API key to summarize, extract the author, categorize, etc.

## Manual curation

The review page lets you mark feed items as accepted, rejected, or blocked. Blocked items are stored as `needs_rule`, meaning they are candidates for blocking similar content automatically later. Historical items that were already processed before this review workflow can be stored as `archived`; they are hidden from pending items without being counted as accepted. The page loads `data/curation_decisions.jsonl` on startup and merges it with local browser decisions. Export new decisions as JSONL and place the file at `data/curation_decisions.jsonl`.

On the next run, `npm start` will apply those manual decisions before calling OpenAI, so reviewed items do not need to be classified again.
