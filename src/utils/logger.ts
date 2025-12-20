/**
 * Simple logging utility
 * Replaces crawlee's log with a lightweight implementation
 */

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

// Default to 'info' level, can be overridden via environment
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: object): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data && Object.keys(data).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${message}`;
}

export const log = {
  debug(message: string, data?: object): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, data));
    }
  },

  info(message: string, data?: object): void {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, data));
    }
  },

  warning(message: string, data?: object): void {
    if (shouldLog('warning')) {
      console.warn(formatMessage('warning', message, data));
    }
  },

  error(message: string, data?: object): void {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, data));
    }
  },
};
