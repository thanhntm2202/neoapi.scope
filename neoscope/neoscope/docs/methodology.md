# Methodology and analytical contract

## Purpose and scope

NeoScope is a reproducible market-microstructure research and decision-support prototype for Vietnamese listed equities. It measures displayed liquidity, constructs a relative liquidity score, flags unusual observations, and estimates hypothetical execution shortfall. It does not forecast long-horizon returns, recommend trades, route orders, or represent an execution guarantee.

All live measurements inherit the selected provider's coverage and semantics. SSI is the default live source; NEO is a manually selected backup. Provider-specific RAW and result namespaces are kept separate. Synthetic sessions are useful for controlled pipeline demonstrations and software scenarios, but are never market evidence.

## Units and event-time conventions

- Prices in the canonical layer are VND per share. SSI quote-book and market-band prices are converted from the thousand-VND scale shown in SSI's documented examples; SSI trade prices are retained in VND. The source message remains unchanged in RAW.
- Quantities are shares; monetary notionals are VND; returns and execution shortfall are basis points (1 bp = 0.0001).
- Exchange/event time is preferred where the source provides a parseable timestamp; local arrival time is retained independently. Arrival time must not silently replace missing event time in a research claim.
- Session and display timezone is `Asia/Ho_Chi_Minh`. The pipeline retains sequence and arrival metadata to diagnose duplicates, late arrivals, and out-of-order updates.
- Missing or semantically uncertain source fields remain null. A null is not zero and must not be interpreted as an inactive market.

## Canonical microstructure measures

For best bid (b_t), best ask (a_t), and midpoint (m_t=(a_t+b_t)/2):

- Quoted spread in bps: (10^4(a_t-b_t)/m_t).
- Visible depth: sum of price-times-quantity over the available bid and ask levels; each side is also reported separately.
- Order-book imbalance (OBI): ((Q^b_t-Q^a_t)/(Q^b_t+Q^a_t)) where source-supported aggregate quantities are available. If unavailable, OBI remains missing; displayed three-level quantities are not silently relabeled as total-book quantities.
- One-minute bars aggregate event observations. Returns are midpoint changes; volume/value measures use cleaned increments from source cumulative counters where available. Counter resets, late snapshots, and stale gaps carry explicit quality flags.
- Amihud-style illiquidity proxy: sum of absolute one-minute returns divided by traded value (scaled by the implementation's VND-billion convention) over the rolling window. It is a coarse price-response proxy, not a causal impact estimate.

The canonical layer is a compatibility contract, not a claim that providers publish identical data. See [provider contracts](provider_contracts.md) and [SSI mapping](ssi_fastconnect.md) for field-level differences.

## Liquidity Health Score (LHS)

At each one-minute timestamp, five trailing-window components are calculated over 15 minutes with at least five observations:

1. **Tightness:** negative mean quoted spread.
2. **Depth:** log of one plus mean two-sided monetary displayed depth.
3. **Immediacy:** negative Amihud-style illiquidity proxy.
4. **Stability:** negative standard deviation of spread.
5. **Balance:** negative mean absolute OBI.

Each component is ranked cross-sectionally among symbols with complete components at that timestamp. The default score is the weighted mean of these percentile ranks multiplied by 100; default weights are equal. A higher LHS means relatively healthier observed liquidity within the eligible watchlist at that time. It is not an absolute liquidity unit or a cross-provider benchmark. Sensitivity analysis doubles each component weight in turn and reports Spearman rank correlation with the default score.

The cross-sectional design limits scale sensitivity and supports within-universe comparisons. It also means the score depends on watchlist composition, data coverage, and the selected provider. Compare scores only when those conditions are sufficiently stable.

## Alerting

Alerts are anomaly flags for investigation, not trading signals. The implementation builds expanding historical baselines by symbol and 15-minute intraday bucket, evaluates each session only against earlier sessions, and then adds the evaluated session to the baseline. Minimum baseline size, transformation, gate, persistence, and cooldown are configuration-controlled and described in [threshold rationale](thresholds.md).

Every alert retains its observed value, baseline mean and effective dispersion, z-score where applicable, empirical percentile, baseline count, direction, bucket, and transformed scale. Provider-specific unavailable inputs (for example SSI foreign-flow counters) do not generate an alert through imputed data.

## Hypothetical execution-cost model

The calibrated cost estimator decomposes expected implementation shortfall into: (a) an immediate visible-book sweep over up to three levels, (b) residual participation during a finite horizon, (c) expected adverse drift associated with OBI, and (d) a volatility-based uncertainty interval. Volume profile, OBI drift slope, and risk scale are estimated from training sessions only in each walk-forward fold. Missing profiles and volatility estimates are flagged and surfaced.

The separate paper simulator provides a transparent reference outcome: it assumes access to the displayed three-level book at arrival; residual shares participate at a configured fraction of observed subsequent volume using the contemporaneous best price; any unfilled quantity is marked at the last available midpoint at horizon end. Brokerage fee and sell-tax assumptions are configuration inputs. This is deliberately a simplified counterfactual: it omits queue priority, hidden liquidity, own-market impact, exchange/network latency, rejects, partial-book visibility, and detailed order-handling rules. Large-order results can therefore materially understate actual costs.

The model comparison uses naive zero shortfall, visible-ladder-only, and full-feature estimates. Metrics are out-of-sample by session, with mean absolute error, root mean squared error, bias, interval coverage, and bootstrap uncertainty. Interpret the beyond-visible-book regime separately: in-book simulation outcomes are partly determined by the simulator's own book-sweep assumption and are not an independent test of predictive skill.

## Interpretation hierarchy

1. Inspect source, session coverage, event/arrival timing, and quality flags.
2. Confirm the feature's source semantics and unit conversion.
3. Read estimates with coverage, confidence intervals, and benchmark comparisons.
4. Treat results as descriptive or predictive evidence only within the tested sample and protocol.
5. Require independent data, broader regimes, and production controls before operational or investment use.

## Reproducibility

RAW retains source payloads alongside derived canonical records. Manifests identify provider, configuration hash, session, message counts, and file digests. Rebuild curated data with `neoscope process --force`; reproduce the analysis using the same source namespace and configuration. Record code revision, environment lock/dependency versions, and input-manifest hashes for any external report. The repository does not yet provide a signed build attestation or a frozen transitive dependency lockfile.
