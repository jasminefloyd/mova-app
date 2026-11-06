import { Navigate, useParams } from 'react-router-dom';
import { ComponentGallery } from '../../components';
import { operatorUrl } from '../operator-url';
export default function Route() { const { businessId }=useParams(); return import.meta.env.DEV ? <ComponentGallery /> : <Navigate to={operatorUrl(businessId,'')} replace />; }
