-- Stylist detail writes a view audit entry, so PostgREST must run its POST in a read-write transaction.
alter function public.mova_admin_stylist_detail(uuid) volatile;

notify pgrst, 'reload schema';
