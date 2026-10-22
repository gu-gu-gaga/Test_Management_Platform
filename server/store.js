/* 数据存储：全量状态 JSON + 版本号，原子写入 + 定时快照备份（零依赖） */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP = 20;

let cache = null;      // { version, updatedAt, updatedBy, state }
let writeTimer = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function emptyDoc() {
  return { version: 0, updatedAt: '', updatedBy: '', state: null };
}

function read() {
  if (cache) return cache;
  ensureDirs();
  try {
    const txt = fs.readFileSync(DB_FILE, 'utf8');
    const doc = JSON.parse(txt);
    cache = Object.assign(emptyDoc(), doc);
  } catch (e) {
    cache = emptyDoc();
  }
  return cache;
}

function writeAtomic(doc) {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function backup(doc) {
  try {
    const name = 'db-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(doc), 'utf8');
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-')).sort();
    while (files.length > BACKUP_KEEP) {
      const old = files.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (e) { }
    }
  } catch (e) { /* 备份失败不影响主流程 */ }
}

/* 保存：baseVersion 与服务端版本一致才覆盖（乐观锁）；不一致返回 {conflict:true, doc} */
function save(state, baseVersion, user) {
  const doc = read();
  if (baseVersion != null && Number(baseVersion) !== doc.version) {
    return { conflict: true, doc };
  }
  const next = {
    version: doc.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: user || '',
    state
  };
  writeAtomic(next);
  cache = next;
  /* 每 30 次写入做一次快照备份，避免磁盘堆积 */
  if (next.version % 30 === 1) backup(next);
  return { conflict: false, doc: next };
}

function reset(user) {
  const doc = read();
  const next = { version: doc.version + 1, updatedAt: new Date().toISOString(), updatedBy: user || '', state: null };
  writeAtomic(next);
  cache = next;
  backup(next);
  return next;
}

function info() {
  const doc = read();
  let size = 0;
  try { size = fs.statSync(DB_FILE).size; } catch (e) { }
  return { version: doc.version, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, hasState: !!doc.state, bytes: size };
}

module.exports = { read, save, reset, info, DATA_DIR };
