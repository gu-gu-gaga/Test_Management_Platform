/* 邮件服务（零依赖）：SMTP 直连发送 + 注册验证码
   配置：server/data/mail.json
     { host, port, secure, starttls, user, pass, from, fromName, dev }
     - secure: true  → 465 端口，连接即 TLS
     - starttls: true → 587 端口，EHLO 后 STARTTLS 升级
     - dev: true     → 不发信，验证码直接返回给前端（无 SMTP 环境调试用）
   仅管理员（最高管理员）可读写配置 */
const fs = require('fs');
const net = require('net');
const tls = require('tls');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const CONF = path.join(DATA_DIR, 'mail.json');

const DEFAULTS = {
  host: '', port: 465, secure: true, starttls: false,
  user: '', pass: '', from: '', fromName: '测试任务执行平台',
  dev: false
};

function readConf() {
  try {
    const c = JSON.parse(fs.readFileSync(CONF, 'utf8'));
    return Object.assign({}, DEFAULTS, c);
  } catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveConf(patch) {
  const cur = readConf();
  const next = Object.assign({}, cur, patch || {});
  next.port = Number(next.port) || (next.secure ? 465 : 587);
  next.secure = !!next.secure;
  next.starttls = !!next.starttls;
  next.dev = !!next.dev;
  ['host', 'user', 'pass', 'from', 'fromName'].forEach(k => { next[k] = String(next[k] || '').trim(); });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}
/* 对外返回的配置：口令不返回明文 */
function publicConf() {
  const c = readConf();
  return {
    host: c.host, port: c.port, secure: c.secure, starttls: c.starttls,
    user: c.user, from: c.from, fromName: c.fromName, dev: c.dev,
    hasPass: !!c.pass,
    ready: !!c.dev || !!(c.host && c.user && c.pass)
  };
}

function b64(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }
function qpHeader(s) { return '=?UTF-8?B?' + b64(s) + '?='; }

/* 极简 SMTP 会话：按行读取响应，逐条命令推进 */
function smtpSend(conf, mail) {
  return new Promise((resolve, reject) => {
    const host = conf.host;
    const port = Number(conf.port) || (conf.secure ? 465 : 587);
    let socket = conf.secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    let buf = '';
    let step = 0;
    let closed = false;
    const timer = setTimeout(() => { done(new Error('连接邮件服务器超时（' + host + ':' + port + '）')); }, 15000);

    function done(err) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (e) { }
      err ? reject(err) : resolve({ ok: true });
    }
    function write(line) {
      try { socket.write(line + '\r\n'); } catch (e) { done(e); }
    }
    function authLogin() {
      write('AUTH LOGIN');
    }
    function next() {
      switch (step) {
        case 0: write('EHLO tmplatform'); step = 1; break;            /* 问候 220 后 */
        case 1: /* EHLO 响应 */
          if (!conf.secure && conf.starttls && !tlsUpgraded) {
            write('STARTTLS'); step = 2;
          } else if (conf.user) { authLogin(); step = 3; }
          else { write('MAIL FROM:<' + (conf.from || conf.user) + '>'); step = 6; }
          break;
        case 2: { /* STARTTLS 响应 220：把明文连接升级为 TLS，再重新 EHLO */
          const plain = socket;
          plain.removeAllListeners('data');
          plain.removeAllListeners('close');
          plain.removeAllListeners('error');
          tlsUpgraded = true;
          socket = tls.connect({ socket: plain, servername: host }, () => { write('EHLO tmplatform'); step = 1; });
          socket.on('data', onData);
          socket.on('error', e => done(e));
          socket.on('close', () => { if (!closed) done(new Error('邮件服务器断开连接')); });
          break;
        }
        case 3: /* AUTH LOGIN 334 */
          write(b64(conf.user)); step = 4; break;
        case 4: /* 用户名 334 */
          write(b64(conf.pass)); step = 5; break;
        case 5: /* 认证 235 */
          write('MAIL FROM:<' + (conf.from || conf.user) + '>'); step = 6; break;
        case 6: write('RCPT TO:<' + mail.to + '>'); step = 7; break;
        case 7: write('DATA'); step = 8; break;
        case 8: socket.write(mail.raw + '\r\n.\r\n'); step = 9; break;
        case 9: write('QUIT'); step = 10; break;
        default: done(null); break;
      }
    }
    let tlsUpgraded = false;
    let multi = false;

    function onData(chunk) {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (/^\d{3}-/.test(line)) { multi = true; continue; }
        if (!/^\d{3} /.test(line)) continue;
        multi = false;
        const code = Number(line.slice(0, 3));
        if (code >= 400) return done(new Error('邮件服务器返回 ' + line));
        next();
      }
    }
    if (conf.secure) {
      socket.on('secureConnect', () => { });
    }
    socket.on('data', onData);
    socket.on('error', e => done(e));
    socket.on('close', () => { if (!closed) done(new Error('邮件服务器断开连接')); });
    /* 非 TLS 连接建立后先等服务端问候 220，由 onData 触发 */
    socket.on(conf.secure ? 'secureConnect' : 'connect', () => { /* 等待 220 */ });
  });
}

function buildRaw(conf, mail) {
  const from = conf.from || conf.user;
  const fromName = conf.fromName || '测试任务执行平台';
  const body = Buffer.from(mail.text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    'From: ' + qpHeader(fromName) + ' <' + from + '>',
    'To: <' + mail.to + '>',
    'Subject: ' + qpHeader(mail.subject),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(8).toString('hex') + '@tmplatform>',
    '',
    body
  ].join('\r\n');
}

async function sendMail(mail) {
  const conf = readConf();
  if (conf.dev) {
    console.log('[mail:dev] to=' + mail.to + ' subject=' + mail.subject + '\n' + mail.text);
    return { ok: true, dev: true };
  }
  if (!conf.host || !conf.user || !conf.pass) {
    throw new Error('邮箱服务未配置：请由管理员在「设置 → 邮箱服务」中填写 SMTP 信息');
  }
  const raw = buildRaw(conf, mail);
  return smtpSend(conf, { to: mail.to, raw });
}

/* ---------- 注册验证码（内存保存，5 分钟有效，最多 5 次校验） ---------- */
const codes = new Map();     // email -> { code, exp, tries, sentAt }
const CODE_TTL = 5 * 60 * 1000;
const SEND_GAP = 60 * 1000;  // 同一邮箱 60 秒内不重复发送

function issueCode(email) {
  const key = String(email || '').trim().toLowerCase();
  const old = codes.get(key);
  if (old && Date.now() - old.sentAt < SEND_GAP) {
    const wait = Math.ceil((SEND_GAP - (Date.now() - old.sentAt)) / 1000);
    return { error: `验证码已发送，请 ${wait} 秒后再试` };
  }
  const code = String(crypto.randomInt(100000, 999999));
  codes.set(key, { code, exp: Date.now() + CODE_TTL, tries: 0, sentAt: Date.now() });
  return { code, key };
}

function verifyCode(email, code) {
  const key = String(email || '').trim().toLowerCase();
  const rec = codes.get(key);
  if (!rec) return { error: '请先获取邮箱验证码' };
  if (rec.exp < Date.now()) { codes.delete(key); return { error: '验证码已过期，请重新获取' }; }
  rec.tries++;
  if (rec.tries > 5) { codes.delete(key); return { error: '验证码错误次数过多，请重新获取' }; }
  if (String(code || '').trim() !== rec.code) return { error: '验证码不正确' };
  codes.delete(key);
  return { ok: true };
}

function mailReady() {
  const c = readConf();
  return !!c.dev || !!(c.host && c.user && c.pass);
}

module.exports = { readConf, saveConf, publicConf, sendMail, issueCode, verifyCode, mailReady };
