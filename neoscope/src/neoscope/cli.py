"""NeoScope CLI — một cửa ngõ cho toàn bộ vòng đời sản phẩm.

    neoscope synth      # sinh dữ liệu MÔ PHỎNG (gắn nhãn SYNTHETIC)
    neoscope process    # RAW → curated (chuẩn hóa, cờ chất lượng, bars)
    neoscope analyze    # LHS, cảnh báo, resilience
    neoscope validate   # walk-forward + benchmark + bootstrap + summary.json
    neoscope all        # synth → process → analyze → validate
    neoscope record     # LIVE: ghi SSI (mặc định) hoặc NEO dự phòng theo NEOSCOPE_PROVIDER
    neoscope snapshot   # LIVE NEO: lấy stock-detail snapshot REST
    neoscope app        # mở dashboard Streamlit
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
from loguru import logger

from .config import REPO_ROOT, load_settings
from .data.store import list_session_dirs, write_parquet


def _new_live_capture_dir(settings, now=None) -> Path:
    """Unique same-day capture directory; retries never append to prior RAW."""
    from datetime import datetime
    from .constants import VN_TZ
    now = now or datetime.now(VN_TZ)
    stamp = now.strftime("%Y-%m-%d_%H%M%S")
    return settings.data_path("raw", f"{settings.dataset_mode}_{stamp}_{uuid.uuid4().hex[:8]}")


def cmd_synth(args) -> None:
    from .synth.generator import generate_dataset
    settings = load_settings(args.config)
    dirs = generate_dataset(settings, n_sessions=args.sessions)
    logger.info("SYNTHETIC: {} phiên tại {}", len(dirs), dirs[0].parent)


def cmd_process(args) -> None:
    from .data.pipeline import process_all
    settings = load_settings(args.config)
    process_all(settings, force=args.force)


def cmd_analyze(args) -> None:
    from .analytics.alerts import run_alerts
    from .analytics.lhs import compute_lhs, lhs_sensitivity
    from .data.pipeline import load_curated
    from .finance.liquidity import resilience_episodes
    settings = load_settings(args.config)
    data = load_curated(settings)
    snaps, bars = data["snapshots"], data["bars"]
    if snaps.empty:
        raise RuntimeError("Chưa có curated — chạy `neoscope process` trước.")

    bars_lhs = compute_lhs(bars, settings)
    write_parquet(bars_lhs, settings.results_path("bars_lhs.parquet"))
    sens = lhs_sensitivity(bars_lhs, settings)
    write_parquet(sens, settings.results_path("lhs_sensitivity.parquet"))
    logger.info("LHS xong — độ nhạy trọng số (Spearman TB): {}",
                round(float(sens["mean_spearman"].mean()), 4))

    alerts = run_alerts(settings, snaps)
    write_parquet(alerts, settings.results_path("alerts.parquet"))
    logger.info("Cảnh báo: {} sự kiện trên {} phiên", len(alerts), snaps["session_date"].nunique())

    res_rows = []
    for (ds, sym), g in snaps.groupby(["session_date", "symbol"]):
        ep = resilience_episodes(g)
        if ep.empty:
            continue
        ep["session_date"], ep["symbol"] = ds, sym
        ep["group"] = settings.group_of(sym)
        res_rows.append(ep)
    resilience = pd.concat(res_rows, ignore_index=True) if res_rows else pd.DataFrame()
    write_parquet(resilience, settings.results_path("resilience.parquet"))
    logger.info("Resilience: {} episode", len(resilience))


def cmd_validate(args) -> None:
    from .analytics import validation as V
    from .analytics.calibration import run_walk_forward
    from .data.pipeline import load_curated
    from .data.store import read_parquet
    settings = load_settings(args.config)
    data = load_curated(settings)
    snaps, bars = data["snapshots"], data["bars"]
    bars_lhs = read_parquet(settings.results_path("bars_lhs.parquet"))
    alerts = read_parquet(settings.results_path("alerts.parquet"))
    lhs_sens = read_parquet(settings.results_path("lhs_sensitivity.parquet"))
    resilience = read_parquet(settings.results_path("resilience.parquet"))

    orders, preds, fold_params = run_walk_forward(settings, snaps, bars)
    write_parquet(orders, settings.results_path("orders.parquet"))
    write_parquet(preds, settings.results_path("predictions.parquet"))
    write_parquet(fold_params, settings.results_path("fold_params.parquet"))

    metrics = V.metrics_table(preds)
    write_parquet(metrics, settings.results_path("metrics.parquet"))
    metrics_cov = V.metrics_by_coverage(preds)
    write_parquet(metrics_cov, settings.results_path("metrics_coverage.parquet"))
    reps = int(settings.validation.bootstrap_reps)
    seed = int(settings.validation.bootstrap_seed)
    boot_fl = V.session_bootstrap(preds, "full", "ladder_only", reps, seed)
    boot_fn = V.session_bootstrap(preds, "full", "naive_mid", reps, seed)
    full_rows = preds[preds["model"] == "full"]
    beyond_ids = set(full_rows.loc[full_rows["coverage"] < 1.0, "order_id"])
    boot_beyond = V.session_bootstrap(preds, "full", "ladder_only", reps, seed, order_ids=beyond_ids)
    coverage = V.pi_coverage(preds)
    write_parquet(coverage, settings.results_path("coverage.parquet"))
    dates = sorted(snaps["session_date"].unique())
    test_dates = dates[int(settings.validation.min_train_sessions):]
    ic = V.lhs_forward_ic(bars_lhs, test_dates)
    write_parquet(ic, settings.results_path("lhs_ic.parquet"))
    obi_tab = V.obi_direction_table(bars, test_dates)
    write_parquet(obi_tab, settings.results_path("obi_direction.parquet"))
    pr = V.alert_precision_recall(alerts, settings)
    write_parquet(pr, settings.results_path("alert_pr.parquet"))

    res_stats = {}
    if not resilience.empty:
        for grp, g in resilience.groupby("group"):
            rec = g["recover_s"].dropna()
            res_stats[grp] = {
                "n_episodes": len(g),
                "median_recover_s": float(rec.median()) if len(rec) else None,
                "p90_recover_s": float(rec.quantile(0.9)) if len(rec) else None,
                "unrecovered_frac": float(g["unrecovered"].mean()),
            }

    summary = V.build_summary(
        settings, metrics, boot_fl, boot_fn, coverage, ic, obi_tab, pr,
        fold_params, orders, preds, lhs_sens, res_stats,
        data["quality_meta"], snaps,
        metrics_coverage=metrics_cov, boot_beyond=boot_beyond,
    )
    out = settings.results_path("summary.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    logger.info("KẾT QUẢ (ngoài mẫu, {} lệnh test):", len(preds) // 3)
    for _, r in metrics[metrics["group"] == "ALL"].iterrows():
        logger.info("  {:12s} MAE={:7.2f} bps  RMSE={:7.2f}  bias={:+7.2f}",
                    r["model"], r["mae_bps"], r["rmse_bps"], r["bias_bps"])
    logger.info("  ΔMAE full−ladder (tất cả) = {:+.2f} bps, CI95 [{:.2f}, {:.2f}], p={:.3f}",
                boot_fl["delta_mae_bps"], boot_fl["ci95_lo"], boot_fl["ci95_hi"], boot_fl["p_two_sided"])
    if boot_beyond.get("n_sessions"):
        logger.info("  ΔMAE full−ladder (VƯỢT SỔ, n={} lệnh) = {:+.2f} bps, CI95 [{:.2f}, {:.2f}], p={:.3f}",
                    len(beyond_ids), boot_beyond["delta_mae_bps"], boot_beyond["ci95_lo"],
                    boot_beyond["ci95_hi"], boot_beyond["p_two_sided"])
    cov_all = coverage[coverage["group"] == "ALL"].iloc[0]
    logger.info("  Độ phủ PI 90%: {:.1%} (Wilson [{:.1%}, {:.1%}])",
                cov_all["coverage"], cov_all["wilson_lo"], cov_all["wilson_hi"])
    logger.info("Summary → {}", out)


def cmd_all(args) -> None:
    settings = load_settings(args.config)
    if settings.mode == "SYNTHETIC":
        cmd_synth(args)
    cmd_process(args)
    cmd_analyze(args)
    cmd_validate(args)


def cmd_record(args) -> None:
    import asyncio
    settings = load_settings(args.config)
    if settings.mode != "LIVE":
        raise RuntimeError("Đặt NEOSCOPE_MODE=LIVE trong .env để ghi dữ liệu thật.")
    session_dir = _new_live_capture_dir(settings)
    if settings.provider == "NEO":
        from .neo_api.ws import NeoMarketWS
        asyncio.run(NeoMarketWS(settings, session_dir).run())
    else:
        from .ssi_api.ws import SsiMarketWS
        SsiMarketWS(settings, session_dir).run()


def cmd_snapshot(args) -> None:
    from .data.store import RawWriter
    from .neo_api.rest import NeoRestClient
    settings = load_settings(args.config)
    if settings.mode != "LIVE" or settings.provider != "NEO":
        raise RuntimeError("`neoscope snapshot` chỉ dùng với provider NEO; SSI depth được ghi qua `neoscope record`.")
    client = NeoRestClient(settings)
    try:
        body = client.stock_detail(symbols=settings.watchlist())
        session_dir = _new_live_capture_dir(settings)
        writer = RawWriter(session_dir, "LIVE", meta={
            "provider": "VPBankS NEO API", "source": "REST /stock/stockDetail",
            "config_hash": settings.config_hash,
        })
        data = body.get("data", body)
        items = data if isinstance(data, list) else data.get("content", data.get("list", []))
        for item in items:
            writer.write("stockInfo", item)
        writer.close()
        logger.info("NEO REST snapshot: {} symbols | {}", len(items), client.compliance_report())
    finally:
        client.close()


def cmd_app(args) -> None:
    app_path = Path(__file__).parent / "app" / "main.py"
    cmd = [sys.executable, "-m", "streamlit", "run", str(app_path),
           "--server.address", "127.0.0.1", "--server.port", str(args.port),
           "--server.headless", "true", "--browser.gatherUsageStats", "false",
           # Bind localhost and retain Streamlit's CORS/XSRF defaults. Remote
           # publication requires a separately reviewed authenticated proxy.
           ]
    subprocess.run(cmd, cwd=REPO_ROOT, check=False)


def main() -> None:
    parser = argparse.ArgumentParser(prog="neoscope", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=None, help="đường dẫn settings.yaml thay thế")
    parser.add_argument("--mode", choices=("SYNTHETIC", "LIVE"), default=None,
                        help="ghi đè chế độ cấu hình cho lệnh này (ví dụ SYNTHETIC để demo offline)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("synth", help="sinh dữ liệu mô phỏng (SYNTHETIC)")
    p.add_argument("--sessions", type=int, default=None)
    p.set_defaults(fn=cmd_synth)
    p = sub.add_parser("process", help="RAW → curated")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_process)
    p = sub.add_parser("analyze", help="LHS + cảnh báo + resilience")
    p.set_defaults(fn=cmd_analyze)
    p = sub.add_parser("validate", help="walk-forward + kiểm chứng")
    p.set_defaults(fn=cmd_validate)
    p = sub.add_parser("all", help="toàn bộ pipeline")
    p.add_argument("--sessions", type=int, default=None)
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_all)
    p = sub.add_parser("record", help="LIVE: ghi provider đang chọn (SSI mặc định, NEO dự phòng)")
    p.set_defaults(fn=cmd_record)
    p = sub.add_parser("snapshot", help="LIVE NEO: ghi snapshot cổ phiếu qua REST")
    p.set_defaults(fn=cmd_snapshot)
    p = sub.add_parser("app", help="mở dashboard")
    p.add_argument("--port", type=int, default=8501)
    p.set_defaults(fn=cmd_app)
    args = parser.parse_args()
    if args.mode is not None:
        os.environ["NEOSCOPE_MODE"] = args.mode
    args.fn(args)


if __name__ == "__main__":
    main()
