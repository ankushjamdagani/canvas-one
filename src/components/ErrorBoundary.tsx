import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          className="min-h-screen w-full flex items-center justify-center p-6 bg-background text-foreground"
        >
          <div className="w-full max-w-md p-6 bg-card border border-border rounded-xl shadow-xl flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-semibold text-foreground">
                  Something went wrong
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  An unexpected error occurred in the workspace.
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="p-3 bg-muted/60 border border-border/80 rounded-lg text-xs font-mono text-muted-foreground overflow-x-auto max-h-32">
                <p className="font-semibold text-destructive">
                  {this.state.error.name}: {this.state.error.message}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                size="sm"
                onClick={this.handleReset}
                className="flex items-center gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Try again
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={this.handleReload}
                className="text-xs"
              >
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
