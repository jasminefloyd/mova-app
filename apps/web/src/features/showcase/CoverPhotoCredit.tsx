import { useTranslation } from 'react-i18next';

export function CoverPhotoCredit({ name, url, unsplashUrl, locale }: { name: string; url: string; unsplashUrl: string; locale?: string }) {
  const { t } = useTranslation(undefined, locale ? { lng: locale } : undefined);
  return <p className="mova-cover-photo-credit">
    {t('coverPicker.photoBy')}{' '}
    <a href={url} target="_blank" rel="noopener noreferrer">{name}</a>{' '}
    {t('coverPicker.photoOn')}{' '}
    <a href={unsplashUrl} target="_blank" rel="noopener noreferrer">{t('coverPicker.unsplash')}</a>
  </p>;
}
