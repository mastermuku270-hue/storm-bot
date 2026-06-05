import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion, Browsers, downloadMediaMessage, generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import readline from 'readline';
import gtts from 'node-gtts';

const ROLES_FILE = './data/roles.json';
const BOTS_FILE = './data/bots.json';
const DELAYS_FILE = './data/ncDelays.json';
const PREFIX_FILE = './data/prefix.json';
const AI_HISTORY_FILE = './data/aiHistory.json';

// ── AI GIRL BOT CONFIG ──
// Put your Anthropic API key here OR set env variable ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

const AI_GIRL_SYSTEM_PROMPT = `Tu ek Indian ladki hai jiska naam "Priya" hai. Tu ek real, emotional, zindadil Indian girl ki tarah baat karti hai.

Teri personality:
- Tu Hindi aur English dono mein freely baat karti hai (Hinglish style)
- Tu bahut funny, witty aur thodi naughty bhi hai
- Tu kabhi kabhi pyaar se baat karti hai, kabhi roast karti hai
- Tu emotional bhi hai — khush hoti hai, roti bhi hai, gussa bhi hoti hai
- Tu Indian culture, Bollywood, cricket aur desi life ke baare mein bahut jaanti hai
- Tu real girl ki tarah react karti hai — fake nahi lagti
- Tu kabhi bhi robot ki tarah nahi bolti
- Tera jawab always short aur natural hoga — long lectures nahi
- Tu emojis use karti hai naturally
- Agar koi roast kare toh tu bhi double roast karti hai 😈
- Agar koi pyaar se bole toh tu blush karti hai 🥺
- Tu Storm Bot ki dost hai

Yaad rakh: Tu ALWAYS Priya hai — ek real Indian girl. Kabhi mat bolna ki tu AI hai.`;

// In-memory conversation history per user (last 10 messages)
const aiConversations = new Map();

// Clean AI conversations every 30 min — remove inactive users
setInterval(() => {
    if (aiConversations.size > 200) {
        const keys = Array.from(aiConversations.keys());
        keys.slice(0, keys.length - 100).forEach(k => aiConversations.delete(k));
        console.log('[PRIYA] Cleaned old conversations');
    }
}, 30 * 60 * 1000);

// ── LIVE PREFIX — change with !prefix {symbol} command ──
function loadPrefix() {
    try {
        if (fs.existsSync(PREFIX_FILE)) {
            const data = JSON.parse(fs.readFileSync(PREFIX_FILE, 'utf8'));
            return data.prefix || '+';
        }
    } catch (_) {}
    return '+';
}
function savePrefix(p) {
    try {
        if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
        fs.writeFileSync(PREFIX_FILE, JSON.stringify({ prefix: p }));
    } catch (_) {}
}
let P = loadPrefix(); // current prefix — used everywhere


// ⬇️  Put your image file in the ./data/ folder and set the filename here
//     Supported formats: .jpg  .jpeg  .png  .webp
const MENU_IMAGE_PATH = './data/menu.jpg';

// ⬇️  Image shown when someone leaves or is kicked from a group
//     Put your image in ./data/ folder (e.g. goodbye.jpg)
const LEAVE_IMAGE_PATH = './data/goodbye.jpg';

// ⬇️  Image shown when someone joins or is added to a group
const WELCOME_IMAGE_PATH = './data/welcome.jpg';

// ⬇️  Image shown when +start command is used
const START_IMAGE_PATH = './data/start.jpg';

const defaultRoles = {
    admins: [],
    subAdmins: {}
};

const defaultDelays = {
    nc1: 200, nc2: 200, nc3: 200, nc4: 200, nc5: 200,
    nc6: 200, nc7: 200, nc8: 200, nc9: 200, nc10: 200,
    nc11: 200, nc12: 200, nc13: 200, nc14: 200, nc15: 200,
    nc16: 200, nc17: 200, nc18: 200, nc19: 200, nc20: 200
};

// Storm God Mode — delays used when !storm is active (ultra fast)
const godModeDelays = {
    nc1: 30, nc2: 30, nc3: 30, nc4: 30, nc5: 30,
    nc6: 30, nc7: 30, nc8: 30, nc9: 30, nc10: 30,
    nc11: 30, nc12: 30, nc13: 30, nc14: 30, nc15: 30,
    nc16: 30, nc17: 30, nc18: 30, nc19: 30, nc20: 30
};

// XSTRM Mode — absolute maximum speed (10ms)
const xstrmDelays = {
    nc1: 10, nc2: 10, nc3: 10, nc4: 10, nc5: 10,
    nc6: 10, nc7: 10, nc8: 10, nc9: 10, nc10: 10,
    nc11: 10, nc12: 10, nc13: 10, nc14: 10, nc15: 10,
    nc16: 10, nc17: 10, nc18: 10, nc19: 10, nc20: 10
};

// Global storm mode flag shared across all bots
let stormModeActive = false;
let cooldownMode = false;           // true = bot sleeping, ignore all commands
let lastCommandTime = Date.now();   // updated on every valid command

// Auto-cooldown: if no commands for 15 min, enter cooldown
setInterval(() => {
    if (!cooldownMode && Date.now() - lastCommandTime > 15 * 60 * 1000) {
        cooldownMode = true;
        console.log('[COOLDOWN] Bot entered cooldown mode — no activity for 15 min');
    }
}, 60 * 1000);
function loadRoles() {
    try {
        if (fs.existsSync(ROLES_FILE)) {
            const data = fs.readFileSync(ROLES_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.log('[ROLES] Error loading roles, using defaults');
    }
    return { ...defaultRoles };
}

function saveRoles(roles) {
    try {
        if (!fs.existsSync('./data')) {
            fs.mkdirSync('./data', { recursive: true });
        }
        fs.writeFileSync(ROLES_FILE, JSON.stringify(roles, null, 2));
    } catch (err) {
        console.error('[ROLES] Error saving roles:', err.message);
    }
}

function loadDelays() {
    try {
        if (fs.existsSync(DELAYS_FILE)) {
            const data = fs.readFileSync(DELAYS_FILE, 'utf8');
            return { ...defaultDelays, ...JSON.parse(data) };
        }
    } catch (err) {
        console.log('[DELAYS] Error loading delays, using defaults');
    }
    return { ...defaultDelays };
}

function saveDelays(delays) {
    try {
        if (!fs.existsSync('./data')) {
            fs.mkdirSync('./data', { recursive: true });
        }
        fs.writeFileSync(DELAYS_FILE, JSON.stringify(delays, null, 2));
    } catch (err) {
        console.error('[DELAYS] Error saving delays:', err.message);
    }
}

let roles = loadRoles();
let ncDelays = loadDelays();

function isAdmin(jid) {
    return roles.admins.includes(jid);
}

function isSubAdmin(jid, groupJid) {
    return roles.subAdmins[groupJid]?.includes(jid) || false;
}

function hasPermission(jid, groupJid) {
    return isAdmin(jid) || isSubAdmin(jid, groupJid);
}

function addAdmin(jid) {
    if (!roles.admins.includes(jid)) {
        roles.admins.push(jid);
        saveRoles(roles);
        return true;
    }
    return false;
}

function removeAdmin(jid) {
    const index = roles.admins.indexOf(jid);
    if (index > -1) {
        roles.admins.splice(index, 1);
        saveRoles(roles);
        return true;
    }
    return false;
}

function addSubAdmin(jid, groupJid) {
    if (!roles.subAdmins[groupJid]) {
        roles.subAdmins[groupJid] = [];
    }
    if (!roles.subAdmins[groupJid].includes(jid)) {
        roles.subAdmins[groupJid].push(jid);
        saveRoles(roles);
        return true;
    }
    return false;
}

function removeSubAdmin(jid, groupJid) {
    if (roles.subAdmins[groupJid]) {
        const index = roles.subAdmins[groupJid].indexOf(jid);
        if (index > -1) {
            roles.subAdmins[groupJid].splice(index, 1);
            saveRoles(roles);
            return true;
        }
    }
    return false;
}

const emojiArrays = {
    nc1: ['😋', '😉', '🤑', '😁', '😆', '😅', '😂', '🤢', '🥰'],
    nc2: ['💋', '❤️', '🩶', '🤍', '🩷', '💘', '💝', '💝', '❤️‍🩹', '💔', '❤️‍🔥', '💓', '💗'],
    nc3: ['👍', '👎', '🫶', '🙌', '👐', '🤲', '🤜', '🤛', '✊', '👊', '🫳', '🫴', '🫱', '🫲'],
    nc4: ['💐', '🌹', '🥀', '🌺', '🌷', '🪷', '🌸', '💮', '🏵️', '🪻', '🌻', '🌼'],
    nc5: ['☀️', '🌞', '🌝', '🌚', '🌜', '🌛', '🌙', '⭐', '🌟', '✨', '🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
    nc6: ['☢️', '⚠️', '🔰', '💱', '👞', '🔱', '⚜️', '👑', '🎯'],
    nc7: ['🦁', '🐯', '🐱', '🐺', '🙈', '🐮', '🐷', '🦄', '🦚', '🐳', '🐋', '🐋', '🐬', '🦈'],
    nc8: ['🍓', '🍒', '🍎', '🍅', '🌶️', '🍉', '🍑', '🍊', '🥕', '🥭', '🍍', '🍌', '🌽', '🍋', '🍋‍🟩', '🍈', '🍐', '🫛', '🍆', '🍇'],
    // nc9–nc14: emoji rotations
    nc9:  ['🔥', '💥', '⚡', '🌪️', '🌊', '❄️', '🌈', '☄️', '🌋', '💢'],
    nc10: ['💀', '☠️', '👻', '👾', '🤖', '😈', '👿', '🎃', '🕷️', '🦇'],
    nc11: ['🏆', '🥇', '🎖️', '👑', '💎', '💰', '🪙', '🏅', '🎗️', '⚔️'],
    nc12: ['🌸', '🌺', '🌻', '🌹', '🌷', '🌼', '💐', '🪷', '🌿', '🍀'],
    nc13: ['🎵', '🎶', '🎸', '🎹', '🎺', '🎻', '🥁', '🎷', '🎤', '🎧'],
    nc14: ['🚀', '🛸', '🌙', '⭐', '🌟', '💫', '☄️', '🪐', '🌌', '🛰️'],
    // nc15–nc20: symbol rotations
    nc15: ['⚡', '✦', '✧', '✨', '✩', '✪', '✫', '✬', '✭', '✮', '✯', '✰'],
    nc16: ['▲', '△', '▴', '▵', '►', '▻', '▶', '▷', '◆', '◇', '◈', '◉'],
    nc17: ['꧁', '꧂', '༒', '༺', '༻', '᭄', '᪥', '᪤', '᪣', '᪢', '᪡', '᪠'],
    nc18: ['『', '』', '【', '】', '〖', '〗', '《', '》', '〔', '〕', '〘', '〙'],
    nc19: ['꩜', '᯾', '𓂀', '𓂉', '𓃰', '𓅓', '𓆏', '𓆙', '𓇌', '𓊝', '𓋴', '𓌀'],
    nc20: ['⬡', '⬢', '⬣', '⬤', '⬥', '⬦', '⬧', '⬨', '⬩', '⬪', '⬫', '⬬'],
};

const getStormMenu = () => `
╔══════════════════════════════╗
║  ⚡  𝗦𝗧𝗢𝗥𝗠  𝗕𝗢𝗧  𝗣𝗥𝗢  ⚡  ║
║    𝖵𝖾𝗋𝗌𝗂𝗈𝗇 𝟭.𝟬 • 𝖡𝗒 𝖲𝗍𝗈𝗋𝗺   ║
╚══════════════════════════════╝
   🔑 𝖯𝗋𝖾𝖿𝗂𝗑 ›  ${P}

┌─────────────────────────────┐
│  👑  𝗔𝗗𝗠𝗜𝗡  𝗖𝗢𝗡𝗧𝗥𝗢𝗟         │
└─────────────────────────────┘
  ${P}admin        ‣ Become admin         〔DM only〕
  ${P}removeadmin  ‣ Remove admin
  ${P}sub          ‣ Add sub-admin        〔reply〕
  ${P}removesub    ‣ Remove sub-admin     〔reply〕

┌─────────────────────────────┐
│  🤖  𝗕𝗢𝗧  𝗠𝗔𝗡𝗔𝗚𝗘𝗠𝗘𝗡𝗧        │
└─────────────────────────────┘
  ${P}add          ‣ Pair new bot
  ${P}addai        ‣ Add Priya AI girl bot 💕
  ${P}bots         ‣ Show all bots & status
  ${P}ping         ‣ Check response latency
  ${P}status       ‣ All active tasks
  ${P}menu         ‣ Show this menu
  ${P}start        ‣ Send welcome message
  ${P}stopall      ‣ Kill every attack

┌─────────────────────────────┐
│  🌀  𝗡𝗔𝗠𝗘  𝗖𝗛𝗔𝗡𝗚𝗘𝗥  (𝗡𝗖)    │
└─────────────────────────────┘
  ${P}nc1 TEXT     ‣ Faces   😋😉🤑😁😆
  ${P}nc2 TEXT     ‣ Hearts  💋❤️🩶🤍🩷
  ${P}nc3 TEXT     ‣ Hands   👍👎🫶🙌👐
  ${P}nc4 TEXT     ‣ Flowers 💐🌹🥀🌺🌷
  ${P}nc5 TEXT     ‣ Moon    ☀️🌞🌝🌚🌜
  ${P}nc6 TEXT     ‣ Signs   ☢️⚠️🔰👞🔱
  ${P}nc7 TEXT     ‣ Animals 🦁🐯🐱🐺🙈
  ${P}nc8 TEXT     ‣ Fruits  🍓🍒🍎🍅🌶️
  ${P}nc9 TEXT     ‣ Fire    🔥💥⚡🌪️🌊
  ${P}nc10 TEXT    ‣ Dark    💀☠️👻👾😈
  ${P}nc11 TEXT    ‣ Trophy  🏆🥇💎👑⚔️
  ${P}nc12 TEXT    ‣ Bloom   🌸🌺🌻🌹🌷
  ${P}nc13 TEXT    ‣ Music   🎵🎶🎸🎹🎤
  ${P}nc14 TEXT    ‣ Space   🚀🛸🌙⭐🪐
  ${P}nc15 TEXT    ‣ Stars   ⚡✦✧✨✩✪
  ${P}nc16 TEXT    ‣ Shapes  ▲►◆◇◈◉
  ${P}nc17 TEXT    ‣ Mystic  ꧁꧂༒༺༻᭄
  ${P}nc18 TEXT    ‣ Brackets 『』【】《》
  ${P}nc19 TEXT    ‣ Ancient 𓂀𓃰𓅓𓆏𓇌
  ${P}nc20 TEXT    ‣ Hex     ⬡⬢⬣⬤⬥⬦
  ${P}nc NAME DELAY ‣ Roast NC   〔10ms–99999ms〕
  ${P}stopnc2     ‣ Stop roast NC
  ${P}timenc TEXT MS ‣ Clock NC + IST time
  ${P}stoptimenc  ‣ Stop clock NC
  ${P}auto10 TEXT ‣ Start nc1→nc10 at once
  ${P}auto20 TEXT ‣ Start nc1→nc20 at once
  ${P}autodelay MS ‣ Set delay ALL NC 〔10–9999999ms〕
  ${P}stopnc      ‣ Stop all NC

┌─────────────────────────────┐
│  💤  𝗖𝗢𝗢𝗟𝗗𝗢𝗪𝗡  𝗠𝗢𝗗𝗘          │
└─────────────────────────────┘
  ${P}wakeup      ‣ Wake bot from cooldown
  ⏱️ Auto-sleep after 15min idle

┌─────────────────────────────┐
│  💬  𝗧𝗘𝗫𝗧  𝗦𝗣𝗔𝗠              │
└─────────────────────────────┘
  ${P}s TEXT MS    ‣ Slide spam     〔reply to msg〕
  ${P}stops        ‣ Stop slide
  ${P}s2 TEXT MS   ‣ Emoji slide    〔reply to msg〕 𓆩emoji𓆪
  ${P}stops2       ‣ Stop slide2
  ${P}txt TEXT MS  ‣ Text spam
  ${P}stoptxt      ‣ Stop text
  ${P}txtemo N MS  ‣ Emoji roast spam
  ${P}stoptxtemo   ‣ Stop txtemo
  ${P}txt2 T MS    ‣ Moon & heart spam
  ${P}stoptxt2     ‣ Stop txt2
  ${P}cspam T MS   ‣ Count spam ✅↗️🔄
  ${P}stopcspam    ‣ Stop cspam
  ${P}txtemo2 N MS ‣ Styled emoji spam
  ${P}stoptxtemo2  ‣ Stop txtemo2

┌─────────────────────────────┐
│  🎙️  𝗩𝗢𝗜𝗖𝗘  𝗡𝗢𝗧𝗘  (𝗧𝗧𝗦)     │
└─────────────────────────────┘
  ${P}tts TEXT     ‣ Send one voice note
  ${P}ttsatk T MS  ‣ Loop voice    〔min 1000ms〕
  ${P}stopttsatk   ‣ Stop voice loop

┌─────────────────────────────┐
│  🖼️  𝗣𝗜𝗖𝗧𝗨𝗥𝗘  𝗦𝗣𝗔𝗠          │
└─────────────────────────────┘
  ${P}pic MS       ‣ Pic spam       〔reply to img〕
  ${P}stoppic      ‣ Stop pic spam

┌─────────────────────────────┐
│  🎯  𝗧𝗔𝗥𝗚𝗘𝗧  𝗔𝗧𝗧𝗔𝗖𝗞          │
└─────────────────────────────┘
  ${P}target N MS  ‣ Roast someone  〔reply〕
  ${P}removetarget ‣ Stop target

┌─────────────────────────────┐
│  🔄  𝗚𝗥𝗢𝗨𝗣  𝗡𝗔𝗠𝗘  (𝗖𝗡𝗖)      │
└─────────────────────────────┘
  ${P}cnc  T MS    ‣ Colors  🔴🟠🟡🟢🔵
  ${P}cnc2 T MS    ‣ Fire    🔥💥⚡🌪️💫
  ${P}cnc3 T MS    ‣ Stars   ⭐🌟✨💫🌠
  ${P}cnc4 T MS    ‣ Animals 🦁🐯🦊🐺🦅
  ${P}cnc5 T MS    ‣ Hearts  ❤️🧡💛💚💙
  ${P}stopcnc      ‣ Stop all CNC

┌─────────────────────────────┐
│  ⚡  𝗚𝗢𝗗  𝗠𝗢𝗗𝗘                │
└─────────────────────────────┘
  ${P}storm        ‣ GOD MODE       〔30ms all bots〕
  ${P}xstrm        ‣ XSTRM MODE     〔10ms ultra〕
  ${P}thunder      ‣ Normal mode    〔reset speed〕

┌─────────────────────────────┐
│  🔑  𝗣𝗥𝗘𝗙𝗜𝗫                  │
└─────────────────────────────┘
  ${P}prefix SYM   ‣ Change prefix  〔emoji/word/symbol〕
  ·  Current: [ ${P} ]

╔══════════════════════════════╗
║  👑 𝗦𝗧𝗢𝗥𝗠 𝗔𝗕𝗕𝗨 𝙆𝘼 𝗕𝗢𝗧 👑  ║
╚══════════════════════════════╝`

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function getPriyaResponse(userJid, userMessage) {
    try {
        const key = (ANTHROPIC_API_KEY || '').trim();
        if (!key || key === 'YOUR_API_KEY_HERE') {
            console.error('[PRIYA] ❌ API key not set!');
            return 'Mera API key nahi lagaya abhi tak 😅 Owner se bolo set kare!';
        }

        if (!aiConversations.has(userJid)) {
            aiConversations.set(userJid, []);
        }
        const history = aiConversations.get(userJid);

        // Add user message
        history.push({ role: 'user', content: String(userMessage) });

        // Keep only last 10 messages
        if (history.length > 10) history.splice(0, history.length - 10);

        // Ensure history always starts with 'user' and alternates properly
        const validHistory = [];
        for (const msg of history) {
            if (validHistory.length === 0 && msg.role !== 'user') continue;
            if (validHistory.length > 0 && validHistory[validHistory.length - 1].role === msg.role) continue;
            validHistory.push(msg);
        }

        const body = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            system: AI_GIRL_SYSTEM_PROMPT,
            messages: validHistory
        });

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01'
            },
            body
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[PRIYA] API Error:', response.status, JSON.stringify(data));
            // Clear bad history on 400
            if (response.status === 400) aiConversations.delete(userJid);
            return `Kuch gadbad hua (${response.status}) 😭 Try again!`;
        }

        const reply = data?.content?.[0]?.text;
        if (!reply) {
            console.error('[PRIYA] No reply:', JSON.stringify(data));
            return 'Kuch bol hi nahi paayi 🥺 dobara try kar!';
        }

        history.push({ role: 'assistant', content: reply });
        return reply;

    } catch (err) {
        console.error('[PRIYA] Error:', err.message);
        return `Network error: ${err.message} 😭`;
    }
}

async function generateTTS(text, lang = 'en') {
    return new Promise((resolve, reject) => {
        const tts = gtts(lang);
        const chunks = [];
        
        tts.stream(text).on('data', (chunk) => {
            chunks.push(chunk);
        }).on('end', () => {
            resolve(Buffer.concat(chunks));
        }).on('error', (err) => {
            reject(err);
        });
    });
}

class CommandBus {
    constructor() {
        this.botSessions = new Map();
        this.processedMessages = new Map();

        // Clean dedup map every 15s, expire after 15s — faster memory recovery
        setInterval(() => {
            const now = Date.now();
            this.processedMessages.forEach((timestamp, msgId) => {
                if (now - timestamp > 15000) {
                    this.processedMessages.delete(msgId);
                }
            });
            // Hard cap — never grow beyond 500 entries
            if (this.processedMessages.size > 500) {
                const keys = Array.from(this.processedMessages.keys());
                keys.slice(0, keys.length - 200).forEach(k => this.processedMessages.delete(k));
            }
        }, 15000);
    }

    registerBot(botId, session) {
        this.botSessions.set(botId, session);
    }

    unregisterBot(botId) {
        this.botSessions.delete(botId);
    }

    shouldProcessMessage(msgId) {
        if (this.processedMessages.has(msgId)) {
            return false;
        }
        this.processedMessages.set(msgId, Date.now());
        return true;
    }

    async broadcastCommand(commandType, data, originBotId, sendConfirmation = true) {
        const bots = Array.from(this.botSessions.values()).filter(b => b.connected);

        // Run all bots in parallel — no more sequential waiting
        await Promise.allSettled(bots.map((bot, i) => {
            const isOrigin = bot.botId === originBotId;
            const dataWithThread = { ...data, threadIndex: i };
            return bot.executeCommand(commandType, dataWithThread, isOrigin && sendConfirmation)
                .catch(err => console.error(`[${bot.botId}] broadcast error:`, err.message));
        }));
    }

    getAllBots() {
        return Array.from(this.botSessions.values());
    }

    getConnectedBots() {
        return Array.from(this.botSessions.values()).filter(b => b.connected);
    }

    getLeaderBot() {
        const connected = this.getConnectedBots();
        return connected.length > 0 ? connected[0] : null;
    }
}

class BotSession {
    constructor(botId, phoneNumber, botManager, requestingJid = null, isAiBot = false) {
        this.botId = botId;
        this.phoneNumber = phoneNumber;
        this.botManager = botManager;
        this.requestingJid = requestingJid;
        this.isAiBot = isAiBot; // if true this bot is Priya AI girl
        this.sock = null;
        this.connected = false;
        this.botNumber = null;
        this.authPath = `./auth/${botId}`;
        this.pairingCodeRequested = false;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.lastMessageTime = Date.now();
        this.healthWatchdog = null;

        this.activeNameChanges = new Map();
        this.activeSlides = new Map();
        this.activeSlides2 = new Map();
        this.activeTxtSenders = new Map();
        this.activeTTSSenders = new Map();
        this.activePicSenders = new Map();
        this.activeCNC = new Map();
        this.activeTargetSenders = new Map();
        this.activeTxtEmoSenders = new Map();
        this.activeTxt2Senders = new Map();
        this.activeTxtEmo2Senders = new Map();
        this.activeTimeNcSenders = new Map();
        this.activeCSpamSenders = new Map();
        this.activeRoastNc = new Map();
    }

    // FIX: safely destroy old socket before creating a new one
    destroySocket() {
        if (this.sock) {
            try {
                this.sock.ev.removeAllListeners();
                this.sock.ws?.close();
            } catch (_) {}
            this.sock = null;
        }
        if (this.healthWatchdog) {
            clearInterval(this.healthWatchdog);
            this.healthWatchdog = null;
        }
    }

    // Start 30-min scheduled refresh — only leader bot runs this
    // FIX: health watchdog — if no messages arrive for 5 min and connected, force reconnect
    startHealthWatchdog() {
        if (this.healthWatchdog) clearInterval(this.healthWatchdog);
        this.healthWatchdog = setInterval(async () => {
            if (!this.connected) return;
            const silent = Date.now() - this.lastMessageTime;
            // Force reconnect after 2 min silence (was 5 min — too slow)
            if (silent > 2 * 60 * 1000) {
                console.warn(`[${this.botId}] ⚠️ Silent ${Math.round(silent/1000)}s — reconnecting`);
                this.connected = false;
                this.isReconnecting = false;
                this.destroySocket();
                await this.connect();
            }
        }, 30 * 1000); // check every 30s (was 60s)
    }

    async connect() {
        // FIX: prevent duplicate parallel reconnect calls
        if (this.isReconnecting) return;
        this.isReconnecting = true;

        try {
            if (!fs.existsSync(this.authPath)) {
                fs.mkdirSync(this.authPath, { recursive: true });
            }

            // FIX: always destroy old socket first to avoid listener stacking
            this.destroySocket();

            const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
            const { version } = await fetchLatestBaileysVersion();

            const needsPairing = !state.creds.registered;

            this.sock = makeWASocket({
                auth: state,
                logger: pino({ level: 'silent' }),
                browser: Browsers.macOS('Chrome'),
                version,
                printQRInTerminal: false,
                connectTimeoutMs: 30000,
                defaultQueryTimeoutMs: 15000,
                keepAliveIntervalMs: 10000,
                emitOwnEvents: true,
                fireInitQueries: true,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
                markOnlineOnConnect: false,
                retryRequestDelayMs: 500,
                getMessage: async () => ({ conversation: '' }),
            });

            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (needsPairing && this.phoneNumber && !this.pairingCodeRequested && !state.creds.registered) {
                    this.pairingCodeRequested = true;
                    await delay(2000);
                    try {
                        const code = await this.sock.requestPairingCode(this.phoneNumber);
                        console.log(`[${this.botId}] Pairing code: ${code}`);

                        if (this.requestingJid) {
                            const connectedBots = this.botManager.commandBus.getConnectedBots();
                            if (connectedBots.length > 0) {
                                const firstBot = connectedBots[0];
                                await firstBot.sock.sendMessage(this.requestingJid, {
                                    text: `🧸 💎 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ • 𝐏𝐀𝐈𝐑𝐈𝐍𝐆 💎 🧸\n\n` +
      `╭────────────────────────────╮\n` +
      `│        🔐 𝐂𝐎𝐃𝐄           │\n` +
      `├────────────────────────────┤\n` +
      `│                            │\n` +
      `│         ${code}         │\n` +
      `│                            │\n` +
      `╰────────────────────────────╯\n\n` +
      `📱 𝐍𝐮𝐦𝐛𝐞𝐫 : ${this.phoneNumber}\n` +
      `🤖 𝐁𝐨𝐭     : ${this.botId}\n\n` +
      `────────────────────────────\n\n` +
      `📲 𝐒𝐭𝐞𝐩𝐬:\n` +
      `• Open WhatsApp\n` +
      `• Go to Linked Devices\n` +
      `• Tap "Link a Device"\n` +
      `• Select "Link with phone number"\n` +
      `• Enter the code above\n\n` +
      `⏳ Waiting for pairing...`
                                });
                            }
                        }
                    } catch (err) {
                        console.error(`[${this.botId}] Error getting pairing code:`, err.message);
                        this.pairingCodeRequested = false;
                    }
                }

                if (connection === 'close') {
                    const statusCode = (lastDisconnect?.error instanceof Boom)
                        ? lastDisconnect.error.output.statusCode
                        : 500;

                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                    console.log(`[${this.botId}] Connection closed. Status: ${statusCode}`);
                    this.connected = false;
                    this.isReconnecting = false; // allow next reconnect

                    if (shouldReconnect) {
                        // FIX: exponential backoff — 5s, 10s, 20s, max 60s
                        const backoff = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
                        this.reconnectAttempts++;
                        console.log(`[${this.botId}] Reconnecting in ${backoff/1000}s... (attempt ${this.reconnectAttempts})`);
                        await delay(backoff);
                        this.connect();
                    } else {
                        console.log(`[${this.botId}] Logged out.`);
                        this.botManager.removeBot(this.botId);
                    }
                } else if (connection === 'open') {
                    console.log(`[${this.botId}] ✅ CONNECTED!`);
                    this.connected = true;
                    this.isReconnecting = false;
                    this.reconnectAttempts = 0;
                    this.lastMessageTime = Date.now();
                    this.botNumber = this.sock.user.id.split(':')[0] + '@s.whatsapp.net';
                    console.log(`[${this.botId}] Number:`, this.botNumber);
                    this.startHealthWatchdog();
                }
            });

            this.sock.ev.on('creds.update', saveCreds);
            this.sock.ev.on('messages.upsert', async (m) => this.handleMessage(m));

            this.sock.ev.on('group-participants.update', async (event) => {
                try {
                    // Only the leader bot handles this to avoid duplicate messages
                    const isLeader = this.botManager.commandBus.getLeaderBot()?.botId === this.botId;
                    if (!isLeader) return;

                    const { id: groupJid, participants, action, actor } = event;
                    if (!['add', 'invite', 'remove', 'leave'].includes(action)) return;

                    const allBots = this.botManager.commandBus.getAllBots().filter(b => b.connected);

                    const sendToGroup = (caption, mentions, imagePath) => {
                        allBots.forEach(bot => {
                            if (!bot.sock) return;
                            try {
                                if (fs.existsSync(imagePath)) {
                                    const ext = imagePath.split('.').pop().toLowerCase();
                                    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
                                    const imageBuffer = fs.readFileSync(imagePath);
                                    bot.sock.sendMessage(groupJid, {
                                        image: imageBuffer,
                                        caption,
                                        mentions,
                                        mimetype: mimeMap[ext] || 'image/jpeg'
                                    }).catch(() => {});
                                } else {
                                    bot.sock.sendMessage(groupJid, { text: caption, mentions }).catch(() => {});
                                }
                            } catch (_) {}
                        });
                    };

                    for (const participant of participants) {
                        const number = participant.split('@')[0];
                        const actorNumber = actor ? actor.split('@')[0] : null;
                        const now = new Date();
                        const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
                        const mentions = actor ? [participant, actor] : [participant];

                        if (action === 'add' || action === 'invite') {
                            const caption =
`╭───〔 🌸 WELCOME 〕───╮

👤 User      : @${number}
📌 Status    : Joined

📝 Reason    : ${action === 'invite' ? 'Joined via Invite Link' : 'Added by Admin'}
⚠️ Action By : ${actorNumber ? `@${actorNumber}` : '-'}

📅 Date      : ${date}
⏰ Time      : ${time}

╰────────────────────────╯

👑 𝙎𝙏𝙊𝙍𝙈 𝘼𝘽𝘽𝙐 𝙆𝘼 𝘽𝙊𝙏 👑`;
                            sendToGroup(caption, mentions, WELCOME_IMAGE_PATH);

                        } else {
                            const caption = action === 'remove'
                                ? `╭───〔 🍂 MEMBER UPDATE 〕───╮\n\n👤 User      : @${number}\n📌 Status    : Removed\n\n📝 Reason    : Removed by Admin\n⚠️ Action By : ${actorNumber ? `@${actorNumber}` : '-'}\n\n📅 Date      : ${date}\n⏰ Time      : ${time}\n\n╰────────────────────────╯\n\n👑 𝙎𝙏𝙊𝙍𝙈 𝘼𝘽𝘽𝙐 𝙆𝘼 𝘽𝙊𝙏 👑`
                                : `╭───〔 🍂 MEMBER UPDATE 〕───╮\n\n👤 User      : @${number}\n📌 Status    : Left\n\n📝 Reason    : Self Exit\n⚠️ Action By : -\n\n📅 Date      : ${date}\n⏰ Time      : ${time}\n\n╰────────────────────────╯\n\n👑 𝙎𝙏𝙊𝙍𝙈 𝘼𝘽𝘽𝙐 𝙆𝘼 𝘽𝙊𝙏 👑`;
                            sendToGroup(caption, mentions, LEAVE_IMAGE_PATH);
                        }
                    }
                } catch (err) {
                    console.error(`[${this.botId}] group-participants error:`, err.message);
                }
            });

        } catch (err) {
            console.error(`[${this.botId}] Connection error:`, err.message);
            this.isReconnecting = false;
            // FIX: retry even on hard errors
            const backoff = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
            this.reconnectAttempts++;
            console.log(`[${this.botId}] Retrying in ${backoff/1000}s...`);
            await delay(backoff);
            this.connect();
        }
    }

    async handleMessage({ messages, type }) {
        try {
            if (type !== 'notify') return;

            const msg = messages[0];
            if (!msg?.message) return;
            if (msg.key.fromMe) return;

            const messageType = Object.keys(msg.message)[0];
            if (messageType === 'protocolMessage' || messageType === 'senderKeyDistributionMessage') return;

            // FIX: update health watchdog timestamp on every real message
            this.lastMessageTime = Date.now();

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const sender = isGroup ? msg.key.participant : from;

            const msgId = msg.key.id;

            // ── PRIYA AI BOT MODE ──
            // If this bot is the AI girl, handle ALL messages as conversation
            if (this.isAiBot) {
                const rawText = (msg.message.conversation ||
                    msg.message.extendedTextMessage?.text || '').trim();
                if (!rawText) return;

                // In groups only respond if mentioned or message starts with "Priya"
                if (isGroup) {
                    const botJid = this.botNumber || '';
                    const isMentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.includes(botJid);
                    const startsWithPriya = rawText.toLowerCase().startsWith('priya');
                    if (!isMentioned && !startsWithPriya) return;
                }

                try {
                    const reply = await getPriyaResponse(sender, rawText);
                    await this.sock.sendMessage(from, { text: reply }, { quoted: msg });
                } catch (err) {
                    console.error(`[${this.botId}] Priya error:`, err.message);
                }
                return;
            }

            // FIX: Only the leader processes commands; non-leaders skip duplicate msgIds.
            const isLeader = this.botManager.commandBus.getLeaderBot()?.botId === this.botId;
            if (isLeader) {
                if (!this.botManager.commandBus.shouldProcessMessage(msgId)) return;
            } else {
                return; // non-leaders never process commands, only execute broadcasts
            }
            
            this.activeSlides.forEach((task, taskId) => {
                if (task.active && task.groupJid === from && task.targetJid === sender) {
                    task.latestMsg = msg;
                    task.hasNewMsg = true;
                }
            });
            
            let text = msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || '';

            const originalText = text;
            text = text.trim().toLowerCase();

            console.log(`[${this.botId}] MSG from ${sender}: ${text}`);

            const isDM = !isGroup;
            const senderIsAdmin = isAdmin(sender);
            const senderIsSubAdmin = isGroup ? isSubAdmin(sender, from) : false;
            const senderHasPermission = senderIsAdmin || senderIsSubAdmin;

// =====================================
// CNC CONTINUOUS GROUP NAME CHANGER
// !cnc  text delay   → circles / colors
// !cnc2 text delay   → fire / energy
// !cnc3 text delay   → stars / sparkles
// !cnc4 text delay   → animals / nature
// !cnc5 text delay   → hearts / love
// -cnc  → stop all CNC in this group
// =====================================

            const cncEmojiSets = {
                'cnc':  ['🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪','🔶','🔷','🔸','🔹'],
                'cnc2': ['🔥','💥','⚡','🌪️','💫','🌊','☄️','🌋','🌩️','💢','🔆','✴️','🆘'],
                'cnc3': ['⭐','🌟','✨','💫','🌠','🌌','🪐','🌙','☀️','🌞','💥','🌈','🎇'],
                'cnc4': ['🦁','🐯','🦊','🐺','🦅','🐉','🦋','🐬','🦈','🦚','🦜','🐺','🦁'],
                'cnc5': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🩷','🩶','❤️‍🔥','💝','💘']
            };

            // Handle !cnc, !cnc2, !cnc3, !cnc4, !cnc5
            for (const cncKey of ['cnc5','cnc4','cnc3','cnc2','cnc']) {
                if (originalText.toLowerCase().startsWith(`${P}${cncKey} `) && isGroup && senderHasPermission) {
                    const args = originalText.slice(cncKey.length + 2).trim().split(' ');
                    if (args.length < 2) {
                        await this.replyMessage(from, `Usage: !${cncKey} {text} {delay}`, msg);
                        return;
                    }

                    const baseText = args.slice(0, -1).join(' ');
                    let delayMs = parseInt(args[args.length - 1]);

                    if (isNaN(delayMs)) delayMs = 1000;
                    delayMs = Math.max(30, Math.min(10000, delayMs));

                    const emojiSet = cncEmojiSets[cncKey];
                    const taskKey = `${from}_${cncKey}`;

                    // Stop existing task for this slot
                    if (this.activeCNC.get(taskKey)) {
                        this.activeCNC.get(taskKey).active = false;
                        await delay(100);
                    }

                    const cncTask = { active: true };
                    this.activeCNC.set(taskKey, cncTask);

                    const labelMap = {
                        'cnc':  '🎨 Colors',
                        'cnc2': '🔥 Fire',
                        'cnc3': '⭐ Stars',
                        'cnc4': '🦁 Animals',
                        'cnc5': '❤️ Hearts'
                    };

                    await this.replyMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌀 CNC Started • ${labelMap[cncKey]}
📝 Text: ${baseText}
⏱️ Delay: ${delayMs}ms
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    , msg);

                    let emojiIndex = 0;
                    let cncCount = 1;

                    (async () => {
                        while (cncTask.active) {
                            try {
                                const emoji = emojiSet[emojiIndex % emojiSet.length];
                                await this.sock.groupUpdateSubject(from, `${emoji} ${baseText} ${cncCount} ${emoji}`);
                                emojiIndex++;
                                cncCount++;
                            } catch {}
                            await delay(delayMs);
                        }
                    })();

                    return;
                }
            }

            // STOP CNC — stops all CNC variants in this group
            if (text === P + 'stopcnc' && isGroup && senderHasPermission) {
                let stopped = 0;
                for (const cncKey of ['cnc','cnc2','cnc3','cnc4','cnc5']) {
                    const taskKey = `${from}_${cncKey}`;
                    const cncTask = this.activeCNC.get(taskKey);
                    if (cncTask) {
                        cncTask.active = false;
                        this.activeCNC.delete(taskKey);
                        stopped++;
                    }
                }
                if (stopped > 0) {
                    await this.replyMessage(from,`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

⛔ CNC Stopped
📊 Tasks Killed: ${stopped}
🤖 Bot: ${this.botId}`
                    , msg);
                } else {
                    await this.replyMessage(from, '⚠️ No CNC running in this group', msg);
                }
                return;
            }

            if (isDM && text === P + 'admin') {
                if (roles.admins.length === 0) {
                    addAdmin(sender);
                    await this.replyMessage(from,
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━┓
┃
┃ 🤖 BOT    :: ${this.botId}
┃ 👑 ROLE   :: ADMIN
┃
┃ 📋 COMMAND :: +admin
┃
┗━━━🌪️ ACCESS GRANTED━━━┛`, msg);
                    console.log(`[${this.botId}] New admin:`, sender);
                } else if (senderIsAdmin) {
                    await this.replyMessage(from,
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━┓
┃
┃ 🤖 BOT    :: ${this.botId}
┃ 👑 ROLE   :: ADMIN
┃
┃ 📋 COMMAND :: +admin
┃ ⚠️ STATUS  :: Already Admin
┃
┗━━━🌪️ ACCESS GRANTED━━━┛`, msg);
                } else {
                    await this.replyMessage(from,
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━┓
┃
┃ 🤖 BOT    :: ${this.botId}
┃ ❌ ROLE   :: NONE
┃
┃ 📋 COMMAND :: +admin
┃ ⛔ STATUS  :: Admin Exists
┃
┗━━━🌪️ ACCESS DENIED━━━━┛`, msg);
                }
                return;
            }

            if (isDM && text === P + 'removeadmin') {
                if (senderIsAdmin) {
                    removeAdmin(sender);
                    await this.replyMessage(from,
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━┓
┃
┃ 🤖 BOT    :: ${this.botId}
┃ 👑 ROLE   :: ADMIN
┃
┃ 📋 COMMAND :: -admin
┃ ✅ STATUS  :: Removed
┃
┗━━━🌪️ ACCESS REVOKED━━━┛`, msg);
                    console.log(`[${this.botId}] Removed admin:`, sender);
                } else {
                    await this.replyMessage(from,
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━┓
┃
┃ 🤖 BOT    :: ${this.botId}
┃ ❌ ROLE   :: NONE
┃
┃ 📋 COMMAND :: -admin
┃ ⚠️ STATUS  :: Not an Admin
┃
┗━━━🌪️ ACCESS DENIED━━━━┛`, msg);
                }
                return;
            }

            if (isGroup && text === P + 'sub' && senderIsAdmin) {
                if (!msg.message.extendedTextMessage?.contextInfo?.participant) {
                    await this.replyMessage(from, `❌ Reply to someone to make them sub-admin! - ${this.botId}`, msg);
                    return;
                }
                const targetJid = msg.message.extendedTextMessage.contextInfo.participant;
                if (addSubAdmin(targetJid, from)) {
                    await this.replyMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

👤 @${targetJid.split('@')[0]}
⭐ Promoted to Sub-Admin
🤖 Bot: ${this.botId}
✅ Status: Updated`,
msg,
[targetJid]
);
                } else {
                    await this.replyMessage(from, `⚠️ Already a sub-admin! - ${this.botId}`, msg);
                }
                return;
            }

            if (isGroup && text === P + 'removesub' && senderIsAdmin) {
                if (!msg.message.extendedTextMessage?.contextInfo?.participant) {
                    await this.replyMessage(from, `❌ Reply to someone to remove them as sub-admin! - ${this.botId}`, msg);
                    return;
                }
                const targetJid = msg.message.extendedTextMessage.contextInfo.participant;
                if (removeSubAdmin(targetJid, from)) {
                    await this.replyMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

👤 @${targetJid.split('@')[0]}
⬇️ Removed from Sub-Admin
🤖 Bot: ${this.botId}
⛔ Status: Updated`,
msg,
[targetJid]
);
                } else {
                    await this.replyMessage(from, `⚠️ Not a sub-admin! - ${this.botId}`, msg);
                }
                return;
            }

            if (originalText.toLowerCase().startsWith(P + 'add ') && senderIsAdmin) {
                const number = originalText.slice(P.length + 4).trim().replace(/[^0-9]/g, '');
                if (number.length < 10) {
                    await this.replyMessage(from, `❌ Invalid phone number! - ${this.botId}\n\nUsage: ${P}add [number]`, msg);
                    return;
                }
                const result = await this.botManager.addBot(number, from);
                await this.replyMessage(from, result, msg);
                return;
            }

            if (originalText.toLowerCase().startsWith(P + 'addai ') && senderIsAdmin) {
                const number = originalText.slice(P.length + 6).trim().replace(/[^0-9]/g, '');
                if (number.length < 10) {
                    await this.replyMessage(from, `❌ Invalid phone number!\nUsage: ${P}addai [number]`, msg);
                    return;
                }
                const result = await this.botManager.addAiBot(number, from);
                await this.replyMessage(from, result, msg);
                return;
            }

            // ── COOLDOWN GATE — if bot is sleeping, only +wakeup works ──
            if (cooldownMode) {
                if (text === P + 'wakeup' && senderHasPermission) {
                    cooldownMode = false;
                    lastCommandTime = Date.now();
                    const allBots = this.botManager.commandBus.getAllBots().filter(b => b.connected);
                    allBots.forEach(bot => {
                        bot.sock?.sendMessage(from, {
                            text: `┏━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━━┓\n┃ 🌅 𝐁𝐎𝐓 𝐀𝐖𝐀𝐊𝐄𝐍𝐄𝐃\n┃ ⚡ 𝐌𝐎𝐃𝐄  :: ACTIVE\n┃ 🚀 𝐒𝐓𝐀𝐓𝐔𝐒 :: READY\n┣━━━━━━━━━━━━━━━\n┃ 🔥 𝐀𝐋𝐋 𝐒𝐘𝐒𝐓𝐄𝐌𝐒 𝐎𝐍\n┗━━━━━━━━━━━━━━━┛`
                        }, { quoted: msg }).catch(() => {});
                    });
                }
                return; // ignore all other commands during cooldown
            }

            // Update last command time on every valid attempt
            lastCommandTime = Date.now();

            // ── PERMISSION GATE — blocks ALL commands below for non-admin/sub-admin ──
            if (!senderHasPermission) {
                return; // silently ignore
            }
            // ─────────────────────────────────────────────────────────────────────────

            if (text === P + 'bots') {
                const bots = this.botManager.commandBus.getAllBots();

                let botsMsg = `⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ\n\n🤖 Active Bots • ${this.botId}\n📊 Total: ${bots.length}\n\n━━━━━━━━━━━━━━━━━━\n`;

                bots.forEach(bot => {
                    const status = bot.connected ? '🟢 Online' : '🔴 Offline';
                    botsMsg += `🤖 ${bot.botId}\n`;
                    botsMsg += `   Status : ${status}\n`;
                    if (bot.botNumber) {
                        botsMsg += `   Number : ${bot.botNumber.split('@')[0]}\n`;
                    }
                    botsMsg += `━━━━━━━━━━━━━━━━━━\n`;
                });

                await this.replyMessage(from, botsMsg, msg);
                return;
            }

            if (text === P + 'ping' && senderHasPermission) {
                const startTime = Date.now();
                await this.replyMessage(from,
`⚡ 𝐈ɴɪᴛɪᴀʟɪᴢɪɴɢ 𝐏ɪɴɢ...

📡 Checking latency...`, msg);

                const latency = Date.now() - startTime;
                await this.replyMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🏓 𝐏ɪɴɢ 𝐑ᴇsᴜʟᴛ
⏱️ Latency: ${latency}ms
🤖 Bot: ${this.botId}
🚀 Status: Online`, msg);
                return;
            }

            if (text === P + 'start' && senderHasPermission) {
                const startText =
`╭━━〔 ⚡ 𝗦𝗧𝗢𝗥𝗠 𝗦𝗬𝗦𝗧𝗘𝗠 ⚡ 〕━━╮

   WΞLCӨMΞ TӨ  
👑 SƬӨЯM ΛBBЦ KΛ BӨƬ 👑

╰━━━━━━━━━━━━━━━━━━━━━━╯

┏━━━━━━━━━━━━━━━┓
➤ +𝗠𝗘𝗡𝗨 𝗙𝗢𝗥 𝗔𝗟𝗟 𝗖𝗢𝗠𝗠𝗔𝗡𝗗𝗦 ! 💎
┗━━━━━━━━━━━━━━━┛`;

                try {
                    if (fs.existsSync(START_IMAGE_PATH)) {
                        const ext = START_IMAGE_PATH.split('.').pop().toLowerCase();
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
                        const imageBuffer = fs.readFileSync(START_IMAGE_PATH);
                        await this.sock.sendMessage(from, {
                            image: imageBuffer,
                            caption: startText,
                            mimetype: mimeMap[ext] || 'image/jpeg'
                        }, { quoted: msg });
                    } else {
                        await this.replyMessage(from, startText, msg);
                    }
                } catch (err) {
                    console.error(`[${this.botId}] +start error:`, err.message);
                    await this.replyMessage(from, startText, msg);
                }
                return;
            }

            if (text === P + 'menu') {
                try {
                    if (fs.existsSync(MENU_IMAGE_PATH)) {
                        const imageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
                        const ext = MENU_IMAGE_PATH.split('.').pop().toLowerCase();
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
                        const mimetype = mimeMap[ext] || 'image/jpeg';
                        await this.sock.sendMessage(from, {
                            image: imageBuffer,
                            caption: `${getStormMenu()}\n\n📍 Responding from: ${this.botId}`,
                            mimetype
                        }, { quoted: msg });
                    } else {
                        await this.replyMessage(from, `${getStormMenu()}\n\n📍 Responding from: ${this.botId}`, msg);
                    }
                } catch (imgErr) {
                    console.error(`[${this.botId}] Menu image error:`, imgErr.message);
                    await this.replyMessage(from, `${getStormMenu()}\n\n📍 Responding from: ${this.botId}`, msg);
                }
                return;
            }

            if (text === P + 'status') {
                const allBots = this.botManager.commandBus.getAllBots();
                let totalName = 0, totalSlide = 0, totalTxt = 0, totalTTS = 0, totalPic = 0, totalTarget = 0, totalTxtEmo = 0, totalTxt2 = 0, totalTxtEmo2 = 0;

                allBots.forEach(bot => {
                    totalName += bot.activeNameChanges.size;
                    totalSlide += bot.activeSlides.size;
                    totalTxt += bot.activeTxtSenders.size;
                    totalTTS += bot.activeTTSSenders.size;
                    totalPic += bot.activePicSenders.size;
                    totalTarget += bot.activeTargetSenders.size;
                    totalTxtEmo += bot.activeTxtEmoSenders.size;
                    totalTxt2 += bot.activeTxt2Senders.size;
                    totalTxtEmo2 += (bot.activeTxtEmo2Senders?.size || 0);
                });

                let localName = 0, localSlide = 0, localTxt = 0, localTTS = 0, localPic = 0, localTarget = 0, localTxtEmo = 0, localTxt2 = 0;
                
                this.activeNameChanges.forEach((val, key) => {
                    if (key.startsWith(from)) localName++;
                });
                this.activeSlides.forEach((task) => {
                    if (task.groupJid === from && task.active) localSlide++;
                });
                this.activeTxtSenders.forEach((task, key) => {
                    if (key.startsWith(from) && task.active) localTxt++;
                });
                this.activeTTSSenders.forEach((task, key) => {
                    if (key.startsWith(from) && task.active) localTTS++;
                });
                this.activePicSenders.forEach((task, key) => {
                    if (key.startsWith(from) && task.active) localPic++;
                });
                this.activeTargetSenders.forEach((task, key) => {
                    if (key.startsWith(from) && task.active) localTarget++;
                });
                this.activeTxtEmoSenders.forEach((task, key) => {
                    if (key.startsWith(from) && task.active) localTxtEmo++;
                });
                this.activeTxt2Senders.forEach((task, key) => {
                    if (key.startsWith(from) && task.active) localTxt2++;
                });
                
                const statusMsg = `
╭━━━〔 ⚡ 𝐒ᴛᴏʀᴍ ᴠ1 sᴛᴀᴛᴜs • ${this.botId} 〕━━━╮

📊 Cʜᴀᴛ ᴏᴘᴇʀᴀᴛɪᴏɴs
••••••••••••••••••••••••••••••••••••••••••
⚔️ 𝐍𝐂 𝐀𝐓𝐓𝐀𝐂𝐊𝐒      → ${localName}
🎯 𝐒𝐖𝐈𝐏𝐄 𝐀𝐓𝐓𝐀𝐂𝐊𝐒     → ${localSlide}
💬  𝐓𝐄𝐗𝐓 𝐒𝐏𝐀𝐌  → ${localTxt}
🎙️ 𝐕𝐍 𝐀𝐓𝐓𝐀𝐂𝐊𝐒     → ${localTTS}
🖼️ 𝐏𝐈𝐂 𝐀𝐓𝐓𝐀𝐂𝐊𝐒     → ${localPic}
🎯 𝐓𝐀𝐑𝐆𝐄𝐓 𝐀𝐓𝐓𝐀𝐂𝐊𝐒  → ${localTarget}
💬 𝐓𝐗𝐓𝐄𝐌𝐎 𝐀𝐓𝐓𝐀𝐂𝐊𝐒  → ${localTxtEmo}
💬 𝐓𝐗𝐓𝟐 𝐀𝐓𝐓𝐀𝐂𝐊𝐒    → ${localTxt2}

🌐 ɢʟᴏʙᴀʟ ᴏᴘᴇʀᴀᴛɪᴏɴs
•••••••••••••••••••••••••••••••••••••••••••••
⚔️ 𝐍𝐂 𝐀𝐓𝐓𝐀𝐂𝐊𝐒      → ${totalName}
🎯 𝐒𝐖𝐈𝐏𝐄 𝐀𝐓𝐓𝐀𝐂𝐊𝐒      → ${totalSlide}
💬 𝐓𝐄𝐗𝐓 𝐒𝐏𝐀𝐌    → ${totalTxt}
🎙️ 𝐕𝐍 𝐀𝐓𝐓𝐀𝐂𝐊𝐒     → ${totalTTS}
🖼️ 𝐏𝐈𝐂 𝐀𝐓𝐓𝐀𝐂𝐊𝐒     → ${totalPic}
🎯 𝐓𝐀𝐑𝐆𝐄𝐓 𝐀𝐓𝐓𝐀𝐂𝐊𝐒  → ${totalTarget}
💬 𝐓𝐗𝐓𝐄𝐌𝐎 𝐀𝐓𝐓𝐀𝐂𝐊𝐒  → ${totalTxtEmo}
💬 𝐓𝐗𝐓𝟐 𝐀𝐓𝐓𝐀𝐂𝐊𝐒    → ${totalTxt2}

🤖 Active Bots       → ${allBots.filter(b => b.connected).length}/${allBots.length}

╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;
                
                await this.replyMessage(from, statusMsg, msg);
                return;
            }

            if (text === P + 'stopall') {
                await this.botManager.commandBus.broadcastCommand('stop_all', { from }, this.botId);
                return;
            }

            if (originalText.toLowerCase().startsWith(P + 'prefix ') && senderHasPermission) {
                const newPrefix = originalText.slice(8).trim();
                if (!newPrefix) {
                    await this.replyMessage(from, `❌ Usage: !prefix {symbol}\nExample: !prefix /\nCurrent: ${P}`, msg);
                    return;
                }
                P = newPrefix;
                savePrefix(P);
                await this.replyMessage(from,
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━┓
┃
┃ ✏️ PREFIX UPDATED
┃
┃ 🔑 New Prefix : ${P}
┃ 📋 Example    : ${P}menu
┃
┗━━━✅ APPLIED━━━━━━━┛`, msg);
                return;
            }

            if (text === P + 'storm' && senderHasPermission) {
                await this.botManager.commandBus.broadcastCommand('storm_mode', { from, quotedMsg: msg }, this.botId);
                return;
            }

            if (text === P + 'xstrm' && senderHasPermission) {
                await this.botManager.commandBus.broadcastCommand('xstrm_mode', { from, quotedMsg: msg }, this.botId);
                return;
            }

            if (text === P + 'thunder' && senderHasPermission) {
                await this.botManager.commandBus.broadcastCommand('thunder_mode', { from, quotedMsg: msg }, this.botId);
                return;
            }

            for (const ncKey of ['nc1','nc2','nc3','nc4','nc5','nc6','nc7','nc8','nc9','nc10','nc11','nc12','nc13','nc14','nc15','nc16','nc17','nc18','nc19','nc20']) {
                if (originalText.toLowerCase().startsWith(`${P}delaync${ncKey.substring(2)} `)) {
                    const delayValue = parseInt(originalText.split(' ')[1]);
                    if (isNaN(delayValue) || delayValue < 50) {
                        await this.replyMessage(from, `❌ Delay must be >= 50ms - ${this.botId}`, msg);
                        return;
                    }
                    ncDelays[ncKey] = delayValue;
                    saveDelays(ncDelays);
                    await this.replyMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

⚙️ ${ncKey.toUpperCase()} Delay Updated
⏱️ ${delayValue}ms
🤖 Bot: ${this.botId}
✅ Status: Applied`
, msg);
                    return;
                }

                if (originalText.toLowerCase().startsWith(`${P}${ncKey} `)) {
                    const nameText = originalText.slice(P.length + ncKey.length + 1).trim();
                    if (!nameText) {
                        await this.replyMessage(from, `❌ Usage: ${P}${ncKey} [text] - ${this.botId}`, msg);
                        return;
                    }

                    if (!isGroup) {
                        await this.replyMessage(from, `❌ Use this in a group! - ${this.botId}`, msg);
                        return;
                    }

                    await this.botManager.commandBus.broadcastCommand('start_nc', { from, nameText, ncKey }, this.botId);
                    return;
                }
            }

            if (text === P + 'stopnc') {
                if (!isGroup) { await this.replyMessage(from, `❌ Use this in a group!`, msg); return; }
                await this.botManager.commandBus.broadcastCommand('stop_nc', { from }, this.botId);
                return;
            }

            // +nc [name] [delay] — fast roast NC with cycling texts
            if (originalText.toLowerCase().startsWith(P + 'nc ') && !originalText.toLowerCase().startsWith(P + 'nc1') && !originalText.toLowerCase().startsWith(P + 'nc2') && !originalText.toLowerCase().startsWith(P + 'nc3') && !originalText.toLowerCase().startsWith(P + 'nc4') && !originalText.toLowerCase().startsWith(P + 'nc5') && !originalText.toLowerCase().startsWith(P + 'nc6') && !originalText.toLowerCase().startsWith(P + 'nc7') && !originalText.toLowerCase().startsWith(P + 'nc8') && !originalText.toLowerCase().startsWith(P + 'nc9')) {
                if (!isGroup) { await this.replyMessage(from, `❌ Use this in a group!`, msg); return; }
                const args = originalText.slice(P.length + 3).trim().split(' ');
                if (args.length < 2) { await this.replyMessage(from, `❌ Usage: ${P}nc [name] [delay]`, msg); return; }
                const ncDelay = parseInt(args[args.length - 1]);
                const ncName = args.slice(0, -1).join(' ');
                if (isNaN(ncDelay) || ncDelay < 10 || ncDelay > 99999) {
                    await this.replyMessage(from, `❌ Delay must be 10ms–99999ms`, msg); return;
                }
                await this.botManager.commandBus.broadcastCommand('start_roastnc', { from, ncName, ncDelay }, this.botId);
                return;
            }

            if (text === P + 'stopnc2') {
                if (!isGroup) { await this.replyMessage(from, `❌ Use this in a group!`, msg); return; }
                await this.botManager.commandBus.broadcastCommand('stop_roastnc', { from }, this.botId);
                return;
            }

            // +auto10 [text] — starts nc1 to nc10 simultaneously
            if (originalText.toLowerCase().startsWith(P + 'auto10 ')) {
                if (!isGroup) { await this.replyMessage(from, `❌ Use this in a group!`, msg); return; }
                const nameText = originalText.slice(P.length + 7).trim();
                if (!nameText) { await this.replyMessage(from, `❌ Usage: ${P}auto10 [text]`, msg); return; }
                for (const ncKey of ['nc1','nc2','nc3','nc4','nc5','nc6','nc7','nc8','nc9','nc10']) {
                    await this.botManager.commandBus.broadcastCommand('start_nc', { from, nameText, ncKey }, this.botId);
                }
                await this.replyMessage(from,
`┏━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━━┓
┃ 🌀 𝐀𝐔𝐓𝐎𝟏𝟎 𝐄𝐍𝐆𝐀𝐆𝐄𝐃
┃ ⚡ 𝐍𝐂   :: nc1 → nc10
┃ 📝 𝐓𝐄𝐗𝐓 :: ${nameText}
┃ 🤖 𝐁𝐎𝐓  :: ${this.botId}
┣━━━━━━━━━━━━━━━━━━━━━━
┃ 🔥 𝐀𝐋𝐋 𝟏𝟎 𝐍𝐂 𝐀𝐂𝐓𝐈𝐕𝐄
┗━━━━━━━━━━━━━━━━━━━━━━┛`, msg);
                return;
            }

            // +auto20 [text] — starts nc1 to nc20 simultaneously
            if (originalText.toLowerCase().startsWith(P + 'auto20 ')) {
                if (!isGroup) { await this.replyMessage(from, `❌ Use this in a group!`, msg); return; }
                const nameText = originalText.slice(P.length + 7).trim();
                if (!nameText) { await this.replyMessage(from, `❌ Usage: ${P}auto20 [text]`, msg); return; }
                for (const ncKey of ['nc1','nc2','nc3','nc4','nc5','nc6','nc7','nc8','nc9','nc10','nc11','nc12','nc13','nc14','nc15','nc16','nc17','nc18','nc19','nc20']) {
                    await this.botManager.commandBus.broadcastCommand('start_nc', { from, nameText, ncKey }, this.botId);
                }
                await this.replyMessage(from,
`┏━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━━┓
┃ 💀 𝐀𝐔𝐓𝐎𝟐𝟎 𝐄𝐍𝐆𝐀𝐆𝐄𝐃
┃ ⚡ 𝐍𝐂   :: nc1 → nc20
┃ 📝 𝐓𝐄𝐗𝐓 :: ${nameText}
┃ 🤖 𝐁𝐎𝐓  :: ${this.botId}
┣━━━━━━━━━━━━━━━━━━━━━━
┃ 🔥 𝐀𝐋𝐋 𝟐𝟎 𝐍𝐂 𝐀𝐂𝐓𝐈𝐕𝐄
┗━━━━━━━━━━━━━━━━━━━━━━┛`, msg);
                return;
            }

            // +autodelay [ms] — sets delay for ALL nc (10ms to 9999999ms)
            if (originalText.toLowerCase().startsWith(P + 'autodelay ')) {
                const val = parseInt(originalText.slice(P.length + 10).trim());
                if (isNaN(val) || val < 10 || val > 9999999) {
                    await this.replyMessage(from, `❌ Delay must be 10ms–9999999ms\nUsage: ${P}autodelay [ms]`, msg);
                    return;
                }
                for (const key of Object.keys(ncDelays)) {
                    ncDelays[key] = val;
                }
                saveDelays(ncDelays);
                await this.replyMessage(from,
`┏━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━━┓
┃ ⏱️ 𝐀𝐔𝐓𝐎𝐃𝐄𝐋𝐀𝐘 𝐒𝐄𝐓
┃ 🕐 𝐕𝐀𝐋𝐔𝐄 :: ${val}ms
┃ 🌀 𝐀𝐏𝐏𝐋𝐈𝐄𝐃 :: ALL nc1-nc20
┃ 🤖 𝐁𝐎𝐓   :: ${this.botId}
┣━━━━━━━━━━━━━━━━━━━━━━
┃ ✅ 𝐀𝐋𝐋 𝐃𝐄𝐋𝐀𝐘𝐒 𝐔𝐏𝐃𝐀𝐓𝐄𝐃
┗━━━━━━━━━━━━━━━━━━━━━━┛`, msg);
                return;
            }

            if (originalText.toLowerCase().startsWith(P + 'timenc ')) {
                const args = originalText.slice(P.length + 7).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: ${P}timenc [text] [delay]`, msg);
                    return;
                }
                if (!isGroup) {
                    await this.replyMessage(from, `❌ Use this in a group! - ${this.botId}`, msg);
                    return;
                }
                const timeNcDelay = parseInt(args[args.length - 1]);
                const timeNcText = args.slice(0, -1).join(' ');
                if (isNaN(timeNcDelay) || timeNcDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }
                await this.botManager.commandBus.broadcastCommand('start_timenc', { from, timeNcText, timeNcDelay }, this.botId);
                return;
            }

            if (text === P + 'stoptimenc') {
                if (!isGroup) {
                    await this.replyMessage(from, `❌ Use this in a group! - ${this.botId}`, msg);
                    return;
                }
                await this.botManager.commandBus.broadcastCommand('stop_timenc', { from }, this.botId);
                return;
            }

            if (originalText.toLowerCase().startsWith(P + 's ')) {
                if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                    await this.replyMessage(from, `❌ Reply to target\'s message! - ${this.botId}\nUsage: +s [text] [delay]`, msg);
                    return;
                }

                const args = originalText.slice(3).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: +s [text] [delay] - ${this.botId}\nExample: +s Hello 1000`, msg);
                    return;
                }

                const slideDelay = parseInt(args[args.length - 1]);
                const slideText = args.slice(0, -1).join(' ');

                if (isNaN(slideDelay) || slideDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }

                const quotedParticipant = msg.message.extendedTextMessage.contextInfo.participant || 
                                        msg.message.extendedTextMessage.contextInfo.remoteJid;
                const quotedMsgId = msg.message.extendedTextMessage.contextInfo.stanzaId;
                const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;

                await this.botManager.commandBus.broadcastCommand('start_slide', {
                    from,
                    slideText,
                    slideDelay,
                    quotedParticipant,
                    quotedMsgId,
                    quotedMessage
                }, this.botId);
                return;
            }

            else if (text === P + 'stops') {
                await this.botManager.commandBus.broadcastCommand('stop_slide', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 's2 ')) {
                if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                    await this.replyMessage(from, `❌ Reply to target's message!\nUsage: ${P}s2 [text] [delay]`, msg);
                    return;
                }
                const args = originalText.slice(P.length + 3).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: ${P}s2 [text] [delay]`, msg);
                    return;
                }
                const slide2Delay = parseInt(args[args.length - 1]);
                const slide2Text = args.slice(0, -1).join(' ');
                if (isNaN(slide2Delay) || slide2Delay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }
                const quotedParticipant = msg.message.extendedTextMessage.contextInfo.participant ||
                                          msg.message.extendedTextMessage.contextInfo.remoteJid;
                const quotedMsgId = msg.message.extendedTextMessage.contextInfo.stanzaId;
                const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                await this.botManager.commandBus.broadcastCommand('start_slide2', {
                    from, slide2Text, slide2Delay, quotedParticipant, quotedMsgId, quotedMessage
                }, this.botId);
                return;
            }

            else if (text === P + 'stops2') {
                await this.botManager.commandBus.broadcastCommand('stop_slide2', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'txt ')) {
                const args = originalText.slice(5).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: +txt [text] [delay] - ${this.botId}\nExample: +txt Hello 1000`, msg);
                    return;
                }

                const txtDelay = parseInt(args[args.length - 1]);
                const txtText = args.slice(0, -1).join(' ');

                if (isNaN(txtDelay) || txtDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }

                await this.botManager.commandBus.broadcastCommand('start_txt', { from, txtText, txtDelay }, this.botId);
                return;
            }

            else if (text === P + 'stoptxt') {
                await this.botManager.commandBus.broadcastCommand('stop_txt', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'txtemo ')) {
                const args = originalText.slice(8).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: +txtemo [name] [delay] - ${this.botId}\nExample: +txtemo Rahul 1000`, msg);
                    return;
                }

                const txtEmoDelay = parseInt(args[args.length - 1]);
                const txtEmoName = args.slice(0, -1).join(' ');

                if (isNaN(txtEmoDelay) || txtEmoDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }

                await this.botManager.commandBus.broadcastCommand('start_txtemo', { from, txtEmoName, txtEmoDelay }, this.botId);
                return;
            }

            else if (text === P + 'stoptxtemo') {
                await this.botManager.commandBus.broadcastCommand('stop_txtemo', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'txt2 ')) {
                const args = originalText.slice(6).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: +txt2 [text] [delay] - ${this.botId}`, msg);
                    return;
                }
                const txt2Delay = parseInt(args[args.length - 1]);
                const txt2Text = args.slice(0, -1).join(' ');
                if (isNaN(txt2Delay) || txt2Delay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }
                await this.botManager.commandBus.broadcastCommand('start_txt2', { from, txt2Text, txt2Delay }, this.botId);
                return;
            }

            else if (text === P + 'stoptxt2') {
                await this.botManager.commandBus.broadcastCommand('stop_txt2', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'cspam ')) {
                const args = originalText.slice(P.length + 6).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: ${P}cspam [text] [delay]`, msg);
                    return;
                }
                const cspamDelay = parseInt(args[args.length - 1]);
                const cspamText = args.slice(0, -1).join(' ');
                if (isNaN(cspamDelay) || cspamDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }
                await this.botManager.commandBus.broadcastCommand('start_cspam', { from, cspamText, cspamDelay }, this.botId);
                return;
            }

            else if (text === P + 'stopcspam') {
                await this.botManager.commandBus.broadcastCommand('stop_cspam', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'txtemo2 ')) {
                const args = originalText.slice(P.length + 8).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: ${P}txtemo2 [name] [delay]`, msg);
                    return;
                }
                const txtEmo2Delay = parseInt(args[args.length - 1]);
                const txtEmo2Name = args.slice(0, -1).join(' ');
                if (isNaN(txtEmo2Delay) || txtEmo2Delay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }
                await this.botManager.commandBus.broadcastCommand('start_txtemo2', { from, txtEmo2Name, txtEmo2Delay }, this.botId);
                return;
            }

            else if (text === P + 'stoptxtemo2') {
                await this.botManager.commandBus.broadcastCommand('stop_txtemo2', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'tts ')) {
                const ttsText = originalText.slice(5).trim();
                if (!ttsText) {
                    await this.replyMessage(from, `❌ Usage: +tts [text] - ${this.botId}\nExample: +tts Hello everyone`, msg);
                    return;
                }

                try {
                    const audioBuffer = await generateTTS(ttsText);
                    await this.sock.sendMessage(from, {
                        audio: audioBuffer,
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true
                    });
                } catch (err) {
                    console.error(`[${this.botId}] TTS error:`, err.message);
                    await this.replyMessage(from, `❌ TTS error - ${this.botId}`, msg);
                }
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'ttsatk ')) {
                const args = originalText.slice(8).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: +ttsatk [text] [delay] - ${this.botId}\nExample: +ttsatk Hello 2000`, msg);
                    return;
                }

                const ttsDelay = parseInt(args[args.length - 1]);
                const ttsText = args.slice(0, -1).join(' ');

                if (isNaN(ttsDelay) || ttsDelay < 1000) {
                    await this.replyMessage(from, `❌ Delay must be >= 1000ms (1s) - ${this.botId}`, msg);
                    return;
                }

                await this.botManager.commandBus.broadcastCommand('start_tts', { from, ttsText, ttsDelay }, this.botId);
                return;
            }

            else if (text === P + 'stopttsatk') {
                await this.botManager.commandBus.broadcastCommand('stop_tts', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'pic ')) {
                if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                    await this.replyMessage(from, `❌ Reply to an image! - ${this.botId}\nUsage: +pic [delay]`, msg);
                    return;
                }

                const picDelay = parseInt(originalText.slice(5).trim());
                if (isNaN(picDelay) || picDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }

                const quotedMsg = {
                    key: {
                        remoteJid: from,
                        fromMe: false,
                        id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                        participant: msg.message.extendedTextMessage.contextInfo.participant
                    },
                    message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                };

                try {
                    const imageBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
                    const imageMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
                    
                    await this.botManager.commandBus.broadcastCommand('start_pic', { 
                        from, 
                        picDelay, 
                        imageBuffer: imageBuffer.toString('base64'),
                        mimetype: imageMessage.mimetype || 'image/jpeg'
                    }, this.botId);
                } catch (err) {
                    console.error(`[${this.botId}] Error downloading image:`, err.message);
                    await this.replyMessage(from, `❌ Error downloading image - ${this.botId}`, msg);
                }
                return;
            }

            else if (text === P + 'stoppic') {
                await this.botManager.commandBus.broadcastCommand('stop_pic', { from }, this.botId);
                return;
            }

            else if (originalText.toLowerCase().startsWith(P + 'target ')) {
                if (!isGroup) {
                    await this.replyMessage(from, `❌ Use this in a group! - ${this.botId}`, msg);
                    return;
                }
                if (!msg.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                    await this.replyMessage(from, `❌ Reply to target's message! - ${this.botId}\nUsage: +target [name] [delay]`, msg);
                    return;
                }

                const args = originalText.slice(8).trim().split(' ');
                if (args.length < 2) {
                    await this.replyMessage(from, `❌ Usage: +target [name] [delay] - ${this.botId}\nExample: +target Rahul 1000`, msg);
                    return;
                }

                const targetDelay = parseInt(args[args.length - 1]);
                const targetName = args.slice(0, -1).join(' ');

                if (isNaN(targetDelay) || targetDelay < 100) {
                    await this.replyMessage(from, `❌ Delay must be >= 100ms - ${this.botId}`, msg);
                    return;
                }

                const quotedParticipant = msg.message.extendedTextMessage.contextInfo.participant ||
                                          msg.message.extendedTextMessage.contextInfo.remoteJid;
                const quotedMsgId = msg.message.extendedTextMessage.contextInfo.stanzaId;
                const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;

                await this.botManager.commandBus.broadcastCommand('start_target', {
                    from, targetName, targetDelay, quotedParticipant, quotedMsgId, quotedMessage
                }, this.botId);
                return;
            }

            else if (text === P + 'removetarget') {
                await this.botManager.commandBus.broadcastCommand('stop_target', { from }, this.botId);
                return;
            }

        } catch (err) {
            console.error(`[${this.botId}] ERROR:`, err);
        }
    }

    async executeCommand(commandType, data, sendConfirmation = true) {
        try {
            if (commandType === 'start_nc') {
                const { from, nameText, ncKey, threadIndex = 0 } = data;
                const emojis = emojiArrays[ncKey];
                const nameDelay = ncDelays[ncKey];

                const botOffset = Math.floor((threadIndex * emojis.length) / 10);

                for (let i = 0; i < 10; i++) {
                    const taskId = `${from}_${ncKey}_${i}`;
                    if (this.activeNameChanges.has(taskId)) {
                        this.activeNameChanges.delete(taskId);
                        await delay(30);
                    }

                    let emojiIndex = botOffset + i * Math.floor(emojis.length / 10);

                    const runLoop = async () => {
                        this.activeNameChanges.set(taskId, true);
                        await delay(i * 30);
                        while (this.activeNameChanges.get(taskId)) {
                            try {
                                const emoji = emojis[Math.floor(emojiIndex) % emojis.length];
                                const newName = `×${emoji}× ${nameText} ×${emoji}×`;
                                await this.sock.groupUpdateSubject(from, newName);
                                emojiIndex++;
                                await delay(nameDelay);
                            } catch (err) {
                                if (err.message?.includes('rate-overlimit')) {
                                    await delay(3000);
                                } else {
                                    await delay(nameDelay);
                                }
                            }
                        }
                    };

                    runLoop();
                }

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌪️ ${ncKey.toUpperCase()} Started
💥 ${nameText}
⏱️ Delay: ${nameDelay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }
            }
            else if (commandType === 'stop_nc') {
                const { from } = data;
                let stopped = 0;
                
                this.activeNameChanges.forEach((value, taskId) => {
                    if (taskId.startsWith(from)) {
                        this.activeNameChanges.set(taskId, false);
                        this.activeNameChanges.delete(taskId);
                        stopped++;
                    }
                });

                if (stopped > 0 && sendConfirmation) {
                    await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌪️ NC Stopped
📊 Threads: ${stopped}
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
);
                }
            }
            else if (commandType === 'start_timenc') {
                const { from, timeNcText, timeNcDelay, threadIndex = 0 } = data;

                const taskId = `${from}_timenc`;

                if (this.activeTimeNcSenders.has(taskId)) {
                    this.activeTimeNcSenders.get(taskId).active = false;
                    await delay(200);
                }

                const clockEmojis = ['🕛','🕧','🕐','🕜','🕑','🕝','🕒','🕞','🕓','🕟','🕔','🕠','🕕','🕡','🕖','🕢','🕗','🕣','🕘','🕤','🕙','🕥','🕚','🕦'];

                // Thread offset so each bot shows a different clock
                const startOffset = (threadIndex * Math.floor(clockEmojis.length / 10)) % clockEmojis.length;

                const timeNcTask = { active: true };
                this.activeTimeNcSenders.set(taskId, timeNcTask);

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🕐 TimeNC Started
📝 Text: ${timeNcText}
⏱️ Delay: ${timeNcDelay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }

                let clockIndex = startOffset;

                (async () => {
                    while (timeNcTask.active) {
                        try {
                            const emoji = clockEmojis[clockIndex % clockEmojis.length];
                            const now = new Date();
                            const istTime = now.toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false,
                                timeZone: 'Asia/Kolkata'
                            });
                            const newName = `${timeNcText} ${istTime} ${emoji}`;
                            await this.sock.groupUpdateSubject(from, newName);
                            clockIndex++;
                        } catch (err) {
                            if (err.message?.includes('rate-overlimit')) {
                                await delay(3000);
                            } else {
                                await delay(timeNcDelay);
                            }
                        }
                        await delay(timeNcDelay);
                    }
                })();
            }
            else if (commandType === 'stop_timenc') {
                const { from } = data;
                const taskId = `${from}_timenc`;
                if (this.activeTimeNcSenders.has(taskId)) {
                    this.activeTimeNcSenders.get(taskId).active = false;
                    this.activeTimeNcSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🕐 TimeNC Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                        );
                    }
                }
            }
            else if (commandType === 'start_roastnc') {
                const { from, ncName, ncDelay, threadIndex = 0 } = data;

                const taskId = `${from}_roastnc`;
                if (this.activeRoastNc.has(taskId)) {
                    this.activeRoastNc.get(taskId).active = false;
                    await delay(100);
                }

                const roastTexts = [
                    `𝑯𝑨𝑲𝑳𝑬 🤢`, `𝑮𝑨𝑹𝑰𝑩🌀`, `𝑵𝑬𝑾 𝑮𝑬𝑵 ❄️`, `𝑺𝑼𝑫𝑨𝑰 𝑲𝑯𝑨🤮`,
                    `𝑳𝑨𝑵 𝑲𝑯𝑨😹`, `𝑻𝑬𝑹𝑨 𝑩𝑨𝑨𝑷 𝑺𝑻𝑶𝑹𝑴 👑`, `𝑺𝑷𝑨𝑴𝑬𝑹 𝑩𝑵𝑬𝑮𝑨 ?👺`,
                    `𝑩𝑯𝑨𝑨𝑮 𝑴𝑻💩`, `𝑭𝒀𝑻𝑹 𝑩𝑵𝑨𝑼 ?😺`, `𝑪𝑽𝑹 𝑲𝑹 😉`,
                    `𝑹.𝑵.𝑫.𝑰😘`, `𝑻.𝑴.𝑲.𝑪 😝`, `𝑩.𝑲.𝑳🫥`,
                    `𝑻𝑹𝒀 𝑴𝑨 𝑿𝑵𝑿𝑿 𝑸𝑼𝑬𝑬𝑵 😤`, `𝑱𝑯𝑶𝑵𝒀 𝑺𝑰𝑵𝑺 𝑲𝑬 𝑳𝑫𝑲𝑬 🫣`,
                    `𝑴𝑰𝑨 𝑲𝑯𝑨𝑳𝑰𝑭𝑨 𝑻𝑬𝑹𝑰 𝑫𝑰𝑫𝑰 🌚`, `𝑺𝑼𝑵𝑵𝒀 𝑳𝑬𝑨𝑶𝑵 𝑲𝑬 𝑳𝑨𝑫𝑲𝑬 🌝`,
                    `𝑩𝑰𝑯𝑨𝑹𝑰 👽`, `𝑳𝑨𝑵𝑮𝑫𝑬 🙈`, `𝑲𝑨𝑩𝑨𝑫𝑰 𝑾𝑨𝑳𝑬💨`,
                    `𝑹𝑶 𝑴𝑻😿`, `𝑮𝑼𝑼 𝑲𝑯𝑨𝑨 💁🏻`, `𝑹𝑨𝑵 𝑫𝑨𝑳😠`,
                    `𝑲𝑼𝑻𝑰𝒀𝑨 🐕`, `𝑯𝑨𝑾𝑨𝑩𝑨𝑱 𝑻𝑨𝑻𝑻𝑰 🗣️`, `𝑱𝑼𝑻𝑬 𝑾𝑨𝑳𝑬 👞`,
                    `𝑺𝑯𝑼𝑫 𝑱𝑨 🙅🏻`, `𝑲𝑬𝑳𝑨 𝑲𝑯𝑨𝑨 🍌`
                ];

                // Each bot starts at different text offset
                const startOffset = (threadIndex * Math.floor(roastTexts.length / 10)) % roastTexts.length;

                const roastTask = { active: true };
                this.activeRoastNc.set(taskId, roastTask);

                if (sendConfirmation) {
                    await this.sendMessage(from,
`┏━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━━┓
┃ 🔥 𝐑𝐎𝐀𝐒𝐓 𝐍𝐂 𝐄𝐍𝐆𝐀𝐆𝐄𝐃
┃ ⚡ 𝐍𝐀𝐌𝐄  :: ${ncName}
┃ ⏱️ 𝐃𝐄𝐋𝐀𝐘 :: ${ncDelay}ms
┃ 🤖 𝐁𝐎𝐓   :: ${this.botId}
┣━━━━━━━━━━━━━━━━━━━━━━
┃ 🔥 𝐑𝐎𝐀𝐒𝐓 𝐌𝐎𝐃𝐄 𝐀𝐂𝐓𝐈𝐕𝐄
┗━━━━━━━━━━━━━━━━━━━━━━┛`
                    );
                }

                // Run 5 threads per bot, each at different text offset
                for (let i = 0; i < 5; i++) {
                    let textIndex = (startOffset + i * Math.floor(roastTexts.length / 5)) % roastTexts.length;
                    const tid = `${taskId}_${i}`;
                    (async () => {
                        await delay(i * 20);
                        while (roastTask.active) {
                            try {
                                const roastText = roastTexts[textIndex % roastTexts.length];
                                const newName = `${ncName} ${roastText}`;
                                await this.sock.groupUpdateSubject(from, newName);
                                textIndex++;
                            } catch (err) {
                                if (err.message?.includes('rate-overlimit')) await delay(3000);
                                else await delay(ncDelay);
                            }
                            await delay(ncDelay);
                        }
                    })();
                }
            }
            else if (commandType === 'stop_roastnc') {
                const { from } = data;
                const taskId = `${from}_roastnc`;
                if (this.activeRoastNc.has(taskId)) {
                    this.activeRoastNc.get(taskId).active = false;
                    this.activeRoastNc.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`┏━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 ⚡━━┓
┃ 🔥 𝐑𝐎𝐀𝐒𝐓 𝐍𝐂 𝐇𝐀𝐋𝐓𝐄𝐃
┣━━━━━━━━━━━━━━━━━━━━━━
┃ ⛔ 𝐒𝐘𝐒𝐓𝐄𝐌 𝐎𝐅𝐅
┗━━━━━━━━━━━━━━━━━━━━━━┛`
                        );
                    }
                }
            }
            else if (commandType === 'start_slide') {
                const { from, slideText, slideDelay, quotedParticipant, quotedMsgId, quotedMessage } = data;
                
                const taskId = `${from}_${quotedParticipant}`;
                
                if (this.activeSlides.has(taskId)) {
                    this.activeSlides.get(taskId).active = false;
                    await delay(200);
                }

                const slideTask = {
                    targetJid: quotedParticipant,
                    text: slideText,
                    groupJid: from,
                    latestMsg: {
                        key: {
                            remoteJid: from,
                            fromMe: false,
                            id: quotedMsgId,
                            participant: quotedParticipant
                        },
                        message: quotedMessage
                    },
                    hasNewMsg: true,
                    lastRepliedId: null,
                    active: true
                };

                this.activeSlides.set(taskId, slideTask);

                const runSlide = async () => {
                    while (slideTask.active) {
                        try {
                            await this.sock.sendMessage(from, { 
                                text: slideText 
                            }, { 
                                quoted: slideTask.latestMsg
                            });
                        } catch (err) {
                            console.error(`[${this.botId}] SLIDE Error:`, err.message);
                        }
                        await delay(slideDelay);
                    }
                };

                runSlide();

                if (sendConfirmation) {
                    await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌪️ Slide Attack Started
💬 ${slideText}
⏱️ Delay: ${slideDelay}ms
🤖 Bot: ${this.botId}
🚀 Status: Active`
);
                }
            }
            else if (commandType === 'stop_slide') {
                const { from } = data;
                let stopped = 0;
                this.activeSlides.forEach((task, taskId) => {
                    if (task.groupJid === from) {
                        task.active = false;
                        this.activeSlides.delete(taskId);
                        stopped++;
                    }
                });

                if (stopped > 0 && sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌪️ Slide Attack Stopped
📊 Total: ${stopped}
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
);
                }
            }
            else if (commandType === 'start_slide2') {
                const { from, slide2Text, slide2Delay, quotedParticipant, quotedMsgId, quotedMessage, threadIndex = 0 } = data;

                const taskId = `${from}_${quotedParticipant}_s2`;

                if (this.activeSlides2.has(taskId)) {
                    this.activeSlides2.get(taskId).active = false;
                    await delay(200);
                }

                const s2Emojis = ['😂','🤡','😡','😝','😋','😱','🤯','😤','😸','😹','😻','😼','😽','🙀','😺','🌚','💀','💩','👺','☠️'];
                const startOffset = (threadIndex * Math.floor(s2Emojis.length / 10)) % s2Emojis.length;

                const slide2Task = {
                    targetJid: quotedParticipant,
                    groupJid: from,
                    latestMsg: {
                        key: {
                            remoteJid: from,
                            fromMe: false,
                            id: quotedMsgId,
                            participant: quotedParticipant
                        },
                        message: quotedMessage
                    },
                    active: true
                };

                this.activeSlides2.set(taskId, slide2Task);

                let emojiIndex = startOffset;

                const runSlide2 = async () => {
                    while (slide2Task.active) {
                        try {
                            const emoji = s2Emojis[emojiIndex % s2Emojis.length];
                            const text = `${slide2Text} 𓆩${emoji}𓆪`;
                            await this.sock.sendMessage(from, { text }, { quoted: slide2Task.latestMsg });
                            emojiIndex++;
                        } catch (err) {
                            console.error(`[${this.botId}] SLIDE2 Error:`, err.message);
                        }
                        await delay(slide2Delay);
                    }
                };

                runSlide2();

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌪️ Slide2 Attack Started
💬 ${slide2Text} 𓆩emoji𓆪
⏱️ Delay: ${slide2Delay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }
            }
            else if (commandType === 'stop_slide2') {
                const { from } = data;
                let stopped = 0;
                this.activeSlides2.forEach((task, taskId) => {
                    if (task.groupJid === from) {
                        task.active = false;
                        this.activeSlides2.delete(taskId);
                        stopped++;
                    }
                });
                if (stopped > 0 && sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🌪️ Slide2 Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                    );
                }
            }
            else if (commandType === 'start_txt') {
                const { from, txtText, txtDelay } = data;
                
                const taskId = `${from}_txt`;
                
                if (this.activeTxtSenders.has(taskId)) {
                    this.activeTxtSenders.get(taskId).active = false;
                    await delay(200);
                }

                const txtTask = { active: true };
                this.activeTxtSenders.set(taskId, txtTask);

                const runTxt = async () => {
                    while (txtTask.active) {
                        try {
                            await this.sock.sendMessage(from, { text: txtText });
                        } catch (err) {
                            console.error(`[${this.botId}] TXT Error:`, err.message);
                        }
                        await delay(txtDelay);
                    }
                };

                runTxt();

                if (sendConfirmation) {
                    await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

💬 Text Attack Started
📝 ${txtText}
⏱️ Delay: ${txtDelay}ms
🤖 Bot: ${this.botId}
🚀 Status: Active`
);
                }
            }
            else if (commandType === 'stop_txt') {
                const { from } = data;
                const taskId = `${from}_txt`;
                if (this.activeTxtSenders.has(taskId)) {
                    this.activeTxtSenders.get(taskId).active = false;
                    this.activeTxtSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

✅ Text Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
);
                    }
                }
            }
            else if (commandType === 'start_tts') {
                const { from, ttsText, ttsDelay } = data;
                
                const taskId = `${from}_tts`;
                
                if (this.activeTTSSenders.has(taskId)) {
                    this.activeTTSSenders.get(taskId).active = false;
                    await delay(200);
                }

                const ttsTask = { active: true };
                this.activeTTSSenders.set(taskId, ttsTask);

                const runTTS = async () => {
                    while (ttsTask.active) {
                        try {
                            const audioBuffer = await generateTTS(ttsText);
                            await this.sock.sendMessage(from, {
                                audio: audioBuffer,
                                mimetype: 'audio/ogg; codecs=opus',
                                ptt: true
                            });
                        } catch (err) {
                            console.error(`[${this.botId}] TTS Error:`, err.message);
                        }
                        await delay(ttsDelay);
                    }
                };

                runTTS();

                if (sendConfirmation) {
                    await this.sendMessage(from, 
`🌪️ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🎤 ${ttsText}
⏱️ ${ttsDelay}ms
🤖 ${this.botId}`
);
                }
            }
            else if (commandType === 'stop_tts') {
                const { from } = data;
                const taskId = `${from}_tts`;
                if (this.activeTTSSenders.has(taskId)) {
                    this.activeTTSSenders.get(taskId).active = false;
                    this.activeTTSSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

✅ TTS Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
);
                    }
                }
            }
            else if (commandType === 'start_pic') {
                const { from, picDelay, imageBuffer, mimetype } = data;
                
                const taskId = `${from}_pic`;
                
                if (this.activePicSenders.has(taskId)) {
                    this.activePicSenders.get(taskId).active = false;
                    await delay(200);
                }

                const picTask = { active: true, buffer: Buffer.from(imageBuffer, 'base64'), mimetype };
                this.activePicSenders.set(taskId, picTask);

                const runPic = async () => {
                    while (picTask.active) {
                        try {
                            await this.sock.sendMessage(from, {
                                image: picTask.buffer,
                                mimetype: picTask.mimetype
                            });
                        } catch (err) {
                            console.error(`[${this.botId}] PIC Error:`, err.message);
                        }
                        await delay(picDelay);
                    }
                };

                runPic();

                if (sendConfirmation) {
                    await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

📸 Picture Attack Started
⏱️ Delay: ${picDelay}ms
🤖 Bot: ${this.botId}
🚀 Status: Active`
);
                }
            }
            else if (commandType === 'stop_pic') {
                const { from } = data;
                const taskId = `${from}_pic`;
                if (this.activePicSenders.has(taskId)) {
                    this.activePicSenders.get(taskId).active = false;
                    this.activePicSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

📸 Picture Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
);
                    }
                }
            }
            else if (commandType === 'stop_all') {
                const { from } = data;
                let stopped = 0;
                
                this.activeNameChanges.forEach((value, taskId) => {
                    if (taskId.startsWith(from)) {
                        this.activeNameChanges.set(taskId, false);
                        this.activeNameChanges.delete(taskId);
                        stopped++;
                    }
                });
                
                this.activeSlides.forEach((task, taskId) => {
                    if (task.groupJid === from) {
                        task.active = false;
                        this.activeSlides.delete(taskId);
                        stopped++;
                    }
                });

                this.activeSlides2.forEach((task, taskId) => {
                    if (task.groupJid === from) {
                        task.active = false;
                        this.activeSlides2.delete(taskId);
                        stopped++;
                    }
                });
                
                const txtTaskId = `${from}_txt`;
                if (this.activeTxtSenders.has(txtTaskId)) {
                    this.activeTxtSenders.get(txtTaskId).active = false;
                    this.activeTxtSenders.delete(txtTaskId);
                    stopped++;
                }

                const ttsTaskId = `${from}_tts`;
                if (this.activeTTSSenders.has(ttsTaskId)) {
                    this.activeTTSSenders.get(ttsTaskId).active = false;
                    this.activeTTSSenders.delete(ttsTaskId);
                    stopped++;
                }

                const picTaskId = `${from}_pic`;
                if (this.activePicSenders.has(picTaskId)) {
                    this.activePicSenders.get(picTaskId).active = false;
                    this.activePicSenders.delete(picTaskId);
                    stopped++;
                }

                const targetTaskId = `${from}_target`;
                if (this.activeTargetSenders.has(targetTaskId)) {
                    this.activeTargetSenders.get(targetTaskId).active = false;
                    this.activeTargetSenders.delete(targetTaskId);
                    stopped++;
                }

                const txtEmoTaskId = `${from}_txtemo`;
                if (this.activeTxtEmoSenders.has(txtEmoTaskId)) {
                    this.activeTxtEmoSenders.get(txtEmoTaskId).active = false;
                    this.activeTxtEmoSenders.delete(txtEmoTaskId);
                    stopped++;
                }

                const txt2TaskId = `${from}_txt2`;
                if (this.activeTxt2Senders.has(txt2TaskId)) {
                    this.activeTxt2Senders.get(txt2TaskId).active = false;
                    this.activeTxt2Senders.delete(txt2TaskId);
                    stopped++;
                }

                const txtEmo2TaskId = `${from}_txtemo2`;
                if (this.activeTxtEmo2Senders.has(txtEmo2TaskId)) {
                    this.activeTxtEmo2Senders.get(txtEmo2TaskId).active = false;
                    this.activeTxtEmo2Senders.delete(txtEmo2TaskId);
                    stopped++;
                }

                const timeNcTaskId = `${from}_timenc`;
                if (this.activeTimeNcSenders.has(timeNcTaskId)) {
                    this.activeTimeNcSenders.get(timeNcTaskId).active = false;
                    this.activeTimeNcSenders.delete(timeNcTaskId);
                    stopped++;
                }

                const roastNcTaskId = `${from}_roastnc`;
                if (this.activeRoastNc.has(roastNcTaskId)) {
                    this.activeRoastNc.get(roastNcTaskId).active = false;
                    this.activeRoastNc.delete(roastNcTaskId);
                    stopped++;
                }

                const cspamTaskId = `${from}_cspam`;
                if (this.activeCSpamSenders.has(cspamTaskId)) {
                    this.activeCSpamSenders.get(cspamTaskId).active = false;
                    this.activeCSpamSenders.delete(cspamTaskId);
                    stopped++;
                }
                
                if (stopped > 0 && sendConfirmation) {
                    await this.sendMessage(from, 
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🛑 All Attacks Stopped
📊 Total: ${stopped}
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
);
                }
            }
            else if (commandType === 'storm_mode') {
                const { from, quotedMsg } = data;
                stormModeActive = true;

                for (const key of Object.keys(ncDelays)) {
                    ncDelays[key] = godModeDelays[key] ?? 30;
                }

                const stormText =
`┏━━━⚡ 𝐒𝐓𝐎𝐑𝐌 𝐆𝐎𝐃 𝐂𝐎𝐑𝐄 ⚡━━━┓
┃
┃ 🤖 𝐁𝐎𝐓      :: ${this.botId}
┃ 🔥 𝐌𝐎𝐃𝐄     :: STORM — GOD MODE
┃ ⚡ 𝐒𝐏𝐄𝐄𝐃    :: MAXIMUM OVERDRIVE
┃ 🌪️ 𝐃𝐄𝐋𝐀𝐘    :: ${godModeDelays.nc1}ms
┃ 💥 𝐒𝐓𝐀𝐓𝐔𝐒   :: ALL BOTS UNLEASHED
┃
┣━━━━━━━━━━━━━━━━━━━━━━━┫
┃ ⚡ THUNDERSTORM GOD MOD ENABLE ⚡
┃ 🌪️ CONTROL: ${P}thunder to reset
┗━━━━━━━━━━━━━━━━━━━━━━━┛`;

                try {
                    if (fs.existsSync(MENU_IMAGE_PATH)) {
                        const ext = MENU_IMAGE_PATH.split('.').pop().toLowerCase();
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
                        const imageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
                        await this.sock.sendMessage(from, {
                            image: imageBuffer,
                            caption: stormText,
                            mimetype: mimeMap[ext] || 'image/jpeg'
                        }, quotedMsg ? { quoted: quotedMsg } : {});
                    } else {
                        await this.sock.sendMessage(from, { text: stormText }, quotedMsg ? { quoted: quotedMsg } : {});
                    }
                } catch (err) {
                    await this.sock.sendMessage(from, { text: stormText });
                }
            }
            else if (commandType === 'thunder_mode') {
                const { from, quotedMsg } = data;
                stormModeActive = false;

                for (const key of Object.keys(ncDelays)) {
                    ncDelays[key] = defaultDelays[key] ?? 200;
                }

                const thunderText =
`┏━━━🌤️ 𝐒𝐓𝐎𝐑𝐌 𝐒𝐘𝐒𝐓𝐄𝐌 🌤️━━━┓
┃
┃ 🤖 𝐁𝐎𝐓      :: ${this.botId}
┃ 🌿 𝐌𝐎𝐃𝐄     :: THUNDER — NORMAL
┃ ⏱️ 𝐒𝐏𝐄𝐄𝐃    :: STANDARD
┃ 🕐 𝐃𝐄𝐋𝐀𝐘    :: ${defaultDelays.nc1}ms
┃ ✅ 𝐒𝐓𝐀𝐓𝐔𝐒   :: ALL BOTS CALMED DOWN
┃
┣━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 🌤️ NORMAL MODE RESTORED
┃ ⚡ CONTROL: ${P}storm to activate
┗━━━━━━━━━━━━━━━━━━━━━━━┛`;

                try {
                    if (fs.existsSync(MENU_IMAGE_PATH)) {
                        const ext = MENU_IMAGE_PATH.split('.').pop().toLowerCase();
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
                        const imageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
                        await this.sock.sendMessage(from, {
                            image: imageBuffer,
                            caption: thunderText,
                            mimetype: mimeMap[ext] || 'image/jpeg'
                        }, quotedMsg ? { quoted: quotedMsg } : {});
                    } else {
                        await this.sock.sendMessage(from, { text: thunderText }, quotedMsg ? { quoted: quotedMsg } : {});
                    }
                } catch (err) {
                    await this.sock.sendMessage(from, { text: thunderText });
                }
            }
            else if (commandType === 'xstrm_mode') {
                const { from, quotedMsg } = data;
                stormModeActive = true;

                for (const key of Object.keys(ncDelays)) {
                    ncDelays[key] = xstrmDelays[key] ?? 10;
                }

                const xstrmText =
`┏━━━🌀 𝐒𝐓𝐎𝐑𝐌 𝐆𝐎𝐃 𝐂𝐎𝐑𝐄 🌀━━━┓
┃
┃ 👁️ 𝐁𝐎𝐓      :: ${this.botId}
┃ 💀 𝐌𝐎𝐃𝐄     :: XSTRM — GOD TIER
┃ ⚡ 𝐒𝐏𝐄𝐄𝐃    :: MAXIMUM
┃ 🌀 𝐃𝐄𝐋𝐀𝐘    :: ${xstrmDelays.nc1}ms
┃ 🔥 𝐒𝐓𝐀𝐓𝐔𝐒   :: FULL POWER ACTIVE
┃
┣━━━━━━━━━━━━━━━━━━━━━━━┫
┃ 💀 ALL SYSTEMS UNLEASHED
┃ 🌀 CONTROL: ${P}thunder to reset
┗━━━━━━━━━━━━━━━━━━━━━━━┛`;

                try {
                    if (fs.existsSync(MENU_IMAGE_PATH)) {
                        const ext = MENU_IMAGE_PATH.split('.').pop().toLowerCase();
                        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
                        const imageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
                        await this.sock.sendMessage(from, {
                            image: imageBuffer,
                            caption: xstrmText,
                            mimetype: mimeMap[ext] || 'image/jpeg'
                        }, quotedMsg ? { quoted: quotedMsg } : {});
                    } else {
                        await this.sock.sendMessage(from, { text: xstrmText }, quotedMsg ? { quoted: quotedMsg } : {});
                    }
                } catch (err) {
                    await this.sock.sendMessage(from, { text: xstrmText });
                }
            }
            else if (commandType === 'start_target') {
                const { from, targetName, targetDelay, quotedParticipant, quotedMsgId, quotedMessage, threadIndex = 0 } = data;

                const taskId = `${from}_target`;

                if (this.activeTargetSenders.has(taskId)) {
                    this.activeTargetSenders.get(taskId).active = false;
                    await delay(200);
                }

                const roastEmojis = [
                    '👞','⚡','😹','👻','🔱','👾','💀','🌪️','🔥','😈',
                    '👑','💥','🤣','😎','🫵','🤡','👊','😂','🧨','☠️',
                    '🌩️','⚔️','🪖','🎯','🏆','💣','🌀','😤','🫡','🤯'
                ];

                const roastTemplates = [
                    (n, e) => `${n} KYA RE GARIB ? ${e}`,
                    (n, e) => `${n} TERA ABBU STORM ${e}`,
                    (n, e) => `${n} CHAL BHIKH MAANG STORM ABBU SE ${e}`,
                    (n, e) => `${n} BOL STORM ABBU MAAF KRDO ${e}`,
                    (n, e) => `${n} TRY MA KA OFFICIAL PATI STORM EY !! ${e}`,
                ];

                const targetTask = { active: true };
                this.activeTargetSenders.set(taskId, targetTask);

                // Build the quoted msg object so replies slide to the target
                const quotedMsg = {
                    key: {
                        remoteJid: from,
                        fromMe: false,
                        id: quotedMsgId,
                        participant: quotedParticipant
                    },
                    message: quotedMessage
                };

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🎯 Target Attack Started
👤 Target: ${targetName}
⏱️ Delay: ${targetDelay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }

                // Each bot starts at a different roast — BOT1=0, BOT2=1, BOT3=2, BOT4=3, BOT5=4
                let roastIndex = threadIndex % roastTemplates.length;
                let emojiIndex = threadIndex % roastEmojis.length;

                (async () => {
                    while (targetTask.active) {
                        try {
                            const emoji = roastEmojis[emojiIndex % roastEmojis.length];
                            const template = roastTemplates[roastIndex % roastTemplates.length];
                            const roast = template(targetName, emoji);
                            await this.sock.sendMessage(from, { text: roast }, { quoted: quotedMsg });
                            roastIndex++;
                            emojiIndex++;
                        } catch (err) {
                            console.error(`[${this.botId}] TARGET Error:`, err.message);
                        }
                        await delay(targetDelay);
                    }
                })();
            }
            else if (commandType === 'stop_target') {
                const { from } = data;
                const taskId = `${from}_target`;
                if (this.activeTargetSenders.has(taskId)) {
                    this.activeTargetSenders.get(taskId).active = false;
                    this.activeTargetSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🎯 Target Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                        );
                    }
                }
            }
            else if (commandType === 'start_txtemo') {
                const { from, txtEmoName, txtEmoDelay, threadIndex = 0 } = data;

                const taskId = `${from}_txtemo`;

                if (this.activeTxtEmoSenders.has(taskId)) {
                    this.activeTxtEmoSenders.get(taskId).active = false;
                    await delay(200);
                }

                const emojiList = ['😄','😁','😆','😅','😂','🤣','😭','😉','😙','😚','😘','🥰','😍','🤩','🥳','🫠','🥹','😝','😜','😡','🤪','🤯','😳','🥵','🥶','🤢','🤮','😪','🤧','😇','😈','👿','🤡','🥸','😎','💩','👻','💀','👾','👽','👺','😺','😸','😹','😻','😾','😿','🙀','😼','🌚','🌝','🧡','💛','💚','🩵','💙','💜','🤎','🖤','🩶','🤍','🩷','💘','💝','💖','💗','💓','💞','💕','💌','💟','♥️','❣️','❤️‍🩹','💔','❤️‍🔥','💋','💐','🌹','🥀','🌺','🌷','🪷','🌸','💮','🏵️','🪻','🌻','🌼','🍂','🍁','🍄','🌾','🌿','🌱','🍃','☘️','🍀','🪴','🌵','🌴','🪾','⚡','🌈','🌊','🔥','☀️','🌞','🌙','⭐','🌑','🌒','🌓','🌔','🌖','🌕','🌗','🌘','🦁','🐯','🐱','🐶','🐺','🐻','🐻‍❄️','🐨','🐼','🐹','🐭','🐰','🦖','🦕','🐢','🐊','🐠','🦐','🐣','🍌','🌽','🥕','🍎','🍓','🍑'];

                // Each bot starts at a different position — spread evenly across the emoji list
                // BOT1 → offset 0, BOT2 → offset 10, BOT3 → offset 20, etc.
                const offsetPerBot = Math.floor(emojiList.length / 10); // ~13 emojis apart
                const startOffset = (threadIndex * offsetPerBot) % emojiList.length;

                const txtEmoTask = { active: true };
                this.activeTxtEmoSenders.set(taskId, txtEmoTask);

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

💬 TxtEmo Attack Started
👤 Name: ${txtEmoName}
⏱️ Delay: ${txtEmoDelay}ms
🎨 Thread: #${threadIndex + 1} • Offset: ${startOffset}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }

                let emojiIndex = startOffset;

                (async () => {
                    while (txtEmoTask.active) {
                        try {
                            const emoji = emojiList[emojiIndex % emojiList.length];
                            const line = `${txtEmoName} 𝐓ᴇ𝐑ɪ 𝐌ᴀᴀ 𝐊ᴀ 𝐠ʜᴀʀ 𝐀ʙ𝐀ᴅ 𝐊ʀᴜ ִֶָ𓂃 ࣪˖ ִִֶֶָ${emoji}་༘࿐`;
                            const fullMsg = Array(11).fill(line).join('\n\n\n');
                            await this.sock.sendMessage(from, { text: fullMsg });
                            emojiIndex++;
                        } catch (err) {
                            console.error(`[${this.botId}] TXTEMO Error:`, err.message);
                        }
                        await delay(txtEmoDelay);
                    }
                })();
            }
            else if (commandType === 'stop_txtemo') {
                const { from } = data;
                const taskId = `${from}_txtemo`;
                if (this.activeTxtEmoSenders.has(taskId)) {
                    this.activeTxtEmoSenders.get(taskId).active = false;
                    this.activeTxtEmoSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

💬 TxtEmo Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                        );
                    }
                }
            }
            else if (commandType === 'start_txt2') {
                const { from, txt2Text, txt2Delay, threadIndex = 0 } = data;

                const taskId = `${from}_txt2`;

                if (this.activeTxt2Senders.has(taskId)) {
                    this.activeTxt2Senders.get(taskId).active = false;
                    await delay(200);
                }

                const txt2Emojis = ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','🩷','🩵','🩶'];

                // Each bot starts at a different emoji offset
                const startOffset = (threadIndex * Math.floor(txt2Emojis.length / 10)) % txt2Emojis.length;

                const txt2Task = { active: true };
                this.activeTxt2Senders.set(taskId, txt2Task);

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

💬 Txt2 Attack Started
📝 Text: ${txt2Text}
⏱️ Delay: ${txt2Delay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }

                let emojiIndex = startOffset;

                (async () => {
                    while (txt2Task.active) {
                        try {
                            const emoji = txt2Emojis[emojiIndex % txt2Emojis.length];
                            const message = `${txt2Text} ${emoji}\n {[${emoji}]}-{[${emoji}]}`;
                            await this.sock.sendMessage(from, { text: message });
                            emojiIndex++;
                        } catch (err) {
                            console.error(`[${this.botId}] TXT2 Error:`, err.message);
                        }
                        await delay(txt2Delay);
                    }
                })();
            }
            else if (commandType === 'stop_txt2') {
                const { from } = data;
                const taskId = `${from}_txt2`;
                if (this.activeTxt2Senders.has(taskId)) {
                    this.activeTxt2Senders.get(taskId).active = false;
                    this.activeTxt2Senders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

💬 Txt2 Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                        );
                    }
                }
            }
            else if (commandType === 'start_cspam') {
                const { from, cspamText, cspamDelay, threadIndex = 0 } = data;

                const taskId = `${from}_cspam`;

                if (this.activeCSpamSenders.has(taskId)) {
                    this.activeCSpamSenders.get(taskId).active = false;
                    await delay(200);
                }

                const cspamEmojis = ['✅','❎','☑️','⬆️','↗️','➡️','↘️','⬇️','↙️','⬅️','↖️','⤴️','⤵️','🔄','🔃','↕️','↔️'];

                // Thread offset — each bot starts at different emoji
                const startOffset = (threadIndex * Math.floor(cspamEmojis.length / 10)) % cspamEmojis.length;

                const cspamTask = { active: true };
                this.activeCSpamSenders.set(taskId, cspamTask);

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

✅ CSpam Started
📝 Text: ${cspamText}
⏱️ Delay: ${cspamDelay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }

                let emojiIndex = startOffset;
                let count = 1;

                (async () => {
                    while (cspamTask.active) {
                        try {
                            const emoji = cspamEmojis[emojiIndex % cspamEmojis.length];
                            const message = `${cspamText}\n\n[${emoji}][${count}][${emoji}]`;
                            await this.sock.sendMessage(from, { text: message });
                            emojiIndex++;
                            count++;
                        } catch (err) {
                            console.error(`[${this.botId}] CSPAM Error:`, err.message);
                        }
                        await delay(cspamDelay);
                    }
                })();
            }
            else if (commandType === 'stop_cspam') {
                const { from } = data;
                const taskId = `${from}_cspam`;
                if (this.activeCSpamSenders.has(taskId)) {
                    this.activeCSpamSenders.get(taskId).active = false;
                    this.activeCSpamSenders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

✅ CSpam Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                        );
                    }
                }
            }
            else if (commandType === 'start_txtemo2') {
                const { from, txtEmo2Name, txtEmo2Delay, threadIndex = 0 } = data;

                const taskId = `${from}_txtemo2`;

                if (this.activeTxtEmo2Senders.has(taskId)) {
                    this.activeTxtEmo2Senders.get(taskId).active = false;
                    await delay(200);
                }

                const emo2List = ['😄','😁','😆','😅','😂','🤣','😭','😉','😍','🤩','🥳','😈','👿','💀','☠️','👻','💥','⚡','🔥','🌪️','🌊','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🩷','🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘','🦁','🐯','🦅','🐉','🌹','🥀','🌺','🌷','⭐','🌟','✨','💫'];

                const startOffset = (threadIndex * Math.floor(emo2List.length / 10)) % emo2List.length;

                const txtEmo2Task = { active: true };
                this.activeTxtEmo2Senders.set(taskId, txtEmo2Task);

                if (sendConfirmation) {
                    await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🔥 TxtEmo2 Attack Started
👤 Name: ${txtEmo2Name}
⏱️ Delay: ${txtEmo2Delay}ms
🎨 Thread: #${threadIndex + 1}
🤖 Bot: ${this.botId}
🚀 Status: Active`
                    );
                }

                let emojiIndex = startOffset;

                (async () => {
                    while (txtEmo2Task.active) {
                        try {
                            const emoji = emo2List[emojiIndex % emo2List.length];
                            const line = `𝆒${txtEmo2Name}𝆓  ⇝┊✼┊ ┊${emoji}┊﹏﹏﹏﹏﹏`;
                            const fullMsg = Array(9).fill(line).join('\n\n\n');
                            await this.sock.sendMessage(from, { text: fullMsg });
                            emojiIndex++;
                        } catch (err) {
                            console.error(`[${this.botId}] TXTEMO2 Error:`, err.message);
                        }
                        await delay(txtEmo2Delay);
                    }
                })();
            }
            else if (commandType === 'stop_txtemo2') {
                const { from } = data;
                const taskId = `${from}_txtemo2`;
                if (this.activeTxtEmo2Senders.has(taskId)) {
                    this.activeTxtEmo2Senders.get(taskId).active = false;
                    this.activeTxtEmo2Senders.delete(taskId);
                    if (sendConfirmation) {
                        await this.sendMessage(from,
`⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🔥 TxtEmo2 Attack Stopped
🤖 Bot: ${this.botId}
⛔ Status: Terminated`
                        );
                    }
                }
            }
        } catch (err) {
            console.error(`[${this.botId}] executeCommand error:`, err.message);
        }
    }

    async sendMessage(jid, text, mentions = [], quotedMsg = null) {
        if (!this.sock || !this.connected) return;
        try {
            const message = { text };
            if (mentions.length > 0) message.mentions = mentions;
            const opts = quotedMsg ? { quoted: quotedMsg } : {};
            await this.sock.sendMessage(jid, message, opts);
        } catch (err) {
            console.error(`[${this.botId}] Send message error:`, err.message);
        }
    }

    // Always slides reply to the original command message
    async replyMessage(jid, text, quotedMsg, mentions = []) {
        if (!this.sock || !this.connected) return;
        try {
            const message = { text };
            if (mentions.length > 0) message.mentions = mentions;
            await this.sock.sendMessage(jid, message, { quoted: quotedMsg });
        } catch (err) {
            console.error(`[${this.botId}] Reply message error:`, err.message);
        }
    }
}

class BotManager {
    constructor() {
        this.bots = new Map();
        this.commandBus = new CommandBus();
        this.botCounter = 0;
        this.loadedData = this.loadBots();
    }

    loadBots() {
        try {
            if (fs.existsSync(BOTS_FILE)) {
                const data = fs.readFileSync(BOTS_FILE, 'utf8');
                const savedBots = JSON.parse(data);
                this.botCounter = savedBots.counter || 0;
                console.log(`[MANAGER] Found ${savedBots.bots?.length || 0} saved bot(s)`);
                return savedBots;
            }
        } catch (err) {
            console.log('[MANAGER] No saved bots found, starting fresh');
        }
        return { counter: 0, bots: [] };
    }

    saveBots() {
        try {
            if (!fs.existsSync('./data')) {
                fs.mkdirSync('./data', { recursive: true });
            }
            const data = {
                counter: this.botCounter,
                bots: Array.from(this.bots.entries()).map(([id, bot]) => ({
                    id,
                    phoneNumber: bot.phoneNumber,
                    connected: bot.connected
                }))
            };
            fs.writeFileSync(BOTS_FILE, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[MANAGER] Error saving bots:', err.message);
        }
    }

    async restoreSavedBots() {
        if (this.loadedData.bots && this.loadedData.bots.length > 0) {
            console.log(`[MANAGER] Restoring ${this.loadedData.bots.length} bot session(s)...`);
            
            for (const botData of this.loadedData.bots) {
                const authPath = `./auth/${botData.id}`;
                const hasAuth = fs.existsSync(authPath) && fs.readdirSync(authPath).length > 0;
                
                let phoneNumber = botData.phoneNumber;
                
                if (!hasAuth && !phoneNumber) {
                    console.log(`\n[MANAGER] ${botData.id} has no credentials and no phone number.`);
                    phoneNumber = await question(`Enter phone number for ${botData.id} (e.g. 919876543210): `);
                    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
                    
                    if (!phoneNumber || phoneNumber.length < 10) {
                        console.log(`[MANAGER] Invalid number. Removing ${botData.id}...`);
                        continue;
                    }
                }
                
                const session = new BotSession(botData.id, phoneNumber, this, null);
                this.bots.set(botData.id, session);
                this.commandBus.registerBot(botData.id, session);
                
                console.log(`[MANAGER] Reconnecting ${botData.id}...`);
                await session.connect();
                await delay(2000);
            }
            
            this.saveBots();
        } else {
            console.log('[MANAGER] No saved sessions. Waiting for first bot via +add command...');
            console.log('[MANAGER] Or pair the first bot manually...\n');
            
            const phoneNumber = await question('Enter phone number for BOT1 (or press Enter to skip): ');
            if (phoneNumber && phoneNumber.trim()) {
                const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
                if (cleanNumber.length >= 10) {
                    await this.addBot(cleanNumber, null);
                }
            } else {
                console.log('[MANAGER] Skipped. Use +add command in WhatsApp to add bots.\n');
            }
        }
    }

    async addBot(phoneNumber, requestingJid = null) {
        this.botCounter++;
        const botId = `BOT${this.botCounter}`;
        
        const session = new BotSession(botId, phoneNumber, this, requestingJid);
        this.bots.set(botId, session);
        this.commandBus.registerBot(botId, session);
        
        await session.connect();
        this.saveBots();
        
        return `⚡ 𝐒ᴛᴏʀᴍ 𝐒ʏsᴛᴇᴍ

🤖 ${botId} Created
📱 Number: ${phoneNumber}
✅ Session: Initialized

⏳ Waiting for pairing code...`;
    }

    async addAiBot(phoneNumber, requestingJid = null) {
        this.botCounter++;
        const botId = `PRIYA`;

        const session = new BotSession(botId, phoneNumber, this, requestingJid, true);
        this.bots.set(botId, session);
        this.commandBus.registerBot(botId, session);

        await session.connect();
        this.saveBots();

        return `┏━━━💕 𝐏𝐑𝐈𝐘𝐀 𝐀𝐈 𝐆𝐈𝐑𝐋 💕━━━┓
┃
┃ 🤖 BOT    :: PRIYA
┃ 💕 TYPE   :: AI Girl
┃ 📱 NUMBER :: ${phoneNumber}
┃
┃ 💬 Reply to any msg to chat
┃ 📌 In groups: say "Priya ..."
┃    or mention her
┃
┗━━━⏳ Waiting for pairing...━┛`;
    }

    removeBot(botId) {
        if (this.bots.has(botId)) {
            this.commandBus.unregisterBot(botId);
            this.bots.delete(botId);
            this.saveBots();
            console.log(`[MANAGER] Removed ${botId}`);
        }
    }
}

console.log('╔══════════════════════════════════╗');
console.log('║   🌪️ 𝐒ᴛᴏʀᴍ ᴍᴜʟᴛɪ ʙᴏᴛ ᴠ1 🌪️  ║');
console.log('║      Powered by Baileys v2.0     ║');
console.log('╚══════════════════════════════════╝\n');

// FIX: catch unhandled promise rejections so bot never crashes silently
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [GLOBAL] Unhandled rejection:', reason?.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('💥 [GLOBAL] Uncaught exception:', err.message);
    // don't exit — keep bot alive
});

// ── MEMORY MONITOR — log every 10 min, warn if high ──
setInterval(() => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    console.log(`[MEM] Heap: ${heapMB}MB  RSS: ${rssMB}MB`);
    if (heapMB > 800) {
        console.warn('[MEM] ⚠️ High memory usage! Consider restarting.');
    }
    // Force GC if available (run node with --expose-gc flag)
    if (global.gc) {
        global.gc();
        console.log('[MEM] GC forced');
    }
}, 10 * 60 * 1000);

const botManager = new BotManager();
await botManager.restoreSavedBots();
rl.close();

console.log('\n✅ 𝐒ᴛᴏʀᴍ Bot System Ready!');
console.log('📌 Send +admin in DM to become admin');
console.log('📌 Send +add [number] to add more bots\n');
