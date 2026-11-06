import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState, ErrorState, TextArea } from '../../components';
import { useArtistBusiness } from '../settings/useArtistBusiness';

type Service = { id: string; name: string; status: string };
type Item = { id: string; media_path: string; alt_text: string; sort_order: number; is_published: boolean; service_ids: string[]; image_url: string };

export function PortfolioSettingsPage() {
  const { t } = useTranslation();
  const { client, businessId, loading: identityLoading } = useArtistBusiness();
  const [items, setItems] = useState<Item[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [altText, setAltText] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!client || !businessId) return;
    setError(false);
    const [{ data: rows, error: itemsError }, { data: serviceRows, error: servicesError }] = await Promise.all([
      client.from('mova_portfolio_items').select('id, media_path, alt_text, sort_order, is_published').eq('artist_business_id', businessId).order('sort_order'),
      client.from('mova_services').select('id, name, status').eq('artist_business_id', businessId).order('name'),
    ]);
    if (itemsError || servicesError) { setError(true); return; }
    setServices(serviceRows as Service[] ?? []);
    const mapped = await Promise.all((rows ?? []).map(async (row) => {
      const [{ data: signed }, { data: links }] = await Promise.all([
        client.storage.from('mova_portfolio_media').createSignedUrl(row.media_path, 300),
        client.from('mova_portfolio_service_links').select('service_id').eq('portfolio_item_id', row.id),
      ]);
      return { ...row, image_url: signed?.signedUrl ?? '', service_ids: links?.map((link) => link.service_id) ?? [] } as Item;
    }));
    setItems(mapped);
  }, [businessId, client]);

  useEffect(() => { void load(); }, [load]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.currentTarget.files?.[0] ?? null);
    event.currentTarget.value = '';
  };

  const addItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !businessId || !file) return;
    setLoading(true); setError(false);
    let variants: Record<string, string> | null = null;
    try {
      const { data: uploaded, error: uploadError } = await client.functions.invoke('photo-upload-url', {
        body: { kind: 'portfolio', size: file.size, contentType: file.type },
      });
      if (uploadError) throw uploadError;
      const path = uploaded?.data?.path;
      const token = uploaded?.data?.token;
      const bucket = uploaded?.data?.bucket;
      if (typeof path !== 'string' || typeof token !== 'string' || bucket !== 'mova_portfolio_media') throw new Error('Upload URL response is invalid');
      const { error: storageError } = await client.storage.from(bucket).uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (storageError) throw storageError;
      const { data: processed, error: processError } = await client.functions.invoke('photo-process', { body: { path, kind: 'portfolio', zoom: 1 } });
      if (processError) throw processError;
      variants = processed?.data?.variants;
      if (!variants?.['512']) throw new Error('No image variant returned');
      const { data: row, error: insertError } = await client.from('mova_portfolio_items').insert({
        artist_business_id: businessId, media_path: variants['512'], alt_text: altText.trim(),
        sort_order: items.length, is_published: false,
      }).select('id').single();
      if (insertError || !row) throw insertError ?? new Error('Portfolio item was not created');
      const { error: linkError } = await client.rpc('mova_set_portfolio_service_links', {
        p_artist_business_id: businessId, p_portfolio_item_id: row.id, p_service_ids: selectedServices,
      });
      if (linkError) {
        await client.from('mova_portfolio_items').delete().eq('id', row.id);
        throw linkError;
      }
      setFile(null); setAltText(''); setSelectedServices([]); await load();
    } catch {
      setError(true);
      if (variants) await client.storage.from('mova_portfolio_media').remove(Object.values(variants));
    } finally { setLoading(false); }
  };

  const updateAltText = async (item: Item, nextAlt: string) => {
    if (!client) return;
    const { error: updateError } = await client.from('mova_portfolio_items').update({ alt_text: nextAlt }).eq('id', item.id);
    if (updateError) setError(true); else setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, alt_text: nextAlt } : row));
  };

  const updateLinks = async (item: Item, serviceIds: string[]) => {
    if (!client || !businessId) return;
    const { error: updateError } = await client.rpc('mova_set_portfolio_service_links', {
      p_artist_business_id: businessId, p_portfolio_item_id: item.id, p_service_ids: serviceIds,
    });
    if (updateError) setError(true); else setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, service_ids: serviceIds } : row));
  };

  const setPublished = async (item: Item) => {
    if (!client) return;
    const { error: updateError } = await client.from('mova_portfolio_items').update({ is_published: !item.is_published }).eq('id', item.id);
    if (updateError) setError(true); else setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, is_published: !row.is_published } : row));
  };

  const move = async (index: number, delta: -1 | 1) => {
    if (!client || !businessId) return;
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    const ordered = [...items];
    const currentItem = ordered[index];
    const nextItem = ordered[nextIndex];
    if (!currentItem || !nextItem) return;
    ordered[index] = nextItem;
    ordered[nextIndex] = currentItem;
    const { error: orderError } = await client.rpc('mova_reorder_portfolio_items', {
      p_artist_business_id: businessId, p_item_ids: ordered.map((item) => item.id),
    });
    if (orderError) setError(true); else setItems(ordered.map((item, sort_order) => ({ ...item, sort_order })));
  };

  const remove = async (item: Item) => {
    if (!client) return;
    const { error: deleteError } = await client.from('mova_portfolio_items').delete().eq('id', item.id);
    if (deleteError) { setError(true); return; }
    await client.storage.from('mova_portfolio_media').remove([item.media_path]);
    await load();
  };

  if (identityLoading) return <main className="mova-page"><p role="status">{t('settings.loading')}</p></main>;
  if (!client || !businessId) return <main className="mova-page"><ErrorState title={t('settings.identityError')} retryLabel={t('settings.retry')} onRetry={() => void load()} /></main>;
  return <main className="mova-page mova-settings-page">
    <h1>{t('settings.portfolio')}</h1>
    {error && <ErrorState title={t('settings.saveError')} retryLabel={t('settings.retry')} onRetry={() => void load()} />}
    {items.length === 0 && <EmptyState title={t('settings.noPortfolio')} />}
    <ol className="mova-portfolio-list">{items.map((item, index) => <li key={item.id}>
      <Card className="mova-portfolio-card">
        {item.image_url && <img src={item.image_url} alt="" />}
        <TextArea label={t('settings.altText')} maxLength={250} value={item.alt_text} onChange={(event) => setItems((rows) => rows.map((row) => row.id === item.id ? { ...row, alt_text: event.currentTarget.value } : row))} onBlur={(event) => void updateAltText(item, event.currentTarget.value)} />
        <label className="mova-field"><span className="mova-field__label">{t('settings.linkedServices')}</span><select className="mova-input" multiple value={item.service_ids} onChange={(event) => void updateLinks(item, [...event.currentTarget.selectedOptions].map((option) => option.value))}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <div className="mova-photo-actions"><Button variant="secondary" onClick={() => void move(index, -1)} disabled={index === 0}>{t('settings.moveUp')}</Button><Button variant="secondary" onClick={() => void move(index, 1)} disabled={index === items.length - 1}>{t('settings.moveDown')}</Button><Button variant="ghost" onClick={() => void setPublished(item)}>{item.is_published ? t('settings.unpublish') : t('settings.publish')}</Button><Button variant="destructive" onClick={() => void remove(item)}>{t('settings.delete')}</Button></div>
      </Card>
    </li>)}</ol>
    <Card><form className="mova-form-stack" onSubmit={addItem}>
      <h2>{t('settings.addPortfolioItem')}</h2>
      <label className="mova-field"><span className="mova-field__label">{t('settings.image')}</span><input className="mova-input" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required onChange={selectFile} /></label>
      <TextArea label={t('settings.altText')} required maxLength={250} value={altText} onChange={(event) => setAltText(event.currentTarget.value)} />
      <label className="mova-field"><span className="mova-field__label">{t('settings.linkedServices')}</span><select className="mova-input" multiple value={selectedServices} onChange={(event) => setSelectedServices([...event.currentTarget.selectedOptions].map((option) => option.value))}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      <Button type="submit" loading={loading}>{t('settings.uploadPortfolio')}</Button>
    </form></Card>
  </main>;
}
