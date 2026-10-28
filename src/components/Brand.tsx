import { BRAND } from '../brand';

interface BrandLogoProps {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  withTagline?: boolean;
}

/** Typographic placeholder logo — replaceable later through logo_doc_id. */
export const BrandLogo = ({ variant = 'dark', size = 'md', withTagline = true }: BrandLogoProps) => (
  <div className={`brand brand--${variant} brand--${size}`}>
    <span className="brand__mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="presentation" focusable="false">
        <defs>
          <linearGradient id="brandGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={BRAND.colors.primary} />
            <stop offset="100%" stopColor={BRAND.colors.accent} />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#brandGradient)" />
        <path d="M30 14.5a10.5 10.5 0 1 0 0 19" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <circle cx="33" cy="24" r="3.4" fill="#fff" />
      </svg>
    </span>
    <span className="brand__text">
      <span className="brand__name">{BRAND.name}</span>
      {withTagline ? <span className="brand__tagline">{BRAND.tagline}</span> : null}
    </span>
  </div>
);
