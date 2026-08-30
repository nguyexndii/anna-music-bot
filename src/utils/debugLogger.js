/**
 * debugLogger.js
 *
 * Helper log debug de truy vet moi hanh dong Discord API cua bot.
 * Moi dong log co timestamp chinh xac toi mili-giay, de doi chieu voi
 * thoi diem nghe tieng "tit" tren taskbar.
 *
 * Format: [DEBUG 2026-08-29T10:15:32.481Z] ACTION key=val key=val ...
 */

/**
 * Ghi 1 dong log debug voi timestamp ISO hien tai.
 * @param {string} action  Ten hanh dong viet HOA (e.g. MESSAGE_SEND)
 * @param {Object} details Cac cap key-value bo sung (tuy chon)
 */
function logAction(action, details = {}) {
  const ts = new Date().toISOString();
  const pairs = Object.entries(details)
    .map(([k, v]) => {
      const val = (v === null || v === undefined) ? 'null' : String(v);
      return `${k}=${val.includes(' ') || val.length === 0 ? `"${val}"` : val}`;
    })
    .join(' ');
  console.log(`[DEBUG ${ts}] ${action}${pairs ? ' ' + pairs : ''}`);
}

module.exports = { logAction };
