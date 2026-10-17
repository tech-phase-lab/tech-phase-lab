# Automatic headline translation display recovery

Railway staging was verified directly through its authenticated localhost `/live` endpoint: automatic headline translation enabled, 19 eligible and 19 translated, zero pending. OpenAI processing had completed successfully. Do not request another API key or charge.

The preview remained on its bundled September 19 snapshot because `snapshotIssues` rejected one TSM inline TWSE disclosure evidence URL. Rejecting that record caused the entire current snapshot to fall back. The fix validates the exact TWSE disclosure endpoint and its company/date/time/id identity separately from remote article rules. Adding the endpoint to shared `articleRules` would strip its identifying query and break inline ingestion; preserve that distinction.

Regression coverage accepts the observed valid disclosure identity and rejects unrelated paths, hosts, companies, and duplicate query parameters. Verify the preview intake and Japanese home news after deployment; server-side translation completion alone is insufficient.

Relevant preview backend: Railway `research-staging` environment, `research-monitor-staging` service. The production monitor is separate. Keep credentials private and only publish this repair to `codex/research-preview`.
