# System architecture

## Components and data flow

```text
SSI FastConnect v3 (default) ─┐
NEO API (explicit backup) ────┼─> provider recorder -> append-only capture + finalized manifest
Deterministic synthetic data ─┘                         -> normalize / quality flags
                                                       -> curated Parquet
                                                       -> LHS / alerts / paper cost
                                                       -> walk-forward diagnostics
                                                       -> read-only Streamlit research UI
```

### Provider adapters

- `src/neoscope/ssi_api/` uses the official SSI Python SDK and subscribes to market-data streams only. Its callback enqueues decoded messages to a bounded single-writer queue so disk compression does not block the SDK reader thread; queue saturation marks the capture failed instead of silently dropping data. SSI topic records are preserved and the adapter emits canonical records only where fields and units are understood. It does not instantiate trading clients.
- `src/neoscope/neo_api/` preserves the original VPBankS NEO REST/WebSocket integration as an explicit backup source.
- `src/neoscope/synth/` generates deterministic, clearly labeled sessions and known injected events for pipeline and alert-mechanism studies.

The provider is chosen explicitly with `NEOSCOPE_PROVIDER` (`SSI` default; `NEO` backup) and `NEOSCOPE_MODE=LIVE`. The recorder does not automatically switch providers. Provider-specific directories, dashboard data selection, caches, and analysis outputs are isolated. Stop and restart the recorder when switching. This operational rule avoids mixing incompatible timestamps, update cadence, field coverage, and units in a nominally continuous session.

### Storage and transformations

`data/raw/<provider_session>/` stores compressed JSON Lines per channel, preserving decoded provider-shaped fields, local arrival timestamp, sequence, provider metadata, configuration hash, counts, and SHA-256 file hashes in a finalized session manifest. SDK-backed SSI records are decoded objects, not packet-level copies of wire bytes. Each live recorder start has a unique capture suffix, so restarting never appends new records to an old capture with a reset sequence. Recorders stop at Vietnam calendar-day rollover; start a new capture for the next date. Canonical records are additional derived channels, not replacements for decoded source fields. `neoscope process` parses, normalizes, deduplicates, derives counter deltas, flags data quality, and writes curated Parquet under the matching capture name. Analysis outputs are stored under `data/results/<provider>/` for live sessions and in the existing `data/results/` namespace for the committed synthetic example set.

### Analysis and presentation

The analytics layer uses the selected namespace only. It computes microstructure features, relative LHS, expanding-history alerts, order scenarios, calibration folds, bootstrap comparisons, and diagnostics. The simulator is isolated from provider clients and cannot send an order. The Streamlit application reads curated data and result artifacts; it has no order-entry form or trading client.

### Operations and trust boundaries

- Credentials are read from environment variables; `.env` is excluded from version control. Never place keys in YAML, manifests, logs, notebook output, or screenshots.
- Market-data entitlement and legal permitted use are governed by provider agreements, not by the software.
- RAW is append/write oriented during a session; post-capture transformations are reproducible from it. Filesystem permissions and backup retention remain deployment responsibilities.
- The CLI binds the dashboard to loopback and retains Streamlit's default CORS and XSRF protections. Production hosting still requires an authenticated reverse proxy, TLS, network restrictions, secure headers, secrets management, audit/retention policy, monitoring, and a reviewed threat model.
- No claim of ISO 27001, SOC 2, exchange certification, or production operational resilience is made by this prototype.

## Key modules

| Concern | Implementation |
|---|---|
| Settings and secret boundary | `src/neoscope/config.py`, `config/settings.yaml`, `.env.example` |
| SSI read-only stream | `src/neoscope/ssi_api/` |
| NEO backup | `src/neoscope/neo_api/` |
| RAW manifest and namespace | `src/neoscope/data/store.py` |
| Normalize and curate | `src/neoscope/data/normalize.py`, `src/neoscope/data/pipeline.py` |
| Measures and validation | `src/neoscope/finance/`, `src/neoscope/analytics/` |
| Paper execution only | `src/neoscope/simulator/matching.py` |
| Read-only research dashboard | `src/neoscope/app/` |
