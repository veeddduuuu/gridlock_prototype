"""Empirical coverage test for the deployed conformal prediction intervals.

Loads the production champion via Predictor (stacking + regime blend + conformal),
predicts on the held-out chronological test set, and measures what fraction of
true durations actually fall inside the nominal 90% interval.

A correctly calibrated 90% interval should cover ~90% of held-out cases.
Run from apps/ml:  python -m scripts.verify_conformal_coverage
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.data import load_and_prepare, chrono_split, load_config
from src.predict import Predictor, find_latest_artifacts
from src.constants import DURATION_COL


def main():
    cfg = load_config()
    df = load_and_prepare(cfg)
    _, test_df = chrono_split(df, cfg["train_test"]["test_fraction"])

    art = find_latest_artifacts()
    predictor = Predictor()
    print(f"\nArtifacts dir : {art.name}")
    print(f"Test rows     : {len(test_df)}")
    print(f"Conformal cal : {'loaded' if predictor._conformal_cal else 'MISSING'}\n")

    covered = 0
    widths = []
    point_abs_err = []
    n = 0
    per_corridor = {}  # corridor -> [covered, total]

    for _, row in test_df.iterrows():
        event = row.to_dict()
        true_dur = float(row[DURATION_COL])
        try:
            out = predictor.predict(event)
        except Exception as e:
            print(f"  predict failed: {e}")
            continue

        iv = out["prediction_interval"]
        lo, hi = iv["lower_mins"], iv["upper_mins"]
        if lo is None or hi is None:
            continue

        n += 1
        inside = lo <= true_dur <= hi
        covered += int(inside)
        widths.append(hi - lo)
        point_abs_err.append(abs(out["predicted_duration_mins"] - true_dur))

        corr = str(event.get("corridor", "") or "unknown")
        pc = per_corridor.setdefault(corr, [0, 0])
        pc[0] += int(inside)
        pc[1] += 1

    cov = covered / n if n else 0.0
    print("=" * 56)
    print(f"  NOMINAL coverage target : 0.90")
    print(f"  EMPIRICAL coverage      : {cov:.3f}  ({covered}/{n})")
    print(f"  Median interval width   : {np.median(widths):.1f} min")
    print(f"  Median point |error|    : {np.median(point_abs_err):.1f} min")
    print("=" * 56)

    verdict = "OK (within ±0.05 of nominal)" if abs(cov - 0.90) <= 0.05 else \
              ("OVER-covered (intervals too wide)" if cov > 0.95 else
               "UNDER-covered (intervals too narrow / wrong model)")
    print(f"  VERDICT: {verdict}\n")

    # Per-corridor breakdown (corridors with >=15 test samples)
    print("  Per-corridor coverage (n>=15):")
    for corr, (c, t) in sorted(per_corridor.items(), key=lambda x: -x[1][1]):
        if t >= 15:
            print(f"    {corr[:28]:<28} {c/t:.2f}  ({c}/{t})")


if __name__ == "__main__":
    main()
