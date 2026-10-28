import type { ReactNode } from 'react';

export const Card = ({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`card ${className}`.trim()}>
    {title || actions ? (
      <header className="card__header">
        <div>
          {title ? <h2 className="card__title">{title}</h2> : null}
          {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="card__actions no-print">{actions}</div> : null}
      </header>
    ) : null}
    <div className="card__body">{children}</div>
  </section>
);

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'purple';

export const Badge = ({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) => (
  <span className={`badge badge--${tone}`}>{children}</span>
);

export const StatCard = ({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'danger' | 'warning' | 'purple';
}) => (
  <div className={`stat stat--${tone}`}>
    <span className="stat__label">{label}</span>
    <span className="stat__value">{value}</span>
    {hint ? <span className="stat__hint">{hint}</span> : null}
  </div>
);

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'start' | 'end';
  render?: (row: T) => ReactNode;
  width?: string;
}

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  empty,
  dense = false,
  footer,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty: string;
  dense?: boolean;
  footer?: ReactNode;
}) => {
  if (rows.length === 0) {
    return <div className="empty-state">{empty}</div>;
  }
  return (
    <div className={`table-wrap ${dense ? 'table-wrap--dense' : ''}`.trim()}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={column.width ? { width: column.width } : undefined} className={`align-${column.align ?? 'start'}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} className={`align-${column.align ?? 'start'}`}>
                  {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
};

export const LoadingBlock = ({ label }: { label: string }) => (
  <div className="loading-block" role="status">
    <span className="spinner" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export const ErrorNote = ({ children }: { children: ReactNode }) => (
  <div className="error-note" role="alert">
    {children}
  </div>
);

export const InfoNote = ({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'purple' }) => (
  <div className={`info-note info-note--${tone}`}>{children}</div>
);

export const SectionTitle = ({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: ReactNode }) => (
  <div className="section-title">
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
    {badge ? <div className="section-title__badge">{badge}</div> : null}
  </div>
);
