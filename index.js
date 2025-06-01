require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dns = require('dns').promises;

// ===== Simple session per user (reset jika bot restart) =====
const userSession = {};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN belum di-set di .env');
  process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// ====== Fungsi Helper ======
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
        { text: '❓ Bantuan', callback_data: 'help' }
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

  // Lewati jika command
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

// ====== MENU PILIHAN (INLINE KEYBOARD) ======
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = userSession[chatId];

  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }

  // Set state agar user tahu step selanjutnya
  if (data === 'addcf') {
    session.step = 'addcf_ask';
    bot.sendMessage(chatId, 'Kirim format:\n`*.domain.com 1.2.3.4`', { parse_mode: 'Markdown' });
  }
  if (data === 'listcf') {
    await handleListDNS(chatId, session);
  }
  if (data === 'delcf') {
    session.step = 'delcf_ask';
    bot.sendMessage(chatId, 'Kirim *Record ID* yang ingin dihapus (lihat di /listcf):', { parse_mode: 'Markdown' });
  }
  if (data === 'updatecf') {
    session.step = 'updatecf_ask';
    bot.sendMessage(chatId, 'Kirim format:\n`record_id 5.6.7.8`', { parse_mode: 'Markdown' });
  }
  if (data === 'cek') {
    session.step = 'cek_ask';
    bot.sendMessage(chatId, 'Kirim format wildcard, contoh:\n`*.domain.com`', { parse_mode: 'Markdown' });
  }
  if (data === 'help') {
    sendHelp(chatId);
  }

  bot.answerCallbackQuery(query.id);
});

// ====== HANDLING STEP MENU (INPUT LANJUTAN USER) ======
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text && msg.text.trim();

  // Jangan override onboarding
  if (text.startsWith('/')) return;

  const session = userSession[chatId];
  if (!session || !session.step) return;

  // ADDCF step
  if (session.step === 'addcf_ask') {
    const parts = text.split(' ');
    if (parts.length !== 2) {
      bot.sendMessage(chatId, 'Format salah. Contoh: `*.domain.com 1.2.3.4`', { parse_mode: 'Markdown' });
      return;
    }
    const [name, content] = parts;
    await handleAddDNS(chatId, session, name, content);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu utama:', {
      reply_markup: getMenuKeyboard()
    });
    return;
  }

  // DELCF step
  if (session.step === 'delcf_ask') {
    const recordId = text;
    await handleDelDNS(chatId, session, recordId);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu utama:', {
      reply_markup: getMenuKeyboard()
    });
    return;
  }

  // UPDATECF step
  if (session.step === 'updatecf_ask') {
    const parts = text.split(' ');
    if (parts.length !== 2) {
      bot.sendMessage(chatId, 'Format salah. Contoh: `record_id 5.6.7.8`', { parse_mode: 'Markdown' });
      return;
    }
    const [recordId, newContent] = parts;
    await handleUpdateDNS(chatId, session, recordId, newContent);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu utama:', {
      reply_markup: getMenuKeyboard()
    });
    return;
  }

  // CEK step
  if (session.step === 'cek_ask') {
    const domainPattern = text.replace(/^\*\./, '');
    await handleCekWildcard(chatId, domainPattern);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu utama:', {
      reply_markup: getMenuKeyboard()
    });
    return;
  }
});

// ====== FUNCTION: ADD DNS ======
async function handleAddDNS(chatId, session, name, content) {
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
      bot.sendMessage(chatId, `✅ DNS wildcard berhasil ditambah:\n\`${name} ➡️ ${content}\``, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ Gagal: ${JSON.stringify(resp.data.errors)}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ====== FUNCTION: LIST DNS ======
async function handleListDNS(chatId, session) {
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
      reply += `• [${r.type}] ${r.name} ➡️ ${r.content}\n  ID: \`${r.id}\`\n`;
    });
    bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ====== FUNCTION: DELETE DNS ======
async function handleDelDNS(chatId, session, recordId) {
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
    bot.sendMessage(chatId, `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ====== FUNCTION: UPDATE DNS ======
async function handleUpdateDNS(chatId, session, recordId, newContent) {
  try {
    // Get old record data
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
      bot.sendMessage(chatId, `✅ Berhasil update record:\n\`${oldRecord.name} ➡️ ${newContent}\``, { parse_mode: 'Markdown' });
    } else {
      bot.sendMessage(chatId, `❌ Gagal update: ${JSON.stringify(resp.data.errors)}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ====== FUNCTION: CEK WILDCARD ======
async function handleCekWildcard(chatId, domainPattern) {
  const subdomains = ['www', 'api', 'blog', 'mail', 'dev', 'app', 'test', 'cdn'];
  let resultMsg = `🔍 *Hasil cek wildcard*: *.*.${domainPattern}*\n\n`;

  for (let sub of subdomains) {
    const fqdn = `${sub}.${domainPattern}`;
    try {
      const addrs = await dns.resolve(fqdn);
      resultMsg += `✅ ${fqdn} -> ${addrs.join(', ')}\n`;
    } catch (e) {
      resultMsg += `❌ ${fqdn} tidak resolve\n`;
    }
  }
  bot.sendMessage(chatId, resultMsg, { parse_mode: 'Markdown' });
}

// ====== HELP MENU ======
function sendHelp(chatId) {
  bot.sendMessage(
    chatId,
    `*Panduan Bot Cloudflare:*\n\n` +
      '• *Tambah Wildcard DNS*: Daftarkan wildcard DNS baru.\n' +
      '• *List DNS*: Lihat semua record DNS di zona kamu.\n' +
      '• *Update DNS*: Update IP/pointing suatu record DNS.\n' +
      '• *Hapus DNS*: Hapus DNS record (pakai ID dari List DNS).\n' +
      '• *Cek Wildcard*: Cek resolve subdomain wildcard ke IP.\n\n' +
      'Gunakan tombol menu di bawah pesan, atau ketik /start untuk setup ulang.\n\n' +
      'Format manual:\n' +
      '`/addcf *.domain.com 1.2.3.4`\n' +
      '`/delcf record_id`\n' +
      '`/updatecf record_id 5.6.7.8`\n' +
      '`/cek *.domain.com`\n',
    {
      parse_mode: 'Markdown',
      reply_markup: getMenuKeyboard()
    }
  );
}

// ====== MANUAL COMMANDS (tetap bisa digunakan) ======
bot.onText(/\/addcf (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  const name = match[1];
  const content = match[2];
  await handleAddDNS(chatId, session, name, content);
});
bot.onText(/\/listcf/, async (msg) => {
  const chatId = msg.chat.id;
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  await handleListDNS(chatId, session);
});
bot.onText(/\/delcf (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const recordId = match[1].trim();
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  await handleDelDNS(chatId, session, recordId);
});
bot.onText(/\/updatecf (.+) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const recordId = match[1].trim();
  const newContent = match[2].trim();
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  await handleUpdateDNS(chatId, session, recordId, newContent);
});
bot.onText(/\/cek \*\.?([^\s]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const domainPattern = match[1].trim();
  await handleCekWildcard(chatId, domainPattern);
});
bot.onText(/\/help/, (msg) => {
  sendHelp(msg.chat.id);
});

console.log('Bot Telegram Cloudflare DNS siap!');
