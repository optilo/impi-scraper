/**
 * Type definitions for IMPI Scraper
 */
export class IMPIError extends Error {
    code;
    httpStatus;
    retryAfter;
    url;
    timestamp;
    constructor(details) {
        super(details.message);
        this.name = 'IMPIError';
        this.code = details.code;
        this.httpStatus = details.httpStatus;
        this.retryAfter = details.retryAfter;
        this.url = details.url;
        this.timestamp = details.timestamp;
        // Maintains proper stack trace in V8 environments
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, IMPIError);
        }
    }
    toJSON() {
        return {
            code: this.code,
            message: this.message,
            httpStatus: this.httpStatus,
            retryAfter: this.retryAfter,
            url: this.url,
            timestamp: this.timestamp
        };
    }
    /** Check if error is retryable */
    get isRetryable() {
        return ['RATE_LIMITED', 'TIMEOUT', 'NETWORK_ERROR', 'SERVER_ERROR'].includes(this.code);
    }
}
//# sourceMappingURL=types.js.map