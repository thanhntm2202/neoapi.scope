# Validation protocol

## Objective

Estimate how well the execution-cost models generalize to later sessions, measure interval calibration, and test whether the liquidity score and alert machinery behave consistently under a stated data source and sample. This protocol does not establish profitability or live execution quality.

## Data eligibility and integrity

1. Select a single provider namespace (`SYNTHETIC`, `LIVE_SSI`, or `LIVE_NEO`) before analysis. Never concatenate vendor sessions without an independently documented reconciliation protocol.
2. Rebuild curated tables from RAW and review manifests, session coverage, stale gaps, duplicates, out-of-order/late records, missing book levels, crossed books, counter resets, and timestamp fallback.
3. Retain source-specific missing values. Exclude or separately report observations whose required fields or event-time quality do not support the target measure.
4. Label every synthetic result as simulated; synthetic ground truth validates implementation pathways only.

## Walk-forward design

Sort sessions chronologically. For each test session (t), train only on sessions preceding (t), with the configured minimum of five training sessions. The implementation emits one expanding-window fold for each eligible later session; it does not shuffle rows or randomly split observations. Feature calibration (volume profile, OBI drift coefficient, risk scale) is fitted using training data only. The test session is never used to fit its own fold parameters.

An order cohort is generated deterministically from the configured seed, symbol, time window, side, and log-uniform notional range. The simulation horizon must remain inside the same continuous trading segment; examples near open/close and the lunch break are excluded according to the generator rules. Document the seed, config hash, code revision, input session dates, and order-generation parameters.

## Comparators and estimands

Compare `full` against `ladder_only` and `naive_mid` on the same out-of-sample orders. Report MAE, RMSE, signed bias, nominal interval coverage, and performance by symbol group and visible-book coverage regime. Because the simulator's in-book outcome is constructed from the visible ladder, treat those results as a mechanism check, not independent proof of skill. The primary incremental-value analysis is the separately reported beyond-book cohort where it exists.

For model differences, resample whole test sessions (cluster bootstrap), not individual orders, because orders within a session share market conditions. Report the number of test-session clusters, the two-sided exact sign-test p-value for the session-level paired differences, and the percentile 95% cluster-bootstrap interval for the mean difference. These are distinct quantities: the bootstrap distribution estimates effect uncertainty and is not reused as a null distribution for a p-value. With few sessions, the sign test is discrete and both inferential summaries have low power; show this limitation prominently. Interval coverage is accompanied by Wilson binomial intervals, with the caveat that dependence can make the nominal binomial uncertainty optimistic.

For LHS construct validity, report session-level Spearman association with subsequent illiquidity on the held-out dates. For OBI, report the next-period return relationship by OBI quintile on held-out dates. Treat these as predictive association, not causal impact. Alert precision/recall is reported only for the simulator's explicitly generated synthetic truth events; no real-market alert truth labels are supplied.

## Required reporting

- Provider, API/SDK version, entitlement environment, symbols, dates, timezone, and source manifests.
- Data-quality exclusions and coverage by symbol/session; feed gaps and event-time availability.
- Exact configuration, code revision, dependency versions, seed, train/test boundary, and fold-specific fitted parameters.
- Sample size by session, group, and coverage regime; complete benchmark results and uncertainty intervals.
- Sensitivity to alert thresholds, LHS weights, participation rate, fee/tax assumptions, horizon, and source/provider.
- All failed folds or non-estimable outputs. Do not omit weak groups or adverse regimes.

## Stop/go interpretation

This repository's short synthetic panel and limited live history are not enough to make a production-readiness claim. Before external or operational use, extend the sample across market regimes, secure independently sourced labels, conduct a pre-registered prospective shadow evaluation, validate provider units and timestamp semantics against authoritative records, and obtain model-risk, compliance, information-security, and business-owner review. A statistically significant backtest alone is insufficient.
