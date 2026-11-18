# NeoScope

NeoScope is a market microstructure research and decision-support product for Vietnamese equities. It turns timestamped order-book and trade data into liquidity diagnostics, simulated execution-cost estimates, anomaly alerts, and walk-forward validation results.

**Live provider:** SSI FastConnect API v3 by default. VPBankS NEO API is retained as an explicit backup source. **No real order entry is implemented.** Synthetic mode remains available without broker credentials and is always labeled as synthetic.

## Research questions

1. How do quoted spread, displayed depth, imbalance, and intraday volatility vary across liquid and thinner Vietnamese equities?
2. How well do observable book conditions explain simulated market-impact and execution cost at different order sizes?
3. Do calibrated liquidity scores and alerts retain useful performance on later sessions under a leakage-resistant walk-forward design?

The product is designed as a reproducible research lab, not a trading recommendation system. Simulation, calibration, and predictive claims must be read with their data coverage and validation limits.

## Learning and research outcomes

The product makes the revised Bloom progression observable in deliverables:

| Level | User action | Product evidence |
|---|---|---|
| Remember | Identify provider topics, canonical fields, units, and limitations | NEO/SSI provider mappings and data dictionary |
| Understand | Explain why spread, depth, imbalance, and adverse-selection proxies matter | Research dashboard and method notes |
| Apply | Capture a session and reproduce normalized measures | Provider recorder, append-only capture with finalized SHA-256 manifest, and curated pipeline |
| Analyze | Compare liquidity regimes and decompose execution cost | LHS, microstructure measures, alerts, and paper simulator |
| Evaluate | Judge stability and uncertainty on later sessions | Walk-forward folds, cluster bootstrap, coverage, and quality diagnostics |
| Create | Formulate a follow-up hypothesis and define a cohort/evaluation protocol | Reusable session data, config-driven cohorts, and reproducible pipeline |

Scores and alerts support investigation; they do not substitute for a researcher's interpretation or independent validation.

## Start

Python 3.11 or later is required.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
neoscope --mode SYNTHETIC all --force
neoscope --mode SYNTHETIC app
```

The explicit mode flag takes precedence over a machine-level `NEOSCOPE_MODE`, so the offline demo still works when the shell is configured for LIVE. Open the localhost Streamlit URL shown in the terminal. The synthetic banner and manifest identify simulated data; never cite these outputs as market evidence.

## Live provider selection

SSI FastConnect v3 is the primary live provider. Create an SSI Market Data key and add `SSI_CLIENT_ID`, `SSI_API_KEY`, and `SSI_API_SECRET` to `.env`. Set `NEOSCOPE_MODE=LIVE`; `NEOSCOPE_PROVIDER=SSI` is the default.

NEO is the backup source. Add `NEO_USERNAME` and `NEO_PASSWORD` to `.env`; `NEO_DEVICE_ID` is optional. If SSI is unavailable, stop the recorder, set `NEOSCOPE_PROVIDER=NEO`, and restart. Return to SSI by setting `NEOSCOPE_PROVIDER=SSI`. Selection is explicit; the application never silently switches providers within a session. This preserves a visible source boundary and avoids combining vendor feeds with different field and timing semantics.

### Course requirement and approved source exception

The supplied course brief names NEO API as the default core source and permits SSI as a supplement. The instructor has approved SSI FastConnect as a complete substitute for this project, so SSI is the primary live source and VPBankS NEO remains an optional backup adapter. Attach the instructor's approval evidence to the submission so the evaluator can apply the approved source choice when reading the rubric. See the [course brief](docs/de-bai/De-thi-cuoi-ky-NEO-API.docx) and [as-built product dossier](docs/as-built-product-dossier.md).

Start the selected source during a market session:

```powershell
neoscope --mode LIVE record
neoscope process
neoscope analyze
neoscope validate
neoscope --mode LIVE app
```

SSI depth is collected through its quote stream. The NEO recorder can also take a REST snapshot with `neoscope snapshot`. Each recorder start gets a unique capture directory beginning `LIVE_SSI_<date>_...` or `LIVE_NEO_<date>_...`; live results are separated by provider under `data/results/`. Do not treat sessions from different providers as one uninterrupted time series without a documented reconciliation study.

SSI's published quote examples express book prices in VND thousands while trade messages express prices in VND. Its adapter scales quote-book and market-band prices by 1,000 into canonical VND. SDK-decoded, provider-shaped messages are retained for audit; these are not packet-level copies of original wire bytes. Foreign buy/sell fields stay in SSI RAW messages until SSI confirms their counter semantics. Provider-specific missing fields remain null.

## Product flow

```text
SSI primary / NEO backup ───────┐
                               ├─ source-isolated RAW → normalization & quality flags
Reproducible synthetic stream ─┘          → microstructure indicators → 1m bars
                                              → alerts / LHS / execution simulator
                                              → session-clustered walk-forward validation
                                              → Streamlit research dashboard
```

The dashboard is organized into seven pages under **Analysis** and **Research administration**. The overview starts with session/watchlist KPIs (spread, displayed depth, LHS and alerts), paired market-breadth/liquidity-rank charts, and the selected-symbol table. A shared session/watchlist filter, provider/mode state, last event timestamp, and refresh control remain visible across the workflow. The other pages cover LHS composition, paper execution, alert evidence, out-of-sample validation, data quality, and methods/limits. Empty, stale, and unavailable-data states explain what the user can check next. The paper matching engine is isolated from all provider clients.

## Reproducibility and safety

- Each RAW session records source/provider metadata, local arrival timestamps, sequence numbers, configuration hash, message counts, and SHA-256 digests.
- Original provider messages are retained beside canonical records; derived data can be rebuilt with `neoscope process`.
- Credentials are read only from environment variables. Do not commit `.env`, API keys, or live captures.
- NEO, SSI, and synthetic data use separate session directories and result namespaces.
- All prices used by analytics are canonical VND; source-unit conversion is recorded in the manifest.
- Execution costs are simulated estimates with explicit assumptions, not broker quotes or guarantees.

## Main commands

| Command | Purpose |
|---|---|
| `neoscope synth` | Generate deterministic synthetic sessions |
| `neoscope process` | Normalize RAW data and build curated Parquet tables |
| `neoscope analyze` | Calculate scores, alerts, and execution simulation outputs |
| `neoscope validate` | Run walk-forward evaluation and diagnostics |
| `neoscope all` | Run the full synthetic pipeline (or processing stages for LIVE) |
| `neoscope record` | Record selected live provider (SSI default; NEO backup) |
| `neoscope snapshot` | Capture a NEO REST stock-detail snapshot |
| `neoscope app` | Open the dashboard |

See [docs/provider_contracts.md](docs/provider_contracts.md) for provider roles and fallback steps, [docs/ssi_fastconnect.md](docs/ssi_fastconnect.md) for SSI's primary provider contract, [docs/methodology.md](docs/methodology.md) for measures and assumptions, and [docs/limitations.md](docs/limitations.md) for research limitations.
