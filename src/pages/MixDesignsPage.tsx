import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiFetch } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone, type TableColumn } from '../components/ui';
import { KNOWN_STRENGTH_CLASSES, MIX_MATERIALS } from '../core/mixDesign';
import type { Lang } from '../types';

/**
 * M2 — two screens over one route: the catalogue list, and the detail/create screen.
 *
 * Drafts are editable at level 4 and above; approve and supersede controls are disabled
 * below level 5 instead of failing after a click. Approved versions render read-only with
 * their checks, because the engine never lets an approved recipe be edited — a change
 * supersedes it and starts a new draft.
 */

interface PlantOption {
  id: string;
  name_ar: string;
  name_en: string;
}

interface MixComponent {
  id?: string;
  material_id: string;
  role: string;
  qty_per_m3: number;
  unit: string;
  moisture_basis: string;
}

interface MixStrengthTest {
  id?: string;
  age_days: number;
  target_min_mpa: number | null;
  source_note: string;
}

interface MixVersion {
  id: string;
  version_no: number;
  status: string;
  strength_class: string;
  notes: string;
  approved_by: string;
  approved_at: string | null;
  immutable: boolean;
  components: MixComponent[];
  strength_tests: MixStrengthTest[];
}

interface MixCheck {
  key: string;
  classification: string;
  outcome: string;
  reasonKey: string;
}

interface MixDesign {
  id: string;
  plant_id: string;
  plant_name_ar: string;
  plant_name_en: string;
  code: string;
  name_ar: string;
  name_en: string;
  current_version: number;
  version_count: number;
  approved_version: number;
  current_status: string;
  created_at: string;
}

interface MixDetail extends MixDesign {
  versions: MixVersion[];
  checks: MixCheck[];
}

interface RuleRow {
  code: string;
  classification: string;
  value_display: string;
  configured: boolean;
}

interface ComponentDraft {
  materialId: string;
  role: string;
  qtyPerM3: string;
  unit: string;
  moistureBasis: string;
}

interface TestDraft {
  ageDays: string;
  targetMinMpa: string;
  sourceNote: string;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  superseded: 'purple',
};

const OUTCOME_TONE: Record<string, BadgeTone> = {
  pass: 'success',
  failure: 'danger',
  approval_required: 'warning',
  warning: 'warning',
  engineering_hold: 'purple',
  override_required: 'purple',
};

const emptyComponent = (): ComponentDraft => ({
  materialId: MIX_MATERIALS[0]!.id,
  role: '',
  qtyPerM3: '',
  unit: 'kg',
  moistureBasis: '',
});

const emptyTest = (): TestDraft => ({ ageDays: '28', targetMinMpa: '', sourceNote: '' });

const apiMessage = (caught: unknown): string => {
  if (caught instanceof ApiError) {
    if (caught.status === 403) return 'errors.forbidden';
    if (caught.code === 'mandatory_failure') return 'mixDesigns.err.mandatoryFailure';
    if (caught.code === 'approval_required') return 'mixDesigns.err.approvalRequired';
    if (caught.code === 'invalid_transition') return 'mixDesigns.err.invalidTransition';
    if (caught.status === 409) return 'mixDesigns.err.conflict';
    if (caught.status === 422) return 'mixDesigns.err.validation';
    if (caught.status === 503) return 'common.durableRequired';
  }
  return 'errors.network';
};

export const MixDesignsPage = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const level = user?.role_level ?? 1;

  const [mode, setMode] = useState<'list' | 'create' | 'detail'>('list');
  const [rows, setRows] = useState<MixDesign[]>([]);
  const [plants, setPlants] = useState<PlantOption[]>([]);
  const [detail, setDetail] = useState<MixDetail | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [missingReference, setMissingReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');

  const [form, setForm] = useState({
    plantId: '',
    code: '',
    nameAr: '',
    nameEn: '',
    strengthClass: '',
    notes: '',
    components: [emptyComponent()] as ComponentDraft[],
    strengthTests: [emptyTest()] as TestDraft[],
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogue, ruleCatalogue] = await Promise.all([
        apiFetch<{ designs: MixDesign[]; plants: PlantOption[] }>('/api/mix-designs'),
        apiFetch<{ rules: RuleRow[]; missingReference: string }>('/api/rules?module=mix_design'),
      ]);
      setRows(catalogue.designs);
      setPlants(catalogue.plants);
      setRules(ruleCatalogue.rules);
      setMissingReference(ruleCatalogue.missingReference);
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ design: MixDetail }>(`/api/mix-designs/${encodeURIComponent(id)}`);
      const design = response.design;
      setDetail(design);
      const working =
        design.versions.find((version) => version.version_no === design.current_version) ?? design.versions[0];
      if (working) {
        setForm((previous) => ({
          ...previous,
          strengthClass: working.strength_class,
          notes: working.notes,
          components: working.components.map((component) => ({
            materialId: component.material_id,
            role: component.role,
            qtyPerM3: String(component.qty_per_m3),
            unit: component.unit,
            moistureBasis: component.moisture_basis,
          })),
          strengthTests: working.strength_tests.map((test) => ({
            ageDays: String(test.age_days),
            targetMinMpa: test.target_min_mpa === null ? '' : String(test.target_min_mpa),
            sourceNote: test.source_note,
          })),
        }));
      }
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'list') void loadList();
  }, [mode, loadList]);

  const openCreate = () => {
    setForm({
      plantId: plants[0]?.id ?? '',
      code: '',
      nameAr: '',
      nameEn: '',
      strengthClass: KNOWN_STRENGTH_CLASSES[4]!,
      notes: '',
      components: [emptyComponent()],
      strengthTests: [emptyTest()],
    });
    setFormError(null);
    setMode('create');
  };

  const openDetail = async (id: string) => {
    setFormError(null);
    setReason('');
    setMode('detail');
    await loadDetail(id);
  };

  const backToList = () => {
    setDetail(null);
    setFormError(null);
    setMode('list');
  };

  const payloadFromForm = () => ({
    plantId: form.plantId,
    code: form.code.trim(),
    nameAr: form.nameAr.trim(),
    nameEn: form.nameEn.trim(),
    strengthClass: form.strengthClass.trim(),
    notes: form.notes,
    components: form.components.map((component) => ({
      materialId: component.materialId,
      role: component.role.trim(),
      qtyPerM3: Number(component.qtyPerM3),
      unit: component.unit.trim() || 'kg',
      moistureBasis: component.moistureBasis.trim(),
    })),
    strengthTests: form.strengthTests.map((test) => ({
      ageDays: Number(test.ageDays),
      targetMinMpa: test.targetMinMpa === '' ? null : Number(test.targetMinMpa),
      sourceNote: test.sourceNote.trim(),
    })),
  });

  const submitCreate = async () => {
    if (!form.code.trim() || !form.plantId) {
      setFormError('mixDesigns.err.validation');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const response = await apiFetch<{ design: MixDesign }>('/api/mix-designs', {
        method: 'POST',
        body: JSON.stringify(payloadFromForm()),
      });
      await openDetail(response.design.id);
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const workingVersion = detail ? detail.versions.find((version) => version.version_no === detail.current_version) ?? null : null;

  const callAction = async (action: string, payload?: Record<string, unknown>) => {
    if (!detail || !workingVersion) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch(`/api/mix-designs/${encodeURIComponent(detail.id)}/versions/${workingVersion.version_no}/${action}`, {
        method: 'POST',
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      setReason('');
      await loadDetail(detail.id);
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!detail || !workingVersion) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch(`/api/mix-designs/${encodeURIComponent(detail.id)}/versions/${workingVersion.version_no}`, {
        method: 'PATCH',
        body: JSON.stringify(payloadFromForm()),
      });
      await loadDetail(detail.id);
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const deleteDesign = async () => {
    if (!detail) return;
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch(`/api/mix-designs/${encodeURIComponent(detail.id)}`, { method: 'DELETE' });
      backToList();
    } catch (caught) {
      setFormError(apiMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const componentColumns: TableColumn<ComponentDraft>[] = [
    {
      key: 'materialId',
      header: t('mixDesigns.material'),
      render: (row) => (
        <select
          value={row.materialId}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              components: previous.components.map((component) =>
                component === row ? { ...component, materialId: event.target.value } : component,
              ),
            }))
          }
        >
          {MIX_MATERIALS.map((material) => (
            <option key={material.id} value={material.id}>
              {lang === 'ar' ? material.nameAr : material.nameEn} ({material.code})
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'role',
      header: t('mixDesigns.role'),
      render: (row) => (
        <input
          value={row.role}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              components: previous.components.map((component) =>
                component === row ? { ...component, role: event.target.value } : component,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'qtyPerM3',
      header: t('mixDesigns.qty'),
      render: (row) => (
        <input
          inputMode="decimal"
          value={row.qtyPerM3}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              components: previous.components.map((component) =>
                component === row ? { ...component, qtyPerM3: event.target.value } : component,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'unit',
      header: t('mixDesigns.unit'),
      render: (row) => (
        <input
          value={row.unit}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              components: previous.components.map((component) =>
                component === row ? { ...component, unit: event.target.value } : component,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'moistureBasis',
      header: t('mixDesigns.moistureBasis'),
      render: (row) => (
        <input
          value={row.moistureBasis}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              components: previous.components.map((component) =>
                component === row ? { ...component, moistureBasis: event.target.value } : component,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() =>
            setForm((previous) => ({
              ...previous,
              components: previous.components.filter((component) => component !== row),
            }))
          }
        >
          {t('common.remove')}
        </button>
      ),
    },
  ];

  const testColumns: TableColumn<TestDraft>[] = [
    {
      key: 'ageDays',
      header: t('mixDesigns.ageDays'),
      render: (row) => (
        <input
          inputMode="numeric"
          value={row.ageDays}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              strengthTests: previous.strengthTests.map((test) =>
                test === row ? { ...test, ageDays: event.target.value } : test,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'targetMinMpa',
      header: t('mixDesigns.targetMpa'),
      render: (row) => (
        <input
          inputMode="decimal"
          value={row.targetMinMpa}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              strengthTests: previous.strengthTests.map((test) =>
                test === row ? { ...test, targetMinMpa: event.target.value } : test,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'sourceNote',
      header: t('mixDesigns.sourceNote'),
      render: (row) => (
        <input
          value={row.sourceNote}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              strengthTests: previous.strengthTests.map((test) =>
                test === row ? { ...test, sourceNote: event.target.value } : test,
              ),
            }))
          }
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() =>
            setForm((previous) => ({
              ...previous,
              strengthTests: previous.strengthTests.filter((test) => test !== row),
            }))
          }
        >
          {t('common.remove')}
        </button>
      ),
    },
  ];

  if (loading) return <LoadingBlock label={t('common.loading')} />;
  if (error) return <ErrorNote>{t(error)}</ErrorNote>;

  // ------------------------------------------------------------ screen 1: list
  if (mode === 'list') {
    const columns: TableColumn<MixDesign>[] = [
      { key: 'code', header: t('mixDesigns.code') },
      {
        key: 'name_ar',
        header: t('mixDesigns.name'),
        render: (row) => (lang === 'ar' ? row.name_ar || row.name_en : row.name_en || row.name_ar),
      },
      {
        key: 'plant_id',
        header: t('mixDesigns.plant'),
        render: (row) => (lang === 'ar' ? row.plant_name_ar : row.plant_name_en),
      },
      { key: 'current_version', header: t('mixDesigns.version'), align: 'end' },
      {
        key: 'current_status',
        header: t('mixDesigns.status'),
        render: (row) => (
          <Badge tone={STATUS_TONE[row.current_status] ?? 'neutral'}>
            {t(`mixDesigns.status.${row.current_status}`)}
          </Badge>
        ),
      },
      {
        key: 'id',
        header: '',
        render: (row) => (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openDetail(row.id)}>
            {t('mixDesigns.open')}
          </button>
        ),
      },
    ];

    return (
      <div className="page-stack">
        <SectionTitle
          title={t('mixDesigns.title')}
          subtitle={t('mixDesigns.subtitle')}
          badge={<Badge tone="purple">{rows.length}</Badge>}
        />
        <Card
          actions={
            <button type="button" className="btn btn--primary btn--sm" onClick={openCreate} disabled={level < 4}>
              {t('mixDesigns.create')}
            </button>
          }
        >
          <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty={t('mixDesigns.empty')} />
          {level < 4 ? <InfoNote>{t('mixDesigns.readOnly')}</InfoNote> : null}
        </Card>
      </div>
    );
  }

  // ------------------------------------------------- screen 2: create / detail
  const createMode = mode === 'create';
  const status = createMode ? 'draft' : (detail?.current_status ?? 'draft');
  const editable = createMode || status === 'draft';

  const formCard = (
    <Card
      actions={
        <div className="filters__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void (createMode ? submitCreate() : saveDraft())}
            disabled={saving || level < 4 || !editable}
          >
            {saving ? t('common.loading') : createMode ? t('mixDesigns.create') : t('common.save')}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={createMode ? backToList : backToList}>
            {t('mixDesigns.back')}
          </button>
        </div>
      }
    >
      <div className="filters">
        <label className="field">
          <span>{t('mixDesigns.code')}</span>
          <input
            value={form.code}
            disabled={!createMode}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
        </label>
        <label className="field field--grow">
          <span>{t('mixDesigns.name')} (AR)</span>
          <input
            value={form.nameAr}
            dir="rtl"
            onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
          />
        </label>
        <label className="field field--grow">
          <span>{t('mixDesigns.name')} (EN)</span>
          <input
            value={form.nameEn}
            dir="ltr"
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{t('mixDesigns.plant')}</span>
          <select
            value={form.plantId}
            disabled={!createMode}
            onChange={(event) => setForm({ ...form, plantId: event.target.value })}
          >
            <option value="">{t('mixDesigns.pickPlant')}</option>
            {plants.map((plant) => (
              <option key={plant.id} value={plant.id}>
                {lang === 'ar' ? plant.name_ar : plant.name_en}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('mixDesigns.strengthClass')}</span>
          <select
            value={form.strengthClass}
            onChange={(event) => setForm({ ...form, strengthClass: event.target.value })}
          >
            <option value="">{t('mixDesigns.pickStrengthClass')}</option>
            {KNOWN_STRENGTH_CLASSES.map((grade) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--grow">
          <span>{t('mixDesigns.notes')}</span>
          <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
      </div>

      <SectionTitle title={t('mixDesigns.components')} />
      <DataTable
        columns={componentColumns}
        rows={form.components}
        rowKey={(_row, index) => `component-${index}`}
        empty={t('mixDesigns.noComponents')}
      />
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setForm({ ...form, components: [...form.components, emptyComponent()] })}
      >
        {t('mixDesigns.addComponent')}
      </button>

      <SectionTitle title={t('mixDesigns.strengthTests')} />
      <DataTable
        columns={testColumns}
        rows={form.strengthTests}
        rowKey={(_row, index) => `test-${index}`}
        empty={t('mixDesigns.noTests')}
      />
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setForm({ ...form, strengthTests: [...form.strengthTests, emptyTest()] })}
      >
        {t('mixDesigns.addTest')}
      </button>

      {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}
    </Card>
  );

  if (createMode) {
    return (
      <div className="page-stack">
        <SectionTitle title={t('mixDesigns.createTitle')} subtitle={t('mixDesigns.createSubtitle')} />
        {formCard}
      </div>
    );
  }

  if (!detail) return <ErrorNote>{t('errors.network')}</ErrorNote>;

  const versionColumns: TableColumn<MixVersion>[] = [
    { key: 'version_no', header: t('mixDesigns.version'), align: 'end' },
    {
      key: 'status',
      header: t('mixDesigns.status'),
      render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t(`mixDesigns.status.${row.status}`)}</Badge>,
    },
    { key: 'strength_class', header: t('mixDesigns.strengthClass') },
    {
      key: 'approved_by',
      header: t('mixDesigns.approvedBy'),
      render: (row) => row.approved_by || '—',
    },
  ];

  return (
    <div className="page-stack">
      <SectionTitle
        title={`${detail.code} — ${lang === 'ar' ? detail.name_ar : detail.name_en}`}
        subtitle={t('mixDesigns.detailSubtitle')}
        badge={<Badge tone="purple">{t(`mixDesigns.status.${detail.current_status}`)}</Badge>}
      />

      <Card actions={<button type="button" className="btn btn--ghost btn--sm" onClick={backToList}>{t('mixDesigns.back')}</button>}>
        <DataTable columns={versionColumns} rows={detail.versions} rowKey={(row) => row.id} empty={t('mixDesigns.noVersions')} />
      </Card>

      {formCard}

      <Card>
        <SectionTitle title={t('mixDesigns.checks')} subtitle={t('mixDesigns.checksNote')} />
        {detail.checks.length === 0 ? (
          <InfoNote>{t('mixDesigns.noChecks')}</InfoNote>
        ) : (
          <ul className="check-list">
            {detail.checks.map((check) => (
              <li key={check.key}>
                <Badge tone={OUTCOME_TONE[check.outcome] ?? 'neutral'}>{t(`mixDesigns.outcome.${check.outcome}`)}</Badge>{' '}
                <strong>{t(`mixDesigns.check.${check.key}`)}</strong>{' '}
                <span className="muted">{t(`mixDesigns.class.${check.classification}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title={t('mixDesigns.rulesTitle')} subtitle={t('mixDesigns.rulesNote')} />
        <DataTable
          columns={[
            { key: 'code', header: t('mixDesigns.code') },
            {
              key: 'classification',
              header: t('mixDesigns.classification'),
              render: (row: RuleRow) => t(`mixDesigns.class.${row.classification}`),
            },
            {
              key: 'value_display',
              header: t('mixDesigns.value'),
              render: (row: RuleRow) => (row.configured ? row.value_display : `${row.value_display}`),
            },
            {
              key: 'configured',
              header: t('mixDesigns.state'),
              render: (row: RuleRow) =>
                row.configured ? (
                  <Badge tone="success">{t('mixDesigns.configured')}</Badge>
                ) : (
                  <Badge tone="warning">{t('mixDesigns.configurable')}</Badge>
                ),
            },
          ]}
          rows={rules}
          rowKey={(row) => row.code}
          empty={t('mixDesigns.noRules')}
        />
        <InfoNote>{t('mixDesigns.rulesHint')}</InfoNote>
        <p className="muted">{missingReference}</p>
      </Card>

      <Card>
        <SectionTitle title={t('mixDesigns.actions')} />
        <div className="filters__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void callAction('submit')}
            disabled={saving || level < 4 || status !== 'draft'}
          >
            {t('mixDesigns.submit')}
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void callAction('approve')}
            disabled={saving || level < 5 || status !== 'submitted'}
            title={level < 5 ? t('mixDesigns.approveHint') : undefined}
          >
            {t('mixDesigns.approve')}
          </button>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => void callAction('supersede', { reason })}
            disabled={saving || level < 5 || status !== 'approved' || reason.trim().length < 5}
            title={level < 5 ? t('mixDesigns.approveHint') : undefined}
          >
            {t('mixDesigns.supersede')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void deleteDesign()}
            disabled={saving || level < 4 || detail.approved_version > 0}
          >
            {t('mixDesigns.delete')}
          </button>
        </div>
        <label className="field field--grow">
          <span>{t('mixDesigns.reason')}</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('mixDesigns.reasonHint')} />
        </label>
        {status !== 'draft' ? <InfoNote tone="warning">{t('mixDesigns.immutable')}</InfoNote> : null}
        {level < 4 ? <InfoNote>{t('mixDesigns.readOnly')}</InfoNote> : null}
        {formError ? <ErrorNote>{t(formError)}</ErrorNote> : null}
      </Card>
    </div>
  );
};
