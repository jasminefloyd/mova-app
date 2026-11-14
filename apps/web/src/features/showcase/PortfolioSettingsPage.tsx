import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Chip, EmptyState, ErrorState, Icon, IconButton, ScreenHeader, TextField, Toggle } from '../../components';
import { operatorUrl } from '../../app/operator-url';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Service = { id: string; name: string; status: string };
type Item = { id: string; media_path: string; alt_text: string; sort_order: number; is_published: boolean; service_ids: string[]; image_url: string };

/** Swaps two neighbours; returns null when the move would leave the list. */
export function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return null;
  const next = [...items];
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

/** A look has no title column, so it is named after its first linked service. */
export function lookTitle(item: Pick<Item, 'service_ids'>, services: Service[], fallback: string) {
  const names = item.service_ids.map((id) => services.find((service) => service.id === id)?.name).filter((name): name is string => Boolean(name));
  return names[0] ?? fallback;
}

export function PortfolioSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [items, setItems] = useState<Item[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setError(false);
    const [{ data: rows, error: itemsError }, { data: serviceRows, error: servicesError }] = await Promise.all([
      client.from('mova_portfolio_items').select('id, media_path, alt_text, sort_order, is_published').eq('artist_business_id', businessId).order('sort_order'),
      client.from('mova_services').select('id, name, status').eq('artist_business_id', businessId).order('name'),
    ]);
    if (itemsError || servicesError) { setError(true); return; }
    setServices(((serviceRows ?? []) as Service[]).filter((service) => service.status !== 'inactive'));
    const mapped = await Promise.all((rows ?? []).map(async (row) => {
      const [{ data: signed }, { data: links }] = await Promise.all([
        client.storage.from('mova_portfolio_media').createSignedUrl(row.media_path, 300),
        client.from('mova_portfolio_service_links').select('service_id').eq('portfolio_item_id', row.id),
      ]);
      return { ...row, image_url: signed?.signedUrl ?? '', service_ids: links?.map((link) => link.service_id) ?? [] } as Item;
    }));
    setItems(mapped);
    setLoaded(true);
  }, [businessId, client]);

  useEffect(() => { void load(); }, [load]);

  const patch = (id: string, value: Partial<Item>) => setItems((rows) => rows.map((row) => row.id === id ? { ...row, ...value } : row));

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!client || !businessId || !file) return;
    setUploading(true); setError(false);
    let variants: Record<string, string> | null = null;
    try {
      const { data: uploaded, error: uploadError } = await client.functions.invoke('photo-upload-url', { body: { kind: 'portfolio', size: file.size, contentType: file.type, artist_business_id: businessId } });
      if (uploadError) throw uploadError;
      const { path, token, bucket } = uploaded?.data ?? {};
      if (typeof path !== 'string' || typeof token !== 'string' || bucket !== 'mova_portfolio_media') throw new Error('UPLOAD_RESPONSE_INVALID');
      const { error: storageError } = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (storageError) throw storageError;
      const { data: processed, error: processError } = await client.functions.invoke('photo-process', { body: { path, kind: 'portfolio', zoom: 1 } });
      if (processError) throw processError;
      variants = processed?.data?.variants ?? null;
      if (!variants?.['512']) throw new Error('NO_VARIANT');
      const nextOrder = items.reduce((max, item) => Math.max(max, item.sort_order + 1), 0);
      // New looks start hidden; the stylist describes the image before showing it.
      const { data: row, error: insertError } = await client.from('mova_portfolio_items').insert({
        artist_business_id: businessId, media_path: variants['512'], alt_text: '', sort_order: nextOrder, is_published: false,
      }).select('id').single();
      if (insertError || !row) throw insertError ?? new Error('NOT_CREATED');
      await load();
      setOpenId(row.id);
    } catch {
      setError(true);
      if (variants) await client.storage.from('mova_portfolio_media').remove(Object.values(variants));
    } finally { setUploading(false); }
  };

  const saveAlt = async (item: Item, value: string) => {
    if (!client) return;
    const alt = value.trim();
    const { error: updateError } = await client.from('mova_portfolio_items').update({ alt_text: alt }).eq('id', item.id);
    if (updateError) setError(true); else patch(item.id, { alt_text: alt });
  };

  const toggleService = async (item: Item, serviceId: string) => {
    if (!client || !businessId) return;
    const next = item.service_ids.includes(serviceId) ? item.service_ids.filter((id) => id !== serviceId) : [...item.service_ids, serviceId];
    const { error: updateError } = await client.rpc('mova_set_portfolio_service_links', { p_artist_business_id: businessId, p_portfolio_item_id: item.id, p_service_ids: next });
    if (updateError) setError(true); else patch(item.id, { service_ids: next });
  };

  const setPublished = async (item: Item, value: boolean) => {
    if (!client) return;
    const { error: updateError } = await client.from('mova_portfolio_items').update({ is_published: value }).eq('id', item.id);
    if (updateError) setError(true); else patch(item.id, { is_published: value });
  };

  const move = async (index: number, delta: -1 | 1) => {
    if (!client || !businessId) return;
    const ordered = moveItem(items, index, delta);
    if (!ordered) return;
    const { error: orderError } = await client.rpc('mova_reorder_portfolio_items', { p_artist_business_id: businessId, p_item_ids: ordered.map((item) => item.id) });
    if (orderError) setError(true); else setItems(ordered.map((item, sort_order) => ({ ...item, sort_order })));
  };

  const remove = async (item: Item) => {
    if (!client) return;
    if (confirmDelete !== item.id) { setConfirmDelete(item.id); return; }
    const { error: deleteError } = await client.from('mova_portfolio_items').delete().eq('id', item.id);
    if (deleteError) { setError(true); return; }
    await client.storage.from('mova_portfolio_media').remove([item.media_path]);
    setConfirmDelete(null); setOpenId(null);
    await load();
  };

  if (identityLoading) return <main className="mova-page"><p role="status">{t('settings.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page"><ErrorState title={t('settings.identityError')} retryLabel={t('settings.retry')} onRetry={() => void load()} /></main>;
  const shown = items.filter((item) => item.is_published).length;
  return <main className="mova-page mova-settings-page mova-looks">
    <ScreenHeader onBack={() => navigate(operatorUrl(businessId, 'settings/profile'))} backLabel={t('settings.backToProfile')}
      trailing={<IconButton label={t('settings.addPortfolioItem')} icon="plus" onClick={() => fileInput.current?.click()} />} />
    <div className="mova-looks__head"><h1>{t('settings.portfolio')}</h1><p>{t('settings.looksIntro')}</p></div>
    <label className={`mova-looks__upload${uploading ? ' is-busy' : ''}`} aria-busy={uploading || undefined}>
      <Icon name="photo" size={20} />{uploading ? t('settings.uploading') : t('settings.uploadPhotos')}
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={uploading} onChange={(event) => void upload(event)} />
    </label>
    {error && <ErrorState title={t('settings.saveError')} retryLabel={t('settings.retry')} onRetry={() => void load()} />}
    {loaded && items.length === 0 && <EmptyState title={t('settings.noPortfolio')} />}
    {items.length > 0 && <p className="mova-looks__summary">{t('settings.looksSummary', { count: items.length, shown })} · {t('settings.firstShowsFirst')}</p>}
    <ol className="mova-looks__list">{items.map((item, index) => {
      const open = openId === item.id;
      const title = lookTitle(item, services, t('settings.lookNumber', { number: index + 1 }));
      const linked = item.service_ids.map((id) => services.find((service) => service.id === id)?.name).filter(Boolean).join(', ');
      return <li key={item.id} className={`mova-looks__card${open ? ' is-open' : ''}`} data-testid="look-card">
        <div className="mova-looks__row">
          {item.image_url ? <img src={item.image_url} alt={item.alt_text} /> : <span className="mova-looks__thumb" />}
          <button type="button" className="mova-looks__summary-button" aria-expanded={open} onClick={() => { setOpenId(open ? null : item.id); setConfirmDelete(null); }}>
            <strong>{title}</strong>
            <small>{linked ? t('settings.bookThisLook', { services: linked }) : t('settings.notLinked')}</small>
            <span className={`mova-looks__pill${item.is_published ? ' is-on' : ''}`}>{item.is_published ? t('settings.onYourPage') : t('settings.hidden')}</span>
          </button>
          <span className="mova-looks__arrows">
            <IconButton label={t('settings.moveUpNamed', { name: title })} icon="chevron" className="mova-looks__up" disabled={index === 0} onClick={() => void move(index, -1)} />
            <IconButton label={t('settings.moveDownNamed', { name: title })} icon="chevron" className="mova-looks__down" disabled={index === items.length - 1} onClick={() => void move(index, 1)} />
          </span>
        </div>
        {open && <div className="mova-looks__editor">
          <TextField label={t('settings.altText')} hint={t('settings.altTextHint')} maxLength={250} value={item.alt_text}
            onChange={(event) => patch(item.id, { alt_text: event.currentTarget.value })} onBlur={(event) => void saveAlt(item, event.currentTarget.value)} />
          <fieldset className="mova-looks__services">
            <legend>{t('settings.linkedServices')}</legend>
            <div className="mova-chip-list">{services.map((service) => <Chip key={service.id} selected={item.service_ids.includes(service.id)} onClick={() => void toggleService(item, service.id)}>{service.name}</Chip>)}</div>
          </fieldset>
          <Toggle label={t('settings.showOnMyPage')} description={item.alt_text.trim() ? t('settings.hiddenStaysHere') : t('settings.describeFirst')}
            checked={item.is_published} disabled={!item.is_published && !item.alt_text.trim()} onChange={(value) => void setPublished(item, value)} />
          <button type="button" className="mova-button mova-button--destructive" onClick={() => void remove(item)}>{confirmDelete === item.id ? t('settings.confirmDeleteLook') : t('settings.deleteLook')}</button>
        </div>}
      </li>;
    })}</ol>
  </main>;
}

export default PortfolioSettingsPage;
