import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { createMovaSupabaseClient } from '../../lib/supabase';
import { goTo, openWorkspace, resolveWorkspaces, type WorkspaceChoice } from './stylist-workspace';
import './stylist-auth.css';

type Status = 'working' | 'expired' | 'error';

/** Reads the error Supabase appends to the link's address when a link is expired, reused or invalid. */
function linkError(): string | null {
  const values = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  return values.get('error_code') ?? values.get('error') ?? query.get('error_code') ?? query.get('error');
}

/**
 * /auth/confirm: where every stylist email link lands (sign-up and sign-in). The Supabase client finishes the
 * sign-in from the link, then a new stylist continues onboarding and a returning stylist opens their workspace.
 */
export default function AuthConfirmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '';
  const supabase = useMemo(() => { try { return createMovaSupabaseClient(); } catch { return null; } }, []);
  const [status, setStatus] = useState<Status>('working');
  const [choices, setChoices] = useState<WorkspaceChoice[]>([]);

  useEffect(() => {
    if (!supabase) { setStatus('error'); return; }
    const failure = linkError();
    if (failure) { setStatus(/expired|otp|access_denied/i.test(failure) ? 'expired' : 'error'); return; }
    let done = false;
    const route = async (userId: string) => {
      if (done) return;
      done = true;
      try {
        // Admin email links use the existing allowlisted callback, then return to the MFA gate.
        if (returnTo === '/admin/signin') {
          navigate('/admin/signin', { replace: true });
          return;
        }
        const workspaceReturn = returnTo.startsWith('/onboarding') ? '' : returnTo;
        const resolution = await resolveWorkspaces(supabase, userId, workspaceReturn);
        if (resolution.kind === 'none') navigate('/onboarding/profile', { replace: true });
        else if (resolution.kind === 'choose') setChoices(resolution.choices);
        else {
          const { data: progress } = await supabase.from('mova_onboarding_progress').select('current_step').eq('artist_business_id', resolution.businessId).maybeSingle();
          // Someone who hasn't finished setup picks up where they left off; onboarding resumes the right step.
          if (progress && progress.current_step !== 'complete') navigate('/onboarding/profile', { replace: true });
          else goTo(await openWorkspace(supabase, resolution.businessId, workspaceReturn), navigate);
        }
      } catch { setStatus('error'); }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { if (session) void route(session.user.id); });
    void supabase.auth.getSession().then(({ data: { session } }) => { if (session) void route(session.user.id); });
    const timer = window.setTimeout(() => { if (!done) setStatus('expired'); }, 10000);
    return () => { subscription.unsubscribe(); window.clearTimeout(timer); };
  }, [navigate, returnTo, supabase]);

  const enter = async (businessId: string) => {
    if (!supabase) return;
    goTo(await openWorkspace(supabase, businessId, returnTo), navigate);
  };

  return <div className="stylist-auth stylist-auth--signin">
    <header className="stylist-auth__top"><Link className="stylist-auth__wordmark" to="/">mova</Link></header>
    <div className="stylist-auth__rule" aria-hidden="true" />
    <div className="stylist-auth__column">
      {choices.length > 0 ? <section className="stylist-auth__choices" aria-label={t('stylistAuth.signIn.chooseTitle')}>
        <h1 className="stylist-auth__title">{t('stylistAuth.signIn.chooseTitle')}</h1>
        {choices.map((choice) => <button key={choice.id} type="button" className="stylist-auth__choice" onClick={() => void enter(choice.id)}>{choice.label}</button>)}
      </section>
        : status === 'working' ? <p className="stylist-auth__lede" role="status" aria-busy="true">{t('stylistAuth.confirm.working')}</p>
        : <section className="stylist-auth__check" aria-labelledby="stylist-confirm-h">
          <h1 id="stylist-confirm-h" className="stylist-auth__title">{status === 'expired' ? t('stylistAuth.confirm.expiredTitle') : t('stylistAuth.confirm.error')}</h1>
          <p className="stylist-auth__lede">{t('stylistAuth.confirm.expiredBody')}</p>
          <Link className="stylist-auth__submit" to="/login">{t('stylistAuth.confirm.newLink')}</Link>
        </section>}
    </div>
  </div>;
}
