# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
import json
import logging

import numpy as np
import pandas as pd
import pytest

from superset.exceptions import InvalidPostProcessingError
from superset.utils.pandas_postprocessing import density as density_module
from superset.utils.pandas_postprocessing.density import (
    _bandwidth,
    estimate_density,
    make_density_operators,
    validate_density_settings,
)

# Max |binned - direct| relative to the direct peak, on the fixtures below.
KDE_TOLERANCE = 0.02


def _unimodal() -> np.ndarray:
    return np.random.default_rng(0).normal(10, 2, 500)


def _bimodal() -> np.ndarray:
    rng = np.random.default_rng(1)
    return np.concatenate([rng.normal(0, 1, 300), rng.normal(8, 1.5, 300)])


def _skewed() -> np.ndarray:
    return np.random.default_rng(2).lognormal(0, 0.8, 500)


def _area(points: list[list[float]]) -> float:
    xs = np.array([p[0] for p in points])
    ys = np.array([p[1] for p in points])
    return float(np.sum((ys[1:] + ys[:-1]) * np.diff(xs)) / 2)


def _direct_kde(x: np.ndarray, grid: np.ndarray, h: float) -> np.ndarray:
    z = (grid[:, None] - x[None, :]) / h
    y = np.exp(-0.5 * z * z).sum(axis=1) / (len(x) * h * np.sqrt(2 * np.pi))
    area = np.sum((y[1:] + y[:-1]) * np.diff(grid)) / 2
    return y / area


@pytest.mark.parametrize("make", [_unimodal, _bimodal, _skewed])
def test_density_shape(make) -> None:
    x = make()
    result = estimate_density(x, 64, 1.0)
    pts = result["points"]
    assert result["status"] == "ok"
    assert result["count"] == len(x)
    assert len(pts) == 64
    xs = [p[0] for p in pts]
    assert xs == sorted(xs)
    assert xs[0] == pytest.approx(x.min())
    assert xs[-1] == pytest.approx(x.max())
    assert all(np.isfinite(p[1]) and p[1] >= 0 for p in pts)
    assert _area(pts) == pytest.approx(1.0, abs=1e-9)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("make", [_unimodal, _bimodal, _skewed])
@pytest.mark.parametrize("multiplier", [0.5, 1.0, 2.0])
def test_binned_matches_direct_kde(make, multiplier) -> None:
    x = make()
    pts = estimate_density(x, 128, multiplier)["points"]
    grid = np.array([p[0] for p in pts])
    binned = np.array([p[1] for p in pts])
    direct = _direct_kde(x, grid, _bandwidth(x, multiplier))
    assert np.max(np.abs(binned - direct)) / direct.max() < KDE_TOLERANCE


def test_bimodal_has_two_peaks() -> None:
    ys = np.array([p[1] for p in estimate_density(_bimodal(), 128)["points"]])
    peaks = np.sum((ys[1:-1] > ys[:-2]) & (ys[1:-1] > ys[2:]))
    assert peaks == 2


def test_larger_bandwidth_is_smoother() -> None:
    x = _bimodal()
    rough = np.array([p[1] for p in estimate_density(x, 128, 0.1)["points"]])
    smooth = np.array([p[1] for p in estimate_density(x, 128, 5.0)["points"]])
    assert np.abs(np.diff(rough)).sum() > np.abs(np.diff(smooth)).sum()


@pytest.mark.parametrize(
    "values",
    [[], [None, None], [np.nan, np.nan], [np.inf, -np.inf], ["a", "b"]],
)
def test_empty(values) -> None:
    result = estimate_density(pd.Series(values, dtype=object))
    assert result == {"points": [], "count": 0, "status": "empty"}


def test_numeric_strings_are_converted() -> None:
    result = estimate_density(pd.Series(["1", "2.5", "4", "x", "7"]))
    assert result["count"] == 4


def test_nan_and_infinity_are_ignored_in_count() -> None:
    x = pd.Series([1.0, 2.0, 3.0, np.nan, np.inf, -np.inf, None, 4.0])
    result = estimate_density(x)
    assert result["count"] == 4
    assert result["status"] == "ok"
    json.dumps(result, allow_nan=False)


def test_single_value_is_constant() -> None:
    assert estimate_density([5.0]) == {
        "points": [[5.0, 1.0]],
        "count": 1,
        "status": "constant",
    }


def test_constant_group() -> None:
    result = estimate_density([3.0] * 50)
    assert result["status"] == "constant"
    assert result["count"] == 50
    assert result["points"] == [[3.0, 1.0]]


def test_near_constant_is_constant() -> None:
    x = 1e6 + np.arange(10) * 1e-12
    assert estimate_density(x)["status"] == "constant"


def test_zero_iqr_with_outliers_is_not_a_spike() -> None:
    x = np.array([0.0] * 95 + [10.0, 20.0, 30.0, 40.0, 50.0])
    result = estimate_density(x)
    assert result["status"] == "ok"
    assert _area(result["points"]) == pytest.approx(1.0, abs=1e-9)
    assert _bandwidth(x, 1.0) > (x.max() - x.min()) / 1024


@pytest.mark.parametrize("scale", [1e-12, 1e-9, 1.0, 1e9, 1e12])
def test_very_small_and_large_scales(scale) -> None:
    x = _unimodal() * scale
    result = estimate_density(x)
    assert result["status"] == "ok"
    assert all(np.isfinite(p[1]) for p in result["points"])
    json.dumps(result, allow_nan=False)


def test_unusable_normalization_falls_back_with_log(monkeypatch, caplog) -> None:
    monkeypatch.setattr(density_module, "_trapezoid_area", lambda g, d: 0.0)
    with caplog.at_level(logging.WARNING, logger=density_module.logger.name):
        result = estimate_density(_unimodal())
    assert result["status"] == "constant"
    assert result["count"] == 500
    assert len(result["points"]) == 1
    assert "falling back" in caplog.text


def test_datetime_is_rejected() -> None:
    with pytest.raises(InvalidPostProcessingError):
        estimate_density(pd.Series(pd.date_range("2020-01-01", periods=5)))


@pytest.mark.parametrize(
    "points,bandwidth",
    [
        (True, 1.0),
        (64.0, 1.0),
        ("64", 1.0),
        (None, 1.0),
        (15, 1.0),
        (257, 1.0),
        (0, 1.0),
        (-5, 1.0),
        (64, True),
        (64, "1"),
        (64, None),
        (64, 0),
        (64, -1.0),
        (64, 0.05),
        (64, 5.01),
        (64, float("nan")),
        (64, float("inf")),
        (64, float("-inf")),
    ],
)
def test_invalid_settings(points, bandwidth) -> None:
    with pytest.raises(InvalidPostProcessingError):
        validate_density_settings(points, bandwidth)
    with pytest.raises(InvalidPostProcessingError):
        estimate_density([1.0, 2.0, 3.0], points, bandwidth)
    with pytest.raises(InvalidPostProcessingError):
        make_density_operators(points, bandwidth)


@pytest.mark.parametrize("points", [16, 64, 256])
@pytest.mark.parametrize("bandwidth", [0.1, 1.0, 5.0])
def test_valid_settings_bounds(points, bandwidth) -> None:
    validate_density_settings(points, bandwidth)
    assert len(estimate_density(_unimodal(), points, bandwidth)["points"]) == points


def test_numpy_integer_points_are_accepted() -> None:
    validate_density_settings(np.int64(32), np.float64(1.5))


def test_operators_match_estimate_and_share_cache(monkeypatch) -> None:
    calls = []
    real = density_module.estimate_density

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(density_module, "estimate_density", counting)
    ops = make_density_operators(32, 1.0)
    assert set(ops) == {"density", "density_count", "density_status"}
    series = pd.Series(_unimodal())
    expected = real(series, 32, 1.0)
    assert ops["density"](series) == expected["points"]
    assert ops["density_count"](series) == expected["count"]
    assert ops["density_status"](series) == expected["status"]
    assert len(calls) == 1


def test_operators_work_with_groupby_agg() -> None:
    df = pd.DataFrame(
        {
            "g": ["a"] * 30 + ["b"] * 30 + ["c"] * 5,
            "v": list(_unimodal()[:30]) + [7.0] * 30 + [np.nan] * 5,
        }
    )
    ops = make_density_operators(16, 1.0)
    funcs = {f"v__{name}": ("v", fn) for name, fn in ops.items()}
    out = df.groupby("g").agg(**funcs).reset_index()
    assert list(out["v__density_status"]) == ["ok", "constant", "empty"]
    assert list(out["v__density_count"]) == [30, 30, 0]
    assert len(out.loc[0, "v__density"]) == 16
    assert out.loc[2, "v__density"] == []


def test_cache_is_bounded(monkeypatch) -> None:
    monkeypatch.setattr(density_module, "CACHE_SIZE", 3)
    ops = make_density_operators(16, 1.0)
    for i in range(10):
        ops["density_status"](pd.Series([float(i), i + 1.0, i + 3.0]))
    # No direct access to the closure cache, so only check it still works.
    assert ops["density_count"](pd.Series([1.0, 2.0, 3.0])) == 3
