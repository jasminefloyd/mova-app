import { useTranslation } from 'react-i18next';
import { ButtonLink, Bullets, Eyebrow, PhoneFrame } from './parts';

type FeatureKey = 'showcase' | 'booking' | 'clients' | 'money' | 'revenue' | 'concierge' | 'clientCard' | 'reports';

// W2 Features. Each section: eyebrow, heading, body, three bullets and a decorative screen preview.
const features: Array<{ id: FeatureKey; anchor: string; art: 'home' | 'booking' | 'client' | 'money' | 'campaign' | 'concierge' | 'status' | 'reports'; reverse?: boolean; band: 'base' | 'alt' }> = [
  { id: 'showcase', anchor: 'showcase', art: 'home', band: 'base' },
  { id: 'booking', anchor: 'booking', art: 'booking', reverse: true, band: 'alt' },
  { id: 'clients', anchor: 'clients', art: 'client', band: 'base' },
  { id: 'money', anchor: 'money', art: 'money', reverse: true, band: 'alt' },
  { id: 'revenue', anchor: 'revenue', art: 'campaign', band: 'base' },
  { id: 'concierge', anchor: 'concierge', art: 'concierge', reverse: true, band: 'alt' },
  { id: 'clientCard', anchor: 'clientcard', art: 'status', band: 'base' },
  { id: 'reports', anchor: 'reports', art: 'reports', reverse: true, band: 'alt' },
];

const bulletKeys: Record<FeatureKey, [string, string, string]> = {
  showcase: ['showcase1', 'showcase2', 'showcase3'],
  booking: ['booking1', 'booking2', 'booking3'],
  clients: ['clients1', 'clients2', 'clients3'],
  money: ['money1', 'money2', 'money3'],
  revenue: ['revenue1', 'revenue2', 'revenue3'],
  concierge: ['concierge1', 'concierge2', 'concierge3'],
  clientCard: ['clientCard1', 'clientCard2', 'clientCard3'],
  reports: ['reports1', 'reports2', 'reports3'],
};

const titleKeys: Record<FeatureKey, { eyebrow: string; a: string; b: string; body: string; jump: string }> = {
  showcase: { eyebrow: 'showcaseEyebrow', a: 'showcaseTitleA', b: 'showcaseTitleB', body: 'showcaseBody', jump: 'jumpShowcase' },
  booking: { eyebrow: 'bookingEyebrow', a: 'bookingTitleA', b: 'bookingTitleB', body: 'bookingBody', jump: 'jumpBooking' },
  clients: { eyebrow: 'clientsEyebrow', a: 'clientsTitleA', b: 'clientsTitleB', body: 'clientsBody', jump: 'jumpClients' },
  money: { eyebrow: 'moneyEyebrow', a: 'moneyTitleA', b: 'moneyTitleB', body: 'moneyBody', jump: 'jumpMoney' },
  revenue: { eyebrow: 'revenueEyebrow', a: 'revenueTitleA', b: 'revenueTitleB', body: 'revenueBody', jump: 'jumpRevenue' },
  concierge: { eyebrow: 'conciergeEyebrow', a: 'conciergeTitleA', b: 'conciergeTitleB', body: 'conciergeBody', jump: 'jumpConcierge' },
  clientCard: { eyebrow: 'clientCardEyebrow', a: 'clientCardTitleA', b: 'clientCardTitleB', body: 'clientCardBody', jump: 'jumpClientCard' },
  reports: { eyebrow: 'reportsEyebrow', a: 'reportsTitleA', b: 'reportsTitleB', body: 'reportsBody', jump: 'jumpReports' },
};

export default function FeaturesPage() {
  const { t } = useTranslation();
  return <div>
    <section className="mova-site__container" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBlock: 'clamp(40px, 6vw, 80px) 24px' }} aria-labelledby="feat-h">
      <Eyebrow>{t('website.features.eyebrow')}</Eyebrow>
      <h1 id="feat-h" className="mova-site__h1" style={{ maxWidth: 860, fontSize: 'clamp(36px, 4.8vw, 60px)' }}>{t('website.features.headlineA')} <span className="mova-site__accent">{t('website.features.headlineB')}</span></h1>
      <p className="mova-site__lead" style={{ maxWidth: 680 }}>{t('website.features.intro')}</p>
      <nav aria-label={t('website.features.jumpLabel')} className="mova-site__feature-anchors" style={{ marginTop: 8 }}>
        {features.map(({ id, anchor }) => <a className="mova-site__chip" key={id} href={`#${anchor}`}>{t(`website.features.${titleKeys[id].jump}`)}</a>)}
      </nav>
    </section>

    {features.map(({ id, anchor, art, reverse, band }) => {
      const keys = titleKeys[id];
      const copy = <div className="mova-site__split-copy">
        <Eyebrow>{t(`website.features.${keys.eyebrow}`)}</Eyebrow>
        <h2 id={`${anchor}-h`} className="mova-site__h2" style={{ fontSize: 'clamp(28px, 3vw, 40px)', letterSpacing: -0.6 }}>{t(`website.features.${keys.a}`)} <span className="mova-site__accent">{t(`website.features.${keys.b}`)}</span></h2>
        <p className="mova-site__lead" style={{ fontSize: 17 }}>{t(`website.features.${keys.body}`)}</p>
        <Bullets items={bulletKeys[id].map((key) => t(`website.features.${key}`))} />
      </div>;
      const figure = <div className="mova-site__split-art"><PhoneFrame variant={art === 'status' ? 'client' : art === 'reports' ? 'reports' : art} /></div>;
      return <section key={id} id={anchor} aria-labelledby={`${anchor}-h`} className={`mova-site__band${band === 'alt' ? ' mova-site__band--mist' : ''}`}>
        <div className="mova-site__container mova-site__section">
          <div className={`mova-site__split${reverse ? ' mova-site__split--reverse' : ''}`}>
            {reverse ? <>{figure}{copy}</> : <>{copy}{figure}</>}
          </div>
        </div>
      </section>;
    })}

    <section className="mova-site__container" aria-labelledby="fcta-h" style={{ paddingBlock: 'clamp(48px, 6vw, 96px)' }}>
      <div className="mova-site__cta">
        <div className="mova-site__cta-copy">
          <h2 id="fcta-h">{t('website.features.ctaTitle')}</h2>
          <p>{t('website.features.ctaBody')}</p>
        </div>
        <ButtonLink to="/signup">{t('website.nav.startFree')}</ButtonLink>
      </div>
    </section>
  </div>;
}
