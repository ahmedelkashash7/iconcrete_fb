"""Pure calculation rules for the ICONCRETE Excel generator.

Every function mirrors a rule in the master specification (PART 4 / PART 5)
so the workbook formulas and the automated tests share one implementation.
No I/O, no global state: safe to unit test and safe to run in Google Colab.
"""

from __future__ import annotations

from typing import Iterable, Sequence

# Master specification PART 5 validation limits.
YIELD_MIN_M3 = 0.98
YIELD_MAX_M3 = 1.02

# Water/cement limits per exposure class (M2).
WC_LIMITS = {"XC1": 0.60, "XC4": 0.45, "XS2": 0.45, "XS3": 0.40}

# Rule 19: reclaimed water may not exceed 20% of design water.
RECLAIMED_WATER_MAX_RATIO = 0.20

# Rule 9: concrete age limit (minutes).
CONCRETE_AGE_LIMIT_MINUTES = 120
CONCRETE_AGE_WARNING_MINUTES = 90
CONCRETE_AGE_CRITICAL_MINUTES = 110


def absolute_volume(weight_kg: float, specific_gravity: float) -> float:
    """Absolute volume of an ingredient in m3: weight / (SG * 1000)."""
    if specific_gravity <= 0:
        raise ValueError("specific_gravity must be positive")
    if weight_kg < 0:
        raise ValueError("weight_kg must not be negative")
    return weight_kg / (specific_gravity * 1000.0)


def theoretical_yield(
    cement_kg: float,
    sand_kg: float,
    gravel_kg: float,
    water_l: float,
    air_percent: float,
    sg_cement: float,
    sg_sand: float,
    sg_gravel: float,
) -> float:
    """Sum of absolute volumes + entrained air, in m3 (must be 1.000 +/- 2%)."""
    return round(
        absolute_volume(cement_kg, sg_cement)
        + absolute_volume(sand_kg, sg_sand)
        + absolute_volume(gravel_kg, sg_gravel)
        + water_l / 1000.0
        + air_percent / 100.0,
        6,
    )


def yield_within_tolerance(yield_m3: float) -> bool:
    return YIELD_MIN_M3 <= yield_m3 <= YIELD_MAX_M3


def yield_correction_factor(yield_m3: float) -> float:
    """Correction factor that brings a mix back to 1.000 m3."""
    if yield_m3 <= 0:
        raise ValueError("yield_m3 must be positive")
    return round(1.0 / yield_m3, 4)


def wet_weight(dry_kg: float, moisture_percent: float) -> float:
    """Wet weight from dry weight and moisture percentage."""
    return round(dry_kg * (1.0 + moisture_percent / 100.0), 4)


def free_water_l(dry_kg: float, moisture_percent: float) -> float:
    """Free water contributed by an aggregate, in litres."""
    return round(dry_kg * (moisture_percent / 100.0), 4)


def corrected_mixing_water(
    design_water_l: float, aggregates: Iterable[tuple[float, float]]
) -> float:
    """Design water minus free water of every (dry_kg, moisture_percent) pair."""
    free_total = sum(free_water_l(dry_kg, moisture) for dry_kg, moisture in aggregates)
    return round(design_water_l - free_total, 4)


def water_conservation_variance(
    corrected_water_l: float, free_water_total_l: float, design_water_l: float
) -> float:
    """(corrected + free) - design; must stay below 0.5 litre (rule 5)."""
    return round((corrected_water_l + free_water_total_l) - design_water_l, 4)


def water_conservation_ok(variance_l: float) -> bool:
    return abs(variance_l) < 0.5


def wc_ratio(water_l: float, binder_kg: float) -> float:
    if binder_kg <= 0:
        raise ValueError("binder_kg must be positive")
    return round(water_l / binder_kg, 4)


def wc_limit(exposure_class: str) -> float:
    return WC_LIMITS.get(exposure_class.upper(), WC_LIMITS["XC1"])


def wc_within_limit(water_l: float, binder_kg: float, exposure_class: str) -> bool:
    return wc_ratio(water_l, binder_kg) <= wc_limit(exposure_class)


def reclaimed_water_ratio(reclaimed_l: float, design_water_l: float) -> float:
    if design_water_l <= 0:
        return 0.0
    return round(reclaimed_l / design_water_l, 4)


def reclaimed_water_ok(reclaimed_l: float, design_water_l: float) -> bool:
    return reclaimed_water_ratio(reclaimed_l, design_water_l) <= RECLAIMED_WATER_MAX_RATIO


def credit_available(credit_limit: float, outstanding: float) -> float:
    return round(credit_limit - outstanding, 2)


def credit_allows(credit_limit: float, outstanding: float, new_order_value: float) -> bool:
    return round(outstanding + new_order_value, 2) <= round(credit_limit, 2)


def weighted_average_cost(
    previous_qty: float, previous_cost: float, received_qty: float, received_cost: float
) -> float:
    """Weighted average unit cost after a receipt."""
    total_qty = previous_qty + received_qty
    if total_qty <= 0:
        return 0.0
    return round(((previous_qty * previous_cost) + (received_qty * received_cost)) / total_qty, 4)


def order_vat(subtotal: float, vat_percent: float) -> float:
    return round(subtotal * (vat_percent / 100.0), 2)


def order_grand_total(subtotal: float, vat_percent: float, pump_fee: float = 0.0) -> float:
    return round(subtotal + order_vat(subtotal, vat_percent) + pump_fee, 2)


def concrete_age_minutes(batching_started_at, now) -> int:
    """Age of a load in minutes (rule 9: warning 90, critical 110, limit 120)."""
    return int((now - batching_started_at).total_seconds() // 60)


def concrete_age_status(minutes: int) -> str:
    if minutes >= CONCRETE_AGE_LIMIT_MINUTES:
        return "REJECT"
    if minutes >= CONCRETE_AGE_CRITICAL_MINUTES:
        return "CRITICAL"
    if minutes >= CONCRETE_AGE_WARNING_MINUTES:
        return "WARNING"
    return "OK"


def slump_within_tolerance(actual_mm: float, target_mm: float) -> bool:
    return abs(actual_mm - target_mm) <= 25


def strength_7d_ok(strength_7d_mpa: float, fck_mpa: float) -> bool:
    return strength_7d_mpa >= 0.65 * fck_mpa


def strength_28d_ok(strength_28d_mpa: float, fck_mpa: float, margin_mpa: float = 2.0) -> bool:
    return strength_28d_mpa >= fck_mpa + margin_mpa


def concrete_temperature_ok(temperature_c: float) -> bool:
    return temperature_c <= 32.0


def depreciation_straight_line(cost: float, salvage: float, life_years: int) -> float:
    if life_years <= 0:
        raise ValueError("life_years must be positive")
    return round(max(cost - salvage, 0.0) / life_years, 2)


def loan_annuity_installment(principal: float, annual_rate: float, months: int) -> float:
    if months <= 0:
        raise ValueError("months must be positive")
    monthly_rate = annual_rate / 12.0
    if monthly_rate == 0:
        return round(principal / months, 2)
    factor = (1 + monthly_rate) ** months
    return round(principal * monthly_rate * factor / (factor - 1), 2)


def days_until(target_date, reference_date) -> int:
    return (target_date - reference_date).days


def license_alert(days_remaining: int) -> str:
    return "RENEW" if days_remaining <= 30 else "OK"


def sum_sq(values: Sequence[float]) -> float:
    return round(sum(value * value for value in values), 6)
