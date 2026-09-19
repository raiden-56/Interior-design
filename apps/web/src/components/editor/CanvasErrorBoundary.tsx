'use client';

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  label: string;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a renderer failure inside its pane.
 *
 * WebGL can refuse to start (blocked GPU, exhausted contexts, remote desktop),
 * and Pixi/Three throw during init when it does. Without a boundary React
 * unmounts the whole editor — toolbars, panels, the lot — leaving a blank
 * page with no way to switch views or export the work.
 */
export class CanvasErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[${this.props.label}] renderer crashed`, error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center">
        <div className="max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-amber-400" />
          <h3 className="text-sm font-medium text-zinc-100">The {this.props.label} could not be displayed</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
            {this.state.error.message || 'The graphics engine failed to start.'} Your project is unaffected — try the other view,
            or reload once hardware acceleration is enabled in your browser.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      </div>
    );
  }
}
