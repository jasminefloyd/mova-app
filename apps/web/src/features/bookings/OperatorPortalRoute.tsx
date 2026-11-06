import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { operatorUrl } from '../../app/operator-url';

export default function OperatorPortalRoute() {
  const { businessId = '' } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  useEffect(() => { navigate(operatorUrl(businessId, ''), { replace: true }); }, [businessId, navigate]);
  return <main className="mova-page" aria-busy="true"><p role="status">{t('operator.loading')}</p></main>;
}
