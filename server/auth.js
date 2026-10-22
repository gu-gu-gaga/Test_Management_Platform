/* 账号与会话：scrypt 口令哈希 + 内存令牌（重启后需重新登录）
   账号来源（平台不依赖任何外部 OA 账号体系，账号全部由本服务独立维护）：
     ① 首次启动按 data.js 的角色表 / 部门成员表生成（默认口令 DEFAULT_PASSWORD）
     ② 登录页「注册新账号」自助注册（默认角色 DEFAULT_ROLE，可在账号管理里调整）
     ③ 管理员在「权限管理 → 账号管理」中新建 / 停用 / 改角色 / 重置口令
   账号文件：data/accounts.json */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ACC_FILE = path.join(DATA_DIR, 'accounts.json');
const DEFAULT_PASSWORD = '123456';
const DEFAULT_ROLE = '三级';          // 自助注册账号的默认角色（最小权限）
const ADMIN_ROLES = ['最高管理员', '一级'];
const STATIC_ADMIN = 'admin';         // 平台保留的管理员账号名
const TOKEN_TTL = 12 * 60 * 60 * 1000;   // 12 小时
const NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_.@-]{2,20}$/;

let accounts = null;      // { name: { salt, hash, role, mustChange, status, createdAt, createdBy, lastLoginAt } }
const tokens = new Map(); // token -> { name, exp }

function hash(pwd, salt) {
  return crypto.scryptSync(String(pwd), salt, 32).toString('hex');
}
function nowStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function makeAccount(name, role, password) {
  const salt = crypto.randomBytes(12).toString('hex');
  return { salt, hash: hash(password || DEFAULT_PASSWORD, salt), role, mustChange: !password };
}
/* 兼容早期账号文件：补齐「状态 / 注册时间 / 来源 / 最近登录 / 邮箱 / 头像」等字段 */
function norm(acc) {
  if (!acc.status) acc.status = 'active';
  if (acc.createdAt == null) acc.createdAt = '';
  if (acc.createdBy == null) acc.createdBy = '平台初始化';
  if (acc.lastLoginAt == null) acc.lastLoginAt = '';
  if (acc.email == null) acc.email = '';
  if (acc.avatar == null) acc.avatar = '';
  if (!acc.role) acc.role = DEFAULT_ROLE;
  return acc;
}
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/* 从 data.js 读出角色与成员（与前端同源，避免两处维护） */
function readBaseFromDataJs() {
  const file = path.join(__dirname, '..', 'data.js');
  const code = fs.readFileSync(file, 'utf8');
  const fn = new Function('window', code + '\n;return (typeof mock !== "undefined") ? mock : (window && window.mock);');
  const mock = fn({}) || {};
  const roles = Array.isArray(mock.roles) ? mock.roles : [];
  const members = Array.isArray(mock.deptMembers) ? mock.deptMembers.slice() : [];
  const roleOf = {};
  roles.forEach(r => (r.users || []).forEach(u => { roleOf[u] = r.name; }));
  members.forEach(m => { if (!roleOf[m]) roleOf[m] = '三级'; });
  return { roles, members, roleOf };
}

/* 平台始终保留的管理员入口账号：账号缺失或没有可用管理员时自动补建 */
function ensureAdmin() {
  const alive = Object.keys(accounts).filter(n => ADMIN_ROLES.includes(accounts[n].role) && accounts[n].status !== 'disabled');
  if (alive.length) return;
  if (!accounts[STATIC_ADMIN]) accounts[STATIC_ADMIN] = makeAccount(STATIC_ADMIN, '最高管理员');
  accounts[STATIC_ADMIN].role = '最高管理员';
  accounts[STATIC_ADMIN].status = 'active';
  saveAccounts();
}

function load() {
  if (accounts) return accounts;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    accounts = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8'));
    Object.keys(accounts).forEach(n => norm(accounts[n]));
  } catch (e) {
    const base = readBaseFromDataJs();
    accounts = {};
    base.members.forEach(name => { accounts[name] = makeAccount(name, base.roleOf[name] || '三级'); });
    /* 角色表里有但不在部门成员表里的人（以及保底管理员 admin）也建账号 */
    Object.keys(base.roleOf).forEach(name => {
      if (!accounts[name]) accounts[name] = makeAccount(name, base.roleOf[name]);
    });
    if (!accounts[STATIC_ADMIN]) accounts[STATIC_ADMIN] = makeAccount(STATIC_ADMIN, '最高管理员');
    Object.keys(accounts).forEach(n => {
      const a = norm(accounts[n]);
      a.createdAt = nowStr();
      a.createdBy = '平台初始化';
      a.lastLoginAt = '';
    });
    saveAccounts();
  }
  /* 账号文件里没有任何可用管理员时，自动补建 admin，避免平台失去管理入口 */
  ensureAdmin();
  return accounts;
}

function saveAccounts() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ACC_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(accounts, null, 2), 'utf8');
  fs.renameSync(tmp, ACC_FILE);
}

/* 停用 / 删除账号时把其在线令牌一并失效 */
function dropTokens(name) {
  Array.from(tokens.keys()).forEach(t => {
    const s = tokens.get(t);
    if (s && s.name === name) tokens.delete(t);
  });
}

function login(name, password) {
  const list = load();
  const acc = list[name];
  if (!acc) return { error: '账号不存在' };
  if (acc.status === 'disabled') return { error: '账号已停用，请联系管理员' };
  if (!acc.hash) { acc.hash = makeAccount(name, acc.role, password).hash; }
  const salt = acc.salt || (acc.salt = crypto.randomBytes(12).toString('hex'));
  if (hash(password, salt) !== acc.hash) return { error: '密码不正确' };
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { name, exp: Date.now() + TOKEN_TTL });
  acc.lastLoginAt = nowStr();
  try { saveAccounts(); } catch (e) { }
  return { token, user: { name, role: acc.role, mustChange: !!acc.mustChange, email: acc.email || '', avatar: acc.avatar || '' } };
}

function logout(token) { tokens.delete(token); }

function verify(token) {
  if (!token) return null;
  const s = tokens.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { tokens.delete(token); return null; }
  s.exp = Date.now() + TOKEN_TTL;   // 滑动续期
  const acc = load()[s.name];
  if (!acc || acc.status === 'disabled') { tokens.delete(token); return null; }
  return {
    name: s.name, role: (acc && acc.role) || '三级',
    email: (acc && acc.email) || '', avatar: (acc && acc.avatar) || '',
    mustChange: !!(acc && acc.mustChange)
  };
}

function changePassword(name, oldPwd, newPwd) {
  const list = load();
  const acc = list[name];
  if (!acc) return { error: '账号不存在' };
  if (hash(oldPwd, acc.salt) !== acc.hash) return { error: '原密码不正确' };
  if (String(newPwd || '').length < 6) return { error: '新密码至少 6 位' };
  const salt = crypto.randomBytes(12).toString('hex');
  acc.salt = salt;
  acc.hash = hash(newPwd, salt);
  acc.mustChange = false;
  saveAccounts();
  return { ok: true };
}

/* 重置口令（管理员重置 / 邮箱自助找回）
   opts.mustChange=false 表示本人自助重置，不再强制首次登录改口令 */
function resetPassword(name, newPwd, opts) {
  const list = load();
  if (!list[name]) return { error: '账号不存在' };
  if (String(newPwd || '').length < 6) return { error: '新密码至少 6 位' };
  const salt = crypto.randomBytes(12).toString('hex');
  list[name].salt = salt;
  list[name].hash = hash(newPwd, salt);
  list[name].mustChange = !(opts && opts.mustChange === false);
  saveAccounts();
  dropTokens(name);
  return { ok: true };
}

/* 自助注册：默认角色 三级，需通过邮箱验证码校验（email 由接口层校验过验证码后传入） */
function register(name, password, email) {
  const n = String(name || '').trim();
  const p = String(password || '');
  const mail = String(email || '').trim().toLowerCase();
  if (!n) return { error: '请填写账号' };
  if (!NAME_RE.test(n)) return { error: '账号需 2-20 位，可用中文、字母、数字、下划线、@、点、横线' };
  if (p.length < 6) return { error: '密码至少 6 位' };
  if (!EMAIL_RE.test(mail)) return { error: '请填写正确的邮箱地址' };
  const list = load();
  if (list[n]) return { error: `账号「${n}」已存在` };
  if (findByEmail(mail)) return { error: `邮箱「${mail}」已被其他账号使用` };
  const acc = makeAccount(n, DEFAULT_ROLE, p);
  acc.mustChange = false;
  acc.status = 'active';
  acc.createdAt = nowStr();
  acc.createdBy = '自助注册';
  acc.lastLoginAt = '';
  acc.email = mail;
  acc.avatar = '';
  list[n] = acc;
  saveAccounts();
  return { ok: true, user: { name: n, role: acc.role, mustChange: false, email: mail } };
}

/* 邮箱是否已被占用（返回账号名） */
function findByEmail(email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) return '';
  const list = load();
  return Object.keys(list).find(n => String(list[n].email || '').toLowerCase() === mail) || '';
}

/* 个人头像（dataURL，前端已压缩到 128×128 以内） */
function setAvatar(name, dataUrl) {
  const acc = load()[name];
  if (!acc) return { error: '账号不存在' };
  const v = String(dataUrl || '');
  if (v && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(v)) return { error: '头像格式不支持' };
  if (v.length > 400 * 1024) return { error: '头像文件过大（请压缩到 300KB 以内）' };
  acc.avatar = v;
  saveAccounts();
  return { ok: true, avatar: v };
}

/* 修改绑定邮箱（本人操作，需唯一） */
function setEmail(name, email) {
  const acc = load()[name];
  if (!acc) return { error: '账号不存在' };
  const mail = String(email || '').trim().toLowerCase();
  if (mail && !EMAIL_RE.test(mail)) return { error: '请填写正确的邮箱地址' };
  const owner = findByEmail(mail);
  if (owner && owner !== name) return { error: `邮箱「${mail}」已被账号「${owner}」使用` };
  acc.email = mail;
  saveAccounts();
  return { ok: true, email: mail };
}

/* 管理员新建账号（首次登录强制改口令） */
function create(name, password, role, createdBy) {
  const n = String(name || '').trim();
  const p = String(password || '');
  if (!NAME_RE.test(n)) return { error: '账号需 2-20 位，可用中文、字母、数字、下划线、@、点、横线' };
  if (p.length < 6) return { error: '初始口令至少 6 位' };
  const list = load();
  if (list[n]) return { error: `账号「${n}」已存在` };
  const acc = makeAccount(n, String(role || DEFAULT_ROLE), p);
  acc.mustChange = true;
  acc.status = 'active';
  acc.createdAt = nowStr();
  acc.createdBy = createdBy || '管理员';
  acc.lastLoginAt = '';
  list[n] = acc;
  saveAccounts();
  return { ok: true, user: { name: n, role: acc.role } };
}

function setRole(name, role) {
  const list = load();
  if (!list[name]) list[name] = makeAccount(name, role);
  else list[name].role = role;
  saveAccounts();
}

function setStatus(name, status) {
  const acc = load()[name];
  if (!acc) return { error: '账号不存在' };
  if (!['active', 'disabled'].includes(String(status))) return { error: '状态不合法' };
  acc.status = status;
  saveAccounts();
  if (status === 'disabled') dropTokens(name);
  return { ok: true };
}

function remove(name) {
  const list = load();
  const acc = list[name];
  if (!acc) return { error: '账号不存在' };
  const admins = Object.keys(list).filter(n => ADMIN_ROLES.includes(list[n].role) && list[n].status !== 'disabled');
  if (ADMIN_ROLES.includes(acc.role) && admins.length <= 1) return { error: '至少保留一个可用的管理员账号' };
  delete list[name];
  saveAccounts();
  dropTokens(name);
  return { ok: true };
}

/* 账号列表（不含口令哈希），按账号名排序 */
function listAccounts() {
  const l = load();
  return Object.keys(l).map(n => ({
    name: n,
    role: l[n].role || DEFAULT_ROLE,
    status: l[n].status || 'active',
    mustChange: !!l[n].mustChange,
    email: l[n].email || '',
    avatar: l[n].avatar || '',
    createdAt: l[n].createdAt || '',
    createdBy: l[n].createdBy || '',
    lastLoginAt: l[n].lastLoginAt || ''
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}

function isAdmin(role) { return ADMIN_ROLES.includes(String(role || '')); }
function has(name) { return !!load()[name]; }
function names() { return Object.keys(load()); }

module.exports = {
  login, logout, verify, changePassword, resetPassword, setRole, setStatus, remove,
  register, create, listAccounts, isAdmin, has, names, load, loadAccounts: load,
  setAvatar, setEmail, findByEmail, EMAIL_RE,
  DEFAULT_PASSWORD, DEFAULT_ROLE, ADMIN_ROLES
};
