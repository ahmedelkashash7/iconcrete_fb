#!/usr/bin/env python3
"""Idempotent M12 demo seed.

Creates three DEMO mix designs with the plant's real DEMO material masters, produces one
completed 6 m³ batch per mix/order, records aggregate moisture, then asks the cost engine
to recompute. Every write goes through the existing HTTP APIs, so rules/RLS/audit apply.

Required: DEMO_ADMIN_PASSWORD. Optional: ICONCRETE_URL, ICONCRETE_COMPANY, ICONCRETE_ADMIN_USER.
The script never prints the password and never writes it to disk.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("ICONCRETE_URL", "https://iconcrete-fb.onrender.com").rstrip("/")
COMPANY = os.environ.get("ICONCRETE_COMPANY", "IConcrete Demo Company")
USERNAME = os.environ.get("ICONCRETE_ADMIN_USER", "admin")
PASSWORD = os.environ["DEMO_ADMIN_PASSWORD"]

MIXES = [
    {
        "code": "M12-DEMO-250",
        "name_ar": "ديمو M12 / خلطة 250",
        "name_en": "M12 DEMO / Mix 250",
        "strength": "C25/30",
        "components": [
            ("DEMO-CEM-OPC", "cement", 250, "kg"),
            ("DEMO-SAND", "sand", 780, "kg"),
            ("DEMO-GRV-10", "coarse_10mm", 520, "kg"),
            ("DEMO-GRV-20", "coarse_20mm", 520, "kg"),
            ("DEMO-WTR", "water", 160, "L"),
            ("DEMO-ADM", "admixture", 4.5, "L"),
        ],
    },
    {
        "code": "M12-DEMO-300",
        "name_ar": "ديمو M12 / خلطة 300",
        "name_en": "M12 DEMO / Mix 300",
        "strength": "C30/37",
        "components": [
            ("DEMO-CEM-OPC", "cement", 300, "kg"),
            ("DEMO-SAND", "sand", 760, "kg"),
            ("DEMO-GRV-10", "coarse_10mm", 510, "kg"),
            ("DEMO-GRV-20", "coarse_20mm", 510, "kg"),
            ("DEMO-WTR", "water", 165, "L"),
            ("DEMO-ADM", "admixture", 5.0, "L"),
        ],
    },
    {
        "code": "M12-DEMO-350",
        "name_ar": "ديمو M12 / خلطة 350",
        "name_en": "M12 DEMO / Mix 350",
        "strength": "C35/45",
        "components": [
            ("DEMO-CEM-OPC", "cement", 350, "kg"),
            ("DEMO-SAND", "sand", 740, "kg"),
            ("DEMO-GRV-10", "coarse_10mm", 500, "kg"),
            ("DEMO-GRV-20", "coarse_20mm", 500, "kg"),
            ("DEMO-WTR", "water", 170, "L"),
            ("DEMO-ADM", "admixture", 5.5, "L"),
        ],
    },
]


class Api:
    def __init__(self) -> None:
        self.token = ""

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        data = None if body is None else json.dumps(body).encode()
        headers = {"content-type": "application/json"}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"error": "non_json_error"}
            return error.code, parsed

    def ok(self, method: str, path: str, body: dict | None = None) -> dict:
        status, payload = self.call(method, path, body)
        if status not in (200, 201):
            raise RuntimeError(f"{method} {path} -> {status} {payload.get('error', '')} {payload}")
        return payload


def main() -> int:
    api = Api()
    status, login = api.call(
        "POST",
        "/api/auth/login",
        {"company": COMPANY, "username": USERNAME, "password": PASSWORD},
    )
    if status != 200 or not login.get("token"):
        print("login failed", status, login.get("error"))
        return 1
    api.token = login["token"]
    print("login: 200")

    seeded = api.ok("POST", "/api/cost/seed-demo", {})
    print("cost settings:", json.dumps(seeded.get("seeded", {})))

    materials = api.ok("GET", "/api/inventory/materials").get("materials", [])
    by_code = {row.get("material_code"): row for row in materials if row.get("material_code")}
    required = ["DEMO-CEM-OPC", "DEMO-SAND", "DEMO-GRV-10", "DEMO-GRV-20", "DEMO-WTR", "DEMO-ADM"]
    missing = [code for code in required if code not in by_code]
    if missing:
        print("missing demo material masters:", ", ".join(missing))
        return 2

    designs = api.ok("GET", "/api/mix-designs").get("designs", [])
    design_by_code = {row.get("code"): row for row in designs}
    board = api.ok("GET", "/api/trips")
    orders = [row for row in board.get("orders", []) if float(row.get("remaining_m3") or 0) >= 6]
    if len(orders) < 3:
        print("not enough demo orders with 6 m³ remaining:", len(orders))
        return 3
    batches = api.ok("GET", "/api/batches").get("batches", [])
    existing_batches = {row.get("batch_no"): row for row in batches}

    created = 0
    specs = []
    for index, definition in enumerate(MIXES):
        design = design_by_code.get(definition["code"])
        if design:
            design = api.ok("GET", f"/api/mix-designs/{design['id']}")["design"]
        if not design:
            components = [
                {
                    "materialId": by_code[code]["id"],
                    "role": role,
                    "qtyPerM3": qty,
                    "unit": unit,
                    "moistureBasis": "dry" if unit == "kg" else "liquid",
                }
                for code, role, qty, unit in definition["components"]
            ]
            payload = api.ok(
                "POST",
                "/api/mix-designs",
                {
                    "plantId": "PLT-0001",
                    "code": definition["code"],
                    "nameAr": definition["name_ar"],
                    "nameEn": definition["name_en"],
                    "strengthClass": definition["strength"],
                    "components": components,
                    "strengthTests": [{"ageDays": 28, "targetMinMpa": 25, "sourceNote": "DEMO M12 target"}],
                },
            )
            design_id = payload["design"]["id"]
            detail = api.ok("GET", f"/api/mix-designs/{design_id}")["design"]
            version = detail["versions"][0]
            api.ok("POST", f"/api/mix-designs/{design_id}/versions/{version['version_no']}/submit", {})
            api.ok("POST", f"/api/mix-designs/{design_id}/versions/{version['version_no']}/approve", {})
            design = api.ok("GET", f"/api/mix-designs/{design_id}")["design"]
            design_by_code[definition["code"]] = design
            print("mix created:", definition["code"], design["id"])

        batch_no = f"M12-DEMO-{index + 1:02d}"
        existing = existing_batches.get(batch_no)
        if existing and existing.get("status") == "completed":
            print("batch already completed:", batch_no)
            continue
        order = orders[index]
        version = next(v for v in design["versions"] if v["status"] == "approved")
        components = [
            {
                "materialId": by_code[code]["id"],
                "targetWeight": qty * 6,
                "actualWeight": round(qty * 6 * (1.012 if role != "water" else 1.0), 3),
                "unit": unit,
            }
            for code, role, qty, unit in definition["components"]
        ]
        moistures = [
            {
                "materialId": by_code[code]["id"],
                "moisturePct": 4.5 if role == "sand" else 1.2,
            }
            for code, role, _qty, _unit in definition["components"]
            if role in ("sand", "coarse_10mm", "coarse_20mm")
        ]
        specs.append(
            {
                "batchNo": batch_no,
                "plantId": "PLT-0001",
                "orderId": order["id"],
                "mixVersionId": version["id"],
                "volume": 6,
                "components": components,
                "moistures": moistures,
            }
        )
        print("batch spec:", batch_no, "order", order.get("order_no"))

    seeded_batches = api.ok("POST", "/api/cost/seed-demo-batches", {"batches": specs})
    created = int(seeded_batches.get("seeded", {}).get("created", 0))
    recomputed = api.ok("POST", "/api/cost/recompute", {})
    dashboard = api.ok("GET", "/api/cost/dashboard")
    print("recomputed:", json.dumps(recomputed.get("recomputed", {})))
    print("dashboard:", json.dumps(dashboard.get("kpis", {})))
    print("created_batches:", created)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
