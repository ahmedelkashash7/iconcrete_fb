# GOLDEN MASTER SPECIFICATION

> **Source:** ICONCRETE Golden Master Specification, supplied verbatim by the user on 2026-11-02
> (the earlier statement that it accompanied Directive 2 was corrected by the user; the text
> arrived in the follow-up message).
> **Date ingested:** 2026-11-02.
> **Status:** CONTROLLING REFERENCE for all compliance claims. Every claim elsewhere in this
> repository that depends on the specification cites a section number of this document.
> Transcription is verbatim: no summarising, paraphrasing, reordering, renumbering or reformatting.

# ICONCRETE — GOLDEN MASTER SPECIFICATION

# Product Architecture, Ready-Mix Concrete ERP, Engineering,
# Accounting, Quality, Excel Integration, Security, Testing,
# Free-Tier Deployment, and Commercial Readiness

You are acting as a senior multidisciplinary engineering team
responsible for designing, building, testing, documenting, and
delivering ICONCRETE.

Your responsibilities include:

- Product architecture.
- Ready-mix concrete plant operations.
- Concrete production and mix design.
- Quality assurance and laboratory operations.
- Egyptian concrete standards research.
- Accounting and financial controls.
- Inventory and procurement.
- Fleet, dispatch, pumps, and maintenance.
- Database architecture.
- Frontend and backend engineering.
- Excel generation and integration.
- Cybersecurity.
- Offline-first application design.
- Testing and verification.
- UX/UI and accessibility.
- Deployment and DevOps.
- Cost optimization.
- Product strategy and commercial readiness.

Do not behave as a screen generator.

Build a coherent, integrated, testable business system.

The objective is to create a reliable platform that can
eventually manage real ready-mix concrete operations,
from customer quotation through production, delivery,
quality verification, invoicing, collection, and reporting.

The platform must be designed to scale from one plant
to multiple plants and, eventually, international groups.

However, scalability targets must not be confused with
capabilities that have already been implemented.

Every capability must have an explicit implementation
status and verifiable acceptance criteria.

==================================================
1. LOCKED PRODUCT IDENTITY
==================================================

Technical project name:
IConcrete-fp

Product brand:
ICONCRETE

Logo text:
ICONCRETE

Tagline:
Concrete Management Solutions

Default language:
Arabic.

Secondary language:
English.

Default direction:
RTL.

English direction:
LTR.

Initial market:
Egypt.

Display timezone:
Africa/Cairo.

Store timestamps in UTC where supported, converting
them correctly to the relevant local timezone.

Default currency:
EGP.

Demo company:
شركة آي كونكريت التجريبية

Demo company English:
IConcrete Demo Company

Demo plant:
محطة آي كونكريت التجريبية - القاهرة

Demo plant English:
IConcrete Demo Plant - Cairo

Visual identity:
Professional Flat Purple with a restrained purple-blue
visual system.

Locked colors:

Primary purple: #6D28D9
Dark purple: #4C1D95
Secondary purple: #8B5CF6
Accent blue: #2563EB
Success: #16A34A
Danger: #DC2626
Warning: #F59E0B
Background: #F8FAFC
Main text: #0F172A

Display the brand as readable text.

Do not substitute decorative symbols for the brand name.

Keep the design ready for a future uploaded logo document
identified through logo_doc_id.

Do not ask the user to reconfirm these decisions.

==================================================
2. PRIMARY MISSION
==================================================

Build ICONCRETE as a modular ready-mix concrete management
platform with a web application as the long-term product
and a real Excel workbook as a complementary product.

The system must integrate:

1. Sales and CRM.
2. Customers and projects.
3. Quotations and contracts.
4. Orders and scheduling.
5. Mix designs.
6. Production and batching.
7. Quality and laboratory.
8. Materials and inventory.
9. Procurement and suppliers.
10. Fleet and dispatch.
11. Drivers and trips.
12. Delivery tickets and proof of delivery.
13. Pumps and pumping jobs.
14. Maintenance and spare parts.
15. Weighbridge integration.
16. Accounting and finance.
17. HR and payroll.
18. Assets and depreciation.
19. Environmental monitoring.
20. Reports and analytics.
21. Offline operations.
22. Multi-plant management.
23. Excel generation and integration.
24. Customer and driver portals.
25. Notifications and integrations.
26. Forecasting and carefully governed AI.

These modules must share consistent business entities,
identifiers, relationships, permissions, and audit rules.

Do not implement them as disconnected demonstrations.

==================================================
3. NON-NEGOTIABLE DELIVERY RULES
==================================================

Never claim a feature is functional simply because:

- A page exists.
- A button exists.
- A table is visible.
- A database schema exists.
- A service interface exists.
- A chart displays sample values.
- A mock API returns a response.
- A file with the expected name exists.
- A test file exists without being executed.

Never fabricate:

- Successful tests.
- Successful deployments.
- Database connections.
- Authentication security.
- Excel generation.
- Offline synchronization.
- Live GPS.
- PLC/SCADA integration.
- Weighbridge integration.
- AI predictions.
- External message delivery.
- Egyptian Code compliance.

Every important claim must be supported by observable
implementation evidence or executed tests.

Use the following statuses consistently:

IMPLEMENTED AND VERIFIED
IMPLEMENTED BUT NOT FULLY VERIFIED
DEMO ONLY
TEMPLATE ONLY
INTEGRATION READY
BLOCKED
NOT IMPLEMENTED
NOT TESTED
NOT VERIFIED AGAINST SOURCE

If a feature cannot be implemented in the current
environment, document the exact limitation.

Implement unrelated supported work without waiting
for unsupported features.

Do not silently omit requirements.

Do not create empty screens or empty worksheets merely
to claim that a module has been delivered.

==================================================
4. ENVIRONMENT AND FREE-TOOL INSPECTION
==================================================

Before modifying the project, inspect the actual environment.

Determine:

- Available operating system and runtime.
- Existing repository and source files.
- Existing framework and language.
- Package manager.
- Available build commands.
- Available testing commands.
- Existing routes and components.
- Existing database or backend capabilities.
- File upload and download capabilities.
- Real XLSX-generation support.
- CSV-processing support.
- Charting capabilities.
- Authentication capabilities.
- Deployment capabilities.
- Available persistent storage.
- Existing integrations.
- Available free-tier tools.
- Restrictions imposed by the current platform.

Do not assume a particular framework, package, runtime,
database, or command is installed.

Do not replace an existing working architecture without
a demonstrated reason.

Before choosing a new dependency, determine:

1. Whether it is already available.
2. Whether its license permits the intended use.
3. Whether it can run without a paid subscription.
4. Whether it introduces a paid external dependency.
5. Whether a simpler free alternative exists.
6. Whether it creates vendor lock-in.
7. Whether it can be replaced later without redesigning
   the entire application.

Create:

docs/ENVIRONMENT_AUDIT.md
docs/ARCHITECTURE_DECISIONS.md
docs/FREE_TOOLING_AND_COSTS.md

Document actual findings, not assumptions.

==================================================
5. ZERO-BUDGET BUILD AND DEPLOYMENT STRATEGY
==================================================

The project must prioritize a zero-budget development,
storage, and deployment workflow.

The preferred workflow is:

Build
→ Validate
→ Test
→ Save source code
→ Version changes
→ Build distributable artifacts
→ Deploy using available free infrastructure
→ Verify the deployed result
→ Preserve rollback capability.

Use Git and a remote repository when available.

Do not require paid subscriptions for the core development
workflow when a practical free alternative exists.

Investigate available free options for:

- Source-code hosting.
- Local development.
- Browser-based development.
- Static hosting.
- Frontend hosting.
- Serverless functions.
- Free database tiers.
- Open-source relational databases.
- Local development databases.
- Spreadsheet generation.
- Testing.
- Monitoring.
- Documentation.
- Backups.
- Continuous integration.

Do not assume that any provider's free tier is permanent.

For every selected external service, document:

- Current free-tier limits.
- Storage limits.
- Execution limits.
- Bandwidth limits.
- Sleep or suspension behavior.
- Data retention.
- Backup restrictions.
- Deployment restrictions.
- Commercial-use restrictions.
- Export and migration options.
- Potential future costs.

Never require a paid service merely because it is convenient.

Prefer portable technologies and open standards.

Separate application logic from provider-specific APIs.

Where appropriate, implement adapters so that a database,
file-storage provider, or hosting provider can be replaced
without rewriting business logic.

Never bypass usage limits or terms of service.

Never claim the application can support unlimited users,
unlimited data, or permanent free hosting.

If a reliable production deployment cannot be achieved
within the available free infrastructure, explain why.

Distinguish:

A. Zero-cost local prototype.
B. Zero-cost demonstration deployment.
C. Limited free-tier pilot.
D. Production deployment with defined reliability.
E. Scalable commercial deployment.

Do not represent A, B, or C as equivalent to D or E.

The user has no current software budget.

Design for the best achievable free workflow first,
without creating unnecessary paid dependencies.

==================================================
6. TARGET ARCHITECTURE
==================================================

Use the simplest architecture that satisfies the current
phase while preserving a practical migration path.

Preferred frontend characteristics:

- Component-based architecture.
- Type safety where supported.
- Reusable design system.
- Arabic RTL and English LTR.
- Responsive layouts.
- Accessible controls.
- Centralized validation.
- Predictable state management.
- Clear separation of UI and business logic.

Preferred online architecture:

- Relational database.
- Server-side validation.
- Explicit service boundaries.
- Transactional business operations.
- Role-based authorization.
- Tenant and plant isolation.
- Audit logging.
- Database migrations.
- Automated testing.
- Backup and recovery procedures.

PostgreSQL is a preferred target where available and
appropriate, but must not be assumed to exist.

A local prototype may use browser storage or a local
database, provided that its limitations are documented.

Do not pretend browser storage is a secure, centralized,
multi-user database.

Do not pretend local demo state is synchronized with a server.

Create an architecture decision record whenever a
significant technology choice is made.

==================================================
7. MULTI-TENANT DATA MODEL
==================================================

Design the data model around stable identifiers and
explicit relationships.

Core organizational entities:

- Company.
- Plant.
- User.
- Role.
- Permission.
- UserPlantAssignment.
- Customer.
- Supplier.
- Project.
- Document.
- AuditEvent.

Every applicable business record must be scoped to the
correct company and plant.

Use company_id and plant_id where appropriate.

Define which entities belong to:

- The company.
- A specific plant.
- A shared corporate scope.
- An external customer.
- An external supplier.

Do not add meaningless tenant fields to entities that
do not require them.

Enforce tenant and plant isolation at the server or
database authorization boundary when a backend exists.

Frontend filtering alone is not security.

Define:

- Primary keys.
- Foreign keys.
- Unique constraints.
- Nullability.
- Data types.
- Units.
- Enumerated values.
- Status lifecycles.
- Soft-delete rules.
- Audit fields.
- Indexes.
- Retention rules.
- Ownership.
- Data provenance.

Use explicit relationship cardinalities.

Do not assume that one order equals one batch, one truck,
one delivery ticket, or one quality sample.

The system must support one-to-many and many-to-one
relationships where required by real operations.

Use junction tables when many-to-many relationships
are necessary.

Never rely on display names as permanent identifiers.

Never use floating-point arithmetic for financial
amounts where decimal arithmetic is appropriate.

Use appropriate numeric precision for concrete quantities,
material weights, currency, and engineering measurements.

Store units explicitly and convert them only through
defined, tested conversion rules.

Keep the following distinct:

- Master data.
- Transactional data.
- Reference data.
- Audit events.
- Derived values.
- Temporary data.
- Integration events.
- Forecast outputs.

Create:

docs/DATA_MODEL.md
docs/DATA_DICTIONARY.md
docs/ENTITY_RELATIONSHIPS.md

==================================================
8. TRANSACTIONS AND CONCURRENCY
==================================================

Where a transactional backend exists, use atomic
transactions for operations that must succeed or fail
together.

Examples include:

- Posting a journal entry.
- Receiving inventory.
- Confirming a delivery.
- Posting an invoice.
- Allocating a payment.
- Completing an interplant transfer.

Use:

- Stable transaction identifiers.
- Idempotency keys.
- Appropriate uniqueness constraints.
- Concurrency control.
- Server-side validation.
- Explicit transaction states.
- Audit events.

Prevent duplicate submissions from creating duplicate
financial postings or inventory movements.

Do not use silent overwrites to resolve conflicts.

Define which operations may be reversed and how.

Never physically delete posted financial transactions
as the normal correction method.

Use approved reversal or adjustment workflows.

==================================================
9. AUTHENTICATION AND AUTHORIZATION
==================================================

Target roles:

1. Viewer.
2. Operator.
3. Dispatcher.
4. Plant Manager.
5. Owner/Administrator.

Permissions must be configurable by module and action.

Examples:

- View.
- Create.
- Edit.
- Submit.
- Approve.
- Reject.
- Post.
- Reverse.
- Export.
- Import.
- Manage users.
- Configure system rules.

A user may have different permissions at different plants.

Separate authentication from authorization.

Required production capabilities where supported:

- Secure password hashing.
- Session expiry.
- Session revocation.
- Rate limiting.
- Protection against repeated failed logins.
- Password-reset workflow.
- Secure cookie configuration where applicable.
- CSRF protection where applicable.
- HTTPS in deployment.
- Input validation.
- Output encoding.
- Secure file-upload handling.
- Audit events.
- Optional TOTP two-factor authentication.

Enforce permissions on protected operations,
not merely by hiding interface elements.

Unauthorized API requests must be rejected by the API.

Never store production credentials in frontend code.

Never commit secrets to source control.

Use environment variables or the hosting platform's
supported secret-management facility.

Do not hard-code demonstration credentials into a
production authentication mechanism.

If a backend is unavailable, create an explicitly labeled
demo login and do not claim production authentication.

==================================================
10. AUDIT AND CHANGE CONTROL
==================================================

Audit significant events, including:

- Login and logout.
- Failed authentication.
- Permission changes.
- Record creation.
- Record modification.
- Approval and rejection.
- Financial posting.
- Financial reversal.
- Imports and exports.
- Synchronization.
- Conflict resolution.
- Configuration changes.
- Deletion requests.
- Engineering-rule changes.

Where appropriate, store:

- Actor.
- Timestamp.
- Company.
- Plant.
- Action.
- Entity type.
- Entity ID.
- Previous values.
- New values.
- Reason.
- Correlation ID.
- Source.
- Result.

Avoid recording passwords, secrets, or unnecessary sensitive data.

Protect audit records against unauthorized modification.

Document audit-retention and access policies.

==================================================
11. DATA MIGRATION AND BACKUP
==================================================

Support future migration from Excel and CSV into the
central application.

Create versioned database migrations.

Document how to:

- Initialize a new environment.
- Upgrade a database.
- Validate a migration.
- Back up data.
- Restore a backup.
- Verify restoration.
- Export business data.
- Recover from failed upgrades.

A backup is not considered verified until a restoration
test has been performed.

Do not claim disaster recovery readiness based solely
on the existence of a backup button.

Define recovery objectives where the infrastructure
supports them.

Document free-tier backup limitations and retention risks.

==================================================
12. DESIGN SYSTEM
==================================================

Create one canonical design system.

Use the locked ICONCRETE colors.

Define tokens for:

- Colors.
- Typography.
- Spacing.
- Borders.
- Shadows.
- Radius.
- Focus indicators.
- Animation.
- Component states.

Use readable Arabic and English fonts.

Use subtle gradients only where appropriate.

Do not use gradients or color effects that reduce
text readability.

All interactive elements must have visible:

- Default state.
- Hover state.
- Focus state.
- Active state.
- Disabled state.
- Loading state.
- Error state.

Use consistent colors for success, warnings, danger,
and neutral information.

Do not rely on color alone to communicate meaning.

Provide appropriate contrast.

Create a design-system preview containing:

- Colors.
- Typography.
- Buttons.
- Inputs.
- Tables.
- Cards.
- Badges.
- Alerts.
- Dialogs.
- Loading indicators.
- Empty states.
- Error states.
- Keyboard focus.
- Arabic examples.
- English examples.
- RTL and LTR examples.

==================================================
13. INTERNATIONALIZATION
==================================================

Arabic is the default language.

English must be fully supported.

Translate:

- Navigation.
- Labels.
- Buttons.
- Errors.
- Notifications.
- Reports.
- Validation messages.
- Status values.
- Empty states.
- Help text.

Use translation keys.

Switch direction consistently when changing languages.

Do not hard-code user-facing text inside business logic.

Support appropriate localization for:

- Dates.
- Times.
- Numbers.
- Currency.
- Decimal separators.
- Units.

Do not confuse localized display with stored values.

==================================================
14. APPLICATION NAVIGATION
==================================================

Create a coherent application shell.

Include:

- Sidebar or appropriate mobile navigation.
- Top navigation.
- Current company and plant.
- Language switch.
- User menu.
- Notifications.
- Search where useful.
- Breadcrumbs where appropriate.
- Current synchronization status when applicable.

Navigation must reflect the actual implementation status.

Do not present unimplemented modules as working features.

If future modules are shown, label them clearly.

Every active navigation item must open a valid destination.

Every visible button must perform its intended action
or be explicitly disabled with an explanation.

Never create silent dead buttons.

==================================================
15. LOGIN
==================================================

Login must display:

ICONCRETE

Concrete Management Solutions

Include:

- Username or email.
- Password.
- Language switch.
- Company context where applicable.
- Appropriate validation.
- Clear errors.
- Accessible keyboard navigation.

Use Arabic RTL by default.

The login screen must not expose confidential information.

When authentication is not connected to a backend,
label the experience as a demo.

Do not imply that a demo login protects business data.

==================================================
16. DASHBOARD
==================================================

Build a responsive operational and financial dashboard.

It must support:

- KPI cards.
- Urgent alerts.
- Production summary.
- Orders and deliveries.
- Fleet status.
- Quality summary.
- Inventory alerts.
- Receivables and payables.
- Cash position.
- Monthly performance.
- Relevant charts.
- Date filters.
- Plant filters.
- Click-through navigation.
- Last-refresh timestamp.
- Data-source status.

All displayed totals must be derived from underlying
records or clearly labeled demo data.

Do not independently hard-code dashboard totals.

Clicking a supported metric must navigate to its
underlying detailed records.

Provide loading, empty, error, and stale-data states.

Never imply that stale data is current.

==================================================
17. FINANCIAL POSITION
==================================================

The dashboard must clearly distinguish:

A. Total Assets.
B. Total Liabilities.
C. Net Assets / Equity.
D. Profit or Loss for the selected period.
E. Cash and Cash Equivalents.
F. Working Capital.
G. Overdue Receivables.
H. Overdue Payables.

Net Assets = Total Assets - Total Liabilities.

Do not label Net Assets as Profit.

Profit or Loss must be calculated according to the
accounting model and reporting period.

Potential assets include:

- Cash.
- Bank balances.
- Eligible cheques under collection.
- Customer receivables.
- Inventory.
- Fixed assets net of accumulated depreciation.
- Other recognized assets.

Potential liabilities include:

- Supplier payables.
- Payroll obligations.
- Recognized rent and utility liabilities.
- Loans.
- Taxes.
- Other recognized obligations.

Define the accounting treatment of every category.

Prevent double-counting of:

- Transfers between cash and bank.
- Cheques in different lifecycle states.
- Customer advances.
- Supplier advances.
- Loan principal and interest.
- Inventory.
- Fixed assets and depreciation.
- Posted and unposted entries.

Provide drill-down from every supported total.

Do not represent a simplified management indicator as
a formally verified balance sheet unless the accounting
requirements have been met.

==================================================
18. REPORTING
==================================================

Create a unified Reports module.

Support:

- Report selection.
- Date range.
- Plant selection.
- Customer selection.
- Project selection.
- Dynamic filters.
- Search.
- Sorting.
- Pagination.
- Charts where appropriate.
- Print where supported.
- CSV export.
- XLSX export when genuinely supported.
- PDF export when genuinely supported.

Include report definitions for:

- General balance.
- Customer statement.
- Supplier statement.
- Sales by period.
- Production.
- Quality.
- Inventory.
- Fleet.
- Maintenance.
- Delivery performance.
- Cash movement.
- Bank movement.
- Cheques.
- Loans.
- Fixed assets.
- Customer profitability.
- Project profitability.
- Order profitability.
- Budget versus actual.

Every report must state its data source and calculation
rules.

Reports must respect the user's company, plant,
and record-level permissions.

Exports must use the current authorized filters.

Do not silently export all company data when a
user has access only to one plant.

==================================================
19. COMPLETE BUSINESS LIFECYCLE
==================================================

Implement the following business lifecycle:

Lead
→ Opportunity
→ Quotation
→ Contract
→ Customer Order
→ Production Schedule
→ Mix Design
→ Batch
→ Dispatch Assignment
→ Trip
→ Delivery Ticket
→ Proof of Delivery
→ Quality Records
→ Invoice
→ Payment
→ Journal Entry
→ Reconciliation
→ Reporting.

Every transition must have:

- Defined preconditions.
- Defined required fields.
- Validated relationships.
- Permission checks.
- Status transitions.
- Audit events.
- Error handling.
- Correction or reversal rules.

Do not assume every order must pass through exactly
one batch, one trip, or one delivery ticket.

Support the actual cardinalities of ready-mix operations.

==================================================
20. CUSTOMER AND PROJECT MANAGEMENT
==================================================

Support:

- Customer master records.
- Customer contacts.
- Billing details.
- Delivery locations.
- Credit limits.
- Payment terms.
- Customer status.
- Customer documents.
- Customer history.
- Projects and job sites.
- Project contacts.
- Project specifications.
- Contracts.
- Price agreements.
- Order history.
- Complaints.
- Quality records.
- Outstanding balances.

Validate duplicate customer identifiers.

Do not use customer names as unique identifiers.

Support multiple projects and delivery sites for one
customer where required.

==================================================
21. SALES AND CRM
==================================================

Support:

- Leads.
- Opportunities.
- Sales stages.
- Sources.
- Quotations.
- Quote versions.
- Price lists.
- Contract pricing.
- Seasonal pricing.
- Volume commitments.
- Discounts.
- Approval thresholds.
- Win/loss reasons.
- Conversion metrics.
- Sales performance.
- Customer profitability.

Quote revisions must preserve historical versions.

Changes to an approved quotation must not silently
change an existing signed contract.

==================================================
22. ORDERS AND DISTRIBUTION
==================================================

Support:

- Customer orders.
- Order items.
- Project and site.
- Concrete grade and mix.
- Quantity.
- Unit price.
- Delivery schedule.
- Pour windows.
- Distance surcharges.
- Pump charges.
- Taxes.
- Customer credit checks.
- Material availability.
- Plant capacity.
- Truck availability.
- Dispatch availability.
- Order lifecycle.
- Partial deliveries.
- Cancellations.
- Returned loads.
- Diversions.
- Approved delivery records.

Possible order lifecycle:

Draft
→ Confirmed
→ Scheduled
→ In Production
→ Delivering
→ Completed
→ Invoiced.

Allow controlled exceptions when the actual workflow
requires them.

Do not permit invalid transitions without an explicit,
authorized exception.

==================================================
23. PRODUCTION SCHEDULING
==================================================

Support:

- Production queue.
- Planned volume.
- Required delivery times.
- Mix requirements.
- Plant capacity.
- Available materials.
- Batch plant assignment.
- Planned production rate.
- Actual production rate.
- Production delays.
- Queue changes.
- Shift handover.
- Schedule revisions.

Identify resource conflicts before confirming schedules.

Do not promise production capacity based only on a
manually entered dashboard number.

Use validated plant capacity and available-resource data
where those records exist.

==================================================
24. MIX DESIGN AND BATCHING
==================================================

Support:

- Versioned mix designs.
- Approved material definitions.
- Specific gravity.
- Bulk density where applicable.
- Exposure classes.
- Water/cementitious ratio.
- Target quantities.
- Moisture readings.
- Moisture corrections.
- Actual batch weights.
- Batch yield.
- Batch validation.
- Production queue.
- Waste.
- Returned concrete.
- Material custody.
- Toll batching.
- Batch tickets.
- PLC/SCADA adapter interfaces.

Store target and actual values separately.

Preserve historical mix-design versions.

Never silently modify an approved mix design.

Require authorized approval for controlled revisions.

==================================================
25. ENGINEERING CALCULATION GOVERNANCE
==================================================

All engineering calculations must be validated before
they are used for operational decisions.

For each calculation, document:

1. Engineering meaning.
2. Inputs.
3. Units.
4. Formula.
5. Dimensional consistency.
6. Assumptions.
7. Worked example.
8. Boundary conditions.
9. Precision and rounding.
10. Expected result.
11. Actual test result.
12. Difference.
13. Reference.
14. Approval status.

Do not treat the numerical values in a software prompt
as authoritative engineering standards by default.

Classify every engineering rule as:

- Applicable code requirement.
- Project or contract requirement.
- Approved mix-design requirement.
- Plant operating tolerance.
- Internal warning.
- Demo assumption.
- Not verified.

For code-based requirements, record:

- Jurisdiction.
- Standard title.
- Edition.
- Clause or page.
- Applicability.
- Effective date.
- Approval status.
- Version history.

Use the supplied Egyptian Code and project specifications
as the controlling references where available.

Do not invent clause numbers.

Do not attribute an unsourced threshold to the Egyptian Code.

If the applicable rule is unknown, mark it NOT VERIFIED.

A software validation result must never be presented as
a substitute for engineering approval.

==================================================
26. BATCH VALIDATION
==================================================

Create a configurable validation engine.

Potential checks include:

- Positive batch volume.
- Plant capacity.
- Approved mix version.
- Material availability.
- Valid material weights.
- Valid moisture readings.
- Valid moisture corrections.
- Water/cementitious ratio.
- Material tolerances.
- Expected yield.
- Calibration status where applicable.
- Duplicate batch identifier.
- Required authorization.

Do not hard-code universal tolerances without
an applicable reference.

All numerical tolerances must be configurable
according to the approved rule classification.

Distinguish between:

- Warning.
- Mandatory validation failure.
- Approval required.
- Engineering hold.
- Authorized override.

An override must record the actor, reason, time,
affected rule, and resulting decision.

Never silently correct a batch.

The system may propose a correction but must not
apply it without the required authorization.

==================================================
27. MATERIALS AND MOISTURE
==================================================

Support:

- Cementitious materials.
- Aggregates.
- Water.
- Admixtures.
- Other approved materials.
- Material densities.
- Moisture readings.
- Absorption values where applicable.
- Moisture-corrected aggregate weights.
- Mixing-water corrections.
- Target-versus-actual comparisons.

Implement each moisture calculation using an explicit
definition of moisture basis and absorption basis.

Do not confuse wet-basis moisture percentage with
dry-basis moisture percentage.

Define whether moisture is expressed relative to
oven-dry mass or another specified basis.

Document the applicable formula and units.

Test against independently calculated examples.

Reject or flag missing, expired, impossible, or
inconsistent measurements according to configured rules.

Do not assume one moisture-reading validity window
is universally correct.

==================================================
28. FLEET AND DISPATCH
==================================================

Support:

- Trucks.
- Drivers.
- Pumps.
- Vehicle capacities.
- Ownership status.
- Licensing.
- Insurance expiry.
- Driver availability.
- Work and rest constraints.
- Dispatch queue.
- Dispatch assignments.
- Trips.
- Trip lifecycle timestamps.
- Fuel transactions.
- Maintenance.
- Vehicle health.
- Water additions.
- Returned loads.
- Diverted loads.
- Delivery tickets.
- Proof of delivery.

Dispatch decisions should consider:

- Order priority.
- Pour windows.
- Truck capacity.
- Plant availability.
- Distance.
- Driver availability.
- Vehicle availability.
- Vehicle health.
- Travel time where available.
- Production schedule.
- Existing assignments.

Provide delay detection and re-sequencing support.

Live GPS, traffic, and route optimization must be
identified as integrations unless actually connected.

==================================================
29. CONCRETE AGE AND DELIVERY CONTROL
==================================================

If configured for the applicable project and operating
standard, support warning thresholds for concrete age.

Example demo configuration:

Warning: 90 minutes.
Urgent: 110 minutes.
Maximum: 120 minutes.

These are demo defaults, not universal code requirements.

The system must allow an authorized configuration
to replace them.

Define precisely which event starts the clock and
which event ends it.

Distinguish batching time, dispatch time, arrival time,
discharge time, and other relevant events.

Do not calculate concrete age from an undefined timestamp.

If the required timestamp is missing, report that the
age cannot be reliably determined.

==================================================
30. QUALITY AND LABORATORY
==================================================

Support:

- Mix submissions.
- Trial batches.
- Laboratory equipment.
- Calibration records.
- Sampling plans.
- Samples.
- Slump tests.
- Temperature tests.
- Cube and cylinder specimens.
- Strength tests.
- Seven-day tests.
- Twenty-eight-day tests.
- Optional additional test ages.
- Individual results.
- Average results.
- Outlier review.
- Retests.
- Failed results.
- Nonconformance reports.
- Root-cause analysis.
- Corrective actions.
- Preventive actions.
- Statistical process control.
- Control limits.
- Quality certificates.
- Inspection and test plans.
- Hold points.
- Witness points.

Link every relevant quality record to:

- Company.
- Plant.
- Customer.
- Project.
- Order.
- Mix-design version.
- Batch.
- Delivery.
- Sample.
- Specimen.
- Test method.
- Laboratory equipment.
- Calibration record.
- Test age.
- Test result.
- Applicable acceptance requirement.

Preserve sample traceability.

Record sampling and testing timestamps.

Support authorized corrections without deleting
the original test history.

==================================================
31. STRENGTH AND QUALITY ACCEPTANCE
==================================================

Do not universally enforce the following as code-based
acceptance rules without verified applicability:

- Seven-day strength percentages.
- Twenty-eight-day strength requirements.
- Slump tolerances.
- Temperature limits.
- Sampling frequencies.
- Cube acceptance rules.
- Batch tolerances.

These must be configured from the applicable standard,
project specifications, approved mix design, or documented
plant quality procedure.

For every acceptance decision, record:

- Required criterion.
- Source and version.
- Applicable conditions.
- Actual result.
- Calculation.
- Comparison.
- Outcome.
- Reviewer.
- Timestamp.

Keep warning thresholds separate from formal acceptance.

Do not infer a failed 28-day result solely from a
seven-day result unless the applicable approved procedure
explicitly requires that action.

Do not label a test result compliant merely because
a default threshold was met.

==================================================
32. LAB EQUIPMENT AND CALIBRATION
==================================================

Support:

- Equipment register.
- Equipment ID.
- Calibration provider.
- Calibration date.
- Expiry date.
- Calibration certificate.
- Status.
- Next calibration.
- Maintenance.
- Usage history.

Provide upcoming-expiry alerts.

Where a valid calibration is mandatory, prevent the
relevant test from being accepted when calibration has
expired, according to the approved rule.

Preserve historical calibration records.

Do not assume one warning period applies to every device.

==================================================
33. NONCONFORMANCE AND CORRECTIVE ACTION
==================================================

Support:

- Nonconformance identification.
- Severity.
- Affected records.
- Immediate containment.
- Root-cause analysis.
- Corrective action.
- Preventive action.
- Responsible person.
- Due date.
- Verification.
- Closure approval.
- Supporting evidence.

Link nonconformances to relevant batches, materials,
deliveries, customers, and tests.

Track overdue corrective actions.

Do not close a nonconformance without the required
evidence and authorization.

==================================================
34. INVENTORY
==================================================

Support:

- Materials.
- Receipts.
- Issues.
- Consumption.
- Returns.
- Adjustments.
- Transfers.
- Daily snapshots.
- Reorder levels.
- Safety stock.
- Material valuation.
- Stock reconciliation.
- Parts inventory.
- Supplier lots.
- Material quality.
- Purchase suggestions.

Inventory balances must be derived from validated
inventory movements.

Do not allow negative inventory silently.

If negative stock is permitted as an exceptional workflow,
require authorization, explanation, and audit logging.

Support moisture-adjusted consumption where applicable.

Clearly distinguish actual wet aggregate weight,
dry-equivalent aggregate weight, and mixing-water effects.

Use a documented inventory valuation method.

Do not assume a single valuation method is suitable
for every accounting environment.

==================================================
35. PROCUREMENT
==================================================

Support:

- Purchase requests.
- Approval workflows.
- Purchase orders.
- Supplier quotations.
- Goods receipts.
- Supplier bills.
- Three-way matching.
- Exceptions.
- Supplier scorecards.
- Price history.
- Delivery performance.
- Material quality.
- Approval limits.

The three-way match must compare the relevant purchase
order, goods receipt, and supplier invoice data.

Record quantity and price discrepancies.

Do not mark a purchase transaction fully matched when
required evidence is missing.

==================================================
36. PUMPS
==================================================

Support:

- Boom pumps.
- Stationary pumps.
- Rental pumps.
- Pump operators.
- Assignments.
- Pumping jobs.
- Actual hours.
- Delivered volume.
- Pumping rate.
- Cleaning.
- Maintenance.
- Downtime.
- Hour-based billing.
- Volume-based billing.

Support pump assignment to projects and orders.

Track availability and maintenance restrictions.

==================================================
37. WEIGHBRIDGE
==================================================

Prepare adapters for:

- RS-232.
- RS-485.
- IP-connected devices.
- RFID.
- Tare master.
- Stable-weight detection.
- Inbound weighing.
- Outbound weighing.
- Tickets.
- Gate integration.
- Inventory updates.
- Billing updates.
- Anomaly detection.

Do not claim hardware integration without real hardware,
working drivers or adapters, and verified tests.

==================================================
38. MAINTENANCE AND ASSETS
==================================================

Support:

- Vehicles.
- Production equipment.
- Pumps.
- Weighbridge equipment.
- Other plant assets.
- Preventive maintenance.
- Corrective maintenance.
- Work orders.
- Spare parts.
- Labor.
- Downtime.
- Maintenance costs.
- Equipment availability.
- Service history.

Define maintenance intervals based on the relevant
asset requirements.

Do not assume every maintenance interval is identical.

Support cost analysis by asset, plant, and period.

==================================================
39. ACCOUNTING
==================================================

Build an accounting model that supports proper
double-entry bookkeeping.

Core entities:

- Chart of accounts.
- Journal entries.
- Journal lines.
- Customers.
- Suppliers.
- Invoices.
- Invoice items.
- Payments.
- Payment allocations.
- Deposits.
- Retention.
- Cash accounts.
- Cash transactions.
- Bank accounts.
- Bank transactions.
- Bank reconciliation.
- Cheques.
- Cheque movements.
- Fixed assets.
- Depreciation schedules.
- Loans.
- Loan installments.
- Expenses.
- Budgets.
- Tax configuration.
- Exchange rates.
- General ledger.

Every posted journal entry must satisfy:

Total Debits = Total Credits.

The system must reject unbalanced posting.

Derived balances must not be manually editable.

Support:

- Customer statements.
- Supplier statements.
- Accounts receivable.
- Accounts payable.
- Cash movement.
- Bank movement.
- Trial balance.
- General ledger.
- Profit and loss.
- Balance sheet.
- Cash-flow reporting.
- Budget versus actual.
- Profitability by customer, project, order, mix, plant,
  and reporting period.

Define posting rules for each transaction type.

Distinguish:

- Draft.
- Approved.
- Posted.
- Reversed.
- Cancelled where permitted.

Posted financial transactions must not be silently edited.

Use reversal or adjustment entries.

==================================================
40. PAYMENTS AND RECONCILIATION
==================================================

Support:

- Cash receipts.
- Bank receipts.
- Customer payments.
- Supplier payments.
- Payment allocations.
- Customer advances.
- Supplier advances.
- Partial payments.
- Unallocated payments.
- Cheque lifecycle.
- Bank reconciliation.

Payment allocation must not exceed the amount available
for allocation.

Prevent duplicate payment posting.

Support FIFO allocation as an option, not as an
unconditional universal accounting rule.

Provide an auditable payment correction workflow.

==================================================
41. FIXED ASSETS AND LOANS
==================================================

Support:

- Asset register.
- Acquisition cost.
- Useful life.
- Residual value.
- Depreciation method.
- Accumulated depreciation.
- Disposal.
- Asset transfers.
- Loan principal.
- Interest.
- Installments.
- Repayment status.

Support straight-line and declining-balance depreciation
where applicable.

Define the calculation and posting treatment.

Do not confuse an asset's purchase price with its
current net book value.

Do not confuse loan principal with interest expense.

==================================================
42. TAX AND REGULATORY CONFIGURATION
==================================================

Tax treatment must be configurable for the relevant
jurisdiction and effective period.

Do not hard-code tax rates without a verified source.

Record:

- Rule.
- Jurisdiction.
- Rate.
- Effective date.
- Applicability.
- Reference.
- Approval status.

Do not claim legal or tax compliance merely because
a configurable tax field exists.

==================================================
43. HR AND PAYROLL
==================================================

Support:

- Employees.
- Employee documents.
- Attendance.
- Shifts.
- Shift handover.
- Overtime requests.
- Salary structures.
- Payroll runs.
- Salary payments.
- Salary advances.
- Insurance configuration.
- Tax configuration.
- Role-restricted visibility.

Restrict access to sensitive employee information.

Use synthetic demo data only.

Do not claim compliance with employment or payroll
requirements without verified applicable rules.

==================================================
44. ENVIRONMENTAL AND RECYCLING MODULES
==================================================

Support:

- Washout stations.
- Returned concrete.
- Reclaimed water.
- Reclaimed aggregates.
- Non-structural reuse.
- Dump and diversion destinations.
- Waste quantities.
- Water usage.
- Dust.
- Noise.
- Permits.
- Permit expiry.
- Compliance exceptions.
- Supporting documents.
- Corrective actions.

Do not treat reclaimed materials as automatically
acceptable for structural concrete.

Any usage rule must follow the applicable approved
engineering requirements.

Do not enforce a universal reclaimed-water percentage
as a code requirement without evidence.

==================================================
45. PREDICTIVE MAINTENANCE
==================================================

Prepare data structures for:

- Sensor readings.
- Asset health.
- Failure history.
- Failure predictions.
- Work orders.
- Feature extraction.
- Model versions.
- Training metadata.
- Evaluation.
- Precision and recall.
- Drift monitoring.

If real sensor data and a validated model do not exist,
implement a clearly labeled rule-based demonstration.

Do not present simulated predictions as production AI.

==================================================
46. OPERATIONAL FORECASTING
==================================================

Prepare:

- Demand forecasting.
- Material requirements.
- Truck requirements.
- Resource optimization.
- Seasonal effects.
- Project demand signals.
- Reject-load prevention.
- Forecast confidence.
- Actual-versus-forecast analysis.

Display data freshness and confidence.

Record model versions where models are used.

Do not present a forecast as a confirmed fact.

==================================================
47. NOTIFICATIONS
==================================================

Prepare a notification framework for:

- In-app notifications.
- Email.
- SMS.
- WhatsApp Business API.
- Push notifications.

Support:

- Arabic and English templates.
- Parameters.
- Delivery attempts.
- Retry.
- Failure logs.
- User preferences.
- Consent and opt-out where applicable.

Do not claim external messages were delivered without
an actual configured provider and verified result.

==================================================
48. OFFLINE OPERATIONS
==================================================

Design offline support according to the actual capabilities
of the chosen architecture.

Possible local technologies include browser storage,
IndexedDB, or a suitable local database.

Do not assume that offline capability exists merely
because local data can be displayed.

Document:

- Which screens work offline.
- Which operations can be created offline.
- Which data is stored locally.
- Local data protection.
- Synchronization behavior.
- Retry behavior.
- Conflict resolution.
- Data retention.
- Recovery after application restart.

Support, where feasible:

- Local writes.
- Synchronization queue.
- Conflict queue.
- Idempotency keys.
- Retry with backoff.
- Last successful synchronization.
- Manual retry.
- Per-record error details.

Do not use Last-Write-Wins or Server-Wins as universal
conflict-resolution policies.

Financial operations must preserve transaction identity
and must not be silently discarded.

Inventory balances must be recomputed from validated
movements.

Unsafe conflicts require explicit resolution.

Distinguish:

- Locally saved.
- Pending synchronization.
- Synchronized.
- Rejected.
- Conflict detected.
- Resolution required.

Test reconnects, duplicate submissions, failed retries,
concurrent updates, and application restarts.

==================================================
49. MULTI-PLANT MANAGEMENT
==================================================

Support the future management of multiple plants.

Include:

- Plant register.
- Plant capacity.
- Plant-specific inventory.
- Plant-specific permissions.
- Plant-specific pricing where applicable.
- Plant staff.
- Interplant transfers.
- Consolidated reporting.
- Cross-plant comparison.
- Resource allocation.
- Load balancing.

A user must see only the plants and records authorized
for that user.

Consolidated reports must not double-count interplant
transfers or internal transactions.

==================================================
50. CUSTOMER AND DRIVER PORTALS
==================================================

Prepare future support for a customer portal containing:

- Orders.
- Delivery status.
- ETA when connected.
- Delivery tickets.
- Proof of delivery.
- Invoices.
- Payments.
- Quality certificates.
- Downloadable reports.

Prepare a driver application interface for:

- Assigned trips.
- Trip status.
- Navigation handoff.
- Offline proof of delivery.
- Signature.
- Photos.
- Added-water record.
- Synchronization status.

Prepare laboratory workflows for:

- Sampling.
- Tests.
- Photos.
- Batch and order linkage.
- Offline entry where supported.
- Synchronization.

Do not expose internal company data to external users.

==================================================
51. EXCEL GENERATOR
==================================================

Create a real, portable Excel generator.

Preferred repository structure:

excel_generator/
    generate_workbook.py
    config.py
    requirements.txt
    IConcrete_Generator.ipynb
    README_AR.md
    README_EN.md
    tests/
        test_workbook.py
    output/
        .gitkeep
    sample_input/

docs/
    EXCEL_GENERATOR_CHANGELOG.md
    DATA_DICTIONARY.md
    VALIDATION_RULES.md
    MIGRATION_TO_WEB.md
    IMPORT_EXPORT_MAP.md

Use Python and an appropriate spreadsheet library
only if the required runtime and dependencies are available.

The generator must be designed to run locally and,
where supported, in a hosted notebook environment.

It must:

- Generate a genuine XLSX file.
- Use timestamped output filenames.
- Avoid overwriting earlier output.
- Support Arabic RTL.
- Provide English labels.
- Separate input cells from calculated cells.
- Use structured tables.
- Use filters.
- Use freeze panes.
- Use dropdown validation.
- Use conditional formatting.
- Protect formula cells where appropriate.
- Include charts where supported.
- Include documentation.
- Include schema version.
- Include a data dictionary.
- Include validation reporting.
- Include import/export mapping.
- Include web migration guidance.
- Separate synthetic data from real data.

Never claim an XLSX file was generated unless the file
was actually created and validated.

Never execute uploaded macros.

Never trust uploaded spreadsheet formulas as business logic.

Validate uploaded file type and size.

Do not silently overwrite business records during import.

Document differences between spreadsheet engines.

A formula being present in a cell does not prove that
the formula has been calculated correctly.

Test formulas independently.

==================================================
52. EXCEL WORKBOOK STRUCTURE
==================================================

The workbook must evolve toward a comprehensive system
mirror, but must be implemented in dependency order.

Do not generate more worksheets than can be meaningfully
implemented and tested.

Initial workbook group:

Control:
- Cover_Login.
- README.
- Settings_Lists.
- Data_Dictionary.
- Validation_Report.
- Audit_Log_Local.
- Import_Export_Map.
- Migration_to_Web_App.
- Schema_Version.

Organization:
- Companies.
- Plants.
- Users_Roles.
- Permissions_Matrix.
- Documents_Register.

Reporting:
- Dashboard.
- General_Balance.
- Reports.
- KPI_Summary.
- Alerts_Center.

Customer operations:
- Customers.
- Projects.
- Concrete_Orders.
- Order_Items.

Subsequent workbook modules may include:

Finance:
- Suppliers.
- Invoices.
- Invoice_Items.
- Customer_Payments.
- Supplier_Bills.
- Cash_Accounts.
- Cash_Transactions.
- Bank_Accounts.
- Bank_Transactions.
- Bank_Reconciliation.
- Cheques.
- Cheque_Movements.
- Fixed_Assets.
- Depreciation_Schedule.
- Loans.
- Loan_Installments.
- Journal_Entries.
- Journal_Entry_Lines.
- GL_Accounts.
- General_Ledger.
- Expenses.
- Budgets.

Production:
- Mix_Designs.
- Material_Densities.
- Moisture_Readings.
- Moisture_Corrections.
- Batches.
- Batch_Target_Actual.
- Production_Queue.
- Waste_Tracking.
- Toll_Batching.

Fleet:
- Trucks.
- Drivers.
- Trips.
- Dispatch_Queue.
- Dispatch_Assignments.
- Fuel_Transactions.
- Maintenance_Records.
- Water_Additions.
- Dump_Divert.

Quality:
- Lab_Equipment.
- Calibration_Records.
- Mix_Submissions.
- Trial_Batch_Reports.
- Quality_Tests.
- Cube_Cylinders.
- Nonconformance_Reports.
- Corrective_Actions.
- SPC_Control_Limits.
- SPC_Data_Points.
- Quality_Certificates.
- Test_Plans.
- Test_Execution_Schedule.

Inventory and procurement:
- Materials.
- Material_Receipts.
- Inventory_Movements.
- Inventory_Snapshot.
- Reorder_Levels.
- Purchase_Requests.
- Purchase_Orders.
- Goods_Receipts.
- Three_Way_Match.
- Parts_Inventory.

Advanced modules:
- Employees.
- Attendance.
- Shifts.
- Payroll_Runs.
- Pumps.
- Pump_Assignments.
- Pumping_Jobs.
- Weighment_Transactions.
- Sensors.
- Sensor_Readings.
- Demand_Forecasts.
- Returned_Concrete.
- Reclaimed_Water.
- Permits.
- Notification_Log.
- Sync_Queue.
- Conflict_Queue.
- Interplant_Transfers.
- Consolidated_Reporting.

Additional sheets may be added when their data contracts
and implementation requirements are defined.

This list is a roadmap, not permission to create empty sheets.

Every implemented worksheet must declare one status:

- Functional.
- Formula-driven.
- Validated template.
- Integration ready.
- Not implemented.

==================================================
53. EXCEL DATA CONTRACTS
==================================================

Before generating each worksheet, define:

- Business purpose.
- Primary key.
- Required fields.
- Optional fields.
- Foreign keys.
- Allowed values.
- Units.
- Formula dependencies.
- Validation rules.
- Source of truth.
- Import/export behavior.
- Test cases.

Validate:

- Required worksheets.
- Table structures.
- Unique IDs.
- Broken references.
- Formula consistency.
- Dropdown sources.
- Named ranges.
- Input/formula separation.
- Schema compatibility.
- Relationship integrity.

Do not use worksheet protection as a substitute
for authentication or strong access control.

==================================================
54. WEB/EXCEL INTEGRATION
==================================================

When a backend exists, the database is the source of truth.

Exports must contain appropriate metadata:

- Company ID.
- Plant ID.
- Export timestamp.
- Schema version.
- Template version.

Import workflow:

Upload
→ File validation
→ Schema validation
→ Preview
→ Data validation
→ Change summary
→ Explicit commit
→ Audit record
→ Final report.

Show:

- Inserted records.
- Updated records.
- Rejected records.
- Unchanged records.
- Conflicting records.

Do not silently overwrite records.

Do not execute uploaded macros.

Do not trust uploaded formulas.

Use idempotency keys where appropriate.

Create a downloadable error report.

Support CSV import where feasible.

Support XLSX import only when the actual implementation
supports it.

If XLSX functionality is unavailable, state the limitation.

Never label a file operation successful unless it completed
and the resulting records or file were verified.

==================================================
55. IMPORT VALIDATION
==================================================

Validate all imported business records.

Required checks may include:

- Duplicate IDs.
- Missing required fields.
- Invalid data types.
- Invalid dates.
- Invalid currency.
- Invalid units.
- Broken references.
- Invalid statuses.
- Unauthorized records.
- Tenant mismatch.
- Plant mismatch.
- Negative inventory.
- Invalid financial entries.
- Duplicate transaction submission.
- Schema incompatibility.
- Unsupported file types.
- Oversized files.

Validation must produce actionable errors.

Where practical, retain the user's original entered data
for review rather than silently replacing it.

Do not apply invalid records as if they were valid.

Allow safe records to be processed only when the import
design explicitly supports partial commits and the user
understands the outcome.

Otherwise, reject the transaction atomically.

==================================================
56. TESTING STRATEGY
==================================================

Create a layered test strategy.

Unit tests:
- Pure business calculations.
- Validation rules.
- Financial arithmetic.
- Unit conversions.
- Status transitions.
- Permission decisions.

Integration tests:
- Database operations.
- Transaction boundaries.
- Foreign-key integrity.
- Imports and exports.
- Audit creation.
- Financial posting.
- Inventory movement.

API tests where an API exists:
- Authentication.
- Authorization.
- Tenant isolation.
- Input validation.
- Error handling.
- Idempotency.

End-to-end tests:
- Critical user workflows.
- Navigation.
- Record creation and editing.
- Dashboard updates.
- Reports.
- Import preview.
- Import commit.
- Excel download.

Operational tests:
- Busy dispatch workflow.
- Multiple orders.
- Partial deliveries.
- Failed loads.
- Quality failures.
- Inventory shortages.
- Maintenance restrictions.
- Shift handover.

Reliability tests:
- Restart.
- Network loss.
- Retry.
- Duplicate submission.
- Concurrent operations.
- Database interruption.
- Backup restoration.

Security tests:
- Unauthorized access.
- Cross-tenant access.
- Cross-plant access.
- Input validation.
- Upload handling.
- Session handling.
- Secret exposure.

Performance tests:
- Representative dataset sizes.
- Search.
- Filtering.
- Pagination.
- Report generation.
- Import processing.

Offline tests where supported:
- Local persistence.
- Reconnection.
- Conflict handling.
- Retry.
- Idempotency.
- Financial transaction preservation.

Never claim a performance target has been achieved
without a reproducible benchmark.

Never claim a security property merely because
a relevant library has been installed.

==================================================
57. PHASE 1 ACCEPTANCE GATE
==================================================

Phase 1 must not be accepted based on the number
of screens, components, or files created.

The goal is a coherent, demonstrably working foundation.

Mandatory criteria:

1. All implemented routes load without runtime errors.
2. All active navigation items lead to valid destinations.
3. Every visible action works or is explicitly disabled
   with a clear explanation.
4. Customer records use a consistent data model.
5. Customer lists, details, and supported reports read
   from the same data source.
6. Creating or editing a customer updates all relevant
   views according to the chosen architecture.
7. Dashboard metrics are derived from underlying data.
8. Synthetic demo data is clearly identified.
9. CSV import includes validation and preview.
10. Imports do not silently overwrite or duplicate records.
11. The Excel generator creates a genuine XLSX file if
    the actual runtime supports the required dependencies.
12. Unsupported features are documented honestly.
13. Tests are actually executed and results recorded.
14. Known issues are documented.
15. No later-phase feature is represented as operational
    merely because a page or schema exists.

If a criterion cannot be executed, mark it BLOCKED
or NOT TESTED and explain why.

Do not hide failed tests.

==================================================
58. ERROR HANDLING AND OBSERVABILITY
==================================================

Provide consistent error handling.

Errors must be:

- Understandable.
- Actionable.
- Logged where appropriate.
- Safe to display.
- Free from leaked secrets.

Do not expose stack traces or confidential database
details to ordinary users.

Where supported, provide:

- Structured logs.
- Correlation IDs.
- Health checks.
- Error monitoring.
- Performance measurements.
- Import failure logs.
- Synchronization failure logs.

Document any monitoring that is unavailable because
the free infrastructure does not support it.

==================================================
59. BACKUP AND RECOVERY
==================================================

Document a realistic backup and recovery plan.

Include:

- What data is backed up.
- How often backups occur.
- Where backups are stored.
- Retention.
- Encryption where supported.
- Restoration steps.
- Restoration verification.
- Known recovery limitations.

Do not assume that the hosting provider's database
is automatically backed up.

Do not claim a recovery time or recovery point objective
without evidence that the architecture supports it.

==================================================
60. ACCESSIBILITY AND RESPONSIVE TESTING
==================================================

Test:

- Desktop.
- Tablet.
- Mobile.
- Arabic RTL.
- English LTR.
- Keyboard navigation.
- Visible focus.
- Contrast.
- Screen-reader labels where applicable.
- Form errors.
- Table overflow.
- Long Arabic labels.
- Loading states.
- Empty states.

Operational screens must prioritize speed and clarity.

A dispatch workflow must not require unnecessary
navigation during a busy production period.

Measure common workflows where practical.

==================================================
61. COMMERCIAL READINESS
==================================================

Do not declare ICONCRETE commercially ready solely
because the interface looks professional.

Evaluate:

- Installation.
- Configuration.
- Data import.
- Customer onboarding.
- Plant setup.
- Mix setup.
- Material setup.
- User permissions.
- Staff training.
- Support.
- Backups.
- Recovery.
- Security.
- Operational acceptance.
- Pricing assumptions.
- Deployment costs.
- Customer value.

Distinguish between:

- Prototype.
- Demonstration.
- Pilot.
- Operational release.
- Commercial release.

Do not charge for or promise functionality that
has not been demonstrated.

Prepare a pilot workflow for one plant before assuming
that multi-plant deployment is operationally safe.

==================================================
62. IMPLEMENTATION PHASES
==================================================

Implement the product in controlled phases.

Do not attempt to implement the entire ERP in one pass.

Do not begin a later phase automatically.

PHASE 1 — FOUNDATION

Implement:

- Environment inspection.
- Architecture documentation.
- Design system.
- Arabic RTL and English LTR.
- Application shell.
- Login/demo authentication structure.
- Company and plant foundation.
- Users and permission structure.
- Customer management.
- Project management foundation.
- Basic order foundation.
- Dashboard.
- Reports foundation.
- Excel Integration Center.
- Initial Excel generator.
- CSV import and validation.
- Synthetic demo data.
- Audit structure.
- Automated tests.
- Documentation.
- Git-ready project structure.

Phase 1 must have meaningful working functionality.

It must not be a collection of empty module pages.

PHASE 2 — CORE OPERATIONS

Implement:

- Accounting.
- Mix design.
- Batching.
- Quality and laboratory.
- Fleet and dispatch.

Prioritize end-to-end integration.

PHASE 3 — MATERIALS AND COMMERCIAL OPERATIONS

Implement:

- Inventory.
- Orders and distribution.
- Sales and CRM.
- Procurement.
- Supplier workflows.

PHASE 4 — ASSET AND WORKFORCE OPERATIONS

Implement:

- HR and payroll.
- Pumps.
- Weighbridge adapters.
- Maintenance.
- Spare parts.

PHASE 5 — ADVANCED OPERATIONS

Implement:

- Forecasting.
- Recycling.
- Environmental monitoring.
- Notifications.
- Analytics.
- Predictive maintenance foundations.

PHASE 6 — CONNECTED ECOSYSTEM

Implement:

- Offline synchronization.
- Multi-plant consolidation.
- Customer portal.
- Driver workflows.
- Laboratory workflows.
- External integrations.

The phase boundaries may be adjusted only when
a documented dependency or measurable benefit justifies it.

Do not remove required modules silently.

==================================================
63. PHASE COMPLETION REPORT
==================================================

At the end of each phase, report:

1. Files created.
2. Files modified.
3. Features implemented.
4. Features verified.
5. Features not implemented.
6. Environment limitations.
7. Database changes.
8. Excel worksheets created.
9. Excel worksheets missing.
10. Validation rules implemented.
11. Tests executed.
12. Exact commands executed.
13. Actual test results.
14. Known issues.
15. Security limitations.
16. Performance limitations.
17. Free-tier limitations.
18. Deployment status.
19. Rollback instructions.
20. Recommended next phase.

Never report a test as passed unless it was executed.

Never report deployment success unless deployment
actually occurred.

Never report synchronization as working unless
records were actually synchronized and verified.

Never report production readiness without passing
the applicable acceptance gates.

==================================================
64. REPOSITORY REQUIREMENTS
==================================================

Prepare a clean, portable repository.

Include appropriate files such as:

- .gitignore.
- .env.example.
- LICENSE.
- README.md.
- README_AR.md.
- Documentation.
- Database migrations.
- Tests.
- Excel generator.
- Sample synthetic data.
- Build instructions.
- Deployment instructions.
- Backup instructions.
- Rollback instructions.
- Known limitations.
- Architecture decisions.
- Change log.

Use an appropriate open-source license only after
considering the intended distribution and dependencies.

Do not assume every dependency permits unrestricted
commercial use.

Never commit:

- Production secrets.
- Real passwords.
- API keys.
- Confidential customer data.
- Real employee personal data.
- Local production databases.
- Unintended generated files.

Do not commit generated Excel outputs by default.

Provide reproducible instructions to generate them.

==================================================
65. DEPLOYMENT AND ROLLBACK
==================================================

Use the deployment method supported by the actual
environment and chosen free infrastructure.

Document:

- Build command.
- Test command.
- Environment variables.
- Database setup.
- Migration command.
- Deployment command.
- Verification steps.
- Rollback steps.

Do not expose secrets in client bundles or repository files.

Do not deploy untested database migrations without
an appropriate recovery strategy.

Verify the deployed application through actual requests
or browser tests where available.

A successful build is not proof of a successful deployment.

A successful deployment is not proof of correct business logic.

==================================================
66. FINAL RELEASE GATES
==================================================

Before any production release, evaluate these gates:

1. Functional completeness.
2. Engineering and calculation correctness.
3. Data integrity.
4. Real operational workflow acceptance.
5. Reliability and recovery.
6. Security.
7. Performance.
8. Usability and accessibility.
9. Deployment and rollback.
10. Commercial value and support readiness.

For each gate, report:

- PASS.
- FAIL.
- BLOCKED.
- NOT TESTED.
- NOT APPLICABLE, with justification.

Do not release when a critical safety, financial,
security, or data-integrity failure remains unresolved.

Do not represent unverified engineering rules as approved.

==================================================
67. START NOW
==================================================

First inspect the actual environment.

Then produce a concise environment audit and architecture
decision record.

Implement Phase 1 only.

Prioritize a coherent working product over a large
collection of unfinished features.

Use free and open-source tools where practical.

Avoid mandatory paid subscriptions.

Do not ask the user to reconfirm locked identity decisions.

Do not fabricate capabilities.

Do not silently remove requirements.

Do not begin Phase 2 automatically.

Begin implementation now.

==================================================
68. IMPLEMENTATION INTEGRITY RULES
==================================================

A. SINGLE SOURCE OF TRUTH

Do not maintain independent copies of the same business
fact in unrelated components.

For example, a customer balance must not be separately
hard-coded in the dashboard, customer page, and report.

Define the source of truth and calculate derived values
consistently.

B. REAL NAVIGATION

Every active menu item must open the correct screen.

Every supported dashboard metric must navigate to the
corresponding detailed records.

C. NO FAKE INTEGRATIONS

A map with sample markers is not live GPS.

A generated message is not proof of delivery.

A database schema is not a functioning integration.

A prediction generated from fixed demonstration values
is not a trained forecasting model.

Label simulations clearly.

D. SAFE DEFAULTS

When a required engineering or financial rule is unknown,
do not invent a universal threshold.

Use a documented configurable rule or mark the operation
as requiring review.

E. TRACEABILITY

Every important financial, production, and quality result
must be traceable to its underlying source records.

F. REVERSIBILITY

Important changes must have a documented correction
or rollback path where appropriate.

G. MEASURABLE QUALITY

Use tests and acceptance criteria instead of statements
such as "professional," "complete," or "enterprise-grade."

H. MINIMAL COMPLEXITY

Do not introduce unnecessary infrastructure merely
to make the architecture appear sophisticated.

Choose the simplest design that satisfies the current
requirements and preserves the next migration path.

I. DOCUMENTED ASSUMPTIONS

Record unresolved assumptions in:

docs/ASSUMPTIONS.md

Record issues and gaps in:

docs/ISSUES_AND_GAPS.md

Record important design decisions in:

docs/ARCHITECTURE_DECISIONS.md

J. NO FALSE COMPLETION

A placeholder must remain labeled as a placeholder.

An untested feature must remain labeled as untested.

A simulated integration must remain labeled as simulated.

A future architecture must not be presented as an
existing implementation.

K. USER DATA SAFETY

Do not destroy existing project files or business data
without explicit authorization.

Prefer incremental, reversible changes.

Preserve existing functionality unless a documented
defect or approved requirement justifies changing it.

L. COMMERCIAL REALISM

Do not add a feature merely because it is technically
possible.

Prioritize features that solve a demonstrated user
problem and improve operational accuracy, reduce waste,
save time, improve traceability, or protect revenue.

END OF MASTER SPECIFICATION.
