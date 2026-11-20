# External performance analysis connector

AI Office has a read-only adapter for a performance analysis service. It is inactive until both server secrets are configured:

- `PERFORMANCE_ANALYSIS_URL`: a full HTTPS URL for the summary endpoint.
- `PERFORMANCE_ANALYSIS_API_KEY`: the bearer token. Store it in the server's protected environment, never in the repository or browser.

The endpoint must return JSON with the following canonical shape. A provider-specific mapper can translate its actual response once its API documentation is available.

```json
{
  "observedAt": "2026-11-20T10:00:00Z",
  "from": "2026-11-01",
  "to": "2026-11-19",
  "currency": "INR",
  "metrics": [
    { "name": "Meta spend", "value": 10000, "unit": "INR", "source": "Meta Ads account A", "definition": "Account spend over the stated window" }
  ],
  "insights": [
    { "finding": "Recorded spend rose in the last week", "source": "Meta Ads daily report" }
  ]
}
```

AI Office bounds the response, requires source and metric definitions, and uses figures only if the observation is at most 36 hours old. Missing, stale, or invalid data is explicitly marked unavailable to the strategist. The adapter makes GET requests only and never sends a campaign change to the analysis service.
