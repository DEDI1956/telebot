require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ===== In-memory session per user (reset jika bot restart) =====
const userSession = {};

// ===== INIT TELEGRAM BOT =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN belum di-set di .env');
  process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

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

  // Lewati jika command (sudah di-handle onText lain)
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
      `✅ Cloudflare terhubung!\n\nPilih menu:\n` +
        `/addcf *.domain.com 1.2.3.4 - Tambah wildcard DNS\n` +
        `/listcf - Lihat record DNS\n` +
        `/delcf record_id - Hapus record DNS\n` +
        `/updatecf record_id 5.6.7.8 - Update record DNS\n` +
        `/cek *.domain.com - Cek wildcard subdomain\n` +
        `/help - Bantuan`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
});

// ====== ADD WILDCARD DNS RECORD ======
bot.onText(/\/addcf (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  const name = match[1]; // *.namadomain.com
  const content = match[2]; // IP address

  try {
    const resp = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records`,
      {
        type: 'A',
        name,
        content,
        proxied: false,
      },
      {
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (resp.data.success) {
      bot.sendMessage(chatId, `✅ Berhasil menambah wildcard DNS:\n${name} ➡️ ${content}`);
    } else {
      bot.sendMessage(chatId, `❌ Gagal: ${JSON.stringify(resp.data.errors)}`);
    }
  } catch (e) {
    bot.sendMessage(
      chatId,
      `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`
    );
  }
});

// ====== LIST DNS RECORDS ======
bot.onText(/\/listcf/, async (msg) => {
  const chatId = msg.chat.id;
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  try {
    const resp = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
        },
      }
    );
    const data = resp.data.result;
    if (data.length === 0) {
      bot.sendMessage(chatId, 'DNS record kosong.');
      return;
    }
    let reply = '*Daftar DNS record:*\n\n';
    data.forEach((r) => {
      reply += `• [${r.type}] ${r.name} ➡️ ${r.content}\n    ID: \`${r.id}\`\n`;
    });
    bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(
      chatId,
      `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`
    );
  }
});

// ====== DELETE DNS RECORD ======
bot.onText(/\/delcf (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const recordId = match[1].trim();
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  try {
    const resp = await axios.delete(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records/${recordId}`,
      {
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
        },
      }
    );
    if (resp.data.success) {
      bot.sendMessage(chatId, `✅ DNS record berhasil dihapus!`);
    } else {
      bot.sendMessage(chatId, `❌ Gagal hapus: ${JSON.stringify(resp.data.errors)}`);
    }
  } catch (e) {
    bot.sendMessage(
      chatId,
      `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`
    );
  }
});

// ====== UPDATE DNS RECORD ======
bot.onText(/\/updatecf (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const recordId = match[1].trim();
  const newContent = match[2].trim();
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }

  try {
    // Ambil data lama record untuk type/name/ttl/proxied
    const getResp = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records/${recordId}`,
      { headers: { Authorization: `Bearer ${session.apiToken}` } }
    );
    const oldRecord = getResp.data.result;

    const resp = await axios.put(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records/${recordId}`,
      {
        type: oldRecord.type,
        name: oldRecord.name,
        content: newContent,
        ttl: oldRecord.ttl,
        proxied: oldRecord.proxied,
      },
      {
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (resp.data.success) {
      bot.sendMessage(chatId, `✅ Berhasil update record:\n${oldRecord.name} ➡️ ${newContent}`);
    } else {
      bot.sendMessage(chatId, `❌ Gagal update: ${JSON.stringify(resp.data.errors)}`);
    }
  } catch (e) {
    bot.sendMessage(
      chatId,
      `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`
    );
  }
});

// ====== CEK WILDCARD SUBDOMAIN (RESOLVE DNS BEBERAPA SUBDOMAIN) ======
const dns = require('dns').promises;
bot.onText(/\/cek \*\.?([^\s]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const domainPattern = match[1].trim();
  const subdomains = ['www', 'api', 'blog', 'mail', 'dev', 'app', 'test', 'cdn'];
  let resultMsg = `🔍 *Hasil cek wildcard*: *.*.${domainPattern}*\n\n`;

  for (let sub of subdomains) {
    const fqdn = `${sub}.${domainPattern}`;
    try {
      const addrs = await dns.resolve(fqdn);
      resultMsg += `✅ ${fqdn} -> ${addrs.join(', ')}\n`;
    } catch (e) {
      resultMsg += `❌ ${fqdn} TIDAK ditemukan/resolve\n`;
    }
  }
  bot.sendMessage(chatId, resultMsg, { parse_mode: 'Markdown' });
});

// ====== HELP ======
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `*Fitur Bot Cloudflare:*\n\n` +
      `/start - Setup Cloudflare\n` +
      `/addcf *.domain.com 1.2.3.4 - Tambah wildcard DNS\n` +
      `/listcf - List record DNS\n` +
      `/delcf record_id - Hapus record DNS\n` +
      `/updatecf record_id 5.6.7.8 - Update record DNS\n` +
      `/cek *.domain.com - Cek beberapa subdomain wildcard\n`,
    { parse_mode: 'Markdown' }
  );
});

console.log('Bot Telegram Cloudflare DNS siap!');
