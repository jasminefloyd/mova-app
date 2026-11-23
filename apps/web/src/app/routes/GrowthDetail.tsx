import { Navigate, useParams } from 'react-router';
import { operatorUrl } from '../operator-url';
import { RevenueDetailPage } from '../../features/revenue/RevenuePages';
import { ConciergeInboxPage } from '../../features/concierge/ConciergeBoard';

const detailModes = ['pipeline', 'winback', 'slots', 'autopilot', 'templates', 'activity'] as const;
type DetailMode = (typeof detailModes)[number];

export default function GrowthDetailRoute() {
  const { businessId, view } = useParams();
  if (view === 'concierge') return <ConciergeInboxPage />;
  if (detailModes.includes(view as DetailMode)) return <RevenueDetailPage mode={view as DetailMode} />;
  return <Navigate to={operatorUrl(businessId, 'growth')} replace />;
}
