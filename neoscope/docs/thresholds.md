# Thresholds and design rationale

Thresholds are operational choices for anomaly screening. They are not exchange standards, universal constants, or statistically optimal values. They are centralized in `config/settings.yaml`, must be reported with analyses, and should be recalibrated when provider, universe, frequency, or regime changes.

## Current configured values

| Setting | Default | Role and interpretation |
|---|---:|---|
| Baseline grouping | symbol × 15-minute intraday bucket | Controls intraday seasonality and symbol-level scale differences. |
| Warm-up | 1 session | First session contributes history but emits no alerts; prevents scoring against an empty baseline. |
| Minimum baseline | 30 observations per key | Below this, do not issue a distribution-based alert. It is a minimum guardrail, not a claim of sufficient power. |
| Standardized gate | |z| ≥ 3 and empirical tail ≥ 99th percentile | Two simultaneous criteria reduce sensitivity to a single parametric assumption. The normal-tail interpretation of z is only approximate under heavy tails. |
| Persistence | 3 consecutive observations | Filters isolated prints for most alert classes. It depends on feed cadence, so do not compare raw persistence across different sampling/update rates. |
| Cooldown | 60 seconds | Limits repeated notifications during one continuing anomaly; it does not merge events into a causal episode. |
| Depth transform | log1p(nonnegative depth) | Compresses skewed positive depth values; negative depth is not meaningful and is clipped in the transform. |
| OBI gate | empirical 99th percentile of absolute OBI | OBI is bounded; a Gaussian z threshold is poorly suited to a bounded ratio. |
| Foreign-flow gate | 2 × 99th percentile among nonzero absolute historical values; one observation | Avoids a near-zero threshold caused by zero-inflated flow. This feature is disabled in practice where the source does not expose validated flow semantics. |
| Alert priority | P3: empirical tail ≥99%; P2: ≥99.5%; P1: ≥99.9% | Ranks already-triggered observations by rarity against the prior-session baseline. It is a screening priority, not a loss probability, expected loss, or investment recommendation. |
| LHS trailing window | 15 minutes, at least 5 one-minute bars | Smooths transient book noise while retaining intraday conditions; this is a design setting, not a universal horizon. |
| LHS weights | Equal | Neutral starting point absent an externally justified utility function; sensitivity analysis is reported. |
| Execution horizon | 180 seconds | Scenario parameter for the paper estimator, not an expected execution time. |
| Participation | 15% of observed volume | Simplified capacity constraint; test alternative values because realized participation depends on strategy and venue. |
| Prediction interval | nominal 90% (z=1.6449) | Calibrated on the training fold; actual out-of-sample coverage is measured rather than presumed. |

## Alert mechanics

For each symbol and applicable bucket, the expanding baseline is computed from prior sessions only. Effective scale is the larger of sample standard deviation, 5% of the 95th-to-5th percentile range, and a small numerical floor. The percentile is the empirical rank against the stored baseline. For high-direction metrics, the standardized gate requires z ≥ configured threshold and percentile ≥ configured threshold; for low-direction metrics, both tails reverse. OBI uses the empirical absolute-value tail; foreign flow uses its nonzero tail gate. Persistence and cooldown are then applied in chronological order.

For a triggered event, priority uses the direction-adjusted empirical tail rank: `tail_pct = pct` for high-direction events and `tail_pct = 1 − pct` for low-direction events. P1/P2/P3 correspond to tail ranks at or above 99.9%/99.5%/99%. These labels communicate relative rarity only. They do not measure market impact, client harm, or the probability of a loss; those require separate prospective calibration and outcome labels.

The 30-observation threshold, 3-sigma screen, 99th percentile, persistence, and cooldown are initial screening defaults. They require sensitivity analysis and prospective monitoring on the actual feed. Changing SDK cadence or quote-update semantics can change effective persistence, alert frequency, and false-positive rates.

## Recalibration protocol

Before changing a threshold, specify the target event and acceptable false-alert burden; use training sessions to choose candidate values; freeze the rule; evaluate once on later untouched sessions; report alerts per symbol-session, precision/recall only where independent labels exist, and stability by provider, symbol group, session phase, and data-quality state. Keep the prior version and the change rationale. Do not select thresholds against the same test sessions used to report performance.
