interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

interface ProviderState {
  failures: number;
  lastFailureAt: number;
  available: boolean;
}

export class CircuitBreaker {
  private states = new Map<string, ProviderState>();
  private failureThreshold: number;
  private resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = options.failureThreshold;
    this.resetTimeoutMs = options.resetTimeoutMs;
  }

  private getState(provider: string): ProviderState {
    if (!this.states.has(provider)) {
      this.states.set(provider, { failures: 0, lastFailureAt: 0, available: true });
    }
    return this.states.get(provider)!;
  }

  isAvailable(provider: string): boolean {
    const state = this.getState(provider);
    if (state.available) return true;
    if (Date.now() - state.lastFailureAt > this.resetTimeoutMs) {
      state.available = true;
      state.failures = 0;
      return true;
    }
    return false;
  }

  recordFailure(provider: string): void {
    const state = this.getState(provider);
    state.failures++;
    state.lastFailureAt = Date.now();
    if (state.failures >= this.failureThreshold) {
      state.available = false;
    }
  }

  recordSuccess(provider: string): void {
    const state = this.getState(provider);
    state.failures = 0;
    state.available = true;
  }

  getNextProvider(chain: string[]): string | null {
    for (const provider of chain) {
      if (this.isAvailable(provider)) return provider;
    }
    return null;
  }

  getStatus(): Record<string, { available: boolean; failures: number }> {
    const status: Record<string, { available: boolean; failures: number }> = {};
    for (const [provider, state] of this.states) {
      status[provider] = {
        available: this.isAvailable(provider),
        failures: state.failures,
      };
    }
    return status;
  }
}
