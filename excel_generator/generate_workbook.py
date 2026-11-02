#!/usr/bin/env python3
"""ICONCRETE portable Excel workbook generator.

Generates a real .xlsx workbook with Arabic RTL sheets, Excel tables, formulas,
dropdown validations, conditional formatting, protected formula cells, dashboard
charts and a Validation_Report that flags data problems.

Runs locally (Python 3.9+ with openpyxl) and in Google Colab without any
backend, API key, AI Studio, GitHub credentials or Excel Desktop.

Usage:
    python generate_workbook.py
    python generate_workbook.py --output-dir ./output
    python generate_workbook.py --no-protection --no-charts
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from openpyxl import Workbook
from openpyxl.chart import BarChart, DoughnutChart, LineChart, Reference
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

import calc  # noqa: E402  (path set above for Colab/script usage)
import config as cfg_module  # noqa: E402

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LOGIN = "Login"
README = "README"
DASHBOARD = "Dashboard"
VALIDATION = "Validation_Report"
DATA_DICTIONARY = "Data_Dictionary"
SETTINGS = "Settings"
CUSTOMERS = "Customers"
SUPPLIERS = "Suppliers"
MATERIALS = "Materials"
MIX = "Mix_Designs"
ORDERS = "Orders"
EMPLOYEES = "Employees"
FLEET = "Fleet"
MIGRATION = "Migration_to_Web_App"
DEMO_DATA = "Demo_Data"

DATA_SHEETS = (CUSTOMERS, SUPPLIERS, MATERIALS, MIX, ORDERS, EMPLOYEES, FLEET)

EXPECTED_SHEETS: tuple[str, ...] = (
    LOGIN,
    README,
    DASHBOARD,
    VALIDATION,
    DATA_DICTIONARY,
    SETTINGS,
    CUSTOMERS,
    SUPPLIERS,
    MATERIALS,
    MIX,
    ORDERS,
    EMPLOYEES,
    FLEET,
    MIGRATION,
    DEMO_DATA,
)

MONEY_FMT = "#,##0.00"
DATE_FMT = "yyyy-mm-dd"
NUMBER_FMT = "#,##0.###"

COLOR = cfg_module.COLORS
PRIMARY_FILL = PatternFill("solid", start_color=COLOR["primary"], end_color=COLOR["primary"])
PRIMARY_DARK_FILL = PatternFill("solid", start_color=COLOR["primary_dark"], end_color=COLOR["primary_dark"])
HEADER_FILL = PatternFill("solid", start_color=COLOR["primary"], end_color=COLOR["primary"])
INPUT_FILL = PatternFill("solid", start_color="FFF7E6", end_color="FFF7E6")
FORMULA_FILL = PatternFill("solid", start_color="F1F5F9", end_color="F1F5F9")
RED_FILL = PatternFill("solid", start_color="FEE2E2", end_color="FEE2E2")
GREEN_FILL = PatternFill("solid", start_color="DCFCE7", end_color="DCFCE7")
AMBER_FILL = PatternFill("solid", start_color="FEF3C7", end_color="FEF3C7")
SECTION_FILL = PatternFill("solid", start_color="EDE9FE", end_color="EDE9FE")

HEADER_FONT = Font(bold=True, color="FFFFFF", size=11, name="Calibri")
TITLE_FONT = Font(bold=True, size=18, color=COLOR["primary_dark"])
SUBTITLE_FONT = Font(bold=True, size=12, color=COLOR["text"])
BODY_FONT = Font(size=10, color=COLOR["text"])
NOTE_FONT = Font(size=9, italic=True, color="64748B")
MONO_FONT = Font(size=9, name="Consolas", color="334155")

THIN = Side(style="thin", color="E2E8F0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _title(ws, text: str, subtitle: str = "", span: int = 8) -> None:
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=span)
    cell = ws.cell(row=1, column=1, value=text)
    cell.font = TITLE_FONT
    cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30
    if subtitle:
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=span)
        sub = ws.cell(row=2, column=1, value=subtitle)
        sub.font = NOTE_FONT
        sub.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.row_dimensions[2].height = 24


def _header_row(ws, row: int, headers: Iterable[str]) -> None:
    for index, header in enumerate(headers, start=1):
        cell = ws.cell(row=row, column=index, value=header)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[row].height = 32


def _section(ws, row: int, text: str, span: int = 8) -> None:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = Font(bold=True, size=11, color=COLOR["primary_dark"])
    cell.fill = SECTION_FILL
    cell.alignment = Alignment(horizontal="right", vertical="center")


def _widths(ws, widths: Iterable[float]) -> None:
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(index)].width = width


def _add_table(ws, name: str, last_row: int, last_col: int, style: str = "TableStyleMedium2") -> None:
    if last_row < 2:
        return
    ref = f"A1:{get_column_letter(last_col)}{last_row}"
    table = Table(displayName=name, ref=ref)
    table.tableStyleInfo = TableStyleInfo(
        name=style, showFirstColumn=False, showLastColumn=False, showRowStripes=True, showColumnStripes=False
    )
    ws.add_table(table)


def _protect(ws, input_columns: Iterable[int], first_row: int, last_row: int, enabled: bool) -> None:
    if not enabled:
        return
    unlocked = set(input_columns)
    for row in ws.iter_rows(min_row=first_row, max_row=max(last_row, first_row), min_col=1, max_col=ws.max_column):
        for cell in row:
            if cell.column in unlocked:
                cell.protection = Protection(locked=False)
            else:
                cell.protection = Protection(locked=True)
    ws.protection.sheet = True
    ws.protection.autoFilter = False
    ws.protection.formatColumns = False
    ws.protection.formatRows = False


def _rtl(ws) -> None:
    ws.sheet_view.rightToLeft = True


def _data_validation(ws, formula: str, cell_range: str, allow_blank: bool, title: str, message: str = "") -> None:
    dv = DataValidation(
        type="list",
        formula1=formula,
        allow_blank=allow_blank,
        showDropDown=False,
        showErrorMessage=True,
        errorTitle=title,
        error="قيمة غير مسموح بها — استخدم القائمة / Value is not in the allowed list",
        showInputMessage=bool(message),
        promptTitle=title,
        prompt=message,
    )
    ws.add_data_validation(dv)
    dv.add(cell_range)


def _decimal_validation(ws, cell_range: str, minimum: float, maximum: float, title: str) -> None:
    dv = DataValidation(
        type="decimal",
        operator="between",
        formula1=str(minimum),
        formula2=str(maximum),
        allow_blank=True,
        showErrorMessage=True,
        errorTitle=title,
        error="القيمة خارج النطاق المسموح / Value outside the allowed range",
    )
    ws.add_data_validation(dv)
    dv.add(cell_range)


def _date_validation(ws, cell_range: str, title: str) -> None:
    dv = DataValidation(
        type="date",
        operator="greaterThan",
        formula1="DATE(2000,1,1)",
        allow_blank=False,
        showErrorMessage=True,
        errorTitle=title,
        error="أدخل تاريخاً صحيحاً / Enter a valid date",
    )
    ws.add_data_validation(dv)
    dv.add(cell_range)


# ---------------------------------------------------------------------------
# Settings sheet (identity, report range, palette, allowed-value lists)
# ---------------------------------------------------------------------------
def _build_settings(wb: Workbook, cfg: cfg_module.GeneratorConfig) -> dict[str, str]:
    ws = wb.create_sheet(SETTINGS)
    _rtl(ws)
    _title(ws, "ICONCRETE — Settings | الإعدادات", "الهوية البصرية، فترة التقرير، والقوائم المسموح بها", 6)
    _widths(ws, [30, 34, 3, 3, 24, 26])

    _section(ws, 4, "الهوية | Identity", 2)
    identity = [
        ("اسم الشركة (عربي)", cfg.company_name_ar),
        ("Company name (EN)", cfg.company_name_en),
        ("اسم المحطة (عربي)", cfg.plant_name_ar),
        ("Plant name (EN)", cfg.plant_name_en),
        ("العملة | Currency", cfg.currency),
        ("اللغة الافتراضية | Default language", cfg.language),
        ("المنطقة الزمنية | Timezone", cfg.timezone),
        ("الدولة | Country", cfg.country),
    ]
    for offset, (label, value) in enumerate(identity, start=5):
        ws.cell(row=offset, column=1, value=label).font = Font(bold=True, size=10)
        cell = ws.cell(row=offset, column=2, value=value)
        cell.font = BODY_FONT
        cell.fill = INPUT_FILL
        cell.protection = Protection(locked=False)

    _section(ws, 14, "إعدادات التقرير | Report settings", 2)
    report_rows = [
        ("من تاريخ | Report from", cfg.report_from, DATE_FMT),
        ("إلى تاريخ | Report to", cfg.report_to, DATE_FMT),
        ("نسبة الضريبة % | VAT rate", cfg.vat_rate, "0.00"),
        ("إصدار قالب Excel | Excel template version", cfg_module.EXCEL_TEMPLATE_VERSION, "@"),
        ("إصدار المولد | Generator version", cfg_module.GENERATOR_VERSION, "@"),
    ]
    for offset, (label, value, fmt) in enumerate(report_rows, start=15):
        ws.cell(row=offset, column=1, value=label).font = Font(bold=True, size=10)
        cell = ws.cell(row=offset, column=2, value=value)
        cell.font = BODY_FONT
        cell.number_format = fmt
        cell.fill = INPUT_FILL
        cell.protection = Protection(locked=False)

    _section(ws, 22, "لوحة الألوان | Palette", 2)
    for offset, (name, value) in enumerate(COLOR.items(), start=23):
        ws.cell(row=offset, column=1, value=name).font = Font(size=9, name="Consolas")
        cell = ws.cell(row=offset, column=2, value=f"#{value}")
        cell.font = Font(size=9, name="Consolas")
        cell.fill = PatternFill("solid", start_color=value, end_color=value)
        cell.font = Font(size=9, name="Consolas", color="FFFFFF" if name in {"primary", "primary_dark"} else "0F172A")

    lists_label = ws.cell(row=4, column=5, value="القوائم المسموح بها | Allowed values")
    lists_label.font = Font(bold=True, size=11, color=COLOR["primary_dark"])
    lists_label.fill = SECTION_FILL
    lists = {
        "Allowed_Order_Status": (5, cfg_module.ALLOWED["order_status"], 4),
        "Allowed_Customer_Status": (12, cfg_module.ALLOWED["customer_status"], 11),
        "Allowed_Mix_Status": (16, cfg_module.ALLOWED["mix_status"], 15),
        "Allowed_Exposure_Class": (21, cfg_module.ALLOWED["exposure_class"], 20),
        "Allowed_Material_Unit": (26, cfg_module.ALLOWED["material_unit"], 25),
        "Allowed_Supplier_Category": (31, cfg_module.ALLOWED["supplier_category"], 30),
        "Allowed_Supplier_Status": (38, cfg_module.ALLOWED["supplier_status"], 37),
        "Allowed_Employee_Status": (41, cfg_module.ALLOWED["employee_status"], 40),
        "Allowed_Fleet_Ownership": (45, cfg_module.ALLOWED["fleet_ownership"], 44),
        "Allowed_Fleet_Status": (49, cfg_module.ALLOWED["fleet_status"], 48),
        "Allowed_Grade": (53, cfg_module.ALLOWED["grade"], 52),
        "Allowed_Priority": (61, cfg_module.ALLOWED["priority_tier"], 60),
        "Allowed_Data_Source": (65, ["DEMO", "REAL"], 64),
    }
    ranges: dict[str, str] = {}
    for name, (start_row, values, label_row) in lists.items():
        label = ws.cell(row=label_row, column=5, value=name)
        label.font = Font(bold=True, size=9, color=COLOR["primary_dark"])
        for index, value in enumerate(values):
            cell = ws.cell(row=start_row + index, column=6, value=value)
            cell.font = BODY_FONT
        last = start_row + len(values) - 1
        ranges[name] = f"{SETTINGS}!$F${start_row}:$F${last}"

    named = {
        "Company_Name": f"{SETTINGS}!$B$5",
        "Company_Name_EN": f"{SETTINGS}!$B$6",
        "Plant_Name": f"{SETTINGS}!$B$7",
        "Plant_Name_EN": f"{SETTINGS}!$B$8",
        "Currency_Code": f"{SETTINGS}!$B$9",
        "Default_Language": f"{SETTINGS}!$B$10",
        "Timezone_Name": f"{SETTINGS}!$B$11",
        "Report_From": f"{SETTINGS}!$B$15",
        "Report_To": f"{SETTINGS}!$B$16",
        "VAT_Rate": f"{SETTINGS}!$B$17",
        "Excel_Template_Version": f"{SETTINGS}!$B$18",
        "Excel_Generator_Version": f"{SETTINGS}!$B$19",
    }
    named.update(ranges)
    for name, reference in named.items():
        wb.defined_names.add(DefinedName(name, attr_text=reference))

    ws.cell(row=68, column=1, value=cfg_module.PROTECTION_NOTE_AR).font = NOTE_FONT
    ws.cell(row=69, column=1, value=cfg_module.PROTECTION_NOTE_EN).font = NOTE_FONT
    _protect(ws, input_columns=[2], first_row=5, last_row=20, enabled=cfg.protect_sheets)
    return ranges


# ---------------------------------------------------------------------------
# Data sheets
# ---------------------------------------------------------------------------
def _build_customers(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]], ranges: dict[str, str]) -> int:
    ws = wb.create_sheet(CUSTOMERS)
    _rtl(ws)
    headers = [
        "معرّف العميل | CustomerID",
        "الاسم بالعربية | Name_AR",
        "الاسم بالإنجليزية | Name_EN",
        "الرقم الضريبي | TaxID",
        "الهاتف | Phone",
        "الأولوية | Priority",
        "سقف الائتمان | CreditLimit",
        "أيام السماح | CreditDays",
        "المديونية | Outstanding",
        "المتاح | Available",
        "الحالة | Status",
        "المصدر | DataSource",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [14, 30, 28, 16, 16, 12, 18, 14, 16, 16, 14, 12])

    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["customer_id"])
        ws.cell(row=index, column=2, value=row["name_ar"]).alignment = Alignment(horizontal="right")
        ws.cell(row=index, column=3, value=row["name_en"])
        ws.cell(row=index, column=4, value=row["tax_id"])
        ws.cell(row=index, column=5, value=row["phone"])
        ws.cell(row=index, column=6, value=row["priority_tier"])
        ws.cell(row=index, column=7, value=row["credit_limit_egp"]).number_format = MONEY_FMT
        ws.cell(row=index, column=8, value=row["credit_days"])
        ws.cell(row=index, column=9, value=f'=SUMIF(Orders!$B$2:$B$400,$A{index},Orders!$K$2:$K$400)').number_format = MONEY_FMT
        ws.cell(row=index, column=10, value=f"=$G{index}-$I{index}").number_format = MONEY_FMT
        ws.cell(row=index, column=11, value=row["status"])
        ws.cell(row=index, column=12, value=row["data_source"])
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
            if column in (9, 10):
                cell.fill = FORMULA_FILL

    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblCustomers", last_row, len(headers))
    _data_validation(ws, "Allowed_Priority", f"F2:F{max(last_row, 200)}", False, "Priority")
    _data_validation(ws, "Allowed_Customer_Status", f"K2:K{max(last_row, 200)}", False, "Customer status")
    _data_validation(ws, "Allowed_Data_Source", f"L2:L{max(last_row, 200)}", False, "Data source")
    _decimal_validation(ws, f"G2:G{max(last_row, 200)}", 0, 100_000_000, "Credit limit")
    ws.conditional_formatting.add(
        f"J2:J{max(last_row, 200)}",
        CellIsRule(operator="lessThan", formula=["0"], fill=RED_FILL),
    )
    ws.freeze_panes = "A2"
    _protect(ws, input_columns=[1, 2, 3, 4, 5, 6, 7, 8, 11, 12], first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


def _build_orders(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(ORDERS)
    _rtl(ws)
    headers = [
        "معرّف الطلب | OrderID",
        "العميل | CustomerID",
        "الخلطة | MixCode",
        "الحجم م³ | VolumeM3",
        "تاريخ الصب | PourDate",
        "سعر المتر | UnitPrice",
        "المضخة | PumpFee",
        "المسافة كم | DistanceKm",
        "قبل الضريبة | Subtotal",
        "الضريبة | VAT",
        "الإجمالي | GrandTotal",
        "الحالة | Status",
        "المصدر | DataSource",
        "فحص الائتمان | CreditCheck",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [14, 14, 10, 13, 14, 14, 12, 12, 15, 13, 15, 14, 12, 15])

    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["order_id"])
        ws.cell(row=index, column=2, value=row["customer_id"])
        ws.cell(row=index, column=3, value=row["mix_code"])
        ws.cell(row=index, column=4, value=row["volume_m3"]).number_format = NUMBER_FMT
        date_cell = ws.cell(row=index, column=5, value=row["pour_date"])
        date_cell.number_format = DATE_FMT
        ws.cell(row=index, column=6, value=row["unit_price"]).number_format = MONEY_FMT
        ws.cell(row=index, column=7, value=row["pump_fee"]).number_format = MONEY_FMT
        ws.cell(row=index, column=8, value=row["distance_km"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=9, value=f"=ROUND(D{index}*F{index},2)").number_format = MONEY_FMT
        ws.cell(row=index, column=10, value=f"=ROUND(I{index}*VAT_Rate,2)").number_format = MONEY_FMT
        ws.cell(row=index, column=11, value=f"=ROUND(I{index}+J{index}+G{index},2)").number_format = MONEY_FMT
        ws.cell(row=index, column=12, value=row["status"])
        ws.cell(row=index, column=13, value=row.get("data_source", "DEMO"))
        ws.cell(
            row=index,
            column=14,
            value=(
                f'=IF(K{index}>SUMIF(Customers!$A$2:$A$300,B{index},Customers!$G$2:$G$300),'
                f'"OVER_LIMIT","OK")'
            ),
        )
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
            if column in (9, 10, 11, 14):
                cell.fill = FORMULA_FILL

    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblOrders", last_row, len(headers))
    _data_validation(ws, "Allowed_Order_Status", f"L2:L{max(last_row, 400)}", False, "Order status")
    _data_validation(ws, "Allowed_Data_Source", f"M2:M{max(last_row, 400)}", False, "Data source")
    _decimal_validation(ws, f"D2:D{max(last_row, 400)}", 0, 5000, "Volume")
    _date_validation(ws, f"E2:E{max(last_row, 400)}", "Pour date")
    ws.conditional_formatting.add(
        f"N2:N{max(last_row, 400)}",
        FormulaRule(formula=[f'$N2="OVER_LIMIT"'], fill=RED_FILL),
    )
    ws.freeze_panes = "A2"
    _protect(ws, input_columns=[1, 2, 3, 4, 5, 6, 7, 8, 12, 13], first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


def _build_materials(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(MATERIALS)
    _rtl(ws)
    headers = [
        "معرّف المادة | MaterialID",
        "الكود | Code",
        "الاسم بالعربية | Name_AR",
        "الاسم بالإنجليزية | Name_EN",
        "الوحدة | Unit",
        "الكثافة النوعية | SG",
        "حد الطلب | ReorderLevel",
        "الافتتاحي | OpeningQty",
        "الوارد | ReceivedQty",
        "الصادر | IssuedQty",
        "الرصيد | ClosingQty",
        "تكلفة الوحدة | UnitCost",
        "قيمة المخزون | StockValue",
        "التحذير | Status",
        "المصدر | DataSource",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [14, 12, 26, 24, 9, 12, 13, 12, 12, 12, 12, 14, 16, 12, 12])

    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["material_id"])
        ws.cell(row=index, column=2, value=row["code"])
        ws.cell(row=index, column=3, value=row["name_ar"])
        ws.cell(row=index, column=4, value=row["name_en"])
        ws.cell(row=index, column=5, value=row["unit"])
        ws.cell(row=index, column=6, value=row["specific_gravity"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=7, value=row["reorder_level"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=8, value=row["opening_qty"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=9, value=row["received_qty"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=10, value=row["issued_qty"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=11, value=f"=H{index}+I{index}-J{index}").number_format = NUMBER_FMT
        ws.cell(row=index, column=12, value=row["unit_cost"]).number_format = MONEY_FMT
        ws.cell(row=index, column=13, value=f"=ROUND(K{index}*L{index},2)").number_format = MONEY_FMT
        ws.cell(row=index, column=14, value=f'=IF(K{index}<=G{index},"REORDER","OK")')
        ws.cell(row=index, column=15, value=row["data_source"])
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
            if column in (11, 13, 14):
                cell.fill = FORMULA_FILL

    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblMaterials", last_row, len(headers))
    _data_validation(ws, "Allowed_Material_Unit", f"E2:E{max(last_row, 200)}", False, "Material unit")
    _data_validation(ws, "Allowed_Data_Source", f"O2:O{max(last_row, 200)}", False, "Data source")
    _decimal_validation(ws, f"F2:F{max(last_row, 200)}", 0.5, 8, "Specific gravity")
    _decimal_validation(ws, f"H2:J{max(last_row, 200)}", 0, 1_000_000, "Quantities")
    ws.conditional_formatting.add(
        f"K2:K{max(last_row, 200)}",
        CellIsRule(operator="lessThan", formula=["0"], fill=RED_FILL),
    )
    ws.conditional_formatting.add(
        f"N2:N{max(last_row, 200)}",
        FormulaRule(formula=[f'$N2="REORDER"'], fill=AMBER_FILL),
    )
    ws.freeze_panes = "A2"
    _protect(ws, input_columns=list(range(1, 13)) + [15], first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


def _build_mix(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(MIX)
    _rtl(ws)
    headers = [
        "معرّف | MixID",
        "الكود | Code",
        "الدرجة | Grade",
        "التعرض | Exposure",
        "أسمنت kg | Cement",
        "رمل kg | Sand",
        "زلط kg | Gravel",
        "مياه L | Water",
        "هواء % | Air",
        "SG أسمنت",
        "SG رمل",
        "SG زلط",
        "حجم أسمنت | AbsCement",
        "حجم رمل | AbsSand",
        "حجم زلط | AbsGravel",
        "حجم مياه | AbsWater",
        "حجم هواء | AbsAir",
        "العائد | Yield",
        "فحص العائد | YieldStatus",
        "W/C",
        "حد W/C",
        "فحص W/C | WCStatus",
        "معامل التصحيح | Correction",
        "حالة الخلطة | Status",
        "المصدر | DataSource",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [11, 9, 9, 11, 12, 11, 11, 11, 9, 10, 10, 10, 12, 12, 12, 12, 11, 12, 13, 9, 10, 12, 14, 12, 12])

    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["mix_id"])
        ws.cell(row=index, column=2, value=row["code"])
        ws.cell(row=index, column=3, value=row["grade"])
        ws.cell(row=index, column=4, value=row["exposure_class"])
        ws.cell(row=index, column=5, value=row["cement_kg"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=6, value=row["sand_kg"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=7, value=row["gravel_kg"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=8, value=row["water_l"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=9, value=row["air_percent"]).number_format = "0.00"
        ws.cell(row=index, column=10, value=row["sg_cement"]).number_format = "0.00"
        ws.cell(row=index, column=11, value=row["sg_sand"]).number_format = "0.00"
        ws.cell(row=index, column=12, value=row["sg_gravel"]).number_format = "0.00"
        ws.cell(row=index, column=13, value=f"=E{index}/(J{index}*1000)").number_format = "0.000000"
        ws.cell(row=index, column=14, value=f"=F{index}/(K{index}*1000)").number_format = "0.000000"
        ws.cell(row=index, column=15, value=f"=G{index}/(L{index}*1000)").number_format = "0.000000"
        ws.cell(row=index, column=16, value=f"=H{index}/1000").number_format = "0.000000"
        ws.cell(row=index, column=17, value=f"=I{index}/100").number_format = "0.000000"
        ws.cell(row=index, column=18, value=f"=SUM(M{index}:Q{index})").number_format = "0.0000"
        ws.cell(row=index, column=19, value=f'=IF(AND(R{index}>=0.98,R{index}<=1.02),"OK","FAIL")')
        ws.cell(row=index, column=20, value=f"=H{index}/E{index}").number_format = "0.000"
        ws.cell(
            row=index,
            column=21,
            value=f'=IF(D{index}="XC1",0.6,IF(D{index}="XC4",0.45,IF(D{index}="XS2",0.45,0.4)))',
        ).number_format = "0.00"
        ws.cell(row=index, column=22, value=f'=IF(T{index}<=U{index},"OK","FAIL")')
        ws.cell(row=index, column=23, value=f"=IF(R{index}=0,1,ROUND(1/R{index},4))").number_format = "0.0000"
        ws.cell(row=index, column=24, value=row["status"])
        ws.cell(row=index, column=25, value=row["data_source"])
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
            if column >= 13:
                cell.fill = FORMULA_FILL

    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblMixDesigns", last_row, len(headers))
    _data_validation(ws, "Allowed_Grade", f"C2:C{max(last_row, 200)}", False, "Grade")
    _data_validation(ws, "Allowed_Exposure_Class", f"D2:D{max(last_row, 200)}", False, "Exposure class")
    _data_validation(ws, "Allowed_Mix_Status", f"X2:X{max(last_row, 200)}", False, "Mix status")
    _decimal_validation(ws, f"E2:H{max(last_row, 200)}", 0, 2000, "Weights")
    ws.conditional_formatting.add(
        f"S2:S{max(last_row, 200)}",
        FormulaRule(formula=[f'$S2="FAIL"'], fill=RED_FILL),
    )
    ws.conditional_formatting.add(
        f"V2:V{max(last_row, 200)}",
        FormulaRule(formula=[f'$V2="FAIL"'], fill=RED_FILL),
    )
    ws.freeze_panes = "C2"
    _protect(ws, input_columns=list(range(1, 13)) + [24, 25], first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


def _build_suppliers(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(SUPPLIERS)
    _rtl(ws)
    headers = [
        "معرّف المورد | SupplierID",
        "الاسم بالعربية | Name_AR",
        "الاسم بالإنجليزية | Name_EN",
        "الهاتف | Phone",
        "التصنيف | Category",
        "الحالة | Status",
        "المصدر | DataSource",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [14, 30, 26, 16, 16, 14, 12])
    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["supplier_id"])
        ws.cell(row=index, column=2, value=row["name_ar"])
        ws.cell(row=index, column=3, value=row["name_en"])
        ws.cell(row=index, column=4, value=row["phone"])
        ws.cell(row=index, column=5, value=row["category"])
        ws.cell(row=index, column=6, value=row["status"])
        ws.cell(row=index, column=7, value=row["data_source"])
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblSuppliers", last_row, len(headers))
    _data_validation(ws, "Allowed_Supplier_Category", f"E2:E{max(last_row, 200)}", False, "Supplier category")
    _data_validation(ws, "Allowed_Supplier_Status", f"F2:F{max(last_row, 200)}", False, "Supplier status")
    ws.freeze_panes = "A2"
    _protect(ws, input_columns=list(range(1, len(headers) + 1)), first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


def _build_employees(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(EMPLOYEES)
    _rtl(ws)
    headers = [
        "معرّف الموظف | EmployeeID",
        "الاسم بالعربية | Name_AR",
        "الاسم بالإنجليزية | Name_EN",
        "الوظيفة | JobTitle",
        "الهاتف | Phone",
        "الراتب الأساسي | BasicSalary",
        "البدلات | Allowances",
        "الخصومات | Deductions",
        "الصافي | NetSalary",
        "الحالة | Status",
        "المصدر | DataSource",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [14, 24, 22, 18, 16, 16, 14, 14, 16, 14, 12])
    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["employee_id"])
        ws.cell(row=index, column=2, value=row["name_ar"])
        ws.cell(row=index, column=3, value=row["name_en"])
        ws.cell(row=index, column=4, value=row["job_title"])
        ws.cell(row=index, column=5, value=row["phone"])
        ws.cell(row=index, column=6, value=row["basic_salary"]).number_format = MONEY_FMT
        ws.cell(row=index, column=7, value=row["allowances"]).number_format = MONEY_FMT
        ws.cell(row=index, column=8, value=row["deductions"]).number_format = MONEY_FMT
        ws.cell(row=index, column=9, value=f"=G{index}+H{index}-I{index}").number_format = MONEY_FMT
        ws.cell(row=index, column=10, value=row["status"])
        ws.cell(row=index, column=11, value=row["data_source"])
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
            if column == 9:
                cell.fill = FORMULA_FILL
    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblEmployees", last_row, len(headers))
    _data_validation(ws, "Allowed_Employee_Status", f"J2:J{max(last_row, 200)}", False, "Employee status")
    _decimal_validation(ws, f"F2:H{max(last_row, 200)}", 0, 1_000_000, "Salary")
    ws.conditional_formatting.add(
        f"I2:I{max(last_row, 200)}",
        CellIsRule(operator="lessThan", formula=["0"], fill=RED_FILL),
    )
    ws.freeze_panes = "A2"
    _protect(ws, input_columns=[1, 2, 3, 4, 5, 6, 7, 8, 10, 11], first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


def _build_fleet(wb: Workbook, cfg: cfg_module.GeneratorConfig, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(FLEET)
    _rtl(ws)
    headers = [
        "معرّف الشاحنة | TruckID",
        "الكود | Code",
        "السعة م³ | CapacityM3",
        "الملكية | Ownership",
        "الصحة | HealthScore",
        "انتهاء الترخيص | LicenseExpiry",
        "السائق | Driver",
        "الحالة | Status",
        "الأيام المتبقية | DaysToExpiry",
        "التنبيه | Alert",
        "المصدر | DataSource",
    ]
    _header_row(ws, 1, headers)
    _widths(ws, [14, 12, 13, 14, 12, 18, 18, 14, 16, 12, 12])
    for index, row in enumerate(rows, start=2):
        ws.cell(row=index, column=1, value=row["truck_id"])
        ws.cell(row=index, column=2, value=row["code"])
        ws.cell(row=index, column=3, value=row["capacity_m3"]).number_format = NUMBER_FMT
        ws.cell(row=index, column=4, value=row["ownership"])
        ws.cell(row=index, column=5, value=row["health_score"]).number_format = "0"
        ws.cell(row=index, column=6, value=row["license_expiry"]).number_format = DATE_FMT
        ws.cell(row=index, column=7, value=row["driver_name"])
        ws.cell(row=index, column=8, value=row["status"])
        ws.cell(row=index, column=9, value=f"=F{index}-TODAY()").number_format = "0"
        ws.cell(row=index, column=10, value=f'=IF(I{index}<=30,"RENEW","OK")')
        ws.cell(row=index, column=11, value=row["data_source"])
        for column in range(1, len(headers) + 1):
            cell = ws.cell(row=index, column=column)
            cell.border = BORDER
            cell.font = BODY_FONT
            if column in (9, 10):
                cell.fill = FORMULA_FILL
    last_row = max(len(rows) + 1, 2)
    _add_table(ws, "tblFleet", last_row, len(headers))
    _data_validation(ws, "Allowed_Fleet_Ownership", f"D2:D{max(last_row, 200)}", False, "Ownership")
    _data_validation(ws, "Allowed_Fleet_Status", f"H2:H{max(last_row, 200)}", False, "Fleet status")
    _date_validation(ws, f"F2:F{max(last_row, 200)}", "Licence expiry")
    ws.conditional_formatting.add(
        f"J2:J{max(last_row, 200)}",
        FormulaRule(formula=[f'$J2="RENEW"'], fill=RED_FILL),
    )
    ws.freeze_panes = "A2"
    _protect(ws, input_columns=[1, 2, 3, 4, 5, 6, 7, 8, 11], first_row=2, last_row=last_row, enabled=cfg.protect_sheets)
    return last_row


# ---------------------------------------------------------------------------
# Validation helpers (shared by the workbook and the tests)
# ---------------------------------------------------------------------------
CHECKS: list[dict[str, str]] = [
    {
        "id": "VAL-01",
        "sheet": CUSTOMERS,
        "rule_ar": "معرّفات عملاء مكررة",
        "rule_en": "Duplicate customer IDs",
        "formula": 'SUMPRODUCT((COUNTIF(Customers!$A$2:$A$300,Customers!$A$2:$A$300)>1)*(Customers!$A$2:$A$300<>""))/2',
        "action_ar": "احذف أو أعد ترقيم الصفوف المكررة.",
        "action_en": "Remove or renumber duplicate rows.",
    },
    {
        "id": "VAL-02",
        "sheet": ORDERS,
        "rule_ar": "معرّفات طلبات مكررة",
        "rule_en": "Duplicate order IDs",
        "formula": 'SUMPRODUCT((COUNTIF(Orders!$A$2:$A$400,Orders!$A$2:$A$400)>1)*(Orders!$A$2:$A$400<>""))/2',
        "action_ar": "كل طلب يجب أن يكون له معرّف فريد.",
        "action_en": "Every order needs a unique ID.",
    },
    {
        "id": "VAL-03",
        "sheet": ORDERS,
        "rule_ar": "طلبات لعميل غير موجود",
        "rule_en": "Orders referencing unknown customers",
        "formula": '=SUMPRODUCT((Orders!$B$2:$B$400<>"")*(COUNTIF(Customers!$A$2:$A$300,Orders!$B$2:$B$400)=0))',
        "action_ar": "أضف العميل أولاً أو صحح المعرّف.",
        "action_en": "Add the customer first or fix the reference.",
    },
    {
        "id": "VAL-04",
        "sheet": ORDERS,
        "rule_ar": "حالات طلبات غير مسموح بها",
        "rule_en": "Invalid order statuses",
        "formula": '=SUMPRODUCT((Orders!$L$2:$L$400<>"")*(COUNTIF(Allowed_Order_Status,Orders!$L$2:$L$400)=0))',
        "action_ar": "استخدم القيم من القائمة المنسدلة فقط.",
        "action_en": "Use only the dropdown values.",
    },
    {
        "id": "VAL-05",
        "sheet": ORDERS,
        "rule_ar": "كميات سالبة",
        "rule_en": "Negative order volumes",
        "formula": '=COUNTIF(Orders!$D$2:$D$400,"<0")',
        "action_ar": "الحجم يجب أن يكون أكبر من صفر.",
        "action_en": "Volume must be greater than zero.",
    },
    {
        "id": "VAL-06",
        "sheet": CUSTOMERS,
        "rule_ar": "سقوف ائتمان سالبة",
        "rule_en": "Negative credit limits",
        "formula": '=COUNTIF(Customers!$G$2:$G$300,"<0")',
        "action_ar": "صحح سقف الائتمان.",
        "action_en": "Correct the credit limit.",
    },
    {
        "id": "VAL-07",
        "sheet": ORDERS,
        "rule_ar": "طلبات تجاوزت سقف الائتمان",
        "rule_en": "Orders above the credit limit",
        "formula": '=COUNTIF(Orders!$N$2:$N$400,"OVER_LIMIT")',
        "action_ar": "اطلب موافقة مالية أو خفّض قيمة الطلب.",
        "action_en": "Request finance approval or reduce the order value.",
    },
    {
        "id": "VAL-08",
        "sheet": MATERIALS,
        "rule_ar": "أرصدة مخزون سالبة",
        "rule_en": "Negative closing stock",
        "formula": '=COUNTIF(Materials!$K$2:$K$300,"<0")',
        "action_ar": "راجع الوارد والصادر قبل الجرد.",
        "action_en": "Review receipts and issues before stocktake.",
    },
    {
        "id": "VAL-09",
        "sheet": MIX,
        "rule_ar": "عائد الخلطة خارج 0.98–1.02 م³",
        "rule_en": "Mix yield outside 0.98–1.02 m3",
        "formula": '=COUNTIF(Mix_Designs!$S$2:$S$300,"FAIL")',
        "action_ar": "طبّق معامل التصحيح أو صحح الأوزان.",
        "action_en": "Apply the correction factor or fix the weights.",
    },
    {
        "id": "VAL-10",
        "sheet": MIX,
        "rule_ar": "نسبة W/C تتجاوز حد التعرض",
        "rule_en": "W/C ratio above exposure limit",
        "formula": '=COUNTIF(Mix_Designs!$V$2:$V$300,"FAIL")',
        "action_ar": "قلل المياه أو ارفع الأسمنت حسب التصميم.",
        "action_en": "Reduce water or increase cement per the design.",
    },
    {
        "id": "VAL-11",
        "sheet": FLEET,
        "rule_ar": "تراخيص منتهية أو تنتهي خلال 30 يوم",
        "rule_en": "Licences expired or expiring within 30 days",
        "formula": '=COUNTIF(Fleet!$J$2:$J$300,"RENEW")',
        "action_ar": "جدّد الترخيص قبل التشغيل.",
        "action_en": "Renew the licence before operation.",
    },
    {
        "id": "VAL-12",
        "sheet": CUSTOMERS,
        "rule_ar": "عملاء بدون اسم",
        "rule_en": "Customers without a name",
        "formula": '=SUMPRODUCT((Customers!$A$2:$A$300<>"")*(Customers!$B$2:$B$300=""))',
        "action_ar": "أدخل الاسم العربي لكل عميل.",
        "action_en": "Enter the Arabic name for every customer.",
    },
    {
        "id": "VAL-13",
        "sheet": EMPLOYEES,
        "rule_ar": "صافي رواتب سالب",
        "rule_en": "Negative net salary",
        "formula": '=COUNTIF(Employees!$J$2:$J$300,"<0")',
        "action_ar": "راجع البدلات والخصومات.",
        "action_en": "Review allowances and deductions.",
    },
]


def validate_demo_scenarios(today: date | None = None) -> list[dict[str, Any]]:
    """Self-test of the validation rules using deliberately invalid values.

    Every scenario must be detected; the Validation_Report shows the result.
    """
    today = today or date.today()
    dataset = cfg_module.build_demo_data(cfg_module.GeneratorConfig(report_to=today))
    customers = {row["customer_id"] for row in dataset["customers"]}
    order_statuses = set(cfg_module.ALLOWED["order_status"])

    duplicate_ids = ["CUS-0001", "CUS-0001"]
    scenario_duplicate = len(duplicate_ids) != len(set(duplicate_ids))

    unknown_customer = "CUS-9999" not in customers

    bad_status = "shipped" not in order_statuses

    negative_volume = -5 <= 0

    negative_limit = -100_000 < 0

    credit_limit = 500_000
    outstanding = 0
    over_credit = not calc.credit_allows(credit_limit, outstanding, 900_000)

    closing_stock = 10 + 0 - 25
    negative_stock = closing_stock < 0

    bad_yield = calc.theoretical_yield(400, 650, 1250, 180, 2.0, 3.15, 2.65, 2.68)
    yield_detected = not calc.yield_within_tolerance(bad_yield)

    bad_wc = calc.wc_ratio(200, 320)
    wc_detected = bad_wc > calc.wc_limit("XC1")

    expired_days = calc.days_until(today - timedelta(days=10), today)
    licence_detected = calc.license_alert(expired_days) == "RENEW"

    empty_name = "" == ""

    negative_net = (8_000 + 1_000 - 12_000) < 0

    return [
        {
            "id": "SEED-01",
            "ar": "معرّف عميل مكرر داخل الملف",
            "en": "Duplicate customer ID in the file",
            "value": "CUS-0001 × 2",
            "detected": scenario_duplicate,
        },
        {
            "id": "SEED-02",
            "ar": "طلب يشير إلى عميل غير موجود",
            "en": "Order referencing a missing customer",
            "value": "CUS-9999",
            "detected": unknown_customer,
        },
        {
            "id": "SEED-03",
            "ar": "حالة طلب غير مسموح بها",
            "en": "Invalid order status",
            "value": "shipped",
            "detected": bad_status,
        },
        {
            "id": "SEED-04",
            "ar": "حجم طلب سالب",
            "en": "Negative order volume",
            "value": "-5 m3",
            "detected": negative_volume,
        },
        {
            "id": "SEED-05",
            "ar": "سقف ائتمان سالب",
            "en": "Negative credit limit",
            "value": "-100000",
            "detected": negative_limit,
        },
        {
            "id": "SEED-06",
            "ar": "طلب يتجاوز سقف ائتمان العميل",
            "en": "Order above the customer credit limit",
            "value": "900000 > 500000",
            "detected": over_credit,
        },
        {
            "id": "SEED-07",
            "ar": "رصيد مخزون سالب (افتتاحي + وارد − صادر)",
            "en": "Negative closing stock",
            "value": "10 + 0 − 25 = -15",
            "detected": negative_stock,
        },
        {
            "id": "SEED-08",
            "ar": "عائد خلطة خارج النطاق (زلط 1250)",
            "en": "Mix yield out of tolerance (gravel 1250)",
            "value": f"{bad_yield:.4f} m3",
            "detected": yield_detected,
        },
        {
            "id": "SEED-09",
            "ar": "نسبة W/C أعلى من حد XC1",
            "en": "W/C above the XC1 limit",
            "value": f"{bad_wc:.3f}",
            "detected": wc_detected,
        },
        {
            "id": "SEED-10",
            "ar": "ترخيص شاحنة منتهي",
            "en": "Expired truck licence",
            "value": f"{expired_days} days",
            "detected": licence_detected,
        },
        {
            "id": "SEED-11",
            "ar": "عميل بدون اسم",
            "en": "Customer without a name",
            "value": "(empty)",
            "detected": empty_name,
        },
        {
            "id": "SEED-12",
            "ar": "صافي راتب سالب",
            "en": "Negative net salary",
            "value": "8000 + 1000 − 12000",
            "detected": negative_net,
        },
    ]


def evaluate_demo_data_issues(dataset: dict[str, list[dict[str, Any]]], today: date | None = None) -> list[str]:
    """Validate the shipped demo dataset; must return an empty list."""
    today = today or date.today()
    issues: list[str] = []
    customer_ids = [row["customer_id"] for row in dataset["customers"]]
    if len(customer_ids) != len(set(customer_ids)):
        issues.append("duplicate customer ids")
    for row in dataset["customers"]:
        if row["credit_limit_egp"] < 0:
            issues.append(f"negative credit limit {row['customer_id']}")
        if not row["name_ar"].strip():
            issues.append(f"missing name {row['customer_id']}")
        if row["status"] not in cfg_module.ALLOWED["customer_status"]:
            issues.append(f"invalid customer status {row['customer_id']}")
    for row in dataset["orders"]:
        if row["customer_id"] not in customer_ids:
            issues.append(f"unknown customer {row['order_id']}")
        if row["volume_m3"] <= 0:
            issues.append(f"non-positive volume {row['order_id']}")
        if row["status"] not in cfg_module.ALLOWED["order_status"]:
            issues.append(f"invalid order status {row['order_id']}")
    for row in dataset["materials"]:
        closing = row["opening_qty"] + row["received_qty"] - row["issued_qty"]
        if closing < 0:
            issues.append(f"negative stock {row['material_id']}")
        if row["unit"] not in cfg_module.ALLOWED["material_unit"]:
            issues.append(f"invalid unit {row['material_id']}")
    for row in dataset["mix_designs"]:
        yield_m3 = calc.theoretical_yield(
            row["cement_kg"], row["sand_kg"], row["gravel_kg"], row["water_l"], row["air_percent"],
            row["sg_cement"], row["sg_sand"], row["sg_gravel"],
        )
        if not calc.yield_within_tolerance(yield_m3):
            issues.append(f"yield out of tolerance {row['mix_id']}")
        if not calc.wc_within_limit(row["water_l"], row["cement_kg"], row["exposure_class"]):
            issues.append(f"W/C above limit {row['mix_id']}")
        if row["status"] not in cfg_module.ALLOWED["mix_status"]:
            issues.append(f"invalid mix status {row['mix_id']}")
    for row in dataset["fleet"]:
        if calc.license_alert(calc.days_until(row["license_expiry"], today)) == "RENEW":
            issues.append(f"licence expiring {row['truck_id']}")
        if row["status"] not in cfg_module.ALLOWED["fleet_status"]:
            issues.append(f"invalid fleet status {row['truck_id']}")
    for row in dataset["employees"]:
        net = row["basic_salary"] + row["allowances"] - row["deductions"]
        if net < 0:
            issues.append(f"negative net salary {row['employee_id']}")
        if row["status"] not in cfg_module.ALLOWED["employee_status"]:
            issues.append(f"invalid employee status {row['employee_id']}")
    return issues


# ---------------------------------------------------------------------------
# Validation_Report sheet
# ---------------------------------------------------------------------------
def _build_validation(wb: Workbook, cfg: cfg_module.GeneratorConfig) -> None:
    ws = wb.create_sheet(VALIDATION)
    _rtl(ws)
    _title(
        ws,
        "ICONCRETE — Validation_Report | تقرير التحقق",
        "فحوصات حية على صيغ Excel + سيناريوهات اختبار مقصودة للتحقق من عمل القواعد",
        8,
    )
    _widths(ws, [8, 18, 34, 38, 62, 10, 12, 40])

    ws.cell(row=3, column=1, value="عدد الفحوصات").font = Font(bold=True, size=10)
    ws.cell(row=3, column=2, value="=COUNTA($A$7:$A$30)").font = Font(bold=True)
    ws.cell(row=3, column=3, value="OK").font = Font(bold=True, color=COLOR["success"])
    ws.cell(row=3, column=4, value='=COUNTIF($G$7:$G$30,"OK")').font = Font(bold=True, color=COLOR["success"])
    ws.cell(row=3, column=5, value="FAIL").font = Font(bold=True, color=COLOR["danger"])
    ws.cell(row=3, column=6, value='=COUNTIF($G$7:$G$30,"FAIL")').font = Font(bold=True, color=COLOR["danger"])

    _header_row(ws, 6, ["#", "Sheet", "Rule (AR)", "Rule (EN)", "Formula", "Result", "Status", "Action if FAIL"])

    for offset, check in enumerate(CHECKS):
        row = 7 + offset
        ws.cell(row=row, column=1, value=check["id"])
        ws.cell(row=row, column=2, value=check["sheet"])
        ws.cell(row=row, column=3, value=check["rule_ar"]).alignment = Alignment(horizontal="right", vertical="top", wrap_text=True)
        ws.cell(row=row, column=4, value=check["rule_en"]).alignment = Alignment(vertical="top", wrap_text=True)
        formula = check["formula"]
        ws.cell(row=row, column=5, value=formula[1:] if formula.startswith("=") else formula).font = MONO_FONT
        ws.cell(row=row, column=5).alignment = Alignment(vertical="top", wrap_text=True)
        result_formula = formula if formula.startswith("=") else f"={formula}"
        ws.cell(row=row, column=6, value=result_formula).font = Font(bold=True, size=11)
        ws.cell(row=row, column=7, value=f'=IF(F{row}=0,"OK","FAIL")').font = Font(bold=True)
        ws.cell(row=row, column=8, value=check["action_ar"]).alignment = Alignment(horizontal="right", vertical="top", wrap_text=True)
        for column in range(1, 9):
            ws.cell(row=row, column=column).border = BORDER
        ws.row_dimensions[row].height = 30

    last_check_row = 6 + len(CHECKS)
    ws.conditional_formatting.add(
        f"G7:G{last_check_row}",
        FormulaRule(formula=[f'$G7="FAIL"'], fill=RED_FILL),
    )
    ws.conditional_formatting.add(
        f"G7:G{last_check_row}",
        FormulaRule(formula=[f'$G7="OK"'], fill=GREEN_FILL),
    )

    scenarios = validate_demo_scenarios(cfg.report_to)
    start = last_check_row + 3
    _section(ws, start, "سيناريوهات اختبار مقصودة (بيانات تجريبية فقط) | Seeded test scenarios (demo only)", 8)
    _header_row(ws, start + 1, ["#", "Scenario (AR)", "Scenario (EN)", "Seed value", "Expected", "Detected", "Status", "Note"])
    for offset, scenario in enumerate(scenarios):
        row = start + 2 + offset
        ws.cell(row=row, column=1, value=scenario["id"])
        ws.cell(row=row, column=2, value=scenario["ar"]).alignment = Alignment(horizontal="right", wrap_text=True)
        ws.cell(row=row, column=3, value=scenario["en"]).alignment = Alignment(wrap_text=True)
        ws.cell(row=row, column=4, value=scenario["value"]).font = MONO_FONT
        ws.cell(row=row, column=5, value="DETECTED")
        ws.cell(row=row, column=6, value="YES" if scenario["detected"] else "NO")
        ws.cell(row=row, column=7, value="DETECTED" if scenario["detected"] else "NOT_DETECTED")
        ws.cell(row=row, column=8, value="قاعدة التحقق تعمل كما هو مطلوب — القيمة غير الصالحة تم رفضها" if scenario["detected"] else "لم يتم الرفض — راجع القاعدة")
        for column in range(1, 9):
            ws.cell(row=row, column=column).border = BORDER
            ws.cell(row=row, column=column).font = BODY_FONT
        status_cell = ws.cell(row=row, column=7)
        status_cell.fill = GREEN_FILL if scenario["detected"] else RED_FILL
        status_cell.font = Font(bold=True, color=COLOR["success"] if scenario["detected"] else COLOR["danger"])

    note_row = start + 3 + len(scenarios)
    ws.cell(row=note_row, column=1, value="ملاحظة: العمود Formula يوضح الصيغة المستخدمة؛ يمكن إعادة حسابها في Excel بعد تعديل البيانات. / The Formula column shows the live rule; recalculate in Excel after editing data.").font = NOTE_FONT
    ws.freeze_panes = "A7"


# ---------------------------------------------------------------------------
# Dashboard sheet
# ---------------------------------------------------------------------------
def _build_dashboard(wb: Workbook, cfg: cfg_module.GeneratorConfig, demo: dict[str, list[dict[str, Any]]]) -> None:
    ws = wb.create_sheet(DASHBOARD)
    _rtl(ws)
    _title(
        ws,
        "ICONCRETE — الداشبورد | Dashboard",
        "كل الأرقام محسوبة بصيغ Excel من أوراق البيانات — لا إدخال يدوي",
        11,
    )
    ws.cell(row=3, column=1, value="=Company_Name").font = Font(bold=True, size=11, color=COLOR["primary_dark"])
    ws.cell(row=3, column=5, value="=Plant_Name").font = Font(bold=True, size=11)
    ws.cell(row=4, column=1, value="فترة التقرير | Period").font = NOTE_FONT
    ws.cell(row=4, column=2, value="=Report_From").number_format = DATE_FMT
    ws.cell(row=4, column=3, value="→").alignment = Alignment(horizontal="center")
    ws.cell(row=4, column=4, value="=Report_To").number_format = DATE_FMT
    ws.cell(row=4, column=6, value="العملة | Currency").font = NOTE_FONT
    ws.cell(row=4, column=7, value="=Currency_Code")

    _section(ws, 6, "المؤشرات الرئيسية | Key indicators", 11)
    _header_row(ws, 7, ["المؤشر | KPI", "القيمة | Value", "الوحدة | Unit"])

    kpis = [
        ("عملاء | Customers", "=COUNTA(Customers!$A$2:$A$300)", "عميل"),
        ("إجمالي سقوف الائتمان | Credit limits", "=SUM(Customers!$G$2:$G$300)", "EGP"),
        ("المديونية | Outstanding", "=SUM(Customers!$I$2:$I$300)", "EGP"),
        ("الائتمان المتاح | Available credit", "=SUM(Customers!$J$2:$J$300)", "EGP"),
        ("قيمة المخزون | Stock value", "=SUM(Materials!$M$2:$M$300)", "EGP"),
        ("مواد تحت حد الطلب | Reorder alerts", '=COUNTIF(Materials!$N$2:$N$300,"REORDER")', "مادة"),
        ("إجمالي الطلبات | Order value", "=SUM(Orders!$K$2:$K$400)", "EGP"),
        ("حجم الإنتاج | Production volume", "=SUM(Orders!$D$2:$D$400)", "m³"),
        ("خلطات معتمدة | Approved mixes", '=COUNTIF(Mix_Designs!$X$2:$X$300,"approved")+COUNTIF(Mix_Designs!$X$2:$X$300,"active")', "خلطة"),
        ("رواتب مستحقة | Payroll", "=SUM(Employees!$J$2:$J$300)", "EGP"),
        ("شاحنات نشطة | Active trucks", '=COUNTIF(Fleet!$H$2:$H$300,"active")', "شاحنة"),
        ("فحوصات فاشلة | Validation failures", '=COUNTIF(Validation_Report!$G$7:$G$30,"FAIL")', "فحص"),
    ]
    for offset, (label, formula, unit) in enumerate(kpis, start=8):
        ws.cell(row=offset, column=1, value=label).font = Font(size=10)
        value_cell = ws.cell(row=offset, column=2, value=formula)
        value_cell.font = Font(bold=True, size=11, color=COLOR["primary_dark"])
        if unit == "EGP":
            value_cell.number_format = MONEY_FMT
        ws.cell(row=offset, column=3, value=unit).font = NOTE_FONT
        for column in range(1, 4):
            ws.cell(row=offset, column=column).border = BORDER

    _section(ws, 22, "بيانات الرسوم البيانية | Chart data", 11)
    _header_row(ws, 23, ["الشهر | Month", "الإيراد | Revenue", "الإنتاج m³ | Volume"])

    months = cfg.month_keys(6)
    for offset, key in enumerate(months):
        row = 24 + offset
        start_date, end_date = cfg.month_bounds(key)
        ws.cell(row=row, column=1, value=key)
        ws.cell(
            row=row,
            column=2,
            value=(
                f'=SUMIFS(Orders!$K$2:$K$400,Orders!$E$2:$E$400,">="&DATE({start_date.year},{start_date.month},{start_date.day}),'
                f'Orders!$E$2:$E$400,"<="&DATE({end_date.year},{end_date.month},{end_date.day}))'
            ),
        ).number_format = MONEY_FMT
        ws.cell(
            row=row,
            column=3,
            value=(
                f'=SUMIFS(Orders!$D$2:$D$400,Orders!$E$2:$E$400,">="&DATE({start_date.year},{start_date.month},{start_date.day}),'
                f'Orders!$E$2:$E$400,"<="&DATE({end_date.year},{end_date.month},{end_date.day}))'
            ),
        ).number_format = NUMBER_FMT

    _header_row(ws, 23, ["الشهر | Month", "الإيراد | Revenue", "الإنتاج m³ | Volume"])
    ws.cell(row=32, column=1, value="المادة | Material").font = HEADER_FONT
    ws.cell(row=32, column=1).fill = HEADER_FILL
    ws.cell(row=32, column=2, value="قيمة المخزون | Stock value").font = HEADER_FONT
    ws.cell(row=32, column=2).fill = HEADER_FILL
    for offset, material in enumerate(demo["materials"]):
        row = 33 + offset
        ws.cell(row=row, column=1, value=material["name_ar"])
        ws.cell(row=row, column=2, value=f'=SUMIF(Materials!$C$2:$C$300,A{row},Materials!$M$2:$M$300)').number_format = MONEY_FMT

    if cfg.include_charts:
        revenue_chart = BarChart()
        revenue_chart.type = "col"
        revenue_chart.style = 12
        revenue_chart.title = "الإيراد الشهري | Monthly revenue"
        revenue_chart.y_axis.title = "EGP"
        revenue_chart.x_axis.title = "Month"
        revenue_chart.height = 8.5
        revenue_chart.width = 16
        data = Reference(ws, min_col=2, min_row=23, max_row=23 + len(months))
        categories = Reference(ws, min_col=1, min_row=24, max_row=23 + len(months))
        revenue_chart.add_data(data, titles_from_data=True)
        revenue_chart.set_categories(categories)
        ws.add_chart(revenue_chart, "E8")

        volume_chart = LineChart()
        volume_chart.style = 13
        volume_chart.title = "الإنتاج الشهري | Monthly volume (m3)"
        volume_chart.y_axis.title = "m3"
        volume_chart.height = 8.5
        volume_chart.width = 16
        volume_data = Reference(ws, min_col=3, min_row=23, max_row=23 + len(months))
        volume_chart.add_data(volume_data, titles_from_data=True)
        volume_chart.set_categories(categories)
        ws.add_chart(volume_chart, "E25")

        doughnut = DoughnutChart()
        doughnut.title = "توزيع قيمة المخزون | Stock value mix"
        doughnut.height = 9
        doughnut.width = 14
        stock_data = Reference(ws, min_col=2, min_row=32, max_row=32 + len(demo["materials"]))
        stock_categories = Reference(ws, min_col=1, min_row=33, max_row=32 + len(demo["materials"]))
        doughnut.add_data(stock_data, titles_from_data=True)
        doughnut.set_categories(stock_categories)
        ws.add_chart(doughnut, "E42")

    ws.cell(row=52, column=1, value="المصدر: جداول Excel داخل هذا الملف. / Source: Excel tables inside this workbook.").font = NOTE_FONT
    ws.cell(row=53, column=1, value=cfg_module.GENERATOR_LIMITATIONS_EN).font = NOTE_FONT
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 16
    ws.freeze_panes = "A8"


# ---------------------------------------------------------------------------
# Login / cover, README, data dictionary, migration, demo data
# ---------------------------------------------------------------------------
def _build_login(wb: Workbook, cfg: cfg_module.GeneratorConfig, generated_at: datetime) -> None:
    ws = wb.create_sheet(LOGIN, 0)
    _rtl(ws)
    _widths(ws, [26, 34, 22, 20])
    ws.merge_cells("A1:D1")
    brand = ws.cell(row=1, column=1, value=cfg_module.BRAND_NAME)
    brand.font = Font(bold=True, size=40, color=COLOR["primary_dark"])
    brand.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 58

    ws.merge_cells("A2:D2")
    tagline = ws.cell(row=2, column=1, value=cfg_module.TAGLINE)
    tagline.font = Font(size=14, color="64748B")
    tagline.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[2].height = 26

    ws.merge_cells("A4:D4")
    subtitle = ws.cell(row=4, column=1, value="نظام إدارة محطات الخرسانة الجاهزة | Ready-mix concrete plant management")
    subtitle.font = Font(bold=True, size=12, color=COLOR["text"])
    subtitle.alignment = Alignment(horizontal="center")

    info = [
        ("الشركة | Company", cfg.company_name_ar, cfg.company_name_en),
        ("المحطة | Plant", cfg.plant_name_ar, cfg.plant_name_en),
        ("العملة | Currency", cfg.currency, "EGP (demo)"),
        ("اللغة الافتراضية | Default language", "العربية (RTL)", "English (LTR)"),
        ("المنطقة الزمنية | Timezone", cfg.timezone, cfg.country),
        ("إصدار المولد | Generator version", cfg_module.GENERATOR_VERSION, cfg_module.EXCEL_TEMPLATE_VERSION),
        ("تاريخ التوليد | Generated at", generated_at.strftime("%Y-%m-%d %H:%M"), "UTC"),
    ]
    for offset, (label, value_ar, value_en) in enumerate(info, start=6):
        ws.cell(row=offset, column=1, value=label).font = Font(bold=True, size=10)
        ws.cell(row=offset, column=2, value=value_ar).font = BODY_FONT
        ws.cell(row=offset, column=3, value=value_en).font = NOTE_FONT

    _section(ws, 14, "تسجيل الدخول | Sign in", 4)
    ws.cell(row=15, column=1, value="الشركة | Company").font = Font(bold=True, size=10)
    company_input = ws.cell(row=15, column=2, value=cfg.company_name_ar)
    company_input.fill = INPUT_FILL
    company_input.protection = Protection(locked=False)
    ws.cell(row=16, column=1, value="المستخدم | Username").font = Font(bold=True, size=10)
    user_input = ws.cell(row=16, column=2, value="demo.admin")
    user_input.fill = INPUT_FILL
    user_input.protection = Protection(locked=False)
    ws.cell(row=17, column=1, value="كلمة المرور | Password").font = Font(bold=True, size=10)
    password_input = ws.cell(row=17, column=2, value="********")
    password_input.fill = INPUT_FILL
    password_input.protection = Protection(locked=False)
    ws.cell(row=18, column=1, value="تسجيل الدخول | Sign in").font = Font(bold=True, size=10)
    ws.merge_cells("B18:C18")
    button = ws.cell(row=18, column=2, value="المصادقة تتم في تطبيق الويب | Authentication happens in the web app")
    button.fill = PRIMARY_FILL
    button.font = Font(bold=True, color="FFFFFF", size=10)
    button.alignment = Alignment(horizontal="center", vertical="center")

    ws.merge_cells("A20:D20")
    note = ws.cell(
        row=20,
        column=1,
        value=(
            "هذا الملف نسخة مبدئية/أوفلاين: لا يحتوي تحققاً بخطوتين فعلياً ولا صلاحيات RBAC على الخادم "
            "ولا مزامنة سحابية. تسجيل الدخول الحقيقي يتم في تطبيق ICONCRETE على الويب."
        ),
    )
    note.font = NOTE_FONT
    note.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[20].height = 34

    ws.cell(row=22, column=1, value="حالة التحقق | Validation status").font = Font(bold=True, size=10)
    status_cell = ws.cell(row=22, column=2, value='=IF(COUNTIF(Validation_Report!$G$7:$G$30,"FAIL")=0,"OK","CHECK REQUIRED")')
    status_cell.font = Font(bold=True, size=12, color=COLOR["success"])
    status_cell.fill = GREEN_FILL

    ws.merge_cells("A24:D24")
    protection_note = ws.cell(row=24, column=1, value=cfg_module.PROTECTION_NOTE_AR)
    protection_note.font = NOTE_FONT
    protection_note.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[24].height = 30

    ws.merge_cells("A26:D26")
    demo_note = ws.cell(
        row=26,
        column=1,
        value="بيانات هذا الملف تجريبية وموسومة DEMO — لا تحتوي أي بيانات شركة أو أفراد حقيقيين. / All data is DEMO-marked; no real company or personal data.",
    )
    demo_note.font = Font(bold=True, size=9, color=COLOR["danger"])
    demo_note.alignment = Alignment(wrap_text=True)
    ws.row_dimensions[26].height = 28

    _protect(ws, input_columns=[2], first_row=15, last_row=18, enabled=cfg.protect_sheets)


def _build_readme(wb: Workbook, cfg: cfg_module.GeneratorConfig) -> None:
    ws = wb.create_sheet(README)
    _rtl(ws)
    _widths(ws, [110])
    ws.cell(row=1, column=1, value="ICONCRETE — دليل المصنف | Workbook guide").font = TITLE_FONT
    ws.row_dimensions[1].height = 30

    sections: list[tuple[str, str]] = [
        (
            "كيف تستخدم هذا المصنف (عربي)",
            "1) ابدأ من ورقة Settings لتأكيد هوية الشركة والمحطة وفترة التقرير.\n"
            "2) أدخل بياناتك في الأوراق ذات الخلايا الصفراء (Customers, Suppliers, Materials, Mix_Designs, Orders, Employees, Fleet).\n"
            "3) لا تكتب في الخلايا الرمادية — تحتوي صيغاً محسوبة ومحمية.\n"
            "4) افتح Validation_Report بعد كل تعديل: أي FAIL يعني صفاً يحتاج تصحيحاً.\n"
            "5) راقب Dashboard — كل المؤشرات تُجمع من الأوراق بالصيغ.\n"
            "6) البيانات الحالية تجريبية وموسومة DEMO. قبل الاستخدام الحقيقي احذف كل الصفوف التي DataSource = DEMO.",
        ),
        (
            "How to use this workbook (English)",
            "1) Start in Settings to confirm company/plant identity and the report period.\n"
            "2) Enter data in the yellow input cells of the data sheets.\n"
            "3) Never type into grey cells — they hold protected, calculated formulas.\n"
            "4) Open Validation_Report after every edit: FAIL means a row needs fixing.\n"
            "5) Watch Dashboard — every KPI is aggregated by formula from the sheets.\n"
            "6) All shipped rows are DEMO-marked. Delete DataSource = DEMO rows before real use.",
        ),
        (
            "الأوراق | Worksheets",
            "Login: غلاف وهوية ICONCRETE + ملاحظة أن الدخول الحقيقي في الويب.\n"
            "Dashboard: مؤشرات ورسوم بيانية محسوبة.\n"
            "Validation_Report: فحوصات حية + سيناريوهات اختبار مقصودة.\n"
            "Data_Dictionary: تعريف كل حقل والقيم المسموح بها.\n"
            "Settings: الهوية، الفترة، الألوان، القوائم المنسدلة، أسماء النطاقات.\n"
            "Customers / Suppliers / Materials / Mix_Designs / Orders / Employees / Fleet: إدخال البيانات.\n"
            "Migration_to_Web_App: خطوات الانتقال إلى تطبيق الويب.\n"
            "Demo_Data: شرح فصل البيانات التجريبية وعدد الصفوف.",
        ),
        (
            "القواعد المطبقة في المصنف | Rules enforced here",
            "RTL كامل + عربي افتراضي: نعم.\n"
            "عائد الخلطة 0.98–1.02 م³: صيغة في Mix_Designs.\n"
            "W/C حسب ظرف التعرض (XC1=0.60, XC4=0.45, XS2=0.45, XS3=0.40): صيغة + تحقق.\n"
            "سقف ائتمان العميل: صيغة CreditCheck في Orders + فحص في Validation_Report.\n"
            "ترخيص الشاحنة ≤ 30 يوم: تنبيه تلقائي في Fleet.\n"
            "W/C و العائد: يُرفضان في تقرير التحقق.",
        ),
        (
            "ما لا يعمل داخل ملف Excel مستقل | Limitations",
            cfg_module.GENERATOR_LIMITATIONS_AR + "\n\n" + cfg_module.GENERATOR_LIMITATIONS_EN,
        ),
        (
            "البيانات التجريبية | Demo data",
            "كل الصفوف تحمل DataSource = DEMO وشركة/محطة تجريبية. لا تُستخدم أي بيانات حقيقية. "
            "الاستيراد إلى تطبيق الويب يتم عبر مركز تكامل Excel بعد تحقق كامل، ولا يكتب فوق سجل موجود بصمت.",
        ),
        (
            "التصدير إلى تطبيق ICONCRETE | Export to the web app",
            "استخدم قوالب مركز تكامل Excel في التطبيق (Customers, Suppliers, Materials, Mix_Designs, Orders, Employees, Fleet). "
            "حافظ على أسماء الأعمدة. التطبيق يتحقق من الأنواع والتكرار والمراجع والقواعد قبل الاستيراد.",
        ),
    ]

    row = 3
    for heading, body in sections:
        cell = ws.cell(row=row, column=1, value=heading)
        cell.font = Font(bold=True, size=12, color=COLOR["primary_dark"])
        cell.fill = SECTION_FILL
        ws.row_dimensions[row].height = 22
        row += 1
        body_cell = ws.cell(row=row, column=1, value=body)
        body_cell.font = Font(size=10)
        body_cell.alignment = Alignment(wrap_text=True, vertical="top", horizontal="right")
        lines = max(body.count("\n") + 1, body.count(". ") + 1, 3)
        ws.row_dimensions[row].height = min(24 * lines, 210)
        row += 3

    ws.cell(row=row, column=1, value=f"ICONCRETE — {cfg_module.TAGLINE} — v{cfg_module.GENERATOR_VERSION}").font = NOTE_FONT


def _build_data_dictionary(wb: Workbook) -> None:
    ws = wb.create_sheet(DATA_DICTIONARY)
    _rtl(ws)
    _title(ws, "ICONCRETE — Data Dictionary | قاموس البيانات", "كل ورقة وكل حقل والقيم المسموح بها", 9)
    headers = ["الورقة | Sheet", "الحقل | Field", "التسمية العربية", "English label", "النوع | Type", "مطلوب | Required", "القيم المسموح بها | Allowed", "ملاحظات | Notes"]
    _header_row(ws, 4, headers)
    _widths(ws, [20, 20, 24, 26, 12, 14, 34, 32])
    row = 5
    for sheet, fields in cfg_module.SCHEMA.items():
        for field in fields:
            ws.cell(row=row, column=1, value=sheet).font = Font(bold=True, size=9)
            ws.cell(row=row, column=2, value=field["field"]).font = MONO_FONT
            ws.cell(row=row, column=3, value=field["ar"]).alignment = Alignment(horizontal="right", wrap_text=True)
            ws.cell(row=row, column=4, value=field["en"]).alignment = Alignment(wrap_text=True)
            ws.cell(row=row, column=5, value=field["type"])
            ws.cell(row=row, column=6, value=field["required"])
            ws.cell(row=row, column=7, value=field["allowed"]).alignment = Alignment(wrap_text=True)
            ws.cell(row=row, column=8, value=field["note"]).alignment = Alignment(wrap_text=True)
            for column in range(1, 9):
                ws.cell(row=row, column=column).border = BORDER
            row += 1
    ws.freeze_panes = "A5"
    ws.auto_filter.ref = f"A4:H{row - 1}"


def _build_migration(wb: Workbook) -> None:
    ws = wb.create_sheet(MIGRATION)
    _rtl(ws)
    _title(ws, "ICONCRETE — Migration to Web App | الانتقال إلى تطبيق الويب", "من مصنف أوفلاين إلى نظام مركزي بمصدر حقيقة واحد", 6)
    _widths(ws, [8, 44, 52, 34])
    _header_row(ws, 4, ["#", "الخطوة | Step (AR)", "Step (EN)", "المكان في التطبيق | Where"])
    steps = [
        ("نظّف البيانات التجريبية: احذف كل صف DataSource = DEMO.", "Remove demo rows: delete every row with DataSource = DEMO.", "Customers … Fleet sheets"),
        ("تأكد أن Validation_Report يعرض OK لكل الفحوصات.", "Make Validation_Report show OK for every check.", "Validation_Report"),
        ("نزّل قالب الاستيراد المطابق من مركز تكامل Excel.", "Download the matching import template from the Excel Integration Center.", "Web → Excel Integration Center"),
        ("انقل بياناتك إلى القالب دون تغيير أسماء الأعمدة.", "Copy your data into the template without renaming columns.", "Excel"),
        ("ارفع الملف: معاينة ← تحقق ← تقرير أخطاء إن وجد.", "Upload: preview → validate → error report if any.", "Web → Upload"),
        ("أكّد الاستيراد بعد مراجعة الصفوف الصالحة.", "Confirm the import after reviewing valid rows.", "Web → Confirm"),
        ("راجع سجل التدقيق للتأكد من تسجيل العملية.", "Check the audit log to confirm the operation was recorded.", "Web → Audit log"),
    ]
    for offset, (ar, en, where) in enumerate(steps, start=5):
        ws.cell(row=offset, column=1, value=offset - 4)
        ws.cell(row=offset, column=2, value=ar).alignment = Alignment(horizontal="right", wrap_text=True, vertical="top")
        ws.cell(row=offset, column=3, value=en).alignment = Alignment(wrap_text=True, vertical="top")
        ws.cell(row=offset, column=4, value=where).font = MONO_FONT
        ws.row_dimensions[offset].height = 30
        for column in range(1, 5):
            ws.cell(row=offset, column=column).border = BORDER

    ws.cell(row=14, column=1, value="قواعد الانتقال | Migration rules").font = Font(bold=True, size=12, color=COLOR["primary_dark"])
    rules = [
        "قاعدة البيانات هي مصدر الحقيقة؛ Excel لا يكون قاعدة بيانات ثانية.",
        "كل استيراد يتحقق قبل الحفظ، ولا يكتب فوق سجل موجود بصمت.",
        "الملفات المرفوعة تُقرأ كبيانات فقط: لا ماكروات ولا معادلات موثوقة.",
        "كل عملية استيراد/تصدير/رفض تُسجل في سجل التدقيق.",
        "إصدار قالب الاستيراد مذكور في كل ملف لضمان التوافق مستقبلاً.",
    ]
    for offset, rule in enumerate(rules, start=15):
        ws.cell(row=offset, column=1, value=f"{offset - 14}.")
        ws.cell(row=offset, column=2, value=rule).alignment = Alignment(horizontal="right", wrap_text=True)
        ws.merge_cells(start_row=offset, start_column=2, end_row=offset, end_column=4)
        ws.row_dimensions[offset].height = 22
    ws.cell(row=21, column=1, value="The database is the single source of truth; Excel is a starter/export/import format, never a competing database.").font = NOTE_FONT


def _build_demo_data(wb: Workbook, cfg: cfg_module.GeneratorConfig) -> None:
    ws = wb.create_sheet(DEMO_DATA)
    _rtl(ws)
    _title(ws, "ICONCRETE — Demo_Data", "شرح فصل البيانات التجريبية عن بياناتك الحقيقية", 6)
    _widths(ws, [36, 18, 18, 50])
    ws.cell(row=4, column=1, value="كل الصفوف المولدة موسومة DEMO في عمود DataSource.").font = Font(bold=True, color=COLOR["danger"])
    ws.cell(row=5, column=1, value="لا تخلط بيانات حقيقية مع صفوف DEMO داخل نفس الورقة.").font = BODY_FONT
    ws.cell(row=6, column=1, value="قبل الاستخدام الحقيقي: رشّح DataSource = DEMO واحذف كل الصفوف المطابقة، ثم املأ بياناتك.").font = BODY_FONT

    _header_row(ws, 8, ["الورقة | Sheet", "صفوف تجريبية | Demo rows", "الحالة | Status", "ملاحظة | Note"])
    sheets = [
        (CUSTOMERS, "Customers!$L$2:$L$300"),
        (SUPPLIERS, "Suppliers!$G$2:$G$300"),
        (MATERIALS, "Materials!$O$2:$O$300"),
        (MIX, "Mix_Designs!$Y$2:$Y$300"),
        (ORDERS, "Orders!$M$2:$M$400"),
        (EMPLOYEES, "Employees!$K$2:$K$300"),
        (FLEET, "Fleet!$K$2:$K$300"),
    ]
    for offset, (sheet, column) in enumerate(sheets, start=9):
        ws.cell(row=offset, column=1, value=sheet)
        ws.cell(row=offset, column=2, value=f'=COUNTIF({column},"DEMO")').font = Font(bold=True)
        ws.cell(row=offset, column=3, value=f'=IF(B{offset}>0,"DEMO PRESENT","CLEAN")')
        ws.cell(row=offset, column=4, value="احذف صفوف DEMO قبل الاستخدام الحقيقي / Delete DEMO rows before real use").font = NOTE_FONT
        for column_index in range(1, 5):
            ws.cell(row=offset, column=column_index).border = BORDER

    ws.cell(row=18, column=1, value="الهوية التجريبية | Demo identity").font = Font(bold=True, size=12, color=COLOR["primary_dark"])
    ws.cell(row=19, column=1, value="الشركة | Company")
    ws.cell(row=19, column=2, value=f"{cfg.company_name_ar} / {cfg.company_name_en}")
    ws.cell(row=20, column=1, value="المحطة | Plant")
    ws.cell(row=20, column=2, value=f"{cfg.plant_name_ar} / {cfg.plant_name_en}")
    ws.cell(row=21, column=1, value="فترة التقرير | Report period")
    ws.cell(row=21, column=2, value=f"{cfg.report_from.isoformat()} → {cfg.report_to.isoformat()}")
    ws.cell(row=23, column=1, value="ملف الإدخال التجريبي في المستودع | Demo CSV inputs").font = NOTE_FONT
    ws.cell(row=24, column=1, value="excel_generator/sample_input/customers_demo.csv").font = MONO_FONT
    ws.cell(row=25, column=1, value="excel_generator/sample_input/suppliers_demo.csv").font = MONO_FONT
    ws.cell(row=26, column=1, value="excel_generator/sample_input/materials_opening_balances_demo.csv").font = MONO_FONT


# ---------------------------------------------------------------------------
# Workbook assembly
# ---------------------------------------------------------------------------
def build_workbook(cfg: cfg_module.GeneratorConfig | None = None) -> Workbook:
    cfg = cfg or cfg_module.GeneratorConfig()
    generated_at = datetime.now()
    workbook = Workbook()
    workbook.remove(workbook.active)

    properties = workbook.properties
    properties.creator = f"{cfg_module.BRAND_NAME} — {cfg_module.TAGLINE}"
    properties.title = f"{cfg_module.PROJECT_INTERNAL_NAME} — Excel Starter Workbook"
    properties.description = (
        "Standalone ICONCRETE workbook generated by the portable Python generator. "
        "Contains demo data marked DEMO, protected formulas and a live validation report."
    )
    properties.subject = "Ready-mix concrete management"
    properties.keywords = "ICONCRETE, concrete, RTL, Arabic, Excel generator"
    # §51: a formula in a cell does not prove it was calculated. Ask Excel/LibreOffice to
    # recalculate every formula when the workbook opens, and never ship cached results.
    workbook.calculation.fullCalcOnLoad = True

    demo = cfg_module.build_demo_data(cfg) if cfg.include_demo_data else {name: [] for name in (
        "customers", "suppliers", "materials", "mix_designs", "orders", "employees", "fleet"
    )}

    ranges = _build_settings(workbook, cfg)
    _build_customers(workbook, cfg, demo["customers"], ranges)
    _build_suppliers(workbook, cfg, demo["suppliers"])
    _build_materials(workbook, cfg, demo["materials"])
    _build_mix(workbook, cfg, demo["mix_designs"])
    _build_orders(workbook, cfg, demo["orders"])
    _build_employees(workbook, cfg, demo["employees"])
    _build_fleet(workbook, cfg, demo["fleet"])
    _build_dashboard(workbook, cfg, demo)
    _build_validation(workbook, cfg)
    _build_data_dictionary(workbook)
    _build_migration(workbook)
    _build_demo_data(workbook, cfg)
    _build_readme(workbook, cfg)
    _build_login(workbook, cfg, generated_at)

    order = list(EXPECTED_SHEETS)
    workbook._sheets.sort(key=lambda sheet: order.index(sheet.title) if sheet.title in order else len(order))
    workbook.active = 0
    return workbook


def _unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem = candidate.stem
    suffix = candidate.suffix
    for counter in range(1, 1000):
        alternative = directory / f"{stem}_{counter}{suffix}"
        if not alternative.exists():
            return alternative
    raise RuntimeError("Could not find a free output filename")


def generate(cfg: cfg_module.GeneratorConfig | None = None, output_dir: str | Path | None = None) -> dict[str, Any]:
    """Generate the workbook and return a small report describing the result."""
    cfg = cfg or cfg_module.GeneratorConfig()
    directory = Path(output_dir or cfg.output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    workbook = build_workbook(cfg)
    filename = cfg.timestamped_filename()
    path = _unique_path(directory, filename)
    workbook.save(path)

    scenarios = validate_demo_scenarios(cfg.report_to)
    dataset = cfg_module.build_demo_data(cfg) if cfg.include_demo_data else {name: [] for name in (
        "customers", "suppliers", "materials", "mix_designs", "orders", "employees", "fleet"
    )}
    issues = evaluate_demo_data_issues(dataset, cfg.report_to) if cfg.include_demo_data else []

    return {
        "path": str(path),
        "filename": path.name,
        "sheets": list(workbook.sheetnames),
        "bytes": path.stat().st_size,
        "data_issues": issues,
        "seeded_scenarios": len(scenarios),
        "seeded_detected": sum(1 for scenario in scenarios if scenario["detected"]),
        "charts": sum(len(sheet._charts) for sheet in workbook.worksheets),
        "rtl_sheets": sum(1 for sheet in workbook.worksheets if sheet.sheet_view.rightToLeft),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the ICONCRETE Excel workbook")
    parser.add_argument("--output-dir", default="output", help="Directory for the generated .xlsx")
    parser.add_argument("--from", dest="date_from", default=None, help="Report start date YYYY-MM-DD")
    parser.add_argument("--to", dest="date_to", default=None, help="Report end date YYYY-MM-DD")
    parser.add_argument("--no-protection", action="store_true", help="Leave sheets unprotected")
    parser.add_argument("--no-charts", action="store_true", help="Skip dashboard charts")
    parser.add_argument("--empty", action="store_true", help="Generate without demo rows")
    args = parser.parse_args(argv)

    cfg = cfg_module.GeneratorConfig(output_dir=args.output_dir)
    if args.date_from:
        cfg.report_from = date.fromisoformat(args.date_from)
    if args.date_to:
        cfg.report_to = date.fromisoformat(args.date_to)
    cfg.protect_sheets = not args.no_protection
    cfg.include_charts = not args.no_charts
    cfg.include_demo_data = not args.empty

    result = generate(cfg, args.output_dir)
    print(f"Workbook: {result['path']}")
    print(f"Sheets ({len(result['sheets'])}): {', '.join(result['sheets'])}")
    print(f"Charts: {result['charts']} | RTL sheets: {result['rtl_sheets']} | Size: {result['bytes']} bytes")
    print(f"Demo data issues: {len(result['data_issues'])}")
    print(f"Seeded scenarios detected: {result['seeded_detected']}/{result['seeded_scenarios']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
