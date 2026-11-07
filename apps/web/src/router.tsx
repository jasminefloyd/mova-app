import { createBrowserRouter, Navigate } from 'react-router';
import OperatorShellRoute from './app/OperatorShellRoute';
import { ArtistPage, SettingsPage } from './app/ArtistPages';
import { ComponentGallery } from './components';
import { ClientShell } from './app/ClientShell';
import { OnboardingShell } from './app/OnboardingShell';
import { PublicShell } from './app/PublicShell';
import { PublicArtistPage } from './features/showcase/PublicArtistPage';
import { ServiceSettingsPage } from './features/services/ServiceSettingsPage';
import { PortfolioSettingsPage } from './features/showcase/PortfolioSettingsPage';
import { ArtistProfilePreviewPage } from './features/showcase/ArtistProfilePreviewPage';
import { LocationsPage } from './features/locations/LocationsPage';
import { BookingManageRoute } from './features/bookings/BookingManageRoute';
import { BookingRoute } from './features/bookings/BookingRoute';
import { CalendarPage } from './features/bookings/CalendarPage';
import { AppointmentRoute } from './features/bookings/AppointmentRoute';
import { MoneyPage } from './features/money/MoneyPage';
import { PaymentSettingsPage } from './features/money/PaymentSettingsPage';
import { GetPaidPage } from './features/getpaid/GetPaidPage';
import { ClientDetail } from './features/clients/ClientsFeature';
import { ClientImport } from './features/clients/ClientsFeature';
import VisitNotesRoute from './features/clients/VisitNotesRoute';
import MarketingHome from './app/routes/MarketingHome';
import CalendarSyncPage from './features/calendar-sync/CalendarSyncPage';
import ShowMyQrPage from './features/identity/ShowMyQrPage';
import SignInPage from './features/identity/SignInPage';
import ClientProfilePage from './features/identity/ClientProfilePage';
import ScanLandingPage from './features/identity/ScanLandingPage';
import ClientCardLandingPage from './features/identity/ClientCardLandingPage';
import {NotificationInboxPage,NotificationSettingsPage} from './features/messaging/NotificationPages';
import {RevenueHomePage,RevenueDetailPage} from './features/revenue/RevenuePages';
import {ConciergeInboxPage,ConciergeSetupPage,ConciergeThreadPage} from './features/concierge/ConciergePages';
import { ReputationPage } from './features/reports/ReputationPage';
import { ReviewPage } from './features/reports/ReviewPage';
import { PlanPage } from './features/reports/PlanPage';
import { PrivacyPage } from './features/settings/PrivacyPage';

export const router = createBrowserRouter([
  { path: '/auth', element: <OnboardingShell /> },
  { path: '/:businessId', element: <OperatorShellRoute />, children: [
    { index: true, element: <ArtistPage section="home" /> },
    { path: 'calendar', element: <CalendarPage /> },
    { path: 'clients', element: <ArtistPage section="clients" /> },
    { path: 'clients/import', element: <ClientImport /> },
    { path: 'clients/:clientId', element: <ClientDetail /> },
    { path: 'growth', element: <RevenueHomePage /> },
    { path: 'growth/pipeline', element: <RevenueDetailPage mode="pipeline" /> },
    { path: 'growth/winback', element: <RevenueDetailPage mode="winback" /> },
    { path: 'growth/slots', element: <RevenueDetailPage mode="slots" /> },
    { path: 'growth/autopilot', element: <RevenueDetailPage mode="autopilot" /> },
    { path: 'growth/templates', element: <RevenueDetailPage mode="templates" /> },
    { path: 'growth/activity', element: <RevenueDetailPage mode="activity" /> },
    { path: 'growth/concierge', element: <ConciergeInboxPage /> },
    { path: 'concierge', element: <ConciergeInboxPage /> },
    { path: 'concierge/setup', element: <ConciergeSetupPage /> },
    { path: 'concierge/quotes/:quoteId', element: <ConciergeThreadPage /> },
    { path: 'concierge/:conversationId', element: <ConciergeThreadPage /> },
    { path: 'reports', element: <ArtistPage section="reports" /> },
    { path: 'reports/reputation', element: <ReputationPage /> },
    { path: 'settings/reviews', element: <ReputationPage /> },
    { path: 'settings/plan', element: <PlanPage /> },
    { path: 'settings/privacy', element: <PrivacyPage /> },
    { path: 'settings', element: <SettingsPage /> },
    { path: 'settings/services', element: <ServiceSettingsPage /> },
    { path: 'settings/portfolio', element: <PortfolioSettingsPage /> },
    { path: 'settings/profile/preview', element: <ArtistProfilePreviewPage /> },
    { path: 'settings/locations', element: <LocationsPage /> },
    { path: 'settings/calendar-sync', element: <CalendarSyncPage /> },
    { path: 'settings/notifications', element: <NotificationSettingsPage /> },
    { path: 'notifications', element: <NotificationInboxPage /> },
    { path: 'settings/qr', element: <ShowMyQrPage /> },
    { path: 'settings/payments', element: <PaymentSettingsPage /> },
    { path: 'settings/money', element: <MoneyPage /> },
    { path: 'money', element: <MoneyPage /> },
    { path: 'appointments/:appointmentId', element: <AppointmentRoute /> },
    { path: 'appointments/:appointmentId/pay', element: <GetPaidPage /> },
    { path: 'appointments/:appointmentId/notes', element: <VisitNotesRoute /> },
    { path: 'components', element: import.meta.env.DEV ? <ComponentGallery /> : <Navigate to="/auth" replace /> },
    { path: '*', element: <ArtistPage section="home" /> },
  ] },
  { path: '/onboarding/*', element: <OnboardingShell /> },
  { path: '/signin', element: <ClientShell />, children: [{ index:true, element:<SignInPage/> }] },
  { path: '/me', element: <ClientShell />, children: [{ index:true, element:<ClientProfilePage/> }] },
  { path: '/', element: <PublicShell />, children: [
    { index: true, element: <MarketingHome /> },
    { path: 'a/:handle', element: <PublicArtistPage /> },
    { path: 'a/:handle/book', element: <BookingRoute /> },
    { path: 's/:handle', element: <ScanLandingPage /> },
    { path: 'c/:token', element: <ClientCardLandingPage /> },
    { path: 'b/:token', element: <BookingManageRoute /> },
    { path: 'review/:token', element: <ReviewPage /> },
    { path: '*', element: <Navigate to="/" replace /> },
  ] },
]);
