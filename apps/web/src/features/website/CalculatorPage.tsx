import { useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonLink, Eyebrow } from './parts';
import { calculate, formatDollars, type CalculatorInput } from './calculator';

// W4 Calculator. Free, no signup. Numbers are computed in the browser and never sent anywhere.
const defaults: CalculatorInput = { revenue: '1500', commissionCut: '40', rent: '300', expenses: '150' };

export default function CalculatorPage() {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState<CalculatorInput>(defaults);
  const result = calculate(input);
  const locale = i18n.language === 'es-US' ? 'es-US' : 'en-US';
  const set = (key: keyof CalculatorInput) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    setInput((current) => ({ ...current, [key]: value }));
  };

  const errorKey = result.status === 'incomplete' ? 'errorMissing'
    : result.status === 'negative' ? 'errorNegative'
      : result.status === 'commission-range' ? 'errorCommission' : null;
  const ok = result.status === 'ok' ? result : null;
  const verdict = !ok ? '—'
    : ok.difference === 0 ? t('website.calculator.verdictEven')
      : t(ok.difference > 0 ? 'website.calculator.verdictBooth' : 'website.calculator.verdictCommission', { amount: formatDollars(Math.abs(ok.difference), locale) });
  const yearly = ok ? t('website.calculator.yearly', { amount: formatDollars(Math.abs(ok.difference) * 52, locale) }) : '';

  return <div>
    <section className="mova-site__container" aria-labelledby="calc-h" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: 'clamp(40px, 6vw, 80px) 24px' }}>
      <Eyebrow>{t('website.calculator.eyebrow')}</Eyebrow>
      <h1 id="calc-h" className="mova-site__h1" style={{ maxWidth: 820, fontSize: 'clamp(36px, 4.6vw, 58px)' }}>{t('website.calculator.headlineA')} <span className="mova-site__accent">{t('website.calculator.headlineB')}</span></h1>
      <p className="mova-site__lead" style={{ maxWidth: 640, fontSize: 'clamp(17px, 1.6vw, 19px)' }}>{t('website.calculator.intro')}</p>
    </section>

    <section className="mova-site__container" aria-label={t('website.calculator.formTitle')} style={{ paddingBottom: 'clamp(48px, 6vw, 80px)' }}>
      <div className="mova-site__calc">
        <form className="mova-site__calc-form" aria-labelledby="calc-form-h" onSubmit={(event) => event.preventDefault()}>
          <h2 id="calc-form-h">{t('website.calculator.formTitle')}</h2>
          <div className="mova-site__field">
            <label htmlFor="calc-revenue">{t('website.calculator.revenue')}</label>
            <input id="calc-revenue" className="mova-site__input" type="number" inputMode="decimal" min="0" value={input.revenue} onChange={set('revenue')} />
          </div>
          <div className="mova-site__field">
            <label htmlFor="calc-cut">{t('website.calculator.commission')}</label>
            <input id="calc-cut" className="mova-site__input" type="number" inputMode="decimal" min="0" max="100" value={input.commissionCut} onChange={set('commissionCut')} aria-describedby="calc-cut-hint" />
            <small id="calc-cut-hint">{t('website.calculator.commissionHint')}</small>
          </div>
          <div className="mova-site__field">
            <label htmlFor="calc-rent">{t('website.calculator.rent')}</label>
            <input id="calc-rent" className="mova-site__input" type="number" inputMode="decimal" min="0" value={input.rent} onChange={set('rent')} />
          </div>
          <div className="mova-site__field">
            <label htmlFor="calc-expenses">{t('website.calculator.expenses')}</label>
            <input id="calc-expenses" className="mova-site__input" type="number" inputMode="decimal" min="0" value={input.expenses} onChange={set('expenses')} aria-describedby="calc-expenses-hint" />
            <small id="calc-expenses-hint">{t('website.calculator.expensesHint')}</small>
          </div>
          {errorKey && <p role="alert" className="mova-site__error">{t(`website.calculator.${errorKey}`)}</p>}
        </form>

        <div className="mova-site__calc-result" aria-live="polite">
          <h2>{t('website.calculator.resultsTitle')}</h2>
          <div className="mova-site__meter-row">
            <div className="mova-site__meter-head"><span>{t('website.calculator.resultCommission')}</span><strong>{ok ? formatDollars(ok.commission, locale) : '—'}</strong></div>
            <div className="mova-site__meter" aria-hidden="true"><div style={{ width: `${ok ? ok.commissionBar : 0}%`, background: '#C9E6D4' }} /></div>
          </div>
          <div className="mova-site__meter-row">
            <div className="mova-site__meter-head"><span>{t('website.calculator.resultBooth')}</span><strong>{ok ? formatDollars(ok.booth, locale) : '—'}</strong></div>
            <div className="mova-site__meter" aria-hidden="true"><div style={{ width: `${ok ? ok.boothBar : 0}%`, background: '#E7C3AA' }} /></div>
          </div>
          <div className="mova-site__verdict">
            <strong>{verdict}</strong>
            <span>{yearly}</span>
          </div>
          <p className="mova-site__disclaimer">{t('website.calculator.disclaimer')}</p>
        </div>
      </div>
    </section>

    <section className="mova-site__container" aria-labelledby="calc-next-h" style={{ paddingBottom: 'clamp(56px, 7vw, 96px)' }}>
      <div className="mova-site__cta">
        <div className="mova-site__cta-copy">
          <h2 id="calc-next-h">{t('website.calculator.nextTitle')}</h2>
          <p>{t('website.calculator.nextBody')}</p>
        </div>
        <ButtonLink to="/signup">{t('website.calculator.startFree')}</ButtonLink>
      </div>
    </section>
  </div>;
}
