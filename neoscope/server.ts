import express from 'express';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import {
  buildCostCurve,
  buildOrderBookFromSnap,
  buildOrderSlicingComparison,
  buildSigmaFallback,
  buildTopFailureCases,
  buildVolumeProfile,
  computeStaticFeatures,
  foldParamsFor,
  lastValidBySymbol,
  median,
  predictAllModels,
  simulateOrder,
  tradingCostsBps,
} from './src/server/analytics.js';
import {
  dataCache,
  FLAG_DESCRIPTIONS,
  formatVnTimestamp,
  groupOf,
  listAvailableDatasets,
  listSessionDirs,
  loadSettings,
  readLiveStatus,
  REPO_ROOT,
} from './src/server/store.js';
import { computeSymbolSignals, type SignalBarLike } from './src/lib/symbolFilter.js';
import { buildSessionNarrative } from './server/liquidityMath.ts';
import { loadSettings as loadProviderSettings } from './server/config.ts';
import {
  inspectProviderReadiness,
  testSsiFastConnectConnection,
} from './server/ssiFastConnect.ts';
import {
  computeCalibrationCurve,
  computeIntradayUShape,
  computeLiquidityBeta,
  computePortfolioStress,
  evaluateAlertThresholdLab,
  type TruthEventInput,
} from './server/portfolioAndProfileMath.ts';
import {
  buildSystemSelfCheck,
  fetchSsiRestContext,
  simulateChaosScenario,
  testNeoApiConnection,
  type ChaosScenarioId,
} from './server/providerExtras.ts';

const NGINX_PORT = process.env.NGINX_PORT ? Number(process.env.NGINX_PORT) : null;
const ENV_PORT = process.env.PORT ? Number(process.env.PORT) : null;
const PORT =
  Number(process.env.APP_PORT || process.env.DEFAULT_APP_PORT) ||
  (ENV_PORT && ENV_PORT !== NGINX_PORT ? ENV_PORT : 3000);
const HOST = '0.0.0.0';

const ALLOWED_DOCS = new Set([
  'methodology.md',
  'thresholds.md',
  'validation_protocol.md',
  'limitations.md',
  'architecture.md',
  'references.md',
]);

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'neoscope' });
  });

  app.post('/api/refresh', (_req, res) => {
    dataCache.clear();
    res.json({ ok: true });
  });

  app.get('/api/live-status', (req, res) => {
    const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
    const settings = loadSettings(dataset);
    res.json({
      mode: settings.mode,
      provider: settings.provider,
      dataset_mode: settings.dataset_mode,
      liveStatus: readLiveStatus(settings.provider),
    });
  });

  app.get('/api/provider/status', (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const providerSettings = loadProviderSettings(dataset);
      res.json(inspectProviderReadiness(providerSettings));
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Cannot inspect provider readiness' });
    }
  });

  app.post('/api/provider/probe', async (req, res) => {
    try {
      const datasetRaw = req.body?.dataset ?? req.query.dataset;
      const dataset = datasetRaw ? String(datasetRaw) : undefined;
      const target = String(req.body?.target || 'BOTH').toUpperCase();
      const providerSettings = loadProviderSettings(dataset);
      const status = inspectProviderReadiness(providerSettings);
      const [probe, neoProbe] = await Promise.all([
        target === 'NEO' ? Promise.resolve(null) : testSsiFastConnectConnection(providerSettings),
        target === 'SSI' ? Promise.resolve(null) : testNeoApiConnection(providerSettings),
      ]);
      res.json({ status, probe, neoProbe });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Provider probe failed' });
    }
  });

  app.get('/api/provider/rest-context', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const providerSettings = loadProviderSettings(dataset);
      const result = await fetchSsiRestContext(providerSettings, {
        symbol: req.query.symbol ? String(req.query.symbol) : undefined,
        market: req.query.market ? String(req.query.market) : undefined,
        fromDate: req.query.fromDate ? String(req.query.fromDate) : undefined,
        toDate: req.query.toDate ? String(req.query.toDate) : undefined,
      });
      res.json(result);
    } catch (err: any) {
      const msg = err?.message || 'SSI REST context error';
      res.status(msg.includes('không hợp lệ') || msg.includes('YYYY-MM-DD') ? 400 : 500).json({ error: msg });
    }
  });

  app.post('/api/system/chaos-demo', (req, res) => {
    const scenarioId = String(req.body?.scenarioId || '') as ChaosScenarioId;
    const allowed = new Set(['RATE_LIMIT_429', 'STALE_GAP_30S', 'DIRTY_DATA_TRAPS', 'MISSING_FOLD_PARAMS']);
    if (!allowed.has(scenarioId)) {
      return res.status(400).json({ error: 'Unknown chaos scenarioId' });
    }
    res.json(simulateChaosScenario(scenarioId));
  });

  app.get('/api/system/self-check', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const storeSettings = loadSettings(dataset);
      const providerSettings = loadProviderSettings(dataset);
      const summary = dataCache.getSummary(storeSettings);
      const qualityBundle = await dataCache.getQuality(storeSettings);
      const availableDatasets = listAvailableDatasets();
      res.json(
        buildSystemSelfCheck({
          settings: providerSettings,
          summary,
          qualityMeta: qualityBundle.quality_meta,
          availableDatasets,
        }),
      );
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Self-check failed' });
    }
  });

  app.get('/api/bootstrap', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const summary = dataCache.getSummary(settings);
      const sessionDirs = listSessionDirs(settings.dataset_mode);
      const sessions = sessionDirs.map((d) => d.date);

      const [
        metrics,
        metrics_coverage,
        fold_params,
        coverage,
        alerts,
        alert_pr,
        lhs_ic,
        lhs_sensitivity,
        obi_direction,
        qualityBundle,
      ] = await Promise.all([
        dataCache.getResult(settings, 'metrics'),
        dataCache.getResult(settings, 'metrics_coverage'),
        dataCache.getResult(settings, 'fold_params'),
        dataCache.getResult(settings, 'coverage'),
        dataCache.getAlerts(settings),
        dataCache.getResult(settings, 'alert_pr'),
        dataCache.getResult(settings, 'lhs_ic'),
        dataCache.getResult(settings, 'lhs_sensitivity'),
        dataCache.getResult(settings, 'obi_direction'),
        dataCache.getQuality(settings),
      ]);

      const manifests = dataCache.getManifests(settings);

      // Freshness from latest session's snapshots
      let freshnessStr = 'chưa có dữ liệu';
      if (sessions.length > 0) {
        const latestSnaps = await dataCache.getSnaps(settings, sessions[sessions.length - 1]);
        if (latestSnaps.length > 0) {
          let maxTs = 0;
          let maxIso = latestSnaps[0].ts;
          for (const s of latestSnaps) {
            if (s.ts_ms > maxTs) {
              maxTs = s.ts_ms;
              maxIso = s.ts;
            }
          }
          freshnessStr = formatVnTimestamp(maxIso);
        }
      }

      const allSymbols = Array.from(
        new Set(settings.allSymbols.length ? settings.allSymbols : summary?.dataset?.symbols ?? []),
      ).sort();

      res.json({
        settings,
        sessions,
        allSymbols,
        freshness: freshnessStr,
        availableDatasets: listAvailableDatasets(),
        liveStatus: readLiveStatus(settings.provider),
        summary,
        results: {
          metrics,
          metrics_coverage,
          fold_params,
          coverage,
          alerts,
          alert_pr,
          lhs_ic,
          lhs_sensitivity,
          obi_direction,
        },
        quality: qualityBundle.quality,
        quality_meta: qualityBundle.quality_meta,
        flag_descriptions: FLAG_DESCRIPTIONS,
        manifests,
      });
    } catch (err: any) {
      console.error('[bootstrap error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/trends', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const sessions = listSessionDirs(settings.dataset_mode).map((d) => d.date);
      const hasSymbolsParam = req.query.symbols !== undefined;
      const symbolsParam = String(req.query.symbols || '');
      const selectedSymbols = hasSymbolsParam
        ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : settings.allSymbols;
      const symSet = new Set(selectedSymbols);

      const [barsLhsAll, alertsAll] = await Promise.all([
        dataCache.getResult(settings, 'bars_lhs'),
        dataCache.getAlerts(settings),
      ]);

      const rows = await Promise.all(
        sessions.map(async (sessionDate) => {
          const snapsAll = await dataCache.getSnaps(settings, sessionDate);
          const daySnaps = snapsAll.filter((s) => symSet.has(s.symbol));
          const sp = Array.from(lastValidBySymbol(daySnaps, 'spread_bps').values());
          const dpBid = Array.from(lastValidBySymbol(daySnaps, 'depth_bid_vnd').values());
          const dpAsk = Array.from(lastValidBySymbol(daySnaps, 'depth_ask_vnd').values());

          const dayLhsRows = barsLhsAll.filter(
            (b) => b.session_date === sessionDate && symSet.has(b.symbol) && b.lhs !== null && Number.isFinite(b.lhs),
          );
          const lastLhsBySym = new Map<string, number>();
          for (const r of dayLhsRows) {
            lastLhsBySym.set(r.symbol, Number(r.lhs));
          }

          const alertCount = alertsAll.filter(
            (a) => a.session_date === sessionDate && symSet.has(a.symbol),
          ).length;

          return {
            session: sessionDate,
            spreadMed: median(sp),
            depthMed: median([...dpBid, ...dpAsk].map((v) => v / 1e9)),
            lhsMed: median(Array.from(lastLhsBySym.values())),
            alertCount,
          };
        }),
      );

      res.json({ rows });
    } catch (err: any) {
      console.error('[trends error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/session/:date', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const sessionDate = req.params.date;
      const sessions = listSessionDirs(settings.dataset_mode).map((d) => d.date);
      if (!sessions.includes(sessionDate)) {
        return res.status(404).json({ error: `Unknown session ${sessionDate}` });
      }

      const hasSymbolsParam = req.query.symbols !== undefined;
      const symbolsParam = String(req.query.symbols || '');
      const selectedSymbols = hasSymbolsParam
        ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : settings.allSymbols;
      const symSet = new Set(selectedSymbols);

      const [snapsAll, indicesAll, barsLhsAll, alertsAll] = await Promise.all([
        dataCache.getSnaps(settings, sessionDate),
        dataCache.getIndices(settings, sessionDate),
        dataCache.getResult(settings, 'bars_lhs'),
        dataCache.getAlerts(settings),
      ]);

      const daySnaps = snapsAll.filter((s) => symSet.has(s.symbol));
      const dayLhs = barsLhsAll.filter((b) => b.session_date === sessionDate && symSet.has(b.symbol));
      const dayLhsAllSyms = barsLhsAll.filter((b) => b.session_date === sessionDate);
      const rawSignalBars = dayLhsAllSyms.length > 0 ? dayLhsAllSyms : await dataCache.getBars(settings, sessionDate);
      const signalBars = (rawSignalBars as SignalBarLike[]).filter((b) => typeof b.symbol === 'string');
      const dayAlertsAllSyms = alertsAll.filter((a) => a.session_date === sessionDate);
      const groupMap: Record<string, 'large' | 'thin'> = {};
      for (const sym of settings.allSymbols) {
        groupMap[sym] = groupOf(settings, sym);
      }
      const symbolSignals = computeSymbolSignals(
        signalBars,
        dayAlertsAllSyms,
        settings.allSymbols,
        groupMap,
      );

      // Previous session for KPI deltas
      const sessIdx = sessions.indexOf(sessionDate);
      const prevSession = sessIdx > 0 ? sessions[sessIdx - 1] : null;
      let spreadPrevMed: number | null = null;
      let depthPrevMed: number | null = null;
      let lhsPrevMed: number | null = null;

      if (prevSession) {
        const prevSnapsAll = await dataCache.getSnaps(settings, prevSession);
        const prevSnaps = prevSnapsAll.filter((s) => symSet.has(s.symbol));
        const spPrev = Array.from(lastValidBySymbol(prevSnaps, 'spread_bps').values());
        const dpBidPrev = Array.from(lastValidBySymbol(prevSnaps, 'depth_bid_vnd').values());
        const dpAskPrev = Array.from(lastValidBySymbol(prevSnaps, 'depth_ask_vnd').values());
        spreadPrevMed = median(spPrev);
        depthPrevMed = median([...dpBidPrev, ...dpAskPrev].map((v) => v / 1e9));

        const prevLhsRows = barsLhsAll.filter(
          (b) => b.session_date === prevSession && symSet.has(b.symbol) && b.lhs !== null && Number.isFinite(b.lhs),
        );
        const lastPrevLhsBySym = new Map<string, number>();
        for (const r of prevLhsRows) {
          lastPrevLhsBySym.set(r.symbol, Number(r.lhs));
        }
        lhsPrevMed = median(Array.from(lastPrevLhsBySym.values()));
      }

      const spreadMap = lastValidBySymbol(daySnaps, 'spread_bps');
      const depthBidMap = lastValidBySymbol(daySnaps, 'depth_bid_vnd');
      const depthAskMap = lastValidBySymbol(daySnaps, 'depth_ask_vnd');
      const midMap = lastValidBySymbol(daySnaps, 'mid');
      const obiMap = lastValidBySymbol(daySnaps, 'obi');

      const latestBySymbol = new Map<string, (typeof daySnaps)[number]>();
      for (const s of daySnaps) {
        latestBySymbol.set(s.symbol, s);
      }

      const spreadNow = median(Array.from(spreadMap.values()));
      const depthNow = median(
        [...Array.from(depthBidMap.values()), ...Array.from(depthAskMap.values())].map((v) => v / 1e9),
      );

      const lhsLastBySym = new Map<string, number>();
      const lhsSeriesBySym = new Map<string, number[]>();
      const sortedDayLhs = [...dayLhs].sort((a, b) => a.bar_ts_ms - b.bar_ts_ms);
      for (const r of sortedDayLhs) {
        if (r.lhs !== null && Number.isFinite(r.lhs)) {
          lhsLastBySym.set(r.symbol, Number(r.lhs));
          const arr = lhsSeriesBySym.get(r.symbol) || [];
          arr.push(Math.round(Number(r.lhs) * 10) / 10);
          lhsSeriesBySym.set(r.symbol, arr);
        }
      }
      const lhsNow = median(Array.from(lhsLastBySym.values()));

      const alertCut = alertsAll.filter((a) => a.session_date === sessionDate && symSet.has(a.symbol));
      const rareCount = alertCut.filter((a) => a.priority === 'P1' || a.priority === 'P2').length;
      const alertTypes: Record<string, number> = {};
      for (const a of alertCut) {
        const t = String(a.type || 'OTHER');
        alertTypes[t] = (alertTypes[t] || 0) + 1;
      }

      const alertPulse = [...alertCut]
        .sort((a, b) => b.ts_ms - a.ts_ms)
        .slice(0, 6);

      const signalMap = new Map(symbolSignals.map((s) => [s.symbol, s]));
      const latestLhsRowsBySym = new Map<string, Record<string, unknown>>();
      for (const r of sortedDayLhs) {
        if (r.lhs !== null && Number.isFinite(r.lhs)) {
          latestLhsRowsBySym.set(r.symbol, r);
        }
      }

      const watchlist = Array.from(latestBySymbol.values())
        .map((last) => {
          const sym = last.symbol;
          const db = depthBidMap.get(sym);
          const midVal = midMap.get(sym) ?? null;
          const sig = signalMap.get(sym);
          return {
            symbol: sym,
            groupLabel: groupOf(settings, sym) === 'large' ? 'VN30 lớn' : 'Midcap mỏng',
            group: groupOf(settings, sym),
            lhsSeries: lhsSeriesBySym.get(sym) ?? [],
            midLast: midVal,
            spreadBps: spreadMap.get(sym) ?? null,
            volatilityBps: sig?.volatilityBps ?? null,
            depthBidB: db !== undefined ? db / 1e9 : null,
            obi: obiMap.get(sym) ?? null,
            cumVolM: last.cum_vol !== null && Number.isFinite(last.cum_vol) ? last.cum_vol / 1e6 : null,
            alertCount: sig?.alertCount ?? 0,
            rareAlertCount: sig?.rareAlertCount ?? 0,
          };
        })
        .sort((a, b) => (b.midLast ?? -Infinity) - (a.midLast ?? -Infinity));

      const narrative = buildSessionNarrative({
        session: sessionDate,
        mode: settings.mode,
        watchlistRows: watchlist.map((w) => ({
          symbol: w.symbol,
          groupLabel: w.groupLabel,
          lhsSeries: w.lhsSeries,
          mid: w.midLast,
          spreadBps: w.spreadBps,
          depthBidB: w.depthBidB,
          obi: w.obi,
          cumVolM: w.cumVolM,
        })),
        lhsRanking: Array.from(latestLhsRowsBySym.values()),
        alertCount: alertCut.length,
        rareCount,
        alertTypes,
      });

      const availableTapeSymbols = Array.from(latestBySymbol.keys()).sort();

      res.json({
        session: sessionDate,
        prevSession,
        kpis: {
          symbolCount: latestBySymbol.size,
          spreadNow,
          spreadPrev: spreadPrevMed,
          depthNow,
          depthPrev: depthPrevMed,
          lhsNow,
          lhsPrev: lhsPrevMed,
          alertCount: alertCut.length,
          rareCount,
        },
        narrative,
        alertPulse,
        dayAlerts: alertCut,
        indices: indicesAll.filter((r) => r.index_code === 'VNINDEX'),
        barsLhs: dayLhsAllSyms,
        watchlist,
        availableTapeSymbols,
        symbolSignals,
      });
    } catch (err: any) {
      console.error('[session error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/tape/:date/:symbol', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const { date, symbol } = req.params;
      const snapsAll = await dataCache.getSnaps(settings, date);
      const rows = snapsAll
        .filter((s) => s.symbol === symbol)
        .map((s) => ({
          ts: s.ts,
          ts_ms: s.ts_ms,
          mid: s.mid,
          last_price: s.last_price,
          depth_bid_vnd: s.depth_bid_vnd,
          depth_ask_vnd: s.depth_ask_vnd,
          spread_bps: s.spread_bps,
          obi: s.obi,
          microprice: s.microprice,
          bid1: s.bid1,
          bid2: s.bid2,
          bid3: s.bid3,
          ask1: s.ask1,
          ask2: s.ask2,
          ask3: s.ask3,
          bidvol1: s.bidvol1,
          bidvol2: s.bidvol2,
          bidvol3: s.bidvol3,
          askvol1: s.askvol1,
          askvol2: s.askvol2,
          askvol3: s.askvol3,
          d_f_net_val: s.d_f_net_val,
          d_vol: s.d_vol,
          session: s.session,
        }));
      res.json({ rows });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/execution/timestamps', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const sessionDate = String(req.query.session || '');
      const symbol = String(req.query.symbol || '');
      const snapsAll = await dataCache.getSnaps(settings, sessionDate);
      const lo = snapsAll.filter(
        (s) =>
          s.symbol === symbol &&
          (s.session === 'LO_AM' || s.session === 'LO_PM') &&
          s.mid !== null &&
          Number.isFinite(s.mid),
      );

      const summary = dataCache.getSummary(settings);
      const fpAll = await dataCache.getResult(settings, 'fold_params');
      const testDates: string[] = summary?.dataset?.test_dates || [];
      const { note } = foldParamsFor(fpAll, sessionDate, testDates);

      res.json({
        timestamps: lo.map((r) => ({ ts: r.ts, ts_ms: r.ts_ms })),
        foldNote: note,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.post('/api/execution/estimate', async (req, res) => {
    try {
      const { dataset, session: sessionDate, symbol, side, notional, ts_ms } = req.body as {
        dataset?: string;
        session: string;
        symbol: string;
        side: 1 | -1;
        notional: number;
        ts_ms: number;
      };
      const settings = loadSettings(dataset);

      const [snapsAll, barsAll, fpAll, predsAll] = await Promise.all([
        dataCache.getSnaps(settings, sessionDate),
        dataCache.getBars(settings, sessionDate),
        dataCache.getResult(settings, 'fold_params'),
        dataCache.getResult(settings, 'predictions'),
      ]);

      const snapsSym = snapsAll.filter((s) => s.symbol === symbol);
      const barsSym = barsAll.filter((b) => b.symbol === symbol);
      const summary = dataCache.getSummary(settings);
      const testDates: string[] = summary?.dataset?.test_dates || [];
      const allDates: string[] = summary?.dataset?.dates || [];
      const { rows: fpRows, note: foldNote } = foldParamsFor(fpAll, sessionDate, testDates);

      const lo = snapsSym.filter((s) => (s.session === 'LO_AM' || s.session === 'LO_PM') && s.mid !== null);
      if (!lo.length) {
        return res.status(400).json({ error: 'Mã này không có sổ lệnh hợp lệ trong phiên LO.' });
      }

      // Match searchsorted(..., side='right') - 1
      let rightIdx = 0;
      while (rightIdx < snapsSym.length && snapsSym[rightIdx].ts_ms <= ts_ms) rightIdx++;
      const arr = snapsSym[Math.max(rightIdx - 1, 0)];
      const orderBook = arr ? buildOrderBookFromSnap(arr) : null;
      if (!arr || !orderBook || arr.mid === null || !Number.isFinite(arr.mid)) {
        return res.status(400).json({
          error: 'Không dựng được sổ lệnh hợp lệ tại thời điểm này (cờ NO_BOOK/ATO_ATC) — mô hình từ chối ước tính.',
        });
      }

      const mid = arr.mid;
      const qty = Math.max(Math.round(notional / mid / 100) * 100, 100);
      const feat = computeStaticFeatures(ts_ms, side, qty, snapsSym, barsSym, settings);
      if (!feat) {
        return res.status(400).json({
          error: 'Không dựng được sổ lệnh hợp lệ tại thời điểm này (cờ NO_BOOK/ATO_ATC) — mô hình từ chối ước tính.',
        });
      }

      const lad = feat.ladder;
      const costs = tradingCostsBps(
        qty * mid,
        side,
        settings.execution.fee_rate,
        settings.execution.sell_tax_rate,
      );
      const ladderPayload = {
        ...lad,
        prices: feat.prices,
        vols: feat.vols,
        fills: lad.fills.map((f) => ({
          ...f,
          cost_bps: (side * (f.price - mid) / mid) * 10000,
        })),
      };

      if (!fpRows.length) {
        const costCurve = buildCostCurve({
          mid,
          side,
          prices: feat.prices,
          vols: feat.vols,
          hs_bps: feat.hs_bps,
          obi_now: feat.obi_now,
          v_rate: null,
          sigma: null,
          kappa: 0,
          y_risk: 1.0,
          settings,
          hasFoldModel: false,
        });
        const slicingComparison = buildOrderSlicingComparison({
          mid,
          side,
          qty,
          prices: feat.prices,
          vols: feat.vols,
          hs_bps: feat.hs_bps,
          obi_now: feat.obi_now,
          v_rate: null,
          sigma: null,
          kappa: 0,
          y_risk: 1.0,
          settings,
          hasFoldModel: false,
        });
        return res.json({
          hasFoldModel: false,
          foldNote:
            foldNote ||
            'Chưa có tham số fold (cần nhiều phiên để chạy `neoscope validate`) — chỉ hiển thị sổ lệnh 3 mức & quét tất định.',
          mid,
          qty,
          side,
          orderBook,
          costs,
          ladder: ladderPayload,
          costCurve,
          slicingComparison,
          full: null,
          waterfallParts: null,
          benchmarks: [],
          transparency: {
            mid_arrival_vnd: mid,
            half_spread_bps: feat.hs_bps,
            OBI_now: feat.obi_now,
            note: 'Chỉ hiển thị chi phí quét sổ 3 mức tất định (chưa có tham số kappa/Y_cov từ walk-forward).',
          },
          nOos: 0,
        });
      }

      const grp = groupOf(settings, symbol);
      const fpRow = fpRows.find((r) => r.group === grp) || fpRows[0];
      const trainDates = allDates.filter((d) => d < String(fpRow.test_date));
      const trainBars = await dataCache.getAllBarsForDates(settings, trainDates);
      const profile = buildVolumeProfile(trainBars);
      const sigFb = buildSigmaFallback(trainBars);

      const sigma =
        feat.sigma_trail !== null && Number.isFinite(feat.sigma_trail)
          ? feat.sigma_trail
          : (sigFb.get(`${grp}|${feat.bucket}`) ?? null);
      const v_rate = profile.lookup(symbol, grp, feat.bucket);

      const preds = predictAllModels({
        feat,
        side,
        qty,
        v_rate,
        sigma,
        kappa: Number(fpRow.kappa_bps_per_s),
        y_risk: Number(fpRow.y_cov),
        settings,
      });

      const full = preds._full_obj;
      const mu = full.detail.mu_bps_per_s;
      const waterfallParts: Record<string, number> = {
        'Sweep sổ hiển thị': full.w_vis * (lad.cost_vis_bps ?? 0),
      };
      if (full.w_res > 0) {
        waterfallParts['Nửa spread phần dư'] = full.w_res * full.detail.hs_bps;
        waterfallParts['Trôi giá κ·OBI (phần dư)'] = full.w_res * side * mu * full.tau_s / 2.0;
      }
      if (full.w_unf > 0) {
        waterfallParts['Chi phí cơ hội phần chưa khớp'] =
          full.w_unf * side * mu * settings.execution.horizon_s;
      }

      const nOos = predsAll.filter((r) => r.model === 'full').length;
      const costCurve = buildCostCurve({
        mid,
        side,
        prices: feat.prices,
        vols: feat.vols,
        hs_bps: feat.hs_bps,
        obi_now: feat.obi_now,
        v_rate,
        sigma,
        kappa: Number(fpRow.kappa_bps_per_s),
        y_risk: Number(fpRow.y_cov),
        settings,
        hasFoldModel: true,
      });
      const slicingComparison = buildOrderSlicingComparison({
        mid,
        side,
        qty,
        prices: feat.prices,
        vols: feat.vols,
        hs_bps: feat.hs_bps,
        obi_now: feat.obi_now,
        v_rate,
        sigma,
        kappa: Number(fpRow.kappa_bps_per_s),
        y_risk: Number(fpRow.y_cov),
        settings,
        hasFoldModel: true,
      });

      res.json({
        hasFoldModel: true,
        foldNote,
        mid,
        qty,
        side,
        orderBook,
        costs,
        ladder: ladderPayload,
        costCurve,
        slicingComparison,
        full: {
          e_is_bps: full.e_is_bps,
          sigma_is_bps: full.sigma_is_bps,
          lo_bps: full.lo_bps,
          hi_bps: full.hi_bps,
          tau_s: full.tau_s,
          w_vis: full.w_vis,
          w_res: full.w_res,
          w_unf: full.w_unf,
          coverage: full.coverage,
          flags: full.flags,
        },
        waterfallParts,
        benchmarks: [
          { model: 'naive_mid (bỏ qua mọi chi phí)', e_is_bps: 0.0 },
          {
            model: 'ladder_only (phần dư tại giá tốt nhất, không trôi giá)',
            e_is_bps: preds.ladder_only.e,
          },
          { model: 'full (ladder + trôi giá + rủi ro thời điểm)', e_is_bps: preds.full.e },
        ],
        transparency: {
          mid_arrival_vnd: mid,
          half_spread_bps: feat.hs_bps,
          OBI_now: feat.obi_now,
          'kappa_bps_per_s (fold)': Number(fpRow.kappa_bps_per_s),
          'Y_coverage (fold)': Number(fpRow.y_cov),
          sigma_bps_per_sqrt_s: sigma,
          'v_rate_shares_per_s (profile train)': v_rate,
          participation_rho: settings.execution.participation_rate,
          horizon_s: settings.execution.horizon_s,
          mu_drift_bps_per_s: full.detail.mu_bps_per_s,
          tau_eff_s: full.detail.tau_eff,
          weights: { vis: full.w_vis, res: full.w_res, unf: full.w_unf },
        },
        nOos,
      });
    } catch (err: any) {
      console.error('[execution estimate error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.post('/api/execution/simulate', async (req, res) => {
    try {
      const { dataset, session: sessionDate, symbol, side, qty, ts_ms } = req.body as {
        dataset?: string;
        session: string;
        symbol: string;
        side: 1 | -1;
        qty: number;
        ts_ms: number;
      };
      const settings = loadSettings(dataset);
      const snapsAll = await dataCache.getSnaps(settings, sessionDate);
      const snapsSym = snapsAll.filter((s) => s.symbol === symbol);
      const sim = simulateOrder({
        snapsSym,
        ts0Ms: ts_ms,
        side,
        qty,
        rho: settings.execution.participation_rate,
        horizon_s: settings.execution.horizon_s,
        fee_rate: settings.execution.fee_rate,
        sell_tax_rate: settings.execution.sell_tax_rate,
      });
      res.json(sim);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/alerts/context', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const sessionDate = String(req.query.session || '');
      const symbol = String(req.query.symbol || '');
      const tsMs = Number(req.query.ts_ms || 0);
      const windowMs = 10 * 60 * 1000;

      const snapsAll = await dataCache.getSnaps(settings, sessionDate);
      const windowRows = snapsAll
        .filter((s) => s.symbol === symbol && s.ts_ms >= tsMs - windowMs && s.ts_ms <= tsMs + windowMs)
        .map((s) => ({
          ts: s.ts,
          ts_ms: s.ts_ms,
          mid: s.mid,
          last_price: s.last_price,
          depth_bid_vnd: s.depth_bid_vnd,
          d_vol: s.d_vol,
        }));

      const truthEvents = dataCache.getTruthEvents(settings, sessionDate, symbol);
      res.json({ rows: windowRows, truthEvents });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/liquidity/profile', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const allSessions = listSessionDirs(settings.dataset_mode).map((d) => d.date);
      const reqSession = req.query.session ? String(req.query.session) : 'ALL';
      const targetSessions =
        reqSession !== 'ALL' && allSessions.includes(reqSession) ? [reqSession] : allSessions;

      const hasSymbolsParam = req.query.symbols !== undefined;
      const symbolsParam = String(req.query.symbols || '');
      const selectedSymbols = hasSymbolsParam
        ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
        : settings.allSymbols;
      const symSet = new Set(selectedSymbols);

      const loaded = await Promise.all(
        targetSessions.map(async (sDate) => {
          const [sn, br] = await Promise.all([
            dataCache.getSnaps(settings, sDate),
            dataCache.getBars(settings, sDate),
          ]);
          return { sn, br };
        }),
      );
      const snapsAll = [];
      const barsAll = [];
      for (const { sn, br } of loaded) {
        for (let i = 0; i < sn.length; i++) snapsAll.push(sn[i]);
        for (let i = 0; i < br.length; i++) barsAll.push(br[i]);
      }

      const uShape = computeIntradayUShape(snapsAll, settings, symSet);
      const liquidityBeta = computeLiquidityBeta(
        barsAll.filter((b) => symSet.size === 0 || symSet.has(b.symbol)),
        settings,
      );

      res.json({
        sessionsAnalyzed: targetSessions.length,
        uShape,
        liquidityBeta,
      });
    } catch (err: any) {
      console.error('[liquidity profile error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.post('/api/portfolio/stress', async (req, res) => {
    try {
      const { dataset, session: sessionDate, totalVnd, side, holdings } = req.body as {
        dataset?: string;
        session: string;
        totalVnd: number;
        side: 1 | -1;
        holdings: { symbol: string; weightPct: number }[];
      };
      const settings = loadSettings(dataset);
      const sessions = listSessionDirs(settings.dataset_mode).map((d) => d.date);
      const targetSession = sessionDate && sessions.includes(sessionDate) ? sessionDate : sessions[sessions.length - 1];
      if (!targetSession) {
        return res.status(400).json({ error: 'Không tìm thấy phiên curated để chạy stress danh mục.' });
      }
      if (!Array.isArray(holdings) || !holdings.length) {
        return res.status(400).json({ error: 'Danh mục phải có ít nhất 1 mã cổ phiếu.' });
      }
      const cleanSide: 1 | -1 = Number(side) === 1 ? 1 : -1;
      const [snaps, barsLhs] = await Promise.all([
        dataCache.getSnaps(settings, targetSession),
        dataCache.getResult(settings, 'bars_lhs'),
      ]);
      const dayLhs = barsLhs.filter((b) => b.session_date === targetSession);
      const out = computePortfolioStress({
        holdings,
        totalVnd: Number(totalVnd || 1_000_000_000),
        side: cleanSide,
        snaps,
        barsLhs: dayLhs,
        settings,
      });
      res.json({ session: targetSession, ...out });
    } catch (err: any) {
      console.error('[portfolio stress error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.post('/api/alerts/lab', async (req, res) => {
    try {
      const { dataset, zThreshold, pctThreshold, persistenceN, cooldownS } = req.body as {
        dataset?: string;
        zThreshold?: number;
        pctThreshold?: number;
        persistenceN?: number;
        cooldownS?: number;
      };
      const settings = loadSettings(dataset);
      const sessions = listSessionDirs(settings.dataset_mode).map((d) => d.date);
      if (!sessions.length) {
        return res.status(400).json({ error: 'Chưa có phiên curated để chạy Threshold Lab.' });
      }
      const snapsBySession = await Promise.all(
        sessions.map(async (s) => ({
          session: s,
          snaps: await dataCache.getSnaps(settings, s),
        })),
      );
      const truthEvents: TruthEventInput[] = [];
      if (settings.mode === 'SYNTHETIC') {
        for (const s of sessions) {
          for (const sym of settings.allSymbols) {
            const evs = dataCache.getTruthEvents(settings, s, sym);
            for (const ev of evs) {
              truthEvents.push({
                session_date: s,
                type: String(ev.type),
                symbol: String(ev.symbol),
                start_ts: String(ev.start_ts),
                end_ts: String(ev.end_ts),
              });
            }
          }
        }
      }
      const result = evaluateAlertThresholdLab(snapsBySession, truthEvents, {
        zThreshold,
        pctThreshold,
        persistenceN,
        cooldownS,
      });
      res.json({ mode: settings.mode, sessionsCount: sessions.length, ...result });
    } catch (err: any) {
      console.error('[alerts lab error]', err);
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/validation/extra', async (req, res) => {
    try {
      const dataset = req.query.dataset ? String(req.query.dataset) : undefined;
      const settings = loadSettings(dataset);
      const [predictions, resilience] = await Promise.all([
        dataCache.getResult(settings, 'predictions'),
        dataCache.getResult(settings, 'resilience'),
      ]);

      const fullPreds = predictions
        .filter((p) => p.model === 'full')
        .map((p) => ({
          realized_is_bps: p.realized_is_bps,
          e_is_bps: p.e_is_bps,
          coverage: p.coverage,
        }));

      const resRows = resilience
        .filter((r) => r.recover_s !== null && Number.isFinite(r.recover_s))
        .map((r) => ({
          group: r.group,
          recover_s: r.recover_s,
        }));

      const failureCases = buildTopFailureCases(
        predictions,
        settings.execution.horizon_s,
        10,
      );

      const calibrationCurve = computeCalibrationCurve(predictions, 'beyond_book');
      const calibrationCurveAll = computeCalibrationCurve(predictions, 'all');

      const datasetsInfo = listAvailableDatasets();
      const liveSummaries = datasetsInfo
        .filter((d) => d.id !== 'SYNTHETIC')
        .map((d) => {
          const liveSettings = loadSettings(d.id);
          const s = dataCache.getSummary(liveSettings);
          const fullMetric = Array.isArray(s?.metrics)
            ? s.metrics.find((m: any) => m.model === 'full' && m.group === 'ALL')
            : null;
          return {
            id: d.id,
            label: d.label,
            sessions: d.sessions,
            hasSummary: Boolean(s && Object.keys(s).length > 0),
            nOrders: s?.orders?.n ?? 0,
            maeFullBps: fullMetric?.mae_bps ?? null,
            lhsIcOverall: s?.lhs_ic_overall ?? null,
          };
        });

      res.json({
        fullPreds,
        resilience: resRows,
        failureCases,
        calibrationCurve,
        calibrationCurveAll,
        liveBenchmark: {
          hasLiveSessions: liveSummaries.some((x) => x.sessions > 0),
          providers: liveSummaries,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Internal server error' });
    }
  });

  app.get('/api/docs/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!ALLOWED_DOCS.has(filename)) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const p = path.join(REPO_ROOT, 'docs', filename);
    if (!fs.existsSync(p)) {
      return res.status(404).json({ error: `Thiếu docs/${filename}.` });
    }
    const markdown = fs.readFileSync(p, 'utf-8');
    const html = marked.parse(markdown, { async: false }) as string;
    res.json({ filename, markdown, html });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(REPO_ROOT, 'dist');
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(distDir, 'index.html'));
      }
      return next();
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`NeoScope server listening on http://${HOST}:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start NeoScope server:', err);
  process.exit(1);
});
