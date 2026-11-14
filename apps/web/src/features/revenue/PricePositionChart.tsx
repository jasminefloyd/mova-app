import type { PriceEvidenceDetails } from './price-pilot-model';

export function PricePositionChart({ evidence, current, formatPrice, label, rangeLabel, currentLabel }: {
  evidence: PriceEvidenceDetails;
  current: number;
  formatPrice: (minor: number) => string;
  label: string;
  rangeLabel: string;
  currentLabel: string;
}) {
  const min = Math.min(evidence.marketMin, current);
  const max = Math.max(evidence.marketMax, current);
  const span = Math.max(1, max - min);
  const position = (value: number) => `${Math.max(0, Math.min(100, ((value - min) / span) * 100))}%`;
  return <div className="mova-price-pilot__position" role="img" aria-label={label}>
    <div className="mova-price-pilot__position-values"><span>{formatPrice(evidence.marketMin)}</span><span>{formatPrice(evidence.marketMax)}</span></div>
    <div className="mova-price-pilot__position-track">
      <span className="mova-price-pilot__position-band" style={{ left: position(evidence.low), width: `${Math.max(1, ((evidence.high - evidence.low) / span) * 100)}%` }} />
      <span className="mova-price-pilot__position-median" style={{ left: position(evidence.median) }} />
      <span className="mova-price-pilot__position-current" style={{ left: position(current) }} />
    </div>
    <div className="mova-price-pilot__position-legend"><span><i className="is-range" />{formatPrice(evidence.low)}–{formatPrice(evidence.high)} · {rangeLabel}</span><span><i className="is-current" />{currentLabel} · {formatPrice(current)}</span></div>
  </div>;
}
