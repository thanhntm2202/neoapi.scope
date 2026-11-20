# Provider roles and source isolation

## Roles

- **SSI FastConnect v3 is primary** and is selected by default.
- **SSI is an approved complete replacement for NEO when NEO API is unavailable**, as confirmed by the instructor and permitted by the course brief.
- **NEO remains an optional provider.** Select it when available and required for a separately identified source run.
- Provider choice is explicit through `NEOSCOPE_PROVIDER=NEO|SSI`. NeoScope does not switch sources automatically during a session.
- Synthetic data remains a separate mode and is never treated as market data.

## NEO outage / SSI replacement procedure

1. Stop the NEO recorder after determining the feed is unavailable; record the interruption time and reason in the incident log.
2. Set `NEOSCOPE_MODE=LIVE` and `NEOSCOPE_PROVIDER=SSI` in `.env`.
3. Confirm SSI Market Data credentials and entitlement, then run `neoscope record`.
4. Run `neoscope process`, `neoscope analyze`, and `neoscope validate` against the SSI source namespace.
5. In the report, identify SSI as the approved replacement source and describe its coverage and limitations.

## SSI outage / optional NEO procedure

1. Stop the SSI recorder after determining the feed is unavailable; record the interruption time and reason in the incident log.
2. Set `NEOSCOPE_MODE=LIVE` and `NEOSCOPE_PROVIDER=NEO` in `.env`.
3. Confirm NEO credentials and entitlement, then run `neoscope record`.
4. Run `neoscope process`, `neoscope analyze`, and `neoscope validate` against the NEO source namespace.
5. To resume SSI, stop NEO, set `NEOSCOPE_PROVIDER=SSI`, and restart the recorder. Retain both runs and their incident notes.

The explicit restart makes the source boundary reviewable. Different vendors can differ in scope, price units, timestamp semantics, depth, update cadence, and entitlement. Silent failover could splice non-comparable observations into one session and contaminate liquidity estimates or validation. The recorder status file identifies the active provider; every RAW manifest also records it. SSI's approved replacement status does not make its records NEO records or authorize merging both feeds into one session.

## Storage and analysis isolation

| Source | RAW / curated namespace | Results namespace |
|---|---|---|
| Synthetic | `SYNTH_<date>` | `data/results/` (legacy reproducible set) |
| SSI | `LIVE_SSI_<date>_<time>_<capture-id>` | `data/results/SSI/` |
| NEO | `LIVE_NEO_<date>_<time>_<capture-id>` | `data/results/NEO/` |

Changing providers changes the active dataset selection. RAW captures are preserved. NeoScope does not join a NEO session to an SSI session, nor train one provider's calibration on the other's curated files. A deliberate cross-provider study needs a separate reconciliation protocol for symbols, units, timestamps, coverage, and schema.

## Shared analytical contract

Both adapters emit canonical `stockInfo` and `marketInfo` records where source fields support them. Missing or semantically uncertain fields remain null. SSI's quote-book and market-band prices are converted from the examples' thousand-VND scale; NEO's numeric prices are retained in the source's VND scale. Source payloads stay in topic-specific RAW files for audit and reprocessing. Field-level details and SSI-specific restrictions are in [ssi_fastconnect.md](ssi_fastconnect.md).
