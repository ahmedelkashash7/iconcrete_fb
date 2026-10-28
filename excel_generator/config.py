"""ICONCRETE Excel generator — locked configuration, demo data and schema.

All identity values below are final (Addendum A1). Change only the paths or
report dates when you need a different output; do not change the brand.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

# ---------------------------------------------------------------------------
# Locked identity (Addendum A1) — do not ask the user to confirm these.
# ---------------------------------------------------------------------------
PROJECT_INTERNAL_NAME = "IConcrete-fp"
BRAND_NAME = "ICONCRETE"
TAGLINE = "Concrete Management Solutions"
DEFAULT_LANGUAGE = "ar"
SECOND_LANGUAGE = "en"
CURRENCY = "EGP"
TIMEZONE = "Africa/Cairo"

DEMO_COMPANY_AR = "شركة آي كونكريت التجريبية"
DEMO_COMPANY_EN = "IConcrete Demo Company"
DEMO_PLANT_AR = "محطة آي كونكريت التجريبية - القاهرة"
DEMO_PLANT_EN = "IConcrete Demo Plant - Cairo"

COLORS: dict[str, str] = {
    "primary": "6D28D9",
    "primary_dark": "4C1D95",
    "secondary": "8B5CF6",
    "accent": "2563EB",
    "success": "16A34A",
    "danger": "DC2626",
    "warning": "F59E0B",
    "background": "F8FAFC",
    "text": "0F172A",
}

VAT_RATE = 14.0
EXCEL_TEMPLATE_VERSION = "1.0.0"
GENERATOR_VERSION = "0.1.0"
DEMO_MARKER = "DEMO"

GENERATOR_LIMITATIONS_AR = (
    "ما لا يمكن تنفيذه داخل ملف Excel مستقل: المزامنة السحابية الحية، فرض RLS على "
    "PostgreSQL، التحقق بخطوتين الفعلي، اتصال GPS/SCADA/IoT الحقيقي، إرسال "
    "واتساب/SMS فعلياً، Power Query/Data Model/Power Pivot/DAX الأصلية، وتفويض "
    "الـ API على الخادم. هذه العناصر ممثلة بواجهات إعداد أو قوالب استيراد/تصدير "
    "أو وضع محاكاة موسوم بوضوح، ولا ندّعي أنها تعمل داخل الملف."
)

GENERATOR_LIMITATIONS_EN = (
    "Not implementable inside a standalone .xlsx: live cloud sync, PostgreSQL RLS "
    "enforcement, real 2FA, live GPS/SCADA/IoT connectivity, actual WhatsApp/SMS "
    "delivery, native Power Query/Data Model/Power Pivot/DAX, and server-side API "
    "authorization. These are represented by configuration placeholders, import/"
    "export templates, documented interfaces or clearly labelled simulation modes; "
    "this workbook does not claim they are live."
)

PROTECTION_NOTE_AR = (
    "حماية الأوراق هنا لمنع التعديل العارض فقط وليست حداً أمنياً؛ يمكن إزالتها من "
    "Excel. الحماية الحقيقية للبيانات تتم في تطبيق الويب وقاعدة البيانات."
)
PROTECTION_NOTE_EN = (
    "Sheet protection prevents accidental edits only and is not a security boundary; "
    "it can be removed in Excel. Real data protection lives in the web app and database."
)


@dataclass
class GeneratorConfig:
    """Everything a user normally edits before generating the workbook."""

    company_name_ar: str = DEMO_COMPANY_AR
    company_name_en: str = DEMO_COMPANY_EN
    plant_name_ar: str = DEMO_PLANT_AR
    plant_name_en: str = DEMO_PLANT_EN
    currency: str = CURRENCY
    language: str = DEFAULT_LANGUAGE
    country: str = "Egypt"
    timezone: str = TIMEZONE
    report_from: date = field(default_factory=lambda: date.today() - timedelta(days=150))
    report_to: date = field(default_factory=lambda: date.today())
    output_dir: str = "output"
    filename_prefix: str = "IConcrete"
    protect_sheets: bool = True
    include_demo_data: bool = True
    include_charts: bool = True
    vat_rate: float = VAT_RATE
    prepared_by: str = "ICONCRETE demo generator"

    def timestamped_filename(self, when: datetime | None = None) -> str:
        stamp = (when or datetime.now()).strftime("%Y%m%d_%H%M%S")
        return f"{self.filename_prefix}_{stamp}.xlsx"

    def month_keys(self, count: int = 6) -> list[str]:
        """Last `count` months ending in the report-to month, as YYYY-MM."""
        year, month = self.report_to.year, self.report_to.month
        keys: list[str] = []
        for _ in range(count):
            keys.append(f"{year:04d}-{month:02d}")
            month -= 1
            if month == 0:
                month = 12
                year -= 1
        return list(reversed(keys))

    def month_bounds(self, key: str) -> tuple[date, date]:
        year, month = (int(part) for part in key.split("-"))
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) - timedelta(days=1) if month == 12 else date(year, month + 1, 1) - timedelta(days=1)
        return start, end


# ---------------------------------------------------------------------------
# Allowed values (also written into the Settings sheet for dropdowns)
# ---------------------------------------------------------------------------
ALLOWED = {
    "customer_status": ["active", "suspended", "archived"],
    "priority_tier": ["A", "B", "C"],
    "order_status": ["draft", "confirmed", "scheduled", "in_production", "delivering", "completed", "invoiced"],
    "mix_status": ["draft", "testing", "approved", "active"],
    "exposure_class": ["XC1", "XC4", "XS2", "XS3"],
    "material_unit": ["ton", "m3", "liter", "kg"],
    "supplier_category": ["cement", "aggregate", "admixture", "fuel", "spare_parts", "services"],
    "supplier_status": ["active", "suspended"],
    "employee_status": ["active", "on_leave", "terminated"],
    "fleet_ownership": ["owned", "leased", "contracted"],
    "fleet_status": ["active", "maintenance", "idle"],
    "grade": ["C20", "C25", "C30", "C35", "C40", "C45", "C50"],
}


def build_demo_data(cfg: GeneratorConfig) -> dict[str, list[dict[str, Any]]]:
    """Deterministic demo dataset, clearly marked DEMO in every row."""
    today = cfg.report_to

    customers = [
        ("CUS-0001", "شركة النيل للإنشاءات", "Nile Construction Co.", "DEMO-TAX-1001", "+201000000001", "A", 500000, 30, "active"),
        ("CUS-0002", "مقاولات الدلتا", "Delta Contracting", "DEMO-TAX-1002", "+201000000002", "B", 750000, 45, "active"),
        ("CUS-0003", "شركة الأهرام للتعمير", "Pyramids Development", "DEMO-TAX-1003", "+201000000003", "A", 1500000, 60, "active"),
        ("CUS-0004", "مجموعة الجيزة العقارية", "Giza Real Estate Group", "DEMO-TAX-1004", "+201000000004", "B", 1000000, 30, "active"),
        ("CUS-0005", "شركة المستقبل للمشاريع", "Future Projects Co.", "DEMO-TAX-1005", "+201000000005", "C", 300000, 15, "active"),
        ("CUS-0006", "إنشاءات الإسكندرية", "Alexandria Builders", "DEMO-TAX-1006", "+201000000006", "B", 2000000, 45, "active"),
        ("CUS-0007", "شركة السلام للتطوير", "Al Salam Development", "DEMO-TAX-1007", "+201000000007", "C", 400000, 0, "suspended"),
        ("CUS-0008", "تحالف القاهرة للبناء", "Cairo Build Alliance", "DEMO-TAX-1008", "+201000000008", "A", 3000000, 60, "active"),
    ]

    suppliers = [
        ("SUP-001", "أسمنت السويس", "Suez Cement", "+20224000001", "cement", "active"),
        ("SUP-002", "محاجر عتاقة", "Ataka Quarries", "+20224000002", "aggregate", "active"),
        ("SUP-003", "شركة الرمل الذهبي", "Golden Sand Co.", "+20224000003", "aggregate", "active"),
        ("SUP-004", "إضافات البناء الحديثة", "Modern Build Admixtures", "+20224000004", "admixture", "active"),
        ("SUP-005", "مؤسسة وقود المحطة", "Plant Fuel Supply", "+20224000005", "fuel", "active"),
        ("SUP-006", "قطع غيار الخرسانة", "Concrete Spare Parts", "+20224000006", "spare_parts", "suspended"),
    ]

    materials = [
        ("MAT-001", "CEM-OPC", "أسمنت OPC", "OPC Cement", "ton", 3.15, 25, 120, 240, 310, 2450),
        ("MAT-002", "SAND-01", "رمل", "Sand", "ton", 2.65, 60, 340, 620, 780, 320),
        ("MAT-003", "GRV-01", "زلط ١", "Gravel 1", "ton", 2.68, 80, 460, 710, 900, 335),
        ("MAT-004", "GRV-02", "زلط ٢", "Gravel 2", "ton", 2.70, 50, 280, 380, 520, 340),
        ("MAT-005", "ADM-01", "إضافات خرسانة", "Concrete Admixture", "liter", 1.05, 400, 1800, 900, 1500, 62),
        ("MAT-006", "WTR-01", "مياه خلط", "Mixing Water", "m3", 1.00, 50, 140, 260, 300, 18),
    ]

    mix_designs = [
        ("MIX-001", "C25", "C25", "XC1", 320, 700, 1180, 175, 2.0, 3.15, 2.65, 2.68, "approved"),
        ("MIX-002", "C30", "C30", "XC1", 400, 650, 1150, 180, 2.0, 3.15, 2.65, 2.68, "active"),
        ("MIX-003", "C35", "C35", "XC4", 430, 640, 1120, 185, 2.0, 3.15, 2.65, 2.68, "active"),
        ("MIX-004", "C40", "C40", "XS2", 460, 620, 1100, 175, 2.5, 3.15, 2.65, 2.68, "approved"),
    ]

    order_templates = [
        ("ORD-1001", "CUS-0001", "C30", 60, 18, 1750, 0, 18, "invoiced"),
        ("ORD-1002", "CUS-0003", "C35", 120, 12, 1920, 4500, 24, "completed"),
        ("ORD-1003", "CUS-0002", "C25", 45, 9, 1620, 0, 12, "completed"),
        ("ORD-1004", "CUS-0004", "C30", 80, 5, 1780, 3000, 30, "delivering"),
        ("ORD-1005", "CUS-0008", "C40", 200, 2, 2100, 9000, 42, "in_production"),
        ("ORD-1006", "CUS-0006", "C30", 95, 20, 1800, 2500, 16, "confirmed"),
        ("ORD-1007", "CUS-0005", "C25", 30, 15, 1600, 0, 8, "completed"),
        ("ORD-1008", "CUS-0003", "C35", 150, 25, 1950, 6000, 26, "scheduled"),
        ("ORD-1009", "CUS-0001", "C30", 70, 8, 1760, 1500, 18, "confirmed"),
        ("ORD-1010", "CUS-0008", "C40", 180, 30, 2050, 7500, 42, "completed"),
        ("ORD-1011", "CUS-0004", "C30", 55, 22, 1790, 0, 30, "draft"),
        ("ORD-1012", "CUS-0006", "C35", 110, 14, 1900, 3500, 16, "completed"),
    ]
    orders = []
    for index, (order_id, customer_id, mix_code, volume, days_ago, unit_price, pump_fee, distance, status) in enumerate(order_templates):
        pour_date = today - timedelta(days=days_ago)
        orders.append(
            {
                "order_id": order_id,
                "customer_id": customer_id,
                "mix_code": mix_code,
                "volume_m3": float(volume),
                "pour_date": pour_date,
                "unit_price": float(unit_price),
                "pump_fee": float(pump_fee),
                "distance_km": float(distance),
                "status": status,
                "data_source": DEMO_MARKER,
            }
        )
        # Make the demo span the last six months for the dashboard trend.
        if index % 2 == 0 and days_ago < 30:
            orders[-1]["pour_date"] = today - timedelta(days=days_ago + 95)

    employees = [
        ("EMP-001", "أحمد محمود", "Ahmed Mahmoud", "مدير محطة", "+201000000001", 22000, 6000, 2500, "active"),
        ("EMP-002", "منى عبد الرحمن", "Mona Abdelrahman", "مديرة تشغيل", "+201000000002", 18500, 5000, 2000, "active"),
        ("EMP-003", "خالد سمير", "Khaled Samir", "مسؤول توزيع", "+201000000003", 12000, 3000, 1500, "active"),
        ("EMP-004", "سيد إبراهيم", "Sayed Ibrahim", "مشغل محطة", "+201000000004", 9800, 2200, 900, "active"),
        ("EMP-005", "محمد فتحي", "Mohamed Fathy", "فني صيانة", "+201000000005", 8400, 1800, 700, "active"),
        ("EMP-006", "عمرو حسن", "Amr Hassan", "فني معمل", "+201000000006", 8100, 1700, 650, "active"),
        ("EMP-007", "إسلام رجب", "Islam Ragab", "سائق", "+201000000007", 7900, 1600, 600, "on_leave"),
        ("EMP-008", "نادية علي", "Nadia Ali", "محاسبة", "+201000000008", 11200, 2600, 1100, "active"),
    ]

    fleet = [
        ("TRK-001", "TRK-01", 12, "owned", 92, 240, "سيد إبراهيم", "active"),
        ("TRK-002", "TRK-02", 12, "owned", 88, 180, "إسلام رجب", "active"),
        ("TRK-003", "TRK-03", 12, "owned", 72, 90, "محمد فتحي", "maintenance"),
        ("TRK-004", "TRK-04", 10, "owned", 95, 300, "عمرو حسن", "active"),
        ("TRK-005", "TRK-05", 12, "leased", 81, 150, "سيد إبراهيم", "active"),
        ("TRK-006", "TRK-06", 10, "leased", 79, 210, "إسلام رجب", "active"),
        ("TRK-007", "TRK-07", 12, "contracted", 68, 120, "محمد فتحي", "idle"),
        ("TRK-008", "TRK-08", 12, "owned", 90, 260, "عمرو حسن", "active"),
    ]

    return {
        "customers": [
            {
                "customer_id": row[0],
                "name_ar": row[1],
                "name_en": row[2],
                "tax_id": row[3],
                "phone": row[4],
                "priority_tier": row[5],
                "credit_limit_egp": row[6],
                "credit_days": row[7],
                "status": row[8],
                "data_source": DEMO_MARKER,
            }
            for row in customers
        ],
        "suppliers": [
            {
                "supplier_id": row[0],
                "name_ar": row[1],
                "name_en": row[2],
                "phone": row[3],
                "category": row[4],
                "status": row[5],
                "data_source": DEMO_MARKER,
            }
            for row in suppliers
        ],
        "materials": [
            {
                "material_id": row[0],
                "code": row[1],
                "name_ar": row[2],
                "name_en": row[3],
                "unit": row[4],
                "specific_gravity": row[5],
                "reorder_level": row[6],
                "opening_qty": row[7],
                "received_qty": row[8],
                "issued_qty": row[9],
                "unit_cost": row[10],
                "data_source": DEMO_MARKER,
            }
            for row in materials
        ],
        "mix_designs": [
            {
                "mix_id": row[0],
                "code": row[1],
                "grade": row[2],
                "exposure_class": row[3],
                "cement_kg": row[4],
                "sand_kg": row[5],
                "gravel_kg": row[6],
                "water_l": row[7],
                "air_percent": row[8],
                "sg_cement": row[9],
                "sg_sand": row[10],
                "sg_gravel": row[11],
                "status": row[12],
                "data_source": DEMO_MARKER,
            }
            for row in mix_designs
        ],
        "orders": orders,
        "employees": [
            {
                "employee_id": row[0],
                "name_ar": row[1],
                "name_en": row[2],
                "job_title": row[3],
                "phone": row[4],
                "basic_salary": row[5],
                "allowances": row[6],
                "deductions": row[7],
                "status": row[8],
                "data_source": DEMO_MARKER,
            }
            for row in employees
        ],
        "fleet": [
            {
                "truck_id": row[0],
                "code": row[1],
                "capacity_m3": row[2],
                "ownership": row[3],
                "health_score": row[4],
                "license_expiry": today + timedelta(days=row[5]),
                "driver_name": row[6],
                "status": row[7],
                "data_source": DEMO_MARKER,
            }
            for row in fleet
        ],
    }


# ---------------------------------------------------------------------------
# Data dictionary metadata (sheet -> fields)
# ---------------------------------------------------------------------------
SCHEMA: dict[str, list[dict[str, str]]] = {
    "Customers": [
        {"field": "CustomerID", "ar": "معرّف العميل", "en": "Customer ID", "type": "text", "required": "نعم", "allowed": "CUS-XXXX", "note": "مفتاح فريد"},
        {"field": "Name_AR", "ar": "الاسم بالعربية", "en": "Name (Arabic)", "type": "text", "required": "نعم", "allowed": "—", "note": ""},
        {"field": "Name_EN", "ar": "الاسم بالإنجليزية", "en": "Name (English)", "type": "text", "required": "لا", "allowed": "—", "note": ""},
        {"field": "TaxID", "ar": "الرقم الضريبي", "en": "Tax ID", "type": "text", "required": "لا", "allowed": "—", "note": ""},
        {"field": "Phone", "ar": "الهاتف", "en": "Phone", "type": "text", "required": "لا", "allowed": "+201…", "note": ""},
        {"field": "Priority", "ar": "درجة الأولوية", "en": "Priority tier", "type": "list", "required": "نعم", "allowed": "A, B, C", "note": ""},
        {"field": "CreditLimit", "ar": "سقف الائتمان", "en": "Credit limit (EGP)", "type": "number", "required": "نعم", "allowed": ">= 0", "note": "قاعدة PART 5 رقم 10"},
        {"field": "CreditDays", "ar": "أيام السماح", "en": "Credit days", "type": "number", "required": "نعم", "allowed": "0–180", "note": ""},
        {"field": "Outstanding", "ar": "المديونية", "en": "Outstanding", "type": "formula", "required": "محسوب", "allowed": "SUMIF من Orders", "note": "لا يُكتب يدوياً"},
        {"field": "Available", "ar": "المتاح", "en": "Available", "type": "formula", "required": "محسوب", "allowed": "سقف − مديونية", "note": "لا يُكتب يدوياً"},
        {"field": "Status", "ar": "الحالة", "en": "Status", "type": "list", "required": "نعم", "allowed": "active/suspended/archived", "note": ""},
        {"field": "DataSource", "ar": "مصدر البيانات", "en": "Data source", "type": "list", "required": "نعم", "allowed": "DEMO/REAL", "note": "يفصل البيانات التجريبية"},
    ],
    "Suppliers": [
        {"field": "SupplierID", "ar": "معرّف المورد", "en": "Supplier ID", "type": "text", "required": "نعم", "allowed": "SUP-XXX", "note": ""},
        {"field": "Name_AR", "ar": "الاسم بالعربية", "en": "Name (Arabic)", "type": "text", "required": "نعم", "allowed": "—", "note": ""},
        {"field": "Name_EN", "ar": "الاسم بالإنجليزية", "en": "Name (English)", "type": "text", "required": "لا", "allowed": "—", "note": ""},
        {"field": "Phone", "ar": "الهاتف", "en": "Phone", "type": "text", "required": "نعم", "allowed": "—", "note": ""},
        {"field": "Category", "ar": "التصنيف", "en": "Category", "type": "list", "required": "نعم", "allowed": "cement/aggregate/admixture/fuel/spare_parts/services", "note": ""},
        {"field": "Status", "ar": "الحالة", "en": "Status", "type": "list", "required": "نعم", "allowed": "active/suspended", "note": ""},
    ],
    "Materials": [
        {"field": "MaterialID", "ar": "معرّف المادة", "en": "Material ID", "type": "text", "required": "نعم", "allowed": "MAT-XXX", "note": ""},
        {"field": "Code", "ar": "كود المادة", "en": "Code", "type": "text", "required": "نعم", "allowed": "—", "note": ""},
        {"field": "Name_AR", "ar": "اسم المادة", "en": "Name (Arabic)", "type": "text", "required": "نعم", "allowed": "—", "note": ""},
        {"field": "Unit", "ar": "وحدة القياس", "en": "Unit", "type": "list", "required": "نعم", "allowed": "ton/m3/liter/kg", "note": ""},
        {"field": "SG", "ar": "الكثافة النوعية", "en": "Specific gravity", "type": "number", "required": "نعم", "allowed": "0.5–8", "note": "من المعمل"},
        {"field": "ReorderLevel", "ar": "حد إعادة الطلب", "en": "Reorder level", "type": "number", "required": "نعم", "allowed": ">= 0", "note": ""},
        {"field": "ClosingQty", "ar": "الرصيد الحالي", "en": "Closing quantity", "type": "formula", "required": "محسوب", "allowed": "افتتاحي + وارد − صادر", "note": ""},
        {"field": "StockValue", "ar": "قيمة المخزون", "en": "Stock value", "type": "formula", "required": "محسوب", "allowed": "الرصيد × التكلفة", "note": ""},
    ],
    "Mix_Designs": [
        {"field": "MixID", "ar": "معرّف الخلطة", "en": "Mix ID", "type": "text", "required": "نعم", "allowed": "MIX-XXX", "note": ""},
        {"field": "Grade", "ar": "الدرجة", "en": "Grade", "type": "list", "required": "نعم", "allowed": "C20–C50", "note": ""},
        {"field": "Exposure", "ar": "ظرف التعرض", "en": "Exposure class", "type": "list", "required": "نعم", "allowed": "XC1/XC4/XS2/XS3", "note": "يحدد حد W/C"},
        {"field": "Cement", "ar": "أسمنت (كجم)", "en": "Cement (kg)", "type": "number", "required": "نعم", "allowed": "100–600", "note": ""},
        {"field": "TotalYield", "ar": "العائد النظري", "en": "Theoretical yield", "type": "formula", "required": "محسوب", "allowed": "0.98–1.02 م³", "note": "قاعدة PART 5 رقم 1"},
        {"field": "WC", "ar": "نسبة المياه/الأسمنت", "en": "W/C ratio", "type": "formula", "required": "محسوب", "allowed": "حسب التعرض", "note": "قاعدة رقم 2"},
        {"field": "Water", "ar": "مياه (لتر)", "en": "Water (l)", "type": "number", "required": "نعم", "allowed": "80–260", "note": ""},
    ],
    "Orders": [
        {"field": "OrderID", "ar": "معرّف الطلب", "en": "Order ID", "type": "text", "required": "نعم", "allowed": "ORD-XXXX", "note": ""},
        {"field": "CustomerID", "ar": "العميل", "en": "Customer ID", "type": "text", "required": "نعم", "allowed": "يجب أن يوجد في Customers", "note": ""},
        {"field": "VolumeM3", "ar": "الحجم (م³)", "en": "Volume (m3)", "type": "number", "required": "نعم", "allowed": "> 0", "note": ""},
        {"field": "UnitPrice", "ar": "سعر المتر", "en": "Unit price", "type": "number", "required": "نعم", "allowed": ">= 0", "note": ""},
        {"field": "GrandTotal", "ar": "الإجمالي", "en": "Grand total", "type": "formula", "required": "محسوب", "allowed": "بنود + ضريبة + مضخة", "note": ""},
        {"field": "CreditCheck", "ar": "فحص الائتمان", "en": "Credit check", "type": "formula", "required": "محسوب", "allowed": "OK/OVER_LIMIT", "note": "قاعدة رقم 10"},
    ],
    "Employees": [
        {"field": "EmployeeID", "ar": "معرّف الموظف", "en": "Employee ID", "type": "text", "required": "نعم", "allowed": "EMP-XXX", "note": ""},
        {"field": "BasicSalary", "ar": "الراتب الأساسي", "en": "Basic salary", "type": "number", "required": "نعم", "allowed": ">= 0", "note": ""},
        {"field": "NetSalary", "ar": "الصافي", "en": "Net salary", "type": "formula", "required": "محسوب", "allowed": "أساسي + بدلات − خصومات", "note": ""},
        {"field": "Status", "ar": "الحالة", "en": "Status", "type": "list", "required": "نعم", "allowed": "active/on_leave/terminated", "note": ""},
    ],
    "Fleet": [
        {"field": "TruckID", "ar": "معرّف الشاحنة", "en": "Truck ID", "type": "text", "required": "نعم", "allowed": "TRK-XXX", "note": ""},
        {"field": "CapacityM3", "ar": "سعة الحوض", "en": "Drum capacity", "type": "number", "required": "نعم", "allowed": "1–20", "note": ""},
        {"field": "LicenseExpiry", "ar": "انتهاء الترخيص", "en": "Licence expiry", "type": "date", "required": "نعم", "allowed": "YYYY-MM-DD", "note": "تنبيه قبل 30 يوم"},
        {"field": "DaysToExpiry", "ar": "الأيام المتبقية", "en": "Days to expiry", "type": "formula", "required": "محسوب", "allowed": "التاريخ − اليوم", "note": ""},
    ],
}
