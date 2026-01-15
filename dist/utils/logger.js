/**
 * Simple logging utility
 * Replaces crawlee's log with a lightweight implementation
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warning: 2,
    error: 3,
};
// Default to 'info' level, can be overridden via environment
const currentLevel = process.env.LOG_LEVEL || 'info';
function shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}
function formatMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    if (data && Object.keys(data).length > 0) {
        return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${message}`;
}
export const log = {
    debug(message, data) {
        if (shouldLog('debug')) {
            console.debug(formatMessage('debug', message, data));
        }
    },
    info(message, data) {
        if (shouldLog('info')) {
            console.info(formatMessage('info', message, data));
        }
    },
    warning(message, data) {
        if (shouldLog('warning')) {
            console.warn(formatMessage('warning', message, data));
        }
    },
    error(message, data) {
        if (shouldLog('error')) {
            console.error(formatMessage('error', message, data));
        }
    },
};
//# sourceMappingURL=logger.js.map