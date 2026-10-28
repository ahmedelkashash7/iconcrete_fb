"""Automated tests for the portable ICONCRETE Excel generator.

Run with:
    python -m pytest excel_generator/tests -q
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import calc  # noqa: E402
import config as cfg_module  # noqa: E402
import generate_workbook as gen  # noqa: E402


@pytest.fixture(scope="module")
def generated(tmp_path_factory):
    out = tmp_path_factory.mktemp("iconcrete_output")
    cfg = cfg_module.GeneratorConfig(output_dir=str(out))
    result = gen.generate(cfg, out)
    return result, cfg, out


@pytest.fixture(scope="module")
def workbook(generated):
    result, _, _ = generated
    return load_workbook(result["path"])


# ---------------------------------------------------------------------------
# Workbook generation and structure
# ---------------------------------------------------------------------------
def test_output_file_created(generated):
    result, _, out = generated
    path = Path(result["path"])
    assert path.exists(), "the .xlsx file must exist"
    assert path.suffix == ".xlsx"
    assert path.parent == out
    assert path.stat().st_size > 20_000
    assert path.name.startswith("IConcrete_")


def test_workbook_opens_with_openpyxl(workbook):
    assert workbook.sheetnames
    assert str(workbook.properties.creator).startswith("ICONCRETE")


def test_expected_phase1_sheets_exist(workbook):
    assert workbook.sheetnames == list(gen.EXPECTED_SHEETS)
    for sheet in (
        "Login",
        "Dashboard",
        "README",
        "Validation_Report",
        "Data_Dictionary",
        "Settings",
        "Customers",
        "Suppliers",
        "Materials",
        "Mix_Designs",
        "Orders",
        "Employees",
        "Fleet",
        "Migration_to_Web_App",
        "Demo_Data",
    ):
        assert sheet in workbook.sheetnames


def test_required_headers_and_tables(workbook):
    tables = {
        "Customers": ("tblCustomers", "CustomerID"),
        "Suppliers": ("tblSuppliers", "SupplierID"),
        "Materials": ("tblMaterials", "MaterialID"),
        "Mix_Designs": ("tblMixDesigns", "MixID"),
        "Orders": ("tblOrders", "OrderID"),
        "Employees": ("tblEmployees", "EmployeeID"),
        "Fleet": ("tblFleet", "TruckID"),
    }
    for sheet_name, (table_name, header) in tables.items():
        sheet = workbook[sheet_name]
        assert table_name in sheet.tables, f"{table_name} missing"
        assert header in str(sheet["A1"].value), f"{header} header missing"
        assert sheet.tables[table_name].ref.startswith("A1")


def test_formulas_not_hardcoded_totals(workbook):
    assert str(workbook["Customers"]["I2"].value).startswith("=")
    assert str(workbook["Customers"]["J2"].value).startswith("=")
    assert str(workbook["Orders"]["K2"].value).startswith("=")
    assert str(workbook["Orders"]["N2"].value).startswith("=")
    assert str(workbook["Materials"]["K2"].value).startswith("=")
    assert str(workbook["Materials"]["M2"].value).startswith("=")
    assert str(workbook["Mix_Designs"]["R2"].value).startswith("=")
    assert str(workbook["Mix_Designs"]["V2"].value).startswith("=")
    assert str(workbook["Employees"]["I2"].value).startswith("=")
    assert str(workbook["Fleet"]["I2"].value).startswith("=")
    assert str(workbook["Dashboard"]["B8"].value).startswith("=")
    assert "SUM" in str(workbook["Dashboard"]["B8"].value) or "COUNTA" in str(workbook["Dashboard"]["B8"].value)


def test_named_ranges_exist(workbook):
    for name in (
        "Company_Name",
        "Plant_Name",
        "Currency_Code",
        "Report_From",
        "Report_To",
        "VAT_Rate",
        "Excel_Template_Version",
        "Allowed_Order_Status",
        "Allowed_Customer_Status",
        "Allowed_Material_Unit",
        "Allowed_Exposure_Class",
    ):
        assert name in workbook.defined_names, f"named range {name} missing"


def test_dropdown_validations_exist(workbook):
    for sheet_name in ("Customers", "Orders", "Mix_Designs", "Fleet", "Employees", "Materials", "Suppliers"):
        sheet = workbook[sheet_name]
        validations = sheet.data_validations.dataValidation
        assert len(validations) >= 1, f"no validations on {sheet_name}"
        assert any(validation.type == "list" for validation in validations), f"no dropdown on {sheet_name}"


def test_dashboard_charts_exist(workbook):
    dashboard = workbook["Dashboard"]
    assert len(dashboard._charts) >= 3, "expected bar, line and doughnut charts"


def test_rtl_applied_to_arabic_sheets(workbook):
    for sheet in workbook.worksheets:
        assert sheet.sheet_view.rightToLeft is True, f"{sheet.title} is not RTL"


def test_locked_brand_text_on_login(workbook):
    login = workbook["Login"]
    assert login["A1"].value == "ICONCRETE"
    assert login["A2"].value == "Concrete Management Solutions"


def test_manual_input_cells_unlocked_and_formulas_protected(workbook):
    customers = workbook["Customers"]
    assert customers.protection.sheet is True
    assert customers["I2"].protection.locked is True
    assert customers["A2"].protection.locked is False
    mix = workbook["Mix_Designs"]
    assert mix["R2"].protection.locked is True
    assert mix["E2"].protection.locked is False
    fleet = workbook["Fleet"]
    assert fleet["I2"].protection.locked is True
    assert fleet["F2"].protection.locked is False


def test_validation_report_live_checks(workbook):
    sheet = workbook["Validation_Report"]
    assert str(sheet["F7"].value).startswith("=")
    assert str(sheet["G7"].value).startswith("=IF(")
    ids = [sheet.cell(row=row, column=1).value for row in range(7, 20)]
    assert len([value for value in ids if value and str(value).startswith("VAL-")]) == len(gen.CHECKS)


def test_validation_report_flags_seeded_scenarios(workbook):
    sheet = workbook["Validation_Report"]
    seeded: dict[str, tuple] = {}
    for row in sheet.iter_rows(min_row=1, max_row=sheet.max_row):
        first = row[0].value
        if isinstance(first, str) and first.startswith("SEED-"):
            seeded[first] = row

    scenarios = gen.validate_demo_scenarios()
    assert len(scenarios) >= 10
    assert len(seeded) >= len(scenarios)
    for scenario in scenarios:
        assert scenario["detected"] is True, f"{scenario['id']} was not detected"
        row = seeded[scenario["id"]]
        assert row[4].value == "DETECTED"
        assert row[5].value == "YES"
        assert row[6].value == "DETECTED"


def test_demo_data_is_clean():
    cfg = cfg_module.GeneratorConfig()
    dataset = cfg_module.build_demo_data(cfg)
    assert gen.evaluate_demo_data_issues(dataset, cfg.report_to) == []


def test_demo_rows_are_marked():
    cfg = cfg_module.GeneratorConfig()
    dataset = cfg_module.build_demo_data(cfg)
    assert all(row["data_source"] == "DEMO" for row in dataset["customers"])
    assert all(row["data_source"] == "DEMO" for row in dataset["orders"])


def test_output_filename_is_unique(tmp_path):
    cfg = cfg_module.GeneratorConfig(output_dir=str(tmp_path))
    first = gen.generate(cfg, tmp_path)
    second = gen.generate(cfg, tmp_path)
    assert first["path"] != second["path"]
    assert Path(first["path"]).exists()
    assert Path(second["path"]).exists()


# ---------------------------------------------------------------------------
# Core calculation rules (mirroring master specification PART 4 / PART 5)
# ---------------------------------------------------------------------------
def test_reference_mix_yield_matches_specification():
    yield_m3 = calc.theoretical_yield(400, 650, 1150, 180, 2.0, 3.15, 2.65, 2.68)
    assert round(yield_m3, 4) == pytest.approx(1.0014, abs=0.00005)
    assert calc.yield_within_tolerance(yield_m3)


def test_heavy_gravel_fails_and_correction_factor():
    yield_m3 = calc.theoretical_yield(400, 650, 1250, 180, 2.0, 3.15, 2.65, 2.68)
    assert round(yield_m3, 4) == pytest.approx(1.0387, abs=0.00005)
    assert not calc.yield_within_tolerance(yield_m3)
    # The specification shows 0.9627 (truncated); 1/1.038685 = 0.962756,
    # which the generator rounds to four decimals (0.9628).
    assert calc.yield_correction_factor(yield_m3) == pytest.approx(0.9628, abs=0.0001)


def test_moisture_correction_and_water_conservation():
    assert calc.wet_weight(650, 6.5) == pytest.approx(692.25, abs=0.01)
    free_sand = calc.free_water_l(650, 6.5)
    free_gravel = calc.free_water_l(1150, 1.2)
    assert free_sand == pytest.approx(42.25, abs=0.01)
    assert free_gravel == pytest.approx(13.8, abs=0.01)
    corrected = calc.corrected_mixing_water(180, [(650, 6.5), (1150, 1.2)])
    assert corrected == pytest.approx(123.95, abs=0.01)
    variance = calc.water_conservation_variance(corrected, free_sand + free_gravel, 180)
    assert calc.water_conservation_ok(variance)


def test_wc_ratio_and_exposure_limits():
    assert calc.wc_ratio(180, 400) == pytest.approx(0.45, abs=0.001)
    assert calc.wc_within_limit(180, 400, "XC1")
    assert not calc.wc_within_limit(200, 320, "XC1")
    assert calc.wc_limit("XS3") == 0.40
    assert calc.wc_limit("XC4") == 0.45


def test_credit_limit_rule():
    assert calc.credit_allows(1000, 600, 300)
    assert not calc.credit_allows(1000, 600, 500)
    assert calc.credit_available(1000, 600) == 400


def test_weighted_average_cost():
    assert calc.weighted_average_cost(10, 100, 10, 200) == 150
    assert calc.weighted_average_cost(0, 0, 0, 0) == 0


def test_order_totals_and_vat():
    assert calc.order_vat(1000, 14) == 140
    assert calc.order_grand_total(1000, 14, 50) == 1190


def test_quality_rules():
    assert calc.slump_within_tolerance(140, 120)
    assert not calc.slump_within_tolerance(150, 120)
    assert calc.strength_7d_ok(21, 30)
    assert not calc.strength_7d_ok(19, 30)
    assert calc.strength_28d_ok(34, 30)
    assert calc.concrete_temperature_ok(32)
    assert not calc.concrete_temperature_ok(33)


def test_concrete_age_status():
    assert calc.concrete_age_status(60) == "OK"
    assert calc.concrete_age_status(95) == "WARNING"
    assert calc.concrete_age_status(115) == "CRITICAL"
    assert calc.concrete_age_status(121) == "REJECT"


def test_reclaimed_water_limit():
    assert calc.reclaimed_water_ok(30, 180)
    assert not calc.reclaimed_water_ok(40, 180)


def test_depreciation_and_loan_schedule():
    assert calc.depreciation_straight_line(100_000, 10_000, 5) == 18_000
    installment = calc.loan_annuity_installment(120_000, 0.12, 12)
    assert installment == pytest.approx(10_661.85, abs=0.5)


def test_licence_alert_rule():
    today = date(2026, 10, 28)
    assert calc.license_alert(calc.days_until(today + timedelta(days=30), today)) == "RENEW"
    assert calc.license_alert(calc.days_until(today + timedelta(days=31), today)) == "OK"
    assert calc.license_alert(calc.days_until(today - timedelta(days=1), today)) == "RENEW"
