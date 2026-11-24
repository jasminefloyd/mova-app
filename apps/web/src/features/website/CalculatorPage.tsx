import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MetaFunction } from 'react-router';
import { ButtonLink, Eyebrow, JsonLd, useSiteShell } from './parts';
import { breadcrumbLd, calculatorLd, pageMeta, shellFromMatches } from './seo';
import {
  DEFAULT_INPUT, EVEN_YEARLY, PAYROLL_TAX, SE_BASE, SE_TAX, SETUPS, breakEven, breakEvenPair, formatDollars, formatHourly,
  readInput, series, verdict, week, workingWeeks, type CalculatorInput, type InputProblem, type Numbers, type Setup, type Verdict, type Week,
} from './calculator';
import { startCalculatorSignup, trackCalculatorUse } from './calculator-analytics';
import './calculator.css';

// W4·v2a (inputs and live results) and W4·v2b (full breakdown). English only (owner decision, Nov 24).
// Everything is computed in the browser; nothing typed here is sent anywhere.

export const meta: MetaFunction = ({ matches }) => pageMeta('calculator', shellFromMatches(matches));

const NAMES: Record<Setup, string> = { commission: 'Commission', booth: 'Booth rental', suite: 'Suite rental' };
const SHORT: Record<Setup, string> = { commission: 'Commission', booth: 'Booth', suite: 'Suite' };
const SUBS: Record<Setup, string> = { commission: 'Salon employee, often W-2', booth: 'Self-employed, shared salon', suite: 'Self-employed, your own room' };
const COLORS: Record<Setup, string> = { commission: '#8BA990', booth: '#C98F66', suite: 'var(--forest)' };
type Period = 'week' | 'month' | 'year';

const PROBLEM_TEXT: Record<InputProblem['kind'], string> = {
  missing: 'Fill in your weekly service revenue and hours to see results.',
  negative: 'Numbers can’t be negative.',
  percent: 'Percentages must be between 0 and 100.',
  weeks: 'Weeks off must be 51 or fewer.',
  hours: 'Hours a week must be between 1 and 100.',
};

const money = (value: number) => formatDollars(value);
const amount = (raw: string) => { const value = Number(raw); return raw.trim() && Number.isFinite(value) ? formatDollars(value) : '$0'; };

export default function CalculatorPage() {
  const { t } = useTranslation();
  const shell = useSiteShell();
  const [input, setInput] = useState<CalculatorInput>(DEFAULT_INPUT);
  const [open, setOpen] = useState(0);
  const [period, setPeriod] = useState<Period>('year');
  const read = readInput(input);
  const numbers = read.ok ? read.numbers : null;
  const selected = SETUPS.filter((s) => input.setups[s]);
  const weeks = numbers ? selected.map((s) => week(s, numbers)) : [];

  const update = (patch: Partial<CalculatorInput>) => {
    setInput((current) => {
      const next = { ...current, ...patch };
      if (readInput(next).ok) trackCalculatorUse();
      return next;
    });
  };
  const toggleSetup = (setup: Setup) => {
    if (input.setups[setup] && selected.length === 1) return; // keep at least one
    update({ setups: { ...input.setups, [setup]: !input.setups[setup] } });
  };

  return <div className="mova-calc">
    <JsonLd data={calculatorLd(shell)} />
    <JsonLd data={breadcrumbLd(shell, [[t('website.nav.calculator'), '/calculator']])} />
    <section className="mova-site__container mova-calc__hero" aria-labelledby="calc-h">
      <Eyebrow>Free calculator · no signup · full results</Eyebrow>
      <h1 id="calc-h" className="mova-site__h1">Commission, booth or suite? <span className="mova-site__accent">See what you really keep.</span></h1>
      <p className="mova-site__lead">After costs, taxes and time off.</p>
    </section>

    <section className="mova-site__container mova-calc__compare" aria-labelledby="calc-compare-h">
      <div className="mova-calc__compare-head"><h2 id="calc-compare-h">Compare</h2><span>Pick two or all three</span></div>
      <div className="mova-calc__picks">
        {SETUPS.map((setup) => <label key={setup} className="mova-calc__pick" data-on={input.setups[setup] || undefined}>
          <input type="checkbox" checked={input.setups[setup]} onChange={() => toggleSetup(setup)} />
          <span className="mova-calc__swatch" style={{ background: COLORS[setup] }} aria-hidden="true" />
          <span><strong>{NAMES[setup]}</strong><small>{SUBS[setup]}</small></span>
        </label>)}
      </div>
    </section>

    <section className="mova-site__container mova-calc__main" aria-label="Your numbers and results">
      <Steps input={input} update={update} open={open} setOpen={setOpen} selected={selected} problem={read.ok ? null : read.problem} />
      <Results id="results" weeks={weeks} numbers={numbers} period={period} setPeriod={setPeriod} problem={read.ok ? null : read.problem} />
    </section>

    {numbers && weeks.length > 0 && <Breakdown weeks={weeks} numbers={numbers} selected={selected} />}

    {!(numbers && weeks.length > 0) && <section className="mova-site__container" aria-labelledby="calc-next-h" style={{ paddingBottom: 'clamp(56px, 7vw, 96px)' }}>
      <div className="mova-site__cta">
        <div className="mova-site__cta-copy">
          <h2 id="calc-next-h">{t('website.calculator.nextTitle')}</h2>
          <p>{t('website.calculator.nextBody')}</p>
        </div>
        <ButtonLink to="/signup?from=calculator" onClick={startCalculatorSignup}>{t('website.calculator.startFree')}</ButtonLink>
      </div>
    </section>}

    {numbers && weeks.length > 0 && <aside className="mova-calc__bar" aria-label="Take-home a week">
      <span className="mova-calc__bar-head"><b>Take-home a week</b><a href="#results">See results ↑</a></span>
      <span className="mova-calc__bar-values">{weeks.map((w) => <span key={w.setup}><i style={{ background: COLORS[w.setup] }} aria-hidden="true" /><b>{money(w.takeHome)}</b> {SHORT[w.setup].toLowerCase()}</span>)}</span>
    </aside>}
  </div>;
}

/* ---------- Inputs (W4·v2a) ---------- */

type StepsProps = { input: CalculatorInput; update: (patch: Partial<CalculatorInput>) => void; open: number; setOpen: (step: number) => void; selected: Setup[]; problem: InputProblem | null };

function Steps({ input, update, open, setOpen, selected, problem }: StepsProps) {
  const [estimate, setEstimate] = useState<{ ticket: string; clients: string } | null>(null);
  const hasCommission = selected.includes('commission');
  const hasRental = selected.includes('booth') || selected.includes('suite');
  const num = (key: keyof CalculatorInput, label: string, opts: { unit?: '$' | '%'; hint?: ReactNode; required?: boolean } = {}) => {
    const id = `calc-${key}`;
    const value = input[key] as string;
    const invalid = problem?.field === key;
    return <div className="mova-calc__field">
      <label htmlFor={id}>{label}</label>
      <div className="mova-calc__input" data-invalid={invalid || undefined}>
        {opts.unit !== '%' && <span aria-hidden="true">$</span>}
        <input id={id} type="number" inputMode="decimal" min="0" max={opts.unit === '%' ? 100 : undefined} value={value}
          aria-invalid={invalid || undefined} aria-describedby={opts.hint ? `${id}-hint` : undefined}
          onChange={(event) => update({ [key]: event.currentTarget.value } as Partial<CalculatorInput>)} />
        {opts.unit === '%' && <span aria-hidden="true">%</span>}
      </div>
      {opts.hint && <small id={`${id}-hint`}>{opts.hint}</small>}
    </div>;
  };
  const segment = <T extends string>(label: string, value: T, options: Array<[T, string]>, onChange: (value: T) => void) =>
    <div className="mova-calc__seg-row"><span>{label}</span><div className="mova-calc__seg" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => <button key={key} type="button" role="radio" aria-checked={value === key} onClick={() => onChange(key)}>{text}</button>)}
    </div></div>;

  const rentWord = input.rentPeriod === 'month' ? 'a month' : 'a week';
  const steps: Array<{ title: string; summary: string; body: ReactNode; hidden?: boolean }> = [
    {
      title: 'Your income',
      summary: `${amount(input.revenue)} services · ${amount(input.tips)} tips a week`,
      body: <>
        <div className="mova-calc__fields">
          {num('revenue', 'Service revenue per week', { hint: estimate ? undefined : <>Not sure? <button type="button" className="mova-calc__link" onClick={() => setEstimate({ ticket: '', clients: '' })}>Estimate it</button>: average ticket × clients a week.</> })}
          {num('tips', 'Tips per week', { hint: 'Tips are taxable, so they count in every setup.' })}
        </div>
        {estimate && <div className="mova-calc__estimate">
          <div className="mova-calc__field"><label htmlFor="calc-ticket">Average ticket</label><div className="mova-calc__input"><span aria-hidden="true">$</span>
            <input id="calc-ticket" type="number" inputMode="decimal" min="0" value={estimate.ticket} onChange={(e) => { const next = { ...estimate, ticket: e.currentTarget.value }; setEstimate(next); fromEstimate(next, update); }} /></div></div>
          <div className="mova-calc__field"><label htmlFor="calc-clients">Clients a week</label><div className="mova-calc__input">
            <input id="calc-clients" type="number" inputMode="numeric" min="0" value={estimate.clients} onChange={(e) => { const next = { ...estimate, clients: e.currentTarget.value }; setEstimate(next); fromEstimate(next, update); }} /></div></div>
          <button type="button" className="mova-calc__link" onClick={() => setEstimate(null)}>Done</button>
        </div>}
      </>,
    },
    {
      title: 'Your time',
      summary: `${input.hours || '0'} hours a week · ${input.weeksOff || '0'} weeks off`,
      body: <div className="mova-calc__fields">
        {num('hours', 'Hours behind the chair per week', { hint: 'Used for your pay per hour.' })}
        {num('weeksOff', 'Weeks off per year', { hint: 'Vacation, sick days and education. A year counts 52 minus these.' })}
      </div>,
    },
    {
      title: 'Commission costs',
      summary: hasCommission ? `${input.split || '0'}% to the salon · ${input.commissionPay === 'w2' ? 'W-2' : '1099'}` : 'Not compared',
      hidden: !hasCommission,
      body: <>
        {segment('How the salon pays you', input.commissionPay, [['w2', 'W-2 employee'], ['1099', '1099 contractor']], (value) => update({ commissionPay: value }))}
        <div className="mova-calc__fields">
          {num('split', 'Salon’s commission cut', { unit: '%', hint: 'The share of service revenue the salon keeps.' })}
          {num('backbar', 'Product or backbar fee per week', { hint: 'Only if the salon charges you one.' })}
          {num('tools', 'Your own tools per week', { hint: 'Shears, irons and the like you buy yourself.' })}
        </div>
      </>,
    },
    {
      title: 'Booth and suite costs',
      summary: hasRental ? [selected.includes('booth') ? `Rent ${amount(input.boothRent)} booth` : null, selected.includes('suite') ? `${selected.includes('booth') ? '' : 'Rent '}${amount(input.suiteRent)} suite` : null].filter(Boolean).join(' · ') + ` ${rentWord}` : 'Not compared',
      hidden: !hasRental,
      body: <>
        {segment('Enter rent', input.rentPeriod, [['week', 'per week'], ['month', 'per month']], (value) => update({ rentPeriod: value }))}
        <div className="mova-calc__fields">
          {selected.includes('booth') && num('boothRent', `Booth rent ${rentWord}`)}
          {selected.includes('suite') && num('suiteRent', `Suite rent ${rentWord}`)}
          {num('products', 'Products and color per week', { hint: 'Booth and suite renters buy their own.' })}
          {num('cardFees', 'Card processing', { unit: '%', hint: 'Of service revenue.' })}
          {num('insurance', 'Insurance per week')}
          {num('license', 'License and renewals per week')}
          {num('software', 'Booking software per week')}
          {num('education', 'Education per week')}
          {num('otherCosts', 'Other costs per week', { hint: 'Marketing, laundry, supplies, anything else.' })}
        </div>
      </>,
    },
    {
      title: 'Taxes',
      summary: input.taxes ? `Estimate on · ${input.incomeTax || '0'}% set aside for income tax` : 'Estimate off',
      body: <>
        {segment('Estimate taxes', input.taxes ? 'on' : 'off', [['on', 'On'], ['off', 'Off']], (value) => update({ taxes: value === 'on' }))}
        {input.taxes && <div className="mova-calc__fields">
          {num('incomeTax', 'Set aside for income tax', { unit: '%', hint: '15% is a starting point. Change it to match your own tax rate.' })}
        </div>}
        <p className="mova-calc__note">Payroll tax ({(PAYROLL_TAX * 100).toFixed(2)}%) and self-employment tax ({(SE_TAX * 100).toFixed(1)}%) are worked out for you.</p>
      </>,
    },
    {
      title: 'Salon perks',
      summary: hasCommission ? (Number(input.perks) > 0 ? `${amount(input.perks)} a week` : 'None') : 'Not compared',
      hidden: !hasCommission,
      body: <div className="mova-calc__fields">
        {num('perks', 'Value of salon perks per week', { hint: 'Health insurance, paid time off, education or product the salon pays for. Shown next to commission, not in its cash.' })}
      </div>,
    },
  ];
  const visible = steps.map((step, index) => ({ ...step, index })).filter((step) => !step.hidden);
  const position = visible.findIndex((step) => step.index === open);

  return <div className="mova-calc__steps">
    <div className="mova-calc__progress" aria-hidden="true">
      <span>Step {Math.max(1, position + 1)} of {visible.length}</span>
      <span className="mova-calc__dots">{visible.map((step, i) => <i key={step.index} data-on={i <= position || undefined} />)}</span>
    </div>
    {visible.map((step, i) => {
      const isOpen = step.index === open;
      const next = visible[i + 1];
      return <div key={step.index} className="mova-calc__step" data-open={isOpen || undefined}>
        <h3>
          <button type="button" className="mova-calc__step-head" aria-expanded={isOpen} aria-controls={`calc-step-${step.index}`} onClick={() => setOpen(isOpen ? -1 : step.index)}>
            <span className="mova-calc__num">{i + 1}</span>
            <span className="mova-calc__step-title">{step.title}</span>
            <span className="mova-calc__step-sum">{step.summary}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={isOpen ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} /></svg>
          </button>
        </h3>
        {isOpen && <div id={`calc-step-${step.index}`} className="mova-calc__step-body">
          {step.body}
          <div className="mova-calc__step-actions">
            {next ? <button type="button" className="mova-calc__next" onClick={() => setOpen(next.index)}>Next: {next.title}</button>
              : <a className="mova-calc__next" href="#results" onClick={() => setOpen(-1)}>See results</a>}
          </div>
        </div>}
      </div>;
    })}
    {problem && <p role="alert" className="mova-site__error mova-calc__problem">{PROBLEM_TEXT[problem.kind]}</p>}
  </div>;
}

function fromEstimate(estimate: { ticket: string; clients: string }, update: (patch: Partial<CalculatorInput>) => void) {
  const ticket = Number(estimate.ticket); const clients = Number(estimate.clients);
  if (estimate.ticket.trim() && estimate.clients.trim() && Number.isFinite(ticket) && Number.isFinite(clients) && ticket >= 0 && clients >= 0) {
    update({ revenue: String(Math.round(ticket * clients)) });
  }
}

/* ---------- Live results (W4·v2a) ---------- */

function per(value: number, period: Period, n: Numbers) {
  return period === 'week' ? value : period === 'month' ? (value * workingWeeks(n)) / 12 : value * workingWeeks(n);
}

function verdictText(v: Verdict): { title: string; body: string } | null {
  if (v.kind === 'one') return { title: 'Pick another setup to compare', body: 'Choose two or all three above to see which keeps more.' };
  if (v.kind === 'even') return { title: 'About the same either way', body: `${NAMES[v.first]} and ${SHORT[v.second].toLowerCase()} are within ${money(EVEN_YEARLY)} a year of each other.` };
  if (v.kind === 'leader') return { title: `${NAMES[v.first]} keeps the most`, body: `${money(v.yearly)} a year more than ${SHORT[v.second].toLowerCase()}, after costs and estimated taxes.` };
  return { title: 'Close call. It depends on the perks.', body: `${NAMES[v.cashLeader]} pays ${money(v.cashYearly)} more a year in cash. Count the salon’s perks and commission comes out ${money(v.perksYearly)} ahead.` };
}

function Results({ id, weeks, numbers, period, setPeriod, problem }: { id: string; weeks: Week[]; numbers: Numbers | null; period: Period; setPeriod: (p: Period) => void; problem: InputProblem | null }) {
  const n = numbers;
  const top = n && weeks.length ? Math.max(...weeks.map((w) => per(w.takeHome + w.perks, period, n)), 1) : 1;
  const v = n ? verdictText(verdict(weeks, n)) : null;
  return <div id={id} className="mova-calc__results" aria-live="polite">
    <div className="mova-calc__results-head">
      <h2>Your take-home</h2>
      <div className="mova-calc__seg" role="radiogroup" aria-label="Show take-home per">
        {(['week', 'month', 'year'] as Period[]).map((p) => <button key={p} type="button" role="radio" aria-checked={period === p} onClick={() => setPeriod(p)}>{p[0]!.toUpperCase() + p.slice(1)}</button>)}
      </div>
    </div>
    <p className="mova-calc__note">{n ? `After costs and estimated taxes${period === 'week' ? '' : `, for ${workingWeeks(n)} working weeks`}.` : PROBLEM_TEXT[problem?.kind ?? 'missing']}</p>
    {n && weeks.map((w) => {
      const value = per(w.takeHome, period, n);
      return <div key={w.setup} className="mova-calc__row">
        <div className="mova-calc__row-head"><span><i style={{ background: COLORS[w.setup] }} />{NAMES[w.setup]}</span><strong>{money(value)}</strong></div>
        <div className="mova-calc__meter" aria-hidden="true"><div style={{ width: `${Math.max(0, (value / top) * 100)}%`, background: COLORS[w.setup] }} /></div>
        <div className="mova-calc__row-foot"><span>{formatHourly(w.takeHome / n.hours)}/hr for the hours you work</span>{w.perks > 0 && <b>+ {money(per(w.perks, period, n))} salon perks</b>}</div>
      </div>;
    })}
    {v && <div className="mova-calc__verdict"><strong>{v.title}</strong><span>{v.body}</span></div>}
    {n && weeks.length > 0 && <a className="mova-calc__cta" href="#breakdown">See the full breakdown ↓</a>}
    <p className="mova-calc__note">An estimate, not tax or legal advice. State taxes aren’t included.</p>
  </div>;
}

/* ---------- Full breakdown (W4·v2b) ---------- */

function Breakdown({ weeks, numbers: n, selected }: { weeks: Week[]; numbers: Numbers; selected: Setup[] }) {
  const has = (pick: (w: Week) => number) => weeks.some((w) => Math.abs(pick(w)) > 0.004);
  const cell = (w: Week, pick: (w: Week) => number, sign: '-' | '+' | '' = '-') => {
    const value = pick(w);
    if (Math.abs(value) < 0.005) return <span className="mova-calc__na">—</span>;
    return `${sign === '-' ? '−' : sign}${money(Math.abs(value)).replace('−', '')}`;
  };
  const row = (label: string, pick: (w: Week) => number, sign: '-' | '+' | '' = '-') => has(pick) ? <tr key={label}><th scope="row">{label}</th>{weeks.map((w) => <td key={w.setup}>{cell(w, pick, sign)}</td>)}</tr> : null;
  const group = (label: string) => <tr className="mova-calc__group"><th scope="rowgroup" colSpan={weeks.length + 1}>{label}</th></tr>;
  const ww = workingWeeks(n);
  const cardPct = `${+(n.cardFees * 100).toFixed(2)}%`;

  return <section id="breakdown" className="mova-site__container mova-calc__breakdown" aria-labelledby="calc-breakdown-h">
    <Eyebrow>Full breakdown</Eyebrow>
    <h2 id="calc-breakdown-h" className="mova-site__h2">Where every dollar goes</h2>
    <p className="mova-site__lead">Same week, {weeks.length === 1 ? 'one setup' : `${weeks.length === 2 ? 'two' : 'three'} setups`}. Nothing is hidden or behind an email.</p>
    <div className="mova-calc__breakdown-grid">
      <div className="mova-calc__left">
      <div className="mova-calc__card mova-calc__table-wrap">
        <table className="mova-calc__table">
          <caption className="mova-calc__sr">Weekly breakdown for each setup</caption>
          <thead><tr><th scope="col">Per week</th>{weeks.map((w) => <th key={w.setup} scope="col"><i style={{ background: COLORS[w.setup] }} />{SHORT[w.setup]}</th>)}</tr></thead>
          <tbody>
            {row('Service revenue', (w) => w.revenue, '')}
            {row('Tips', (w) => w.tips, '')}
            {group('Costs')}
            {row(`Salon’s commission (${+(n.split * 100).toFixed(1)}%)`, (w) => w.salonCut)}
            {row('Rent', (w) => w.rent)}
            {row('Products and color', (w) => w.products)}
            {row('Product or backbar fee', (w) => w.backbar)}
            {row('Your own tools', (w) => w.tools)}
            {row('Insurance, license, software, education, other', (w) => w.fixedCosts)}
            {row(`Card processing (${cardPct})`, (w) => w.cardFees)}
            {n.taxes && group('Taxes (estimate)')}
            {row(`Payroll tax, your half (${(PAYROLL_TAX * 100).toFixed(2)}%)`, (w) => w.payrollTax)}
            {row(`Self-employment tax (${(SE_TAX * 100).toFixed(1)}%)`, (w) => w.selfEmploymentTax)}
            {row(`Income tax set-aside (${+(n.incomeTax * 100).toFixed(1)}%)`, (w) => w.incomeTax)}
          </tbody>
          <tfoot>
            <tr className="mova-calc__total"><th scope="row">Take-home</th>{weeks.map((w) => <td key={w.setup}>{money(w.takeHome)}</td>)}</tr>
            {row('Plus salon perks', (w) => w.perks, '+')}
            <tr><th scope="row">Per hour you work ({+n.hours.toFixed(1)} h)</th>{weeks.map((w) => <td key={w.setup}>{formatHourly(w.takeHome / n.hours)}</td>)}</tr>
          </tfoot>
        </table>
      </div>
      <div className="mova-calc__phone-list">
        {weeks.map((w, i) => <details key={w.setup} className="mova-calc__card" open={i === 0}>
          <summary><span><i style={{ background: COLORS[w.setup] }} aria-hidden="true" />{NAMES[w.setup]}</span><b>{money(w.takeHome)}/wk</b></summary>
          <dl>
            {lines(w, n).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            <div className="mova-calc__total"><dt>Take-home</dt><dd>{money(w.takeHome)}</dd></div>
            {w.perks > 0 && <div><dt>Plus salon perks</dt><dd>+{money(w.perks)}</dd></div>}
            <div><dt>Per hour you work</dt><dd>{formatHourly(w.takeHome / n.hours)}</dd></div>
          </dl>
        </details>)}
      </div>
      <BreakdownCta weeks={weeks} numbers={n} />
      </div>
      <div className="mova-calc__side">
        <BreakEvenChart numbers={n} selected={selected} />
        <WhatIf numbers={n} selected={selected} />
      </div>
    </div>
    <h3 className="mova-calc__how-h">How we calculated it</h3>
    <div className="mova-calc__how">
      <p><b>Commission:</b> service revenue × your share ({+((1 - n.split) * 100).toFixed(1)}%) + tips − your own tools and any backbar fee. As a W-2 employee, payroll tax is your half of Social Security and Medicare, {(PAYROLL_TAX * 100).toFixed(2)}%; the salon pays the other half. As a 1099 contractor, self-employment tax applies instead.</p>
      <p><b>Booth and suite:</b> revenue + tips − rent − every cost you entered − card processing. Self-employment tax is {(SE_TAX * 100).toFixed(1)}% on {(SE_BASE * 100).toFixed(2)}% of that profit, as the IRS works it out (<a href="https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes" target="_blank" rel="noopener noreferrer">IRS: self-employment tax</a>).</p>
      <p><b>Income tax set-aside:</b> the percentage you chose ({+(n.incomeTax * 100).toFixed(1)}%) of taxable income. Self-employed: after deducting half of self-employment tax. A week with a loss has no tax.</p>
      <p><b>Year:</b> one week × {ww} working weeks (52 minus the {+n.weeksOff.toFixed(1)} weeks off you entered). <b>Per hour:</b> weekly take-home ÷ {+n.hours.toFixed(1)} hours.</p>
      <p className="mova-calc__muted">An estimate, not tax or legal advice. State and local taxes, retirement savings and the 20% pass-through deduction aren’t included. Ask a tax pro before you switch setups.</p>
    </div>
    <div className="mova-calc__trial">
      <div><strong>Try Mova free for 30 days</strong><span>Every new stylist gets 30 days of AI + Growth free. Then keep it, switch to Pro, or go to Free.</span></div>
      <ButtonLink to="/signup?from=calculator" onClick={startCalculatorSignup}>Start your free trial</ButtonLink>
    </div>
  </section>;
}

/** One setup's week as label/amount pairs, for the phone list. Zero lines are left out. */
function lines(w: Week, n: Numbers): Array<[string, string]> {
  const out: Array<[string, number, boolean]> = [
    ['Revenue + tips', w.revenue + w.tips, false],
    [`Salon’s commission (${+(n.split * 100).toFixed(1)}%)`, w.salonCut, true], ['Rent', w.rent, true], ['Products and color', w.products, true],
    ['Product or backbar fee', w.backbar, true], ['Your own tools', w.tools, true], ['Insurance, license, software, education, other', w.fixedCosts, true],
    ['Card processing', w.cardFees, true], ['Payroll tax, your half', w.payrollTax, true], ['Self-employment tax', w.selfEmploymentTax, true],
    ['Income tax set-aside', w.incomeTax, true],
  ];
  return out.filter(([, value]) => Math.abs(value) >= 0.005).map(([label, value, cost]) => [label, `${cost ? '−' : ''}${money(value).replace('−', '')}`]);
}

/** Trial prompt beside the numbers. The message follows whichever setup the stylist's numbers point to. */
function BreakdownCta({ weeks, numbers: n }: { weeks: Week[]; numbers: Numbers }) {
  const v = verdict(weeks, n);
  const leader = v.kind === 'leader' ? v.first : null;
  const copy = leader === 'booth' || leader === 'suite'
    ? { eyebrow: `Your numbers point to ${NAMES[leader].toLowerCase()}`, title: 'Taking clients with you?', body: 'Mova gives you a booking page, QR code and client notes that move with you.' }
    : leader === 'commission'
      ? { eyebrow: 'Your numbers point to commission', title: 'Building your own book on the side?', body: 'Mova gives you a booking page and client notes that stay yours, so you’re ready whenever renting makes sense.' }
      : { eyebrow: 'Whichever way you go', title: 'Keep your clients and your numbers in one place', body: 'Mova gives you a booking page, client notes and a clear view of what you take home.' };
  return <div className="mova-calc__card mova-calc__side-cta">
    <span className="mova-site__eyebrow">{copy.eyebrow}</span>
    <h3>{copy.title}</h3>
    <p>{copy.body}</p>
    <div className="mova-calc__side-cta-actions">
      <ButtonLink to="/signup?from=calculator" onClick={startCalculatorSignup}>Start free for 30 days</ButtonLink>
      <span>AI + Growth free for 30 days. Change plans anytime.</span>
    </div>
  </div>;
}

function BreakEvenChart({ numbers: n, selected }: { numbers: Numbers; selected: Setup[] }) {
  const pair = breakEvenPair([...selected], n);
  const from = Math.max(0, Math.round(n.revenue * 0.4 / 100) * 100);
  const to = Math.max(from + 400, Math.round(n.revenue * 1.6 / 100) * 100);
  const lines = useMemo(() => series(selected, n, from, to), [selected, n, from, to]);
  const perks = selected.includes('commission') && n.perks > 0 ? series(['commission'], n, from, to)[0]!.points.map((p) => ({ ...p, takeHome: p.takeHome + n.perks })) : null;
  const all = [...lines.flatMap((l) => l.points.map((p) => p.takeHome)), ...(perks?.map((p) => p.takeHome) ?? [])];
  const lo = Math.min(0, ...all); const hi = Math.max(...all, 100);
  const W = 620; const H = 300; const L = 58; const R = 16; const T = 14; const B = 36;
  const x = (r: number) => L + ((r - from) / (to - from)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (pts: Array<{ revenue: number; takeHome: number }>) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.revenue).toFixed(1)},${y(p.takeHome).toFixed(1)}`).join('');
  const ticks = niceTicks(lo, hi);
  const plain = pair ? breakEven(pair[0], pair[1], n) : null;
  const withPerks = pair && perks ? breakEven(pair[0], pair[1], n, true) : null;
  const point = plain?.kind === 'revenue' && plain.amount >= from && plain.amount <= to ? plain.amount : null;

  let text: ReactNode;
  if (!pair) text = selected.includes('booth') && selected.includes('suite') && !selected.includes('commission')
    ? <>Booth and suite share every cost but rent, so the one with lower rent always keeps more, by {money(Math.abs(week('booth', n).takeHome - week('suite', n).takeHome))} a week here.</>
    : <>Pick commission and a rental above to see where they cross.</>;
  else if (plain?.kind === 'revenue') text = <>Above <b>{money(plain.amount)}</b> a week in services, {SHORT[plain.above].toLowerCase()} pays more than {SHORT[plain.below].toLowerCase()}{withPerks?.kind === 'revenue' ? <>; counting the salon’s perks, above <b>{money(withPerks.amount)}</b></> : null}. You’re at {money(n.revenue)}.</>;
  else text = <>{NAMES[plain!.ahead]} pays more at every weekly revenue up to {money(Math.max(20000, n.revenue * 4))}.</>;

  return <div className="mova-calc__card mova-calc__chart">
    <h3>Break-even point</h3>
    <p className="mova-calc__note">Weekly take-home at different weekly service revenue. {text}</p>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly take-home by weekly service revenue for each setup">
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-subtle)" /><text x={L - 8} y={y(v) + 4} textAnchor="end">{money(v)}</text></g>)}
      {[from, (from + to) / 2, to].map((r) => <text key={r} x={x(r)} y={H - 12} textAnchor="middle">{money(r)}</text>)}
      <line x1={x(n.revenue)} x2={x(n.revenue)} y1={T} y2={H - B} stroke="var(--forest)" strokeDasharray="3 4" opacity={0.5} />
      <text x={x(n.revenue) + 6} y={T + 10} className="mova-calc__chart-you">You: {money(n.revenue)}</text>
      {lines.map((l) => <path key={l.setup} d={path(l.points)} fill="none" stroke={COLORS[l.setup]} strokeWidth={3} strokeLinecap="round" />)}
      {perks && <path d={path(perks)} fill="none" stroke={COLORS.commission} strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round" />}
      {point !== null && pair && <circle cx={x(point)} cy={y(week(pair[0], { ...n, revenue: point }).takeHome)} r={6} fill="#fff" stroke="var(--forest)" strokeWidth={2.5} />}
    </svg>
    <div className="mova-calc__legend">
      {selected.map((s) => <span key={s}><i style={{ background: COLORS[s] }} />{SHORT[s]}</span>)}
      {perks && <span><i className="mova-calc__dash" />Commission + perks</span>}
    </div>
  </div>;
}

function niceTicks(lo: number, hi: number) {
  const span = hi - lo; const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 0.001; v += step) out.push(v);
  return out;
}

function WhatIf({ numbers: n, selected }: { numbers: Numbers; selected: Setup[] }) {
  const [rent, setRent] = useState(0);
  const [booked, setBooked] = useState(100);
  const [split, setSplit] = useState(Math.round(n.split * 100));
  const hasRental = selected.includes('booth') || selected.includes('suite');
  const hasCommission = selected.includes('commission');
  const describe = (m: Numbers) => {
    const ws = selected.map((s) => week(s, m));
    const best = [...ws].sort((a, b) => b.takeHome - a.takeHome)[0]!;
    return <>{ws.map((w, i) => <span key={w.setup}>{i ? ' · ' : ''}{SHORT[w.setup]} {money(w.takeHome)}</span>)} a week.{ws.length > 1 && <> {NAMES[best.setup]} pays the most.</>}</>;
  };
  const slider = (id: string, label: string, value: number, min: number, max: number, stepSize: number, display: string, onChange: (v: number) => void, result: ReactNode, reset: () => void, changed: boolean) =>
    <div className="mova-calc__card mova-calc__whatif">
      <div className="mova-calc__whatif-head"><label htmlFor={id}>{label}</label><span>{display}</span></div>
      <input id={id} type="range" min={min} max={max} step={stepSize} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} />
      <p className="mova-calc__note" aria-live="polite">{result}{changed && <> <button type="button" className="mova-calc__link" onClick={reset}>Reset</button></>}</p>
    </div>;

  return <div className="mova-calc__whatifs">
    <div className="mova-calc__card mova-calc__whatif-intro"><h3>What would change the answer</h3><p className="mova-calc__note">Drag to test a different week. Your numbers above don’t change.</p></div>
    {hasRental && slider('calc-whatif-rent', 'Rent goes up or down', rent, -100, 200, 10, `${rent >= 0 ? '+' : '−'}${money(Math.abs(rent))} a week`, setRent,
      describe({ ...n, boothRent: Math.max(0, n.boothRent + rent), suiteRent: Math.max(0, n.suiteRent + rent) }), () => setRent(0), rent !== 0)}
    {slider('calc-whatif-booked', 'Fewer or more clients', booked, 50, 130, 5, `${booked}% of your revenue`, setBooked,
      describe({ ...n, revenue: (n.revenue * booked) / 100 }), () => setBooked(100), booked !== 100)}
    {hasCommission && slider('calc-whatif-split', 'Salon takes a different cut', split, 20, 70, 1, `${split}% to the salon`, setSplit,
      describe({ ...n, split: split / 100 }), () => setSplit(Math.round(n.split * 100)), split !== Math.round(n.split * 100))}
  </div>;
}
