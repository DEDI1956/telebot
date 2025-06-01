require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dns = require('dns').promises;
const fs = require('fs');

const userSession = {};
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN belum di-set di .env');
  process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Helper: tombol menu utama
function getMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '➕ Tambah Wildcard DNS', callback_data: 'addcf' },
        { text: '📄 List DNS', callback_data: 'listcf' }
      ],
      [
        { text: '✏️ Update DNS', callback_data: 'updatecf' },
        { text: '🗑 Hapus DNS', callback_data: 'delcf' }
      ],
      [
        { text: '🔎 Cek Wildcard', callback_data: 'cek' },
        { text: '💾 Backup DNS', callback_data: 'backup' }
      ],
      [
        { text: '♻️ Restore DNS', callback_data: 'restore' },
        { text: '📜 Riwayat', callback_data: 'riwayat' }
      ],
      [
        { text: '🌐 Pilih Domain', callback_data: 'zone' },
        { text: '📦 Tipe Record', callback_data: 'recordtype' }
      ],
      [
        { text: '⏰ TTL & Proxy', callback_data: 'ttlproxy' },
        { text: '👥 Admin/User', callback_data: 'useradmin' }
      ],
      [
        { text: '🌍 Cek Propagasi', callback_data: 'propagasi' },
        { text: '🗑 Auto Delete', callback_data: 'autodelete' }
      ],
      [
        { text: '🔒 WHOIS & SSL', callback_data: 'whois' },
        { text: '📢 Monitoring', callback_data: 'monitor' }
      ],
      [
        { text: '❓ Bantuan', callback_data: 'help' },
        { text: '🚪 Keluar', callback_data: 'logout' }
      ]
    ]
  };
}

// ====== ONBOARDING ======
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSession[chatId] = { step: 'cf_account_id' };
  bot.sendMessage(
    chatId,
    `👋 *Selamat datang di Bot Cloudflare DNS!*\n\n` +
      `Untuk mulai, silakan masukkan *Cloudflare Account ID* kamu.`,
    { parse_mode: 'Markdown' }
  );
});

// ====== HANDLE ONBOARDING ======
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text && msg.text.trim();
  if (text.startsWith('/')) return;
  const session = userSession[chatId];
  if (!session) return;

  if (session.step === 'cf_account_id') {
    session.accountId = text;
    session.step = 'cf_zone_id';
    bot.sendMessage(chatId, 'Sekarang masukkan *Zone ID* domain Cloudflare kamu:', { parse_mode: 'Markdown' });
    return;
  }
  if (session.step === 'cf_zone_id') {
    session.zoneId = text;
    session.step = 'cf_token';
    bot.sendMessage(
      chatId,
      'Terakhir, masukkan *API Token Cloudflare* (harus punya akses DNS):',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  if (session.step === 'cf_token') {
    session.apiToken = text;
    session.step = 'menu';
    bot.sendMessage(
      chatId,
      `✅ Cloudflare terhubung!\n\nSilakan pilih fitur di bawah ini:`,
      {
        parse_mode: 'Markdown',
        reply_markup: getMenuKeyboard()
      }
    );
    return;
  }
});

// ====== CALLBACK MENU UTAMA ======
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = userSession[chatId];

  // Logout: hapus session
  if (data === 'logout') {
    delete userSession[chatId];
    bot.sendMessage(chatId, '🚪 Kamu telah keluar dari session Cloudflare.\nKetik /start untuk mulai lagi.');
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Cek sudah login
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    bot.answerCallbackQuery(query.id);
    return;
  }

  // Menu routing
  switch (data) {
    case 'addcf': session.step = 'addcf_ask'; bot.sendMessage(chatId, 'Kirim format: `*.domain.com 1.2.3.4`', { parse_mode: 'Markdown' }); break;
    case 'listcf': await handleListDNS(chatId, session); break;
    case 'delcf': session.step = 'delcf_ask'; bot.sendMessage(chatId, 'Kirim *Record ID* yang ingin dihapus:', { parse_mode: 'Markdown' }); break;
    case 'updatecf': session.step = 'updatecf_ask'; bot.sendMessage(chatId, 'Kirim format: `record_id 5.6.7.8`', { parse_mode: 'Markdown' }); break;
    case 'cek': session.step = 'cek_ask'; bot.sendMessage(chatId, 'Kirim wildcard, contoh: `*.domain.com`', { parse_mode: 'Markdown' }); break;
    case 'backup': await handleBackupDNS(chatId, session); break;
    case 'restore': session.step = 'restore_ask'; bot.sendMessage(chatId, 'Upload file backup JSON DNS untuk restore.', { parse_mode: 'Markdown' }); break;
    case 'riwayat': await handleAuditLog(chatId, session); break;
    case 'zone': session.step = 'zone_ask'; bot.sendMessage(chatId, 'Kirim Zone ID (domain) yang ingin dipakai:', { parse_mode: 'Markdown' }); break;
    case 'recordtype': session.step = 'recordtype_ask'; bot.sendMessage(chatId, 'Ketik tipe record yang ingin dikelola (A, AAAA, CNAME, TXT, MX, dsb):', { parse_mode: 'Markdown' }); break;
    case 'ttlproxy': session.step = 'ttlproxy_ask'; bot.sendMessage(chatId, 'Ketik TTL (detik) dan status proxied (true/false), contoh: `120 true`:', { parse_mode: 'Markdown' }); break;
    case 'useradmin': await handleUserAdmin(chatId, session); break;
    case 'propagasi': session.step = 'propagasi_ask'; bot.sendMessage(chatId, 'Ketik domain/subdomain yang ingin dicek propagasi:', { parse_mode: 'Markdown' }); break;
    case 'autodelete': session.step = 'autodelete_ask'; bot.sendMessage(chatId, 'Ketik record_id dan waktu expired (menit), contoh: `record_id 60`:', { parse_mode: 'Markdown' }); break;
    case 'whois': session.step = 'whois_ask'; bot.sendMessage(chatId, 'Ketik domain yang ingin dicek WHOIS & SSL:', { parse_mode: 'Markdown' }); break;
    case 'monitor': session.step = 'monitor_ask'; bot.sendMessage(chatId, 'Ketik domain/subdomain yang ingin dimonitor (status up/down):', { parse_mode: 'Markdown' }); break;
    case 'help': sendHelp(chatId); break;
    default: bot.sendMessage(chatId, 'Fitur belum didukung.'); break;
  }

  bot.answerCallbackQuery(query.id);
});

// ====== HANDLING STEP LANJUTAN USER (kerangka, tambahkan sesuai fitur) ======
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text && msg.text.trim();
  if (text.startsWith('/')) return;
  const session = userSession[chatId];
  if (!session || !session.step) return;

  // Contoh: addcf
  if (session.step === 'addcf_ask') {
    const [name, content] = text.split(' ');
    await handleAddDNS(chatId, session, name, content);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // Tambahkan step lain sesuai fitur (delcf_ask, updatecf_ask, restore_ask, dsb)
});

// ====== Placeholders: Tambahkan kode detail per fitur di bawah ini ======
async function handleAddDNS(chatId, session, name, content) { /* ... */ }
async function handleListDNS(chatId, session) { /* ... */ }
async function handleBackupDNS(chatId, session) { /* ... */ }
async function handleAuditLog(chatId, session) { /* ... */ }
async function handleUserAdmin(chatId, session) { /* ... */ }
function sendHelp(chatId) {
  bot.sendMessage(chatId, 'Daftar fitur:\n- Tambah wildcard DNS\n- List DNS\n- Update/Hapus record\n- Backup/restore\n- Riwayat, multi-zone, record type, TTL/proxy, user/admin, propagasi, auto-delete, whois/SSL, monitoring, dan keluar session.\n\nPilih fitur di menu.');
}

console.log('Bot Telegram Cloudflare DNS siap!');
