-- Task 4.1: post Stripe's processing fee to the ledger so Money's "Stripe processing" matches Stripe.
-- The webhook queues a job; the job reads the fee from the charge's balance transaction and calls
-- mova_stripe_record_processor_fee. The fee belongs to the connected account (direct charges).

create or replace function public.mova_stripe_enqueue_processor_fee(p_payment_id uuid, p_payment_intent_id text, p_account_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare payment public.mova_payments%rowtype;
begin
  if p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' or p_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception using errcode = '22023', message = 'STRIPE_FEE_REQUEST_INVALID'; end if;
  select * into payment from public.mova_payments where id = p_payment_id;
  if not found or payment.provider <> 'stripe' or payment.collector <> 'mova_processed' then return false; end if;
  if not exists (select 1 from public.mova_stripe_connections c where c.artist_business_id = payment.artist_business_id and c.stripe_account_id = p_account_id) then
    raise exception using errcode = '42501', message = 'STRIPE_ACCOUNT_MISMATCH';
  end if;
  insert into public.mova_background_jobs(job_type, artist_business_id, payload, idempotency_key)
  values ('stripe_processor_fee', payment.artist_business_id,
    jsonb_build_object('payment_id', payment.id, 'payment_intent_id', p_payment_intent_id, 'account_id', p_account_id), 'stripe-fee:' || payment.id::text)
  on conflict (idempotency_key) do nothing;
  return true;
end $$;
revoke all on function public.mova_stripe_enqueue_processor_fee(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mova_stripe_enqueue_processor_fee(uuid, text, text) to service_role;

-- Idempotent: the ledger key is the same one 0009 uses for a fee known at success time, so a fee is
-- posted at most once per payment. A different fee for an already-posted payment is refused.
create or replace function public.mova_stripe_record_processor_fee(p_payment_id uuid, p_fee_minor bigint)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare payment public.mova_payments%rowtype; posted bigint;
begin
  if p_fee_minor is null or p_fee_minor < 0 then raise exception using errcode = '22023', message = 'STRIPE_FEE_INVALID'; end if;
  select * into payment from public.mova_payments where id = p_payment_id for update;
  if not found or payment.provider <> 'stripe' or payment.status not in ('succeeded', 'partially_refunded', 'refunded') then return 'not_applicable'; end if;
  if p_fee_minor > payment.amount_minor then raise exception using errcode = '22023', message = 'STRIPE_FEE_INVALID'; end if;
  select -amount_minor into posted from public.mova_payment_ledger where artist_business_id = payment.artist_business_id and idempotency_key = 'payment_processor_fee:' || payment.id::text;
  if posted is not null then
    if posted <> p_fee_minor then raise exception using errcode = '22023', message = 'STRIPE_FEE_MISMATCH'; end if;
    return 'already_posted';
  end if;
  update public.mova_payments set processor_fee_minor = p_fee_minor, updated_at = now() where id = payment.id;
  if p_fee_minor > 0 then
    insert into public.mova_payment_ledger(artist_business_id, appointment_id, payment_id, category, amount_minor, currency, idempotency_key)
    values (payment.artist_business_id, payment.appointment_id, payment.id, 'processor_fee', -p_fee_minor, payment.currency, 'payment_processor_fee:' || payment.id::text);
  end if;
  return 'posted';
end $$;
revoke all on function public.mova_stripe_record_processor_fee(uuid, bigint) from public, anon, authenticated;
grant execute on function public.mova_stripe_record_processor_fee(uuid, bigint) to service_role;
