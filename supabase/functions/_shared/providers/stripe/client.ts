export type StripeCheckoutInput = {
  accountId: string;
  amountMinor: number;
  applicationFeeMinor: number;
  currency: 'usd';
  expiresAt: number;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  productName: string;
  customerEmail?: string;
  locale?: 'en' | 'es';
  idempotencyKey: string;
};

type StripeResponse = Record<string, unknown>;

export class StripeTestClient {
  constructor(private readonly secretKey: string, private readonly fetcher: typeof fetch = fetch) {
    if (!secretKey.startsWith('sk_test_')) throw new Error('STRIPE_TEST_KEY_REQUIRED');
  }

  private async post(path: string, form: URLSearchParams, accountId?: string, idempotencyKey?: string): Promise<StripeResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (accountId) {
      if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error('STRIPE_ACCOUNT_ID_INVALID');
      headers['Stripe-Account'] = accountId;
    }
    if (idempotencyKey) {
      if (idempotencyKey.length < 8 || idempotencyKey.length > 200) throw new Error('STRIPE_IDEMPOTENCY_KEY_INVALID');
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const response = await this.fetcher(`https://api.stripe.com/v1${path}`, { method: 'POST', headers, body: form.toString() });
    const result = await response.json().catch(() => null) as StripeResponse | null;
    if (!response.ok || !result) throw new Error('STRIPE_REQUEST_FAILED');
    return result;
  }

  createConnectAuthorizationUrl(clientId: string, redirectUri: string, state: string) {
    if (!/^ca_[A-Za-z0-9]+$/.test(clientId) || state.length < 32 || state.length > 256) throw new Error('STRIPE_CONNECT_CONFIG_INVALID');
    const url = new URL('https://connect.stripe.com/oauth/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'read_write', redirect_uri: redirectUri, state }).toString();
    return url.toString();
  }

  async exchangeConnectCode(code: string, clientId: string) {
    if (!/^ca_[A-Za-z0-9]+$/.test(clientId) || !/^[A-Za-z0-9_-]{10,512}$/.test(code)) throw new Error('STRIPE_CONNECT_CODE_INVALID');
    const response = await this.fetcher('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_secret: this.secretKey }).toString(),
    });
    const result = await response.json().catch(() => null) as StripeResponse | null;
    if (!response.ok || !result || typeof result.stripe_user_id !== 'string' || !/^acct_[A-Za-z0-9]+$/.test(result.stripe_user_id)) {
      throw new Error('STRIPE_CONNECT_EXCHANGE_FAILED');
    }
    return result;
  }

  async retrieveConnectedAccount(accountId: string) {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error('STRIPE_ACCOUNT_ID_INVALID');
    const response = await this.fetcher(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${this.secretKey}` },
    });
    const result = await response.json().catch(() => null) as StripeResponse | null;
    if (!response.ok || !result) throw new Error('STRIPE_ACCOUNT_READ_FAILED');
    return result;
  }

  /** Express accounts only: a single-use link into the Express dashboard. */
  async createExpressLoginLink(accountId: string) {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error('STRIPE_ACCOUNT_ID_INVALID');
    const result = await this.post(`/accounts/${encodeURIComponent(accountId)}/login_links`, new URLSearchParams());
    if (typeof result.url !== 'string' || !result.url.startsWith('https://')) throw new Error('STRIPE_LOGIN_LINK_FAILED');
    return result.url;
  }

  /**
   * Task 4.1: Stripe's own processing fee for a direct charge, read from the charge's balance
   * transaction on the connected account. Returns minor units, or null when Stripe has not settled it yet.
   */
  async retrieveProcessorFee(paymentIntentId: string, accountId: string) {
    if (!/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error('STRIPE_FEE_REQUEST_INVALID');
    const url = `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`;
    const response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.secretKey}`, 'Stripe-Account': accountId } });
    const result = await response.json().catch(() => null) as StripeResponse | null;
    if (!response.ok || !result) throw new Error('STRIPE_FEE_READ_FAILED');
    const charge = result.latest_charge as StripeResponse | null | undefined;
    const balance = charge && typeof charge === 'object' ? charge.balance_transaction as StripeResponse | null | undefined : null;
    if (!balance || typeof balance !== 'object') return null;
    const details = Array.isArray(balance.fee_details) ? balance.fee_details as StripeResponse[] : [];
    const stripeFee = details.filter((item) => item.type === 'stripe_fee').reduce((sum, item) => sum + (Number.isSafeInteger(item.amount) ? Number(item.amount) : 0), 0);
    const balanceId = typeof balance.id === 'string' ? balance.id : null;
    return { feeMinor: details.length ? stripeFee : (Number.isSafeInteger(balance.fee) ? Number(balance.fee) : 0), balanceTransactionId: balanceId };
  }

  async createCheckoutSession(input: StripeCheckoutInput) {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1
      || !Number.isSafeInteger(input.applicationFeeMinor) || input.applicationFeeMinor < 0
      || input.applicationFeeMinor > input.amountMinor) throw new Error('STRIPE_AMOUNT_INVALID');
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (input.expiresAt < nowSeconds + 1800 || input.expiresAt > nowSeconds + 86400) throw new Error('STRIPE_SESSION_EXPIRY_INVALID');
    const form = new URLSearchParams({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency,
      'line_items[0][price_data][unit_amount]': String(input.amountMinor),
      'line_items[0][price_data][product_data][name]': input.productName.slice(0, 120),
      expires_at: String(input.expiresAt),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.clientReferenceId,
      locale: input.locale ?? 'auto',
      'payment_intent_data[application_fee_amount]': String(input.applicationFeeMinor),
    });
    if (input.customerEmail) form.set('customer_email', input.customerEmail);
    for (const [key, value] of Object.entries(input.metadata)) {
      if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key) || value.length > 500) throw new Error('STRIPE_METADATA_INVALID');
      form.set(`metadata[${key}]`, value);
      form.set(`payment_intent_data[metadata][${key}]`, value);
    }
    return this.post('/checkout/sessions', form, input.accountId, input.idempotencyKey);
  }

  expireCheckoutSession(sessionId: string, accountId: string) {
    if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) throw new Error('STRIPE_SESSION_ID_INVALID');
    return this.post(`/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, new URLSearchParams(), accountId);
  }

  async retrieveCheckoutSession(sessionId: string, accountId: string) {
    if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error('STRIPE_SESSION_ID_INVALID');
    const response = await this.fetcher(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Stripe-Account': accountId },
    });
    const result = await response.json().catch(() => null) as StripeResponse | null;
    if (!response.ok || !result) throw new Error('STRIPE_SESSION_READ_FAILED');
    return result;
  }

  createRefund(input: { paymentIntentId: string; amountMinor: number; idempotencyKey: string; accountId: string; refundApplicationFee?: boolean }) {
    if (!/^pi_[A-Za-z0-9_]+$/.test(input.paymentIntentId) || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1
      || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) throw new Error('STRIPE_REFUND_INVALID');
    const form = new URLSearchParams({ payment_intent: input.paymentIntentId, amount: String(input.amountMinor), refund_application_fee: String(input.refundApplicationFee ?? true) });
    return this.post('/refunds', form, input.accountId, input.idempotencyKey);
  }
}

const hex = (bytes: Uint8Array) => [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
const equal = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
};

export async function verifyStripeTestWebhook(rawBody: string, signatureHeader: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret.startsWith('whsec_')) return false;
  const parts = signatureHeader.split(',').map((part) => part.split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0 || Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  const expected = hex(digest);
  return signatures.some((signature) => /^[0-9a-f]{64}$/i.test(signature) && equal(signature.toLowerCase(), expected));
}
