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

// === Tambahan: USER DATABASE ===
const userDbFile = 'users.json';
function saveUser(user) {
  let users = [];
  if (fs.existsSync(userDbFile)) {
    users = JSON.parse(fs.readFileSync(userDbFile));
  }
  if (!users.find(u => u.id === user.id)) {
    users.push(user);
    fs.writeFileSync(userDbFile, JSON.stringify(users, null, 2));
  }
}

// ==== Helper: tombol menu utama ====
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
        { text: '🚪 Keluar', callback_data: 'logout' }
      ]
    ]
  };
}

// ==== ONBOARDING ====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  // === Tambahan: simpan user ke users.json ===
  saveUser({
    id: msg.from.id,
    username: msg.from.username,
    first_name: msg.from.first_name,
    last_name: msg.from.last_name,
    date: new Date().toISOString()
  });

  userSession[chatId] = { step: 'cf_account_id' };
  bot.sendMessage(
    chatId,
    `👋 *Selamat datang di Bot Cloudflare DNS!*\n\n` +
      `Untuk mulai, silakan masukkan *Cloudflare Account ID* kamu.`,
    { parse_mode: 'Markdown' }
  );
});

// ==== ADMIN: List User Bot ====
const ADMIN_ID = 7857630943; // <-- GANTI dengan user id Telegram kamu!
bot.onText(/\/listuser/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return; // hanya admin
  let users = [];
  if (fs.existsSync(userDbFile)) {
    users = JSON.parse(fs.readFileSync(userDbFile));
  }
  if (users.length === 0) {
    bot.sendMessage(msg.chat.id, 'Belum ada user yang pernah menggunakan bot.');
    return;
  }
  const daftar = users
    .map(u => `${u.first_name || ''} @${u.username || '-'} (ID: ${u.id})`)
    .join('\n');
  bot.sendMessage(msg.chat.id, `Daftar user bot:\n\n${daftar}`);
});

// ==== HANDLE ONBOARDING ====
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

// ==== CALLBACK MENU UTAMA ====
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

  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    bot.answerCallbackQuery(query.id);
    return;
  }

  switch (data) {
    case 'addcf': session.step = 'addcf_ask'; bot.sendMessage(chatId, 'Kirim format: `*.domain.com 1.2.3.4`', { parse_mode: 'Markdown' }); break;
    case 'listcf': await handleListDNS(chatId, session); break;
    case 'delcf': session.step = 'delcf_ask'; bot.sendMessage(chatId, 'Kirim *Record ID* yang ingin dihapus:', { parse_mode: 'Markdown' }); break;
    case 'updatecf': session.step = 'updatecf_ask'; bot.sendMessage(chatId, 'Kirim format: `record_id 5.6.7.8`', { parse_mode: 'Markdown' }); break;
    case 'cek': session.step = 'cek_ask'; bot.sendMessage(chatId, 'Kirim wildcard, contoh: `*.domain.com`', { parse_mode: 'Markdown' }); break;
    case 'backup': await handleBackupDNS(chatId, session); break;
    case 'restore': session.step = 'restore_ask'; bot.sendMessage(chatId, 'Upload file backup JSON DNS untuk restore.', { parse_mode: 'Markdown' }); break;
    case 'help': sendHelp(chatId); break;
    default: bot.sendMessage(chatId, 'Fitur belum didukung.'); break;
  }

  bot.answerCallbackQuery(query.id);
});

// ==== HANDLING STEP LANJUTAN USER ====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text && msg.text.trim();
  if (text.startsWith('/')) return;
  const session = userSession[chatId];
  if (!session || !session.step) return;

  // ADDCF step
  if (session.step === 'addcf_ask') {
    const [name, content] = text.split(' ');
    await handleAddDNS(chatId, session, name, content);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // DELCF step
  if (session.step === 'delcf_ask') {
    await handleDelDNS(chatId, session, text);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // UPDATECF step
  if (session.step === 'updatecf_ask') {
    const [recordId, newContent] = text.split(' ');
    await handleUpdateDNS(chatId, session, recordId, newContent);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // CEK step
  if (session.step === 'cek_ask') {
    const domainPattern = text.replace(/^\*\./, '');
    await handleCekWildcard(chatId, domainPattern);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // RESTORE step (file upload)
  if (session.step === 'restore_ask' && msg.document) {
    const fileId = msg.document.file_id;
    const fileLink = await bot.getFileLink(fileId);
    await handleRestoreDNS(chatId, session, fileLink);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
});

// ==== FUNCTION: ADD DNS ====
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

// ==== FUNCTION: LIST DNS ====
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

// ==== FUNCTION: DELETE DNS ====
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

// ==== FUNCTION: UPDATE DNS ====
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

// ==== FUNCTION: CEK WILDCARD ====
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

// ==== FUNCTION: BACKUP DNS ====
async function handleBackupDNS(chatId, session) {
  try {
    const resp = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records?per_page=100`,
      {
        headers: { Authorization: `Bearer ${session.apiToken}` },
      }
    );
    const data = resp.data.result;
    if (!data || data.length === 0) {
      bot.sendMessage(chatId, 'DNS record kosong, tidak ada yang dibackup.');
      return;
    }
    const backupFile = `dns-backup-${Date.now()}.json`;
    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
    await bot.sendDocument(chatId, backupFile, {}, { filename: backupFile });
    fs.unlinkSync(backupFile); // hapus file lokal setelah upload
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error backup: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ==== FUNCTION: RESTORE DNS ====
async function handleRestoreDNS(chatId, session, fileUrl) {
  try {
    const resp = await axios.get(fileUrl);
    const records = resp.data;
    if (!Array.isArray(records)) {
      bot.sendMessage(chatId, '❌ File backup tidak valid.');
      return;
    }
    let success = 0, fail = 0;
    for (let rec of records) {
      try {
        await axios.post(
          `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records`,
          {
            type: rec.type,
            name: rec.name,
            content: rec.content,
            proxied: rec.proxied,
            ttl: rec.ttl,
          },
          {
            headers: {
              Authorization: `Bearer ${session.apiToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        success++;
      } catch {
        fail++;
      }
    }
    bot.sendMessage(chatId, `♻️ Restore selesai!\nSukses: ${success}, Gagal: ${fail}`);
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error restore: ${e.message}`);
  }
}

// ==== HELP MENU ====
function sendHelp(chatId) {
  bot.sendMessage(
    chatId,
    `*Fitur Bot Cloudflare:*\n\n` +
      '• Tambah wildcard DNS\n' +
      '• List semua DNS record\n' +
      '• Hapus/Update DNS record\n' +
      '• Cek wildcard subdomain\n' +
      '• Backup & Restore DNS ke file\n' +
      '• Keluar session\n\n' +
      'Gunakan tombol menu di bawah pesan, atau ketik /start untuk setup ulang.',
    {
      parse_mode: 'Markdown',
      reply_markup: getMenuKeyboard()
    }
  );
}

console.log('Bot Telegram Cloudflare DNS siap!');
