create or replace function public.mova_booking_create_with_consent(
  p_location_id uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_client_locale text,
  p_idempotency_key text,
  p_manage_token_hash bytea,
  p_alternate_starts_at timestamptz,
  p_client_note text,
  p_portfolio_item_id uuid,
  p_consent_choices jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  result jsonb;
  appointment public.mova_appointments%rowtype;
  purpose_choice record;
  channel_choice record;
  allowed_purpose boolean;
  allowed_channel boolean;
begin
  if p_consent_choices is null or jsonb_typeof(p_consent_choices) <> 'object' then
    raise exception using errcode = '22023', message = 'BOOKING_CONSENTS_INVALID';
  end if;

  for purpose_choice in select key, value from jsonb_each(p_consent_choices) loop
    allowed_purpose := purpose_choice.key in ('rebooking_reminders', 'offers', 'review_requests');
    if not allowed_purpose or jsonb_typeof(purpose_choice.value) <> 'object' then
      raise exception using errcode = '22023', message = 'BOOKING_CONSENTS_INVALID';
    end if;
    for channel_choice in select key, value from jsonb_each(purpose_choice.value) loop
      allowed_channel := channel_choice.key in ('email', 'sms')
        and (purpose_choice.key <> 'review_requests' or channel_choice.key = 'email');
      if not allowed_channel or jsonb_typeof(channel_choice.value) <> 'boolean' then
        raise exception using errcode = '22023', message = 'BOOKING_CONSENTS_INVALID';
      end if;
    end loop;
  end loop;

  result := public.mova_booking_create_with_options(
    p_location_id, p_service_id, p_starts_at, p_client_name, p_client_email,
    p_client_phone, p_client_locale, p_idempotency_key, p_manage_token_hash,
    p_alternate_starts_at, p_client_note, p_portfolio_item_id
  );
  if coalesce((result ->> 'replayed')::boolean, false) then
    return result;
  end if;

  select * into appointment
  from public.mova_appointments
  where id = (result ->> 'id')::uuid;
  if not found then
    raise exception using errcode = 'P0002', message = 'BOOKING_NOT_FOUND';
  end if;

  if appointment.client_id is not null then
    for purpose_choice in select key, value from jsonb_each(p_consent_choices) loop
      for channel_choice in select key, value from jsonb_each(purpose_choice.value) loop
        if (channel_choice.key = 'email' and appointment.client_email is not null)
          or (channel_choice.key = 'sms' and appointment.client_phone is not null) then
          insert into public.mova_client_consents(
            artist_business_id, client_id, purpose, channel, granted, locale, evidence, changed_at
          ) values (
            appointment.artist_business_id,
            appointment.client_id,
            purpose_choice.key,
            channel_choice.key,
            (channel_choice.value #>> '{}')::boolean,
            coalesce(appointment.client_locale, 'en-US'),
            jsonb_build_object(
              'source', 'booking_checkout',
              'copy_version', 'f04-checkout-v1',
              'appointment_id', appointment.id
            ),
            clock_timestamp()
          );
        end if;
      end loop;
    end loop;
  end if;

  return result;
end;
$$;

revoke all on function public.mova_booking_create_with_consent(uuid, uuid, timestamptz, text, text, text, text, text, bytea, timestamptz, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mova_booking_create_with_consent(uuid, uuid, timestamptz, text, text, text, text, text, bytea, timestamptz, text, uuid, jsonb) to service_role;
