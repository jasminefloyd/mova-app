import { Component } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { logger } from '../lib/logger';
import { ErrorFallback } from './ErrorFallback';
import { createMovaSupabaseClient } from '../lib/supabase';
import { appVersion } from '../lib/env';

type Props = PropsWithChildren;
type State = { hasError: boolean; requestId: string | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, requestId: null };

  private readonly onWindowError = () => this.reportClientError('error');
  private readonly onUnhandledRejection = () => this.reportClientError('unhandledrejection');
  private readonly onRequestError = (event: Event) => {
    const requestId = (event as CustomEvent<{ requestId?: string }>).detail?.requestId;
    if (requestId) this.setState({ requestId });
  };

  componentDidMount(): void {
    window.addEventListener('error', this.onWindowError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    window.addEventListener('mova:request-error', this.onRequestError);
  }

  componentWillUnmount(): void {
    window.removeEventListener('error', this.onWindowError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    window.removeEventListener('mova:request-error', this.onRequestError);
  }

  private reportClientError(event: 'error' | 'unhandledrejection'): void {
    const requestId = crypto.randomUUID();
    try {
      void createMovaSupabaseClient().functions.invoke('client-log', {
        body: { event, level: 'error', route: window.location.pathname, app_version: appVersion, request_id: requestId },
        headers: { 'x-request-id': requestId },
      });
    } catch { /* Error reporting is best effort. */ }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, requestId: null };
  }

  componentDidCatch(error: Error): void {
    const requestId = crypto.randomUUID();
    this.setState({ requestId });
    logger.error('app.render_error', { requestId, code: error.name.toUpperCase() });
    try { void createMovaSupabaseClient().functions.invoke('client-log', {
      body: { event: 'render_error', level: 'error', route: window.location.pathname, app_version: appVersion, request_id: requestId, message: error.name },
      headers: { 'x-request-id': requestId },
    }); } catch { /* Error reporting must never mask the original app error. */ }
  }

  render(): ReactNode {
    return this.state.hasError ? <ErrorFallback requestId={this.state.requestId} /> : <>
      {this.props.children}
      {this.state.requestId ? <div className="mova-request-reference" role="status">A request failed. Reference: <code>{this.state.requestId}</code><button type="button" onClick={() => this.setState({ requestId: null })} aria-label="Dismiss reference">×</button></div> : null}
    </>;
  }
}
