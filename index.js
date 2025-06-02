require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dns = require('dns').promises;
const fs = require('fs');

const userSession = {};
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = 7857630943; // GANTI dengan user id Telegram kamu!
const userDbFile = 'users.json';
const logFile = 'dnslog.json';

// --- Isi file_id jika ada gambar sendiri (opsional) ---
const IMG_ACCOUNT_ID = ""; // contoh: "AgACAgUAAxkBAAIDV2W...."
const IMG_ZONE_ID = "";
const IMG_API_TOKEN = "";

if (!TELEGRAM_TOKEN) {
  console.error('TELEGRAM_TOKEN belum di-set di .env');
  process.exit(1);
}
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// === USER LOGGER ===
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

// ==== LOGGING & ADMIN NOTIF ====
function logActivity(user, action, detail) {
  const logData = {
    time: new Date().toISOString(),
    user_id: user.id,
    username: user.username,
    first_name: user.first_name,
    action,
    detail
  };
  let logs = [];
  if (fs.existsSync(logFile)) {
    logs = JSON.parse(fs.readFileSync(logFile));
  }
  logs.push(logData);
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  if (user.id !== ADMIN_ID) {
    bot.sendMessage(
      ADMIN_ID,
      `*LOG DNS:*\nAksi: ${action}\nUser: ${user.first_name || ''} (@${user.username || '-'}, ID:${user.id})\nDetail: ${detail}\nWaktu: ${logData.time}`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ==== MENU ====
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
        { text: '📚 Petunjuk', callback_data: 'howto' }
      ],
      [
        { text: '🚪 Keluar', callback_data: 'logout' }
      ]
    ]
  };
}

// ==== PETUNJUK KHUSUS ====
const PETUNJUK_CF = `
🔹 *Cara Mendapatkan Cloudflare Account ID*
1. Login ke dashboard Cloudflare: https://dash.cloudflare.com/profile
2. Account ID ada di bagian "API" atau di URL dashboard:
   Contoh: https://dash.cloudflare.com/**ACCOUNT_ID**/ZONE_ID
3. Contoh Account ID: \`e4b1234567890abcdef1234567890ab\`

🔹 *Cara Mendapatkan Zone ID*
1. Di dashboard Cloudflare, pilih domain kamu.
2. Di halaman "Overview", lihat bagian bawah ada "Zone ID".
3. Atau lihat di URL: https://dash.cloudflare.com/ACCOUNT_ID/**ZONE_ID**
4. Contoh Zone ID: \`d12e34567890abcde1234567890fghij\`

🔹 *Cara Membuat API Token Cloudflare*
1. Masuk ke https://dash.cloudflare.com/profile/api-tokens
2. Klik “Create Token”
3. Pilih template *Edit zone DNS* (atau custom, beri izin: Zone > DNS > Edit)
4. Assign ke domain kamu.
5. Klik “Continue to summary” lalu “Create Token”
6. Salin dan simpan token yang muncul.

💡 Jika bingung, klik menu 📚 Petunjuk di bot!
`;

// ==== HALAMAN AWAL TUTORIAL ====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSession[chatId] = { step: 'tutorial' };
  saveUser({
    id: msg.from.id,
    username: msg.from.username,
    first_name: msg.from.first_name,
    last_name: msg.from.last_name,
    date: new Date().toISOString()
  });

  bot.sendMessage(
    chatId,
    `👋 *Selamat datang di Bot Cloudflare DNS!*

Sebelum mulai, berikut tutorial singkat:
1. Siapkan *Cloudflare Account ID* (dari URL dashboard Cloudflare)
2. Siapkan *Zone ID* (lihat di bawah halaman Overview domain di Cloudflare)
3. Buat *API Token* (dari menu API Tokens di dashboard Cloudflare, pilih template "Edit zone DNS")

Butuh gambar? Tekan tombol 📚 Petunjuk.

Jika sudah siap, klik tombol "Mulai Setup" di bawah ini.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📚 Petunjuk', callback_data: 'howto' }],
          [{ text: 'Mulai Setup', callback_data: 'start_setup' }]
        ]
      }
    }
  );
});

// ==== FITUR PETUNJUK ====
bot.onText(/\/petunjuk/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, PETUNJUK_CF, { parse_mode: 'Markdown' });
  if (IMG_ACCOUNT_ID) bot.sendPhoto(chatId, IMG_ACCOUNT_ID, { caption: "Contoh letak Account ID" });
  if (IMG_ZONE_ID) bot.sendPhoto(chatId, IMG_ZONE_ID, { caption: "Contoh letak Zone ID" });
  if (IMG_API_TOKEN) bot.sendPhoto(chatId, IMG_API_TOKEN, { caption: "Contoh pembuatan API Token" });
});

// ==== ADMIN: List User ====
bot.onText(/\/listuser/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
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

// ==== ADMIN: Log DNS ====
bot.onText(/\/logdns/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  let logs = [];
  if (fs.existsSync(logFile)) {
    logs = JSON.parse(fs.readFileSync(logFile));
  }
  if (logs.length === 0) {
    bot.sendMessage(msg.chat.id, 'Log kosong.');
    return;
  }
  let reply = '*Log Aktivitas DNS:*\n\n';
  logs.slice(-30).reverse().forEach(lg => {
    reply += `${lg.time}\n${lg.action} oleh ${lg.first_name || ''} (@${lg.username || '-'}, ID:${lg.user_id})\nDetail: ${lg.detail}\n\n`;
  });
  bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown' });
});

// ==== FITUR: Cari DNS Record ====
bot.onText(/\/finddns (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const keyword = match[1].toLowerCase();
  const session = userSession[chatId];
  if (!session || !session.zoneId || !session.apiToken) {
    bot.sendMessage(chatId, '⚠️ Silakan lakukan setup Cloudflare dulu dengan /start');
    return;
  }
  try {
    const resp = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records?per_page=100`,
      {
        headers: { Authorization: `Bearer ${session.apiToken}` },
      }
    );
    const data = resp.data.result;
    const found = data.filter(r =>
      (r.name && r.name.toLowerCase().includes(keyword)) ||
      (r.content && r.content.toLowerCase().includes(keyword)) ||
      (r.type && r.type.toLowerCase().includes(keyword))
    );
    if (found.length === 0) {
      bot.sendMessage(chatId, `Tidak ada record yang cocok dengan kata kunci "${keyword}".`);
      return;
    }
    let reply = `*Hasil pencarian DNS dengan kata "${keyword}":*\n\n`;
    found.forEach((r) => {
      reply += `• [${r.type}] ${r.name} ➡️ ${r.content}\n  ID: \`${r.id}\`\n`;
    });
    bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error saat pencarian: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
});

// ==== CALLBACK MENU, TUTORIAL, DAN SETUP ====
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = userSession[chatId];
  const user = query.from;

  if (data === 'howto') {
    bot.sendMessage(chatId, PETUNJUK_CF, { parse_mode: 'Markdown' });
    if (IMG_ACCOUNT_ID) bot.sendPhoto(chatId, IMG_ACCOUNT_ID, { caption: "Contoh letak Account ID" });
    if (IMG_ZONE_ID) bot.sendPhoto(chatId, IMG_ZONE_ID, { caption: "Contoh letak Zone ID" });
    if (IMG_API_TOKEN) bot.sendPhoto(chatId, IMG_API_TOKEN, { caption: "Contoh pembuatan API Token" });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === 'start_setup') {
    userSession[chatId] = { step: 'cf_account_id' };
    bot.sendMessage(
      chatId,
      `Silakan masukkan *Cloudflare Account ID* kamu:\n\n(langkah detail dan contoh gambar klik /petunjuk)`,
      { parse_mode: 'Markdown' }
    );
    bot.answerCallbackQuery(query.id);
    return;
  }

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
    case 'addcf':
      session.step = 'addcf_ask';
      bot.sendMessage(chatId, 'Kirim format: `*.domain.com 1.2.3.4 [ttl] [on/off]`\nContoh: `*.domain.com 1.2.3.4 300 on`', { parse_mode: 'Markdown' });
      break;
    case 'listcf':
      await handleListDNS(chatId, session);
      break;
    case 'delcf':
      session.step = 'delcf_ask';
      bot.sendMessage(chatId, 'Kirim *Record ID* yang ingin dihapus:', { parse_mode: 'Markdown' });
      break;
    case 'updatecf':
      session.step = 'updatecf_ask';
      bot.sendMessage(chatId, 'Kirim format: `record_id 5.6.7.8 [ttl] [on/off]`', { parse_mode: 'Markdown' });
      break;
    case 'cek':
      session.step = 'cek_ask';
      bot.sendMessage(chatId, 'Kirim wildcard, contoh: `*.domain.com`', { parse_mode: 'Markdown' });
      break;
    case 'backup':
      await handleBackupDNS(chatId, session, user);
      break;
    case 'restore':
      session.step = 'restore_ask';
      bot.sendMessage(chatId, 'Upload file backup JSON DNS untuk restore.', { parse_mode: 'Markdown' });
      break;
    case 'help':
      sendHelp(chatId);
      break;
    default:
      bot.sendMessage(chatId, 'Fitur belum didukung.');
      break;
  }

  bot.answerCallbackQuery(query.id);
});

// ==== ONBOARDING LANJUTAN ====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text && msg.text.trim();
  if (text.startsWith('/')) return;
  const session = userSession[chatId];
  if (!session) return;

  // Account ID
  if (session.step === 'cf_account_id') {
    session.accountId = text;
    session.step = 'cf_zone_id';
    bot.sendMessage(chatId,
      `*Petunjuk Zone ID:*\n` +
      `1. Pilih domain di dashboard Cloudflare\n` +
      `2. Lihat bagian bawah halaman Overview, ada "Zone ID"\n` +
      `3. Atau cek di URL: https://dash.cloudflare.com/ACCOUNT_ID/ZONE_ID\n` +
      `4. Contoh Zone ID: \`d12e34567890abcde1234567890fghij\`\n\nMasukkan Zone ID:`,
      { parse_mode: 'Markdown' }
    );
    if (IMG_ZONE_ID) bot.sendPhoto(chatId, IMG_ZONE_ID, { caption: "Contoh letak Zone ID di dashboard Cloudflare" });
    return;
  }
  // Zone ID
  if (session.step === 'cf_zone_id') {
    session.zoneId = text;
    session.step = 'cf_token';
    bot.sendMessage(chatId,
      `*Petunjuk API Token:*\n` +
      `1. Buka https://dash.cloudflare.com/profile/api-tokens\n` +
      `2. Klik “Create Token” lalu pilih template *Edit zone DNS*\n` +
      `3. Assign ke domain kamu, klik "Create Token"\n` +
      `4. Salin token yang muncul, masukkan di sini!\n\nMasukkan API Token Cloudflare:`,
      { parse_mode: 'Markdown' }
    );
    if (IMG_API_TOKEN) bot.sendPhoto(chatId, IMG_API_TOKEN, { caption: "Contoh pembuatan API Token Cloudflare" });
    return;
  }
  // API Token
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
  // ADDCF step
  if (session.step === 'addcf_ask') {
    const [name, content, ttlRaw, proxiedRaw] = text.split(' ');
    let ttl = 3600;
    let proxied = false;
    if (ttlRaw && !isNaN(Number(ttlRaw))) ttl = Number(ttlRaw);
    if (proxiedRaw && (proxiedRaw.toLowerCase() === 'on' || proxiedRaw.toLowerCase() === 'true')) proxied = true;
    await handleAddDNS(chatId, session, name, content, ttl, proxied, msg.from);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // DELCF step
  if (session.step === 'delcf_ask') {
    await handleDelDNS(chatId, session, text, msg.from);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
  // UPDATECF step
  if (session.step === 'updatecf_ask') {
    const [recordId, newContent, ttlRaw, proxiedRaw] = text.split(' ');
    let ttl = null;
    let proxied = null;
    if (ttlRaw && !isNaN(Number(ttlRaw))) ttl = Number(ttlRaw);
    if (proxiedRaw && (proxiedRaw.toLowerCase() === 'on' || proxiedRaw.toLowerCase() === 'true')) proxied = true;
    else if (proxiedRaw && (proxiedRaw.toLowerCase() === 'off' || proxiedRaw.toLowerCase() === 'false')) proxied = false;
    await handleUpdateDNS(chatId, session, recordId, newContent, ttl, proxied, msg.from);
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
    await handleRestoreDNS(chatId, session, fileLink, msg.from);
    session.step = 'menu';
    bot.sendMessage(chatId, 'Kembali ke menu:', { reply_markup: getMenuKeyboard() });
    return;
  }
});

// ==== FUNCTION: ADD DNS ====
async function handleAddDNS(chatId, session, name, content, ttl = 3600, proxied = false, user) {
  try {
    const resp = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records`,
      {
        type: 'A',
        name,
        content,
        ttl,
        proxied
      },
      {
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (resp.data.success) {
      bot.sendMessage(chatId, `✅ DNS wildcard berhasil ditambah:\n\`${name} ➡️ ${content}\`\nTTL: ${ttl}\nProxied: ${proxied ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
      logActivity(user, 'Tambah DNS', `${name} ➡️ ${content} | TTL: ${ttl} | Proxied: ${proxied ? 'ON' : 'OFF'}`);
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
        headers: { Authorization: `Bearer ${session.apiToken}` },
      }
    );
    const data = resp.data.result;
    if (data.length === 0) {
      bot.sendMessage(chatId, 'DNS record kosong.');
      return;
    }
    let reply = '*Daftar DNS record:*\n\n';
    data.forEach((r) => {
      reply += `• [${r.type}] ${r.name} ➡️ ${r.content}\n  ID: \`${r.id}\` TTL: ${r.ttl} Proxied: ${r.proxied ? 'ON' : 'OFF'}\n`;
    });
    bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ==== FUNCTION: DELETE DNS ====
async function handleDelDNS(chatId, session, recordId, user) {
  try {
    const resp = await axios.delete(
      `https://api.cloudflare.com/client/v4/zones/${session.zoneId}/dns_records/${recordId}`,
      {
        headers: { Authorization: `Bearer ${session.apiToken}` },
      }
    );
    if (resp.data.success) {
      bot.sendMessage(chatId, `✅ DNS record berhasil dihapus!`);
      logActivity(user, 'Hapus DNS', `ID: ${recordId}`);
    } else {
      bot.sendMessage(chatId, `❌ Gagal hapus: ${JSON.stringify(resp.data.errors)}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ==== FUNCTION: UPDATE DNS ====
async function handleUpdateDNS(chatId, session, recordId, newContent, ttl, proxied, user) {
  try {
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
        ttl: ttl || oldRecord.ttl,
        proxied: typeof proxied === 'boolean' ? proxied : oldRecord.proxied,
      },
      {
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (resp.data.success) {
      bot.sendMessage(chatId, `✅ Berhasil update record:\n\`${oldRecord.name} ➡️ ${newContent}\`\nTTL: ${ttl || oldRecord.ttl}\nProxied: ${(typeof proxied === 'boolean' ? proxied : oldRecord.proxied) ? 'ON' : 'OFF'}`, { parse_mode: 'Markdown' });
      logActivity(user, 'Update DNS', `${oldRecord.name} ➡️ ${newContent} | TTL: ${ttl || oldRecord.ttl} | Proxied: ${(typeof proxied === 'boolean' ? proxied : oldRecord.proxied) ? 'ON' : 'OFF'}`);
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
async function handleBackupDNS(chatId, session, user) {
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
    fs.unlinkSync(backupFile);
    logActivity(user, 'Backup DNS', `Total: ${data.length} record`);
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error backup: ${e.response?.data?.errors?.[0]?.message || e.message}`);
  }
}

// ==== FUNCTION: RESTORE DNS ====
async function handleRestoreDNS(chatId, session, fileUrl, user) {
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
    logActivity(user, 'Restore DNS', `Sukses: ${success}, Gagal: ${fail}`);
  } catch (e) {
    bot.sendMessage(chatId, `❌ Error restore: ${e.message}`);
  }
}

// ==== HELP MENU ====
function sendHelp(chatId) {
  bot.sendMessage(
    chatId,
    `*Fitur Bot Cloudflare:*\n\n` +
      '• Tambah wildcard DNS (bisa TTL & proxied)\n' +
      '• List semua DNS record\n' +
      '• Hapus/Update DNS record (bisa TTL & proxied)\n' +
      '• Cek wildcard subdomain\n' +
      '• Backup & Restore DNS ke file\n' +
      '• Cari DNS: /finddns <kata>\n' +
      '• Petunjuk pengisian: /petunjuk\n' +
      '• Keluar session\n\n' +
      'Gunakan tombol menu di bawah pesan, atau ketik /start untuk setup ulang.',
    {
      parse_mode: 'Markdown',
      reply_markup: getMenuKeyboard()
    }
  );
}

console.log('Bot Telegram Cloudflare DNS siap!');
