import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '../../components';
import { operatorLocation } from '../operator-url';
import { useArtistBusiness } from '../../features/settings/useArtistBusiness';

export function OperatorAlias({ section, titleKey }: { section: 'growth' | 'money' | 'reports'; titleKey: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { businessId, loading } = useArtistBusiness();

  useEffect(() => {
    if (loading || !businessId) return;
    const target = operatorLocation(businessId, section);
    if (target.startsWith('https://')) window.location.assign(target);
    else navigate(target, { replace: true });
  }, [businessId, loading, navigate, section]);

  if (loading || businessId) {
    return <main className="mova-page" aria-busy="true"><p role="status">{t('operator.loading')}</p></main>;
  }

  return <main className="mova-page mova-reports-alias">
    <Card>
      <h1>{t(titleKey)}</h1>
      <p>{t('reports.signInRequired')}</p>
      <Button onClick={() => navigate('/auth')}>{t('onboarding.signIn')}</Button>
    </Card>
  </main>;
}
