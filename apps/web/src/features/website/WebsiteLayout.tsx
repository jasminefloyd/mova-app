import { Outlet } from 'react-router';
import { WebsiteFooter } from './WebsiteFooter';
import { WebsiteNav } from './WebsiteNav';
import './website.css';

// Route module for the public website. Google Fonts is the only stylesheet we load from outside.
export const links = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Manrope:wght@600;700;800&display=swap' },
];

export default function WebsiteLayout() {
  return <div className="mova-site">
    <WebsiteNav />
    <Outlet />
    <WebsiteFooter />
  </div>;
}
