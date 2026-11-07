-- P17 executes the recorded safe default for A-16: Zelle is unavailable.
update public.mova_payment_method_settings set zelle_recorded_enabled=false where zelle_recorded_enabled;
alter table public.mova_payment_method_settings alter column zelle_recorded_enabled set default false;

alter function public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid) rename to mova_payment_record_manual_legacy;
revoke all on function public.mova_payment_record_manual_legacy(uuid,uuid,text,bigint,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_payment_record_manual_legacy(uuid,uuid,text,bigint,text,text,text,text,uuid) to service_role;
create function public.mova_payment_record_manual(
  p_artist_business_id uuid,p_appointment_id uuid,p_method text,p_amount_minor bigint,p_collector text,
  p_recorded_method_label text,p_confirmation_ref text,p_idempotency_key text,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_method='zelle_recorded' then raise exception using errcode='22023',message='PAYMENT_METHOD_UNAVAILABLE'; end if;
  if p_method not in ('cash','other','salon_collected') then raise exception using errcode='22023',message='MANUAL_PAYMENT_INVALID'; end if;
  return public.mova_payment_record_manual_legacy(p_artist_business_id,p_appointment_id,p_method,p_amount_minor,p_collector,p_recorded_method_label,p_confirmation_ref,p_idempotency_key,p_actor_id);
end $$;
revoke all on function public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.mova_payment_record_manual(uuid,uuid,text,bigint,text,text,text,text,uuid) to service_role;
