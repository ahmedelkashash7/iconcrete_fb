# ICONCRETE — نظام إدارة الخرسانة الجاهزة

**IConcrete-fp** — نظام إدارة محطات الخرسانة الجاهزة.
العلامة: **ICONCRETE** — **Concrete Management Solutions**.
العربية هي اللغة الأولى والاتجاه الافتراضي RTL، والإنجليزية هي اللغة الثانية.
الترخيص: MIT.

> **المرحلة الأولى نموذج تجريبي (Demo Prototype).** تشمل المصادقة، وهيكل الصلاحيات (RBAC)،
> ولوحة المعلومات، وهيكل التقارير، وأساس بيانات العملاء والمحطات والمستخدمين، ومركز تكامل Excel،
> ومولّد Excel محمول بلغة Python. وحدات التشغيل (M1–M19) **غير مبنية**، ولا يدّعي هذا المستند خلاف ذلك.

---

## البدء السريع

المتطلبات: [Bun](https://bun.sh) 1.2+ (تم الاختبار على 1.3.14)، وPython 3.9+ لمولّد Excel.

```bash
bun install
cp .env.example .env          # عدّل القيم محليًا فقط
bun run dev                   # واجهة Vite على :3000 وواجهة API على :3001
```

وضع التخزين الافتراضي هو `demo` (بيانات تجريبية في الذاكرة، بلا قاعدة بيانات).

### التشغيل على PostgreSQL

```bash
export DATABASE_URL="postgres://postgres@127.0.0.1:5432/iconcrete"
export ICONCRETE_STORAGE_MODE=postgres
bun run db:migrate
bun run db:seed
bun run dev
```

في وضع `postgres` يرفض الخادم العمل إذا تعذّر الاتصال، ولا يعود إلى الذاكرة أبدًا.

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `bun run dev` | واجهة التطوير + واجهة API معًا |
| `bun run build` | فحص الأنواع ثم بناء الإنتاج إلى `dist/` |
| `bun test` | كل الاختبارات (وحدات، API، PostgreSQL عند ضبط `DATABASE_URL`) |
| `bash scripts/verify.sh` | بوابة كاملة: تثبيت، ترحيل، بذر، أنواع، اختبارات، بناء، pytest، مولّد Excel |
| `bun run schema:docs` | إعادة توليد `docs/DATA_DICTIONARY.md` من قاعدة البيانات |
| `python3 excel_generator/generate_workbook.py` | توليد مصنّف Excel حقيقي |
| `bun run scripts/a11y-audit.ts` | تدقيق إمكانية الوصول الميكانيكي |
| `bash scripts/backup-restore-drill.sh` | تمرين نسخ احتياطي واستعادة مُقاس |

## البنية

```
server/          واجهة API (Bun) + خدمات M1 + ترحيلات
db/migrations/   ترحيلات SQL بالترتيب (0001…0011)
src/             واجهة React (RTL/LTR، i18n عربي/إنجليزي)
tests/           Bun test: وحدات، مسارات، RLS وPostgreSQL
excel_generator/ مولّد Excel محمول (Python + openpyxl)
docs/            المواصفة، القرارات، الترحيلات، سجلات التحقق
```

## الحدود المعروفة

- وحدات التشغيل M1–M19 غير مبنية؛ المرحلة الأولى أساس فقط.
- بعض نماذج القراءة (لوحة المعلومات والتقارير) ما زالت تقرأ بيانات العرض التجريبي في وضع postgres.
- لا توجد أتمتة متصفح في بيئة التشغيل هذه، لذا فإن تحقق RTL البصري وتدفق النقرات البصرية **غير مختبَر**.
- لا يوجد بعيد Git ولا CI ولا نشر مُنفَّذ؛ راجع `docs/ISSUES_AND_GAPS.md`.

## التوثيق

- `docs/GOLDEN_MASTER_SPEC.md` — المواصفة الحاكمة.
- `docs/PHASE2_M1.md` و`docs/B3_REPORT.md` — حالة المرحلة وتقرير الإنجاز.
- `docs/SECURITY.md`، `docs/VERIFICATION_RECORD.md`، `docs/ACCESSIBILITY_AUDIT.md`.
- `docs/BUILD_AND_DEPLOY.md`، `docs/BACKUP_AND_RESTORE.md`، `docs/ROLLBACK.md`.

الترخيص: [MIT](LICENSE).
