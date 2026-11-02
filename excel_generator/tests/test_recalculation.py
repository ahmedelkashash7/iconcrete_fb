"""§51 — formula recalculation, verified rather than assumed.

The generator writes formulas plus a workbook-level ``fullCalcOnLoad`` flag. These tests
prove the flag is set, that formula cells carry no stale cached value, and that a real
spreadsheet engine recalculates them when one is available in the environment.

Run with:
    python -m pytest excel_generator/tests -q
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import config as cfg_module  # noqa: E402
import generate_workbook as gen  # noqa: E402


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("iconcrete_recalc")
    cfg = cfg_module.GeneratorConfig(output_dir=str(out))
    result = gen.generate(cfg, out)
    return result, out


def _formula_cells(workbook):
    found = []
    for sheet in workbook.worksheets:
        for row in sheet.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith("="):
                    found.append((sheet.title, cell.coordinate, cell.value))
    return found


def test_workbook_requests_recalculation_on_open(built):
    result, _ = built
    workbook = load_workbook(result["path"])
    assert workbook.calculation is not None
    assert workbook.calculation.fullCalcOnLoad is True


def test_formulas_are_present_and_not_hardcoded(built):
    result, _ = built
    workbook = load_workbook(result["path"])
    formulas = _formula_cells(workbook)
    assert len(formulas) > 100, f"only {len(formulas)} formulas found"
    sheets = {sheet for sheet, _, _ in formulas}
    for required in ("Dashboard", "Validation_Report", "Customers", "Orders"):
        assert required in sheets, f"{required} has no formula cells"


def test_no_formula_ships_a_cached_result(built):
    result, _ = built
    cached = load_workbook(result["path"], data_only=True)
    non_empty = [
        (sheet.title, cell.coordinate, cell.value)
        for sheet in cached.worksheets
        for row in sheet.iter_rows()
        for cell in row
        if cell.value is not None
    ]
    # Values written by the generator may exist, but formula results must not: with
    # data_only=True a formula cell is either None or a previously cached value.
    formula_ref = load_workbook(result["path"])
    formula_cells = {(sheet, coord) for sheet, coord, _ in _formula_cells(formula_ref)}
    cached_results = [
        (sheet, coord, value)
        for sheet, coord, value in non_empty
        if (sheet, coord) in formula_cells
    ]
    assert cached_results == [], f"stale cached formula results: {cached_results[:5]}"


@pytest.mark.skipif(shutil.which("soffice") is None and shutil.which("libreoffice") is None, reason="LibreOffice is not installed; recalculation is verified structurally only")
def test_libreoffice_recalculates_the_workbook(built):
    result, out = built
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    target = out / "recalc"
    target.mkdir(exist_ok=True)
    completed = subprocess.run(
        [binary, "--headless", "--calc", "--convert-to", "xlsx", "--outdir", str(target), result["path"]],
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert completed.returncode == 0, completed.stderr
    converted = next(target.glob("*.xlsx"))
    recalculated = load_workbook(converted, data_only=True)
    values = [
        cell.value
        for sheet in recalculated.worksheets
        for row in sheet.iter_rows()
        for cell in row
        if isinstance(cell.value, (int, float))
    ]
    assert values, "LibreOffice produced no numeric results"
    dashboard = recalculated["Dashboard"]
    numbers = [cell.value for row in dashboard.iter_rows() for cell in row if isinstance(cell.value, (int, float))]
    assert numbers, "Dashboard KPIs were not recalculated"
