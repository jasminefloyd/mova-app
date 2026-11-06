import { Component } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { logger } from '../lib/logger';
import { ErrorFallback } from './ErrorFallback';

type Props = PropsWithChildren;
type State = { hasError: boolean };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    logger.error('app.render_error', { code: error.name.toUpperCase() });
  }

  render(): ReactNode {
    return this.state.hasError ? <ErrorFallback /> : this.props.children;
  }
}
