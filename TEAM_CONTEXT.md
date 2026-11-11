# Violin mode for Box Plot: Team context

Written 2026-11-10 by Mustafa (Role A: density math). Reference checkout `56ff8920385c`, shared branch `feat/boxplot-violin`.
**This is a coordination note, not part of the PR. Remove it before the final push to Superset.**

Two sources are combined here:
- **Team design doc** ("Violin Option: Design Decisions", agreed in Discord on 2026-11-05, final unless Tareq records a change). Summarized in section 2.
- **Role A's implementation session** (2026-11-08 to 2026-11-10). Sections 3 and 4.

**Section 5 lists where the two disagree. Please read it first. Those items need a team decision.**

Roles: **A** backend math (Mustafa) · **B** backend integration and data format · **C** frontend rendering · **D** controls and community (Tareq)

## 1. Status

| Item | State |
|---|---|
| `superset/utils/pandas_postprocessing/density.py` | Written (A) |
| `tests/unit_tests/pandas_postprocessing/test_density.py` | Written (A), 63 tests passing |
| Tests run in the real Superset env | **No.** They ran only against stubbed `flask_babel` and `superset.exceptions` (no dev env yet). Rerun once an env exists. |
| `pre-commit` (ruff, mypy), `test_boxplot.py` | **Not run** |
| Benchmark (time, memory, response size, accuracy vs direct KDE) | **Not written.** No speed or accuracy claims until measured. |
| Integration through Superset's real `boxplot()` | **Not tested** |
| `density.py` vs the team design doc | **Not yet aligned.** See section 5. |
| Not touched by A | `boxplot.py`, `schemas.py`, `pandas_postprocessing/__init__.py`, any TypeScript |

## 2. Team design doc (agreed 2026-11-05, final unless Tareq records a change)

### Data format

| # | Decision | Final choice | Affects |
|---|---|---|---|
| 1 | Naming of new settings | **snake_case** (e.g. `distribution_style`). `boxplotOperator.ts` sees snake_case. `transformProps.ts` sees camelCase (`distributionStyle`). | B, C, D |
| 2 | How the mode is stored | Text value `"box" \| "violin"`. A missing value means `"box"`, so saved charts don't change. | B, C, D |
| 3 | Settings, defaults, ranges | Proposed defaults adopted (table below). | A, B, D |
| 4 | What gets sent to the server | **Only in violin mode:** `density_points` and `density_bandwidth` are added to the `boxplot` options. If absent, the server returns exactly what it returns today. | B, D |
| 5 | Where the curve appears | **A new column per metric:** `${metric}__density`, next to `${metric}__outliers`. Two underscores like the existing columns. | B, C |
| 6 | Format of each curve | A list of pairs: `[[value, density], ...]` | A, B, C |
| 7 | How far the curve extends | From the actual minimum to the actual maximum, including outliers. Not stopped at the whiskers, not extended past the data. | A, C |
| 8 | How the curve is scaled | **Raw density:** each curve's area is 1. The frontend handles width scaling (per-group peak, shared peak, or multiplied by `__count`). | A, C, D |
| 9 | Edge cases | **No status field.** Empty group returns `[]` and nothing is drawn. Null and NaN are dropped before the calculation. All-same-value group: proposal is `[[v, 1.0]]`, drawn as a single marker. A should confirm this in tests. | A, C |

### Decision 3: settings

| Setting | Default | Allowed range | Control |
|---|---|---|---|
| `distribution_style` | `"box"` | `"box"`, `"violin"` | Radio |
| `density_bandwidth` | `1.0` | 0.1 - 5 | Free-form select |
| `density_points` | `100` | 20 - 500 | **No control in the first PR** (D4). The request always sends `100`. |
| `show_inner_box` | `true` | true / false | Checkbox |
| `violin_width_scale` *(nice-to-have; name reserved)* | `"per_group"` | `"per_group"`, `"shared"` | Select |

The same ranges must appear in three places: the form controls (D), `ChartDataBoxplotOptionsSchema` (B), and the Python checks (A/B).
The smoothness and inner-box controls show only when `distribution_style == "violin"`. The whisker setting stays visible because it still controls the inner box.

### Example response row (shared test fixture)

```json
{
  "school_degree": "Ph.D.",
  "AVG(last_yr_income)__median": 51250.0,
  "AVG(last_yr_income)__q1": 36083.3,
  "AVG(last_yr_income)__q3": 66666.7,
  "AVG(last_yr_income)__count": 49,
  "AVG(last_yr_income)__outliers": [210000.0],
  "AVG(last_yr_income)__density": [[0.0, 1.1e-6], [2121.2, 1.4e-6]]
}
```
Box-plot numbers are from a real local query on the FCC survey example dataset. Density values are placeholders.

### Left to each owner
- **A:** bandwidth rule (Silverman or Scott) and bin count (512). Internal, doesn't change the format. *A chose Silverman with 512 bins.*
- **C:** whether outlier dots show in violin mode, inner box width, tooltip content.
- **A, D:** default numbers can change later if names and meanings stay the same.

### D: settings panel design (Tareq, from /grill-me, 2026-11-06)

| # | Decision |
|---|---|
| D1 | All four violin settings go in the **Query** section. `distribution_style` sits directly above "Whisker/outlier options"; violin-only settings directly below it. `show_inner_box` keeps `renderTrigger: true`. |
| D2 | Box / Violin switch is a `RadioButtonControl` (like Bar orientation). Default `"box"`. |
| D3 | `density_bandwidth` uses a `SelectControl` with `freeForm: true` (like Histogram `bins`). Presets `0.5` (more detail), `1` (default), `1.5`, `2` (smoother). Typed values validated to 0.1-5. Label is **"Curve smoothness"**; "bandwidth" only in help text. |
| D4 | `density_points` is **not shown in the panel in the first PR.** The request always sends `density_points: 100`. The server still validates it (range 20-500) and the name stays reserved. B's operator sends a fixed value. |
| D5 | Default hiding behaviour for violin settings in Box mode (no `disableStash`). **For B:** send density options only when `distribution_style === "violin"`. Do **not** decide based on whether `density_bandwidth` is present, because API-made charts can include it in Box mode. |
| D6 | All strings wrapped in `t()`, sentence case. Help text for Distribution style, Curve smoothness and Show inner box is fixed in the design doc. |
| D7 | Mention violin **only in the description** in `BoxPlot/index.ts`. No new tag, no rename. |
| D8 | Gallery: add a second `exampleGallery` entry ("Violin style"). Storybook: add a separate `Violin` story using the shared fixture. Both are late tasks (need C's drawing code). |
| D9 | Smoothness validation: `validateNumber`, `validateMaxValue(v, 5)`, plus a small minimum check inside Box Plot's `controlPanel.ts`. The server still rejects bad values. |
| D10 | `controlPanel.test.ts`: eight top-level `test()` blocks checking the config directly (radio, placement, hiding, validation, `renderTrigger`, defaults, no `density_points` setting). |
| D11 | Community log is a shared Google Sheet (**TODO Tareq: create it**). No GitHub issue. PR SUMMARY outline fixed. **AI line is on hold until the course AI policy is confirmed with a TA.** Tareq is the single contact: reply to reviews within 48 hours and ping at most once after a week. Tareq writes TESTING INSTRUCTIONS; A/B/C each add a step. |

### Change rule
To change anything above, open a PR that updates only the design doc and the shared test fixture, and tell everyone first so frontend and backend switch together.

## 3. Role A implementation decisions (this session)

| # | Decision | Why |
|---|---|---|
| A1 | Density is exposed as **three operators** (`density`, `density_count`, `density_status`) from `make_density_operators`. **Under review, see section 5 (conflict 1).** | Matches the proven pattern (`outliers` already returns a list per group). Dict/tuple cells through `aggregate()` are untested. |
| A2 | The operators share a **small per-call LRU cache** (1024 entries, created inside `make_density_operators`, not global) so the KDE runs once per distinct group. | Avoids computing the KDE three times. |
| A3 | A group is **constant** when `max - min <= 1e-12 * max(abs(min), abs(max), 1)` and returns `[[v, 1.0]]`. | Avoids spiky or NaN KDEs from float noise. Matches design #9. |
| A4 | If the normalization area is zero or not finite, or the density is non-finite, **log a warning and fall back to a constant marker** instead of raising. | One odd group should not fail the whole chart. |
| A5 | Keep the **(M x B) matrix** evaluation (about 1 MB max, independent of N). Don't loop per grid point. | Faster and simpler. Revisit only if the benchmark shows memory matters. Not the O(B+M) of the original handoff. |
| A6 | `density.py` is a **private helper**, not in `__init__.py` or `__all__`. | Adding it would put it in `OPERATIONS` and make it callable from any chart's `post_processing` spec. |
| A7 | Bandwidth bounds 0.1-5 match the design doc and are now **agreed**, no longer provisional. Points bounds do **not** match, see section 5 (conflict 2). | |
| A8 | Silverman bandwidth, `0.9 * min(std, IQR/1.34) * n^-0.2 * multiplier`, with a floor of `range / 1024`. 512 bins. | Within A's remit per the design doc. |

## 4. Contract for B (`boxplot.py`): current helper API

```python
from superset.utils.pandas_postprocessing.density import (
    make_density_operators,
    validate_density_settings,
)

# in boxplot(..., density_points=None, density_bandwidth=1.0):
if density_points is not None:
    validate_density_settings(density_points, density_bandwidth)  # real validation is B's job
    operators.update(make_density_operators(density_points, density_bandwidth))
```

- `make_density_operators` currently returns `density`, `density_count` and `density_status` operators. With the `f"{metric}__{operator_name}"` naming that gives three columns per metric. **The design doc only wants `__density`. See section 5.**
- Parameter names must be exactly `density_points` and `density_bandwidth`. `_drop_unsupported_options` (`query_object.py:251`) **silently drops** options not in the `boxplot()` signature. A typo turns density off with no error, so add an integration test with density on.
- `density_points=None` means density is off and the output must be unchanged. Add a regression test.
- Per D5, the frontend operator (`boxplotOperator.ts`) sends the density options only in violin mode, keyed on `distribution_style`.
- Settings are validated twice: B up front, and the helper again (`InvalidPostProcessingError`).
- Output is JSON-safe: floats only, no NaN or infinity. The curve is cut at the observed min and max and has trapezoid area 1.
- Only C edits `transformProps.ts`.

## 5. Conflicts between the design doc and Role A's work: team decision needed

The design doc is the team's agreement, so my default is to **align the helper to it**. I haven't changed any code yet.

### Conflict 1: `density_count` and `density_status` columns vs "no status field" (design #5 and #9)

Role A added `__density_count` and `__density_status` (`ok` / `empty` / `constant`) from the original handoff. The design says one `__density` column and no status field: empty is `[]`, constant is `[[v, 1.0]]`.

| Option | Pros | Cons |
|---|---|---|
| **Align to design:** only `__density` | Matches the agreed fixture and format. One column, a smaller response. C needs no status logic. | C can't tell a truly constant group from my normalization fallback. C can't tell "0 values" from "values dropped" other than by `[]`. |
| Keep the extra columns | `density_count` allows an accurate violin-width scale by finite observations. `status` is explicit for C. | Contradicts a "final" decision. Changes B's and C's work and the shared fixture. Needs a change PR and everyone's agreement. |

**A recommends aligning.** The helper already returns `[]` for empty and `[[v, 1.0]]` for constant, so it only needs `make_density_operators` to return `density`. The three-operator cache then becomes unnecessary. Keeping `estimate_density` returning count and status internally costs nothing. The width scale from design #8 can use the existing `__count`.

### Conflict 2: `density_points` default and range

| | Default | Range |
|---|---|---|
| Design doc | 100 | 20 - 500 |
| Current helper | 64 | 16 - 256 |

The request always sends 100, which the helper accepts. Any value above 256 (up to 500) would be rejected by the helper but allowed by the schema, and the doc says the same ranges must appear in three places.
- **Align (recommended):** change the helper to 20-500, default 100. A 500-point curve is cheap per group (about 2 MB matrix, still bounded).
- **Keep:** a smaller response, but it breaks the "same ranges" rule.

### Conflict 3 (minor): where the original handoff differed

The original Role A handoff described `density_points` as 16-256 with a default of 64, and a status field. Those came from before or outside the Discord agreement. Treat the design doc as the source of truth.

### Resolved (no action)
- Bandwidth range 0.1-5: matches.
- Curve extent (min to max, outliers included), area 1, `[[x, d], ...]` pairs, `[]` for empty, `[[v, 1.0]]` for constant: all match.
- Settings sent only in violin mode, absent means unchanged output: matches.

## 5b. Possible alternative (not adopted): convolution-based binned KDE

NumPy has no KDE function. `scipy.stats.gaussian_kde` exists, but scipy is not a declared dependency (checked `pyproject.toml` and `requirements/`), and the PR promises no new dependencies. The current helper uses `np.histogram` plus a hand-written (grid x bins) Gaussian sum.

Alternative: histogram on an evenly spaced grid, convolve with a Gaussian kernel (`np.convolve` or FFT), then `np.interp` onto the output grid (R's `density()` method).
- Pros: less code, no ~1 MB matrix, memory closer to O(B+M), well-known method.
- Cons: kernel truncation and edge handling needed, interpolation adds a little error.
- Decision (2026-11-11): not needed now. Revisit if the benchmark shows memory or speed problems. Existing tests (binned vs direct KDE) can validate it.

## 6. Known risks and gotchas

1. **Operator return shape through `aggregate()`:** list cells work (as `outliers` shows). Dict or tuple cells are unverified. Nobody has run the helper through Superset's own `boxplot()` yet. Only a plain pandas `groupby.agg` test exists.
2. **Silent parameter dropping:** see section 4.
3. **NaN in JSON:** guarded in the helper and tested with `allow_nan=False`.
4. **Count semantics:** `density_count` (if kept) counts finite values only and is not the legacy `count`. They differ whenever a group has nulls. Never show it as the box plot's `count`.
5. **Datetime and timedelta columns:** the helper rejects them with `InvalidPostProcessingError`. `boxplot` coerces non-numeric columns with `to_numeric`, so check what reaches the helper for date metrics.
6. **Shared test fixtures:** `test_boxplot_type_coercion` mutates `names_df` in place. Copy frames in new tests.
7. **Maintainer approval:** D is checking that extending the existing `boxplot` operation is acceptable (plus Ville's nod, whether a SIP is needed, and TA approval). A "no" mainly moves B's call site. The helper's math doesn't change.
8. **Silent fallback:** the normalization fallback draws a marker with only a log line. Without a status field, C can't distinguish it from a truly constant group.

## 7. Open items

- **Team (all):** decide conflicts 1 and 2 above. Tareq records the result in the design doc.
- **A:** after the decision, update `density.py` and its tests. Run tests, `pre-commit` and `test_boxplot.py` in a real dev environment.
- **A:** benchmark at the configured row limit once B's integration lands. Compare accuracy against a direct KDE.
- **B:** integration tests: multiple metrics, empty groupby, joining density to the right summary rows, density disabled. Also the D5 rule.
- **Tareq:** create the community log sheet, confirm the AI policy with a TA, and confirm that maintainers accept extending `boxplot`.

## 8. Repo rules to remember

- Python type hints and docstrings on all new code, and an ASF license header on new files.
- Frontend tests use `test()`, not `describe()`. No new `any` types.
- Run `pre-commit run` before pushing.

## 9. Change log

- 2026-11-05: Design decisions 1-9 adopted (Discord).
- 2026-11-06: D1-D4 added. `density_points` gets no control in the first PR.
- 2026-11-10: Role A helper written. Conflicts with the design doc recorded (section 5). Not yet resolved.
