"""Reproducible conformal calibration for the DEPLOYED champion.

Why this exists
---------------
The champion (stacking + soft-blend regime routing) is promoted by
experiments/promote.py, which does NOT emit conformal calibration. The
conformal_calibration.json shipped in the champion artifact dir was produced
ad-hoc with no committed generator, and was calibrated against a *different*
model (LGB-only OOF residuals) on the *train* period. Empirically that under-
covers: the nominal 90% interval covered only ~83% of held-out cases.

This script fixes both problems:
  * residuals come from the ACTUAL deployed pipeline (Predictor.predict), so the
    intervals match the model that serves them;
  * residuals are measured on the held-out period the champion never trained on,
    so coverage reflects the real (post-deployment) distribution;
  * split-conformal uses the finite-sample-adjusted rank quantile
    ceil((n+1)(1-alpha))/n rather than a plain empirical quantile.

It also runs an internal chronological calib/eval honesty check and prints the
generalization coverage before overwriting the artifact.

Usage (from apps/ml):
    python -m scripts.calibrate_conformal            # verify + write
    python -m scripts.calibrate_conformal --dry-run  # verify only, no write
"""

import argparse
import json
import math
import shutil
from datetime import datetime, timezone

import numpy as np

from src.data import load_and_prepare, chrono_split, load_config
from src.predict import Predictor, find_latest_artifacts
from src.constants import DURATION_COL

MIN_CORRIDOR_SAMPLES = 20  # below this, fall back to global at serve time
COVERAGES = (0.80, 0.90, 0.95)


def _adjusted_quantile(residuals: np.ndarray, coverage: float) -> float:
    """Split-conformal quantile with finite-sample correction.

    Returns the value q such that P(residual <= q) >= coverage with the
    standard conformal guarantee. Falls back to max residual when n is tiny.
    """
    n = len(residuals)
    if n == 0:
        return float("nan")
    rank = math.ceil((n + 1) * coverage)
    if rank > n:
        return float(np.max(residuals))
    # rank-th smallest (1-indexed) -> index rank-1
    return float(np.sort(residuals)[rank - 1])


def _deployed_residuals(predictor: Predictor, frame):
    """Absolute log-space residuals of the deployed pipeline + group labels."""
    resids, corridors, sev_bands = [], [], []
    for _, row in frame.iterrows():
        event = row.to_dict()
        true_dur = float(row[DURATION_COL])
        if not (true_dur > 0):
            continue
        try:
            out = predictor.predict(event)
        except Exception:
            continue
        pred_mins = float(out["predicted_duration_mins"])
        resid = abs(math.log1p(pred_mins) - math.log1p(true_dur))
        resids.append(resid)
        corridors.append(str(event.get("corridor", "") or "unknown"))
        sev_bands.append(f"sev:{out['severity_label']}")
    return np.asarray(resids), np.asarray(corridors), np.asarray(sev_bands)


def _quantile_block(r: np.ndarray) -> dict:
    return {
        **{f"q{int(c*100)}": _adjusted_quantile(r, c) for c in COVERAGES},
        "median": float(np.median(r)),
        "n_samples": int(len(r)),
    }


def _build_calibration(resids: np.ndarray, corridors: np.ndarray, sev_bands: np.ndarray) -> dict:
    cal = {"__global__": _quantile_block(resids)}
    # Per-corridor (primary key at serve time)
    for corr in np.unique(corridors):
        mask = corridors == corr
        if mask.sum() >= MIN_CORRIDOR_SAMPLES:
            cal[str(corr)] = _quantile_block(resids[mask])
    # Per-severity-band (fallback axis when corridor lacks calibration data)
    for band in np.unique(sev_bands):
        mask = sev_bands == band
        if mask.sum() >= MIN_CORRIDOR_SAMPLES:
            cal[str(band)] = _quantile_block(resids[mask])
    return cal


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="verify only, do not write")
    args = ap.parse_args()

    cfg = load_config()
    df = load_and_prepare(cfg)
    _, held_out = chrono_split(df, cfg["train_test"]["test_fraction"])

    art = find_latest_artifacts()
    predictor = Predictor()
    print(f"\nChampion dir   : {art.name}")
    print(f"Held-out rows  : {len(held_out)} (champion never trained on these)\n")

    resids, corridors, sev_bands = _deployed_residuals(predictor, held_out)
    print(f"Computed deployed residuals for {len(resids)} rows\n")

    # --- Honesty check: chronological calib/eval split of the held-out period ---
    split = int(len(resids) * 0.6)
    calib_r, eval_r = resids[:split], resids[split:]
    for cov in COVERAGES:
        q = _adjusted_quantile(calib_r, cov)
        emp = float(np.mean(eval_r <= q))
        print(f"  honesty check  cov={cov:.2f}  q={q:.3f}  "
              f"eval coverage={emp:.3f}  ({int((eval_r<=q).sum())}/{len(eval_r)})")
    print()

    # --- Ship: calibrate on the full held-out period (max data, model unseen) ---
    cal = _build_calibration(resids, corridors, sev_bands)
    g = cal["__global__"]
    n_sev = sum(1 for k in cal if k.startswith("sev:"))
    n_corr = len(cal) - 1 - n_sev
    print(f"  shipped global: q90={g['q90']:.3f}  median={g['median']:.3f}  "
          f"n={g['n_samples']}  corridors={n_corr}  severity_bands={n_sev}")

    if args.dry_run:
        print("\n[dry-run] not writing.\n")
        return

    out_path = art / "conformal_calibration.json"
    if out_path.exists():
        backup = art / f"conformal_calibration.prev_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.json"
        shutil.copy(out_path, backup)
        print(f"  backed up old calibration -> {backup.name}")
    with open(out_path, "w") as f:
        json.dump(cal, f, indent=2)
    print(f"  wrote {out_path}\n")


if __name__ == "__main__":
    main()
