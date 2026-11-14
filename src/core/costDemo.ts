/**
 * M12 demo assumptions. These are not market facts: they are replaceable, dated demo
 * settings written into cost_settings with is_demo=true. The engine reads the table,
 * never this file, so editing the UI changes every subsequent calculation.
 */

export interface CostSettingDefault {
  key: string;
  value: number;
  unit: string;
  noteEn: string;
  noteAr: string;
}

export const COST_DEMO_SETTINGS: readonly CostSettingDefault[] = [
  {
    key: 'electricity_tariff',
    value: 3.1,
    unit: 'EGP/kWh',
    noteEn: 'DEMO industrial tariff assumption; replace with the plant bill.',
    noteAr: 'افتراض تجريبي لتعريفة الكهرباء الصناعية؛ استبدله بفاتورة المحطة.',
  },
  {
    key: 'kwh_per_m3',
    value: 18,
    unit: 'kWh/m3',
    noteEn: 'DEMO batching-plant consumption assumption.',
    noteAr: 'افتراض تجريبي لاستهلاك محطة الخلط.',
  },
  {
    key: 'fuel_price',
    value: 14.5,
    unit: 'EGP/L',
    noteEn: 'DEMO diesel price assumption; replace with the supplier price.',
    noteAr: 'افتراض تجريبي لسعر السولار؛ استبدله بسعر المورد.',
  },
  {
    key: 'fuel_l_per_m3',
    value: 1.2,
    unit: 'L/m3',
    noteEn: 'DEMO loader and generator diesel consumption per produced m³.',
    noteAr: 'افتراض تجريبي لاستهلاك اللودر والمولد لكل م³ منتج.',
  },
  {
    key: 'plant_crew_monthly',
    value: 180000,
    unit: 'EGP/month',
    noteEn: 'DEMO monthly batching crew cost; replace with payroll.',
    noteAr: 'افتراض تجريبي لتكلفة طاقم الخلط الشهرية؛ استبدلها بالرواتب.',
  },
  {
    key: 'plant_maintenance_monthly',
    value: 45000,
    unit: 'EGP/month',
    noteEn: 'DEMO fallback when the maintenance module has no posted cost for the month.',
    noteAr: 'افتراض تجريبي بديل عند عدم وجود تكلفة صيانة مرحّلة للشهر.',
  },
  {
    key: 'plant_asset_cost',
    value: 12000000,
    unit: 'EGP',
    noteEn: 'DEMO batching-plant asset value for straight-line depreciation.',
    noteAr: 'افتراض تجريبي لقيمة أصل محطة الخلط للإهلاك بالقسط الثابت.',
  },
  {
    key: 'plant_useful_life_months',
    value: 180,
    unit: 'months',
    noteEn: 'DEMO useful life: 15 years.',
    noteAr: 'افتراض تجريبي للعمر الإنتاجي: 15 سنة.',
  },
  {
    key: 'overhead_rent',
    value: 120000,
    unit: 'EGP/month',
    noteEn: 'DEMO plant rent allocation.',
    noteAr: 'افتراض تجريبي لتوزيع إيجار المحطة.',
  },
  {
    key: 'overhead_admin',
    value: 90000,
    unit: 'EGP/month',
    noteEn: 'DEMO plant administration salaries allocation.',
    noteAr: 'افتراض تجريبي لتوزيع رواتب الإدارة.',
  },
  {
    key: 'overhead_insurance',
    value: 35000,
    unit: 'EGP/month',
    noteEn: 'DEMO plant insurance allocation.',
    noteAr: 'افتراض تجريبي لتوزيع تأمين المحطة.',
  },
  {
    key: 'default_distance_km',
    value: 25,
    unit: 'km',
    noteEn: 'DEMO one-way distance when a trip has no measured distance.',
    noteAr: 'افتراض تجريبي للمسافة في اتجاه واحد عند غياب مسافة الرحلة.',
  },
  {
    key: 'truck_fuel_l_per_km',
    value: 0.35,
    unit: 'L/km',
    noteEn: 'DEMO mixer fuel consumption fallback.',
    noteAr: 'افتراض تجريبي بديل لاستهلاك الخلاطة.',
  },
  {
    key: 'truck_asset_cost',
    value: 4200000,
    unit: 'EGP',
    noteEn: 'DEMO mixer asset value for straight-line depreciation.',
    noteAr: 'افتراض تجريبي لقيمة أصل الخلاطة للإهلاك بالقسط الثابت.',
  },
  {
    key: 'truck_useful_life_months',
    value: 120,
    unit: 'months',
    noteEn: 'DEMO mixer useful life: 10 years.',
    noteAr: 'افتراض تجريبي للعمر الإنتاجي للخلاطة: 10 سنوات.',
  },
  {
    key: 'driver_salary_monthly',
    value: 18000,
    unit: 'EGP/month',
    noteEn: 'DEMO driver salary when the driver master has no salary.',
    noteAr: 'افتراض تجريبي لراتب السائق عند غياب الراتب في بيانات السائق.',
  },
  {
    key: 'driver_hourly_cost',
    value: 60,
    unit: 'EGP/hour',
    noteEn: 'DEMO driver cost used for waiting-time penalty.',
    noteAr: 'افتراض تجريبي لتكلفة السائق المستخدمة في غرامة وقت الانتظار.',
  },
  {
    key: 'driver_idle_l_per_hour',
    value: 3,
    unit: 'L/hour',
    noteEn: 'DEMO idling diesel burn while waiting to unload.',
    noteAr: 'افتراض تجريبي لاستهلاك السولار أثناء الانتظار للتفريغ.',
  },
  {
    key: 'wait_threshold_minutes',
    value: 30,
    unit: 'minutes',
    noteEn: 'DEMO operating threshold beyond which waiting cost is charged.',
    noteAr: 'افتراض تجريبي لحد التشغيل الذي تُحسب بعده تكلفة الانتظار.',
  },
  {
    key: 'yield_tolerance_pct',
    value: 2,
    unit: '%',
    noteEn: 'DEMO investigation trigger for yield variance.',
    noteAr: 'افتراض تجريبي لحد فحص انحراف الإنتاجية.',
  },
];

export interface CostMaterialDefault {
  code: string;
  pricePerBase: number;
  baseUnit: 'kg' | 'L';
  sourceUnit: string;
  source: string;
}

/** DEMO material price chain, already normalised to EGP/kg or EGP/L. */
export const COST_DEMO_MATERIALS: readonly CostMaterialDefault[] = [
  {
    code: 'DEMO-CEM-OPC',
    pricePerBase: 3.0,
    baseUnit: 'kg',
    sourceUnit: 'ton',
    source: 'DEMO 3,000 EGP/ton cement assumption (2,800–3,200 range requested).',
  },
  {
    code: 'DEMO-SAND',
    pricePerBase: 0.45,
    baseUnit: 'kg',
    sourceUnit: 'ton',
    source: 'DEMO 450 EGP/ton natural sand assumption.',
  },
  {
    code: 'DEMO-GRV-10',
    pricePerBase: 0.35,
    baseUnit: 'kg',
    sourceUnit: 'ton',
    source: 'DEMO 350 EGP/ton 10 mm aggregate assumption.',
  },
  {
    code: 'DEMO-GRV-20',
    pricePerBase: 0.35,
    baseUnit: 'kg',
    sourceUnit: 'ton',
    source: 'DEMO 350 EGP/ton 20 mm aggregate assumption.',
  },
  {
    code: 'DEMO-ADM',
    pricePerBase: 48,
    baseUnit: 'L',
    sourceUnit: 'liter',
    source: 'DEMO 48 EGP/L admixture assumption.',
  },
  {
    code: 'DEMO-WTR',
    pricePerBase: 0.015,
    baseUnit: 'L',
    sourceUnit: 'm3',
    source: 'DEMO 15 EGP/m³ mixing water assumption (0.015 EGP/L).',
  },
];
