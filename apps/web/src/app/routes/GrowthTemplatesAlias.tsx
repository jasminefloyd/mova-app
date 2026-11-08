import { Navigate, useParams } from 'react-router';
import { operatorUrl } from '../operator-url';

export default function GrowthTemplatesAlias() {
  const { businessId } = useParams();
  return <Navigate to={operatorUrl(businessId, 'growth/templates')} replace />;
}
