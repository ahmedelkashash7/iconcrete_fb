import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BRAND } from '../brand';
import { formatMoney, formatNumber } from '../core/money';
import type { Lang } from '../types';

const PALETTE = [
  BRAND.colors.primary,
  BRAND.colors.accent,
  BRAND.colors.secondary,
  BRAND.colors.success,
  BRAND.colors.warning,
  BRAND.colors.danger,
  '#7C3AED',
  '#0EA5E9',
];

export interface ChartPoint {
  label: string;
  value: number;
  color?: string;
}

export const DonutChart = ({
  points,
  lang,
  height = 260,
  currency = true,
}: {
  points: ChartPoint[];
  lang: Lang;
  height?: number;
  currency?: boolean;
}) => (
  <ResponsiveContainer width="100%" height={height}>
    <PieChart>
      <Pie data={points} dataKey="value" nameKey="label" innerRadius="52%" outerRadius="82%" paddingAngle={2} stroke="none">
        {points.map((point, index) => (
          <Cell key={point.label} fill={point.color ?? PALETTE[index % PALETTE.length]} />
        ))}
      </Pie>
      <Tooltip
        formatter={(value) =>
          currency ? formatMoney(Number(value), lang) : formatNumber(Number(value), lang, 2)
        }
        contentStyle={{ borderRadius: 10, borderColor: '#E2E8F0', fontFamily: 'inherit' }}
      />
      <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'inherit' }} />
    </PieChart>
  </ResponsiveContainer>
);

export const TrendLine = ({
  points,
  lang,
  currency = false,
  color = BRAND.colors.primary,
  height = 260,
  unit,
}: {
  points: ChartPoint[];
  lang: Lang;
  currency?: boolean;
  color?: string;
  height?: number;
  unit?: string;
}) => (
  <ResponsiveContainer width="100%" height={height}>
    <LineChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} reversed={lang === 'ar'} />
      <YAxis
        tick={{ fontSize: 11, fill: '#64748B' }}
        orientation={lang === 'ar' ? 'right' : 'left'}
        width={70}
        tickFormatter={(value) =>
          currency
            ? new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-EG', { notation: 'compact' }).format(Number(value))
            : formatNumber(Number(value), lang, 0)
        }
      />
      <Tooltip
        formatter={(value) =>
          currency ? formatMoney(Number(value), lang) : `${formatNumber(Number(value), lang, 2)}${unit ? ` ${unit}` : ''}`
        }
        contentStyle={{ borderRadius: 10, borderColor: '#E2E8F0', fontFamily: 'inherit' }}
      />
      <Line type="monotone" dataKey="value" stroke={color} strokeWidth={3} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
    </LineChart>
  </ResponsiveContainer>
);

export const VolumeBars = ({
  points,
  lang,
  color = BRAND.colors.accent,
  height = 260,
  unit = 'm³',
}: {
  points: ChartPoint[];
  lang: Lang;
  color?: string;
  height?: number;
  unit?: string;
}) => (
  <ResponsiveContainer width="100%" height={height}>
    <BarChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
      <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} reversed={lang === 'ar'} />
      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} orientation={lang === 'ar' ? 'right' : 'left'} width={56} />
      <Tooltip
        formatter={(value) => `${formatNumber(Number(value), lang, 1)} ${unit}`}
        contentStyle={{ borderRadius: 10, borderColor: '#E2E8F0', fontFamily: 'inherit' }}
      />
      <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={42} />
    </BarChart>
  </ResponsiveContainer>
);
