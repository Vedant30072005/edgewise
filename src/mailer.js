/**
 * Email abstraction.
 * - Dev (no SMTP_HOST): prints the email to console so you can copy-paste links.
 * - Prod: sends via SMTP using nodemailer (configure SMTP_* in .env).
 */
const nodemailer = require('nodemailer');

const transport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

async function sendMail({ to, subject, text, html }) {
  if (!transport) {
    console.log('\n[edgewise] ── EMAIL (dev mode — not sent) ─────────────');
    console.log(`  To:      ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log('  Body:');
    text.split('\n').forEach(l => console.log(`    ${l}`));
    console.log('─────────────────────────────────────────────────────\n');
    return;
  }
  await transport.sendMail({
    from: process.env.SMTP_FROM || 'Edgewise <noreply@edgewise.local>',
    to, subject, text, html,
  });
}

module.exports = { sendMail };
