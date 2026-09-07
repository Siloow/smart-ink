import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorFallbackProps {
  error: Error;
  /** Clears the caught error and renders the children again. */
  reset: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback: (props: ErrorFallbackProps) => ReactNode;
  /**
   * When any value in this list changes while an error is showing, the error
   * is cleared and the children re-render. Use it to recover automatically
   * when the user changes the thing that failed (e.g. switches body mesh).
   */
  resetKeys?: readonly unknown[];
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function sameKeys(a?: readonly unknown[], b?: readonly unknown[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Catches render errors below it and shows `fallback` instead of unmounting
 * the whole tree. React only exposes this through a class component.
 *
 * React Three Fiber's <Canvas> rethrows errors from inside the WebGL tree in
 * the DOM tree, so a boundary wrapping the Canvas catches mesh-load and
 * shader failures too.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Smart Ink] Uncaught render error:', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && !sameKeys(prevProps.resetKeys, this.props.resetKeys)) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}
