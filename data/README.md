# Curation data

Place exported manual decisions in `curation_decisions.jsonl`.

Each line must be one JSON object with at least:

```json
{"url":"https://example.com/item","status":"accepted","reason":"tutorial","reviewedAt":"2026-05-12T20:30:00.000Z"}
```

Supported statuses:

- `accepted`
- `rejected`
- `needs_rule`
- `archived`

Use `needs_rule` for items that should help block similar content automatically later.
Use `archived` for historical items that should not appear as pending but were not necessarily accepted.
