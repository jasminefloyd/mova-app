import { Navigate, useParams } from 'react-router-dom';
import { operatorUrl } from '../operator-url';
export default function Route() { const { businessId } = useParams(); return <Navigate to={operatorUrl(businessId,'')} replace />; }
