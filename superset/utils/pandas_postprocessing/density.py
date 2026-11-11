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
"""
Private helper that computes a binned Gaussian kernel density estimate (KDE).

It is used by the ``boxplot`` post-processing operation to draw violin shapes.
It is intentionally *not* exported from ``pandas_postprocessing/__init__.py``,
so it is not available as a public post-processing operation.
"""

from __future__ import annotations

import hashlib
import logging
import numbers
from collections import OrderedDict
from collections.abc import Callable, Sequence
from typing import Any

import numpy as np
import pandas as pd
from flask_babel import gettext as _
from pandas.api.types import is_datetime64_any_dtype, is_timedelta64_dtype

from superset.exceptions import InvalidPostProcessingError

logger = logging.getLogger(__name__)

DENSITY_POINTS_DEFAULT = 64
DENSITY_POINTS_MIN = 16
DENSITY_POINTS_MAX = 256
DENSITY_BANDWIDTH_DEFAULT = 1.0
# Provisional bounds, to be confirmed with the maintainers.
DENSITY_BANDWIDTH_MIN = 0.1
DENSITY_BANDWIDTH_MAX = 5.0

STATUS_OK = "ok"
STATUS_EMPTY = "empty"
STATUS_CONSTANT = "constant"

NUM_BINS = 512
# A group whose spread is below this fraction of its magnitude is "constant".
RELATIVE_EPSILON = 1e-12
# Max number of per-group results kept by one set of operators.
CACHE_SIZE = 1024
# 2 * sqrt(2 * ln 2) / 1.34: converts IQR to a std-like scale (normal data)
IQR_TO_STD = 1.34
SILVERMAN_FACTOR = 0.9


def validate_density_settings(points: Any, bandwidth: Any) -> None:
    """
    Validate the density settings.

    :param points: number of grid points, an integer in [16, 256]
    :param bandwidth: positive finite multiplier in [0.1, 5]
    :raises InvalidPostProcessingError: If either setting is invalid
    """
    if (
        isinstance(points, bool)
        or not isinstance(points, numbers.Integral)
        or not DENSITY_POINTS_MIN <= int(points) <= DENSITY_POINTS_MAX
    ):
        raise InvalidPostProcessingError(
            _(
                "density_points must be an integer between %(min)s and %(max)s",
                min=DENSITY_POINTS_MIN,
                max=DENSITY_POINTS_MAX,
            )
        )
    if (
        isinstance(bandwidth, (bool, np.bool_))
        or not isinstance(bandwidth, numbers.Real)
        or not np.isfinite(float(bandwidth))
        or not DENSITY_BANDWIDTH_MIN <= float(bandwidth) <= DENSITY_BANDWIDTH_MAX
    ):
        raise InvalidPostProcessingError(
            _(
                "density_bandwidth must be a number between %(min)s and %(max)s",
                min=DENSITY_BANDWIDTH_MIN,
                max=DENSITY_BANDWIDTH_MAX,
            )
        )


def _finite_values(values: pd.Series | Sequence[Any] | np.ndarray) -> np.ndarray:
    """
    Return the finite numeric observations as a float64 array.

    Nulls, NaN, infinities and non-numeric strings are dropped. Numeric strings
    are converted.

    :raises InvalidPostProcessingError: for datetime or timedelta data
    """
    series = values if isinstance(values, pd.Series) else pd.Series(values)
    if is_datetime64_any_dtype(series.dtype) or is_timedelta64_dtype(series.dtype):
        raise InvalidPostProcessingError(_("Density requires numeric values"))
    numeric = pd.to_numeric(series, errors="coerce")
    array = numeric.to_numpy(dtype=np.float64, na_value=np.nan)
    return array[np.isfinite(array)]


def _result(points: list[list[float]], count: int, status: str) -> dict[str, Any]:
    return {"points": points, "count": count, "status": status}


def _constant_result(value: float, count: int) -> dict[str, Any]:
    return _result([[float(value), 1.0]], count, STATUS_CONSTANT)


def _bandwidth(x: np.ndarray, multiplier: float) -> float:
    """
    Silverman-style bandwidth using a robust scale, scaled by ``multiplier``.

    The floor is relative to the data range (half a histogram bin), because the
    binned estimator cannot resolve anything narrower than that.
    """
    n = len(x)
    spread = float(x.max() - x.min())
    std = float(np.std(x, ddof=1))
    q1, q3 = np.percentile(x, [25, 75])
    iqr = float(q3 - q1)
    scale = std if iqr <= 0 else min(std, iqr / IQR_TO_STD)
    h = SILVERMAN_FACTOR * scale * n**-0.2 * multiplier
    floor = spread / (2 * NUM_BINS)
    if not np.isfinite(h):
        return floor
    return max(h, floor)


def _trapezoid_area(grid: np.ndarray, density: np.ndarray) -> float:
    return float(np.sum((density[1:] + density[:-1]) * np.diff(grid)) / 2.0)


def estimate_density(
    values: pd.Series | Sequence[Any] | np.ndarray,
    points: int = DENSITY_POINTS_DEFAULT,
    bandwidth: float = DENSITY_BANDWIDTH_DEFAULT,
) -> dict[str, Any]:
    """
    Estimate a Gaussian KDE on a regular grid, using binned data.

    Observations are put in 512 bins and the kernel is evaluated against the
    bin centers, so the cost is O(N + B*M) instead of O(N*M). Only one
    group/metric is processed per call, and nothing of size N x M is allocated.

    The curve is cut at the observed min and max and normalized so that its
    trapezoid area is 1.

    :param values: observations of a single group/metric
    :param points: number of grid points (16-256)
    :param bandwidth: multiplier on the automatic bandwidth (0.1-5)
    :return: ``{"points": [[x, density], ...], "count": int, "status": str}``
        where status is ``ok``, ``empty`` or ``constant`` and count is the
        number of finite observations used
    :raises InvalidPostProcessingError: If the settings are invalid
    """
    validate_density_settings(points, bandwidth)
    points = int(points)
    multiplier = float(bandwidth)

    x = _finite_values(values)
    n = len(x)
    if n == 0:
        return _result([], 0, STATUS_EMPTY)

    x_min, x_max = float(x.min()), float(x.max())
    spread = x_max - x_min
    if spread <= RELATIVE_EPSILON * max(abs(x_min), abs(x_max), 1.0):
        return _constant_result(x_min, n)

    h = _bandwidth(x, multiplier)
    counts, edges = np.histogram(x, bins=NUM_BINS, range=(x_min, x_max))
    centers = (edges[:-1] + edges[1:]) / 2.0
    grid = np.linspace(x_min, x_max, points)

    # (M, B) matrix: bounded by points * NUM_BINS, independent of N.
    z = (grid[:, None] - centers[None, :]) / h
    density = (np.exp(-0.5 * z * z) * counts[None, :]).sum(axis=1) / (
        n * h * np.sqrt(2.0 * np.pi)
    )

    area = _trapezoid_area(grid, density)
    if not np.all(np.isfinite(density)) or not np.isfinite(area) or area <= 0:
        logger.warning(
            "Density normalization unusable (area=%s, n=%s, h=%s); "
            "falling back to a constant marker",
            area,
            n,
            h,
        )
        return _constant_result(float(np.median(x)), n)

    density = density / area
    return _result(
        [[float(a), float(b)] for a, b in zip(grid, density, strict=True)],
        n,
        STATUS_OK,
    )


def make_density_operators(
    points: int = DENSITY_POINTS_DEFAULT,
    bandwidth: float = DENSITY_BANDWIDTH_DEFAULT,
) -> dict[str, Callable[[pd.Series], Any]]:
    """
    Build the three per-group operators used by ``boxplot``.

    Each operator maps one group's ``Series`` to a single cell value, so they
    work with ``aggregate()``. The KDE is computed once per distinct group and
    shared between the operators through a small per-call LRU cache, which is
    created here and not global.

    Keys are the operator names, so the output columns are
    ``<metric>__density``, ``<metric>__density_count`` and
    ``<metric>__density_status``.

    :param points: number of grid points (16-256)
    :param bandwidth: multiplier on the automatic bandwidth (0.1-5)
    :raises InvalidPostProcessingError: If the settings are invalid
    """
    validate_density_settings(points, bandwidth)
    cache: OrderedDict[bytes, dict[str, Any]] = OrderedDict()

    def compute(series: pd.Series) -> dict[str, Any]:
        x = _finite_values(series)
        key = hashlib.blake2b(x.tobytes(), digest_size=16).digest()
        cached = cache.get(key)
        if cached is not None:
            cache.move_to_end(key)
            return cached
        result = estimate_density(x, points, bandwidth)
        cache[key] = result
        if len(cache) > CACHE_SIZE:
            cache.popitem(last=False)
        return result

    def density(series: pd.Series) -> list[list[float]]:
        return compute(series)["points"]

    def density_count(series: pd.Series) -> int:
        return compute(series)["count"]

    def density_status(series: pd.Series) -> str:
        return compute(series)["status"]

    return {
        "density": density,
        "density_count": density_count,
        "density_status": density_status,
    }
