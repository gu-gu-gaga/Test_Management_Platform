/* ================= 后端接口封装（登录 / 会话 / 状态同步） =================
   服务端：node server/index.js（零依赖，默认 8080）
   - 登录拿到令牌后存本地，后续请求带 Authorization: Bearer <token>
   - 令牌 12 小时滑动过期；过期或服务器重启后需重新登录
   - 断网 / 服务不可达时抛 offline 错误，由 app.js 走本地缓存兜底 */
const API = (function () {
  const TOKEN_KEY = 'tmplatform.token';
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { }

  function setToken(t) {
    token = t || '';
    try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch (e) { }
  }
  function getToken() { return token; }

  async function req(method, path, body) {
    const opt = { method, headers: {}, cache: 'no-store' };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    if (token) opt.headers['Authorization'] = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(path, opt);
    } catch (e) {
      const err = new Error('无法连接服务器，请确认后端服务已启动');
      err.offline = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (e) { }
    if (res.status === 401) {
      setToken('');
      const err = new Error((data && data.error) || '未登录或会话已过期');
      err.unauthorized = true;
      throw err;
    }
    if (res.status === 409) return Object.assign({ conflict: true }, data || {});
    if (!res.ok) {
      const err = new Error((data && data.error) || ('请求失败（' + res.status + '）'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    getToken: getToken,
    setToken: setToken,
    login: (name, password) => req('POST', '/api/login', { name: name, password: password }),
    /* 注册：先发邮箱验证码，再带验证码注册 */
    sendRegisterCode: (email) => req('POST', '/api/register/code', { email: email }),
    register: (name, password, email, code) => req('POST', '/api/register', { name: name, password: password, email: email, code: code }),
    /* 找回密码：向账号绑定邮箱发验证码，验证通过后重设口令 */
    findPwdCode: (account) => req('POST', '/api/findpwd/code', { account: account }),
    findPwdReset: (account, code, password) => req('POST', '/api/findpwd/reset', { account: account, code: code, password: password }),
    logout: () => req('POST', '/api/logout', {}).catch(() => null),
    me: () => req('GET', '/api/me'),
    changePassword: (oldPwd, newPwd) => req('POST', '/api/password', { old: oldPwd, new: newPwd }),
    /* 个人资料 */
    setAvatar: (avatar) => req('POST', '/api/account/avatar', { avatar: avatar }),
    setEmail: (email) => req('POST', '/api/account/email', { email: email }),
    /* 邮箱服务配置（仅最高管理员） */
    mailConfig: () => req('GET', '/api/mail/config'),
    saveMailConfig: (cfg) => req('POST', '/api/mail/config', cfg),
    testMail: (to) => req('POST', '/api/mail/test', { to: to }),
    /* 账号管理（管理员）：列表 / 新建 / 改角色 / 启停 / 删除 / 重置口令 */
    accounts: () => req('GET', '/api/accounts'),
    createAccount: (name, password, role) => req('POST', '/api/accounts', { name: name, password: password, role: role }),
    setAccountRole: (name, role) => req('POST', '/api/accounts/role', { name: name, role: role }),
    setAccountStatus: (name, status) => req('POST', '/api/accounts/status', { name: name, status: status }),
    deleteAccount: (name) => req('POST', '/api/accounts/delete', { name: name }),
    resetAccountPassword: (name, password) => req('POST', '/api/accounts/reset-password', { name: name, password: password }),
    getState: () => req('GET', '/api/state'),
    putState: (baseVersion, state) => req('PUT', '/api/state', { baseVersion: baseVersion, state: state }),
    resetState: (state) => req('POST', '/api/state/reset', { state: state }),
    health: () => req('GET', '/api/health')
  };
})();
