/* 测试用例管理平台 · 后端服务（零依赖）
   启动：node server/index.js [端口]      默认 8080
   职责：① 托管静态前端（index.html / app.js / data.js / style.css / xlsx.js / api.js）
        ② 账号登录与会话（scrypt 口令、内存令牌）
        ③ 平台状态持久化（data/db.json，带版本号做乐观锁，冲突由前端三方合并）
        ④ 运行状态查询（/api/health）
   数据目录：server/data/（db.json 主库、accounts.json 账号、backups 快照）*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const auth = require('./auth');
const mailer = require('./mailer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const MAX_BODY = 32 * 1024 * 1024;
/* 是否开放登录页自助注册（TM_REGISTER=off 关闭，账号只能由管理员创建） */
const REGISTER_OPEN = String(process.env.TM_REGISTER || 'on').toLowerCase() !== 'off';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function json(res, code, body) {
  const txt = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(txt)
  });
  res.end(txt);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function tokenOf(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return String(req.headers['x-token'] || '').trim();
}

/* 账号管理权限：内置管理员角色，或自定义角色勾选了「角色与权限配置」 */
function canManageAccounts(me) {
  if (!me) return false;
  if (auth.isAdmin(me.role)) return true;
  try {
    const doc = store.read();
    const r = ((doc.state || {}).roles || []).find(x => x && x.name === me.role);
    return !!(r && (r.perms || []).includes('roleManage'));
  } catch (e) { return false; }
}

/* 按「账号名或邮箱」定位账号（找回密码用，免登录） */
function findAccountByLogin(who) {
  const v = String(who || '').trim().toLowerCase();
  if (!v) return null;
  const list = auth.load();
  const name = Object.keys(list).find(n => n.toLowerCase() === v || String(list[n].email || '').toLowerCase() === v);
  if (!name) return null;
  const acc = list[name];
  return { name, role: acc.role, status: acc.status || 'active', email: String(acc.email || '').trim().toLowerCase() };
}

/* 邮箱脱敏：ab***@company.com */
function maskMail(mail) {
  const [a, b] = String(mail || '').split('@');
  if (!b) return mail || '';
  const head = a.length <= 2 ? a.slice(0, 1) + '*' : a.slice(0, 2) + '***';
  return head + '@' + b;
}

/* 保存后把「角色 → 成员」同步到账号表，保证登录角色与应用内的角色权限一致 */
function syncRoles(state) {
  if (!state || !Array.isArray(state.roles)) return;
  state.roles.forEach(r => {
    if (!r || !r.name) return;
    (r.users || []).forEach(u => {
      if (!u) return;
      try { auth.setRole(u, r.name); } catch (e) { }
    });
  });
}

async function handleApi(req, res, url) {
  const p = url.pathname;

  if (p === '/api/health' && req.method === 'GET') {
    return json(res, 200, {
      ok: true, name: '测试任务执行平台',
      serverTime: new Date().toISOString(),
      store: store.info(),
      accounts: auth.names().length,
      mail: mailer.mailReady()
    });
  }

  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b.name || !b.password) return json(res, 400, { error: '请填写账号与密码' });
    const r = auth.login(String(b.name).trim(), String(b.password));
    if (r.error) return json(res, 401, { error: r.error });
    return json(res, 200, r);
  }

  if (p === '/api/logout' && req.method === 'POST') {
    auth.logout(tokenOf(req));
    return json(res, 200, { ok: true });
  }

  /* 注册第一步：向邮箱发送 6 位验证码（免登录）
     需要先在「设置 → 邮箱服务」配置 SMTP；dev 模式下不发信，验证码直接返回 */
  if (p === '/api/register/code' && req.method === 'POST') {
    if (!REGISTER_OPEN) return json(res, 403, { error: '平台已关闭自助注册，请联系管理员开通账号' });
    const b = await readBody(req);
    const email = String(b.email || '').trim().toLowerCase();
    if (!auth.EMAIL_RE.test(email)) return json(res, 400, { error: '请填写正确的邮箱地址' });
    if (auth.findByEmail(email)) return json(res, 400, { error: `邮箱「${email}」已被注册` });
    if (!mailer.mailReady()) return json(res, 400, { error: '邮箱服务未配置，请联系管理员在「设置 → 邮箱服务」中配置' });
    const r = mailer.issueCode(email);
    if (r.error) return json(res, 429, { error: r.error });
    try {
      await mailer.sendMail({
        to: email,
        subject: '【测试任务执行平台】注册验证码',
        text: `您正在注册「测试任务执行平台」账号，验证码：${r.code}\n\n验证码 5 分钟内有效，请勿转发他人。如非本人操作，请忽略本邮件。`
      });
    } catch (e) {
      return json(res, 500, { error: '验证码发送失败：' + String((e && e.message) || e) });
    }
    const dev = mailer.readConf().dev;
    return json(res, 200, { ok: true, dev, code: dev ? r.code : undefined });
  }

  /* 注册第二步：校验邮箱验证码后创建账号（默认角色「三级」）
     如需关闭入口：启动时设置环境变量 TM_REGISTER=off */
  if (p === '/api/register' && req.method === 'POST') {
    if (!REGISTER_OPEN) return json(res, 403, { error: '平台已关闭自助注册，请联系管理员开通账号' });
    const b = await readBody(req);
    const v = mailer.verifyCode(b.email, b.code);
    if (v.error) return json(res, 400, { error: v.error });
    const r = auth.register(b.name, b.password, b.email);
    return json(res, r.error ? 400 : 200, r);
  }

  /* 找回密码第一步：向账号绑定的邮箱发送 6 位验证码（免登录）
     支持用「账号」或「绑定邮箱」任一方式定位账号；dev 模式下不发信，验证码直接返回 */
  if (p === '/api/findpwd/code' && req.method === 'POST') {
    const b = await readBody(req);
    const acc = findAccountByLogin(b.account);
    if (!acc) return json(res, 400, { error: '账号不存在，请检查账号 / 邮箱是否正确' });
    if (acc.status === 'disabled') return json(res, 403, { error: '账号已停用，请联系管理员' });
    if (!auth.EMAIL_RE.test(acc.email)) return json(res, 400, { error: '该账号未绑定邮箱，请联系管理员重置密码' });
    if (!mailer.mailReady()) return json(res, 400, { error: '邮箱服务未配置，请联系管理员在「设置 → 邮箱服务」中配置' });
    const r = mailer.issueCode(acc.email);
    if (r.error) return json(res, 429, { error: r.error });
    try {
      await mailer.sendMail({
        to: acc.email,
        subject: '【测试任务执行平台】找回密码验证码',
        text: `您正在找回「测试任务执行平台」账号「${acc.name}」的密码，验证码：${r.code}\n\n验证码 5 分钟内有效。如非本人操作，请忽略本邮件，并尽快联系管理员。`
      });
    } catch (e) {
      return json(res, 500, { error: '验证码发送失败：' + String((e && e.message) || e) });
    }
    const dev = mailer.readConf().dev;
    return json(res, 200, { ok: true, dev, code: dev ? r.code : undefined, email: maskMail(acc.email) });
  }

  /* 找回密码第二步：校验邮箱验证码后重设口令（免登录，成功后旧会话全部失效） */
  if (p === '/api/findpwd/reset' && req.method === 'POST') {
    const b = await readBody(req);
    const acc = findAccountByLogin(b.account);
    if (!acc) return json(res, 400, { error: '账号不存在' });
    if (acc.status === 'disabled') return json(res, 403, { error: '账号已停用，请联系管理员' });
    if (!auth.EMAIL_RE.test(acc.email)) return json(res, 400, { error: '该账号未绑定邮箱，请联系管理员重置密码' });
    if (String(b.password || '').length < 6) return json(res, 400, { error: '新密码至少 6 位' });
    const v = mailer.verifyCode(acc.email, b.code);
    if (v.error) return json(res, 400, { error: v.error });
    /* 自助重置不需要首次登录强制改口令 */
    const r = auth.resetPassword(acc.name, String(b.password), { mustChange: false });
    if (r.error) return json(res, 400, r);
    return json(res, 200, { ok: true, name: acc.name });
  }

  /* 以下接口都需要登录 */
  const me = auth.verify(tokenOf(req));
  if (!me) return json(res, 401, { error: '未登录或会话已过期' });

  if (p === '/api/me' && req.method === 'GET') return json(res, 200, { user: me });

  /* ---- 个人资料（本人操作）---- */
  if (p === '/api/account/avatar' && req.method === 'POST') {
    const b = await readBody(req);
    const r = auth.setAvatar(me.name, b.avatar);
    return json(res, r.error ? 400 : 200, r);
  }

  if (p === '/api/account/email' && req.method === 'POST') {
    const b = await readBody(req);
    const r = auth.setEmail(me.name, b.email);
    return json(res, r.error ? 400 : 200, r);
  }

  /* ---- 邮箱服务配置（仅最高管理员）---- */
  if (p === '/api/mail/config') {
    if (me.role !== '最高管理员') return json(res, 403, { error: '仅最高管理员可配置邮箱服务' });
    if (req.method === 'GET') return json(res, 200, { config: mailer.publicConf() });
    if (req.method === 'POST') {
      const b = await readBody(req);
      const patch = {
        host: b.host, port: b.port, secure: b.secure, starttls: b.starttls,
        user: b.user, from: b.from, fromName: b.fromName, dev: b.dev
      };
      /* 口令留空表示不修改 */
      if (b.pass !== undefined && b.pass !== null && String(b.pass) !== '') patch.pass = String(b.pass);
      const next = mailer.saveConf(patch);
      return json(res, 200, { ok: true, config: mailer.publicConf(), ready: mailer.mailReady(), dev: next.dev });
    }
  }

  if (p === '/api/mail/test' && req.method === 'POST') {
    if (me.role !== '最高管理员') return json(res, 403, { error: '仅最高管理员可发送测试邮件' });
    const b = await readBody(req);
    const to = String(b.to || '').trim() || String(b.email || '').trim();
    if (!auth.EMAIL_RE.test(to)) return json(res, 400, { error: '请填写正确的收件邮箱' });
    if (!mailer.mailReady()) return json(res, 400, { error: '邮箱服务未配置完整（主机 / 账号 / 授权码）' });
    try {
      await mailer.sendMail({
        to,
        subject: '【测试任务执行平台】邮箱服务测试',
        text: '这是一封测试邮件，收到即表示「设置 → 邮箱服务」配置可用。\n\n发送时间：' + new Date().toLocaleString('zh-CN')
      });
    } catch (e) {
      return json(res, 500, { error: '发送失败：' + String((e && e.message) || e) });
    }
    return json(res, 200, { ok: true, message: mailer.readConf().dev ? '调试模式：未实际发信，内容已输出到服务端日志' : `测试邮件已发送至 ${to}` });
  }

  if (p === '/api/password' && req.method === 'POST') {
    const b = await readBody(req);
    const r = auth.changePassword(me.name, String(b.old || ''), String(b.new || ''));
    return json(res, r.error ? 400 : 200, r);
  }

  if (p === '/api/state' && req.method === 'GET') {
    const doc = store.read();
    return json(res, 200, {
      version: doc.version, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy,
      state: doc.state, user: me
    });
  }

  if (p === '/api/state' && (req.method === 'PUT' || req.method === 'POST')) {
    const b = await readBody(req);
    if (!b || typeof b.state !== 'object' || b.state === null) return json(res, 400, { error: 'state 不能为空' });
    const r = store.save(b.state, b.baseVersion, me.name);
    if (r.conflict) {
      return json(res, 409, {
        conflict: true, version: r.doc.version, updatedAt: r.doc.updatedAt,
        updatedBy: r.doc.updatedBy, state: r.doc.state
      });
    }
    syncRoles(b.state);
    return json(res, 200, { ok: true, version: r.doc.version, updatedAt: r.doc.updatedAt });
  }

  /* 清空业务数据（仅一级及以上）：服务端落一份空白状态，客户端随后拉取 */
  if (p === '/api/state/reset' && req.method === 'POST') {
    const b = await readBody(req);
    if (!['最高管理员', '一级'].includes(me.role)) return json(res, 403, { error: '仅一级及以上账号可清空数据' });
    const doc = store.save(b && b.state ? b.state : null, null, me.name);
    return json(res, 200, { ok: true, version: doc.doc.version });
  }

  /* ---- 账号管理（管理员）：列表 / 新建 / 改角色 / 启停 / 删除 ---- */
  if (p === '/api/accounts' && req.method === 'GET') {
    if (!canManageAccounts(me)) return json(res, 403, { error: '无「账号管理」权限' });
    return json(res, 200, { accounts: auth.listAccounts(), roles: auth.ADMIN_ROLES });
  }

  if (p === '/api/accounts' && req.method === 'POST') {
    if (!canManageAccounts(me)) return json(res, 403, { error: '无「账号管理」权限' });
    const b = await readBody(req);
    const r = auth.create(b.name, b.password, b.role, me.name);
    return json(res, r.error ? 400 : 200, r);
  }

  if (p === '/api/accounts/role' && req.method === 'POST') {
    if (!canManageAccounts(me)) return json(res, 403, { error: '无「账号管理」权限' });
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    const role = String(b.role || '').trim();
    if (!auth.has(name)) return json(res, 400, { error: '账号不存在' });
    if (!role) return json(res, 400, { error: '请选择角色' });
    auth.setRole(name, role);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/accounts/status' && req.method === 'POST') {
    if (!canManageAccounts(me)) return json(res, 403, { error: '无「账号管理」权限' });
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (name === me.name) return json(res, 400, { error: '不能停用当前登录账号' });
    const r = auth.setStatus(name, b.status);
    return json(res, r.error ? 400 : 200, r);
  }

  if (p === '/api/accounts/delete' && req.method === 'POST') {
    if (!canManageAccounts(me)) return json(res, 403, { error: '无「账号管理」权限' });
    const b = await readBody(req);
    const name = String(b.name || '').trim();
    if (name === me.name) return json(res, 400, { error: '不能删除当前登录账号' });
    const r = auth.remove(name);
    return json(res, r.error ? 400 : 200, r);
  }

  if (p === '/api/accounts/reset-password' && req.method === 'POST') {
    if (!canManageAccounts(me)) return json(res, 403, { error: '无「账号管理」权限' });
    const b = await readBody(req);
    const r = auth.resetPassword(String(b.name || ''), String(b.password || auth.DEFAULT_PASSWORD));
    return json(res, r.error ? 400 : 200, r);
  }

  return json(res, 404, { error: '接口不存在' });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  /* 保护后端源码与数据（账号口令哈希、主库文件不可被下载） */
  if (p === '/server' || p.startsWith('/server/') || p.startsWith('/_pwcli') || p.includes('/.')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 forbidden');
  }
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 not found');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (e) {
      json(res, 500, { error: String((e && e.message) || e) });
    }
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  const i = store.info();
  console.log(`[server] http://127.0.0.1:${PORT}/  数据版本 v${i.version}  账号 ${auth.names().length} 个`);
});
