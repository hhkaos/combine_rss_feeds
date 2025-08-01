# Esri Dev content

This repo contains a script that aims to monitor content generated on the Internet about Esri's developer technologies by processing multiple RSS feeds, curating them, categorizing them, and exposing them.

Results can be explored in:
* All retrieved items: https://www.rauljimenez.info/combine_rss_feeds/
* Items generated daily: https://www.rauljimenez.info/combine_rss_feeds/news/
* Ignored items are published into: https://github.com/hhkaos/combine_rss_feeds/blob/main/ignored_items.csv
* And a feed RSS with the items from the last two days is published here: https://raw.githubusercontent.com/hhkaos/combine_rss_feeds/refs/heads/main/feeds/arcgis_esri_dev_feed.xml

## Requirements

It uses and OpenAI API key to summarize, extract the author, categorize, etc.
