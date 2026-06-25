/**
 * Edgewise — structured logging for production debugging.
 * Logs as JSON that's parseable by Render/Railway/etc. logging systems.
 * Usage: log('info', 'User login', { userId: 123, email: 'user@example.com' })
 */

/**
 * Log structured JSON with timestamp, level, message, and context.
 * @param {string} level - 'debug', 'info', 'warn', 'error'
 * @param {string} msg - Human-readable message
 * @param {Object} context - Additional fields to include in log (optional)
 */
function log(level, msg, context = {}) {
  const logEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...context,
  };
  // Output to stdout/stderr so hosting platforms can collect it
  if (level === 'error') {
    console.error(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

function debug(msg, ctx) {
  log('debug', msg, ctx);
}

function info(msg, ctx) {
  log('info', msg, ctx);
}

function warn(msg, ctx) {
  log('warn', msg, ctx);
}

function error(msg, ctx) {
  log('error', msg, ctx);
}

module.exports = { log, debug, info, warn, error };
