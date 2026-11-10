#!/usr/bin/env python3
"""Idempotent full-system demo seed for the live ICONCRETE API.

Every write goes through an existing HTTP endpoint, so validation, RLS, audit
trails and server timestamps are preserved. The script never opens a database
connection and never prints credentials.

Required environment:
  ICONCRETE_ADMIN_PASSWORD   demo admin password (not stored in this file)

Optional:
  ICONCRETE_URL              default https://iconcrete-fb.onrender.com
  ICONCRETE_COMPANY          default IConcrete Demo Company
  ICONCRETE_ADMIN_USER       default admin
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

BASE = os.environ.get("ICONCRETE_URL", "https://iconcrete-fb.onrender.com").rstrip("/")
COMPANY = os.environ.get("ICONCRETE_COMPANY", "IConcrete Demo Company")
USERNAME = os.environ.get("ICONCRETE_ADMIN_USER", "admin")
PASSWORD = os.environ.get("ICONCRETE_ADMIN_PASSWORD", "")
PLANT_CAIRO = "PLT-0001"
PLANT_GIZA = "PLT-0002"
TODAY = datetime.now(timezone.utc).date()


def iso(day: date) -> str:
    return day.isoformat()


def days_ago(n: int) -> str:
    return iso(TODAY - timedelta(days=n))


def days_ahead(n: int) -> str:
    return iso(TODAY + timedelta(days=n))


class Api:
    def __init__(self) -> None:
        self.token = ""
        self.writes = 0

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        payload = None if body is None else json.dumps(body).encode()
        headers = {"content-type": "application/json"}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(BASE + path, data=payload, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"error": "non_json_error"}
            return error.code, parsed

    def get(self, path: str) -> dict:
        status, body = self.request("GET", path)
        if status != 200:
            raise RuntimeError(f"GET {path} -> {status} {body.get('error', '')}")
        return body

    def post(self, path: str, body: dict, expected: tuple[int, ...] = (200, 201)) -> dict:
        status, response = self.request("POST", path, body)
        if status not in expected:
            raise RuntimeError(f"POST {path} -> {status} {response.get('error', '')} {response.get('field', '')}")
        self.writes += 1
        return response

    def login(self) -> None:
        status, response = self.request(
            "POST",
            "/api/auth/login",
            {"company": COMPANY, "username": USERNAME, "password": PASSWORD},
        )
        if status != 200 or not response.get("token"):
            raise RuntimeError(f"login -> {status} {response.get('error', '')}")
        self.token = response["token"]
        print(f"login: status=200 user={USERNAME}")


def find(items: list[dict], key: str, value: str) -> dict | None:
    return next((item for item in items if str(item.get(key, "")) == value), None)


CUSTOMERS = [
    ("DEMO/Nile Crown Contracting", "ديمو/شركة تاج النيل للمقاولات", "DEMO-CUS-01", 1500000, 30, "A"),
    ("DEMO/Delta Horizon Builders", "ديمو/بناء أفق الدلتا", "DEMO-CUS-02", 900000, 45, "A"),
    ("DEMO/Pyramid Gate Developments", "ديمو/تطويرات بوابة الهرم", "DEMO-CUS-03", 2400000, 60, "A"),
    ("DEMO/Red Sea Coast Contracting", "ديمو/مقاولات ساحل البحر الأحمر", "DEMO-CUS-04", 700000, 30, "B"),
    ("DEMO/New Cairo Structures", "ديمو/إنشاءات القاهرة الجديدة", "DEMO-CUS-05", 1200000, 45, "A"),
    ("DEMO/Alexandria Marine Works", "ديمو/أعمال الإسكندرية البحرية", "DEMO-CUS-06", 600000, 30, "B"),
    ("DEMO/Suez Canal Infrastructure", "ديمو/بنية قناة السويس", "DEMO-CUS-07", 3000000, 60, "A"),
    ("DEMO/Upper Egypt Roads Co.", "ديمو/طرق الصعيد", "DEMO-CUS-08", 800000, 30, "B"),
    ("DEMO/6th October Urban", "ديمو/عمران السادس من أكتوبر", "DEMO-CUS-09", 500000, 15, "C"),
    ("DEMO/Mansoura Commercial Build", "ديمو/إنشاءات المنصورة التجارية", "DEMO-CUS-10", 650000, 30, "B"),
]

PROJECTS = [
    ("DEMO-PRJ-01", "DEMO/Nile Crown Tower", "ديمو/برج تاج النيل", 0, "DEMO/New Cairo — 18 km from plant", PLANT_CAIRO),
    ("DEMO-PRJ-02", "DEMO/Delta Horizon Mall", "ديمو/مول أفق الدلتا", 1, "DEMO/Tanta — 52 km from plant", PLANT_CAIRO),
    ("DEMO-PRJ-03", "DEMO/Pyramid Gate Phase 2", "ديمو/بوابة الهرم - المرحلة الثانية", 2, "DEMO/6th of October — 24 km from plant", PLANT_GIZA),
    ("DEMO-PRJ-04", "DEMO/Red Sea Coast Resort", "ديمو/منتجع ساحل البحر الأحمر", 3, "DEMO/Ain Sokhna — 45 km from plant", PLANT_CAIRO),
    ("DEMO-PRJ-05", "DEMO/New Cairo Logistics Hub", "ديمو/مركز لوجستي القاهرة الجديدة", 4, "DEMO/New Cairo — 12 km from plant", PLANT_CAIRO),
    ("DEMO-PRJ-06", "DEMO/Alexandria Marine Terminal", "ديمو/محطة الإسكندرية البحرية", 5, "DEMO/Alexandria — 37 km from plant", PLANT_GIZA),
    ("DEMO-PRJ-07", "DEMO/Suez Canal Bridge", "ديمو/كوبري قناة السويس", 6, "DEMO/Ismailia — 31 km from plant", PLANT_CAIRO),
    ("DEMO-PRJ-08", "DEMO/Upper Egypt Road Package", "ديمو/حزمة طرق الصعيد", 7, "DEMO/Beni Suef — 8 km from plant", PLANT_GIZA),
]

MATERIALS = [
    ("DEMO-CEM-OPC", "ديمو/أسمنت OPC 42.5", "DEMO/OPC Cement 42.5", "cement", "ton", True, 30, 150, 50),
    ("DEMO-SAND", "ديمو/رمل طبيعي", "DEMO/Natural Sand", "aggregate", "ton", True, 120, 600, 180),
    ("DEMO-GRV-10", "ديمو/ركام 10 مم", "DEMO/Crushed Aggregate 10 mm", "aggregate", "ton", True, 100, 500, 160),
    ("DEMO-GRV-20", "ديمو/ركام 20 مم", "DEMO/Crushed Aggregate 20 mm", "aggregate", "ton", True, 100, 500, 160),
    ("DEMO-ADM", "ديمو/إضافات خرسانة", "DEMO/Concrete Admixture", "admixture", "liter", False, 500, 8000, 1200),
    ("DEMO-WTR", "ديمو/مياه خلط", "DEMO/Mixing Water", "water", "m3", True, 20, 200, 50),
]

MIXES = [
    ("DEMO-MIX-250", "ديمو/خلطة 250 كجم/م³", "DEMO/Mix 250 kg cement/m³", "C25/30", 250, 780, 520, 520, 160, 4.5, 25),
    ("DEMO-MIX-300", "ديمو/خلطة 300 كجم/م³", "DEMO/Mix 300 kg cement/m³", "C30/37", 300, 760, 510, 510, 165, 5.0, 30),
    ("DEMO-MIX-350", "ديمو/خلطة 350 كجم/م³", "DEMO/Mix 350 kg cement/m³", "C35/45", 350, 740, 500, 500, 170, 5.5, 35),
    ("DEMO-MIX-400", "ديمو/خلطة 400 كجم/م³", "DEMO/Mix 400 kg cement/m³", "C40/50", 400, 720, 490, 490, 175, 6.0, 40),
]

QC_CASES = [
    ("DEMO/MIX-250-SLUMP", "DEMO-MIX-250", "slump", 75, 125, "mm", 95, False),
    ("DEMO/MIX-300-SLUMP", "DEMO-MIX-300", "slump", 75, 125, "mm", 145, True),
    ("DEMO/MIX-350-SLUMP", "DEMO-MIX-350", "slump", 75, 125, "mm", 110, False),
    ("DEMO/MIX-400-SLUMP", "DEMO-MIX-400", "slump", 75, 125, "mm", 90, False),
    ("DEMO/MIX-250-TEMP", "DEMO-MIX-250", "temperature", 20, 32, "C", 27, False),
    ("DEMO/MIX-300-TEMP", "DEMO-MIX-300", "temperature", 20, 32, "C", 29, False),
    ("DEMO/MIX-350-TEMP", "DEMO-MIX-350", "temperature", 20, 32, "C", 31, False),
    ("DEMO/MIX-400-TEMP", "DEMO-MIX-400", "temperature", 20, 32, "C", 28, False),
    ("DEMO/MIX-250-CUBE", "DEMO-MIX-250", "cube_strength", 25, 40, "MPa", 31, False),
    ("DEMO/MIX-300-CUBE", "DEMO-MIX-300", "cube_strength", 30, 45, "MPa", 36, False),
    ("DEMO/MIX-350-CUBE", "DEMO-MIX-350", "cube_strength", 35, 50, "MPa", 28, True),
    ("DEMO/MIX-400-CUBE", "DEMO-MIX-400", "cube_strength", 40, 55, "MPa", 42, False),
]

INVOICES = [
    ("INV-2026-0101", 0, -30, -15, 120, 1850, "DEMO/Invoice 0101 — 120 m³ C25/30"),
    ("INV-2026-0102", 1, -25, -10, 90, 1950, "DEMO/Invoice 0102 — 90 m³ C30/37"),
    ("INV-2026-0103", 2, -20, 20, 150, 2050, "DEMO/Invoice 0103 — 150 m³ C35/45"),
    ("INV-2026-0104", 3, -15, 30, 60, 2150, "DEMO/Invoice 0104 — 60 m³ C40/50"),
    ("INV-2026-0105", 4, -10, 40, 180, 1900, "DEMO/Invoice 0105 — 180 m³ C25/30"),
    ("INV-2026-0106", 5, 0, 30, 75, 2200, "DEMO/Invoice 0106 — 75 m³ C40/50"),
]


def seed_customers(api: Api) -> dict[str, str]:
    existing = api.get("/api/m1/customers")["customers"]
    ids: dict[str, str] = {}
    for name_en, name_ar, tax_no, limit, credit_days, tier in CUSTOMERS:
        row = find(existing, "nameEn", name_en)
        if row:
            ids[name_en] = row["id"]
            continue
        response = api.post(
            "/api/m1/customers",
            {
                "nameAr": name_ar,
                "nameEn": name_en,
                "taxId": tax_no,
                "phone": f"+20{1000000000 + len(ids):09d}",
                "email": f"demo{len(ids) + 1}@iconcrete.local",
                "address": "DEMO/Address — Cairo, Egypt",
                "priorityTier": tier,
                "creditDays": credit_days,
                "creditLimitEgp": str(limit),
                "plantId": PLANT_CAIRO if len(ids) % 2 == 0 else PLANT_GIZA,
            },
        )
        ids[name_en] = response["id"]
    print(f"customers: {len(ids)} DEMO records ensured")
    return ids


def seed_projects(api: Api, customers: dict[str, str]) -> dict[str, str]:
    existing = api.get("/api/projects")["projects"]
    ids: dict[str, str] = {}
    for code, name_en, name_ar, customer_index, location, plant in PROJECTS:
        row = find(existing, "code", code)
        if row:
            ids[code] = row["id"]
            continue
        name_en_customer = CUSTOMERS[customer_index][0]
        response = api.post(
            "/api/projects",
            {
                "customerId": customers[name_en_customer],
                "code": code,
                "nameAr": name_ar,
                "nameEn": name_en,
                "siteLocation": location,
                "plantId": plant,
                "status": "active",
                "startDate": days_ago(60),
                "endDate": days_ahead(180),
            },
        )
        ids[code] = response["project"]["id"]
    print(f"projects: {len(ids)} DEMO records ensured")
    return ids


def seed_materials(api: Api) -> dict[str, str]:
    existing = api.get("/api/inventory/materials")["materials"]
    ids: dict[str, str] = {}
    for code, name_ar, name_en, category, unit, bulk, minimum, maximum, reorder in MATERIALS:
        row = find(existing, "material_code", code)
        if row:
            ids[code] = row["id"]
            continue
        response = api.post(
            "/api/inventory/materials",
            {
                "plantId": PLANT_CAIRO,
                "materialCode": code,
                "nameAr": name_ar,
                "nameEn": name_en,
                "category": category,
                "unitOfMeasure": unit,
                "isBulk": bulk,
                "valuationMethod": "weighted_average",
                "minStockLevel": minimum,
                "maxStockLevel": maximum,
                "reorderPoint": reorder,
            },
        )
        ids[code] = response["material"]["id"]
    print(f"materials: {len(ids)} DEMO records ensured")
    return ids


def seed_purchase_receipts(api: Api, materials: dict[str, str]) -> int:
    existing = api.get("/api/inventory/purchase-orders")["purchaseOrders"]
    plans = [
        (
            "DEMO-PO-001",
            "SUP-001",
            [("DEMO-CEM-OPC", 120, 3800)],
            "DEMO/GRN-001",
            "DEMO/Cement receipt 120 ton @ 3,800 EGP/ton",
        ),
        (
            "DEMO-PO-002",
            "SUP-002",
            [("DEMO-GRV-10", 180, 650), ("DEMO-GRV-20", 150, 630)],
            "DEMO/GRN-002",
            "DEMO/Aggregate receipt 330 ton",
        ),
        (
            "DEMO-PO-003",
            "SUP-004",
            [("DEMO-ADM", 6000, 22)],
            "DEMO/GRN-003",
            "DEMO/Admixture receipt 6,000 liter @ 22 EGP/liter",
        ),
    ]
    receipts = {row["receipt_no"]: row for row in api.get("/api/inventory/goods-receipts")["goodsReceipts"]}
    created = 0
    for po_no, supplier_id, lines, receipt_no, note in plans:
        if receipt_no in receipts:
            continue
        order = find(existing, "po_no", po_no)
        if not order:
            response = api.post(
                "/api/inventory/purchase-orders",
                {
                    "plantId": PLANT_CAIRO,
                    "supplierId": supplier_id,
                    "poNo": po_no,
                    "expectedDeliveryAt": days_ago(7),
                    "items": [
                        {
                            "materialId": materials[code],
                            "quantityOrdered": quantity,
                            "unitPrice": price,
                            "taxRate": 14,
                            "discountPct": 0,
                        }
                        for code, quantity, price in lines
                    ],
                },
            )
            order = response["purchaseOrder"]
        if order["status"] == "draft":
            api.post(
                f"/api/inventory/purchase-orders/{order['id']}/confirm",
                {"reason": "DEMO/seed confirmation — supplier documents pending"},
            )
            order = find(api.get("/api/inventory/purchase-orders")["purchaseOrders"], "id", order["id"])
        if not order:
            raise RuntimeError(f"purchase order {po_no} could not be read back")
        if order["status"] not in ("confirmed", "partially_received"):
            raise RuntimeError(f"purchase order {po_no} is {order['status']}, cannot receive")
        if not order.get("items"):
            raise RuntimeError(f"purchase order {po_no} returned no lines")
        items = [
            {
                "poItemId": item["id"],
                "quantityReceived": item["quantity_ordered"],
                "unitCost": item["unit_price"],
                "lotNo": f"DEMO-LOT-{po_no[-3:]}-{index + 1}",
                "expiryDate": None,
                "weightInKg": item["quantity_ordered"] * 1000 if item["unit_of_measure"] == "ton" else None,
            }
            for index, item in enumerate(order["items"])
        ]
        response = api.post(
            "/api/inventory/goods-receipts",
            {"poId": order["id"], "receivedAt": datetime.now(timezone.utc).isoformat(), "receiptNo": receipt_no, "items": items},
        )
        receipt_id = response["goodsReceipt"]["id"]
        api.post(f"/api/inventory/goods-receipts/{receipt_id}/confirm", {"reason": note})
        created += 1
    total = len(api.get("/api/inventory/goods-receipts")["goodsReceipts"])
    print(f"goods_receipts: {total} total ({created} created this run)")
    return total


def seed_mix_designs(api: Api) -> dict[str, dict]:
    existing = api.get("/api/mix-designs")["designs"]
    designs: dict[str, dict] = {}
    for code, name_ar, name_en, strength, cement, sand, gravel10, gravel20, water, admix, target in MIXES:
        row = find(existing, "code", code)
        if row:
            designs[code] = row
            continue
        response = api.post(
            "/api/mix-designs",
            {
                "plantId": PLANT_CAIRO,
                "code": code,
                "nameAr": name_ar,
                "nameEn": name_en,
                "strengthClass": strength,
                "components": [
                    {"materialId": "MAT-001", "role": "cement", "qtyPerM3": cement, "unit": "kg", "moistureBasis": "dry"},
                    {"materialId": "MAT-002", "role": "sand", "qtyPerM3": sand, "unit": "kg", "moistureBasis": "dry"},
                    {"materialId": "MAT-003", "role": "coarse_10mm", "qtyPerM3": gravel10, "unit": "kg", "moistureBasis": "dry"},
                    {"materialId": "MAT-004", "role": "coarse_20mm", "qtyPerM3": gravel20, "unit": "kg", "moistureBasis": "dry"},
                    {"materialId": "MAT-006", "role": "water", "qtyPerM3": water, "unit": "kg", "moistureBasis": "dry"},
                    {"materialId": "MAT-005", "role": "admixture", "qtyPerM3": admix, "unit": "liter", "moistureBasis": "liquid"},
                ],
                "strengthTests": [
                    {
                        "ageDays": 28,
                        "targetMinMpa": target,
                        "sourceNote": "DEMO value — illustrative target only, not an ECP acceptance limit",
                    }
                ],
            },
        )
        designs[code] = response["design"]
    for code, design in list(designs.items()):
        detail = api.get(f"/api/mix-designs/{design['id']}")["design"]
        versions = detail.get("versions", [])
        if not versions:
            continue
        version = versions[0]
        if version["status"] == "draft":
            api.post(f"/api/mix-designs/{design['id']}/versions/{version['version_no']}/submit", {})
            version["status"] = "submitted"
        if version["status"] == "submitted":
            api.post(f"/api/mix-designs/{design['id']}/versions/{version['version_no']}/approve", {})
        designs[code] = detail
    print(f"mix_designs: {len(designs)} DEMO records ensured")
    return designs


def seed_quality(api: Api, designs: dict[str, dict]) -> int:
    existing = api.get("/api/quality/tests")["tests"]
    for key, mix_code, test_type, spec_min, spec_max, unit, result, deviation in QC_CASES:
        row = find(existing, "spec_source_note", key)
        design = designs[mix_code]
        version_id = design["versions"][0]["id"] if design.get("versions") else None
        if not row:
            sampled = days_ago(30 if test_type == "cube_strength" else 2)
            response = api.post(
                "/api/quality/tests",
                {
                    "plantId": PLANT_CAIRO,
                    "mixVersionId": version_id,
                    "testType": test_type,
                    "sampledAt": f"{sampled}T08:00:00.000Z",
                    "ageDays": 28 if test_type == "cube_strength" else None,
                    "requiredSpecimenCount": 3 if test_type == "cube_strength" else 1,
                    "specMin": spec_min,
                    "specMax": spec_max,
                    "specSourceNote": key,
                },
            )
            row = response["test"]
            if row["status"] == "sampled":
                amount = 3 if test_type == "cube_strength" else 1
                cast = days_ago(30) if test_type == "cube_strength" else days_ago(2)
                for specimen_no in range(1, amount + 1):
                    api.post(
                        f"/api/quality/tests/{row['id']}/specimens",
                        {"specimenNo": specimen_no, "castAt": f"{cast}T08:10:00.000Z", "curedUntil": None},
                    )
        detail = api.get(f"/api/quality/tests/{row['id']}")["test"]
        if detail.get("result_value") is None:
            tested_at = f"{days_ahead(0)}T10:00:00.000Z" if test_type != "cube_strength" else f"{days_ago(2)}T10:00:00.000Z"
            api.post(
                f"/api/quality/tests/{row['id']}/result",
                {
                    "resultValue": result,
                    "resultUnit": unit,
                    "testedAt": tested_at,
                    "ageDays": 28 if test_type == "cube_strength" else None,
                },
            )
        detail = api.get(f"/api/quality/tests/{row['id']}")["test"]
        if not detail.get("verified_at"):
            api.post(f"/api/quality/tests/{row['id']}/verify", {})
    total = len(api.get("/api/quality/tests")["tests"])
    print(f"quality_tests: {total} total (12 DEMO scenarios, 2 labeled deviations)")
    return total


def seed_fleet(api: Api) -> tuple[dict[str, dict], dict[str, str]]:
    existing = api.get("/api/fleet/trucks")["trucks"]
    trucks: dict[str, dict] = {}
    for index, plate in enumerate(("101", "102", "103", "104")):
        row = find(existing, "plate_no", plate)
        if row:
            trucks[plate] = row
            continue
        response = api.post(
            "/api/fleet/trucks",
            {
                "plantId": PLANT_CAIRO,
                "plateNo": plate,
                "capacityM3": (8, 10, 12, 8)[index],
                "mixerType": "drum",
                "odometerKm": (124500, 118000, 96500, 142000)[index],
                "ownership": "owned",
                "insuranceExpiresAt": days_ahead(180),
            },
        )
        trucks[plate] = response["truck"]
    drivers_existing = api.get("/api/fleet/drivers")["drivers"]
    drivers: dict[str, str] = {}
    driver_data = [
        ("DEMO-DRV-01", "Mahmoud Fathy", "DEMO-DL-101"),
        ("DEMO-DRV-02", "Hassan El-Sayed", "DEMO-DL-102"),
        ("DEMO-DRV-03", "Karim Abdelaziz", "DEMO-DL-103"),
        ("DEMO-DRV-04", "Tarek Mostafa", "DEMO-DL-104"),
    ]
    for employee_ref, name, licence in driver_data:
        row = find(drivers_existing, "employee_ref", employee_ref)
        if not row:
            response = api.post(
                "/api/fleet/drivers",
                {
                    "plantId": PLANT_CAIRO,
                    "employeeRef": employee_ref,
                    "fullName": name,
                    "phone": f"+2011{len(drivers) + 1}00000",
                    "licenceNo": licence,
                    "licenceClass": "heavy",
                    "licenceExpiresAt": days_ahead(365),
                },
            )
            row = response["driver"]
        drivers[employee_ref] = row["id"]
    print(f"trucks: {len(trucks)} ensured; drivers: {len(drivers)} ensured")
    return trucks, drivers


def seed_maintenance(api: Api, trucks: dict[str, dict]) -> int:
    existing = api.get("/api/fleet/maintenance")["maintenance"]
    plans = [
        ("101", "breakdown", "DEMO/Breakdown — hydraulic drum motor leak; truck stopped at site (open)"),
        ("102", "preventive", "DEMO/Preventive service due soon — next service at 120,000 km (open)"),
    ]
    for plate, kind, note in plans:
        if any(str(row.get("notes", "")).startswith(note.split(" —")[0]) for row in existing):
            continue
        api.post(
            "/api/fleet/maintenance",
            {
                "truckId": trucks[plate]["id"],
                "maintenanceType": kind,
                "odometerKm": trucks[plate].get("odometer_km") or 0,
                "notes": note,
            },
        )
    total = len(api.get("/api/fleet/maintenance")["maintenance"])
    print(f"maintenance: {total} total (1 breakdown + 1 preventive open)")
    return total


def seed_orders(api: Api, customers: dict[str, str], projects: dict[str, str]) -> int:
    existing = api.get("/api/orders")["orders"]
    desired_statuses = ["draft", "confirmed", "scheduled", "in_production", "delivered", "invoiced", "closed", "draft"]
    chain = ["draft", "confirmed", "scheduled", "in_production", "delivered", "invoiced", "closed"]
    for index, (code, name_en, name_ar, customer_index, location, plant) in enumerate(PROJECTS):
        order_no = f"DEMO-ORD-2026-{index + 1:03d}"
        row = find(existing, "order_no", order_no)
        if not row:
            customer_name = CUSTOMERS[customer_index][0]
            grade = ("C25/30 — 250 kg/m³", "C30/37 — 300 kg/m³", "C35/45 — 350 kg/m³", "C40/50 — 400 kg/m³")[index % 4]
            response = api.post(
                "/api/orders",
                {
                    "customerId": customers[customer_name],
                    "projectId": projects[code],
                    "orderNo": order_no,
                    "concreteGrade": f"DEMO/{grade}",
                    "quantityM3": str(60 + index * 15),
                    "unitPrice": str(1850 + index * 50),
                    "plantId": plant,
                    "deliveryDate": days_ahead(index - 3),
                    "pourWindowStart": "07:00",
                    "pourWindowEnd": "11:00",
                    "notes": f"DEMO/Order for {name_en} — distance and pour window recorded",
                },
            )
            row = response["order"]
        target_index = chain.index(desired_statuses[index])
        current_index = chain.index(row["status"]) if row["status"] in chain else -1
        while current_index < target_index:
            next_status = chain[current_index + 1]
            response = api.post(
                f"/api/orders/{row['id']}/transition",
                {"to": next_status, "note": "DEMO/seed lifecycle progression"},
            )
            row = response["order"]
            current_index += 1
    total = len(api.get("/api/orders")["orders"])
    print(f"orders: {total} total (8 DEMO orders across {len(set(desired_statuses))} lifecycle states)")
    return total


def seed_invoices(api: Api, customers: dict[str, str]) -> int:
    existing = api.get("/api/m1/invoices")["invoices"]
    created_ids: list[str] = []
    for invoice_no, customer_index, issue_offset, due_offset, quantity, price, description in INVOICES:
        row = find(existing, "invoiceNo", invoice_no)
        if row:
            created_ids.append(row["id"])
            continue
        customer_name = CUSTOMERS[customer_index][0]
        response = api.post(
            "/api/m1/invoices",
            {
                "customerId": customers[customer_name],
                "invoiceNo": invoice_no,
                "issueDate": days_ahead(issue_offset),
                "dueDate": days_ahead(due_offset),
                "plantId": PLANT_CAIRO,
                "taxPercent": 14,
                "retentionPercent": 0,
                "items": [
                    {
                        "quantity": quantity,
                        "unitPrice": price,
                        "descriptionAr": f"ديمو/خرسانة جاهزة — {quantity} م³",
                        "descriptionEn": description,
                    }
                ],
            },
        )
        created_ids.append(response["invoiceId"])
    for index, invoice_id in enumerate(created_ids):
        detail = next((row for row in api.get("/api/m1/invoices")["invoices"] if row["id"] == invoice_id), None)
        if not detail:
            continue
        if detail["status"] == "draft" and index != 5:
            api.post(f"/api/m1/invoices/{invoice_id}/post", {})
    payments = api.get("/api/m1/payments")["payments"]
    for index, invoice_id in enumerate(created_ids):
        detail = next((row for row in api.get("/api/m1/invoices")["invoices"] if row["id"] == invoice_id), None)
        if not detail or detail["status"] == "draft":
            continue
        reference = f"DEMO/PAY-{index + 1:03d}"
        if find(payments, "reference", reference):
            continue
        if index == 0:
            amount = detail["grandTotal"] - detail["paidAmount"]
        elif index in (1, 4):
            amount = round((detail["grandTotal"] - detail["paidAmount"]) * 0.45, 2)
        else:
            continue
        if amount <= 0:
            continue
        customer_name = CUSTOMERS[INVOICES[index][1]][0]
        api.post(
            "/api/m1/payments",
            {
                "customerId": customers[customer_name],
                "amount": amount,
                "method": "bank",
                "paymentDate": days_ahead(0),
                "reference": reference,
            },
        )
    total = len(api.get("/api/m1/invoices")["invoices"])
    print(f"invoices: {total} total; DEMO invoices: {len(created_ids)}")
    return total


def main() -> int:
    if not PASSWORD:
        print("ICONCRETE_ADMIN_PASSWORD is required", file=sys.stderr)
        return 2
    api = Api()
    api.login()
    customers = seed_customers(api)
    projects = seed_projects(api, customers)
    materials = seed_materials(api)
    seed_purchase_receipts(api, materials)
    designs = seed_mix_designs(api)
    seed_quality(api, designs)
    trucks, _drivers = seed_fleet(api)
    seed_maintenance(api, trucks)
    seed_orders(api, customers, projects)
    seed_invoices(api, customers)
    print(f"seed_writes: {api.writes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
