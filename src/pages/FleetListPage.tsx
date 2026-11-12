import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { MaintenanceModal } from '../components/MaintenanceModal';
import {
  Badge,
  Card,
  DataTable,
  ErrorNote,
  LoadingBlock,
  SectionTitle,
  type BadgeTone,
  type TableColumn,
} from '../components/ui';
import type { Lang } from '../types';

/**
 * M5 — fleet register. Trucks and drivers share the page; the driver tab is only fetched at
 * level 3 because a licence number is personal data (read 3+, export 4+). Retiring a truck is
 * level 5 and opening or closing maintenance is level 4, so the controls disappear rather than
 * fail after a click.
 */

interface Truck {
  id: string;
  plant_id: string;
  plate_no: string;
  capacity_m3: number;
  mixer_type: string;
  status: string;
  odometer_km: number | null;
  ownership: string;
  insurance_expires_at: string | null;
}

interface Driver {
  id: string;
  plant_id: string;
  employee_ref: string | null;
  full_name: string;
  phone: string | null;
  licence_no: string;
  licence_class: string | null;
  licence_expires_at: string | null;
  status: string;
}

const TRUCK_TONE: Record<string, BadgeTone> = {
  available: 'success',
  assigned: 'info',
  loading: 'info',
  en_route: 'info',
  at_site: 'warning',
  returning: 'warning',
  maintenance: 'warning',
  retired: 'neutral',
};

const TRUCK_STATUSES = ['available', 'assigned', 'loading', 'en_route', 'at_site', 'returning', 'maintenance', 'retired'];
const DRIVER_STATUSES = ['active', 'suspended', 'inactive'];

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.status === 503) return 'common.durableRequired';
    if (caught.code === 'invalid_transition') return 'fleet.err.invalidTransition';
  }
  return 'errors.network';
};

export const FleetListPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;
  const canReadDrivers = level >= 3;

  const [tab, setTab] = useState<'trucks' | 'drivers'>('trucks');
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [plantId, setPlantId] = useState('');
  const [truckStatus, setTruckStatus] = useState('');
  const [driverStatus, setDriverStatus] = useState('');
  const [licence, setLicence] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [maintenanceTruck, setMaintenanceTruck] = useState<Truck | null>(null);
  const [renewDriver, setRenewDriver] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState('');
  const [addMode, setAddMode] = useState<'truck' | 'driver' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [truckForm, setTruckForm] = useState({
    plantId: 'PLT-0001',
    plateNo: '',
    capacityM3: '8',
    mixerType: 'drum',
    odometerKm: '',
    ownership: 'owned',
    insuranceExpiresAt: '',
  });
  const [driverForm, setDriverForm] = useState({
    plantId: 'PLT-0001',
    employeeRef: '',
    fullName: '',
    phone: '',
    licenceNo: '',
    licenceClass: 'C',
    licenceExpiresAt: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const truckQuery = new URLSearchParams();
      if (plantId) truckQuery.set('plantId', plantId);
      if (truckStatus) truckQuery.set('status', truckStatus);
      const truckSuffix = truckQuery.toString() ? `?${truckQuery.toString()}` : '';
      const truckResponse = await apiFetch<{ trucks: Truck[] }>(`/api/fleet/trucks${truckSuffix}`);
      setTrucks(truckResponse.trucks);

      if (canReadDrivers) {
        const driverQuery = new URLSearchParams();
        if (plantId) driverQuery.set('plantId', plantId);
        if (driverStatus) driverQuery.set('status', driverStatus);
        const driverSuffix = driverQuery.toString() ? `?${driverQuery.toString()}` : '';
        const driverResponse = await apiFetch<{ drivers: Driver[] }>(`/api/fleet/drivers${driverSuffix}`);
        setDrivers(driverResponse.drivers);
      }
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [plantId, truckStatus, driverStatus, canReadDrivers]);

  useEffect(() => {
    void load();
  }, [load]);

  const plants = useMemo(() => {
    const seen = new Set<string>();
    for (const row of [...trucks, ...drivers]) seen.add(row.plant_id);
    return [...seen];
  }, [trucks, drivers]);

  const visibleDrivers = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return drivers.filter((driver) => {
      if (!licence) return true;
      const day = driver.licence_expires_at?.slice(0, 10) ?? '';
      if (!day) return licence === 'expired';
      return licence === 'expired' ? day < today : day >= today;
    });
  }, [drivers, licence]);

  const retire = async (truck: Truck) => {
    if (!window.confirm(t('fleet.confirmRetire'))) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/fleet/trucks/${encodeURIComponent(truck.id)}/retire`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveTruck = async () => {
    setFormError(null);
    const capacity = Number(truckForm.capacityM3);
    if (!truckForm.plateNo.trim() || !Number.isFinite(capacity) || capacity <= 0) {
      setFormError('fleet.err.required');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/fleet/trucks', {
        method: 'POST',
        body: JSON.stringify({
          plantId: truckForm.plantId,
          plateNo: truckForm.plateNo.trim(),
          capacityM3: capacity,
          mixerType: truckForm.mixerType,
          odometerKm: truckForm.odometerKm === '' ? null : Number(truckForm.odometerKm),
          ownership: truckForm.ownership,
          insuranceExpiresAt: truckForm.insuranceExpiresAt || null,
        }),
      });
      setAddMode(null);
      setTruckForm((current) => ({ ...current, plateNo: '', odometerKm: '', insuranceExpiresAt: '' }));
      await load();
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveDriver = async () => {
    setFormError(null);
    if (!driverForm.fullName.trim() || !driverForm.licenceNo.trim()) {
      setFormError('fleet.err.required');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/fleet/drivers', {
        method: 'POST',
        body: JSON.stringify({
          plantId: driverForm.plantId,
          employeeRef: driverForm.employeeRef.trim(),
          fullName: driverForm.fullName.trim(),
          phone: driverForm.phone.trim(),
          licenceNo: driverForm.licenceNo.trim(),
          licenceClass: driverForm.licenceClass,
          licenceExpiresAt: driverForm.licenceExpiresAt || null,
        }),
      });
      setAddMode(null);
      setDriverForm((current) => ({ ...current, employeeRef: '', fullName: '', phone: '', licenceNo: '', licenceExpiresAt: '' }));
      await load();
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveLicence = async () => {
    if (!renewDriver || !renewDate) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/fleet/drivers/${encodeURIComponent(renewDriver)}/licence`, {
        method: 'POST',
        body: JSON.stringify({ expiresAt: renewDate }),
      });
      setRenewDriver(null);
      setRenewDate('');
      await load();
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  const truckColumns: TableColumn<Truck>[] = [
    { key: 'plate_no', header: t('fleet.plate') },
    { key: 'plant_id', header: t('fleet.plant') },
    {
      key: 'capacity_m3',
      header: t('fleet.capacity'),
      align: 'end',
      render: (row) => `${row.capacity_m3} m³`,
    },
    {
      key: 'mixer_type',
      header: t('fleet.mixer'),
      render: (row) => t(`fleet.mixer.${row.mixer_type}`),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => <Badge tone={TRUCK_TONE[row.status] ?? 'neutral'}>{t(`fleet.status.${row.status}`)}</Badge>,
    },
    {
      key: 'odometer_km',
      header: t('fleet.odometer'),
      align: 'end',
      render: (row) => (row.odometer_km === null ? '—' : `${row.odometer_km.toLocaleString()} km`),
    },
    {
      key: 'ownership',
      header: t('fleet.ownership'),
      render: (row) => t(`fleet.ownership.${row.ownership}`),
    },
    {
      key: 'maintenance',
      header: t('fleet.maintenance'),
      render: (row) =>
        level >= 4 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || row.status === 'retired'}
            onClick={() => setMaintenanceTruck(row)}
          >
            {row.status === 'maintenance' ? t('fleet.closeMaintenance') : t('fleet.openMaintenance')}
          </button>
        ) : (
          <span className="muted">{t(`fleet.status.${row.status}`)}</span>
        ),
    },
    {
      key: 'id',
      header: '',
      render: (row) =>
        level >= 5 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy || row.status === 'retired'}
            onClick={() => void retire(row)}
          >
            {t('fleet.retire')}
          </button>
        ) : null,
    },
  ];

  const driverColumns: TableColumn<Driver>[] = [
    { key: 'full_name', header: t('fleet.driver') },
    { key: 'employee_ref', header: t('fleet.employeeRef'), render: (row) => row.employee_ref ?? '—' },
    { key: 'plant_id', header: t('fleet.plant') },
    { key: 'licence_no', header: t('fleet.licence') },
    { key: 'licence_class', header: t('fleet.licenceClass'), render: (row) => row.licence_class ?? '—' },
    {
      key: 'licence_expires_at',
      header: t('fleet.licenceExpiry'),
      render: (row) =>
        row.licence_expires_at === null ? (
          <Badge tone="danger">{t('fleet.expired')}</Badge>
        ) : (
          <span>{new Date(row.licence_expires_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</span>
        ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <Badge tone={row.status === 'active' ? 'success' : 'warning'}>{t(`fleet.driverStatus.${row.status}`)}</Badge>
      ),
    },
    {
      key: 'id',
      header: '',
      render: (row) =>
        level >= 4 ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setRenewDriver(row.id);
              setRenewDate(row.licence_expires_at?.slice(0, 10) ?? '');
            }}
          >
            {t('fleet.renewLicence')}
          </button>
        ) : null,
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={t('fleet.title')}
        subtitle={t('fleet.subtitle')}
        badge={<Badge tone="purple">{tab === 'trucks' ? trucks.length : visibleDrivers.length}</Badge>}
      />

      <Card>
        <div className="filters">
          <label className="field">
            <span>{t('fleet.view')}</span>
            <select value={tab} onChange={(event) => setTab(event.target.value as 'trucks' | 'drivers')}>
              <option value="trucks">{t('fleet.trucks')}</option>
              {canReadDrivers ? <option value="drivers">{t('fleet.drivers')}</option> : null}
            </select>
          </label>
          <label className="field">
            <span>{t('fleet.plant')}</span>
            <select value={plantId} onChange={(event) => setPlantId(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {plants.map((plant) => (
                <option key={plant} value={plant}>
                  {plant}
                </option>
              ))}
            </select>
          </label>
          {tab === 'trucks' ? (
            <label className="field">
              <span>{t('common.status')}</span>
              <select value={truckStatus} onChange={(event) => setTruckStatus(event.target.value)}>
                <option value="">{t('common.all')}</option>
                {TRUCK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`fleet.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                <span>{t('common.status')}</span>
                <select value={driverStatus} onChange={(event) => setDriverStatus(event.target.value)}>
                  <option value="">{t('common.all')}</option>
                  {DRIVER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {t(`fleet.driverStatus.${status}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('fleet.licenceExpiry')}</span>
                <select value={licence} onChange={(event) => setLicence(event.target.value)}>
                  <option value="">{t('common.all')}</option>
                  <option value="valid">{t('fleet.valid')}</option>
                  <option value="expired">{t('fleet.expired')}</option>
                </select>
              </label>
            </>
          )}
        </div>
        {level < 4 ? <p className="muted">{t('fleet.readOnly')}</p> : null}
        {level >= 4 ? (
          <div className="filters__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() => {
                setFormError(null);
                setAddMode('truck');
              }}
            >
              {t('fleet.addTruck')}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy}
              onClick={() => {
                setFormError(null);
                setAddMode('driver');
              }}
            >
              {t('fleet.addDriver')}
            </button>
          </div>
        ) : null}
      </Card>

      {addMode === 'truck' ? (
        <Card title={t('fleet.addTruck')}>
          {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}
          <div className="form-grid">
            <label className="field">
              <span>{t('fleet.plant')}</span>
              <select value={truckForm.plantId} onChange={(event) => setTruckForm({ ...truckForm, plantId: event.target.value })}>
                {plants.map((plant) => (
                  <option key={plant} value={plant}>{plant}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('fleet.plate')}</span>
              <input value={truckForm.plateNo} onChange={(event) => setTruckForm({ ...truckForm, plateNo: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.capacity')} (m³)</span>
              <input type="number" min="0" step="0.1" value={truckForm.capacityM3} onChange={(event) => setTruckForm({ ...truckForm, capacityM3: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.mixer')}</span>
              <select value={truckForm.mixerType} onChange={(event) => setTruckForm({ ...truckForm, mixerType: event.target.value })}>
                {['drum', 'rear_discharge', 'front_discharge', 'other'].map((type) => (
                  <option key={type} value={type}>{t(`fleet.mixer.${type}`)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('fleet.odometer')} (km)</span>
              <input type="number" min="0" value={truckForm.odometerKm} onChange={(event) => setTruckForm({ ...truckForm, odometerKm: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.ownership')}</span>
              <select value={truckForm.ownership} onChange={(event) => setTruckForm({ ...truckForm, ownership: event.target.value })}>
                {['owned', 'rented', 'leased'].map((type) => (
                  <option key={type} value={type}>{t(`fleet.ownership.${type}`)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('fleet.insuranceExpiry')}</span>
              <input type="date" value={truckForm.insuranceExpiresAt} onChange={(event) => setTruckForm({ ...truckForm, insuranceExpiresAt: event.target.value })} />
            </label>
          </div>
          <div className="filters__actions">
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveTruck()}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAddMode(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Card>
      ) : null}

      {addMode === 'driver' ? (
        <Card title={t('fleet.addDriver')}>
          {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}
          <div className="form-grid">
            <label className="field">
              <span>{t('fleet.plant')}</span>
              <select value={driverForm.plantId} onChange={(event) => setDriverForm({ ...driverForm, plantId: event.target.value })}>
                {plants.map((plant) => (
                  <option key={plant} value={plant}>{plant}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('fleet.driver')}</span>
              <input value={driverForm.fullName} onChange={(event) => setDriverForm({ ...driverForm, fullName: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.employeeRef')}</span>
              <input value={driverForm.employeeRef} onChange={(event) => setDriverForm({ ...driverForm, employeeRef: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.phone')}</span>
              <input value={driverForm.phone} onChange={(event) => setDriverForm({ ...driverForm, phone: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.licence')}</span>
              <input value={driverForm.licenceNo} onChange={(event) => setDriverForm({ ...driverForm, licenceNo: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.licenceClass')}</span>
              <input value={driverForm.licenceClass} onChange={(event) => setDriverForm({ ...driverForm, licenceClass: event.target.value })} />
            </label>
            <label className="field">
              <span>{t('fleet.licenceExpiry')}</span>
              <input type="date" value={driverForm.licenceExpiresAt} onChange={(event) => setDriverForm({ ...driverForm, licenceExpiresAt: event.target.value })} />
            </label>
          </div>
          <div className="filters__actions">
            <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void saveDriver()}>
              {t('common.save')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAddMode(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </Card>
      ) : null}

      {renewDriver ? (
        <Card title={t('fleet.renewLicence')}>
          <div className="filters">
            <label className="field">
              <span>{t('fleet.newExpiry')}</span>
              <input type="date" value={renewDate} onChange={(event) => setRenewDate(event.target.value)} />
            </label>
            <div className="filters__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={busy || !renewDate}
                onClick={() => void saveLicence()}
              >
                {t('common.save')}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRenewDriver(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        {tab === 'trucks' ? (
          <DataTable columns={truckColumns} rows={trucks} rowKey={(row) => row.id} empty={t('fleet.emptyTrucks')} />
        ) : canReadDrivers ? (
          <DataTable
            columns={driverColumns}
            rows={visibleDrivers}
            rowKey={(row) => row.id}
            empty={t('fleet.emptyDrivers')}
          />
        ) : (
          <p className="info-note info-note--warning">{t('fleet.driversRestricted')}</p>
        )}
      </Card>

      <MaintenanceModal
        truck={maintenanceTruck}
        open={maintenanceTruck !== null}
        onClose={() => setMaintenanceTruck(null)}
        onSaved={() => {
          setMaintenanceTruck(null);
          void load();
        }}
      />
    </div>
  );
};
