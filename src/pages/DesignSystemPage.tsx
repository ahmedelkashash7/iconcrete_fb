import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card, DataTable, ErrorNote, InfoNote, LoadingBlock, SectionTitle, type BadgeTone } from '../components/ui';
import { CONTRAST_PAIRS, PALETTE, TOKENS } from '../lib/designTokens';
import { contrastRatio, formatRatio, wcagGrade } from '../lib/contrast';
import type { Lang } from '../types';

const BADGE_TONES: BadgeTone[] = ['neutral', 'success', 'danger', 'warning', 'info', 'purple'];

const SAMPLE_ROWS = [
  { id: 'CUST-0001', nameAr: 'شركة المقاولات المتحدة للتشييد والبناء', nameEn: 'United Contracting & Construction', limit: '250,000.00', status: 'active' },
  { id: 'CUST-0002', nameAr: 'مؤسسة النيل للأعمال المدنية', nameEn: 'Nile Civil Works', limit: '90,000.00', status: 'on_hold' },
];

export const DesignSystemPage = () => {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language === 'en' ? 'en' : 'ar';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [invalid, setInvalid] = useState(true);
  const [sectionDir, setSectionDir] = useState<'rtl' | 'ltr'>('rtl');
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const tokenRows = useMemo(
    () =>
      TOKENS.map((token) => {
        const ratio = contrastRatio(token.hex, PALETTE.surface);
        return { ...token, ratio, grade: wcagGrade(ratio, true) };
      }),
    [],
  );

  const pairRows = useMemo(
    () =>
      CONTRAST_PAIRS.map((pair) => {
        const ratio = contrastRatio(PALETTE[pair.fg], PALETTE[pair.bg]);
        return {
          ...pair,
          ratio,
          pass: ratio >= pair.min,
          label: lang === 'ar' ? pair.pairAr : pair.pairEn,
        };
      }),
    [lang],
  );

  return (
    <>
      <SectionTitle
        title={lang === 'ar' ? 'نظام التصميم' : 'Design system'}
        subtitle={
          lang === 'ar'
            ? 'لوحة الألوان المقفلة من المواصفة §1، ونسب التباين المحسوبة، ومكونات الواجهة في العربية والإنجليزية.'
            : 'The locked palette from spec §1, computed contrast ratios, and every UI component in Arabic and English.'
        }
        badge={<Badge tone="purple">{lang === 'ar' ? 'مرجع حي' : 'Living reference'}</Badge>}
      />

      <Card
        title={lang === 'ar' ? 'لوحة الألوان المقفلة (§1)' : 'Locked palette (§1)'}
        subtitle={
          lang === 'ar'
            ? 'كل لون مقابل سطحة الأبيض. النسبة محسوبة في وقت العرض بنفس كود الاختبار.'
            : 'Every colour against the white surface. Ratios are computed at render time with the same code the test uses.'
        }
      >
        <div className="table-wrap table-wrap--dense">
          <table className="data-table">
            <thead>
              <tr>
                <th>{lang === 'ar' ? 'اللون' : 'Token'}</th>
                <th>{lang === 'ar' ? 'القيمة' : 'Hex'}</th>
                <th>{lang === 'ar' ? 'على الأبيض' : 'On white'}</th>
                <th>{lang === 'ar' ? 'التقييم' : 'Grade'}</th>
                <th>{lang === 'ar' ? 'الاستخدام' : 'Usage'}</th>
              </tr>
            </thead>
            <tbody>
              {tokenRows.map((token) => (
                <tr key={token.key}>
                  <td>
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        background: token.hex,
                        border: '1px solid #CBD5E1',
                        verticalAlign: 'middle',
                        marginInlineEnd: 8,
                      }}
                    />
                    <span className="mono">{token.key}</span>
                  </td>
                  <td className="mono">{token.hex}</td>
                  <td className="mono">{formatRatio(token.ratio)}</td>
                  <td>
                    <Badge tone={token.ratio >= 4.5 ? 'success' : token.ratio >= 3 ? 'warning' : 'neutral'}>
                      {token.grade}
                    </Badge>
                  </td>
                  <td className="small">{lang === 'ar' ? token.usageAr : token.usageEn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field__hint">
          {lang === 'ar'
            ? 'الألوان الثانوية والنجاح والتحذير لا تُستخدم كنص عادي على الأبيض: النجاح 3.30:1 والتحذير 2.15:1، لذلك تُستخدم كخلفيات مصبوغة أو علامات غير نصية فقط.'
            : 'Secondary, success and warning are not used as normal text on white: success is 3.30:1 and warning 2.15:1, so they appear as tinted backgrounds or non-text markers only.'}
        </p>
      </Card>

      <Card
        title={lang === 'ar' ? 'عقد التباين (§60)' : 'Contrast contract (§60)'}
        subtitle={
          lang === 'ar'
            ? 'كل زوج له هدف WCAG محدد؛ الاختبار tests/design.tokens.test.ts يفشل إذا انخفض أي زوج.'
            : 'Each pair declares a WCAG target; tests/design.tokens.test.ts fails if any pair drops.'
        }
      >
        <DataTable
          dense
          rows={pairRows}
          rowKey={(row) => `${row.fg}-${row.bg}-${row.kind}`}
          empty={lang === 'ar' ? 'لا توجد أزواج' : 'No pairs'}
          columns={[
            { key: 'label', header: lang === 'ar' ? 'الزوج' : 'Pair' },
            { key: 'kind', header: lang === 'ar' ? 'النوع' : 'Kind', render: (row) => <span className="mono small">{row.kind}</span> },
            { key: 'ratio', header: lang === 'ar' ? 'النسبة' : 'Ratio', render: (row) => <span className="mono">{formatRatio(row.ratio)}</span> },
            { key: 'min', header: lang === 'ar' ? 'الهدف' : 'Target', render: (row) => <span className="mono">{row.min}:1</span> },
            {
              key: 'pass',
              header: lang === 'ar' ? 'النتيجة' : 'Result',
              render: (row) => <Badge tone={row.pass ? 'success' : 'danger'}>{row.pass ? (lang === 'ar' ? 'ناجح' : 'PASS') : lang === 'ar' ? 'فاشل' : 'FAIL'}</Badge>,
            },
          ]}
        />
      </Card>

      <Card title={lang === 'ar' ? 'الطباعة' : 'Typography'} subtitle={lang === 'ar' ? 'Cairo للعربية، Inter للإنجليزية' : 'Cairo for Arabic, Inter for English'}>
        <div className="stack">
          <p style={{ fontSize: 28, fontWeight: 800 }}>ICONCRETE — نظام إدارة الخرسانة الجاهزة</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>H1 · 20px bold — تقرير الرصيد العام</p>
          <p style={{ fontSize: 16, fontWeight: 700 }}>H2 · 16px bold — General balance</p>
          <p>Body · 14px — يُحدَّث المخزون تلقائيًا عند اعتماد أمر التشغيل.</p>
          <p className="muted small">Small / muted · 12px — آخر تحديث 2026-11-02 09:15</p>
          <p className="mono">Mono · 12px — INV-2026-000042 · 1,250.00 EGP</p>
        </div>
      </Card>

      <Card title={lang === 'ar' ? 'الأزرار' : 'Buttons'} subtitle={lang === 'ar' ? 'أحجام وحالات، مع حلقة تركيز ظاهرة' : 'Sizes and states, with a visible focus ring'}>
        <div className="filters">
          <div className="filters__actions">
            <button type="button" className="btn btn--primary">حفظ / Save</button>
            <button type="button" className="btn btn--ghost">إلغاء / Cancel</button>
            <button type="button" className="btn btn--danger">حذف / Delete</button>
            <button type="button" className="btn btn--primary btn--sm">صغير / Small</button>
          </div>
          <div className="filters__actions">
            <button type="button" className="btn btn--primary" disabled>
              معطل / Disabled
            </button>
            <button type="button" className="btn btn--ghost" aria-busy="true">
              <span className="spinner" aria-hidden="true" /> جارٍ / Busy
            </button>
            <a className="btn btn--ghost" href="#/designSystem">
              رابط / Link
            </a>
          </div>
        </div>
        <p className="field__hint">
          {lang === 'ar' ? 'اضغط Tab للتحقق من حلقة التركيز على كل عنصر.' : 'Press Tab to verify the focus ring on each control.'}
        </p>
      </Card>

      <Card title={lang === 'ar' ? 'الحقول' : 'Inputs'} subtitle={lang === 'ar' ? 'حالات عادية وخطأ ومعطل' : 'Default, invalid and disabled'}>
        <div className="filters">
          <label className="field">
            <span>{lang === 'ar' ? 'الاسم' : 'Name'}</span>
            <input type="text" defaultValue="شركة النيل" />
          </label>
          <label className="field">
            <span>{lang === 'ar' ? 'المحطة' : 'Plant'}</span>
            <select defaultValue="PLT-0001">
              <option value="PLT-0001">محطة القاهرة / Cairo plant</option>
              <option value="PLT-0002">محطة الجيزة / Giza plant</option>
            </select>
          </label>
          <label className="field">
            <span>{lang === 'ar' ? 'معطل' : 'Disabled'}</span>
            <input type="text" defaultValue="—" disabled />
          </label>
          <label className="field">
            <span>{lang === 'ar' ? 'حد الائتمان' : 'Credit limit'}</span>
            <input
              type="text"
              defaultValue="abc"
              aria-invalid={invalid}
              aria-describedby="ds-credit-error"
              onChange={() => setInvalid(false)}
            />
            {invalid ? (
              <small className="field__hint" id="ds-credit-error" role="alert" style={{ color: PALETTE.danger }}>
                {lang === 'ar' ? 'قيمة غير رقمية' : 'Not a number'}
              </small>
            ) : null}
          </label>
          <label className="field">
            <span>{lang === 'ar' ? 'ملاحظات' : 'Notes'}</span>
            <textarea rows={2} defaultValue={lang === 'ar' ? 'تسليم صباحي' : 'Morning delivery'} />
          </label>
        </div>
      </Card>

      <Card title={lang === 'ar' ? 'الشارات والتنبيهات' : 'Badges and alerts'}>
        <div className="filters__actions" style={{ marginBottom: 12 }}>
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </div>
        <div className="stack">
          <InfoNote tone="info">Info — {lang === 'ar' ? 'تم تحديث القائمة.' : 'List refreshed.'}</InfoNote>
          <InfoNote tone="warning">Warning — {lang === 'ar' ? 'الرصيد أقل من الحد الأدنى.' : 'Stock is below the reorder level.'}</InfoNote>
          <InfoNote tone="danger">Danger — {lang === 'ar' ? 'لا يمكن حذف عميل له فواتير.' : 'A customer with invoices cannot be deleted.'}</InfoNote>
          <InfoNote tone="purple">Notice — {lang === 'ar' ? 'تم الاعتماد بواسطة المدير.' : 'Approved by the manager.'}</InfoNote>
          <ErrorNote>{lang === 'ar' ? 'تعذر الاتصال بالخادم. حاول مرة أخرى.' : 'Could not reach the server. Try again.'}</ErrorNote>
        </div>
      </Card>

      <Card
        title={lang === 'ar' ? 'الجدول' : 'Table'}
        subtitle={lang === 'ar' ? 'تمرير أفقي عند ضيق الشاشة ونص عربي طويل' : 'Horizontal overflow on narrow screens and long Arabic labels'}
      >
        <DataTable
          rows={SAMPLE_ROWS}
          rowKey={(row) => row.id}
          empty={lang === 'ar' ? 'لا توجد بيانات' : 'No data'}
          columns={[
            { key: 'id', header: lang === 'ar' ? 'الكود' : 'ID', render: (row) => <span className="mono">{row.id}</span> },
            { key: 'nameAr', header: lang === 'ar' ? 'الاسم العربي' : 'Arabic name' },
            { key: 'nameEn', header: lang === 'ar' ? 'الاسم الإنجليزي' : 'English name' },
            { key: 'limit', header: lang === 'ar' ? 'حد الائتمان' : 'Credit limit', align: 'end', render: (row) => <span className="mono">{row.limit}</span> },
            { key: 'status', header: lang === 'ar' ? 'الحالة' : 'Status', render: (row) => <Badge tone={row.status === 'active' ? 'success' : 'warning'}>{row.status}</Badge> },
          ]}
        />
      </Card>

      <Card title={lang === 'ar' ? 'الحالات' : 'States'} subtitle={lang === 'ar' ? 'تحميل، فراغ، خطأ' : 'Loading, empty, error'}>
        <LoadingBlock label={lang === 'ar' ? 'جارٍ تحميل البيانات…' : 'Loading data…'} />
        <DataTable rows={[]} rowKey={() => 'x'} empty={lang === 'ar' ? 'لا توجد سجلات بعد' : 'No records yet'} columns={[{ key: 'id', header: 'ID' }]} />
        <ErrorNote>{lang === 'ar' ? 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.' : 'Your session expired. Sign in again.'}</ErrorNote>
      </Card>

      <Card
        title={lang === 'ar' ? 'نافذة الحوار' : 'Dialog'}
        subtitle={lang === 'ar' ? 'role="dialog" وaria-modal، وإغلاق بـ Escape' : 'role="dialog", aria-modal, Escape to close'}
      >
        <button type="button" className="btn btn--primary" onClick={() => setDialogOpen(true)}>
          {lang === 'ar' ? 'فتح حوار' : 'Open dialog'}
        </button>
        {dialogOpen ? (
          <div className="ds-dialog-backdrop" role="presentation" onClick={() => setDialogOpen(false)}>
            <div
              className="card ds-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ds-dialog-title"
              tabIndex={-1}
              ref={dialogRef}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setDialogOpen(false);
              }}
            >
              <header className="card__header">
                <h2 className="card__title" id="ds-dialog-title">
                  {lang === 'ar' ? 'تأكيد الاعتماد' : 'Confirm commit'}
                </h2>
              </header>
              <div className="card__body stack">
                <p>{lang === 'ar' ? 'سيتم اعتماد 12 صفًا وكتابة حدث تدقيق لكل صف.' : '12 rows will be committed with one audit event per row.'}</p>
                <div className="filters__actions">
                  <button type="button" className="btn btn--primary" onClick={() => setDialogOpen(false)}>
                    {lang === 'ar' ? 'تأكيد' : 'Confirm'}
                  </button>
                  <button type="button" className="btn btn--ghost" onClick={() => setDialogOpen(false)}>
                    {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      <Card
        title={lang === 'ar' ? 'الاتجاه: RTL / LTR' : 'Direction: RTL / LTR'}
        subtitle={lang === 'ar' ? 'نفس المكونات في الاتجاهين' : 'The same components in both directions'}
        actions={
          <div className="lang-toggle" role="group" aria-label={lang === 'ar' ? 'الاتجاه' : 'Direction'}>
            <button type="button" className={sectionDir === 'rtl' ? 'is-active' : ''} onClick={() => setSectionDir('rtl')}>
              RTL
            </button>
            <button type="button" className={sectionDir === 'ltr' ? 'is-active' : ''} onClick={() => setSectionDir('ltr')}>
              LTR
            </button>
          </div>
        }
      >
        <div dir={sectionDir} lang={sectionDir === 'rtl' ? 'ar' : 'en'}>
          <div className="filters">
            <label className="field">
              <span>{sectionDir === 'rtl' ? 'العميل' : 'Customer'}</span>
              <input type="text" defaultValue={sectionDir === 'rtl' ? 'شركة المقاولات المتحدة' : 'United Contracting'} />
            </label>
            <label className="field">
              <span>{sectionDir === 'rtl' ? 'المبلغ' : 'Amount'}</span>
              <input type="text" className="mono" defaultValue="1,250.00" readOnly />
            </label>
            <div className="filters__actions">
              <button type="button" className="btn btn--primary">
                {sectionDir === 'rtl' ? 'بحث' : 'Search'}
              </button>
            </div>
          </div>
          <p className="field__hint">
            {sectionDir === 'rtl'
              ? 'اتجاه الصفحة افتراضيًا RTL لأن العربية هي اللغة الأولى؛ الأرقام تبقى LTR داخل الخلايا.'
              : 'Page direction defaults to RTL because Arabic is the first language; numbers stay LTR inside cells.'}
          </p>
        </div>
      </Card>
    </>
  );
};
