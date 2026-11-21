class Logger {
  private debugEnabled = false;

  public setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  public debug(scope: string, message: string, data?: unknown): void {
    if (!this.debugEnabled) return;
    if (data !== undefined) {
      console.debug(`[${scope}] ${message}`, data);
    } else {
      console.debug(`[${scope}] ${message}`);
    }
  }

  public warn(scope: string, message: string, data?: unknown): void {
    if (data !== undefined) {
      console.warn(`[${scope}] ${message}`, data);
    } else {
      console.warn(`[${scope}] ${message}`);
    }
  }

  public error(scope: string, message: string, err?: unknown): void {
    if (err !== undefined) {
      console.error(`[${scope}] ${message}`, err);
    } else {
      console.error(`[${scope}] ${message}`);
    }
  }
}

export const logger = new Logger();
