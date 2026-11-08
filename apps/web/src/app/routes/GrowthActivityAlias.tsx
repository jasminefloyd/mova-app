import { Navigate, useParams } from 'react-router';
import { operatorUrl } from '../operator-url';

export default function GrowthActivityAlias() {
  const { businessId } = useParams();
  return <Navigate to={operatorUrl(businessId, 'growth/activity')} replace />;
}
